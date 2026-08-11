import { describe, expect, it } from "vitest";
import type { Editor } from "obsidian";
import { applyLineEditOutcome, LineEditOutcome } from "../src/commands/applyLineEditOutcome";

/**
 * Minimal fake Editor: actually applies replaceRange to a real in-memory
 * document (not just recording call args), so tests assert the resulting
 * TEXT is correct — not just that some plausible-looking arguments were
 * passed. Only implements the two Editor methods applyLineEditOutcome
 * actually calls.
 */
class FakeEditor {
  lines: string[];
  cursor: { line: number; ch: number } = { line: 0, ch: 0 };

  constructor(text: string) {
    this.lines = text.split("\n");
  }

  replaceRange(
    text: string,
    from: { line: number; ch: number },
    to: { line: number; ch: number }
  ): void {
    if (to.line < from.line || (to.line === from.line && to.ch < from.ch)) {
      throw new RangeError("Selection points outside of document");
    }
    const before = this.lines.slice(0, from.line);
    const afterFromLine = this.lines[from.line].slice(0, from.ch);
    const beforeToLine = this.lines[to.line].slice(to.ch);
    const after = this.lines.slice(to.line + 1);
    const middle = (afterFromLine + text + beforeToLine).split("\n");
    this.lines = [...before, ...middle, ...after];
  }

  setCursor(pos: { line: number; ch: number }): void {
    this.cursor = pos;
  }

  getValue(): string {
    return this.lines.join("\n");
  }
}

function outcome(lines: string[], newStartLine: number, newCursorCh?: number): LineEditOutcome {
  return { changed: true, lines, newStartLine, newCursorCh };
}

describe("applyLineEditOutcome: pure append at end of document (Phase 5C-1B regression)", () => {
  it("inserting new lines strictly after the last old line never inverts the replaceRange (real-device-reported bug)", () => {
    const oldLines = ["a", "b"];
    const editor = new FakeEditor(oldLines.join("\n"));
    const newLines = ["a", "b", "c", ""];

    const changed = applyLineEditOutcome(
      editor as unknown as Editor,
      { line: 1, ch: 0 },
      1,
      oldLines,
      outcome(newLines, 2, 1),
      () => {}
    );

    expect(changed).toBe(true);
    expect(editor.lines).toEqual(newLines);
    expect(editor.cursor).toEqual({ line: 2, ch: 1 });
  });

  it("handles a two-line append (heading + blank line, matching insertSiblingSection's own shape) at the very end", () => {
    const oldLines = ["# A", "body", "", "## B", "- one", "- two"];
    const editor = new FakeEditor(oldLines.join("\n"));
    const newLines = [...oldLines, "## ", ""];

    const changed = applyLineEditOutcome(
      editor as unknown as Editor,
      { line: 6, ch: 0 },
      6,
      oldLines,
      outcome(newLines, 6, 3),
      () => {}
    );

    expect(changed).toBe(true);
    expect(editor.lines).toEqual(newLines);
    expect(editor.cursor).toEqual({ line: 6, ch: 3 });
  });
});

describe("applyLineEditOutcome: existing move/indent-style behavior is unaffected", () => {
  it("replaces a mid-document differing region and preserves unchanged prefix/suffix", () => {
    const oldLines = ["a", "b", "c", "d"];
    const editor = new FakeEditor(oldLines.join("\n"));
    const newLines = ["a", "X", "c", "d"];

    const changed = applyLineEditOutcome(
      editor as unknown as Editor,
      { line: 1, ch: 0 },
      1,
      oldLines,
      outcome(newLines, 1),
      () => {}
    );

    expect(changed).toBe(true);
    expect(editor.lines).toEqual(newLines);
  });

  it("preserves the caller's relative cursor offset within the block when newCursorCh is not set", () => {
    const oldLines = ["- one", "- two"];
    const editor = new FakeEditor(oldLines.join("\n"));
    const newLines = ["- two", "- one"];

    applyLineEditOutcome(
      editor as unknown as Editor,
      { line: 0, ch: 2 },
      0,
      oldLines,
      outcome(newLines, 1),
      () => {}
    );

    // newStartLine=1 + offsetInBlock(0) = line 1, ch preserved at 2.
    expect(editor.cursor).toEqual({ line: 1, ch: 2 });
  });

  it("does not call replaceRange/setCursor and reports the no-op reason when unchanged", () => {
    const oldLines = ["a"];
    const editor = new FakeEditor(oldLines.join("\n"));
    let notified: string | undefined;

    const changed = applyLineEditOutcome(
      editor as unknown as Editor,
      { line: 0, ch: 0 },
      0,
      oldLines,
      { changed: false, lines: oldLines, newStartLine: -1, reason: "resolve-failed" },
      (m) => (notified = m)
    );

    expect(changed).toBe(false);
    expect(editor.lines).toEqual(oldLines);
    expect(notified).toBe(
      "Unified Outliner: could not resolve that block (the note may have changed)."
    );
  });
});

describe("applyLineEditOutcome: true no-op guard (2026-08-11 regression, inline rename)", () => {
  it("does not touch the document or move the cursor when outcome.lines is byte-identical to oldLines despite changed: true", () => {
    // renameSection/renameListItem report changed: true unconditionally,
    // even when the "new" text is exactly the original text (e.g. the
    // Outline Tree's inline rename box committing on blur — see
    // OutlineTreeView.ts's rename blur handler — with nothing actually
    // typed). Without the no-op guard this degenerates into the "pure
    // append" branch below (the prefix-matching loop consumes every line,
    // landing on oldLast < first) and inserts a spurious blank line at the
    // end of the document.
    const oldLines = ["## List 3", "some unrelated text", "## Markdown B"];
    const editor = new FakeEditor(oldLines.join("\n"));

    const changed = applyLineEditOutcome(
      editor as unknown as Editor,
      { line: 0, ch: 0 },
      0,
      oldLines,
      outcome([...oldLines], 0, oldLines[0].length),
      () => {}
    );

    expect(changed).toBe(false);
    expect(editor.lines).toEqual(oldLines);
    expect(editor.cursor).toEqual({ line: 0, ch: 0 });
  });

  it("still applies a real change even when only a single character differs deep in a long unbroken line", () => {
    const oldLines = ["- " + "3".repeat(80)];
    const editor = new FakeEditor(oldLines.join("\n"));
    const newLines = ["- " + "3".repeat(79)];

    const changed = applyLineEditOutcome(
      editor as unknown as Editor,
      { line: 0, ch: 0 },
      0,
      oldLines,
      outcome(newLines, 0, newLines[0].length),
      () => {}
    );

    expect(changed).toBe(true);
    expect(editor.lines).toEqual(newLines);
  });
});

describe("applyLineEditOutcome: pure deletion down to an empty document", () => {
  it("deleting the entire document does not invert the replaceRange either", () => {
    const oldLines = ["# Only section", "body"];
    const editor = new FakeEditor(oldLines.join("\n"));
    const newLines: string[] = [];

    const changed = applyLineEditOutcome(
      editor as unknown as Editor,
      { line: 0, ch: 0 },
      0,
      oldLines,
      outcome(newLines, 0, 0),
      () => {}
    );

    expect(changed).toBe(true);
    expect(editor.lines).toEqual([""]);
  });
});
