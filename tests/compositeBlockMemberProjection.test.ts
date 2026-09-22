/**
 * Phase 5D-2B ("CompositeBlock Structured Partial Edit Projection — structured member
 * reuse"): unit tests for edit/compositeBlockMemberProjection.ts's pure
 * split/compose pair. Real parseDocument -> scanComplexBlocks ->
 * matchCompositeBlocks -> buildCompositeBlockSnapshot pipeline is used for
 * every success-path fixture (never a hand-typed CompositeBlockSnapshot),
 * mirroring tests/compositeBlockPartialEdit.test.ts's own convention — a
 * fixture typo can never silently turn a success case into something this
 * module wasn't actually meant to accept. Rejection-reason cases build a
 * minimal snapshot by hand, since those are deliberately testing this
 * module's OWN shape checks in isolation, not the real scanner/matcher.
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { scanComplexBlocks } from "../src/parser/complexBlocks";
import { matchCompositeBlocks } from "../src/parser/compositeBlocks";
import { DEFAULT_COMPOSITE_BLOCK_RULES } from "../src/model/compositeBlock";
import { buildCompositeBlockSnapshot, CompositeBlockSnapshot } from "../src/edit/deleteCompositeBlock";
import {
  composeCompositeBlockMemberText,
  isListMemberEligibleForMarkerFreeProjection,
  splitCompositeBlockMembers,
} from "../src/edit/compositeBlockMemberProjection";

function buildSnapshot(text: string): { lines: string[]; snapshot: CompositeBlockSnapshot } {
  const doc = parseDocument(text);
  const complexScan = scanComplexBlocks(doc);
  const composites = matchCompositeBlocks(doc, complexScan, DEFAULT_COMPOSITE_BLOCK_RULES);
  expect(composites.length).toBe(1);
  return { lines: doc.lines, snapshot: buildCompositeBlockSnapshot(composites[0]) };
}

describe("splitCompositeBlockMembers: success cases", () => {
  it("splits a list + callout CompositeBlock into its own list line and trailing callout text", () => {
    const text = ["- ![[scan-001.png]]", "> [!note] OCR転写", "> 本文の読み"].join("\n");
    const { lines, snapshot } = buildSnapshot(text);
    const outcome = splitCompositeBlockMembers(lines, snapshot);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected ok");
    expect(outcome.split.listLineText).toBe("- ![[scan-001.png]]");
    expect(outcome.split.trailingKind).toBe("callout");
    expect(outcome.split.trailingRawText).toBe("> [!note] OCR転写\n> 本文の読み");
  });

  it("splits a list + blockquote CompositeBlock into its own list line and trailing quote text", () => {
    const text = ["- 史料本文の項目", "> 引用資料の本文", "> 続きの引用"].join("\n");
    const { lines, snapshot } = buildSnapshot(text);
    const outcome = splitCompositeBlockMembers(lines, snapshot);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected ok");
    expect(outcome.split.listLineText).toBe("- 史料本文の項目");
    expect(outcome.split.trailingKind).toBe("blockquote");
    expect(outcome.split.trailingRawText).toBe("> 引用資料の本文\n> 続きの引用");
  });

  it("preserves list marker/indentation verbatim in listLineText", () => {
    const text = ["  - ![[nested.png]]", "  > [!warning]- 注意"].join("\n");
    const { lines, snapshot } = buildSnapshot(text);
    const outcome = splitCompositeBlockMembers(lines, snapshot);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected ok");
    expect(outcome.split.listLineText).toBe("  - ![[nested.png]]");
  });

  it("round-trips: composing the split pieces reproduces the CompositeBlock's whole raw text byte-for-byte", () => {
    const cases = [
      ["- ![[a.png]]", "> [!note]- タイトル", "> 本文一行目", ">", "> - ネストしたlist"].join("\n"),
      ["- item", "> quoted line one", "> quoted line two"].join("\n"),
    ];
    for (const text of cases) {
      const { lines, snapshot } = buildSnapshot(text);
      const outcome = splitCompositeBlockMembers(lines, snapshot);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error("expected ok");
      const recomposed = composeCompositeBlockMemberText(
        outcome.split.listLineText,
        outcome.split.trailingRawText
      );
      const wholeRangeText = lines
        .slice(snapshot.range.startLine, snapshot.range.endLine + 1)
        .join("\n");
      expect(recomposed).toBe(wholeRangeText);
      expect(recomposed).toBe(text);
    }
  });
});

describe("splitCompositeBlockMembers: rejection reasons", () => {
  const baseRange = { startLine: 0, endLine: 1 };

  it("rejects a snapshot with member count !== 2 (\"member-count\")", () => {
    const snapshot: CompositeBlockSnapshot = {
      id: "composite-0",
      ruleId: "image-ocr",
      sectionId: null,
      range: baseRange,
      members: [{ kind: "single-line-list", id: "li-0", range: { startLine: 0, endLine: 0 } }],
    };
    const outcome = splitCompositeBlockMembers(["- x", "> y"], snapshot);
    expect(outcome).toEqual({ ok: false, reason: "member-count" });
  });

  it("rejects when the first member's kind is not single-line-list/list (\"list-member-kind\")", () => {
    const snapshot: CompositeBlockSnapshot = {
      id: "composite-0",
      ruleId: "image-ocr",
      sectionId: null,
      range: baseRange,
      members: [
        { kind: "callout", id: "cb-0", range: { startLine: 0, endLine: 0 } },
        { kind: "callout", id: "cb-1", range: { startLine: 1, endLine: 1 } },
      ],
    };
    const outcome = splitCompositeBlockMembers(["> [!note] a", "> [!note] b"], snapshot);
    expect(outcome).toEqual({ ok: false, reason: "list-member-kind" });
  });

  it("rejects when the list member's own range spans more than one line (\"list-member-not-single-line\")", () => {
    const snapshot: CompositeBlockSnapshot = {
      id: "composite-0",
      ruleId: "hypothetical",
      sectionId: null,
      range: { startLine: 0, endLine: 2 },
      members: [
        { kind: "list", id: "li-0", range: { startLine: 0, endLine: 1 } },
        { kind: "callout", id: "cb-0", range: { startLine: 2, endLine: 2 } },
      ],
    };
    const outcome = splitCompositeBlockMembers(
      ["- item", "  continuation", "> [!note] a"],
      snapshot
    );
    expect(outcome).toEqual({ ok: false, reason: "list-member-not-single-line" });
  });

  it("rejects when the trailing member's kind is not callout/blockquote (\"trailing-member-kind\")", () => {
    const snapshot: CompositeBlockSnapshot = {
      id: "composite-0",
      ruleId: "hypothetical",
      sectionId: null,
      range: baseRange,
      members: [
        { kind: "single-line-list", id: "li-0", range: { startLine: 0, endLine: 0 } },
        { kind: "table", id: "tb-0", range: { startLine: 1, endLine: 1 } },
      ],
    };
    const outcome = splitCompositeBlockMembers(["- item", "| a | b |"], snapshot);
    expect(outcome).toEqual({ ok: false, reason: "trailing-member-kind" });
  });
});

describe("composeCompositeBlockMemberText", () => {
  it("joins the list line and trailing text with exactly one newline, never a blank line", () => {
    expect(composeCompositeBlockMemberText("- item", "> body")).toBe("- item\n> body");
  });

  it("preserves a multi-line trailing text unchanged", () => {
    expect(composeCompositeBlockMemberText("- item", "> line one\n> line two")).toBe(
      "- item\n> line one\n> line two"
    );
  });
});


describe("isListMemberEligibleForMarkerFreeProjection", () => {
  it('returns true ONLY for "single-line-list"', () => {
    expect(isListMemberEligibleForMarkerFreeProjection("single-line-list")).toBe(true);
  });

  it('returns false for "list" — the defensive, potentially-multi-line/nested kind, even though splitCompositeBlockMembers itself tolerates it', () => {
    expect(isListMemberEligibleForMarkerFreeProjection("list")).toBe(false);
  });

  it("returns false for every non-list CompositeMemberKind (callout/blockquote/section/etc — defensive, unreachable as an actual list member's own kind in practice)", () => {
    expect(isListMemberEligibleForMarkerFreeProjection("callout")).toBe(false);
    expect(isListMemberEligibleForMarkerFreeProjection("blockquote")).toBe(false);
    expect(isListMemberEligibleForMarkerFreeProjection("section")).toBe(false);
  });
});
