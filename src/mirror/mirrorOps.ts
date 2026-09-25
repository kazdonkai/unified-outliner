/**
 * Phase 5M-2 ("ミラー行に対する操作"): pure, Obsidian-free operations on a
 * mirror row (a same-note mirror embed line) — Delete, Move up/down, and
 * the "which mirrors reference this block?" lookup the Partial Edit Pane
 * displays.
 *
 * No mirror-specific move/delete logic lives here. Both operations are thin
 * wrappers that build a snapshot for the embed line and call the EXISTING
 * standalone pipelines, which Phase 5M-2 widened to admit exactly this
 * shape (mirror/isMirrorEmbedBlock.ts):
 *
 *   - Move  -> edit/moveStandaloneComplexBlock.ts#moveStandaloneComplexBlock
 *              (same adjacency judge, same same-section-only rule, same
 *              swapBlocks primitive as a standalone callout/blockquote).
 *   - Delete -> edit/deleteStandaloneComplexBlock.ts#deleteStandaloneComplexBlock
 *              (same snapshot re-verification, same "3+ blank lines -> 2"
 *              normalization as a standalone callout/blockquote).
 *
 * The one addition is deleteMirror's own invariant check: the result must
 * be the original text with the embed line removed and, at most, some
 * blank lines collapsed — every non-blank line other than the embed line is
 * kept byte-for-byte and in order. A mirror delete therefore can never
 * change the referenced block (heading, body, or its `^block-id`), even if
 * the underlying delete pipeline were to change in the future.
 */
import { ParsedDocument } from "../model/block";
import { ComplexBlockInfo, ComplexBlockScanResult } from "../model/complexBlock";
import { CompositeBlockInfo, CompositeBlockRule } from "../model/compositeBlock";
import { isBlankLine, parseDocument } from "../parser/parseDocument";
import { scanComplexBlocks } from "../parser/complexBlocks";
import { evaluateStandaloneComplexBlockMovability } from "../parser/compositeBlocks";
import {
  buildMirrorEmbedMoveSnapshot,
  moveStandaloneComplexBlock,
  StandaloneComplexBlockMoveOutcome,
  StandaloneComplexBlockSnapshot,
} from "../edit/moveStandaloneComplexBlock";
import {
  buildMirrorEmbedDeleteSnapshot,
  deleteStandaloneComplexBlock,
  StandaloneComplexBlockDeleteOutcome,
  StandaloneComplexBlockDeleteSnapshot,
} from "../edit/deleteStandaloneComplexBlock";
import { StandaloneMoveDirection } from "../move/findStandaloneComplexBlockMoveTarget";
import { blockBodyText, detectBlockIdLayout, extractSubtreeText } from "../edit/partialEdit";
import { isMirrorEmbedBlock } from "./isMirrorEmbedBlock";
import { scanMirrorEmbeds } from "./scanMirrorEmbeds";

/** The embed line's paragraph block at `embedLine`, when it is a mirror embed line right now. */
export function findMirrorEmbedBlock(
  doc: ParsedDocument,
  scan: ComplexBlockScanResult,
  embedLine: number
): ComplexBlockInfo | null {
  return (
    scan.blocks.find(
      (b) => b.kind === "paragraph" && b.range.startLine === embedLine && isMirrorEmbedBlock(doc, b)
    ) ?? null
  );
}

export interface MirrorOpSnapshots {
  move: StandaloneComplexBlockSnapshot;
  delete: StandaloneComplexBlockDeleteSnapshot;
}

/** Move/Delete snapshots for the mirror embed line at `embedLine`, or null when that line is not a mirror embed. */
export function buildMirrorOpSnapshots(
  doc: ParsedDocument,
  scan: ComplexBlockScanResult,
  embedLine: number
): MirrorOpSnapshots | null {
  const block = findMirrorEmbedBlock(doc, scan, embedLine);
  if (!block) return null;
  const move = buildMirrorEmbedMoveSnapshot(doc, block);
  const del = buildMirrorEmbedDeleteSnapshot(doc, block);
  return move && del ? { move, delete: del } : null;
}

/** Menu-time feasibility for Move mirror up/down — the SAME judge moveStandaloneComplexBlock re-runs at click time. */
export function evaluateMirrorMove(
  doc: ParsedDocument,
  scan: ComplexBlockScanResult,
  composites: CompositeBlockInfo[],
  embedLine: number,
  direction: StandaloneMoveDirection
): ReturnType<typeof evaluateStandaloneComplexBlockMovability> {
  const block = findMirrorEmbedBlock(doc, scan, embedLine);
  if (!block) return { eligible: false, reason: "not-supported" };
  return evaluateStandaloneComplexBlockMovability(doc, scan, block, direction, composites);
}

/** Move the mirror embed line one unit up/down within its section (existing standalone Move, unchanged). */
export function moveMirror(
  text: string,
  snapshot: StandaloneComplexBlockSnapshot,
  direction: StandaloneMoveDirection,
  rules: CompositeBlockRule[]
): StandaloneComplexBlockMoveOutcome {
  return moveStandaloneComplexBlock(text, { snapshot, direction }, rules);
}

export type MirrorDeleteOutcome = StandaloneComplexBlockDeleteOutcome & {
  /** Set when the invariant check (see this module's top doc comment) refused the result. */
  invariantViolated?: boolean;
};

/**
 * True when `after` is `before` with exactly the line at `removedLine`
 * dropped plus, possibly, some blank lines removed — i.e. every non-blank
 * line except the removed one survives byte-for-byte and in order.
 */
export function onlyEmbedLineRemoved(before: readonly string[], after: readonly string[], removedLine: number): boolean {
  const expected = before.filter((l, i) => i !== removedLine && !isBlankLine(l));
  const actual = after.filter((l) => !isBlankLine(l));
  if (expected.length !== actual.length) return false;
  if (!expected.every((l, i) => l === actual[i])) return false;
  // Only blank lines may disappear besides the embed line.
  return after.length <= before.length - 1 && after.length >= expected.length;
}

/**
 * Phase 5M-2 follow-up ("Delete Mirror 後の空行クリーンアップ"): collapses
 * the run of blank lines at `boundary` in `lines` (the post-delete array;
 * `boundary` is any index inside or directly after that run) so that it no
 * longer carries the separators Create mirror added around the embed.
 *
 * The run shrinks to:
 *   - 0 lines at the start or the end of the note (nothing to separate);
 *   - exactly 1 line when non-blank content remains on BOTH sides.
 *
 * Never 0 between two pieces of content: in Markdown a blank line is what
 * separates two blocks, so dropping the last one would merge the block
 * before the mirror with the one after it — e.g. `para ^uo-x` and the next
 * paragraph would become ONE paragraph and the `^uo-x` id would then point
 * at the merged text, i.e. deleting a mirror would change the block it
 * referenced. A run that is already 0 lines is returned unchanged. Only
 * blank lines are ever removed. Not exported: mirror-delete-specific
 * post-processing, used solely by deleteMirror below.
 */
function collapseAdjacentBlanksAtBoundary(lines: string[], boundary: number): string[] {
  const b = Math.max(0, Math.min(boundary, lines.length));
  let start = b;
  while (start > 0 && isBlankLine(lines[start - 1])) start--;
  let end = b;
  while (end < lines.length && isBlankLine(lines[end])) end++;
  if (end === start) return lines;
  const keep = start > 0 && end < lines.length ? 1 : 0;
  return [...lines.slice(0, start), ...Array<string>(keep).fill(""), ...lines.slice(end)];
}

/**
 * Delete ONLY the mirror embed line (existing standalone Delete, unchanged) —
 * never the referenced block. `deleteImpl` exists for tests only (so the
 * invariant-violation path can be exercised); production callers never pass it.
 */
export function deleteMirror(
  text: string,
  snapshot: StandaloneComplexBlockDeleteSnapshot,
  rules: CompositeBlockRule[],
  deleteImpl: typeof deleteStandaloneComplexBlock = deleteStandaloneComplexBlock
): MirrorDeleteOutcome {
  const outcome = deleteImpl(text, snapshot, rules);
  if (!outcome.changed) return outcome;
  const before = text.split("\n");
  if (!onlyEmbedLineRemoved(before, outcome.lines, snapshot.range.startLine)) {
    return { changed: false, lines: before, newStartLine: -1, newCursorCh: 0, reason: "boundary-changed", invariantViolated: true };
  }
  // Blank-line cleanup (only after the invariant above passed). The run
  // around the deleted line starts at the first blank line directly above
  // the embed in the ORIGINAL text; deleteStandaloneComplexBlock's own
  // "3+ -> 2" normalization may have shortened that run but never moves
  // its start, so that index locates it in outcome.lines too.
  let runStart = snapshot.range.startLine;
  while (runStart > 0 && isBlankLine(before[runStart - 1])) runStart--;
  const cleaned = collapseAdjacentBlanksAtBoundary(outcome.lines, runStart);
  // Defense in depth: the cleanup removed blank lines only.
  if (!onlyEmbedLineRemoved(before, cleaned, snapshot.range.startLine)) return outcome;
  // A cursor fallback line below the collapsed run moves up with it.
  const removed = outcome.lines.length - cleaned.length;
  const shifted = outcome.newStartLine > runStart ? Math.max(runStart, outcome.newStartLine - removed) : outcome.newStartLine;
  const newStartLine = Math.max(0, Math.min(shifted, cleaned.length - 1));
  return { ...outcome, lines: cleaned, newStartLine };
}

// ---- Partial Edit Pane: "mirrors referencing this block" ---------------------

/**
 * The embed lines (document order) of every RESOLVED mirror whose target
 * starts at `targetStartLine` — i.e. the mirrors that show the block the
 * Partial Edit Pane is editing. Unresolved and circular mirrors are not
 * counted. Display-only.
 */
export function findMirrorsReferencing(
  doc: ParsedDocument,
  blocks: ComplexBlockInfo[],
  notePath: string,
  targetStartLine: number
): number[] {
  return scanMirrorEmbeds(doc, blocks, notePath)
    .filter((p) => p.resolution.status === "resolved" && p.resolution.source.lineRange.startLine === targetStartLine)
    .map((p) => p.node.embedLine)
    .sort((a, b) => a - b);
}

/** Which mirror a click jumps to next: cycles 0,1,…,count-1,0,…; -1 when there are none. */
export function nextMirrorJumpIndex(previousIndex: number, count: number): number {
  if (count <= 0) return -1;
  return previousIndex < 0 ? 0 : (previousIndex + 1) % count;
}

/** What the Partial Edit Pane currently has loaded, for locating its block's first line. */
export type PartialEditMirrorTarget =
  | { kind: "node"; nodeId: string }
  | { kind: "paragraph"; parentId: string | null; originalText: string }
  | { kind: "none" };

/**
 * The CURRENT first line of the Partial Edit Pane's block in `doc`, or null
 * when it cannot be located unambiguously (display then shows nothing).
 * CompositeBlocks are not mirror targets in this phase and always map to
 * `{ kind: "none" }` at the call site.
 */
export function partialEditTargetStartLine(doc: ParsedDocument, target: PartialEditMirrorTarget): number | null {
  if (target.kind === "node") {
    const extracted = extractSubtreeText(doc, target.nodeId);
    if (!extracted.ok) return null;
    const node = doc.nodes.get(target.nodeId);
    if (node) return node.range.startLine;
    const block = scanComplexBlocks(doc).blocks.find((b) => b.id === target.nodeId);
    return block ? block.range.startLine : extracted.startLine;
  }
  if (target.kind === "paragraph") {
    const matches = scanComplexBlocks(doc).blocks.filter(
      (b) =>
        b.kind === "paragraph" &&
        b.editability === "supported" &&
        b.parentId === target.parentId &&
        paragraphMatchesText(doc, b, target.originalText)
    );
    return matches.length === 1 ? matches[0].range.startLine : null;
  }
  return null;
}

/**
 * True when paragraph `b`'s text equals `text` — either its raw text or its
 * body with the block id removed (the Partial Edit Pane's Block ID field
 * keeps the id out of the pane's text).
 */
function paragraphMatchesText(doc: ParsedDocument, b: ComplexBlockInfo, text: string): boolean {
  if (doc.lines.slice(b.range.startLine, b.range.endLine + 1).join("\n") === text) return true;
  const layout = detectBlockIdLayout(doc.lines, b.range.startLine, b.range.endLine, { inline: true });
  return layout.blockId !== null && blockBodyText(doc.lines, b.range.startLine, layout) === text;
}

/** Convenience for the view: everything from raw text. */
export function mirrorReferencesForTarget(
  text: string,
  notePath: string,
  target: PartialEditMirrorTarget
): number[] {
  if (target.kind === "none") return [];
  const doc = parseDocument(text);
  const start = partialEditTargetStartLine(doc, target);
  if (start === null) return [];
  return findMirrorsReferencing(doc, scanComplexBlocks(doc).blocks, notePath, start);
}
