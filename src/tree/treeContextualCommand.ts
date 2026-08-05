/**
 * Phase 2C: Fold-Aware Contextual Operations
 * (docs/別ペイン実装計画と当面の実装指示.md §6.3).
 *
 * Pure routing layer: decides whether a tree-triggered command should run
 * as the block-scoped (subtree) version or the node-only (single heading
 * line) version, based purely on the Outline Tree View's own LOCAL
 * collapse/expand state for that node — never the body editor's CM6 fold
 * state, and never anything that would change a body-editor command's own
 * meaning (docs §2.1/§2.2 still apply there; this module is Tree-View-only
 * and is never imported by main.ts).
 *
 *   - node is collapsed in the tree -> block-scoped (subtree) command
 *   - node is expanded in the tree  -> node-only (single heading) command
 *
 * This module decides WHICH dispatch to call; it never re-implements the
 * underlying move/level logic itself — that stays fully owned by
 * treeBlockCommand.ts / treeNodeOnlyCommand.ts (and, beneath them, the
 * existing move/ and level/ modules). The explicit, always-block
 * "Move/Indent/Outdent subtree" commands (Phase 2B, treeBlockCommand.ts)
 * remain available side-by-side with this contextual layer — contextual
 * dispatch is an additional convenience, not a replacement.
 */
import { ParsedDocument } from "../model/block";
import { MoveOutcome } from "../move/moveBlock";
import { IndentOutcome } from "../move/indentBlock";
import { NodeOnlyMoveOutcome } from "../move/moveNodeOnly";
import { NodeOnlyLevelOutcome } from "../level/setNodeOnlyLevel";
import {
  DEFAULT_TREE_BLOCK_COMMAND_OPTIONS,
  runTreeBlockCommand,
  TreeBlockCommandOptions,
} from "./treeBlockCommand";
import { runTreeNodeOnlyCommand } from "./treeNodeOnlyCommand";
import { TreeStructureOperation } from "./treeOperation";

export type TreeContextualMode = "block" | "node-only";

/** Which dispatch a contextual command resolves to for a given fold state. */
export function resolveContextualMode(isCollapsed: boolean): TreeContextualMode {
  return isCollapsed ? "block" : "node-only";
}

/**
 * Run a contextual tree command. `isCollapsed` must reflect the Outline
 * Tree View's local collapse state for `sectionId` at the moment the
 * command was invoked (the view owns that state; this function only
 * consumes it). See treeBlockCommand.ts / treeNodeOnlyCommand.ts for the
 * id-stability caveat (sectionId must resolve against this same `doc`).
 */
export function runTreeContextualCommand(
  doc: ParsedDocument,
  sectionId: string,
  operation: TreeStructureOperation,
  isCollapsed: boolean,
  options: TreeBlockCommandOptions = DEFAULT_TREE_BLOCK_COMMAND_OPTIONS
): MoveOutcome | IndentOutcome | NodeOnlyMoveOutcome | NodeOnlyLevelOutcome {
  return resolveContextualMode(isCollapsed) === "block"
    ? runTreeBlockCommand(doc, sectionId, operation, options)
    : runTreeNodeOnlyCommand(doc, sectionId, operation);
}
