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
 *   - "Go to mirror source" (context menu) or a desktop double click
 *                          -> the referenced heading/block;
 *   - on mobile, tapping the already-selected row again TOGGLES the cursor
 *     between the referenced block and the embed line (follow-up after
 *     real-device testing: a third tap used to "do nothing", because it
 *     jumped to the source the cursor was already on);
 *   - on desktop, clicking the already-selected row again toggles the same
 *     way (2026-09-30; see mirrorRowClickAction).
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
 * that is ALREADY selected (and the tree focused) toggles: when the body
 * cursor is currently on the referenced block's first line
 * (`cursorAtSource`) it goes back to the embed line, otherwise it jumps to
 * the source. This is the gesture that starts inline rename on an editable
 * row, which a read-only mirror row never has. Deciding from the actual
 * cursor position (not a remembered toggle bit) keeps it right after the
 * user moved the cursor some other way. The click a long press's release
 * produces (`pressDurationMs >= longPressMs`: that gesture opened the
 * context menu) never jumps to the source; an unknown press duration
 * (`null`) is treated as a tap.
 *
 * Desktop (2026-09-30, "デスクトップでもクリックごとに交互に移動"): a mouse
 * click on the ALREADY selected mirror row toggles as well, but decided
 * from `cursorAtEmbed`: when the body cursor is on the row's own embed
 * line it jumps to the source, otherwise (cursor on the source, or moved
 * somewhere else meanwhile) it goes to the embed line. So repeated clicks
 * alternate embed -> source -> embed -> ..., and a click after the user
 * moved the cursor elsewhere first returns to the embed line like any
 * ordinary row click. Tree focus and press duration are not consulted on
 * desktop (a mouse has no long press; the context menu is a right click).
 * The desktop double click (-> source) is kept.
 */
export function mirrorRowClickAction(params: {
  isMobile: boolean;
  treeHasFocus: boolean;
  alreadySelected: boolean;
  pressDurationMs: number | null;
  longPressMs: number;
  cursorAtSource: boolean;
  /** Desktop toggle: the body cursor is on this mirror row's own embed line. Defaults to false. */
  cursorAtEmbed?: boolean;
}): MirrorRowClickAction {
  if (!params.isMobile) {
    return params.alreadySelected && params.cursorAtEmbed === true ? "jump-to-source" : "jump-to-embed";
  }
  const isTap = params.pressDurationMs === null || params.pressDurationMs < params.longPressMs;
  const reTap = params.treeHasFocus && params.alreadySelected && isTap;
  return reTap && !params.cursorAtSource ? "jump-to-source" : "jump-to-embed";
}

/** True when the body cursor is on the mirror row's own embed line (for the desktop click toggle). */
export function isCursorAtMirrorEmbed(node: OutlineTreeMirrorNode, cursorLine: number | null): boolean {
  return cursorLine !== null && cursorLine === mirrorRowClickLine(node);
}

/** True when the body cursor is on the mirror's resolved source line (for the mobile re-tap toggle). */
export function isCursorAtMirrorSource(node: OutlineTreeMirrorNode, cursorLine: number | null): boolean {
  const target = mirrorSourceJumpTarget(node);
  return target.ok && cursorLine !== null && cursorLine === target.line;
}
