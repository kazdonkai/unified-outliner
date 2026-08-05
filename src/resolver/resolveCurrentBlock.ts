/**
 * Resolve which block the cursor line belongs to.
 *
 *   - list line       -> the (deepest) list item at that line
 *   - heading line    -> that section
 *   - body line       -> the owning section
 *   - code block line -> no-op (reason: "code-block")
 */

import { BlockNode, ParsedDocument } from "../model/block";

export type ResolveFailureReason =
  | "out-of-range"
  | "code-block"
  | "frontmatter"
  | "no-block";

export interface ResolveResult {
  node: BlockNode | null;
  reason?: ResolveFailureReason;
}

export function resolveCurrentBlock(
  doc: ParsedDocument,
  cursorLine: number
): ResolveResult {
  if (cursorLine < 0 || cursorLine >= doc.lines.length) {
    return { node: null, reason: "out-of-range" };
  }
  if (doc.codeBlockLines[cursorLine]) {
    return { node: null, reason: "code-block" };
  }
  if (doc.frontmatterLines[cursorLine]) {
    return { node: null, reason: "frontmatter" };
  }
  const ownerId = doc.lineToOwningNodeId[cursorLine];
  if (!ownerId) {
    return { node: null, reason: "no-block" };
  }
  const node = doc.nodes.get(ownerId) ?? null;
  if (!node) {
    return { node: null, reason: "no-block" };
  }
  return { node };
}
