/**
 * Phase 5T-3A ("paragraph non-adjacent move の最小実装"): a pure function
 * that moves a Tree-displayed paragraph to a NON-adjacent position within
 * the same safe sibling group (same parentId/depth), by cutting it out and
 * re-inserting it before/after another paragraph or standalone complex
 * block (callout/blockquote) sibling — in exactly ONE edit, never as a
 * sequence of adjacent swaps. This is Phase 5T-3D's design (see
 * docs/phase5t3_non_adjacent_paragraph_move_design.md) turned into code;
 * see that document for the full design rationale (案A vs 案B vs 案C, the
 * `insertBlockAt` auto-offset-correction finding, the blank-line-insertion
 * requirement) — this file's own doc comments cover only the
 * implementation-level detail that document didn't already fix in place.
 *
 * ---- Reused unchanged ----
 *
 *   - `edit/paragraphTreeMove.ts#resolveAnchorUnit` — the SOURCE side's
 *     existing three-stage (id-candidate / structural / content +
 *     document-wide ambiguity) re-resolution contract, exported from that
 *     module for this reuse. Source is always a paragraph in this phase
 *     (ticket §1: "source は paragraph node"), so this file never needs a
 *     paragraph-specific variant of its own.
 *   - `move/moveBlock.ts#insertBlockAt` — the generic cut-and-reinsert
 *     primitive. Its own internal offset self-correction already answers
 *     the design doc's "does target range shift after source removal need
 *     tail-first processing" question (no) — this file passes it ORIGINAL
 *     (pre-cut) line numbers exactly as its own doc comment requires, and
 *     never relies on its silent "target falls inside source" clamp
 *     branch: overlap is rejected explicitly, below, before this is ever
 *     called.
 *
 * ---- New in this file ----
 *
 *   - `resolveTargetAnchor` — the TARGET side's own three-stage
 *     re-resolution, symmetric to `resolveAnchorUnit` but generalized over
 *     `ComplexBlockKind` (a target may be a paragraph OR a standalone
 *     callout/blockquote — ticket §1), whereas `resolveAnchorUnit` is
 *     paragraph-only. Design doc §5-1's explicit requirement: target gets
 *     the SAME rigor as source (content-byte match + document-wide
 *     ambiguity check), not just `resolveParagraphFromTreeHint`'s weaker
 *     structural-hint-only match (that function is 5T-2's D&D-only
 *     dragover hint resolver and is never reused here).
 *   - `ensureBlankSeparation` — the new, paragraph-specific safety rule
 *     design doc §5-2 requires: parser/complexBlocks.ts#scanParagraphBlocks
 *     defines a paragraph purely as "a run of consecutive lines that are
 *     each individually a `isCandidate` line" (not blank, not a heading,
 *     not a list marker — see that function's own doc comment). Critically,
 *     `isCandidate` does NOT exclude `>`-prefixed (callout/blockquote) or
 *     pipe-table-row-shaped lines either — only blank/heading/list lines
 *     break a paragraph-candidate run. So inserting a moved paragraph
 *     directly adjacent (no blank line) to ANY other non-blank,
 *     non-heading, non-list-marker line — another paragraph, OR a
 *     callout/blockquote's own quote-prefixed line — would let
 *     scanParagraphBlocks' candidate loop sweep both together into ONE
 *     paragraph-candidate range, which then overlaps the neighbor's own
 *     (higher-priority, for callout/blockquote) recognized range and gets
 *     downgraded to "ambiguous" by mergeBlockRangesSafely's overlap policy
 *     — corrupting recognition of the moved paragraph itself, not just
 *     failing to keep it separate. `ensureBlankSeparation` inserts a blank
 *     line on either side of the moved block whenever the adjacent line is
 *     non-blank and not a heading/list-marker line (the only three
 *     boundary types scanParagraphBlocks' own `isCandidate` already
 *     recognizes as breaking a candidate run) — deliberately NOT scoped to
 *     "only when the neighbor happens to be another paragraph", since the
 *     entanglement risk above applies identically to a callout/blockquote
 *     neighbor's own quote-prefixed line.
 *
 * ---- Deliberately out of scope (ticket §2) ----
 *
 * paragraph↔list cross-model move, crossing a section/list-item boundary,
 * parent change, child drop, indent/outdent, paragraph rename/delete/
 * insert, Tree Partial Edit, D&D for this operation, `parseDocument.ts`
 * changes, `ParsedDocument.nodes` changes, and any change to the existing
 * 5T-1/5T-2/5T-2S adjacent-move contracts. This file imports nothing from
 * `move/relocateSection.ts`/`move/relocateListSubtree.ts` and does not
 * touch `parser/parseDocument.ts`.
 *
 * [2026-09-24 追記, feat/paragraph-dnd-cross-section] The "crossing a
 * section/list-item boundary" exclusion directly above described this
 * file's ORIGINAL (5T-3A) scope and is kept verbatim for history, but no
 * longer reflects current behavior for the section-boundary half of it
 * (list-item boundary crossing remains out of scope — see
 * docs/feat_paragraph-dnd-cross-section-design-memo.md's own "Move との
 * 整合性" note). `moveParagraphNonAdjacent` no longer rejects a target
 * whose `parentId` differs from the source's own `parentId`
 * ("parent-mismatch"/"depth-mismatch" are no longer returned by this
 * function, though both reason values are kept in `NonAdjacentMoveReason`
 * and `paragraphNonAdjacentMoveReasonText` for i18n-key backward
 * compatibility) — following the EXACT same design already shipped for
 * standalone-complex-block D&D
 * (move/findStandaloneComplexBlockDropTarget.ts#resolveStandaloneComplexBlockDropTarget,
 * commit 6938898, feat/standalone-complex-dnd-cross-section, not yet
 * merged to main at the time of this addendum): cut the source's own line
 * range via the existing `insertBlockAt` primitive, insert at the
 * target-derived `insertBeforeLine`, and let re-parsing resolve the moved
 * paragraph's new `parentId` naturally — no `parentId` is ever written or
 * read back out of this function. `listNonAdjacentMoveTargets` (the
 * context-menu "指定 sibling の前へ/後へ" picker's own candidate list) is
 * DELIBERATELY NOT widened by this addendum and still only lists
 * same-parentId/same-depth siblings — see the design memo for why: this
 * ticket's own scope note explicitly excludes Move menu-command
 * cross-section support, and `deleteParagraph.ts` also reuses this same
 * function for an unrelated purpose (safe-delete sibling-group
 * computation) that must not change shape either. Only the D&D adapter in
 * view/OutlineTreeView.ts (`resolveParagraphNonAdjacentDragTarget`'s own
 * same-parentId preview gate) was widened to match this function's new
 * permissiveness.
 *
 * This addendum also adds a NEW safety check this file never had before,
 * for either same-section or cross-section moves: `moveParagraphNonAdjacent`
 * now takes an optional `rules: CompositeBlockRule[]` parameter (default
 * `[]`, so every pre-existing call site that does not pass it keeps its
 * exact prior behavior) and rejects, as `"composite-internal-boundary"`,
 * an `insertBeforeLine` that would land strictly inside any
 * CompositeBlockInfo's own aggregate range — mirroring
 * resolveStandaloneComplexBlockDropTarget's own identically-named guard.
 * This file's original design (5T-3A) never re-derived `CompositeBlockInfo`
 * at all, unlike edit/deleteParagraph.ts's own `matchCompositeBlocks`
 * call for its "composite-member" source guard — that gap is now closed
 * for the DESTINATION side only (a moved paragraph landing inside a
 * composite's own aggregate range), not for the SOURCE side (moving a
 * paragraph that is itself a composite member) — see the design memo's
 * own "既知の制約" section for why the source-side gap is left as-is by
 * this ticket.
 */
import { ParsedDocument } from "../model/block";
import { ComplexBlockInfo, ComplexBlockKind, ComplexBlockScanResult } from "../model/complexBlock";
import { CompositeBlockRule } from "../model/compositeBlock";
import { complexBlockDepth, scanComplexBlocks } from "../parser/complexBlocks";
import { matchCompositeBlocks } from "../parser/compositeBlocks";
import { isBlankLine, parseDocument } from "../parser/parseDocument";
import { insertBlockAt } from "../move/moveBlock";
import { LineEditOutcome } from "../commands/applyLineEditOutcome";
import { TranslationKey } from "../i18n";
import {
  NoParagraphTreeMoveReason,
  ParagraphMoveAnchor,
  resolveAnchorUnit,
} from "./paragraphTreeMove";

/** Every ComplexBlockKind this phase allows as a non-adjacent move TARGET (ticket §1: "target は同一 parentId / 同一 depth の sibling 群" restricted to "paragraph または standalone complex block sibling"). Deliberately narrower than the full ComplexBlockKind union — fenced-code/table/thematic-break are not offered by the UI and are rejected defensively if ever passed in (see buildSiblingTargetAnchor). */
export const NON_ADJACENT_TARGET_KINDS: readonly ComplexBlockKind[] = ["paragraph", "callout", "blockquote"];

/**
 * The insertion side of a non-adjacent move: "before" places the source
 * immediately ahead of the target's own current position, "after"
 * immediately behind it — both defined relative to the TARGET's position,
 * exactly like `move/relocateSection.ts#DropMode`'s existing before/after
 * meaning, and matching design doc §5-2's own definition.
 */
export type NonAdjacentMovePosition = "before" | "after";

/**
 * A point-in-time capture of a TARGET candidate (paragraph or standalone
 * complex block), analogous to `ParagraphMoveAnchor` but generalized over
 * kind. Built once, at Tree menu-build time, from a live `ComplexBlockInfo`
 * — never persisted, never hand-constructed field-by-field (see
 * `buildSiblingTargetAnchor`).
 */
export interface SiblingTargetAnchor {
  kind: ComplexBlockKind;
  complexBlockId: string;
  parentId: string | null;
  depth: number;
  originalText: string;
  rangeStart: number;
  rangeEnd: number;
}

function extractText(doc: ParsedDocument, startLine: number, endLine: number): string {
  return doc.lines.slice(startLine, endLine + 1).join("\n");
}

/**
 * Projects a live, already-eligible `ComplexBlockInfo` into a
 * `SiblingTargetAnchor`. Returns `null` when `info` is not eligible as a
 * non-adjacent-move target: wrong kind (not in `NON_ADJACENT_TARGET_KINDS`)
 * or `editability !== "supported"` — the same "return null rather than
 * guess" convention `buildParagraphMoveAnchor` already uses.
 */
export function buildSiblingTargetAnchor(
  doc: ParsedDocument,
  info: ComplexBlockInfo
): SiblingTargetAnchor | null {
  if (!NON_ADJACENT_TARGET_KINDS.includes(info.kind)) return null;
  if (info.editability !== "supported") return null;
  return {
    kind: info.kind,
    complexBlockId: info.id,
    parentId: info.parentId,
    depth: complexBlockDepth(doc, info.parentId),
    originalText: extractText(doc, info.range.startLine, info.range.endLine),
    rangeStart: info.range.startLine,
    rangeEnd: info.range.endLine,
  };
}

/**
 * Every eligible sibling (same parentId/depth as `sourceParentId`/
 * `sourceDepth`, kind in `NON_ADJACENT_TARGET_KINDS`, `editability ===
 * "supported"`) EXCLUDING the source's own range — in document order. Used
 * by the Tree menu to populate "move to top"/"move to bottom" (first/last
 * of this list) and the "指定 sibling の前へ/後へ" picker (every entry).
 * Purely a menu-time convenience list — like every other `currentDoc`/
 * `currentComplexScan`-derived eligibility check in this codebase, it is
 * NEVER itself a green light to write to the note; the actual move always
 * re-resolves both source and target independently at execution time (see
 * `moveParagraphNonAdjacent`).
 */
export function listNonAdjacentMoveTargets(
  scan: ComplexBlockScanResult,
  sourceRange: { startLine: number; endLine: number },
  sourceParentId: string | null,
  sourceDepth: number,
  doc: ParsedDocument
): ComplexBlockInfo[] {
  return scan.blocks
    .filter((b) => NON_ADJACENT_TARGET_KINDS.includes(b.kind))
    .filter((b) => b.editability === "supported")
    .filter((b) => b.parentId === sourceParentId)
    .filter((b) => complexBlockDepth(doc, b.parentId) === sourceDepth)
    .filter((b) => !(b.range.startLine === sourceRange.startLine && b.range.endLine === sourceRange.endLine))
    .sort((a, b) => a.range.startLine - b.range.startLine);
}

/**
 * Every way `moveParagraphNonAdjacent` refuses to touch the note.
 *
 * The first four reuse `NoParagraphTreeMoveReason`'s SOURCE-side values
 * verbatim (via `resolveAnchorUnit`) — "resolve-failed"/"identity-changed"/
 * "content-changed"/"ambiguous-match" always describe the SOURCE anchor
 * when they appear here (a paragraph is always the source in this phase).
 * The `target-*` values are this file's own, symmetric TARGET-side
 * re-resolution failures (see `resolveTargetAnchor`) — kept as distinct
 * keys, rather than reusing the source-side names again, so a no-op
 * message can unambiguously say WHICH side failed re-resolution.
 */
export type NonAdjacentMoveReason =
  | NoParagraphTreeMoveReason
  | "target-resolve-failed"
  | "target-identity-changed"
  | "target-content-changed"
  | "target-ambiguous-match"
  | "self-target"
  | "parent-mismatch"
  | "depth-mismatch"
  | "range-overlap"
  | "composite-internal-boundary";

export interface ParagraphNonAdjacentMoveOutcome extends LineEditOutcome {
  reason?: NonAdjacentMoveReason;
}

function rejected(lines: string[], reason: NonAdjacentMoveReason): ParagraphNonAdjacentMoveOutcome {
  return { changed: false, lines, newStartLine: -1, reason };
}

type ResolveTargetResult =
  | { ok: true; info: ComplexBlockInfo }
  | {
      ok: false;
      reason: "target-resolve-failed" | "target-identity-changed" | "target-content-changed" | "target-ambiguous-match";
    };

/**
 * The TARGET side's own three-stage re-resolution — symmetric to
 * `resolveAnchorUnit`, but over `NON_ADJACENT_TARGET_KINDS` instead of
 * "paragraph" only. See this file's top doc comment for why this cannot
 * simply reuse `resolveParagraphFromTreeHint` (that function has no
 * content-byte match / document-wide ambiguity check at all — 5T-2's D&D
 * only ever needed a structural hint match, because D&D's own
 * `resolveParagraphDropDirection` additionally requires the target to be a
 * TRUE ADJACENT SIBLING of the freshly re-resolved source, which by itself
 * already rules out the "wrong duplicate" ambiguity a non-adjacent target
 * can't rely on).
 */
function resolveTargetAnchor(
  doc: ParsedDocument,
  scan: ComplexBlockScanResult,
  anchor: SiblingTargetAnchor
): ResolveTargetResult {
  const eligible = scan.blocks.filter(
    (b) => NON_ADJACENT_TARGET_KINDS.includes(b.kind) && b.editability === "supported"
  );

  const idCandidate = eligible.find((b) => b.id === anchor.complexBlockId && b.kind === anchor.kind);
  if (!idCandidate) {
    return { ok: false, reason: "target-resolve-failed" };
  }

  const candidateDepth = complexBlockDepth(doc, idCandidate.parentId);
  if (idCandidate.parentId !== anchor.parentId || candidateDepth !== anchor.depth) {
    return { ok: false, reason: "target-identity-changed" };
  }

  const candidateText = extractText(doc, idCandidate.range.startLine, idCandidate.range.endLine);
  if (candidateText !== anchor.originalText) {
    return { ok: false, reason: "target-content-changed" };
  }

  const allMatches = eligible.filter((b) => {
    if (b.kind !== anchor.kind) return false;
    if (b.parentId !== anchor.parentId) return false;
    if (complexBlockDepth(doc, b.parentId) !== anchor.depth) return false;
    return extractText(doc, b.range.startLine, b.range.endLine) === anchor.originalText;
  });
  if (allMatches.length > 1) {
    return { ok: false, reason: "target-ambiguous-match" };
  }

  return { ok: true, info: idCandidate };
}

function rangesOverlap(
  a: { startLine: number; endLine: number },
  b: { startLine: number; endLine: number }
): boolean {
  return a.startLine <= b.endLine && b.startLine <= a.endLine;
}

// Byte-identical duplicates of parser/complexBlocks.ts's own HEADING_RE/
// LIST_RE — same "duplicated, not imported" policy that file's own top doc
// comment already establishes for its copies of parser/parseDocument.ts's
// regexes (touching either of those two files is out of this phase's
// scope). Used only to recognize the two boundary-line shapes that already
// safely terminate a paragraph-candidate run on their own — see
// `ensureBlankSeparation`'s own doc comment.
const HEADING_RE = /^(#{1,6})[ \t]+(.*)$/;
const LIST_RE = /^([ \t]*)([-*+]|\d+[.)])(?:[ \t]+.*)?$/;

/**
 * True when a blank line must be inserted between the moved paragraph and
 * `neighborLine` to keep `scanParagraphBlocks` from sweeping them into one
 * candidate range (see this file's top doc comment). `undefined` means "no
 * neighbor at all" (moved block now sits at the very start/end of the
 * document) — never needs a separator.
 */
function needsSeparatingBlankLine(neighborLine: string | undefined): boolean {
  if (neighborLine === undefined) return false;
  if (isBlankLine(neighborLine)) return false;
  if (HEADING_RE.test(neighborLine)) return false;
  if (LIST_RE.test(neighborLine)) return false;
  return true;
}

/**
 * Pure post-processing step applied to the `lines[]` `insertBlockAt` just
 * produced: inserts a blank line immediately after the moved block first
 * (an index past the block's own end, so it never disturbs `start`/the
 * block's own content), then immediately before it (which DOES shift
 * `start` by one — applied second, and only this one adjusts the returned
 * `newStart`). Never touches any line more than the minimum needed: each
 * side is checked, and only inserted, independently — a moved block that
 * already sits next to a heading/list-marker/blank line, or at a document
 * boundary, gets no extra blank line on that side at all (design doc
 * §5-2's "既存 Markdown を不必要に膨らませない" / "不要な空行は増やさない").
 */
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

/**
 * Moves the paragraph described by `sourceAnchor` to a non-adjacent
 * position `position` ("before"/"after") relative to `targetAnchor`, in
 * `text` — or returns `changed: false` (original `lines` byte-for-byte
 * unchanged) with a stable `reason` when it cannot safely do so.
 *
 * Fixed step order (design doc §5-1/§5-2):
 *
 *   1. Re-resolve SOURCE via `resolveAnchorUnit` (unchanged 5T-1 contract)
 *      -> "resolve-failed"/"identity-changed"/"content-changed"/
 *      "ambiguous-match".
 *   2. Re-resolve TARGET via `resolveTargetAnchor` (this file's new,
 *      symmetric contract) -> "target-*" reasons.
 *   3. Reject "self-target" (source and target resolved to the exact same
 *      range — can happen if a caller passes the same block as both,
 *      including via two different SiblingTargetAnchor/ParagraphMoveAnchor
 *      captures of what turns out to be the same live block).
 *   4. [SUPERSEDED 2026-09-24, feat/paragraph-dnd-cross-section — see this
 *      file's own top doc comment addendum] `source.parentId` no longer
 *      needs to equal `target.parentId`, and no depth check is performed
 *      either — cross-section moves are allowed, so both rejections
 *      (formerly "parent-mismatch"/"depth-mismatch" here) are skipped
 *      entirely. Numbering below keeps its original slots to minimize
 *      churn in cross-references to it.
 *   5. Reject "range-overlap" — the one case this function must catch
 *      itself rather than leaning on `insertBlockAt`'s own silent
 *      mid-source clamp (design doc §5-2's explicit warning against
 *      relying on that).
 *   5b. [2026-09-24 追記, feat/paragraph-dnd-cross-section] Reject
 *      "composite-internal-boundary" when the computed `insertBeforeLine`
 *      would land strictly inside any `CompositeBlockInfo` from
 *      `matchCompositeBlocks(doc, scan, rules)` — mirrors
 *      resolveStandaloneComplexBlockDropTarget's own identically-named
 *      guard (move/findStandaloneComplexBlockDropTarget.ts). `rules`
 *      defaults to `[]` (no composites ever matched, guard never fires)
 *      so every pre-existing call site that omits it keeps its exact
 *      prior behavior — see this file's own top doc comment addendum.
 *   6. `insertBlockAt(doc.lines, source.range, insertBeforeLine)` — a
 *      single cut-and-reinsert, ORIGINAL (pre-cut) line numbers, exactly
 *      as that function's own contract requires. `insertBeforeLine` is
 *      `target.range.startLine` for "before", `target.range.endLine + 1`
 *      for "after" — both naturally handle "target is the first/last
 *      sibling in the group" and "target is the very first/last block in
 *      the document/section/list-item" with no extra branching (design doc
 *      §5-2).
 *   7. `ensureBlankSeparation` — the new paragraph-specific merge-safety
 *      post-step (see this file's top doc comment).
 *
 * One call, one final `lines[]` -> exactly the "1操作=1編集=1Undo" contract
 * ticket §4 requires, once a caller feeds this outcome through the SAME
 * single-`replaceRange` `commands/applyLineEditOutcome.ts#applyLineEditOutcome`
 * every other move in this codebase already uses — no new CM6
 * undo-grouping mechanism is introduced or needed here.
 */
export function moveParagraphNonAdjacent(
  text: string,
  sourceAnchor: ParagraphMoveAnchor,
  targetAnchor: SiblingTargetAnchor,
  position: NonAdjacentMovePosition,
  rules: CompositeBlockRule[] = []
): ParagraphNonAdjacentMoveOutcome {
  const doc: ParsedDocument = parseDocument(text);
  const scan = scanComplexBlocks(doc);

  const sourceResolved = resolveAnchorUnit(doc, sourceAnchor);
  if (!sourceResolved.ok) {
    return rejected(doc.lines, sourceResolved.reason);
  }
  const source = sourceResolved.unit;

  const targetResolved = resolveTargetAnchor(doc, scan, targetAnchor);
  if (!targetResolved.ok) {
    return rejected(doc.lines, targetResolved.reason);
  }
  const target = targetResolved.info;

  if (source.range.startLine === target.range.startLine && source.range.endLine === target.range.endLine) {
    return rejected(doc.lines, "self-target");
  }

  // [2026-09-24, feat/paragraph-dnd-cross-section] The
  // `source.parentId !== target.parentId` -> "parent-mismatch" and
  // `sourceDepth !== targetDepth` -> "depth-mismatch" rejections that used
  // to live here have been REMOVED — see this file's own top doc comment
  // addendum for the full rationale. A cross-section move now falls
  // straight through to the range-overlap and composite-internal-boundary
  // checks below, exactly like the standalone-complex-block D&D precedent.

  if (rangesOverlap(source.range, target.range)) {
    return rejected(doc.lines, "range-overlap");
  }

  const insertBeforeLine = position === "before" ? target.range.startLine : target.range.endLine + 1;

  // [2026-09-24 追記, feat/paragraph-dnd-cross-section] New guard this
  // file never had before (for either same-section or cross-section
  // moves): reject a drop that would land strictly inside any existing
  // CompositeBlock's own aggregate range, mirroring
  // resolveStandaloneComplexBlockDropTarget's own "composite-internal-
  // boundary" check. `rules` defaults to `[]`, so `matchCompositeBlocks`
  // matches nothing and this loop is a no-op for any caller that has not
  // opted in by passing its enabled rule set. See this file's own top doc
  // comment addendum, and the design memo's "既知の制約" section, for why
  // this only guards the DESTINATION side (not source-side composite
  // membership).
  const composites = matchCompositeBlocks(doc, scan, rules);
  for (const composite of composites) {
    if (insertBeforeLine > composite.range.startLine && insertBeforeLine <= composite.range.endLine) {
      return rejected(doc.lines, "composite-internal-boundary");
    }
  }

  const { lines: cutLines, newStart } = insertBlockAt(doc.lines, source.range, insertBeforeLine);
  const blockLength = source.range.endLine - source.range.startLine + 1;
  const separated = ensureBlankSeparation(cutLines, newStart, blockLength);

  return { changed: true, lines: separated.lines, newStartLine: separated.newStart };
}

/**
 * Translates a non-adjacent-move rejection reason into the current locale —
 * mirrors `edit/paragraphTreeMove.ts#paragraphTreeMoveReasonText`'s
 * identical role for the adjacent-move case. The four source-side reasons
 * resolve to the SAME existing `reason.paragraphTreeMove*` keys that
 * function already uses (they describe the identical situation — a
 * paragraph anchor failing to re-resolve — regardless of which move
 * command triggered it); only the `target-*`/`self-target`/
 * `parent-mismatch`/`depth-mismatch`/`range-overlap`/
 * `composite-internal-boundary` (added 2026-09-24,
 * feat/paragraph-dnd-cross-section) reasons need NEW keys.
 */
export function paragraphNonAdjacentMoveReasonText(
  t: (key: TranslationKey) => string,
  reason: NonAdjacentMoveReason | undefined
): string | undefined {
  if (!reason) return undefined;
  switch (reason) {
    case "resolve-failed":
      return t("reason.paragraphTreeMoveResolveFailed");
    case "identity-changed":
      return t("reason.paragraphTreeMoveIdentityChanged");
    case "content-changed":
      return t("reason.paragraphTreeMoveContentChanged");
    case "ambiguous-match":
      return t("reason.paragraphTreeMoveAmbiguous");
    case "target-resolve-failed":
      return t("reason.paragraphNonAdjacentTargetResolveFailed");
    case "target-identity-changed":
      return t("reason.paragraphNonAdjacentTargetIdentityChanged");
    case "target-content-changed":
      return t("reason.paragraphNonAdjacentTargetContentChanged");
    case "target-ambiguous-match":
      return t("reason.paragraphNonAdjacentTargetAmbiguous");
    case "self-target":
      return t("reason.paragraphNonAdjacentSelfTarget");
    case "parent-mismatch":
      return t("reason.paragraphNonAdjacentParentMismatch");
    case "depth-mismatch":
      return t("reason.paragraphNonAdjacentDepthMismatch");
    case "range-overlap":
      return t("reason.paragraphNonAdjacentRangeOverlap");
    case "composite-internal-boundary":
      return t("reason.paragraphNonAdjacentCompositeInternalBoundary");
    default:
      return t(("reason." + reason) as TranslationKey);
  }
}
