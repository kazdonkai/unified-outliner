/**
 * Phase 5D-2C ("CompositeBlock single-line-list member marker-free
 * projection"): a pure, Obsidian-free text transform that lets the
 * Partial Edit Pane show a `single-line-list` item's BODY content without
 * its leading list marker (`-`/`*`/`+`), marker-trailing whitespace, and
 * indentation, while still round-tripping back to byte-identical raw
 * Markdown on an unedited Apply — the exact same discipline
 * edit/quotePrefixProjection.ts already established for a callout/
 * blockquote's `>` prefix, applied to a list item's own marker instead.
 *
 * This module does NOT know about ParsedDocument, ListBlockNode,
 * CompositeBlockSnapshot, or any parser/scanner concept — it operates
 * purely on ONE raw line string. It is deliberately independent of
 * edit/compositeBlockMemberProjection.ts (which slices a CompositeBlock's
 * two members apart but never inspects or reformats the list member's own
 * line content) and of view/PartialEditView.ts — CompositeBlock Partial
 * Edit (Phase 5D-2B) is this module's first CALLER, not something this
 * module depends on. This separation is deliberate and required: a future
 * standalone single-line-list Partial Edit (Phase 5L-1, explicitly out of
 * this ticket's scope — see this ticket's own design doc) can reuse this
 * exact module unchanged, the same way edit/quotePrefixProjection.ts is
 * already shared, unmodified, between the standalone callout/blockquote
 * Partial Edit Pane and the CompositeBlock structured session.
 *
 * ---- The core invariant: indent + marker + markerSpacing + body === rawLine, always ----
 *
 * Every ListMarkerProjection splits ONE raw line into exactly four
 * substrings that reconstruct the original line byte-for-byte when
 * concatenated in that order, unconditionally, for any line
 * buildListMarkerProjection accepts. This is what makes
 * invertListMarkerProjection lossless on an unedited round-trip: it never
 * re-derives indentation or a marker, it only ever concatenates the
 * ORIGINAL indent/marker/markerSpacing (captured once, at build time)
 * with whatever body text the list-member input currently holds.
 *
 * ---- What this module refuses, and why every refusal is safe ----
 *
 * buildListMarkerProjection only ever succeeds for an UNORDERED,
 * non-task-list single-line-list item — the minimal scope this ticket's
 * own approved spec requires (marker one of `-`/`*`/`+`; matching
 * parser/parseDocument.ts's own LIST_RE unordered-marker branch exactly —
 * see LIST_MARKER_LINE_RE's own doc comment). Refuses, and never guesses,
 * for:
 *
 *   - "not-list-line": `rawLine` does not even match the list-line shape
 *     at all. Defensive only — every caller today only ever passes a line
 *     the parser already classified as a list item (via
 *     parser/parseDocument.ts's own LIST_RE, which LIST_MARKER_LINE_RE
 *     below is a superset of), so this should be unreachable in practice.
 *     Kept, tested, and returned rather than assumed, matching this
 *     codebase's standing "never throw, never silently coerce an
 *     unexpected shape" convention (e.g.
 *     edit/quotePrefixProjection.ts's own "should be unreachable in
 *     practice" LINE_PREFIX_RE fallback).
 *   - "ordered-marker": the list item's own marker is an ordered marker
 *     (`1.`/`1)` etc, per parser/parseDocument.ts's own `ordered` test —
 *     reused verbatim, see isOrderedMarker below). An ordered list's
 *     marker carries its own numbering semantics that this ticket's
 *     minimal unordered-only scope does not attempt to preserve/
 *     renumber — see this ticket's own design doc for why ordered lists
 *     are left as a future extension rather than guessed at.
 *   - "task-list-marker": the list item's own body, immediately after the
 *     marker and its trailing whitespace, is a task-list checkbox
 *     (`[ ]`/`[x]`/any single-character status, per Obsidian's own
 *     task-list convention — see TASK_LIST_BODY_RE's own doc comment). A
 *     task list's checkbox is itself meaningful, editable state this
 *     ticket's minimal scope does not attempt to project/preserve
 *     separately from the body — projecting it away would silently hide
 *     the checkbox from the editable body entirely, which this ticket's
 *     approved spec explicitly excludes.
 *
 * A caller MUST fall back to showing the list member's own RAW line
 * (Phase 5D-2B's own pre-5D-2C behavior — completely unmodified by this
 * module) whenever this returns `ok: false`; this module never mutates
 * anything, so that fallback is always safe. This is a narrower, member-
 * local fallback than the whole-CompositeBlock raw-textarea fallback
 * edit/compositeBlockMemberProjection.ts's own failures trigger — see
 * view/PartialEditView.ts's loadCompositeInternal for exactly which
 * fallback applies at which layer.
 *
 * ---- Apply-time: what counts as an allowed edit ----
 *
 * Unlike edit/quotePrefixProjection.ts's body (which may freely change
 * line count — Phase 5D-1.5), a `single-line-list` item is, by
 * definition (parser/compositeBlocks.ts's own classification: "no
 * continuation lines and no nested child list"), always exactly ONE raw
 * line. invertListMarkerProjection therefore refuses (`reason:
 * "multiline-body"`) whenever the edited body contains a newline
 * character — the one and only way a marker-free body edit could
 * silently turn one list line into two-or-more raw lines, which would
 * both violate the single-line-list invariant this module's own kind gate
 * exists to protect AND require inventing continuation-line/nested-list
 * Markdown this minimal ticket never attempts to produce. A caller must
 * treat this exactly like edit/quotePrefixProjection.ts's own
 * "blockquote-empty" refusal: reject Apply outright, preserve the pane's
 * draft, never guess a split.
 *
 * A user typing a marker-LOOKING string (e.g. "- more text") into the
 * marker-free body is never special-cased, collapsed, or treated as a
 * "real" second marker — invertListMarkerProjection performs a single,
 * literal concatenation (`indent + marker + markerSpacing + body`) with
 * no re-parsing of `body` at all, so such input simply becomes literal
 * text content of the (unchanged) list item, never a double marker or a
 * nested list. See this module's own test file for the exact fixture
 * proving this.
 *
 * An originally-EMPTY body (`markerSpacing === ""`, e.g. a bare `-` line
 * with nothing after the marker at all) that the user edits to non-empty
 * text would, if `markerSpacing` were reused verbatim, reconstruct as
 * `-text` — NOT a valid list-item continuation of the marker at all per
 * parser/parseDocument.ts's own LIST_RE (which requires AT LEAST one
 * space/tab between the marker and any following content). To avoid
 * silently producing unparseable Markdown, invertListMarkerProjection
 * synthesizes exactly one space in this one case — the same "minimum
 * readability/validity correction for a previously-empty slot" policy
 * edit/quotePrefixProjection.ts's own reconstructQuoteHeader already
 * applies to an empty title/separator pair (see that function's own rule
 * 2). Every other case reuses the original `markerSpacing` verbatim, with
 * zero reformatting.
 */

/** Matches parser/parseDocument.ts's own LIST_RE structurally (leading indentation, then an unordered `-`/`*`/`+` marker OR an ordered `1.`/`1)` marker, then optional marker-trailing whitespace and body) — but split into FOUR lossless capture groups instead of LIST_RE's two, so indent/marker/markerSpacing/body can each be inspected and reconstructed independently. Intentionally its own regex object rather than an import of LIST_RE itself (that constant is not exported, and boundary detection vs. lossless round-trip splitting are different concerns even when their shapes overlap — the exact same reasoning edit/quotePrefixProjection.ts's own LINE_PREFIX_RE doc comment gives for not reusing parser/complexBlocks.ts's QUOTE_PREFIX_RE). `[ \t]*` for the marker-trailing whitespace group (group 3) is deliberately unbounded (not `[ \t]+`), so a bare marker with no following whitespace or content (e.g. a lone `-`) still matches with group 3/4 both `""` — see buildListMarkerProjection's own doc comment for how Apply-time reconstruction keeps such a line valid even after the body is edited to non-empty. */
const LIST_MARKER_LINE_RE = /^([ \t]*)([-*+]|\d+[.)])([ \t]*)(.*)$/;

/** The exact "is this marker ordered" test parser/parseDocument.ts itself already uses (`ordered: /^\d/.test(marker)`) — reused verbatim, never re-derived, so "which markers count as ordered" can never drift between the canonical parser and this module. */
function isOrderedMarker(marker: string): boolean {
  return /^\d/.test(marker);
}

/**
 * A task-list checkbox at the very start of a list item's own body —
 * Obsidian's own task-list convention (`- [ ] text`, `- [x] text`), which
 * this plugin's parser (parser/parseDocument.ts) does not itself model as
 * a distinct concept (a task-list item is, to that parser, an ordinary
 * list item whose content happens to start with `[ ] `). Matches ANY
 * single character between the brackets (not only ` `/`x`/`X`), since
 * Obsidian itself renders arbitrary single-character task statuses (e.g.
 * `[/]`, `[-]`) as valid, meaningful checkbox states — this module must
 * never silently strip/hide one of those into a projected body just
 * because its specific status character wasn't anticipated.
 */
const TASK_LIST_BODY_RE = /^\[[^\]]\](?:[ \t]|$)/;

/** Every way buildListMarkerProjection refuses to project a list line — see this module's own top doc comment for the full rationale behind each. */
export type ListMarkerProjectionBuildReason = "not-list-line" | "ordered-marker" | "task-list-marker";

/**
 * `rawLine` is the original line, byte-for-byte, kept alongside the split
 * pieces for caller convenience/debugging (mirrors
 * edit/quotePrefixProjection.ts's own QuotePrefixProjection carrying its
 * source alongside the split). `indent` is the leading whitespace before
 * the marker; `marker` is the literal marker character (`-`/`*`/`+` —
 * ordered markers are always refused at build time, never reach here);
 * `markerSpacing` is whatever run of spaces/tabs originally sat between
 * the marker and the body (possibly `""` for a bare marker with no
 * following content at all); `body` is the marker-free editable text —
 * exactly what the Partial Edit Pane's list-member input shows and lets
 * the user edit. `indent + marker + markerSpacing + body === rawLine`
 * always holds — see this module's own top doc comment.
 */
export interface ListMarkerProjection {
  rawLine: string;
  indent: string;
  marker: string;
  markerSpacing: string;
  body: string;
}

export type ListMarkerProjectionBuildResult =
  | { ok: true; projection: ListMarkerProjection }
  | { ok: false; reason: ListMarkerProjectionBuildReason };

/**
 * Build a ListMarkerProjection from ONE raw list-item line — the exact
 * line edit/compositeBlockMemberProjection.ts's own
 * `CompositeMemberSplit.listLineText` already holds for a
 * `single-line-list` CompositeBlock member (byte-for-byte, no
 * reformatting). See this module's own top doc comment for the three
 * refusal reasons and the caller-side fallback each requires.
 */
export function buildListMarkerProjection(rawLine: string): ListMarkerProjectionBuildResult {
  const m = rawLine.match(LIST_MARKER_LINE_RE);
  if (!m) {
    // Defensive only — see this module's top doc comment.
    return { ok: false, reason: "not-list-line" };
  }
  const [, indent, marker, markerSpacing, body] = m;
  if (isOrderedMarker(marker)) {
    return { ok: false, reason: "ordered-marker" };
  }
  if (TASK_LIST_BODY_RE.test(body)) {
    return { ok: false, reason: "task-list-marker" };
  }
  return { ok: true, projection: { rawLine, indent, marker, markerSpacing, body } };
}

/** The list-member input's display value for a built projection — just `projection.body`. A trivial one-liner (unlike edit/quotePrefixProjection.ts's own multi-line projectedDisplayText), kept as its own named export for the same reason that one is: callers reference the CONCEPT ("this projection's editable display text"), not the field name, and a future Phase 5L-1 standalone-list caller gets the same stable entry point edit/quotePrefixProjection.ts's callers already rely on. */
export function projectedListBodyText(projection: ListMarkerProjection): string {
  return projection.body;
}

/**
 * "multiline-body" is the ONLY refusal reason — see this module's own top
 * doc comment's "Apply-time: what counts as an allowed edit" section for
 * why a `single-line-list` item can never accept a body edit that
 * introduces a newline.
 */
export type ListMarkerProjectionInvertReason = "multiline-body";

export type ListMarkerProjectionInvertResult =
  | { ok: true; rawLine: string }
  | { ok: false; reason: ListMarkerProjectionInvertReason };

/**
 * Reconstruct the raw list-item line from `projection` (the ORIGINAL,
 * load-time split — never mutated) and `editedBody` (the list-member
 * input's CURRENT value, edited or not). See this module's own top doc
 * comment for the empty-markerSpacing space-synthesis rule and the
 * "typing a marker-looking string never becomes a real marker" guarantee.
 * An unedited `editedBody === projection.body` always reconstructs
 * `projection.rawLine` byte-for-byte.
 */
export function invertListMarkerProjection(
  projection: ListMarkerProjection,
  editedBody: string
): ListMarkerProjectionInvertResult {
  if (editedBody.includes("\n")) {
    return { ok: false, reason: "multiline-body" };
  }
  const markerSpacing =
    projection.markerSpacing === "" && editedBody !== "" ? " " : projection.markerSpacing;
  return {
    ok: true,
    rawLine: projection.indent + projection.marker + markerSpacing + editedBody,
  };
}
