import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { findNodeOnlyLevelTarget } from "../src/level/findNodeOnlyLevelTarget";
import { ownerAt } from "./fixtures";

describe("findNodeOnlyLevelTarget", () => {
  it("allows indenting a heading that has child sections (node-only never inspects subtree)", () => {
    const d = parseDocument(
      ["# A", "## A-1", "text", "# B", "text b"].join("\n")
    );
    const secA = ownerAt(d, 0); // has a child section, would be blocked in block mode
    expect(findNodeOnlyLevelTarget(secA, "indent")).toEqual({
      kind: "node-only-indent",
    });
  });

  it("allows outdenting a heading that has child sections", () => {
    const d = parseDocument(["# A", "## A-1", "text"].join("\n"));
    const secA1 = ownerAt(d, 1);
    expect(findNodeOnlyLevelTarget(secA1, "outdent")).toEqual({
      kind: "node-only-outdent",
    });
  });

  it("allows indenting a heading with no previous sibling (block mode would refuse this)", () => {
    const d = parseDocument(["# A", "## A-1", "text"].join("\n"));
    const secA1 = ownerAt(d, 1); // first (only) child of A, no previous sibling
    expect(findNodeOnlyLevelTarget(secA1, "indent")).toEqual({
      kind: "node-only-indent",
    });
  });

  it("no-ops at the max heading level (6)", () => {
    const d = parseDocument(["###### A", "text"].join("\n"));
    const secA = ownerAt(d, 0);
    expect(findNodeOnlyLevelTarget(secA, "indent")).toEqual({
      kind: "none",
      reason: "max-heading-level",
    });
  });

  it("no-ops at the min heading level (1)", () => {
    const d = parseDocument(["# A", "text"].join("\n"));
    const secA = ownerAt(d, 0);
    expect(findNodeOnlyLevelTarget(secA, "outdent")).toEqual({
      kind: "none",
      reason: "min-heading-level",
    });
  });

  it("no-ops on a list item (node-only level change is heading-specific)", () => {
    const d = parseDocument(["- one", "- two"].join("\n"));
    const one = ownerAt(d, 0);
    expect(findNodeOnlyLevelTarget(one, "indent")).toEqual({
      kind: "none",
      reason: "not-a-heading",
    });
    expect(findNodeOnlyLevelTarget(one, "outdent")).toEqual({
      kind: "none",
      reason: "not-a-heading",
    });
  });
});
