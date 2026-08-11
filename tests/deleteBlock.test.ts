import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { isListNode, isSectionNode, ParsedDocument } from "../src/model/block";
import { deleteBlock } from "../src/edit/deleteBlock";
import { FIX_BASIC } from "./fixtures";

function sectionIdOf(doc: ParsedDocument, headingText: string): string {
  for (const n of doc.nodes.values()) {
    if (isSectionNode(n) && n.headingText === headingText) return n.id;
  }
  throw new Error(`no section named ${headingText}`);
}

function listIdOf(doc: ParsedDocument, needle: string): string {
  for (const n of doc.nodes.values()) {
    if (isListNode(n) && doc.lines[n.range.startLine].includes(needle)) return n.id;
  }
  throw new Error(`no list item matching "${needle}"`);
}

describe("deleteBlock: section subtree", () => {
  it("removes the whole section subtree (heading + body + lists) and nothing else", () => {
    const doc = parseDocument(FIX_BASIC);
    const b = sectionIdOf(doc, "B");
    const outcome = deleteBlock(doc, b);
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "# A",
      "body a",
      "",
      "- one",
      "  - one-1",
      "- two",
      "",
      "# C",
      "text",
    ]);
  });

  it("removes nested subsections along with their parent", () => {
    const text = ["# A", "## A1", "text under A1", "### A1a", "more text", "# B", "b text"].join(
      "\n"
    );
    const doc = parseDocument(text);
    const a = sectionIdOf(doc, "A");
    const outcome = deleteBlock(doc, a);
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["# B", "b text"]);
  });

  it("no-ops (document unchanged) when the id no longer resolves", () => {
    const doc = parseDocument(FIX_BASIC);
    const outcome = deleteBlock(doc, "not-a-real-id");
    expect(outcome.changed).toBe(false);
    expect(outcome.lines).toEqual(doc.lines);
    expect(outcome.reason).toBe("resolve-failed");
  });

  it("does not auto-merge or collapse the blank line left behind", () => {
    const doc = parseDocument(FIX_BASIC);
    const b = sectionIdOf(doc, "B");
    const outcome = deleteBlock(doc, b);
    // The blank line that was between "two" (line 6) and "## B" (line 7)
    // survives untouched, immediately followed by "# C" — no extra
    // normalization collapses or removes it.
    expect(outcome.lines[6]).toBe("");
    expect(outcome.lines[7]).toBe("# C");
  });
});

describe("deleteBlock: list subtree", () => {
  it("removes a list item and all of its nested children", () => {
    const text = ["# A", "- one", "  - one-1", "    - one-1-1", "- two"].join("\n");
    const doc = parseDocument(text);
    const one = listIdOf(doc, "- one");
    const outcome = deleteBlock(doc, one);
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["# A", "- two"]);
  });

  it("leaves adjacent paragraph/callout/fenced-code/table content untouched", () => {
    const text = [
      "# A",
      "A paragraph before.",
      "> [!note] callout",
      "> callout body",
      "- one",
      "  - one-1",
      "- two",
      "```js",
      "code();",
      "```",
      "| h1 | h2 |",
      "| -- | -- |",
      "| a  | b  |",
    ].join("\n");
    const doc = parseDocument(text);
    const one = listIdOf(doc, "- one");
    const before = doc.lines.slice();
    const outcome = deleteBlock(doc, one);
    expect(outcome.changed).toBe(true);
    // Deleted: "- one" and "  - one-1" (2 lines). Everything else, in the
    // same relative order, must survive byte-for-byte.
    const untouchedBefore = before.slice(0, 4);
    const untouchedAfter = before.slice(6);
    expect(outcome.lines.slice(0, 4)).toEqual(untouchedBefore);
    expect(outcome.lines.slice(4)).toEqual(untouchedAfter);
  });
});

describe("deleteBlock: selection-restoration fallback chain", () => {
  it("prefers the previous sibling when one exists", () => {
    const text = ["- one", "- two", "- three"].join("\n");
    const doc = parseDocument(text);
    const two = listIdOf(doc, "two");
    const outcome = deleteBlock(doc, two);
    expect(outcome.changed).toBe(true);
    // "one" is unaffected by the cut (it precedes the deleted line).
    expect(outcome.newStartLine).toBe(0);
    expect(outcome.lines[outcome.newStartLine]).toBe("- one");
  });

  it("falls back to the next sibling when there is no previous sibling", () => {
    const text = ["- one", "- two"].join("\n");
    const doc = parseDocument(text);
    const one = listIdOf(doc, "one");
    const outcome = deleteBlock(doc, one);
    expect(outcome.changed).toBe(true);
    // "two" shifts up by 1 line after "one" is removed.
    expect(outcome.newStartLine).toBe(0);
    expect(outcome.lines[outcome.newStartLine]).toBe("- two");
  });

  it("falls back to the parent when there is no sibling of the same kind", () => {
    const text = ["- one", "  - one-1"].join("\n");
    const doc = parseDocument(text);
    const child = listIdOf(doc, "one-1");
    const outcome = deleteBlock(doc, child);
    expect(outcome.changed).toBe(true);
    expect(outcome.newStartLine).toBe(0);
    expect(outcome.lines[outcome.newStartLine]).toBe("- one");
  });

  it("falls back to the clamped deletion point when nothing else resolves", () => {
    const text = ["# Only section", "body"].join("\n");
    const doc = parseDocument(text);
    const only = sectionIdOf(doc, "Only section");
    const outcome = deleteBlock(doc, only);
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([]);
    // Clamped into the now-empty document.
    expect(outcome.newStartLine).toBe(0);
  });

  it("always sets newCursorCh to 0, overriding any relative offset the caller had", () => {
    const text = ["- one", "- two", "- three"].join("\n");
    const doc = parseDocument(text);
    const two = listIdOf(doc, "two");
    const outcome = deleteBlock(doc, two);
    expect(outcome.newCursorCh).toBe(0);
  });
});
