/**
 * Apply an indent / outdent edit (safe structural editing). Pure function, no Obsidian
 * dependency — mirrors moveBlock.ts's style (operate on a ParsedDocument,
 * return a new lines[] + outcome).
 *
 * Unlike moveBlock, indent/outdent never needs a cut + re-insert: both
 * supported cases (list-indent onto the previous sibling, list-outdent of
 * a parent's last child, heading level change) leave the block's line
 * range exactly where it is and only rewrite leading whitespace or the
 * heading's `#` run in place. See findIndentTarget.ts for why the MVP
 * scope guarantees this.
 */

import {
  isSectionNode,
  ListBlockNode,
  ParsedDocument,
  SectionBlockNode,
} from "../model/block";
import { isBlankLine, leadingWhitespace, TAB_WIDTH } from "../parser/parseDocument";
import { changeHeadingLevel } from "../level/headingLevel";
import {
  findIndentTarget,
  IndentDirection,
  NoIndentReason,
} from "./findIndentTarget";
import { expandToListRegion } from "./moveBlock";
import { normalizeOrderedMarkers } from "./renumber";

/**
 * `root` and every descendant section, in no particular order. Exported
 * for reuse by move/relocateSection.ts (Phase 3A drag & drop's "inside"
 * mode needs the same whole-subtree level cascade this module already
 * implements for block-scoped indent/outdent).
 */
export function collectSectionSubtree(
  doc: ParsedDocument,
  root: SectionBlockNode
): SectionBlockNode[] {
  const result: SectionBlockNode[] = [root];
  for (const id of root.childIds) {
    const child = doc.nodes.get(id);
    if (child && isSectionNode(child)) {
      result.push(...collectSectionSubtree(doc, child));
    }
  }
  return result;
}

export interface IndentOutcome {
  changed: boolean;
  lines: string[];
  /** Line the moved cursor should land on (same block, position unchanged). */
  newStartLine: number;
  reason?: NoIndentReason | "resolve-failed";
}

export interface IndentBlockOptions {
  normalizeOrderedLists: boolean;
}

const DEFAULT_OPTIONS: IndentBlockOptions = {
  normalizeOrderedLists: true,
};

/**
 * Build the whitespace prefix to add when nesting a root/sibling item under
 * `prev`. If `prev` already has a child, the new item must land exactly on
 * that child's indentColumns to become its sibling (rather than accidentally
 * nesting one level deeper, under the existing child) — so the target
 * column count is read from the document instead of assumed. Only when
 * `prev` has no children yet do we fall back to a fixed TAB_WIDTH step;
 * matching a document-wide indent convention in that case is a known MVP
 * simplification (same policy as renumber.ts's "1." normalization).
 */
function buildIndentPrefix(
  doc: ParsedDocument,
  prev: ListBlockNode,
  node: ListBlockNode
): string {
  let targetColumns: number;
  let useTabs: boolean;
  if (prev.childIds.length > 0) {
    const firstChild = doc.nodes.get(prev.childIds[0]) as ListBlockNode;
    targetColumns = firstChild.indentColumns;
    useTabs = leadingWhitespace(doc.lines[firstChild.range.startLine]).includes("\t");
  } else {
    targetColumns = prev.indentColumns + TAB_WIDTH;
    useTabs = leadingWhitespace(doc.lines[node.range.startLine]).includes("\t");
  }
  const delta = Math.max(targetColumns - node.indentColumns, 1);
  return useTabs
    ? "\t".repeat(Math.max(Math.round(delta / TAB_WIDTH), 1))
    : " ".repeat(delta);
}

/**
 * Prepend `chars` to the leading whitespace of every non-blank line in
 * range. Exported for reuse by move/relocateListSubtree.ts (Phase 4A drag
 * & drop needs the same whole-subtree reindent this module already
 * implements for block-scoped list indent/outdent — growIndent/shrinkIndent
 * are the list-item counterpart of collectSectionSubtree + setHeadingLevel,
 * which Phase 3A already reuses the same way for section "inside" drops).
 */
export function growIndent(
  lines: string[],
  startLine: number,
  endLine: number,
  chars: string
): string[] {
  const out = lines.slice();
  for (let l = startLine; l <= endLine; l++) {
    if (isBlankLine(out[l])) continue;
    out[l] = chars + out[l];
  }
  return out;
}

/** Remove up to `columns` columns' worth of leading whitespace (tab = TAB_WIDTH). */
function stripLeadingColumns(ws: string, columns: number): string {
  let budget = columns;
  let i = 0;
  while (i < ws.length && budget > 0) {
    const step = ws[i] === "\t" ? TAB_WIDTH : 1;
    budget -= step;
    i++;
  }
  return ws.slice(i);
}

/** Exported for reuse by move/relocateListSubtree.ts — see growIndent's doc comment. */
export function shrinkIndent(
  lines: string[],
  startLine: number,
  endLine: number,
  columns: number
): string[] {
  const out = lines.slice();
  for (let l = startLine; l <= endLine; l++) {
    if (isBlankLine(out[l])) continue;
    const ws = leadingWhitespace(out[l]);
    const rest = out[l].slice(ws.length);
    out[l] = stripLeadingColumns(ws, columns) + rest;
  }
  return out;
}

export function indentBlock(
  doc: ParsedDocument,
  nodeId: string,
  direction: IndentDirection,
  options: IndentBlockOptions = DEFAULT_OPTIONS
): IndentOutcome {
  const node = doc.nodes.get(nodeId);
  if (!node) {
    return {
      changed: false,
      lines: doc.lines,
      newStartLine: -1,
      reason: "resolve-failed",
    };
  }

  const target = findIndentTarget(doc, node, direction);
  if (target.kind === "none") {
    return {
      changed: false,
      lines: doc.lines,
      newStartLine: -1,
      reason: target.reason,
    };
  }

  let outLines: string[];

  if (target.kind === "heading-indent" || target.kind === "heading-outdent") {
    // Cascades to the whole section subtree (section-subtree) — see findIndentTarget.ts.
    const headingDirection = target.kind === "heading-indent" ? "indent" : "outdent";
    const sections = collectSectionSubtree(doc, node as SectionBlockNode);
    outLines = doc.lines.slice();
    for (const sec of sections) {
      outLines = changeHeadingLevel(outLines, sec.range.startLine, headingDirection);
    }
  } else if (target.kind === "list-indent") {
    const list = node as ListBlockNode;
    const prev = doc.nodes.get(target.prevSiblingId) as ListBlockNode;
    const chars = buildIndentPrefix(doc, prev, list);
    outLines = growIndent(doc.lines, list.range.startLine, list.range.endLine, chars);
  } else {
    // list-outdent
    const list = node as ListBlockNode;
    const parent = doc.nodes.get(target.parentId) as ListBlockNode | undefined;
    const columns = parent ? list.indentColumns - parent.indentColumns : TAB_WIDTH;
    outLines = shrinkIndent(
      doc.lines,
      list.range.startLine,
      list.range.endLine,
      Math.max(columns, 1)
    );
  }

  if (
    node.type === "list" &&
    options.normalizeOrderedLists &&
    (target.kind === "list-indent" || target.kind === "list-outdent")
  ) {
    const region = expandToListRegion(outLines, node.range);
    outLines = normalizeOrderedMarkers(outLines, [region]);
  }

  return { changed: true, lines: outLines, newStartLine: node.range.startLine };
}
