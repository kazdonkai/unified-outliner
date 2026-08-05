import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { resolveCurrentBlock } from "../src/resolver/resolveCurrentBlock";
import { moveNodeOnly } from "../src/move/moveNodeOnly";
import { ownerAt } from "./fixtures";

describe("moveNodeOnly: normal cases", () => {
  it("swaps two independent top-level heading lines and nothing else", () => {
    const text = ["# A", "text a", "# B", "text b"].join("\n");
    const doc = parseDocument(text);
    const secA = ownerAt(doc, 0);
    const outcome = moveNodeOnly(doc, secA.id, "down");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["# B", "text a", "# A", "text b"]);
  });

  it("does not move body or list content — only the two heading lines change, even when the next heading is a nested child", () => {
    // "A"'s immediate next heading in document order is its own nested
    // child "## A-1" (not the further-away sibling "# B") — node-only move
    // does not skip past nested headings to find a same-level sibling.
    // Only line 0 ("# A") and line 2 ("## A-1") swap; A's own body (line 1)
    // and A-1's own body/list (lines 3-4) are untouched.
    const text = [
      "# A",
      "body a",
      "## A-1",
      "body a-1",
      "- list a-1",
      "# B",
      "body b",
    ].join("\n");
    const doc = parseDocument(text);
    const secA = ownerAt(doc, 0);
    const outcome = moveNodeOnly(doc, secA.id, "down");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "## A-1",
      "body a",
      "# A",
      "body a-1",
      "- list a-1",
      "# B",
      "body b",
    ]);
  });

  it("swaps with the next heading in document order even across a level jump", () => {
    // "## B" is A's child (level 2). Moving A down swaps A's line with B's
    // line — level travels with the swapped text, by design.
    const text = ["# A", "## B", "text b"].join("\n");
    const doc = parseDocument(text);
    const secA = ownerAt(doc, 0);
    const outcome = moveNodeOnly(doc, secA.id, "down");
    expect(outcome.lines).toEqual(["## B", "# A", "text b"]);
  });

  it("keeps the cursor's line position fixed (only the text at that line changes)", () => {
    const text = ["# A", "body a", "# B"].join("\n");
    const doc = parseDocument(text);
    const secA = ownerAt(doc, 0);
    const outcome = moveNodeOnly(doc, secA.id, "down");
    expect(outcome.newStartLine).toBe(0);
  });
});

describe("moveNodeOnly: no-op boundaries", () => {
  it("no-ops moving up from the first heading", () => {
    const doc = parseDocument(["# A", "text", "# B"].join("\n"));
    const secA = ownerAt(doc, 0);
    const outcome = moveNodeOnly(doc, secA.id, "up");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("top-of-document");
    expect(outcome.lines).toBe(doc.lines);
  });

  it("no-ops moving down from the last heading", () => {
    const doc = parseDocument(["# A", "text", "# B"].join("\n"));
    const secB = ownerAt(doc, 2);
    const outcome = moveNodeOnly(doc, secB.id, "down");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("end-of-document");
  });

  it("no-ops on a list item", () => {
    const doc = parseDocument(["# A", "- one"].join("\n"));
    const one = ownerAt(doc, 1);
    const outcome = moveNodeOnly(doc, one.id, "up");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("not-a-heading");
  });
});

describe("moveNodeOnly: full pipeline via resolveCurrentBlock (frontmatter / code fence / invalid structure)", () => {
  it("no-ops when the cursor is inside frontmatter", () => {
    const text = ["---", "title: x", "---", "# A", "text"].join("\n");
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

  it("resolves a body line to its section and moves that section's heading line", () => {
    const text = ["# A", "body a", "# B", "body b"].join("\n");
    const doc = parseDocument(text);
    const resolved = resolveCurrentBlock(doc, 1); // "body a", under "# A"
    expect(resolved.node?.id).toBeDefined();
    const outcome = moveNodeOnly(doc, resolved.node!.id, "down");
    expect(outcome.lines).toEqual(["# B", "body a", "# A", "body b"]);
  });
});
