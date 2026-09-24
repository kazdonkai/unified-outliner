/**
 * Phase 5E-2A ("Markdown table の raw Partial Edit・Apply 検証・安全な書き
 * 戻し"): tests for the table-only raw Partial Edit operation this phase
 * adds — extraction (Open in Partial Edit), Apply-time structural
 * validation (検証1〜4), conflict detection reuse, the UI-wiring
 * consequence (table now attaches the standalone context menu, but only
 * ever gets "Open in Partial Edit" — no Move/Delete), and the
 * insertionFramework table implementation.
 *
 * See docs/phase5e2a_table-raw-partial-edit-design-memo.md for the full
 * design. table のmove・削除・新規挿入UI・セル単位の編集・Table Modeは
 * 本フェーズの対象外（挿入framework自体のresolveInsertionは実装するが、
 * UIからの起動経路は今回も未接続 — Phase 5E-0.5/5E-1と同じ境界）。
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { scanComplexBlocks } from "../src/parser/complexBlocks";
import { ComplexBlockInfo, ComplexBlockScanResult } from "../src/model/complexBlock";
import {
  buildOutlineTree,
  collectReadOnlyOutlineNodeIds,
  flattenOutlineTree,
  isOutlineComplexMemberNode,
} from "../src/tree/buildOutlineTree";
import { createTranslator } from "../src/i18n";
import { buildStandaloneComplexBlockSnapshot } from "../src/edit/moveStandaloneComplexBlock";
import { applySubtreeEdit, extractSubtreeText } from "../src/edit/partialEdit";
import { resolveInsertion, InsertionRequest } from "../src/tree/insertionFramework";

/** Finds the table ComplexBlockInfo whose own range includes a line containing `needle`. */
function tableOf(complexScan: ComplexBlockScanResult, doc: ReturnType<typeof parseDocument>, needle: string): ComplexBlockInfo {
  const found = complexScan.blocks.find(
    (b) => b.kind === "table" && doc.lines.slice(b.range.startLine, b.range.endLine + 1).some((l) => l.includes(needle))
  );
  if (!found) throw new Error(`no table block found containing "${needle}"`);
  return found;
}

function treeWithTable(text: string) {
  const doc = parseDocument(text);
  const complexScan = scanComplexBlocks(doc);
  const tree = buildOutlineTree(doc, {
    includeLists: true,
    standaloneComplexBlocks: {
      blocks: complexScan.blocks,
      includeFencedCode: true,
      includeTables: true,
    },
    t: createTranslator("en"),
  });
  return { doc, complexScan, tree };
}

describe("Phase 5E-2A category A: Partial Edit 展開", () => {
  it("extractSubtreeText resolves a standalone table block as ok:true, kind 'table'", () => {
    const text = ["# H", "| a | b |", "|---|---|", "| 1 | 2 |"].join("\n");
    const doc = parseDocument(text);
    const info = scanComplexBlocks(doc).blocks.find((b) => b.kind === "table")!;
    const outcome = extractSubtreeText(doc, info.id);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.kind).toBe("table");
  });

  it("all table rows (header〜最終データ行) are extracted as one editing unit, byte-identical to the source", () => {
    const text = ["# H", "| a | b | c |", "|---|---|---|", "| 1 | 2 | 3 |", "| x | y | z |"].join("\n");
    const doc = parseDocument(text);
    const info = scanComplexBlocks(doc).blocks.find((b) => b.kind === "table")!;
    const outcome = extractSubtreeText(doc, info.id);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.text).toBe(["| a | b | c |", "|---|---|---|", "| 1 | 2 | 3 |", "| x | y | z |"].join("\n"));
    }
  });

  it("boundary blank lines immediately before/after the table are NOT included in the editing unit", () => {
    const text = ["# H", "intro paragraph", "", "| a | b |", "|---|---|", "| 1 | 2 |", "", "after paragraph"].join(
      "\n"
    );
    const doc = parseDocument(text);
    const info = scanComplexBlocks(doc).blocks.find((b) => b.kind === "table")!;
    const outcome = extractSubtreeText(doc, info.id);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.text).toBe(["| a | b |", "|---|---|", "| 1 | 2 |"].join("\n"));
      expect(outcome.text.startsWith("\n")).toBe(false);
      expect(outcome.text.endsWith("\n")).toBe(false);
    }
  });

  it("a table nested as a list item's child still resolves for Partial Edit, exactly like a section-level table", () => {
    const text = ["- item", "  | a | b |", "  |---|---|", "  | 1 | 2 |"].join("\n");
    const doc = parseDocument(text);
    const info = scanComplexBlocks(doc).blocks.find((b) => b.kind === "table")!;
    expect(info.parentId).not.toBeNull();
    const outcome = extractSubtreeText(doc, info.id);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.kind).toBe("table");
  });
});

describe("Phase 5E-2A category B: Apply 検証（合格ケース）", () => {
  it("最小構成（ヘッダー1行＋区切り1行＋データ1行）が合格する", () => {
    const text = ["| a |", "| --- |", "| 1 |"].join("\n");
    const doc = parseDocument(text);
    const info = scanComplexBlocks(doc).blocks.find((b) => b.kind === "table")!;
    const original = extractSubtreeText(doc, info.id);
    expect(original.ok).toBe(true);

    const outcome = applySubtreeEdit(doc, info.id, original.text, ["| x |", "| --- |", "| 9 |"].join("\n"));
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["| x |", "| --- |", "| 9 |"]);
  });

  it("先頭・末尾 pipe の有無が混在していても列数が一致すれば合格する", () => {
    const text = ["| a | b |", "|---|---|", "| 1 | 2 |"].join("\n");
    const doc = parseDocument(text);
    const info = scanComplexBlocks(doc).blocks.find((b) => b.kind === "table")!;
    const original = extractSubtreeText(doc, info.id);
    expect(original.ok).toBe(true);

    // Header/data rows: no leading/trailing pipe. Delimiter row: full pipes.
    const newText = ["a | b", "| --- | --- |", "1 | 2"].join("\n");
    const outcome = applySubtreeEdit(doc, info.id, original.text, newText);
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["a | b", "| --- | --- |", "1 | 2"]);
  });

  it("セルに日本語・特殊文字・空文字が含まれても合格する", () => {
    const text = ["| a |", "| --- |", "| 1 |"].join("\n");
    const doc = parseDocument(text);
    const info = scanComplexBlocks(doc).blocks.find((b) => b.kind === "table")!;
    const original = extractSubtreeText(doc, info.id);
    expect(original.ok).toBe(true);

    const newText = ["| 項目名 |", "| --- |", "|  |", "| a/b (c) — \"quoted\" |"].join("\n");
    const outcome = applySubtreeEdit(doc, info.id, original.text, newText);
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["| 項目名 |", "| --- |", "|  |", '| a/b (c) — "quoted" |']);
  });

  it("列数が3以上のtableが合格する", () => {
    const text = ["| a |", "| --- |", "| 1 |"].join("\n");
    const doc = parseDocument(text);
    const info = scanComplexBlocks(doc).blocks.find((b) => b.kind === "table")!;
    const original = extractSubtreeText(doc, info.id);
    expect(original.ok).toBe(true);

    const newText = ["| a | b | c | d |", "| --- | :--- | ---: | :---: |", "| 1 | 2 | 3 | 4 |"].join("\n");
    const outcome = applySubtreeEdit(doc, info.id, original.text, newText);
    expect(outcome.changed).toBe(true);
    expect(outcome.reason).toBeUndefined();
  });
});

describe("Phase 5E-2A category C: Apply 検証（拒否ケース）", () => {
  it("行数が2行以下の場合は拒否される（table-too-few-lines）", () => {
    const text = ["| a |", "| --- |", "| 1 |"].join("\n");
    const doc = parseDocument(text);
    const info = scanComplexBlocks(doc).blocks.find((b) => b.kind === "table")!;
    const original = extractSubtreeText(doc, info.id);
    expect(original.ok).toBe(true);

    const outcome = applySubtreeEdit(doc, info.id, original.text, ["| a |", "| --- |"].join("\n"));
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("table-too-few-lines");
    expect(outcome.lines).toEqual(doc.lines);
  });

  it("pipe を含まない行がある場合は拒否される（table-missing-pipe）", () => {
    const text = ["| a |", "| --- |", "| 1 |"].join("\n");
    const doc = parseDocument(text);
    const info = scanComplexBlocks(doc).blocks.find((b) => b.kind === "table")!;
    const original = extractSubtreeText(doc, info.id);
    expect(original.ok).toBe(true);

    const outcome = applySubtreeEdit(doc, info.id, original.text, ["| a |", "no pipe here", "| 1 |"].join("\n"));
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("table-missing-pipe");
    expect(outcome.lines).toEqual(doc.lines);
  });

  it("区切り行が不正な形式（ハイフンなし・数字を含む等）の場合は拒否される（table-invalid-delimiter）", () => {
    const text = ["| a |", "| --- |", "| 1 |"].join("\n");
    const doc = parseDocument(text);
    const info = scanComplexBlocks(doc).blocks.find((b) => b.kind === "table")!;
    const original = extractSubtreeText(doc, info.id);
    expect(original.ok).toBe(true);

    const outcomeNoHyphen = applySubtreeEdit(doc, info.id, original.text, ["| a |", "| xyz |", "| 1 |"].join("\n"));
    expect(outcomeNoHyphen.changed).toBe(false);
    expect(outcomeNoHyphen.reason).toBe("table-invalid-delimiter");

    const outcomeDigit = applySubtreeEdit(doc, info.id, original.text, ["| a |", "| -1- |", "| 1 |"].join("\n"));
    expect(outcomeDigit.changed).toBe(false);
    expect(outcomeDigit.reason).toBe("table-invalid-delimiter");
  });

  it("行間で列数が一致しない場合は拒否される（table-column-mismatch）", () => {
    const text = ["| a |", "| --- |", "| 1 |"].join("\n");
    const doc = parseDocument(text);
    const info = scanComplexBlocks(doc).blocks.find((b) => b.kind === "table")!;
    const original = extractSubtreeText(doc, info.id);
    expect(original.ok).toBe(true);

    const outcome = applySubtreeEdit(
      doc,
      info.id,
      original.text,
      ["| a | b |", "| --- | --- |", "| 1 |"].join("\n")
    );
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("table-column-mismatch");
    expect(outcome.lines).toEqual(doc.lines);
  });

  it("空文字列をApplyしようとした場合は拒否される（table-too-few-lines）", () => {
    const text = ["| a |", "| --- |", "| 1 |"].join("\n");
    const doc = parseDocument(text);
    const info = scanComplexBlocks(doc).blocks.find((b) => b.kind === "table")!;
    const original = extractSubtreeText(doc, info.id);
    expect(original.ok).toBe(true);

    const outcome = applySubtreeEdit(doc, info.id, original.text, "");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("table-too-few-lines");
    expect(outcome.lines).toEqual(doc.lines);
  });
});

describe("Phase 5E-2A category D: UI 配線 (view/OutlineTreeView.ts)", () => {
  /**
   * Reproduces view/OutlineTreeView.ts's renderNode context-menu-
   * attachment condition, as of this phase: `isComplexMember &&
   * node.isStandalone && (complexKind === "callout" || "blockquote" ||
   * "fenced-code" || "table")` — see that branch's own doc comment.
   */
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

  it("table の complex-member ノードは右クリックメニューが表示される（Open in Partial Edit のみ）", () => {
    const { tree, complexScan, doc } = treeWithTable(["# H", "| a | b |", "|---|---|", "| 1 | 2 |"].join("\n"));
    const flat = flattenOutlineTree(tree);
    const tableRow = flat.find((n) => isOutlineComplexMemberNode(n) && n.complexKind === "table")!;
    expect(tableRow).toBeDefined();
    // Layer ONE: the menu attaches at all.
    expect(wouldAttachStandaloneMenu(tableRow)).toBe(true);
    // "Open in Partial Edit" re-verifies via extractSubtreeText at click
    // time — confirm that succeeds for the real target this row resolves to.
    const tableInfo = tableOf(complexScan, doc, "1");
    const outcome = extractSubtreeText(doc, tableInfo.id);
    expect(outcome.ok).toBe(true);
  });

  it("table の complex-member ノードでも Move up / Move down / Delete が表示される（Phase 5E-3d で追加 — tests/phase5e3dTableMoveDeleteDnd.test.ts に詳細カバレッジあり）", () => {
    // Phase 5E-3d ("Table Move/Delete/DnD Parity") widens
    // buildStandaloneComplexBlockSnapshot's own StandaloneComplexBlockMoveKind
    // allow-list, and the Delete item's own kind gate in
    // showStandaloneComplexBlockMenu, to also admit "table" — this test
    // originally pinned "table stays Move/Delete-less, unchanged by Phase
    // 5E-2A" as a regression guard for that phase; Phase 5E-3d
    // deliberately changes that, so this test is updated to confirm the
    // new, intentional behavior instead of continuing to pin the old one.
    const { complexScan, doc } = treeWithTable(["# H", "| a | b |", "|---|---|", "| 1 | 2 |"].join("\n"));
    const tableInfo = tableOf(complexScan, doc, "1");
    expect(buildStandaloneComplexBlockSnapshot(tableInfo)).not.toBeNull();
    expect(tableInfo.kind).toBe("table");
  });

  it("collectReadOnlyOutlineNodeIds は table の complex-member ノードを読み取り専用集合に含め続ける", () => {
    const { tree } = treeWithTable(["# H", "| a | b |", "|---|---|", "| 1 | 2 |"].join("\n"));
    const readOnlyIds = collectReadOnlyOutlineNodeIds(tree);
    const flat = flattenOutlineTree(tree);
    const tableRow = flat.find((n) => isOutlineComplexMemberNode(n) && n.complexKind === "table")!;
    expect(readOnlyIds.has(tableRow.id)).toBe(true);
  });
});

describe("Phase 5E-2A category E: insertionFramework の table 実装", () => {
  it("resolveInsertion が table の before 挿入に対して正しい行番号と挿入テキストを返す", () => {
    const text = ["# H", "existing text", "| a |", "| --- |", "| 1 |"].join("\n");
    const doc = parseDocument(text);
    const target = scanComplexBlocks(doc).blocks.find((b) => b.kind === "table")!;
    const request: InsertionRequest = { targetNodeId: target.id, kind: "table", position: "before" };

    const result = resolveInsertion(request, text, undefined);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.insertAtLine).toBe(target.range.startLine);
      // Near boundary (target's own first line follows immediately) ->
      // always padded. Far boundary ("existing text", not blank) -> also
      // padded.
      expect(result.insertText).toBe(["", "| Header |", "| --- |", "|  |", "", ""].join("\n"));
    }
  });

  it("resolveInsertion が table の after 挿入に対して正しい行番号と挿入テキストを返す", () => {
    const text = ["| a |", "| --- |", "| 1 |", "", "after (already blank before it)"].join("\n");
    const doc = parseDocument(text);
    const target = scanComplexBlocks(doc).blocks.find((b) => b.kind === "table")!;
    const request: InsertionRequest = { targetNodeId: target.id, kind: "table", position: "after" };

    const result = resolveInsertion(request, text, undefined);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.insertAtLine).toBe(target.range.endLine + 1);
      // Near boundary (target's own last line precedes insert) -> always
      // padded. Far boundary is already blank -> NOT double-padded.
      expect(result.insertText).toBe(["", "| Header |", "| --- |", "|  |", ""].join("\n"));
    }
  });
});

describe("Phase 5E-2A category F: 既存機能回帰", () => {
  it("fenced-code の Partial Edit が Phase 5E-1 時点と同等に機能する（Phase 5E-3: body-only 契約に更新 — newText はフェンス行を含まない）", () => {
    const text = ["# H", "```js", "code", "```"].join("\n");
    const doc = parseDocument(text);
    const info = scanComplexBlocks(doc).blocks.find((b) => b.kind === "fenced-code")!;
    const original = extractSubtreeText(doc, info.id);
    expect(original.ok).toBe(true);
    if (original.ok) {
      expect(original.kind).toBe("fenced-code");
      expect(original.text).toBe("code");
    }

    const outcome = applySubtreeEdit(doc, info.id, original.text, "changed code");
    expect(outcome.changed).toBe(true);
    // Phase 5E-3: fence+infoString reconstruction always inserts exactly
    // one space (per the design memo §2 step 1), so the space-less
    // original open line ("```js") normalizes to a spaced one
    // ("``` js") — an intentional formatting normalization, not a
    // fidelity bug (both are the same CommonMark info string "js"). See
    // phase5e1FencedCodePartialEditMoveDelete.test.ts's own Mermaid test
    // for the same normalization spelled out in more detail.
    expect(outcome.lines).toEqual(["# H", "``` js", "changed code", "```"]);

    // Phase 5E-3: newText itself can no longer carry an invalid fence line
    // (it's body-only now) — the invalid-open trigger moves to the new
    // fencedCodeInfoString argument instead (an embedded newline corrupts
    // the synthesized opening line — see partialEdit.ts's own
    // applySubtreeEdit doc comment).
    const rejected = applySubtreeEdit(doc, info.id, original.text, "changed code", "js\nmalicious");
    expect(rejected.changed).toBe(false);
    expect(rejected.reason).toBe("fenced-code-invalid-open");
  });

  it("showTablesInOutline: false（includeTables 未指定）の状態でTree出力は table 投影なしの状態と完全一致する", () => {
    const text = ["# H", "- item", "  continuation", "| a | b |", "|---|---|", "| 1 | 2 |"].join("\n");
    const doc = parseDocument(text);
    const complexScan = scanComplexBlocks(doc);
    const withoutTables = buildOutlineTree(doc, {
      includeLists: true,
      standaloneComplexBlocks: { blocks: complexScan.blocks, includeFencedCode: false, includeTables: false },
      t: createTranslator("en"),
    });
    const shapeOf = (nodes: ReturnType<typeof flattenOutlineTree>): unknown =>
      nodes.map((n) => ({ kind: n.kind, id: n.id }));
    const flat = flattenOutlineTree(withoutTables);
    expect(flat.some((n) => isOutlineComplexMemberNode(n) && n.complexKind === "table")).toBe(false);

    // Byte-identical to calling with the options object omitted entirely
    // (the pre-Phase-5E-0 calling convention every other pre-existing
    // tree test in this codebase still uses).
    const defaultTree = buildOutlineTree(doc, {
      includeLists: true,
      standaloneComplexBlocks: { blocks: complexScan.blocks },
      t: createTranslator("en"),
    });
    expect(JSON.stringify(shapeOf(flattenOutlineTree(withoutTables)))).toBe(
      JSON.stringify(shapeOf(flattenOutlineTree(defaultTree)))
    );
  });

  it("conflict 検知が table でも fenced-code と同等に機能する", () => {
    const originalText = ["| a |", "| --- |", "| original |"].join("\n");
    const laterText = ["# A", "| a |", "| --- |", "| changed by someone else |"].join("\n");
    const doc = parseDocument(laterText);
    const info = scanComplexBlocks(doc).blocks.find((b) => b.kind === "table")!;

    const outcome = applySubtreeEdit(doc, info.id, originalText, ["| a |", "| --- |", "| my edit |"].join("\n"));
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("conflict");
    expect(outcome.lines).toEqual(doc.lines);
  });
});
