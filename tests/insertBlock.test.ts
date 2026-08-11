import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { isListNode, isSectionNode, ParsedDocument } from "../src/model/block";
import {
  contentColumnOf,
  insertChildListItem,
  insertSiblingListItem,
  insertSiblingSection,
} from "../src/edit/insertBlock";
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

describe("insertSiblingSection", () => {
  it("inserts a heading placeholder at the requested level plus a blank line, right after the target's whole subtree", () => {
    const doc = parseDocument(FIX_BASIC);
    const a = sectionIdOf(doc, "A");
    const outcome = insertSiblingSection(doc, a, 2);
    expect(outcome.changed).toBe(true);
    // "# A"'s subtree INCLUDES "## B" (a deeper heading, so it's a
    // subsection of A, not a sibling), running through line 10 (the blank
    // line right before "# C"). The new sibling section therefore lands at
    // line 11, right before "# C" — not immediately after "## B".
    expect(outcome.lines[7]).toBe("## B");
    expect(outcome.lines[11]).toBe("## ");
    expect(outcome.lines[12]).toBe("");
    expect(outcome.lines[13]).toBe("# C");
    expect(outcome.newStartLine).toBe(11);
    expect(outcome.newCursorCh).toBe(3); // right after "## "
  });

  it("clamps an out-of-range heading level defensively (never above 6 or below 1)", () => {
    const doc = parseDocument("# A\ntext");
    const a = sectionIdOf(doc, "A");
    const tooHigh = insertSiblingSection(doc, a, 9);
    expect(tooHigh.lines[2]).toBe("###### ");
    const tooLow = insertSiblingSection(doc, a, 0);
    expect(tooLow.lines[2]).toBe("# ");
  });

  it("no-ops when the target section no longer resolves", () => {
    const doc = parseDocument(FIX_BASIC);
    const outcome = insertSiblingSection(doc, "not-a-real-id", 2);
    expect(outcome.changed).toBe(false);
    expect(outcome.lines).toEqual(doc.lines);
    expect(outcome.reason).toBe("resolve-failed");
  });
});

describe("insertSiblingListItem", () => {
  it("copies the target's marker and leading whitespace verbatim, inserted right after the target's own subtree", () => {
    const text = ["- one", "  - one-1", "- two"].join("\n");
    const doc = parseDocument(text);
    const one = listIdOf(doc, "- one");
    const outcome = insertSiblingListItem(doc, one, { normalizeOrderedLists: true });
    expect(outcome.changed).toBe(true);
    // Inserted after "one"'s whole subtree (including "one-1"), not
    // immediately after "one" itself — i.e. it's a SIBLING, not swallowing
    // one's own child.
    expect(outcome.lines).toEqual(["- one", "  - one-1", "- ", "- two"]);
    expect(outcome.newStartLine).toBe(2);
    expect(outcome.newCursorCh).toBe(2);
  });

  it("renumbers the whole ordered-list region to the MVP '1.' convention when normalizeOrderedLists is on", () => {
    const text = ["1. a", "2. b"].join("\n");
    const doc = parseDocument(text);
    const a = listIdOf(doc, "a");
    const outcome = insertSiblingListItem(doc, a, { normalizeOrderedLists: true });
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["1. a", "1. ", "1. b"]);
  });

  it("leaves existing numerals untouched when normalizeOrderedLists is off, still inserting '1.' as the new item's own placeholder", () => {
    const text = ["1. a", "2. b"].join("\n");
    const doc = parseDocument(text);
    const a = listIdOf(doc, "a");
    const outcome = insertSiblingListItem(doc, a, { normalizeOrderedLists: false });
    expect(outcome.lines).toEqual(["1. a", "1. ", "2. b"]);
  });

  it("succeeds even when the target has mixed tab/space (unsafeIndent) indentation, since it's a verbatim copy", () => {
    const text = ["- a", " \t- bad"].join("\n");
    const doc = parseDocument(text);
    const bad = listIdOf(doc, "bad");
    expect((doc.nodes.get(bad) as { unsafeIndent?: boolean }).unsafeIndent).toBe(true);
    const outcome = insertSiblingListItem(doc, bad, { normalizeOrderedLists: true });
    expect(outcome.changed).toBe(true);
    expect(outcome.lines[2]).toBe(" \t- ");
  });

  it("refuses (not-a-list-item) when the target is a section", () => {
    const doc = parseDocument(FIX_BASIC);
    const a = sectionIdOf(doc, "A");
    const outcome = insertSiblingListItem(doc, a, { normalizeOrderedLists: true });
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("not-a-list-item");
  });

  it("no-ops when the target no longer resolves", () => {
    const doc = parseDocument(FIX_BASIC);
    const outcome = insertSiblingListItem(doc, "not-a-real-id", {
      normalizeOrderedLists: true,
    });
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("resolve-failed");
  });
});

describe("contentColumnOf", () => {
  it("reads the real column where content starts after a single-space gap", () => {
    const doc = parseDocument("- text");
    const item = doc.nodes.get(doc.lineToOwningNodeId[0]!);
    expect(contentColumnOf(doc, item as any)).toBe(2);
  });

  it("reads a wider real gap rather than assuming a fixed 1-space convention", () => {
    const doc = parseDocument("-   text");
    const item = doc.nodes.get(doc.lineToOwningNodeId[0]!);
    expect(contentColumnOf(doc, item as any)).toBe(4);
  });

  it("accounts for the marker's own leading indentation", () => {
    const doc = parseDocument("  - text");
    const item = doc.nodes.get(doc.lineToOwningNodeId[0]!);
    expect(contentColumnOf(doc, item as any)).toBe(4);
  });

  it("accounts for a multi-character ordered marker", () => {
    const doc = parseDocument("10. text");
    const item = doc.nodes.get(doc.lineToOwningNodeId[0]!);
    expect(contentColumnOf(doc, item as any)).toBe(4);
  });

  it("falls back to one column past the marker when the item is empty (no separating gap at all)", () => {
    const doc = parseDocument("-");
    const item = doc.nodes.get(doc.lineToOwningNodeId[0]!);
    expect(contentColumnOf(doc, item as any)).toBe(2);
  });
});

describe("insertChildListItem", () => {
  it("indents the new child to the parent's real contentColumn when the parent has no children yet", () => {
    const text = ["- parent", "- sibling"].join("\n");
    const doc = parseDocument(text);
    const parent = listIdOf(doc, "parent");
    const outcome = insertChildListItem(doc, parent, { normalizeOrderedLists: true });
    expect(outcome.changed).toBe(true);
    // "- parent"'s content starts at column 2, so the new child's marker
    // starts there too.
    expect(outcome.lines).toEqual(["- parent", "  - ", "- sibling"]);
    expect(outcome.newStartLine).toBe(1);
    expect(outcome.newCursorCh).toBe(4);
  });

  it("mirrors the LAST existing child's marker/indentation when the parent already has children", () => {
    const text = ["- parent", "  - child1", "  - child2", "- sibling"].join("\n");
    const doc = parseDocument(text);
    const parent = listIdOf(doc, "parent");
    const outcome = insertChildListItem(doc, parent, { normalizeOrderedLists: true });
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "- parent",
      "  - child1",
      "  - child2",
      "  - ",
      "- sibling",
    ]);
  });

  it("refuses (unsafe-indent) when a childless parent's own indentation mixes tabs and spaces", () => {
    const text = ["- a", " \t- bad"].join("\n");
    const doc = parseDocument(text);
    const bad = listIdOf(doc, "bad");
    const outcome = insertChildListItem(doc, bad, { normalizeOrderedLists: true });
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("unsafe-indent");
  });

  it("succeeds despite the parent's own unsafeIndent when it already has a (safely-indented) child to mirror", () => {
    const text = [" \t- bad", "\t\t- childitem"].join("\n");
    const doc = parseDocument(text);
    const bad = listIdOf(doc, " \t- bad");
    expect((doc.nodes.get(bad) as { unsafeIndent?: boolean }).unsafeIndent).toBe(true);
    const outcome = insertChildListItem(doc, bad, { normalizeOrderedLists: true });
    expect(outcome.changed).toBe(true);
    expect(outcome.lines[2]).toBe("\t\t- ");
  });

  it("refuses (not-a-list-item) when the target is a section", () => {
    const doc = parseDocument(FIX_BASIC);
    const a = sectionIdOf(doc, "A");
    const outcome = insertChildListItem(doc, a, { normalizeOrderedLists: true });
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("not-a-list-item");
  });

  it("no-ops when the target no longer resolves", () => {
    const doc = parseDocument(FIX_BASIC);
    const outcome = insertChildListItem(doc, "not-a-real-id", {
      normalizeOrderedLists: true,
    });
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("resolve-failed");
  });
});

describe("insert*: does not disturb adjacent complex-block-shaped content", () => {
  it("inserting a sibling list item near a fenced code block / table leaves them untouched", () => {
    const text = [
      "# A",
      "- one",
      "- two",
      "```js",
      "code();",
      "```",
      "| h1 | h2 |",
      "| -- | -- |",
      "| a  | b  |",
    ].join("\n");
    const doc = parseDocument(text);
    const two = listIdOf(doc, "- two");
    const outcome = insertSiblingListItem(doc, two, { normalizeOrderedLists: true });
    expect(outcome.changed).toBe(true);
    expect(outcome.lines[3]).toBe("- ");
    expect(outcome.lines.slice(4)).toEqual([
      "```js",
      "code();",
      "```",
      "| h1 | h2 |",
      "| -- | -- |",
      "| a  | b  |",
    ]);
  });
});
