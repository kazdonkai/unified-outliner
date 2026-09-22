/**
 * Phase 5E-0 ("Fenced Code Block / Markdown Table 読み取り専用 Outline Tree
 * 投影基盤"), categories E (読み取り専用の二重防御) and F (既存機能の回帰):
 * tests for the ONE functional UI change this ticket made to
 * view/OutlineTreeView.ts's renderNode — narrowing the standalone
 * complex-member context-menu-attachment branch (previously
 * `isComplexMember && node.isStandalone`) to also require
 * `node.complexKind === "callout" || node.complexKind === "blockquote"` —
 * plus this ticket's own required zero-new-code regression checks
 * (collectReadOnlyOutlineNodeIds, buildStandaloneComplexBlockSnapshot,
 * extractSubtreeText all already reject fenced-code/table without any
 * change).
 *
 * Same "obsidian is types-only, no real Menu/ItemView is instantiated"
 * testing boundary as tests/standaloneComplexBlockUiWiring.test.ts (see
 * that file's own top doc comment) — this file reproduces renderNode's own
 * condition directly against real OutlineTreeNode values from the real
 * buildOutlineTree pipeline, the same way that file already does for
 * callout/blockquote. Real menu-item appearance / DOM dispatch require
 * manual desktop/iPad verification, tracked separately (実機受入).
 *
 * Phase 5E-1 UPDATE: view/OutlineTreeView.ts's renderNode
 * context-menu-attachment guard was widened again by that ticket to also
 * admit `node.complexKind === "fenced-code"` — table alone remains
 * excluded (and therefore read-only) now. wouldAttachStandaloneMenu below
 * and every test in the first describe block are updated to match that
 * new, current condition; the "layer TWO" describe block below is split
 * so its fenced-code assertions now expect success (Move/Partial-Edit are
 * genuinely supported for fenced-code as of Phase 5E-1) while its table
 * assertions are unchanged (table remains unsupported/rejected). See
 * docs/phase5e1_fenced-code-partial-edit-move-delete-design-memo.md §3
 * for the full, current read-only-scope rationale.
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { scanComplexBlocks } from "../src/parser/complexBlocks";
import {
  buildOutlineTree,
  collectReadOnlyOutlineNodeIds,
  flattenOutlineTree,
  isOutlineComplexMemberNode,
} from "../src/tree/buildOutlineTree";
import { buildStandaloneComplexBlockSnapshot } from "../src/edit/moveStandaloneComplexBlock";
import { extractSubtreeText } from "../src/edit/partialEdit";
import { createTranslator } from "../src/i18n";

/**
 * Reproduces renderNode's POST-Phase-5E-0 context-menu-attachment
 * condition for a standalone complex-member row:
 * `isComplexMember && node.isStandalone && (node.complexKind === "callout"
 * || node.complexKind === "blockquote")`. Before this ticket the kind
 * check did not exist — see this file's own top doc comment.
 */
function wouldAttachStandaloneMenu(node: ReturnType<typeof flattenOutlineTree>[number]): boolean {
  return (
    isOutlineComplexMemberNode(node) &&
    node.isStandalone &&
    (node.complexKind === "callout" || node.complexKind === "blockquote" || node.complexKind === "fenced-code")
  );
}

function treeWithCodeTable(text: string) {
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

describe("renderNode's standalone-menu attachment condition (Phase 5E-1: fenced-code included, table excluded)", () => {
  it("Phase 5E-1: a standalone fenced-code row DOES satisfy the (post-5E-1) attachment condition — context menu shown", () => {
    const { tree } = treeWithCodeTable(["# H", "```ts", "code", "```"].join("\n"));
    const flat = flattenOutlineTree(tree);
    const codeRow = flat.find((n) => isOutlineComplexMemberNode(n) && n.complexKind === "fenced-code");
    expect(codeRow).toBeDefined();
    expect(isOutlineComplexMemberNode(codeRow!) && codeRow!.isStandalone).toBe(true);
    expect(wouldAttachStandaloneMenu(codeRow!)).toBe(true);
  });

  it("a standalone table row does NOT satisfy the attachment condition — no context menu (unchanged by Phase 5E-1)", () => {
    const { tree } = treeWithCodeTable(["# H", "| a | b |", "|---|---|", "| 1 | 2 |"].join("\n"));
    const flat = flattenOutlineTree(tree);
    const tableRow = flat.find((n) => isOutlineComplexMemberNode(n) && n.complexKind === "table");
    expect(tableRow).toBeDefined();
    expect(isOutlineComplexMemberNode(tableRow!) && tableRow!.isStandalone).toBe(true);
    expect(wouldAttachStandaloneMenu(tableRow!)).toBe(false);
  });

  it("regression: a standalone callout/blockquote row still satisfies the attachment condition, byte-identical to before this ticket", () => {
    const { tree } = treeWithCodeTable(["# H", "> [!note] Title", "> body"].join("\n"));
    const flat = flattenOutlineTree(tree);
    const calloutRow = flat.find((n) => isOutlineComplexMemberNode(n) && n.complexKind === "callout");
    expect(calloutRow).toBeDefined();
    expect(wouldAttachStandaloneMenu(calloutRow!)).toBe(true);
  });
});

describe("Phase 5E-0 read-only defense, layer TWO: handler/dispatch-level rejection (pre-existing, zero new code)", () => {
  it("buildStandaloneComplexBlockSnapshot (Move) still returns null for table (Phase 5E-1: table remains excluded; fenced-code is now accepted — see moveStandaloneComplexBlock.test.ts's own new coverage)", () => {
    const doc2 = parseDocument(["# H", "| a | b |", "|---|---|", "| 1 | 2 |"].join("\n"));
    const tableInfo = scanComplexBlocks(doc2).blocks.find((b) => b.kind === "table")!;
    expect(tableInfo).toBeDefined();
    expect(buildStandaloneComplexBlockSnapshot(tableInfo)).toBeNull();
  });

  it("Phase 5E-1: buildStandaloneComplexBlockSnapshot (Move) now returns a real snapshot for fenced-code — Move is genuinely enabled", () => {
    const doc = parseDocument(["# H", "```ts", "code", "```"].join("\n"));
    const codeInfo = scanComplexBlocks(doc).blocks.find((b) => b.kind === "fenced-code")!;
    expect(codeInfo).toBeDefined();
    expect(buildStandaloneComplexBlockSnapshot(codeInfo)).not.toBeNull();
  });

  it("extractSubtreeText (Partial Edit) still rejects a table nodeId with reason 'resolve-failed' — layer TWO of this ticket's required two-layer defense, unchanged for table by Phase 5E-1", () => {
    const doc2 = parseDocument(["# H", "| a | b |", "|---|---|", "| 1 | 2 |"].join("\n"));
    const tableInfo = scanComplexBlocks(doc2).blocks.find((b) => b.kind === "table")!;
    const tableOutcome = extractSubtreeText(doc2, tableInfo.id);
    expect(tableOutcome.ok).toBe(false);
    if (!tableOutcome.ok) expect(tableOutcome.reason).toBe("resolve-failed");
  });

  it("Phase 5E-1: extractSubtreeText (Partial Edit) now resolves a fenced-code nodeId successfully — raw Partial Edit is genuinely enabled", () => {
    const doc = parseDocument(["# H", "```ts", "code", "```"].join("\n"));
    const codeInfo = scanComplexBlocks(doc).blocks.find((b) => b.kind === "fenced-code")!;
    const codeOutcome = extractSubtreeText(doc, codeInfo.id);
    expect(codeOutcome.ok).toBe(true);
  });

  it("regression: extractSubtreeText still resolves a standalone callout successfully (unaffected by this ticket)", () => {
    const doc = parseDocument(["# H", "> [!note] Title", "> body"].join("\n"));
    const calloutInfo = scanComplexBlocks(doc).blocks.find((b) => b.kind === "callout")!;
    const outcome = extractSubtreeText(doc, calloutInfo.id);
    expect(outcome.ok).toBe(true);
  });
});

describe("Phase 5E-0 read-only defense, layer ZERO: collectReadOnlyOutlineNodeIds (pre-existing, zero new code — reused verbatim via kind 'complex-member')", () => {
  it("a standalone fenced-code/table row is unconditionally read-only, exactly like every other complex-member row", () => {
    const { tree } = treeWithCodeTable(
      ["# H", "```ts", "code", "```", "| a | b |", "|---|---|", "| 1 | 2 |"].join("\n")
    );
    const readOnlyIds = collectReadOnlyOutlineNodeIds(tree);
    const flat = flattenOutlineTree(tree);
    const complexMemberRows = flat.filter(isOutlineComplexMemberNode);
    expect(complexMemberRows.length).toBeGreaterThan(0);
    for (const row of complexMemberRows) {
      expect(readOnlyIds.has(row.id)).toBe(true);
    }
  });
});

describe("Phase 5E-0 regression (category F): opt-in flags default OFF leaves every pre-existing Tree shape untouched", () => {
  it("a document with callout, paragraph, and list content builds a byte-identical tree whether or not the new fenced-code/table opt-in flags are present, as long as they're both false/omitted", () => {
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
});
