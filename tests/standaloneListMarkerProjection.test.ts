/**
 * Phase 5L-1 ("Standalone Single-Line Unordered List Marker-Free Partial
 * Edit"): pure unit tests for
 * edit/standaloneListMarkerProjection.ts#isStandaloneListItemEligibleForMarkerFreeProjection.
 *
 * Every fixture goes through the REAL parser (parser/parseDocument.ts) —
 * never a hand-built ListBlockNode literal — so these tests pin down the
 * function's behavior against the SAME node shapes loadNodeInternal will
 * actually see, exactly like tests/compositeBlockMemberProjection.test.ts's
 * own "prefer a real fixture over a hand-typed snapshot" convention (see
 * that file's own doc comment).
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { isListNode } from "../src/model/block";
import { isStandaloneListItemEligibleForMarkerFreeProjection } from "../src/edit/standaloneListMarkerProjection";

function listNode(text: string, nodeId: string) {
  const doc = parseDocument(text);
  const node = doc.nodes.get(nodeId);
  if (!node || !isListNode(node)) {
    throw new Error(`fixture error: ${nodeId} did not resolve to a list node`);
  }
  return node;
}

describe("Phase 5L-1: isStandaloneListItemEligibleForMarkerFreeProjection — eligible shapes", () => {
  it("a single top-level '-' leaf item is eligible", () => {
    const node = listNode("- 史料の確認事項", "li-0");
    expect(isStandaloneListItemEligibleForMarkerFreeProjection(node)).toBe(true);
  });

  it("a single top-level '*' leaf item is eligible", () => {
    const node = listNode("* 史料の確認事項", "li-0");
    expect(isStandaloneListItemEligibleForMarkerFreeProjection(node)).toBe(true);
  });

  it("a single top-level '+' leaf item is eligible", () => {
    const node = listNode("+ 史料の確認事項", "li-0");
    expect(isStandaloneListItemEligibleForMarkerFreeProjection(node)).toBe(true);
  });

  it("a leaf item directly under a heading section is eligible", () => {
    const node = listNode(["# 見出し", "- 本文項目"].join("\n"), "li-0");
    expect(isStandaloneListItemEligibleForMarkerFreeProjection(node)).toBe(true);
  });

  it("the LEAF of a nested list (the deepest, childless item) is eligible, even though its own parent is not", () => {
    const doc = parseDocument(["- 親項目", "  - 子項目"].join("\n"));
    const parent = doc.nodes.get("li-0");
    const leaf = doc.nodes.get("li-1");
    if (!parent || !isListNode(parent) || !leaf || !isListNode(leaf)) {
      throw new Error("fixture error");
    }
    expect(isStandaloneListItemEligibleForMarkerFreeProjection(leaf)).toBe(true);
    expect(isStandaloneListItemEligibleForMarkerFreeProjection(parent)).toBe(false);
  });

  it("indentation alone does not affect eligibility — only structure (childIds/range) and marker type do", () => {
    const doc = parseDocument(["- 親項目", "  - 子項目"].join("\n"));
    const leaf = doc.nodes.get("li-1");
    if (!leaf || !isListNode(leaf)) throw new Error("fixture error");
    expect(leaf.indentColumns).toBeGreaterThan(0);
    expect(isStandaloneListItemEligibleForMarkerFreeProjection(leaf)).toBe(true);
  });

  it("a task-list item ('- [ ] ...') is STRUCTURALLY eligible here — the checkbox is plain body text this parser's ListBlockNode never models separately, so raw fallback for it is left entirely to buildListMarkerProjection's own text-level 'task-list-marker' refusal, one layer up (see view/PartialEditView.ts#loadNodeInternal)", () => {
    const node = listNode("- [ ] 確認する", "li-0");
    expect(isStandaloneListItemEligibleForMarkerFreeProjection(node)).toBe(true);
  });
});

describe("Phase 5L-1: isStandaloneListItemEligibleForMarkerFreeProjection — ineligible shapes", () => {
  it("an ordered-marker item is ineligible", () => {
    const node = listNode("1. 史料の確認事項", "li-0");
    expect(isStandaloneListItemEligibleForMarkerFreeProjection(node)).toBe(false);
  });

  it("an ordered-marker item with the ')' variant is ineligible", () => {
    const node = listNode("1) 史料の確認事項", "li-0");
    expect(isStandaloneListItemEligibleForMarkerFreeProjection(node)).toBe(false);
  });

  it("a parent item that owns a nested child list is ineligible (childIds.length > 0), even though its own single line looks like a plain leaf", () => {
    const doc = parseDocument(["- 親項目", "  - 子項目"].join("\n"));
    const parent = doc.nodes.get("li-0");
    if (!parent || !isListNode(parent)) throw new Error("fixture error");
    expect(parent.childIds.length).toBeGreaterThan(0);
    expect(isStandaloneListItemEligibleForMarkerFreeProjection(parent)).toBe(false);
  });

  it("an item with a continuation paragraph is ineligible (range spans past its own start line with no child list item)", () => {
    const doc = parseDocument(["- 項目本文", "  続きの段落。"].join("\n"));
    const node = doc.nodes.get("li-0");
    if (!node || !isListNode(node)) throw new Error("fixture error");
    expect(node.childIds.length).toBe(0);
    expect(node.range.endLine).toBeGreaterThan(node.range.startLine);
    expect(isStandaloneListItemEligibleForMarkerFreeProjection(node)).toBe(false);
  });

  it("an item with a MULTI-LINE continuation paragraph is ineligible", () => {
    const doc = parseDocument(["- 項目本文", "  続きその1。", "  続きその2。"].join("\n"));
    const node = doc.nodes.get("li-0");
    if (!node || !isListNode(node)) throw new Error("fixture error");
    expect(isStandaloneListItemEligibleForMarkerFreeProjection(node)).toBe(false);
  });

  it("a grandparent item (two levels of nested children) is ineligible at every non-leaf level, while the deepest leaf stays eligible", () => {
    const doc = parseDocument(["- 祖父項目", "  - 親項目", "    - 子項目"].join("\n"));
    const grandparent = doc.nodes.get("li-0");
    const parent = doc.nodes.get("li-1");
    const leaf = doc.nodes.get("li-2");
    if (
      !grandparent || !isListNode(grandparent) ||
      !parent || !isListNode(parent) ||
      !leaf || !isListNode(leaf)
    ) {
      throw new Error("fixture error");
    }
    expect(isStandaloneListItemEligibleForMarkerFreeProjection(grandparent)).toBe(false);
    expect(isStandaloneListItemEligibleForMarkerFreeProjection(parent)).toBe(false);
    expect(isStandaloneListItemEligibleForMarkerFreeProjection(leaf)).toBe(true);
  });

  it("mixed tab/space leading whitespace (unsafeIndent) is ineligible, defensively — even though such a node is already refused entirely upstream by extractSubtreeText's own 'unsafe-indent' gate before this function would ever run against it in practice", () => {
    const doc = parseDocument("\t - 項目本文");
    const node = doc.nodes.get("li-0");
    if (!node || !isListNode(node)) throw new Error("fixture error");
    expect(node.unsafeIndent).toBe(true);
    expect(isStandaloneListItemEligibleForMarkerFreeProjection(node)).toBe(false);
  });
});
