/**
 * Range-based move primitives + orchestration.
 *
 * IMPORTANT: implemented as "cut the whole range and re-insert it",
 * never as repeated single-line swaps.
 */

import { LineRange, ParsedDocument } from "../model/block";
import { FindMoveTargetOptions, findMoveTarget, MoveDirection, NoMoveReason } from "./findMoveTarget";
import { normalizeOrderedMarkers } from "./renumber";

export interface MoveOutcome {
  changed: boolean;
  lines: string[];
  /** New start line of the moved block (valid when changed). */
  newStartLine: number;
  reason?: NoMoveReason | "resolve-failed";
}

/**
 * Swap two non-overlapping blocks (a must precede b). The gap between them
 * (typically blank lines) stays in place, so visual separation is preserved.
 */
export function swapBlocks(
  lines: string[],
  a: LineRange,
  b: LineRange
): { lines: string[]; newStartOfA: number; newStartOfB: number } {
  if (a.startLine > b.startLine) {
    const r = swapBlocks(lines, b, a);
    return { lines: r.lines, newStartOfA: r.newStartOfB, newStartOfB: r.newStartOfA };
  }
  const before = lines.slice(0, a.startLine);
  const blockA = lines.slice(a.startLine, a.endLine + 1);
  const gap = lines.slice(a.endLine + 1, b.startLine);
  const blockB = lines.slice(b.startLine, b.endLine + 1);
  const after = lines.slice(b.endLine + 1);
  const out = [...before, ...blockB, ...gap, ...blockA, ...after];
  return {
    lines: out,
    newStartOfB: a.startLine,
    newStartOfA: a.startLine + blockB.length + gap.length,
  };
}

/**
 * Cut `source` out of the document and re-insert it before the line that was
 * originally at `insertBeforeLine`. `insertBeforeLine` may equal lines.length
 * (insert at end of document).
 */
export function insertBlockAt(
  lines: string[],
  source: LineRange,
  insertBeforeLine: number
): { lines: string[]; newStart: number } {
  const block = lines.slice(source.startLine, source.endLine + 1);
  const rest = [
    ...lines.slice(0, source.startLine),
    ...lines.slice(source.endLine + 1),
  ];
  let idx = insertBeforeLine;
  if (idx > source.endLine) {
    idx -= block.length;
  } else if (idx > source.startLine) {
    idx = source.startLine;
  }
  idx = Math.max(0, Math.min(idx, rest.length));
  const out = [...rest.slice(0, idx), ...block, ...rest.slice(idx)];
  return { lines: out, newStart: idx };
}

export interface MoveBlockOptions extends FindMoveTargetOptions {
  normalizeOrderedLists: boolean;
}

const DEFAULT_MOVE_OPTIONS: MoveBlockOptions = {
  allowCrossSectionListMove: true,
  normalizeOrderedLists: true,
};

const LIST_LINE_RE = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]/;

/** Expand a range over directly adjacent list-marker lines (no blank gaps). */
export function expandToListRegion(
  lines: string[],
  range: LineRange
): LineRange {
  let s = range.startLine;
  while (s > 0 && LIST_LINE_RE.test(lines[s - 1])) s--;
  let e = range.endLine;
  while (e < lines.length - 1 && LIST_LINE_RE.test(lines[e + 1])) e++;
  return { startLine: s, endLine: e };
}

/**
 * High-level pure entry point: given a parsed document and a node id,
 * compute the document after moving that block up or down.
 */
export function moveBlock(
  doc: ParsedDocument,
  nodeId: string,
  direction: MoveDirection,
  options: MoveBlockOptions = DEFAULT_MOVE_OPTIONS
): MoveOutcome {
  const node = doc.nodes.get(nodeId);
  if (!node) {
    return { changed: false, lines: doc.lines, newStartLine: -1, reason: "resolve-failed" };
  }

  const target = findMoveTarget(doc, node, direction, options);
  if (target.kind === "none") {
    return { changed: false, lines: doc.lines, newStartLine: -1, reason: target.reason };
  }

  let outLines: string[];
  let newStartLine: number;
  let affected: LineRange[];

  if (target.kind === "swap") {
    const other = doc.nodes.get(target.withId);
    if (!other) {
      return { changed: false, lines: doc.lines, newStartLine: -1, reason: "resolve-failed" };
    }
    const r = swapBlocks(doc.lines, node.range, other.range);
    outLines = r.lines;
    newStartLine = r.newStartOfA;
    const top = Math.min(node.range.startLine, other.range.startLine);
    const bottom = Math.max(node.range.endLine, other.range.endLine);
    affected = [{ startLine: top, endLine: bottom }];
  } else {
    const r = insertBlockAt(doc.lines, node.range, target.insertBeforeLine);
    outLines = r.lines;
    newStartLine = r.newStart;
    const blockLen = node.range.endLine - node.range.startLine + 1;
    const top = Math.min(node.range.startLine, r.newStart);
    const bottom = Math.max(node.range.endLine, r.newStart + blockLen - 1);
    affected = [{ startLine: top, endLine: Math.min(bottom, outLines.length - 1) }];
  }

  if (node.type === "list" && options.normalizeOrderedLists) {
    const regions = affected.map((r) => expandToListRegion(outLines, r));
    outLines = normalizeOrderedMarkers(outLines, regions);
  }

  return { changed: true, lines: outLines, newStartLine };
}
