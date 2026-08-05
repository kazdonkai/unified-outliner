/**
 * Phase 4A: List Subtree Relocation in Outline.
 *
 * Pure, Obsidian-free function that relocates a whole list-item subtree
 * (the item itself + every nested child item — already exactly what
 * ListBlockNode.range spans, the same range move-block-up/down and
 * indent-block/outdent-block already treat as one unit) to before, after,
 * or inside another node — a list item OR a section — for the Outline Tree
 * View's drag & drop (view/OutlineTreeView.ts). This mirrors
 * move/relocateSection.ts's shape and role (canDropOn-style preflight +
 * a relocate function returning the same {changed, lines, newStartLine,
 * reason?} outcome shape every other block-scoped command uses), extended
 * to a second source kind rather than sharing one function, since sections
 * and list items differ in exactly the two places that matter here: what a
 * "cycle" means (a list item can never contain a section, so cycle
 * prevention only applies to list targets) and how "become a child" is
 * expressed (heading level vs. indent column).
 *
 * Reuses rather than reimplements:
 *   - move/moveBlock.ts's insertBlockAt (the cut + reinsert primitive) and
 *     expandToListRegion (for ordered-marker renumbering, same as
 *     moveBlock/indentBlock already do for list edits);
 *   - move/indentBlock.ts's growIndent/shrinkIndent for the whole-subtree
 *     reindent every mode here needs (the list-item counterpart of
 *     relocateSection.ts's collectSectionSubtree + setHeadingLevel cascade
 *     — see indentBlock.ts's doc comments on both).
 *
 * Reindenting rather than "preserving levels" (unlike relocateSection's
 * before/after, which deliberately keep the moved subtree's heading levels
 * untouched): a heading's `#` count is a well-formed, self-contained value
 * regardless of where it lands, but a list item's raw indent column count
 * is only meaningful relative to its surroundings — dropping a subtree with
 * a stale indent next to unrelated content can silently attach it to the
 * wrong parent or simply look broken. So every mode here computes and
 * applies the correct target indent explicitly, rather than leaving the
 * source's original indent alone.
 *
 * Target-kind asymmetry for "after" vs "inside" when the target is a
 * SECTION: "before" a section is unambiguous — inserting at the target's
 * own heading line always lands OUTSIDE the target (in whatever content
 * precedes it: the target's parent if target is its first child, or a
 * preceding sibling section otherwise — either way, never the target
 * itself or one of its descendants), since nothing of the target has
 * started yet. But there is no textual position that means "after the
 * target's ENTIRE subtree, back out at the target's own level" for
 * non-heading content: unlike a heading, a bare list item carries no level
 * marker of its own to re-delimit a boundary, so anything placed between
 * the target's own content and its next same-or-shallower-level heading is
 * always absorbed as content of whichever heading is still open there —
 * which, once inserted at the correct "before the target's first child
 * section" boundary (see ownContentInsertionLine below), is the target
 * itself. This makes "after" and "inside" necessarily the same operation
 * when the target is a section (both become "append to the target's own
 * root content"); they only diverge when the target is a list item, where
 * indent columns (not heading levels) are what a target's own children
 * share.
 */
import {
  isListNode,
  isSectionNode,
  LineRange,
  ListBlockNode,
  ParsedDocument,
  SectionBlockNode,
} from "../model/block";
import { leadingWhitespace, TAB_WIDTH } from "../parser/parseDocument";
import { expandToListRegion, insertBlockAt } from "./moveBlock";
import { growIndent, shrinkIndent } from "./indentBlock";
import { normalizeOrderedMarkers } from "./renumber";

export type ListDropMode = "before" | "after" | "inside";

export type NoListRelocateReason =
  | "resolve-failed"
  | "target-resolve-failed"
  | "not-a-list-item"
  | "invalid-target"
  | "drop-into-self"
  | "drop-into-descendant"
  | "unsafe-indent";

export interface ListRelocateOutcome {
  changed: boolean;
  lines: string[];
  /** New start line of the relocated item's own first line (valid when changed). */
  newStartLine: number;
  reason?: NoListRelocateReason;
}

export interface RelocateListSubtreeOptions {
  normalizeOrderedLists: boolean;
}

const DEFAULT_OPTIONS: RelocateListSubtreeOptions = {
  normalizeOrderedLists: true,
};

/** The nearest ancestor LIST item of `node` (skipping section parentage), or undefined at the root/section boundary. */
function parentListOf(
  doc: ParsedDocument,
  node: ListBlockNode
): ListBlockNode | undefined {
  if (!node.parentId) return undefined;
  const parent = doc.nodes.get(node.parentId);
  return parent && isListNode(parent) ? parent : undefined;
}

/** True when `candidate` is `root` itself or nested anywhere under it (list-item chain only). */
function isSelfOrDescendantList(
  doc: ParsedDocument,
  candidate: ListBlockNode,
  root: ListBlockNode
): boolean {
  let cur: ListBlockNode | undefined = candidate;
  while (cur) {
    if (cur.id === root.id) return true;
    cur = parentListOf(doc, cur);
  }
  return false;
}

/**
 * Preflight check the Outline Tree View uses while dragging a list item, to
 * decide whether to show a drop indicator / allow the browser drop at all.
 * Mirrors relocateSection.ts's canDropOn: only guards structural
 * impossibilities valid for every mode (self, descendant, unresolvable,
 * unsafe indentation on either side) — the "inside" mode's own edge cases
 * still fall back to a safe no-op in relocateListSubtree if attempted
 * anyway (e.g. a drop that ends up mid-flight resolving differently).
 */
export function canDropListOn(
  doc: ParsedDocument,
  sourceId: string,
  targetId: string
): boolean {
  const source = doc.nodes.get(sourceId);
  const target = doc.nodes.get(targetId);
  if (!source || !target) return false;
  if (!isListNode(source)) return false;
  if (!isListNode(target) && !isSectionNode(target)) return false;
  if (source.id === target.id) return false;
  if (source.unsafeIndent) return false;
  if (isListNode(target)) {
    if (target.unsafeIndent) return false;
    if (isSelfOrDescendantList(doc, target, source)) return false;
  }
  return true;
}

/** Column count a NEW direct child of `parent` should use — mirrors indentBlock.ts's buildIndentPrefix target-column logic (match the existing first child's column if any, else step by TAB_WIDTH). */
function childIndentColumnsOf(doc: ParsedDocument, parent: ListBlockNode): number {
  if (parent.childIds.length > 0) {
    const firstChild = doc.nodes.get(parent.childIds[0]);
    if (firstChild && isListNode(firstChild)) return firstChild.indentColumns;
  }
  return parent.indentColumns + TAB_WIDTH;
}

/**
 * The line at which `section`'s OWN root content ends — i.e. the correct
 * insertion point for "append as the last root item belonging to this
 * section specifically", not to whichever descendant section happens to be
 * open at section.range.endLine (see the class doc comment's "after" vs
 * "inside" note). This is the start line of the section's first child
 * section, if it has one; otherwise section.range.endLine + 1 is safe
 * (nothing deeper is open there).
 */
function ownContentInsertionLine(doc: ParsedDocument, section: SectionBlockNode): number {
  let min: number | null = null;
  for (const id of section.childIds) {
    const child = doc.nodes.get(id);
    if (child && isSectionNode(child)) {
      if (min === null || child.range.startLine < min) min = child.range.startLine;
    }
  }
  return min ?? section.range.endLine + 1;
}

function reindent(
  lines: string[],
  startLine: number,
  endLine: number,
  deltaColumns: number,
  useTabs: boolean
): string[] {
  if (deltaColumns === 0) return lines;
  if (deltaColumns > 0) {
    const chars = useTabs
      ? "\t".repeat(Math.max(Math.round(deltaColumns / TAB_WIDTH), 1))
      : " ".repeat(deltaColumns);
    return growIndent(lines, startLine, endLine, chars);
  }
  return shrinkIndent(lines, startLine, endLine, -deltaColumns);
}

/**
 * Relocate the list-item subtree identified by `sourceId` to before, after,
 * or inside (as last child of) the node identified by `targetId` — a list
 * item or a section. Both ids must resolve against this same `doc` (same
 * id-stability caveat as every other tree/* dispatch: ids are only
 * meaningful within the parseDocument() pass they came from).
 */
export function relocateListSubtree(
  doc: ParsedDocument,
  sourceId: string,
  targetId: string,
  mode: ListDropMode,
  options: RelocateListSubtreeOptions = DEFAULT_OPTIONS
): ListRelocateOutcome {
  const source = doc.nodes.get(sourceId);
  if (!source) {
    return { changed: false, lines: doc.lines, newStartLine: -1, reason: "resolve-failed" };
  }
  if (!isListNode(source)) {
    return { changed: false, lines: doc.lines, newStartLine: -1, reason: "not-a-list-item" };
  }
  if (source.unsafeIndent) {
    return { changed: false, lines: doc.lines, newStartLine: -1, reason: "unsafe-indent" };
  }

  const target = doc.nodes.get(targetId);
  if (!target) {
    return {
      changed: false,
      lines: doc.lines,
      newStartLine: -1,
      reason: "target-resolve-failed",
    };
  }
  if (!isListNode(target) && !isSectionNode(target)) {
    return { changed: false, lines: doc.lines, newStartLine: -1, reason: "invalid-target" };
  }

  if (source.id === target.id) {
    return { changed: false, lines: doc.lines, newStartLine: -1, reason: "drop-into-self" };
  }

  let insertBeforeLine: number;
  let newIndentColumns: number;

  if (isListNode(target)) {
    if (target.unsafeIndent) {
      return { changed: false, lines: doc.lines, newStartLine: -1, reason: "unsafe-indent" };
    }
    if (isSelfOrDescendantList(doc, target, source)) {
      return {
        changed: false,
        lines: doc.lines,
        newStartLine: -1,
        reason: "drop-into-descendant",
      };
    }

    if (mode === "before") {
      insertBeforeLine = target.range.startLine;
      newIndentColumns = target.indentColumns;
    } else if (mode === "after") {
      insertBeforeLine = target.range.endLine + 1;
      newIndentColumns = target.indentColumns;
    } else {
      insertBeforeLine = target.range.endLine + 1;
      newIndentColumns = childIndentColumnsOf(doc, target);
    }
  } else {
    // section target — a list item can never contain a section, so no
    // cycle check is needed here (see class doc comment for why "after"
    // and "inside" collapse to the same insertion point).
    if (mode === "before") {
      insertBeforeLine = target.range.startLine;
    } else {
      insertBeforeLine = ownContentInsertionLine(doc, target);
    }
    newIndentColumns = 0;
  }

  const { lines: movedLines, newStart } = insertBlockAt(
    doc.lines,
    source.range,
    insertBeforeLine
  );

  const blockLen = source.range.endLine - source.range.startLine + 1;
  const deltaColumns = newIndentColumns - source.indentColumns;
  const useTabs = leadingWhitespace(doc.lines[source.range.startLine]).includes("\t");
  let outLines = reindent(
    movedLines,
    newStart,
    newStart + blockLen - 1,
    deltaColumns,
    useTabs
  );

  if (options.normalizeOrderedLists) {
    const top = Math.min(source.range.startLine, newStart);
    const bottom = Math.max(source.range.endLine, newStart + blockLen - 1);
    const region: LineRange = {
      startLine: top,
      endLine: Math.min(bottom, outLines.length - 1),
    };
    outLines = normalizeOrderedMarkers(outLines, [expandToListRegion(outLines, region)]);
  }

  return { changed: true, lines: outLines, newStartLine: newStart };
}
