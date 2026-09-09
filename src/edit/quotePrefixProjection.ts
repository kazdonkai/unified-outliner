/**
 * Phase 5D-0.5 ("Quote Prefix Projection for Partial Edit"): a pure,
 * Obsidian-free text transform that lets the Partial Edit Pane show a
 * callout/blockquote's BODY content without its leading `>` prefix (and,
 * for a callout, without its header line at all), while still round-
 * tripping back to byte-identical raw Markdown on Apply.
 *
 * This module does NOT know about ParsedDocument, ComplexBlockInfo,
 * doc.nodes, or any parser/scanner concept — it operates purely on the
 * raw multi-line text edit/partialEdit.ts's extractSubtreeText already
 * returns for a "supported" callout/blockquote (see that function's own
 * doc comment), plus the caller-supplied `kind`. This keeps the same
 * "each layer is independently testable, no Obsidian dependency creeps
 * downward" discipline every other edit/* module in this plugin already
 * follows. No new parser/writer/Markdown-normalization logic is added —
 * this module only ever slices/rejoins strings that extractSubtreeText/
 * applySubtreeEdit (both unmodified) already treat as ground truth.
 *
 * ---- The core invariant: prefix + content === original line, always ----
 *
 * Every QuotePrefixLineMapping splits ONE raw body line into exactly two
 * substrings — `prefix` (everything from the start of the line through
 * its `>` marker and at most one following space/tab) and `content`
 * (everything after that) — such that `prefix + content` reconstructs the
 * original line byte-for-byte, unconditionally, for ANY input line (the
 * split point can never fail to cover the whole line, since `content` is
 * captured via `.*` with no length restriction — see LINE_PREFIX_RE).
 * This is what makes invertQuotePrefixProjection lossless: it never
 * re-derives or re-normalizes a prefix, it only ever concatenates the
 * ORIGINAL prefix (captured once, at build time) with whatever content
 * the textarea now holds for that line.
 *
 * ---- Two "do not project" cases ----
 *
 * buildQuotePrefixProjection reports exactly two distinct failure
 * reasons, and the two are NOT interchangeable — see this ticket's
 * approved scope for the exact caller-side handling of each:
 *
 *   - "nested": some body line, after stripping exactly ONE level of `>`
 *     prefix, ITSELF still starts with a quote prefix — a plain nested
 *     blockquote (`> > text`, no `[!` marker). This is a real, confirmed
 *     gap in parser/complexBlocks.ts's own nested-quote detection: that
 *     module's hasEmbeddedCalloutMarker/NESTED_CALLOUT_RE only fire for a
 *     nested CALLOUT marker (`> > [!type]`), never for a plain nested
 *     blockquote with no marker at all, so a block containing one can
 *     still reach editability "supported" upstream. This module's own,
 *     independent check is what closes that remaining gap, without
 *     touching parser/complexBlocks.ts at all. The caller (PartialEditView)
 *     must refuse to open the Pane at all for this reason — never fall
 *     back to raw editing — per the approved scope's explicit "raw
 *     fallback を使わない" instruction: nested quote structure is not
 *     something this phase's flat line-mapping model can represent
 *     safely, projected OR raw-in-a-projecting-pane.
 *   - "no-body": a callout whose range is header-only (zero body lines).
 *     The caller must fall back to the EXISTING, unmodified raw Partial
 *     Edit behavior for this reason — this is NOT a rejection; nothing
 *     about the block is unsupported, there is simply nothing to project.
 *     A blockquote can never produce this reason: a "supported"
 *     blockquote's range always has at least one line, and blockquote has
 *     no header line to exclude, so its body-line list is never empty.
 *
 * ---- What counts as an allowed edit (Phase 5D-1.5 update) ----
 *
 * Through Phase 5D-1C, invertQuotePrefixProjection accepted ONLY a
 * per-line CONTENT change — any edit that changed the number of lines was
 * refused wholesale with reason "line-count-changed", on the theory that
 * there is no per-line prefix to attribute to a line that did not exist
 * when the projection was built, and guessing one would silently
 * fabricate Markdown structure. Phase 5D-1.5 ("単独 Callout / Blockquote
 * Partial Edit Pane の可変長本文編集") replaces that wholesale refusal
 * with real support for adding, removing, and splitting/joining lines —
 * ordinary textarea editing (Enter, Backspace/Delete, multi-line paste,
 * whole-body replacement) — for BOTH callout and blockquote. The
 * unresolvable-prefix problem that motivated the old refusal is real, but
 * it only actually blocks EXACT positional attribution; it does not block
 * reconstructing valid Markdown. This module now handles two cases:
 *
 *   - Same line count as the loaded projection (`editedDisplayText.split
 *     ("\n").length === projection.lines.length`): each line reunites
 *     with its own ORIGINAL prefix, preserving exact per-line formatting
 *     (mixed `>`/`> `/`>  ` styles, list-item-owned indentation) —
 *     UNCHANGED from before this ticket for a line whose content is
 *     unchanged, or already blank and stays blank. The one thing that DID
 *     change: a line whose content this edit itself made blank (was
 *     non-empty, is now `""`) normalizes to that line's own prefix with
 *     trailing whitespace stripped, per this ticket's own explicit
 *     worked example (6-2) — see invertQuotePrefixProjection's own doc
 *     comment for the exact "cleared vs. already-blank" distinction that
 *     keeps a genuinely unedited round-trip still byte-identical.
 *   - A DIFFERENT line count: there is no positional correspondence left
 *     to trust (a line inserted or removed partway through shifts every
 *     line after it), so every line — kept, added, or shifted alike — is
 *     reconstructed under ONE canonical prefix instead, derived from the
 *     projection's own first body line (preserving that line's leading
 *     indentation, e.g. for a list-item-owned block) with its trailing
 *     whitespace stripped. A blank line's content reconstructs as that
 *     bare prefix alone (e.g. `>`, never `> ` with a trailing space) —
 *     never a bare, quote-breaking empty raw line — matching this
 *     ticket's own explicit "空行は `>` のみの行へ正規化する" requirement.
 *     A NON-blank line reconstructs as the bare prefix plus exactly one
 *     space plus its content. See invertQuotePrefixProjection's own doc
 *     comment for the exact algorithm and worked example.
 *
 * Fully emptying the body (`editedDisplayText === ""`) is handled as a
 * THIRD, explicit case, not merely "zero lines" of the above: for a
 * callout, this reconstructs as the header line alone (a valid,
 * already-supported "header-only" callout — the exact same shape
 * buildQuotePrefixProjection's own "no-body" case already falls back to
 * raw-editing for at LOAD time); for a blockquote (no header to fall back
 * to — emptying it would delete the block's only content entirely, not
 * shrink it), this is refused with reason "blockquote-empty". Neither
 * case guesses: a callout with a title becomes a bare header line users
 * can see and edit further; a blockquote's would-be deletion is refused
 * outright, leaving the note and the pane's own draft untouched — see
 * view/PartialEditView.ts's applyEdit for the user-facing Notice.
 *
 * Whatever this module reconstructs, view/PartialEditView.ts's applyEdit
 * re-verifies the result against the CURRENT parser/scanner (in isolation
 * — never assumed valid) before ever touching the note, exactly like this
 * ticket's own approved scope requires — see that method's own doc
 * comment for why that check cannot live in this Obsidian/parser-free
 * module itself.
 */

/** Only callout/blockquote ever reach this module — see extractSubtreeText's SubtreeKind (edit/partialEdit.ts), which also includes "section"/"list" that never project. */
export type QuotePrefixProjectionKind = "callout" | "blockquote";

/**
 * One body line's lossless split. `prefix + content` always reconstructs
 * the original raw line byte-for-byte — see this module's top doc
 * comment for why that invariant holds unconditionally.
 */
export interface QuotePrefixLineMapping {
  prefix: string;
  content: string;
}

/**
 * Phase 5D-1B ("Callout Fold Marker Editing"): the callout header's own
 * fold marker — `""` (absent: not foldable), `"+"` (foldable, expanded by
 * default), or `"-"` (foldable, collapsed by default). See
 * https://obsidian.md/help/callouts — "You can make a callout foldable by
 * adding a plus (+) or a minus (-) directly after the type identifier. A
 * plus sign expands the callout by default, and a minus sign collapses it
 * instead." (the no-marker "not foldable" behavior itself is this
 * plugin's own documented real-device observation, not spelled out
 * verbatim in that page).
 */
export type CalloutFoldMarker = "" | "+" | "-";

/**
 * Phase 5D-1A ("Callout Header Title Editing") / 5D-1B ("Callout Fold
 * Marker Editing") / 5D-1C ("Callout Type Editing"): the callout header
 * line split into five lossless pieces — `quotePrefix` (leading
 * indentation, the `>` marker itself, and at most one following space/
 * tab — NEVER touched by type, marker, or title edits), `type` (the
 * `[!type]` type identifier itself, edited in 5D-1C, held verbatim with
 * no case-folding/trimming/alias-resolution of any kind — see
 * reconstructQuoteHeader's own doc comment), `marker` (the fold marker,
 * edited in 5D-1B), `separator` (whatever run of spaces/tabs originally
 * sat between the marker position and the title, edited in none of the
 * three tickets directly but its CONTENT reused verbatim — see
 * reconstructQuoteHeader's own doc comment for the one case where a
 * single space is synthesized instead of reused), and `title` (edited in
 * 5D-1A). Exactly the same lossless-split discipline as
 * QuotePrefixLineMapping above:
 *
 *   quotePrefix + "[!" + type + "]" + marker + separator + title === the
 *   original header line, byte-for-byte, unconditionally — see
 *   buildQuoteHeaderTitleSlot's own doc comment.
 *
 * Only ever built for kind "callout"; a blockquote has no header/type/
 * title/marker concept at all. The type name (`QuoteHeaderTitleSlot`, not
 * `QuoteHeaderSlot`) is kept unchanged from 5D-1A despite now also
 * carrying the type and marker splits, per Phase 5D-1B's own approved
 * ticket wording ("QuoteHeaderTitleSlot を...拡張する"), reaffirmed by
 * 5D-1C's own ticket for the same reason.
 *
 * Phase 5D-1C: the former `beforeMarker` field (quote prefix through the
 * closing `]` of `[!type]`, as ONE opaque span) is retired in favor of
 * `quotePrefix` + `type` — `"[!"` and `"]"` are fixed literal characters
 * that never need their own field, since they are never edited and are
 * always reconstructed verbatim around whatever `type` currently is.
 * `beforeMarker` had no callers outside this module and view/
 * PartialEditView.ts (confirmed by a full-repo search before this
 * rename), so this is a clean internal rename with no external API
 * surface to migrate.
 */
export interface QuoteHeaderTitleSlot {
  quotePrefix: string;
  type: string;
  marker: CalloutFoldMarker;
  separator: string;
  title: string;
}

/**
 * `header` is the callout's own header line (`> [!type]+ title`),
 * verbatim, shown read-only OUTSIDE the textarea by the caller — never
 * null for kind "callout", always null for kind "blockquote" (a
 * blockquote has no header concept; every one of its lines is body
 * content). `lines` never includes the header line for a callout.
 *
 * Phase 5D-1A: `titleSlot` is the header's title split out for editing —
 * always null for kind "blockquote", and for kind "callout" null only in
 * the defensive case where the header line unexpectedly doesn't match
 * HEADER_TITLE_SPLIT_RE (should not happen for a header that already
 * matched parser/complexBlocks.ts's own CALLOUT_START_RE at scan time;
 * see buildQuoteHeaderTitleSlot's doc comment). `header` and `titleSlot`
 * are two independent views of the SAME header line — `header` for
 * read-only display when title editing isn't offered, `titleSlot` for
 * the editable case — never out of sync with each other, since both are
 * derived from the identical `rawLines[0]` in buildQuotePrefixProjection.
 */
export interface QuotePrefixProjection {
  kind: QuotePrefixProjectionKind;
  header: string | null;
  titleSlot: QuoteHeaderTitleSlot | null;
  lines: QuotePrefixLineMapping[];
}

export type QuotePrefixProjectionBuildReason = "nested" | "no-body";

export type QuotePrefixProjectionBuildResult =
  | { ok: true; projection: QuotePrefixProjection }
  | { ok: false; reason: QuotePrefixProjectionBuildReason };

/**
 * Splits ONE raw line into (prefix, content) covering the whole line —
 * `[ \t]*` (leading indentation, e.g. list-item-owned continuation),
 * `>` (the quote marker itself, required), `[ \t]?` (at most one
 * following space/tab — a SECOND space, if present, becomes part of
 * `content`, which is still lossless since prefix+content always equals
 * the original line regardless of where the split falls). Intentionally
 * NOT the same regex as parser/complexBlocks.ts's QUOTE_PREFIX_RE/
 * CALLOUT_START_RE (boundary-detection, not display/round-trip) or
 * tree/buildOutlineTree.ts's stripQuotePrefixForDisplay (display-only,
 * lossy — it `.trim()`s the result, which this module must never do).
 */
const LINE_PREFIX_RE = /^([ \t]*>[ \t]?)(.*)$/;

/** True when `content` (already one level of `>` stripped) itself starts with another quote prefix — the plain-nested-blockquote case this module exists to catch. */
const NESTED_QUOTE_CONTENT_RE = /^[ \t]*>/;

/**
 * Phase 5D-1A / 5D-1B / 5D-1C: splits a callout HEADER line into all FIVE
 * lossless pieces in one pass — mirrors LINE_PREFIX_RE's split discipline
 * exactly, just anchored to the header's own shape instead of a body
 * line's bare `>` prefix. Structurally the same anchor as
 * parser/complexBlocks.ts's CALLOUT_START_RE (group 1 here ==
 * CALLOUT_START_RE's own quote-prefix span, group 2 here ==
 * CALLOUT_START_RE's own type-capture group verbatim (`[^\]]+`), group 3
 * here == CALLOUT_START_RE's own fold-marker group verbatim), but
 * additionally separates the type (group 2) from the fold marker
 * (group 3), the marker from its trailing separator whitespace (group 4),
 * and the title (group 5) — 5D-1A only needed groups 1+2+3+4 collapsed
 * into one opaque `beforeTitle` span; 5D-1B split the marker out; 5D-1C
 * now also splits the type out on its own so it can be edited
 * independently of the quote-prefix portion that must never change and
 * the marker/title portions that must not be implicitly touched by a
 * type edit.
 */
const HEADER_SLOT_RE = /^([ \t]*>[ \t]?)\[!([^\]]+)\]([+-]?)([ \t]*)(.*)$/;

/**
 * Build a QuoteHeaderTitleSlot from a raw callout header line. Returns
 * null only defensively — a header line that already matched
 * CALLOUT_START_RE at scan time (the only way a block is ever classified
 * "callout" in the first place) is structurally guaranteed to also match
 * HEADER_SLOT_RE above, since the latter is anchored identically (see
 * that const's own doc comment for the group-by-group correspondence). A
 * caller seeing null here should treat it exactly like a callout with no
 * title/marker/type slot at all — fall back to read-only header display,
 * offer no type input, title input, or fold-marker select — never throw
 * or guess.
 */
export function buildQuoteHeaderTitleSlot(headerLine: string): QuoteHeaderTitleSlot | null {
  const m = headerLine.match(HEADER_SLOT_RE);
  if (!m) return null;
  // `[+-]?` in HEADER_SLOT_RE guarantees m[3] is always "" | "+" | "-" —
  // this cast reflects that regex-level guarantee, not an assumption.
  const marker = m[3] as CalloutFoldMarker;
  return { quotePrefix: m[1], type: m[2], marker, separator: m[4], title: m[5] };
}

/**
 * Build a QuotePrefixProjection from `rawText` — the EXACT string
 * extractSubtreeText returned for a "supported" callout/blockquote (the
 * whole block's range, `\n`-joined, header line included for a callout).
 * See this module's top doc comment for the "nested"/"no-body" failure
 * reasons and how a caller must handle each.
 */
export function buildQuotePrefixProjection(
  rawText: string,
  kind: QuotePrefixProjectionKind
): QuotePrefixProjectionBuildResult {
  const rawLines = rawText.split("\n");
  let header: string | null = null;
  let titleSlot: QuoteHeaderTitleSlot | null = null;
  let bodyLines = rawLines;
  if (kind === "callout") {
    header = rawLines[0] ?? "";
    titleSlot = buildQuoteHeaderTitleSlot(header);
    bodyLines = rawLines.slice(1);
  }
  if (bodyLines.length === 0) {
    // Only reachable for kind "callout" (header-only range) — see this
    // module's top doc comment for why a blockquote can never hit this.
    return { ok: false, reason: "no-body" };
  }

  const lines: QuotePrefixLineMapping[] = [];
  for (const raw of bodyLines) {
    const m = raw.match(LINE_PREFIX_RE);
    if (!m) {
      // Defensive only: every line inside a "supported" callout/
      // blockquote range is guaranteed by parser/complexBlocks.ts's
      // scanQuoteRuns to match its own QUOTE_PREFIX_RE, and LINE_PREFIX_RE
      // above matches a strict superset of that (it never requires
      // anything QUOTE_PREFIX_RE doesn't already require) — so this
      // should be unreachable in practice. If it is somehow reached, the
      // raw text does not actually describe a well-formed quote body;
      // fail closed exactly like a genuinely nested run, rather than
      // guessing a synthetic prefix for it.
      return { ok: false, reason: "nested" };
    }
    const prefix = m[1];
    const content = m[2];
    if (NESTED_QUOTE_CONTENT_RE.test(content)) {
      return { ok: false, reason: "nested" };
    }
    lines.push({ prefix, content });
  }
  return { ok: true, projection: { kind, header, titleSlot, lines } };
}

/** The textarea's display value for a built projection — each body line's `content`, joined with "\n". Never includes the header (callers render that separately, read-only). */
export function projectedDisplayText(projection: QuotePrefixProjection): string {
  return projection.lines.map((line) => line.content).join("\n");
}

/**
 * Phase 5D-1.5: "blockquote-empty" is the ONLY remaining refusal reason —
 * see this module's top doc comment's "What counts as an allowed edit"
 * section. A blockquote whose body was fully emptied has no header to
 * fall back to (emptying it would delete the block's only content
 * entirely), so it is refused rather than silently producing an empty/
 * invalid block; a callout in the same situation instead succeeds with a
 * header-only result (not a refusal at all).
 */
export type QuotePrefixProjectionInvertReason = "blockquote-empty";

export type QuotePrefixProjectionInvertResult =
  | { ok: true; rawText: string }
  | { ok: false; reason: QuotePrefixProjectionInvertReason };

/**
 * Reconstruct raw Markdown text from `projection` and the textarea's
 * CURRENT (possibly edited) display text — see this module's top doc
 * comment ("What counts as an allowed edit (Phase 5D-1.5 update)") for
 * the full policy this implements. Three cases, checked in this order:
 *
 * 1. `editedDisplayText === ""` (the body was fully cleared): a callout
 *    reconstructs as its header line ALONE (no body lines at all — a
 *    valid, already-supported header-only callout); a blockquote refuses
 *    with "blockquote-empty" (no header to fall back to).
 * 2. `editedDisplayText.split("\n").length === projection.lines.length`
 *    (an exact per-line content edit, no lines added/removed): each line
 *    reunites with its own ORIGINAL prefix — EXCEPT a line this specific
 *    edit actively CLEARED (its edited content is `""` but its ORIGINAL
 *    `mapping.content` was not), which normalizes to that line's own
 *    prefix with trailing whitespace stripped (a bare `>`), same as case
 *    3 below — this is this ticket's own explicit requirement ("空の編集
 *    行は...`>` のみの行へ正規化する" applies to ANY line an edit makes
 *    blank, not only ones introduced by a line-count change). A line that
 *    was ALREADY blank and stays untouched (`mapping.content === ""` and
 *    edited content is still `""`) is NOT "cleared by this edit" — it
 *    reunites with its ORIGINAL prefix byte-for-byte like every other
 *    untouched line, which is what keeps a genuinely unedited round-trip
 *    (a pre-existing bare `>` body line, or one with trailing whitespace
 *    after `>`) exactly byte-identical, unchanged from before this
 *    ticket.
 * 3. Any other line count (lines were added, removed, or split/joined via
 *    an embedded newline): every line reconstructs under one canonical
 *    prefix derived from `projection.lines[0].prefix` with its trailing
 *    space/tab stripped (`basePrefix`) — a blank line's content becomes
 *    `basePrefix` alone (e.g. `>`), a non-blank line becomes `basePrefix
 *    + " " + content` (e.g. `> text`). Worked example: loaded body
 *    ["A", "B"] (prefix "> " on both) edited to "A\nnew\n\nC" (4 lines)
 *    reconstructs as ["> A", "> new", ">", "> C"] — every line rebuilt
 *    under the same "> " / ">" pair, never a per-original-line prefix
 *    that no longer has anything to positionally correspond to.
 *
 * The callout header (if any) is reattached verbatim and unedited in
 * cases 2 and 3 — the header is never part of `editedDisplayText` at all,
 * since projectedDisplayText never included it either.
 */
export function invertQuotePrefixProjection(
  projection: QuotePrefixProjection,
  editedDisplayText: string
): QuotePrefixProjectionInvertResult {
  if (editedDisplayText === "") {
    if (projection.kind === "blockquote") {
      return { ok: false, reason: "blockquote-empty" };
    }
    return { ok: true, rawText: projection.header ?? "" };
  }

  const stripTrailingWhitespace = (prefix: string): string => prefix.replace(/[ \t]$/, "");

  const editedLines = editedDisplayText.split("\n");
  const rawBodyLines: string[] =
    editedLines.length === projection.lines.length
      ? projection.lines.map((mapping, i) => {
          const content = editedLines[i];
          if (content === "" && mapping.content !== "") {
            // Actively cleared by this edit — normalize, never keep a
            // now-orphaned trailing space that would round-trip as
            // `> ` (see this function's own doc comment, case 2).
            return stripTrailingWhitespace(mapping.prefix);
          }
          return mapping.prefix + content;
        })
      : (() => {
          const basePrefix = stripTrailingWhitespace(projection.lines[0].prefix);
          return editedLines.map((content) =>
            content === "" ? basePrefix : basePrefix + " " + content
          );
        })();

  const rawLines =
    projection.kind === "callout" ? [projection.header ?? "", ...rawBodyLines] : rawBodyLines;
  return { ok: true, rawText: rawLines.join("\n") };
}

export type QuoteHeaderTitleReconstructReason = "newline" | "invalid-marker" | "invalid-type";

export type QuoteHeaderTitleReconstructResult =
  | { ok: true; header: string }
  | { ok: false; reason: QuoteHeaderTitleReconstructReason };

/**
 * Phase 5D-1A ("Callout Header Title Editing") / 5D-1B ("Callout Fold
 * Marker Editing") / 5D-1C ("Callout Type Editing"): reconstruct a full
 * callout header line from `slot` (the ORIGINAL, load-time split — never
 * mutated), `newType` (the type combobox's CURRENT value, edited or
 * not), `newMarker` (the fold marker select's CURRENT value, edited or
 * not), and `newTitle` (the title input's CURRENT value, edited or not).
 * `slot.quotePrefix` — leading indentation, `>`, and at most one
 * following space/tab — is NEVER altered by this function; only the
 * type, marker, and title portions change. All three new values are
 * independent inputs combined in a SINGLE reassembly (`quotePrefix +
 * "[!" + newType + "]" + newMarker + effectiveSeparator + newTitle`) —
 * there is no meaningful "order" in which type vs. marker vs. title is
 * applied, since each is just one piece of one concatenation; a caller
 * changing only a subset of the three simply passes the others unchanged
 * (`slot.type` / `slot.marker` / `slot.title`) and gets a byte-identical
 * result for those pieces, exactly like an unedited title already did in
 * 5D-1A and an unedited marker in 5D-1B.
 *
 * Refuses with reason "invalid-type" whenever `newType` is empty, or
 * contains `"]"`, or contains a line break (`\r` and/or `\n` — LF, CRLF,
 * and bare CR are all rejected) — a callout header is exactly one raw
 * Markdown line, and `]` would terminate the `[!type]` span early. Unlike
 * "invalid-marker" below, this branch IS reachable through completely
 * ordinary UI use: the type combobox is free text (see this ticket's own
 * approved UI decision — a `<datalist>` offers suggestions but never
 * constrains the typed value, precisely so custom/alias/unknown callout
 * types the user already has in their vault are never rejected or
 * rewritten), so a user can trivially clear the field or paste a string
 * containing `]`/a line break. The View layer must show a user-facing
 * Notice for this reason — see PartialEditView.ts's applyEdit.
 *
 * Refuses with reason "newline" whenever `newTitle` contains one (5D-1A,
 * unchanged) — same one-line-header rule as above, for the title portion
 * specifically. Refuses with reason "invalid-marker" whenever `newMarker`
 * is anything other than `"" | "+" | "-"` — defense-in-depth only: the
 * TypeScript `CalloutFoldMarker` union already restricts this at compile
 * time, and the View's own fold-marker control is a closed-set `<select>`
 * that can only ever emit one of these three values, so this branch
 * should be unreachable via normal UI (unlike "invalid-type" above). It
 * exists for the same reason buildQuotePrefixProjection's own "should be
 * unreachable in practice" guards exist: never throw, never silently
 * coerce/normalize an unexpected value — fail closed as a safe, ordinary
 * result instead. Any of the three refusals rejects the WHOLE Apply
 * (type edit, marker edit, title edit, AND any body edit together),
 * zero-byte-change, never a partial write — mirroring
 * invertQuotePrefixProjection's own "line-count-changed" refusal
 * contract.
 *
 * `newType` is validated FIRST, before `newMarker` and `newTitle` — an
 * arbitrary but stable order; a caller relying on a specific refusal
 * reason when multiple fields are simultaneously invalid should not
 * assume the others were validated at all, only that no partial header
 * is ever returned on any failure.
 *
 * The separator rules below are 5D-1A's own approved, fixed
 * specification, restated here in terms of `slot.separator` (the
 * whitespace between the marker position and the title) instead of
 * "beforeTitle's trailing whitespace" — the underlying rule is
 * unchanged, and does not depend on whether the type or marker
 * themselves changed:
 *
 *   1. newTitle === "" (title emptied, or was already empty and stays
 *      empty/unedited): `slot.separator` is reused completely unmodified.
 *      Nothing is trimmed, regardless of what newType/newMarker are.
 *   2. `slot.title === ""` (the ORIGINAL title was empty) AND
 *      `slot.separator === ""` (no existing separator at all) and
 *      newTitle is non-empty: exactly one space is synthesized instead
 *      of reusing the (empty) separator — the minimum readability
 *      correction needed for a brand-new title to not glue onto `]` or
 *      the new marker character. This is a pure insertion; it never
 *      touches `quotePrefix` or `type`.
 *   3. Every other case (a non-empty separator already existed, or the
 *      original title was already non-empty): `slot.separator` is reused
 *      verbatim, no space logic — the original separator convention is
 *      deliberately preserved as-is rather than reformatted.
 *
 * An unedited type, unedited title, AND unedited marker (newType ===
 * slot.type, newTitle === slot.title, newMarker === slot.marker) also
 * falls under rule 1 or rule 3 and reconstructs the header byte-identical
 * to the original — the same "unedited Apply changes nothing" guarantee
 * QuotePrefixProjection's body-line split already provides.
 */
export function reconstructQuoteHeader(
  slot: QuoteHeaderTitleSlot,
  newType: string,
  newMarker: CalloutFoldMarker,
  newTitle: string
): QuoteHeaderTitleReconstructResult {
  if (newType.length === 0 || newType.includes("]") || /[\r\n]/.test(newType)) {
    return { ok: false, reason: "invalid-type" };
  }
  if (newMarker !== "" && newMarker !== "+" && newMarker !== "-") {
    return { ok: false, reason: "invalid-marker" };
  }
  if (newTitle.includes("\n")) {
    return { ok: false, reason: "newline" };
  }
  let separator: string;
  if (newTitle === "") {
    separator = slot.separator;
  } else if (slot.title === "" && slot.separator === "") {
    separator = " ";
  } else {
    separator = slot.separator;
  }
  return {
    ok: true,
    header: slot.quotePrefix + "[!" + newType + "]" + newMarker + separator + newTitle,
  };
}
