/**
 * Decide whether the current block can be indented / outdented, and what
 * kind of edit that requires.
 *
 * Design summary
 * ---------------
 * - Heading indent/outdent is a *subtree-cascading* edit in block mode: a
 *   heading represents the whole section subtree rather than just its own
 *   line, so changing a
 *   section's level here changes that section's `#` count AND every
 *   descendant section's `#` count by the same delta, preserving every
 *   relative level difference within the subtree exactly. This can never
 *   invert or break the subtree's internal structure, because every member
 *   shifts together. List content anywhere in the subtree is left
 *   untouched — list depth and heading level are independent axes. (The
 *   node-only heading level commands in ../level/ are the single-line,
 *   non-cascading counterpart — see docs/別ペイン実装計画と当面の実装指示.md §5–6.)
 * - The only structural constraint is the ATX heading level range (1–6)
 *   across the *whole* subtree: indenting is refused if the subtree's
 *   deepest heading is already at level 6 (it would exceed 6), and
 *   outdenting is refused if this section itself is already at level 1
 *   (descendants are always deeper, so the section's own level is always
 *   the subtree's shallowest and thus the binding constraint for outdent).
 * - List indent nests the item under its previous sibling (any position,
 *   not just an edge). List outdent works for a child at *any* position
 *   among its parent's children, not only the last: when the item being
 *   outdented has trailing siblings (same parent, later in document
 *   order), those trailing siblings become the outdented item's own
 *   children — but this needs no line repositioning or explicit
 *   re-parenting bookkeeping. Every list item's `range` (computed by
 *   parser/parseDocument.ts) already spans exactly that item plus its own
 *   descendants, stopping at the next line whose indent is >= the item's
 *   own indent — i.e. stopping exactly where a following sibling begins.
 *   So shrinking only the outdented item's own range (its pre-existing
 *   subtree) by one level, and leaving every trailing sibling's lines
 *   completely untouched, is already sufficient: a trailing sibling's
 *   absolute indent column does not change, but because the outdented
 *   item's own column just decreased by one level, that same unchanged
 *   column now reads as one level *deeper than the outdented item*, so
 *   parseDocument.ts's indent-based nesting reinterprets it as the
 *   outdented item's child on the next parse — with zero line movement,
 *   trivially preserving document order for every affected block. This is
 *   why indentBlock.ts needs no change beyond the removal of the
 *   last-child restriction: the existing shrinkIndent-over-node.range call
 *   already does the right thing.
 * - This is the direct extension point for the `nested-edge` reason that
 *   findMoveTarget already returns when move-block-up/down has nowhere to
 *   go for a nested item at the edge of its parent: indent/outdent is the
 *   command a user reaches for next in that situation.
 */

import {
  BlockNode,
  isListNode,
  isSectionNode,
  ParsedDocument,
  SectionBlockNode,
} from "../model/block";

/**
 * Re-exported for backward compatibility with existing imports
 * (`./findIndentTarget`'s `IndentDirection` is used by main.ts and
 * indentBlock.ts). The canonical definition now lives in
 * ../level/direction.ts, shared with the node-only heading level commands.
 */
export type { IndentDirection } from "../level/direction";
import type { IndentDirection } from "../level/direction";

export type NoIndentReason =
  | "no-previous-sibling"
  | "already-root"
  | "max-heading-level"
  | "min-heading-level"
  | "unsafe-indent";

export type IndentTarget =
  | { kind: "list-indent"; prevSiblingId: string }
  | { kind: "list-outdent"; parentId: string }
  | { kind: "heading-indent" }
  | { kind: "heading-outdent" }
  | { kind: "none"; reason: NoIndentReason };

const MAX_HEADING_LEVEL = 6;
const MIN_HEADING_LEVEL = 1;

/** Deepest heading level among `node` and every descendant section. */
export function deepestHeadingLevel(
  doc: ParsedDocument,
  node: SectionBlockNode
): number {
  let max = node.headingLevel;
  for (const id of node.childIds) {
    const child = doc.nodes.get(id);
    if (child && isSectionNode(child)) {
      max = Math.max(max, deepestHeadingLevel(doc, child));
    }
  }
  return max;
}

export function findIndentTarget(
  doc: ParsedDocument,
  node: BlockNode,
  direction: IndentDirection
): IndentTarget {
  if (isListNode(node)) {
    if (node.unsafeIndent) return { kind: "none", reason: "unsafe-indent" };

    if (direction === "indent") {
      const prevId = node.prevSiblingId;
      const prev = prevId ? doc.nodes.get(prevId) : null;
      if (!prev || !isListNode(prev)) {
        return { kind: "none", reason: "no-previous-sibling" };
      }
      if (prev.unsafeIndent) return { kind: "none", reason: "unsafe-indent" };
      return { kind: "list-indent", prevSiblingId: prev.id };
    }

    // outdent
    if (node.depth === 0) return { kind: "none", reason: "already-root" };
    // Any position among the parent's children is allowed — see the design
    // note above for why trailing siblings need no explicit handling here.
    const parent = node.parentId ? doc.nodes.get(node.parentId) : null;
    if (!parent || !isListNode(parent)) {
      return { kind: "none", reason: "already-root" };
    }
    return { kind: "list-outdent", parentId: parent.id };
  }

  // section (heading) — see the subtree-cascading design note above.
  if (direction === "indent") {
    if (!node.prevSiblingId) {
      return { kind: "none", reason: "no-previous-sibling" };
    }
    if (deepestHeadingLevel(doc, node) >= MAX_HEADING_LEVEL) {
      return { kind: "none", reason: "max-heading-level" };
    }
    return { kind: "heading-indent" };
  }

  // outdent
  if (node.headingLevel <= MIN_HEADING_LEVEL) {
    return { kind: "none", reason: "min-heading-level" };
  }
  return { kind: "heading-outdent" };
}
