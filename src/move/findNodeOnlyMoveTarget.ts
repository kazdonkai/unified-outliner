/**
 * Decide whether the current heading's own line can be swapped with an
 * adjacent heading line, ignoring section/subtree structure entirely
 * (node-only move — docs/別ペイン実装計画と当面の実装指示.md §5–6, extending the
 * same node-only / block axis already used for heading level changes to
 * up/down movement).
 *
 * "Adjacent" here means the previous/next heading LINE in whole-document
 * order, regardless of level or parent/child relationship — not the
 * same-level sibling that ../move/findMoveTarget.ts (block-scoped move)
 * looks for. This is deliberate: node-only move is a lightweight text swap
 * of two heading lines, decoupled from the document's structure, which is
 * exactly why it is flagged in the README as an advanced operation that can
 * temporarily put a heading's text out of sync with the body/children still
 * sitting at its old position. Block-scoped move never has this problem
 * because it moves the whole subtree together; node-only move deliberately
 * does not.
 */
import { BlockNode, isSectionNode, ParsedDocument, SectionBlockNode } from "../model/block";
import { MoveDirection } from "./findMoveTarget";

export type NoNodeOnlyMoveReason =
  | "not-a-heading"
  | "top-of-document"
  | "end-of-document";

export type NodeOnlyMoveTarget =
  | { kind: "swap-heading-line"; withLine: number }
  | { kind: "none"; reason: NoNodeOnlyMoveReason };

/** Every section in the document, ordered by their heading line. */
export function sectionsInDocumentOrder(doc: ParsedDocument): SectionBlockNode[] {
  const sections: SectionBlockNode[] = [];
  for (const n of doc.nodes.values()) {
    if (isSectionNode(n)) sections.push(n);
  }
  sections.sort((a, b) => a.range.startLine - b.range.startLine);
  return sections;
}

export function findNodeOnlyMoveTarget(
  doc: ParsedDocument,
  node: BlockNode,
  direction: MoveDirection
): NodeOnlyMoveTarget {
  if (!isSectionNode(node)) {
    return { kind: "none", reason: "not-a-heading" };
  }

  const sections = sectionsInDocumentOrder(doc);
  const index = sections.findIndex((s) => s.id === node.id);
  const other = direction === "up" ? sections[index - 1] : sections[index + 1];
  if (!other) {
    return {
      kind: "none",
      reason: direction === "up" ? "top-of-document" : "end-of-document",
    };
  }
  return { kind: "swap-heading-line", withLine: other.range.startLine };
}
