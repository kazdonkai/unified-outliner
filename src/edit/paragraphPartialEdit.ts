/**
 * Phase 5P-2: Apply-time counterpart to
 * resolver/resolveParagraphAtCursor.ts — the "load" side of paragraph
 * Partial Edit hoist. This module is the only place that ever splices an
 * edited paragraph's text back into a note.
 *
 * Deliberately NOT built on edit/partialEdit.ts's
 * extractSubtreeText/applySubtreeEdit (both left completely unchanged by
 * this ticket): those two resolve purely by id against a fresh scan/parse
 * — sufficient for a section/list (a stable BlockNode id) or a standalone
 * callout/blockquote (re-verified only by id + editability + a
 * byte-for-byte content compare). A paragraph has no persistent id at all
 * (Markdown text is this plugin's only source of truth — see
 * docs/phase5p_paragraph-block-foundation-plan.md) and — unlike
 * callout/blockquote — is explicitly required to also survive re-parenting
 * detection: an id could coincidentally still resolve to A paragraph after
 * the note changed elsewhere, and its text could even coincidentally still
 * match, while its STRUCTURAL position moved (e.g. a new heading inserted
 * directly above an otherwise byte-identical paragraph changes its
 * parentId/depth without changing a single character of its own text) —
 * see this module's applyParagraphEdit doc comment for the full contract
 * this guards against.
 *
 * ---- Phase 5P-4 supplement: id-instability across a paragraph<->paragraph
 * swap (this module's own persistent-anchor fix) ----
 *
 * The Partial Edit Pane holds a `ParagraphEditAnchor` for as long as it
 * stays open — unlike edit/paragraphTreeMove.ts's `ParagraphMoveAnchor`,
 * which is built and consumed within a single, effectively atomic
 * command. In that window, `complexBlockId`
 * (parser/complexBlocks.ts's `paragraph-${seq++}`, a per-scan sequence
 * number, never a persistent id) can silently start pointing at a
 * DIFFERENT paragraph: Phase 5P-4's own "Move block up/down" swaps two
 * adjacent same-parent paragraphs by exchanging their POSITIONS, which
 * re-numbers every paragraph-kind candidate from that point on in scan
 * order. A stale id-only lookup can therefore resolve to the wrong
 * paragraph (or to none at all) even though the pane's own target is
 * still sitting safely in the note, merely repositioned.
 *
 * `applyParagraphEdit` below fixes this by never trusting
 * `complexBlockId` alone. It is kept only as a fast first-choice lookup
 * (requirement: still cheap for the overwhelmingly common "nothing moved"
 * case) — see the "Two-pass identity resolution" section of this
 * function's own doc comment for the full algorithm and the reasoning
 * behind each of its outcomes. `ParagraphEditAnchor.siblingCount` (new
 * field, populated by the new `buildParagraphEditAnchor` builder below)
 * exists solely to support this: it lets a failed content-match tell "the
 * paragraph population under this parent is exactly what it was — the
 * text itself must have changed" apart from "something was inserted,
 * removed, split, or merged nearby — identity can no longer be safely
 * attributed", without needing a persistent id at all (deliberately out
 * of scope this round — see docs/phase5p_paragraph-block-foundation-
 * plan.md and this ticket's own explicit exclusion list).
 *
 * Safety contract (5P-2 ticket §4, extended by the above): Apply never
 * trusts the cursor position or the anchor's own line numbers — the
 * caller always re-parses the CURRENT note fresh and hands the resulting
 * ParsedDocument here, where this module re-scans it and re-resolves the
 * SAME logical paragraph. Any disagreement no-ops (byte-identical `lines`)
 * with a distinct, typed reason rather than guessing which paragraph the
 * user meant. On success, the replacement always covers EXACTLY the
 * re-resolved paragraph's own range — nothing before or after it is ever
 * touched, so an adjacent heading/list/callout/blockquote/fence/table can
 * never be affected by an Apply.
 */
import { ParsedDocument } from "../model/block";
import { ComplexBlockInfo } from "../model/complexBlock";
import { complexBlockDepth, scanComplexBlocks } from "../parser/complexBlocks";

/**
 * Captured once, at load time, via `buildParagraphEditAnchor` below — see
 * that function's own doc comment for how each field is derived. Never
 * persisted beyond the Partial Edit Pane's own in-memory session; never
 * written to the note or to plugin settings.
 */
export interface ParagraphEditAnchor {
  complexBlockId: string;
  parentId: string | null;
  depth: number;
  /**
   * The pane's "before editing" snapshot — compared byte-for-byte against
   * the freshly re-extracted text at Apply time, exactly like
   * edit/partialEdit.ts's applySubtreeEdit.
   */
  originalText: string;
  /**
   * Phase 5P-4 supplement: the number of "supported" paragraph-kind
   * siblings under `parentId`/`depth` at the moment this anchor was built
   * (this paragraph included). Used only to distinguish, at Apply time, a
   * pure content edit (population unchanged) from a structural change
   * nearby (population changed) once a byte-for-byte content match can no
   * longer be found — see `applyParagraphEdit`'s own doc comment.
   */
  siblingCount: number;
  /**
   * Phase 5A-1 hardening §5 ("paragraph reload / stale resolution
   * hardening", read-only-only — see `resolveParagraphAnchorText`'s own
   * "Pass 3" section below for the full contract): this paragraph's own
   * 0-based position, at anchor-build time, among the same
   * `supportedParagraphCandidates`-filtered, document-order array
   * `siblingCount` is also derived from. `-1` only in the defensive case
   * where a caller hands `buildParagraphEditAnchor` a `complexBlocks`
   * array that does not actually contain `resolved.complexBlockId` at
   * all (should not happen for any real caller in this codebase, which
   * always builds the anchor from a scan that includes the paragraph
   * itself) — Pass 3 below treats `-1` as never eligible, never as a
   * valid array index.
   *
   * Declared optional (rather than always-required) purely for structural
   * type compatibility with edit/paragraphTreeMove.ts's own, separate
   * `ParagraphMoveAnchor` type: several existing, unrelated call sites in
   * view/OutlineTreeView.ts (rename-commit and pending-paragraph-insert
   * commit — both out of scope for this hardening round, and explicitly
   * off-limits to touch) pass a `ParagraphMoveAnchor` value directly to
   * `applyParagraphEdit`, relying on it structurally satisfying
   * `ParagraphEditAnchor`'s pre-existing 5 fields. `applyParagraphEdit`
   * itself never reads `siblingIndex`/`prevSiblingText`/`nextSiblingText`
   * (see its own doc comment/body — completely unchanged by this
   * hardening), so this is safe at runtime; `buildParagraphEditAnchor`
   * below — the one true builder for every real `ParagraphEditAnchor`,
   * including the one `resolveParagraphAnchorText` is ever actually
   * called with (view/PartialEditView.ts's own `paragraphAnchor` field) —
   * always populates all three fields, so Pass 3 below only ever sees
   * `undefined` in this defensive, never-in-practice sense; its own
   * `siblingIndex === undefined` check treats that identically to `-1`.
   */
  siblingIndex?: number;
  /**
   * The immediately preceding same-slot candidate's own text at anchor-
   * build time, or `null` when `siblingIndex` was `0` (no previous
   * sibling in this slot) or `-1` (see `siblingIndex`'s own doc comment).
   * Read-only structural context for Pass 3 only — never consulted by
   * `applyParagraphEdit`'s own Pass 1/Pass 2, which this field leaves
   * completely untouched. Optional for the same `ParagraphMoveAnchor`
   * structural-compatibility reason as `siblingIndex` above.
   */
  prevSiblingText?: string | null;
  /** Same as `prevSiblingText`, for the immediately following same-slot candidate. */
  nextSiblingText?: string | null;
}

/**
 * Projects a live, already-resolved paragraph (kind "paragraph",
 * editability "supported") into a `ParagraphEditAnchor` — the one
 * intended way to build one; a caller should never hand-construct the
 * object literal field-by-field (that would silently skip the
 * `siblingCount` computation this fix depends on). Accepts the flattened
 * shape `resolver/resolveParagraphAtCursor.ts`'s `ResolvedParagraphAtCursor`
 * already exposes (complexBlockId/parentId/depth/text), so callers never
 * need the raw `ComplexBlockInfo` — mirrors
 * edit/paragraphTreeMove.ts#buildParagraphMoveAnchor's "one true builder"
 * convention for that module's own, separate anchor type.
 *
 * `complexBlocks` defaults to a fresh scan, but a caller that already has
 * one (e.g. PartialEditView re-anchoring right after a successful Apply,
 * from the same scan it just re-parsed for) may pass it to avoid a
 * redundant re-scan — same convention as
 * resolver/resolveParagraphAtCursor.ts's own default-parameter shape.
 */
export function buildParagraphEditAnchor(
  doc: ParsedDocument,
  resolved: { complexBlockId: string; parentId: string | null; depth: number; text: string },
  complexBlocks: ComplexBlockInfo[] = scanComplexBlocks(doc).blocks
): ParagraphEditAnchor {
  // Phase 5A-1 hardening §5: the same filtered, document-order candidate
  // array now backs siblingCount AND the new siblingIndex/prevSiblingText/
  // nextSiblingText fields — computed once here, no extra re-scan (the
  // filter predicate itself is unchanged from before this hardening).
  const sameSlot = complexBlocks.filter(
    (b) =>
      b.kind === "paragraph" &&
      b.editability === "supported" &&
      b.parentId === resolved.parentId &&
      complexBlockDepth(doc, b.parentId) === resolved.depth
  );
  const siblingIndex = sameSlot.findIndex((b) => b.id === resolved.complexBlockId);
  const extract = (b: ComplexBlockInfo): string =>
    doc.lines.slice(b.range.startLine, b.range.endLine + 1).join("\n");
  return {
    complexBlockId: resolved.complexBlockId,
    parentId: resolved.parentId,
    depth: resolved.depth,
    originalText: resolved.text,
    siblingCount: sameSlot.length,
    siblingIndex,
    prevSiblingText: siblingIndex > 0 ? extract(sameSlot[siblingIndex - 1]) : null,
    nextSiblingText:
      siblingIndex >= 0 && siblingIndex < sameSlot.length - 1 ? extract(sameSlot[siblingIndex + 1]) : null,
  };
}

export type NoParagraphApplyReason =
  | "anchor-unresolved"
  | "content-changed"
  | "blank-line-not-allowed";

export interface ApplyParagraphEditOutcome {
  changed: boolean;
  lines: string[];
  /** New start line of the replaced range (valid when changed). */
  newStartLine: number;
  reason?: NoParagraphApplyReason;
}

/**
 * Phase 5T-4A ("Tree paragraph → 既存 Partial Edit の最小実装",
 * docs/phase5t4_tree_paragraph_partial_edit_design.md §5-3): a paragraph's
 * own text can legitimately span multiple lines (soft-wrapped, no blank
 * separator — see this file's own "successful apply" test for
 * "a multi-line paragraph can grow or shrink in line count on Apply",
 * unchanged and still supported), but it must never contain a genuinely
 * BLANK line — parser/complexBlocks.ts's own paragraph-boundary rule
 * treats a blank (or whitespace-only) line as a hard paragraph separator,
 * so splicing one into the middle of `newText` would, on the next parse,
 * silently turn one paragraph into two: exactly the "分割" the 5T-4A
 * ticket §4 requires this module to reject outright, safe-side, whenever
 * the input is even ambiguous.
 *
 * A line counts as "blank" here whenever it is empty OR whitespace-only
 * after trimming — both are indistinguishable from an ordinary Markdown
 * blank-line separator once written back to the note, so both are
 * rejected identically; there is no separate "whitespace-only is more
 * lenient" case.
 *
 * A trailing newline in the caller's `newText` (e.g. the user pressed
 * Enter once at the very end of the Partial Edit Pane's textarea) is
 * DELIBERATELY treated exactly like any other blank line, not stripped or
 * special-cased: `"Some text.\n".split("\n")` ends in an empty-string
 * element, which this function flags the same as an interior blank line.
 * This keeps the rule simple and total (one check, no exceptions to
 * explain), and matches the 5T-4A ticket's own explicit fallback ("仕様が
 * 曖昧なら「paragraph を複数段落に分割し得る入力はすべて拒否」とすること") —
 * a paragraph's own `originalText` snapshot (doc.lines.slice(...).join
 * ("\n")) never carries a trailing newline in the first place, so an
 * unedited round-trip Apply never trips this check.
 *
 * A newline strictly BETWEEN two non-blank lines (ordinary multi-line
 * paragraph text, e.g. `"Line one.\nLine two."`) is explicitly NOT
 * rejected — see the doc comment above for why this remains supported,
 * pre-existing 5P-2 behavior.
 */
export function paragraphEditTextContainsBlankLine(text: string): boolean {
  return text.split("\n").some((line) => line.trim().length === 0);
}

/**
 * Re-resolve `anchor` against a fresh scan of `doc` (the CURRENT note,
 * already re-parsed by the caller) and splice `newText` in over exactly
 * that paragraph's own range — but only once every check below passes.
 *
 * ---- Two-pass identity resolution (Phase 5P-4 supplement) ----
 *
 * Pass 1 (fast path): if a "supported" paragraph with
 * `id === anchor.complexBlockId` exists AND its parentId/depth/content all
 * still match the anchor exactly, apply immediately. This is the
 * overwhelmingly common case (nothing moved since the pane loaded) and
 * needs no further search.
 *
 * Pass 2 (structural + content re-search): reached whenever Pass 1 does
 * not fully match — the id may be stale (a paragraph<->paragraph swap
 * elsewhere renumbered it), missing, or pointing at a structurally
 * different slot. Every "supported" paragraph sharing `anchor.parentId`/
 * `anchor.depth` is a candidate; among those, look for an EXACT
 * byte-for-byte match of `anchor.originalText`:
 *   - exactly one match -> that is the same logical paragraph, merely
 *     repositioned (a pure Phase 5P-4 swap never touches a paragraph's
 *     own text) -> apply to it, regardless of how many times it has moved
 *     since the anchor was built.
 *   - two or more matches -> genuinely ambiguous (e.g. two byte-identical
 *     sibling paragraphs) -> "anchor-unresolved"; never guesses.
 *   - zero matches -> nothing under this parent currently has the
 *     anchor's exact text. Compare the CURRENT same-parent/depth
 *     "supported" paragraph count against `anchor.siblingCount`:
 *       - equal -> the population is unchanged, so the anchor's own
 *         paragraph must still be there with DIFFERENT text -> "content-
 *         changed" (a genuine edit, independent of this fix).
 *       - different -> something was inserted, removed, split, or merged
 *         nearby (or the paragraph reparented) -> too uncertain to safely
 *         attribute to any one candidate -> "anchor-unresolved".
 *
 * Reasons:
 *   - "blank-line-not-allowed" (Phase 5T-4A): `newText` itself contains a
 *     blank (or whitespace-only) line — see
 *     `paragraphEditTextContainsBlankLine`'s own doc comment above.
 *     Checked FIRST, before any re-resolution against `doc`, since this is
 *     purely an input-validity question independent of the target
 *     paragraph's current state.
 *   - "anchor-unresolved": the target paragraph could not be safely and
 *     uniquely re-identified — covers deletion, an ambiguous duplicate,
 *     and any nearby structural change (split/merge/reparent) that makes
 *     content-based re-identification unsafe. Never touches the note.
 *   - "content-changed": the target WAS safely and uniquely re-identified
 *     (by id, or by structural position + an unchanged sibling
 *     population), but its own text differs from the anchor's snapshot —
 *     the note changed since the pane loaded it. Never touches the note.
 */
/**
 * Phase 5A-1 hardening §2 (shared, read-only identity-resolution core):
 * every "supported" paragraph candidate in `doc`, and the byte-for-byte
 * text extractor both `applyParagraphEdit` and `resolveParagraphAnchorText`
 * below need — the one piece of matching logic genuinely identical between
 * the splice path and the read-only path, so it is consolidated here
 * rather than duplicated. Never mutates `doc`; never touches any Editor/
 * Vault/DOM/Notice API — this whole module has zero "obsidian" imports
 * (see this file's own top doc comment and its accompanying guard test).
 */
function supportedParagraphCandidates(doc: ParsedDocument): ComplexBlockInfo[] {
  return scanComplexBlocks(doc).blocks.filter(
    (b) => b.kind === "paragraph" && b.editability === "supported"
  );
}

function extractParagraphText(doc: ParsedDocument, b: ComplexBlockInfo): string {
  return doc.lines.slice(b.range.startLine, b.range.endLine + 1).join("\n");
}

export function applyParagraphEdit(
  doc: ParsedDocument,
  anchor: ParagraphEditAnchor,
  newText: string
): ApplyParagraphEditOutcome {
  if (paragraphEditTextContainsBlankLine(newText)) {
    return { changed: false, lines: doc.lines, newStartLine: -1, reason: "blank-line-not-allowed" };
  }

  const paragraphCandidates = supportedParagraphCandidates(doc);
  const extract = (b: ComplexBlockInfo): string => extractParagraphText(doc, b);

  const applyAt = (b: ComplexBlockInfo): ApplyParagraphEditOutcome => {
    const newLines = newText.split("\n");
    const lines = [
      ...doc.lines.slice(0, b.range.startLine),
      ...newLines,
      ...doc.lines.slice(b.range.endLine + 1),
    ];
    return { changed: true, lines, newStartLine: b.range.startLine };
  };

  // Pass 1: fast path via the (possibly stale) scan-local id.
  const idCandidate = paragraphCandidates.find((b) => b.id === anchor.complexBlockId);
  if (
    idCandidate &&
    idCandidate.parentId === anchor.parentId &&
    complexBlockDepth(doc, idCandidate.parentId) === anchor.depth &&
    extract(idCandidate) === anchor.originalText
  ) {
    return applyAt(idCandidate);
  }

  // Pass 2: structural re-search, never trusting the id alone (see this
  // function's own doc comment for the full rationale).
  const sameSlotCandidates = paragraphCandidates.filter(
    (b) => b.parentId === anchor.parentId && complexBlockDepth(doc, b.parentId) === anchor.depth
  );
  const exactMatches = sameSlotCandidates.filter((b) => extract(b) === anchor.originalText);

  if (exactMatches.length === 1) {
    return applyAt(exactMatches[0]);
  }
  if (exactMatches.length >= 2) {
    return { changed: false, lines: doc.lines, newStartLine: -1, reason: "anchor-unresolved" };
  }
  // exactMatches.length === 0: nothing under this parent currently holds
  // the anchor's exact text.
  if (sameSlotCandidates.length === anchor.siblingCount) {
    return { changed: false, lines: doc.lines, newStartLine: -1, reason: "content-changed" };
  }
  return { changed: false, lines: doc.lines, newStartLine: -1, reason: "anchor-unresolved" };
}

export interface ParagraphAnchorTextResolution {
  ok: boolean;
  /** The re-resolved paragraph's CURRENT text — non-null exactly when `ok` is true. */
  text: string | null;
  /** True only when `ok` is false AND no candidate could be safely, uniquely identified — never guessed. */
  ambiguous: boolean;
}

/**
 * Phase 5A-1 hardening §2: the dedicated, explicitly read-only counterpart
 * to `applyParagraphEdit`'s own two-pass identity resolution above — used
 * by view/PartialEditView.ts's stale-check path (resolveCurrentTarget) IN
 * PLACE OF the discarded-result `applyParagraphEdit(doc, anchor,
 * anchor.originalText)` no-op-probe pattern it used before this hardening
 * round (flagged by this ticket's own safety review as a responsibility-
 * boundary risk: an "Apply"-named function reused for reads, with no
 * explicit read-only contract of its own).
 *
 * Never mutates `doc`; never calls any Editor/Vault/DOM/Notice API; never
 * writes anything — this whole module has zero "obsidian" imports (see
 * this file's own top doc comment), and this function in particular never
 * even constructs an `ApplyParagraphEditOutcome`'s `lines`/`newStartLine`
 * splice — see this file's own accompanying guard test for how that is
 * checked structurally, not just by convention.
 *
 * Re-resolves `anchor` against a fresh scan of `doc` and reports the
 * CURRENT text of the same logical paragraph. Pass 1 below is IDENTICAL
 * to applyParagraphEdit's own Pass 1, content-match requirement included
 * — deliberately NOT relaxed to a structural-only (id + parentId + depth)
 * match: `complexBlockId` is a per-scan-call ordinal number
 * (parser/complexBlocks.ts's `paragraph-${seq++}`), never a persistent
 * identifier (see this file's own top doc comment on id instability
 * across a paragraph<->paragraph swap). After a nearby reorder, the SAME
 * id can end up structurally matching (same parentId/depth) a
 * COMPLETELY DIFFERENT logical paragraph in the new scan — an early,
 * simpler version of this function that omitted the content check learned
 * this the hard way (see this function's own accompanying test, "resolves
 * via the existing structural fallback after a same-parent
 * paragraph<->paragraph swap"): only a content match at that position
 * proves the id still denotes the same paragraph. This function's
 * difference from applyParagraphEdit is entirely in what happens AFTER
 * both passes fail to find an exact content match — see the population-
 * comparison branch below.
 *
 *   - Pass 1 (fast path): a "supported" paragraph with
 *     id === anchor.complexBlockId, whose parentId/depth AND own text all
 *     still match the anchor exactly -> resolved; text === anchor.originalText
 *     (nothing changed).
 *   - Pass 2 (structural + content re-search): reached whenever Pass 1
 *     does not fully match — mirrors applyParagraphEdit's own Pass 2
 *     exactly (same `sameSlotCandidates`/`exactMatches` shape, same shared
 *     `supportedParagraphCandidates`/`extractParagraphText` helpers):
 *     every "supported" paragraph sharing anchor.parentId/depth is a
 *     candidate; an EXACT byte-for-byte match of anchor.originalText among
 *     those identifies the same paragraph, merely repositioned (a pure
 *     sibling swap never touches a paragraph's own text) -> resolved, its
 *     current (== original, by definition of "exact match") text is
 *     returned.
 *       - two or more exact matches -> ambiguous: true, no text (never
 *         guesses among duplicates).
 *       - zero exact matches: this is the one point this function's own
 *         resolution rule DIFFERS from applyParagraphEdit's Pass 2, which
 *         only ever reports the "content-changed" REASON here, without
 *         naming a candidate (safe for Apply, which just refuses either
 *         way). A read-only resolver needs an actual candidate to reveal
 *         its text — falls through to Pass 3 (`resolveViaSiblingContext`,
 *         defined just below this function), rather than giving up
 *         immediately.
 *   - Pass 3 (Phase 5A-1 hardening §5, "structural content-changed
 *     fallback" — see `resolveViaSiblingContext`'s own doc comment
 *     immediately below this function for the full, five-condition
 *     contract): reached only when Pass 1 and Pass 2 have both already
 *     failed. Uses `anchor.siblingIndex`/`prevSiblingText`/
 *     `nextSiblingText` (new fields, populated by `buildParagraphEditAnchor`
 *     from the same candidate array `siblingCount` is derived from) to
 *     recognize the specific, common case where the target paragraph's
 *     OWN text changed but its immediate structural neighborhood (same
 *     population count, same position, same immediate neighbors' text,
 *     no duplicate content anywhere in the slot) is otherwise exactly as
 *     remembered -> resolved, current text returned. Any other case ->
 *     ambiguous: true, no text — this pass never widens the "safely
 *     resolvable" surface beyond that one specific, narrowly-verified
 *     shape (see `resolveViaSiblingContext`'s own doc comment for the
 *     concrete counterexample that shaped condition 3 there).
 *
 * Per this ticket's own explicit, preserved policy: this function's own
 * "ambiguous" result is what lets a mere DETECTION (PartialEditView's
 * evaluateAgainstText) lean toward "stale" rather than "unavailable" —
 * only a subsequent, EXPLICIT Reload attempt that also fails escalates to
 * "unavailable" (see PartialEditView#executeReload). This function itself
 * has no opinion on stale vs. unavailable — that classification lives
 * entirely in view/partialEditSyncClassification.ts, downstream of this
 * function's own ok/text/ambiguous result.
 */
export function resolveParagraphAnchorText(
  doc: ParsedDocument,
  anchor: ParagraphEditAnchor
): ParagraphAnchorTextResolution {
  const paragraphCandidates = supportedParagraphCandidates(doc);
  const extract = (b: ComplexBlockInfo): string => extractParagraphText(doc, b);

  // Pass 1: fast path via the (possibly stale) scan-local id — see this
  // function's own doc comment above for why the content-match
  // requirement here is never relaxed.
  const idCandidate = paragraphCandidates.find((b) => b.id === anchor.complexBlockId);
  if (
    idCandidate &&
    idCandidate.parentId === anchor.parentId &&
    complexBlockDepth(doc, idCandidate.parentId) === anchor.depth &&
    extract(idCandidate) === anchor.originalText
  ) {
    return { ok: true, text: anchor.originalText, ambiguous: false };
  }

  // Pass 2: structural + content re-search, mirroring applyParagraphEdit's
  // own Pass 2 exactly.
  const sameSlotCandidates = paragraphCandidates.filter(
    (b) => b.parentId === anchor.parentId && complexBlockDepth(doc, b.parentId) === anchor.depth
  );
  const exactMatches = sameSlotCandidates.filter((b) => extract(b) === anchor.originalText);

  if (exactMatches.length === 1) {
    return { ok: true, text: extract(exactMatches[0]), ambiguous: false };
  }
  if (exactMatches.length >= 2) {
    return { ok: false, text: null, ambiguous: true };
  }
  // exactMatches.length === 0: nothing under this parent currently holds
  // the anchor's exact original text. Pass 3 (Phase 5A-1 hardening §5,
  // "paragraph reload / stale resolution hardening") — reached ONLY when
  // Pass 1 and Pass 2 above have both already failed.
  return resolveViaSiblingContext(sameSlotCandidates, anchor, extract);
}

/**
 * Phase 5A-1 hardening §5, Pass 3: the structural "content-changed"
 * fallback for `resolveParagraphAnchorText` — the read-only recovery for
 * the single most common real case Pass 1/Pass 2 above cannot handle: the
 * target paragraph's OWN text changed (a direct edit, or an Undo/Redo)
 * while every other same-slot sibling stayed exactly where it was. Never
 * consulted by `applyParagraphEdit`, whose own Pass 2 fallback (just
 * above applyParagraphEdit's own return statements) is left completely
 * unchanged by this hardening — Apply keeps refusing ("content-changed")
 * exactly as before; only this READ-ONLY resolver gains the ability to
 * reveal what the current text actually is.
 *
 * All of the following must hold, checked against `sameSlot` (the SAME
 * `parentId`/`depth`-filtered, document-order candidate array Pass 2
 * above already computed) — any single failure resolves to
 * `ambiguous: true`, never a guess:
 *
 *   1. `sameSlot.length === anchor.siblingCount` — the same-slot
 *      population is unchanged from anchor-build time. A changed count
 *      means something was inserted, removed, split, or merged nearby;
 *      Pass 3 never attempts to reason about WHERE.
 *   2. `anchor.siblingIndex` is a valid index into the CURRENT `sameSlot`
 *      (also rejects the defensive `-1` case — see `siblingIndex`'s own
 *      doc comment on `ParagraphEditAnchor`).
 *   3. No two candidates in the CURRENT `sameSlot` share byte-identical
 *      text (a hardening-round addition beyond the anchor's own stored
 *      fields — see this function's own top doc comment's "Pass 3"
 *      section for the counterexample this closes: without it, a
 *      genuinely-deleted target's slot could be coincidentally refilled
 *      by an unrelated duplicate of a NEIGHBORING sibling's own text in a
 *      way that still satisfies conditions 1/2/4/5 below — verified
 *      against the real scanner/parser before this hardening was written,
 *      never merely hand-traced). This also directly satisfies "two
 *      byte-identical siblings never let Pass 3 guess between them."
 *   4. The CURRENT candidate immediately before `siblingIndex` has text
 *      equal to `anchor.prevSiblingText` — `null` compared against `null`
 *      when `siblingIndex` is `0` (no previous sibling, on EITHER side).
 *   5. Same as 4, for the immediately following candidate and
 *      `anchor.nextSiblingText`.
 *
 * When all five hold, the candidate AT `anchor.siblingIndex` is resolved
 * as the same logical paragraph, and its CURRENT text is returned
 * (`ok: true, ambiguous: false`). This is deliberately narrower than "the
 * population is unchanged and nothing obviously moved" — it is scoped
 * specifically to "this one position changed, and its immediate
 * structural neighborhood, including the absence of any duplicate
 * elsewhere in the same slot, is otherwise exactly as remembered."
 *
 * Pass 3 is NEVER a substitute for Pass 1/Pass 2 above, and is never
 * reached when either already resolved (including the existing "2+ exact
 * matches -> ambiguous" duplicate-content policy, unchanged). It also
 * never fires for insertion/deletion of a NEIGHBORING paragraph (breaks
 * condition 1 or 4/5), split/merge (breaks condition 1), reordering
 * (breaks condition 4/5, since Pass 2's own exact-match path is what
 * legitimately handles a pure reorder), a changed `parentId`/`depth`
 * (already excluded upstream — `sameSlot` itself is filtered by the
 * anchor's own `parentId`/`depth`, so a reparented paragraph never
 * appears in this candidate list at all), or same-content/near-duplicate
 * paragraphs (condition 3, and Pass 2's own duplicate policy for an exact
 * anchor-text duplicate).
 */
function resolveViaSiblingContext(
  sameSlot: ComplexBlockInfo[],
  anchor: ParagraphEditAnchor,
  extract: (b: ComplexBlockInfo) => string
): ParagraphAnchorTextResolution {
  if (sameSlot.length !== anchor.siblingCount) {
    return { ok: false, text: null, ambiguous: true };
  }
  // `siblingIndex` is optional on the type only for ParagraphMoveAnchor
  // structural compatibility elsewhere (see ParagraphEditAnchor's own doc
  // comment) — never actually undefined for a real, buildParagraphEditAnchor
  // -built anchor, but `undefined` is treated identically to the existing
  // defensive `-1` case: never eligible, never a valid array index.
  if (
    anchor.siblingIndex === undefined ||
    anchor.siblingIndex < 0 ||
    anchor.siblingIndex >= sameSlot.length
  ) {
    return { ok: false, text: null, ambiguous: true };
  }

  const currentTexts = sameSlot.map(extract);
  const hasDuplicate = currentTexts.some((t, i) => currentTexts.indexOf(t) !== i);
  if (hasDuplicate) {
    return { ok: false, text: null, ambiguous: true };
  }

  const currentPrev = anchor.siblingIndex > 0 ? currentTexts[anchor.siblingIndex - 1] : null;
  const currentNext =
    anchor.siblingIndex < currentTexts.length - 1 ? currentTexts[anchor.siblingIndex + 1] : null;
  if (currentPrev !== anchor.prevSiblingText || currentNext !== anchor.nextSiblingText) {
    return { ok: false, text: null, ambiguous: true };
  }

  return { ok: true, text: currentTexts[anchor.siblingIndex], ambiguous: false };
}
