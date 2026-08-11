import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import {
  getNextSibling,
  getPreviousSibling,
  getSiblingNavigationState,
} from "../src/tree/siblingNavigation";
import { BlockNode, ParsedDocument } from "../src/model/block";
import { FIX_BASIC, ownerAt } from "./fixtures";

describe("sibling navigation (getPreviousSibling / getNextSibling / getSiblingNavigationState)", () => {
  const doc = parseDocument(FIX_BASIC);

  it("resolves the next sibling for a root list item followed by another", () => {
    // "- one" (line 3) and "- two" (line 5) are both root list items of "# A".
    const one = ownerAt(doc, 3);
    const two = ownerAt(doc, 5);
    expect(getNextSibling(doc, one.id)).toEqual({ nodeId: two.id, displayLabel: "two" });
    expect(getPreviousSibling(doc, one.id)).toBeNull();
  });

  it("resolves the previous sibling symmetrically for the following item", () => {
    const one = ownerAt(doc, 3);
    const two = ownerAt(doc, 5);
    expect(getPreviousSibling(doc, two.id)).toEqual({ nodeId: one.id, displayLabel: "one" });
    expect(getNextSibling(doc, two.id)).toBeNull();
  });

  it("returns null in both directions for a single-child nested list item", () => {
    // "  - one-1" (line 4) is the only child of "- one" — no siblings of its own.
    const oneOne = ownerAt(doc, 4);
    expect(getPreviousSibling(doc, oneOne.id)).toBeNull();
    expect(getNextSibling(doc, oneOne.id)).toBeNull();
  });

  it("resolves top-level section siblings across an intervening child section", () => {
    // "# A" (line 0) and "# C" (line 11) are both top-level sections; "## B"
    // (line 7) is A's child section and does not break the A/C sibling link.
    const a = ownerAt(doc, 0);
    const c = ownerAt(doc, 11);
    expect(getNextSibling(doc, a.id)).toEqual({ nodeId: c.id, displayLabel: "C" });
    expect(getPreviousSibling(doc, c.id)).toEqual({ nodeId: a.id, displayLabel: "A" });
  });

  it("returns null in both directions for an only child section", () => {
    // "## B" (line 7) is the only child section of "# A".
    const b = ownerAt(doc, 7);
    expect(getPreviousSibling(doc, b.id)).toBeNull();
    expect(getNextSibling(doc, b.id)).toBeNull();
  });

  it("returns null in both directions for an unresolvable nodeId", () => {
    expect(getPreviousSibling(doc, "does-not-exist")).toBeNull();
    expect(getNextSibling(doc, "does-not-exist")).toBeNull();
  });

  it("getSiblingNavigationState bundles both directions in one call", () => {
    const one = ownerAt(doc, 3);
    const two = ownerAt(doc, 5);
    expect(getSiblingNavigationState(doc, one.id)).toEqual({
      previous: null,
      next: { nodeId: two.id, displayLabel: "two" },
    });
    expect(getSiblingNavigationState(doc, two.id)).toEqual({
      previous: { nodeId: one.id, displayLabel: "one" },
      next: null,
    });
  });

  it("stops safely instead of crashing when prevSiblingId/nextSiblingId point at a missing node", () => {
    const fake: ParsedDocument = {
      lines: [],
      nodes: new Map<string, BlockNode>([
        [
          "child",
          {
            id: "child",
            type: "section",
            range: { startLine: 0, endLine: 0 },
            parentId: null,
            prevSiblingId: "missing-prev",
            nextSiblingId: "missing-next",
            childIds: [],
            depth: 0,
            headingLevel: 1,
            headingText: "Child",
          },
        ],
      ]),
      topLevelIds: ["child"],
      lineToOwningNodeId: [],
      codeBlockLines: [],
      frontmatterLines: [],
    };
    expect(() => getPreviousSibling(fake, "child")).not.toThrow();
    expect(() => getNextSibling(fake, "child")).not.toThrow();
    expect(getPreviousSibling(fake, "child")).toBeNull();
    expect(getNextSibling(fake, "child")).toBeNull();
  });
});
