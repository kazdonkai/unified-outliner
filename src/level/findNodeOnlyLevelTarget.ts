/**
 * Decide whether the current node's heading level can be changed as a
 * "current node only" edit — i.e. without touching child sections, body
 * text, or any following block (docs/別ペイン実装計画と当面の実装指示.md §5.1,
 * the lightweight lightweight heading-level change).
 *
 * This is deliberately much simpler than ../move/findIndentTarget.ts's
 * block-scoped heading-indent/outdent: it never inspects siblings or child
 * sections, because a node-only edit can never orphan or misalign them (it
 * changes exactly one line). Its only constraints are the ATX heading level
 * bounds (1–6) and — enforced by the caller via resolveCurrentBlock, same
 * as every other command — frontmatter / code-fence / unresolved cursor
 * positions.
 *
 * Per docs §2.1/§2.2, body-editor command semantics must never depend on
 * fold state. This function takes no fold information and must never be
 * given any — fold-aware defaults belong exclusively to the future outline
 * pane's contextual commands (§6.3 there, not here).
 */
import { BlockNode, isSectionNode } from "../model/block";
import { IndentDirection } from "./direction";

export type NoNodeOnlyLevelReason =
  | "not-a-heading"
  | "max-heading-level"
  | "min-heading-level";

export type NodeOnlyLevelTarget =
  | { kind: "node-only-indent" }
  | { kind: "node-only-outdent" }
  | { kind: "none"; reason: NoNodeOnlyLevelReason };

const MAX_HEADING_LEVEL = 6;
const MIN_HEADING_LEVEL = 1;

export function findNodeOnlyLevelTarget(
  node: BlockNode,
  direction: IndentDirection
): NodeOnlyLevelTarget {
  // List items are out of scope for this feature (see docs §5.1: it is a
  // heading-only operation). Block-scoped list indent/outdent already
  // covers list nesting via ../move/indentBlock.ts.
  if (!isSectionNode(node)) {
    return { kind: "none", reason: "not-a-heading" };
  }

  if (direction === "indent") {
    if (node.headingLevel >= MAX_HEADING_LEVEL) {
      return { kind: "none", reason: "max-heading-level" };
    }
    return { kind: "node-only-indent" };
  }

  if (node.headingLevel <= MIN_HEADING_LEVEL) {
    return { kind: "none", reason: "min-heading-level" };
  }
  return { kind: "node-only-outdent" };
}
