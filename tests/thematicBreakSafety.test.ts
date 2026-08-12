import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { isListNode, isSectionNode } from "../src/model/block";
import { scanThematicBreakBlocks } from "../src/parser/complexBlocks";

/**
 * 2026-08-12 ticket "区切り線（thematic break, ---）の安全確認": `---` is
 * ambiguous in plain Markdown — it means one of three different things
 * depending on context (thematic break / Setext H2 underline / YAML
 * frontmatter delimiter), and none of those are specially parsed by
 * parser/parseDocument.ts's own section/list model (that parser recognizes
 * ATX headings only and does not implement Setext headings — see
 * parser/complexBlocks.ts's scanThematicBreakBlocks doc comment).
 *
 * This file is a SAFETY audit, independent of whether `---` should ever be
 * SHOWN in the Outline Tree (a separate, not-yet-decided display question).
 * It only asserts that the base parser never MISCLASSIFIES a `---` line —
 * never lets it become a false heading, a false list marker, get silently
 * dropped from line ownership, get double-owned by two nodes, or corrupt an
 * adjacent list/section's own boundary — across every position named in the
 * ticket: after a blank line, after non-blank paragraph text (Setext
 * shape), at the very start of the file (frontmatter shape), immediately
 * after a list item, immediately after a heading, and immediately after a
 * frontmatter block.
 */
describe("thematic break (---) parser safety audit (2026-08-12)", () => {
  it("case 1: a blank-line-preceded '---' is ordinary un-owned-by-heading body text, never a heading", () => {
    const doc = parseDocument(["# H", "", "---", "", "after"].join("\n"));
    // No new section was created for "---" — H is still the only section.
    const sections = [...doc.nodes.values()].filter(isSectionNode);
    expect(sections).toHaveLength(1);
    expect(sections[0].headingText).toBe("H");
    // "---" (line 2) is owned by H's section range, not orphaned, not a list.
    const owner = doc.lineToOwningNodeId[2];
    expect(owner).toBe(sections[0].id);
    expect(isListNode(doc.nodes.get(owner!) as never)).toBe(false);
  });

  it("case 2 (Setext shape): a paragraph immediately followed by '---' (no blank line) creates no phantom heading", () => {
    const doc = parseDocument(["Some Title", "---", "body"].join("\n"));
    const sections = [...doc.nodes.values()].filter(isSectionNode);
    // parser/parseDocument.ts is ATX-only — "Some Title" must NOT become a
    // heading via the Setext "---" underline (that would be a mis-parse).
    expect(sections).toHaveLength(0);
    // Both lines stay ordinary, top-level (no section) content — same
    // owner (null, pre-heading), not corrupted into two different things.
    expect(doc.lineToOwningNodeId[0]).toBeNull();
    expect(doc.lineToOwningNodeId[1]).toBeNull();
  });

  it("case 2b: complex-block scanner also declines the Setext-shaped '---' (documented conservative behavior)", () => {
    const doc = parseDocument(["Some Title", "---", "body"].join("\n"));
    const result = scanThematicBreakBlocks(doc);
    expect(result.blocks).toHaveLength(0);
  });

  it("case 3: '---' as the literal first line is recognized as frontmatter start, never a thematic break", () => {
    const doc = parseDocument(["---", "key: value", "---", "# H", "body"].join("\n"));
    expect(doc.frontmatterLines.slice(0, 3)).toEqual([true, true, true]);
    expect(doc.frontmatterLines[3]).toBe(false);
    // The heading after frontmatter parses normally and does not absorb it.
    const sections = [...doc.nodes.values()].filter(isSectionNode);
    expect(sections).toHaveLength(1);
    expect(sections[0].range.startLine).toBe(3);
  });

  it("case 3b: a mid-document '---' is NEVER mistaken for frontmatter (frontmatter only triggers at line 0)", () => {
    const doc = parseDocument(["# H", "---", "body"].join("\n"));
    expect(doc.frontmatterLines.some(Boolean)).toBe(false);
  });

  it("position: '---' immediately after a list item (no indent) closes the list rather than being swallowed as its continuation", () => {
    const doc = parseDocument(["- item", "---"].join("\n"));
    const items = [...doc.nodes.values()].filter(isListNode);
    expect(items).toHaveLength(1);
    // The item's range must NOT extend onto line 1 ("---") — it should
    // close at its own line 0.
    expect(items[0].range).toEqual({ startLine: 0, endLine: 0 });
    // Line 1 is owned by the top-level document (no section here), not by
    // the list item — i.e. not silently absorbed into list-item body text.
    expect(doc.lineToOwningNodeId[1]).toBeNull();
  });

  it("position: an INDENTED '---' immediately after a list item is treated as ordinary continuation body text (not corrupted, not double-owned)", () => {
    const doc = parseDocument(["- item", "  ---", "- next item"].join("\n"));
    const items = [...doc.nodes.values()].filter(isListNode);
    expect(items).toHaveLength(2);
    const [first, second] = items.sort((a, b) => a.range.startLine - b.range.startLine);
    // The indented "---" (line 1) extends the FIRST item's range, and only
    // the first item's range — never owned by two nodes at once.
    expect(first.range).toEqual({ startLine: 0, endLine: 1 });
    expect(second.range).toEqual({ startLine: 2, endLine: 2 });
    expect(doc.lineToOwningNodeId[1]).toBe(first.id);
  });

  it("position: '---' immediately after a heading (no blank line) stays inside that section, doesn't split it", () => {
    // H2 is a DEEPER heading than H (level 2 vs 1), so it nests under H
    // rather than closing it — H's own range legitimately extends through
    // H2's range too. What this test actually guards: "---" (line 1) is
    // owned by H specifically (not dropped, not claimed by H2, which
    // hasn't started yet), and H2 itself still starts exactly at line 2 —
    // "---" never gets misread as part of the "## H2" heading line itself.
    const doc = parseDocument(["# H", "---", "## H2"].join("\n"));
    const sections = [...doc.nodes.values()].filter(isSectionNode);
    expect(sections).toHaveLength(2);
    const h = sections.find((s) => s.headingText === "H")!;
    const h2 = sections.find((s) => s.headingText === "H2")!;
    expect(doc.lineToOwningNodeId[1]).toBe(h.id);
    expect(h2.range.startLine).toBe(2);
    expect(h2.headingLevel).toBe(2);
  });

  it("position: '---' immediately after a heading, followed by a SIBLING (same-level) heading, closes the first section exactly at the '---' line", () => {
    const doc = parseDocument(["# H", "---", "# H2"].join("\n"));
    const sections = [...doc.nodes.values()].filter(isSectionNode);
    const h = sections.find((s) => s.headingText === "H")!;
    // Same-level H2 DOES close H — this is the case where "---" being
    // wrongly swallowed into H2's own heading line would be visible as a
    // corrupted range or a missing second section.
    expect(sections).toHaveLength(2);
    expect(h.range).toEqual({ startLine: 0, endLine: 1 });
    expect(doc.lineToOwningNodeId[1]).toBe(h.id);
  });

  it("position: '---' immediately after a frontmatter block (line right after the closing delimiter) is ordinary body, not re-absorbed into frontmatter", () => {
    const doc = parseDocument(["---", "key: value", "---", "---", "# H"].join("\n"));
    // Lines 0-2 are the ONE frontmatter block; line 3 (a second "---") is
    // NOT swallowed into it — frontmatter detection only scans forward
    // from line 0 once.
    expect(doc.frontmatterLines).toEqual([true, true, true, false, false]);
    const sections = [...doc.nodes.values()].filter(isSectionNode);
    expect(sections[0].range.startLine).toBe(4);
  });

  it("position: '---' inside a fenced code block is ignored by both the base parser and the thematic-break scanner", () => {
    const doc = parseDocument(["```", "---", "```"].join("\n"));
    expect(doc.codeBlockLines).toEqual([true, true, true]);
    expect(doc.lineToOwningNodeId[1]).toBeNull();
    const result = scanThematicBreakBlocks(doc);
    expect(result.blocks).toHaveLength(0);
  });

  it("'- - -' (thematic break WITH internal spaces) is claimed by the base parser as a list item, and the thematic-break scanner correctly defers to it", () => {
    // Per complexBlocks.ts's own doc comment: "- - -" is itself a valid
    // LIST_RE match (marker '-', content '- -'), and the base parser
    // already owns it — the scanner must never re-claim it.
    const doc = parseDocument(["- - -"].join("\n"));
    const items = [...doc.nodes.values()].filter(isListNode);
    expect(items).toHaveLength(1);
    const result = scanThematicBreakBlocks(doc);
    expect(result.blocks).toHaveLength(0);
  });
});
