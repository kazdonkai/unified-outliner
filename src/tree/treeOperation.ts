/**
 * Shared operation-name type for every Phase 2B/2C tree dispatch layer
 * (treeBlockCommand.ts, treeNodeOnlyCommand.ts, treeContextualCommand.ts),
 * so all three agree on the same four operation names instead of each
 * defining its own union. The Outline Tree View (view/OutlineTreeView.ts)
 * is the only caller that needs to know these exist.
 */
export type TreeStructureOperation = "move-up" | "move-down" | "indent" | "outdent";
