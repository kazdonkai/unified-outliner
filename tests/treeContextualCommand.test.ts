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
import {
  resolveContextualMode,
  runTreeContextualCommand,
} from "../src/tree/treeContextualCommand";

/** This file only ever builds section-only trees (buildOutlineTree(doc), no options), so every node is a section — this narrows the type accordingly. */
function asSection(n: OutlineTreeNode): OutlineTreeSectionNode {
  if (!isOutlineSectionNode(n)) throw new Error("expected a section node");
  return n;
}

describe("resolveContextualMode", () => {
  it("resolves collapsed -> block, expanded -> node-only", () => {
    expect(resolveContextualMode(true)).toBe("block");
    expect(resolveContextualMode(false)).toBe("node-only");
  });
});

describe("runTreeContextualCommand", () => {
  it("routes a collapsed node's move-up to the block-scoped command (whole subtree swaps)", () => {
    const text = ["# A", "## A-1", "text", "# B"].join("\n");
    const doc = parseDocument(text);
    const tree = buildOutlineTree(doc);
    const nodeB = tree[1];

    const outcome = runTreeContextualCommand(doc, nodeB.id, "move-up", /* isCollapsed */ true);
    expect(outcome.changed).toBe(true);
    // Block-scoped: the whole "# A" + "## A-1" + "text" subtree moves as
    // one block past "# B" — same result as tests/treeBlockCommand.test.ts.
    expect(outcome.lines.join("\n")).toBe(["# B", "# A", "## A-1", "text"].join("\n"));
  });

  it("routes an expanded node's move-up to the node-only command (only the heading line's text swaps)", () => {
    const text = ["# A", "## A-1", "text", "# B"].join("\n");
    const doc = parseDocument(text);
    const tree = buildOutlineTree(doc);
    const nodeB = tree[1];

    const outcome = runTreeContextualCommand(doc, nodeB.id, "move-up", /* isCollapsed */ false);
    expect(outcome.changed).toBe(true);
    // Node-only: "# B" swaps text with its nearest preceding heading line
    // ("## A-1"); "text" and "# A" stay exactly where they are.
    expect(outcome.lines).toEqual(["# A", "# B", "text", "## A-1"]);
  });

  it("routes a collapsed node's indent to the cascading block-scoped command", () => {
    const text = ["# A", "# B", "## B-1"].join("\n");
    const doc = parseDocument(text);
    const tree = buildOutlineTree(doc);
    const nodeB = tree[1];

    const outcome = runTreeContextualCommand(doc, nodeB.id, "indent", true);
    expect(outcome.changed).toBe(true);
    // Cascades: B-1 shifts too (block-scoped section-subtree behavior).
    expect(outcome.lines).toEqual(["# A", "## B", "### B-1"]);
  });

  it("routes an expanded node's indent to the single-line node-only command", () => {
    const text = ["# A", "# B", "## B-1"].join("\n");
    const doc = parseDocument(text);
    const tree = buildOutlineTree(doc);
    const nodeB = tree[1];

    const outcome = runTreeContextualCommand(doc, nodeB.id, "indent", false);
    expect(outcome.changed).toBe(true);
    // Node-only: only B's own line changes; B-1 is untouched.
    expect(outcome.lines).toEqual(["# A", "## B", "## B-1"]);
  });

  it("routes a collapsed node's outdent to the cascading block-scoped command", () => {
    const text = ["## A", "### B", "#### B-1"].join("\n");
    const doc = parseDocument(text);
    const tree = buildOutlineTree(doc);
    const nodeB = tree[0].children[0];

    const outcome = runTreeContextualCommand(doc, nodeB.id, "outdent", true);
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["## A", "## B", "### B-1"]);
  });

  it("routes an expanded node's outdent to the single-line node-only command", () => {
    const text = ["## A", "### B", "#### B-1"].join("\n");
    const doc = parseDocument(text);
    const tree = buildOutlineTree(doc);
    const nodeB = tree[0].children[0];

    const outcome = runTreeContextualCommand(doc, nodeB.id, "outdent", false);
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["## A", "## B", "#### B-1"]);
  });

  it("propagates a block-scoped no-op (max-heading-level) when the node is collapsed", () => {
    const text = ["# Root", "## Sib", "## B", "###### B-1"].join("\n");
    const doc = parseDocument(text);
    const tree = buildOutlineTree(doc);
    const nodeB = tree[0].children[1];
    expect(asSection(nodeB).headingText).toBe("B");

    const outcome = runTreeContextualCommand(doc, nodeB.id, "indent", true);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("max-heading-level");
  });

  it("propagates a node-only no-op (max-heading-level) when the node is expanded, even if the block-scoped version would also no-op for a different reason", () => {
    const text = ["###### A"].join("\n");
    const doc = parseDocument(text);
    const tree = buildOutlineTree(doc);

    const outcome = runTreeContextualCommand(doc, tree[0].id, "indent", false);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("max-heading-level");
  });

  it("propagates a node-only no-op (not-a-heading) — unreachable from the tree UI, but the dispatch itself must not crash on a non-section id", () => {
    const doc = parseDocument(["# A", "- one"].join("\n"));
    const listItemId = [...doc.nodes.values()].find((n) => n.type === "list")!.id;

    const outcome = runTreeContextualCommand(doc, listItemId, "indent", false);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("not-a-heading");
  });

  it("no-ops safely for an id that does not resolve, in either mode", () => {
    const doc = parseDocument(["# A", "# B"].join("\n"));
    expect(runTreeContextualCommand(doc, "sec-not-real", "move-up", true).reason).toBe(
      "resolve-failed"
    );
    expect(runTreeContextualCommand(doc, "sec-not-real", "move-up", false).reason).toBe(
      "resolve-failed"
    );
  });

  it("after a collapsed (block-scoped) move, the rebuilt tree and highlight follow the moved section", () => {
    const text = ["# A", "body a", "# B", "body b"].join("\n");
    const doc = parseDocument(text);
    const tree = buildOutlineTree(doc);
    const nodeB = tree[1];

    const outcome = runTreeContextualCommand(doc, nodeB.id, "move-up", true);
    expect(outcome.changed).toBe(true);

    const newDoc = parseDocument(outcome.lines.join("\n"));
    const newTree = buildOutlineTree(newDoc);
    expect(newTree.map((n) => asSection(n).headingText)).toEqual(["B", "A"]);

    const highlighted = resolveHighlightedSectionId(newDoc, outcome.newStartLine);
    const flat = flattenOutlineTree(newTree);
    const highlightedNode = flat.find((n) => n.id === highlighted);
    expect(highlightedNode && asSection(highlightedNode).headingText).toBe("B");
  });

  it("after an expanded (node-only) move, the rebuilt tree shows the swapped label, and the highlight follows the cursor's fixed line", () => {
    const text = ["# A", "# B"].join("\n");
    const doc = parseDocument(text);
    const tree = buildOutlineTree(doc);
    const nodeB = tree[1];

    const outcome = runTreeContextualCommand(doc, nodeB.id, "move-up", false);
    expect(outcome.changed).toBe(true);
    // Node-only never relocates a line — the cursor lands back on B's
    // original line, which the swap now labels "A".
    expect(outcome.newStartLine).toBe(nodeB.line);

    const newDoc = parseDocument(outcome.lines.join("\n"));
    const newTree = buildOutlineTree(newDoc);
    expect(newTree.map((n) => asSection(n).headingText)).toEqual(["B", "A"]);

    const highlighted = resolveHighlightedSectionId(newDoc, outcome.newStartLine);
    const flat = flattenOutlineTree(newTree);
    // The node highlighted is whichever one now occupies that line — "A"
    // (the label that swapped into B's former position).
    const highlightedNode = flat.find((n) => n.id === highlighted);
    expect(highlightedNode && asSection(highlightedNode).headingText).toBe("A");
  });
});
