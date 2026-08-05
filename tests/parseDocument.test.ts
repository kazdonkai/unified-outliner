import { describe, expect, it } from "vitest";
import { parseDocument, indentColumnsOf } from "../src/parser/parseDocument";
import { isListNode, isSectionNode } from "../src/model/block";
import { FIX_BASIC, ownerAt } from "./fixtures";

describe("parseDocument: sections", () => {
  const doc = parseDocument(FIX_BASIC);

  it("builds the section tree with correct ranges", () => {
    const secA = ownerAt(doc, 0);
    const secB = ownerAt(doc, 7);
    const secC = ownerAt(doc, 11);
    expect(isSectionNode(secA) && secA.headingText).toBe("A");
    expect(secA.range).toEqual({ startLine: 0, endLine: 10 });
    expect(secB.range).toEqual({ startLine: 7, endLine: 10 });
    expect(secC.range).toEqual({ startLine: 11, endLine: 12 });
    expect(secB.parentId).toBe(secA.id);
    expect(secC.parentId).toBeNull();
  });

  it("links top-level section siblings across nested subsections", () => {
    const secA = ownerAt(doc, 0);
    const secC = ownerAt(doc, 11);
    expect(secA.nextSiblingId).toBe(secC.id);
    expect(secC.prevSiblingId).toBe(secA.id);
  });

  it("body lines are owned by their deepest section", () => {
    expect(ownerAt(doc, 1).id).toBe(ownerAt(doc, 0).id);
    expect(ownerAt(doc, 12).id).toBe(ownerAt(doc, 11).id);
  });
});

describe("parseDocument: lists", () => {
  const doc = parseDocument(FIX_BASIC);

  it("computes list subtree ranges (children included, blanks trimmed)", () => {
    const one = ownerAt(doc, 3);
    const two = ownerAt(doc, 5);
    expect(one.range).toEqual({ startLine: 3, endLine: 4 });
    expect(two.range).toEqual({ startLine: 5, endLine: 5 });
  });

  it("links list siblings and parents", () => {
    const one = ownerAt(doc, 3);
    const oneChild = ownerAt(doc, 4);
    const two = ownerAt(doc, 5);
    expect(one.nextSiblingId).toBe(two.id);
    expect(two.prevSiblingId).toBe(one.id);
    expect(oneChild.parentId).toBe(one.id);
    expect(one.childIds).toContain(oneChild.id);
    expect(oneChild.depth).toBe(1);
  });

  it("attaches root list items to their owning section", () => {
    const secB = ownerAt(doc, 7);
    const three = ownerAt(doc, 8);
    expect(three.parentId).toBe(secB.id);
    // "two" (sec A) and "three" (sec B) must NOT be siblings.
    const two = ownerAt(doc, 5);
    expect(two.nextSiblingId).toBeNull();
    expect(three.prevSiblingId).toBeNull();
  });

  it("detects ordered markers and mixed indentation", () => {
    const d = parseDocument(["1. a", " \t- mixed"].join("\n"));
    const a = ownerAt(d, 0);
    const mixed = ownerAt(d, 1);
    expect(isListNode(a) && a.ordered).toBe(true);
    expect(isListNode(mixed) && mixed.unsafeIndent).toBe(true);
  });
});

describe("parseDocument: code blocks and frontmatter", () => {
  it("ignores headings and list markers inside fenced code", () => {
    const d = parseDocument(
      ["# A", "```js", "- not a list", "# not a heading", "```", "- real"].join(
        "\n"
      )
    );
    expect(d.codeBlockLines.slice(0, 6)).toEqual([
      false,
      true,
      true,
      true,
      true,
      false,
    ]);
    const real = ownerAt(d, 5);
    expect(real.type).toBe("list");
    // Only one list node in the document.
    const listCount = [...d.nodes.values()].filter((x) => x.type === "list")
      .length;
    expect(listCount).toBe(1);
    // No section created from the fenced pseudo-heading.
    const sectionCount = [...d.nodes.values()].filter(
      (x) => x.type === "section"
    ).length;
    expect(sectionCount).toBe(1);
  });

  it("flags YAML frontmatter", () => {
    const d = parseDocument(["---", "title: x", "---", "# A"].join("\n"));
    expect(d.frontmatterLines.slice(0, 4)).toEqual([true, true, true, false]);
    expect(ownerAt(d, 3).type).toBe("section");
  });
});

describe("indentColumnsOf", () => {
  it("expands tabs to width 4", () => {
    expect(indentColumnsOf("")).toBe(0);
    expect(indentColumnsOf("  ")).toBe(2);
    expect(indentColumnsOf("\t")).toBe(4);
    expect(indentColumnsOf("  \t")).toBe(4);
  });
});
