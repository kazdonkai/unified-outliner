import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { findAncestorPath } from "../src/tree/ancestorPath";
import { BlockNode, ParsedDocument } from "../src/model/block";
import { FIX_BASIC, ownerAt } from "./fixtures";

describe("findAncestorPath", () => {
  const doc = parseDocument(FIX_BASIC);

  it("returns an empty array for a top-level node with no parent", () => {
    const a = ownerAt(doc, 0); // "# A", a root section
    expect(findAncestorPath(doc, a.id)).toEqual([]);
  });

  it("returns root-first ancestors for a nested list item under a section", () => {
    // "  - one-1" (line 4) is a child of "- one" (line 3), which is a root
    // list item of section "# A" (line 0).
    const oneOne = ownerAt(doc, 4);
    const one = ownerAt(doc, 3);
    const a = ownerAt(doc, 0);
    expect(findAncestorPath(doc, oneOne.id)).toEqual([
      { id: a.id, kind: "section", label: "A" },
      { id: one.id, kind: "list", label: "one" },
    ]);
  });

  it("returns a mixed section/list ancestor chain (section root -> list parent)", () => {
    // Same fixture as above, re-asserted explicitly against the "section
    // と list が混在する祖先列" requirement: the path mixes both kinds.
    const oneOne = ownerAt(doc, 4);
    const kinds = findAncestorPath(doc, oneOne.id).map((e) => e.kind);
    expect(kinds).toEqual(["section", "list"]);
  });

  it("returns root-first ancestors for a deeply nested section (two heading levels)", () => {
    // "## B" (line 7) is a child section of "# A" (line 0); "- three"
    // (line 8) is a root list item of B.
    const three = ownerAt(doc, 8);
    const b = ownerAt(doc, 7);
    const a = ownerAt(doc, 0);
    expect(findAncestorPath(doc, three.id)).toEqual([
      { id: a.id, kind: "section", label: "A" },
      { id: b.id, kind: "section", label: "B" },
    ]);
  });

  it("returns an empty array for an unresolvable nodeId", () => {
    expect(findAncestorPath(doc, "does-not-exist")).toEqual([]);
  });

  it("stops safely instead of crashing when a parentId points at a missing node", () => {
    const fake: ParsedDocument = {
      lines: [],
      nodes: new Map<string, BlockNode>([
        [
          "child",
          {
            id: "child",
            type: "section",
            range: { startLine: 0, endLine: 0 },
            parentId: "missing-parent",
            prevSiblingId: null,
            nextSiblingId: null,
            childIds: [],
            depth: 1,
            headingLevel: 2,
            headingText: "Child",
          },
        ],
      ]),
      topLevelIds: [],
      lineToOwningNodeId: [],
      codeBlockLines: [],
      frontmatterLines: [],
    };
    expect(() => findAncestorPath(fake, "child")).not.toThrow();
    expect(findAncestorPath(fake, "child")).toEqual([]);
  });

  it("stops safely instead of looping forever on a cyclic parentId chain", () => {
    const fake: ParsedDocument = {
      lines: [],
      nodes: new Map<string, BlockNode>([
        [
          "a",
          {
            id: "a",
            type: "section",
            range: { startLine: 0, endLine: 0 },
            parentId: "b",
            prevSiblingId: null,
            nextSiblingId: null,
            childIds: [],
            depth: 1,
            headingLevel: 2,
            headingText: "A",
          },
        ],
        [
          "b",
          {
            id: "b",
            type: "section",
            range: { startLine: 1, endLine: 1 },
            parentId: "a",
            prevSiblingId: null,
            nextSiblingId: null,
            childIds: [],
            depth: 1,
            headingLevel: 2,
            headingText: "B",
          },
        ],
      ]),
      topLevelIds: [],
      lineToOwningNodeId: [],
      codeBlockLines: [],
      frontmatterLines: [],
    };
    expect(() => findAncestorPath(fake, "a")).not.toThrow();
    // "a" -> "b" -> "a" (already visited) -> stop; "a" itself is excluded.
    expect(findAncestorPath(fake, "a")).toEqual([
      { id: "b", kind: "section", label: "B" },
    ]);
  });
});
