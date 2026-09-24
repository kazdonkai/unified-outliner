/**
 * Phase 5D-3C ("Callout and Blockquote Drag and Drop", 案A approved): a
 * pure function that safely drops a standalone OR CompositeBlock-member
 * callout/blockquote at a specific, arbitrary before/after position, given
 * the CURRENT Markdown text and a snapshot of what the caller believes it
 * is dragging.
 *
 * Strictly mirrors edit/moveStandaloneComplexBlock.ts's own "re-parse ->
 * re-scan -> re-match -> snapshot照合 -> resolver再解決 -> insertBlockAt"
 * design and reuses that module's exported `snapshotMatches`/
 * `findRangeInvalidReason` verbatim (Phase 5D-3C approval: "Drag and Drop
 * の source snapshot は、既存 Move の StandaloneComplexBlockSnapshot を
 * 再利用するか、それと同じ契約を守る専用 snapshot とする") — this module
 * has NO Obsidian dependency and is wired into view/OutlineTreeView.ts
 * only via a thin dispatch method, exactly like moveStandaloneComplexBlock.
 *
 * ---- Relationship to the resolver layer ----
 *
 *   - move/findStandaloneComplexBlockDropTarget.ts#resolveStandaloneComplexBlockDropTarget
 *     (resolver): given an already-resolved source/target pair and a zone,
 *     is this specific position safe, and if so what is the exact
 *     `insertBeforeLine`.
 *   - dropStandaloneComplexBlock (this file, executor): given the caller's
 *     source snapshot and target hint, re-resolve BOTH against the CURRENT
 *     text, re-run the resolver, and perform the drop via
 *     move/moveBlock.ts's existing `insertBlockAt` primitive (UNCHANGED —
 *     no new splice/rewrite logic is written here).
 *
 * ---- Why this function re-resolves the TARGET too, not just the source --
 *
 * The ticket's approval explicitly mandates source re-resolution ("drop
 *時には必ず最新の文書を再パースし、drag source を再解決・再照合する"). This
 * function extends the same discipline to the target hint: a target's own
 * `range`/`parentId` captured at a prior dragover could equally have gone
 * stale by drop time (external edit, or a Tree refresh mid-drag) — trusting
 * a stale target position could otherwise insert content at a line number
 * that no longer means what it meant when the hint was captured. Both
 * failures are reported as safe no-ops (`changed: false`), never a
 * best-effort write against stale coordinates.
 *
 * ---- What this function does NOT do ----
 *
 * [2026-09-24 追記, feat/standalone-complex-dnd-cross-section] The
 * "no blank-line cleanup" sentence directly below was true of v1 and is
 * kept for history, but is now only half true: this function now DOES
 * insert a blank line either side of the moved block (via this file's own
 * local `ensureBlankSeparation`), but ONLY on a drop that actually crosses
 * a section boundary (`target.parentId !== resolvedSource.parentId`,
 * checked AFTER both sides are freshly re-resolved). A same-section drop
 * still gets none — see this file's own call site of
 * `ensureBlankSeparation`, below, for the exact condition and rationale.
 * This mirrors edit/paragraphNonAdjacentMove.ts's own
 * `ensureBlankSeparation`, reused here as a byte-identical, independently
 * duplicated copy (same "duplicated, not imported" convention that
 * module's own top doc comment, and edit/deleteParagraph.ts's own copy,
 * already establish) rather than an import, since this module has always
 * deliberately avoided a dependency on the paragraph-move family.
 *
 * [2026-09-25 追記, fix/standalone-dnd-blank-separation-always] The
 * paragraph directly above ("but ONLY on a drop that actually crosses a
 * section boundary...") described the ORIGINAL, now-corrected behavior
 * and is kept for history, but is no longer accurate: ensureBlankSeparation
 * is now applied UNCONDITIONALLY, on every drop, same-section included.
 * That same-section gate rested on an unverified assumption — that
 * move/findStandaloneComplexBlockDropTarget.ts's own resolver
 * (resolveStandaloneComplexBlockDropTarget) only ever offers same-section
 * candidate positions that are already blank-line-separated from their
 * neighbor. That assumption was wrong: the resolver only ever checks
 * self-drop and composite-internal-boundary safety — it has never checked
 * blank-line separation at all, for either same-section or cross-section
 * candidates. A real-device (iPad) report showed exactly this: a
 * blockquote dragged and dropped immediately above an unrelated paragraph
 * in the SAME section, with no blank line between them, silently merged
 * the paragraph into the blockquote's own body on re-parse. This defect
 * predates the cross-section ticket entirely — it goes back to Phase
 * 5D-3C, the original callout/blockquote D&D implementation — and the
 * cross-section ticket's own same-section gate merely left it
 * unprotected rather than introducing it. See this file's own call site
 * of `ensureBlankSeparation`, below, for the corrected, unconditional
 * call.
 *
 * No Markdown reformatting/renormalization of any other kind, no
 * content/text-hash comparison of the SOURCE (matching Move's own "a
 * move/drop relocates whatever content currently sits at the re-verified
 * structural position" policy — this is not a round-trip edit like the
 * Partial Edit Pane). Every rejection path leaves `lines` byte-identical
 * to the input (`changed: false`).
 */
import { ParsedDocument } from "../model/block";
import { ComplexBlockScanResult, StandaloneComplexBlockDropRejectReason } from "../model/complexBlock";
import { CompositeBlockRule } from "../model/compositeBlock";
import { parseDocument } from "../parser/parseDocument";
import { scanComplexBlocks } from "../parser/complexBlocks";
import { matchCompositeBlocks } from "../parser/compositeBlocks";
import {
  resolveStandaloneComplexBlockDropTarget,
  StandaloneComplexBlockDropTargetHint,
  StandaloneComplexBlockDropZone,
} from "../move/findStandaloneComplexBlockDropTarget";
import { insertBlockAt } from "../move/moveBlock";
import {
  StandaloneComplexBlockSnapshot,
  findRangeInvalidReason,
  snapshotMatches,
} from "./moveStandaloneComplexBlock";
import { LineEditOutcome } from "../commands/applyLineEditOutcome";
import { isBlankLine } from "../parser/parseDocument";

// [2026-09-24 追記, feat/standalone-complex-dnd-cross-section]
// Byte-identical duplicate of edit/paragraphNonAdjacentMove.ts's own
// HEADING_RE/LIST_RE/needsSeparatingBlankLine/ensureBlankSeparation —
// same "duplicated, not imported" policy that file's own top doc comment
// already establishes (and edit/deleteParagraph.ts's own copy already
// follows). Needed here because a CROSS-SECTION standalone
// callout/blockquote/fenced-code/table drop can now land the moved block
// directly next to arbitrary destination-section content that never used
// to be adjacent to it — exactly the same "two things merge into one
// parsed unit because no blank line separates them" risk
// moveParagraphNonAdjacent's own blank-line policy already guards against.
// SAME-SECTION drops keep their pre-existing behavior (no blank-line
// insertion at all) — see dropStandaloneComplexBlock's own call site
// below for why this is applied conditionally, not unconditionally.
//
// [2026-09-25 追記, fix/standalone-dnd-blank-separation-always] The
// "SAME-SECTION drops keep their pre-existing behavior (no blank-line
// insertion at all)" sentence directly above is now WRONG — see
// dropStandaloneComplexBlock's own call site below, and this file's top
// doc comment's own dated addendum, for the full correction. This helper
// (ensureBlankSeparation) itself is unchanged; only the CALLER's
// condition for invoking it changed, from "cross-section only" to
// "always, regardless of section".
const HEADING_RE = /^(#{1,6})[ \t]+(.*)$/;
const LIST_RE = /^([ \t]*)([-*+]|\d+[.)])(?:[ \t]+.*)?$/;

function needsSeparatingBlankLine(neighborLine: string | undefined): boolean {
  if (neighborLine === undefined) return false;
  if (isBlankLine(neighborLine)) return false;
  if (HEADING_RE.test(neighborLine)) return false;
  if (LIST_RE.test(neighborLine)) return false;
  return true;
}

function ensureBlankSeparation(
  lines: string[],
  start: number,
  length: number
): { lines: string[]; newStart: number } {
  let out = lines;
  let s = start;
  const end = start + length - 1;

  if (needsSeparatingBlankLine(out[end + 1])) {
    out = [...out.slice(0, end + 1), "", ...out.slice(end + 1)];
  }
  if (needsSeparatingBlankLine(out[s - 1])) {
    out = [...out.slice(0, s), "", ...out.slice(s)];
    s += 1;
  }

  return { lines: out, newStart: s };
}

export interface StandaloneComplexBlockDropRequest {
  snapshot: StandaloneComplexBlockSnapshot;
  target: StandaloneComplexBlockDropTargetHint;
  zone: StandaloneComplexBlockDropZone;
}

export interface StandaloneComplexBlockDropOutcome extends LineEditOutcome {
  reason?: StandaloneComplexBlockDropRejectReason;
}

function rejected(
  lines: string[],
  reason: StandaloneComplexBlockDropRejectReason
): StandaloneComplexBlockDropOutcome {
  return { changed: false, lines, newStartLine: -1, reason };
}

/**
 * True when SOME currently-real node (a complex block OR a plain list
 * item) has EXACTLY `target`'s own `range`/`parentId` right now. Checks
 * both `complexScan.blocks` (paragraph/callout/blockquote/fenced-code/
 * table/thematic-break) and `doc.nodes` list-type entries (a plain list
 * item target), since a StandaloneComplexBlockDropTargetHint carries no
 * kind discriminant of its own — only `range`/`parentId` matter for the
 * `insertBeforeLine` arithmetic the resolver performs, so confirming
 * EITHER source still currently has this exact shape is sufficient to
 * treat the hint as live.
 */
function dropTargetHintStillValid(
  doc: ParsedDocument,
  complexScan: ComplexBlockScanResult,
  target: StandaloneComplexBlockDropTargetHint
): boolean {
  for (const info of complexScan.blocks) {
    if (
      info.range.startLine === target.range.startLine &&
      info.range.endLine === target.range.endLine &&
      info.parentId === target.parentId
    ) {
      return true;
    }
  }
  for (const node of doc.nodes.values()) {
    if (node.type !== "list") continue;
    if (
      node.range.startLine === target.range.startLine &&
      node.range.endLine === target.range.endLine &&
      node.parentId === target.parentId
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Drops the standalone-or-composite-member complex block described by
 * `request.snapshot` at `request.zone` relative to `request.target`, in
 * `text` — or returns `changed: false` (original `lines` byte-for-byte
 * unchanged) with a stable `reason` when it cannot safely do so.
 *
 * Steps (fixed order):
 *   1. `findRangeInvalidReason` on the snapshot alone (reused from
 *      edit/moveStandaloneComplexBlock.ts) — "range-invalid" on failure.
 *   2. A cheap structural bounds check on `request.target.range` against
 *      the CURRENT line count — "target-boundary-changed" on failure
 *      (checked before any parse/scan/match attempt, mirroring step 1).
 *   3. `parseDocument` -> `scanComplexBlocks` -> `matchCompositeBlocks`
 *      (fresh, against `rules` — the CALLER's currently-enabled rule set).
 *   4. Re-resolve the source: find the ComplexBlockInfo matching
 *      `request.snapshot` via `snapshotMatches` (reused, unchanged, from
 *      edit/moveStandaloneComplexBlock.ts). "source-boundary-changed" if
 *      none matches.
 *   5. Re-verify the target hint is still live (`dropTargetHintStillValid`,
 *      above). "target-boundary-changed" if not.
 *   6. `resolveStandaloneComplexBlockDropTarget(doc, resolvedSource,
 *      composites, request.target, request.zone)` (the resolver).
 *      `allowed: false` -> that exact `reason`.
 *   7. `move/moveBlock.ts#insertBlockAt(lines, resolvedSource.range,
 *      insertBeforeLine)` — UNCHANGED, existing primitive. Returns
 *      `changed: true` with the moved block's own new start line.
 */
export function dropStandaloneComplexBlock(
  text: string,
  request: StandaloneComplexBlockDropRequest,
  rules: CompositeBlockRule[]
): StandaloneComplexBlockDropOutcome {
  const doc: ParsedDocument = parseDocument(text);
  const lines = doc.lines;
  const { snapshot, target, zone } = request;

  const rangeInvalidReason = findRangeInvalidReason(snapshot, lines.length);
  if (rangeInvalidReason) {
    return rejected(lines, rangeInvalidReason);
  }
  if (
    target.range.startLine < 0 ||
    target.range.endLine < target.range.startLine ||
    target.range.endLine >= lines.length
  ) {
    return rejected(lines, "target-boundary-changed");
  }

  const complexScan = scanComplexBlocks(doc);
  const composites = matchCompositeBlocks(doc, complexScan, rules);

  const resolvedSource = complexScan.blocks.find((b) => snapshotMatches(snapshot, b));
  if (!resolvedSource) {
    return rejected(lines, "source-boundary-changed");
  }

  if (!dropTargetHintStillValid(doc, complexScan, target)) {
    return rejected(lines, "target-boundary-changed");
  }

  const resolution = resolveStandaloneComplexBlockDropTarget(doc, resolvedSource, composites, target, zone);
  if (!resolution.allowed) {
    return rejected(lines, resolution.reason);
  }

  const { lines: outLines, newStart } = insertBlockAt(lines, resolvedSource.range, resolution.insertBeforeLine);

  // [2026-09-25 追記, fix/standalone-dnd-blank-separation-always]
  // ensureBlankSeparation is now applied UNCONDITIONALLY, on every drop —
  // same-section and cross-section alike. It used to be gated behind
  // `target.parentId !== resolvedSource.parentId` (cross-section only);
  // see this file's own top doc comment addendum, dated 2026-09-24, for
  // why that gate existed and why it turned out to be wrong. In short:
  // the gate's premise was "a same-section drop target is always already
  // a safe, blank-line-separated position" — but
  // move/findStandaloneComplexBlockDropTarget.ts's own resolver
  // (resolveStandaloneComplexBlockDropTarget) never actually guaranteed
  // that. It only ever checked self-drop and composite-internal-boundary
  // safety, never blank-line separation from its neighbor. A real-device
  // report (iPad) showed a blockquote dropped immediately above an
  // unrelated paragraph, with no blank line between them, causing the
  // paragraph to be swallowed into the blockquote's own body on re-parse
  // — a same-section drop, so the old gate left it completely
  // unprotected. This is the same failure mode
  // moveParagraphNonAdjacent's own unconditional ensureBlankSeparation
  // call already guards against for paragraph moves; this executor now
  // matches that same unconditional posture. ensureBlankSeparation
  // itself is a no-op when the neighbor is already blank, a heading, or
  // a list item (see needsSeparatingBlankLine above), so an
  // already-separated drop position still gets byte-identical output —
  // see tests/dropStandaloneComplexBlock.test.ts's own coverage of both
  // cases.
  const blockLength = resolvedSource.range.endLine - resolvedSource.range.startLine + 1;
  const separated = ensureBlankSeparation(outLines, newStart, blockLength);
  return { changed: true, lines: separated.lines, newStartLine: separated.newStart };
}
