import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import {
  findNodeOnlyMoveTarget,
  sectionsInDocumentOrder,
} from "../src/move/findNodeOnlyMoveTarget";
import { ownerAt } from "./fixtures";

describe("findNodeOnlyMoveTarget", () => {
  it("finds the previous/next heading in document order, ignoring level", () => {
    // B is nested under A (level2 vs level1); C is a sibling of A. In
    // document order the sequence of headings is A, B, C — node-only move
    // does not care about the level jumps at all.
    const d = parseDocument(
      ["# A", "text a", "## B", "text b", "# C", "text c"].join("\n")
    );
    const secA = ownerAt(d, 0);
    const secB = ownerAt(d, 2);
    const secC = ownerAt(d, 4);

    expect(findNodeOnlyMoveTarget(d, secB, "up")).toEqual({
      kind: "swap-heading-line",
      withLine: secA.range.startLine,
    });
    expect(findNodeOnlyMoveTarget(d, secB, "down")).toEqual({
      kind: "swap-heading-line",
      withLine: secC.range.startLine,
    });
  });

  it("no-ops going up from the first heading in the document", () => {
    const d = parseDocument(["# A", "text", "## B", "text"].join("\n"));
    const secA = ownerAt(d, 0);
    expect(findNodeOnlyMoveTarget(d, secA, "up")).toEqual({
      kind: "none",
      reason: "top-of-document",
    });
  });

  it("no-ops going down from the last heading in the document", () => {
    const d = parseDocument(["# A", "text", "## B", "text"].join("\n"));
    const secB = ownerAt(d, 2);
    expect(findNodeOnlyMoveTarget(d, secB, "down")).toEqual({
      kind: "none",
      reason: "end-of-document",
    });
  });

  it("no-ops on a list item (heading-only feature)", () => {
    const d = parseDocument(["# A", "- one", "- two"].join("\n"));
    const one = ownerAt(d, 1);
    expect(findNodeOnlyMoveTarget(d, one, "up")).toEqual({
      kind: "none",
      reason: "not-a-heading",
    });
  });

  it("sectionsInDocumentOrder returns headings sorted by line, regardless of nesting", () => {
    const d = parseDocument(
      ["# A", "## A-1", "# B", "## B-1", "### B-1-1"].join("\n")
    );
    const order = sectionsInDocumentOrder(d).map((s) => s.headingText);
    expect(order).toEqual(["A", "A-1", "B", "B-1", "B-1-1"]);
  });
});
