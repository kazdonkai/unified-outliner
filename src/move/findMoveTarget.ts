/**
 * Decide where a block should go when moved up / down.
 *
 *   - swap   : exchange positions with an adjacent sibling of the same kind
 *   - insert : (root list items only) cross the section boundary and be
 *              inserted right before `insertBeforeLine`
 *   - none   : no-op, with a machine-readable reason
 *
 * Design note (relative movement): this module is the *relative-move* resolver. A future
 * "move-block-to..." (destination-picker) command should live in a separate
 * destination resolver that also returns a MoveTarget, so that moveBlock can
 * apply either without changes. Keep relative-move logic and destination
 * resolution separated.
 */

import {
  BlockNode,
  isListNode,
  ParsedDocument,
} from "../model/block";
import { isBlankLine } from "../parser/parseDocument";

export type MoveDirection = "up" | "down";

export type NoMoveReason =
  | "no-sibling"
  | "nested-edge"
  | "top-of-document"
  | "end-of-document"
  | "blocked-by-paragraph"
  | "cross-section-disabled"
  | "unsafe-indent";

export type MoveTarget =
  | { kind: "swap"; withId: string }
  | { kind: "insert"; insertBeforeLine: number }
  | { kind: "none"; reason: NoMoveReason };

export interface FindMoveTargetOptions {
  allowCrossSectionListMove: boolean;
}

const DEFAULT_OPTIONS: FindMoveTargetOptions = {
  allowCrossSectionListMove: true,
};

const HEADING_RE = /^#{1,6}[ \t]+/;

export function findMoveTarget(
  doc: ParsedDocument,
  node: BlockNode,
  direction: MoveDirection,
  options: FindMoveTargetOptions = DEFAULT_OPTIONS
): MoveTarget {
  if (isListNode(node) && node.unsafeIndent) {
    return { kind: "none", reason: "unsafe-indent" };
  }

  const siblingId =
    direction === "up" ? node.prevSiblingId : node.nextSiblingId;
  if (siblingId) {
    const sibling = doc.nodes.get(siblingId);
    if (sibling) {
      if (isListNode(sibling) && sibling.unsafeIndent) {
        return { kind: "none", reason: "unsafe-indent" };
      }
      return { kind: "swap", withId: sibling.id };
    }
  }

  if (node.type === "section") {
    return { kind: "none", reason: "no-sibling" };
  }

  // List item without a sibling in the move direction.
  const parent = node.parentId ? doc.nodes.get(node.parentId) : null;
  const isRootItem = !parent || parent.type === "section";
  if (!isRootItem) {
    // Nested item at the edge of its parent: indent/outdent territory (TODO).
    return { kind: "none", reason: "nested-edge" };
  }
  if (!options.allowCrossSectionListMove) {
    return { kind: "none", reason: "cross-section-disabled" };
  }

  const n = doc.lines.length;
  if (direction === "up") {
    let k = node.range.startLine - 1;
    while (k >= 0 && isBlankLine(doc.lines[k])) k--;
    if (k < 0) return { kind: "none", reason: "top-of-document" };
    if (doc.frontmatterLines[k]) {
      return { kind: "none", reason: "top-of-document" };
    }
    if (!doc.codeBlockLines[k] && HEADING_RE.test(doc.lines[k])) {
      // Hop over the heading: the item becomes the last block of the
      // previous section (or of the parent section's own body).
      return { kind: "insert", insertBeforeLine: k };
    }
    return { kind: "none", reason: "blocked-by-paragraph" };
  } else {
    let k = node.range.endLine + 1;
    while (k < n && isBlankLine(doc.lines[k])) k++;
    if (k >= n) return { kind: "none", reason: "end-of-document" };
    if (!doc.codeBlockLines[k] && HEADING_RE.test(doc.lines[k])) {
      // Hop below the next heading: the item becomes the first block of
      // the next section.
      return { kind: "insert", insertBeforeLine: k + 1 };
    }
    return { kind: "none", reason: "blocked-by-paragraph" };
  }
}
