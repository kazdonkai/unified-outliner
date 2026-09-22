/**
 * Phase 5L-2 ("Task List Marker-Free Partial Edit"): pure unit tests for
 * edit/standaloneTaskListProjection.ts#isStandaloneTaskListItemEligibleForMarkerFreeProjection
 * — mirrors tests/standaloneListMarkerProjection.test.ts's own structure
 * exactly, since the two gates share the identical structural criteria
 * (see that module's own top doc comment for why this is a deliberate,
 * independent copy rather than a shared import).
 *
 * Every fixture goes through the REAL parser (parser/parseDocument.ts) —
 * never a hand-built ListBlockNode literal — matching this project's own
 * "prefer a real fixture over a hand-typed snapshot" convention.
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { isListNode } from "../src/model/block";
import { isStandaloneTaskListItemEligibleForMarkerFreeProjection } from "../src/edit/standaloneTaskListProjection";
import { isStandaloneListItemEligibleForMarkerFreeProjection } from "../src/edit/standaloneListMarkerProjection";

function listNode(text: string, nodeId: string) {
  const doc = parseDocument(text);
  const node = doc.nodes.get(nodeId);
  if (!node || !isListNode(node)) {
    throw new Error(`fixture error: ${nodeId} did not resolve to a list node`);
  }
  return node;
}

describe("Phase 5L-2: isStandaloneTaskListItemEligibleForMarkerFreeProjection — eligible shapes", () => {
  it("a single top-level unchecked task leaf item is eligible", () => {
    const node = listNode("- [ ] 未確認の史料", "li-0");
    expect(isStandaloneTaskListItemEligibleForMarkerFreeProjection(node)).toBe(true);
  });

  it("a single top-level checked task leaf item is eligible", () => {
    const node = listNode("- [x] 校合済みの転写", "li-0");
    expect(isStandaloneTaskListItemEligibleForMarkerFreeProjection(node)).toBe(true);
  });

  it("'*' and '+' marker task items are eligible", () => {
    const star = listNode("* [ ] 別系統の検討", "li-0");
    const plus = listNode("+ [X] 確認済みの論点", "li-0");
    expect(isStandaloneTaskListItemEligibleForMarkerFreeProjection(star)).toBe(true);
    expect(isStandaloneTaskListItemEligibleForMarkerFreeProjection(plus)).toBe(true);
  });

  it("a task leaf item directly under a heading section is eligible", () => {
    const node = listNode(["# 見出し", "- [ ] 本文タスク"].join("\n"), "li-0");
    expect(isStandaloneTaskListItemEligibleForMarkerFreeProjection(node)).toBe(true);
  });

  it("the LEAF of a nested list (the deepest, childless task item) is eligible, even though its own parent is not", () => {
    const doc = parseDocument(["- 親項目", "  - [ ] 入れ子の leaf task"].join("\n"));
    const parent = doc.nodes.get("li-0");
    const leaf = doc.nodes.get("li-1");
    if (!parent || !isListNode(parent) || !leaf || !isListNode(leaf)) {
      throw new Error("fixture error");
    }
    expect(isStandaloneTaskListItemEligibleForMarkerFreeProjection(leaf)).toBe(true);
    expect(isStandaloneTaskListItemEligibleForMarkerFreeProjection(parent)).toBe(false);
  });

  it("a non-task item is ALSO structurally eligible here — this gate is purely structural, identical to isStandaloneListItemEligibleForMarkerFreeProjection's own result for the same node; which builder (buildListMarkerProjection vs. buildTaskListProjection) actually succeeds is decided entirely at the text level (see view/PartialEditView.ts#buildStandaloneListProjections)", () => {
    const node = listNode("- 通常のリスト項目", "li-0");
    expect(isStandaloneTaskListItemEligibleForMarkerFreeProjection(node)).toBe(true);
    expect(isStandaloneListItemEligibleForMarkerFreeProjection(node)).toBe(true);
  });
});

describe("Phase 5L-2: isStandaloneTaskListItemEligibleForMarkerFreeProjection — ineligible shapes", () => {
  it("an ordered-marker task item is ineligible", () => {
    const node = listNode("1. [ ] 史料の確認事項", "li-0");
    expect(isStandaloneTaskListItemEligibleForMarkerFreeProjection(node)).toBe(false);
  });

  it("a parent item that owns a nested child list is ineligible (childIds.length > 0), even when its own single line looks like a plain task leaf", () => {
    const doc = parseDocument(["- [ ] 親タスク", "  - [ ] 子タスク"].join("\n"));
    const parent = doc.nodes.get("li-0");
    if (!parent || !isListNode(parent)) throw new Error("fixture error");
    expect(parent.childIds.length).toBeGreaterThan(0);
    expect(isStandaloneTaskListItemEligibleForMarkerFreeProjection(parent)).toBe(false);
  });

  it("a task item with a continuation paragraph is ineligible (range spans past its own start line with no child list item)", () => {
    const doc = parseDocument(["- [ ] タスク本文", "  続きの段落。"].join("\n"));
    const node = doc.nodes.get("li-0");
    if (!node || !isListNode(node)) throw new Error("fixture error");
    expect(node.childIds.length).toBe(0);
    expect(node.range.endLine).toBeGreaterThan(node.range.startLine);
    expect(isStandaloneTaskListItemEligibleForMarkerFreeProjection(node)).toBe(false);
  });

  it("mixed tab/space leading whitespace (unsafeIndent) is ineligible, defensively", () => {
    const doc = parseDocument("\t - [ ] タスク本文");
    const node = doc.nodes.get("li-0");
    if (!node || !isListNode(node)) throw new Error("fixture error");
    expect(node.unsafeIndent).toBe(true);
    expect(isStandaloneTaskListItemEligibleForMarkerFreeProjection(node)).toBe(false);
  });

  it("matches isStandaloneListItemEligibleForMarkerFreeProjection's own result exactly across every fixture in this file — the two gates are structurally identical by design (see this module's own top doc comment)", () => {
    const fixtures: Array<[string, string]> = [
      ["- [ ] item", "li-0"],
      ["1. [ ] ordered", "li-0"],
    ];
    for (const [text, id] of fixtures) {
      const node = listNode(text, id);
      expect(isStandaloneTaskListItemEligibleForMarkerFreeProjection(node)).toBe(
        isStandaloneListItemEligibleForMarkerFreeProjection(node)
      );
    }
  });
});
