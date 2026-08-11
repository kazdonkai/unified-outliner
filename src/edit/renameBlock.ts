/**
 * Outline Tree inline rename — section heading text / list item text
 * replacement, with structural re-verification against a snapshot taken
 * when the rename began. Pure functions, no Obsidian dependency — mirror
 * edit/deleteBlock.ts's and edit/insertBlock.ts's style (operate on a
 * ParsedDocument, return a new lines[] + outcome shape compatible with
 * commands/applyLineEditOutcome.ts's LineEditOutcome).
 *
 * Only the TEXT portion of a single line is ever touched:
 *   - section: the heading's "#" run and its separating whitespace are
 *     preserved verbatim; only the text after them is replaced.
 *   - list item: the item's leading indentation, marker, and separating
 *     whitespace are preserved verbatim; only the text after them is
 *     replaced (a minimal single space is inserted if the original had no
 *     separating whitespace at all and the new text is non-empty, since a
 *     marker glued directly to text is no longer valid list-item syntax —
 *     see renameListItem's own doc comment).
 *
 * Every commit re-resolves the node from a FRESH ParsedDocument (never a
 * stale one captured when rename began) and compares a small structural
 * snapshot (heading level / marker+indentation+contentColumn) against what
 * was captured at rename-begin time — any mismatch (node gone, kind
 * changed, level/marker/indentation changed by an unrelated edit in the
 * meantime) rejects the commit without touching the original text, exactly
 * like every other move/indent/delete/insert module in this codebase.
 *
 * Complex Markdown blocks (callout/blockquote/fenced-code/table/paragraph —
 * see parser/complexBlocks.ts) are out of scope for this ticket; these
 * functions only ever resolve ids present in ParsedDocument.nodes
 * (section/list), exactly like every other move/indent/level/edit module.
 */

import { isListNode, isSectionNode, ParsedDocument } from "../model/block";
import { contentColumnOf } from "./insertBlock";

/** Kept as a distinct string-literal union (not a plain `string`) so a future
 * UI can branch on it exactly like NoMoveReason/NoIndentReason/NoDeleteReason/
 * NoInsertReason, rather than being confined to an opaque message string. */
export type RenameRejectReason =
  | "resolve-failed"
  | "type-changed"
  | "heading-level-changed"
  | "list-syntax-changed"
  | "contains-newline";

export interface RenameOutcome {
  changed: boolean;
  lines: string[];
  newStartLine: number;
  /** Always set: lands the cursor at the end of the renamed text on
   * successful commit (irrelevant, and set to 0, on rejection). */
  newCursorCh: number;
  reason?: RenameRejectReason;
}

function rejected(doc: ParsedDocument, reason: RenameRejectReason): RenameOutcome {
  return { changed: false, lines: doc.lines, newStartLine: -1, newCursorCh: 0, reason };
}

function hasNewline(text: string): boolean {
  return text.includes("\n") || text.includes("\r");
}

const HEADING_TEXT_RE = /^(#{1,6}[ \t]+)(.*)$/;

export interface SectionRenameSnapshot {
  /** node.headingLevel, captured when the rename UI opened. */
  headingLevel: number;
}

/**
 * Replace a section's heading TEXT only — the "#" run and the whitespace
 * immediately after it are read fresh from the current line and copied
 * verbatim into the result; snapshot.headingLevel is compared against the
 * freshly re-resolved node's own headingLevel so a level change made by
 * some other edit between rename-begin and commit is rejected rather than
 * silently overwriting it with stale expectations.
 */
export function renameSection(
  doc: ParsedDocument,
  nodeId: string,
  snapshot: SectionRenameSnapshot,
  newText: string
): RenameOutcome {
  if (hasNewline(newText)) return rejected(doc, "contains-newline");

  const node = doc.nodes.get(nodeId);
  if (!node) return rejected(doc, "resolve-failed");
  if (!isSectionNode(node)) return rejected(doc, "type-changed");
  if (node.headingLevel !== snapshot.headingLevel) {
    return rejected(doc, "heading-level-changed");
  }

  const line = doc.lines[node.range.startLine];
  const m = line.match(HEADING_TEXT_RE);
  // Structurally unreachable given isSectionNode(node) just succeeded (every
  // SectionBlockNode's own start line is, by construction, a line matching
  // this exact pattern) — defensive rather than trusted blindly.
  if (!m) return rejected(doc, "heading-level-changed");

  const newLine = m[1] + newText;
  const outLines = doc.lines.slice();
  outLines[node.range.startLine] = newLine;

  return {
    changed: true,
    lines: outLines,
    newStartLine: node.range.startLine,
    newCursorCh: newLine.length,
  };
}

const LIST_MARKER_PREFIX_RE = /^([ \t]*)([-*+]|\d+[.)])([ \t]*)/;

export interface ListRenameSnapshot {
  /** node.listMarker, captured when the rename UI opened. */
  marker: string;
  /** node.indentColumns, captured when the rename UI opened. */
  indentColumns: number;
  /** contentColumnOf(doc, node), captured when the rename UI opened. */
  contentColumn: number;
}

/**
 * Replace a list item's own TEXT only — leading indentation, marker, and
 * separating whitespace are read fresh from the current line and copied
 * verbatim into the result. If the original had NO separating whitespace
 * at all (an empty item, e.g. a bare "-") and newText is non-empty, exactly
 * one space is inserted before it: a marker glued directly to text (e.g.
 * "-newtext") no longer matches parser/parseDocument.ts's list-item syntax
 * at all, so this minimal insertion is required to keep the line valid —
 * not a stylistic choice. snapshot's marker/indentColumns/contentColumn are
 * compared against the freshly re-resolved node so any of those changing
 * between rename-begin and commit (re-indented, re-marked, or the
 * separating whitespace itself edited elsewhere) rejects the commit.
 */
export function renameListItem(
  doc: ParsedDocument,
  nodeId: string,
  snapshot: ListRenameSnapshot,
  newText: string
): RenameOutcome {
  if (hasNewline(newText)) return rejected(doc, "contains-newline");

  const node = doc.nodes.get(nodeId);
  if (!node) return rejected(doc, "resolve-failed");
  if (!isListNode(node)) return rejected(doc, "type-changed");
  if (
    node.listMarker !== snapshot.marker ||
    node.indentColumns !== snapshot.indentColumns ||
    contentColumnOf(doc, node) !== snapshot.contentColumn
  ) {
    return rejected(doc, "list-syntax-changed");
  }

  const line = doc.lines[node.range.startLine];
  const m = line.match(LIST_MARKER_PREFIX_RE);
  // Structurally unreachable given isListNode(node) just succeeded — defensive.
  if (!m) return rejected(doc, "list-syntax-changed");
  const [, leadWs, marker, gapWs] = m;
  const prefix = leadWs + marker;
  const newLine =
    newText.length === 0
      ? prefix + gapWs
      : prefix + (gapWs.length > 0 ? gapWs : " ") + newText;

  const outLines = doc.lines.slice();
  outLines[node.range.startLine] = newLine;

  return {
    changed: true,
    lines: outLines,
    newStartLine: node.range.startLine,
    newCursorCh: newLine.length,
  };
}
