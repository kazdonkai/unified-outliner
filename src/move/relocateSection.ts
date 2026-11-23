/**
 * Phase 3A: Drag & Drop Tree Editing.
 *
 * Pure, Obsidian-free function that relocates a whole section subtree to
 * an arbitrary position relative to another section — before it, after
 * it, or inside it (as its first child) — for the Outline Tree View's drag
 * & drop (view/OutlineTreeView.ts). This is a generalization of
 * move/moveBlock.ts's up/down swap (which only ever exchanges a section
 * with its immediate same-level sibling): relocateSection accepts any
 * other section in the document as the destination, not just an adjacent
 * sibling.
 *
 * Reuses rather than reimplements:
 *   - move/moveBlock.ts's insertBlockAt for the actual cut + reinsert
 *     (same "cut the whole range, re-insert it" primitive as every other
 *     block-scoped command in this codebase — never line-by-line edits);
 *   - move/indentBlock.ts's collectSectionSubtree + level/headingLevel.ts's
 *     setHeadingLevel for the "inside" mode's whole-subtree level cascade
 *     (section-subtree: a heading represents its whole subtree, so every descendant
 *     shifts by the same delta, preserving relative levels — the same
 *     principle indentBlock.ts already applies for ±1 indent/outdent).
 *
 * before/after moves deliberately do NOT touch heading levels — the
 * subtree keeps its current levels exactly as they are, per the Phase 3A
 * design brief ("before/after の場合は、原則として現在の subtree 内部構造を保持した
 * まま移動する"). Only "inside" re-levels, because only "inside" changes
 * the subtree's parent.
 */
import {
  isSectionNode,
  ParsedDocument,
  SectionBlockNode,
} from "../model/block";
import { insertBlockAt } from "./moveBlock";
import { collectSectionSubtree } from "./indentBlock";
import { setHeadingLevel } from "../level/headingLevel";

export type DropMode = "before" | "after" | "inside";

export type NoRelocateReason =
  | "resolve-failed"
  | "target-resolve-failed"
  | "not-a-heading"
  | "target-not-a-heading"
  | "drop-into-self"
  | "drop-into-descendant"
  | "max-heading-level";

export interface RelocateOutcome {
  changed: boolean;
  lines: string[];
  /** New start line of the relocated subtree's own heading (valid when changed). */
  newStartLine: number;
  reason?: NoRelocateReason;
}

const MAX_HEADING_LEVEL = 6;

/** The nearest ancestor SECTION of `node` (skipping any list-item parentage), or undefined at the root. */
function parentSectionOf(
  doc: ParsedDocument,
  node: SectionBlockNode
): SectionBlockNode | undefined {
  if (!node.parentId) return undefined;
  const parent = doc.nodes.get(node.parentId);
  return parent && isSectionNode(parent) ? parent : undefined;
}

/** Start line of `target`'s first direct child SECTION, or null when it has none. */
function firstChildSectionStartLine(
  doc: ParsedDocument,
  target: SectionBlockNode
): number | null {
  let first: number | null = null;
  for (const childId of target.childIds) {
    const child = doc.nodes.get(childId);
    if (!child || !isSectionNode(child)) continue;
    if (first === null || child.range.startLine < first) first = child.range.startLine;
  }
  return first;
}

/** True when `candidate` is `root` itself or nested anywhere under it. */
function isSelfOrDescendant(
  doc: ParsedDocument,
  candidate: SectionBlockNode,
  root: SectionBlockNode
): boolean {
  let cur: SectionBlockNode | undefined = candidate;
  while (cur) {
    if (cur.id === root.id) return true;
    cur = parentSectionOf(doc, cur);
  }
  return false;
}

/**
 * Maps the raw pointer-zone drop mode to the mode that actually matches what
 * the drop indicator shows for a SECTION being dropped onto a section row.
 *
 * On an expanded heading that has visible children, the "after" indicator is
 * drawn at the bottom edge of the heading's OWN row — i.e. directly under the
 * heading, above its first child — but "after" really means "after the whole
 * subtree" (below the last descendant). Users dropping on the lower part of
 * such a row expect "directly under this heading" (e.g. dragging
 * "## 調査ステータス" onto the lower half of "# 題名" landed it below
 * "## 記録"), so that case is treated as "inside" (first child). A collapsed
 * heading, or one without children, keeps "after" unchanged — there the
 * row's bottom edge IS the end of the subtree. "before"/"inside" are never
 * changed.
 */
export function resolveSectionDropMode(
  mode: DropMode,
  targetHasVisibleChildren: boolean
): DropMode {
  return mode === "after" && targetHasVisibleChildren ? "inside" : mode;
}

/**
 * Preflight check the Outline Tree View uses while dragging, to decide
 * whether to show a drop indicator / allow the browser drop at all, for
 * hovering `sourceId` over `targetId` — WITHOUT the mode-specific
 * "inside would exceed level 6" check (that one only matters for the
 * "inside" third of a row, and relocateSection() itself still reports it
 * safely as a no-op if the drop is attempted anyway). This only guards
 * against structural impossibilities (self, descendant, unresolvable)
 * that are invalid for every mode.
 */
export function canDropOn(
  doc: ParsedDocument,
  sourceId: string,
  targetId: string
): boolean {
  const source = doc.nodes.get(sourceId);
  const target = doc.nodes.get(targetId);
  if (!source || !target) return false;
  if (!isSectionNode(source) || !isSectionNode(target)) return false;
  if (source.id === target.id) return false;
  if (isSelfOrDescendant(doc, target, source)) return false;
  return true;
}

/**
 * Relocate the section subtree identified by `sourceId` to before, after,
 * or inside (as FIRST child of) the section identified by `targetId`.
 * Both ids must resolve against this same `doc` (same id-stability caveat
 * as every other tree/* dispatch: section ids are only meaningful within
 * the parseDocument() pass they came from).
 */
export function relocateSection(
  doc: ParsedDocument,
  sourceId: string,
  targetId: string,
  mode: DropMode
): RelocateOutcome {
  const source = doc.nodes.get(sourceId);
  if (!source) {
    return { changed: false, lines: doc.lines, newStartLine: -1, reason: "resolve-failed" };
  }
  if (!isSectionNode(source)) {
    return { changed: false, lines: doc.lines, newStartLine: -1, reason: "not-a-heading" };
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
  if (!isSectionNode(target)) {
    return {
      changed: false,
      lines: doc.lines,
      newStartLine: -1,
      reason: "target-not-a-heading",
    };
  }

  if (source.id === target.id) {
    return { changed: false, lines: doc.lines, newStartLine: -1, reason: "drop-into-self" };
  }
  if (isSelfOrDescendant(doc, target, source)) {
    return {
      changed: false,
      lines: doc.lines,
      newStartLine: -1,
      reason: "drop-into-descendant",
    };
  }

  let insertBeforeLine: number;
  let newRootLevel: number | null = null;

  if (mode === "before") {
    insertBeforeLine = target.range.startLine;
  } else if (mode === "after") {
    insertBeforeLine = target.range.endLine + 1;
  } else {
    // inside: insert as target's FIRST child section, i.e. directly under
    // the target's own heading + body (before its first existing child
    // section). Originally this appended as the LAST child (right after
    // target.range, which spans the whole subtree), but dropping a section
    // onto a heading that already had children then landed it BELOW those
    // children (e.g. "## 調査ステータス" dropped on "# 題名" ended up under
    // "## 記録"), which is not what "drop onto this heading" means to the
    // user. A target with no child section keeps the old behavior (the
    // end of its range is also "directly under" it).
    insertBeforeLine = firstChildSectionStartLine(doc, target) ?? target.range.endLine + 1;
    newRootLevel = target.headingLevel + 1;
    if (newRootLevel > MAX_HEADING_LEVEL) {
      return {
        changed: false,
        lines: doc.lines,
        newStartLine: -1,
        reason: "max-heading-level",
      };
    }
  }

  const { lines: movedLines, newStart } = insertBlockAt(
    doc.lines,
    source.range,
    insertBeforeLine
  );

  let outLines = movedLines;
  if (newRootLevel !== null) {
    const delta = newRootLevel - source.headingLevel;
    if (delta !== 0) {
      // Every section in the subtree shifted by the same number of lines
      // as the root did (the whole block moved together), so re-derive
      // each one's new line from its offset within the ORIGINAL subtree
      // rather than re-parsing — cheaper, and avoids any ambiguity from
      // re-parsing text that hasn't had levels rewritten yet.
      const lineShift = newStart - source.range.startLine;
      for (const sec of collectSectionSubtree(doc, source)) {
        const newLine = sec.range.startLine + lineShift;
        outLines = setHeadingLevel(outLines, newLine, sec.headingLevel + delta);
      }
    }
  }

  return { changed: true, lines: outLines, newStartLine: newStart };
}
