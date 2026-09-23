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
 * admit `node.complexKind === "fenced-code"` — table alone remained
 * excluded (and therefore read-only) at that point. wouldAttachStandaloneMenu
 * below and every test in the first describe block were updated to match
 * that condition; the "layer TWO" describe block below was split so its
 * fenced-code assertions expected success (Move/Partial-Edit are genuinely
 * supported for fenced-code as of Phase 5E-1) while its table assertions
 * stayed unchanged (table still unsupported/rejected at that point).
 *
 * Phase 5E-2A UPDATE: the same guard was widened once more, to also admit
 * `node.complexKind === "table"` — table now attaches this menu too (it
 * gains Open in Partial Edit only, no Move/Delete — see
 * tests/phase5e2aTableRawPartialEdit.test.ts's own category D for that
 * distinction). wouldAttachStandaloneMenu below and this file's table
 * assertions are updated once more to match. The one "layer TWO" table
 * assertion in this file that is STILL true after Phase 5E-2A —
 * buildStandaloneComplexBlockSnapshot (Move) returning null for table — is
 * left as-is below; extractSubtreeText's own table assertion is updated
 * (see docs/phase5e2a_table-raw-partial-edit-design-memo.md §3 for the
 * full, current read-only-scope rationale).
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
 * Reproduces renderNode's CURRENT (as of Phase 5E-2A) context-menu-
 * attachment condition for a standalone complex-member row:
 * `isComplexMember && node.isStandalone && (node.complexKind === "callout"
 * || "blockquote" || "fenced-code" || "table")`. Before Phase 5E-0 the
 * kind check did not exist at all — see this file's own top doc comment
 * for the full history of each widening.
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

describe("renderNode's standalone-menu attachment condition (as of Phase 5E-2A: callout/blockquote/fenced-code/table all included)", () => {
  it("Phase 5E-1: a standalone fenced-code row DOES satisfy the (post-5E-1) attachment condition — context menu shown", () => {
    const { tree } = treeWithCodeTable(["# H", "```ts", "code", "```"].join("\n"));
    const flat = flattenOutlineTree(tree);
    const codeRow = flat.find((n) => isOutlineComplexMemberNode(n) && n.complexKind === "fenced-code");
    expect(codeRow).toBeDefined();
    expect(isOutlineComplexMemberNode(codeRow!) && codeRow!.isStandalone).toBe(true);
    expect(wouldAttachStandaloneMenu(codeRow!)).toBe(true);
  });

  it("Phase 5E-2A: a standalone table row DOES satisfy the (post-5E-2A) attachment condition — context menu shown (Open in Partial Edit only; see tests/phase5e2aTableRawPartialEdit.test.ts's category D)", () => {
    const { tree } = treeWithCodeTable(["# H", "| a | b |", "|---|---|", "| 1 | 2 |"].join("\n"));
    const flat = flattenOutlineTree(tree);
    const tableRow = flat.find((n) => isOutlineComplexMemberNode(n) && n.complexKind === "table");
    expect(tableRow).toBeDefined();
    expect(isOutlineComplexMemberNode(tableRow!) && tableRow!.isStandalone).toBe(true);
    expect(wouldAttachStandaloneMenu(tableRow!)).toBe(true);
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

  it("Phase 5E-2A: extractSubtreeText (Partial Edit) now resolves a table nodeId successfully — raw Partial Edit is genuinely enabled for table too", () => {
    // Phase 5E-0/5E-1: this test used to assert extractSubtreeText
    // rejected table with "resolve-failed" — layer TWO of this file's own
    // two-layer read-only defense. Phase 5E-2A intentionally widens
    // extractSubtreeText/extractComplexBlockText (edit/partialEdit.ts) to
    // also accept kind "table" for Partial Edit, exactly like Phase 5E-1
    // already did for "fenced-code" (see the fenced-code test right below
    // this one). Table's continued lack of Move/Delete is NOT enforced by
    // this function any more — it is enforced entirely by
    // buildStandaloneComplexBlockSnapshot still returning null for kind
    // "table" (see the test above this describe block's fenced-code
    // counterpart) and by showStandaloneComplexBlockMenu's own
    // `target.kind === "fenced-code"` Delete gate (view/OutlineTreeView.ts)
    // — see docs/phase5e2a_table-raw-partial-edit-design-memo.md §3.
    const doc2 = parseDocument(["# H", "| a | b |", "|---|---|", "| 1 | 2 |"].join("\n"));
    const tableInfo = scanComplexBlocks(doc2).blocks.find((b) => b.kind === "table")!;
    const tableOutcome = extractSubtreeText(doc2, tableInfo.id);
    expect(tableOutcome.ok).toBe(true);
    if (tableOutcome.ok) expect(tableOutcome.kind).toBe("table");
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
