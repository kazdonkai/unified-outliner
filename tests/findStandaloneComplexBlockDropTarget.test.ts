/**
 * Phase 5D-3C ("Callout and Blockquote Drag and Drop", 案A approved):
 * unit tests for the pure resolver —
 * move/findStandaloneComplexBlockDropTarget.ts#resolveStandaloneComplexBlockDropTarget
 * and model/complexBlock.ts's StandaloneComplexBlockDropRejectReason.
 *
 * Scope reminder (mirrors tests/standaloneComplexBlockMovability.test.ts's
 * own): NO drop is actually EXECUTED here — only whether a given
 * already-resolved (source, target, zone) triple WOULD be safe, and if so
 * the exact insertBeforeLine. Actually performing the drop (re-parsing,
 * re-resolving source/target from a snapshot/hint, calling insertBlockAt)
 * is edit/dropStandaloneComplexBlock.ts's job, tested in its own file.
 *
 * Same fixture caveat as standaloneComplexBlockMovability.test.ts: two
 * `>`-prefixed blocks with NO blank line between them merge into one
 * "unsupported" run (parser/complexBlocks.ts's quote-run scanner) rather
 * than staying two distinct ComplexBlockInfo entries — every fixture below
 * that wants two DISTINCT standalone blocks uses a blank-line gap.
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { scanComplexBlocks } from "../src/parser/complexBlocks";
import { matchCompositeBlocks } from "../src/parser/compositeBlocks";
import { DEFAULT_COMPOSITE_BLOCK_RULES } from "../src/model/compositeBlock";
import { ComplexBlockInfo, ComplexBlockScanResult } from "../src/model/complexBlock";
import { resolveStandaloneComplexBlockDropTarget } from "../src/move/findStandaloneComplexBlockDropTarget";

function pipeline(text: string) {
  const doc = parseDocument(text);
  const complexScan = scanComplexBlocks(doc);
  const composites = matchCompositeBlocks(doc, complexScan, DEFAULT_COMPOSITE_BLOCK_RULES);
  return { doc, complexScan, composites };
}

function blockOf(complexScan: ComplexBlockScanResult, needle: string, doc: ReturnType<typeof parseDocument>): ComplexBlockInfo {
  const found = complexScan.blocks.find((b) => doc.lines[b.range.startLine].includes(needle));
  if (!found) throw new Error(`no block matching "${needle}"`);
  return found;
}

describe("resolveStandaloneComplexBlockDropTarget: positive cases (real pipeline)", () => {
  it("standalone callout can be dropped AFTER a genuine standalone sibling in the same section", () => {
    const text = ["# H", "> [!note] one", "> body a", "", "> [!tip] two", "> body b"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    const one = blockOf(complexScan, "one", doc);
    const two = blockOf(complexScan, "two", doc);
    const resolution = resolveStandaloneComplexBlockDropTarget(
      doc,
      one,
      composites,
      { range: two.range, parentId: two.parentId },
      "after"
    );
    expect(resolution).toEqual({ allowed: true, insertBeforeLine: two.range.endLine + 1 });
  });

  it("standalone blockquote can be dropped BEFORE a genuine standalone sibling in the same section", () => {
    const text = ["# H", "> quoted one", "", "> quoted two"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    const one = blockOf(complexScan, "quoted one", doc);
    const two = blockOf(complexScan, "quoted two", doc);
    const resolution = resolveStandaloneComplexBlockDropTarget(
      doc,
      two,
      composites,
      { range: one.range, parentId: one.parentId },
      "before"
    );
    expect(resolution).toEqual({ allowed: true, insertBeforeLine: one.range.startLine });
  });
});

describe("resolveStandaloneComplexBlockDropTarget: self-drop", () => {
  it("dropping a block 'before' itself is rejected as self-drop", () => {
    const text = ["# H", "> [!note] one", "> body a", "", "> [!tip] two", "> body b"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    const one = blockOf(complexScan, "one", doc);
    const resolution = resolveStandaloneComplexBlockDropTarget(
      doc,
      one,
      composites,
      { range: one.range, parentId: one.parentId },
      "before"
    );
    expect(resolution).toEqual({ allowed: false, reason: "self-drop" });
  });

  it("dropping a block 'after' itself is rejected as self-drop", () => {
    const text = ["# H", "> [!note] one", "> body a", "", "> [!tip] two", "> body b"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    const one = blockOf(complexScan, "one", doc);
    const resolution = resolveStandaloneComplexBlockDropTarget(
      doc,
      one,
      composites,
      { range: one.range, parentId: one.parentId },
      "after"
    );
    expect(resolution).toEqual({ allowed: false, reason: "self-drop" });
  });
});

describe("resolveStandaloneComplexBlockDropTarget: cross-section D&D (feat/standalone-complex-dnd-cross-section, 2026-09-24)", () => {
  // Historically this exact fixture was rejected as "not-same-section" —
  // see git history / model/complexBlock.ts's own dated addendum on that
  // reason value for the retired v1 behavior. The section-boundary gate
  // has been lifted: a standalone callout may now be dropped relative to
  // a target under a DIFFERENT heading.
  it("allows dropping AFTER a target under a different heading (cross-section)", () => {
    const text = ["# A", "> [!note] a", "> body", "", "# B", "> [!tip] b", "> body"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    const a = blockOf(complexScan, "a", doc);
    const b = blockOf(complexScan, "b", doc);
    const resolution = resolveStandaloneComplexBlockDropTarget(
      doc,
      a,
      composites,
      { range: b.range, parentId: b.parentId },
      "after"
    );
    expect(resolution).toEqual({ allowed: true, insertBeforeLine: b.range.endLine + 1 });
  });

  it("allows dropping BEFORE a target under a different heading (cross-section)", () => {
    const text = ["# A", "> [!note] a", "> body", "", "# B", "> [!tip] b", "> body"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    const a = blockOf(complexScan, "a", doc);
    const b = blockOf(complexScan, "b", doc);
    const resolution = resolveStandaloneComplexBlockDropTarget(
      doc,
      a,
      composites,
      { range: b.range, parentId: b.parentId },
      "before"
    );
    expect(resolution).toEqual({ allowed: true, insertBeforeLine: b.range.startLine });
  });

  it("still rejects (composite-internal-boundary) a cross-section drop that would land inside a THIRD-PARTY composite in the destination section", () => {
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
    // Dropping "standalone" (section A) "after" the anchor list item
    // (section B) would land it strictly inside the section-B composite's
    // own [anchor, member] range.
    const resolution = resolveStandaloneComplexBlockDropTarget(
      doc,
      standalone,
      composites,
      { range: anchorNode.range, parentId: anchorNode.parentId },
      "after"
    );
    expect(resolution).toEqual({ allowed: false, reason: "composite-internal-boundary" });
  });
});

describe("resolveStandaloneComplexBlockDropTarget: source shape eligibility", () => {
  // Originally used a fenced-code fixture here ("rejects (not-supported)
  // when the source is not kind callout/blockquote/table"): fenced-code
  // itself was excluded from D&D through Phase 5E-3d. The follow-up
  // ticket "fenced-code D&D parity" (2026-09-24, same branch) lifted that
  // exclusion (see the "accepts fenced-code" test just below), so this
  // regression guard's fixture was switched to thematic-break — a kind
  // that genuinely remains unsupported as a D&D source (it is never even
  // projected as its own standalone Tree row — see
  // view/OutlineTreeView.ts's own thematic-break doc comment).
  it("rejects (not-supported) when the source is not kind callout/blockquote/table/fenced-code", () => {
    const text = ["Some paragraph.", "", "***", "", "> [!tip] two", "> body b"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    const thematicBreak = complexScan.blocks.find((b) => b.kind === "thematic-break")!;
    const two = blockOf(complexScan, "two", doc);
    const resolution = resolveStandaloneComplexBlockDropTarget(
      doc,
      thematicBreak,
      composites,
      { range: two.range, parentId: two.parentId },
      "after"
    );
    expect(resolution).toEqual({ allowed: false, reason: "not-supported" });
  });

  it("accepts (allowed: true) when the source is kind fenced-code (fenced-code D&D parity follow-up)", () => {
    const text = ["# H", "```", "code", "```", "", "> [!tip] two", "> body b"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    const fenced = complexScan.blocks.find((b) => b.kind === "fenced-code")!;
    const two = blockOf(complexScan, "two", doc);
    const resolution = resolveStandaloneComplexBlockDropTarget(
      doc,
      fenced,
      composites,
      { range: two.range, parentId: two.parentId },
      "after"
    );
    expect(resolution).toEqual({ allowed: true, insertBeforeLine: two.range.endLine + 1 });
  });

  it("rejects (nested-in-list) when the source itself is nested inside a list item's continuation", () => {
    const text = ["# H", "- item", "  > [!note] nested", "  > body", "", "> [!tip] two", "> body b"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    const nested = blockOf(complexScan, "nested", doc);
    const two = blockOf(complexScan, "two", doc);
    const resolution = resolveStandaloneComplexBlockDropTarget(
      doc,
      nested,
      composites,
      { range: two.range, parentId: two.parentId },
      "after"
    );
    expect(resolution).toEqual({ allowed: false, reason: "nested-in-list" });
  });
});

describe("resolveStandaloneComplexBlockDropTarget: 案A — a CompositeBlock-member source is just as eligible as a standalone one", () => {
  it("a composite's own member CAN be dropped relative to a genuine standalone sibling (composite membership never blocks source eligibility)", () => {
    const text = ["- ![[scan.png]]", "> [!ocr]", "> body", "", "> [!tip] standalone"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    expect(composites).toHaveLength(1);
    const member = complexScan.blocks.find((b) => b.id === composites[0].members[1].id)!;
    const standalone = blockOf(complexScan, "standalone", doc);
    const resolution = resolveStandaloneComplexBlockDropTarget(
      doc,
      member,
      composites,
      { range: standalone.range, parentId: standalone.parentId },
      "after"
    );
    expect(resolution).toEqual({ allowed: true, insertBeforeLine: standalone.range.endLine + 1 });
  });

  it("dropping a composite's own member immediately BEFORE its own anchor list item is allowed (a genuinely different position from its own current one, even though it would dissolve the match)", () => {
    const text = ["- ![[scan.png]]", "> [!ocr]", "> body", "", "> [!tip] standalone"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    const member = complexScan.blocks.find((b) => b.id === composites[0].members[1].id)!;
    const anchor = complexScan.blocks.find((b) => b.id === composites[0].members[0].id);
    // The anchor list item is a BlockNode, not a ComplexBlockInfo — resolve
    // its range directly from doc.nodes for this hint, mirroring how
    // view/OutlineTreeView.ts#calloutDropTargetHint resolves a list target.
    const anchorRange = doc.nodes.get(composites[0].members[0].id)!.range;
    expect(anchor).toBeUndefined(); // sanity: confirms members[0] is NOT itself a ComplexBlockInfo
    const resolution = resolveStandaloneComplexBlockDropTarget(
      doc,
      member,
      composites,
      { range: anchorRange, parentId: doc.nodes.get(composites[0].members[0].id)!.parentId },
      "before"
    );
    expect(resolution).toEqual({ allowed: true, insertBeforeLine: anchorRange.startLine });
  });

  it("dropping a composite's own member immediately AFTER its own anchor list item is rejected as self-drop (this IS its current position)", () => {
    const text = ["- ![[scan.png]]", "> [!ocr]", "> body", "", "> [!tip] standalone"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    const member = complexScan.blocks.find((b) => b.id === composites[0].members[1].id)!;
    const anchorNode = doc.nodes.get(composites[0].members[0].id)!;
    const resolution = resolveStandaloneComplexBlockDropTarget(
      doc,
      member,
      composites,
      { range: anchorNode.range, parentId: anchorNode.parentId },
      "after"
    );
    expect(resolution).toEqual({ allowed: false, reason: "self-drop" });
  });
});

describe("resolveStandaloneComplexBlockDropTarget: third-party CompositeBlock internal-boundary protection", () => {
  it("rejects (composite-internal-boundary) a drop that would insert an UNRELATED standalone block between a composite's own anchor and its own member", () => {
    const text = ["- ![[scan.png]]", "> [!ocr]", "> body", "", "> [!tip] standalone"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    expect(composites).toHaveLength(1);
    const standalone = blockOf(complexScan, "standalone", doc);
    const anchorNode = doc.nodes.get(composites[0].members[0].id)!;
    // Dropping the UNINVOLVED "standalone" block "after" the anchor list
    // item would land it strictly inside the composite's own [0,2] range.
    const resolution = resolveStandaloneComplexBlockDropTarget(
      doc,
      standalone,
      composites,
      { range: anchorNode.range, parentId: anchorNode.parentId },
      "after"
    );
    expect(resolution).toEqual({ allowed: false, reason: "composite-internal-boundary" });
  });

  it("does NOT reject a drop landing exactly BEFORE a composite's own aggregate range (that boundary is 'before the whole composite', not inside it)", () => {
    const text = ["- ![[scan.png]]", "> [!ocr]", "> body", "", "> [!tip] standalone"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    const standalone = blockOf(complexScan, "standalone", doc);
    const anchorNode = doc.nodes.get(composites[0].members[0].id)!;
    const resolution = resolveStandaloneComplexBlockDropTarget(
      doc,
      standalone,
      composites,
      { range: anchorNode.range, parentId: anchorNode.parentId },
      "before"
    );
    expect(resolution).toEqual({ allowed: true, insertBeforeLine: anchorNode.range.startLine });
  });
});
