import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { resolveCurrentBlock } from "../src/resolver/resolveCurrentBlock";
import { setNodeOnlyLevel } from "../src/level/setNodeOnlyLevel";
import { ownerAt } from "./fixtures";

describe("setNodeOnlyLevel: normal cases", () => {
  it("indents a heading's own line only", () => {
    const text = ["# A", "text a", "## B", "text b"].join("\n");
    const doc = parseDocument(text);
    const secB = ownerAt(doc, 2);
    const outcome = setNodeOnlyLevel(doc, secB.id, "indent");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["# A", "text a", "### B", "text b"]);
  });

  it("outdents a heading's own line only", () => {
    const text = ["# A", "## A-1", "text"].join("\n");
    const doc = parseDocument(text);
    const secA1 = ownerAt(doc, 1);
    const outcome = setNodeOnlyLevel(doc, secA1.id, "outdent");
    expect(outcome.lines).toEqual(["# A", "# A-1", "text"]);
  });
});

describe("setNodeOnlyLevel: does not touch subtree structure", () => {
  it("leaves child sections' own level and body untouched when the parent is indented", () => {
    const text = [
      "# A",
      "body a",
      "## A-1",
      "body a-1",
      "### A-1-1",
      "body a-1-1",
      "# B",
      "body b",
    ].join("\n");
    const doc = parseDocument(text);
    const secA = ownerAt(doc, 0);
    const outcome = setNodeOnlyLevel(doc, secA.id, "indent");
    expect(outcome.changed).toBe(true);
    // Only line 0 changes; every other line, including the child
    // sections' own "#" counts and all body text, is byte-for-byte
    // identical to the input.
    expect(outcome.lines).toEqual([
      "## A",
      "body a",
      "## A-1",
      "body a-1",
      "### A-1-1",
      "body a-1-1",
      "# B",
      "body b",
    ]);
  });

  it("outdents a top-level section with no parent at all (unlike block mode, no parent-level lookup happens)", () => {
    const text = ["## A", "text"].join("\n");
    const doc = parseDocument(text);
    const secA = ownerAt(doc, 0);
    const outcome = setNodeOnlyLevel(doc, secA.id, "outdent");
    expect(outcome.lines).toEqual(["# A", "text"]);
  });
});

describe("setNodeOnlyLevel: no-op boundaries", () => {
  it("no-ops at level 1 (outdent) and level 6 (indent)", () => {
    const min = parseDocument("# A");
    const secMin = ownerAt(min, 0);
    expect(setNodeOnlyLevel(min, secMin.id, "outdent").changed).toBe(false);
    expect(setNodeOnlyLevel(min, secMin.id, "outdent").reason).toBe(
      "min-heading-level"
    );

    const max = parseDocument("###### A");
    const secMax = ownerAt(max, 0);
    expect(setNodeOnlyLevel(max, secMax.id, "indent").changed).toBe(false);
    expect(setNodeOnlyLevel(max, secMax.id, "indent").reason).toBe(
      "max-heading-level"
    );
  });

  it("no-ops on a list item", () => {
    const doc = parseDocument("- one");
    const one = ownerAt(doc, 0);
    const outcome = setNodeOnlyLevel(doc, one.id, "indent");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("not-a-heading");
  });
});

describe("setNodeOnlyLevel: full pipeline via resolveCurrentBlock (frontmatter / code fence)", () => {
  it("no-ops when the cursor is inside frontmatter", () => {
    const text = ["---", "title: x", "---", "# A", "text"].join("\n");
    const doc = parseDocument(text);
    const resolved = resolveCurrentBlock(doc, 1);
    expect(resolved.node).toBeNull();
    expect(resolved.reason).toBe("frontmatter");
  });

  it("no-ops when the cursor is inside a fenced code block", () => {
    const text = ["# A", "```", "## not a heading", "```"].join("\n");
    const doc = parseDocument(text);
    const resolved = resolveCurrentBlock(doc, 2);
    expect(resolved.node).toBeNull();
    expect(resolved.reason).toBe("code-block");
  });

  it("resolves a body line to its section and node-only-indents that section only", () => {
    const text = ["# A", "body a", "## B", "body b"].join("\n");
    const doc = parseDocument(text);
    const resolved = resolveCurrentBlock(doc, 3); // "body b" under "## B"
    expect(resolved.node?.id).toBeDefined();
    const outcome = setNodeOnlyLevel(doc, resolved.node!.id, "indent");
    expect(outcome.lines).toEqual(["# A", "body a", "### B", "body b"]);
  });
});
