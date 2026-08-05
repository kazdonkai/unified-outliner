import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { buildOutlineTree, OutlineTreeNode } from "../src/tree/buildOutlineTree";
import { buildNodeIdentityMap } from "../src/tree/foldIdentity";
import {
  FoldStateData,
  getCollapsedIdentities,
  normalizeFoldStateData,
  withFileRenamed,
  withNodeCollapsed,
} from "../src/persistence/foldStateStore";

/**
 * Phase 4E acceptance tests — the 4 manual-confirmation items from the
 * approved design report, expressed as permanent regression tests instead
 * of (only) one-off manual clicking:
 *
 *   1. switching files never bleeds one file's fold state into another's
 *   2. fold state survives a save -> reload cycle (simulated restart)
 *   3. move/indent/drag-style restructuring preserves fold state for a
 *      label-unchanged node
 *   4. renaming a node's own label does not misapply its old fold state
 *
 * These exercise the exact production pure-function pipeline
 * OutlineTreeView.refresh()/setNodeCollapsed() drive at runtime
 * (buildOutlineTree -> buildNodeIdentityMap -> foldStateStore functions),
 * end to end. Deliberately does NOT import persistence/foldStateManager.ts
 * itself — that class's only additions on top of these functions are
 * Obsidian-runtime glue (debounce timing, the real loadData/saveData
 * calls), and it imports `debounce` from the "obsidian" package, which
 * (like every other file under src/view, src/main.ts) has no runtime
 * implementation outside a real Obsidian process — see every other
 * tests/*.ts file's Obsidian-free import list, which this file follows.
 */

function deriveCollapsedNodeIds(
  data: FoldStateData,
  filePath: string,
  identityMap: Map<string, string>
): Set<string> {
  const persisted = getCollapsedIdentities(data, filePath);
  const out = new Set<string>();
  for (const [nodeId, identity] of identityMap) {
    if (persisted.has(identity)) out.add(nodeId);
  }
  return out;
}

function tree(text: string, includeLists = false): OutlineTreeNode[] {
  return buildOutlineTree(parseDocument(text), { includeLists });
}

describe("Phase 4E acceptance 1: switching files does not bleed fold state across files", () => {
  it("collapsing a heading in file A never shows the coincidentally-identical heading in file B as collapsed, and switching back to A still shows it collapsed", () => {
    // Same content in both files on purpose — the harder case: node.id
    // AND the content-based identity string are identical between A and
    // B's first heading. Only the FILE PATH keying can tell them apart.
    const text = "# Shared First Heading";
    const treeA = tree(text);
    const treeB = tree(text);
    const idMapA = buildNodeIdentityMap(treeA);
    const idMapB = buildNodeIdentityMap(treeB);

    let data: FoldStateData = {};
    data = withNodeCollapsed(data, "Notes/A.md", idMapA.get(treeA[0].id)!, true);

    const collapsedInB = deriveCollapsedNodeIds(data, "Notes/B.md", idMapB);
    expect(collapsedInB.size).toBe(0);

    const collapsedInA = deriveCollapsedNodeIds(data, "Notes/A.md", idMapA);
    expect(collapsedInA.has(treeA[0].id)).toBe(true);
  });

  it("multiple files can each have independent collapsed sets simultaneously", () => {
    let data: FoldStateData = {};
    const treeA = tree("# A1\n# A2");
    const treeB = tree("# B1\n# B2");
    const idMapA = buildNodeIdentityMap(treeA);
    const idMapB = buildNodeIdentityMap(treeB);

    data = withNodeCollapsed(data, "Notes/A.md", idMapA.get(treeA[0].id)!, true);
    data = withNodeCollapsed(data, "Notes/B.md", idMapB.get(treeB[1].id)!, true);

    expect(deriveCollapsedNodeIds(data, "Notes/A.md", idMapA)).toEqual(
      new Set([treeA[0].id])
    );
    expect(deriveCollapsedNodeIds(data, "Notes/B.md", idMapB)).toEqual(
      new Set([treeB[1].id])
    );
  });
});

describe("Phase 4E acceptance 2: fold state survives a save -> reload cycle (simulated restart)", () => {
  it("a real JSON.stringify/parse round-trip (standing in for data.json being written and re-read after restart) preserves the collapsed state", () => {
    const text = ["# A", "## A1", "- item1"].join("\n");
    const before = tree(text, true);
    const idMapBefore = buildNodeIdentityMap(before);
    const a1 = before[0].children[0];

    let data: FoldStateData = {};
    data = withNodeCollapsed(data, "Notes/A.md", idMapBefore.get(a1.id)!, true);

    // "Write to disk" then "restart Obsidian, read data.json again" —
    // nothing but the JSON text itself survives between these two lines.
    const onDisk = JSON.stringify({ foldState: data });
    const reloadedRaw = JSON.parse(onDisk);
    const reloadedData = normalizeFoldStateData(reloadedRaw.foldState);

    // Fresh parse too, as a real restart would re-parse the note from
    // scratch with brand-new node.id counters.
    const after = tree(text, true);
    const idMapAfter = buildNodeIdentityMap(after);
    const collapsed = deriveCollapsedNodeIds(reloadedData, "Notes/A.md", idMapAfter);
    expect(collapsed.has(after[0].children[0].id)).toBe(true);
  });
});

describe("Phase 4E acceptance 3: fold state survives move/indent/drag-style restructuring", () => {
  it("a collapsed section keeps its collapsed state after being reordered among its siblings (relocateSection-style move)", () => {
    const before = tree(["# A", "# B", "# C"].join("\n"));
    const idMapBefore = buildNodeIdentityMap(before);
    let data: FoldStateData = {};
    data = withNodeCollapsed(
      data,
      "Notes/A.md",
      idMapBefore.get(before[1].id)!, // "B"
      true
    );

    // Simulate relocateSection moving B to the front.
    const after = tree(["# B", "# A", "# C"].join("\n"));
    const idMapAfter = buildNodeIdentityMap(after);
    const collapsedAfter = deriveCollapsedNodeIds(data, "Notes/A.md", idMapAfter);
    const bAfter = after.find((n) => n.kind === "section" && n.headingText === "B")!;
    expect(collapsedAfter.has(bAfter.id)).toBe(true);
  });

  it("a collapsed list item keeps its collapsed state after its INDENT DEPTH changes (indent/outdent-style restructuring)", () => {
    const before = tree(["- parent", "  - item", "    - child"].join("\n"), true);
    const idMapBefore = buildNodeIdentityMap(before);
    const itemBefore = before[0].children[0]; // "item", nested under "parent"
    let data: FoldStateData = {};
    data = withNodeCollapsed(data, "Notes/A.md", idMapBefore.get(itemBefore.id)!, true);

    // Simulate an outdent: "item" (and its child) promoted to top level,
    // no longer nested under "parent" — identity is label+ancestor-based,
    // not depth-based, so this must still resolve.
    const after = tree(["- parent", "- item", "  - child"].join("\n"), true);
    const idMapAfter = buildNodeIdentityMap(after);
    const itemAfter = after.find((n) => n.kind === "list" && n.text === "item")!;
    const collapsedAfter = deriveCollapsedNodeIds(data, "Notes/A.md", idMapAfter);
    expect(collapsedAfter.has(itemAfter.id)).toBe(true);
  });

  it("re-nesting a list item under a DIFFERENT sibling item, still within the same section, keeps its collapsed state (list identity is scoped to the enclosing SECTION, not the exact list-item parent chain — see tree/foldIdentity.ts)", () => {
    const before = tree(["# H", "- a", "  - item", "- b"].join("\n"), true);
    const idMapBefore = buildNodeIdentityMap(before);
    const hBefore = before[0];
    const itemBefore = hBefore.children.find((n) => n.kind === "list" && n.text === "a")!
      .children[0];
    let data: FoldStateData = {};
    data = withNodeCollapsed(data, "Notes/A.md", idMapBefore.get(itemBefore.id)!, true);

    // "item" re-nested from under "a" to under "b" — still the same
    // section, so its identity (enclosing-section-scoped) is unchanged.
    const after = tree(["# H", "- a", "- b", "  - item"].join("\n"), true);
    const idMapAfter = buildNodeIdentityMap(after);
    const hAfter = after[0];
    const itemAfter = hAfter.children.find((n) => n.kind === "list" && n.text === "b")!
      .children[0];
    const collapsedAfter = deriveCollapsedNodeIds(data, "Notes/A.md", idMapAfter);
    expect(collapsedAfter.has(itemAfter.id)).toBe(true);
  });
});

describe("Phase 4E known limitation: relocating a node to a DIFFERENT enclosing section does not carry fold state over", () => {
  it("dropping a list item inside a genuinely different section resets it to the default (expanded) — a deliberate, narrower-than-ideal trade-off (see tree/foldIdentity.ts's module doc comment): scoping list identity to the enclosing section is what makes ordinary indent/outdent WITHIN a section transparent to fold state (see the test above), and a cross-section relocation is a structurally bigger edit than a re-nest, so losing fold state there is far less surprising than losing it on every routine indent/outdent would be", () => {
    const before = tree(["# Alpha", "- x", "# Beta", "- item", "  - child"].join("\n"), true);
    const idMapBefore = buildNodeIdentityMap(before);
    const betaBefore = before.find((n) => n.kind === "section" && n.headingText === "Beta")!;
    const itemBefore = betaBefore.children[0];
    let data: FoldStateData = {};
    data = withNodeCollapsed(data, "Notes/A.md", idMapBefore.get(itemBefore.id)!, true);

    // Simulate drag & drop: "item" (+ child) relocated under "Alpha".
    const after = tree(["# Alpha", "- x", "- item", "  - child", "# Beta"].join("\n"), true);
    const idMapAfter = buildNodeIdentityMap(after);
    const alphaAfter = after.find((n) => n.kind === "section" && n.headingText === "Alpha")!;
    const itemAfter = alphaAfter.children.find((n) => n.kind === "list" && n.text === "item")!;
    const collapsedAfter = deriveCollapsedNodeIds(data, "Notes/A.md", idMapAfter);
    expect(collapsedAfter.has(itemAfter.id)).toBe(false);
  });

  it("changing a HEADING's level such that its logical parent section changes also resets it to the default (indent-block/outdent-block on a section, a comparatively rare, safety-gated operation)", () => {
    const before = tree(["# Top", "## Nested"].join("\n"));
    const idMapBefore = buildNodeIdentityMap(before);
    const nestedBefore = before[0].children[0];
    let data: FoldStateData = {};
    data = withNodeCollapsed(data, "Notes/A.md", idMapBefore.get(nestedBefore.id)!, true);

    // Outdent "Nested" from level 2 to level 1 — it's no longer a child of
    // "Top" at all, so its ancestor path (and thus identity) changes.
    const after = tree(["# Top", "# Nested"].join("\n"));
    const idMapAfter = buildNodeIdentityMap(after);
    const nestedAfter = after.find((n) => n.kind === "section" && n.headingText === "Nested")!;
    const collapsedAfter = deriveCollapsedNodeIds(data, "Notes/A.md", idMapAfter);
    expect(collapsedAfter.has(nestedAfter.id)).toBe(false);
  });
});

describe("Phase 4E acceptance 4: renaming a node's own label does not misapply its old fold state", () => {
  it("after a heading rename, the renamed node defaults to expanded (no incorrect inheritance) — the old identity remains orphaned in the store, not deleted or reassigned", () => {
    const before = tree("# Original Title");
    const idMapBefore = buildNodeIdentityMap(before);
    let data: FoldStateData = {};
    const oldIdentity = idMapBefore.get(before[0].id)!;
    data = withNodeCollapsed(data, "Notes/A.md", oldIdentity, true);

    const after = tree("# Renamed Title");
    const idMapAfter = buildNodeIdentityMap(after);
    const collapsedAfter = deriveCollapsedNodeIds(data, "Notes/A.md", idMapAfter);

    // The renamed node is NOT collapsed — falls back to the default
    // (expanded), rather than incorrectly inheriting the old title's state.
    expect(collapsedAfter.has(after[0].id)).toBe(false);
    // The old identity is still sitting in the persisted store, inert —
    // confirms this is "orphaned, harmless" rather than "silently deleted"
    // (deleting it would need to know the rename happened, which nothing
    // here does for a plain content edit, as opposed to vault's "rename"
    // event, which is a file-path rename, not a heading-text edit).
    expect(getCollapsedIdentities(data, "Notes/A.md").has(oldIdentity)).toBe(true);
  });

  it("renaming does not accidentally collapse an unrelated, differently-labeled sibling", () => {
    const before = tree(["# Original Title", "# Other Heading"].join("\n"));
    const idMapBefore = buildNodeIdentityMap(before);
    let data: FoldStateData = {};
    data = withNodeCollapsed(
      data,
      "Notes/A.md",
      idMapBefore.get(before[0].id)!,
      true
    );

    const after = tree(["# Renamed Title", "# Other Heading"].join("\n"));
    const idMapAfter = buildNodeIdentityMap(after);
    const collapsedAfter = deriveCollapsedNodeIds(data, "Notes/A.md", idMapAfter);
    const otherAfter = after.find((n) => n.kind === "section" && n.headingText === "Other Heading")!;
    expect(collapsedAfter.has(otherAfter.id)).toBe(false);
  });
});

describe("Phase 4E acceptance (bonus): vault rename event migrates fold state to the new file path", () => {
  it("withFileRenamed moves a file's collapsed set to the new path; the old path resolves empty afterward", () => {
    const t = tree("# A");
    const idMap = buildNodeIdentityMap(t);
    let data: FoldStateData = {};
    data = withNodeCollapsed(data, "Notes/Old.md", idMap.get(t[0].id)!, true);

    data = withFileRenamed(data, "Notes/Old.md", "Notes/New.md");

    expect(getCollapsedIdentities(data, "Notes/Old.md").size).toBe(0);
    expect(getCollapsedIdentities(data, "Notes/New.md").has(idMap.get(t[0].id)!)).toBe(true);
  });
});
