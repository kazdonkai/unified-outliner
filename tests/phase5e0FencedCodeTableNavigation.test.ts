/**
 * Phase 5E-0 ("Fenced Code Block / Markdown Table 読み取り専用 Outline Tree
 * 投影基盤"), category D (ナビゲーション): tests for the one addition this
 * ticket made to tree/resolveCurrentPositionNodeId.ts's own candidateTreeId
 * — a fenced-code/table ComplexBlockInfo now resolves to its own Tree row
 * id (`info.id`, exactly like callout/blockquote already did) WHENEVER that
 * row is actually currently displayed (i.e. nodeById.has(id) — the
 * corresponding opt-in setting is on). When the setting is off, no such row
 * exists, so nodeById.has(id) is false and cursor resolution correctly
 * falls back to the pre-existing section/list behavior — verified
 * explicitly below alongside the existing "no Tree row today" regression
 * tests already in tests/resolveCurrentPositionNodeId.test.ts (left
 * completely unmodified by this ticket: their own default `setup()` never
 * opts into fenced-code/table projection, so their asserted behavior is
 * byte-identical before and after this phase).
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { scanComplexBlocks } from "../src/parser/complexBlocks";
import { buildOutlineTree, isOutlineComplexMemberNode } from "../src/tree/buildOutlineTree";
import { buildNodeByIdMap } from "../src/tree/outlineNavigation";
import { resolveCurrentPositionNodeId } from "../src/tree/resolveCurrentPositionNodeId";
import { ownerAt } from "./fixtures";

/** Builds a tree + nodeById with fenced-code/table standalone projection turned ON — the state view/OutlineTreeView.ts reaches when both new settings are on. */
function setupWithCodeTable(text: string, includeLists = true) {
  const doc = parseDocument(text);
  const complexScan = scanComplexBlocks(doc);
  const tree = buildOutlineTree(doc, {
    includeLists,
    standaloneComplexBlocks: {
      blocks: complexScan.blocks,
      includeFencedCode: true,
      includeTables: true,
    },
  });
  const nodeById = buildNodeByIdMap(tree);
  return { doc, complexScan, tree, nodeById };
}

describe("resolveCurrentPositionNodeId (Phase 5E-0: fenced-code/table, setting ON)", () => {
  it("resolves a cursor on the opening fence line to the fenced-code row's own id", () => {
    const text = ["# H", "```ts", "const x = 1;", "```"].join("\n");
    const { doc, complexScan, tree, nodeById } = setupWithCodeTable(text, false);
    const section = tree[0];
    const [row] = section.children;
    if (!isOutlineComplexMemberNode(row)) throw new Error("expected complex-member row");
    expect(resolveCurrentPositionNodeId(doc, 1, complexScan, nodeById, { includeLists: false })).toBe(
      row.id
    );
  });

  it("resolves a cursor on a code body line, and on the closing fence line, to the SAME fenced-code row id", () => {
    const text = ["# H", "```ts", "line one", "line two", "```"].join("\n");
    const { doc, complexScan, tree, nodeById } = setupWithCodeTable(text, false);
    const section = tree[0];
    const [row] = section.children;
    if (!isOutlineComplexMemberNode(row)) throw new Error("expected complex-member row");
    expect(resolveCurrentPositionNodeId(doc, 2, complexScan, nodeById, { includeLists: false })).toBe(
      row.id
    );
    expect(resolveCurrentPositionNodeId(doc, 3, complexScan, nodeById, { includeLists: false })).toBe(
      row.id
    );
    expect(resolveCurrentPositionNodeId(doc, 4, complexScan, nodeById, { includeLists: false })).toBe(
      row.id
    );
  });

  it("resolves a cursor on the header row, delimiter row, or a body row to the table row's own id", () => {
    const text = ["# H", "| a | b |", "|---|---|", "| 1 | 2 |"].join("\n");
    const { doc, complexScan, tree, nodeById } = setupWithCodeTable(text, false);
    const section = tree[0];
    const [row] = section.children;
    if (!isOutlineComplexMemberNode(row)) throw new Error("expected complex-member row");
    for (const line of [1, 2, 3]) {
      expect(resolveCurrentPositionNodeId(doc, line, complexScan, nodeById, { includeLists: false })).toBe(
        row.id
      );
    }
  });

  it("does not bleed the highlight onto the immediately preceding or following line (boundary safety)", () => {
    const text = ["# H", "intro paragraph", "```ts", "code", "```", "outro paragraph"].join("\n");
    const { doc, complexScan, tree, nodeById } = setupWithCodeTable(text, false);
    const section = tree[0];
    const codeRow = section.children.find(isOutlineComplexMemberNode);
    if (!codeRow) throw new Error("expected complex-member row");
    const secH = ownerAt(doc, 0);
    // Line 1 ("intro paragraph") and line 5 ("outro paragraph") are OUTSIDE
    // the fenced-code block's own range — with no paragraph projection
    // turned on here, both fall back to the enclosing section, never to
    // the code row.
    expect(resolveCurrentPositionNodeId(doc, 1, complexScan, nodeById, { includeLists: false })).toBe(
      secH.id
    );
    expect(resolveCurrentPositionNodeId(doc, 5, complexScan, nodeById, { includeLists: false })).toBe(
      secH.id
    );
    expect(resolveCurrentPositionNodeId(doc, 2, complexScan, nodeById, { includeLists: false })).toBe(
      codeRow.id
    );
  });

  it("resolves a cursor inside a table's header row to the table row's own id, distinct from the enclosing section", () => {
    const text = ["# H", "| a | b |", "|---|---|", "| 1 | 2 |"].join("\n");
    const { doc, complexScan, tree, nodeById } = setupWithCodeTable(text, false);
    const section = tree[0];
    const [row] = section.children;
    if (!isOutlineComplexMemberNode(row)) throw new Error("expected complex-member row");
    const secH = ownerAt(doc, 0);
    expect(row.id).not.toBe(secH.id);
    expect(resolveCurrentPositionNodeId(doc, 1, complexScan, nodeById, { includeLists: false })).not.toBe(
      secH.id
    );
  });
});

describe("resolveCurrentPositionNodeId (Phase 5E-0: fenced-code/table, setting OFF — no regression)", () => {
  it("returns null for a fenced-code body line when the opt-in flags are both left off — byte-identical to the pre-existing regression test in resolveCurrentPositionNodeId.test.ts (resolveHighlightedNodeId itself returns null inside a fenced code block; there is no section/list fallback for THIS specific line, and no nodeById entry to prefer either)", () => {
    const text = ["# H", "```ts", "code", "```"].join("\n");
    const doc = parseDocument(text);
    const complexScan = scanComplexBlocks(doc);
    // No standaloneComplexBlocks option at all -> byte-identical to every
    // pre-Phase-5E-0 caller.
    const tree = buildOutlineTree(doc, { includeLists: false });
    const nodeById = buildNodeByIdMap(tree);
    expect(
      resolveCurrentPositionNodeId(doc, 2, complexScan, nodeById, { includeLists: false })
    ).toBeNull();
  });

  it("falls back to the enclosing section for a table line when the opt-in flags are both left off", () => {
    const text = ["# H", "| a | b |", "|---|---|", "| 1 | 2 |"].join("\n");
    const doc = parseDocument(text);
    const complexScan = scanComplexBlocks(doc);
    const tree = buildOutlineTree(doc, { includeLists: false });
    const nodeById = buildNodeByIdMap(tree);
    const secH = ownerAt(doc, 0);
    expect(resolveCurrentPositionNodeId(doc, 2, complexScan, nodeById, { includeLists: false })).toBe(
      secH.id
    );
  });
});
