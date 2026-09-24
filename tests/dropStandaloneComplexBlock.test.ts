/**
 * Phase 5D-3C ("Callout and Blockquote Drag and Drop", 案A approved):
 * unit tests for the pure EXECUTOR — edit/dropStandaloneComplexBlock.ts.
 *
 * Mirrors tests/moveStandaloneComplexBlock.test.ts's own scope/structure:
 * given the CURRENT Markdown text plus a source snapshot and a target
 * hint (both possibly captured at an earlier, now-stale moment), re-parse/
 * re-scan/re-match/re-resolve and perform (or safely no-op) the drop via
 * move/moveBlock.ts's existing insertBlockAt primitive.
 *
 * tests/findStandaloneComplexBlockDropTarget.test.ts already covers the
 * resolver's own decision logic (self-drop / composite-internal-boundary /
 * source shape eligibility / cross-section allowance) against an
 * already-resolved (source, target, zone) triple. This file does NOT
 * re-duplicate that matrix — it instead focuses on the executor's own
 * concerns: re-resolution against fresh text, snapshot/target staleness,
 * and the actual insertBlockAt output (byte-exact `lines`).
 *
 * [2026-09-24 追記, feat/standalone-complex-dnd-cross-section] This file
 * used to also assert a "not-same-section: rejects a drop whose source
 * and target sit under different headings" case here — that behavior was
 * retired (see model/complexBlock.ts's own dated addendum on the
 * "not-same-section" reason value, and
 * move/findStandaloneComplexBlockDropTarget.ts's own top doc comment
 * addendum). Its replacement, executor-level cross-section coverage lives
 * in the "dropStandaloneComplexBlock: cross-section drops" describe block
 * below, which also asserts this executor's own `ensureBlankSeparation`
 * post-step fires only for a cross-section drop.
 *
 * [2026-09-25 追記, fix/standalone-dnd-blank-separation-always] The
 * sentence directly above ("fires only for a cross-section drop") is now
 * WRONG — a real-device (iPad) report showed that a SAME-section drop
 * could just as easily land a standalone block directly against
 * unrelated content with no blank line between them, silently merging
 * the two on re-parse (see src/edit/dropStandaloneComplexBlock.ts's own
 * top doc comment, dated addendum, for the full root-cause writeup).
 * `ensureBlankSeparation` is now applied unconditionally, on EVERY drop.
 * The fixtures below that used to assert a same-section drop produces
 * NO inserted blank line have been corrected to assert the blank line
 * IS now inserted where the drop position was genuinely unseparated —
 * see "dropStandaloneComplexBlock: successful standalone drops" and
 * the 案A composite-member describe block below. A new
 * "dropStandaloneComplexBlock: blank-line separation applies regardless
 * of section (regression test, 2026-09-25)" describe block below adds
 * direct coverage of this fix, including the exact callout-before-
 * paragraph shape from the original iPad report, and confirms
 * `ensureBlankSeparation`'s own no-op behavior (no extra blank line) is
 * preserved when the destination is already separated.
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { scanComplexBlocks } from "../src/parser/complexBlocks";
import { matchCompositeBlocks } from "../src/parser/compositeBlocks";
import { CompositeBlockRule, DEFAULT_COMPOSITE_BLOCK_RULES } from "../src/model/compositeBlock";
import { ComplexBlockInfo, ComplexBlockScanResult } from "../src/model/complexBlock";
import {
  buildStandaloneComplexBlockSnapshot,
  StandaloneComplexBlockSnapshot,
} from "../src/edit/moveStandaloneComplexBlock";
import { dropStandaloneComplexBlock } from "../src/edit/dropStandaloneComplexBlock";
import { StandaloneComplexBlockDropTargetHint } from "../src/move/findStandaloneComplexBlockDropTarget";

function pipeline(text: string, rules: CompositeBlockRule[] = DEFAULT_COMPOSITE_BLOCK_RULES) {
  const doc = parseDocument(text);
  const complexScan = scanComplexBlocks(doc);
  const composites = matchCompositeBlocks(doc, complexScan, rules);
  return { doc, complexScan, composites };
}

function blockOf(complexScan: ComplexBlockScanResult, needle: string, doc: ReturnType<typeof parseDocument>): ComplexBlockInfo {
  const found = complexScan.blocks.find((b) => doc.lines[b.range.startLine].includes(needle));
  if (!found) throw new Error(`no block matching "${needle}"`);
  return found;
}

function listNodeOf(doc: ReturnType<typeof parseDocument>, needle: string) {
  for (const node of doc.nodes.values()) {
    if (node.type === "list" && doc.lines[node.range.startLine].includes(needle)) return node;
  }
  throw new Error(`no list node matching "${needle}"`);
}

function targetHintOf(range: { startLine: number; endLine: number }, parentId: string | null): StandaloneComplexBlockDropTargetHint {
  return { range: { startLine: range.startLine, endLine: range.endLine }, parentId };
}

describe("dropStandaloneComplexBlock: successful standalone drops", () => {
  it("drops a standalone callout AFTER a genuine standalone sibling in the same section, inserting blank-line separation from the following block (2026-09-25: ensureBlankSeparation now applies unconditionally, not just cross-section)", () => {
    const text = ["# H", "> [!note] one", "> body a", "", "> [!tip] two", "> body b"].join("\n");
    const { doc, complexScan } = pipeline(text);
    const one = blockOf(complexScan, "one", doc);
    const two = blockOf(complexScan, "two", doc);
    const snapshot = buildStandaloneComplexBlockSnapshot(one)!;

    const outcome = dropStandaloneComplexBlock(
      text,
      { snapshot, target: targetHintOf(two.range, two.parentId), zone: "after" },
      DEFAULT_COMPOSITE_BLOCK_RULES
    );

    // Before insertBlockAt's own raw output would have left "> body b"
    // (the end of "two") directly adjacent to "> [!note] one" (the moved
    // block) with no blank line between them -- two blockquote-shaped
    // blocks back to back would merge into one on re-parse. This is
    // exactly the "結合" (merge) bug reported on iPad, just with the moved
    // block as the ATTACKER instead of the victim. ensureBlankSeparation now
    // inserts the missing blank line.
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "# H",
      "",
      "> [!tip] two",
      "> body b",
      "",
      "> [!note] one",
      "> body a",
    ]);
    expect(outcome.lines[outcome.newStartLine]).toBe("> [!note] one");
  });

  it("drops a standalone blockquote BEFORE a genuine standalone sibling in the same section, inserting blank-line separation before the following block (2026-09-25: ensureBlankSeparation now applies unconditionally, not just cross-section)", () => {
    const text = ["# H", "> quote one", "", "> quote two"].join("\n");
    const { doc, complexScan } = pipeline(text);
    const one = blockOf(complexScan, "quote one", doc);
    const two = blockOf(complexScan, "quote two", doc);
    const snapshot = buildStandaloneComplexBlockSnapshot(two)!;

    const outcome = dropStandaloneComplexBlock(
      text,
      { snapshot, target: targetHintOf(one.range, one.parentId), zone: "before" },
      DEFAULT_COMPOSITE_BLOCK_RULES
    );

    // Raw insertBlockAt output would have left "> quote two" (the moved
    // block) directly adjacent to "> quote one" with no blank line --
    // ensureBlankSeparation now inserts one after the moved block, since
    // its own start neighbor ("# H", a heading) already needs none.
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["# H", "> quote two", "", "> quote one", ""]);
    expect(outcome.lines[outcome.newStartLine]).toBe("> quote two");
  });
});

describe("dropStandaloneComplexBlock: 案A — CompositeBlock-member drop tolerates the source's own matching dissolution", () => {
  it("drops a composite's own callout member cleanly away from its anchor: Markdown holds the user's move, no coincidental recomposition, Tree reprojects to individual display, and gets blank-line separation from the following paragraph (2026-09-25: ensureBlankSeparation now applies unconditionally -- this is the exact shape of the reported iPad merge bug, a callout dropped directly above a paragraph)", () => {
    const text = [
      "- ![[scan.png]]",
      "> [!ocr]",
      "> body",
      "",
      "Middle paragraph.",
      "",
      "> [!tip] standalone",
    ].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    expect(composites).toHaveLength(1);
    const member = complexScan.blocks.find((b) => b.id === composites[0].members[1].id)!;
    const middleParagraph = blockOf(complexScan, "Middle paragraph.", doc);
    const snapshot = buildStandaloneComplexBlockSnapshot(member)!;

    const outcome = dropStandaloneComplexBlock(
      text,
      { snapshot, target: targetHintOf(middleParagraph.range, middleParagraph.parentId), zone: "before" },
      DEFAULT_COMPOSITE_BLOCK_RULES
    );

    // Without ensureBlankSeparation, "> body" would sit directly above
    // "Middle paragraph." with no blank line -- exactly the merge shape
    // from the iPad bug report (a paragraph swallowed into a callout's
    // own body on re-parse). ensureBlankSeparation now inserts the
    // missing blank line.
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "- ![[scan.png]]",
      "",
      "> [!ocr]",
      "> body",
      "",
      "Middle paragraph.",
      "",
      "> [!tip] standalone",
    ]);

    // The anchor list item no longer sits directly above any callout (a
    // blank line now separates them) -- matching cleanly dissolved, and no
    // OTHER composite coincidentally formed. This is the "individual node
    // display" reprojection the ticket describes, verified by re-running
    // the pipeline against the drop's own output.
    const { composites: reprojected } = pipeline(outcome.lines.join("\n"));
    expect(reprojected).toHaveLength(0);
  });

  it("tolerates a coincidental NEW composite forming as a side effect of the drop (not a regression -- Phase 5D-3B precedent): the moved member itself is tracked by content", () => {
    const text = [
      "- ![[scan.png]]",
      "> [!ocr]",
      "> body",
      "",
      "- other item",
      "",
      "> [!tip] standalone",
    ].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    expect(composites).toHaveLength(1);
    const member = complexScan.blocks.find((b) => b.id === composites[0].members[1].id)!;
    const otherItem = listNodeOf(doc, "other item");
    const snapshot = buildStandaloneComplexBlockSnapshot(member)!;

    const outcome = dropStandaloneComplexBlock(
      text,
      { snapshot, target: targetHintOf(otherItem.range, otherItem.parentId), zone: "after" },
      DEFAULT_COMPOSITE_BLOCK_RULES
    );

    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "- ![[scan.png]]",
      "",
      "- other item",
      "> [!ocr]",
      "> body",
      "",
      "> [!tip] standalone",
    ]);

    // The original anchor's own match dissolved (blank line now follows
    // it), AND a brand-new composite coincidentally formed between
    // "other item" and the relocated "[!ocr]" member purely because the
    // drop landed them adjacent with no blank line -- exactly the
    // "coincidental new composite forming is expected, not a regression"
    // precedent from Phase 5D-3B. This is tolerated, not prevented.
    const { composites: reprojected } = pipeline(outcome.lines.join("\n"));
    expect(reprojected).toHaveLength(1);
    expect(doc.lines).toBeDefined(); // sanity: doc from BEFORE the drop is untouched
    const newDoc = parseDocument(outcome.lines.join("\n"));
    expect(newDoc.lines[reprojected[0].members[0].range.startLine]).toContain("other item");
    expect(newDoc.lines[reprojected[0].members[1].range.startLine]).toContain("[!ocr]");
  });
});

describe("dropStandaloneComplexBlock: rejections leave text byte-identical", () => {
  it("composite-internal-boundary: rejects an UNRELATED standalone block dropped between a third party's anchor and its member", () => {
    const text = ["- ![[scan.png]]", "> [!ocr]", "> body", "", "> [!tip] standalone"].join("\n");
    const { doc, complexScan } = pipeline(text);
    const standalone = blockOf(complexScan, "standalone", doc);
    const anchor = listNodeOf(doc, "scan.png");
    const snapshot = buildStandaloneComplexBlockSnapshot(standalone)!;

    const outcome = dropStandaloneComplexBlock(
      text,
      { snapshot, target: targetHintOf(anchor.range, anchor.parentId), zone: "after" },
      DEFAULT_COMPOSITE_BLOCK_RULES
    );

    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("composite-internal-boundary");
    expect(outcome.lines).toEqual(text.split("\n"));
  });

  it("self-drop: rejects dropping a block relative to its own current position", () => {
    const text = ["# H", "> [!note] one", "> body a", "", "> [!tip] two", "> body b"].join("\n");
    const { doc, complexScan } = pipeline(text);
    const one = blockOf(complexScan, "one", doc);
    const snapshot = buildStandaloneComplexBlockSnapshot(one)!;

    const outcome = dropStandaloneComplexBlock(
      text,
      { snapshot, target: targetHintOf(one.range, one.parentId), zone: "before" },
      DEFAULT_COMPOSITE_BLOCK_RULES
    );

    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("self-drop");
    expect(outcome.lines).toEqual(text.split("\n"));
  });

  it("source-boundary-changed: no-ops when the snapshot no longer matches anything in the current text (source shifted lines via an unrelated edit)", () => {
    const originalText = ["# H", "> [!note] one", "> body", "", "> [!tip] two", "> body b"].join("\n");
    const { doc, complexScan } = pipeline(originalText);
    const one = blockOf(complexScan, "one", doc);
    const two = blockOf(complexScan, "two", doc);
    const snapshot = buildStandaloneComplexBlockSnapshot(one)!;
    const target = targetHintOf(two.range, two.parentId);

    // An unrelated line inserted above shifts "one" down by one line, so
    // the snapshot's own range no longer matches its current position.
    const laterText = ["# H", "extra inserted line", "> [!note] one", "> body", "", "> [!tip] two", "> body b"].join(
      "\n"
    );

    const outcome = dropStandaloneComplexBlock(laterText, { snapshot, target, zone: "after" }, DEFAULT_COMPOSITE_BLOCK_RULES);

    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("source-boundary-changed");
    expect(outcome.lines).toEqual(laterText.split("\n"));
  });

  it("target-boundary-changed: no-ops when the target hint's range no longer matches anything in the current text (target shifted lines via an unrelated edit)", () => {
    const originalText = ["# H", "> [!note] one", "> body", "", "> [!tip] two", "> body b"].join("\n");
    const { doc: origDoc, complexScan: origScan } = pipeline(originalText);
    const origTwo = blockOf(origScan, "two", origDoc);
    const staleTarget = targetHintOf(origTwo.range, origTwo.parentId);

    // An unrelated block inserted between "one" and "two" leaves "one"'s
    // own position untouched (so a FRESH source snapshot built against the
    // later text is valid) but shifts "two" down -- the stale target hint,
    // captured before this edit, no longer matches anything.
    const laterText = [
      "# H",
      "> [!note] one",
      "> body",
      "",
      "extra line",
      "",
      "> [!tip] two",
      "> body b",
    ].join("\n");
    const { doc: laterDoc, complexScan: laterScan } = pipeline(laterText);
    const laterOne = blockOf(laterScan, "one", laterDoc);
    const freshSourceSnapshot = buildStandaloneComplexBlockSnapshot(laterOne)!;

    const outcome = dropStandaloneComplexBlock(
      laterText,
      { snapshot: freshSourceSnapshot, target: staleTarget, zone: "after" },
      DEFAULT_COMPOSITE_BLOCK_RULES
    );

    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("target-boundary-changed");
    expect(outcome.lines).toEqual(laterText.split("\n"));
  });

  it("range-invalid: no-ops on a structurally invalid snapshot range (checked before any parse/target work)", () => {
    const text = ["# H", "> [!note] one", "> body"].join("\n");
    const snapshot: StandaloneComplexBlockSnapshot = {
      id: "callout-x",
      kind: "callout",
      range: { startLine: -1, endLine: 1 },
      parentId: null,
    };
    const target = targetHintOf({ startLine: 1, endLine: 2 }, null);

    const outcome = dropStandaloneComplexBlock(text, { snapshot, target, zone: "after" }, DEFAULT_COMPOSITE_BLOCK_RULES);

    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("range-invalid");
    expect(outcome.lines).toEqual(text.split("\n"));
  });
});

describe("dropStandaloneComplexBlock: cross-section drops (feat/standalone-complex-dnd-cross-section, 2026-09-24)", () => {
  it("moves a callout across a section boundary, dropped BEFORE a paragraph in the destination section, and inserts blank-line separation on both sides", () => {
    const text = [
      "# A",
      "> [!note] callout",
      "> body",
      "",
      "Untouched paragraph in A.",
      "",
      "# B",
      "Destination paragraph.",
    ].join("\n");
    const { doc, complexScan } = pipeline(text);
    const callout = blockOf(complexScan, "callout", doc);
    const destParagraph = blockOf(complexScan, "Destination paragraph.", doc);
    const snapshot = buildStandaloneComplexBlockSnapshot(callout)!;

    const outcome = dropStandaloneComplexBlock(
      text,
      { snapshot, target: targetHintOf(destParagraph.range, destParagraph.parentId), zone: "before" },
      DEFAULT_COMPOSITE_BLOCK_RULES
    );

    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "# A",
      "",
      "Untouched paragraph in A.",
      "",
      "# B",
      "> [!note] callout",
      "> body",
      "",
      "Destination paragraph.",
    ]);
    expect(outcome.lines[outcome.newStartLine]).toBe("> [!note] callout");

    // Re-parsing confirms the moved callout's own parentId is now
    // section B's — never manually rewritten by this executor, purely a
    // consequence of re-parsing the new text (per this ticket's own
    // approved design: "parentId は書き戻し後の再パースで自然に解決させ、
    // 書き戻し時に手動で parentId を書き換えない").
    const { doc: afterDoc, complexScan: afterScan } = pipeline(outcome.lines.join("\n"));
    const movedCallout = blockOf(afterScan, "callout", afterDoc);
    const sectionB = [...afterDoc.nodes.values()].find(
      (n) => n.type === "section" && afterDoc.lines[n.range.startLine] === "# B"
    )!;
    expect(movedCallout.parentId).toBe(sectionB.id);
  });

  it("moves a blockquote across a section boundary, dropped at the very end (AFTER the destination section's last block)", () => {
    const text = ["# A", "> quoted", "", "# B", "Only paragraph in B."].join("\n");
    const { doc, complexScan } = pipeline(text);
    const quoted = blockOf(complexScan, "quoted", doc);
    const destParagraph = blockOf(complexScan, "Only paragraph in B.", doc);
    const snapshot = buildStandaloneComplexBlockSnapshot(quoted)!;

    const outcome = dropStandaloneComplexBlock(
      text,
      { snapshot, target: targetHintOf(destParagraph.range, destParagraph.parentId), zone: "after" },
      DEFAULT_COMPOSITE_BLOCK_RULES
    );

    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["# A", "", "# B", "Only paragraph in B.", "", "> quoted"]);
    expect(outcome.lines[outcome.newStartLine]).toBe("> quoted");
  });

  it("moves a fenced-code block across a section boundary, dropped BEFORE the destination section's first block (at the very start of that section)", () => {
    const text = ["# A", "```", "code", "```", "", "# B", "First paragraph in B."].join("\n");
    const { doc, complexScan } = pipeline(text);
    const fenced = complexScan.blocks.find((b) => b.kind === "fenced-code")!;
    const destParagraph = blockOf(complexScan, "First paragraph in B.", doc);
    const snapshot = buildStandaloneComplexBlockSnapshot(fenced)!;

    const outcome = dropStandaloneComplexBlock(
      text,
      { snapshot, target: targetHintOf(destParagraph.range, destParagraph.parentId), zone: "before" },
      DEFAULT_COMPOSITE_BLOCK_RULES
    );

    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "# A",
      "",
      "# B",
      "```",
      "code",
      "```",
      "",
      "First paragraph in B.",
    ]);
    expect(outcome.lines[outcome.newStartLine]).toBe("```");
  });

  it("composite-internal-boundary: still rejects a cross-section drop that would land inside a THIRD-PARTY composite in the destination section", () => {
    const text = [
      "# A",
      "> [!tip] standalone",
      "",
      "# B",
      "- ![[scan.png]]",
      "> [!ocr]",
      "> body",
    ].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    expect(composites).toHaveLength(1);
    const standalone = blockOf(complexScan, "standalone", doc);
    const anchorNode = doc.nodes.get(composites[0].members[0].id)!;
    const snapshot = buildStandaloneComplexBlockSnapshot(standalone)!;

    const outcome = dropStandaloneComplexBlock(
      text,
      { snapshot, target: targetHintOf(anchorNode.range, anchorNode.parentId), zone: "after" },
      DEFAULT_COMPOSITE_BLOCK_RULES
    );

    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("composite-internal-boundary");
    expect(outcome.lines).toEqual(text.split("\n"));
  });

  it("DOES insert blank-line separation for a SAME-section drop too (2026-09-25: ensureBlankSeparation now fires regardless of section — this test used to guard the opposite, now-corrected, behavior; see src/edit/dropStandaloneComplexBlock.ts's own dated addendum)", () => {
    const text = ["# H", "> [!note] one", "> body a", "", "> [!tip] two", "> body b"].join("\n");
    const { doc, complexScan } = pipeline(text);
    const one = blockOf(complexScan, "one", doc);
    const two = blockOf(complexScan, "two", doc);
    const snapshot = buildStandaloneComplexBlockSnapshot(one)!;

    const outcome = dropStandaloneComplexBlock(
      text,
      { snapshot, target: targetHintOf(two.range, two.parentId), zone: "after" },
      DEFAULT_COMPOSITE_BLOCK_RULES
    );

    // Identical fixture and drop to the "successful standalone drops"
    // describe block's own first case above — kept here too, under its
    // own (corrected) title, as a direct same-section regression guard
    // for this fix.
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "# H",
      "",
      "> [!tip] two",
      "> body b",
      "",
      "> [!note] one",
      "> body a",
    ]);
  });
});

describe("dropStandaloneComplexBlock: blank-line separation applies regardless of section (regression test, 2026-09-25, fix/standalone-dnd-blank-separation-always)", () => {
  it("callout dropped directly BEFORE a paragraph with no blank line between them (the exact shape of the reported iPad bug): inserts a blank line so the paragraph is NOT swallowed into the callout's own body", () => {
    const text = ["# H", "Some paragraph.", "", "> [!note] callout", "> body"].join("\n");
    const { doc, complexScan } = pipeline(text);
    const callout = blockOf(complexScan, "callout", doc);
    const paragraph = blockOf(complexScan, "Some paragraph.", doc);
    const snapshot = buildStandaloneComplexBlockSnapshot(callout)!;

    const outcome = dropStandaloneComplexBlock(
      text,
      { snapshot, target: targetHintOf(paragraph.range, paragraph.parentId), zone: "before" },
      DEFAULT_COMPOSITE_BLOCK_RULES
    );

    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "# H",
      "> [!note] callout",
      "> body",
      "",
      "Some paragraph.",
      "",
    ]);

    // Re-parsing confirms the paragraph survived as its own standalone
    // paragraph block, not swallowed into the callout's own body.
    const { complexScan: afterScan, doc: afterDoc } = pipeline(outcome.lines.join("\n"));
    const survivingParagraph = blockOf(afterScan, "Some paragraph.", afterDoc);
    expect(survivingParagraph.kind).toBe("paragraph");
  });

  it("blockquote dropped directly BEFORE a paragraph with no blank line: inserts a blank line, same as callout", () => {
    const text = ["# H", "Some paragraph.", "", "> quoted text"].join("\n");
    const { doc, complexScan } = pipeline(text);
    const quoted = blockOf(complexScan, "quoted text", doc);
    const paragraph = blockOf(complexScan, "Some paragraph.", doc);
    const snapshot = buildStandaloneComplexBlockSnapshot(quoted)!;

    const outcome = dropStandaloneComplexBlock(
      text,
      { snapshot, target: targetHintOf(paragraph.range, paragraph.parentId), zone: "before" },
      DEFAULT_COMPOSITE_BLOCK_RULES
    );

    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["# H", "> quoted text", "", "Some paragraph.", ""]);
  });

  it("fenced-code block dropped directly BEFORE a paragraph with no blank line: inserts a blank line, same as callout/blockquote", () => {
    const text = ["# H", "Some paragraph.", "", "```", "code", "```"].join("\n");
    const { doc, complexScan } = pipeline(text);
    const fenced = complexScan.blocks.find((b) => b.kind === "fenced-code")!;
    const paragraph = blockOf(complexScan, "Some paragraph.", doc);
    const snapshot = buildStandaloneComplexBlockSnapshot(fenced)!;

    const outcome = dropStandaloneComplexBlock(
      text,
      { snapshot, target: targetHintOf(paragraph.range, paragraph.parentId), zone: "before" },
      DEFAULT_COMPOSITE_BLOCK_RULES
    );

    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["# H", "```", "code", "```", "", "Some paragraph.", ""]);
  });

  it("table dropped directly BEFORE a paragraph with no blank line: inserts a blank line, same as the other complex block kinds", () => {
    const text = ["# H", "Some paragraph.", "", "| a | b |", "| - | - |", "| 1 | 2 |"].join("\n");
    const { doc, complexScan } = pipeline(text);
    const table = complexScan.blocks.find((b) => b.kind === "table")!;
    const paragraph = blockOf(complexScan, "Some paragraph.", doc);
    const snapshot = buildStandaloneComplexBlockSnapshot(table)!;

    const outcome = dropStandaloneComplexBlock(
      text,
      { snapshot, target: targetHintOf(paragraph.range, paragraph.parentId), zone: "before" },
      DEFAULT_COMPOSITE_BLOCK_RULES
    );

    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "# H",
      "| a | b |",
      "| - | - |",
      "| 1 | 2 |",
      "",
      "Some paragraph.",
      "",
    ]);
  });

  it("inserts ZERO extra blank lines when the drop position is fully already-separated on both sides (ensureBlankSeparation's own no-op behavior, same-section, dropped adjacent to a list item)", () => {
    // A block dropped directly "before" a LIST item never needs a
    // separating blank line on that touching side (LIST_RE exempts list
    // items -- this is the same exemption that lets a CompositeBlock
    // intentionally form directly under its own anchor list item, see
    // the "tolerates a coincidental NEW composite" test above). Combined
    // with a far side that is already blank in the source document, this
    // drop needs no insertion at all -- insertBlockAt's own raw output
    // is the final output, byte-identical.
    const text = ["# H", "> [!tip] two", "> body b", "", "- list item", "", "> [!warn] three", "> body c"].join("\n");
    const { doc, complexScan } = pipeline(text);
    const three = blockOf(complexScan, "three", doc);
    const listItem = listNodeOf(doc, "list item");
    const snapshot = buildStandaloneComplexBlockSnapshot(three)!;

    const outcome = dropStandaloneComplexBlock(
      text,
      { snapshot, target: targetHintOf(listItem.range, listItem.parentId), zone: "before" },
      DEFAULT_COMPOSITE_BLOCK_RULES
    );

    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "# H",
      "> [!tip] two",
      "> body b",
      "",
      "> [!warn] three",
      "> body c",
      "- list item",
      "",
    ]);
    expect(outcome.lines[outcome.newStartLine]).toBe("> [!warn] three");
  });

  it("inserts only the ONE missing blank line -- not a second, redundant one -- when the far side of a cross-section drop is already blank (ensureBlankSeparation's own no-op behavior on the already-separated side)", () => {
    const text = ["# A", "> [!note] callout", "> body", "", "Paragraph in A.", "", "# B", "", "Destination paragraph."].join(
      "\n"
    );
    const { doc, complexScan } = pipeline(text);
    const callout = blockOf(complexScan, "callout", doc);
    const destParagraph = blockOf(complexScan, "Destination paragraph.", doc);
    const snapshot = buildStandaloneComplexBlockSnapshot(callout)!;

    const outcome = dropStandaloneComplexBlock(
      text,
      { snapshot, target: targetHintOf(destParagraph.range, destParagraph.parentId), zone: "before" },
      DEFAULT_COMPOSITE_BLOCK_RULES
    );

    // The FAR side (between "# B" and the moved callout) was already
    // blank in the source document and stays a single blank line -- no
    // second one is stacked on top of it. The TOUCHING side (directly
    // against "Destination paragraph.", which was not separated at all)
    // does get exactly one blank line inserted.
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "# A",
      "",
      "Paragraph in A.",
      "",
      "# B",
      "",
      "> [!note] callout",
      "> body",
      "",
      "Destination paragraph.",
    ]);
  });
});
