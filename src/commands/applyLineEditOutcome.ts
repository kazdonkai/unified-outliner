/**
 * Obsidian-dependent glue shared by main.ts's body-editor commands and the
 * Outline Tree View's Phase 2B block commands (view/OutlineTreeView.ts):
 * turning a pure-function outcome (moveBlock / indentBlock / moveNodeOnly /
 * setNodeOnlyLevel / relocateSection — see move/ and level/, or
 * tree/treeBlockCommand.ts and friends for the tree-triggered dispatch)
 * into an actual editor mutation, plus the shared human-readable no-op
 * messages both callers show via Notice.
 *
 * Kept as the single place that knows how to (a) diff old/new lines down to
 * a minimal replaceRange (undo-friendly, doesn't touch untouched lines) and
 * (b) reposition the cursor — so neither caller reimplements it.
 */
import { Editor } from "obsidian";

export const NOOP_MESSAGES: Record<string, string> = {
  "code-block": "Unified Outliner: cannot move inside a code block.",
  frontmatter: "Unified Outliner: cannot move frontmatter.",
  "no-block": "Unified Outliner: no movable block at cursor.",
  "no-sibling": "Unified Outliner: nothing to swap with in that direction.",
  "nested-edge":
    "Unified Outliner: nested item is at the edge of its parent. Try indent/outdent instead.",
  "top-of-document": "Unified Outliner: already at the top.",
  "end-of-document": "Unified Outliner: already at the bottom.",
  "blocked-by-paragraph":
    "Unified Outliner: a paragraph blocks the move (paragraph hopping is not implemented yet).",
  "cross-section-disabled":
    "Unified Outliner: cross-section list moves are disabled in settings.",
  "unsafe-indent":
    "Unified Outliner: mixed tab/space indentation detected — skipped for safety.",
  "no-previous-sibling":
    "Unified Outliner: no previous sibling to indent under.",
  "already-root": "Unified Outliner: already at the root level.",
  "max-heading-level":
    "Unified Outliner: this heading or a subsection is already at level 6.",
  "min-heading-level": "Unified Outliner: heading is already at level 1.",
  "not-a-heading":
    "Unified Outliner: this node-only command only applies to a heading line.",
  "target-not-a-heading":
    "Unified Outliner: can only drop onto a heading, not a list item.",
  "drop-into-self": "Unified Outliner: can't drop a node onto itself.",
  "drop-into-descendant":
    "Unified Outliner: can't drop a node inside one of its own descendants.",
  "target-resolve-failed":
    "Unified Outliner: could not resolve the drop target (the note may have changed).",
  "resolve-failed":
    "Unified Outliner: could not resolve that block (the note may have changed).",
  "not-a-list-item":
    "Unified Outliner: this operation only applies to a list item.",
  "invalid-target":
    "Unified Outliner: can only drop a list item onto another list item or a heading.",
  "not-editable":
    "Unified Outliner: this node cannot be opened in the Partial Edit Pane.",
  "type-changed":
    "Unified Outliner: this node's kind changed — rename cancelled without changing the note.",
  "heading-level-changed":
    "Unified Outliner: this heading's level changed — rename cancelled without changing the note.",
  "list-syntax-changed":
    "Unified Outliner: this list item's marker or indentation changed — rename cancelled without changing the note.",
  "contains-newline":
    "Unified Outliner: rename text can't contain a line break.",
  "no-active-editor":
    "Unified Outliner: no active note editor — rename cancelled.",
  "boundary-unknown":
    "Unified Outliner: could not confidently determine this block's boundary — move skipped for safety.",
  "not-in-section":
    "Unified Outliner: cursor is not inside any section.",
};

/** Common shape returned by moveBlock / indentBlock / setNodeOnlyLevel / moveNodeOnly. */
export interface LineEditOutcome {
  changed: boolean;
  lines: string[];
  newStartLine: number;
  reason?: string;
  /**
   * Phase 5C-1A/1B (edit/deleteBlock.ts, edit/insertBlock.ts): optional
   * precise column to place the cursor at on `newStartLine`, overriding the
   * default "preserve the caller's relative offset within the block"
   * behavior below. Move/indent/etc. never set this (undefined), so their
   * behavior is byte-identical to before this field existed. Insert
   * outcomes set it to land exactly on the new block's editable placeholder
   * text (e.g. right after "## " or "- "), where "preserve the original
   * cursor's line/ch offset" has no meaningful interpretation — there was
   * no old block to be offset from.
   */
  newCursorCh?: number;
}

/**
 * Apply (or report the no-op reason for) a LineEditOutcome.
 *
 * `cursor` / `resolvedNodeStartLine` describe where the caller's "current
 * position" is relative to the block that was operated on, so the new
 * cursor can be placed at the same relative offset after the edit — for
 * body-editor commands this is the real editor cursor (always inside the
 * resolved block, by construction of resolveCurrentBlock). For tree-
 * triggered commands, callers that don't have a meaningful "offset within
 * the block" should just pass the block's own start line for both
 * `cursor` and `resolvedNodeStartLine` (offset 0), landing the cursor on
 * the operated-on block's new position.
 *
 * Returns whether an edit was actually applied, so callers can decide
 * whether to refresh any dependent UI (e.g. the Outline Tree View).
 */
export function applyLineEditOutcome(
  editor: Editor,
  cursor: { line: number; ch: number },
  resolvedNodeStartLine: number,
  oldLines: string[],
  outcome: LineEditOutcome,
  notify: (message: string | undefined) => void
): boolean {
  if (!outcome.changed) {
    // Every caller resolves its node id from the same ParsedDocument it
    // then queries, so in practice "resolve-failed" is unreachable for the
    // body-editor commands (main.ts) — but it IS reachable from the tree
    // view if the note changed between the last tree render and the click.
    // Reporting it either way is harmless and gives real feedback instead
    // of a silent no-op in that edge case.
    if (outcome.reason) {
      notify(NOOP_MESSAGES[outcome.reason]);
    }
    return false;
  }

  const newLines = outcome.lines;

  // True no-op guard (2026-08-11 fix): a rename committed with the text
  // left exactly as it started (e.g. the Outline Tree's inline rename box
  // now also commits on blur, so simply clicking into a row and then
  // clicking elsewhere without typing anything reaches this function with
  // outcome.changed === true and outcome.lines byte-identical to
  // oldLines — renameSection/renameListItem don't themselves compare
  // against the original text, unlike move/indent/etc., which already
  // reject via changed: false before anything with an actual difference
  // reaches here). Without this guard, the "prefix/suffix trim down to the
  // differing middle" logic below degenerates when there is no differing
  // middle at all: the prefix-matching loop consumes every line (`first`
  // ends at oldLines.length), which then satisfies the `oldLast < first`
  // "pure insert" branch further down and inserts a spurious blank line at
  // the end of the document. Bailing out here before any of that keeps a
  // truly unchanged commit a real no-op, exactly like every other
  // no-actual-difference outcome in this codebase.
  if (
    newLines.length === oldLines.length &&
    newLines.every((line, i) => line === oldLines[i])
  ) {
    return false;
  }

  let first = 0;
  const minLen = Math.min(oldLines.length, newLines.length);
  while (first < minLen && oldLines[first] === newLines[first]) first++;
  let oldLast = oldLines.length - 1;
  let newLast = newLines.length - 1;
  while (
    oldLast > first &&
    newLast > first &&
    oldLines[oldLast] === newLines[newLast]
  ) {
    oldLast--;
    newLast--;
  }

  // oldLast < first can only happen when `first` consumed the ENTIRE old
  // document as a matching prefix (first === oldLines.length) — i.e. a
  // pure append with nothing removed and no trailing old content left to
  // anchor a "to" position on. Every pre-existing caller (move/indent/
  // etc.) always has at least one differing old line in play, so this
  // never came up before edit/insertBlock.ts's insertSiblingSection could
  // insert brand-new lines strictly after the last existing line (e.g.
  // "insert section after" on the last section in the document). Using
  // `oldLast` unguarded here previously produced an inverted replaceRange
  // (`from` on a line past `to`), which CodeMirror rejects with "Selection
  // points outside of document" — this branch collapses `from`/`to` onto
  // the end of the old document's real last line instead, and prefixes
  // the replacement with the newline that join("\n") would otherwise have
  // supplied between the old last line and the first inserted line.
  if (oldLast < first) {
    const anchorLine = Math.max(0, oldLines.length - 1);
    const anchorCh = oldLines[anchorLine]?.length ?? 0;
    const inserted = newLines.slice(first, newLast + 1).join("\n");
    editor.replaceRange(
      "\n" + inserted,
      { line: anchorLine, ch: anchorCh },
      { line: anchorLine, ch: anchorCh }
    );
  } else {
    const replacement = newLines.slice(first, newLast + 1).join("\n");
    editor.replaceRange(
      replacement,
      { line: first, ch: 0 },
      { line: oldLast, ch: oldLines[oldLast]?.length ?? 0 }
    );
  }

  // newCursorCh (Phase 5C-1A/1B) means "place the cursor at this exact
  // (newStartLine, ch)", not "preserve the caller's offset within the old
  // block" — an inserted block has no old position to be offset from, and
  // a deleted block's fallback target (prev sibling / next sibling /
  // parent / clamped deletion point) is likewise unrelated to wherever the
  // cursor happened to be before the delete. Every other outcome kind
  // (move/indent/etc.) never sets it, so this branch is unreachable for
  // them and their behavior is unchanged.
  let newLine: number;
  let newCh: number;
  if (outcome.newCursorCh !== undefined) {
    newLine = outcome.newStartLine;
    const lineLen = newLines[newLine]?.length ?? 0;
    newCh = Math.min(outcome.newCursorCh, lineLen);
  } else {
    const offsetInBlock = cursor.line - resolvedNodeStartLine;
    newLine = outcome.newStartLine + offsetInBlock;
    const lineLen = newLines[newLine]?.length ?? 0;
    newCh = Math.min(cursor.ch, lineLen);
  }
  editor.setCursor({ line: newLine, ch: newCh });

  return true;
}
