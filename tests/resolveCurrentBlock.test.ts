import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { resolveCurrentBlock } from "../src/resolver/resolveCurrentBlock";
import { FIX_BASIC, ownerAt } from "./fixtures";

describe("resolveCurrentBlock", () => {
  const doc = parseDocument(FIX_BASIC);

  it("list line resolves to the deepest list item", () => {
    expect(resolveCurrentBlock(doc, 3).node?.id).toBe(ownerAt(doc, 3).id);
    // Nested child line resolves to the child, not the parent subtree root.
    const child = resolveCurrentBlock(doc, 4).node;
    expect(child?.type).toBe("list");
    expect(child?.range).toEqual({ startLine: 4, endLine: 4 });
  });

  it("heading line resolves to its section", () => {
    const sec = resolveCurrentBlock(doc, 7).node;
    expect(sec?.type).toBe("section");
    expect(sec?.range.startLine).toBe(7);
  });

  it("body line resolves to the owning section (spec §4)", () => {
    const sec = resolveCurrentBlock(doc, 1).node;
    expect(sec?.type).toBe("section");
    expect(sec?.range.startLine).toBe(0);
  });

  it("code block line is a no-op (spec §6)", () => {
    const d = parseDocument(["# A", "```", "code", "```"].join("\n"));
    expect(resolveCurrentBlock(d, 2)).toEqual({
      node: null,
      reason: "code-block",
    });
  });

  it("frontmatter and out-of-range are no-ops", () => {
    const d = parseDocument(["---", "t: 1", "---", "x"].join("\n"));
    expect(resolveCurrentBlock(d, 1).reason).toBe("frontmatter");
    expect(resolveCurrentBlock(d, 99).reason).toBe("out-of-range");
  });

  it("body line before any heading has no block", () => {
    const d = parseDocument(["plain text", "", "# A"].join("\n"));
    expect(resolveCurrentBlock(d, 0).reason).toBe("no-block");
  });
});
