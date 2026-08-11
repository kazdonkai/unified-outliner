/**
 * Pure long-press gesture geometry for the Outline Tree View's mobile
 * tap/long-press/menu design (see OutlineTreeView.ts's renderNode — the
 * "Mobile gesture" block right after the row's contextmenu wiring — for
 * the full three-tier design this supports: single tap selects, a second
 * tap on an already-selected row starts inline rename, and a long press
 * opens the same context menu the desktop right-click uses).
 *
 * Kept here, not inline in the view, purely so the move-cancel distance
 * check is a plain function over numbers — testable without any DOM or
 * PointerEvent mocking, matching every other pure module under src/tree
 * (outlineNavigation.ts, resolveHighlightedSectionId.ts, etc.).
 */

/**
 * How long a pointer must stay down (without moving past
 * LONG_PRESS_MOVE_CANCEL_PX) before it counts as a long press rather than
 * an ordinary tap. The implementation instruction suggested a 400–500ms
 * range; 450ms sits in the middle — long enough that a normal tap-to-select
 * or the start of a scroll gesture never accidentally fires it, short
 * enough that deliberately holding a row doesn't feel sluggish.
 */
export const LONG_PRESS_DURATION_MS = 450;

/**
 * Beyond this many CSS pixels of movement from the initial pointerdown
 * point, the gesture is treated as a scroll/drag attempt rather than a
 * long press, and the pending timer must be cancelled — see
 * exceedsLongPressMoveThreshold below. 10px matches the kind of small
 * "slop" threshold most touch UIs use to distinguish an intentional drag
 * from a finger that isn't perfectly still while held.
 */
export const LONG_PRESS_MOVE_CANCEL_PX = 10;

/**
 * Whether a pointer that started at (startX, startY) and has since moved to
 * (currentX, currentY) has travelled far enough that a pending long-press
 * timer should be cancelled. Plain Euclidean distance against
 * `thresholdPx` — deliberately not axis-limited, so a diagonal or
 * purely-vertical scroll attempt cancels just as readily as a horizontal
 * one.
 */
export function exceedsLongPressMoveThreshold(
  startX: number,
  startY: number,
  currentX: number,
  currentY: number,
  thresholdPx: number = LONG_PRESS_MOVE_CANCEL_PX
): boolean {
  const dx = currentX - startX;
  const dy = currentY - startY;
  return Math.sqrt(dx * dx + dy * dy) > thresholdPx;
}
