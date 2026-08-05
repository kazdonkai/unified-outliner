import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { buildOutlineTree, OutlineTreeNode } from "../src/tree/buildOutlineTree";
import { buildNodeIdentityMap } from "../src/tree/foldIdentity";

function tree(text: string): OutlineTreeNode[] {
  return buildOutlineTree(parseDocument(text), { includeLists: true });
}

function idOf(nodes: OutlineTreeNode[], predicate: (n: OutlineTreeNode) => boolean): string {
  for (const n of nodes) {
    if (predicate(n)) return n.id;
    const found = idOf(n.children, predicate);
    if (found) return found;
  }
  return "";
}

describe("buildNodeIdentityMap", () => {
  it("gives every node in the tree an entry", () => {
    const t = tree(["# A", "## A1", "- item1", "## A2"].join("\n"));
    const map = buildNodeIdentityMap(t);
    expect(map.size).toBe(4);
  });

  it("the same document text re-parsed twice (fresh node.id counters both times) produces IDENTICAL identity strings for the same content", () => {
    const text = ["# A", "## A1", "- item1", "- item2"].join("\n");
    const t1 = tree(text);
    const t2 = tree(text);
    const map1 = buildNodeIdentityMap(t1);
    const map2 = buildNodeIdentityMap(t2);

    const a1Id1 = idOf(t1, (n) => n.kind === "section" && n.headingText === "A1");
    const a1Id2 = idOf(t2, (n) => n.kind === "section" && n.headingText === "A1");
    // node.id itself need not match (it's a fresh per-parse counter — it
    // does happen to match here since both parses see identical input in
    // the same order, but that's incidental, not something this test
    // relies on); the IDENTITY must match regardless.
    expect(map1.get(a1Id1)).toBe(map2.get(a1Id2));

    const item1Id1 = idOf(t1, (n) => n.kind === "list" && n.text === "item1");
    const item1Id2 = idOf(t2, (n) => n.kind === "list" && n.text === "item1");
    expect(map1.get(item1Id1)).toBe(map2.get(item1Id2));
  });

  it("a node's identity is unaffected by reordering ITS OWN SIBLINGS elsewhere in the document (survives the plugin's own move/indent operations)", () => {
    const before = ["# A", "# B", "# C"].join("\n");
    const after = ["# C", "# A", "# B"].join("\n"); // as if C moved to the top
    const mapBefore = buildNodeIdentityMap(tree(before));
    const mapAfter = buildNodeIdentityMap(tree(after));

    const aIdBefore = idOf(tree(before), (n) => n.kind === "section" && n.headingText === "A");
    const aIdAfter = idOf(tree(after), (n) => n.kind === "section" && n.headingText === "A");
    expect(mapBefore.get(aIdBefore)).toBe(mapAfter.get(aIdAfter));
  });

  it("changing a node's own label produces a DIFFERENT identity (documented limitation — rename does not carry fold state forward)", () => {
    const before = tree("# Original Title");
    const after = tree("# Renamed Title");
    const mapBefore = buildNodeIdentityMap(before);
    const mapAfter = buildNodeIdentityMap(after);
    const idBefore = idOf(before, (n) => n.kind === "section");
    const idAfter = idOf(after, (n) => n.kind === "section");
    expect(mapBefore.get(idBefore)).not.toBe(mapAfter.get(idAfter));
  });

  it("changing an ANCESTOR's label also changes a descendant's identity (path includes the whole ancestor chain)", () => {
    const before = tree(["# Parent", "## Child"].join("\n"));
    const after = tree(["# Renamed Parent", "## Child"].join("\n"));
    const mapBefore = buildNodeIdentityMap(before);
    const mapAfter = buildNodeIdentityMap(after);
    const childBefore = idOf(before, (n) => n.kind === "section" && n.headingText === "Child");
    const childAfter = idOf(after, (n) => n.kind === "section" && n.headingText === "Child");
    expect(mapBefore.get(childBefore)).not.toBe(mapAfter.get(childAfter));
  });

  it("a list item's identity is unaffected by re-nesting under a DIFFERENT list-item parent, as long as it stays under the same enclosing section (scoped to section, not to the exact list-item ancestor chain)", () => {
    const before = tree(["# H", "- a", "  - item", "- b"].join("\n"));
    const after = tree(["# H", "- a", "- b", "  - item"].join("\n"));
    const mapBefore = buildNodeIdentityMap(before);
    const mapAfter = buildNodeIdentityMap(after);
    const itemBefore = idOf(before, (n) => n.kind === "list" && n.text === "item");
    const itemAfter = idOf(after, (n) => n.kind === "list" && n.text === "item");
    expect(mapBefore.get(itemBefore)).toBe(mapAfter.get(itemAfter));
  });

  it("a list item's identity DOES change when it's relocated to a DIFFERENT enclosing section (known, documented limitation — see module doc comment)", () => {
    const before = tree(["# Alpha", "# Beta", "- item"].join("\n"));
    const after = tree(["# Alpha", "- item", "# Beta"].join("\n"));
    const mapBefore = buildNodeIdentityMap(before);
    const mapAfter = buildNodeIdentityMap(after);
    const itemBefore = idOf(before, (n) => n.kind === "list" && n.text === "item");
    const itemAfter = idOf(after, (n) => n.kind === "list" && n.text === "item");
    expect(mapBefore.get(itemBefore)).not.toBe(mapAfter.get(itemAfter));
  });

  it("two siblings with the IDENTICAL label under the same parent get DISTINCT identities (occurrence-index disambiguation)", () => {
    const t = tree(["# H", "- dup", "- dup", "- dup"].join("\n"));
    const map = buildNodeIdentityMap(t);
    const listNodes = t[0].children; // all three "dup" items, document order
    const identities = listNodes.map((n) => map.get(n.id));
    expect(new Set(identities).size).toBe(3); // all distinct
  });

  it("identically-labeled nodes under DIFFERENT parents do not collide with each other (no spurious #N suffix needed)", () => {
    const t = tree(["# A", "- same", "# B", "- same"].join("\n"));
    const map = buildNodeIdentityMap(t);
    const aItem = idOf(t, (n) => n.kind === "list" && n.text === "same");
    // idOf finds the first match (under A); locate the second manually.
    const bSection = t.find((n) => n.kind === "section" && n.headingText === "B")!;
    const bItem = bSection.children[0];
    const aIdentity = map.get(aItem);
    const bIdentity = map.get(bItem.id);
    expect(aIdentity).not.toBe(bIdentity);
    // Neither should carry a spurious occurrence suffix, since each is the
    // only "list:same" under its own parent.
    expect(aIdentity).not.toMatch(/#\d+$/);
    expect(bIdentity).not.toMatch(/#\d+$/);
  });
});
