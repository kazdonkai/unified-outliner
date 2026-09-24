import { describe, expect, it } from "vitest";
import type { Editor } from "obsidian";
import { parseDocument } from "../src/parser/parseDocument";
import { scanComplexBlocks } from "../src/parser/complexBlocks";
import { matchCompositeBlocks } from "../src/parser/compositeBlocks";
import { DEFAULT_COMPOSITE_BLOCK_RULES } from "../src/model/compositeBlock";
import { applyLineEditOutcome } from "../src/commands/applyLineEditOutcome";
import { buildOutlineTree } from "../src/tree/buildOutlineTree";
import { buildNodeIdentityMap } from "../src/tree/foldIdentity";
import {
  BlockCopyOutcome,
  BlockCopySnapshot,
  BlockCopyTargetHint,
  BlockPastePosition,
  buildBlockCopySnapshot,
  duplicateBlockBelow,
  pasteBlockCopy,
} from "../src/edit/copyBlock";

/**
 * Phase 5E-Copy ("Outline Tree でのブロックコピー操作"): real-assertion tests
 * for the pure copy/duplicate/paste module (src/edit/copyBlock.ts). The
 * Outline Tree / Command Palette wiring is covered separately by
 * tests/phase5eCopyBlockUiWiring.test.ts (static source checks, since an
 * Obsidian ItemView cannot be constructed in vitest).
 */

const rules = DEFAULT_COMPOSITE_BLOCK_RULES;
const J = (...lines: string[]) => lines.join("\n");

type CopyKind = "section" | "list" | "callout" | "blockquote" | "fenced-code" | "table" | "paragraph";

/** Resolves the block of `kind` starting at `startLine` in `text` and builds its copy snapshot (fails the test if not copyable). */
function snapshotAt(text: string, kind: CopyKind, startLine: number): BlockCopySnapshot {
  const doc = parseDocument(text);
  const scan = scanComplexBlocks(doc);
  let endLine = -1;
  if (kind === "section" || kind === "list") {
    for (const n of doc.nodes.values()) if (n.type === kind && n.range.startLine === startLine) endLine = n.range.endLine;
  } else {
    for (const b of scan.blocks) if (b.kind === kind && b.range.startLine === startLine) endLine = b.range.endLine;
  }
  expect(endLine, `no ${kind} at line ${startLine}`).toBeGreaterThanOrEqual(startLine);
  const r = buildBlockCopySnapshot(doc, scan, matchCompositeBlocks(doc, scan, rules), { kind, range: { startLine, endLine } });
  if (!r.ok) throw new Error(`snapshot failed: ${r.reason}`);
  return r.value;
}

/** Builds a paste target hint for the Tree row of `kind` starting at `startLine`. */
function targetAt(text: string, kind: BlockCopyTargetHint["kind"], startLine: number): BlockCopyTargetHint {
  const doc = parseDocument(text);
  const scan = scanComplexBlocks(doc);
  if (kind === "section" || kind === "list") {
    for (const n of doc.nodes.values()) {
      if (n.type === kind && n.range.startLine === startLine) return { kind, range: n.range, parentId: n.parentId };
    }
  } else if (kind === "composite") {
    const c = matchCompositeBlocks(doc, scan, rules).find((x) => x.range.startLine === startLine);
    if (c) return { kind, range: c.range, parentId: null };
  } else {
    const b = scan.blocks.find(
      (x) =>
        x.range.startLine === startLine &&
        (kind === "paragraph" ? x.kind === "paragraph" : x.kind !== "paragraph") &&
        x.editability === "supported"
    );
    if (b) return { kind, range: b.range, parentId: b.parentId };
  }
  throw new Error(`no ${kind} target at line ${startLine}`);
}

function paste(text: string, snapshot: BlockCopySnapshot, target: BlockCopyTargetHint, position: BlockPastePosition) {
  return pasteBlockCopy(text, { snapshot, target, position }, rules);
}

/**
 * The central "原本を一切変更しない" invariant: removing exactly the lines
 * the operation added (the copy plus any blank separators, i.e. the
 * contiguous segment where old and new differ) yields the original lines
 * byte-for-byte.
 */
function expectOnlyInsertion(original: string, outcome: BlockCopyOutcome): void {
  expect(outcome.changed).toBe(true);
  const oldLines = original.split("\n");
  const newLines = outcome.lines;
  const added = newLines.length - oldLines.length;
  expect(added).toBeGreaterThan(0);
  let p = 0;
  while (p < oldLines.length && oldLines[p] === newLines[p]) p++;
  // Every old line after the insertion point must reappear, in order, right after the inserted segment.
  expect(newLines.slice(p + added)).toEqual(oldLines.slice(p));
  expect(newLines.slice(0, p)).toEqual(oldLines.slice(0, p));
}

// ---------------------------------------------------------------------------

describe("Phase 5E-Copy: Duplicate below — section", () => {
  const text = J("# Title", "", "## A", "alpha", "", "### A1", "a1 text", "", "## B", "beta");

  it("duplicates the whole section subtree (heading + body + child sections) directly after it", () => {
    const out = duplicateBlockBelow(text, snapshotAt(text, "section", 2), rules);
    expect(out.lines.join("\n")).toBe(
      J("# Title", "", "## A", "alpha", "", "### A1", "a1 text", "", "## A", "alpha", "", "### A1", "a1 text", "", "## B", "beta")
    );
    expect(out.insertedRange).toEqual({ startLine: 8, endLine: 13 });
    expect(out.newStartLine).toBe(8);
    expectOnlyInsertion(text, out);
  });

  it("the copy is independent: editing the original afterwards leaves the copy untouched", () => {
    const out = duplicateBlockBelow(text, snapshotAt(text, "section", 2), rules);
    const edited = [...out.lines];
    edited[3] = "alpha EDITED"; // the ORIGINAL's body line
    edited[6] = "a1 EDITED";
    const doc = parseDocument(edited.join("\n"));
    const copyRange = out.insertedRange!;
    expect(edited.slice(copyRange.startLine, copyRange.endLine + 1)).toEqual(["## A", "alpha", "", "### A1", "a1 text", ""]);
    // …and both are still real, separate sections in the re-parsed document.
    const aSections = [...doc.nodes.values()].filter((n) => n.type === "section" && n.range.startLine !== 0 && doc.lines[n.range.startLine] === "## A");
    expect(aSections.map((n) => n.range.startLine)).toEqual([2, 8]);
  });

  it("adds a blank separator when the section is the last one and the note has no trailing blank line", () => {
    const t = J("# A", "text");
    const out = duplicateBlockBelow(t, snapshotAt(t, "section", 0), rules);
    expect(out.lines).toEqual(["# A", "text", "", "# A", "text"]);
    expectOnlyInsertion(t, out);
  });

  it("never touches YAML frontmatter", () => {
    const t = J("---", "tags: [x]", "---", "# A", "text");
    const out = duplicateBlockBelow(t, snapshotAt(t, "section", 3), rules);
    expect(out.lines.slice(0, 3)).toEqual(["---", "tags: [x]", "---"]);
    expect(out.lines).toEqual(["---", "tags: [x]", "---", "# A", "text", "", "# A", "text"]);
  });
});

describe("Phase 5E-Copy: Duplicate below — list subtree", () => {
  it("duplicates a list item together with all of its descendants, as the next sibling", () => {
    const t = J("## S", "- a", "  - a1", "    - a1x", "  - a2", "- b");
    const out = duplicateBlockBelow(t, snapshotAt(t, "list", 1), rules);
    expect(out.lines).toEqual(["## S", "- a", "  - a1", "    - a1x", "  - a2", "- a", "  - a1", "    - a1x", "  - a2", "- b"]);
    expect(out.insertedRange).toEqual({ startLine: 5, endLine: 8 });
    expectOnlyInsertion(t, out);
  });

  it("duplicates a nested item at its own indentation without adding blank lines inside the list", () => {
    const t = J("- a", "  - a1", "  - a2", "- b");
    const out = duplicateBlockBelow(t, snapshotAt(t, "list", 1), rules);
    expect(out.lines).toEqual(["- a", "  - a1", "  - a1", "  - a2", "- b"]);
  });

  it("does not renumber ordered items — every existing line (the original included) stays byte-identical", () => {
    const t = J("1. one", "2. two", "3. three");
    const out = duplicateBlockBelow(t, snapshotAt(t, "list", 1), rules);
    expect(out.lines).toEqual(["1. one", "2. two", "2. two", "3. three"]);
    expectOnlyInsertion(t, out);
  });

  it("refuses a list item with mixed tab/space indentation", () => {
    const t = J("- a", " \t- mixed", "- b");
    const doc = parseDocument(t);
    const mixed = [...doc.nodes.values()].find((n) => n.type === "list" && n.range.startLine === 1)!;
    const r = buildBlockCopySnapshot(doc, scanComplexBlocks(doc), [], { kind: "list", range: mixed.range });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("copy-unsafe-indent");
  });
});

describe("Phase 5E-Copy: Duplicate below — callout / blockquote / fenced-code / table / paragraph", () => {
  it("callout", () => {
    const t = J("## S", "intro", "", "> [!note] Title", "> body", "", "outro");
    const out = duplicateBlockBelow(t, snapshotAt(t, "callout", 3), rules);
    expect(out.lines).toEqual(["## S", "intro", "", "> [!note] Title", "> body", "", "> [!note] Title", "> body", "", "outro"]);
    expect(out.insertedRange).toEqual({ startLine: 6, endLine: 7 });
    expectOnlyInsertion(t, out);
  });

  it("blockquote", () => {
    const t = J("## S", "", "> quoted", "> more", "", "outro");
    const out = duplicateBlockBelow(t, snapshotAt(t, "blockquote", 2), rules);
    expect(out.lines).toEqual(["## S", "", "> quoted", "> more", "", "> quoted", "> more", "", "outro"]);
    expectOnlyInsertion(t, out);
  });

  it("fenced-code (fence lines and body copied verbatim)", () => {
    const t = J("## S", "", "```mermaid", "graph TD", "  A --> B", "```", "", "outro");
    const out = duplicateBlockBelow(t, snapshotAt(t, "fenced-code", 2), rules);
    expect(out.lines).toEqual([
      "## S", "", "```mermaid", "graph TD", "  A --> B", "```", "", "```mermaid", "graph TD", "  A --> B", "```", "", "outro",
    ]);
    expectOnlyInsertion(t, out);
  });

  it("table", () => {
    const t = J("## S", "", "| a | b |", "| --- | --- |", "| 1 | 2 |", "", "outro");
    const out = duplicateBlockBelow(t, snapshotAt(t, "table", 2), rules);
    expect(out.lines).toEqual([
      "## S", "", "| a | b |", "| --- | --- |", "| 1 | 2 |", "", "| a | b |", "| --- | --- |", "| 1 | 2 |", "", "outro",
    ]);
    expectOnlyInsertion(t, out);
  });

  it("paragraph — inserts the blank line needed to keep the two paragraphs separate", () => {
    const t = J("## S", "first para", "", "second para");
    const out = duplicateBlockBelow(t, snapshotAt(t, "paragraph", 1), rules);
    expect(out.lines).toEqual(["## S", "first para", "", "first para", "", "second para"]);
    expectOnlyInsertion(t, out);
  });

  it("paragraph at the end of the note without a trailing blank line", () => {
    const t = J("## S", "only para");
    const out = duplicateBlockBelow(t, snapshotAt(t, "paragraph", 1), rules);
    expect(out.lines).toEqual(["## S", "only para", "", "only para"]);
  });

  it("refuses a callout nested inside a list item's continuation", () => {
    const t = J("- item", "", "  > [!note] nested", "  > body");
    const doc = parseDocument(t);
    const scan = scanComplexBlocks(doc);
    const nested = scan.blocks.find((b) => b.kind === "callout")!;
    expect(nested.parentId).toBe("li-0");
    const r = buildBlockCopySnapshot(doc, scan, [], { kind: "callout", range: nested.range });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("copy-nested-in-list");
  });

  it("refuses a flat paste relative to a paragraph nested inside a list item", () => {
    const t = J("- item", "  continuation para", "- b", "", "top para");
    const doc = parseDocument(t);
    const nestedPara = scanComplexBlocks(doc).blocks.find((b) => b.kind === "paragraph" && b.parentId === "li-0")!;
    const out = paste(
      t,
      snapshotAt(t, "paragraph", 4),
      { kind: "paragraph", range: nestedPara.range, parentId: nestedPara.parentId },
      "after"
    );
    expect(out.reason).toBe("copy-invalid-target");
  });

  it("refuses a block whose boundary is not confidently known (lazy continuation after a blockquote)", () => {
    const t = J("x", "", "> quote", "> more", "y");
    const doc = parseDocument(t);
    const scan = scanComplexBlocks(doc);
    const bq = scan.blocks.find((b) => b.kind === "blockquote")!;
    const r = buildBlockCopySnapshot(doc, scan, [], { kind: "blockquote", range: bq.range });
    expect(r.ok).toBe(true);
    const out = duplicateBlockBelow(t, (r as { ok: true; value: BlockCopySnapshot }).value, rules);
    expect(out.changed).toBe(false);
    expect(out.reason).toBe("copy-unsafe-position");
    expect(out.lines).toEqual(t.split("\n"));
  });
});

describe("Phase 5E-Copy: Copy → Paste inserts at the chosen position", () => {
  const doc1 = J("# Root", "", "## A", "alpha", "", "## B", "beta", "", "## C", "gamma");

  it("section: Paste block (after) inserts after the target's whole subtree", () => {
    const out = paste(doc1, snapshotAt(doc1, "section", 2), targetAt(doc1, "section", 5), "after");
    expect(out.lines).toEqual(["# Root", "", "## A", "alpha", "", "## B", "beta", "", "## A", "alpha", "", "## C", "gamma"]);
    expectOnlyInsertion(doc1, out);
  });

  it("section: Paste block above (before) inserts at the target heading line", () => {
    const out = paste(doc1, snapshotAt(doc1, "section", 8), targetAt(doc1, "section", 2), "before");
    expect(out.lines).toEqual(["# Root", "", "## C", "gamma", "", "## A", "alpha", "", "## B", "beta", "", "## C", "gamma"]);
    expectOnlyInsertion(doc1, out);
  });

  it("section: Paste as child re-levels the whole copied subtree (target level + 1), leaving the original untouched", () => {
    const t = J("# P", "", "## A", "a", "### A1", "a1", "", "## B", "b");
    const out = paste(t, snapshotAt(t, "section", 2), targetAt(t, "section", 7), "inside");
    expect(out.lines).toEqual(["# P", "", "## A", "a", "### A1", "a1", "", "## B", "b", "", "### A", "a", "#### A1", "a1", ""]);
    expectOnlyInsertion(t, out);
  });

  it("section: refuses a paste that would re-parent existing sections under the copy", () => {
    // "## A" pasted above "### B1" would swallow B1 (and B2) as its own children.
    const t = J("# P", "## A", "a", "## B", "### B1", "b1", "### B2", "b2");
    const out = paste(t, snapshotAt(t, "section", 1), targetAt(t, "section", 4), "before");
    expect(out.changed).toBe(false);
    expect(out.reason).toBe("copy-structure-changed");
    expect(out.lines).toEqual(t.split("\n"));
  });

  it("section: refuses Paste as child beyond heading level 6", () => {
    const t = J("# P", "## A", "###### deep", "x", "## B");
    const out = paste(t, snapshotAt(t, "section", 1), targetAt(t, "section", 4), "inside");
    expect(out.reason).toBe("copy-max-heading-level");
  });

  it("section: a list/paragraph row is not a valid target for a section copy", () => {
    const t = J("## A", "- item", "", "## B");
    const out = paste(t, snapshotAt(t, "section", 3), targetAt(t, "list", 1), "after");
    expect(out.reason).toBe("copy-invalid-target");
  });

  const listDoc = J("## S", "- a", "  - a1", "- b", "  - b1", "", "## T", "text");

  it("list: Paste block (after) a list item — as its next sibling, at the target's indentation", () => {
    const out = paste(listDoc, snapshotAt(listDoc, "list", 2), targetAt(listDoc, "list", 3), "after");
    expect(out.lines).toEqual(["## S", "- a", "  - a1", "- b", "  - b1", "- a1", "", "## T", "text"]);
    expectOnlyInsertion(listDoc, out);
  });

  it("list: Paste block above (before) a list item", () => {
    const out = paste(listDoc, snapshotAt(listDoc, "list", 3), targetAt(listDoc, "list", 1), "before");
    expect(out.lines).toEqual(["## S", "- b", "  - b1", "- a", "  - a1", "- b", "  - b1", "", "## T", "text"]);
  });

  it("list: Paste as child appends as the target's last child at the child indentation", () => {
    const out = paste(listDoc, snapshotAt(listDoc, "list", 3), targetAt(listDoc, "list", 1), "inside");
    expect(out.lines).toEqual(["## S", "- a", "  - a1", "  - b", "    - b1", "- b", "  - b1", "", "## T", "text"]);
    expectOnlyInsertion(listDoc, out);
  });

  it("list: Paste block onto a section heading appends to that section's own content, with a blank separator", () => {
    const out = paste(listDoc, snapshotAt(listDoc, "list", 1), targetAt(listDoc, "section", 6), "after");
    expect(out.lines).toEqual(["## S", "- a", "  - a1", "- b", "  - b1", "", "## T", "text", "", "- a", "  - a1"]);
    expectOnlyInsertion(listDoc, out);
  });

  const flatDoc = J("## S", "para one", "", "> [!note] N", "> body", "", "- item", "", "## T", "tail para");

  it("callout: Paste block after a paragraph row", () => {
    const t = J("## S", "para one", "", "para two", "", "> [!note] N", "> body");
    const out = paste(t, snapshotAt(t, "callout", 5), targetAt(t, "paragraph", 1), "after");
    expect(out.lines).toEqual(["## S", "para one", "", "> [!note] N", "> body", "", "para two", "", "> [!note] N", "> body"]);
    expectOnlyInsertion(t, out);
  });

  it("callout: Paste block after a list item gets a blank line (never forms a new CompositeBlock with it)", () => {
    const t = J("## S", "- ![[img.png]]", "", "> [!note] N", "> body");
    const out = paste(t, snapshotAt(t, "callout", 3), targetAt(t, "list", 1), "after");
    expect(out.lines).toEqual(["## S", "- ![[img.png]]", "", "> [!note] N", "> body", "", "> [!note] N", "> body"]);
    const doc = parseDocument(out.lines.join("\n"));
    expect(matchCompositeBlocks(doc, scanComplexBlocks(doc), rules)).toHaveLength(0);
  });

  it("paragraph pasted before an ordered item not numbered 1 gets a blank line (no lazy continuation)", () => {
    const t = J("## S", "3. third", "", "para");
    const out = paste(t, snapshotAt(t, "paragraph", 3), targetAt(t, "list", 1), "before");
    expect(out.lines).toEqual(["## S", "para", "", "3. third", "", "para"]);
  });

  it("callout: Paste block onto another section's heading (cross-section)", () => {
    const out = paste(flatDoc, snapshotAt(flatDoc, "callout", 3), targetAt(flatDoc, "section", 8), "after");
    expect(out.lines).toEqual([
      "## S", "para one", "", "> [!note] N", "> body", "", "- item", "", "## T", "tail para", "", "> [!note] N", "> body",
    ]);
    expectOnlyInsertion(flatDoc, out);
  });

  it("paragraph: Paste block above a list item", () => {
    const t = J("## S", "para one", "", "- item", "", "## T", "tail para");
    const out = paste(t, snapshotAt(t, "paragraph", 6), targetAt(t, "list", 3), "before");
    expect(out.changed).toBe(true);
    expectOnlyInsertion(t, out);
    expect(out.lines.slice(out.insertedRange!.startLine, out.insertedRange!.endLine + 1)).toEqual(["tail para"]);
  });

  it("fenced-code and table: Paste block after a callout row (complex target)", () => {
    const t = J("## S", "", "```js", "x()", "```", "", "| a |", "| - |", "| 1 |", "", "> [!tip] T", "> b");
    const code = paste(t, snapshotAt(t, "fenced-code", 2), targetAt(t, "complex", 10), "after");
    expect(code.lines.slice(-4)).toEqual(["", "```js", "x()", "```"]);
    expectOnlyInsertion(t, code);
    const table = paste(t, snapshotAt(t, "table", 6), targetAt(t, "complex", 10), "after");
    expect(table.lines.slice(-4)).toEqual(["", "| a |", "| - |", "| 1 |"]);
    expectOnlyInsertion(t, table);
  });

  it("flat blocks never accept 'inside' relative to a non-section row", () => {
    const out = paste(flatDoc, snapshotAt(flatDoc, "callout", 3), targetAt(flatDoc, "paragraph", 1), "inside");
    expect(out.reason).toBe("copy-invalid-target");
  });

  it("re-resolves a source that merely shifted (edited above) by its exact content", () => {
    const snap = snapshotAt(flatDoc, "callout", 3);
    const edited = J("## S", "a NEW first line", "", "para one", "", "> [!note] N", "> body", "", "- item", "", "## T", "tail para");
    const out = paste(edited, snap, targetAt(edited, "section", 10), "after");
    expect(out.changed).toBe(true);
    expect(out.lines.slice(-2)).toEqual(["> [!note] N", "> body"]);
  });

  it("refuses when the source was edited after Copy block (never pastes content the user did not copy)", () => {
    const snap = snapshotAt(flatDoc, "callout", 3);
    const edited = flatDoc.replace("> body", "> body CHANGED");
    const out = paste(edited, snap, targetAt(edited, "section", 8), "after");
    expect(out.changed).toBe(false);
    expect(out.reason).toBe("copy-source-changed");
  });

  it("refuses when the source can no longer be told apart from an identical block (ambiguous)", () => {
    const t = J("## S", "dup", "", "other", "", "## T", "x");
    const snap = snapshotAt(t, "paragraph", 1);
    // The original moved AND an identical paragraph now exists elsewhere.
    const edited = J("## S", "other", "", "dup", "", "## T", "dup");
    const out = paste(edited, snap, targetAt(edited, "section", 5), "after");
    expect(out.reason).toBe("copy-source-ambiguous");
  });

  it("refuses when the target row changed since the menu was built", () => {
    const snap = snapshotAt(flatDoc, "callout", 3);
    const staleTarget = targetAt(flatDoc, "paragraph", 1);
    const edited = flatDoc.replace("para one", "para one\nnow two lines");
    const out = paste(edited, snap, staleTarget, "after");
    expect(out.reason).toBe("copy-target-changed");
  });
});

describe("Phase 5E-Copy: pasting inside the copy source is refused", () => {
  it("section: onto one of its own child sections", () => {
    const t = J("## A", "a", "### A1", "a1", "## B");
    const snap = snapshotAt(t, "section", 0);
    for (const pos of ["before", "after", "inside"] as const) {
      const out = paste(t, snap, targetAt(t, "section", 2), pos);
      expect(out.changed).toBe(false);
      expect(out.reason).toBe("copy-inside-source");
      expect(out.lines).toEqual(t.split("\n"));
    }
  });

  it("section: Paste as child of itself", () => {
    const t = J("## A", "a", "## B");
    const out = paste(t, snapshotAt(t, "section", 0), targetAt(t, "section", 0), "inside");
    expect(out.reason).toBe("copy-inside-source");
  });

  it("list: onto one of its own descendants, or as its own child", () => {
    const t = J("- a", "  - a1", "    - a1x", "- b");
    const snap = snapshotAt(t, "list", 0);
    expect(paste(t, snap, targetAt(t, "list", 1), "after").reason).toBe("copy-inside-source");
    expect(paste(t, snap, targetAt(t, "list", 2), "before").reason).toBe("copy-inside-source");
    expect(paste(t, snap, targetAt(t, "list", 0), "inside").reason).toBe("copy-inside-source");
  });

  it("section: onto a list item or paragraph inside the copied section", () => {
    const t = J("## A", "para", "", "- x", "## B");
    const snap = snapshotAt(t, "section", 0);
    expect(paste(t, snap, targetAt(t, "list", 3), "after").reason).toBe("copy-inside-source");
  });

  it("pasting directly before/after the source itself is allowed (that is a duplicate)", () => {
    const t = J("- a", "- b");
    const snap = snapshotAt(t, "list", 0);
    expect(paste(t, snap, targetAt(t, "list", 0), "before").lines).toEqual(["- a", "- a", "- b"]);
    expect(paste(t, snap, targetAt(t, "list", 0), "after").lines).toEqual(["- a", "- a", "- b"]);
  });
});

describe("Phase 5E-Copy: required blank lines are supplied (ensureBlankSeparation reuse)", () => {
  it("callout pasted directly before a paragraph with no blank line between — blank added after the copy", () => {
    const t = J("## S", "para A", "para A2", "", "> [!note] N", "> b");
    // "para A\npara A2" is one paragraph (lines 1-2); paste the callout BEFORE it.
    const out = paste(t, snapshotAt(t, "callout", 4), targetAt(t, "paragraph", 1), "before");
    expect(out.lines).toEqual(["## S", "> [!note] N", "> b", "", "para A", "para A2", "", "> [!note] N", "> b"]);
  });

  it("paragraph pasted after a paragraph that ends the note — blank added before the copy", () => {
    const t = J("## S", "one", "", "two");
    const out = paste(t, snapshotAt(t, "paragraph", 1), targetAt(t, "paragraph", 3), "after");
    expect(out.lines).toEqual(["## S", "one", "", "two", "", "one"]);
  });

  it("existing blank lines are never doubled", () => {
    const t = J("## S", "one", "", "two", "", "three");
    const out = paste(t, snapshotAt(t, "paragraph", 5), targetAt(t, "paragraph", 1), "after");
    expect(out.lines).toEqual(["## S", "one", "", "three", "", "two", "", "three"]);
  });

  it("section copy: blank lines are added between body text and a neighboring heading", () => {
    const t = J("## A", "a text", "## B", "b text");
    const out = paste(t, snapshotAt(t, "section", 2), targetAt(t, "section", 0), "before");
    expect(out.lines).toEqual(["## B", "b text", "", "## A", "a text", "## B", "b text"]);
    const out2 = paste(t, snapshotAt(t, "section", 0), targetAt(t, "section", 2), "after");
    expect(out2.lines).toEqual(["## A", "a text", "## B", "b text", "", "## A", "a text"]);
  });

  it("list items pasted between list items get no blank line (the list stays tight)", () => {
    const t = J("- a", "- b", "- c");
    const out = paste(t, snapshotAt(t, "list", 2), targetAt(t, "list", 0), "after");
    expect(out.lines).toEqual(["- a", "- c", "- b", "- c"]);
  });
});

describe("Phase 5E-Copy: CompositeBlock boundaries", () => {
  const t = J("## S", "- ![[img.png]]", "> [!note] OCR", "> text", "", "para", "", "> [!tip] other", "> x");

  it("the fixture really is a CompositeBlock (list + callout)", () => {
    const doc = parseDocument(t);
    const composites = matchCompositeBlocks(doc, scanComplexBlocks(doc), rules);
    expect(composites.map((c) => [c.range.startLine, c.range.endLine])).toEqual([[1, 3]]);
  });

  it("refuses to paste between a CompositeBlock's anchor list item and its callout", () => {
    const out = paste(t, snapshotAt(t, "callout", 7), targetAt(t, "list", 1), "after");
    expect(out.changed).toBe(false);
    expect(out.reason).toBe("copy-composite-internal-boundary");
    expect(out.lines).toEqual(t.split("\n"));
  });

  it("refuses to paste a list item between the anchor and its member", () => {
    const t2 = J("- other", "", "- ![[img.png]]", "> [!note] OCR", "> text");
    const out = paste(t2, snapshotAt(t2, "list", 0), targetAt(t2, "list", 2), "after");
    expect(out.reason).toBe("copy-composite-internal-boundary");
  });

  it("a CompositeBlock member (anchor list item or callout member) is not a copy source on its own", () => {
    const doc = parseDocument(t);
    const scan = scanComplexBlocks(doc);
    const composites = matchCompositeBlocks(doc, scan, rules);
    for (const m of composites[0].members) {
      const kind = m.kind === "single-line-list" || m.kind === "list" ? "list" : m.kind;
      const r = buildBlockCopySnapshot(doc, scan, composites, { kind, range: m.range });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("copy-composite-member");
    }
  });

  it("allows pasting before/after the CompositeBlock as a whole, leaving it intact", () => {
    const before = paste(t, snapshotAt(t, "paragraph", 5), targetAt(t, "composite", 1), "before");
    expect(before.lines).toEqual(["## S", "para", "", "- ![[img.png]]", "> [!note] OCR", "> text", "", "para", "", "> [!tip] other", "> x"]);
    const after = paste(t, snapshotAt(t, "callout", 7), targetAt(t, "composite", 1), "after");
    expect(after.lines).toEqual([
      "## S", "- ![[img.png]]", "> [!note] OCR", "> text", "", "> [!tip] other", "> x", "", "para", "", "> [!tip] other", "> x",
    ]);
    for (const out of [before, after]) {
      const doc = parseDocument(out.lines.join("\n"));
      expect(matchCompositeBlocks(doc, scanComplexBlocks(doc), rules)).toHaveLength(1);
    }
  });

  it("a section containing a CompositeBlock duplicates with the composite intact (two composites afterwards)", () => {
    const t3 = J("## S", "- ![[img.png]]", "> [!note] OCR", "> text", "", "## T");
    const out = duplicateBlockBelow(t3, snapshotAt(t3, "section", 0), rules);
    const doc = parseDocument(out.lines.join("\n"));
    expect(matchCompositeBlocks(doc, scanComplexBlocks(doc), rules)).toHaveLength(2);
    expectOnlyInsertion(t3, out);
  });
});

describe("Phase 5E-Copy: one Undo step (single write through applyLineEditOutcome)", () => {
  /** Fake Editor with a real undo history: each replaceRange is one history entry, exactly like one CM6 transaction. */
  class UndoableFakeEditor {
    lines: string[];
    history: string[][] = [];
    replaceCalls = 0;
    constructor(text: string) {
      this.lines = text.split("\n");
    }
    replaceRange(text: string, from: { line: number; ch: number }, to: { line: number; ch: number }): void {
      this.replaceCalls++;
      this.history.push([...this.lines]);
      const before = this.lines.slice(0, from.line);
      const head = this.lines[from.line].slice(0, from.ch);
      const tail = this.lines[to.line].slice(to.ch);
      const after = this.lines.slice(to.line + 1);
      this.lines = [...before, ...(head + text + tail).split("\n"), ...after];
    }
    undo(): void {
      const prev = this.history.pop();
      if (prev) this.lines = prev;
    }
    setCursor(): void {}
    getValue(): string {
      return this.lines.join("\n");
    }
  }

  const cases: [string, string, () => BlockCopyOutcome][] = [];
  const secDoc = J("# R", "", "## A", "alpha", "", "### A1", "x", "", "## B", "beta");
  cases.push(["section duplicate", secDoc, () => duplicateBlockBelow(secDoc, snapshotAt(secDoc, "section", 2), rules)]);
  const listDoc = J("- a", "  - a1", "- b");
  cases.push(["list paste as child", listDoc, () => paste(listDoc, snapshotAt(listDoc, "list", 2), targetAt(listDoc, "list", 0), "inside")]);
  const calloutDoc = J("## S", "para", "> [!note] N", "> b");
  cases.push([
    "callout paste with blank separators on both sides",
    J("## S", "para", "", "> [!note] N", "> b", "", "tail"),
    () => {
      const t = J("## S", "para", "", "> [!note] N", "> b", "", "tail");
      return paste(t, snapshotAt(t, "callout", 3), targetAt(t, "paragraph", 1), "before");
    },
  ]);
  void calloutDoc;

  for (const [name, text, run] of cases) {
    it(`${name}: exactly one replaceRange, and one undo restores the original byte-for-byte`, () => {
      const outcome = run();
      expect(outcome.changed).toBe(true);
      const editor = new UndoableFakeEditor(text);
      const changed = applyLineEditOutcome(
        editor as unknown as Editor,
        { line: 0, ch: 0 },
        0,
        text.split("\n"),
        outcome,
        () => {}
      );
      expect(changed).toBe(true);
      expect(editor.replaceCalls).toBe(1);
      expect(editor.lines).toEqual(outcome.lines);
      editor.undo();
      expect(editor.getValue()).toBe(text);
    });
  }
});

describe("Phase 5E-Copy: fold-state identity of the original is preserved by Duplicate below", () => {
  /** Fold identity (tree/foldIdentity.ts) of the section/list node starting at `line`. */
  function identityAt(text: string, line: number): string | undefined {
    const doc = parseDocument(text);
    const tree = buildOutlineTree(doc, { includeLists: true });
    const ids = buildNodeIdentityMap(tree);
    const node = [...doc.nodes.values()].find((n) => n.range.startLine === line);
    return node ? ids.get(node.id) : undefined;
  }

  it("section: the original keeps its identity; the copy gets a new (#2) identity, so a collapsed original stays collapsed", () => {
    const t = J("# R", "## A", "- x", "  - y", "## B");
    const before = identityAt(t, 1);
    const out = duplicateBlockBelow(t, snapshotAt(t, "section", 1), rules);
    const text = out.lines.join("\n");
    expect(identityAt(text, 1)).toBe(before);
    expect(identityAt(text, out.insertedRange!.startLine)).not.toBe(before);
  });

  it("list: the original item and its child keep their identities", () => {
    const t = J("## S", "- x", "  - y", "- z");
    const beforeX = identityAt(t, 1);
    const beforeY = identityAt(t, 2);
    const out = duplicateBlockBelow(t, snapshotAt(t, "list", 1), rules);
    const text = out.lines.join("\n");
    expect(identityAt(text, 1)).toBe(beforeX);
    expect(identityAt(text, 2)).toBe(beforeY);
  });
});
