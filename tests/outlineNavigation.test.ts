import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { buildOutlineTree, OutlineTreeNode } from "../src/tree/buildOutlineTree";
import {
  buildNodeByIdMap,
  buildParentIdMap,
  flattenVisibleOutlineTree,
  nextVisibleId,
  prevVisibleId,
  shouldFollowKeyboardSelectionIntoBody,
} from "../src/tree/outlineNavigation";

// Shared fixture: a two-level heading tree with list items under one leaf
// section, so every case (siblings, parent/child, fold-hidden descendants)
// is exercised from one document.
//
// 0: # A
// 1: ## A1
// 2: - item1
// 3: - item2
// 4: ## A2
// 5: # B
const text = ["# A", "## A1", "- item1", "- item2", "## A2", "# B"].join("\n");

function tree(): OutlineTreeNode[] {
  const doc = parseDocument(text);
  return buildOutlineTree(doc, { includeLists: true });
}

function idOf(nodes: OutlineTreeNode[], predicate: (n: OutlineTreeNode) => boolean): string {
  for (const n of nodes) {
    if (predicate(n)) return n.id;
    const found = idOf(n.children, predicate);
    if (found) return found;
  }
  return "";
}

/** This fixture only ever contains section/list nodes — see tree() above. */
function labelOf(n: OutlineTreeNode): string {
  return n.kind === "section" ? n.headingText : n.kind === "list" ? n.text : "";
}

describe("flattenVisibleOutlineTree", () => {
  it("with nothing collapsed, includes every node in document order (same as flattenOutlineTree)", () => {
    const t = tree();
    const visible = flattenVisibleOutlineTree(t, new Set());
    const labels = visible.map((n) => (labelOf(n)));
    expect(labels).toEqual(["A", "A1", "item1", "item2", "A2", "B"]);
  });

  it("skips a collapsed node's descendants, but keeps the collapsed node itself and its own siblings", () => {
    const t = tree();
    const a1Id = idOf(t, (n) => n.kind === "section" && n.headingText === "A1");
    const visible = flattenVisibleOutlineTree(t, new Set([a1Id]));
    const labels = visible.map((n) => (labelOf(n)));
    // item1/item2 (children of A1) are gone; A1 itself, and A1's own
    // sibling A2, both remain.
    expect(labels).toEqual(["A", "A1", "A2", "B"]);
  });

  it("collapsing an ancestor two levels up hides every descendant, not just direct children", () => {
    const t = tree();
    const aId = idOf(t, (n) => n.kind === "section" && n.headingText === "A");
    const visible = flattenVisibleOutlineTree(t, new Set([aId]));
    const labels = visible.map((n) => (labelOf(n)));
    expect(labels).toEqual(["A", "B"]);
  });
});

describe("buildNodeByIdMap / buildParentIdMap", () => {
  it("maps every node to itself and to its parent id, regardless of fold state", () => {
    const t = tree();
    const nodeById = buildNodeByIdMap(t);
    const parentById = buildParentIdMap(t);

    const aId = idOf(t, (n) => n.kind === "section" && n.headingText === "A");
    const a1Id = idOf(t, (n) => n.kind === "section" && n.headingText === "A1");
    const item1Id = idOf(t, (n) => n.kind === "list" && n.text === "item1");
    const bId = idOf(t, (n) => n.kind === "section" && n.headingText === "B");

    expect(nodeById.get(a1Id)?.kind).toBe("section");
    expect(nodeById.get(item1Id)?.kind).toBe("list");

    expect(parentById.get(aId)).toBe(null);
    expect(parentById.get(a1Id)).toBe(aId);
    expect(parentById.get(item1Id)).toBe(a1Id);
    expect(parentById.get(bId)).toBe(null);
  });
});

describe("nextVisibleId / prevVisibleId", () => {
  it("null currentId (nothing selected yet) resolves to the first visible node", () => {
    const t = tree();
    const visible = flattenVisibleOutlineTree(t, new Set());
    expect(nextVisibleId(visible, null)).toBe(visible[0].id);
    expect(prevVisibleId(visible, null)).toBe(visible[0].id);
  });

  it("steps forward/backward through the visible list in order", () => {
    const t = tree();
    const visible = flattenVisibleOutlineTree(t, new Set());
    const aId = visible[0].id;
    const a1Id = visible[1].id;
    expect(nextVisibleId(visible, aId)).toBe(a1Id);
    expect(prevVisibleId(visible, a1Id)).toBe(aId);
  });

  it("clamps at the last node on Down (no wraparound)", () => {
    const t = tree();
    const visible = flattenVisibleOutlineTree(t, new Set());
    const lastId = visible[visible.length - 1].id;
    expect(nextVisibleId(visible, lastId)).toBe(lastId);
  });

  it("clamps at the first node on Up (no wraparound)", () => {
    const t = tree();
    const visible = flattenVisibleOutlineTree(t, new Set());
    const firstId = visible[0].id;
    expect(prevVisibleId(visible, firstId)).toBe(firstId);
  });

  it("a currentId no longer present in the visible list (e.g. just collapsed away) resolves to the first visible node", () => {
    const t = tree();
    const item1Id = idOf(t, (n) => n.kind === "list" && n.text === "item1");
    const a1Id = idOf(t, (n) => n.kind === "section" && n.headingText === "A1");
    // Collapse A1 so item1 is no longer visible, then ask for "next after
    // item1" as if a stale selection were passed in.
    const visible = flattenVisibleOutlineTree(t, new Set([a1Id]));
    expect(nextVisibleId(visible, item1Id)).toBe(visible[0].id);
    expect(prevVisibleId(visible, item1Id)).toBe(visible[0].id);
  });

  it("an empty visible list resolves to null in both directions", () => {
    expect(nextVisibleId([], null)).toBe(null);
    expect(prevVisibleId([], null)).toBe(null);
  });
});

describe("shouldFollowKeyboardSelectionIntoBody", () => {
  it("follows when enabled and selection moved to a different node", () => {
    expect(shouldFollowKeyboardSelectionIntoBody(true, "a", "b")).toBe(true);
  });

  it("follows when enabled and there was no previous selection (null -> a node)", () => {
    expect(shouldFollowKeyboardSelectionIntoBody(true, null, "a")).toBe(true);
  });

  it("does not follow when disabled, even if selection moved to a different node", () => {
    expect(shouldFollowKeyboardSelectionIntoBody(false, "a", "b")).toBe(false);
  });

  it("does not follow when enabled but selection stayed on the same node (in-place fold/unfold)", () => {
    expect(shouldFollowKeyboardSelectionIntoBody(true, "a", "a")).toBe(false);
  });

  it("does not follow when enabled but there is no next selection (clamped at an end, or nothing visible)", () => {
    expect(shouldFollowKeyboardSelectionIntoBody(true, "a", null)).toBe(false);
    expect(shouldFollowKeyboardSelectionIntoBody(true, null, null)).toBe(false);
  });

  it("disabled and no movement is still false (both conditions independently false)", () => {
    expect(shouldFollowKeyboardSelectionIntoBody(false, "a", "a")).toBe(false);
    expect(shouldFollowKeyboardSelectionIntoBody(false, null, null)).toBe(false);
  });
});
