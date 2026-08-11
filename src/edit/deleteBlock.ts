/**
 * Phase 5C-1A: delete a section or list subtree from the Outline Tree.
 * Pure function, no Obsidian dependency — mirrors move/moveBlock.ts's and
 * move/indentBlock.ts's style (operate on a ParsedDocument, return a new
 * lines[] + outcome shape compatible with commands/applyLineEditOutcome.ts's
 * LineEditOutcome).
 *
 * Deletion always removes exactly `node.range` — for a section, heading +
 * body + nested subsections + root lists; for a list item, its own line(s)
 * + all nested child items — and nothing else. No blank-line cleanup, no
 * adjacent-block merging, no broad normalization: whatever was directly
 * before/after the deleted range (including any blank lines) is left
 * exactly as it was. This matches move/indentBlock.ts's existing "never
 * touch anything the caller didn't ask to touch" policy, and satisfies the
 * explicit no-auto-merge-after-delete requirement for this ticket.
 *
 * Complex Markdown blocks (callout/blockquote/fenced-code/table/paragraph —
 * see parser/complexBlocks.ts) are never targeted by this module; it only
 * ever resolves ids present in ParsedDocument.nodes (section/list), exactly
 * like every other move/indent/level module.
 */

import { BlockNode, ParsedDocument } from "../model/block";

/** Kept as a distinct string-literal union (not a plain `string`) so a future
 * UI can branch on it exactly like NoMoveReason/NoIndentReason, rather than
 * being confined to an opaque message string. */
export type NoDeleteReason = "resolve-failed";

export interface DeleteOutcome {
  changed: boolean;
  lines: string[];
  /**
   * Post-delete line to restore selection/cursor to, per the required
   * fallback chain: previous sibling (same kind) → next sibling (same
   * kind) → parent → the original deletion start line, clamped to the new
   * document length. Same-kind sibling/parent linkage is read from the
   * node's own fields in the ORIGINAL (pre-delete) document, then
   * translated into post-delete line numbers — no new selection-handling
   * code is needed in the tree view, since OutlineTreeView's existing
   * ensureSelection()/refresh() pipeline already restores selection from
   * wherever the cursor lands after any edit (see
   * commands/applyLineEditOutcome.ts).
   */
  newStartLine: number;
  /**
   * Always 0: land the cursor at the very start of the fallback line,
   * regardless of where the caller's own cursor was inside the now-deleted
   * block. Set unconditionally (mirroring InsertOutcome's newCursorCh) so
   * BOTH main.ts's body-editor delete command and OutlineTreeView's
   * dispatchAndApply can pass through applyLineEditOutcome without any
   * special-cased "zero-offset cursor" argument of their own — an
   * "offset within the block" has no meaningful interpretation once the
   * block is gone, so this field being present is what makes that
   * distinction explicit rather than accidental.
   */
  newCursorCh: number;
  reason?: NoDeleteReason;
}

export function deleteBlock(doc: ParsedDocument, nodeId: string): DeleteOutcome {
  const node = doc.nodes.get(nodeId);
  if (!node) {
    return {
      changed: false,
      lines: doc.lines,
      newStartLine: -1,
      newCursorCh: 0,
      reason: "resolve-failed",
    };
  }

  const { startLine, endLine } = node.range;
  const deletedCount = endLine - startLine + 1;
  const outLines = [
    ...doc.lines.slice(0, startLine),
    ...doc.lines.slice(endLine + 1),
  ];

  const newStartLine = computeFallbackLine(doc, node, startLine, deletedCount, outLines.length);

  return { changed: true, lines: outLines, newStartLine, newCursorCh: 0 };
}

/**
 * prevSiblingId/nextSiblingId/parentId are always fully outside the deleted
 * node's own range by construction (a sibling or parent can never overlap
 * the subtree it is sibling/parent to), so exactly one of "candidate starts
 * before the deleted range" or "candidate starts after it" always holds for
 * any candidate that resolves — never both, and never exactly at
 * `deletedStart`. A candidate before the deletion is unaffected by the cut
 * (still-valid line number); one after it shifts up by `deletedCount`.
 */
function computeFallbackLine(
  doc: ParsedDocument,
  node: BlockNode,
  deletedStart: number,
  deletedCount: number,
  newLineCount: number
): number {
  const candidates = [node.prevSiblingId, node.nextSiblingId, node.parentId];
  for (const candidateId of candidates) {
    if (!candidateId) continue;
    const candidate = doc.nodes.get(candidateId);
    if (!candidate) continue;
    const line = candidate.range.startLine;
    if (line < deletedStart) return line;
    if (line > deletedStart) return line - deletedCount;
    // Structurally unreachable (see doc comment above) — fall through to
    // the next candidate rather than trust an inconsistent position.
  }
  // No sibling/parent resolved (e.g. the only top-level section): fall back
  // to the editor's own deletion-start position, clamped into the new,
  // shorter document.
  return Math.max(0, Math.min(deletedStart, newLineCount - 1));
}
