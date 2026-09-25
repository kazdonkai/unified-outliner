/**
 * Phase 5M-2 follow-up ("ミラー行のクリック先の変更"): pure, Obsidian-free
 * decision logic for where activating an Outline Tree mirror row moves the
 * body cursor.
 *
 * Phase 5M-0 made a click (and Enter) on a mirror row jump to the
 * REFERENCED heading/block. That made sense while mirror rows were
 * display-only, but once Phase 5M-2 gave them Move/Delete it split the
 * row the user had selected from the row the cursor-follow highlight
 * showed, and scrolled the embed line being operated on out of view. So:
 *
 *   - click / Enter        -> the mirror's OWN embed line (like every other row);
 *   - "Go to mirror source" (context menu), desktop double click, or — on
 *     mobile — tapping the already-selected row again
 *                          -> the referenced heading/block.
 *
 * This module never reads the clock or the DOM (timestamps are passed in),
 * matching view/rowDoubleClickDetector.ts, so it is unit-testable directly.
 */
import { OutlineTreeMirrorNode } from "../tree/buildOutlineTree";

/** Where a plain click / Enter on a mirror row moves the cursor: always its own embed line. */
export function mirrorRowClickLine(node: OutlineTreeMirrorNode): number {
  return node.line;
}

export type MirrorSourceJumpTarget =
  | { ok: true; line: number }
  | { ok: false; reason: "unresolved" | "cycle" };

/** The referenced heading/block's first line, or why there is none (not found / circular). */
export function mirrorSourceJumpTarget(node: OutlineTreeMirrorNode): MirrorSourceJumpTarget {
  if (node.status === "resolved" && node.targetLine !== null) return { ok: true, line: node.targetLine };
  return { ok: false, reason: node.status === "cycle" ? "cycle" : "unresolved" };
}

/**
 * A desktop double click is recognized on its SECOND pointerdown, but that
 * press's own `click` event still arrives afterwards and would move the
 * cursor straight back to the embed line. The view records the source jump
 * here and swallows exactly that one following click on the same row.
 */
export interface MirrorSourceJumpRecord {
  nodeId: string;
  /** The recognizing pointerdown's `Event.timeStamp` (same time base as the click's). */
  time: number;
}

/** A click later than this after the recognizing pointerdown is an ordinary new click. */
export const MIRROR_SOURCE_JUMP_CLICK_SUPPRESS_MS = 1000;

/** True for the one click that completes a double click which already jumped to the source. */
export function shouldSuppressMirrorRowClick(
  record: MirrorSourceJumpRecord | null,
  nodeId: string,
  clickTime: number
): boolean {
  if (!record || record.nodeId !== nodeId) return false;
  const dt = clickTime - record.time;
  return dt >= 0 && dt <= MIRROR_SOURCE_JUMP_CLICK_SUPPRESS_MS;
}

export type MirrorRowClickAction = "jump-to-embed" | "jump-to-source";

/**
 * What a click/tap on a mirror row does. On mobile, a short TAP on the row
 * that is ALREADY selected (and the tree focused) jumps to the source — the
 * same gesture that starts inline rename on an editable row, which a
 * read-only mirror row never has. The click a long press's release
 * produces (`pressDurationMs >= longPressMs`: that gesture opened the
 * context menu) never jumps to the source; an unknown press duration
 * (`null`) is treated as a tap. Desktop clicks always go to the embed line
 * (desktop uses the double click instead).
 */
export function mirrorRowClickAction(params: {
  isMobile: boolean;
  treeHasFocus: boolean;
  alreadySelected: boolean;
  pressDurationMs: number | null;
  longPressMs: number;
}): MirrorRowClickAction {
  const isTap = params.pressDurationMs === null || params.pressDurationMs < params.longPressMs;
  return params.isMobile && params.treeHasFocus && params.alreadySelected && isTap ? "jump-to-source" : "jump-to-embed";
}
