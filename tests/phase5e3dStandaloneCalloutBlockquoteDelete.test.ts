/**
 * Follow-up ticket ("standalone callout/blockquote Delete", 2026-09-24,
 * same branch as Phase 5E-3d — `phase5e3d-table-move-delete-dnd`):
 * during the user's own real-device acceptance testing of that branch,
 * the standalone callout/blockquote context menu was found to offer no
 * Delete item at all — Move up/down was already available for those two
 * kinds (since Phase 5C-3), but Delete had been deliberately excluded
 * since Phase 5E-1 for a reason that was never technical (see
 * src/edit/deleteStandaloneComplexBlock.ts's own dated addendum): it was
 * simply never requested for callout/blockquote until now.
 *
 * This file mirrors tests/phase5e1FencedCodePartialEditMoveDelete.test.ts's
 * own "category B: delete" structure and
 * tests/phase5e3dTableMoveDeleteDnd.test.ts's own "category B: table
 * delete" structure almost exactly, substituting standalone callout and
 * blockquote fixtures — no new delete logic was written anywhere in the
 * pipeline (`deleteStandaloneComplexBlock`'s own re-verify/normalize body
 * has always been kind-generic; only its `kind` allow-list, this same
 * allow-list in `buildStandaloneComplexBlockDeleteSnapshot`/
 * `findRangeInvalidReason`, the Delete menu item's own gate in
 * view/OutlineTreeView.ts#showStandaloneComplexBlockMenu, and
 * ConfirmFencedCodeDeleteModal's title-selection branch were widened).
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { scanComplexBlocks } from "../src/parser/complexBlocks";
import { matchCompositeBlocks } from "../src/parser/compositeBlocks";
import { CompositeBlockRule, DEFAULT_COMPOSITE_BLOCK_RULES } from "../src/model/compositeBlock";
import { ComplexBlockInfo, ComplexBlockScanResult } from "../src/model/complexBlock";
import {
  buildStandaloneComplexBlockDeleteSnapshot,
  deleteStandaloneComplexBlock,
} from "../src/edit/deleteStandaloneComplexBlock";
import { createTranslator } from "../src/i18n";

/** Real pipeline: parse -> scan -> match, mirroring every other *StandaloneComplexBlock test file's own pipeline() helper. */
function pipeline(text: string, rules: CompositeBlockRule[] = DEFAULT_COMPOSITE_BLOCK_RULES) {
  const doc = parseDocument(text);
  const complexScan = scanComplexBlocks(doc);
  const composites = matchCompositeBlocks(doc, complexScan, rules);
  return { doc, complexScan, composites };
}

/** Finds the callout or blockquote ComplexBlockInfo whose own start line contains `needle`. */
function calloutOrBlockquoteOf(
  complexScan: ComplexBlockScanResult,
  doc: ReturnType<typeof parseDocument>,
  needle: string
): ComplexBlockInfo {
  const found = complexScan.blocks.find(
    (b) => (b.kind === "callout" || b.kind === "blockquote") && doc.lines[b.range.startLine].includes(needle)
  );
  if (!found) throw new Error(`no callout/blockquote matching "${needle}"`);
  return found;
}

describe("follow-up ticket category A: standalone callout delete (ブロック全体の一括削除)", () => {
  it("deletes a standalone callout atomically — its own lines removed as one unit", () => {
    const text = ["# H", "para one", "", "> [!note] Title", "> body line", "", "para two"].join("\n");
    const { doc, complexScan } = pipeline(text);
    const callout = calloutOrBlockquoteOf(complexScan, doc, "Title");
    const snapshot = buildStandaloneComplexBlockDeleteSnapshot(callout)!;
    expect(snapshot.kind).toBe("callout");

    const outcome = deleteStandaloneComplexBlock(text, snapshot, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(true);
    // The single blank line before and the single blank line after the
    // deleted callout become newly adjacent, forming a 2-line run — at
    // or under normalizeBlankRunAtBoundary's own 2-line cap, so it is
    // left untouched (never trimmed below 2, per that function's own
    // "MAXIMUM, never a minimum" contract).
    expect(outcome.lines).toEqual(["# H", "para one", "", "", "para two"]);
  });

  it("normalizes a 3+ line blank run at the new boundary down to exactly 2 lines after delete", () => {
    const text = ["# H", "para one", "", "", "> [!note] Title", "> body", "", "para two"].join("\n");
    const { doc, complexScan } = pipeline(text);
    const callout = calloutOrBlockquoteOf(complexScan, doc, "Title");
    const snapshot = buildStandaloneComplexBlockDeleteSnapshot(callout)!;

    const outcome = deleteStandaloneComplexBlock(text, snapshot, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["# H", "para one", "", "", "para two"]);
  });

  it("rejects the delete and leaves the original text untouched when the callout's boundary can no longer be confirmed (boundary-changed)", () => {
    const originalText = ["# H", "> [!note] Title", "> body"].join("\n");
    const { doc, complexScan } = pipeline(originalText);
    const callout = calloutOrBlockquoteOf(complexScan, doc, "Title");
    const snapshot = buildStandaloneComplexBlockDeleteSnapshot(callout)!;

    const laterText = ["# H", "no", "longer", "a callout"].join("\n");
    const outcome = deleteStandaloneComplexBlock(laterText, snapshot, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("boundary-changed");
    expect(outcome.lines).toEqual(parseDocument(laterText).lines);
  });

  it("a composite-member callout (list item + callout) is excluded from delete eligibility (composite-member)", () => {
    const text = ["- source note", "> [!ocr]", "> body", "", "> [!tip] standalone"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    expect(composites).toHaveLength(1);
    const memberInfo = complexScan.blocks.find((b) => b.id === composites[0].members[1].id)!;
    const snapshot = buildStandaloneComplexBlockDeleteSnapshot(memberInfo)!;

    const outcome = deleteStandaloneComplexBlock(text, snapshot, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("composite-member");
    expect(outcome.lines).toEqual(doc.lines);
  });

  it("a callout nested inside a list item's continuation is excluded from delete eligibility (not-supported)", () => {
    const text = ["# H", "- item", "  > [!note] nested", "  > body"].join("\n");
    const { doc, complexScan } = pipeline(text);
    const nested = complexScan.blocks.find((b) => b.kind === "callout" && b.parentId !== null)!;
    const snapshot = buildStandaloneComplexBlockDeleteSnapshot(nested)!;

    const outcome = deleteStandaloneComplexBlock(text, snapshot, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("not-supported");
    expect(outcome.lines).toEqual(doc.lines);
  });
});

describe("follow-up ticket category B: standalone blockquote delete (ブロック全体の一括削除)", () => {
  it("deletes a standalone blockquote atomically — its own lines removed as one unit", () => {
    const text = ["# H", "para one", "", "> quoted line one", "> quoted line two", "", "para two"].join("\n");
    const { doc, complexScan } = pipeline(text);
    const blockquote = calloutOrBlockquoteOf(complexScan, doc, "quoted line one");
    const snapshot = buildStandaloneComplexBlockDeleteSnapshot(blockquote)!;
    expect(snapshot.kind).toBe("blockquote");

    const outcome = deleteStandaloneComplexBlock(text, snapshot, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(true);
    // Same 2-line-run-stays-untouched rationale as the callout atomic
    // delete test above.
    expect(outcome.lines).toEqual(["# H", "para one", "", "", "para two"]);
  });

  it("normalizes a 3+ line blank run at the new boundary down to exactly 2 lines after delete", () => {
    const text = ["# H", "para one", "", "", "> quoted", "", "para two"].join("\n");
    const { doc, complexScan } = pipeline(text);
    const blockquote = calloutOrBlockquoteOf(complexScan, doc, "quoted");
    const snapshot = buildStandaloneComplexBlockDeleteSnapshot(blockquote)!;

    const outcome = deleteStandaloneComplexBlock(text, snapshot, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["# H", "para one", "", "", "para two"]);
  });

  it("rejects the delete and leaves the original text untouched when the blockquote's boundary can no longer be confirmed (boundary-changed)", () => {
    const originalText = ["# H", "> quoted line"].join("\n");
    const { doc, complexScan } = pipeline(originalText);
    const blockquote = calloutOrBlockquoteOf(complexScan, doc, "quoted line");
    const snapshot = buildStandaloneComplexBlockDeleteSnapshot(blockquote)!;

    const laterText = ["# H", "no", "longer", "a blockquote"].join("\n");
    const outcome = deleteStandaloneComplexBlock(laterText, snapshot, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("boundary-changed");
    expect(outcome.lines).toEqual(parseDocument(laterText).lines);
  });

  it("a blockquote nested inside a list item's continuation is excluded from delete eligibility (not-supported)", () => {
    const text = ["# H", "- item", "  > nested quote"].join("\n");
    const { doc, complexScan } = pipeline(text);
    const nested = complexScan.blocks.find((b) => b.kind === "blockquote" && b.parentId !== null)!;
    const snapshot = buildStandaloneComplexBlockDeleteSnapshot(nested)!;

    const outcome = deleteStandaloneComplexBlock(text, snapshot, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("not-supported");
    expect(outcome.lines).toEqual(doc.lines);
  });
});

describe("follow-up ticket category C: i18n — new modal title keys, en + ja", () => {
  it("modal.deleteCalloutTitle / modal.deleteBlockquoteTitle resolve to non-empty, per-locale-distinct, per-kind-distinct text", () => {
    const en = createTranslator("en");
    const ja = createTranslator("ja");
    expect(en("modal.deleteCalloutTitle").length).toBeGreaterThan(0);
    expect(en("modal.deleteBlockquoteTitle").length).toBeGreaterThan(0);
    expect(ja("modal.deleteCalloutTitle").length).toBeGreaterThan(0);
    expect(ja("modal.deleteBlockquoteTitle").length).toBeGreaterThan(0);
    expect(en("modal.deleteCalloutTitle")).not.toBe(ja("modal.deleteCalloutTitle"));
    expect(en("modal.deleteBlockquoteTitle")).not.toBe(ja("modal.deleteBlockquoteTitle"));
    expect(en("modal.deleteCalloutTitle")).not.toBe(en("modal.deleteBlockquoteTitle"));
    // Also distinct from the pre-existing fenced-code/table titles.
    expect(en("modal.deleteCalloutTitle")).not.toBe(en("modal.deleteFencedCodeTitle"));
    expect(en("modal.deleteBlockquoteTitle")).not.toBe(en("modal.deleteTableTitle"));
  });
});

describe("follow-up ticket category D: UI 配線 (view/OutlineTreeView.ts) — Delete menu item gate", () => {
  it("reproduces showStandaloneComplexBlockMenu's Delete item kind gate: now true for callout/blockquote too, alongside fenced-code/table", () => {
    function wouldShowDeleteItem(kind: string): boolean {
      return (
        kind === "fenced-code" || kind === "table" || kind === "callout" || kind === "blockquote"
      );
    }
    for (const kind of ["fenced-code", "table", "callout", "blockquote"]) {
      expect(wouldShowDeleteItem(kind)).toBe(true);
    }
    expect(wouldShowDeleteItem("section")).toBe(false);
    expect(wouldShowDeleteItem("list")).toBe(false);
  });
});
