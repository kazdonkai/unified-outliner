/**
 * Apply a node-only heading level change (docs §5.1). Pure function; only
 * the heading's own line is read or written, which is what guarantees
 * subsections, body text, and following blocks are left exactly as they
 * were — no re-parenting, no re-parsing of the rest of the subtree.
 */
import { ParsedDocument } from "../model/block";
import { IndentDirection } from "./direction";
import {
  findNodeOnlyLevelTarget,
  NoNodeOnlyLevelReason,
} from "./findNodeOnlyLevelTarget";
import { changeHeadingLevel } from "./headingLevel";

export interface NodeOnlyLevelOutcome {
  changed: boolean;
  lines: string[];
  /** Line the cursor should stay on (this command never moves lines). */
  newStartLine: number;
  reason?: NoNodeOnlyLevelReason | "resolve-failed";
}

export function setNodeOnlyLevel(
  doc: ParsedDocument,
  nodeId: string,
  direction: IndentDirection
): NodeOnlyLevelOutcome {
  const node = doc.nodes.get(nodeId);
  if (!node) {
    return {
      changed: false,
      lines: doc.lines,
      newStartLine: -1,
      reason: "resolve-failed",
    };
  }

  const target = findNodeOnlyLevelTarget(node, direction);
  if (target.kind === "none") {
    return {
      changed: false,
      lines: doc.lines,
      newStartLine: -1,
      reason: target.reason,
    };
  }

  const lines = changeHeadingLevel(doc.lines, node.range.startLine, direction);
  return { changed: true, lines, newStartLine: node.range.startLine };
}
