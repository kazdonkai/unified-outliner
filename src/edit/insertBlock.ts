/**
 * Phase 5C-1B: insert a new, empty section or list item into the Outline
 * Tree. Pure functions, no Obsidian dependency — mirror move/moveBlock.ts's
 * and move/indentBlock.ts's style (operate on a ParsedDocument, return a
 * new lines[] + outcome shape compatible with
 * commands/applyLineEditOutcome.ts's LineEditOutcome, via the extra
 * `newCursorCh` field that module now supports).
 *
 * Three entry points, one per this ticket's in-scope insert kind:
 *   - insertSiblingSection: new section, explicit heading level required
 *     (never inferred — see this ticket's requirement).
 *   - insertSiblingListItem: new list item as a sibling of an existing one,
 *     marker/indentation copied verbatim from the target.
 *   - insertChildListItem: new list item as the last child of a selected
 *     list item, only valid when the selection IS a list item.
 *
 * All three insert exactly one minimal, empty placeholder block and never
 * touch anything outside the inserted lines — no reflow, no renumbering
 * beyond the existing normalizeOrderedLists convention every other list op
 * already applies (move/moveBlock.ts, move/indentBlock.ts).
 *
 * Complex Markdown blocks (callout/blockquote/fenced-code/table/paragraph —
 * see parser/complexBlocks.ts) are out of scope for this ticket; these
 * functions only ever resolve ids present in ParsedDocument.nodes
 * (section/list), exactly like every other move/indent/level module.
 */

import { isListNode, ListBlockNode, ParsedDocument } from "../model/block";
import { indentColumnsOf, leadingWhitespace, TAB_WIDTH } from "../parser/parseDocument";
import { expandToListRegion } from "../move/moveBlock";
import { normalizeOrderedMarkers } from "../move/renumber";

/** Kept as a distinct string-literal union (not a plain `string`) so a future
 * UI can branch on it exactly like NoMoveReason/NoIndentReason/NoDeleteReason,
 * rather than being confined to an opaque message string. */
export type NoInsertReason = "resolve-failed" | "not-a-list-item" | "unsafe-indent";

export interface InsertOutcome {
  changed: boolean;
  lines: string[];
  newStartLine: number;
  /** Column on newStartLine where the new block's editable placeholder text
   * begins — always set (even on the rejected path, as 0, for a uniform
   * shape), consumed by applyLineEditOutcome's newCursorCh handling. */
  newCursorCh: number;
  reason?: NoInsertReason;
}

export interface InsertListOptions {
  normalizeOrderedLists: boolean;
}

const DEFAULT_INSERT_LIST_OPTIONS: InsertListOptions = { normalizeOrderedLists: true };

const MIN_HEADING_LEVEL = 1;
const MAX_HEADING_LEVEL = 6;

function rejected(doc: ParsedDocument, reason: NoInsertReason): InsertOutcome {
  return { changed: false, lines: doc.lines, newStartLine: -1, newCursorCh: 0, reason };
}

/**
 * Insert a brand-new, empty section as a sibling immediately after
 * `afterSectionId`, at the explicit `headingLevel` the caller's UI already
 * collected. This module never infers a level from context — the caller
 * (a heading-level picker) is responsible for asking the user before this
 * function is ever invoked; `headingLevel` is still defensively clamped to
 * 1–6 here as a last-resort safety net, not as a substitute for that UI
 * step.
 *
 * New content is a single heading placeholder line ("## ", ready for the
 * title to be typed) plus one blank separator line, positioned right after
 * the target's entire subtree (target.range.endLine + 1) — the same
 * insertion point relocateSection.ts's own "after" mode uses.
 */
export function insertSiblingSection(
  doc: ParsedDocument,
  afterSectionId: string,
  headingLevel: number
): InsertOutcome {
  const target = doc.nodes.get(afterSectionId);
  if (!target) return rejected(doc, "resolve-failed");

  const level = Math.min(
    MAX_HEADING_LEVEL,
    Math.max(MIN_HEADING_LEVEL, Math.round(headingLevel))
  );
  const headingLine = "#".repeat(level) + " ";
  const insertAt = target.range.endLine + 1;

  const outLines = [
    ...doc.lines.slice(0, insertAt),
    headingLine,
    "",
    ...doc.lines.slice(insertAt),
  ];

  return {
    changed: true,
    lines: outLines,
    newStartLine: insertAt,
    newCursorCh: headingLine.length,
  };
}

/**
 * Shared primitive for both insertSiblingListItem and insertChildListItem's
 * "parent already has children" branch: insert a new, empty list item
 * immediately after `reference`'s own entire range, copying its leading
 * whitespace and marker style verbatim. A literal string copy, not column
 * math — safe even when `reference` itself is unsafeIndent (mixed tab/
 * space), since no interpretation of columns is performed.
 */
function insertListItemAfter(
  doc: ParsedDocument,
  reference: ListBlockNode,
  options: InsertListOptions
): InsertOutcome {
  const ws = leadingWhitespace(doc.lines[reference.range.startLine]);
  // Ordered items always start as "1." regardless of the existing sequence
  // — matches renumber.ts's own stated MVP policy ("normalize to 1., real
  // sequential renumbering is a TODO"); when normalizeOrderedLists is on,
  // the whole affected region is renormalized below anyway (as every other
  // list-mutating op already does), and when it's off, no code path in
  // this codebase tracks real sequence numbers.
  const marker = reference.ordered ? "1." : reference.listMarker;
  const newLine = `${ws}${marker} `;
  const insertAt = reference.range.endLine + 1;

  let outLines = [
    ...doc.lines.slice(0, insertAt),
    newLine,
    ...doc.lines.slice(insertAt),
  ];

  if (reference.ordered && options.normalizeOrderedLists) {
    const region = expandToListRegion(outLines, { startLine: insertAt, endLine: insertAt });
    outLines = normalizeOrderedMarkers(outLines, [region]);
  }

  return {
    changed: true,
    lines: outLines,
    newStartLine: insertAt,
    newCursorCh: newLine.length,
  };
}

/**
 * Insert a new, empty list item as a sibling immediately after
 * `afterListItemId`, matching its marker style and indentation exactly.
 * No unsafeIndent restriction: this is a verbatim copy of the target's own
 * leading whitespace, not a derived column computation.
 */
export function insertSiblingListItem(
  doc: ParsedDocument,
  afterListItemId: string,
  options: InsertListOptions = DEFAULT_INSERT_LIST_OPTIONS
): InsertOutcome {
  const target = doc.nodes.get(afterListItemId);
  if (!target) return rejected(doc, "resolve-failed");
  if (!isListNode(target)) return rejected(doc, "not-a-list-item");

  return insertListItemAfter(doc, target, options);
}

/**
 * Insert a new, empty list item as the last CHILD of `parentListItemId`.
 * Only valid when the selected node is itself a list item (never a
 * section).
 *
 * If the parent already has children, the new item mirrors the LAST
 * existing child's own marker/indentation (via insertListItemAfter, for
 * consistency among siblings — no column math needed in this branch,
 * regardless of the parent's own unsafeIndent-ness).
 *
 * Otherwise (parent has no children yet) a fresh indentation is computed
 * from contentColumnOf(parent) — the column where the parent's own text
 * content begins, read directly from its actual line text, never a fixed
 * or purely-visual constant. This branch refuses (unsafe-indent) when the
 * parent's own leading whitespace mixes tabs and spaces, since deriving a
 * new column from it would require interpreting an already-ambiguous
 * indentation.
 */
export function insertChildListItem(
  doc: ParsedDocument,
  parentListItemId: string,
  options: InsertListOptions = DEFAULT_INSERT_LIST_OPTIONS
): InsertOutcome {
  const parent = doc.nodes.get(parentListItemId);
  if (!parent) return rejected(doc, "resolve-failed");
  if (!isListNode(parent)) return rejected(doc, "not-a-list-item");

  if (parent.childIds.length > 0) {
    const lastChild = doc.nodes.get(parent.childIds[parent.childIds.length - 1]);
    if (!lastChild || !isListNode(lastChild)) return rejected(doc, "resolve-failed");
    return insertListItemAfter(doc, lastChild, options);
  }

  if (parent.unsafeIndent) return rejected(doc, "unsafe-indent");

  const targetColumns = contentColumnOf(doc, parent);
  const ws = buildColumnPrefix(doc.lines[parent.range.startLine], targetColumns);
  const newLine = `${ws}- `;
  const insertAt = parent.range.endLine + 1;

  const outLines = [
    ...doc.lines.slice(0, insertAt),
    newLine,
    ...doc.lines.slice(insertAt),
  ];

  return {
    changed: true,
    lines: outLines,
    newStartLine: insertAt,
    newCursorCh: newLine.length,
  };
}

const LIST_MARKER_PREFIX_RE = /^([ \t]*)([-*+]|\d+[.)])([ \t]*)/;

/**
 * The column at which `item`'s own text content begins — read directly from
 * its actual line text (leading whitespace + marker + separating
 * whitespace), never assumed from a fixed constant. Uses
 * parser/parseDocument.ts's own indentColumnsOf, which already performs
 * correct tab-stop math (a tab snaps to the next multiple of TAB_WIDTH from
 * the CURRENT running column, not a flat +TAB_WIDTH) — calling it on the
 * whole leadWs+marker+gapWs prefix in one pass (rather than summing
 * separately-computed pieces) is what keeps that tab-stop math correct
 * when the separating whitespace itself contains a tab.
 *
 * When the item has no separating whitespace after its marker at all (an
 * empty item, e.g. a bare "-" with nothing following), falls back to
 * exactly one column past the marker as the minimal conventional gap.
 * Exported for tests and for reuse if a future ticket needs the same
 * column for a different purpose.
 */
export function contentColumnOf(doc: ParsedDocument, item: ListBlockNode): number {
  const line = doc.lines[item.range.startLine];
  const m = line.match(LIST_MARKER_PREFIX_RE);
  if (!m) return item.indentColumns + TAB_WIDTH;
  const [, leadWs, marker, gapWs] = m;
  const col = indentColumnsOf(leadWs + marker + gapWs);
  return gapWs.length === 0 ? col + 1 : col;
}

/**
 * Build a leading-whitespace string reaching `targetColumns`, choosing tabs
 * vs. spaces from `referenceLine`'s own existing indentation style (the
 * same heuristic move/indentBlock.ts's buildIndentPrefix already uses) —
 * never a hardcoded space count regardless of the document's own
 * convention.
 */
function buildColumnPrefix(referenceLine: string, targetColumns: number): string {
  const useTabs = leadingWhitespace(referenceLine).includes("\t");
  return useTabs
    ? "\t".repeat(Math.max(Math.round(targetColumns / TAB_WIDTH), 1))
    : " ".repeat(targetColumns);
}
