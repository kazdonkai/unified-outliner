/**
 * Phase 5C-3 (2026-08-14): a pure function that safely swaps a standalone
 * (non-composite-member) callout/blockquote with the adjacent standalone
 * callout/blockquote in a given up/down direction, given the CURRENT
 * Markdown text and a snapshot of what the caller believes it selected.
 *
 * Deliberately, strictly mirrors edit/moveCompositeBlock.ts's own
 * "re-parse -> re-scan -> re-match -> snapshot照合 -> judge再評価 ->
 * resolver再解決 -> swapBlocks" design (Phase 5C-3 approval's own fixed
 * step order): this module has NO Obsidian dependency, calls no Editor API,
 * and is wired into view/OutlineTreeView.ts only via a thin dispatch
 * method, exactly like moveCompositeBlock's own relationship to
 * dispatchAndApplyCompositeMove.
 *
 * ---- Relationship to the judge/resolver layers ----
 *
 *   - parser/compositeBlocks.ts#evaluateStandaloneComplexBlockMovability
 *     (judge): may this standalone block move in this direction.
 *   - move/findStandaloneComplexBlockMoveTarget.ts#findStandaloneComplexBlockMoveTarget
 *     (resolver): given that it may, what is the exact LineRange to swap
 *     with.
 *   - moveStandaloneComplexBlock (this file, executor): given the caller's
 *     snapshot, re-verify identity against the CURRENT text and perform the
 *     swap via move/moveBlock.ts's existing swapBlocks primitive
 *     (UNCHANGED — no new swap logic is written here).
 *
 * ---- Why this function re-parses / re-scans / re-matches internally ----
 *
 * A ComplexBlockInfo's `callout-N`/`blockquote-N` id is "stable only within
 * a single scanComplexBlocks() call" (see model/complexBlock.ts's own
 * ComplexBlockInfo.id doc comment) — exactly the same reason
 * edit/deleteCompositeBlock.ts and edit/moveCompositeBlock.ts never trust a
 * bare id captured at Tree-render time. So this function takes the raw
 * CURRENT `text` and performs its own parseDocument -> scanComplexBlocks ->
 * matchCompositeBlocks pass (matchCompositeBlocks is needed here too,
 * despite this feature never touching a CompositeBlock itself, because
 * evaluateStandaloneComplexBlockMovability's own "not currently a composite
 * member" check requires a fresh composite-match result to check against —
 * see that function's own doc comment), then finds the ComplexBlockInfo
 * that matches the caller-supplied StandaloneComplexBlockSnapshot BY
 * STRUCTURE (kind, range, parentId) — never by `id` alone (see
 * snapshotMatches below, and StandaloneComplexBlockSnapshot.id's own doc
 * comment).
 *
 * ---- What this function does NOT do ----
 *
 * No blank-line cleanup before/after the swapped ranges beyond what
 * swapBlocks already preserves automatically, no Markdown reformatting/
 * renormalization of any kind, no content/text-hash comparison (a move
 * relocates whatever content currently sits at the re-verified structural
 * position — it is not a round-trip edit like the Partial Edit Pane, which
 * IS content-sensitive by design; see edit/partialEdit.ts's own conflict
 * check for that different concern). Every rejection path leaves `lines`
 * byte-identical to the input (`changed: false`).
 */
import { LineRange, ParsedDocument } from "../model/block";
import {
  ComplexBlockInfo,
  ComplexBlockKind,
  StandaloneComplexBlockMoveRejectionReason,
} from "../model/complexBlock";
import { CompositeBlockRule } from "../model/compositeBlock";
import { parseDocument } from "../parser/parseDocument";
import { scanComplexBlocks } from "../parser/complexBlocks";
import { evaluateStandaloneComplexBlockMovability, matchCompositeBlocks } from "../parser/compositeBlocks";
import {
  findStandaloneComplexBlockMoveTarget,
  StandaloneMoveDirection,
} from "../move/findStandaloneComplexBlockMoveTarget";
import { swapBlocks } from "../move/moveBlock";
import { LineEditOutcome } from "../commands/applyLineEditOutcome";
import { TranslationKey } from "../i18n";

/**
 * The ComplexBlockKind values a standalone complex-block move ever targets.
 * Phase 5C-3 originally scoped this to callout/blockquote only ("A案").
 * Phase 5E-1 ("fenced code block の raw Partial Edit・移動・削除") widens it
 * to also include "fenced-code" — reusing this exact same move pipeline
 * (findRangeInvalidReason/snapshotMatches/moveStandaloneComplexBlock below,
 * and isStandaloneComplexBlockShapeEligible/evaluateStandaloneComplexBlockMovability
 * in parser/compositeBlocks.ts) rather than writing a parallel fenced-code-
 * specific move engine. paragraph/table/thematic-break remain out of scope
 * — table in particular stays read-only, unchanged from Phase 5E-0.
 */
export type StandaloneComplexBlockMoveKind = Extract<ComplexBlockKind, "callout" | "blockquote" | "fenced-code">;

/**
 * A point-in-time capture of a standalone ComplexBlockInfo, taken by the
 * caller when the user selects it for a move — via
 * buildStandaloneComplexBlockSnapshot, applied to whatever ComplexBlockInfo
 * was resolved in the Tree at that moment. Moving NEVER trusts this
 * snapshot's fields as current truth by themselves: moveStandaloneComplexBlock
 * always re-derives a fresh ComplexBlockInfo from the CURRENT text and
 * compares it against every field here (see snapshotMatches) before acting.
 */
export interface StandaloneComplexBlockSnapshot {
  /**
   * The ComplexBlockInfo's own id AT SNAPSHOT TIME. Kept for caller
   * convenience/debugging/logging only — deliberately NEVER used as a
   * matching key by snapshotMatches (see this module's top doc comment for
   * why `callout-N`/`blockquote-N` ids cannot be trusted to survive a
   * re-parse). Per Phase 5C-3 approval's own explicit instruction: "id は
   * 診断用・ログ用の補助情報としてのみ扱ってください。"
   */
  id: string;
  kind: StandaloneComplexBlockMoveKind;
  range: LineRange;
  parentId: string | null;
}

/**
 * Projects a live, already-eligible ComplexBlockInfo into a
 * StandaloneComplexBlockSnapshot. This is the one intended way to build a
 * StandaloneComplexBlockMoveRequest's `snapshot` field — a caller should
 * never hand-construct one field-by-field. Returns `null` (rather than
 * throwing or silently coercing) when `info.kind` is not "callout" or
 * "blockquote" — defense-in-depth for a caller that hasn't already filtered
 * to Phase 5C-3's own eligible kind set (see
 * tree/buildOutlineTree.ts's isStandaloneComplexBlockEligible, which every
 * real caller has already applied before a Tree row exists to click at
 * all), matching this whole codebase's "resolve safely, never guess"
 * policy for an input shape this function cannot itself verify further.
 */
export function buildStandaloneComplexBlockSnapshot(info: ComplexBlockInfo): StandaloneComplexBlockSnapshot | null {
  // Phase 5E-1: widened to also accept "fenced-code" — see
  // StandaloneComplexBlockMoveKind's own updated doc comment above.
  if (info.kind !== "callout" && info.kind !== "blockquote" && info.kind !== "fenced-code") return null;
  return {
    id: info.id,
    kind: info.kind,
    range: { startLine: info.range.startLine, endLine: info.range.endLine },
    parentId: info.parentId,
  };
}

export interface StandaloneComplexBlockMoveRequest {
  snapshot: StandaloneComplexBlockSnapshot;
  direction: StandaloneMoveDirection;
  /**
   * Phase 5D-3B ("Composite Member Move Menu Parity"), default `false`:
   * passed straight through to evaluateStandaloneComplexBlockMovability's
   * own same-named parameter on every re-verification this function does
   * (see moveStandaloneComplexBlock's own doc comment below). `false` (or
   * omitted) reproduces this function's exact pre-5D-3B behavior — the
   * snapshot's block must still be standalone at Apply time, or the move is
   * safely refused with reason "composite-member". Set to `true` only by
   * the NEW composite-member Tree menu dispatch, to allow moving a block
   * that IS currently a matched CompositeBlock's own member. Never affects
   * which adjacent block is an eligible swap PARTNER — that stays
   * standalone-only regardless (see findStandaloneComplexBlockMoveTarget's
   * own doc comment).
   */
  allowComposedMember?: boolean;
}

/**
 * Every way moveStandaloneComplexBlock refuses to touch the note. The first
 * five values are EXACTLY model/complexBlock.ts's own
 * StandaloneComplexBlockMoveRejectionReason (the judge's own reasons,
 * re-run here against a FRESH parse/scan/match — never re-derived
 * differently). The last three mirror edit/moveCompositeBlock.ts's own
 * NoCompositeMoveReason additions for the request/re-resolution step this
 * function adds:
 *
 *   - "standalone-boundary-changed": the current text no longer contains a
 *     standalone complex block matching every field of the caller's
 *     snapshot (kind/range/parentId) — the structural analogue of
 *     moveCompositeBlock's own "composite-boundary-changed".
 *   - "range-invalid": the snapshot itself is not self-consistent, checked
 *     BEFORE attempting any match.
 *   - "no-target": defensive only, mirroring moveCompositeBlock's own
 *     "no-target" — should be unreachable given `eligible: true` from the
 *     SAME doc/complexScan/composites this function just computed, kept in
 *     this union anyway so a future change to either the judge or resolver
 *     that breaks this invariant fails safely (a reported reason) rather
 *     than silently.
 */
export type NoStandaloneComplexBlockMoveReason =
  | StandaloneComplexBlockMoveRejectionReason
  | "standalone-boundary-changed"
  | "range-invalid"
  | "no-target";

/**
 * moveStandaloneComplexBlock's result — a deliberate STRUCTURAL SUBTYPE of
 * commands/applyLineEditOutcome.ts's LineEditOutcome, exactly like
 * CompositeMoveOutcome. Never sets `newCursorCh` on success, for the same
 * reason CompositeMoveOutcome doesn't: a move is a swap, so the moved block
 * still exists afterward at a new line, and applyLineEditOutcome's default
 * "preserve the caller's relative offset within the block" behavior
 * already handles that correctly.
 */
export interface StandaloneComplexBlockMoveOutcome extends LineEditOutcome {
  reason?: NoStandaloneComplexBlockMoveReason;
}

function rejected(lines: string[], reason: NoStandaloneComplexBlockMoveReason): StandaloneComplexBlockMoveOutcome {
  return { changed: false, lines, newStartLine: -1, reason };
}

/**
 * Structural self-consistency check on `snapshot` alone, against the
 * CURRENT document's line count (`lineCount`) — deliberately checked
 * BEFORE any parse/scan/match attempt, mirroring
 * edit/moveCompositeBlock.ts's own findRangeInvalidReason. `kind` is also
 * defensively re-checked here (even though the type already narrows it) in
 * case a caller constructs a snapshot from untyped/deserialized data.
 */
export function findRangeInvalidReason(
  snapshot: StandaloneComplexBlockSnapshot,
  lineCount: number
): "range-invalid" | null {
  // Phase 5E-1: widened to also accept "fenced-code" — see
  // StandaloneComplexBlockMoveKind's own updated doc comment above.
  if (snapshot.kind !== "callout" && snapshot.kind !== "blockquote" && snapshot.kind !== "fenced-code") {
    return "range-invalid";
  }
  const { startLine, endLine } = snapshot.range;
  if (startLine < 0 || endLine < startLine || endLine >= lineCount) return "range-invalid";
  return null;
}

/**
 * True when `info` (a freshly re-scanned ComplexBlockInfo) is, structurally,
 * the SAME standalone block `snapshot` describes — kind, range, and
 * parentId, per Phase 5C-3 approval's explicit "再照合の主キーは id ではなく
 * kind / range / parentId の構造一致にしてください" instruction. Deliberately
 * excludes `id` (see StandaloneComplexBlockSnapshot.id's own doc comment)
 * and deliberately excludes any body-text comparison (see this module's top
 * doc comment for why a move is not content-sensitive the way Partial Edit
 * is).
 *
 * Exported (Phase 5D-3C, "Callout and Blockquote Drag and Drop") so
 * edit/dropStandaloneComplexBlock.ts can reuse this EXACT same
 * structural-match predicate for its own drop-time source re-resolution —
 * D&D's snapshot re-verification contract is deliberately identical to
 * Move's own (see this ticket's approval: "Drag and Drop の source
 * snapshot は、既存 Move の StandaloneComplexBlockSnapshot を再利用するか、
 * それと同じ契約を守る専用 snapshot とする"), so this predicate must never
 * drift between the two features.
 */
export function snapshotMatches(snapshot: StandaloneComplexBlockSnapshot, info: ComplexBlockInfo): boolean {
  if (info.kind !== snapshot.kind) return false;
  if (info.range.startLine !== snapshot.range.startLine || info.range.endLine !== snapshot.range.endLine) {
    return false;
  }
  if (info.parentId !== snapshot.parentId) return false;
  return true;
}

/**
 * Swaps the standalone complex block described by `request.snapshot` with
 * the adjacent standalone callout/blockquote in `request.direction`, in
 * `text` — or returns `changed: false` (original `lines` byte-for-byte
 * unchanged) with a stable `reason` when it cannot safely do so.
 *
 * `request.allowComposedMember` (Phase 5D-3B, default `false`, threaded
 * unchanged into both the judge and resolver calls below): the ONLY thing
 * this whole function does differently when it is `true` is that the
 * `snapshot`'s block is allowed to currently be a matched CompositeBlock's
 * own member. Every other step below — parse/scan/match, snapshotMatches,
 * the adjacency scan, `swapBlocks` itself — is completely unaffected; the
 * function's title ("swaps the standalone complex block... with the
 * adjacent standalone callout/blockquote") still accurately describes the
 * adjacent CANDIDATE side even when `allowComposedMember` is `true`, since
 * that side is never widened.
 *
 * Steps (fixed order per Phase 5C-3 approval):
 *   1. `findRangeInvalidReason` on the snapshot alone — "range-invalid" on
 *      failure.
 *   2. `parseDocument` -> `scanComplexBlocks` -> `matchCompositeBlocks`
 *      (fresh, against `rules` — the CALLER's currently-enabled rule set),
 *      then find the ComplexBlockInfo matching `snapshot` via
 *      `snapshotMatches`. "standalone-boundary-changed" if none matches.
 *   3. `evaluateStandaloneComplexBlockMovability(doc, complexScan, resolved,
 *      direction, composites, allowComposedMember)` (the judge). `eligible:
 *      false` -> that exact `reason`.
 *   4. `findStandaloneComplexBlockMoveTarget(doc, complexScan, resolved,
 *      direction, composites, allowComposedMember)` (the resolver), re-run
 *      against the SAME doc/complexScan/composites step 3 just used. `null`
 *      -> "no-target" (defensive; see NoStandaloneComplexBlockMoveReason's
 *      own doc comment
 *      for why this should be unreachable in practice).
 *   5. `move/moveBlock.ts#swapBlocks(lines, resolved.range, target.range)`
 *      — UNCHANGED, existing primitive. Returns `changed: true` with the
 *      moved block's own new start line.
 */
export function moveStandaloneComplexBlock(
  text: string,
  request: StandaloneComplexBlockMoveRequest,
  rules: CompositeBlockRule[]
): StandaloneComplexBlockMoveOutcome {
  const doc: ParsedDocument = parseDocument(text);
  const lines = doc.lines;
  const { snapshot, direction, allowComposedMember = false } = request;

  const rangeInvalidReason = findRangeInvalidReason(snapshot, lines.length);
  if (rangeInvalidReason) {
    return rejected(lines, rangeInvalidReason);
  }

  const complexScan = scanComplexBlocks(doc);
  const composites = matchCompositeBlocks(doc, complexScan, rules);

  const resolved = complexScan.blocks.find((b) => snapshotMatches(snapshot, b));
  if (!resolved) {
    return rejected(lines, "standalone-boundary-changed");
  }

  const movability = evaluateStandaloneComplexBlockMovability(
    doc,
    complexScan,
    resolved,
    direction,
    composites,
    allowComposedMember
  );
  if (!movability.eligible) {
    return rejected(lines, movability.reason);
  }

  const target = findStandaloneComplexBlockMoveTarget(
    doc,
    complexScan,
    resolved,
    direction,
    composites,
    allowComposedMember
  );
  if (!target) {
    return rejected(lines, "no-target");
  }

  const sourceRange: LineRange = { startLine: resolved.range.startLine, endLine: resolved.range.endLine };
  const { lines: outLines, newStartOfA } = swapBlocks(lines, sourceRange, target.range);

  return { changed: true, lines: outLines, newStartLine: newStartOfA };
}

/**
 * Translates a standalone-complex-block-move rejection reason into the
 * current locale — the single, shared mapping every caller of
 * moveStandaloneComplexBlock uses, mirroring
 * edit/moveCompositeBlock.ts#compositeMoveReasonText's own role for the
 * composite feature. `t` is passed in rather than a Plugin/View instance so
 * this stays Obsidian-independent.
 *
 * Every value gets its OWN dedicated `reason.standaloneMove*` key rather
 * than falling through to a shared "reason." + reason pattern or reusing
 * any of moveCompositeBlock's own `reason.compositeMove*` keys — per Phase
 * 5C-3 approval's explicit "composite 前提の文言流用は避けてください"
 * instruction (several of composite move's own keys read "拡張ブロック" /
 * "extended block" in their wording, which would be misleading for a
 * standalone callout/blockquote that was never part of any CompositeBlock).
 */
export function standaloneComplexBlockMoveReasonText(
  t: (key: TranslationKey) => string,
  reason: NoStandaloneComplexBlockMoveReason | undefined
): string | undefined {
  if (!reason) return undefined;
  switch (reason) {
    case "not-supported":
      return t("reason.standaloneMoveNotSupported");
    case "composite-member":
      return t("reason.standaloneMoveCompositeMember");
    case "nested-in-list":
      return t("reason.standaloneMoveNestedInList");
    case "no-adjacent-compatible-unit":
      return t("reason.standaloneMoveNoAdjacentUnit");
    case "different-section":
      return t("reason.standaloneMoveDifferentSection");
    case "standalone-boundary-changed":
      return t("reason.standaloneMoveBoundaryChanged");
    case "range-invalid":
      return t("reason.standaloneMoveRangeInvalid");
    case "no-target":
      return t("reason.standaloneMoveNoTarget");
  }
}
