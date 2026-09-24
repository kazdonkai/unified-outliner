/**
 * Phase 5E-1 ("fenced code block の raw Partial Edit・移動・削除"): a pure
 * function that safely deletes a standalone (non-composite-member) fenced
 * code block from the note, given the CURRENT Markdown text and a snapshot
 * captured when the Tree's context menu was built.
 *
 * ---- Why this is a NEW module rather than a widened moveStandaloneComplexBlock.ts ----
 *
 * Phase 5E-1's own brief asks this feature to "reuse the existing callout/
 * blockquote operation paths as much as possible" — but unlike Move (Phase
 * 5C-3's moveStandaloneComplexBlock.ts, widened by this same ticket to also
 * accept "fenced-code"), NO existing standalone-callout/blockquote DELETE
 * pipeline exists anywhere in this codebase to reuse: standalone callout/
 * blockquote has never had a Tree-driven delete command
 * (view/OutlineTreeView.ts#showStandaloneComplexBlockMenu has only ever
 * offered Open in Partial Edit / Move up / Move down — see that method's
 * own source). This module is therefore new code, but it deliberately
 * mirrors moveStandaloneComplexBlock.ts's own re-parse -> re-scan ->
 * snapshot-match -> re-verify -> execute shape byte-for-byte, and reuses
 * parser/compositeBlocks.ts#isStandaloneComplexBlockShapeEligible /
 * #isComposedMember UNCHANGED (both already widened/already generic) for
 * its own eligibility gate, rather than writing any new eligibility logic.
 *
 * Originally scoped to kind "fenced-code" ONLY — deliberately NOT
 * callout/blockquote. Widening this delete pipeline to callout/blockquote
 * too was NOT part of Phase 5E-1's brief (which only asked for
 * fenced-code move/delete/Partial Edit), and doing so silently would hand
 * callout/blockquote a new capability nobody asked for in that phase and
 * that has never been reviewed for that kind's own edge cases (e.g. a
 * callout's fold marker, a blockquote's own nested-quote handling).
 *
 * Phase 5E-3d ("Table Move/Delete/DnD Parity") widens this module's own
 * `kind` field to also accept "table" — table already has Tree projection
 * and a working Partial Edit session (Phase 5E-2A/5E-2B), and its own
 * ComplexBlockInfo.range/editability are reused completely unchanged here,
 * exactly as fenced-code's were before it. callout/blockquote remained
 * excluded at that time, for the identical reason given above.
 *
 * > **2026-09-24 追記（follow-up ticket, discovered during the user's own
 * > real-device acceptance testing of the phase5e3d-table-move-delete-dnd
 * > branch）**: the standalone callout/blockquote context menu was found
 * > to still offer no Delete item at all — the exclusion above was never
 * > about a technical limitation of this module (its own delete/re-verify
 * > logic — `snapshotMatches`, the deletion itself,
 * > `normalizeBlankRunAtBoundary` — has always been kind-generic, gated
 * > only by this file's own narrow `kind` allow-list; nothing about a
 * > callout's fold marker or a blockquote's own nested-quote handling
 * > ever required special-casing here, since this module deletes the
 * > block's already-resolved `ComplexBlockInfo.range` as opaque lines,
 * > never re-parsing or re-interpreting its content). It was simply never
 * > requested for those two kinds until now. This module's own `kind`
 * > field is widened one more time to admit "callout" and "blockquote" —
 * > reusing this exact same pipeline unchanged, mirroring the table
 * > widening above byte-for-byte (allow-list only, no new logic).
 *
 * ---- Blank-line normalization on delete ----
 *
 * This ticket's brief specifies: "削除後に連続した空行が3行以上残る場合は、
 * 2行に正規化する". No existing delete pipeline in this codebase does any
 * blank-line cleanup at all today (edit/deleteBlock.ts and
 * edit/deleteCompositeBlock.ts both explicitly document "no blank-line
 * cleanup"; edit/deleteParagraph.ts's own `needsSeparator` logic only ever
 * INSERTS a single missing blank line, never removes excess ones) — so
 * `normalizeBlankRunAtBoundary` below is new logic specific to this
 * module, not a reuse of an existing normalizer. It runs ONLY at the one
 * new boundary a delete creates (where the line that used to precede the
 * deleted range and the line that used to follow it become newly
 * adjacent): if the contiguous blank-line run spanning that boundary is 3
 * lines or longer, it is trimmed down to exactly 2; a run of 0, 1, or 2
 * blank lines is left completely untouched (this is a MAXIMUM cap, never
 * a minimum — it never inserts a blank line where none existed, unlike
 * deleteParagraph.ts's own insert-only `needsSeparator`).
 */
import { LineRange, ParsedDocument } from "../model/block";
import { ComplexBlockInfo } from "../model/complexBlock";
import { CompositeBlockRule } from "../model/compositeBlock";
import { parseDocument, isBlankLine } from "../parser/parseDocument";
import { scanComplexBlocks } from "../parser/complexBlocks";
import { isComposedMember, isStandaloneComplexBlockShapeEligible, matchCompositeBlocks } from "../parser/compositeBlocks";
import { LineEditOutcome } from "../commands/applyLineEditOutcome";
import { TranslationKey } from "../i18n";

/** The ComplexBlockKind values this module ever deletes — see this file's own top doc comment for this allow-list's history (originally "fenced-code" only, widened to "table" by Phase 5E-3d, and to "callout"/"blockquote" by this same branch's 2026-09-24 follow-up — now matching moveStandaloneComplexBlock.ts's own StandaloneComplexBlockMoveKind exactly). */
export type StandaloneComplexBlockDeleteKind = "fenced-code" | "table" | "callout" | "blockquote";

/**
 * A point-in-time capture of a standalone fenced-code ComplexBlockInfo,
 * taken via buildStandaloneComplexBlockDeleteSnapshot at menu-build time.
 * Mirrors edit/moveStandaloneComplexBlock.ts#StandaloneComplexBlockSnapshot's
 * own shape and re-verification contract exactly: `id` is diagnostic-only
 * (never used as a matching key — see snapshotMatches below), every other
 * field is re-checked against a FRESH parse/scan before any write.
 */
export interface StandaloneComplexBlockDeleteSnapshot {
  id: string;
  kind: StandaloneComplexBlockDeleteKind;
  range: LineRange;
  parentId: string | null;
}

/**
 * Projects a live, already-eligible ComplexBlockInfo into a
 * StandaloneComplexBlockDeleteSnapshot. Returns `null` when `info.kind` is
 * not "fenced-code" or `info.editability` is not "supported" — defense-in-
 * depth for a caller that hasn't already filtered to this exact eligible
 * set (see tree/buildOutlineTree.ts's isStandaloneComplexBlockEligible,
 * which every real caller has already applied before a Tree row exists to
 * right-click at all).
 */
export function buildStandaloneComplexBlockDeleteSnapshot(
  info: ComplexBlockInfo
): StandaloneComplexBlockDeleteSnapshot | null {
  if (
    info.kind !== "fenced-code" &&
    info.kind !== "table" &&
    info.kind !== "callout" &&
    info.kind !== "blockquote"
  ) {
    return null;
  }
  if (info.editability !== "supported") return null;
  return {
    id: info.id,
    kind: info.kind,
    range: { startLine: info.range.startLine, endLine: info.range.endLine },
    parentId: info.parentId,
  };
}

/**
 * Every way deleteStandaloneComplexBlock refuses to touch the note.
 *   - "not-supported": the re-resolved block is no longer standalone-
 *     shape-eligible (wrong kind, editability no longer "supported", or
 *     now nested inside a list item — isStandaloneComplexBlockShapeEligible's
 *     own three conditions, re-checked fresh).
 *   - "composite-member": the re-resolved block's id is currently some
 *     matched CompositeBlockInfo's own member (kept as defense-in-depth,
 *     mirroring every other *StandaloneComplexBlock module's identical
 *     check — fenced-code is not collected as a composite candidate by
 *     any shipped CompositeBlockRule today, so this should be structurally
 *     unreachable in practice, same status as several of
 *     edit/deleteCompositeBlock.ts's own currently-unreachable reasons).
 *   - "boundary-changed": the current text no longer contains a standalone
 *     fenced-code block matching every field of the caller's snapshot.
 *   - "range-invalid": the snapshot itself is not self-consistent, checked
 *     BEFORE attempting any match.
 */
export type NoStandaloneComplexBlockDeleteReason =
  | "not-supported"
  | "composite-member"
  | "boundary-changed"
  | "range-invalid";

/** deleteStandaloneComplexBlock's result — a structural subtype of commands/applyLineEditOutcome.ts's LineEditOutcome, exactly like every other *DeleteOutcome in this codebase. */
export interface StandaloneComplexBlockDeleteOutcome extends LineEditOutcome {
  newCursorCh: number;
  reason?: NoStandaloneComplexBlockDeleteReason;
}

function rejected(lines: string[], reason: NoStandaloneComplexBlockDeleteReason): StandaloneComplexBlockDeleteOutcome {
  return { changed: false, lines, newStartLine: -1, newCursorCh: 0, reason };
}

/** Structural self-consistency check on `snapshot` alone — mirrors moveStandaloneComplexBlock.ts's own findRangeInvalidReason exactly, scoped to this module's narrower kind. */
function findRangeInvalidReason(
  snapshot: StandaloneComplexBlockDeleteSnapshot,
  lineCount: number
): "range-invalid" | null {
  if (
    snapshot.kind !== "fenced-code" &&
    snapshot.kind !== "table" &&
    snapshot.kind !== "callout" &&
    snapshot.kind !== "blockquote"
  ) {
    return "range-invalid";
  }
  const { startLine, endLine } = snapshot.range;
  if (startLine < 0 || endLine < startLine || endLine >= lineCount) return "range-invalid";
  return null;
}

/** True when `info` (a freshly re-scanned ComplexBlockInfo) is, structurally, the SAME block `snapshot` describes — kind/range/parentId, never `id` — mirrors moveStandaloneComplexBlock.ts#snapshotMatches exactly. */
function snapshotMatches(snapshot: StandaloneComplexBlockDeleteSnapshot, info: ComplexBlockInfo): boolean {
  if (info.kind !== snapshot.kind) return false;
  if (info.range.startLine !== snapshot.range.startLine || info.range.endLine !== snapshot.range.endLine) {
    return false;
  }
  if (info.parentId !== snapshot.parentId) return false;
  return true;
}

/**
 * Trims the contiguous blank-line run straddling `boundary` (the index in
 * `lines` immediately after the deleted range) down to exactly 2 lines
 * when it is 3 or longer — see this file's own top doc comment for the
 * exact rule. Never adds a blank line; only ever removes from an
 * already-3-or-longer run.
 */
function normalizeBlankRunAtBoundary(lines: string[], boundary: number): string[] {
  let start = boundary;
  while (start > 0 && isBlankLine(lines[start - 1])) start--;
  let end = boundary;
  while (end < lines.length && isBlankLine(lines[end])) end++;
  const runLength = end - start;
  if (runLength <= 2) return lines;
  return [...lines.slice(0, start), "", "", ...lines.slice(end)];
}

/**
 * Deletes the standalone fenced-code block described by `snapshot` from
 * `text` — or returns `changed: false` (original `lines` byte-for-byte
 * unchanged) with a stable `reason` when it cannot safely do so.
 *
 * `rules` must be the caller's currently-enabled CompositeBlockRule set,
 * exactly as matchCompositeBlocks itself requires (see this file's own
 * "composite-member" reason doc comment for why this check is currently
 * unreachable but kept as defense-in-depth).
 *
 * Post-delete fallback line: the nearest standalone-eligible complex block
 * or existing BlockNode (section/list) that shares the deleted block's own
 * parentId and starts after it, else the nearest one that starts before
 * it, else the enclosing parent's own start line, else the deletion's own
 * (clamped) start line — mirrors edit/deleteBlock.ts's own fallback chain
 * shape, re-derived here rather than imported since that module only ever
 * resolves BlockNode (section/list) ids, never a ComplexBlockInfo id.
 */
export function deleteStandaloneComplexBlock(
  text: string,
  snapshot: StandaloneComplexBlockDeleteSnapshot,
  rules: CompositeBlockRule[]
): StandaloneComplexBlockDeleteOutcome {
  const doc: ParsedDocument = parseDocument(text);
  const lines = doc.lines;

  const rangeInvalidReason = findRangeInvalidReason(snapshot, lines.length);
  if (rangeInvalidReason) {
    return rejected(lines, rangeInvalidReason);
  }

  const complexScan = scanComplexBlocks(doc);
  const composites = matchCompositeBlocks(doc, complexScan, rules);

  const resolved = complexScan.blocks.find((b) => snapshotMatches(snapshot, b));
  if (!resolved) {
    return rejected(lines, "boundary-changed");
  }

  if (!isStandaloneComplexBlockShapeEligible(doc, resolved)) {
    return rejected(lines, "not-supported");
  }
  if (isComposedMember(composites, resolved.id)) {
    return rejected(lines, "composite-member");
  }

  const { startLine, endLine } = resolved.range;

  // Fallback line: nearest standalone-eligible complex block sharing this
  // block's own parentId (document order), else the parent BlockNode's own
  // start line, else the deletion's own clamped start line.
  const siblingCandidates = complexScan.blocks.filter(
    (b) => b.id !== resolved.id && b.parentId === resolved.parentId && isStandaloneComplexBlockShapeEligible(doc, b)
  );
  const nextSibling = siblingCandidates
    .filter((b) => b.range.startLine > endLine)
    .sort((a, b) => a.range.startLine - b.range.startLine)[0];
  const prevSibling = siblingCandidates
    .filter((b) => b.range.startLine < startLine)
    .sort((a, b) => b.range.startLine - a.range.startLine)[0];
  const parentNode = resolved.parentId !== null ? doc.nodes.get(resolved.parentId) : undefined;
  const fallbackPreLine = nextSibling?.range.startLine ?? prevSibling?.range.startLine ?? parentNode?.range.startLine;

  const deletedCount = endLine - startLine + 1;
  const removedLines = [...lines.slice(0, startLine), ...lines.slice(endLine + 1)];
  const outLines = normalizeBlankRunAtBoundary(removedLines, startLine);
  // normalizeBlankRunAtBoundary can only ever REMOVE lines (never add —
  // see its own doc comment), so any post-boundary fallback line number
  // computed against `removedLines`'s own length is still valid after
  // this step: a removed line can only ever sit strictly at or after
  // `startLine`, and a fallback line at or after that point is always
  // re-clamped below anyway.

  let newStartLine: number;
  if (fallbackPreLine === undefined) {
    newStartLine = startLine;
  } else if (fallbackPreLine < startLine) {
    newStartLine = fallbackPreLine;
  } else {
    newStartLine = fallbackPreLine - deletedCount;
  }
  newStartLine = Math.max(0, Math.min(newStartLine, outLines.length - 1));

  return { changed: true, lines: outLines, newStartLine, newCursorCh: 0 };
}

/**
 * Translates a standalone-fenced-code-block-delete rejection reason into
 * the current locale — mirrors
 * edit/moveStandaloneComplexBlock.ts#standaloneComplexBlockMoveReasonText's
 * identical role for the move case, with its own dedicated
 * `reason.standaloneFencedCodeDelete*` keys (never reusing the move
 * feature's own `reason.standaloneMove*` keys, which read "...move was
 * cancelled" — actively misleading for a delete).
 */
export function standaloneComplexBlockDeleteReasonText(
  t: (key: TranslationKey) => string,
  reason: NoStandaloneComplexBlockDeleteReason | undefined
): string | undefined {
  if (!reason) return undefined;
  switch (reason) {
    case "not-supported":
      return t("reason.standaloneFencedCodeDeleteNotSupported");
    case "composite-member":
      return t("reason.standaloneFencedCodeDeleteCompositeMember");
    case "boundary-changed":
      return t("reason.standaloneFencedCodeDeleteBoundaryChanged");
    case "range-invalid":
      return t("reason.standaloneFencedCodeDeleteRangeInvalid");
  }
}
