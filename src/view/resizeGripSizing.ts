/**
 * Pure sizing rules of the Partial Edit pane's bottom-right resize grip.
 *
 * The grip resizes its edit box both vertically and horizontally, like the
 * browser's own textarea resizer (`resize: both`, diagonal resize cursor). The width only starts to follow
 * the pointer once it has moved sideways a little (WIDTH_THRESHOLD), so a
 * purely vertical drag keeps the box filling the pane's width as before.
 * The width never grows past the space the box has in its container (no
 * horizontal overflow of the pane) and never shrinks below MIN_WIDTH.
 */

export const RESIZE_GRIP_MIN_HEIGHT = 28;
export const RESIZE_GRIP_MIN_WIDTH = 120;
export const RESIZE_GRIP_WIDTH_THRESHOLD = 4;

export interface ResizeGripDragStart {
  width: number;
  height: number;
  /** The widest the box may become: its start width plus the free space to its right in the container. */
  maxWidth: number;
}

export interface ResizeGripSize {
  height: number;
  /** null while the width is not (yet) being changed in this drag. */
  width: number | null;
  widthEngaged: boolean;
}

export function resizeGripNextSize(start: ResizeGripDragStart, dx: number, dy: number, widthEngaged: boolean): ResizeGripSize {
  const height = Math.round(Math.max(RESIZE_GRIP_MIN_HEIGHT, start.height + dy));
  const engaged = widthEngaged || Math.abs(dx) >= RESIZE_GRIP_WIDTH_THRESHOLD;
  if (!engaged) return { height, width: null, widthEngaged: false };
  const min = Math.min(RESIZE_GRIP_MIN_WIDTH, start.width);
  const max = Math.max(start.maxWidth, start.width);
  const width = Math.round(Math.min(max, Math.max(min, start.width + dx)));
  return { height, width, widthEngaged: true };
}

/**
 * Where the grip sits once the box is narrower than its container: its
 * normal offset from the container's right edge (`base`) plus the gap
 * between the box's right edge and the container's inner right edge, so the
 * grip stays on the box's own bottom-right corner.
 */
export function resizeGripOffset(base: number, containerInnerRight: number, targetRight: number): number {
  return Math.round(base + Math.max(0, containerInnerRight - targetRight));
}
