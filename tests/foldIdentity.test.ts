import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { scanComplexBlocks } from "../src/parser/complexBlocks";
import { matchCompositeBlocks } from "../src/parser/compositeBlocks";
import { DEFAULT_COMPOSITE_BLOCK_RULES } from "../src/model/compositeBlock";
import { buildOutlineTree, OutlineTreeNode } from "../src/tree/buildOutlineTree";
import { buildNodeIdentityMap } from "../src/tree/foldIdentity";

function tree(text: string): OutlineTreeNode[] {
  return buildOutlineTree(parseDocument(text), { includeLists: true });
}

/** Same composite-projection pipeline as buildOutlineTree.test.ts's treeWithComposites. */
function treeWithComposites(text: string): OutlineTreeNode[] {
  const doc = parseDocument(text);
  const complexScan = scanComplexBlocks(doc);
  const infos = matchCompositeBlocks(doc, complexScan, DEFAULT_COMPOSITE_BLOCK_RULES);
  const complexBlocksById = new Map(complexScan.blocks.map((b) => [b.id, b]));
  return buildOutlineTree(doc, {
    includeLists: true,
    composites: { infos, complexBlocksById, rules: DEFAULT_COMPOSITE_BLOCK_RULES },
  });
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

describe("buildNodeIdentityMap (Phase 5D-0.3: composite / complex-member)", () => {
  it("gives every node in a composite-projected tree an identity entry, including the composite and its members", () => {
    const text = ["- ![[scan.png]]", "> [!ocr]", "> line1"].join("\n");
    const t = treeWithComposites(text);
    const map = buildNodeIdentityMap(t);
    // 1 composite + 2 members (list, complex-member) = 3 entries.
    expect(map.size).toBe(3);
  });

  it("a composite's own identity is a distinct `composite:<label>` segment", () => {
    const text = ["- ![[scan.png]]", "> [!ocr]", "> line1"].join("\n");
    const t = treeWithComposites(text);
    const map = buildNodeIdentityMap(t);
    const composite = t[0];
    expect(map.get(composite.id)).toBe("composite:Image + OCR");
  });

  it("a list item's identity is IDENTICAL whether or not it currently happens to be grouped into a composite (member membership must not affect identity — see this file's class doc comment §Phase 5D-0.3)", () => {
    const text = ["- ![[scan.png]]", "> [!ocr]", "> line1"].join("\n");

    // With composite projection: the list item is the composite's first
    // member (an OutlineTreeListNode nested under the composite node).
    const withComposite = treeWithComposites(text);
    const memberList = withComposite[0].children[0];
    const idWithComposite = buildNodeIdentityMap(withComposite).get(memberList.id);

    // Without composite projection (e.g. the rule got disabled, or the user
    // broke the match conditions in the body editor): the SAME list item
    // renders as a plain top-level list node instead.
    const plainTree = tree(text);
    const plainList = plainTree[0];
    const idPlain = buildNodeIdentityMap(plainTree).get(plainList.id);

    expect(idWithComposite).toBe(idPlain);
    expect(idWithComposite).toBe("list:![[scan.png]]");
  });

  it("a complex-block member (callout) gets its own `complex-member:<label>` identity, in a pool separate from list/composite", () => {
    const text = ["- ![[scan.png]]", "> [!ocr]", "> line1"].join("\n");
    const t = treeWithComposites(text);
    const map = buildNodeIdentityMap(t);
    const calloutMember = t[0].children[1];
    expect(map.get(calloutMember.id)).toBe("complex-member:line1");
  });

  it("two composites under the same section with identically-labeled members are disambiguated by occurrence, independently per kind", () => {
    const text = [
      "# H",
      "- ![[scan.png]]",
      "> [!ocr]",
      "> body",
      "",
      "- ![[scan.png]]",
      "> [!ocr]",
      "> body",
    ].join("\n");
    const t = treeWithComposites(text);
    const section = t[0];
    expect(section.children).toHaveLength(2);
    const map = buildNodeIdentityMap(t);
    const [first, second] = section.children;
    const firstId = map.get(first.id);
    const secondId = map.get(second.id);
    expect(firstId).not.toBe(secondId);
    expect(secondId).toMatch(/#1$/);
  });

  it("2026-08-12 amendment §B: a list item and a CompositeBlock that happen to produce the SAME label text, in the same section, never collide — the kind-prefixed segment (`list:X` vs `composite:X`) already disambiguates them without needing an occurrence suffix", () => {
    const text = [
      "# H",
      "- Image + OCR", // a plain list item whose text happens to equal the built-in rule's own display label
      "- ![[scan.png]]",
      "> [!ocr]",
      "> body",
    ].join("\n");
    const t = treeWithComposites(text);
    const section = t[0];
    expect(section.children.map((n) => n.kind)).toEqual(["list", "composite"]);
    const map = buildNodeIdentityMap(t);
    const [plainList, composite] = section.children;
    const plainListId = map.get(plainList.id);
    const compositeId = map.get(composite.id);
    expect(plainListId).toBe("section:H/list:Image + OCR");
    expect(compositeId).toBe("section:H/composite:Image + OCR");
    expect(plainListId).not.toBe(compositeId);
    // Neither carries a spurious occurrence suffix — each is the only node
    // of ITS OWN kind with this label under this section; the list/composite
    // occurrence pools are independent Maps (tree/foldIdentity.ts's
    // OccurrencePools), so one kind's count never influences the other's.
    expect(plainListId).not.toMatch(/#\d+$/);
    expect(compositeId).not.toMatch(/#\d+$/);
  });

  it("2026-08-12 amendment §B/§D: when body edits break a composite's match conditions (a blank line inserted between the list item and the callout), the member list item's fold identity is UNCHANGED across the before/after re-parse — the CompositeBlock's own identity simply stops being produced, but the underlying list item's identity was never derived from it in the first place", () => {
    const before = ["# H", "- ![[scan.png]]", "> [!ocr]", "> body"].join("\n");
    const after = ["# H", "- ![[scan.png]]", "", "> [!ocr]", "> body"].join("\n"); // blank line inserted -> match breaks

    const treeBefore = treeWithComposites(before);
    const treeAfter = treeWithComposites(after);

    // Before: grouped into a composite. After: a plain top-level list row.
    expect(treeBefore[0].children[0].kind).toBe("composite");
    expect(treeAfter[0].children.map((n) => n.kind)).toEqual(["list"]);

    const memberListBefore = treeBefore[0].children[0].children[0];
    const listAfter = treeAfter[0].children[0];
    const idBefore = buildNodeIdentityMap(treeBefore).get(memberListBefore.id);
    const idAfter = buildNodeIdentityMap(treeAfter).get(listAfter.id);
    expect(idBefore).toBe(idAfter);
    expect(idBefore).toBe("section:H/list:![[scan.png]]");
  });
});
