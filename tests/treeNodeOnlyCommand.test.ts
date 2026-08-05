import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { buildOutlineTree } from "../src/tree/buildOutlineTree";
import { runTreeNodeOnlyCommand } from "../src/tree/treeNodeOnlyCommand";

describe("runTreeNodeOnlyCommand", () => {
  it("swaps just the heading line's text with the nearest PRECEDING heading line in document order (move-up), leaving body/children in place", () => {
    const text = ["# A", "body a", "## A-1", "# B", "body b"].join("\n");
    const doc = parseDocument(text);
    const tree = buildOutlineTree(doc);
    const nodeB = tree[1];

    const outcome = runTreeNodeOnlyCommand(doc, nodeB.id, "move-up");
    expect(outcome.changed).toBe(true);
    // "# B"'s nearest preceding heading line is "## A-1", not "# A" — only
    // those two line's texts trade places; "body a" and "body b" (and A's
    // own line) never move.
    expect(outcome.lines).toEqual(["# A", "body a", "# B", "## A-1", "body b"]);
    // Node-only never relocates a line — cursor stays on the same line.
    expect(outcome.newStartLine).toBe(nodeB.line);
  });

  it("swaps with the next heading line in whole-document order (move-down), ignoring level/parentage", () => {
    const text = ["# A", "## A-1", "# B"].join("\n");
    const doc = parseDocument(text);
    const tree = buildOutlineTree(doc);
    const nodeA = tree[0];

    const outcome = runTreeNodeOnlyCommand(doc, nodeA.id, "move-down");
    expect(outcome.changed).toBe(true);
    // A swaps with the very next heading line, which is "## A-1" (not "# B").
    expect(outcome.lines).toEqual(["## A-1", "# A", "# B"]);
  });

  it("changes only the current heading line's level (indent), leaving descendants untouched", () => {
    const text = ["# A", "## A-1", "### A-1-1"].join("\n");
    const doc = parseDocument(text);
    const tree = buildOutlineTree(doc);
    const nodeA1 = tree[0].children[0];

    const outcome = runTreeNodeOnlyCommand(doc, nodeA1.id, "indent");
    expect(outcome.changed).toBe(true);
    // A-1 goes from level 2 to 3; A and A-1-1 are untouched.
    expect(outcome.lines).toEqual(["# A", "### A-1", "### A-1-1"]);
    expect(outcome.newStartLine).toBe(nodeA1.line);
  });

  it("changes only the current heading line's level (outdent)", () => {
    const text = ["## A"].join("\n");
    const doc = parseDocument(text);
    const tree = buildOutlineTree(doc);

    const outcome = runTreeNodeOnlyCommand(doc, tree[0].id, "outdent");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["# A"]);
  });

  it("no-ops at the top of the document (move-up on the first heading)", () => {
    const doc = parseDocument(["# A", "# B"].join("\n"));
    const tree = buildOutlineTree(doc);

    const outcome = runTreeNodeOnlyCommand(doc, tree[0].id, "move-up");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("top-of-document");
  });

  it("no-ops at the end of the document (move-down on the last heading)", () => {
    const doc = parseDocument(["# A", "# B"].join("\n"));
    const tree = buildOutlineTree(doc);

    const outcome = runTreeNodeOnlyCommand(doc, tree[1].id, "move-down");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("end-of-document");
  });

  it("no-ops when indenting a heading already at level 6", () => {
    const doc = parseDocument("###### A");
    const tree = buildOutlineTree(doc);

    const outcome = runTreeNodeOnlyCommand(doc, tree[0].id, "indent");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("max-heading-level");
  });

  it("no-ops when outdenting a heading already at level 1", () => {
    const doc = parseDocument("# A");
    const tree = buildOutlineTree(doc);

    const outcome = runTreeNodeOnlyCommand(doc, tree[0].id, "outdent");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("min-heading-level");
  });

  it("no-ops (not-a-heading) when the id resolves to a list item rather than a section", () => {
    const doc = parseDocument(["# A", "- one"].join("\n"));
    const listItemId = [...doc.nodes.values()].find((n) => n.type === "list")!.id;

    const outcome = runTreeNodeOnlyCommand(doc, listItemId, "indent");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("not-a-heading");
  });

  it("no-ops safely for an id that does not resolve", () => {
    const doc = parseDocument(["# A", "# B"].join("\n"));
    const outcome = runTreeNodeOnlyCommand(doc, "sec-not-real", "move-up");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("resolve-failed");
  });
});
