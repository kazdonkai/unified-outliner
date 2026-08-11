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

  it("outdents a non-last child, adopting its trailing siblings as children (reported scenario)", () => {
    // Reported example: "List 2" is not List 1's last child ("List 3"
    // follows it). Outdenting "List 2" must promote it to List 1's sibling
    // while "List 3" becomes List 2's child — no line reordering, no
    // explicit re-parenting code path, just an indent-column shrink of
    // List 2's own (childless) range. See findIndentTarget.ts's design
    // note for why this is sufficient.
    const text = ["- List 1", "  - List 2", "  - List 3"].join("\n");
    const doc = parseDocument(text);
    const list2 = ownerAt(doc, 1);
    const outcome = indentBlock(doc, list2.id, "outdent");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["- List 1", "- List 2", "  - List 3"]);

    const redoc = parseDocument(outcome.lines.join("\n"));
    const list1Re = ownerAt(redoc, 0);
    const list2Re = ownerAt(redoc, 1);
    const list3Re = ownerAt(redoc, 2);
    // List 1 and List 2 are now siblings (both root list items).
    expect(list2Re.parentId).toBe(list1Re.parentId);
    expect(list1Re.nextSiblingId).toBe(list2Re.id);
    // List 3 is now List 2's child.
    expect(list3Re.parentId).toBe(list2Re.id);
  });

  it("outdents a middle child of four, preserving document order (P/A/B/C/D)", () => {
    // Outdenting B (2nd of P's four children A,B,C,D) must produce:
    // P > A ; B(sibling of P) > C, D — with B, C, D's *trailing* order
    // (document order) unchanged and A left alone as P's remaining child.
    const text = [
      "- P",
      "  - A",
      "  - B",
      "  - C",
      "  - D",
    ].join("\n");
    const doc = parseDocument(text);
    const b = ownerAt(doc, 2);
    const outcome = indentBlock(doc, b.id, "outdent");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "- P",
      "  - A",
      "- B",
      "  - C",
      "  - D",
    ]);

    const redoc = parseDocument(outcome.lines.join("\n"));
    const pRe = ownerAt(redoc, 0);
    const aRe = ownerAt(redoc, 1);
    const bRe = ownerAt(redoc, 2);
    const cRe = ownerAt(redoc, 3);
    const dRe = ownerAt(redoc, 4);
    expect(pRe.childIds).toEqual([aRe.id]);
    expect(pRe.nextSiblingId).toBe(bRe.id);
    expect(bRe.childIds).toEqual([cRe.id, dRe.id]);
    // Document line order is untouched: P, A, B, C, D top-to-bottom.
    expect([pRe, aRe, bRe, cRe, dRe].map((n) => n.range.startLine)).toEqual([
      0, 1, 2, 3, 4,
    ]);
  });

  it("outdents a middle child that already has its own children: pre-existing children stay first, adopted trailing siblings follow, in document order", () => {
    const text = [
      "- P",
      "  - A",
      "  - B",
      "    - B1",
      "  - C",
      "  - D",
    ].join("\n");
    const doc = parseDocument(text);
    const b = ownerAt(doc, 2);
    const outcome = indentBlock(doc, b.id, "outdent");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "- P",
      "  - A",
      "- B",
      "  - B1",
      "  - C",
      "  - D",
    ]);

    const redoc = parseDocument(outcome.lines.join("\n"));
    const bRe = ownerAt(redoc, 2);
    const b1Re = ownerAt(redoc, 3);
    const cRe = ownerAt(redoc, 4);
    const dRe = ownerAt(redoc, 5);
    // B1 (B's own pre-existing child) comes first, then the two adopted
    // former trailing siblings C and D, all in document order.
    expect(bRe.childIds).toEqual([b1Re.id, cRe.id, dRe.id]);
    expect(b1Re.nextSiblingId).toBe(cRe.id);
    expect(cRe.nextSiblingId).toBe(dRe.id);
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
