/**
 * Phase 5E-1 ("fenced code block の raw Partial Edit・移動・削除"): tests for
 * the three fenced-code-only operations this phase adds — Move (前後兄弟
 * との入れ替え), Delete (ブロック全体の一括削除), and raw Partial Edit
 * (フェンス記法を含むMarkdownそのものを1編集単位として編集) — plus the
 * insertionFramework fenced-code implementation and the UI-wiring/
 * regression checks this phase's own completion criteria require.
 *
 * See docs/phase5e1_fenced-code-partial-edit-move-delete-design-memo.md
 * for the full design, including §3's documentation of the two deliberate
 * deviations from the literal instruction text this phase made (a new,
 * narrowly fenced-code-scoped delete module rather than "reusing" a
 * nonexistent callout/blockquote delete pipeline; and NOT altering
 * collectReadOnlyOutlineNodeIds's kind-inclusion logic, so fenced-code
 * stays in the read-only set exactly like callout/blockquote always have
 * — full Move/Delete/Partial-Edit capability comes from the dedicated,
 * `!readOnly`-independent showStandaloneComplexBlockMenu path instead).
 * Category D below tests the ACTUAL, current behavior per that documented
 * decision, not the literal instruction text.
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
import { applySubtreeEdit, extractSubtreeText } from "../src/edit/partialEdit";
import { resolveInsertion, InsertionRequest } from "../src/tree/insertionFramework";

/** Real pipeline: parse -> scan -> match, mirroring the other *StandaloneComplexBlock test files' own pipeline() helper. */
function pipeline(text: string, rules: CompositeBlockRule[] = DEFAULT_COMPOSITE_BLOCK_RULES) {
  const doc = parseDocument(text);
  const complexScan = scanComplexBlocks(doc);
  const composites = matchCompositeBlocks(doc, complexScan, rules);
  return { doc, complexScan, composites };
}

/** Finds the fenced-code ComplexBlockInfo whose own range includes a line containing `needle`. */
function fencedCodeOf(complexScan: ComplexBlockScanResult, doc: ReturnType<typeof parseDocument>, needle: string): ComplexBlockInfo {
  const found = complexScan.blocks.find(
    (b) => b.kind === "fenced-code" && doc.lines.slice(b.range.startLine, b.range.endLine + 1).some((l) => l.includes(needle))
  );
  if (!found) throw new Error(`no fenced-code block matching "${needle}"`);
  return found;
}

describe("Phase 5E-1 category A: move (前後兄弟との入れ替え)", () => {
  it("swaps a standalone fenced-code block with its previous sibling (direction up), preserving fence+body verbatim", () => {
    const text = ["# H", "> [!note] one", "> body a", "", "```js", "console.log(1);", "```"].join("\n");
    const { doc, complexScan } = pipeline(text);
    const fenced = fencedCodeOf(complexScan, doc, "console.log");
    const snapshot = buildStandaloneComplexBlockSnapshot(fenced)!;
    expect(snapshot.kind).toBe("fenced-code");

    const outcome = moveStandaloneComplexBlock(text, { snapshot, direction: "up" }, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "# H",
      "```js",
      "console.log(1);",
      "```",
      "",
      "> [!note] one",
      "> body a",
    ]);
  });

  it("swaps a standalone fenced-code block with its next sibling (direction down), preserving fence+body verbatim", () => {
    const text = ["# H", "```js", "console.log(2);", "```", "", "> [!tip] two", "> body b"].join("\n");
    const { doc, complexScan } = pipeline(text);
    const fenced = fencedCodeOf(complexScan, doc, "console.log");
    const snapshot = buildStandaloneComplexBlockSnapshot(fenced)!;

    const outcome = moveStandaloneComplexBlock(text, { snapshot, direction: "down" }, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "# H",
      "> [!tip] two",
      "> body b",
      "",
      "```js",
      "console.log(2);",
      "```",
    ]);
  });

  it("excludes an unclosed fenced-code block from move eligibility — hidden from the menu, refused by the executor", () => {
    // buildStandaloneComplexBlockSnapshot itself is a pure kind-only
    // projector (unchanged behavior for callout/blockquote too — it never
    // checked editability even before this phase), so it still returns a
    // snapshot here. The actual "excluded from move / hidden from menu"
    // enforcement point is evaluateStandaloneComplexBlockMovability (what
    // showStandaloneComplexBlockMenu itself calls to decide whether to
    // show "Move up"/"Move down" at all) and moveStandaloneComplexBlock's
    // own re-verification of it at execute time — both correctly reject
    // an unterminated fence via its editability field.
    const text = ["# H", "```ts", "const x = 1;"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    const unterminated = complexScan.blocks.find((b) => b.kind === "fenced-code")!;
    expect(unterminated.editability).not.toBe("supported");
    expect(isStandaloneComplexBlockShapeEligible(doc, unterminated)).toBe(false);
    expect(evaluateStandaloneComplexBlockMovability(doc, complexScan, unterminated, "down", composites)).toEqual({
      eligible: false,
      reason: "not-supported",
    });

    const snapshot = buildStandaloneComplexBlockSnapshot(unterminated)!;
    const outcome = moveStandaloneComplexBlock(text, { snapshot, direction: "down" }, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(false);
  });

  it("preserves the exact blank-line gap between blocks after a move (gap is carried, never consumed or duplicated)", () => {
    const text = ["# H", "> [!note] one", "> body a", "", "", "```js", "code", "```"].join("\n");
    const { doc, complexScan } = pipeline(text);
    const fenced = fencedCodeOf(complexScan, doc, "code");
    const snapshot = buildStandaloneComplexBlockSnapshot(fenced)!;

    const outcome = moveStandaloneComplexBlock(text, { snapshot, direction: "up" }, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(true);
    // The 2-line gap that sat between the callout and the fenced-code
    // block stays exactly 2 lines, now sitting between the swapped blocks
    // in the same relative position (swapBlocks's own documented "gap
    // stays in place" contract — src/move/moveBlock.ts).
    expect(outcome.lines).toEqual([
      "# H",
      "```js",
      "code",
      "```",
      "",
      "",
      "> [!note] one",
      "> body a",
    ]);
  });
});

describe("Phase 5E-1 category B: delete (ブロック全体の一括削除)", () => {
  it("deletes a standalone fenced-code block atomically — open fence through close fence removed as one unit", () => {
    const text = ["# H", "> [!note] one", "> body a", "", "```js", "console.log(1);", "```"].join("\n");
    const { doc, complexScan } = pipeline(text);
    const fenced = fencedCodeOf(complexScan, doc, "console.log");
    const snapshot = buildStandaloneComplexBlockDeleteSnapshot(fenced)!;
    expect(snapshot.kind).toBe("fenced-code");

    const outcome = deleteStandaloneComplexBlock(text, snapshot, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["# H", "> [!note] one", "> body a", ""]);
  });

  it("normalizes a 3+ line blank run at the new boundary down to exactly 2 lines after delete", () => {
    const text = ["# H", "para one", "", "", "```js", "code", "```", "", "para two"].join("\n");
    const { doc, complexScan } = pipeline(text);
    const fenced = fencedCodeOf(complexScan, doc, "code");
    const snapshot = buildStandaloneComplexBlockDeleteSnapshot(fenced)!;

    const outcome = deleteStandaloneComplexBlock(text, snapshot, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(true);
    // 2 blank lines before + 1 blank line after the deleted block would
    // combine into a 3-line run at the new boundary — normalized to 2.
    expect(outcome.lines).toEqual(["# H", "para one", "", "", "para two"]);
  });

  it("rejects the delete and leaves the original text untouched when the target's boundary can no longer be confirmed", () => {
    const originalText = ["# H", "```js", "code", "```"].join("\n");
    const { doc, complexScan } = pipeline(originalText);
    const fenced = fencedCodeOf(complexScan, doc, "code");
    const snapshot = buildStandaloneComplexBlockDeleteSnapshot(fenced)!;

    // Simulate: the menu captured `snapshot`, then the note was edited
    // elsewhere (the fenced-code block is now gone entirely) before
    // "Delete" was actually clicked.
    // At least as many lines as snapshot.range.endLine requires (so this
    // exercises the structural re-match failure, "boundary-changed" —
    // not the separate, earlier-checked "range-invalid" self-consistency
    // guard, which only fires when the snapshot's own range no longer
    // fits inside the document at all).
    const laterText = ["# H", "no", "longer", "fenced"].join("\n");
    const outcome = deleteStandaloneComplexBlock(laterText, snapshot, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("boundary-changed");
    expect(outcome.lines).toEqual(parseDocument(laterText).lines);
  });
});

describe("Phase 5E-1 category C: raw Partial Edit", () => {
  it("extractComplexBlockText/extractSubtreeText resolves a standalone fenced-code block as ok:true, raw text including fence lines", () => {
    const text = ["# H", "```js", "code", "```"].join("\n");
    const doc = parseDocument(text);
    const info = scanComplexBlocks(doc).blocks.find((b) => b.kind === "fenced-code")!;
    const outcome = extractSubtreeText(doc, info.id);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.kind).toBe("fenced-code");
      expect(outcome.text).toBe(["```js", "code", "```"].join("\n"));
    }
  });

  it("Apply rejects (fenced-code-invalid-open) when the edited result's first line is not a valid opening fence", () => {
    const text = ["# H", "```js", "code", "```"].join("\n");
    const doc = parseDocument(text);
    const info = scanComplexBlocks(doc).blocks.find((b) => b.kind === "fenced-code")!;
    const original = extractSubtreeText(doc, info.id);
    expect(original.ok).toBe(true);

    const outcome = applySubtreeEdit(doc, info.id, original.text, ["not a fence at all", "code", "```"].join("\n"));
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("fenced-code-invalid-open");
    expect(outcome.lines).toEqual(doc.lines);
  });

  it("Apply rejects (fenced-code-invalid-close) when the edited result's last line is not a valid closing fence", () => {
    const text = ["# H", "```js", "code", "```"].join("\n");
    const doc = parseDocument(text);
    const info = scanComplexBlocks(doc).blocks.find((b) => b.kind === "fenced-code")!;
    const original = extractSubtreeText(doc, info.id);
    expect(original.ok).toBe(true);

    const outcome = applySubtreeEdit(doc, info.id, original.text, ["```js", "code", "not a closing fence"].join("\n"));
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("fenced-code-invalid-close");
    expect(outcome.lines).toEqual(doc.lines);
  });

  it("conflict detection works equivalently to the existing callout/blockquote mechanism — refuses Apply when the note changed since the pane loaded it", () => {
    const originalText = ["```js", "original code"].join("\n") + "\n```";
    const laterText = ["# A", "```js", "changed by someone else"].join("\n") + "\n```";
    const doc = parseDocument(laterText);
    const info = scanComplexBlocks(doc).blocks.find((b) => b.kind === "fenced-code")!;

    const outcome = applySubtreeEdit(doc, info.id, originalText, "```js\nmy pane's edit\n```");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("conflict");
    expect(outcome.lines).toEqual(doc.lines);
  });

  it("a fenced-code block with a Mermaid info string is extracted/edited the exact same way as any other fenced-code block", () => {
    const text = ["# H", "```mermaid", "graph TD", "A-->B", "```"].join("\n");
    const doc = parseDocument(text);
    const info = scanComplexBlocks(doc).blocks.find((b) => b.kind === "fenced-code")!;
    const original = extractSubtreeText(doc, info.id);
    expect(original.ok).toBe(true);
    if (original.ok) {
      expect(original.text).toBe(["```mermaid", "graph TD", "A-->B", "```"].join("\n"));
    }

    const outcome = applySubtreeEdit(doc, info.id, original.text, ["```mermaid", "graph TD", "A-->B-->C", "```"].join("\n"));
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["# H", "```mermaid", "graph TD", "A-->B-->C", "```"]);
  });
});

describe("Phase 5E-1 category D: UI 配線 (view/OutlineTreeView.ts)", () => {
  function treeWithFencedCode(text: string) {
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

  it("collectReadOnlyOutlineNodeIds still includes a standalone fenced-code row (deliberate: see design memo §3) — it reaches full Move/Delete/Partial-Edit capability via the dedicated, non-readOnly-gated menu instead, exactly like callout/blockquote always have", () => {
    const { tree } = treeWithFencedCode(["# H", "```ts", "code", "```"].join("\n"));
    const readOnlyIds = collectReadOnlyOutlineNodeIds(tree);
    const flat = flattenOutlineTree(tree);
    const codeRow = flat.find((n) => isOutlineComplexMemberNode(n) && n.complexKind === "fenced-code");
    expect(codeRow).toBeDefined();
    expect(readOnlyIds.has(codeRow!.id)).toBe(true);
  });

  it("table complex-member nodes remain in the read-only set, unchanged by Phase 5E-1", () => {
    const { tree } = treeWithFencedCode(["# H", "| a | b |", "|---|---|", "| 1 | 2 |"].join("\n"));
    const readOnlyIds = collectReadOnlyOutlineNodeIds(tree);
    const flat = flattenOutlineTree(tree);
    const tableRow = flat.find((n) => isOutlineComplexMemberNode(n) && n.complexKind === "table");
    expect(tableRow).toBeDefined();
    expect(readOnlyIds.has(tableRow!.id)).toBe(true);
  });

  it("a standalone fenced-code row satisfies renderNode's (as of Phase 5E-2A) context-menu attachment condition — \"Open in Partial Edit\"/Move/Delete are shown; a table row also attaches the menu, but only gets Open in Partial Edit (see tests/phase5e2aTableRawPartialEdit.test.ts's own category D for that distinction)", () => {
    // Reproduces view/OutlineTreeView.ts's renderNode condition verbatim.
    // As of Phase 5E-1 this was `isComplexMember && node.isStandalone &&
    // (complexKind === "callout" || "blockquote" || "fenced-code")`, and
    // this test originally asserted a table row did NOT attach the menu
    // at all. Phase 5E-2A widens the REAL guard to also admit "table" (see
    // view/OutlineTreeView.ts's renderNode) — table now attaches this
    // same menu too, so this local reproduction is updated to match,
    // rather than silently drifting from the real condition while still
    // "passing" against its own stale copy. The menu still shows table
    // only "Open in Partial Edit" (no Move/Delete) — that distinction is
    // enforced inside showStandaloneComplexBlockMenu itself, not by this
    // attachment guard, and is covered by
    // tests/phase5e2aTableRawPartialEdit.test.ts's own category D.
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
    const { tree } = treeWithFencedCode(
      ["# H", "```ts", "code", "```", "| a | b |", "|---|---|", "| 1 | 2 |"].join("\n")
    );
    const flat = flattenOutlineTree(tree);
    const codeRow = flat.find((n) => isOutlineComplexMemberNode(n) && n.complexKind === "fenced-code")!;
    const tableRow = flat.find((n) => isOutlineComplexMemberNode(n) && n.complexKind === "table")!;
    expect(wouldAttachStandaloneMenu(codeRow)).toBe(true);
    expect(wouldAttachStandaloneMenu(tableRow)).toBe(true);
  });
});

describe("Phase 5E-1 category E: insertionFramework の fenced-code 実装有効化", () => {
  it("the two former it.todo cases (unclosed-fence target, empty-document target) now resolve to ok:false, never a throw or a guessed line", () => {
    const unterminatedText = ["# H", "```ts", "const x = 1;"].join("\n");
    const doc = parseDocument(unterminatedText);
    const unterminated = scanComplexBlocks(doc).blocks.find((b) => b.kind === "fenced-code")!;
    const requestA: InsertionRequest = { targetNodeId: unterminated.id, kind: "fenced-code", position: "after" };
    const resultA = resolveInsertion(requestA, unterminatedText, undefined);
    expect(resultA.ok).toBe(false);

    const requestB: InsertionRequest = { targetNodeId: "does-not-exist", kind: "fenced-code", position: "before" };
    const resultB = resolveInsertion(requestB, "", undefined);
    expect(resultB.ok).toBe(false);
    if (!resultB.ok) expect(resultB.reason).toBe("target-not-found");
  });

  it("fenced-code \"before\" insertion returns the correct line number and padded insert text", () => {
    const text = ["# H", "```ts", "existing", "```", "para after"].join("\n");
    const doc = parseDocument(text);
    const target = scanComplexBlocks(doc).blocks.find((b) => b.kind === "fenced-code")!;
    const request: InsertionRequest = { targetNodeId: target.id, kind: "fenced-code", position: "before" };

    const result = resolveInsertion(request, text, undefined);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.insertAtLine).toBe(target.range.startLine);
      // Far boundary ("# H") is not blank -> padded; near boundary
      // (target's own first line follows immediately) -> always padded.
      expect(result.insertText).toBe(["", "```", "```", "", ""].join("\n"));
    }
  });

  it("fenced-code \"after\" insertion returns the correct line number and does not double an already-blank far boundary", () => {
    const text = ["# H", "```ts", "existing", "```", "", "para after"].join("\n");
    const doc = parseDocument(text);
    const target = scanComplexBlocks(doc).blocks.find((b) => b.kind === "fenced-code")!;
    const request: InsertionRequest = { targetNodeId: target.id, kind: "fenced-code", position: "after" };

    const result = resolveInsertion(request, text, undefined);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.insertAtLine).toBe(target.range.endLine + 1);
      // Near boundary (target's own last line precedes insert) -> always
      // padded. Far boundary is already blank ("" at line 4) -> NOT
      // double-padded.
      expect(result.insertText).toBe(["", "```", "```", ""].join("\n"));
    }
  });

  it("fenced-code-mermaid insertion's text includes the \"mermaid\" info string on the opening fence", () => {
    const text = ["# H", "```ts", "existing", "```"].join("\n");
    const doc = parseDocument(text);
    const target = scanComplexBlocks(doc).blocks.find((b) => b.kind === "fenced-code")!;
    const request: InsertionRequest = { targetNodeId: target.id, kind: "fenced-code-mermaid", position: "after" };

    const result = resolveInsertion(request, text, undefined);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.insertText).toContain("```mermaid");
      expect(result.insertText).toContain("```\n");
    }
  });
});

describe("Phase 5E-1 category F: 既存機能回帰", () => {
  it("with showFencedCodeInOutline (includeFencedCode) false, Tree output is byte-identical to Phase 5E-0's own output", () => {
    const text = ["# H", "- item", "  continuation", "> [!note] Title", "> body"].join("\n");
    const doc = parseDocument(text);
    const complexScan = scanComplexBlocks(doc);
    const before = buildOutlineTree(doc, {
      includeLists: true,
      standaloneComplexBlocks: { blocks: complexScan.blocks },
      paragraphs: { blocks: complexScan.blocks },
      t: createTranslator("en"),
    });
    const after = buildOutlineTree(doc, {
      includeLists: true,
      standaloneComplexBlocks: {
        blocks: complexScan.blocks,
        includeFencedCode: false,
        includeTables: false,
      },
      paragraphs: { blocks: complexScan.blocks },
      t: createTranslator("en"),
    });
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });

  it("extractComplexBlockText/extractSubtreeText returned ok:false for a table node as of Phase 5E-1 — Phase 5E-2A intentionally changes this (see tests/phase5e2aTableRawPartialEdit.test.ts)", () => {
    // This test originally pinned "table stays ok:false, unchanged by
    // Phase 5E-1" as a Phase 5E-1-era regression guard. Phase 5E-2A
    // ("Markdown table の raw Partial Edit・Apply 検証・安全な書き戻し")
    // deliberately widens extractComplexBlockText/extractSubtreeText to
    // also accept kind "table" (its own explicit brief) — so that premise
    // is no longer true, and this test is updated to confirm the new,
    // intentional behavior instead of continuing to pin the old one.
    // tests/phase5e2aTableRawPartialEdit.test.ts's own category A has the
    // deeper coverage for this; this test remains here only as this
    // phase's own historical regression marker, now pointing the other way.
    const text = ["# H", "| a | b |", "|---|---|", "| 1 | 2 |"].join("\n");
    const doc = parseDocument(text);
    const info = scanComplexBlocks(doc).blocks.find((b) => b.kind === "table")!;
    const outcome = extractSubtreeText(doc, info.id);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.kind).toBe("table");
  });
});
