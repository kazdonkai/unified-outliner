/**
 * Phase 5C-3 (2026-08-14): unit tests for the standalone (non-composite-
 * member) callout/blockquote move-eligibility evaluator —
 * model/complexBlock.ts's StandaloneComplexBlockMovability/
 * StandaloneComplexBlockMoveRejectionReason and
 * parser/compositeBlocks.ts's evaluateStandaloneComplexBlockMovability.
 *
 * Scope reminder (mirrors tests/compositeBlockMovability.test.ts's own):
 * NO move is implemented or tested here — only whether a given, already-
 * recognized standalone ComplexBlockInfo WOULD be safe to swap with
 * whatever sits adjacent to it in a given direction. Which exact RANGE gets
 * swapped with which is move/findStandaloneComplexBlockMoveTarget.ts's job
 * and is tested in its own file, not here.
 *
 * Approved scope (Phase 5C-3, "A案"): adjacency candidates are limited to
 * OTHER standalone callout/blockquote blocks only — never a list item,
 * section, composite, composite member, or any other ComplexBlockKind.
 *
 * IMPORTANT fixture note (verified via a real parseDocument/scanComplexBlocks
 * run before writing these assertions): parser/complexBlocks.ts's quote-run
 * scanner groups ANY run of contiguous (zero-gap) `>`-prefixed lines into
 * ONE single block — two callouts written back-to-back with NO blank line
 * between them are never two separate ComplexBlockInfo entries; they merge
 * into one run, and since the second callout's own `[!type]` marker then
 * appears mid-run, that merged block is flagged editability "unsupported"
 * (hasEmbeddedCalloutMarker). So "directly adjacent" (zero-gap) standalone
 * callout/blockquote pairs are structurally impossible to construct as two
 * distinct blocks — every "eligible: true" fixture below therefore uses (at
 * least) one blank line between the two blocks, exactly like
 * compositeBlockMovability.test.ts's own "gap is only skipped for
 * detection, never consumed" test already establishes for composites.
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { scanComplexBlocks } from "../src/parser/complexBlocks";
import { evaluateStandaloneComplexBlockMovability, matchCompositeBlocks } from "../src/parser/compositeBlocks";
import { CompositeBlockRule, DEFAULT_COMPOSITE_BLOCK_RULES } from "../src/model/compositeBlock";
import { ComplexBlockInfo, ComplexBlockScanResult } from "../src/model/complexBlock";

/** Real pipeline: parse -> scan -> match, mirroring compositeBlockMovability.test.ts's own pipeline() helper. */
function pipeline(text: string, rules: CompositeBlockRule[] = DEFAULT_COMPOSITE_BLOCK_RULES) {
  const doc = parseDocument(text);
  const complexScan = scanComplexBlocks(doc);
  const composites = matchCompositeBlocks(doc, complexScan, rules);
  return { doc, complexScan, composites };
}

/**
 * Finds the callout/blockquote ComplexBlockInfo whose own first line
 * contains `needle`. Explicitly filtered to kind callout/blockquote (never
 * just the first array match) because parser/complexBlocks.ts's paragraph
 * scanner is a catch-all that ALSO produces an "ambiguous" ComplexBlockInfo
 * over the exact same range as a real callout/blockquote (see
 * parser/compositeBlocks.ts's own hasOverlappingDiagnostic doc comment) —
 * relying on unfiltered array order would be fragile.
 */
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

describe("evaluateStandaloneComplexBlockMovability: positive cases (real pipeline)", () => {
  it("eligible: true, direction 'down', when two standalone callouts sit adjacent (one blank line), same section", () => {
    const text = ["# H", "> [!note] one", "> body a", "", "> [!tip] two", "> body b"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    expect(composites).toHaveLength(0);
    const one = calloutOrBlockquoteOf(complexScan, "one", doc);
    expect(evaluateStandaloneComplexBlockMovability(doc, complexScan, one, "down", composites)).toEqual({
      eligible: true,
    });
  });

  it("eligible: true, direction 'up', for the second of two adjacent standalone callouts", () => {
    const text = ["# H", "> [!note] one", "> body a", "", "> [!tip] two", "> body b"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    const two = calloutOrBlockquoteOf(complexScan, "two", doc);
    expect(evaluateStandaloneComplexBlockMovability(doc, complexScan, two, "up", composites)).toEqual({
      eligible: true,
    });
  });

  it("eligible: true when a standalone blockquote sits adjacent to a standalone callout (mixed kinds are still valid partners)", () => {
    const text = ["# H", "> [!note] one", "> body a", "", "> plain quote two"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    const one = calloutOrBlockquoteOf(complexScan, "one", doc);
    expect(evaluateStandaloneComplexBlockMovability(doc, complexScan, one, "down", composites)).toEqual({
      eligible: true,
    });
  });

  it("eligible: true when multiple blank lines separate the two standalone blocks (gap is only skipped for detection, never consumed)", () => {
    const text = ["# H", "> [!note] one", "> body a", "", "", "> [!tip] two", "> body b"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    const one = calloutOrBlockquoteOf(complexScan, "one", doc);
    expect(evaluateStandaloneComplexBlockMovability(doc, complexScan, one, "down", composites)).toEqual({
      eligible: true,
    });
  });

  it("eligible: true for two standalone blocks with no enclosing section at all (both top-of-document)", () => {
    const text = ["> [!note] one", "> body a", "", "> [!tip] two", "> body b"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    const one = calloutOrBlockquoteOf(complexScan, "one", doc);
    expect(evaluateStandaloneComplexBlockMovability(doc, complexScan, one, "down", composites)).toEqual({
      eligible: true,
    });
  });
});

describe("evaluateStandaloneComplexBlockMovability: negative cases reachable via the real pipeline", () => {
  it("rejects (no-adjacent-compatible-unit) direction 'up' when the block is the first content in the document", () => {
    const text = ["# H", "> [!note] one", "> body"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    const one = calloutOrBlockquoteOf(complexScan, "one", doc);
    expect(evaluateStandaloneComplexBlockMovability(doc, complexScan, one, "up", composites)).toEqual({
      eligible: false,
      reason: "no-adjacent-compatible-unit",
    });
  });

  it("rejects (no-adjacent-compatible-unit) direction 'down' when the block is the last content in the document", () => {
    const text = ["# H", "> [!note] one", "> body"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    const one = calloutOrBlockquoteOf(complexScan, "one", doc);
    expect(evaluateStandaloneComplexBlockMovability(doc, complexScan, one, "down", composites)).toEqual({
      eligible: false,
      reason: "no-adjacent-compatible-unit",
    });
  });

  it("rejects (no-adjacent-compatible-unit) when the adjacent content is a plain list item, not a callout/blockquote (list is explicitly out of scope — 'A案のみ')", () => {
    const text = ["# H", "> [!note] one", "> body", "", "- a list item"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    const one = calloutOrBlockquoteOf(complexScan, "one", doc);
    expect(evaluateStandaloneComplexBlockMovability(doc, complexScan, one, "down", composites)).toEqual({
      eligible: false,
      reason: "no-adjacent-compatible-unit",
    });
  });

  it("rejects (no-adjacent-compatible-unit) when the adjacent content is a section heading (no cross-section hop)", () => {
    const text = ["# A", "> [!note] one", "> body", "# B"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    const one = calloutOrBlockquoteOf(complexScan, "one", doc);
    expect(evaluateStandaloneComplexBlockMovability(doc, complexScan, one, "down", composites)).toEqual({
      eligible: false,
      reason: "no-adjacent-compatible-unit",
    });
  });

  it("rejects (no-adjacent-compatible-unit) when the adjacent content is a paragraph (always editability read-only, never a move candidate)", () => {
    const text = ["# H", "> [!note] one", "> body", "", "a plain paragraph line"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    const one = calloutOrBlockquoteOf(complexScan, "one", doc);
    expect(evaluateStandaloneComplexBlockMovability(doc, complexScan, one, "down", composites)).toEqual({
      eligible: false,
      reason: "no-adjacent-compatible-unit",
    });
  });

  it("rejects (no-adjacent-compatible-unit) when the adjacent content is a table block (out of scope — table stays read-only)", () => {
    // Phase 5E-1 widened fenced-code into the standalone-move-eligible set
    // (see the new "eligible: true ... fenced-code" test just below), so
    // this out-of-scope fixture is re-pointed at "table", which remains
    // genuinely out of scope — see
    // docs/phase5e1_fenced-code-partial-edit-move-delete-design-memo.md §3.
    const text = ["# H", "> [!note] one", "> body", "", "| a | b |", "|---|---|", "| 1 | 2 |"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    const one = calloutOrBlockquoteOf(complexScan, "one", doc);
    expect(evaluateStandaloneComplexBlockMovability(doc, complexScan, one, "down", composites)).toEqual({
      eligible: false,
      reason: "no-adjacent-compatible-unit",
    });
  });

  it("Phase 5E-1: eligible: true, direction 'down', when a standalone callout sits adjacent to a standalone fenced-code block (one blank line)", () => {
    const text = ["# H", "> [!note] one", "> body", "", "```", "code", "```"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    const one = calloutOrBlockquoteOf(complexScan, "one", doc);
    expect(evaluateStandaloneComplexBlockMovability(doc, complexScan, one, "down", composites)).toEqual({
      eligible: true,
    });
  });

  it("rejects (nested-in-list) when the target itself is nested inside a list item's continuation", () => {
    const text = ["# H", "- item", "  > [!note] nested", "  > body", "", "> [!tip] two", "> body b"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    const nested = calloutOrBlockquoteOf(complexScan, "nested", doc);
    expect(evaluateStandaloneComplexBlockMovability(doc, complexScan, nested, "down", composites)).toEqual({
      eligible: false,
      reason: "nested-in-list",
    });
  });

  it("rejects (composite-member) when the target itself is currently a matched CompositeBlock's own member", () => {
    const text = ["- ![[scan.png]]", "> [!ocr]", "> body", "", "> [!tip] standalone"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    expect(composites).toHaveLength(1);
    const memberInfo = complexScan.blocks.find((b) => b.id === composites[0].members[1].id)!;
    expect(evaluateStandaloneComplexBlockMovability(doc, complexScan, memberInfo, "down", composites)).toEqual({
      eligible: false,
      reason: "composite-member",
    });
  });

  it("rejects (not-supported) when the target's own editability is not 'supported' (embedded/nested callout marker)", () => {
    const text = ["# H", "> [!note]", "> > [!warning] nested", "", "> [!tip] two", "> body"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    const outer = complexScan.blocks.find((b) => b.editability === "unsupported")!;
    expect(outer).toBeDefined();
    expect(evaluateStandaloneComplexBlockMovability(doc, complexScan, outer, "down", composites)).toEqual({
      eligible: false,
      reason: "not-supported",
    });
  });

  it("rejects (no-adjacent-compatible-unit) when the adjacent block is callout/blockquote in kind but is currently a composite member (excluded from candidacy)", () => {
    const text = ["> [!tip] standalone", "> body", "", "- ![[scan.png]]", "> [!ocr]", "> body a"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    expect(composites).toHaveLength(1);
    const standalone = calloutOrBlockquoteOf(complexScan, "standalone", doc);
    expect(evaluateStandaloneComplexBlockMovability(doc, complexScan, standalone, "down", composites)).toEqual({
      eligible: false,
      reason: "no-adjacent-compatible-unit",
    });
  });
});

describe("evaluateStandaloneComplexBlockMovability: allowComposedMember opt-in (Phase 5D-3B)", () => {
  it("a composite member becomes eligible ('down') with allowComposedMember: true when a genuine standalone sibling follows", () => {
    const text = ["- ![[scan.png]]", "> [!ocr]", "> body", "", "> [!tip] standalone"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    expect(composites).toHaveLength(1);
    const memberInfo = complexScan.blocks.find((b) => b.id === composites[0].members[1].id)!;
    expect(
      evaluateStandaloneComplexBlockMovability(doc, complexScan, memberInfo, "down", composites, true)
    ).toEqual({ eligible: true });
  });

  it("omitting the argument (or passing false) reproduces the existing 'rejects (composite-member)' behavior unchanged — proving the default is backward-compatible", () => {
    const text = ["- ![[scan.png]]", "> [!ocr]", "> body", "", "> [!tip] standalone"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    const memberInfo = complexScan.blocks.find((b) => b.id === composites[0].members[1].id)!;
    const omitted = evaluateStandaloneComplexBlockMovability(doc, complexScan, memberInfo, "down", composites);
    const explicitFalse = evaluateStandaloneComplexBlockMovability(
      doc,
      complexScan,
      memberInfo,
      "down",
      composites,
      false
    );
    expect(omitted).toEqual({ eligible: false, reason: "composite-member" });
    expect(explicitFalse).toEqual(omitted);
  });

  it("a composite member with allowComposedMember: true still rejects (no-adjacent-compatible-unit) in direction 'up' — its own anchor list item is never itself a candidate, so this is never reachable via a hardcoded rejection", () => {
    const text = ["- ![[scan.png]]", "> [!ocr]", "> body", "", "> [!tip] standalone"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    const memberInfo = complexScan.blocks.find((b) => b.id === composites[0].members[1].id)!;
    expect(
      evaluateStandaloneComplexBlockMovability(doc, complexScan, memberInfo, "up", composites, true)
    ).toEqual({ eligible: false, reason: "no-adjacent-compatible-unit" });
  });

  it("allowComposedMember: true does not bypass nested-in-list — this check runs strictly before the (bypassable) composite-member check, so a nested target rejects (nested-in-list) regardless of the flag", () => {
    const text = ["# H", "- item", "  > [!note] nested", "  > body", "", "> [!tip] two", "> body b"].join(
      "\n"
    );
    const { doc, complexScan, composites } = pipeline(text);
    const nested = calloutOrBlockquoteOf(complexScan, "nested", doc);
    expect(
      evaluateStandaloneComplexBlockMovability(doc, complexScan, nested, "down", composites, true)
    ).toEqual({ eligible: false, reason: "nested-in-list" });
  });

  it("allowComposedMember: true does not bypass not-supported — an unsupported-editability composite-shaped block still rejects (not-supported)", () => {
    const text = ["- ![[scan.png]]", "> [!ocr]", "> > [!warning] nested", "", "> [!tip] two"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    const unsupported = complexScan.blocks.find((b) => b.editability === "unsupported")!;
    expect(unsupported).toBeDefined();
    expect(
      evaluateStandaloneComplexBlockMovability(doc, complexScan, unsupported, "down", composites, true)
    ).toEqual({ eligible: false, reason: "not-supported" });
  });

  it("allowComposedMember: true does not widen the CANDIDATE side — a member whose only adjacent neighbor is another composite's member still rejects (no-adjacent-compatible-unit)", () => {
    const text = [
      "- ![[scan-1.png]]",
      "> [!ocr]",
      "> body one",
      "",
      "- ![[scan-2.png]]",
      "> [!ocr]",
      "> body two",
    ].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    expect(composites).toHaveLength(2);
    const firstMember = complexScan.blocks.find((b) => b.id === composites[0].members[1].id)!;
    expect(
      evaluateStandaloneComplexBlockMovability(doc, complexScan, firstMember, "down", composites, true)
    ).toEqual({ eligible: false, reason: "no-adjacent-compatible-unit" });
  });
});

describe("evaluateStandaloneComplexBlockMovability: negative cases requiring a hand-built ComplexBlockScanResult", () => {
  // "different-section" via the real top-to-bottom scan is structurally
  // unreachable: skipBlankLines only ever skips BLANK lines, so any content
  // actually belonging to a different section is necessarily separated by
  // an intervening heading line — and a heading line itself is never a
  // ComplexBlockInfo boundary, so findAdjacentStandaloneComplexBlock always
  // reports "no-adjacent-compatible-unit" first (see the real-pipeline test
  // above, "adjacent content is a section heading"). This mirrors
  // compositeBlockMovability.test.ts's own "different-parent-or-depth via a
  // depth mismatch alone" hand-built test for an analogous structurally-
  // unreachable-via-the-real-parser defensive branch.
  it("rejects (different-section) when a hand-built adjacent block shares no gap with the target but has a different parentId", () => {
    const text = ["# A", "> [!note] one", "> body", "# B", "> [!tip] two", "> body"].join("\n");
    const { doc, complexScan } = pipeline(text);
    const one = calloutOrBlockquoteOf(complexScan, "one", doc);
    const twoOriginal = calloutOrBlockquoteOf(complexScan, "two", doc);
    expect(twoOriginal.parentId).not.toBe(one.parentId);

    // Relocate "two" (in the scan result only — doc.lines is untouched) to
    // sit with zero gap right after "one", as if the heading between them
    // did not exist — isolating the "different parentId" condition alone.
    const twoPatched: ComplexBlockInfo = {
      ...twoOriginal,
      range: { startLine: one.range.endLine + 1, endLine: one.range.endLine + 2 },
    };
    const patchedScan: ComplexBlockScanResult = {
      ...complexScan,
      blocks: complexScan.blocks.map((b) => (b.id === twoOriginal.id ? twoPatched : b)),
    };

    expect(evaluateStandaloneComplexBlockMovability(doc, patchedScan, one, "down", [])).toEqual({
      eligible: false,
      reason: "different-section",
    });
  });
});

describe("evaluateStandaloneComplexBlockMovability: does not mutate its inputs", () => {
  it("leaves doc.nodes and complexScan.blocks untouched", () => {
    const text = ["# H", "> [!note] one", "> body", "", "> [!tip] two", "> body b"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    const one = calloutOrBlockquoteOf(complexScan, "one", doc);
    const nodesBefore = doc.nodes.size;
    const blocksBefore = complexScan.blocks.length;
    evaluateStandaloneComplexBlockMovability(doc, complexScan, one, "down", composites);
    expect(doc.nodes.size).toBe(nodesBefore);
    expect(complexScan.blocks.length).toBe(blocksBefore);
  });
});
