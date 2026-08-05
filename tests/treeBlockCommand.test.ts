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
import { runTreeBlockCommand } from "../src/tree/treeBlockCommand";

/** This file only ever builds section-only trees (buildOutlineTree(doc), no options), so every node is a section — this narrows the type accordingly. */
function asSection(n: OutlineTreeNode): OutlineTreeSectionNode {
  if (!isOutlineSectionNode(n)) throw new Error("expected a section node");
  return n;
}

/**
 * These tests exercise the exact path the Outline Tree View (Phase 2B) uses:
 * build a tree, grab a node's id, run a block command against that id, then
 * re-parse the resulting text and re-build the tree — mirroring what
 * view/OutlineTreeView.ts does after a click, without needing to mock any
 * Obsidian API (runTreeBlockCommand is pure).
 */
describe("runTreeBlockCommand", () => {
  it("moves a section subtree up when triggered via a tree node id (move-up)", () => {
    const text = ["# A", "body a", "# B", "body b"].join("\n");
    const doc = parseDocument(text);
    const tree = buildOutlineTree(doc);
    const nodeB = tree[1];

    const outcome = runTreeBlockCommand(doc, nodeB.id, "move-up");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines.join("\n")).toBe(
      ["# B", "body b", "# A", "body a"].join("\n")
    );
  });

  it("moves a section subtree down, taking its child sections along with it (move-down)", () => {
    const text = ["# A", "## A-1", "text", "# B"].join("\n");
    const doc = parseDocument(text);
    const tree = buildOutlineTree(doc);
    const nodeA = tree[0];

    const outcome = runTreeBlockCommand(doc, nodeA.id, "move-down");
    expect(outcome.changed).toBe(true);
    // The whole "# A" + "## A-1" + "text" subtree swaps with "# B" as one
    // block (section-subtree) — A-1 must not get left behind.
    expect(outcome.lines.join("\n")).toBe(
      ["# B", "# A", "## A-1", "text"].join("\n")
    );
  });

  it("cascades a heading indent through the whole subtree (indent)", () => {
    const text = ["# A", "# B", "## B-1", "### B-1-1"].join("\n");
    const doc = parseDocument(text);
    const tree = buildOutlineTree(doc);
    const nodeB = tree[1];

    const outcome = runTreeBlockCommand(doc, nodeB.id, "indent");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["# A", "## B", "### B-1", "#### B-1-1"]);
  });

  it("cascades a heading outdent through the whole subtree (outdent)", () => {
    const text = ["## A", "### B", "#### B-1"].join("\n");
    const doc = parseDocument(text);
    const tree = buildOutlineTree(doc);
    const nodeB = tree[0].children[0];

    const outcome = runTreeBlockCommand(doc, nodeB.id, "outdent");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["## A", "## B", "### B-1"]);
  });

  it("no-ops (does not throw or mutate) when indenting would exceed heading level 6", () => {
    // B has a previous sibling (Sib, so indent is otherwise eligible) but
    // its own subtree already bottoms out at level 6 via B-1.
    const text = ["# Root", "## Sib", "## B", "###### B-1"].join("\n");
    const doc = parseDocument(text);
    const tree = buildOutlineTree(doc);
    const nodeB = tree[0].children[1];
    expect(asSection(nodeB).headingText).toBe("B");

    const outcome = runTreeBlockCommand(doc, nodeB.id, "indent");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("max-heading-level");
    expect(outcome.lines).toEqual(doc.lines);
  });

  it("no-ops when outdenting a level-1 heading", () => {
    const text = ["# A"].join("\n");
    const doc = parseDocument(text);
    const tree = buildOutlineTree(doc);

    const outcome = runTreeBlockCommand(doc, tree[0].id, "outdent");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("min-heading-level");
  });

  it("no-ops when moving with no sibling in that direction", () => {
    const text = ["# only section", "text"].join("\n");
    const doc = parseDocument(text);
    const tree = buildOutlineTree(doc);

    const up = runTreeBlockCommand(doc, tree[0].id, "move-up");
    expect(up.changed).toBe(false);
    expect(up.reason).toBe("no-sibling");

    const down = runTreeBlockCommand(doc, tree[0].id, "move-down");
    expect(down.changed).toBe(false);
    expect(down.reason).toBe("no-sibling");
  });

  it("no-ops safely for an id that no longer resolves (e.g. stale tree vs. current doc)", () => {
    const doc = parseDocument(["# A", "# B"].join("\n"));
    const outcome = runTreeBlockCommand(doc, "sec-not-real", "move-down");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("resolve-failed");
  });

  it("never produces tree nodes for frontmatter or code-fence content, so those can never be targeted at all", () => {
    const text = [
      "---",
      "title: x",
      "---",
      "# Real Heading",
      "```",
      "# not a heading",
      "```",
    ].join("\n");
    const doc = parseDocument(text);
    const tree = buildOutlineTree(doc);
    expect(tree.map((n) => asSection(n).headingText)).toEqual(["Real Heading"]);
  });

  it("after a successful move, re-parsing the result rebuilds the tree with the new order and the moved section resolves as highlighted at its new line", () => {
    const text = ["# A", "body a", "# B", "body b"].join("\n");
    const doc = parseDocument(text);
    const tree = buildOutlineTree(doc);
    const nodeB = tree[1];

    const outcome = runTreeBlockCommand(doc, nodeB.id, "move-up");
    expect(outcome.changed).toBe(true);

    // Mirror what OutlineTreeView.runBlockCommand does after applying an
    // outcome: re-parse the new text, rebuild the tree, and re-resolve the
    // highlight from the outcome's newStartLine (where the view repositions
    // the cursor).
    const newDoc = parseDocument(outcome.lines.join("\n"));
    const newTree = buildOutlineTree(newDoc);
    expect(newTree.map((n) => asSection(n).headingText)).toEqual(["B", "A"]);

    const highlighted = resolveHighlightedSectionId(newDoc, outcome.newStartLine);
    const flat = flattenOutlineTree(newTree);
    const highlightedNode = flat.find((n) => n.id === highlighted);
    expect(highlightedNode && asSection(highlightedNode).headingText).toBe("B");
  });

  it("after an indent, the rebuilt tree reflects the new (cascaded) heading levels", () => {
    const text = ["# A", "# B", "## B-1"].join("\n");
    const doc = parseDocument(text);
    const tree = buildOutlineTree(doc);
    const nodeB = tree[1];

    const outcome = runTreeBlockCommand(doc, nodeB.id, "indent");
    expect(outcome.changed).toBe(true);

    const newDoc = parseDocument(outcome.lines.join("\n"));
    const newTree = buildOutlineTree(newDoc);
    // B is now a child of A (level 2), with B-1 cascaded to level 3.
    expect(newTree).toHaveLength(1);
    expect(asSection(newTree[0]).headingText).toBe("A");
    expect(asSection(newTree[0].children[0]).headingText).toBe("B");
    expect(asSection(newTree[0].children[0]).headingLevel).toBe(2);
    expect(asSection(newTree[0].children[0].children[0]).headingText).toBe("B-1");
    expect(asSection(newTree[0].children[0].children[0]).headingLevel).toBe(3);
  });
});
