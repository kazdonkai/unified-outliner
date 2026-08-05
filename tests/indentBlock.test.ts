import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { indentBlock } from "../src/move/indentBlock";
import { ownerAt } from "./fixtures";

describe("indentBlock: list items", () => {
  it("indents a root item to become a sibling of an existing child (aligns columns, not a fixed step)", () => {
    // "- one" already has a child "  - one-1" at 2 columns; indenting
    // "- two" under "one" must land it at the SAME 2 columns so it becomes
    // one-1's sibling, not one-1's child.
    const text = ["- one", "  - one-1", "- two"].join("\n");
    const doc = parseDocument(text);
    const two = ownerAt(doc, 2);
    const outcome = indentBlock(doc, two.id, "indent");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["- one", "  - one-1", "  - two"]);

    // Re-parse the result and confirm "two" is one-1's sibling under "one".
    const redoc = parseDocument(outcome.lines.join("\n"));
    const oneRe = ownerAt(redoc, 0);
    const twoRe = ownerAt(redoc, 2);
    expect(twoRe.parentId).toBe(oneRe.id);
    expect(twoRe.prevSiblingId).toBe(ownerAt(redoc, 1).id);
  });

  it("indents a root item under a childless previous sibling using a default TAB_WIDTH step", () => {
    const text = ["- one", "- two"].join("\n");
    const doc = parseDocument(text);
    const two = ownerAt(doc, 1);
    const outcome = indentBlock(doc, two.id, "indent");
    expect(outcome.lines).toEqual(["- one", "    - two"]);
  });

  it("carries a moved item's own children along when indenting", () => {
    const text = ["- one", "- two", "  - two-1"].join("\n");
    const doc = parseDocument(text);
    const two = ownerAt(doc, 1);
    const outcome = indentBlock(doc, two.id, "indent");
    expect(outcome.lines).toEqual(["- one", "    - two", "      - two-1"]);
  });

  it("outdents a last child back to its parent's level (exact column match)", () => {
    const text = ["- one", "  - one-1"].join("\n");
    const doc = parseDocument(text);
    const child = ownerAt(doc, 1);
    const outcome = indentBlock(doc, child.id, "outdent");
    expect(outcome.lines).toEqual(["- one", "- one-1"]);
  });

  it("outdent is a no-op for a root item", () => {
    const doc = parseDocument("- one");
    const one = ownerAt(doc, 0);
    const outcome = indentBlock(doc, one.id, "outdent");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("already-root");
  });

  it("outdent is a no-op for a non-last child (MVP scope limit)", () => {
    const doc = parseDocument(
      ["- parent", "  - child-1", "  - child-2"].join("\n")
    );
    const child1 = ownerAt(doc, 1);
    const outcome = indentBlock(doc, child1.id, "outdent");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("not-last-child");
  });

  it("normalizes ordered markers in the affected region after indent", () => {
    const text = ["1. one", "1. two"].join("\n");
    const doc = parseDocument(text);
    const two = ownerAt(doc, 1);
    const outcome = indentBlock(doc, two.id, "indent", {
      normalizeOrderedLists: true,
    });
    expect(outcome.lines).toEqual(["1. one", "    1. two"]);
  });
});

describe("indentBlock: headings", () => {
  it("indents a leaf section's heading level by one", () => {
    const text = ["# A", "text a", "# B", "text b"].join("\n");
    const doc = parseDocument(text);
    const secB = ownerAt(doc, 2);
    const outcome = indentBlock(doc, secB.id, "indent");
    expect(outcome.lines).toEqual(["# A", "text a", "## B", "text b"]);
  });

  it("outdents a leaf section's heading level by one (two levels below its parent)", () => {
    const text = ["# A", "### A-1", "text"].join("\n");
    const doc = parseDocument(text);
    const secA1 = ownerAt(doc, 1);
    const outcome = indentBlock(doc, secA1.id, "outdent");
    expect(outcome.lines).toEqual(["# A", "## A-1", "text"]);
  });

  it("does not touch sibling sections or list content", () => {
    // B and C are sibling child sections of A; indenting C must leave A's
    // list item, B's heading/list, and B's own text alone.
    const text = [
      "# A",
      "- item-a",
      "## B",
      "- item-b",
      "## C",
      "text-c",
    ].join("\n");
    const doc = parseDocument(text);
    const secC = ownerAt(doc, 4);
    const outcome = indentBlock(doc, secC.id, "indent");
    expect(outcome.lines).toEqual([
      "# A",
      "- item-a",
      "## B",
      "- item-b",
      "### C",
      "text-c",
    ]);
  });

  it("cascades outdent through the whole subtree, preserving relative levels (reported scenario)", () => {
    // "## Markdown B" has a child section "### Markdown C". Outdenting B
    // must produce "# Markdown B" / "## Markdown C" — both shift by the
    // same delta — not be blocked because B has a subsection.
    const text = [
      "# Unified Outliner Test",
      "## Markdown A",
      "## Markdown B",
      "### Markdown C",
      "- List 1",
      "- List 2",
    ].join("\n");
    const doc = parseDocument(text);
    const secB = ownerAt(doc, 2);
    const outcome = indentBlock(doc, secB.id, "outdent");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "# Unified Outliner Test",
      "## Markdown A",
      "# Markdown B",
      "## Markdown C",
      "- List 1",
      "- List 2",
    ]);
  });

  it("cascades indent through the whole subtree, preserving relative levels", () => {
    const text = [
      "# Unified Outliner Test",
      "## Markdown A",
      "## Markdown B",
      "### Markdown C",
      "- List 1",
    ].join("\n");
    const doc = parseDocument(text);
    const secB = ownerAt(doc, 2);
    const outcome = indentBlock(doc, secB.id, "indent");
    expect(outcome.lines).toEqual([
      "# Unified Outliner Test",
      "## Markdown A",
      "### Markdown B",
      "#### Markdown C",
      "- List 1",
    ]);
  });

  it("cascades through multiple levels of descendants and leaves unrelated sections/lists untouched", () => {
    const text = [
      "# Root",
      "## X",
      "- item-x",
      "## Y",
      "### Y-1",
      "#### Y-1-1",
      "text",
      "## Z",
    ].join("\n");
    const doc = parseDocument(text);
    const secY = ownerAt(doc, 3);
    const outcome = indentBlock(doc, secY.id, "outdent");
    expect(outcome.lines).toEqual([
      "# Root",
      "## X",
      "- item-x",
      "# Y",
      "## Y-1",
      "### Y-1-1",
      "text",
      "## Z",
    ]);
  });

  it("promotes a nested section to sit alongside its former parent (regression: reported false no-op)", () => {
    // Reported scenario: "### Markdown C" is a child of "## Markdown B"
    // (itself a child of "# Unified Outliner Test"). Outdenting C must
    // succeed and produce "## Markdown C", making it B's sibling — this
    // used to be incorrectly blocked as "would-break-hierarchy".
    const text = [
      "# Unified Outliner Test",
      "## Markdown A",
      "## Markdown B",
      "### Markdown C",
      "- List 1",
      "- List 2",
    ].join("\n");
    const doc = parseDocument(text);
    const secC = ownerAt(doc, 3);
    const outcome = indentBlock(doc, secC.id, "outdent");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "# Unified Outliner Test",
      "## Markdown A",
      "## Markdown B",
      "## Markdown C",
      "- List 1",
      "- List 2",
    ]);

    const redoc = parseDocument(outcome.lines.join("\n"));
    const root = ownerAt(redoc, 0);
    const secB = ownerAt(redoc, 2);
    const secCRe = ownerAt(redoc, 3);
    expect(secCRe.parentId).toBe(root.id);
    expect(secCRe.prevSiblingId).toBe(secB.id);
  });
});
