import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { complexBlockDepth, scanComplexBlocks } from "../src/parser/complexBlocks";
import {
  buildParagraphMoveAnchor,
  moveParagraphFromAnchor,
  ParagraphMoveAnchor,
} from "../src/edit/paragraphTreeMove";
import {
  buildSiblingTargetAnchor,
  listNonAdjacentMoveTargets,
  moveParagraphNonAdjacent,
  NonAdjacentMovePosition,
  paragraphNonAdjacentMoveReasonText,
  SiblingTargetAnchor,
} from "../src/edit/paragraphNonAdjacentMove";
import { createTranslator } from "../src/i18n";
import { DEFAULT_COMPOSITE_BLOCK_RULES } from "../src/model/compositeBlock";

/**
 * Phase 5T-3A §5 ("必要なテスト"): real, executable tests for
 * moveParagraphNonAdjacent — modeled directly on
 * tests/paragraphTreeMove.test.ts's own fixture style (anchorForNth,
 * three-layer identity re-resolution). Covers every item in the ticket's
 * §5 list, plus the blank-line-insertion safety rule that is this file's
 * own new contribution beyond the existing adjacent-swap move.
 */

function sourceAnchorForNth(text: string, n: number): ParagraphMoveAnchor {
  const doc = parseDocument(text);
  const scan = scanComplexBlocks(doc);
  const paragraphs = scan.blocks.filter((b) => b.kind === "paragraph");
  const info = paragraphs[n];
  if (!info) throw new Error(`expected at least ${n + 1} paragraph(s)`);
  const anchor = buildParagraphMoveAnchor(doc, info);
  if (!anchor) throw new Error("expected buildParagraphMoveAnchor to succeed");
  return anchor;
}

function targetAnchorAtLine(text: string, lineIndex: number): SiblingTargetAnchor {
  const doc = parseDocument(text);
  const scan = scanComplexBlocks(doc);
  const info = scan.blocks.find(
    (b) => b.range.startLine <= lineIndex && lineIndex <= b.range.endLine
  );
  if (!info) throw new Error(`no complex block found at line ${lineIndex}`);
  const anchor = buildSiblingTargetAnchor(doc, info);
  if (!anchor) throw new Error("expected buildSiblingTargetAnchor to succeed");
  return anchor;
}

function move(
  text: string,
  sourceLine: number,
  targetLine: number,
  position: NonAdjacentMovePosition
) {
  const doc = parseDocument(text);
  const scan = scanComplexBlocks(doc);
  const sourceInfo = scan.blocks.find(
    (b) => b.kind === "paragraph" && b.range.startLine <= sourceLine && sourceLine <= b.range.endLine
  );
  if (!sourceInfo) throw new Error(`no paragraph at line ${sourceLine}`);
  const sourceAnchor = buildParagraphMoveAnchor(doc, sourceInfo);
  if (!sourceAnchor) throw new Error("buildParagraphMoveAnchor failed");
  const targetAnchor = targetAnchorAtLine(text, targetLine);
  return moveParagraphNonAdjacent(text, sourceAnchor, targetAnchor, position);
}

describe("moveParagraphNonAdjacent: success cases", () => {
  it("moves a paragraph to the TOP of its sibling group (before the first sibling), single edit", () => {
    const text = ["# H", "A", "", "B", "", "C", "", "D"].join("\n");
    // Move "D" (line 7) to before "A" (line 1). Trailing "" is the leftover
    // gap that used to separate "C" from "D" — D was the document's last
    // paragraph, so the gap is now stranded at the end (see the callout
    // fixture below for the same "no source-side cleanup" note in detail).
    const outcome = move(text, 7, 1, "before");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines.join("\n")).toBe(
      ["# H", "D", "", "A", "", "B", "", "C", ""].join("\n")
    );
  });

  it("moves a paragraph to the BOTTOM of its sibling group (after the last sibling), single edit", () => {
    const text = ["# H", "A", "", "B", "", "C", "", "D"].join("\n");
    // Move "A" (line 1) to after "D" (line 7). Leading "" right after "# H"
    // is the leftover gap that used to separate "A" from "B" — A was the
    // document's first paragraph, so the gap is now stranded right after
    // the heading.
    const outcome = move(text, 1, 7, "after");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines.join("\n")).toBe(
      ["# H", "", "B", "", "C", "", "D", "", "A"].join("\n")
    );
  });

  it("moves a paragraph to BEFORE a specific (non-adjacent) sibling, in one edit — not a sequence of adjacent swaps", () => {
    const text = ["# H", "A", "", "B", "", "C", "", "D"].join("\n");
    // Move "D" to before "B" — 2 hops away, single cut-and-reinsert.
    // Trailing "" is D's leftover source-side gap (D was the last
    // paragraph) — same note as the TOP test above.
    const outcome = move(text, 7, 3, "before");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines.join("\n")).toBe(
      ["# H", "A", "", "D", "", "B", "", "C", ""].join("\n")
    );
  });

  it("moves a paragraph to AFTER a specific (non-adjacent) sibling, in one edit", () => {
    const text = ["# H", "A", "", "B", "", "C", "", "D"].join("\n");
    // Move "A" to after "C". Leading "" right after "# H" is A's leftover
    // source-side gap (A was the first paragraph) — same note as the
    // BOTTOM test above.
    const outcome = move(text, 1, 5, "after");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines.join("\n")).toBe(
      ["# H", "", "B", "", "C", "", "A", "", "D"].join("\n")
    );
  });

  it("moves a paragraph to before a standalone callout sibling, inserting a separating blank line since none existed", () => {
    const text = ["# H", "A", "", "> [!note] N", "> body", "", "B"].join("\n");
    // Move "B" (line 6) to before the callout (starts at line 3).
    const doc = parseDocument(text);
    const scan = scanComplexBlocks(doc);
    const sourceInfo = scan.blocks.find((b) => b.kind === "paragraph" && b.range.startLine === 6)!;
    const sourceAnchor = buildParagraphMoveAnchor(doc, sourceInfo)!;
    const targetAnchor = targetAnchorAtLine(text, 3);
    const outcome = moveParagraphNonAdjacent(text, sourceAnchor, targetAnchor, "before");
    expect(outcome.changed).toBe(true);
    // "B" must be separated from the callout's own quote-prefixed line by a
    // blank line, or scanParagraphBlocks would sweep them into one
    // ambiguous candidate on reparse (see this module's own doc comment).
    // The trailing "" element is the pre-existing gap that used to
    // separate the callout from B, left in place at the (now) end of the
    // document — the same "no blank-line cleanup on the source side"
    // precedent edit/deleteBlock.ts/deleteCompositeBlock.ts already
    // establish, not a bug.
    expect(outcome.lines.join("\n")).toBe(
      ["# H", "A", "", "B", "", "> [!note] N", "> body", ""].join("\n")
    );
  });

  it("moves a paragraph to after a standalone blockquote sibling, inserting a separating blank line", () => {
    const text = ["# H", "> quoted line", "", "A", "", "B"].join("\n");
    // Move "B" (line 5) to after the blockquote (line 1).
    const doc = parseDocument(text);
    const scan = scanComplexBlocks(doc);
    const sourceInfo = scan.blocks.find((b) => b.kind === "paragraph" && b.range.startLine === 5)!;
    const sourceAnchor = buildParagraphMoveAnchor(doc, sourceInfo)!;
    const targetAnchor = targetAnchorAtLine(text, 1);
    const outcome = moveParagraphNonAdjacent(text, sourceAnchor, targetAnchor, "after");
    expect(outcome.changed).toBe(true);
    // Trailing "" is the leftover gap that used to separate "A" from "B" —
    // see the callout test above's identical note.
    expect(outcome.lines.join("\n")).toBe(
      ["# H", "> quoted line", "", "B", "", "A", ""].join("\n")
    );
    // Re-parsing the result must still recognize the blockquote AND the
    // moved paragraph as two separate, "supported" blocks — not one
    // ambiguous merged range.
    const reparsed = parseDocument(outcome.lines.join("\n"));
    const reScan = scanComplexBlocks(reparsed);
    const blockquote = reScan.blocks.find((b) => b.kind === "blockquote");
    const movedParagraph = reScan.blocks.find(
      (b) => b.kind === "paragraph" && reparsed.lines[b.range.startLine] === "B"
    );
    expect(blockquote?.editability).toBe("supported");
    expect(movedParagraph?.editability).toBe("supported");
  });

  it("does NOT insert an unnecessary blank line when one already separates the moved block from its new neighbor", () => {
    const text = ["# H", "A", "", "B", "", "C"].join("\n");
    const outcome = move(text, 5, 1, "before"); // "C" to before "A" — already blank-separated
    expect(outcome.changed).toBe(true);
    // Trailing "" is the leftover gap that used to separate "B" from "C" —
    // see the earlier callout test's identical note. The assertion this
    // test actually cares about is that no ADDITIONAL blank line was
    // inserted between "# H"/"C" or "C"/"A" beyond what already existed.
    expect(outcome.lines.join("\n")).toBe(["# H", "C", "", "A", "", "B", ""].join("\n"));
  });

  it("is a single edit (one final lines[] from one call) — matches the '1操作=1編集=1Undo' contract when fed through applyLineEditOutcome's single replaceRange", () => {
    const text = ["# H", "A", "", "B", "", "C", "", "D"].join("\n");
    const outcome = move(text, 7, 1, "before");
    expect(outcome.changed).toBe(true);
    expect(typeof outcome.newStartLine).toBe("number");
    expect(outcome.newStartLine).toBeGreaterThanOrEqual(0);
  });
});

describe("moveParagraphNonAdjacent: no-op / rejection cases", () => {
  it("self-target: target resolves to the same range as the (re-resolved) source", () => {
    const text = ["# H", "A", "", "B"].join("\n");
    const doc = parseDocument(text);
    const scan = scanComplexBlocks(doc);
    const info = scan.blocks.find((b) => b.kind === "paragraph" && b.range.startLine === 1)!;
    const sourceAnchor = buildParagraphMoveAnchor(doc, info)!;
    const targetAnchor = buildSiblingTargetAnchor(doc, info)!; // same block as source
    const outcome = moveParagraphNonAdjacent(text, sourceAnchor, targetAnchor, "before");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("self-target");
    expect(outcome.lines.join("\n")).toBe(text);
  });

  it("[SUPERSEDED 2026-09-24, feat/paragraph-dnd-cross-section — see the 'cross-section' describe block below for the current behavior] a target under a different section used to be rejected as parent-mismatch; it is now an ALLOWED cross-section move", () => {
    const text = ["# H1", "A", "", "# H2", "B"].join("\n");
    const doc = parseDocument(text);
    const scan = scanComplexBlocks(doc);
    const sourceInfo = scan.blocks.find((b) => b.kind === "paragraph" && b.range.startLine === 1)!;
    const targetInfo = scan.blocks.find((b) => b.kind === "paragraph" && b.range.startLine === 4)!;
    const sourceAnchor = buildParagraphMoveAnchor(doc, sourceInfo)!;
    const targetAnchor = buildSiblingTargetAnchor(doc, targetInfo)!;
    const outcome = moveParagraphNonAdjacent(text, sourceAnchor, targetAnchor, "before");
    expect(outcome.changed).toBe(true);
    expect(outcome.reason).toBeUndefined();
  });

  it("depth-mismatch is unreachable given equal parentId (defense-in-depth only, same precedent as findComplexSiblingTarget's own recheck — see tests/resolveMoveTarget.test.ts's identically-named invariant test): complexBlockDepth is a pure function of parentId, so two blocks sharing a parentId in the SAME doc always share a depth", () => {
    const text = ["# H", "A", "", "B", "", "C"].join("\n");
    const doc = parseDocument(text);
    const scan = scanComplexBlocks(doc);
    const a = scan.blocks.find((b) => b.kind === "paragraph" && b.range.startLine === 1)!;
    const b = scan.blocks.find((b) => b.kind === "paragraph" && b.range.startLine === 3)!;
    expect(a.parentId).toBe(b.parentId);
    expect(complexBlockDepth(doc, a.parentId)).toBe(complexBlockDepth(doc, b.parentId));
  });

  it("range-overlap: a stale target anchor whose captured range now overlaps the freshly re-resolved source is rejected rather than trusting insertBlockAt's own silent clamp", () => {
    const text = ["# H", "AB", "", "C"].join("\n");
    const doc = parseDocument(text);
    const scan = scanComplexBlocks(doc);
    const sourceInfo = scan.blocks.find((b) => b.kind === "paragraph" && b.range.startLine === 1)!;
    const sourceAnchor = buildParagraphMoveAnchor(doc, sourceInfo)!;
    // Hand-crafted stale target anchor: claims the SAME range as source but
    // with different captured text, simulating "this used to be a genuinely
    // different, now-vanished block whose range now overlaps the source" —
    // content-changed would normally catch this at re-resolution, but this
    // test exercises the overlap guard directly by constructing a target
    // anchor whose content STILL matches (so target-side re-resolution
    // succeeds) yet whose range is the source's own range.
    const targetAnchor: SiblingTargetAnchor = {
      kind: "paragraph",
      complexBlockId: sourceInfo.id,
      parentId: sourceInfo.parentId,
      depth: complexBlockDepth(doc, sourceInfo.parentId),
      originalText: "AB",
      rangeStart: 1,
      rangeEnd: 1,
    };
    const outcome = moveParagraphNonAdjacent(text, sourceAnchor, targetAnchor, "before");
    expect(outcome.changed).toBe(false);
    // Same range + same content resolves as self-target before the overlap
    // check is ever reached — confirms the self-target guard already
    // subsumes the exact-same-range case; a genuinely PARTIAL overlap
    // cannot occur here because ComplexBlockInfo ranges from one scan are
    // never partially overlapping by construction (mergeBlockRangesSafely
    // either fully contains or excludes). Documented here rather than
    // silently omitted.
    expect(["self-target", "range-overlap"]).toContain(outcome.reason);
  });

  it("source resolve-failed: no eligible paragraph in the current text has the source anchor's own scan-local id at all (not merely different content at that id — see 'content-changed' below for that case)", () => {
    // scanParagraphBlocks assigns "paragraph-N" ids densely (0..count-1) in
    // document order, so an id can only fail to exist at all when the
    // document's total paragraph count shrinks below the anchor's own
    // ordinal — never merely from different text at the same ordinal
    // (that is "content-changed", tested separately below).
    const original = ["# H", "A", "", "B"].join("\n");
    const sourceAnchor = sourceAnchorForNth(original, 1); // "B" -> id "paragraph-1"
    const targetAnchor = targetAnchorAtLine(original, 1); // "A"
    const changedText = ["# H", "A"].join("\n"); // "B" is gone entirely -> only "paragraph-0" exists now
    const outcome = moveParagraphNonAdjacent(changedText, sourceAnchor, targetAnchor, "before");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("resolve-failed");
  });

  it("source content-changed: the id-matched paragraph still exists structurally, but its text differs from the anchor's captured originalText", () => {
    const original = ["# H", "A", "", "B"].join("\n");
    const sourceAnchor = sourceAnchorForNth(original, 0); // "A"
    const targetAnchor = targetAnchorAtLine(original, 3); // "B"
    const changedText = ["# H", "Different now.", "", "B"].join("\n");
    const outcome = moveParagraphNonAdjacent(changedText, sourceAnchor, targetAnchor, "before");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("content-changed");
  });

  it("target-resolve-failed: no eligible target in the current text has the target anchor's own scan-local id at all", () => {
    const original = ["# H", "A", "", "B"].join("\n");
    const sourceAnchor = sourceAnchorForNth(original, 0); // "A" -> id "paragraph-0"
    const targetAnchor = targetAnchorAtLine(original, 3); // "B" -> id "paragraph-1"
    const changedText = ["# H", "A"].join("\n"); // "B" is gone entirely -> only "paragraph-0" exists now
    const outcome = moveParagraphNonAdjacent(changedText, sourceAnchor, targetAnchor, "before");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("target-resolve-failed");
  });

  it("target-content-changed: the id-matched target still exists structurally, but its text differs from the anchor's captured originalText", () => {
    const original = ["# H", "A", "", "B"].join("\n");
    const sourceAnchor = sourceAnchorForNth(original, 0); // "A"
    const targetAnchor = targetAnchorAtLine(original, 3); // "B"
    const changedText = ["# H", "A", "", "Different now."].join("\n");
    const outcome = moveParagraphNonAdjacent(changedText, sourceAnchor, targetAnchor, "before");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("target-content-changed");
  });

  it("target-ambiguous-match: two siblings share identical parentId/depth/content as the captured target anchor", () => {
    const original = ["# H", "A", "", "SAME", "", "B"].join("\n");
    const sourceAnchor = sourceAnchorForNth(original, 0); // "A"
    const targetAnchor = targetAnchorAtLine(original, 3); // "SAME"
    // Now a second "SAME" paragraph appears under the same section.
    const changedText = ["# H", "A", "", "SAME", "", "SAME", "", "B"].join("\n");
    const outcome = moveParagraphNonAdjacent(changedText, sourceAnchor, targetAnchor, "before");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("target-ambiguous-match");
  });
});

describe("moveParagraphNonAdjacent: does not add unnecessary blank lines", () => {
  it("moving between two already-blank-separated blocks introduces no extra blank lines beyond what already existed", () => {
    const text = ["# H", "A", "", "B", "", "C", "", "D"].join("\n");
    const outcome = move(text, 7, 3, "before"); // "D" before "B"
    const blankRuns = outcome.lines.join("\n").match(/\n\n\n/g);
    expect(blankRuns).toBeNull();
  });
});

describe("regression: existing adjacent-move contracts (5T-1/5T-2/5T-2S) are untouched by this new module", () => {
  it("moveParagraphFromAnchor (5T-1 adjacent swap) still works byte-identically for a simple up/down swap", () => {
    const text = ["# H", "A", "", "B"].join("\n");
    const anchor = sourceAnchorForNth(text, 0);
    const outcome = moveParagraphFromAnchor(text, anchor, "down");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines.join("\n")).toBe(["# H", "B", "", "A"].join("\n"));
  });
});

/**
 * feat/paragraph-dnd-cross-section (2026-09-24): moveParagraphNonAdjacent
 * no longer rejects a target under a DIFFERENT section as
 * "parent-mismatch" — see this module's own top doc comment addendum.
 * These tests cover the ticket's own §"テスト追加" list items 1–5.
 */
describe("moveParagraphNonAdjacent: cross-section (feat/paragraph-dnd-cross-section)", () => {
  it("drops a paragraph BEFORE a paragraph in a DIFFERENT section — reparents naturally, blank-line policy preserved", () => {
    const text = ["# H1", "A", "", "# H2", "B"].join("\n");
    const outcome = move(text, 1, 4, "before"); // "A" (under H1) -> before "B" (under H2)
    expect(outcome.changed).toBe(true);
    expect(outcome.reason).toBeUndefined();

    const reparsed = parseDocument(outcome.lines.join("\n"));
    const reScan = scanComplexBlocks(reparsed);
    const movedA = reScan.blocks.find(
      (b) => b.kind === "paragraph" && reparsed.lines[b.range.startLine] === "A"
    )!;
    const h2 = [...reparsed.nodes.values()].find(
      (n) => n.type === "section" && reparsed.lines[n.range.startLine] === "# H2"
    )!;
    // "A" naturally re-resolves to H2's own section as its parentId — no
    // parentId is ever written or read back out of moveParagraphNonAdjacent
    // itself (see this module's own top doc comment addendum).
    expect(movedA.parentId).toBe(h2.id);
    expect(movedA.editability).toBe("supported");
    // "B" must still be independently recognized right after "A" — the
    // blank-line safety net must have kept them from merging into one
    // ambiguous candidate range on reparse.
    const movedB = reScan.blocks.find(
      (b) => b.kind === "paragraph" && reparsed.lines[b.range.startLine] === "B"
    )!;
    expect(movedB.editability).toBe("supported");
  });

  it("drops a paragraph at the END of a DIFFERENT section (after its last block)", () => {
    const text = ["# H1", "A", "", "# H2", "B", "", "C"].join("\n");
    const outcome = move(text, 1, 6, "after"); // "A" (under H1) -> after "C" (under H2, its last block)
    expect(outcome.changed).toBe(true);
    expect(outcome.reason).toBeUndefined();

    const reparsed = parseDocument(outcome.lines.join("\n"));
    const reScan = scanComplexBlocks(reparsed);
    const movedA = reScan.blocks.find(
      (b) => b.kind === "paragraph" && reparsed.lines[b.range.startLine] === "A"
    )!;
    expect(movedA.editability).toBe("supported");
    // "A" must land AFTER "C" in document order.
    const c = reScan.blocks.find((b) => b.kind === "paragraph" && reparsed.lines[b.range.startLine] === "C")!;
    expect(movedA.range.startLine).toBeGreaterThan(c.range.endLine);
  });

  it("drops a paragraph at the START of a DIFFERENT section (right under its heading)", () => {
    const text = ["# H1", "A", "", "# H2", "B"].join("\n");
    const outcome = move(text, 1, 4, "before"); // same as the first test above — B is H2's own first block
    expect(outcome.changed).toBe(true);
    const reparsed = parseDocument(outcome.lines.join("\n"));
    const reScan = scanComplexBlocks(reparsed);
    const h2Index = outcome.lines.findIndex((l) => l === "# H2");
    const movedA = reScan.blocks.find(
      (b) => b.kind === "paragraph" && reparsed.lines[b.range.startLine] === "A"
    )!;
    // "A" is the first non-heading block under H2 — no target heading row
    // is ever needed (inserting relative to H2's own first block, "B",
    // suffices) — see the design memo's own "見出し行のドロップターゲット
    // 扱い" decision.
    expect(movedA.range.startLine).toBeGreaterThan(h2Index);
  });

  it("rejects a cross-section drop that would land STRICTLY INSIDE a destination CompositeBlock's own aggregate range (composite-internal-boundary)", () => {
    // "- ![[scan.png]]" + the [!ocr] callout right after it forms one
    // image-ocr CompositeBlock (DEFAULT_COMPOSITE_BLOCK_RULES) spanning
    // both lines. Dropping "before" the callout member lands strictly
    // inside that composite's own aggregate range.
    const text = ["# H1", "A", "", "# H2", "- ![[scan.png]]", "> [!ocr]", "> body text"].join("\n");
    const doc = parseDocument(text);
    const scan = scanComplexBlocks(doc);
    const sourceInfo = scan.blocks.find((b) => b.kind === "paragraph" && b.range.startLine === 1)!;
    const sourceAnchor = buildParagraphMoveAnchor(doc, sourceInfo)!;
    const calloutInfo = scan.blocks.find((b) => b.kind === "callout")!;
    const targetAnchor = buildSiblingTargetAnchor(doc, calloutInfo)!;

    const outcome = moveParagraphNonAdjacent(
      text,
      sourceAnchor,
      targetAnchor,
      "before",
      DEFAULT_COMPOSITE_BLOCK_RULES
    );
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("composite-internal-boundary");
    expect(outcome.lines.join("\n")).toBe(text);
  });

  it("omitting `rules` (the default `[]`) keeps prior behavior — the SAME drop that composite-internal-boundary rejects above is allowed when no rule set is passed", () => {
    const text = ["# H1", "A", "", "# H2", "- ![[scan.png]]", "> [!ocr]", "> body text"].join("\n");
    const doc = parseDocument(text);
    const scan = scanComplexBlocks(doc);
    const sourceInfo = scan.blocks.find((b) => b.kind === "paragraph" && b.range.startLine === 1)!;
    const sourceAnchor = buildParagraphMoveAnchor(doc, sourceInfo)!;
    const calloutInfo = scan.blocks.find((b) => b.kind === "callout")!;
    const targetAnchor = buildSiblingTargetAnchor(doc, calloutInfo)!;

    const outcome = moveParagraphNonAdjacent(text, sourceAnchor, targetAnchor, "before");
    expect(outcome.changed).toBe(true);
  });

  it("is a single edit for a cross-section drop too (one final lines[] from one call) — matches the '1操作=1編集=1Undo' contract when fed through applyLineEditOutcome's single replaceRange", () => {
    const text = ["# H1", "A", "", "# H2", "B"].join("\n");
    const outcome = move(text, 1, 4, "before");
    expect(outcome.changed).toBe(true);
    expect(typeof outcome.newStartLine).toBe("number");
    expect(outcome.newStartLine).toBeGreaterThanOrEqual(0);
  });
});

describe("listNonAdjacentMoveTargets", () => {
  it("lists every eligible sibling (paragraph/callout/blockquote, same parentId/depth) in document order, excluding the source itself", () => {
    const text = ["# H", "A", "", "> [!note] N", "> body", "", "B", "", "> quote"].join("\n");
    const doc = parseDocument(text);
    const scan = scanComplexBlocks(doc);
    const sourceInfo = scan.blocks.find((b) => b.kind === "paragraph" && b.range.startLine === 1)!;
    const depth = complexBlockDepth(doc, sourceInfo.parentId);
    const list = listNonAdjacentMoveTargets(scan, sourceInfo.range, sourceInfo.parentId, depth, doc);
    expect(list.map((b) => b.kind)).toEqual(["callout", "paragraph", "blockquote"]);
    expect(list.some((b) => b.range.startLine === sourceInfo.range.startLine)).toBe(false);
  });

  it("excludes a fenced-code/table sibling from the eligible list (out of this phase's target scope)", () => {
    const text = ["# H", "A", "", "```", "code", "```", "", "B"].join("\n");
    const doc = parseDocument(text);
    const scan = scanComplexBlocks(doc);
    const sourceInfo = scan.blocks.find((b) => b.kind === "paragraph" && b.range.startLine === 1)!;
    const depth = complexBlockDepth(doc, sourceInfo.parentId);
    const list = listNonAdjacentMoveTargets(scan, sourceInfo.range, sourceInfo.parentId, depth, doc);
    expect(list.some((b) => b.kind === "fenced-code")).toBe(false);
  });
});

describe("paragraphNonAdjacentMoveReasonText", () => {
  it("translates every NonAdjacentMoveReason to a non-empty string in both locales", () => {
    const reasons = [
      "resolve-failed",
      "identity-changed",
      "content-changed",
      "ambiguous-match",
      "target-resolve-failed",
      "target-identity-changed",
      "target-content-changed",
      "target-ambiguous-match",
      "self-target",
      "parent-mismatch",
      "depth-mismatch",
      "range-overlap",
    ] as const;
    for (const locale of ["en", "ja"] as const) {
      const t = createTranslator(locale);
      for (const reason of reasons) {
        const text = paragraphNonAdjacentMoveReasonText(t, reason);
        expect(text).toBeTruthy();
      }
    }
  });

  it("returns undefined for an undefined reason", () => {
    const t = createTranslator("en");
    expect(paragraphNonAdjacentMoveReasonText(t, undefined)).toBeUndefined();
  });
});
