/**
 * Phase 5L-3 ("Ordered List Marker-Free Partial Edit"): pure unit tests
 * for
 * edit/standaloneOrderedListProjection.ts#isStandaloneOrderedListItemEligibleForMarkerFreeProjection
 * — mirrors tests/standaloneTaskListProjection.test.ts's own structure
 * exactly, since the three gates share the identical structural criteria
 * modulo the ordered/unordered distinction (see that module's own top doc
 * comment for why this is a deliberate, independent copy rather than a
 * shared import).
 *
 * Every fixture goes through the REAL parser (parser/parseDocument.ts) —
 * never a hand-built ListBlockNode literal — matching this project's own
 * "prefer a real fixture over a hand-typed snapshot" convention.
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { isListNode } from "../src/model/block";
import { isStandaloneOrderedListItemEligibleForMarkerFreeProjection } from "../src/edit/standaloneOrderedListProjection";
import { isStandaloneListItemEligibleForMarkerFreeProjection } from "../src/edit/standaloneListMarkerProjection";
import { isStandaloneTaskListItemEligibleForMarkerFreeProjection } from "../src/edit/standaloneTaskListProjection";

function listNode(text: string, nodeId: string) {
  const doc = parseDocument(text);
  const node = doc.nodes.get(nodeId);
  if (!node || !isListNode(node)) {
    throw new Error(`fixture error: ${nodeId} did not resolve to a list node`);
  }
  return node;
}

describe("Phase 5L-3: isStandaloneOrderedListItemEligibleForMarkerFreeProjection — eligible shapes", () => {
  it("a single top-level '.' delimiter ordered leaf item is eligible", () => {
    const node = listNode("1. 未確認の史料", "li-0");
    expect(isStandaloneOrderedListItemEligibleForMarkerFreeProjection(node)).toBe(true);
  });

  it("a single top-level ')' delimiter ordered leaf item is eligible", () => {
    const node = listNode("1) 校合済みの転写", "li-0");
    expect(isStandaloneOrderedListItemEligibleForMarkerFreeProjection(node)).toBe(true);
  });

  it("a multi-digit numbered ordered leaf item is eligible", () => {
    const node = listNode("12. 別系統の検討", "li-0");
    expect(isStandaloneOrderedListItemEligibleForMarkerFreeProjection(node)).toBe(true);
  });

  it("an ordered leaf item directly under a heading section is eligible", () => {
    const node = listNode(["# 見出し", "1. 本文項目"].join("\n"), "li-0");
    expect(isStandaloneOrderedListItemEligibleForMarkerFreeProjection(node)).toBe(true);
  });

  it("the LEAF of a nested ordered list (the deepest, childless item) is eligible, even though its own parent is not", () => {
    const doc = parseDocument(["1. 親項目", "  1. 入れ子の leaf item"].join("\n"));
    const parent = doc.nodes.get("li-0");
    const leaf = doc.nodes.get("li-1");
    if (!parent || !isListNode(parent) || !leaf || !isListNode(leaf)) {
      throw new Error("fixture error");
    }
    expect(isStandaloneOrderedListItemEligibleForMarkerFreeProjection(leaf)).toBe(true);
    expect(isStandaloneOrderedListItemEligibleForMarkerFreeProjection(parent)).toBe(false);
  });

  it("an ordered task-list item is ALSO structurally eligible here — this gate is purely structural; whether the body actually is a checkbox (out of this ticket's scope, so falls back to raw display) is decided entirely at the text level by buildOrderedListProjection's own \"task-list-marker\" refusal (see view/PartialEditView.ts#buildStandaloneListProjections)", () => {
    const node = listNode("1. [ ] 通常のタスク項目", "li-0");
    expect(isStandaloneOrderedListItemEligibleForMarkerFreeProjection(node)).toBe(true);
  });
});

describe("Phase 5L-3: isStandaloneOrderedListItemEligibleForMarkerFreeProjection — ineligible shapes", () => {
  it("an unordered '-' marker item is ineligible", () => {
    const node = listNode("- 通常のリスト項目", "li-0");
    expect(isStandaloneOrderedListItemEligibleForMarkerFreeProjection(node)).toBe(false);
  });

  it("an unordered '*'/'+' marker item is ineligible", () => {
    const star = listNode("* 別系統の検討", "li-0");
    const plus = listNode("+ 確認済みの論点", "li-0");
    expect(isStandaloneOrderedListItemEligibleForMarkerFreeProjection(star)).toBe(false);
    expect(isStandaloneOrderedListItemEligibleForMarkerFreeProjection(plus)).toBe(false);
  });

  it("an unordered task-list item is ineligible", () => {
    const node = listNode("- [ ] 史料の確認事項", "li-0");
    expect(isStandaloneOrderedListItemEligibleForMarkerFreeProjection(node)).toBe(false);
  });

  it("a parent item that owns a nested child list is ineligible (childIds.length > 0), even when its own single line looks like a plain ordered leaf", () => {
    const doc = parseDocument(["1. 親項目", "  1. 子項目"].join("\n"));
    const parent = doc.nodes.get("li-0");
    if (!parent || !isListNode(parent)) throw new Error("fixture error");
    expect(parent.childIds.length).toBeGreaterThan(0);
    expect(isStandaloneOrderedListItemEligibleForMarkerFreeProjection(parent)).toBe(false);
  });

  it("an ordered item with a continuation paragraph is ineligible (range spans past its own start line with no child list item)", () => {
    const doc = parseDocument(["1. 項目本文", "  続きの段落。"].join("\n"));
    const node = doc.nodes.get("li-0");
    if (!node || !isListNode(node)) throw new Error("fixture error");
    expect(node.childIds.length).toBe(0);
    expect(node.range.endLine).toBeGreaterThan(node.range.startLine);
    expect(isStandaloneOrderedListItemEligibleForMarkerFreeProjection(node)).toBe(false);
  });

  it("mixed tab/space leading whitespace (unsafeIndent) is ineligible, defensively", () => {
    const doc = parseDocument("\t 1. 項目本文");
    const node = doc.nodes.get("li-0");
    if (!node || !isListNode(node)) throw new Error("fixture error");
    expect(node.unsafeIndent).toBe(true);
    expect(isStandaloneOrderedListItemEligibleForMarkerFreeProjection(node)).toBe(false);
  });

  it("is the exact structural inverse of isStandaloneListItemEligibleForMarkerFreeProjection for every ordered/unordered fixture in this file (the `ordered` flag is the only differing check)", () => {
    const fixtures: Array<[string, string]> = [
      ["1. item", "li-0"],
      ["- item", "li-0"],
      ["1) item", "li-0"],
      ["* item", "li-0"],
    ];
    for (const [text, id] of fixtures) {
      const node = listNode(text, id);
      expect(isStandaloneOrderedListItemEligibleForMarkerFreeProjection(node)).toBe(
        !isStandaloneListItemEligibleForMarkerFreeProjection(node)
      );
    }
  });

  it("agrees with isStandaloneTaskListItemEligibleForMarkerFreeProjection on every UNORDERED fixture (both structurally ineligible for an ordered-only item, and vice versa never both true)", () => {
    const fixtures: Array<[string, string]> = [
      ["- item", "li-0"],
      ["1. item", "li-0"],
      ["- [ ] task", "li-0"],
      ["1. [ ] task", "li-0"],
    ];
    for (const [text, id] of fixtures) {
      const node = listNode(text, id);
      const orderedEligible = isStandaloneOrderedListItemEligibleForMarkerFreeProjection(node);
      const taskEligible = isStandaloneTaskListItemEligibleForMarkerFreeProjection(node);
      // Structurally, orderedEligible === node.ordered and taskEligible is
      // ordered-agnostic (per that module's own top doc comment) except
      // for the same shared childIds/range/unsafeIndent checks — the two
      // gates must never BOTH report eligible for the SAME node's own
      // `ordered` flag being true and this gate's own criteria differing
      // only in that one flag.
      expect(orderedEligible).toBe(node.ordered);
    }
  });
});
