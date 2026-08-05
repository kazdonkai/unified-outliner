import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { resolveCurrentBlock } from "../src/resolver/resolveCurrentBlock";
import {
  insertBlockAt,
  moveBlock,
  swapBlocks,
} from "../src/move/moveBlock";
import { FIX_BASIC, ownerAt } from "./fixtures";

describe("swapBlocks / insertBlockAt primitives", () => {
  it("swaps ranges and keeps the gap in place", () => {
    const lines = ["- a", "", "- b"];
    const r = swapBlocks(
      lines,
      { startLine: 0, endLine: 0 },
      { startLine: 2, endLine: 2 }
    );
    expect(r.lines).toEqual(["- b", "", "- a"]);
    expect(r.newStartOfA).toBe(2);
    expect(r.newStartOfB).toBe(0);
  });

  it("cuts a range and re-inserts it before a later line", () => {
    const lines = ["x", "y", "z", "w"];
    const r = insertBlockAt(lines, { startLine: 0, endLine: 1 }, 3);
    expect(r.lines).toEqual(["z", "x", "y", "w"]);
    expect(r.newStart).toBe(1);
  });

  it("cuts a range and re-inserts it before an earlier line", () => {
    const lines = ["x", "y", "z", "w"];
    const r = insertBlockAt(lines, { startLine: 2, endLine: 3 }, 0);
    expect(r.lines).toEqual(["z", "w", "x", "y"]);
    expect(r.newStart).toBe(0);
  });
});

describe("moveBlock: list subtree", () => {
  it("moves a subtree up past its sibling (whole range, not line swaps)", () => {
    const doc = parseDocument(FIX_BASIC);
    const two = ownerAt(doc, 5);
    const out = moveBlock(doc, two.id, "up");
    expect(out.changed).toBe(true);
    expect(out.lines.slice(3, 6)).toEqual(["- two", "- one", "  - one-1"]);
    expect(out.newStartLine).toBe(3);
  });

  it("moves a subtree down past its sibling, children travel along", () => {
    const doc = parseDocument(FIX_BASIC);
    const one = ownerAt(doc, 3);
    const out = moveBlock(doc, one.id, "down");
    expect(out.changed).toBe(true);
    expect(out.lines.slice(3, 6)).toEqual(["- two", "- one", "  - one-1"]);
    expect(out.newStartLine).toBe(4);
  });

  it("moves a list item up across a section boundary", () => {
    const doc = parseDocument(FIX_BASIC);
    const three = ownerAt(doc, 8);
    const out = moveBlock(doc, three.id, "up");
    expect(out.changed).toBe(true);
    expect(out.lines.slice(6, 10)).toEqual(["", "- three", "## B", "- four"]);
    expect(out.newStartLine).toBe(7);
  });

  it("moves a list item down across a section boundary", () => {
    const doc = parseDocument(FIX_BASIC);
    const four = ownerAt(doc, 9);
    const out = moveBlock(doc, four.id, "down");
    expect(out.changed).toBe(true);
    expect(out.lines.slice(9, 13)).toEqual(["", "# C", "- four", "text"]);
    expect(out.newStartLine).toBe(11);
  });

  it("is stable: down then up restores the original document", () => {
    const doc = parseDocument(FIX_BASIC);
    const one = ownerAt(doc, 3);
    const down = moveBlock(doc, one.id, "down");
    const doc2 = parseDocument(down.lines.join("\n"));
    const oneAgain = ownerAt(doc2, down.newStartLine);
    const up = moveBlock(doc2, oneAgain.id, "up");
    expect(up.lines.join("\n")).toBe(FIX_BASIC);
  });
});

describe("moveBlock: sections", () => {
  it("moves a whole section (subsections and lists travel along)", () => {
    const doc = parseDocument(FIX_BASIC);
    const secC = ownerAt(doc, 11);
    const out = moveBlock(doc, secC.id, "up");
    expect(out.changed).toBe(true);
    expect(out.lines.slice(0, 3)).toEqual(["# C", "text", "# A"]);
    expect(out.lines).toHaveLength(13);
    expect(out.newStartLine).toBe(0);
  });

  it("section without a sibling is a no-op", () => {
    const doc = parseDocument(FIX_BASIC);
    const secB = ownerAt(doc, 7);
    const out = moveBlock(doc, secB.id, "up");
    expect(out.changed).toBe(false);
    expect(out.reason).toBe("no-sibling");
    expect(out.lines).toBe(doc.lines);
  });

  it("moves a section subtree (own child section, own list, own body) past a sibling as one intact block", () => {
    // "A" owns a child section "A-1" plus a list; "B" is a plain sibling
    // section. Swapping A down past B must carry A's entire subtree —
    // heading, body, child section, and list — along together, in their
    // original relative order, and must not touch B's own content at all.
    const text = [
      "# A",
      "body a",
      "## A-1",
      "body a-1",
      "- item a-1",
      "# B",
      "body b",
    ].join("\n");
    const doc = parseDocument(text);
    const secA = ownerAt(doc, 0);
    const out = moveBlock(doc, secA.id, "down");
    expect(out.changed).toBe(true);
    expect(out.lines).toEqual([
      "# B",
      "body b",
      "# A",
      "body a",
      "## A-1",
      "body a-1",
      "- item a-1",
    ]);
  });
});

describe("moveBlock: full pipeline via resolveCurrentBlock (frontmatter / code fence)", () => {
  it("no-ops when the cursor is inside frontmatter", () => {
    const text = ["---", "title: x", "---", "# A", "# B"].join("\n");
    const doc = parseDocument(text);
    const resolved = resolveCurrentBlock(doc, 1);
    expect(resolved.node).toBeNull();
    expect(resolved.reason).toBe("frontmatter");
  });

  it("no-ops when the cursor is inside a fenced code block", () => {
    const text = ["# A", "```", "# not a heading", "```", "# B"].join("\n");
    const doc = parseDocument(text);
    const resolved = resolveCurrentBlock(doc, 2);
    expect(resolved.node).toBeNull();
    expect(resolved.reason).toBe("code-block");
  });
});

describe("moveBlock: ordered list normalization (spec §7)", () => {
  it("normalizes ordered markers to \"1.\" in the affected region", () => {
    const doc = parseDocument(["# A", "1. a", "2. b", "3. c"].join("\n"));
    const b = ownerAt(doc, 2);
    const out = moveBlock(doc, b.id, "up");
    expect(out.lines).toEqual(["# A", "1. b", "1. a", "1. c"]);
  });

  it("leaves markers untouched when normalization is disabled", () => {
    const doc = parseDocument(["# A", "1. a", "2. b"].join("\n"));
    const b = ownerAt(doc, 2);
    const out = moveBlock(doc, b.id, "up", {
      allowCrossSectionListMove: true,
      normalizeOrderedLists: false,
    });
    expect(out.lines).toEqual(["# A", "2. b", "1. a"]);
  });
});
