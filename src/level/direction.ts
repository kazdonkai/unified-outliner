/**
 * Shared by every level/indent-changing command family (block-scoped
 * indent/outdent in ../move/findIndentTarget.ts, and the node-only heading
 * level commands in this directory). Kept in its own file so neither family
 * has to import the other just to share this one type, and so a future
 * outline-pane command (promote-node-only / demote-node-only, see
 * docs/別ペイン実装計画と当面の実装指示.md §4.1) can depend on it directly.
 */
export type IndentDirection = "indent" | "outdent";
