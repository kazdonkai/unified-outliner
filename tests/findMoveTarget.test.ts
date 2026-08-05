import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { findMoveTarget } from "../src/move/findMoveTarget";
import { FIX_BASIC, ownerAt } from "./fixtures";

describe("findMoveTarget: list items", () => {
  const doc = parseDocument(FIX_BASIC);

  it("swaps with the adjacent list sibling", () => {
    const one = ownerAt(doc, 3);
    const two = ownerAt(doc, 5);
    expect(findMoveTarget(doc, two, "up")).toEqual({
      kind: "swap",
      withId: one.id,
    });
    expect(findMoveTarget(doc, one, "down")).toEqual({
      kind: "swap",
      withId: two.id,
    });
  });

  it("crosses a section boundary when adjacent to a heading (spec §5)", () => {
    const three = ownerAt(doc, 8); // first block of "## B"
    expect(findMoveTarget(doc, three, "up")).toEqual({
      kind: "insert",
      insertBeforeLine: 7,
    });
    const four = ownerAt(doc, 9); // last block of "## B", "# C" follows
    expect(findMoveTarget(doc, four, "down")).toEqual({
      kind: "insert",
      insertBeforeLine: 12,
    });
  });

  it("is blocked by a paragraph (paragraph hopping is TODO)", () => {
    const one = ownerAt(doc, 3); // "body a" sits above
    expect(findMoveTarget(doc, one, "up")).toEqual({
      kind: "none",
      reason: "blocked-by-paragraph",
    });
  });

  it("nested item at the edge of its parent is a no-op", () => {
    const child = ownerAt(doc, 4);
    expect(findMoveTarget(doc, child, "up").kind).toBe("none");
    expect(findMoveTarget(doc, child, "down").kind).toBe("none");
  });

  it("respects allowCrossSectionListMove = false", () => {
    const three = ownerAt(doc, 8);
    expect(
      findMoveTarget(doc, three, "up", { allowCrossSectionListMove: false })
    ).toEqual({ kind: "none", reason: "cross-section-disabled" });
  });

  it("refuses to move blocks with mixed indentation", () => {
    const d = parseDocument(["- a", " \t- mixed"].join("\n"));
    const mixed = ownerAt(d, 1);
    expect(findMoveTarget(d, mixed, "up")).toEqual({
      kind: "none",
      reason: "unsafe-indent",
    });
  });
});

describe("findMoveTarget: sections", () => {
  const doc = parseDocument(FIX_BASIC);

  it("swaps top-level sibling sections", () => {
    const secA = ownerAt(doc, 0);
    const secC = ownerAt(doc, 11);
    expect(findMoveTarget(doc, secC, "up")).toEqual({
      kind: "swap",
      withId: secA.id,
    });
    expect(findMoveTarget(doc, secA, "down")).toEqual({
      kind: "swap",
      withId: secC.id,
    });
  });

  it("sections never cross their parent boundary (no sibling => no-op)", () => {
    const secB = ownerAt(doc, 7); // only child section of "# A"
    expect(findMoveTarget(doc, secB, "up")).toEqual({
      kind: "none",
      reason: "no-sibling",
    });
    expect(findMoveTarget(doc, secB, "down")).toEqual({
      kind: "none",
      reason: "no-sibling",
    });
  });
});
