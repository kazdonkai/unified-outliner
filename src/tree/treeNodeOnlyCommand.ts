/**
 * Phase 2C companion to treeBlockCommand.ts (docs/別ペイン実装計画と当面の実装指示.md
 * §6.3): pure, Obsidian-free dispatch for the node-only command family
 * (single heading line only, no subtree cascade), reused so the fold-aware
 * contextual dispatch (treeContextualCommand.ts) never re-implements
 * move/level logic itself. Mirrors treeBlockCommand.ts's shape exactly —
 * same operation names, same (doc, sectionId, operation) call signature —
 * so callers can treat the two as interchangeable strategies.
 */
import { ParsedDocument } from "../model/block";
import { moveNodeOnly, NodeOnlyMoveOutcome } from "../move/moveNodeOnly";
import { setNodeOnlyLevel, NodeOnlyLevelOutcome } from "../level/setNodeOnlyLevel";
import { TreeStructureOperation } from "./treeOperation";

/**
 * Apply a node-only tree command to the section identified by `sectionId`
 * (same id-stability caveat as runTreeBlockCommand: only valid within the
 * ParsedDocument it was resolved from). An unresolvable id or any other
 * constraint violation (already at level 1/6, at the top/bottom of the
 * document, or the id resolving to a list item rather than a heading)
 * comes back as a no-op outcome rather than throwing.
 */
export function runTreeNodeOnlyCommand(
  doc: ParsedDocument,
  sectionId: string,
  operation: TreeStructureOperation
): NodeOnlyMoveOutcome | NodeOnlyLevelOutcome {
  switch (operation) {
    case "move-up":
      return moveNodeOnly(doc, sectionId, "up");
    case "move-down":
      return moveNodeOnly(doc, sectionId, "down");
    case "indent":
      return setNodeOnlyLevel(doc, sectionId, "indent");
    case "outdent":
      return setNodeOnlyLevel(doc, sectionId, "outdent");
  }
}
