import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { isListNode, isSectionNode, ListBlockNode, ParsedDocument } from "../src/model/block";
import { contentColumnOf } from "../src/edit/insertBlock";
import {
  ListRenameSnapshot,
  renameListItem,
  renameSection,
  SectionRenameSnapshot,
} from "../src/edit/renameBlock";
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

function listSnapshot(doc: ParsedDocument, item: ListBlockNode): ListRenameSnapshot {
  return {
    marker: item.listMarker,
    indentColumns: item.indentColumns,
    contentColumn: contentColumnOf(doc, item),
  };
}

describe("renameSection", () => {
  it("replaces only the heading text, preserving the '#' run and its separating whitespace verbatim", () => {
    const doc = parseDocument(FIX_BASIC);
    const b = sectionIdOf(doc, "B");
    const snapshot: SectionRenameSnapshot = { headingLevel: 2 };
    const outcome = renameSection(doc, b, snapshot, "Renamed B");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines[7]).toBe("## Renamed B");
    // No other line touched.
    const untouched = doc.lines.slice();
    untouched[7] = "## Renamed B";
    expect(outcome.lines).toEqual(untouched);
    expect(outcome.newStartLine).toBe(7);
    expect(outcome.newCursorCh).toBe("## Renamed B".length);
  });

  it("does not change the heading level or the subtree's line range — only the text on its own start line", () => {
    const doc = parseDocument(FIX_BASIC);
    const a = sectionIdOf(doc, "A");
    const before = doc.nodes.get(a)!;
    const snapshot: SectionRenameSnapshot = { headingLevel: 1 };
    const outcome = renameSection(doc, a, snapshot, "Renamed A");
    expect(outcome.changed).toBe(true);
    const after = parseDocument(outcome.lines.join("\n"));
    const reResolved = sectionIdOf(after, "Renamed A");
    const afterNode = after.nodes.get(reResolved)!;
    expect(isSectionNode(afterNode) && afterNode.headingLevel).toBe(
      isSectionNode(before) && before.headingLevel
    );
    expect(afterNode.range).toEqual(before.range);
  });

  it("allows renaming to an empty string, leaving the fallback-eligible empty heading intact", () => {
    const doc = parseDocument("## Old");
    const id = sectionIdOf(doc, "Old");
    const outcome = renameSection(doc, id, { headingLevel: 2 }, "");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines[0]).toBe("## ");
  });

  it("rejects (contains-newline) rather than embedding a line break", () => {
    const doc = parseDocument(FIX_BASIC);
    const a = sectionIdOf(doc, "A");
    const outcome = renameSection(doc, a, { headingLevel: 1 }, "line1\nline2");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("contains-newline");
    expect(outcome.lines).toEqual(doc.lines);
  });

  it("rejects (resolve-failed) when the node id no longer exists, without touching any text", () => {
    const doc = parseDocument(FIX_BASIC);
    const outcome = renameSection(doc, "not-a-real-id", { headingLevel: 1 }, "X");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("resolve-failed");
    expect(outcome.lines).toEqual(doc.lines);
  });

  it("rejects (type-changed) when the id now resolves to a list item instead of a section", () => {
    const doc = parseDocument(FIX_BASIC);
    const listId = listIdOf(doc, "- one");
    const outcome = renameSection(doc, listId, { headingLevel: 1 }, "X");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("type-changed");
    expect(outcome.lines).toEqual(doc.lines);
  });

  it("rejects (heading-level-changed) when the snapshot's level no longer matches the fresh document", () => {
    const doc = parseDocument(FIX_BASIC);
    const b = sectionIdOf(doc, "B");
    // Snapshot captured a stale level (as if some other edit changed "## B"
    // to a different level between rename-begin and commit).
    const outcome = renameSection(doc, b, { headingLevel: 3 }, "X");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("heading-level-changed");
    expect(outcome.lines).toEqual(doc.lines);
  });
});

describe("renameListItem", () => {
  it("replaces only the item text, preserving indentation/marker/gap verbatim", () => {
    const text = ["- one", "  - one-1", "- two"].join("\n");
    const doc = parseDocument(text);
    const oneOne = listIdOf(doc, "one-1");
    const item = doc.nodes.get(oneOne) as ListBlockNode;
    const outcome = renameListItem(doc, oneOne, listSnapshot(doc, item), "renamed");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["- one", "  - renamed", "- two"]);
    expect(outcome.newStartLine).toBe(1);
    expect(outcome.newCursorCh).toBe("  - renamed".length);
  });

  it("allows renaming an empty list item, keeping the marker and gap but no text", () => {
    const text = ["- one", "- "].join("\n");
    const doc = parseDocument(text);
    const empty = doc.lineToOwningNodeId[1]!;
    const item = doc.nodes.get(empty) as ListBlockNode;
    const outcome = renameListItem(doc, empty, listSnapshot(doc, item), "");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines[1]).toBe("- ");
  });

  it("inserts a single separating space when the original marker had no gap at all (a bare '-')", () => {
    const text = "-";
    const doc = parseDocument(text);
    const id = doc.lineToOwningNodeId[0]!;
    const item = doc.nodes.get(id) as ListBlockNode;
    const outcome = renameListItem(doc, id, listSnapshot(doc, item), "text");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines[0]).toBe("- text");
  });

  it("does not disturb contentColumn/parent-child relationships for a nested item", () => {
    const text = ["- parent", "  - child1", "  - child2", "- sibling"].join("\n");
    const doc = parseDocument(text);
    const child2 = listIdOf(doc, "child2");
    const item = doc.nodes.get(child2) as ListBlockNode;
    const before = doc.nodes.get(child2)!;
    const outcome = renameListItem(doc, child2, listSnapshot(doc, item), "renamed-child2");
    expect(outcome.changed).toBe(true);
    const after = parseDocument(outcome.lines.join("\n"));
    const reResolvedId = listIdOf(after, "renamed-child2");
    const afterNode = after.nodes.get(reResolvedId) as ListBlockNode;
    expect(afterNode.indentColumns).toBe((before as ListBlockNode).indentColumns);
    expect(afterNode.parentId ? after.nodes.get(afterNode.parentId)?.range : null).toEqual(
      before.parentId ? doc.nodes.get(before.parentId)?.range : null
    );
    // Sibling "- sibling" line is untouched.
    expect(outcome.lines[3]).toBe("- sibling");
  });

  it("rejects (contains-newline) rather than embedding a line break", () => {
    const text = "- one";
    const doc = parseDocument(text);
    const id = doc.lineToOwningNodeId[0]!;
    const item = doc.nodes.get(id) as ListBlockNode;
    const outcome = renameListItem(doc, id, listSnapshot(doc, item), "a\nb");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("contains-newline");
    expect(outcome.lines).toEqual(doc.lines);
  });

  it("rejects (resolve-failed) when the node id no longer exists, without touching any text", () => {
    const doc = parseDocument(FIX_BASIC);
    const outcome = renameListItem(
      doc,
      "not-a-real-id",
      { marker: "-", indentColumns: 0, contentColumn: 2 },
      "X"
    );
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("resolve-failed");
    expect(outcome.lines).toEqual(doc.lines);
  });

  it("rejects (type-changed) when the id now resolves to a section instead of a list item", () => {
    const doc = parseDocument(FIX_BASIC);
    const a = sectionIdOf(doc, "A");
    const outcome = renameListItem(
      doc,
      a,
      { marker: "-", indentColumns: 0, contentColumn: 2 },
      "X"
    );
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("type-changed");
    expect(outcome.lines).toEqual(doc.lines);
  });

  it("rejects (list-syntax-changed) when the snapshot's marker no longer matches the fresh document", () => {
    const text = "- one";
    const doc = parseDocument(text);
    const id = doc.lineToOwningNodeId[0]!;
    // Snapshot captured a stale marker ("*" instead of the real "-"), as if
    // some other edit changed the marker between rename-begin and commit.
    const outcome = renameListItem(
      doc,
      id,
      { marker: "*", indentColumns: 0, contentColumn: 2 },
      "X"
    );
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("list-syntax-changed");
    expect(outcome.lines).toEqual(doc.lines);
  });

  it("rejects (list-syntax-changed) when the snapshot's indentColumns no longer matches", () => {
    const text = "- one";
    const doc = parseDocument(text);
    const id = doc.lineToOwningNodeId[0]!;
    const outcome = renameListItem(
      doc,
      id,
      { marker: "-", indentColumns: 2, contentColumn: 2 },
      "X"
    );
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("list-syntax-changed");
    expect(outcome.lines).toEqual(doc.lines);
  });

  it("rejects (list-syntax-changed) when the snapshot's contentColumn no longer matches", () => {
    const text = "-   one";
    const doc = parseDocument(text);
    const id = doc.lineToOwningNodeId[0]!;
    const outcome = renameListItem(
      doc,
      id,
      { marker: "-", indentColumns: 0, contentColumn: 2 },
      "X"
    );
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("list-syntax-changed");
    expect(outcome.lines).toEqual(doc.lines);
  });

  it("refuses to touch a mixed tab/space (unsafeIndent) item's structure beyond the safe verbatim-prefix copy", () => {
    const text = ["- a", " \t- bad"].join("\n");
    const doc = parseDocument(text);
    const bad = listIdOf(doc, "bad");
    const item = doc.nodes.get(bad) as ListBlockNode;
    expect(item.unsafeIndent).toBe(true);
    const outcome = renameListItem(doc, bad, listSnapshot(doc, item), "renamed");
    expect(outcome.changed).toBe(true);
    // Leading indentation (the unsafe mix) is preserved verbatim, exactly
    // like insertSiblingListItem's own copy-only handling of unsafeIndent.
    expect(outcome.lines[1]).toBe(" \t- renamed");
  });
});
