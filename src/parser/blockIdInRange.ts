/**
 * v1.0.4: side-effect-free reading of an EXISTING Obsidian block id that
 * sits inside a block's own line range.
 *
 * Recognized shapes — exactly the two "inline" shapes of
 * edit/partialEdit.ts's detectBlockIdLayout (the Block ID field / mirror
 * detection rule), restricted to the block's OWN range:
 *   1. the range's last line is a lone `^id` line AND the range has other
 *      lines before it ("text\n^id");
 *   2. the range's last line ends with whitespace + `^id` and has body text
 *      before it ("text ^id").
 * Deliberately NOT recognized here:
 *   - a lone `^id` line AFTER the range (detectBlockIdLayout's third shape)
 *     — this module never looks outside the given range, so an id that
 *     belongs to some following block, or that follows a whole list item,
 *     is never attributed to the paragraph;
 *   - a `^word` anywhere other than the end of the last line (mid-line
 *     carets, `x^2`, footnote-like text) — the end-anchored, whitespace-
 *     preceded pattern rejects those, and a caret inside a closed code
 *     span ("`a ^b`") ends with a backtick, so it never matches either.
 *
 * The regexes are kept identical to edit/partialEdit.ts's
 * LONE_BLOCK_ID_RE / BLOCK_ID_AT_END_RE (re-declared rather than imported
 * so parser/* never depends on the edit/* layer, which itself depends on
 * parser/*). tests/blockIdInRange.test.ts pins the two in sync.
 *
 * This module only READS. Issuing, writing or normalizing block ids is out
 * of scope.
 */
import { LineRange } from "../model/block";

const LONE_BLOCK_ID_RE = /^\s*\^([A-Za-z0-9-]+)\s*$/;
const BLOCK_ID_AT_END_RE = /(?:^|\s)\^([A-Za-z0-9-]+)\s*$/;

/** The block id written inside `range` (without the caret), or null when there is none. */
export function readBlockIdWithinRange(lines: readonly string[], range: LineRange): string | null {
  if (range.startLine < 0 || range.endLine < range.startLine || range.endLine >= lines.length) return null;
  const last = lines[range.endLine];
  const lone = LONE_BLOCK_ID_RE.exec(last);
  if (lone) return range.endLine > range.startLine ? lone[1] : null;
  const m = BLOCK_ID_AT_END_RE.exec(last);
  if (!m) return null;
  const body = last.slice(0, m.index);
  return body.trim() !== "" ? m[1] : null;
}
