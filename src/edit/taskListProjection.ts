/**
 * Phase 5L-2 ("Task List Marker-Free Partial Edit"): the task-list
 * counterpart of edit/listMarkerProjection.ts — a pure, Obsidian-free text
 * transform that lets the Partial Edit Pane show a standalone single-line
 * task-list item's BODY content with its leading list marker (`-`/`*`/`+`)
 * AND its task checkbox (`[ ]`/`[x]`/`[X]`) both hidden from the editable
 * body, while a small checkbox control (see view/PartialEditView.ts's
 * taskCheckboxInputEl) carries the completion state instead.
 *
 * This module is deliberately independent of
 * edit/listMarkerProjection.ts, exactly the same way that module is
 * deliberately independent of edit/quotePrefixProjection.ts (see that
 * module's own top doc comment) — the two projections are mutually
 * exclusive by construction (a task-list checkbox body is precisely what
 * buildListMarkerProjection's own "task-list-marker" refusal excludes;
 * see PartialEditView.ts's buildStandaloneListProjections, the ONE call
 * site that decides which of the two a given raw line gets), and treating
 * the checkbox as a first-class STRUCTURAL field (never a body substring)
 * is the entire point of this ticket — folding it into
 * ListMarkerProjection's existing four-piece split would blur that
 * distinction the two Notices/UI rows below already keep sharply
 * separated.
 *
 * This module does NOT know about ParsedDocument, ListBlockNode,
 * CompositeBlockSnapshot, or any parser/scanner concept — it operates
 * purely on ONE raw line string, mirroring edit/listMarkerProjection.ts's
 * own "pure text transform" discipline exactly. It is also deliberately
 * independent of any CompositeBlock concept — this ticket's own approved
 * scope is standalone task-list items only (see this ticket's own design
 * doc, docs/phase5l2_task-list-marker-free-partial-edit.md); a future
 * CompositeBlock task-list member ticket can reuse this module unchanged,
 * exactly the same way edit/listMarkerProjection.ts is already shared,
 * unmodified, between the standalone list Partial Edit Pane (Phase 5L-1)
 * and the CompositeBlock structured session (Phase 5D-2C).
 *
 * ---- The core invariant ----
 *
 * Every TaskListProjection splits ONE raw line into SIX substrings that
 * reconstruct the original line byte-for-byte when concatenated in order:
 * `indent + marker + markerSpacing + "[" + checkboxStatusChar + "]" +
 * checkboxSpacing + body === rawLine`, always, for any line
 * buildTaskListProjection accepts. Like edit/listMarkerProjection.ts's own
 * invariant, this is what makes invertTaskListProjection lossless on an
 * unedited round-trip: it never re-derives indentation, a marker, or a
 * checkbox bracket pair, it only ever concatenates the ORIGINAL pieces
 * (captured once, at build time) with whatever body text and checkbox
 * completion state the caller currently holds.
 *
 * ---- What this module refuses, and why every refusal is safe ----
 *
 * buildTaskListProjection only ever succeeds for an UNORDERED single-line
 * task-list item whose checkbox status character is one this ticket's own
 * approved minimal scope supports (see CHECKBOX_STATUS_RE's own doc
 * comment below). It refuses, and never guesses, for:
 *
 *   - "not-list-line": `rawLine` does not even match the list-line shape
 *     at all. Defensive only, mirrors edit/listMarkerProjection.ts's own
 *     identical refusal — every caller today only ever passes a line the
 *     parser already classified as a list item.
 *   - "ordered-marker": the item's own marker is an ordered marker (`1.`/
 *     `1)` etc). Ordered task-list items are out of this ticket's own
 *     explicit scope (see this ticket's own design doc §2) — the SAME
 *     scope boundary edit/listMarkerProjection.ts's own "ordered-marker"
 *     refusal already enforces for non-task items.
 *   - "not-task-checkbox": the item's own body, immediately after the
 *     marker and its trailing whitespace, is NOT a task-list checkbox at
 *     all — either no `[X]` shape immediately there, or (matching
 *     edit/listMarkerProjection.ts's own TASK_LIST_BODY_RE boundary
 *     exactly, so the two modules never disagree about which raw lines
 *     are "task lines") the character immediately following the closing
 *     `]` is neither whitespace nor end-of-line (e.g. `- [x]text`, which
 *     THIS parser's own convention treats as ordinary list body text
 *     starting with a literal `[x]`, never a checkbox — see
 *     edit/listMarkerProjection.ts's own TASK_LIST_BODY_RE doc comment).
 *     A caller reaching this refusal for a line that
 *     buildListMarkerProjection itself refused with "task-list-marker"
 *     should not be possible in practice (the two gates use the identical
 *     boundary check), but is handled the same safe way regardless: raw
 *     fallback, never a guess.
 *   - "unsupported-status": the checkbox's own status character (the
 *     single character between `[` and `]`) is something other than this
 *     ticket's own minimal supported set (` `, `x`, `X` — see
 *     CHECKBOX_STATUS_RE's own doc comment). Obsidian itself treats other
 *     single-character statuses (e.g. `[/]`, `[-]`) as meaningful,
 *     distinct task states this ticket's own approved scope explicitly
 *     does not attempt to represent via a binary checkbox control — rather
 *     than silently collapsing an unrecognized status into checked/
 *     unchecked (data loss) or inventing a third UI state this ticket
 *     never designed, this module refuses outright and the caller falls
 *     back to raw editing, exactly like an ordered marker already does.
 *
 * A caller MUST fall back to showing the item's own RAW line whenever
 * this returns `ok: false` — this module never mutates anything, so that
 * fallback is always safe, mirroring edit/listMarkerProjection.ts's own
 * identical contract.
 *
 * ---- Apply-time: what counts as an allowed edit ----
 *
 * A standalone task-list item eligible for this projection is, by the
 * SAME structural gate edit/standaloneListMarkerProjection.ts's own
 * isStandaloneListItemEligibleForMarkerFreeProjection already enforces
 * (reused, never duplicated — see view/PartialEditView.ts's
 * buildStandaloneListProjections), always exactly ONE raw line.
 * invertTaskListProjection therefore refuses (`reason: "multiline-body"`)
 * whenever the edited body contains a newline character, mirroring
 * edit/listMarkerProjection.ts's own identical "multiline-body" refusal
 * for the identical reason: a caller must treat this exactly like that
 * module's own refusal — reject Apply outright, preserve the pane's
 * draft (checkbox state AND body), never guess a split.
 *
 * A user typing a checkbox- or marker-LOOKING string (e.g. "[x] more
 * text", "- more text") into the marker-free/checkbox-free body is never
 * special-cased, collapsed, or treated as a "real" second marker/
 * checkbox — invertTaskListProjection performs a single, literal
 * concatenation with no re-parsing of `body` at all, exactly mirroring
 * edit/listMarkerProjection.ts's own identical guarantee. See this
 * module's own test file for the exact fixtures proving this.
 *
 * ---- Checkbox completion state: case preservation vs. canonicalization ----
 *
 * `checkboxStatusChar` preserves the ORIGINAL character's case verbatim
 * (` `, `x`, or `X`) — an unedited round-trip (`invertTaskListProjection`
 * called with `editedChecked === projection.checked`) always reconstructs
 * `projection.rawLine` byte-for-byte, including an originally-`[X]`
 * item's own uppercase `X`. Only when `editedChecked` DIFFERS from
 * `projection.checked` (the user actually toggled the checkbox control)
 * does invertTaskListProjection write a CANONICAL status character —
 * lowercase `x` for checked, a single space for unchecked — never
 * attempting to guess or preserve a case distinction for a toggle the
 * user never expressed an opinion on. This is the same "reuse the
 * original verbatim on a no-op path, synthesize a minimal, canonical
 * value only where the previous state had none to reuse" policy
 * edit/listMarkerProjection.ts's own invertListMarkerProjection already
 * applies to markerSpacing's empty-body synthesis rule, applied here to
 * the checkbox status character instead.
 *
 * `checkboxSpacing` (the run of spaces/tabs between the checkbox's
 * closing `]` and the body) follows the IDENTICAL empty-synthesis policy
 * edit/listMarkerProjection.ts's own markerSpacing already uses: reused
 * verbatim when non-empty (no reformatting), but synthesized as exactly
 * one space when it was originally empty (a bare `- [ ]` with nothing
 * after the checkbox at all) AND the edited body is now non-empty — this
 * is what keeps `- [ ]` + newly-typed body from ever reconstructing as
 * the unparseable-as-a-task-checkbox `- [ ]text` (see
 * edit/listMarkerProjection.ts's own TASK_LIST_BODY_RE boundary, reused
 * unmodified above, for why a checkbox immediately followed by non-
 * whitespace body text would silently stop being recognized as a task
 * checkbox at all on a future reload).
 */

/** Matches edit/listMarkerProjection.ts's own LIST_MARKER_LINE_RE structurally (leading indentation, then an unordered `-`/`*`/`+` marker OR an ordered `1.`/`1)` marker, then optional marker-trailing whitespace and body) — intentionally its own regex object rather than an import of that module's own private constant, for the same independence reasons that module's own top doc comment already gives for not importing parser/parseDocument.ts's own LIST_RE. */
const LIST_MARKER_LINE_RE = /^([ \t]*)([-*+]|\d+[.)])([ \t]*)(.*)$/;

/** The exact "is this marker ordered" test edit/listMarkerProjection.ts itself already uses, reused verbatim (as its own independent copy, not an import — see this module's own top doc comment) so "which markers count as ordered" can never drift between the two modules. */
function isOrderedMarker(marker: string): boolean {
  return /^\d/.test(marker);
}

/**
 * Matches a task-list checkbox at the very start of a list item's own
 * body, structurally IDENTICAL to edit/listMarkerProjection.ts's own
 * TASK_LIST_BODY_RE (matches ANY single character between the brackets,
 * and requires the character immediately after the closing `]` to be
 * whitespace or end-of-line) — kept as this module's own independent copy
 * (not an import) for the same independence reasons this module's own
 * top doc comment already gives, but DELIBERATELY matching that module's
 * regex shape exactly, so the two modules never disagree about which raw
 * lines count as "a task-list line" at all: a line either matches BOTH
 * modules' notion of "task line" or NEITHER, by construction, since both
 * copies are pinned to the same shape and this module's own test suite
 * cross-checks that boundary directly (see this module's own test file's
 * "mirrors listMarkerProjection.ts's own task-line boundary" cases).
 */
const TASK_LIST_BODY_RE = /^\[([^\]])\](?:([ \t]+)([\s\S]*)|())$/;

/**
 * The checkbox status characters this ticket's own minimal approved scope
 * supports for a BINARY checkbox control: an unchecked space (` `) and a
 * checked `x`/`X` (case preserved on an unedited round-trip — see this
 * module's own top doc comment's "Checkbox completion state" section).
 * Any OTHER single-character status (`/`, `-`, `!`, ...) is a real,
 * meaningful Obsidian task state this ticket's own scope does not attempt
 * to represent — buildTaskListProjection refuses those with
 * "unsupported-status" rather than silently collapsing them into checked/
 * unchecked, and the caller falls back to raw editing (see this module's
 * own top doc comment).
 */
const SUPPORTED_CHECKBOX_STATUS_RE = /^[ xX]$/;

/** Every way buildTaskListProjection refuses to project a list line — see this module's own top doc comment for the full rationale behind each. */
export type TaskListProjectionBuildReason =
  | "not-list-line"
  | "ordered-marker"
  | "not-task-checkbox"
  | "unsupported-status";

/**
 * `rawLine` is the original line, byte-for-byte, kept alongside the split
 * pieces for caller convenience/debugging (mirrors
 * edit/listMarkerProjection.ts's own ListMarkerProjection carrying its
 * source alongside the split). `indent`/`marker`/`markerSpacing` mirror
 * that module's own identically-named fields exactly (leading whitespace,
 * literal `-`/`*`/`+` marker, and whatever run of spaces/tabs originally
 * sat between the marker and the checkbox's opening `[`).
 * `checkboxStatusChar` is the single original character between the
 * checkbox's `[`/`]` brackets, case preserved (see this module's own top
 * doc comment); `checked` is the derived boolean (`true` for `x`/`X`,
 * `false` for a space) the checkbox control's own `.checked` property
 * reads from and compares against. `checkboxSpacing` is whatever run of
 * spaces/tabs originally sat between the checkbox's closing `]` and the
 * body (possibly `""` for a bare `- [ ]` with nothing after the checkbox
 * at all). `body` is the marker-free, checkbox-free editable text —
 * exactly what the Partial Edit Pane's shared textarea shows and lets the
 * user edit for a task-list item. The invariant `indent + marker +
 * markerSpacing + "[" + checkboxStatusChar + "]" + checkboxSpacing + body
 * === rawLine` always holds — see this module's own top doc comment.
 */
export interface TaskListProjection {
  rawLine: string;
  indent: string;
  marker: string;
  markerSpacing: string;
  checkboxStatusChar: string;
  checked: boolean;
  checkboxSpacing: string;
  body: string;
}

export type TaskListProjectionBuildResult =
  | { ok: true; projection: TaskListProjection }
  | { ok: false; reason: TaskListProjectionBuildReason };

/**
 * Build a TaskListProjection from ONE raw list-item line — the exact line
 * edit/partialEdit.ts's own extractSubtreeText already returns for a
 * standalone single-line list item (byte-for-byte, no reformatting). See
 * this module's own top doc comment for the four refusal reasons and the
 * caller-side fallback each requires. Callers should attempt this ONLY
 * after buildListMarkerProjection (edit/listMarkerProjection.ts) itself
 * refused the SAME line with reason "task-list-marker" — see
 * view/PartialEditView.ts's buildStandaloneListProjections, the one call
 * site both modules are ever invoked from together, for why that
 * ordering is what keeps the two projections mutually exclusive.
 */
export function buildTaskListProjection(rawLine: string): TaskListProjectionBuildResult {
  const m = rawLine.match(LIST_MARKER_LINE_RE);
  if (!m) {
    // Defensive only — see this module's top doc comment.
    return { ok: false, reason: "not-list-line" };
  }
  const [, indent, marker, markerSpacing, body] = m;
  if (isOrderedMarker(marker)) {
    return { ok: false, reason: "ordered-marker" };
  }
  const taskMatch = body.match(TASK_LIST_BODY_RE);
  if (!taskMatch) {
    return { ok: false, reason: "not-task-checkbox" };
  }
  const [, checkboxStatusChar, spacedRest, spacedBody] = taskMatch;
  // TASK_LIST_BODY_RE's two alternatives: either "]" is immediately
  // followed by one-or-more spaces/tabs (spacedRest non-undefined; the
  // remainder splits into that whitespace run as checkboxSpacing and
  // whatever follows as body), or "]" is the very last character on the
  // line at all (both alternative-branch groups undefined; body/
  // checkboxSpacing are simply "").
  const checkboxSpacing = spacedRest ?? "";
  const taskBody = spacedRest !== undefined ? (spacedBody ?? "") : "";
  if (!SUPPORTED_CHECKBOX_STATUS_RE.test(checkboxStatusChar)) {
    return { ok: false, reason: "unsupported-status" };
  }
  const checked = checkboxStatusChar === "x" || checkboxStatusChar === "X";
  return {
    ok: true,
    projection: {
      rawLine,
      indent,
      marker,
      markerSpacing,
      checkboxStatusChar,
      checked,
      checkboxSpacing,
      body: taskBody,
    },
  };
}

/** The shared textarea's display value for a built projection — just `projection.body`. Named for the same "callers reference the CONCEPT, not the field name" reason edit/listMarkerProjection.ts's own projectedListBodyText already gives. */
export function projectedTaskBodyText(projection: TaskListProjection): string {
  return projection.body;
}

/** The checkbox control's own `.checked` value for a built projection — just `projection.checked`. Its own named export for the same reason projectedTaskBodyText above is. */
export function projectedTaskChecked(projection: TaskListProjection): boolean {
  return projection.checked;
}

/**
 * "multiline-body" is the ONLY refusal reason — see this module's own top
 * doc comment's "Apply-time: what counts as an allowed edit" section for
 * why a standalone task-list item can never accept a body edit that
 * introduces a newline.
 */
export type TaskListProjectionInvertReason = "multiline-body";

export type TaskListProjectionInvertResult =
  | { ok: true; rawLine: string }
  | { ok: false; reason: TaskListProjectionInvertReason };

/**
 * Reconstruct the raw task-list item line from `projection` (the
 * ORIGINAL, load-time split — never mutated), `editedChecked` (the
 * checkbox control's CURRENT `.checked` value, toggled or not), and
 * `editedBody` (the shared textarea's CURRENT value, edited or not). See
 * this module's own top doc comment for the checkbox-status case-
 * preservation-vs-canonicalization rule and the checkboxSpacing empty-
 * synthesis rule. An unedited call (`editedChecked === projection.checked
 * && editedBody === projection.body`) always reconstructs
 * `projection.rawLine` byte-for-byte.
 */
export function invertTaskListProjection(
  projection: TaskListProjection,
  editedChecked: boolean,
  editedBody: string
): TaskListProjectionInvertResult {
  if (editedBody.includes("\n")) {
    return { ok: false, reason: "multiline-body" };
  }
  // Checkbox status: reuse the ORIGINAL character verbatim (case
  // preserved) whenever the checked/unchecked STATE itself is unchanged;
  // only a genuine toggle writes a canonical replacement character — see
  // this module's own top doc comment.
  const statusChar =
    editedChecked === projection.checked
      ? projection.checkboxStatusChar
      : editedChecked
        ? "x"
        : " ";
  const checkboxSpacing =
    projection.checkboxSpacing === "" && editedBody !== "" ? " " : projection.checkboxSpacing;
  return {
    ok: true,
    rawLine:
      projection.indent +
      projection.marker +
      projection.markerSpacing +
      "[" +
      statusChar +
      "]" +
      checkboxSpacing +
      editedBody,
  };
}
