/**
 * Phase 5L-3 ("Ordered List Marker-Free Partial Edit"): the ordered-list
 * counterpart of edit/listMarkerProjection.ts and edit/taskListProjection.ts
 * — a pure, Obsidian-free text transform that lets the Partial Edit Pane
 * show a standalone single-line ORDERED list item's BODY content with its
 * leading number marker (`1.`/`12.`/`1)`/`12)`) hidden from the editable
 * body, while a small number control (see view/PartialEditView.ts's
 * orderedNumberInputEl) carries the item's OWN leading number as an
 * independently editable structural field instead.
 *
 * This module is deliberately independent of edit/listMarkerProjection.ts
 * AND edit/taskListProjection.ts — it does NOT widen either module's own
 * contract to also cover ordered markers, exactly the same discipline
 * edit/taskListProjection.ts's own top doc comment already applies to its
 * own independence from edit/listMarkerProjection.ts. The three
 * projections are mutually exclusive by construction: an ordered marker is
 * precisely what buildListMarkerProjection's own "ordered-marker" refusal
 * excludes (see PartialEditView.ts's buildStandaloneListProjections, the
 * ONE call site that decides which of the three a given raw line gets).
 *
 * This module does NOT know about ParsedDocument, ListBlockNode,
 * CompositeBlockSnapshot, or any parser/scanner concept — it operates
 * purely on ONE raw line string, mirroring
 * edit/listMarkerProjection.ts's/edit/taskListProjection.ts's own "pure
 * text transform" discipline exactly. It is also deliberately independent
 * of any CompositeBlock concept — this ticket's own approved scope is
 * standalone ordered-list items only (see this ticket's own design doc,
 * docs/phase5l3_ordered-list-marker-free-partial-edit.md); a future
 * CompositeBlock ordered-list member ticket can reuse this module
 * unchanged, exactly the same way edit/listMarkerProjection.ts is already
 * shared, unmodified, between the standalone list Partial Edit Pane
 * (Phase 5L-1) and the CompositeBlock structured session (Phase 5D-2C).
 *
 * ---- The core invariant ----
 *
 * Every OrderedListProjection splits ONE raw line into FIVE substrings
 * that reconstruct the original line byte-for-byte when concatenated in
 * order: `indent + number + delimiter + markerSpacing + body === rawLine`,
 * always, for any line buildOrderedListProjection accepts. Like the other
 * two projection modules' own invariants, this is what makes
 * invertOrderedListProjection lossless on an unedited round-trip: it never
 * re-derives indentation or a delimiter, it only ever concatenates the
 * ORIGINAL indent/delimiter/markerSpacing (captured once, at build time)
 * with whatever number text and body text the caller currently holds.
 *
 * ---- What this module refuses, and why every refusal is safe ----
 *
 * buildOrderedListProjection only ever succeeds for an ORDERED,
 * non-task-list single-line-list item — the minimal scope this ticket's
 * own approved spec requires. Refuses, and never guesses, for:
 *
 *   - "not-list-line": `rawLine` does not even match the list-line shape
 *     at all. Defensive only, mirrors edit/listMarkerProjection.ts's own
 *     identical refusal — every caller today only ever passes a line the
 *     parser already classified as a list item. Also (defensively)
 *     returned in the practically-unreachable case where a marker the
 *     shared list-line shape already classified as "ordered" somehow
 *     fails ORDERED_MARKER_RE's own digit/delimiter split — that split is
 *     a strict subset of `isOrderedMarker`'s own `/^\d/` test combined
 *     with parser/parseDocument.ts's own LIST_RE marker alternative
 *     (`\d+[.)]`), so this branch should never actually be taken in
 *     practice; kept, tested, and returned rather than assumed, matching
 *     this codebase's standing "never throw, never silently coerce an
 *     unexpected shape" convention.
 *   - "unordered-marker": the list item's own marker is an unordered
 *     marker (`-`/`*`/`+`). Unordered items are edit/listMarkerProjection.ts's
 *     own domain entirely — this module must never attempt to project one,
 *     the same scope boundary edit/listMarkerProjection.ts's own
 *     "ordered-marker" refusal already enforces in the opposite direction.
 *   - "task-list-marker": the list item's own body, immediately after the
 *     marker and its trailing whitespace, is a task-list checkbox
 *     (`[ ]`/`[x]`/any single-character status — see TASK_LIST_BODY_RE's
 *     own doc comment, reused structurally from
 *     edit/listMarkerProjection.ts's own identically-named constant). An
 *     ORDERED task-list item (e.g. `1. [ ] text`) is explicitly out of
 *     this ticket's own approved scope (this ticket's own spec §1: "task
 *     list ... は今回の対象外です") — exactly like Phase 5L-2 left ordered
 *     task-list items to a future ticket, this ticket leaves an ORDERED
 *     line whose body happens to be a checkbox to a future ticket too,
 *     rather than silently treating its checkbox text as ordinary body
 *     content.
 *
 * A caller MUST fall back to showing the list member's own RAW line
 * whenever this returns `ok: false` — this module never mutates anything,
 * so that fallback is always safe, mirroring the other two projection
 * modules' own identical contract.
 *
 * ---- Apply-time: what counts as an allowed edit ----
 *
 * A standalone ordered-list item eligible for this projection is, by the
 * SAME structural gate edit/standaloneOrderedListProjection.ts's own
 * isStandaloneOrderedListItemEligibleForMarkerFreeProjection already
 * enforces, always exactly ONE raw line.
 * invertOrderedListProjection therefore refuses (`reason:
 * "multiline-body"`) whenever the edited body contains a newline
 * character, mirroring edit/listMarkerProjection.ts's own identical
 * "multiline-body" refusal for the identical reason: a caller must treat
 * this exactly like that module's own refusal — reject Apply outright,
 * preserve the pane's draft (number AND body), never guess a split.
 *
 * A user typing a marker-LOOKING string (e.g. "1. more text") into the
 * marker-free body, or a number-LOOKING string containing extra
 * punctuation, is never special-cased, collapsed, or treated as a "real"
 * second marker — invertOrderedListProjection performs a single, literal
 * concatenation of the validated number text with the body, with no
 * re-parsing of `body` at all, exactly mirroring the other two modules'
 * own identical guarantee.
 *
 * ---- The number field: independently editable, strictly validated ----
 *
 * `number` is the item's own ORIGINAL leading digit run, preserved
 * byte-for-byte (e.g. `"007"` stays `"007"` on an unedited round-trip,
 * never renormalized). The Partial Edit Pane exposes this as its own
 * small, independently-editable text control (see this ticket's own
 * design doc §3) — deliberately NOT an HTML `<input type="number">`
 * relied on alone for correctness: `isValidOrderedListNumberText` below
 * is this module's own, fully independent, string-level validator, run at
 * Apply time regardless of what any browser-side input widget would or
 * would not have permitted the user to type. It accepts ONLY a
 * non-empty run of ASCII digits (`/^[0-9]+$/`) that is not itself all
 * zeros — this single pair of checks is what rejects every case this
 * ticket's own spec enumerates: an empty string (no digits to match at
 * all), `"0"`/`"00"` (all-zero, so no positive value), a leading `-`
 * (not a digit, so the regex itself never matches — negative numbers are
 * refused this way, not by comparing a parsed numeric value against
 * zero), a decimal point or exponential marker (`"1.5"`, `"1e2"` — `.`
 * and `e`/`E` are not digits, so the regex fails before any numeric
 * parsing, such as `Number(...)`, is ever attempted — this is
 * deliberate: this module never calls `Number()`/`parseInt()` on
 * `editedNumberText` at all, precisely so that JavaScript's own numeric
 * coercion quirks (`Number("Infinity")`, `Number("  1  ")`,
 * `Number("1e2")` all being "valid" numbers) can never leak into what
 * counts as a valid ordered-list number here), the literal strings
 * `"NaN"`/`"Infinity"` (neither is a digit), and any leading/trailing/
 * internal whitespace (` ` is not a digit, so a whitespace-padded value
 * never matches `/^[0-9]+$/` at all). A caller must treat an
 * "invalid-number" refusal exactly like a "multiline-body" refusal:
 * reject Apply outright, preserve the pane's draft (both the number
 * control's current text AND the body), never silently clamp/round/trim
 * the number into something "close enough".
 *
 * `delimiter` (the literal `.` or `)` immediately after the number) is
 * NEVER an editable field this phase — this ticket's own spec §3 is
 * explicit that only the number itself, not the delimiter, is exposed as
 * structural editable state. invertOrderedListProjection therefore always
 * reuses `projection.delimiter` verbatim, unconditionally — there is no
 * "edited delimiter" parameter at all, so it is structurally impossible
 * for an Apply to change a `.` item into a `)` item or vice versa this
 * phase (a future ticket may lift this restriction; see this ticket's own
 * design doc §7 for that as a future candidate).
 *
 * `markerSpacing` (the run of spaces/tabs between the delimiter and the
 * body) follows the IDENTICAL empty-synthesis policy
 * edit/listMarkerProjection.ts's own markerSpacing and
 * edit/taskListProjection.ts's own checkboxSpacing already use: reused
 * verbatim when non-empty (no reformatting), but synthesized as exactly
 * one space when it was originally empty (a bare `1.` with nothing after
 * the delimiter at all) AND the edited body is now non-empty — this is
 * what keeps `1.` + newly-typed body from ever reconstructing as the
 * ambiguous `1.text` (parser/parseDocument.ts's own LIST_RE still
 * classifies that as a valid ordered list line either way, since its own
 * body-alternative `(?:[ \t]+.*)?` is optional, but this module still
 * synthesizes a separating space for the same readability reason the
 * other two modules already give: a previously-empty slot that is about
 * to receive real content gets the minimum separator needed to keep the
 * result unambiguous and conventionally formatted).
 *
 * ---- Explicitly NOT this module's concern: renumbering ----
 *
 * This module never inspects, computes, or compares sibling list items'
 * own numbers at all — it operates on exactly ONE raw line, with no
 * knowledge that siblings even exist. Duplicate, non-sequential, or
 * reverse-order numbers across sibling items are therefore structurally
 * impossible for this module to detect, and — per this ticket's own
 * explicit spec — must never become an Apply-rejection reason at any
 * layer above this module either. This module's `isValidOrderedListNumberText`
 * validates ONLY that the edited item's own number text is itself a
 * well-formed positive integer in isolation; it says nothing whatsoever
 * about how that number relates to any other line in the document.
 */

/** Matches edit/listMarkerProjection.ts's own LIST_MARKER_LINE_RE structurally (leading indentation, then an unordered `-`/`*`/`+` marker OR an ordered `1.`/`1)` marker, then optional marker-trailing whitespace and body) — intentionally its own regex object rather than an import of that module's own private constant, for the same independence reasons that module's own top doc comment already gives for not importing parser/parseDocument.ts's own LIST_RE. */
const LIST_MARKER_LINE_RE = /^([ \t]*)([-*+]|\d+[.)])([ \t]*)(.*)$/;

/** The exact "is this marker ordered" test edit/listMarkerProjection.ts itself already uses, reused verbatim (as its own independent copy, not an import — see this module's own top doc comment) so "which markers count as ordered" can never drift between the two modules. */
function isOrderedMarker(marker: string): boolean {
  return /^\d/.test(marker);
}

/** Splits an already-confirmed-ordered marker token (e.g. `"12."`, `"1)"`) into its own digit run and delimiter character. Always matches for any marker `isOrderedMarker` accepted, since both are ultimately governed by the same `\d+[.)]` shape parser/parseDocument.ts's own LIST_RE marker alternative defines — kept as an explicit, tested match (never assumed) per this module's own top doc comment's "not-list-line" defensive-fallback rationale. */
const ORDERED_MARKER_RE = /^(\d+)([.)])$/;

/**
 * A task-list checkbox at the very start of a list item's own body —
 * structurally identical to edit/listMarkerProjection.ts's own
 * TASK_LIST_BODY_RE (matches ANY single character between the brackets,
 * requiring only that a following character, if any, be whitespace or
 * end-of-line is NOT required by this simpler boundary form — this is
 * kept as this module's own independent copy, not an import, for the
 * same independence reasons this module's own top doc comment already
 * gives). This module only needs a yes/no "is this an ordered task-list
 * line" boundary test (never a further split into checkbox pieces — an
 * ordered task-list item's checkbox state is out of this ticket's own
 * scope entirely, see this module's own top doc comment), so it reuses
 * edit/listMarkerProjection.ts's own simpler, non-capturing shape rather
 * than edit/taskListProjection.ts's own capturing TASK_LIST_BODY_RE.
 */
const TASK_LIST_BODY_RE = /^\[[^\]]\](?:[ \t]|$)/;

/** Every way buildOrderedListProjection refuses to project a list line — see this module's own top doc comment for the full rationale behind each. */
export type OrderedListProjectionBuildReason =
  | "not-list-line"
  | "unordered-marker"
  | "task-list-marker";

/**
 * `rawLine` is the original line, byte-for-byte, kept alongside the split
 * pieces for caller convenience/debugging (mirrors the other two
 * projection modules' own identical convention). `indent` is the leading
 * whitespace before the number; `number` is the item's own original
 * digit run, preserved verbatim (leading zeros and all — see this
 * module's own top doc comment's "The number field" section);
 * `delimiter` is the single literal `.` or `)` immediately after the
 * number, NEVER an editable field this phase; `markerSpacing` is
 * whatever run of spaces/tabs originally sat between the delimiter and
 * the body (possibly `""` for a bare `1.` with nothing following at
 * all); `body` is the marker-free editable text — exactly what the
 * Partial Edit Pane's shared textarea shows and lets the user edit for
 * an ordered-list item. The invariant `indent + number + delimiter +
 * markerSpacing + body === rawLine` always holds — see this module's own
 * top doc comment.
 */
export interface OrderedListProjection {
  rawLine: string;
  indent: string;
  number: string;
  delimiter: string;
  markerSpacing: string;
  body: string;
}

export type OrderedListProjectionBuildResult =
  | { ok: true; projection: OrderedListProjection }
  | { ok: false; reason: OrderedListProjectionBuildReason };

/**
 * Build an OrderedListProjection from ONE raw list-item line — the exact
 * line edit/partialEdit.ts's own extractSubtreeText already returns for a
 * standalone single-line list item (byte-for-byte, no reformatting). See
 * this module's own top doc comment for the three refusal reasons and the
 * caller-side fallback each requires. Callers should attempt this ONLY
 * after buildListMarkerProjection (edit/listMarkerProjection.ts) itself
 * refused the SAME line with reason "ordered-marker" — see
 * view/PartialEditView.ts's buildStandaloneListProjections, the one call
 * site all three projection builders are ever invoked from together, for
 * why that ordering is what keeps the three projections mutually
 * exclusive.
 */
export function buildOrderedListProjection(rawLine: string): OrderedListProjectionBuildResult {
  const m = rawLine.match(LIST_MARKER_LINE_RE);
  if (!m) {
    // Defensive only — see this module's top doc comment.
    return { ok: false, reason: "not-list-line" };
  }
  const [, indent, marker, markerSpacing, body] = m;
  if (!isOrderedMarker(marker)) {
    return { ok: false, reason: "unordered-marker" };
  }
  const numMatch = marker.match(ORDERED_MARKER_RE);
  if (!numMatch) {
    // Defensive only — should be unreachable; see this module's top doc
    // comment's "not-list-line" rationale.
    return { ok: false, reason: "not-list-line" };
  }
  const [, number, delimiter] = numMatch;
  if (TASK_LIST_BODY_RE.test(body)) {
    return { ok: false, reason: "task-list-marker" };
  }
  return { ok: true, projection: { rawLine, indent, number, delimiter, markerSpacing, body } };
}

/** The shared textarea's display value for a built projection — just `projection.body`. Named for the same "callers reference the CONCEPT, not the field name" reason the other two projection modules' own identically-shaped accessors already are. */
export function projectedOrderedBodyText(projection: OrderedListProjection): string {
  return projection.body;
}

/** The number control's own display value for a built projection — just `projection.number`, preserved verbatim (see this module's own top doc comment's "The number field" section). Its own named export for the same reason projectedOrderedBodyText above is. */
export function projectedOrderedNumberText(projection: OrderedListProjection): string {
  return projection.number;
}

/**
 * The strict, browser-independent positive-integer validator this
 * module's own top doc comment's "The number field" section documents in
 * full: accepts ONLY a non-empty run of ASCII digits that is not itself
 * all zeros. Exported (not merely internal) so view/PartialEditView.ts
 * can run the IDENTICAL check live (e.g. to enable/disable an Apply
 * control or show inline validation feedback) without this module and
 * its caller ever risking two independently-drifting notions of "a valid
 * ordered-list number".
 */
export function isValidOrderedListNumberText(numberText: string): boolean {
  return /^[0-9]+$/.test(numberText) && !/^0+$/.test(numberText);
}

/**
 * "multiline-body" mirrors the other two projection modules' own
 * identical refusal — see this module's own top doc comment's
 * "Apply-time: what counts as an allowed edit" section. "invalid-number"
 * is this module's own addition — see this module's own top doc
 * comment's "The number field" section for the full, exhaustive
 * rejection-case rationale.
 */
export type OrderedListProjectionInvertReason = "multiline-body" | "invalid-number";

export type OrderedListProjectionInvertResult =
  | { ok: true; rawLine: string }
  | { ok: false; reason: OrderedListProjectionInvertReason };

/**
 * Reconstruct the raw ordered-list item line from `projection` (the
 * ORIGINAL, load-time split — never mutated), `editedNumberText` (the
 * number control's CURRENT text value, edited or not), and `editedBody`
 * (the shared textarea's CURRENT value, edited or not). See this
 * module's own top doc comment for the number-validation rationale, the
 * delimiter-never-edited guarantee, and the markerSpacing empty-
 * synthesis rule. An unedited call (`editedNumberText ===
 * projection.number && editedBody === projection.body`) always
 * reconstructs `projection.rawLine` byte-for-byte.
 */
export function invertOrderedListProjection(
  projection: OrderedListProjection,
  editedNumberText: string,
  editedBody: string
): OrderedListProjectionInvertResult {
  if (editedBody.includes("\n")) {
    return { ok: false, reason: "multiline-body" };
  }
  if (!isValidOrderedListNumberText(editedNumberText)) {
    return { ok: false, reason: "invalid-number" };
  }
  const markerSpacing =
    projection.markerSpacing === "" && editedBody !== "" ? " " : projection.markerSpacing;
  return {
    ok: true,
    rawLine: projection.indent + editedNumberText + projection.delimiter + markerSpacing + editedBody,
  };
}
