/**
 * Apply a node-only heading move: swap the raw text of the current heading
 * line with the adjacent heading line's text, and nothing else. Pure
 * function, no Obsidian dependency.
 *
 * Both lines' own positions stay fixed — only their string contents trade
 * places — so each position's body/children/list content (which is not
 * moved) can end up under a different heading than before. This is the
 * intended lightweight behavior (see findNodeOnlyMoveTarget.ts); the
 * block-scoped move-block-up/down in ./moveBlock.ts is the operation that
 * keeps a section's heading and its content together.
 */
import { ParsedDocument } from "../model/block";
import { MoveDirection } from "./findMoveTarget";
import {
  findNodeOnlyMoveTarget,
  NoNodeOnlyMoveReason,
} from "./findNodeOnlyMoveTarget";

export interface NodeOnlyMoveOutcome {
  changed: boolean;
  lines: string[];
  /**
   * Line the cursor should stay on. Node-only move never relocates the
   * cursor's line — only that line's (and the other line's) text changes —
   * so this is always the node's original heading line.
   */
  newStartLine: number;
  reason?: NoNodeOnlyMoveReason | "resolve-failed";
}

export function moveNodeOnly(
  doc: ParsedDocument,
  nodeId: string,
  direction: MoveDirection
): NodeOnlyMoveOutcome {
  const node = doc.nodes.get(nodeId);
  if (!node) {
    return {
      changed: false,
      lines: doc.lines,
      newStartLine: -1,
      reason: "resolve-failed",
    };
  }

  const target = findNodeOnlyMoveTarget(doc, node, direction);
  if (target.kind === "none") {
    return {
      changed: false,
      lines: doc.lines,
      newStartLine: -1,
      reason: target.reason,
    };
  }

  const lines = doc.lines.slice();
  const a = node.range.startLine;
  const b = target.withLine;
  const tmp = lines[a];
  lines[a] = lines[b];
  lines[b] = tmp;

  return { changed: true, lines, newStartLine: a };
}
