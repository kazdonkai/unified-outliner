import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import {
  buildOutlineTree,
  isOutlineCompositeNode,
  isOutlineComplexMemberNode,
  OutlineTreeNode,
} from "../src/tree/buildOutlineTree";
import { scanComplexBlocks } from "../src/parser/complexBlocks";
import { matchCompositeBlocks } from "../src/parser/compositeBlocks";
import { DEFAULT_COMPOSITE_BLOCK_RULES } from "../src/model/compositeBlock";
import { createTranslator } from "../src/i18n";
import { buildNodeIdentityMap } from "../src/tree/foldIdentity";
import { getCollapsedIdentities, withNodeCollapsed } from "../src/persistence/foldStateStore";
import { canCollapseOutlineNode, hasFoldableContent } from "../src/tree/hasFoldableContent";

function labelOf(node: OutlineTreeNode): string {
  if (node.kind === "section") return node.headingText;
  if (node.kind === "list") return node.text;
  return node.label;
}

function findByLabel(nodes: OutlineTreeNode[], label: string): OutlineTreeNode {
  const hit = tryFind(nodes, label);
  if (!hit) throw new Error(`no node labelled ${label}`);
  return hit;
}

function tryFind(nodes: OutlineTreeNode[], label: string): OutlineTreeNode | null {
  for (const node of nodes) {
    if (labelOf(node) === label) return node;
    const deeper = tryFind(node.children, label);
    if (deeper) return deeper;
  }
  return null;
}

/**
 * The affordance question: which rows get a fold toggle. Before this
 * predicate it was "does the row have child rows", which left a heading
 * whose body is prose, a table or a code block unfoldable from the pane
 * even though the fold itself (syncFoldToBodyEditor) works purely off the
 * document range and would have folded it happily.
 */
describe("canCollapseOutlineNode", () => {
  it("a heading with a sub-heading is collapsible, as it always was", () => {
    const doc = parseDocument("# Parent\n## Child\nbody\n");
    const tree = buildOutlineTree(doc, {});
    expect(canCollapseOutlineNode(findByLabel(tree, "Parent"), doc)).toBe(true);
  });

  it("a heading whose body is only prose is collapsible", () => {
    const doc = parseDocument("# Summary\nSome prose about the project.\n");
    const tree = buildOutlineTree(doc, {});
    expect(canCollapseOutlineNode(findByLabel(tree, "Summary"), doc)).toBe(true);
  });

  it("a heading whose body is only a fenced code block is collapsible — the case that motivated this", () => {
    const doc = parseDocument("## Technical Tasks\n```dataviewjs\ndv.table([])\n```\n");
    const tree = buildOutlineTree(doc, {});
    expect(canCollapseOutlineNode(findByLabel(tree, "Technical Tasks"), doc)).toBe(true);
  });

  it("a heading whose body is only a table is collapsible", () => {
    const doc = parseDocument("## Data\n| a | b |\n| --- | --- |\n| 1 | 2 |\n");
    const tree = buildOutlineTree(doc, {});
    expect(canCollapseOutlineNode(findByLabel(tree, "Data"), doc)).toBe(true);
  });

  it("a heading with a genuinely empty body is NOT collapsible", () => {
    const doc = parseDocument("# Empty\n# Next\n");
    const tree = buildOutlineTree(doc, {});
    expect(canCollapseOutlineNode(findByLabel(tree, "Empty"), doc)).toBe(false);
  });

  it("the last heading in a file with nothing under it is NOT collapsible", () => {
    const doc = parseDocument("# Only\n");
    const tree = buildOutlineTree(doc, {});
    expect(canCollapseOutlineNode(findByLabel(tree, "Only"), doc)).toBe(false);
  });

  it("a heading followed only by blank lines is NOT collapsible — there is nothing to hide", () => {
    const doc = parseDocument("# Blank\n\n\n# Next\nbody\n");
    const tree = buildOutlineTree(doc, {});
    expect(canCollapseOutlineNode(findByLabel(tree, "Blank"), doc)).toBe(false);
    expect(canCollapseOutlineNode(findByLabel(tree, "Next"), doc)).toBe(true);
  });

  it("a single-line list item is NOT collapsible; a multi-line one is", () => {
    const doc = parseDocument("- one liner\n- wrapped item\n  continuation line\n");
    const tree = buildOutlineTree(doc, { includeLists: true });
    expect(canCollapseOutlineNode(findByLabel(tree, "one liner"), doc)).toBe(false);
    expect(canCollapseOutlineNode(findByLabel(tree, "wrapped item"), doc)).toBe(true);
  });

  it("falls back to the children test when the document is unavailable, so nothing that folded before stops folding", () => {
    const doc = parseDocument("# Parent\n## Child\nbody\n");
    const tree = buildOutlineTree(doc, {});
    expect(canCollapseOutlineNode(findByLabel(tree, "Parent"), null)).toBe(true);
    expect(canCollapseOutlineNode(findByLabel(tree, "Child"), null)).toBe(false);
    expect(canCollapseOutlineNode(findByLabel(tree, "Parent"), undefined)).toBe(true);
  });

  it("a node id absent from the document resolves to false rather than throwing", () => {
    const doc = parseDocument("# Heading\nbody\n");
    const orphan = { ...findByLabel(buildOutlineTree(doc, {}), "Heading"), id: "no-such-node" };
    expect(canCollapseOutlineNode(orphan as OutlineTreeNode, doc)).toBe(false);
  });
});

/**
 * The document half on its own — the predicate the body fold itself asks,
 * with no knowledge of the tree. Named and shaped as upstream asked in
 * issue #3: `hasFoldableContent(document, nodeId)`.
 */
describe("hasFoldableContent", () => {
  it("is true for a heading whose body is only a fenced code block", () => {
    const doc = parseDocument("## Artefacts\n```dataviewjs\ndv.table()\n```\n");
    const tree = buildOutlineTree(doc, {});
    expect(hasFoldableContent(doc, tree[0].id)).toBe(true);
  });

  it("is false for an empty-bodied heading, a blank-only body and a trailing heading", () => {
    const doc = parseDocument("# A\nbody\n## Empty\n## Blank\n\n## Trailing");
    const tree = buildOutlineTree(doc, {});
    for (const label of ["Empty", "Blank", "Trailing"]) {
      expect(hasFoldableContent(doc, findByLabel(tree, label).id)).toBe(false);
    }
  });

  it("is false for a missing document and for an unknown node id", () => {
    const doc = parseDocument("# A\nbody\n");
    expect(hasFoldableContent(null, "anything")).toBe(false);
    expect(hasFoldableContent(undefined, "anything")).toBe(false);
    expect(hasFoldableContent(doc, "no-such-node")).toBe(false);
  });

  it("knows nothing about tree children — a parent with an empty body of its own is false", () => {
    // The affordance still says true for it (canCollapseOutlineNode's first
    // branch); this predicate answers only the document question, which is
    // the separation upstream asked for.
    const doc = parseDocument("# Parent\n## Child\nbody\n");
    const tree = buildOutlineTree(doc, {});
    expect(hasFoldableContent(doc, tree[0].id)).toBe(true); // child lines count as body
    const child = findByLabel(tree, "Child");
    expect(hasFoldableContent(doc, child.id)).toBe(true);
  });
});

/**
 * Regression areas upstream asked to see covered in issue #3: the change
 * must widen only the body-fold affordance — never tree hierarchy, never
 * what a projected CompositeBlock row permits, and never the identities
 * fold state is persisted under.
 */
describe("widening the fold affordance leaves projections and fold state alone", () => {
  const COMPOSITE_DOC =
    "# Section\n" +
    "- item\n" +
    "> [!note] Callout\n" +
    "> body\n" +
    "\n" +
    "## Code only\n" +
    "```dataviewjs\n" +
    "dv.table()\n" +
    "```\n";

  function compositeTree(text: string) {
    const doc = parseDocument(text);
    const complexScan = scanComplexBlocks(doc);
    const infos = matchCompositeBlocks(doc, complexScan, DEFAULT_COMPOSITE_BLOCK_RULES);
    const complexBlocksById = new Map(complexScan.blocks.map((b) => [b.id, b]));
    const tree = buildOutlineTree(doc, {
      includeLists: true,
      composites: { infos, complexBlocksById, rules: DEFAULT_COMPOSITE_BLOCK_RULES },
      t: createTranslator("en"),
    });
    return { doc, tree };
  }

  function flatten(nodes: OutlineTreeNode[]): OutlineTreeNode[] {
    return nodes.flatMap((n) => [n, ...flatten(n.children)]);
  }

  it("a projected composite/complex-member row has no document node, so the document half stays false", () => {
    const { doc, tree } = compositeTree(COMPOSITE_DOC);
    const projected = flatten(tree).filter(
      (n) => isOutlineCompositeNode(n) || isOutlineComplexMemberNode(n)
    );
    expect(projected.length).toBeGreaterThan(0);
    for (const node of projected) {
      expect(hasFoldableContent(doc, node.id)).toBe(false);
    }
  });

  it("a childless complex-member row is not made foldable by the widening", () => {
    const { doc, tree } = compositeTree(COMPOSITE_DOC);
    const leafMembers = flatten(tree).filter(
      (n) => isOutlineComplexMemberNode(n) && n.children.length === 0
    );
    expect(leafMembers.length).toBeGreaterThan(0);
    for (const node of leafMembers) {
      expect(canCollapseOutlineNode(node, doc)).toBe(false);
    }
  });

  it("a composite PARENT row stays foldable for the reason it always was — its children", () => {
    const { doc, tree } = compositeTree(COMPOSITE_DOC);
    const parents = flatten(tree).filter((n) => isOutlineCompositeNode(n));
    expect(parents.length).toBeGreaterThan(0);
    for (const node of parents) {
      expect(node.children.length).toBeGreaterThan(0);
      expect(canCollapseOutlineNode(node, doc)).toBe(true);
    }
  });

  it("tree hierarchy is untouched: the same tree is built whether or not anything is foldable", () => {
    const { tree } = compositeTree(COMPOSITE_DOC);
    const shape = (nodes: OutlineTreeNode[]): unknown =>
      nodes.map((n) => [n.kind, n.children.length, shape(n.children)]);
    const { tree: again } = compositeTree(COMPOSITE_DOC);
    expect(shape(tree)).toEqual(shape(again));
  });

  it("a newly foldable heading gets a stable identity, so its fold state persists like any other", () => {
    const { doc, tree } = compositeTree(COMPOSITE_DOC);
    const codeOnly = findByLabel(tree, "Code only");
    expect(canCollapseOutlineNode(codeOnly, doc)).toBe(true);

    const identities = buildNodeIdentityMap(tree);
    const identity = identities.get(codeOnly.id);
    expect(identity).toBeTruthy();

    // Round-trip through the persisted store the same way a fold does.
    const persisted = withNodeCollapsed({}, "note.md", identity!, true);
    expect(getCollapsedIdentities(persisted, "note.md").has(identity!)).toBe(true);

    // Re-parsing the same text must resolve to the SAME identity — a fold
    // that does not survive a re-parse is a fold that silently un-folds.
    const { tree: reparsed } = compositeTree(COMPOSITE_DOC);
    const reparsedIdentity = buildNodeIdentityMap(reparsed).get(
      findByLabel(reparsed, "Code only").id
    );
    expect(reparsedIdentity).toBe(identity);
  });
});
