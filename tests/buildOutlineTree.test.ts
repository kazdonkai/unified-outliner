import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import {
  buildOutlineTree,
  flattenOutlineTree,
  isOutlineListNode,
  isOutlineSectionNode,
  OutlineTreeNode,
} from "../src/tree/buildOutlineTree";
import { FIX_BASIC } from "./fixtures";

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
      isOutlineSectionNode(n) ? n.headingText : n.text
    );
    expect(flat).toEqual(["A", "one", "one-1", "two", "B", "three", "four", "C"]);
  });
});
