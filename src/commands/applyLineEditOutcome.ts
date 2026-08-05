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
  "not-last-child":
    "Unified Outliner: only the last child of its parent can be outdented (MVP limitation).",
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
};

/** Common shape returned by moveBlock / indentBlock / setNodeOnlyLevel / moveNodeOnly. */
export interface LineEditOutcome {
  changed: boolean;
  lines: string[];
  newStartLine: number;
  reason?: string;
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
  const replacement = newLines.slice(first, newLast + 1).join("\n");
  editor.replaceRange(
    replacement,
    { line: first, ch: 0 },
    { line: oldLast, ch: oldLines[oldLast]?.length ?? 0 }
  );

  const offsetInBlock = cursor.line - resolvedNodeStartLine;
  const newLine = outcome.newStartLine + offsetInBlock;
  const lineLen = newLines[newLine]?.length ?? 0;
  editor.setCursor({ line: newLine, ch: Math.min(cursor.ch, lineLen) });

  return true;
}
