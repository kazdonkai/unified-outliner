import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { scanComplexBlocks } from "../src/parser/complexBlocks";
import { matchCompositeBlocks } from "../src/parser/compositeBlocks";
import { isListNode } from "../src/model/block";
import {
  CompositeBlockInfo,
  CompositeBlockRule,
  DEFAULT_COMPOSITE_BLOCK_RULES,
} from "../src/model/compositeBlock";
import { ComplexBlockInfo } from "../src/model/complexBlock";
import { createTranslator } from "../src/i18n";
import { buildNodeIdentityMap } from "../src/tree/foldIdentity";
import {
  buildOutlineTree,
  collectCompositeGroupInfo,
  collectReadOnlyOutlineNodeIds,
  complexMemberDisplayLabel,
  flattenOutlineTree,
  headingPrefixText,
  isOutlineCompositeNode,
  isOutlineComplexMemberNode,
  isOutlineListNode,
  isOutlineParagraphNode,
  isOutlineSectionNode,
  listItemDisplayText,
  listPrefixText,
  nodeDisplayLabel,
  OutlineTreeNode,
  PARAGRAPH_LABEL_MAX_LENGTH,
  paragraphTreeLabel,
  standaloneComplexBlockLabel,
  STANDALONE_BLOCKQUOTE_PREFIX,
  STANDALONE_CALLOUT_PREFIX,
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

  it("strips the bullet marker and indent from the display text", () => {
    const doc = parseDocument(["- Item text here", "* also bulleted", "+ plus bullet"].join("\n"));
    const tree = buildOutlineTree(doc, { includeLists: true });
    expect(tree.map((n) => (isOutlineListNode(n) ? n.text : ""))).toEqual([
      "Item text here",
      "also bulleted",
      "plus bullet",
    ]);
  });

  // UXP-04 (2026-08-15, "Configurable List Marker Prefix Display")
  // superseded the 2026-08-12 "数字リストの番号非表示バグ" fix's own behavior:
  // an ordered item's marker used to be baked directly into `node.text`.
  // It now lives in the independent `node.prefix` field instead (produced
  // by listPrefixText, resolved from settings.listPrefixStyle at
  // buildOutlineTree() call time) — `text` is now ALWAYS the item's pure
  // body label, for both ordered and unordered items alike, regardless of
  // listPrefixStyle. These tests were rewritten in place (not left
  // alongside new ones) specifically to keep pinning "the marker is never
  // lost/duplicated", now against the new field.
  describe("list marker prefix (UXP-04, supersedes the 2026-08-12 fix)", () => {
    it("text has no marker, and prefix is null, when listPrefixStyle is omitted (default)", () => {
      const doc = parseDocument(["1. Ordered item"].join("\n"));
      const tree = buildOutlineTree(doc, { includeLists: true });
      const [node] = tree;
      if (!isOutlineListNode(node)) throw new Error("expected list node");
      expect(node.text).toBe("Ordered item");
      expect(node.prefix).toBeNull();
    });

    it("text has no marker, and prefix is null, when listPrefixStyle is explicitly \"none\"", () => {
      const doc = parseDocument(["1. Ordered item"].join("\n"));
      const tree = buildOutlineTree(doc, { includeLists: true, listPrefixStyle: "none" });
      const [node] = tree;
      if (!isOutlineListNode(node)) throw new Error("expected list node");
      expect(node.text).toBe("Ordered item");
      expect(node.prefix).toBeNull();
    });

    it("keeps a simple '1.' marker as prefix (not in text) when listPrefixStyle is \"marker\"", () => {
      const doc = parseDocument(["1. Ordered item"].join("\n"));
      const tree = buildOutlineTree(doc, { includeLists: true, listPrefixStyle: "marker" });
      const [node] = tree;
      if (!isOutlineListNode(node)) throw new Error("expected list node");
      expect(node.text).toBe("Ordered item");
      expect(node.prefix).toBe("1.");
    });

    it("keeps the ')' delimiter variant ('1)') as prefix", () => {
      const doc = parseDocument(["1) Ordered item"].join("\n"));
      const tree = buildOutlineTree(doc, { includeLists: true, listPrefixStyle: "marker" });
      const [node] = tree;
      if (!isOutlineListNode(node)) throw new Error("expected list node");
      expect(node.text).toBe("Ordered item");
      expect(node.prefix).toBe("1)");
    });

    it("keeps a mid-list restart number verbatim as prefix (does not renumber)", () => {
      // "3." here is NOT list position 3 — it's whatever digits the author
      // typed, exactly as parser/parseDocument.ts recorded in listMarker.
      const doc = parseDocument(["3. Third", "4. Fourth", "9. Ninth (typo, stays 9.)"].join("\n"));
      const tree = buildOutlineTree(doc, { includeLists: true, listPrefixStyle: "marker" });
      expect(tree.map((n) => (isOutlineListNode(n) ? n.text : ""))).toEqual([
        "Third",
        "Fourth",
        "Ninth (typo, stays 9.)",
      ]);
      expect(tree.map((n) => (isOutlineListNode(n) ? n.prefix : ""))).toEqual(["3.", "4.", "9."]);
    });

    it("resolves ordered-marker prefixes at every nesting depth", () => {
      const doc = parseDocument(
        ["1. Top", "    1. Nested one", "        1. Deeply nested"].join("\n")
      );
      const tree = buildOutlineTree(doc, { includeLists: true, listPrefixStyle: "marker" });
      const [top] = tree;
      if (!isOutlineListNode(top)) throw new Error("expected list node");
      expect(top.text).toBe("Top");
      expect(top.prefix).toBe("1.");
      const [nested] = top.children;
      if (!isOutlineListNode(nested)) throw new Error("expected list node");
      expect(nested.text).toBe("Nested one");
      expect(nested.prefix).toBe("1.");
      const [deep] = nested.children;
      if (!isOutlineListNode(deep)) throw new Error("expected list node");
      expect(deep.text).toBe("Deeply nested");
      expect(deep.prefix).toBe("1.");
    });

    it("resolves both ordered and unordered prefixes verbatim at the same level", () => {
      const doc = parseDocument(["1. First", "- a bullet", "* star bullet", "+ plus bullet", "2. Second"].join("\n"));
      const tree = buildOutlineTree(doc, { includeLists: true, listPrefixStyle: "marker" });
      expect(tree.map((n) => (isOutlineListNode(n) ? n.text : ""))).toEqual([
        "First",
        "a bullet",
        "star bullet",
        "plus bullet",
        "Second",
      ]);
      expect(tree.map((n) => (isOutlineListNode(n) ? n.prefix : ""))).toEqual([
        "1.",
        "-",
        "*",
        "+",
        "2.",
      ]);
    });

    it("an empty ordered item still gets its bare marker as prefix, with an empty (fallback-eligible) text", () => {
      const doc = parseDocument(["1. "].join("\n"));
      const tree = buildOutlineTree(doc, { includeLists: true, listPrefixStyle: "marker" });
      const [node] = tree;
      if (!isOutlineListNode(node)) throw new Error("expected list node");
      expect(node.text).toBe("");
      expect(node.prefix).toBe("1.");
    });

    it("an empty BULLET item still gets its bare marker as prefix too, with an empty (fallback-eligible) text", () => {
      const doc = parseDocument(["- "].join("\n"));
      const tree = buildOutlineTree(doc, { includeLists: true, listPrefixStyle: "marker" });
      const [node] = tree;
      if (!isOutlineListNode(node)) throw new Error("expected list node");
      expect(node.text).toBe("");
      expect(node.prefix).toBe("-");
    });

    it("an empty BULLET item still falls back to the empty-item placeholder text, unaffected by listPrefixStyle", () => {
      const doc = parseDocument(["- "].join("\n"));
      const tree = buildOutlineTree(doc, { includeLists: true });
      const [node] = tree;
      if (!isOutlineListNode(node)) throw new Error("expected list node");
      expect(node.text).toBe("");
    });

    it("a list item's own standalone-complex-member child (Phase 5C-5) is unaffected by listPrefixStyle", () => {
      const doc = parseDocument(
        ["- list item A", "  > [!note] list child callout", "  > body."].join("\n")
      );
      const complexScan = scanComplexBlocks(doc);
      const tree = buildOutlineTree(doc, {
        includeLists: true,
        standaloneComplexBlocks: { blocks: complexScan.blocks },
        listPrefixStyle: "marker",
        t: createTranslator("en"),
      });
      const [item] = tree;
      if (!isOutlineListNode(item)) throw new Error("expected list node");
      expect(item.prefix).toBe("-");
      expect(item.children).toHaveLength(1);
      expect(item.children[0].kind).toBe("complex-member");
    });

    it("a composite's own decorative prefix is untouched by listPrefixStyle (different field, different concern)", () => {
      const doc = parseDocument(["- ![[dummy.png]]", "> [!ocr]", "> extracted text."].join("\n"));
      const complexScan = scanComplexBlocks(doc);
      const infos = matchCompositeBlocks(doc, complexScan, DEFAULT_COMPOSITE_BLOCK_RULES);
      const complexBlocksById = new Map(complexScan.blocks.map((b) => [b.id, b]));
      const tree = buildOutlineTree(doc, {
        includeLists: true,
        composites: { infos, complexBlocksById, rules: DEFAULT_COMPOSITE_BLOCK_RULES },
        listPrefixStyle: "marker",
        t: createTranslator("en"),
      });
      const [node] = tree;
      if (!isOutlineCompositeNode(node)) throw new Error("expected composite node");
      // The composite's own `prefix` (a decorative rule-level glyph, e.g.
      // "◉") is a completely different field from OutlineTreeListNode.prefix
      // — this just pins that UXP-04 didn't accidentally change it.
      expect(typeof node.prefix).toBe("string");
    });
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

  // UXP-04 (2026-08-15, "Configurable List Marker Prefix Display")
  // superseded the 2026-08-12 fix's behavior here: nodeDisplayLabel no
  // longer embeds the ordered marker either — it now matches
  // listItemDisplayText's own marker-free output exactly, since the marker
  // moved to OutlineTreeListNode.prefix (a field breadcrumb/title labels,
  // which just consume this plain string, have no equivalent slot for —
  // see listItemTreeDisplayText's own doc comment for this ticket's
  // explicit acknowledgment of that consequence).
  it("no longer embeds the ordered marker for a list item — matches listItemDisplayText", () => {
    const doc = parseDocument("1. one");
    const node = ownerAt(doc, 0);
    expect(nodeDisplayLabel(doc, node)).toBe("one");
    if (!isListNode(node)) throw new Error("expected list node");
    expect(listItemDisplayText(doc, node)).toBe("one");
    expect(nodeDisplayLabel(doc, node)).toBe(listItemDisplayText(doc, node));
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
    // Phase 5D-1L: generalized from "Image + OCR" — the label now names
    // the structure the rule matches, not one illustrative use case.
    expect(composite.label).toBe("List + Callout");
    expect(composite.prefix).toBe("◉");
    expect(composite.line).toBe(0);
    expect(composite.children).toHaveLength(2);

    const [listMember, calloutMember] = composite.children;
    if (!isOutlineListNode(listMember)) throw new Error("expected list member");
    expect(listMember.text).toBe("![[scan-001.png]]");
    if (!isOutlineComplexMemberNode(calloutMember)) throw new Error("expected complex-member");
    expect(calloutMember.complexKind).toBe("callout");
    // Phase 5D-1L: callout members now get the same decorative prefix a
    // standalone callout row gets — see the dedicated
    // "callout member prefix parity" describe block below for the full
    // coverage (standalone-unchanged, blockquote-member-excluded, etc.).
    expect(calloutMember.prefix).toBe(STANDALONE_CALLOUT_PREFIX);
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

  describe("Phase 5D-1L: callout member prefix parity", () => {
    it("an image-ocr composite's callout member gets the exact same prefix a standalone callout row gets", () => {
      const text = ["- ![[scan.png]]", "> [!ocr]", "> body"].join("\n");
      const tree = treeWithComposites(text);
      const composite = tree[0];
      if (!isOutlineCompositeNode(composite)) throw new Error("expected composite");
      const [, calloutMember] = composite.children;
      if (!isOutlineComplexMemberNode(calloutMember)) throw new Error("expected complex-member");
      expect(calloutMember.complexKind).toBe("callout");
      expect(calloutMember.prefix).toBe(STANDALONE_CALLOUT_PREFIX);
      expect(calloutMember.prefix).toBe("▣ ");
    });

    it("Phase 5D-2B: an image-quote composite's blockquote member gets the exact same prefix a standalone blockquote row gets", () => {
      const text = ["- source", "> quoted line"].join("\n");
      const tree = treeWithComposites(text);
      const composite = tree[0];
      if (!isOutlineCompositeNode(composite)) throw new Error("expected composite");
      expect(composite.ruleId).toBe("image-quote");
      const [, blockquoteMember] = composite.children;
      if (!isOutlineComplexMemberNode(blockquoteMember)) throw new Error("expected complex-member");
      expect(blockquoteMember.complexKind).toBe("blockquote");
      expect(blockquoteMember.prefix).toBe(STANDALONE_BLOCKQUOTE_PREFIX);
      expect(blockquoteMember.prefix).toBe("❝ ");
    });

    it("a standalone callout's own prefix is completely unaffected by this change (still STANDALONE_CALLOUT_PREFIX, computed by the same buildStandaloneComplexNode path as before)", () => {
      const text = ["> [!note] My Note", "> body"].join("\n");
      const doc = parseDocument(text);
      const complexScan = scanComplexBlocks(doc);
      const tree = buildOutlineTree(doc, {
        includeLists: false,
        standaloneComplexBlocks: { blocks: complexScan.blocks },
        t: createTranslator("en"),
      });
      const [row] = tree;
      if (!isOutlineComplexMemberNode(row)) throw new Error("expected complex-member");
      expect(row.isStandalone).toBe(true);
      expect(row.prefix).toBe(STANDALONE_CALLOUT_PREFIX);
    });

    it("the list member of an image-ocr composite is completely unaffected — no prefix field of the STANDALONE_CALLOUT_PREFIX kind is ever added to a list node (list prefix remains listPrefixStyle-driven, per its own unrelated mechanism)", () => {
      const text = ["- ![[scan.png]]", "> [!ocr]", "> body"].join("\n");
      const tree = treeWithComposites(text, true);
      const composite = tree[0];
      if (!isOutlineCompositeNode(composite)) throw new Error("expected composite");
      const [listMember] = composite.children;
      if (!isOutlineListNode(listMember)) throw new Error("expected list member");
      expect(listMember.text).toBe("![[scan.png]]");
      expect(listMember.prefix).toBeNull();
    });

    it("the CompositeBlock parent's own decorative prefix (◉ / ❖) is completely unchanged by callout member prefix parity", () => {
      const calloutText = ["- ![[scan.png]]", "> [!ocr]", "> body"].join("\n");
      const calloutComposite = treeWithComposites(calloutText)[0];
      if (!isOutlineCompositeNode(calloutComposite)) throw new Error("expected composite");
      expect(calloutComposite.prefix).toBe("◉");

      const quoteText = ["- source", "> quoted line"].join("\n");
      const quoteComposite = treeWithComposites(quoteText)[0];
      if (!isOutlineCompositeNode(quoteComposite)) throw new Error("expected composite");
      expect(quoteComposite.prefix).toBe("❖");
    });

    it("a callout member's LABEL algorithm is completely unchanged — still complexMemberDisplayLabel's own title -> body -> fallback order, with no type-name tier added (that tier stays standalone-only, per standaloneComplexBlockLabel)", () => {
      // No title on the callout header, and an unknown/custom type ("ai")
      // that WOULD produce a type-name tier result ("Ai") if the member
      // used standaloneComplexBlockLabel's algorithm instead of its own —
      // it must not, so the label falls straight through to the first
      // non-empty body line, exactly as complexMemberDisplayLabel's
      // existing (pre-5D-1L) behavior already does.
      const text = ["- ![[scan.png]]", "> [!ai]", "> transcript line"].join("\n");
      const tree = treeWithComposites(text);
      const composite = tree[0];
      if (!isOutlineCompositeNode(composite)) throw new Error("expected composite");
      const [, calloutMember] = composite.children;
      if (!isOutlineComplexMemberNode(calloutMember)) throw new Error("expected complex-member");
      expect(calloutMember.label).toBe("transcript line");
      expect(calloutMember.label).not.toBe("Ai");
    });
  });

  describe("Phase 5D-2B: blockquote member prefix parity", () => {
    it("a standalone blockquote's own prefix is completely unaffected by this change (still STANDALONE_BLOCKQUOTE_PREFIX, computed by the same buildStandaloneComplexNode path as before)", () => {
      const text = ["> quoted body"].join("\n");
      const doc = parseDocument(text);
      const complexScan = scanComplexBlocks(doc);
      const tree = buildOutlineTree(doc, {
        includeLists: false,
        standaloneComplexBlocks: { blocks: complexScan.blocks },
        t: createTranslator("en"),
      });
      const [row] = tree;
      if (!isOutlineComplexMemberNode(row)) throw new Error("expected complex-member");
      expect(row.isStandalone).toBe(true);
      expect(row.complexKind).toBe("blockquote");
      expect(row.prefix).toBe(STANDALONE_BLOCKQUOTE_PREFIX);
    });

    it("an image-ocr composite's callout member prefix (STANDALONE_CALLOUT_PREFIX / ▣ ) is completely unaffected by adding blockquote member prefix parity", () => {
      const text = ["- ![[scan.png]]", "> [!ocr]", "> body"].join("\n");
      const tree = treeWithComposites(text);
      const composite = tree[0];
      if (!isOutlineCompositeNode(composite)) throw new Error("expected composite");
      const [, calloutMember] = composite.children;
      if (!isOutlineComplexMemberNode(calloutMember)) throw new Error("expected complex-member");
      expect(calloutMember.complexKind).toBe("callout");
      expect(calloutMember.prefix).toBe(STANDALONE_CALLOUT_PREFIX);
    });

    it("the list member of an image-quote composite is completely unaffected — no STANDALONE_BLOCKQUOTE_PREFIX-kind prefix field is ever added to a list node", () => {
      const text = ["- source", "> quoted line"].join("\n");
      const tree = treeWithComposites(text, true);
      const composite = tree[0];
      if (!isOutlineCompositeNode(composite)) throw new Error("expected composite");
      const [listMember] = composite.children;
      if (!isOutlineListNode(listMember)) throw new Error("expected list member");
      expect(listMember.text).toBe("source");
      expect(listMember.prefix).toBeNull();
    });

    it("the CompositeBlock parent's own decorative prefix (◉ / ❖) is completely unchanged by blockquote member prefix parity", () => {
      const calloutText = ["- ![[scan.png]]", "> [!ocr]", "> body"].join("\n");
      const calloutComposite = treeWithComposites(calloutText)[0];
      if (!isOutlineCompositeNode(calloutComposite)) throw new Error("expected composite");
      expect(calloutComposite.prefix).toBe("◉");

      const quoteText = ["- source", "> quoted line"].join("\n");
      const quoteComposite = treeWithComposites(quoteText)[0];
      if (!isOutlineCompositeNode(quoteComposite)) throw new Error("expected composite");
      expect(quoteComposite.prefix).toBe("❖");
    });

    it("a blockquote member's LABEL algorithm is completely unchanged — still complexMemberDisplayLabel's own title -> body -> fallback order, independent of the new prefix field", () => {
      const text = ["- source", "> quoted line"].join("\n");
      const tree = treeWithComposites(text);
      const composite = tree[0];
      if (!isOutlineCompositeNode(composite)) throw new Error("expected composite");
      const [, blockquoteMember] = composite.children;
      if (!isOutlineComplexMemberNode(blockquoteMember)) throw new Error("expected complex-member");
      expect(blockquoteMember.label).toBe("quoted line");
      expect(blockquoteMember.prefix).toBe(STANDALONE_BLOCKQUOTE_PREFIX);
    });

    it("within the same List+Quote composite, the parent's ❖ prefix and the blockquote member's ❝ prefix coexist as separate nodes, each with its own correct prefix value", () => {
      const text = ["- source", "> quoted line"].join("\n");
      const tree = treeWithComposites(text);
      const composite = tree[0];
      if (!isOutlineCompositeNode(composite)) throw new Error("expected composite");
      expect(composite.prefix).toBe("❖");
      const [listMember, blockquoteMember] = composite.children;
      if (!isOutlineListNode(listMember)) throw new Error("expected list member");
      if (!isOutlineComplexMemberNode(blockquoteMember)) throw new Error("expected complex-member");
      expect(blockquoteMember.prefix).toBe(STANDALONE_BLOCKQUOTE_PREFIX);
      // Parent and member are distinct nodes in the tree — no double-display,
      // no shared field being overwritten.
      expect(composite).not.toBe(blockquoteMember);
    });

    it("the blockquote member's fold identity segment is derived only from `label` (kind:label), never from the new `prefix` field — adding the ❝ prefix does not perturb fold identity", () => {
      const text = ["- source", "> quoted line"].join("\n");
      const tree = treeWithComposites(text);
      const composite = tree[0];
      if (!isOutlineCompositeNode(composite)) throw new Error("expected composite");
      const [, blockquoteMember] = composite.children;
      if (!isOutlineComplexMemberNode(blockquoteMember)) throw new Error("expected complex-member");
      expect(blockquoteMember.prefix).toBe(STANDALONE_BLOCKQUOTE_PREFIX);

      const identityMap = buildNodeIdentityMap(tree);
      const identity = identityMap.get(blockquoteMember.id);
      expect(identity).toBeDefined();
      // The identity segment is exactly `complex-member:<label>` — the
      // decorative prefix ("❝ ") never appears in it, confirming
      // foldIdentity.ts's nodeLabel() (which switches on node.label only)
      // is unaffected by this change.
      expect(identity).toBe(`complex-member:${blockquoteMember.label}`);
      expect(identity).not.toContain("❝");
      expect(identity).not.toContain(STANDALONE_BLOCKQUOTE_PREFIX);
    });
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
      prefix: null,
      indentDepth: 1,
      line: 2,
      children: [],
    };
    const memberList: OutlineTreeNode = {
      kind: "list",
      id: "li-member",
      text: "member",
      prefix: null,
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

describe("headingPrefixText (2026-08-12 'Heading prefix 表示設定' ticket)", () => {
  it("'none' returns an empty string for every heading level (default — no prefix shown)", () => {
    for (let level = 1; level <= 6; level++) {
      expect(headingPrefixText("none", level)).toBe("");
    }
  });

  it("'hLevel' returns 'H1'..'H6', uppercase, no trailing period", () => {
    expect(headingPrefixText("hLevel", 1)).toBe("H1");
    expect(headingPrefixText("hLevel", 2)).toBe("H2");
    expect(headingPrefixText("hLevel", 3)).toBe("H3");
    expect(headingPrefixText("hLevel", 4)).toBe("H4");
    expect(headingPrefixText("hLevel", 5)).toBe("H5");
    expect(headingPrefixText("hLevel", 6)).toBe("H6");
  });

  it("'atx' returns the literal ATX marker run ('#'..'######') with NO trailing space", () => {
    expect(headingPrefixText("atx", 1)).toBe("#");
    expect(headingPrefixText("atx", 2)).toBe("##");
    expect(headingPrefixText("atx", 3)).toBe("###");
    expect(headingPrefixText("atx", 4)).toBe("####");
    expect(headingPrefixText("atx", 5)).toBe("#####");
    expect(headingPrefixText("atx", 6)).toBe("######");
    // Explicit length check, not just a string-equality check, to guard
    // against a trailing-space regression specifically (the ticket's own
    // "atx は # 〜 ###### のみを表示し、後ろの空白は付けない" requirement).
    expect(headingPrefixText("atx", 3).length).toBe(3);
  });

  it("clamps an out-of-range level defensively (real parsed data is always 1-6 per parseDocument.ts's HEADING_RE)", () => {
    expect(headingPrefixText("hLevel", 0)).toBe("H1");
    expect(headingPrefixText("hLevel", 7)).toBe("H6");
    expect(headingPrefixText("atx", 0)).toBe("#");
    expect(headingPrefixText("atx", 9)).toBe("######");
  });

  it("an unset/migrated settings value ('none', per DEFAULT_SETTINGS.headingPrefixStyle) reproduces the pre-ticket look exactly", () => {
    // Existing-user migration behavior: mergeSettings's shallow
    // Object.assign resolves a missing headingPrefixStyle key to
    // DEFAULT_SETTINGS.headingPrefixStyle ("none") — verified directly in
    // settingsDefaults.test.ts's mergeSettings coverage. This test only
    // confirms the DOWNSTREAM effect: "none" must be indistinguishable from
    // "no prefix rendered at all", not e.g. an empty-but-still-badged state.
    expect(headingPrefixText("none", 4)).toBe("");
  });
});

/** Helper for listPrefixText's own tests below: parses a single-line document and returns its one ListBlockNode. */
function soleListItem(line: string) {
  const doc = parseDocument(line);
  const node = ownerAt(doc, 0);
  if (!isListNode(node)) throw new Error("expected list node");
  return node;
}

describe("listPrefixText (UXP-04 'Configurable List Marker Prefix Display' ticket)", () => {
  it("'none' returns null for an ordered item", () => {
    expect(listPrefixText("none", soleListItem("1. Ordered item"))).toBeNull();
  });

  it("'none' returns null for an unordered item", () => {
    expect(listPrefixText("none", soleListItem("- Bulleted item"))).toBeNull();
  });

  it("'marker' returns the exact ordered marker '1.' verbatim", () => {
    expect(listPrefixText("marker", soleListItem("1. Ordered item"))).toBe("1.");
  });

  it("'marker' returns a mid-list restart ordered marker '3.' verbatim (no renumbering)", () => {
    expect(listPrefixText("marker", soleListItem("3. Third"))).toBe("3.");
  });

  it("'marker' returns the ')' delimiter variant '2)' verbatim", () => {
    expect(listPrefixText("marker", soleListItem("2) Ordered item"))).toBe("2)");
  });

  it("'marker' returns the exact unordered marker '-' verbatim", () => {
    expect(listPrefixText("marker", soleListItem("- Bulleted item"))).toBe("-");
  });

  it("'marker' returns the exact unordered marker '*' verbatim", () => {
    expect(listPrefixText("marker", soleListItem("* Bulleted item"))).toBe("*");
  });

  it("'marker' returns the exact unordered marker '+' verbatim", () => {
    expect(listPrefixText("marker", soleListItem("+ Bulleted item"))).toBe("+");
  });

  it("'marker' returns the bare marker even for an item with no body text", () => {
    expect(listPrefixText("marker", soleListItem("1. "))).toBe("1.");
    expect(listPrefixText("marker", soleListItem("- "))).toBe("-");
  });

  it("returns null for an empty/whitespace-only marker (defensive — not reachable from real parsed data)", () => {
    const item = soleListItem("- Bulleted item");
    expect(listPrefixText("marker", { ...item, listMarker: "" })).toBeNull();
    expect(listPrefixText("marker", { ...item, listMarker: "   " })).toBeNull();
  });

  it("does not invent a task-list-specific prefix for body text that merely looks like a checkbox", () => {
    // task-list checkboxes are not modeled anywhere in parser/model/block.ts
    // (per this ticket's own investigation) — listMarker is always the
    // plain list marker itself, never something derived from the body text,
    // so a body like "[x] done" must not change what this function returns.
    const item = soleListItem("- [x] done");
    expect(listPrefixText("marker", item)).toBe("-");
    expect(listPrefixText("marker", item)).not.toContain("[x]");
  });
});

/** Builds a tree WITH standalone callout/blockquote projection, using the real scan pipeline (same call sequence view/OutlineTreeView.ts's refresh() uses, minus composite matching). */
function treeWithStandalone(text: string, includeLists = false) {
  const doc = parseDocument(text);
  const complexScan = scanComplexBlocks(doc);
  const tree = buildOutlineTree(doc, {
    includeLists,
    standaloneComplexBlocks: { blocks: complexScan.blocks },
    t: createTranslator("en"),
  });
  return { doc, complexScan, tree };
}

describe("buildOutlineTree (Phase 5C-2: standalone callout/blockquote projection, Tree構築)", () => {
  it("projects a supported standalone callout as a section-level sibling row, with its own STANDALONE prefix", () => {
    const text = ["# H", "> [!note] My Note", "> body"].join("\n");
    const { tree } = treeWithStandalone(text);
    const section = tree[0];
    if (!isOutlineSectionNode(section)) throw new Error("expected section");
    expect(section.children).toHaveLength(1);
    const [row] = section.children;
    if (!isOutlineComplexMemberNode(row)) throw new Error("expected complex-member");
    expect(row.isStandalone).toBe(true);
    expect(row.complexKind).toBe("callout");
    expect(row.label).toBe("My Note");
    expect(row.prefix).toBe(STANDALONE_CALLOUT_PREFIX);
    expect(row.line).toBe(1);
  });

  it("projects a supported standalone blockquote similarly, with its own prefix", () => {
    const text = ["# H", "> quoted line"].join("\n");
    const { tree } = treeWithStandalone(text);
    const section = tree[0];
    if (!isOutlineSectionNode(section)) throw new Error("expected section");
    const [row] = section.children;
    if (!isOutlineComplexMemberNode(row)) throw new Error("expected complex-member");
    expect(row.isStandalone).toBe(true);
    expect(row.complexKind).toBe("blockquote");
    expect(row.label).toBe("quoted line");
    expect(row.prefix).toBe(STANDALONE_BLOCKQUOTE_PREFIX);
  });

  it("projects a standalone callout with no enclosing section as a top-level row", () => {
    const text = ["> [!tip] Top Tip", "> body"].join("\n");
    const { tree } = treeWithStandalone(text);
    expect(tree).toHaveLength(1);
    const [row] = tree;
    if (!isOutlineComplexMemberNode(row)) throw new Error("expected complex-member");
    expect(row.label).toBe("Top Tip");
  });

  it("does not duplicate a callout that is already a matched composite's own member (no double-projection)", () => {
    const text = ["- ![[scan.png]]", "> [!ocr]", "> body"].join("\n");
    const doc = parseDocument(text);
    const complexScan = scanComplexBlocks(doc);
    const infos = matchCompositeBlocks(doc, complexScan, DEFAULT_COMPOSITE_BLOCK_RULES);
    const complexBlocksById = new Map(complexScan.blocks.map((b) => [b.id, b]));
    const tree = buildOutlineTree(doc, {
      includeLists: true,
      composites: { infos, complexBlocksById, rules: DEFAULT_COMPOSITE_BLOCK_RULES },
      standaloneComplexBlocks: { blocks: complexScan.blocks },
      t: createTranslator("en"),
    });
    // Just the composite — no extra standalone sibling row for the same callout.
    expect(tree).toHaveLength(1);
    expect(isOutlineCompositeNode(tree[0])).toBe(true);
    const calloutOccurrences = flattenOutlineTree(tree)
      .filter(isOutlineComplexMemberNode)
      .filter((n) => n.complexKind === "callout");
    expect(calloutOccurrences).toHaveLength(1);
    expect(calloutOccurrences[0].isStandalone).toBe(false);
  });

  it("excludes unsupported/ambiguous/read-only complex blocks from standalone projection entirely (never shown, not even disabled)", () => {
    const text = ["# H", "some paragraph line"].join("\n");
    const doc = parseDocument(text);
    const sectionId = doc.topLevelIds[0];
    const unsupported: ComplexBlockInfo = {
      id: "callout-unsupported",
      kind: "callout",
      range: { startLine: 1, endLine: 1 },
      parentId: sectionId,
      childIds: [],
      editability: "unsupported",
      reason: "x",
    };
    const ambiguous: ComplexBlockInfo = {
      id: "blockquote-ambiguous",
      kind: "blockquote",
      range: { startLine: 1, endLine: 1 },
      parentId: sectionId,
      childIds: [],
      editability: "ambiguous",
      reason: "x",
    };
    const readOnly: ComplexBlockInfo = {
      id: "callout-readonly",
      kind: "callout",
      range: { startLine: 1, endLine: 1 },
      parentId: sectionId,
      childIds: [],
      editability: "read-only",
      reason: "x",
    };
    const tree = buildOutlineTree(doc, {
      standaloneComplexBlocks: { blocks: [unsupported, ambiguous, readOnly] },
      t: createTranslator("en"),
    });
    const section = tree[0];
    if (!isOutlineSectionNode(section)) throw new Error("expected section");
    expect(section.children).toHaveLength(0);
  });

  it("Phase 5C-5: projects a standalone callout nested inside a list item's continuation as THAT LIST ITEM's own child, not a section-level sibling ('list 子表示')", () => {
    const text = ["# H", "- item text", "  > [!note] callout in list", "  > body line"].join("\n");
    const { tree } = treeWithStandalone(text, true);
    const section = tree[0];
    if (!isOutlineSectionNode(section)) throw new Error("expected section");
    // The list item is section H's only direct child now — the callout is
    // nested UNDER it, not a sibling of it (reversed from Phase 5C-2's
    // original "section直下委譲" behavior, which this same fixture used to
    // pin — see git history for the pre-Phase-5C-5 version of this test).
    expect(section.children.map((n) => n.kind)).toEqual(["list"]);
    const [listNode] = section.children;
    if (!isOutlineListNode(listNode)) throw new Error("expected list node");
    expect(listNode.children).toHaveLength(1);
    const [calloutNode] = listNode.children;
    if (!isOutlineComplexMemberNode(calloutNode)) throw new Error("expected complex-member");
    expect(calloutNode.isStandalone).toBe(true);
    expect(calloutNode.label).toBe("callout in list");
  });

  it("appends a '#N' suffix to duplicate fallback labels within the same section, in document order (種別＋通番)", () => {
    const text = ["# H", "> [!!!!]", ">", "not quoted", "> [!????]", ">"].join("\n");
    const { tree } = treeWithStandalone(text);
    const section = tree[0];
    if (!isOutlineSectionNode(section)) throw new Error("expected section");
    const labels = section.children.filter(isOutlineComplexMemberNode).map((n) => n.label);
    expect(labels).toEqual(["Callout #1", "Callout #2"]);
  });
});

describe("standaloneComplexBlockLabel (Phase 5C-2, ラベル生成)", () => {
  it("prefers a callout's own title text", () => {
    const doc = parseDocument(["> [!note] My Title", "> body"].join("\n"));
    const info = scanComplexBlocks(doc).blocks[0];
    expect(standaloneComplexBlockLabel(doc, info)).toBe("My Title");
  });

  it("prefers the formatted type display name over a body summary when a callout has no title", () => {
    const doc = parseDocument(["> [!info-box]", "> some body content"].join("\n"));
    const info = scanComplexBlocks(doc).blocks[0];
    expect(standaloneComplexBlockLabel(doc, info)).toBe("Info Box");
  });

  it("falls through to the first body line when the type string has no usable characters after stripping", () => {
    const doc = parseDocument(["> [!!!!]", "> body content here"].join("\n"));
    const info = scanComplexBlocks(doc).blocks[0];
    expect(standaloneComplexBlockLabel(doc, info)).toBe("body content here");
  });

  it("falls back to the existing kind-fallback text when a callout has no title, no usable type, and no body content", () => {
    const doc = parseDocument(["> [!!!!]", ">"].join("\n"));
    const info = scanComplexBlocks(doc).blocks[0];
    expect(standaloneComplexBlockLabel(doc, info, createTranslator("en"))).toBe("Callout");
    expect(standaloneComplexBlockLabel(doc, info, createTranslator("ja"))).toBe("コールアウト");
  });

  it("uses the first non-empty body line for a blockquote (no title/type concept)", () => {
    const doc = parseDocument(["> quoted first line"].join("\n"));
    const info = scanComplexBlocks(doc).blocks[0];
    expect(standaloneComplexBlockLabel(doc, info)).toBe("quoted first line");
  });

  it("falls back to the existing kind-fallback text for an entirely empty blockquote", () => {
    const doc = parseDocument(["> ", ">"].join("\n"));
    const info = scanComplexBlocks(doc).blocks[0];
    expect(standaloneComplexBlockLabel(doc, info, createTranslator("en"))).toBe("Quote");
    expect(standaloneComplexBlockLabel(doc, info, createTranslator("ja"))).toBe("引用");
  });

  it("truncates an overly long label to 80 characters with a trailing ellipsis", () => {
    const longTitle = "x".repeat(120);
    const doc = parseDocument([`> [!note] ${longTitle}`].join("\n"));
    const info = scanComplexBlocks(doc).blocks[0];
    const label = standaloneComplexBlockLabel(doc, info);
    expect(label.length).toBe(80);
    expect(label.endsWith("…")).toBe(true);
    expect(label.startsWith("x".repeat(79))).toBe(true);
  });

  it("never leaks the raw '>' quote marker or a '[!type]' bracket into a body-derived label", () => {
    const doc = parseDocument(["> [!!!!]", "> body content here"].join("\n"));
    const info = scanComplexBlocks(doc).blocks[0];
    const label = standaloneComplexBlockLabel(doc, info);
    expect(label).not.toContain(">");
    expect(label).not.toContain("[!");
  });

  it("STANDALONE_CALLOUT_PREFIX / STANDALONE_BLOCKQUOTE_PREFIX are fixed display constants, not i18n keys", () => {
    expect(STANDALONE_CALLOUT_PREFIX).toBe("▣ ");
    expect(STANDALONE_BLOCKQUOTE_PREFIX).toBe("❝ ");
  });
});

/**
 * Phase 5P-3 ("本文 paragraph の任意 Outline Tree 表示"): builds a tree WITH
 * paragraph projection, using the real scan pipeline (same
 * `paragraphs: { blocks: complexScan.blocks }` shape
 * view/OutlineTreeView.ts's refresh() passes when settings.
 * showParagraphsInOutline is on). `includeLists` defaults to true here
 * (unlike treeWithStandalone's false) because most of this describe block's
 * fixtures need list-item-child placement to be exercisable at all.
 */
function treeWithParagraphs(text: string, includeLists = true) {
  const doc = parseDocument(text);
  const complexScan = scanComplexBlocks(doc);
  const tree = buildOutlineTree(doc, {
    includeLists,
    paragraphs: { blocks: complexScan.blocks },
    t: createTranslator("en"),
  });
  return { doc, complexScan, tree };
}

describe("buildOutlineTree (Phase 5P-3: paragraph projection, showParagraphsInOutline)", () => {
  it("projects NO paragraph nodes at all when the `paragraphs` option is omitted (default off — matches settings.showParagraphsInOutline defaulting to false)", () => {
    const text = ["# H", "a plain paragraph"].join("\n");
    const doc = parseDocument(text);
    const tree = buildOutlineTree(doc, { includeLists: true, t: createTranslator("en") });
    expect(flattenOutlineTree(tree).some(isOutlineParagraphNode)).toBe(false);
  });

  it("produces the EXACT SAME tree shape (node-for-node, by kind) as the pre-5P-3 baseline when `paragraphs` is omitted — off means paragraph never enters the projection model, not merely 'hidden'", () => {
    const text = ["# H", "- item one", "  continuation text", "another paragraph"].join("\n");
    const doc = parseDocument(text);
    const complexScan = scanComplexBlocks(doc);
    const baseline = buildOutlineTree(doc, { includeLists: true, t: createTranslator("en") });
    const withUndefinedParagraphs = buildOutlineTree(doc, {
      includeLists: true,
      standaloneComplexBlocks: { blocks: complexScan.blocks },
      t: createTranslator("en"),
    });
    const kindsOf = (nodes: OutlineTreeNode[]): string[] =>
      flattenOutlineTree(nodes).map((n) => n.kind);
    expect(kindsOf(withUndefinedParagraphs)).toEqual(kindsOf(baseline));
  });

  it("projects a section-direct paragraph as a leaf child of its enclosing section, labeled with a fixed '¶ ' style marker via node.label (prefix itself is applied only at render time in view/OutlineTreeView.ts)", () => {
    const text = ["# H", "a section-direct paragraph"].join("\n");
    const { tree } = treeWithParagraphs(text);
    const section = tree[0];
    if (!isOutlineSectionNode(section)) throw new Error("expected section");
    expect(section.children).toHaveLength(1);
    const [row] = section.children;
    if (!isOutlineParagraphNode(row)) throw new Error("expected paragraph");
    expect(row.label).toBe("a section-direct paragraph");
    expect(row.isLeaf).toBe(true);
    expect(row.isReadOnly).toBe(true);
    expect(row.children).toEqual([]);
    expect(row.parentId).toBe(section.id);
  });

  it("projects a list-item-child paragraph (Phase 5P-1 continuation) as a child of that list item, not of the enclosing section", () => {
    const text = ["# H", "- item text", "  continuation paragraph"].join("\n");
    const { tree } = treeWithParagraphs(text, true);
    const section = tree[0];
    if (!isOutlineSectionNode(section)) throw new Error("expected section");
    expect(section.children.map((n) => n.kind)).toEqual(["list"]);
    const [listNode] = section.children;
    if (!isOutlineListNode(listNode)) throw new Error("expected list");
    expect(listNode.children).toHaveLength(1);
    const [paraNode] = listNode.children;
    if (!isOutlineParagraphNode(paraNode)) throw new Error("expected paragraph");
    expect(paraNode.label).toBe("continuation paragraph");
    expect(paraNode.parentId).toBe(listNode.id);
  });

  it("projects a headingless-note top-level paragraph as a root-level node, alongside any other root-level rows", () => {
    const text = ["a top-level paragraph with no heading above it"].join("\n");
    const { tree } = treeWithParagraphs(text);
    expect(tree).toHaveLength(1);
    const [row] = tree;
    if (!isOutlineParagraphNode(row)) throw new Error("expected paragraph");
    expect(row.parentId).toBeNull();
    expect(row.label).toBe("a top-level paragraph with no heading above it");
  });

  it("a non-indented paragraph following a list is never misprojected as that list item's child — it stays a sibling under the enclosing section", () => {
    const text = ["# H", "- item", "", "not indented, a new paragraph"].join("\n");
    const { tree } = treeWithParagraphs(text, true);
    const section = tree[0];
    if (!isOutlineSectionNode(section)) throw new Error("expected section");
    expect(section.children.map((n) => n.kind)).toEqual(["list", "paragraph"]);
    const paraNode = section.children[1];
    if (!isOutlineParagraphNode(paraNode)) throw new Error("expected paragraph");
    expect(paraNode.parentId).toBe(section.id);
    expect(paraNode.label).toBe("not indented, a new paragraph");
  });

  it("preserves relative Markdown document order among paragraph/list/callout/blockquote siblings under the same section", () => {
    // A blank line separates the blockquote from "last paragraph" —
    // without it, scanParagraphBlocks' own contiguous-candidate-run scan
    // (parser/complexBlocks.ts) would merge the blockquote's line into the
    // SAME paragraph candidate run as "last paragraph" (no intervening
    // blank line to break the run), which mergeBlockRangesSafely then
    // downgrades to "ambiguous" (overlapping a higher-priority accepted
    // blockquote) — correct "refuse rather than guess" behavior, but not
    // what this test means to exercise (ordering among fully independent,
    // "supported" siblings).
    const text = [
      "# H",
      "first paragraph",
      "- a list item",
      "> quoted blockquote",
      "",
      "last paragraph",
    ].join("\n");
    const doc = parseDocument(text);
    const complexScan = scanComplexBlocks(doc);
    const tree = buildOutlineTree(doc, {
      includeLists: true,
      standaloneComplexBlocks: { blocks: complexScan.blocks },
      paragraphs: { blocks: complexScan.blocks },
      t: createTranslator("en"),
    });
    const section = tree[0];
    if (!isOutlineSectionNode(section)) throw new Error("expected section");
    expect(section.children.map((n) => n.kind)).toEqual([
      "paragraph",
      "list",
      "complex-member",
      "paragraph",
    ]);
    expect(section.children.map((n) => n.line)).toEqual([1, 2, 3, 5]);
  });

  it("does not change any existing section/list/CompositeBlock/standalone-complex-block parent-child relationship when paragraph projection is added on top", () => {
    const text = ["- ![[scan.png]]", "> [!ocr]", "> body"].join("\n");
    const doc = parseDocument(text);
    const complexScan = scanComplexBlocks(doc);
    const infos = matchCompositeBlocks(doc, complexScan, DEFAULT_COMPOSITE_BLOCK_RULES);
    const complexBlocksById = new Map(complexScan.blocks.map((b) => [b.id, b]));
    const withoutParagraphs = buildOutlineTree(doc, {
      includeLists: true,
      composites: { infos, complexBlocksById, rules: DEFAULT_COMPOSITE_BLOCK_RULES },
      t: createTranslator("en"),
    });
    const withParagraphs = buildOutlineTree(doc, {
      includeLists: true,
      composites: { infos, complexBlocksById, rules: DEFAULT_COMPOSITE_BLOCK_RULES },
      paragraphs: { blocks: complexScan.blocks },
      t: createTranslator("en"),
    });
    const shapeOf = (nodes: OutlineTreeNode[]): unknown =>
      nodes.map((n) => ({ kind: n.kind, id: n.id, children: shapeOf(n.children) }));
    expect(shapeOf(withParagraphs)).toEqual(shapeOf(withoutParagraphs));
  });

  it("a paragraph is never inserted into ParsedDocument.nodes, even when projected into the Tree", () => {
    const text = ["# H", "a plain paragraph"].join("\n");
    const { doc, complexScan } = treeWithParagraphs(text);
    const paraInfo = complexScan.blocks.find((b) => b.kind === "paragraph");
    expect(paraInfo).toBeDefined();
    expect(doc.nodes.get(paraInfo!.id)).toBeUndefined();
  });

  it("toggling paragraphs on -> off -> on repeatedly never perturbs existing section/list node ids or structure", () => {
    const text = ["# H", "- item", "a paragraph"].join("\n");
    const doc = parseDocument(text);
    const complexScan = scanComplexBlocks(doc);
    const on1 = buildOutlineTree(doc, {
      includeLists: true,
      paragraphs: { blocks: complexScan.blocks },
      t: createTranslator("en"),
    });
    const off = buildOutlineTree(doc, { includeLists: true, t: createTranslator("en") });
    const on2 = buildOutlineTree(doc, {
      includeLists: true,
      paragraphs: { blocks: complexScan.blocks },
      t: createTranslator("en"),
    });
    const sectionAndListIds = (nodes: OutlineTreeNode[]): string[] =>
      flattenOutlineTree(nodes)
        .filter((n) => n.kind === "section" || n.kind === "list")
        .map((n) => n.id);
    expect(sectionAndListIds(on1)).toEqual(sectionAndListIds(off));
    expect(sectionAndListIds(on2)).toEqual(sectionAndListIds(off));
  });
});

describe("paragraphTreeLabel (Phase 5P-3, ラベル生成)", () => {
  const en = createTranslator("en");

  it("uses the paragraph's own normalized text when it has letter/digit content", () => {
    expect(paragraphTreeLabel("hello world", 1, en)).toBe("hello world");
  });

  it("collapses embedded newlines and consecutive whitespace into a single space", () => {
    expect(paragraphTreeLabel("line one\nline   two\n\nline three", 1, en)).toBe(
      "line one line two line three"
    );
  });

  it("trims leading/trailing whitespace after normalization", () => {
    expect(paragraphTreeLabel("   padded text   ", 1, en)).toBe("padded text");
  });

  it("truncates to PARAGRAPH_LABEL_MAX_LENGTH (60) characters with a trailing ellipsis", () => {
    const longText = "x".repeat(120);
    const label = paragraphTreeLabel(longText, 1, en);
    expect(label.length).toBe(PARAGRAPH_LABEL_MAX_LENGTH);
    expect(label.endsWith("…")).toBe(true);
    expect(label.startsWith("x".repeat(PARAGRAPH_LABEL_MAX_LENGTH - 1))).toBe(true);
  });

  it("falls back to the '段落 N' style fallback (via i18n tree.paragraphFallback) when the text is whitespace-only", () => {
    expect(paragraphTreeLabel("   \n  \n  ", 7, en)).toBe("Paragraph 7");
  });

  it("falls back when the text is symbol-only (no letters or digits in any script)", () => {
    expect(paragraphTreeLabel("*** --- ...", 3, en)).toBe("Paragraph 3");
  });

  it("falls back for an entirely empty string", () => {
    expect(paragraphTreeLabel("", 2, en)).toBe("Paragraph 2");
  });

  it("uses the ja fallback text via the ja translator", () => {
    const ja = createTranslator("ja");
    expect(paragraphTreeLabel("", 5, ja)).toBe("段落 5");
  });

  it("never treats a leading '<!-- uo-title: ... -->' comment as a distinct title — it is normalized/previewed like any other text, never stripped or promoted", () => {
    const withComment = "<!-- uo-title: My Title -->\nactual body text";
    const label = paragraphTreeLabel(withComment, 1, en);
    // The comment is part of the normalized preview, not adopted as a
    // separate label — see this function's own doc comment (design doc
    // §3-2) for why uo-title association is deliberately NOT implemented
    // in 5P-3.
    expect(label).toContain("uo-title");
    expect(label).not.toBe("My Title");
  });
});

describe("OutlineTreeParagraphNode identity (Phase 5P-3)", () => {
  it("a paragraph node's Tree id is NEVER identical to the underlying ComplexBlockInfo's own scan-local id", () => {
    const text = ["# H", "a plain paragraph"].join("\n");
    const { tree, complexScan } = treeWithParagraphs(text);
    const paraInfo = complexScan.blocks.find((b) => b.kind === "paragraph")!;
    const paraNode = flattenOutlineTree(tree).find(isOutlineParagraphNode)!;
    expect(paraNode.id).not.toBe(paraInfo.id);
  });

  it("multiple paragraphs in one build get distinct, non-colliding ids", () => {
    const text = ["# H", "first paragraph", "", "second paragraph", "", "third paragraph"].join(
      "\n"
    );
    const { tree } = treeWithParagraphs(text);
    const ids = flattenOutlineTree(tree).filter(isOutlineParagraphNode).map((n) => n.id);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
  });

  it("a paragraph node's id never collides with any section/list/complex-block id in the same tree", () => {
    const text = ["- ![[scan.png]]", "> [!ocr]", "> body", "", "a paragraph"].join("\n");
    const doc = parseDocument(text);
    const complexScan = scanComplexBlocks(doc);
    const infos = matchCompositeBlocks(doc, complexScan, DEFAULT_COMPOSITE_BLOCK_RULES);
    const complexBlocksById = new Map(complexScan.blocks.map((b) => [b.id, b]));
    const tree = buildOutlineTree(doc, {
      includeLists: true,
      composites: { infos, complexBlocksById, rules: DEFAULT_COMPOSITE_BLOCK_RULES },
      paragraphs: { blocks: complexScan.blocks },
      t: createTranslator("en"),
    });
    const allIds = flattenOutlineTree(tree).map((n) => n.id);
    expect(new Set(allIds).size).toBe(allIds.length);
  });
});

describe("collectReadOnlyOutlineNodeIds (Phase 5P-3: paragraph)", () => {
  it("marks every paragraph node's id as read-only", () => {
    const text = ["# H", "a plain paragraph", "- item", "  continuation paragraph"].join("\n");
    const { tree } = treeWithParagraphs(text, true);
    const readOnly = collectReadOnlyOutlineNodeIds(tree);
    const paraNodes = flattenOutlineTree(tree).filter(isOutlineParagraphNode);
    expect(paraNodes.length).toBeGreaterThan(0);
    for (const p of paraNodes) {
      expect(readOnly.has(p.id)).toBe(true);
    }
  });

  it("does not mark a paragraph's own section/list ancestor as read-only merely because a paragraph sits under it (read-only propagates DOWN from composite/complex-member, never UP from a paragraph)", () => {
    const text = ["# H", "a plain paragraph"].join("\n");
    const { tree } = treeWithParagraphs(text);
    const readOnly = collectReadOnlyOutlineNodeIds(tree);
    const section = tree[0];
    expect(readOnly.has(section.id)).toBe(false);
  });
});

describe("collectCompositeGroupInfo (UI-only follow-up, 2026-09-08: Outline Tree CompositeBlock visual grouping)", () => {
  it("marks a list+callout composite's own parent id and BOTH of its member ids (the list-item member and the callout member) as group members, with the LAST member (the callout) as the group end", () => {
    const text = ["- ![[scan.png]]", "> [!ocr]", "> body"].join("\n");
    const tree = treeWithComposites(text, true);
    const composite = tree[0];
    if (!isOutlineCompositeNode(composite)) throw new Error("expected composite");
    // Every composite has >= 2 members (its own list-item first member,
    // plus the callout/blockquote member(s)) — see
    // OutlineTreeCompositeNode's own doc comment.
    expect(composite.children.length).toBeGreaterThanOrEqual(2);
    const [firstMember, calloutMember] = composite.children;

    const info = collectCompositeGroupInfo(tree);
    expect(info.groupNodeIds.has(composite.id)).toBe(true);
    expect(info.groupNodeIds.has(firstMember.id)).toBe(true);
    expect(info.groupNodeIds.has(calloutMember.id)).toBe(true);
    expect(info.groupEndNodeIds.has(calloutMember.id)).toBe(true);
    // Neither the parent row nor the non-last member is also the group end.
    expect(info.groupEndNodeIds.has(composite.id)).toBe(false);
    expect(info.groupEndNodeIds.has(firstMember.id)).toBe(false);
  });

  it("marks a list+blockquote composite's own parent id and BOTH of its member ids as group members, with the LAST member (the blockquote) as the group end", () => {
    const text = ["- source", "> quoted line"].join("\n");
    const tree = treeWithComposites(text, true);
    const composite = tree[0];
    if (!isOutlineCompositeNode(composite)) throw new Error("expected composite");
    expect(composite.ruleId).toBe("image-quote");
    const [firstMember, blockquoteMember] = composite.children;

    const info = collectCompositeGroupInfo(tree);
    expect(info.groupNodeIds.has(composite.id)).toBe(true);
    expect(info.groupNodeIds.has(firstMember.id)).toBe(true);
    expect(info.groupNodeIds.has(blockquoteMember.id)).toBe(true);
    expect(info.groupEndNodeIds.has(blockquoteMember.id)).toBe(true);
  });

  it("does NOT mark an ordinary, non-composite section/list as a group member", () => {
    const text = ["# H", "- plain item"].join("\n");
    const tree = treeWithComposites(text, true);
    const info = collectCompositeGroupInfo(tree);
    const section = tree[0];
    expect(info.groupNodeIds.has(section.id)).toBe(false);
    expect(info.groupNodeIds.has(section.children[0].id)).toBe(false);
    expect(info.groupEndNodeIds.size).toBe(0);
  });

  it("does NOT mark a standalone (non-composite) callout/blockquote as a group member", () => {
    const text = ["> [!note]", "> a standalone callout, not part of any composite"].join("\n");
    const tree = buildOutlineTree(parseDocument(text), {
      standaloneComplexBlocks: { blocks: scanComplexBlocks(parseDocument(text)).blocks },
      t: createTranslator("en"),
    });
    const info = collectCompositeGroupInfo(tree);
    for (const node of flattenOutlineTree(tree)) {
      expect(info.groupNodeIds.has(node.id)).toBe(false);
    }
  });

  it("does NOT mark a plain paragraph row as a group member, even though it IS marked read-only by collectReadOnlyOutlineNodeIds — the two Sets are deliberately independent", () => {
    const text = ["# H", "a plain paragraph"].join("\n");
    const { tree } = treeWithParagraphs(text);
    const readOnly = collectReadOnlyOutlineNodeIds(tree);
    const groupInfo = collectCompositeGroupInfo(tree);
    const paraNode = flattenOutlineTree(tree).find(isOutlineParagraphNode);
    if (!paraNode) throw new Error("expected a paragraph node");
    expect(readOnly.has(paraNode.id)).toBe(true);
    expect(groupInfo.groupNodeIds.has(paraNode.id)).toBe(false);
  });

  it("propagates group membership to a FURTHER-nested list item under a composite's list member, and treats that nested item as the group end (hand-built tree — see collectReadOnlyOutlineNodeIds's identical-shape test for why the real matcher cannot currently produce this nesting itself)", () => {
    const nested: OutlineTreeNode = {
      kind: "list",
      id: "li-nested",
      text: "nested",
      prefix: null,
      indentDepth: 1,
      line: 2,
      children: [],
    };
    const memberList: OutlineTreeNode = {
      kind: "list",
      id: "li-member",
      text: "member",
      prefix: null,
      indentDepth: 0,
      line: 1,
      children: [nested],
    };
    const composite: OutlineTreeNode = {
      kind: "composite",
      id: "composite-1",
      ruleId: "image-ocr",
      label: "test",
      prefix: "",
      line: 1,
      children: [memberList],
    };
    const info = collectCompositeGroupInfo([composite]);
    expect(info.groupNodeIds.has(composite.id)).toBe(true);
    expect(info.groupNodeIds.has(memberList.id)).toBe(true);
    expect(info.groupNodeIds.has(nested.id)).toBe(true);
    // The deepest last-child-chain descendant is the group end, not the
    // intermediate member row.
    expect(info.groupEndNodeIds.has(nested.id)).toBe(true);
    expect(info.groupEndNodeIds.has(memberList.id)).toBe(false);
  });

  it("finds a composite nested arbitrarily deep under an unrelated section/list ancestor chain (hand-built tree, same rationale as the further-nested-list-item test above: this shape need not be producible by today's real matcher for this walk logic itself to be verified)", () => {
    const composite: OutlineTreeNode = {
      kind: "composite",
      id: "composite-deep",
      ruleId: "image-ocr",
      label: "test",
      prefix: "",
      line: 3,
      children: [
        { kind: "list", id: "li-composite-first", text: "img", prefix: null, indentDepth: 2, line: 3, children: [] },
        {
          kind: "complex-member",
          id: "cm-composite-member",
          complexKind: "callout",
          label: "ocr",
          isStandalone: false,
          line: 4,
          children: [],
        },
      ],
    };
    const outerList: OutlineTreeNode = {
      kind: "list",
      id: "li-outer",
      text: "outer item",
      prefix: null,
      indentDepth: 0,
      line: 1,
      children: [composite],
    };
    const section: OutlineTreeNode = {
      kind: "section",
      id: "sec-1",
      headingLevel: 1,
      headingText: "H",
      line: 0,
      children: [outerList],
    };
    const info = collectCompositeGroupInfo([section]);
    expect(info.groupNodeIds.has(section.id)).toBe(false);
    expect(info.groupNodeIds.has(outerList.id)).toBe(false);
    expect(info.groupNodeIds.has(composite.id)).toBe(true);
    for (const member of composite.children) {
      expect(info.groupNodeIds.has(member.id)).toBe(true);
    }
    expect(info.groupEndNodeIds.has(composite.children[1].id)).toBe(true);
  });

  it("a document with multiple composites produces one independent group-end id per composite", () => {
    const text = [
      "- ![[scan1.png]]",
      "> [!ocr]",
      "> body1",
      "- ![[scan2.png]]",
      "> [!ocr]",
      "> body2",
    ].join("\n");
    const tree = treeWithComposites(text, true);
    const composites = flattenOutlineTree(tree).filter(isOutlineCompositeNode);
    expect(composites).toHaveLength(2);
    const info = collectCompositeGroupInfo(tree);
    expect(info.groupEndNodeIds.size).toBe(2);
    for (const c of composites) {
      expect(info.groupNodeIds.has(c.id)).toBe(true);
      expect(c.children.length).toBeGreaterThanOrEqual(2);
      const lastMember = c.children[c.children.length - 1];
      expect(info.groupEndNodeIds.has(lastMember.id)).toBe(true);
    }
  });
});
