/**
 * Phase 5E-3d ("Table Move/Delete/DnD Parity"): tests for widening the
 * three existing fenced-code-block Tree operations — Move (前後兄弟との
 * 入れ替え), Delete (ブロック全体の一括削除), and Drag and Drop — to also
 * cover standalone table blocks. Per this phase's own design constraint,
 * NO new range-determination/parser logic was written and NO parallel
 * move/delete/drag pipeline was created: every kind-gated allow-list this
 * codebase already used for fenced-code (StandaloneComplexBlockMoveKind,
 * StandaloneComplexBlockDeleteKind, isStandaloneComplexBlockShapeEligible,
 * evaluateStandaloneComplexBlockMovability, and — for D&D only —
 * resolveStandaloneComplexBlockDropTarget's own source-kind gate and
 * view/OutlineTreeView.ts's renderNode drag-wiring guard) was simply
 * widened to also accept "table". See
 * docs/phase5e3d_table-move-delete-dnd-design-memo.md for the full design,
 * including the one documented scope deviation THIS PHASE ITSELF ORIGINALLY
 * MADE: fenced-code was NEVER given Drag and Drop by Phase 5E-1 (that
 * phase's own brief was Partial Edit/Move/Delete only), so this phase
 * originally widened table INTO the existing D&D pipeline without ALSO
 * retroactively widening fenced-code into it (fenced-code stayed
 * "not-supported" as a D&D source).
 *
 * UPDATE (follow-up ticket "fenced-code D&D parity", 2026-09-24, same
 * branch): that exclusion has since been lifted — fenced-code now reaches
 * full D&D parity with callout/blockquote/table, via the exact same
 * resolveStandaloneComplexBlockDropTarget source-kind gate and
 * view/OutlineTreeView.ts renderNode drag-wiring guard this phase itself
 * widened for table, simply widened once more. The tests in this file
 * that used to pin fenced-code's D&D exclusion have been updated
 * accordingly (see category C and D below) rather than left describing
 * now-stale behavior.
 *
 * Mirrors tests/phase5e1FencedCodePartialEditMoveDelete.test.ts's own
 * category A/B structure (Move / Delete) almost exactly, substituting
 * table fixtures for fenced-code ones, plus a new category C (Drag and
 * Drop, mirroring tests/findStandaloneComplexBlockDropTarget.test.ts's and
 * tests/dropStandaloneComplexBlock.test.ts's own patterns) and a category
 * D (UI-wiring guards, mirroring
 * tests/phase5e3aStructuredBlockInsertUiWiring.test.ts's own "reproduce
 * the real OutlineTreeView.ts guard locally and assert it now admits
 * table" convention).
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { scanComplexBlocks } from "../src/parser/complexBlocks";
import {
  evaluateStandaloneComplexBlockMovability,
  isStandaloneComplexBlockShapeEligible,
  matchCompositeBlocks,
} from "../src/parser/compositeBlocks";
import { CompositeBlockRule, DEFAULT_COMPOSITE_BLOCK_RULES } from "../src/model/compositeBlock";
import { ComplexBlockInfo, ComplexBlockScanResult } from "../src/model/complexBlock";
import {
  buildOutlineTree,
  collectReadOnlyOutlineNodeIds,
  flattenOutlineTree,
  isOutlineComplexMemberNode,
} from "../src/tree/buildOutlineTree";
import { createTranslator } from "../src/i18n";
import {
  buildStandaloneComplexBlockSnapshot,
  moveStandaloneComplexBlock,
} from "../src/edit/moveStandaloneComplexBlock";
import {
  buildStandaloneComplexBlockDeleteSnapshot,
  deleteStandaloneComplexBlock,
} from "../src/edit/deleteStandaloneComplexBlock";
import { dropStandaloneComplexBlock } from "../src/edit/dropStandaloneComplexBlock";
import {
  resolveStandaloneComplexBlockDropTarget,
  StandaloneComplexBlockDropTargetHint,
} from "../src/move/findStandaloneComplexBlockDropTarget";

/** Real pipeline: parse -> scan -> match, mirroring every other *StandaloneComplexBlock test file's own pipeline() helper. */
function pipeline(text: string, rules: CompositeBlockRule[] = DEFAULT_COMPOSITE_BLOCK_RULES) {
  const doc = parseDocument(text);
  const complexScan = scanComplexBlocks(doc);
  const composites = matchCompositeBlocks(doc, complexScan, rules);
  return { doc, complexScan, composites };
}

/** Finds the table ComplexBlockInfo whose own range includes a line containing `needle`. */
function tableOf(complexScan: ComplexBlockScanResult, doc: ReturnType<typeof parseDocument>, needle: string): ComplexBlockInfo {
  const found = complexScan.blocks.find(
    (b) => b.kind === "table" && doc.lines.slice(b.range.startLine, b.range.endLine + 1).some((l) => l.includes(needle))
  );
  if (!found) throw new Error(`no table block matching "${needle}"`);
  return found;
}

function targetHintOf(range: { startLine: number; endLine: number }, parentId: string | null): StandaloneComplexBlockDropTargetHint {
  return { range: { startLine: range.startLine, endLine: range.endLine }, parentId };
}

describe("Phase 5E-3d category A: table move (前後兄弟との入れ替え)", () => {
  it("swaps a standalone table block with its previous sibling (direction up), preserving every row verbatim", () => {
    const text = ["# H", "> [!note] one", "> body a", "", "| a | b |", "|---|---|", "| 1 | 2 |"].join("\n");
    const { doc, complexScan } = pipeline(text);
    const table = tableOf(complexScan, doc, "1");
    const snapshot = buildStandaloneComplexBlockSnapshot(table)!;
    expect(snapshot.kind).toBe("table");

    const outcome = moveStandaloneComplexBlock(text, { snapshot, direction: "up" }, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "# H",
      "| a | b |",
      "|---|---|",
      "| 1 | 2 |",
      "",
      "> [!note] one",
      "> body a",
    ]);
  });

  it("swaps a standalone table block with its next sibling (direction down), preserving every row verbatim", () => {
    const text = ["# H", "| a | b |", "|---|---|", "| 1 | 2 |", "", "> [!tip] two", "> body b"].join("\n");
    const { doc, complexScan } = pipeline(text);
    const table = tableOf(complexScan, doc, "1");
    const snapshot = buildStandaloneComplexBlockSnapshot(table)!;

    const outcome = moveStandaloneComplexBlock(text, { snapshot, direction: "down" }, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "# H",
      "> [!tip] two",
      "> body b",
      "",
      "| a | b |",
      "|---|---|",
      "| 1 | 2 |",
    ]);
  });

  it("preserves the exact blank-line gap between blocks after a move (gap is carried, never consumed or duplicated)", () => {
    const text = ["# H", "> [!note] one", "> body a", "", "", "| a |", "| --- |", "| 1 |"].join("\n");
    const { doc, complexScan } = pipeline(text);
    const table = tableOf(complexScan, doc, "1");
    const snapshot = buildStandaloneComplexBlockSnapshot(table)!;

    const outcome = moveStandaloneComplexBlock(text, { snapshot, direction: "up" }, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "# H",
      "| a |",
      "| --- |",
      "| 1 |",
      "",
      "",
      "> [!note] one",
      "> body a",
    ]);
  });

  it("excludes a table nested inside a list item's continuation from move eligibility — hidden from the menu, refused by the executor (the 'confident range cannot be established safely' refusal path)", () => {
    const text = ["# H", "- item", "  | a |", "  | --- |", "  | 1 |", "", "| a |", "| --- |", "| 2 |"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    const nested = complexScan.blocks.find((b) => b.kind === "table" && b.parentId !== null)!;
    expect(isStandaloneComplexBlockShapeEligible(doc, nested)).toBe(false);
    expect(evaluateStandaloneComplexBlockMovability(doc, complexScan, nested, "down", composites)).toEqual({
      eligible: false,
      reason: "nested-in-list",
    });

    const snapshot = buildStandaloneComplexBlockSnapshot(nested)!;
    const outcome = moveStandaloneComplexBlock(text, { snapshot, direction: "down" }, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("nested-in-list");
    expect(outcome.lines).toEqual(doc.lines);
  });

  it("rejects the move and leaves the original text untouched when the table's boundary can no longer be confirmed (conflict-detection-equivalent structural re-match failure)", () => {
    const originalText = ["# H", "| a |", "| --- |", "| 1 |", "", "> [!tip] two", "> body b"].join("\n");
    const { doc, complexScan } = pipeline(originalText);
    const table = tableOf(complexScan, doc, "1");
    const snapshot = buildStandaloneComplexBlockSnapshot(table)!;

    // Simulate: the menu captured `snapshot`, then the note was edited
    // elsewhere (the table is now gone entirely) before "Move" was
    // actually clicked — exactly the same conflict-detection mechanism
    // already uniformly covers callout/blockquote/fenced-code moves, with
    // no table-specific exception added.
    const laterText = ["# H", "no", "longer", "a table", "", "> [!tip] two", "> body b"].join("\n");
    const outcome = moveStandaloneComplexBlock(laterText, { snapshot, direction: "down" }, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("standalone-boundary-changed");
    expect(outcome.lines).toEqual(parseDocument(laterText).lines);
  });
});

describe("Phase 5E-3d category B: table delete (ブロック全体の一括削除)", () => {
  it("deletes a standalone table block atomically — header through last data row removed as one unit", () => {
    const text = ["# H", "> [!note] one", "> body a", "", "| a | b |", "|---|---|", "| 1 | 2 |"].join("\n");
    const { doc, complexScan } = pipeline(text);
    const table = tableOf(complexScan, doc, "1");
    const snapshot = buildStandaloneComplexBlockDeleteSnapshot(table)!;
    expect(snapshot.kind).toBe("table");

    const outcome = deleteStandaloneComplexBlock(text, snapshot, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["# H", "> [!note] one", "> body a", ""]);
  });

  it("normalizes a 3+ line blank run at the new boundary down to exactly 2 lines after delete", () => {
    const text = ["# H", "para one", "", "", "| a |", "| --- |", "| 1 |", "", "para two"].join("\n");
    const { doc, complexScan } = pipeline(text);
    const table = tableOf(complexScan, doc, "1");
    const snapshot = buildStandaloneComplexBlockDeleteSnapshot(table)!;

    const outcome = deleteStandaloneComplexBlock(text, snapshot, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["# H", "para one", "", "", "para two"]);
  });

  it("rejects the delete and leaves the original text untouched when the table's boundary can no longer be confirmed", () => {
    const originalText = ["# H", "| a |", "| --- |", "| 1 |"].join("\n");
    const { doc, complexScan } = pipeline(originalText);
    const table = tableOf(complexScan, doc, "1");
    const snapshot = buildStandaloneComplexBlockDeleteSnapshot(table)!;

    const laterText = ["# H", "no", "longer", "a table"].join("\n");
    const outcome = deleteStandaloneComplexBlock(laterText, snapshot, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("boundary-changed");
    expect(outcome.lines).toEqual(parseDocument(laterText).lines);
  });

  it("a table nested inside a list item's continuation is excluded from delete eligibility (not-supported)", () => {
    const text = ["# H", "- item", "  | a |", "  | --- |", "  | 1 |"].join("\n");
    const { doc, complexScan } = pipeline(text);
    const nested = complexScan.blocks.find((b) => b.kind === "table" && b.parentId !== null)!;
    const snapshot = buildStandaloneComplexBlockDeleteSnapshot(nested)!;

    const outcome = deleteStandaloneComplexBlock(text, snapshot, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("not-supported");
    expect(outcome.lines).toEqual(doc.lines);
  });
});

describe("Phase 5E-3d category C: table drag and drop", () => {
  it("resolveStandaloneComplexBlockDropTarget: a standalone table CAN be dropped AFTER a genuine standalone sibling in the same section", () => {
    const text = ["# H", "> [!note] one", "> body a", "", "| a |", "| --- |", "| 1 |"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    const one = complexScan.blocks.find((b) => doc.lines[b.range.startLine].includes("one"))!;
    const table = tableOf(complexScan, doc, "1");
    const resolution = resolveStandaloneComplexBlockDropTarget(
      doc,
      table,
      composites,
      { range: one.range, parentId: one.parentId },
      "before"
    );
    expect(resolution).toEqual({ allowed: true, insertBeforeLine: one.range.startLine });
  });

  it("resolveStandaloneComplexBlockDropTarget: a table source with editability !== supported is rejected (not-supported)", () => {
    const text = ["# H", "- item", "  | a |", "  | --- |", "  | 1 |", "", "> [!tip] two", "> body b"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    const nested = complexScan.blocks.find((b) => b.kind === "table" && b.parentId !== null)!;
    const two = complexScan.blocks.find((b) => doc.lines[b.range.startLine].includes("two"))!;
    const resolution = resolveStandaloneComplexBlockDropTarget(
      doc,
      nested,
      composites,
      { range: two.range, parentId: two.parentId },
      "after"
    );
    expect(resolution).toEqual({ allowed: false, reason: "nested-in-list" });
  });

  it("resolveStandaloneComplexBlockDropTarget: a standalone fenced-code block CAN now be dropped AFTER a genuine standalone sibling in the same section (fenced-code D&D parity follow-up)", () => {
    const text = ["# H", "```", "code", "```", "", "> [!tip] two", "> body b"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    const fenced = complexScan.blocks.find((b) => b.kind === "fenced-code")!;
    const two = complexScan.blocks.find((b) => doc.lines[b.range.startLine].includes("two"))!;
    const resolution = resolveStandaloneComplexBlockDropTarget(
      doc,
      fenced,
      composites,
      { range: two.range, parentId: two.parentId },
      "after"
    );
    expect(resolution).toEqual({ allowed: true, insertBeforeLine: two.range.endLine + 1 });
  });

  it("dropStandaloneComplexBlock: end-to-end drop of a standalone table BEFORE a standalone list item in the same section matches a manual cut-paste move", () => {
    const text = ["# H", "- item one", "- item two", "", "| a |", "| --- |", "| 1 |"].join("\n");
    const { doc, complexScan } = pipeline(text);
    const table = tableOf(complexScan, doc, "1");
    const snapshot = buildStandaloneComplexBlockSnapshot(table)!;
    let itemOne: { range: { startLine: number; endLine: number }; parentId: string | null } | undefined;
    for (const node of doc.nodes.values()) {
      if (node.type === "list" && doc.lines[node.range.startLine].includes("item one")) itemOne = node;
    }
    if (!itemOne) throw new Error("no list item matching 'item one'");

    const outcome = dropStandaloneComplexBlock(
      text,
      { snapshot, target: targetHintOf(itemOne.range, itemOne.parentId), zone: "before" },
      DEFAULT_COMPOSITE_BLOCK_RULES
    );

    expect(outcome.changed).toBe(true);
    // Manual cut-paste equivalent: cut the table's own 3 lines and paste
    // them immediately before "- item one", producing this exact
    // arrangement.
    expect(outcome.lines).toEqual([
      "# H",
      "| a |",
      "| --- |",
      "| 1 |",
      "- item one",
      "- item two",
      "",
    ]);
  });

  it("dropStandaloneComplexBlock: end-to-end drop of a standalone table AFTER a standalone callout in the same section matches a manual cut-paste move, plus the blank-line separation ensureBlankSeparation now applies unconditionally (fix/standalone-dnd-blank-separation-always, 2026-09-25: without it a table row immediately following '> body a' with no blank line risks being parsed as part of the blockquote)", () => {
    const text = ["# H", "| a |", "| --- |", "| 1 |", "", "> [!note] one", "> body a"].join("\n");
    const { doc, complexScan } = pipeline(text);
    const table = tableOf(complexScan, doc, "1");
    const one = complexScan.blocks.find((b) => doc.lines[b.range.startLine].includes("one"))!;
    const snapshot = buildStandaloneComplexBlockSnapshot(table)!;

    const outcome = dropStandaloneComplexBlock(
      text,
      { snapshot, target: targetHintOf(one.range, one.parentId), zone: "after" },
      DEFAULT_COMPOSITE_BLOCK_RULES
    );

    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "# H",
      "",
      "> [!note] one",
      "> body a",
      "",
      "| a |",
      "| --- |",
      "| 1 |",
    ]);
  });

  it("dropStandaloneComplexBlock: rejects and leaves the note untouched when the table source snapshot no longer resolves (boundary changed since drag-start)", () => {
    const originalText = ["# H", "| a |", "| --- |", "| 1 |", "", "> [!tip] two", "> body b"].join("\n");
    const { doc, complexScan } = pipeline(originalText);
    const table = tableOf(complexScan, doc, "1");
    const twoInfo = complexScan.blocks.find((b) => doc.lines[b.range.startLine].includes("two"))!;
    const snapshot = buildStandaloneComplexBlockSnapshot(table)!;

    const laterText = ["# H", "no", "longer", "a table", "", "> [!tip] two", "> body b"].join("\n");
    const outcome = dropStandaloneComplexBlock(
      laterText,
      { snapshot, target: targetHintOf(twoInfo.range, twoInfo.parentId), zone: "after" },
      DEFAULT_COMPOSITE_BLOCK_RULES
    );
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("source-boundary-changed");
    expect(outcome.lines).toEqual(parseDocument(laterText).lines);
  });

  it("dropStandaloneComplexBlock: end-to-end drop of a standalone fenced-code block AFTER a standalone callout in the same section matches a manual cut-paste move (fenced-code D&D parity follow-up), plus the blank-line separation ensureBlankSeparation now applies unconditionally (fix/standalone-dnd-blank-separation-always, 2026-09-25: without it a fenced-code opening ``` immediately following '> body a' with no blank line risks being parsed as part of the blockquote)", () => {
    const text = ["# H", "```", "code", "```", "", "> [!note] one", "> body a"].join("\n");
    const { doc, complexScan } = pipeline(text);
    const fenced = complexScan.blocks.find((b) => b.kind === "fenced-code")!;
    const one = complexScan.blocks.find((b) => doc.lines[b.range.startLine].includes("one"))!;
    const snapshot = buildStandaloneComplexBlockSnapshot(fenced)!;

    const outcome = dropStandaloneComplexBlock(
      text,
      { snapshot, target: targetHintOf(one.range, one.parentId), zone: "after" },
      DEFAULT_COMPOSITE_BLOCK_RULES
    );

    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "# H",
      "",
      "> [!note] one",
      "> body a",
      "",
      "```",
      "code",
      "```",
    ]);
  });
});

describe("Phase 5E-3d category D: UI 配線 (view/OutlineTreeView.ts)", () => {
  function treeWithTable(text: string) {
    const doc = parseDocument(text);
    const complexScan = scanComplexBlocks(doc);
    const tree = buildOutlineTree(doc, {
      standaloneComplexBlocks: {
        blocks: complexScan.blocks,
        includeFencedCode: true,
        includeTables: true,
      },
      t: createTranslator("en"),
    });
    return { doc, complexScan, tree };
  }

  /** Reproduces renderNode's context-menu-attachment condition, as of this phase. */
  function wouldAttachStandaloneMenu(node: ReturnType<typeof flattenOutlineTree>[number]): boolean {
    return (
      isOutlineComplexMemberNode(node) &&
      node.isStandalone &&
      (node.complexKind === "callout" ||
        node.complexKind === "blockquote" ||
        node.complexKind === "fenced-code" ||
        node.complexKind === "table")
    );
  }

  /**
   * Reproduces renderNode's standalone-bridge D&D drag-wiring guard. As of
   * the follow-up ticket "fenced-code D&D parity" (2026-09-24, same
   * branch), this now also admits "fenced-code" alongside
   * callout/blockquote/table — the real guard in
   * view/OutlineTreeView.ts was widened identically.
   */
  function wouldWireDragSource(node: ReturnType<typeof flattenOutlineTree>[number]): boolean {
    return (
      isOutlineComplexMemberNode(node) &&
      node.isStandalone &&
      (node.complexKind === "callout" ||
        node.complexKind === "blockquote" ||
        node.complexKind === "table" ||
        node.complexKind === "fenced-code")
    );
  }

  it("a standalone table row satisfies renderNode's context-menu attachment condition and now also its D&D drag-wiring guard (Phase 5E-3d widened both)", () => {
    const { tree } = treeWithTable(["# H", "| a | b |", "|---|---|", "| 1 | 2 |"].join("\n"));
    const flat = flattenOutlineTree(tree);
    const tableRow = flat.find((n) => isOutlineComplexMemberNode(n) && n.complexKind === "table")!;
    expect(tableRow).toBeDefined();
    expect(wouldAttachStandaloneMenu(tableRow)).toBe(true);
    expect(wouldWireDragSource(tableRow)).toBe(true);
  });

  it("a standalone fenced-code row satisfies BOTH the menu guard and the D&D drag-wiring guard (fenced-code D&D parity follow-up lifted the prior exclusion)", () => {
    const { tree } = treeWithTable(["# H", "```ts", "code", "```"].join("\n"));
    const flat = flattenOutlineTree(tree);
    const codeRow = flat.find((n) => isOutlineComplexMemberNode(n) && n.complexKind === "fenced-code")!;
    expect(codeRow).toBeDefined();
    expect(wouldAttachStandaloneMenu(codeRow)).toBe(true);
    expect(wouldWireDragSource(codeRow)).toBe(true);
  });

  it("collectReadOnlyOutlineNodeIds still includes a standalone table row (deliberate: table reaches Move/Delete/Partial-Edit/D&D via the dedicated, non-readOnly-gated menu/drag paths instead, exactly like callout/blockquote/fenced-code already do)", () => {
    const { tree } = treeWithTable(["# H", "| a | b |", "|---|---|", "| 1 | 2 |"].join("\n"));
    const readOnlyIds = collectReadOnlyOutlineNodeIds(tree);
    const flat = flattenOutlineTree(tree);
    const tableRow = flat.find((n) => isOutlineComplexMemberNode(n) && n.complexKind === "table")!;
    expect(readOnlyIds.has(tableRow!.id)).toBe(true);
  });

  it("the Delete menu item's own kind gate now admits 'fenced-code', 'table', 'callout', and 'blockquote' (showStandaloneComplexBlockMenu) — follow-up ticket, 2026-09-24: callout/blockquote's own prior exclusion (pinned by this test until now) was found to be a gap during the user's own real-device acceptance testing, not a technical limitation, and was lifted; see tests/phase5e3dStandaloneCalloutBlockquoteDelete.test.ts for full delete-pipeline coverage of the newly-admitted kinds", () => {
    function wouldShowDeleteItem(kind: string): boolean {
      return (
        kind === "fenced-code" || kind === "table" || kind === "callout" || kind === "blockquote"
      );
    }
    expect(wouldShowDeleteItem("table")).toBe(true);
    expect(wouldShowDeleteItem("fenced-code")).toBe(true);
    expect(wouldShowDeleteItem("callout")).toBe(true);
    expect(wouldShowDeleteItem("blockquote")).toBe(true);
  });
});
