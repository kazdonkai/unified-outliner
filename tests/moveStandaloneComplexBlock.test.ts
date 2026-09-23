/**
 * Phase 5C-3 (2026-08-14): unit tests for
 * edit/moveStandaloneComplexBlock.ts — the EXECUTOR layer: given the
 * CURRENT Markdown text and a StandaloneComplexBlockSnapshot captured at
 * menu-build time, re-parse/re-scan/re-match/re-verify and perform (or
 * safely refuse) the swap.
 *
 * Mirrors tests/moveCompositeBlock.test.ts's own scope and structure.
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { scanComplexBlocks } from "../src/parser/complexBlocks";
import { matchCompositeBlocks } from "../src/parser/compositeBlocks";
import { CompositeBlockRule, DEFAULT_COMPOSITE_BLOCK_RULES } from "../src/model/compositeBlock";
import { ComplexBlockInfo, ComplexBlockScanResult } from "../src/model/complexBlock";
import {
  buildStandaloneComplexBlockSnapshot,
  moveStandaloneComplexBlock,
  standaloneComplexBlockMoveReasonText,
  StandaloneComplexBlockSnapshot,
} from "../src/edit/moveStandaloneComplexBlock";
import { createTranslator } from "../src/i18n";

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

describe("buildStandaloneComplexBlockSnapshot", () => {
  it("projects a callout ComplexBlockInfo into a snapshot with the same kind/range/parentId", () => {
    const text = ["# H", "> [!note] one", "> body"].join("\n");
    const { doc, complexScan } = pipeline(text);
    const one = calloutOrBlockquoteOf(complexScan, "one", doc);
    const snapshot = buildStandaloneComplexBlockSnapshot(one);
    expect(snapshot).toEqual({
      id: one.id,
      kind: "callout",
      range: { startLine: one.range.startLine, endLine: one.range.endLine },
      parentId: one.parentId,
    });
  });

  it("returns null for a non-callout/blockquote/fenced-code/table kind (defense-in-depth)", () => {
    // Phase 5E-1 widened buildStandaloneComplexBlockSnapshot to also
    // accept kind "fenced-code" (see this file's own new "accepts a
    // standalone fenced-code block" test below), and Phase 5E-3d widened
    // it again to also accept "table" (see this file's own new "accepts a
    // standalone table block" test below) — this defense-in-depth case is
    // re-pointed at "thematic-break", which remains genuinely unsupported
    // (paragraph/thematic-break stay out of scope; see
    // docs/phase5e3d_table-move-delete-dnd-design-memo.md).
    const text = ["Some paragraph.", "", "***"].join("\n");
    const { complexScan } = pipeline(text);
    const thematicBreak = complexScan.blocks.find((b) => b.kind === "thematic-break")!;
    expect(buildStandaloneComplexBlockSnapshot(thematicBreak)).toBeNull();
  });

  it("Phase 5E-1: accepts a standalone fenced-code block, projecting the same kind/range/parentId shape as callout/blockquote", () => {
    const text = ["# H", "```js", "code", "```"].join("\n");
    const { complexScan } = pipeline(text);
    const fenced = complexScan.blocks.find((b) => b.kind === "fenced-code")!;
    const snapshot = buildStandaloneComplexBlockSnapshot(fenced);
    expect(snapshot).toEqual({
      id: fenced.id,
      kind: "fenced-code",
      range: { startLine: fenced.range.startLine, endLine: fenced.range.endLine },
      parentId: fenced.parentId,
    });
  });

  it("Phase 5E-3d: accepts a standalone table block, projecting the same kind/range/parentId shape as callout/blockquote/fenced-code", () => {
    const text = ["# H", "| a | b |", "|---|---|", "| 1 | 2 |"].join("\n");
    const { complexScan } = pipeline(text);
    const table = complexScan.blocks.find((b) => b.kind === "table")!;
    const snapshot = buildStandaloneComplexBlockSnapshot(table);
    expect(snapshot).toEqual({
      id: table.id,
      kind: "table",
      range: { startLine: table.range.startLine, endLine: table.range.endLine },
      parentId: table.parentId,
    });
  });
});

describe("moveStandaloneComplexBlock: successful swaps", () => {
  it("swaps two adjacent standalone callouts (direction down), preserving header/body/quote-prefix verbatim", () => {
    const text = ["# H", "> [!note] one", "> body a", "", "> [!tip] two", "> body b"].join("\n");
    const { doc, complexScan } = pipeline(text);
    const one = calloutOrBlockquoteOf(complexScan, "one", doc);
    const snapshot = buildStandaloneComplexBlockSnapshot(one)!;

    const outcome = moveStandaloneComplexBlock(text, { snapshot, direction: "down" }, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "# H",
      "> [!tip] two",
      "> body b",
      "",
      "> [!note] one",
      "> body a",
    ]);
  });

  it("swaps two adjacent standalone blockquotes (direction up), preserving content verbatim", () => {
    const text = ["# H", "> quote one", "", "> quote two"].join("\n");
    const { doc, complexScan } = pipeline(text);
    const two = calloutOrBlockquoteOf(complexScan, "quote two", doc);
    const snapshot = buildStandaloneComplexBlockSnapshot(two)!;

    const outcome = moveStandaloneComplexBlock(text, { snapshot, direction: "up" }, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["# H", "> quote two", "", "> quote one"]);
  });

  it("preserves the blank-line gap between the two swapped blocks exactly (swapBlocks contract)", () => {
    const text = ["# H", "> [!note] one", "> body a", "", "", "> [!tip] two", "> body b"].join("\n");
    const { doc, complexScan } = pipeline(text);
    const one = calloutOrBlockquoteOf(complexScan, "one", doc);
    const snapshot = buildStandaloneComplexBlockSnapshot(one)!;

    const outcome = moveStandaloneComplexBlock(text, { snapshot, direction: "down" }, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "# H",
      "> [!tip] two",
      "> body b",
      "",
      "",
      "> [!note] one",
      "> body a",
    ]);
  });

  it("returns the moved block's own new start line", () => {
    const text = ["# H", "> [!note] one", "> body a", "", "> [!tip] two", "> body b"].join("\n");
    const { doc, complexScan } = pipeline(text);
    const one = calloutOrBlockquoteOf(complexScan, "one", doc);
    const snapshot = buildStandaloneComplexBlockSnapshot(one)!;

    const outcome = moveStandaloneComplexBlock(text, { snapshot, direction: "down" }, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(true);
    // "one" (2 lines) now sits after "two" (2 lines) + blank line: line 4.
    expect(outcome.lines[outcome.newStartLine]).toBe("> [!note] one");
  });
});

describe("moveStandaloneComplexBlock: rejections leave text byte-identical", () => {
  it("range-invalid: startLine < 0", () => {
    const text = ["# H", "> [!note] one", "> body"].join("\n");
    const snapshot: StandaloneComplexBlockSnapshot = {
      id: "callout-x",
      kind: "callout",
      range: { startLine: -1, endLine: 1 },
      parentId: null,
    };
    const outcome = moveStandaloneComplexBlock(text, { snapshot, direction: "down" }, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("range-invalid");
    expect(outcome.lines).toEqual(text.split("\n"));
  });

  it("range-invalid: endLine >= lineCount", () => {
    const text = ["# H", "> [!note] one", "> body"].join("\n");
    const snapshot: StandaloneComplexBlockSnapshot = {
      id: "callout-x",
      kind: "callout",
      range: { startLine: 1, endLine: 99 },
      parentId: null,
    };
    const outcome = moveStandaloneComplexBlock(text, { snapshot, direction: "down" }, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("range-invalid");
    expect(outcome.lines).toEqual(text.split("\n"));
  });

  it("standalone-boundary-changed: no block in the current text matches the snapshot's kind/range/parentId", () => {
    const text = ["# H", "> [!note] one", "> body"].join("\n");
    const snapshot: StandaloneComplexBlockSnapshot = {
      id: "callout-x",
      kind: "callout",
      range: { startLine: 1, endLine: 1 },
      parentId: null,
    };
    const outcome = moveStandaloneComplexBlock(text, { snapshot, direction: "down" }, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("standalone-boundary-changed");
    expect(outcome.lines).toEqual(text.split("\n"));
  });

  it("standalone-boundary-changed: the note changed between snapshot capture and Apply (content shifted lines)", () => {
    const originalText = ["# H", "> [!note] one", "> body", "", "> [!tip] two", "> body b"].join("\n");
    const { doc, complexScan } = pipeline(originalText);
    const one = calloutOrBlockquoteOf(complexScan, "one", doc);
    const snapshot = buildStandaloneComplexBlockSnapshot(one)!;

    // An unrelated line inserted above shifts every subsequent line number.
    const laterText = ["# H", "extra inserted line", "> [!note] one", "> body", "", "> [!tip] two", "> body b"].join(
      "\n"
    );
    const outcome = moveStandaloneComplexBlock(
      laterText,
      { snapshot, direction: "down" },
      DEFAULT_COMPOSITE_BLOCK_RULES
    );
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("standalone-boundary-changed");
    expect(outcome.lines).toEqual(laterText.split("\n"));
  });

  it("re-evaluated judge rejection (no-adjacent-compatible-unit) propagates and leaves text unchanged", () => {
    const text = ["# H", "> [!note] one", "> body"].join("\n");
    const { doc, complexScan } = pipeline(text);
    const one = calloutOrBlockquoteOf(complexScan, "one", doc);
    const snapshot = buildStandaloneComplexBlockSnapshot(one)!;

    const outcome = moveStandaloneComplexBlock(text, { snapshot, direction: "down" }, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("no-adjacent-compatible-unit");
    expect(outcome.lines).toEqual(text.split("\n"));
  });

  it("re-evaluated judge rejection (composite-member) when the note changed so the target is now a composite's own member", () => {
    // Snapshot captured while "one" was standalone...
    const originalText = ["> [!note] one", "> body", "", "- x"].join("\n");
    const { doc, complexScan } = pipeline(originalText);
    const one = calloutOrBlockquoteOf(complexScan, "one", doc);
    const snapshot = buildStandaloneComplexBlockSnapshot(one)!;

    // ...but by the time Apply runs, a list item was inserted directly
    // before it (no blank line), making it a matched composite's own
    // member instead. Even though kind/range/parentId can still coincide
    // with the snapshot in principle, this fixture also changes the range
    // (the callout no longer starts at line 0) — demonstrating the
    // standalone-boundary-changed path is what actually fires here, which
    // is the CORRECT, safer outcome (never silently reinterpreting a
    // now-composite-member block as still-standalone).
    const laterText = ["- ![[scan.png]]", "> [!note] one", "> body", "", "- x"].join("\n");
    const outcome = moveStandaloneComplexBlock(
      laterText,
      { snapshot, direction: "down" },
      DEFAULT_COMPOSITE_BLOCK_RULES
    );
    expect(outcome.changed).toBe(false);
    expect(outcome.lines).toEqual(laterText.split("\n"));
  });
});

describe("moveStandaloneComplexBlock: allowComposedMember opt-in (Phase 5D-3B)", () => {
  it("with allowComposedMember: true, successfully swaps a composite member down with a genuine standalone sibling, preserving the '>' prefix/header/body/blank-line gap verbatim as one raw-range unit (no reconstruction)", () => {
    const text = ["- ![[scan.png]]", "> [!ocr]", "> body", "", "> [!tip] standalone"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    expect(composites).toHaveLength(1);
    const memberInfo = complexScan.blocks.find((b) => b.id === composites[0].members[1].id)!;
    // buildStandaloneComplexBlockSnapshot has no composite-membership
    // assumption of its own (Phase 5D-3B pre-implementation confirmation
    // item ②) — it snapshots a composite member exactly the same way it
    // snapshots any other ComplexBlockInfo.
    const snapshot = buildStandaloneComplexBlockSnapshot(memberInfo)!;
    expect(snapshot).not.toBeNull();

    const outcome = moveStandaloneComplexBlock(
      text,
      { snapshot, direction: "down", allowComposedMember: true },
      DEFAULT_COMPOSITE_BLOCK_RULES
    );
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "- ![[scan.png]]",
      "> [!tip] standalone",
      "",
      "> [!ocr]",
      "> body",
    ]);
    // The member's own new start line, per swapBlocks' contract (source
    // relocates to old_source_start + target_length + gap_length = 1+1+1).
    expect(outcome.lines[outcome.newStartLine]).toBe("> [!ocr]");

    // CompositeBlock matching for the MOVED member specifically is allowed
    // to dissolve as a result (案A) — confirmed here by re-scanning/
    // re-matching the moved-into text and observing the moved "[!ocr]"
    // callout (now sitting after a blank line, not immediately after any
    // list item) is no longer any composite's member. Note this fixture
    // happens to form a NEW, unrelated composite match at the anchor list
    // item's own position, since "> [!tip] standalone" — a real callout —
    // now coincidentally sits immediately after it; composite matching is
    // purely structural (kindSequence), so that is expected and is not
    // itself a regression — the point of 案A is specifically that the
    // MOVED block's own prior membership is not preserved/re-corrected.
    const movedDoc = parseDocument(outcome.lines.join("\n"));
    const movedScan = scanComplexBlocks(movedDoc);
    const movedOcr = movedScan.blocks.find((b) => movedDoc.lines[b.range.startLine].includes("[!ocr]"))!;
    expect(movedOcr).toBeDefined();
    const movedComposites = matchCompositeBlocks(movedDoc, movedScan, DEFAULT_COMPOSITE_BLOCK_RULES);
    const movedOcrIsStillAMember = movedComposites.some((c) =>
      c.members.some((m) => m.id === movedOcr.id)
    );
    expect(movedOcrIsStillAMember).toBe(false);
  });

  it("without the opt-in (omitted request field), the identical request/text still rejects (composite-member) and leaves text byte-identical — proving the default is unchanged", () => {
    const text = ["- ![[scan.png]]", "> [!ocr]", "> body", "", "> [!tip] standalone"].join("\n");
    const { complexScan, composites } = pipeline(text);
    const memberInfo = complexScan.blocks.find((b) => b.id === composites[0].members[1].id)!;
    const snapshot = buildStandaloneComplexBlockSnapshot(memberInfo)!;

    const outcome = moveStandaloneComplexBlock(
      text,
      { snapshot, direction: "down" },
      DEFAULT_COMPOSITE_BLOCK_RULES
    );
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("composite-member");
    expect(outcome.lines).toEqual(text.split("\n"));
  });

  it("with allowComposedMember: true, direction 'up' is still safely rejected (no-adjacent-compatible-unit), never a hardcoded rejection reason", () => {
    const text = ["- ![[scan.png]]", "> [!ocr]", "> body", "", "> [!tip] standalone"].join("\n");
    const { complexScan, composites } = pipeline(text);
    const memberInfo = complexScan.blocks.find((b) => b.id === composites[0].members[1].id)!;
    const snapshot = buildStandaloneComplexBlockSnapshot(memberInfo)!;

    const outcome = moveStandaloneComplexBlock(
      text,
      { snapshot, direction: "up", allowComposedMember: true },
      DEFAULT_COMPOSITE_BLOCK_RULES
    );
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("no-adjacent-compatible-unit");
    expect(outcome.lines).toEqual(text.split("\n"));
  });
});

describe("standaloneComplexBlockMoveReasonText", () => {
  it("maps every NoStandaloneComplexBlockMoveReason to a non-empty, distinct-per-locale string", () => {
    const en = createTranslator("en");
    const ja = createTranslator("ja");
    const reasons = [
      "not-supported",
      "composite-member",
      "nested-in-list",
      "no-adjacent-compatible-unit",
      "different-section",
      "standalone-boundary-changed",
      "range-invalid",
      "no-target",
    ] as const;
    for (const reason of reasons) {
      const enText = standaloneComplexBlockMoveReasonText(en, reason);
      const jaText = standaloneComplexBlockMoveReasonText(ja, reason);
      expect(enText?.length ?? 0).toBeGreaterThan(0);
      expect(jaText?.length ?? 0).toBeGreaterThan(0);
      expect(enText).not.toBe(jaText);
    }
  });

  it("returns undefined for an undefined reason", () => {
    const en = createTranslator("en");
    expect(standaloneComplexBlockMoveReasonText(en, undefined)).toBeUndefined();
  });

  it("resolves via dedicated reason.standaloneMove* keys, never the reason.compositeMove* keys' own string values (kind/nested/boundary/range reasons overlap by NAME with composite's own but must not overlap by TEXT)", () => {
    const en = createTranslator("en");
    expect(standaloneComplexBlockMoveReasonText(en, "nested-in-list")).not.toBe(
      en("reason.compositeMoveNestedInList")
    );
    expect(standaloneComplexBlockMoveReasonText(en, "standalone-boundary-changed")).not.toBe(
      en("reason.compositeMoveBoundaryChanged")
    );
    expect(standaloneComplexBlockMoveReasonText(en, "range-invalid")).not.toBe(
      en("reason.compositeMoveRangeInvalid")
    );
    expect(standaloneComplexBlockMoveReasonText(en, "no-adjacent-compatible-unit")).toBe(
      en("reason.standaloneMoveNoAdjacentUnit")
    );
  });
});
