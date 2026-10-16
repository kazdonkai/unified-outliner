/**
 * The look of an edit box's bottom-right resize grip (Partial Edit pane):
 * two short parallel diagonal strokes pointing at the corner (no arrow
 * shaft, no arrow heads).
 *
 * Only the LOOK lives here; the grip element and its drag handler are
 * attachResizeGrip in PartialEditView.ts.
 *   - drawResizeGripMarker(el) puts the marker into a plugin grip element
 *     (an inline SVG drawn with currentColor, so it follows the theme);
 *   - resizeGripMarkerSvg(color) gives the same drawing as a standalone SVG
 *     document (e.g. for a CSS background).
 */

/** 12 × 12 view box; the two strokes, outer (longer) first. */
export const RESIZE_GRIP_VIEWBOX = 12;
export const RESIZE_GRIP_STROKES: readonly { x1: number; y1: number; x2: number; y2: number }[] = [
  { x1: 11, y1: 3, x2: 3, y2: 11 },
  { x1: 11, y1: 7, x2: 7, y2: 11 },
];
export const RESIZE_GRIP_STROKE_WIDTH = 1.5;

const SVG_NS = "http://www.w3.org/2000/svg";

/** Replaces `el`'s content with the two-stroke marker (inline SVG, currentColor). */
export function drawResizeGripMarker(el: HTMLElement): void {
  el.empty();
  const doc = el.ownerDocument;
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${RESIZE_GRIP_VIEWBOX} ${RESIZE_GRIP_VIEWBOX}`);
  svg.setAttribute("class", "unified-outliner-resize-grip-marker");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  for (const s of RESIZE_GRIP_STROKES) {
    const line = doc.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", String(s.x1));
    line.setAttribute("y1", String(s.y1));
    line.setAttribute("x2", String(s.x2));
    line.setAttribute("y2", String(s.y2));
    line.setAttribute("stroke", "currentColor");
    line.setAttribute("stroke-width", String(RESIZE_GRIP_STROKE_WIDTH));
    line.setAttribute("stroke-linecap", "round");
    svg.appendChild(line);
  }
  el.appendChild(svg);
}

/** The same marker as a standalone SVG document in `color` (for a CSS background). */
export function resizeGripMarkerSvg(color: string): string {
  const lines = RESIZE_GRIP_STROKES.map(
    (s) =>
      `<line x1='${s.x1}' y1='${s.y1}' x2='${s.x2}' y2='${s.y2}' stroke='${color}' stroke-width='${RESIZE_GRIP_STROKE_WIDTH}' stroke-linecap='round'/>`
  ).join("");
  return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${RESIZE_GRIP_VIEWBOX} ${RESIZE_GRIP_VIEWBOX}'>${lines}</svg>`;
}
