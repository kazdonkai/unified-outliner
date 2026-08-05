import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import {
  buildOutlineTree,
  flattenOutlineTree,
  isOutlineSectionNode,
  OutlineTreeNode,
  OutlineTreeSectionNode,
} from "../src/tree/buildOutlineTree";
import { resolveHighlightedSectionId } from "../src/tree/resolveHighlightedSectionId";
import { canDropOn, relocateSection } from "../src/move/relocateSection";

function idOf(doc: ReturnType<typeof parseDocument>, headingText: string): string {
  for (const n of doc.nodes.values()) {
    if (n.type === "section" && n.headingText === headingText) return n.id;
  }
  throw new Error(`no section named ${headingText}`);
}

/** This file only ever builds section-only trees (buildOutlineTree(doc), no options), so every node is a section — this narrows the type accordingly. */
function asSection(n: OutlineTreeNode): OutlineTreeSectionNode {
  if (!isOutlineSectionNode(n)) throw new Error("expected a section node");
  return n;
}

describe("relocateSection", () => {
  it("before: moves the subtree to immediately precede the target, preserving its own levels/body", () => {
    const text = ["# A", "body a", "# B", "body b", "# C", "body c"].join("\n");
    const doc = parseDocument(text);

    const outcome = relocateSection(doc, idOf(doc, "C"), idOf(doc, "A"), "before");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "# C",
      "body c",
      "# A",
      "body a",
      "# B",
      "body b",
    ]);
    expect(outcome.newStartLine).toBe(0);
  });

  it("after: moves the subtree to immediately follow the target's whole range", () => {
    const text = ["# A", "body a", "# B", "body b", "# C", "body c"].join("\n");
    const doc = parseDocument(text);

    const outcome = relocateSection(doc, idOf(doc, "A"), idOf(doc, "B"), "after");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "# B",
      "body b",
      "# A",
      "body a",
      "# C",
      "body c",
    ]);
  });

  it("inside: appends the subtree as the target's last child and re-levels just the moved root", () => {
    const text = ["# A", "## A-1", "text", "# B"].join("\n");
    const doc = parseDocument(text);

    const outcome = relocateSection(doc, idOf(doc, "B"), idOf(doc, "A"), "inside");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["# A", "## A-1", "text", "## B"]);
  });

  it("inside: cascades the level shift through the whole moved subtree, preserving relative levels", () => {
    const text = ["# A", "# B", "## B-1", "### B-1-1"].join("\n");
    const doc = parseDocument(text);

    const outcome = relocateSection(doc, idOf(doc, "B"), idOf(doc, "A"), "inside");
    expect(outcome.changed).toBe(true);
    // B (was level 1) becomes A's child at level 2; B-1 and B-1-1 shift by
    // the same +1 delta, keeping their relative depth under B intact.
    expect(outcome.lines).toEqual(["# A", "## B", "### B-1", "#### B-1-1"]);
  });

  it("rejects dropping a section onto itself", () => {
    const doc = parseDocument(["# A", "# B"].join("\n"));
    const aId = idOf(doc, "A");

    for (const mode of ["before", "after", "inside"] as const) {
      const outcome = relocateSection(doc, aId, aId, mode);
      expect(outcome.changed).toBe(false);
      expect(outcome.reason).toBe("drop-into-self");
    }
  });

  it("rejects dropping a section onto (or into) one of its own descendants, for every mode", () => {
    const text = ["# A", "## A-1", "### A-1-1"].join("\n");
    const doc = parseDocument(text);
    const aId = idOf(doc, "A");
    const a1Id = idOf(doc, "A-1");
    const a11Id = idOf(doc, "A-1-1");

    for (const mode of ["before", "after", "inside"] as const) {
      expect(relocateSection(doc, aId, a1Id, mode).reason).toBe("drop-into-descendant");
      expect(relocateSection(doc, aId, a11Id, mode).reason).toBe("drop-into-descendant");
    }
  });

  it("allows dropping a section relative to its own ancestor (promoting it out)", () => {
    // Not a cycle: A-1 is B's... no — A-1 is a CHILD of A here, and we
    // drop it "after" its own parent A, which should be allowed (it just
    // becomes A's sibling instead of A's child).
    const text = ["# A", "## A-1", "text", "# B"].join("\n");
    const doc = parseDocument(text);

    const outcome = relocateSection(doc, idOf(doc, "A-1"), idOf(doc, "A"), "after");
    expect(outcome.changed).toBe(true);
  });

  it("no-ops with max-heading-level when 'inside' would push the root past level 6", () => {
    const text = ["###### Deep", "# Other"].join("\n");
    const doc = parseDocument(text);

    const outcome = relocateSection(doc, idOf(doc, "Other"), idOf(doc, "Deep"), "inside");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("max-heading-level");
  });

  it("no-ops safely when the source id does not resolve", () => {
    const doc = parseDocument(["# A", "# B"].join("\n"));
    const outcome = relocateSection(doc, "sec-not-real", idOf(doc, "A"), "before");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("resolve-failed");
  });

  it("no-ops safely when the target id does not resolve", () => {
    const doc = parseDocument(["# A", "# B"].join("\n"));
    const outcome = relocateSection(doc, idOf(doc, "A"), "sec-not-real", "before");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("target-resolve-failed");
  });

  it("no-ops safely when the source id resolves to a list item, not a section", () => {
    const doc = parseDocument(["# A", "- one", "# B"].join("\n"));
    const listItemId = [...doc.nodes.values()].find((n) => n.type === "list")!.id;

    const outcome = relocateSection(doc, listItemId, idOf(doc, "B"), "before");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("not-a-heading");
  });

  it("no-ops safely when the target id resolves to a list item, not a section", () => {
    const doc = parseDocument(["# A", "- one", "# B"].join("\n"));
    const listItemId = [...doc.nodes.values()].find((n) => n.type === "list")!.id;

    const outcome = relocateSection(doc, idOf(doc, "B"), listItemId, "before");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("target-not-a-heading");
  });

  it("after a successful relocate, re-parsing rebuilds the tree and the moved section resolves as highlighted at its new line", () => {
    const text = ["# A", "body a", "# B", "body b", "# C", "body c"].join("\n");
    const doc = parseDocument(text);

    const outcome = relocateSection(doc, idOf(doc, "C"), idOf(doc, "A"), "before");
    expect(outcome.changed).toBe(true);

    const newDoc = parseDocument(outcome.lines.join("\n"));
    const newTree = buildOutlineTree(newDoc);
    expect(newTree.map((n) => asSection(n).headingText)).toEqual(["C", "A", "B"]);

    const highlighted = resolveHighlightedSectionId(newDoc, outcome.newStartLine);
    const flat = flattenOutlineTree(newTree);
    const highlightedNode = flat.find((n) => n.id === highlighted);
    expect(highlightedNode && asSection(highlightedNode).headingText).toBe("C");
  });

  it("after a successful 'inside' relocate, the rebuilt tree shows the section nested under its new parent", () => {
    const text = ["# A", "## A-1", "text", "# B"].join("\n");
    const doc = parseDocument(text);

    const outcome = relocateSection(doc, idOf(doc, "B"), idOf(doc, "A"), "inside");
    expect(outcome.changed).toBe(true);

    const newDoc = parseDocument(outcome.lines.join("\n"));
    const newTree = buildOutlineTree(newDoc);
    expect(newTree).toHaveLength(1);
    expect(asSection(newTree[0]).headingText).toBe("A");
    expect(newTree[0].children.map((n) => asSection(n).headingText)).toEqual(["A-1", "B"]);

    const highlighted = resolveHighlightedSectionId(newDoc, outcome.newStartLine);
    const flat = flattenOutlineTree(newTree);
    const highlightedNode = flat.find((n) => n.id === highlighted);
    expect(highlightedNode && asSection(highlightedNode).headingText).toBe("B");
  });
});

describe("canDropOn", () => {
  it("returns true for two unrelated sections", () => {
    const doc = parseDocument(["# A", "# B"].join("\n"));
    expect(canDropOn(doc, idOf(doc, "A"), idOf(doc, "B"))).toBe(true);
  });

  it("returns false for a section and itself", () => {
    const doc = parseDocument(["# A", "# B"].join("\n"));
    const aId = idOf(doc, "A");
    expect(canDropOn(doc, aId, aId)).toBe(false);
  });

  it("returns false when the target is a descendant of the source", () => {
    const doc = parseDocument(["# A", "## A-1"].join("\n"));
    expect(canDropOn(doc, idOf(doc, "A"), idOf(doc, "A-1"))).toBe(false);
  });

  it("returns true when the target is an ancestor of the source", () => {
    const doc = parseDocument(["# A", "## A-1"].join("\n"));
    expect(canDropOn(doc, idOf(doc, "A-1"), idOf(doc, "A"))).toBe(true);
  });

  it("returns false for ids that don't resolve to sections", () => {
    const doc = parseDocument(["# A", "- one"].join("\n"));
    const listItemId = [...doc.nodes.values()].find((n) => n.type === "list")!.id;
    expect(canDropOn(doc, listItemId, idOf(doc, "A"))).toBe(false);
    expect(canDropOn(doc, idOf(doc, "A"), "sec-not-real")).toBe(false);
  });
});
