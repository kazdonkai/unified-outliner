/**
 * Phase 2B: Tree-Based Structure Editing (docs/別ペイン実装計画と当面の実装指示.md §5–6).
 *
 * Pure, Obsidian-free dispatch layer between the Outline Tree View
 * (view/OutlineTreeView.ts) and the existing block-scoped command
 * primitives (move/moveBlock.ts, move/indentBlock.ts). The tree view never
 * re-implements move/indent/outdent logic itself — it resolves a clicked
 * node's `sectionId` (from tree/buildOutlineTree.ts) and calls
 * runTreeBlockCommand, exactly the same pure functions the body-editor
 * commands (move-block-up/down, indent-block/outdent-block in main.ts)
 * already use and that are already covered by tests/moveBlock.test.ts and
 * tests/indentBlock.test.ts.
 *
 * Phase 2B is deliberately block-scoped only: the tree UI does not expose
 * node-only commands (single heading line, no subtree cascade) — those
 * remain body-editor-only, reached via the command palette / hotkeys, per
 * docs §5–6 and the Phase 2B task brief ("ツリー上から発火する操作は block 系に
 * 限定する"). fold-aware contextual defaults and drag & drop are Phase 2C+
 * and are not part of this module.
 */
import { ParsedDocument } from "../model/block";
import { moveBlock, MoveOutcome } from "../move/moveBlock";
import { indentBlock, IndentOutcome } from "../move/indentBlock";
import { TreeStructureOperation } from "./treeOperation";

/** @deprecated use TreeStructureOperation (kept as an alias for existing imports). */
export type TreeBlockOperation = TreeStructureOperation;

export interface TreeBlockCommandOptions {
  allowCrossSectionListMove: boolean;
  normalizeOrderedLists: boolean;
}

export const DEFAULT_TREE_BLOCK_COMMAND_OPTIONS: TreeBlockCommandOptions = {
  allowCrossSectionListMove: true,
  normalizeOrderedLists: true,
};

/**
 * Apply a Phase 2B tree-triggered block command to the section identified
 * by `sectionId`. `sectionId` must come from a node of the SAME
 * ParsedDocument passed in (e.g. an id captured from the current
 * OutlineTreeNode tree, resolved against a fresh parse of the same text) —
 * ids are only stable within a single parseDocument() pass (see
 * parser/parseDocument.ts's `sec-N` counter). An unresolvable id, and every
 * other constraint violation (no sibling to swap with, heading level
 * already at the 1–6 boundary, etc.), comes back as a no-op outcome
 * (`changed: false`) rather than throwing — callers should treat this the
 * same way the existing body-editor commands treat a no-op.
 */
export function runTreeBlockCommand(
  doc: ParsedDocument,
  sectionId: string,
  operation: TreeStructureOperation,
  options: TreeBlockCommandOptions = DEFAULT_TREE_BLOCK_COMMAND_OPTIONS
): MoveOutcome | IndentOutcome {
  switch (operation) {
    case "move-up":
      return moveBlock(doc, sectionId, "up", options);
    case "move-down":
      return moveBlock(doc, sectionId, "down", options);
    case "indent":
      return indentBlock(doc, sectionId, "indent", options);
    case "outdent":
      return indentBlock(doc, sectionId, "outdent", options);
  }
}
