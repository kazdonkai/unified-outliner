import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import {
  resolveHighlightedNodeId,
  resolveHighlightedSectionId,
} from "../src/tree/resolveHighlightedSectionId";
import { ownerAt } from "./fixtures";

describe("resolveHighlightedSectionId", () => {
  it("resolves a heading line to its own section", () => {
    const doc = parseDocument(["# A", "text a", "# B"].join("\n"));
    const secA = ownerAt(doc, 0);
    expect(resolveHighlightedSectionId(doc, 0)).toBe(secA.id);
  });

  it("resolves a body line to the owning section", () => {
    const doc = parseDocument(["# A", "text a", "# B"].join("\n"));
    const secA = ownerAt(doc, 0);
    expect(resolveHighlightedSectionId(doc, 1)).toBe(secA.id);
  });

  it("resolves a cursor inside a list item to the item's owning section, not the list item", () => {
    const doc = parseDocument(
      ["# A", "- one", "  - one-1", "# B"].join("\n")
    );
    const secA = ownerAt(doc, 0);
    // cursor on the nested list item line
    expect(resolveHighlightedSectionId(doc, 2)).toBe(secA.id);
  });

  it("returns null for frontmatter", () => {
    const doc = parseDocument(["---", "title: x", "---", "# A"].join("\n"));
    expect(resolveHighlightedSectionId(doc, 1)).toBeNull();
  });

  it("returns null for a line inside a fenced code block", () => {
    const doc = parseDocument(
      ["# A", "```", "not code", "```"].join("\n")
    );
    expect(resolveHighlightedSectionId(doc, 2)).toBeNull();
  });

  it("returns null for an out-of-range line", () => {
    const doc = parseDocument("# A");
    expect(resolveHighlightedSectionId(doc, 99)).toBeNull();
  });
});

describe("resolveHighlightedNodeId", () => {
  it("with includeLists: false, behaves exactly like resolveHighlightedSectionId", () => {
    const doc = parseDocument(
      ["# A", "- one", "  - one-1", "# B"].join("\n")
    );
    const secA = ownerAt(doc, 0);
    expect(resolveHighlightedNodeId(doc, 2, { includeLists: false })).toBe(secA.id);
    expect(resolveHighlightedNodeId(doc, 2)).toBe(secA.id);
  });

  it("with includeLists: true, resolves a cursor on a list item to the item itself", () => {
    const doc = parseDocument(
      ["# A", "- one", "  - one-1", "# B"].join("\n")
    );
    const one = ownerAt(doc, 1);
    const oneOne = ownerAt(doc, 2);
    expect(resolveHighlightedNodeId(doc, 1, { includeLists: true })).toBe(one.id);
    expect(resolveHighlightedNodeId(doc, 2, { includeLists: true })).toBe(oneOne.id);
  });

  it("with includeLists: true, still resolves a heading line to its own section", () => {
    const doc = parseDocument(["# A", "- one", "# B"].join("\n"));
    const secA = ownerAt(doc, 0);
    expect(resolveHighlightedNodeId(doc, 0, { includeLists: true })).toBe(secA.id);
  });

  it("with includeLists: true, still returns null for frontmatter / code-fence / out-of-range", () => {
    const fm = parseDocument(["---", "title: x", "---", "# A"].join("\n"));
    expect(resolveHighlightedNodeId(fm, 1, { includeLists: true })).toBeNull();

    const fence = parseDocument(["# A", "```", "not code", "```"].join("\n"));
    expect(resolveHighlightedNodeId(fence, 2, { includeLists: true })).toBeNull();

    const oor = parseDocument("# A");
    expect(resolveHighlightedNodeId(oor, 99, { includeLists: true })).toBeNull();
  });
});
