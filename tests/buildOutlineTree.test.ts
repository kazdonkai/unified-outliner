import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { scanComplexBlocks } from "../src/parser/complexBlocks";
import { matchCompositeBlocks } from "../src/parser/compositeBlocks";
import {
  CompositeBlockInfo,
  CompositeBlockRule,
  DEFAULT_COMPOSITE_BLOCK_RULES,
} from "../src/model/compositeBlock";
import { createTranslator } from "../src/i18n";
import {
  buildOutlineTree,
  collectReadOnlyOutlineNodeIds,
  complexMemberDisplayLabel,
  flattenOutlineTree,
  isOutlineCompositeNode,
  isOutlineComplexMemberNode,
  isOutlineListNode,
  isOutlineSectionNode,
  nodeDisplayLabel,
  OutlineTreeNode,
} from "../src/tree/buildOutlineTree";
import { FIX_BASIC, ownerAt } from "./fixtures";

/** Builds a tree WITH composite projection, using the real scan/match pipeline (same call sequence view/OutlineTreeView.ts's refresh() uses). */
function treeWithComposites(
  text: string,
  includeLists = false,
  rules: CompositeBlockRule[] = DEFAULT_COMPOSITE_BLOCK_RULES
) {
  const doc = parseDocument(text);
  const complexScan = scanComplexBlocks(doc);
  const infos = matchCompositeBlocks(doc, complexScan, rules);
  const complexBlocksById = new Map(complexScan.blocks.map((b) => [b.id, b]));
  return buildOutlineTree(doc, {
    includeLists,
    composites: { infos, complexBlocksById, rules },
    t: createTranslator("en"),
  });
}

/** Test helper: section headingText, or "" for a list node (never expected in section-only assertions). */
function headingTextOf(n: OutlineTreeNode): string {
  return isOutlineSectionNode(n) ? n.headingText : "";
}

describe("buildOutlineTree (section-only, default)", () => {
  it("builds a 1-level tree of sibling sections", () => {
    const doc = parseDocument(["# A", "text a", "# B", "text b"].join("\n"));
    const tree = buildOutlineTree(doc);
    expect(tree.every(isOutlineSectionNode)).toBe(true);
    expect(tree.map(headingTextOf)).toEqual(["A", "B"]);
    expect(tree.every((n) => n.children.length === 0)).toBe(true);
  });

  it("nests child sections under their parent, preserving levels and line numbers", () => {
    const doc = parseDocument(
      ["# A", "## A-1", "### A-1-1", "text", "# B"].join("\n")
    );
    const tree = buildOutlineTree(doc);
    expect(tree).toHaveLength(2);
    const [a, b] = tree;
    if (!isOutlineSectionNode(a) || !isOutlineSectionNode(b)) throw new Error("expected sections");
    expect(a.headingText).toBe("A");
    expect(a.headingLevel).toBe(1);
    expect(a.line).toBe(0);
    expect(a.children).toHaveLength(1);
    const a1 = a.children[0];
    if (!isOutlineSectionNode(a1)) throw new Error("expected section");
    expect(a1.headingText).toBe("A-1");
    expect(a1.headingLevel).toBe(2);
    expect(a1.line).toBe(1);
    expect(a1.children).toHaveLength(1);
    const a11 = a1.children[0];
    if (!isOutlineSectionNode(a11)) throw new Error("expected section");
    expect(a11.headingText).toBe("A-1-1");
    expect(a11.line).toBe(2);
    expect(b.headingText).toBe("B");
    expect(b.children).toHaveLength(0);
  });

  it("does not include list items as tree nodes by default", () => {
    const doc = parseDocument(FIX_BASIC);
    const tree = buildOutlineTree(doc);
    // FIX_BASIC: "# A" > "## B" (children), then "# C" as a sibling of A.
    expect(tree.map(headingTextOf)).toEqual(["A", "C"]);
    expect(tree[0].children.map(headingTextOf)).toEqual(["B"]);
    expect(tree.every(isOutlineSectionNode)).toBe(true);
  });

  it("does not include list items even when includeLists is explicitly false", () => {
    const doc = parseDocument(FIX_BASIC);
    const tree = buildOutlineTree(doc, { includeLists: false });
    expect(tree.every(isOutlineSectionNode)).toBe(true);
  });

  it("handles a document with no headings at all", () => {
    const doc = parseDocument(["just text", "- a list item"].join("\n"));
    expect(buildOutlineTree(doc)).toEqual([]);
  });

  it("does not build nodes for headings inside frontmatter or code fences", () => {
    const text = [
      "---",
      "title: x",
      "---",
      "# Real Heading",
      "```",
      "# not a heading",
      "```",
      "text",
    ].join("\n");
    const doc = parseDocument(text);
    const tree = buildOutlineTree(doc);
    expect(tree.map(headingTextOf)).toEqual(["Real Heading"]);
  });
});

describe("buildOutlineTree (includeLists: true, Phase 3C)", () => {
  it("interleaves root list items with child sections in document order", () => {
    const doc = parseDocument(FIX_BASIC);
    const tree = buildOutlineTree(doc, { includeLists: true });

    // Top level: "# A" then "# C" (list items belong under A, not top-level).
    expect(tree.map((n) => n.kind)).toEqual(["section", "section"]);
    const [a, c] = tree;
    if (!isOutlineSectionNode(a) || !isOutlineSectionNode(c)) throw new Error("expected sections");

    // Under A, document order is: list "one" (with nested "one-1"), list
    // "two", then section "B" — childIds itself does NOT preserve this
    // order (sections are appended before list items in parseDocument.ts),
    // so this specifically exercises the line-number re-sort.
    expect(a.children.map((n) => n.kind)).toEqual(["list", "list", "section"]);
    const [one, two, b] = a.children;
    if (!isOutlineListNode(one) || !isOutlineListNode(two) || !isOutlineSectionNode(b)) {
      throw new Error("unexpected node kinds");
    }
    expect(one.text).toBe("one");
    expect(one.indentDepth).toBe(0);
    expect(one.children).toHaveLength(1);
    const oneOne = one.children[0];
    if (!isOutlineListNode(oneOne)) throw new Error("expected list node");
    expect(oneOne.text).toBe("one-1");
    expect(oneOne.indentDepth).toBe(1);
    expect(two.text).toBe("two");
    expect(b.headingText).toBe("B");

    // Under B: list items "three", "four" (no nested children).
    expect(b.children.map((n) => n.kind)).toEqual(["list", "list"]);
    const [three, four] = b.children;
    if (!isOutlineListNode(three) || !isOutlineListNode(four)) throw new Error("expected list nodes");
    expect(three.text).toBe("three");
    expect(four.text).toBe("four");

    // C has no list items ("text" on line 12 is a plain body line, not a list).
    expect(c.children).toHaveLength(0);
  });

  it("includes pre-heading root list items as top-level nodes", () => {
    const doc = parseDocument(
      ["- pre a", "- pre b", "# Heading"].join("\n")
    );
    const tree = buildOutlineTree(doc, { includeLists: true });
    expect(tree.map((n) => n.kind)).toEqual(["list", "list", "section"]);
    const [preA, preB] = tree;
    if (!isOutlineListNode(preA) || !isOutlineListNode(preB)) throw new Error("expected list nodes");
    expect(preA.text).toBe("pre a");
    expect(preB.text).toBe("pre b");
  });

  it("strips the list marker and indent from the display text", () => {
    const doc = parseDocument(["- Item text here", "1. Ordered item"].join("\n"));
    const tree = buildOutlineTree(doc, { includeLists: true });
    expect(tree.map((n) => (isOutlineListNode(n) ? n.text : ""))).toEqual([
      "Item text here",
      "Ordered item",
    ]);
  });

  it("handles a document with only list items and no headings", () => {
    const doc = parseDocument(["- a", "- b"].join("\n"));
    const tree = buildOutlineTree(doc, { includeLists: true });
    expect(tree.map((n) => n.kind)).toEqual(["list", "list"]);
  });
});

describe("flattenOutlineTree", () => {
  it("flattens depth-first in document order", () => {
    const doc = parseDocument(
      ["# A", "## A-1", "# B"].join("\n")
    );
    const tree = buildOutlineTree(doc);
    const flat = flattenOutlineTree(tree).map(headingTextOf);
    expect(flat).toEqual(["A", "A-1", "B"]);
  });

  it("flattens sections and list nodes together, depth-first", () => {
    const doc = parseDocument(FIX_BASIC);
    const tree = buildOutlineTree(doc, { includeLists: true });
    const flat = flattenOutlineTree(tree).map((n) =>
      isOutlineSectionNode(n) ? n.headingText : isOutlineListNode(n) ? n.text : ""
    );
    expect(flat).toEqual(["A", "one", "one-1", "two", "B", "three", "four", "C"]);
  });
});

describe("nodeDisplayLabel", () => {
  it("prefers headingText for a section", () => {
    const doc = parseDocument(FIX_BASIC);
    const a = ownerAt(doc, 0); // "# A"
    expect(nodeDisplayLabel(doc, a)).toBe("A");
  });

  it("reflects listItemDisplayText for a list item", () => {
    const doc = parseDocument(FIX_BASIC);
    const one = ownerAt(doc, 3); // "- one"
    expect(nodeDisplayLabel(doc, one)).toBe("one");
  });

  it("falls back to the placeholder text for an empty heading", () => {
    const doc = parseDocument(["# ", "text"].join("\n"));
    const empty = ownerAt(doc, 0);
    expect(nodeDisplayLabel(doc, empty)).toBe("(Untitled heading)");
  });

  it("falls back to the placeholder text for an empty list item", () => {
    const doc = parseDocument("- ");
    const empty = ownerAt(doc, 0);
    expect(nodeDisplayLabel(doc, empty)).toBe("(Empty list item)");
  });
});

describe("buildOutlineTree (Phase 5D-0.3: CompositeBlock projection)", () => {
  it("projects a matched image-ocr composite as a composite node with its two members as children", () => {
    const text = ["- ![[scan-001.png]]", "> [!ocr]", "> line1"].join("\n");
    const tree = treeWithComposites(text);
    expect(tree).toHaveLength(1);
    const composite = tree[0];
    if (!isOutlineCompositeNode(composite)) throw new Error("expected composite node");
    expect(composite.ruleId).toBe("image-ocr");
    expect(composite.label).toBe("Image + OCR");
    expect(composite.prefix).toBe("◉");
    expect(composite.line).toBe(0);
    expect(composite.children).toHaveLength(2);

    const [listMember, calloutMember] = composite.children;
    if (!isOutlineListNode(listMember)) throw new Error("expected list member");
    expect(listMember.text).toBe("![[scan-001.png]]");
    if (!isOutlineComplexMemberNode(calloutMember)) throw new Error("expected complex-member");
    expect(calloutMember.complexKind).toBe("callout");
  });

  it("projects composite members regardless of includeLists (approval §4 — composite projection is independent of showListItemsInOutline)", () => {
    const text = ["- source image", "> plain quote body"].join("\n");
    const treeListsOff = treeWithComposites(text, false);
    const treeListsOn = treeWithComposites(text, true);
    expect(treeListsOff).toHaveLength(1);
    expect(treeListsOn).toHaveLength(1);
    expect(isOutlineCompositeNode(treeListsOff[0])).toBe(true);
    expect(isOutlineCompositeNode(treeListsOn[0])).toBe(true);
  });

  it("a list item NOT part of any composite still follows includeLists exactly as before", () => {
    const text = ["- lone item (no follow-up)"].join("\n");
    expect(treeWithComposites(text, false)).toHaveLength(0);
    const treeOn = treeWithComposites(text, true);
    expect(treeOn).toHaveLength(1);
    expect(isOutlineListNode(treeOn[0])).toBe(true);
  });

  it("omitting the composites option entirely reproduces the pre-5D-0.3 tree unchanged", () => {
    const doc = parseDocument(["- ![[scan-001.png]]", "> [!ocr]", "> line1"].join("\n"));
    const tree = buildOutlineTree(doc, { includeLists: true });
    // No composite projection requested: the list item and callout are NOT
    // merged — the callout isn't a BlockNode at all, so only the list item
    // appears (a bare callout has no representation in the pre-5D-0.3 tree).
    expect(tree).toHaveLength(1);
    expect(isOutlineListNode(tree[0])).toBe(true);
  });

  it("a disabled rule (empty rules/infos) leaves the underlying list item to render as a plain list node", () => {
    const doc = parseDocument(["- ![[scan-001.png]]", "> [!ocr]", "> line1"].join("\n"));
    const tree = buildOutlineTree(doc, {
      includeLists: true,
      composites: { infos: [], complexBlocksById: new Map(), rules: [] },
    });
    expect(tree).toHaveLength(1);
    expect(isOutlineListNode(tree[0])).toBe(true);
  });

  it("a composite nested under a section is projected in place of the list item, alongside the section's other children", () => {
    const text = ["# H", "- before", "- ![[scan.png]]", "> [!ocr]", "> body", "- after"].join(
      "\n"
    );
    const tree = treeWithComposites(text, true);
    expect(tree).toHaveLength(1);
    const section = tree[0];
    if (!isOutlineSectionNode(section)) throw new Error("expected section");
    expect(section.children.map((n) => n.kind)).toEqual(["list", "composite", "list"]);
  });

  it("a composite matched via a NESTED list candidate is projected at that same nesting depth, as a child of its own parent list item (buildListNode's substitution branch, not just buildChildren's root-level one)", () => {
    // "outer" itself doesn't qualify as a member (its own range spans
    // through its child's line, disqualifying it from "single-line-list" —
    // see compositeBlocks.test.ts's "OUTER (multi-line, has-a-child) list
    // item does not qualify... its INNER child... independently does"), but
    // its child "![[scan.png]]" is itself a valid, single-line candidate
    // immediately followed by the callout.
    const text = ["- outer", "  - ![[scan.png]]", "> [!ocr]", "> body"].join("\n");
    const tree = treeWithComposites(text, true);
    expect(tree).toHaveLength(1);
    const outer = tree[0];
    if (!isOutlineListNode(outer)) throw new Error("expected outer list node");
    expect(outer.text).toBe("outer");
    expect(outer.children).toHaveLength(1);
    const composite = outer.children[0];
    if (!isOutlineCompositeNode(composite)) throw new Error("expected nested composite node");
    expect(composite.ruleId).toBe("image-ocr");
    const listMember = composite.children[0];
    if (!isOutlineListNode(listMember)) throw new Error("expected list member");
    expect(listMember.text).toBe("![[scan.png]]");
    // A single-line-list member is, by construction, always childless (see
    // the doc comment above on why a list item with children can never be
    // "single-line").
    expect(listMember.children).toHaveLength(0);
  });

  it("a member block is never duplicated: its id appears exactly once in the flattened tree (as the composite's own child), never ALSO as an independent sibling row", () => {
    const text = ["- ![[scan-001.png]]", "> [!ocr]", "> line1"].join("\n");
    const tree = treeWithComposites(text, true);
    const flat = flattenOutlineTree(tree);
    const listMemberOccurrences = flat.filter(
      (n) => isOutlineListNode(n) && n.text === "![[scan-001.png]]"
    );
    expect(listMemberOccurrences).toHaveLength(1);
    // And the composite itself is the ONLY top-level node — no separate,
    // un-grouped copy of the list item sits alongside it.
    expect(tree).toHaveLength(1);
  });

  it("composite.line is the first member's own startLine, and each member's own .line is that member's own startLine — not the composite's range start reused for every child", () => {
    const text = ["# H", "text", "- ![[scan.png]]", "> [!ocr]", "> body line"].join("\n");
    const tree = treeWithComposites(text, true);
    const section = tree[0];
    if (!isOutlineSectionNode(section)) throw new Error("expected section");
    const composite = section.children[0];
    if (!isOutlineCompositeNode(composite)) throw new Error("expected composite");
    expect(composite.line).toBe(2); // "- ![[scan.png]]"
    const [listMember, calloutMember] = composite.children;
    expect(listMember.line).toBe(2);
    expect(calloutMember.line).toBe(3); // "> [!ocr]"
  });

  it("an empty rule prefix produces an empty prefix field on the composite node (no stray placeholder text)", () => {
    const text = ["- one", "> [!note]", "> body"].join("\n");
    const noPrefixRule: CompositeBlockRule[] = [
      { id: "no-prefix", kindSequence: ["single-line-list", "callout"], prefix: "" },
    ];
    const tree = treeWithComposites(text, false, noPrefixRule);
    const composite = tree[0];
    if (!isOutlineCompositeNode(composite)) throw new Error("expected composite");
    expect(composite.prefix).toBe("");
  });

  describe("2026-08-12 amendment §A: safe fallback when a composite's members can't share one Tree projection position", () => {
    it("a composite whose first member does NOT resolve to a ListBlockNode in this doc is silently skipped — never projected, and its (unrelated) list content renders normally", () => {
      const text = ["- a real list item"].join("\n");
      const doc = parseDocument(text);
      // A hand-built CompositeBlockInfo referencing an id that simply
      // doesn't exist in this doc at all — simulating a caller passing
      // `infos` computed against a DIFFERENT parse than `doc` itself (the
      // one thing view/OutlineTreeView.ts's refresh() never actually does,
      // since it always derives infos/doc from the same pass — but this
      // module must still degrade safely rather than crash or fabricate a
      // node for a nonexistent id).
      const bogusInfo: CompositeBlockInfo = {
        id: "composite-bogus",
        ruleId: "image-ocr",
        range: { startLine: 0, endLine: 1 },
        members: [
          { kind: "single-line-list", id: "li-does-not-exist", range: { startLine: 0, endLine: 0 } },
          { kind: "callout", id: "callout-does-not-exist", range: { startLine: 1, endLine: 1 } },
        ],
        sectionId: null,
      };
      const tree = buildOutlineTree(doc, {
        includeLists: true,
        composites: { infos: [bogusInfo], complexBlocksById: new Map(), rules: DEFAULT_COMPOSITE_BLOCK_RULES },
      });
      // No crash, and the real list item renders as an ordinary list row —
      // the bogus composite contributes nothing to the tree at all.
      expect(tree).toHaveLength(1);
      expect(isOutlineListNode(tree[0])).toBe(true);
      if (isOutlineListNode(tree[0])) expect(tree[0].text).toBe("a real list item");
    });

    it("a composite whose SECOND member can't be resolved (missing from complexBlocksById) is also skipped entirely — not partially projected with a garbage label", () => {
      const text = ["- ![[scan.png]]", "> [!ocr]", "> body"].join("\n");
      const doc = parseDocument(text);
      const complexScan = scanComplexBlocks(doc);
      const infos = matchCompositeBlocks(doc, complexScan, DEFAULT_COMPOSITE_BLOCK_RULES);
      expect(infos).toHaveLength(1);
      // Deliberately pass an EMPTY complexBlocksById (as if the caller forgot
      // to include the callout's own ComplexBlockInfo) instead of the real
      // one derived from complexScan.
      const tree = buildOutlineTree(doc, {
        includeLists: true,
        composites: { infos, complexBlocksById: new Map(), rules: DEFAULT_COMPOSITE_BLOCK_RULES },
      });
      // Falls back to the underlying list item as a plain row — no composite
      // node, and no complex-member row with a raw-id/garbage label either.
      expect(tree).toHaveLength(1);
      expect(isOutlineListNode(tree[0])).toBe(true);
    });

    it("2026-08-12 self-review §9 論点2: a composite whose ruleId does NOT resolve in `rules` is skipped entirely — never projected with a raw-ruleId label as a degraded fallback", () => {
      const text = ["- ![[scan.png]]", "> [!ocr]", "> body"].join("\n");
      const doc = parseDocument(text);
      const complexScan = scanComplexBlocks(doc);
      const infos = matchCompositeBlocks(doc, complexScan, DEFAULT_COMPOSITE_BLOCK_RULES);
      expect(infos).toHaveLength(1);
      const complexBlocksById = new Map(complexScan.blocks.map((b) => [b.id, b]));
      // Every member resolves fine; only `rules` is mismatched (as if the
      // caller passed a rules list that doesn't include the rule `infos`
      // was actually matched against).
      const tree = buildOutlineTree(doc, {
        includeLists: true,
        composites: { infos, complexBlocksById, rules: [] },
      });
      expect(tree).toHaveLength(1);
      expect(isOutlineListNode(tree[0])).toBe(true);
    });

    it("a first member whose kind is list/single-line-list but whose id resolves to a SECTION (not a ListBlockNode) is skipped, not force-projected", () => {
      const text = ["# heading text"].join("\n");
      const doc = parseDocument(text);
      const sectionId = doc.topLevelIds[0];
      const bogusInfo: CompositeBlockInfo = {
        id: "composite-bogus-2",
        ruleId: "image-ocr",
        range: { startLine: 0, endLine: 0 },
        members: [
          { kind: "single-line-list", id: sectionId, range: { startLine: 0, endLine: 0 } },
          { kind: "callout", id: "callout-x", range: { startLine: 0, endLine: 0 } },
        ],
        sectionId: null,
      };
      const tree = buildOutlineTree(doc, {
        composites: { infos: [bogusInfo], complexBlocksById: new Map(), rules: DEFAULT_COMPOSITE_BLOCK_RULES },
      });
      expect(tree).toHaveLength(1);
      expect(isOutlineSectionNode(tree[0])).toBe(true);
    });
  });
});

describe("collectReadOnlyOutlineNodeIds (Phase 5D-0.3)", () => {
  it("marks a composite's own id, and every one of its member ids, as read-only", () => {
    const text = ["- ![[scan.png]]", "> [!ocr]", "> body"].join("\n");
    const tree = treeWithComposites(text, true);
    const composite = tree[0];
    if (!isOutlineCompositeNode(composite)) throw new Error("expected composite");
    const readOnly = collectReadOnlyOutlineNodeIds(tree);
    expect(readOnly.has(composite.id)).toBe(true);
    for (const child of composite.children) {
      expect(readOnly.has(child.id)).toBe(true);
    }
  });

  it("does NOT mark an ordinary, non-composite section/list node as read-only", () => {
    const text = ["# H", "- plain item"].join("\n");
    const tree = treeWithComposites(text, true);
    const readOnly = collectReadOnlyOutlineNodeIds(tree);
    const section = tree[0];
    expect(readOnly.has(section.id)).toBe(false);
    expect(readOnly.has(section.children[0].id)).toBe(false);
  });

  it("propagates read-only status to a FURTHER-nested list item under a composite's list member", () => {
    // A hand-built OutlineTreeNode tree (bypassing the real parser/matcher
    // entirely) rather than a real document: in the actual matcher
    // (parser/compositeBlocks.ts), a composite's list member can never
    // structurally have a nested CHILD list item of its own — every list
    // item is unconditionally its own candidate, so any child would always
    // sort as an intervening candidate between the member and whatever the
    // rule expects next, making the match fail (see
    // compositeBlocks.test.ts's "OUTER (multi-line, has-a-child)... does not
    // qualify" case). collectReadOnlyOutlineNodeIds's own recursive-
    // propagation logic must still be correct independent of that today's-
    // matcher limitation — this constructs the shape directly to verify the
    // function itself, not to claim the matcher can currently produce it.
    const nested: OutlineTreeNode = {
      kind: "list",
      id: "li-nested",
      text: "nested",
      indentDepth: 1,
      line: 2,
      children: [],
    };
    const memberList: OutlineTreeNode = {
      kind: "list",
      id: "li-member",
      text: "member",
      indentDepth: 0,
      line: 1,
      children: [nested],
    };
    const composite: OutlineTreeNode = {
      kind: "composite",
      id: "composite-0",
      ruleId: "image-ocr",
      label: "Image + OCR",
      prefix: "◉",
      line: 1,
      children: [memberList],
    };
    const readOnly = collectReadOnlyOutlineNodeIds([composite]);
    expect(readOnly.has(composite.id)).toBe(true);
    expect(readOnly.has(memberList.id)).toBe(true);
    expect(readOnly.has(nested.id)).toBe(true);
  });

  it("an empty tree (or a tree with no composites at all) yields an empty set", () => {
    const text = ["# H", "- a", "- b"].join("\n");
    const tree = treeWithComposites(text, true);
    expect(collectReadOnlyOutlineNodeIds(tree).size).toBe(0);
    expect(collectReadOnlyOutlineNodeIds([]).size).toBe(0);
  });
});

describe("complexMemberDisplayLabel", () => {
  it("prefers a callout's own title text over its body", () => {
    const doc = parseDocument(["> [!ocr] Scan 1", "> body text"].join("\n"));
    const complexScan = scanComplexBlocks(doc);
    const info = complexScan.blocks.find((b) => b.kind === "callout")!;
    expect(complexMemberDisplayLabel(doc, info)).toBe("Scan 1");
  });

  it("falls back to the first non-empty body line, with its quote prefix stripped, when a callout has no title", () => {
    const doc = parseDocument(["> [!ocr]", "> first body line"].join("\n"));
    const complexScan = scanComplexBlocks(doc);
    const info = complexScan.blocks.find((b) => b.kind === "callout")!;
    expect(complexMemberDisplayLabel(doc, info)).toBe("first body line");
  });

  it("uses the first non-empty body line for a plain blockquote (no title concept)", () => {
    const doc = parseDocument(["> quoted text here"].join("\n"));
    const complexScan = scanComplexBlocks(doc);
    const info = complexScan.blocks.find((b) => b.kind === "blockquote")!;
    expect(complexMemberDisplayLabel(doc, info)).toBe("quoted text here");
  });

  it("2026-08-12 amendment §C: falls back to a KIND-SPECIFIC short label ('Callout', not the generic '(empty)') when a callout has neither a title nor any non-empty body line", () => {
    const doc = parseDocument(["> [!ocr]", ">"].join("\n"));
    const complexScan = scanComplexBlocks(doc);
    const info = complexScan.blocks.find((b) => b.kind === "callout")!;
    expect(complexMemberDisplayLabel(doc, info, createTranslator("en"))).toBe("Callout");
    expect(complexMemberDisplayLabel(doc, info, createTranslator("ja"))).toBe("コールアウト");
  });

  it("2026-08-12 amendment §C: falls back to 'Quote' for an entirely empty blockquote", () => {
    const doc = parseDocument(["> ", ">"].join("\n"));
    const complexScan = scanComplexBlocks(doc);
    const info = complexScan.blocks.find((b) => b.kind === "blockquote")!;
    expect(complexMemberDisplayLabel(doc, info, createTranslator("en"))).toBe("Quote");
    expect(complexMemberDisplayLabel(doc, info, createTranslator("ja"))).toBe("引用");
  });
});
