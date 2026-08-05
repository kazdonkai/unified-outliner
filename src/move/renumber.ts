/**
 * Ordered list renumbering.
 *
 * MVP policy (spec §7): normalize every ordered marker in the affected
 * ranges to "1." and let Markdown renderers auto-number. Real sequential
 * renumbering is a TODO.
 */

import { LineRange } from "../model/block";

const ORDERED_MARKER_RE = /^([ \t]*)\d+[.)]([ \t]+)/;

export function normalizeOrderedMarkers(
  lines: string[],
  ranges: LineRange[],
  skipLines?: boolean[]
): string[] {
  const out = lines.slice();
  for (const r of ranges) {
    const start = Math.max(0, r.startLine);
    const end = Math.min(out.length - 1, r.endLine);
    for (let l = start; l <= end; l++) {
      if (skipLines && skipLines[l]) continue;
      out[l] = out[l].replace(ORDERED_MARKER_RE, (_m, ws: string, sp: string) => `${ws}1.${sp}`);
    }
  }
  return out;
}
