import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { findDirectChildren } from "../src/tree/descendantPath";
import { BlockNode, ParsedDocument } from "../src/model/block";
import { FIX_BASIC, ownerAt } from "./fixtures";

describe("findDirectChildren", () => {
  const doc = parseDocument(FIX_BASIC);

  it("returns direct children of a section in document order, not childIds insertion order", () => {
    // Section A's childIds are pushed as [B, one, two] (child sections in
    // pass 1, root list items in pass 2 — see parser/parseDocument.ts), but
    // document/line order is one(3), two(5), B(7).
    const a = ownerAt(doc, 0);
    const one = ownerAt(doc, 3);
    const two = ownerAt(doc, 5);
    const b = ownerAt(doc, 7);
    expect(findDirectChildren(doc, a.id)).toEqual([
      { id: one.id, kind: "list", label: "one", depth: 1, hasChildren: true },
      { id: two.id, kind: "list", label: "two", depth: 1, hasChildren: false },
      { id: b.id, kind: "section", label: "B", depth: 1, hasChildren: true },
    ]);
  });

  it("returns a list item's own direct children", () => {
    const one = ownerAt(doc, 3);
    const oneOne = ownerAt(doc, 4);
    expect(findDirectChildren(doc, one.id)).toEqual([
      { id: oneOne.id, kind: "list", label: "one-1", depth: 1, hasChildren: false },
    ]);
  });

  it("returns an empty array for a leaf node with no children", () => {
    const two = ownerAt(doc, 5);
    expect(findDirectChildren(doc, two.id)).toEqual([]);
  });

  it("returns an empty array for an unresolvable nodeId", () => {
    expect(findDirectChildren(doc, "does-not-exist")).toEqual([]);
  });

  it("uses nodeDisplayLabel's fallback for an empty heading child", () => {
    const d = parseDocument(["# Root", "## ", "text"].join("\n"));
    const root = ownerAt(d, 0);
    const children = findDirectChildren(d, root.id);
    expect(children).toHaveLength(1);
    expect(children[0].label).toBe("(Untitled heading)");
  });

  it("stops safely instead of crashing when a childId points at a missing node", () => {
    const fake: ParsedDocument = {
      lines: [],
      nodes: new Map<string, BlockNode>([
        [
          "parent",
          {
            id: "parent",
            type: "section",
            range: { startLine: 0, endLine: 0 },
            parentId: null,
            prevSiblingId: null,
            nextSiblingId: null,
            childIds: ["missing-child", "missing-child"],
            depth: 0,
            headingLevel: 1,
            headingText: "Parent",
          },
        ],
      ]),
      topLevelIds: ["parent"],
      lineToOwningNodeId: [],
      codeBlockLines: [],
      frontmatterLines: [],
    };
    expect(() => findDirectChildren(fake, "parent")).not.toThrow();
    expect(findDirectChildren(fake, "parent")).toEqual([]);
  });

  it("de-duplicates a childId that (defensively) appears more than once", () => {
    const fake: ParsedDocument = {
      lines: [],
      nodes: new Map<string, BlockNode>([
        [
          "parent",
          {
            id: "parent",
            type: "section",
            range: { startLine: 0, endLine: 0 },
            parentId: null,
            prevSiblingId: null,
            nextSiblingId: null,
            childIds: ["child", "child"],
            depth: 0,
            headingLevel: 1,
            headingText: "Parent",
          },
        ],
        [
          "child",
          {
            id: "child",
            type: "section",
            range: { startLine: 1, endLine: 1 },
            parentId: "parent",
            prevSiblingId: null,
            nextSiblingId: null,
            childIds: [],
            depth: 1,
            headingLevel: 2,
            headingText: "Child",
          },
        ],
      ]),
      topLevelIds: ["parent"],
      lineToOwningNodeId: [],
      codeBlockLines: [],
      frontmatterLines: [],
    };
    expect(findDirectChildren(fake, "parent")).toEqual([
      { id: "child", kind: "section", label: "Child", depth: 1, hasChildren: false },
    ]);
  });
});
