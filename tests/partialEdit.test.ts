import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import {
  buildOutlineTree,
  flattenOutlineTree,
  isOutlineListNode,
  isOutlineSectionNode,
  OutlineTreeNode,
  OutlineTreeSectionNode,
} from "../src/tree/buildOutlineTree";
import {
  resolveHighlightedNodeId,
  resolveHighlightedSectionId,
} from "../src/tree/resolveHighlightedSectionId";
import {
  applySectionEdit,
  applySubtreeEdit,
  extractSectionText,
  extractSubtreeText,
} from "../src/edit/partialEdit";

function idOf(doc: ReturnType<typeof parseDocument>, headingText: string): string {
  for (const n of doc.nodes.values()) {
    if (n.type === "section" && n.headingText === headingText) return n.id;
  }
  throw new Error(`no section named ${headingText}`);
}

/** Finds the id of the list item whose own first line contains `needle`. */
function listIdOf(doc: ReturnType<typeof parseDocument>, needle: string): string {
  for (const n of doc.nodes.values()) {
    if (n.type === "list" && doc.lines[n.range.startLine].includes(needle)) return n.id;
  }
  throw new Error(`no list item matching "${needle}"`);
}

/** This file only ever builds section-only trees (buildOutlineTree(doc), no options), so every node is a section — this narrows the type accordingly. */
function asSection(n: OutlineTreeNode): OutlineTreeSectionNode {
  if (!isOutlineSectionNode(n)) throw new Error("expected a section node");
  return n;
}

describe("extractSectionText", () => {
  it("extracts exactly the section subtree's own lines (heading + body + children + lists)", () => {
    const text = [
      "# A",
      "body a",
      "## A-1",
      "- item",
      "# B",
      "body b",
    ].join("\n");
    const doc = parseDocument(text);

    const outcome = extractSectionText(doc, idOf(doc, "A"));
    expect(outcome.ok).toBe(true);
    expect(outcome.text).toBe(["# A", "body a", "## A-1", "- item"].join("\n"));
    expect(outcome.startLine).toBe(0);
    expect(outcome.endLine).toBe(3);
  });

  it("extracts a leaf section as just its own lines, unaffected by siblings", () => {
    const text = ["# A", "# B", "body b", "# C"].join("\n");
    const doc = parseDocument(text);

    const outcome = extractSectionText(doc, idOf(doc, "B"));
    expect(outcome.ok).toBe(true);
    expect(outcome.text).toBe(["# B", "body b"].join("\n"));
  });

  it("fails with resolve-failed for an id that does not exist", () => {
    const doc = parseDocument(["# A"].join("\n"));
    const outcome = extractSectionText(doc, "sec-not-real");
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe("resolve-failed");
  });

  it("fails with not-a-heading for an id that resolves to a list item", () => {
    const doc = parseDocument(["# A", "- one"].join("\n"));
    const listItemId = [...doc.nodes.values()].find((n) => n.type === "list")!.id;
    const outcome = extractSectionText(doc, listItemId);
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe("not-a-heading");
  });

  it("never includes frontmatter or code-fence content, since those never become sections", () => {
    const text = ["---", "title: x", "---", "# A", "```", "code", "```"].join("\n");
    const doc = parseDocument(text);
    const outcome = extractSectionText(doc, idOf(doc, "A"));
    expect(outcome.ok).toBe(true);
    expect(outcome.text).toBe(["# A", "```", "code", "```"].join("\n"));
    expect(outcome.text).not.toContain("title: x");
  });
});

describe("applySectionEdit", () => {
  it("replaces only the target section's range, leaving everything else in the note untouched", () => {
    const text = ["# A", "body a", "# B", "old body b", "# C", "body c"].join("\n");
    const doc = parseDocument(text);
    const bId = idOf(doc, "B");
    const original = extractSectionText(doc, bId);
    expect(original.ok).toBe(true);

    const newText = ["# B", "new body b", "extra line"].join("\n");
    const outcome = applySectionEdit(doc, bId, original.text, newText);

    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "# A",
      "body a",
      "# B",
      "new body b",
      "extra line",
      "# C",
      "body c",
    ]);
    expect(outcome.newStartLine).toBe(2);
  });

  it("allows editing the heading line itself as part of the section's content", () => {
    const text = ["# A", "body a"].join("\n");
    const doc = parseDocument(text);
    const aId = idOf(doc, "A");
    const original = extractSectionText(doc, aId);

    const outcome = applySectionEdit(doc, aId, original.text, ["## A renamed", "body a"].join("\n"));
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["## A renamed", "body a"]);
  });

  it("no-ops with resolve-failed when the section id no longer exists in the note", () => {
    const doc = parseDocument(["# A", "# B"].join("\n"));
    const outcome = applySectionEdit(doc, "sec-not-real", "# whatever", "# edited");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("resolve-failed");
  });

  it("no-ops with not-a-heading when the id resolves to a list item", () => {
    const doc = parseDocument(["# A", "- one"].join("\n"));
    const listItemId = [...doc.nodes.values()].find((n) => n.type === "list")!.id;
    const outcome = applySectionEdit(doc, listItemId, "- one", "- edited");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("not-a-heading");
  });

  it("refuses to apply (conflict) when the note's section content changed since the pane loaded it", () => {
    const originalText = ["# B", "original body"].join("\n");
    // Simulate: pane opened, captured `originalText`, then the underlying
    // note was edited elsewhere (e.g. directly in the body editor) before
    // the pane's Apply was clicked — the current doc's B no longer matches
    // what the pane still thinks is "before my edits".
    const laterText = ["# A", "# B", "body was changed by someone else"].join("\n");
    const doc = parseDocument(laterText);
    const bId = idOf(doc, "B");

    const outcome = applySectionEdit(doc, bId, originalText, "# B\nmy pane's edit");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("conflict");
  });

  it("does not falsely flag a conflict when the note is genuinely unchanged", () => {
    const text = ["# A", "# B", "body b"].join("\n");
    const doc = parseDocument(text);
    const bId = idOf(doc, "B");
    const original = extractSectionText(doc, bId);

    const outcome = applySectionEdit(doc, bId, original.text, "# B\nedited body");
    expect(outcome.changed).toBe(true);
  });

  it("after a successful apply, re-parsing rebuilds the tree and the edited section resolves as highlighted at its new line", () => {
    const text = ["# A", "# B", "old"].join("\n");
    const doc = parseDocument(text);
    const bId = idOf(doc, "B");
    const original = extractSectionText(doc, bId);

    const outcome = applySectionEdit(doc, bId, original.text, ["# B", "new", "even newer"].join("\n"));
    expect(outcome.changed).toBe(true);

    const newDoc = parseDocument(outcome.lines.join("\n"));
    const newTree = buildOutlineTree(newDoc);
    expect(newTree.map((n) => asSection(n).headingText)).toEqual(["A", "B"]);

    const highlighted = resolveHighlightedSectionId(newDoc, outcome.newStartLine);
    const highlightedNode = newTree.find((n) => n.id === highlighted);
    expect(highlightedNode && asSection(highlightedNode).headingText).toBe("B");
  });
});

// Phase 4C: List Subtree Partial Edit Pane. extractSubtreeText /
// applySubtreeEdit generalize the section-only functions above to also
// accept list item ids — see edit/partialEdit.ts's class doc comment for
// how extractSectionText/applySectionEdit stay behaviorally unchanged
// (verified by every test above still passing unmodified).

describe("extractSubtreeText", () => {
  it("resolves a section id exactly like extractSectionText (kind: 'section')", () => {
    const text = ["# A", "body a", "## A-1", "- item", "# B", "body b"].join("\n");
    const doc = parseDocument(text);

    const outcome = extractSubtreeText(doc, idOf(doc, "A"));
    expect(outcome.ok).toBe(true);
    expect(outcome.kind).toBe("section");
    expect(outcome.text).toBe(["# A", "body a", "## A-1", "- item"].join("\n"));
  });

  it("resolves a list id to the item's own subtree (item + nested children, same range relocateListSubtree treats as one unit)", () => {
    const text = ["# A", "- one", "  - one-1", "  - one-2", "- two"].join("\n");
    const doc = parseDocument(text);

    const outcome = extractSubtreeText(doc, listIdOf(doc, "- one"));
    expect(outcome.ok).toBe(true);
    expect(outcome.kind).toBe("list");
    expect(outcome.text).toBe(["- one", "  - one-1", "  - one-2"].join("\n"));
  });

  it("resolves a leaf list item (no children) to just its own line", () => {
    const text = ["# A", "- one", "- two"].join("\n");
    const doc = parseDocument(text);

    const outcome = extractSubtreeText(doc, listIdOf(doc, "two"));
    expect(outcome.ok).toBe(true);
    expect(outcome.kind).toBe("list");
    expect(outcome.text).toBe("- two");
  });

  it("fails with resolve-failed for an id that does not exist", () => {
    const doc = parseDocument(["# A", "- one"].join("\n"));
    const outcome = extractSubtreeText(doc, "li-not-real");
    expect(outcome.ok).toBe(false);
    expect(outcome.kind).toBe(null);
    expect(outcome.reason).toBe("resolve-failed");
  });

  it("refuses a list item with unsafe (mixed tab/space) indentation", () => {
    const text = ["# A", "- one", "\t - bad", "- two"].join("\n");
    const doc = parseDocument(text);
    const badId = listIdOf(doc, "bad");

    const outcome = extractSubtreeText(doc, badId);
    expect(outcome.ok).toBe(false);
    expect(outcome.kind).toBe("list");
    expect(outcome.reason).toBe("unsafe-indent");
  });
});

describe("applySubtreeEdit", () => {
  it("replaces a list subtree's range, leaving everything else in the note untouched", () => {
    const text = ["# A", "- one", "  - one-1", "- two", "# B"].join("\n");
    const doc = parseDocument(text);
    const oneId = listIdOf(doc, "- one");
    const original = extractSubtreeText(doc, oneId);
    expect(original.ok).toBe(true);

    const newText = ["- one", "  - one-1 edited", "  - one-2 new"].join("\n");
    const outcome = applySubtreeEdit(doc, oneId, original.text, newText);

    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "# A",
      "- one",
      "  - one-1 edited",
      "  - one-2 new",
      "- two",
      "# B",
    ]);
    expect(outcome.newStartLine).toBe(1);
  });

  it("also works for a section id, matching applySectionEdit's own behavior (kind-generic core)", () => {
    const text = ["# A", "body a", "# B", "old body b"].join("\n");
    const doc = parseDocument(text);
    const bId = idOf(doc, "B");
    const original = extractSubtreeText(doc, bId);

    const outcome = applySubtreeEdit(doc, bId, original.text, ["# B", "new body b"].join("\n"));
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["# A", "body a", "# B", "new body b"]);
  });

  it("no-ops with resolve-failed when the list id no longer exists in the note", () => {
    const doc = parseDocument(["# A", "- one"].join("\n"));
    const outcome = applySubtreeEdit(doc, "li-not-real", "- whatever", "- edited");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("resolve-failed");
  });

  it("no-ops with unsafe-indent when the list item has mixed tab/space indentation", () => {
    const text = ["# A", "- one", "\t - bad", "- two"].join("\n");
    const doc = parseDocument(text);
    const badId = listIdOf(doc, "bad");

    const outcome = applySubtreeEdit(doc, badId, "\t - bad", "- edited");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("unsafe-indent");
  });

  it("refuses to apply (conflict) when the note's list content changed since the pane loaded it", () => {
    const originalText = "- original text";
    // Simulate: pane opened, captured `originalText`, then the underlying
    // note was edited elsewhere before the pane's Apply was clicked.
    const laterText = ["# A", "- one", "- changed by someone else"].join("\n");
    const doc = parseDocument(laterText);
    const targetId = listIdOf(doc, "changed by someone else");

    const outcome = applySubtreeEdit(doc, targetId, originalText, "- my pane's edit");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("conflict");
  });

  it("does not falsely flag a conflict when the list item is genuinely unchanged", () => {
    const text = ["# A", "- one", "- two"].join("\n");
    const doc = parseDocument(text);
    const twoId = listIdOf(doc, "two");
    const original = extractSubtreeText(doc, twoId);

    const outcome = applySubtreeEdit(doc, twoId, original.text, "- two edited");
    expect(outcome.changed).toBe(true);
  });

  it("after a successful list apply, re-parsing rebuilds the tree (list mode) and the edited item resolves as highlighted at its new line, ready for tooltip/drag & drop", () => {
    const text = ["# A", "- one", "- two", "- three"].join("\n");
    const doc = parseDocument(text);
    const twoId = listIdOf(doc, "two");
    const original = extractSubtreeText(doc, twoId);

    const outcome = applySubtreeEdit(doc, twoId, original.text, ["- two", "  - two-1 new child"].join("\n"));
    expect(outcome.changed).toBe(true);

    const newDoc = parseDocument(outcome.lines.join("\n"));
    const newTree = buildOutlineTree(newDoc, { includeLists: true });
    const flat = flattenOutlineTree(newTree);
    const listTexts = flat.filter(isOutlineListNode).map((n) => n.text);
    expect(listTexts).toEqual(["one", "two", "two-1 new child", "three"]);

    const highlighted = resolveHighlightedNodeId(newDoc, outcome.newStartLine, { includeLists: true });
    const highlightedNode = flat.find((n) => n.id === highlighted);
    expect(highlightedNode && isOutlineListNode(highlightedNode) && highlightedNode.text).toBe("two");
  });
});
