/**
 * Phase 5C-3 (2026-08-14): unit tests for
 * move/findStandaloneComplexBlockMoveTarget.ts's
 * findStandaloneComplexBlockMoveTarget — the RESOLVER layer, given that
 * evaluateStandaloneComplexBlockMovability (the judge, tested in
 * tests/standaloneComplexBlockMovability.test.ts) has already confirmed a
 * move is eligible.
 *
 * Mirrors tests/findCompositeMoveTarget.test.ts's own scope: this file only
 * checks WHICH range gets resolved as the swap target, and that judge
 * rejection propagates to `null` — never that a swap actually happens (see
 * tests/moveStandaloneComplexBlock.test.ts for the executor).
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { scanComplexBlocks } from "../src/parser/complexBlocks";
import { matchCompositeBlocks } from "../src/parser/compositeBlocks";
import { CompositeBlockRule, DEFAULT_COMPOSITE_BLOCK_RULES } from "../src/model/compositeBlock";
import { ComplexBlockInfo, ComplexBlockScanResult } from "../src/model/complexBlock";
import { findStandaloneComplexBlockMoveTarget } from "../src/move/findStandaloneComplexBlockMoveTarget";

function pipeline(text: string, rules: CompositeBlockRule[] = DEFAULT_COMPOSITE_BLOCK_RULES) {
  const doc = parseDocument(text);
  const complexScan = scanComplexBlocks(doc);
  const composites = matchCompositeBlocks(doc, complexScan, rules);
  return { doc, complexScan, composites };
}

function calloutOrBlockquoteOf(
  complexScan: ComplexBlockScanResult,
  needle: string,
  doc: ReturnType<typeof parseDocument>
): ComplexBlockInfo {
  const found = complexScan.blocks.find(
    (b) => (b.kind === "callout" || b.kind === "blockquote") && doc.lines[b.range.startLine].includes(needle)
  );
  if (!found) throw new Error(`no callout/blockquote matching "${needle}"`);
  return found;
}

describe("findStandaloneComplexBlockMoveTarget: resolves the correct adjacent range", () => {
  it("direction 'down': resolves to the next standalone block's own range", () => {
    const text = ["# H", "> [!note] one", "> body a", "", "> [!tip] two", "> body b"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    const one = calloutOrBlockquoteOf(complexScan, "one", doc);
    const two = calloutOrBlockquoteOf(complexScan, "two", doc);

    const target = findStandaloneComplexBlockMoveTarget(doc, complexScan, one, "down", composites);
    expect(target).toEqual({
      range: { startLine: two.range.startLine, endLine: two.range.endLine },
      targetId: two.id,
    });
  });

  it("direction 'up': resolves to the previous standalone block's own range", () => {
    const text = ["# H", "> [!note] one", "> body a", "", "> [!tip] two", "> body b"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    const one = calloutOrBlockquoteOf(complexScan, "one", doc);
    const two = calloutOrBlockquoteOf(complexScan, "two", doc);

    const target = findStandaloneComplexBlockMoveTarget(doc, complexScan, two, "up", composites);
    expect(target).toEqual({
      range: { startLine: one.range.startLine, endLine: one.range.endLine },
      targetId: one.id,
    });
  });

  it("resolves correctly across a blank-line gap without widening or consuming it", () => {
    const text = ["# H", "> [!note] one", "> body a", "", "", "> [!tip] two", "> body b"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    const one = calloutOrBlockquoteOf(complexScan, "one", doc);
    const two = calloutOrBlockquoteOf(complexScan, "two", doc);

    const target = findStandaloneComplexBlockMoveTarget(doc, complexScan, one, "down", composites);
    expect(target?.range).toEqual({ startLine: two.range.startLine, endLine: two.range.endLine });
  });

  it("resolves a multi-line target's own down direction to a single-line adjacent block correctly", () => {
    const text = ["# H", "> [!note] one", "> line 1", "> line 2", "> line 3", "", "> two"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    const one = calloutOrBlockquoteOf(complexScan, "one", doc);
    const two = calloutOrBlockquoteOf(complexScan, "two", doc);

    const target = findStandaloneComplexBlockMoveTarget(doc, complexScan, one, "down", composites);
    expect(target).toEqual({
      range: { startLine: two.range.startLine, endLine: two.range.endLine },
      targetId: two.id,
    });
  });
});

describe("findStandaloneComplexBlockMoveTarget: propagates judge rejection as null", () => {
  it("returns null when the judge rejects (no-adjacent-compatible-unit: first block, direction up)", () => {
    const text = ["# H", "> [!note] one", "> body"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    const one = calloutOrBlockquoteOf(complexScan, "one", doc);
    expect(findStandaloneComplexBlockMoveTarget(doc, complexScan, one, "up", composites)).toBeNull();
  });

  it("returns null when the judge rejects (nested-in-list)", () => {
    const text = ["# H", "- item", "  > [!note] nested", "  > body", "", "> [!tip] two", "> body b"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    const nested = calloutOrBlockquoteOf(complexScan, "nested", doc);
    expect(findStandaloneComplexBlockMoveTarget(doc, complexScan, nested, "down", composites)).toBeNull();
  });

  it("returns null when the judge rejects (composite-member)", () => {
    const text = ["- ![[scan.png]]", "> [!ocr]", "> body", "", "> [!tip] standalone"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    expect(composites).toHaveLength(1);
    const memberInfo = complexScan.blocks.find((b) => b.id === composites[0].members[1].id)!;
    expect(findStandaloneComplexBlockMoveTarget(doc, complexScan, memberInfo, "down", composites)).toBeNull();
  });

  it("ADDENDUM (2026-09-24): resolves to a standalone list item's own range now that Move's adjacency matches D&D's", () => {
    const text = ["# H", "> [!note] one", "> body", "", "- a list item"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    const one = calloutOrBlockquoteOf(complexScan, "one", doc);
    const listNode = [...doc.nodes.values()].find((n) => n.type === "list")!;
    const target = findStandaloneComplexBlockMoveTarget(doc, complexScan, one, "down", composites);
    expect(target).toEqual({
      range: { startLine: listNode.range.startLine, endLine: listNode.range.endLine },
      targetId: listNode.id,
    });
  });

  it("returns null when the adjacent content is across a section boundary", () => {
    const text = ["# A", "> [!note] one", "> body", "# B"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    const one = calloutOrBlockquoteOf(complexScan, "one", doc);
    expect(findStandaloneComplexBlockMoveTarget(doc, complexScan, one, "down", composites)).toBeNull();
  });
});

describe("findStandaloneComplexBlockMoveTarget: allowComposedMember opt-in (Phase 5D-3B)", () => {
  it("with allowComposedMember: true, a composite member resolves ('down') to its genuine standalone sibling's range — the same resolution the judge's own positive test proved eligible", () => {
    const text = ["- ![[scan.png]]", "> [!ocr]", "> body", "", "> [!tip] standalone"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    expect(composites).toHaveLength(1);
    const memberInfo = complexScan.blocks.find((b) => b.id === composites[0].members[1].id)!;
    const standalone = calloutOrBlockquoteOf(complexScan, "standalone", doc);

    const target = findStandaloneComplexBlockMoveTarget(
      doc,
      complexScan,
      memberInfo,
      "down",
      composites,
      true
    );
    expect(target).toEqual({
      range: { startLine: standalone.range.startLine, endLine: standalone.range.endLine },
      targetId: standalone.id,
    });
  });

  it("without the opt-in (omitted, or explicit false), the same member/direction still returns null (composite-member rejection unchanged)", () => {
    const text = ["- ![[scan.png]]", "> [!ocr]", "> body", "", "> [!tip] standalone"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    const memberInfo = complexScan.blocks.find((b) => b.id === composites[0].members[1].id)!;
    expect(findStandaloneComplexBlockMoveTarget(doc, complexScan, memberInfo, "down", composites)).toBeNull();
    expect(
      findStandaloneComplexBlockMoveTarget(doc, complexScan, memberInfo, "down", composites, false)
    ).toBeNull();
  });

  it("with allowComposedMember: true, direction 'up' still returns null (the member's own anchor list item is never a candidate)", () => {
    const text = ["- ![[scan.png]]", "> [!ocr]", "> body", "", "> [!tip] standalone"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    const memberInfo = complexScan.blocks.find((b) => b.id === composites[0].members[1].id)!;
    expect(
      findStandaloneComplexBlockMoveTarget(doc, complexScan, memberInfo, "up", composites, true)
    ).toBeNull();
  });
});
