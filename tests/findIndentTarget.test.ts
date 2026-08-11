import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { findIndentTarget } from "../src/move/findIndentTarget";
import { FIX_BASIC, ownerAt } from "./fixtures";

describe("findIndentTarget: list items", () => {
  const doc = parseDocument(FIX_BASIC);

  it("indents a root item under its previous sibling", () => {
    const two = ownerAt(doc, 5); // "- two", prev sibling is "- one"
    const one = ownerAt(doc, 3);
    expect(findIndentTarget(doc, two, "indent")).toEqual({
      kind: "list-indent",
      prevSiblingId: one.id,
    });
  });

  it("refuses to indent an item with no previous sibling", () => {
    const one = ownerAt(doc, 3); // first root item, no previous sibling
    expect(findIndentTarget(doc, one, "indent")).toEqual({
      kind: "none",
      reason: "no-previous-sibling",
    });
  });

  it("outdents a nested last child of its parent", () => {
    const child = ownerAt(doc, 4); // "  - one-1", only (=last) child of "- one"
    const one = ownerAt(doc, 3);
    expect(findIndentTarget(doc, child, "outdent")).toEqual({
      kind: "list-outdent",
      parentId: one.id,
    });
  });

  it("refuses to outdent a root item (already-root)", () => {
    const one = ownerAt(doc, 3);
    expect(findIndentTarget(doc, one, "outdent")).toEqual({
      kind: "none",
      reason: "already-root",
    });
  });

  it("allows outdenting a non-last child (trailing siblings become its children)", () => {
    const d = parseDocument(
      ["- parent", "  - child-1", "  - child-2"].join("\n")
    );
    const parent = ownerAt(d, 0);
    const child1 = ownerAt(d, 1);
    expect(findIndentTarget(d, child1, "outdent")).toEqual({
      kind: "list-outdent",
      parentId: parent.id,
    });
    const child2 = ownerAt(d, 2);
    expect(findIndentTarget(d, child2, "outdent").kind).toBe("list-outdent");
  });

  it("refuses to indent/outdent blocks with mixed indentation", () => {
    const d = parseDocument(["- a", " \t- mixed"].join("\n"));
    const mixed = ownerAt(d, 1);
    expect(findIndentTarget(d, mixed, "indent")).toEqual({
      kind: "none",
      reason: "unsafe-indent",
    });
  });
});

describe("findIndentTarget: sections", () => {
  it("indents a leaf section that has a previous sibling", () => {
    const d = parseDocument(["# A", "text a", "# B", "text b"].join("\n"));
    const secB = ownerAt(d, 2);
    expect(findIndentTarget(d, secB, "indent")).toEqual({ kind: "heading-indent" });
  });

  it("refuses to indent the first section (no previous sibling)", () => {
    const d = parseDocument(["# A", "text a", "# B", "text b"].join("\n"));
    const secA = ownerAt(d, 0);
    expect(findIndentTarget(d, secA, "indent")).toEqual({
      kind: "none",
      reason: "no-previous-sibling",
    });
  });

  it("allows outdenting a section that has subsections (cascades to the whole subtree)", () => {
    const d = parseDocument(
      ["# Root", "## A", "### A-1", "text"].join("\n")
    );
    const secA = ownerAt(d, 1);
    expect(findIndentTarget(d, secA, "outdent")).toEqual({
      kind: "heading-outdent",
    });
  });

  it("allows indenting a section that has subsections, given a previous sibling (cascades to the whole subtree)", () => {
    const d = parseDocument(
      ["# Root", "## W", "## A", "### A-1", "text"].join("\n")
    );
    const secA = ownerAt(d, 2);
    expect(findIndentTarget(d, secA, "indent")).toEqual({
      kind: "heading-indent",
    });
  });

  it("refuses to indent past level 6", () => {
    const d = parseDocument(
      ["###### A", "text a", "###### B", "text b"].join("\n")
    );
    const secB = ownerAt(d, 2);
    expect(findIndentTarget(d, secB, "indent")).toEqual({
      kind: "none",
      reason: "max-heading-level",
    });
  });

  it("refuses to indent when a descendant section is already at level 6, even if the section itself is shallower", () => {
    // "A" is itself only level 2 (well under the max) and has a previous
    // sibling "W", but A's descendant "deep" is already at level 6 —
    // indenting the whole subtree would push "deep" to level 7, so the
    // whole cascade must be refused.
    const d = parseDocument(
      ["# Z", "## W", "## A", "###### deep", "text"].join("\n")
    );
    const secA = ownerAt(d, 2);
    expect(findIndentTarget(d, secA, "indent")).toEqual({
      kind: "none",
      reason: "max-heading-level",
    });
  });

  it("outdents a leaf section deeper than its parent + 1", () => {
    const d = parseDocument(["# A", "### A-1", "text"].join("\n"));
    const secA1 = ownerAt(d, 1);
    expect(findIndentTarget(d, secA1, "outdent")).toEqual({
      kind: "heading-outdent",
    });
  });

  it("refuses to outdent level 1", () => {
    const d = parseDocument(["# A", "text a"].join("\n"));
    const secA = ownerAt(d, 0);
    expect(findIndentTarget(d, secA, "outdent")).toEqual({
      kind: "none",
      reason: "min-heading-level",
    });
  });

  it("outdents a direct child to become its former parent's sibling", () => {
    // "## A-1" outdenting to level 1 must succeed: it is promoted to sit
    // alongside "# A" rather than being blocked for "reaching" A's level.
    const d = parseDocument(["# A", "## A-1", "text"].join("\n"));
    const secA1 = ownerAt(d, 1);
    expect(findIndentTarget(d, secA1, "outdent")).toEqual({
      kind: "heading-outdent",
    });
  });
});
