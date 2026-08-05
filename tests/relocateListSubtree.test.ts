import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import {
  buildOutlineTree,
  flattenOutlineTree,
  isOutlineListNode,
} from "../src/tree/buildOutlineTree";
import { resolveHighlightedNodeId } from "../src/tree/resolveHighlightedSectionId";
import { canDropListOn, relocateListSubtree } from "../src/move/relocateListSubtree";

/** Finds the id of the list item whose own first line contains `needle`. */
function listIdOf(doc: ReturnType<typeof parseDocument>, needle: string): string {
  for (const n of doc.nodes.values()) {
    if (n.type === "list" && doc.lines[n.range.startLine].includes(needle)) return n.id;
  }
  throw new Error(`no list item matching "${needle}"`);
}

function sectionIdOf(doc: ReturnType<typeof parseDocument>, headingText: string): string {
  for (const n of doc.nodes.values()) {
    if (n.type === "section" && n.headingText === headingText) return n.id;
  }
  throw new Error(`no section named ${headingText}`);
}

describe("relocateListSubtree: list target", () => {
  it("before: inserts the item immediately before a sibling", () => {
    const text = ["# A", "- one", "- two", "- three"].join("\n");
    const doc = parseDocument(text);

    const outcome = relocateListSubtree(doc, listIdOf(doc, "three"), listIdOf(doc, "one"), "before");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["# A", "- three", "- one", "- two"]);
  });

  it("after: inserts the item immediately after a sibling", () => {
    const text = ["# A", "- one", "- two", "- three"].join("\n");
    const doc = parseDocument(text);

    const outcome = relocateListSubtree(doc, listIdOf(doc, "one"), listIdOf(doc, "two"), "after");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["# A", "- two", "- one", "- three"]);
  });

  it("moves a list item's nested children along with it as one intact block", () => {
    const text = ["# A", "- one", "  - one-1", "  - one-2", "- two"].join("\n");
    const doc = parseDocument(text);

    const outcome = relocateListSubtree(doc, listIdOf(doc, "- one"), listIdOf(doc, "two"), "after");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "# A",
      "- two",
      "- one",
      "  - one-1",
      "  - one-2",
    ]);
  });

  it("inside: nests as a new sibling of an existing child, matching its indent", () => {
    const text = ["# A", "- one", "  - one-1", "  - one-2", "- two"].join("\n");
    const doc = parseDocument(text);

    const outcome = relocateListSubtree(doc, listIdOf(doc, "two"), listIdOf(doc, "- one"), "inside");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "# A",
      "- one",
      "  - one-1",
      "  - one-2",
      "  - two",
    ]);
  });

  it("inside: nests under a childless item, stepping in by one TAB_WIDTH", () => {
    const text = ["# A", "- one", "- two"].join("\n");
    const doc = parseDocument(text);

    const outcome = relocateListSubtree(doc, listIdOf(doc, "two"), listIdOf(doc, "one"), "inside");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["# A", "- one", "    - two"]);
  });

  it("rejects dropping an item onto itself", () => {
    const doc = parseDocument(["# A", "- one", "- two"].join("\n"));
    const id = listIdOf(doc, "one");
    const outcome = relocateListSubtree(doc, id, id, "before");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("drop-into-self");
  });

  it("rejects dropping an item onto its own descendant", () => {
    const text = ["# A", "- one", "  - one-1"].join("\n");
    const doc = parseDocument(text);
    const outcome = relocateListSubtree(
      doc,
      listIdOf(doc, "- one"),
      listIdOf(doc, "one-1"),
      "inside"
    );
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("drop-into-descendant");
  });

  it("allows dropping an item onto its own ancestor (a legitimate 'promote out' move)", () => {
    const text = ["# A", "- one", "  - one-1"].join("\n");
    const doc = parseDocument(text);
    const outcome = relocateListSubtree(
      doc,
      listIdOf(doc, "one-1"),
      listIdOf(doc, "- one"),
      "after"
    );
    expect(outcome.changed).toBe(true);
  });

  it("canDropListOn agrees with relocateListSubtree's self/descendant rejections", () => {
    const text = ["# A", "- one", "  - one-1"].join("\n");
    const doc = parseDocument(text);
    const oneId = listIdOf(doc, "- one");
    const one1Id = listIdOf(doc, "one-1");
    expect(canDropListOn(doc, oneId, oneId)).toBe(false);
    expect(canDropListOn(doc, oneId, one1Id)).toBe(false);
    expect(canDropListOn(doc, one1Id, oneId)).toBe(true);
  });
});

describe("relocateListSubtree: section target", () => {
  it("before: lands outside the section, in whatever precedes it", () => {
    const text = ["# A", "- x", "# B", "- y"].join("\n");
    const doc = parseDocument(text);

    const outcome = relocateListSubtree(doc, listIdOf(doc, "y"), sectionIdOf(doc, "A"), "before");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["- y", "# A", "- x", "# B"]);
  });

  it("inside: appends as the section's own last root item when it has no child sections", () => {
    const text = ["# A", "- x", "# B", "- y"].join("\n");
    const doc = parseDocument(text);

    const outcome = relocateListSubtree(doc, listIdOf(doc, "y"), sectionIdOf(doc, "A"), "inside");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["# A", "- x", "- y", "# B"]);
  });

  it("inside: lands under the target itself, not its last descendant section, when the target has child sections", () => {
    const text = ["# A", "## A1", "- x", "# B", "- y"].join("\n");
    const doc = parseDocument(text);

    const outcome = relocateListSubtree(doc, listIdOf(doc, "y"), sectionIdOf(doc, "A"), "inside");
    expect(outcome.changed).toBe(true);
    // "y" must appear between "# A" and "## A1" — i.e. owned by A itself,
    // not swallowed into A1 (which move naively inserting at A's overall
    // range.endLine + 1 would have produced instead).
    expect(outcome.lines).toEqual(["# A", "- y", "## A1", "- x", "# B"]);
  });

  it("after: produces the exact same result as inside for a section target (see class doc comment on why they necessarily coincide)", () => {
    const text = ["# A", "## A1", "- x", "# B", "- y"].join("\n");
    const insideDoc = parseDocument(text);
    const afterDoc = parseDocument(text);

    const insideOutcome = relocateListSubtree(
      insideDoc,
      listIdOf(insideDoc, "y"),
      sectionIdOf(insideDoc, "A"),
      "inside"
    );
    const afterOutcome = relocateListSubtree(
      afterDoc,
      listIdOf(afterDoc, "y"),
      sectionIdOf(afterDoc, "A"),
      "after"
    );
    expect(afterOutcome.lines).toEqual(insideOutcome.lines);
  });

  it("reindents a nested item to become a root item when dropped onto a section", () => {
    const text = ["# A", "- one", "  - one-1", "# B"].join("\n");
    const doc = parseDocument(text);

    const outcome = relocateListSubtree(
      doc,
      listIdOf(doc, "one-1"),
      sectionIdOf(doc, "B"),
      "inside"
    );
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["# A", "- one", "# B", "- one-1"]);
  });
});

describe("relocateListSubtree: safety / no-ops", () => {
  it("no-ops safely when the source id does not resolve", () => {
    const doc = parseDocument(["# A", "- one"].join("\n"));
    const outcome = relocateListSubtree(doc, "li-not-real", listIdOf(doc, "one"), "before");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("resolve-failed");
  });

  it("no-ops when the source resolves to a section, not a list item", () => {
    const doc = parseDocument(["# A", "- one", "# B"].join("\n"));
    const outcome = relocateListSubtree(
      doc,
      sectionIdOf(doc, "A"),
      listIdOf(doc, "one"),
      "before"
    );
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("not-a-list-item");
  });

  it("no-ops when the target id does not resolve", () => {
    const doc = parseDocument(["# A", "- one"].join("\n"));
    const outcome = relocateListSubtree(doc, listIdOf(doc, "one"), "li-not-real", "before");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("target-resolve-failed");
  });

  it("never produces node ids for frontmatter or code-fence content, so those can never be targeted or dragged at all", () => {
    const text = [
      "---",
      "title: x",
      "---",
      "# Real Heading",
      "```",
      "- not a real list item",
      "```",
      "- real item",
    ].join("\n");
    const doc = parseDocument(text);
    // The only resolvable list item is the one outside the fence.
    const realId = listIdOf(doc, "real item");
    const outcome = relocateListSubtree(doc, realId, "li-inside-fence-does-not-exist", "before");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("target-resolve-failed");
  });

  it("rejects relocating an item with unsafe (mixed tab/space) indentation", () => {
    const text = ["# A", "- one", "\t - bad", "- two"].join("\n");
    const doc = parseDocument(text);
    const badId = listIdOf(doc, "bad");
    const outcome = relocateListSubtree(doc, badId, listIdOf(doc, "two"), "after");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("unsafe-indent");
  });

  it("rejects dropping onto a list target with unsafe (mixed tab/space) indentation", () => {
    const text = ["# A", "- one", "\t - bad", "- two"].join("\n");
    const doc = parseDocument(text);
    const badId = listIdOf(doc, "bad");
    const outcome = relocateListSubtree(doc, listIdOf(doc, "two"), badId, "after");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("unsafe-indent");
  });
});

describe("relocateListSubtree: post-relocate tree rebuild + highlight", () => {
  it("after a successful relocate, re-parsing rebuilds the tree (list mode) and the moved item resolves as highlighted at its new line", () => {
    const text = ["# A", "- one", "- two", "- three"].join("\n");
    const doc = parseDocument(text);

    const outcome = relocateListSubtree(doc, listIdOf(doc, "three"), listIdOf(doc, "one"), "before");
    expect(outcome.changed).toBe(true);

    const newDoc = parseDocument(outcome.lines.join("\n"));
    const newTree = buildOutlineTree(newDoc, { includeLists: true });
    const flat = flattenOutlineTree(newTree);
    const texts = flat.filter(isOutlineListNode).map((n) => n.text);
    expect(texts).toEqual(["three", "one", "two"]);

    const highlighted = resolveHighlightedNodeId(newDoc, outcome.newStartLine, { includeLists: true });
    const highlightedNode = flat.find((n) => n.id === highlighted);
    expect(highlightedNode && isOutlineListNode(highlightedNode) && highlightedNode.text).toBe(
      "three"
    );
  });
});
