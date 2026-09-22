/**
 * Phase 5L-4 ("Multi-Line Leaf List Item Partial Edit Projection"): the
 * multi-line counterpart of edit/listMarkerProjection.ts,
 * edit/taskListProjection.ts, and edit/orderedListProjection.ts — a pure
 * text transform that lets the Partial Edit Pane show a STANDALONE,
 * CHILD-LIST-FREE list item whose own line range spans MORE THAN ONE raw
 * line (a leading marker line plus one or more continuation lines) as a
 * single, marker-free, multi-line editable body, while its own structural
 * marker (unordered `-`/`*`/`+`, task `[ ]`/`[x]`, or ordered `N.`/`N)`)
 * stays hidden from that body exactly the way Phase 5L-1/5L-2/5L-3 already
 * hide it for a SINGLE-line leaf item.
 *
 * ---- Deliberately independent of, and layered ON TOP OF, the three
 * single-line projection modules ----
 *
 * This module does NOT re-implement marker/checkbox/number/delimiter
 * parsing at all. The FIRST raw line of a multi-line leaf item is, in
 * isolation, structurally identical to what edit/listMarkerProjection.ts's
 * buildListMarkerProjection, edit/taskListProjection.ts's
 * buildTaskListProjection, and edit/orderedListProjection.ts's
 * buildOrderedListProjection already know how to split/reconstruct — this
 * module's own buildMultiLineListItemProjection below tries exactly those
 * three builders, in the SAME priority order
 * view/PartialEditView.ts's buildStandaloneListProjections already
 * establishes for the single-line case (unordered first; on its own
 * "task-list-marker" refusal, task; on its own "ordered-marker" refusal,
 * ordered), against ONLY the item's own first line. None of the three
 * single-line modules' own contracts are widened, duplicated, or forked —
 * this module's only NEW responsibility is splitting/reconstructing the
 * CONTINUATION lines beneath that first line, which none of those three
 * modules has any concept of at all (each of them refuses outright,
 * `"multiline-body"`, the instant its own edited body contains a `\n`).
 *
 * ---- Why this module is NOT parser-free, unlike its three siblings ----
 *
 * edit/listMarkerProjection.ts, edit/taskListProjection.ts, and
 * edit/orderedListProjection.ts are all deliberately "pure text transform"
 * modules with zero dependency on parser/parseDocument.ts or
 * parser/complexBlocks.ts — see each of their own top doc comments. That
 * independence is safe for them because a SINGLE-line body edit can only
 * ever change BODY TEXT; it structurally cannot manufacture a new nested
 * list item, callout, blockquote, fenced code block, or table, because
 * `invertListMarkerProjection`/`invertTaskListProjection`/
 * `invertOrderedListProjection` all refuse outright the one and only way
 * that could happen (an embedded newline in the edited body).
 *
 * A MULTI-line body edit has no such guarantee: an edited CONTINUATION
 * line is, once re-indented and re-spliced back into the document,
 * ordinary Markdown source text again — and ordinary Markdown source text
 * CAN accidentally read as a nested list item (a line starting with
 * `-`/`*`/`+`/`N.` at a deep enough indent), a blockquote/callout (a line
 * starting with `>`), a fenced code block (a line starting with
 * ` ``` `/`~~~`), or a table row, once this plugin's own scanners
 * (parser/parseDocument.ts's list-item scan, parser/complexBlocks.ts's
 * scanComplexBlocks) see it. This module's own top-level safety net —
 * validateMultiLineListItemCandidate below, always run from
 * invertMultiLineListItemProjection before ANY candidate text is ever
 * returned as `ok: true` — exists ONLY to catch that one new risk class,
 * and for that reason it deliberately DOES depend on
 * parser/parseDocument.ts's parseDocument and
 * parser/complexBlocks.ts's scanComplexBlocks, re-parsing the freshly
 * reconstructed candidate text as its OWN tiny standalone document and
 * verifying the result is still exactly one leaf list item of the
 * ORIGINAL kind, with no nested child list and no callout/blockquote/
 * fenced-code/table/thematic-break block anywhere inside it. See that
 * function's own doc comment for the exact checks.
 *
 * This module still never touches, or knows anything about, the REAL
 * ParsedDocument the item actually lives in (no node ids, no line-number
 * resolution, no snapshot/conflict handling — edit/partialEdit.ts's
 * applySubtreeEdit, called by view/PartialEditView.ts exactly like every
 * other Partial Edit kind, owns all of that, completely unchanged by this
 * ticket). It only ever parses the small, self-contained CANDIDATE string
 * it itself just built, as a disposable, throwaway mini-document that is
 * never written anywhere — exactly the same "re-parse a freshly
 * reconstructed candidate and check it re-resolves cleanly, entirely
 * independent of the real document" safety pattern
 * view/PartialEditView.ts's own applyEdit already uses for a projecting
 * callout/blockquote's own candidate validation (see that method's
 * `structurallyValid` check, in its `quoteProjection` branch).
 *
 * ---- Continuation indentation: the "canonical" policy ----
 *
 * A multi-line leaf item's own continuation lines are, to
 * parser/parseDocument.ts's own line-scanning contract, "owned" by the
 * item as long as their own indent column is deeper than the item's own
 * marker column (see that module's own `closeItemsWithIndentAtLeast`) —
 * there is no requirement that every continuation line share exactly the
 * same indentation, or that it align with any particular column at all.
 * Real-world notes are NOT consistent about this (a continuation line is
 * just as often indented to the marker's own column-width as it is to the
 * checkbox's, or to some other convenient depth) — so rather than
 * requiring, or trying to detect, one single "the" indentation a document
 * already uses, this module DEFINES its own canonical one and applies it
 * uniformly:
 *
 *   canonicalContinuationIndent = a run of literal SPACE characters whose
 *   COUNT equals the character length of the first raw line's own
 *   `indent + marker(+delimiter) + markerSpacing` prefix — i.e. exactly
 *   where that first line's own BODY begins, per whichever of the three
 *   single-line projections built it (for a task-list first line this is
 *   deliberately the LIST marker's own body-start column, e.g. `"- "`'s
 *   2 characters, NOT the column after the `[ ]` checkbox too — the
 *   checkbox itself is, at the shared LIST_MARKER_LINE_RE marker-split
 *   level every one of the three single-line builders itself uses,
 *   already part of that first line's own "body"; aligning continuation
 *   to the plain list-marker's own body column, not the checkbox's, is
 *   what matches ordinary hand-written task-list continuation lines,
 *   which this ticket's own design doc's worked example itself uses).
 *
 * This canonical indent is a plain CHARACTER COUNT, not a tab-aware
 * COLUMN count (unlike parser/parseDocument.ts's own indentColumnsOf) —
 * deliberately, for the same reason every one of the three single-line
 * projection modules only ever concatenates ORIGINAL captured strings and
 * never re-derives indentation via column math: a literal, fixed-width
 * run of spaces is simpler, always unambiguous, and (since it is always
 * built to be longer than the first line's own marker prefix, which is
 * itself always at least one character past the item's own marker
 * column) always deep enough that parser/parseDocument.ts's own
 * column-based ownership test keeps recognizing every reconstructed
 * continuation line as belonging to this SAME item — never accidentally
 * shallow enough to escape it. (A first line built from real, mixed
 * tab/space indentation is excluded upstream entirely — see
 * edit/standaloneMultiLineListItemProjection.ts's own `!node.unsafeIndent`
 * check — so this module never has to reconcile canonical spaces against
 * an original tab-based column count in practice.)
 *
 * At BUILD time (reading the original raw text), this canonical prefix
 * LENGTH is also the boundary this module uses to safely split each
 * ORIGINAL continuation line into "structural indentation to strip" vs.
 * "the user's own content, indentation included" — see
 * buildMultiLineListItemProjection's own inline comments. A non-blank
 * continuation line whose OWN leading whitespace run is shorter than this
 * canonical length cannot be split this way without guessing, so
 * buildMultiLineListItemProjection refuses outright
 * (`"malformed-continuation-indent"`) rather than ever silently
 * discarding or misplacing part of that line's own content — the caller
 * falls back to raw editing for the WHOLE item, exactly like every other
 * build-time refusal in this module and its three single-line siblings.
 * Any leading whitespace on a qualifying line BEYOND the canonical length
 * is preserved, verbatim, as the first characters of that line's own
 * editable body text — never trimmed away — so a continuation line that
 * happens to be extra-indented (e.g. for a nested code-like example
 * inside the item's own prose) keeps that extra indentation exactly as
 * typed, both on load and after every Apply.
 *
 * At APPLY time (reconstructing raw text from the pane's current draft),
 * this SAME canonical indent is written back in FRONT OF EVERY non-blank
 * continuation line, unconditionally — never the line's own original
 * indentation, even for a line the user never touched. This is a
 * deliberate, intentional difference from the three single-line
 * projection modules' own "an unedited round-trip reconstructs the
 * ORIGINAL raw line byte-for-byte" guarantee: because a multi-line body's
 * own line COUNT can freely change (lines added, removed, split, merged,
 * reordered — there is no longer a stable 1:1 mapping from "this edited
 * line" back to "that one original line"), preserving each individual
 * line's own original indentation byte-for-byte is not a coherent
 * contract to offer. Normalizing every continuation line's structural
 * indentation to one canonical value instead is simpler, always safe (see
 * "Why this module is NOT parser-free" above for the safety net that
 * catches every way a normalized-indent reconstruction could otherwise go
 * wrong), and matches ordinary Markdown authoring convention. A fully
 * UNEDITED round trip is still byte-identical whenever the original
 * document already used this exact canonical indentation for every
 * continuation line (the common case for hand-written notes that align
 * continuation lines to the marker's own body column) — it is only a
 * document whose ORIGINAL continuation indentation happened to differ
 * from canonical (while still being deep enough to build successfully)
 * that this module intentionally re-normalizes on Apply, even with zero
 * user edits.
 *
 * A blank continuation line (matching parser/parseDocument.ts's own
 * `isBlankLine` — empty, or whitespace-only) is represented in the
 * editable body as a plain EMPTY string, with NO canonical indent
 * synthesized in front of it either at build time (there is nothing to
 * strip) or at Apply time (an empty line stays an empty line — a blank
 * line never closes a list item either way, per
 * parser/parseDocument.ts's own `isBlankLine` short-circuit, so there is
 * no readability or validity reason to pad it).
 *
 * ---- The number/checkbox field: identical contract to the single-line
 * case ----
 *
 * For a `listKind: "task"` or `listKind: "ordered"` multi-line item, the
 * FIRST line's own checkbox/number is exposed as the exact SAME
 * independently-editable structural field the single-line case already
 * exposes (view/PartialEditView.ts's taskCheckboxInputEl/
 * orderedNumberInputEl, reused UNCHANGED — see this ticket's own design
 * doc §7 for why no new control is introduced). Apply-time validation for
 * the number field is the exact same
 * edit/orderedListProjection.ts#isValidOrderedListNumberText this
 * module's own invertMultiLineListItemProjection delegates to via
 * invertOrderedListProjection, unmodified; the delimiter (`.`/`)`) is,
 * exactly like the single-line case, NEVER an editable field. This module
 * never inspects or compares sibling list items' own numbers either — see
 * edit/orderedListProjection.ts's own top doc comment's "Explicitly NOT
 * this module's concern: renumbering" section, which applies unchanged
 * here: duplicate/non-sequential/reverse-order sibling numbers are never
 * an Apply-rejection reason at any layer.
 *
 * ---- Phase 5L-5 ("Leaf List Item Blank-Line Continuation Projection"):
 * blank lines within the continuation body ----
 *
 * A blank continuation LINE (see "Continuation indentation" above) was
 * already fully supported by this module before Phase 5L-5, in the one
 * shape that can ever legitimately occur in ORIGINAL raw text: an
 * INTERIOR blank line, with at least one more non-blank continuation line
 * after it (e.g. a two-paragraph item body). buildMultiLineListItemProjection
 * and invertMultiLineListItemProjection both already round-trip that case
 * correctly, with zero Phase 5L-5 changes — see the empty-string
 * representation described above.
 *
 * What Phase 5L-5 adds is narrower: handling a TRAILING blank line (or a
 * run of them) that the user types at the very END of the edited body in
 * the shared textarea. This was empirically verified, before writing any
 * code, against the real parser/parseDocument.ts and
 * parser/complexBlocks.ts (two disposable probe test files, since
 * deleted, each dumping real parseDocument()/scanComplexBlocks() output
 * for blank-line fixtures) — not assumed from reading source. The
 * relevant, confirmed facts:
 *
 *   - parser/parseDocument.ts's own list-item range-closing behavior
 *     NEVER lets a blank line be the LAST line of an item's own `range`:
 *     a trailing blank (or run of trailing blanks) is always trimmed off
 *     before the range closes, regardless of what follows (end of
 *     document, a sibling item at the same/shallower indent, a dedented
 *     paragraph, or a heading) — identically for unordered/task/ordered
 *     items. buildMultiLineListItemProjection already benefits from this
 *     for free, since the ORIGINAL raw text it reads can never itself end
 *     in a blank continuation line.
 *
 *   - A user editing the shared textarea is, however, free to type a
 *     trailing blank line at the very end of the body — the textarea has
 *     no such restriction. Naively reconstructing every edited
 *     continuation line verbatim (the pre-5L-5 behavior) would then
 *     produce a CANDIDATE whose raw text ends in a blank line, which
 *     validateMultiLineListItemCandidate's own re-parse would always
 *     trim when computing `node.range` — making the candidate's own last
 *     line index disagree with the re-parsed node's own
 *     `range.endLine`, which validateMultiLineListItemCandidate's range
 *     check would then reject as `"unsafe-structure"`. This was a
 *     spurious Apply rejection for a completely harmless edit (a trailing
 *     blank line contributes nothing to a list item's own content or
 *     rendering — the parser silently drops it either way).
 *
 *   - A blank line followed by a ComplexBlock (blockquote/callout/fenced
 *     code/table), even with nothing else after it, is NOT trimmed —
 *     scanComplexBlocks still absorbs it into the item's own `range`
 *     (confirmed by probe), so this case was already correctly caught,
 *     with zero Phase 5L-5 changes, by
 *     edit/standaloneMultiLineListItemProjection.ts's existing
 *     `hasComplexBlockInMultiLineListItemContinuation` eligibility gate
 *     (which scans within `node.range`), and separately by
 *     validateMultiLineListItemCandidate's own ComplexBlock check below.
 *
 *   - A blank line followed by a deeper-indented, list-marker-looking
 *     line is correctly parsed as a genuine nested CHILD list item
 *     (confirmed by probe: `childIds` is populated on the parent), so
 *     this was already correctly caught, with zero Phase 5L-5 changes, by
 *     validateMultiLineListItemCandidate's existing
 *     `childIds.length !== 0` check.
 *
 * The fix is therefore narrow and entirely internal to this module:
 * trimTrailingBlankContinuationLines below drops every blank entry from
 * the END of the edited continuation lines (an INTERIOR blank — one
 * followed by more non-blank content — is left exactly where it is)
 * before invertMultiLineListItemProjection reconstructs the candidate
 * text, bringing this module's own candidate construction into agreement
 * with the real parser's own trim-on-close rule instead of fighting it —
 * the same "normalize rather than fight the parser" principle already
 * applied to continuation indentation above. If every continuation line
 * is blank (or there are none at all), the result is an empty array, and
 * the candidate naturally collapses to the already-supported
 * "every continuation line removed" single-line-candidate path.
 *
 * No change was needed, or made, to
 * edit/standaloneMultiLineListItemProjection.ts's eligibility gates or to
 * view/PartialEditView.ts: blank-line handling is entirely internal to
 * this module's own build/invert functions, and the pre-existing
 * eligibility checks already handle every ComplexBlock/child-list
 * exclusion correctly, as confirmed above.
 */
import { isListNode, ParsedDocument } from "../model/block";
import { parseDocument } from "../parser/parseDocument";
import { scanComplexBlocks } from "../parser/complexBlocks";
import {
  buildListMarkerProjection,
  invertListMarkerProjection,
  ListMarkerProjection,
} from "./listMarkerProjection";
import {
  buildTaskListProjection,
  invertTaskListProjection,
  TaskListProjection,
} from "./taskListProjection";
import {
  buildOrderedListProjection,
  invertOrderedListProjection,
  OrderedListProjection,
} from "./orderedListProjection";

/** Which of the three single-line kinds a multi-line leaf item's own FIRST line resolved to — see this module's own top doc comment. */
export type MultiLineListItemKind = "unordered" | "task" | "ordered";

/**
 * The item's own first-line split, carried as a discriminated union over
 * the exact projection type the corresponding single-line module already
 * defines — `kind` always matches which one of the three
 * buildMultiLineListItemProjection actually used (see that function's own
 * doc comment for the fixed try-order). Never a hand-rolled duplicate of
 * any of the three shapes: the `projection` field IS a real
 * ListMarkerProjection/TaskListProjection/OrderedListProjection, produced
 * by, and only ever reconstructed via, that module's own build/invert
 * pair.
 */
export type MultiLineFirstLineSlot =
  | { kind: "unordered"; projection: ListMarkerProjection }
  | { kind: "task"; projection: TaskListProjection }
  | { kind: "ordered"; projection: OrderedListProjection };

/**
 * `rawText` is the item's ORIGINAL full multi-line text, byte-for-byte
 * (the exact string edit/partialEdit.ts's own extractSubtreeText already
 * returns for a multi-line leaf list item). `listKind`/`firstLine` are
 * this projection's own first-line split (see MultiLineFirstLineSlot's
 * own doc comment). `continuationIndent` is the canonical, literal-space
 * indentation string this projection always writes in front of every
 * non-blank continuation line at Apply time (see this module's own top
 * doc comment's "Continuation indentation" section) — its own LENGTH is
 * also what buildMultiLineListItemProjection used, at build time, to
 * split each original continuation line into "stripped structural prefix"
 * vs. "kept as body content". `body` is the shared textarea's own
 * multi-line display value: the first line's own marker-free body, then
 * one joining `"\n"`, then each continuation line's own marker-free
 * (indent-stripped) text, each still separated by `"\n"` in original
 * document order, with a blank original continuation line represented as
 * an empty string in this same join. There is no separate "final newline"
 * field: exactly like every other Partial Edit kind in this codebase,
 * `rawText`/`body` are plain `"\n"`-joined line arrays with no trailing
 * newline of their own (edit/partialEdit.ts's own extractSubtreeText/
 * applySubtreeEdit never store or expect one either), so none is needed
 * here.
 */
export interface MultiLineListItemProjection {
  rawText: string;
  listKind: MultiLineListItemKind;
  firstLine: MultiLineFirstLineSlot;
  continuationIndent: string;
  body: string;
}

/**
 * Every way buildMultiLineListItemProjection refuses to project a
 * multi-line leaf item's raw text — see this module's own top doc comment
 * for the full rationale behind each:
 *
 *   - "single-line": `rawText` contains no `"\n"` at all — defensive
 *     only; a caller should only ever reach this module once
 *     edit/standaloneMultiLineListItemProjection.ts's own
 *     isStandaloneMultiLineLeafListItemEligibleForProjection has already
 *     confirmed the item's own node.range spans more than one line, but
 *     this is checked and returned rather than assumed, matching this
 *     codebase's standing "never throw, never silently coerce an
 *     unexpected shape" convention.
 *   - "first-line-not-projectable": none of
 *     buildListMarkerProjection/buildTaskListProjection/
 *     buildOrderedListProjection succeeded on the item's own first raw
 *     line (e.g. an unsupported task-checkbox status character — see
 *     edit/taskListProjection.ts's own "unsupported-status" refusal). The
 *     caller falls back to raw editing for the whole item, exactly like
 *     the single-line case already does for its own analogous refusals.
 *   - "malformed-continuation-indent": at least one non-blank
 *     continuation line's own leading whitespace run is SHORTER than the
 *     canonical continuation-indent length this projection would need to
 *     safely strip — see this module's own top doc comment's
 *     "Continuation indentation" section for why this must refuse rather
 *     than guess.
 */
export type MultiLineListItemProjectionBuildReason =
  | "single-line"
  | "first-line-not-projectable"
  | "malformed-continuation-indent";

export type MultiLineListItemProjectionBuildResult =
  | { ok: true; projection: MultiLineListItemProjection }
  | { ok: false; reason: MultiLineListItemProjectionBuildReason };

/** Matches parser/parseDocument.ts's own isBlankLine exactly (kept as an independent copy — see this module's own top doc comment for why every projection module in this family keeps its own copy of shapes it shares with a sibling rather than importing them). */
function isBlankLine(line: string): boolean {
  return /^[ \t]*$/.test(line);
}

/** Every leading space/tab character run at the start of `line`. */
function leadingWhitespaceLength(line: string): number {
  const m = line.match(/^[ \t]*/);
  return m ? m[0].length : 0;
}

/**
 * Build a MultiLineListItemProjection from a multi-line leaf list item's
 * ORIGINAL full raw text (the item's own first line, then one or more
 * continuation lines — exactly what edit/partialEdit.ts's own
 * extractSubtreeText already returns for such an item). See this module's
 * own top doc comment for the three refusal reasons and the caller-side
 * fallback each requires (always: show the item's own RAW multi-line text
 * unchanged — this module never mutates anything, so that fallback is
 * always safe).
 */
export function buildMultiLineListItemProjection(
  rawText: string
): MultiLineListItemProjectionBuildResult {
  const lines = rawText.split("\n");
  if (lines.length < 2) {
    return { ok: false, reason: "single-line" };
  }
  const [firstRawLine, ...continuationRawLines] = lines;

  let firstLine: MultiLineFirstLineSlot | null = null;
  const listBuilt = buildListMarkerProjection(firstRawLine);
  if (listBuilt.ok) {
    firstLine = { kind: "unordered", projection: listBuilt.projection };
  } else if (listBuilt.reason === "task-list-marker") {
    const taskBuilt = buildTaskListProjection(firstRawLine);
    if (taskBuilt.ok) {
      firstLine = { kind: "task", projection: taskBuilt.projection };
    }
  } else if (listBuilt.reason === "ordered-marker") {
    const orderedBuilt = buildOrderedListProjection(firstRawLine);
    if (orderedBuilt.ok) {
      firstLine = { kind: "ordered", projection: orderedBuilt.projection };
    }
  }
  if (!firstLine) {
    return { ok: false, reason: "first-line-not-projectable" };
  }

  // The canonical continuation-indent LENGTH: exactly where this first
  // line's own LIST-MARKER body begins — see this module's own top doc
  // comment's "Continuation indentation" section. For "unordered"/
  // "ordered", that is simply `indent + marker(+delimiter) +
  // markerSpacing`, which always precedes `body` in either single-line
  // projection's own core invariant, so it equals "how many characters of
  // the first raw line are NOT the body". For "task", the checkbox itself
  // (`[` + status + `]` + checkboxSpacing) is deliberately EXCLUDED from
  // this prefix too — continuation aligns to the plain LIST marker's own
  // body column, not the checkbox-inclusive one (see this module's own
  // top doc comment for why this matches ordinary hand-written
  // continuation lines) — so it is computed from
  // `indent`/`marker`/`markerSpacing` directly instead of via
  // `rawLine.length - body.length`.
  const firstLineBodyText =
    firstLine.kind === "unordered"
      ? firstLine.projection.body
      : firstLine.kind === "task"
        ? firstLine.projection.body
        : firstLine.projection.body;
  const continuationIndentLength =
    firstLine.kind === "task"
      ? firstLine.projection.indent.length +
        firstLine.projection.marker.length +
        firstLine.projection.markerSpacing.length
      : firstRawLine.length - firstLineBodyText.length;
  const continuationIndent = " ".repeat(continuationIndentLength);

  const continuationBodyLines: string[] = [];
  for (const raw of continuationRawLines) {
    if (isBlankLine(raw)) {
      continuationBodyLines.push("");
      continue;
    }
    if (leadingWhitespaceLength(raw) < continuationIndentLength) {
      return { ok: false, reason: "malformed-continuation-indent" };
    }
    continuationBodyLines.push(raw.slice(continuationIndentLength));
  }

  const body = [firstLineBodyText, ...continuationBodyLines].join("\n");
  return {
    ok: true,
    projection: { rawText, listKind: firstLine.kind, firstLine, continuationIndent, body },
  };
}

/** The shared textarea's display value for a built projection — just `projection.body`. Named for the same "callers reference the CONCEPT, not the field name" reason every sibling projection module's own identically-shaped accessor already is. */
export function projectedMultiLineBodyText(projection: MultiLineListItemProjection): string {
  return projection.body;
}

/** The task checkbox control's own `.checked` value for a built projection — `projection.firstLine.projection.checked` when `listKind === "task"`, `false` for every other kind (a `false` default rather than `null`/`undefined` so view/PartialEditView.ts's renderTaskCheckboxRow can always read this unconditionally, mirroring how that row's own control is always DISABLED, never absent, for a non-task kind). */
export function projectedMultiLineChecked(projection: MultiLineListItemProjection): boolean {
  return projection.firstLine.kind === "task" ? projection.firstLine.projection.checked : false;
}

/** The ordered-number control's own display value for a built projection — `projection.firstLine.projection.number` when `listKind === "ordered"`, `""` for every other kind (mirroring projectedMultiLineChecked's own "always-readable default" rationale immediately above). */
export function projectedMultiLineNumberText(projection: MultiLineListItemProjection): string {
  return projection.firstLine.kind === "ordered" ? projection.firstLine.projection.number : "";
}

/**
 * "invalid-number" mirrors edit/orderedListProjection.ts's own identical
 * refusal, reached only when `listKind === "ordered"` — see this module's
 * own top doc comment's "The number/checkbox field" section.
 * "unsafe-structure" is this module's own addition, covering every way
 * validateMultiLineListItemCandidate (below) can refuse a freshly
 * reconstructed candidate — see that function's own doc comment for the
 * exhaustive list of what it checks. Both are Apply-time-only refusals: a
 * caller must reject Apply outright and preserve every draft field
 * (checkbox/number control AND body textarea) exactly as the user had it,
 * the same contract every sibling projection module's own Apply-time
 * refusal already carries.
 */
export type MultiLineListItemProjectionInvertReason = "invalid-number" | "unsafe-structure";

export type MultiLineListItemProjectionInvertResult =
  | { ok: true; rawText: string }
  | { ok: false; reason: MultiLineListItemProjectionInvertReason };

/**
 * Re-parses `candidateText` (a freshly reconstructed multi-line leaf list
 * item's own full raw text — never the real document) as its OWN tiny,
 * throwaway standalone document, and confirms it still resolves to
 * exactly the safe shape this ticket's own approved scope requires:
 *
 *   - a list node exists at line 0 of that mini-document (the candidate's
 *     own first line always round-trips through one of the three
 *     single-line invert functions, which never themselves introduce a
 *     newline — so this should always be true in practice; checked, not
 *     assumed, per this codebase's standing convention);
 *   - that node's own kind (`ordered` boolean) still matches
 *     `expectedKind` — the candidate's first line can never flip from
 *     ordered to unordered or back (the marker itself is never edited —
 *     see edit/orderedListProjection.ts's own "delimiter... NEVER an
 *     editable field" section, which extends here to the marker/checkbox
 *     shape as a whole too), so this should also always hold; checked
 *     defensively regardless;
 *   - that node's own range spans the ENTIRE candidate text (line 0
 *     through the candidate's own last line) — refusing any edit whose
 *     reconstructed continuation content would, once re-parsed,
 *     terminate the item EARLY (e.g. edited body content that reparses as
 *     a heading — though see this module's own top doc comment for why a
 *     canonical-indent-prefixed line can in practice never match
 *     parser/parseDocument.ts's own heading regex at all) or leave
 *     trailing lines the item no longer owns;
 *   - that node owns NO nested child list item (`childIds.length === 0`)
 *     — refusing any edit whose reconstructed continuation content would
 *     itself parse as a valid, sufficiently-indented list-item line (this
 *     is the single most important check this function performs: see
 *     this module's own top doc comment's "Why this module is NOT
 *     parser-free" section for exactly how a plain typed `-`/`1.`-looking
 *     line in a continuation could otherwise silently manufacture a real
 *     nested list item once canonical-indent-prefixed and re-spliced into
 *     the real document);
 *   - that node is not `unsafeIndent` (defensive only — this projection's
 *     own canonical indent is always pure spaces, so a mixed tab/space
 *     leading run can never actually occur in a candidate this function
 *     builds, but checked rather than assumed);
 *   - no ComplexBlock (callout, blockquote, fenced-code, table, or
 *     thematic-break — parser/complexBlocks.ts's own scanComplexBlocks)
 *     overlaps ANY of the candidate's own continuation lines (line 1
 *     through the candidate's own last line) — refusing any edit whose
 *     reconstructed continuation content would itself read as one of
 *     those other block kinds (a typed `>` quote prefix, a fenced code
 *     opener, a table row/separator, or a thematic-break rule), per this
 *     ticket's own explicit scope boundary (those kinds are always raw
 *     fallback / out of scope for THIS ticket's structured projection —
 *     see this ticket's own design doc §6).
 *
 * Exported (not merely internal) so this exact check can be exercised
 * directly, through the real parseDocument/scanComplexBlocks pipeline,
 * from this module's own test file — mirroring how every sibling
 * projection module already exports its own validators
 * (isValidOrderedListNumberText) for the identical reason.
 */
export function validateMultiLineListItemCandidate(
  candidateText: string,
  expectedKind: MultiLineListItemKind
): boolean {
  const candidateLines = candidateText.split("\n");
  const candidateDoc: ParsedDocument = parseDocument(candidateText);
  const node = candidateDoc.nodes.get("li-0");
  if (!node || !isListNode(node) || node.range.startLine !== 0) {
    return false;
  }
  if (node.ordered !== (expectedKind === "ordered")) {
    return false;
  }
  if (node.range.endLine !== candidateLines.length - 1) {
    return false;
  }
  if (node.childIds.length !== 0) {
    return false;
  }
  if (node.unsafeIndent) {
    return false;
  }
  const disallowedComplexBlockKinds = new Set([
    "callout",
    "blockquote",
    "fenced-code",
    "table",
    "thematic-break",
  ]);
  const hasDisallowedComplexBlock = scanComplexBlocks(candidateDoc).blocks.some(
    (block) =>
      disallowedComplexBlockKinds.has(block.kind) &&
      block.range.startLine <= candidateLines.length - 1 &&
      block.range.endLine >= 1
  );
  if (hasDisallowedComplexBlock) {
    return false;
  }
  return true;
}

/**
 * Reconstruct the multi-line leaf list item's own raw text from
 * `projection` (the ORIGINAL, load-time split — never mutated),
 * `editedChecked` (the task-checkbox control's CURRENT `.checked` value —
 * used only when `projection.listKind === "task"`, ignored for every
 * other kind, mirroring view/PartialEditView.ts's own always-present-but-
 * conditionally-relevant control wiring for the single-line case),
 * `editedNumberText` (the ordered-number control's CURRENT text value —
 * used only when `projection.listKind === "ordered"`, ignored otherwise),
 * and `editedBody` (the shared textarea's CURRENT multi-line value,
 * edited or not).
 *
 * The first line of `editedBody` (everything before its own first `"\n"`,
 * or the whole string if it contains none) is reconstructed via whichever
 * single-line invert function matches `projection.listKind`
 * (invertListMarkerProjection/invertTaskListProjection/
 * invertOrderedListProjection, completely unmodified) — that first split
 * segment can never itself contain a `"\n"` (a `String.split("\n")`
 * segment never does), so each of those three functions' own
 * "multiline-body" refusal is structurally unreachable from here; checked
 * defensively regardless (this codebase's standing convention), folded
 * into this function's own "unsafe-structure" reason if it were somehow
 * ever reached. `invertOrderedListProjection`'s own "invalid-number"
 * refusal IS genuinely reachable (a real, user-facing validation failure
 * — see edit/orderedListProjection.ts's own top doc comment) and is
 * propagated here verbatim as this function's own "invalid-number".
 *
 * Every subsequent line of `editedBody` is a continuation line: an EMPTY
 * string reconstructs to an empty raw line (a blank line — see this
 * module's own top doc comment's "Continuation indentation" section for
 * why no canonical indent is ever synthesized in front of one); any other
 * string reconstructs to `projection.continuationIndent + thatLine`,
 * UNCONDITIONALLY (see that same section for why this applies even to a
 * line the user never touched).
 *
 * Before ever returning `ok: true`, the fully reconstructed candidate is
 * run through validateMultiLineListItemCandidate above — any failure
 * there refuses the WHOLE Apply with reason "unsafe-structure", exactly
 * like an "invalid-number" refusal: every draft field left exactly as the
 * user had it, no partial write of any kind.
 */
/**
 * Phase 5L-5 ("Leaf List Item Blank-Line Continuation Projection"): drop
 * every blank entry from the END of `continuationLines` (an interior blank
 * — one with at least one non-blank entry somewhere after it — is left
 * exactly where it is), returning a NEW array (the input is never
 * mutated).
 *
 * This exists because parser/parseDocument.ts's own list-item scanning
 * NEVER lets a blank line be the last line of an item's own `range` — a
 * trailing blank is always trimmed off before the item's range closes
 * (confirmed directly against the real parser: a list item's raw text, as
 * edit/partialEdit.ts's own extractSubtreeText returns it, can never
 * itself end in a blank line). buildMultiLineListItemProjection already
 * benefits from this for free — the ORIGINAL raw text it reads never has
 * one to worry about — but a user editing the shared textarea is free to
 * type a trailing blank line (or several) at the very end of the body,
 * which invertMultiLineListItemProjection would otherwise faithfully
 * reconstruct into the candidate's own last line(s). Re-parsing THAT
 * candidate would then always disagree with the real parser's own
 * trim-on-close behavior (the mini-document's own node.range.endLine would
 * land one or more lines short of the candidate's own last line index),
 * which validateMultiLineListItemCandidate's range check would reject as
 * `"unsafe-structure"` — a spurious Apply rejection for an edit that is, in
 * fact, completely harmless (a trailing blank line contributes nothing to
 * a list item's own content or rendering; the parser would silently drop
 * it either way). Trimming it here, BEFORE the candidate is built, keeps
 * this module's own candidate construction in agreement with the real
 * parser's own rule instead of fighting it — the same "normalize rather
 * than fight the parser" principle this module's own top doc comment
 * already applies to continuation indentation. If every continuation line
 * is blank (or there are none at all), the result is an empty array, and
 * the candidate naturally collapses to just the reconstructed first line —
 * the exact same, already-supported "every continuation line removed"
 * single-line-candidate path this module has always had.
 */
function trimTrailingBlankContinuationLines(continuationLines: readonly string[]): string[] {
  let end = continuationLines.length;
  while (end > 0 && continuationLines[end - 1] === "") {
    end -= 1;
  }
  return continuationLines.slice(0, end);
}

export function invertMultiLineListItemProjection(
  projection: MultiLineListItemProjection,
  editedChecked: boolean,
  editedNumberText: string,
  editedBody: string
): MultiLineListItemProjectionInvertResult {
  const editedLines = editedBody.split("\n");
  const [editedFirstLineBody, ...editedContinuationLines] = editedLines;

  let reconstructedFirstLine: string;
  if (projection.firstLine.kind === "unordered") {
    const inverted = invertListMarkerProjection(projection.firstLine.projection, editedFirstLineBody);
    if (!inverted.ok) {
      // Unreachable in practice — see this function's own doc comment.
      return { ok: false, reason: "unsafe-structure" };
    }
    reconstructedFirstLine = inverted.rawLine;
  } else if (projection.firstLine.kind === "task") {
    const inverted = invertTaskListProjection(
      projection.firstLine.projection,
      editedChecked,
      editedFirstLineBody
    );
    if (!inverted.ok) {
      // Unreachable in practice — see this function's own doc comment.
      return { ok: false, reason: "unsafe-structure" };
    }
    reconstructedFirstLine = inverted.rawLine;
  } else {
    const inverted = invertOrderedListProjection(
      projection.firstLine.projection,
      editedNumberText,
      editedFirstLineBody
    );
    if (!inverted.ok) {
      if (inverted.reason === "invalid-number") {
        return { ok: false, reason: "invalid-number" };
      }
      // "multiline-body" — unreachable in practice; see this function's
      // own doc comment.
      return { ok: false, reason: "unsafe-structure" };
    }
    reconstructedFirstLine = inverted.rawLine;
  }

  // Phase 5L-5 ("Leaf List Item Blank-Line Continuation Projection"):
  // drop every TRAILING blank line from the edited continuation before
  // reconstructing raw text — see trimTrailingBlankContinuationLines's own
  // doc comment for why this is required (parser/parseDocument.ts's own
  // list-item range never legitimately ends on a blank line, so a
  // candidate that still had one would always fail
  // validateMultiLineListItemCandidate's own range check below, even
  // though the edit itself is harmless). Interior (non-trailing) blank
  // lines are untouched here — trimTrailingBlankContinuationLines only
  // ever removes a contiguous run of blank entries at the very END of the
  // array.
  const trimmedContinuationLines = trimTrailingBlankContinuationLines(editedContinuationLines);
  const reconstructedContinuationLines = trimmedContinuationLines.map((line) =>
    line === "" ? "" : projection.continuationIndent + line
  );

  const candidateText = [reconstructedFirstLine, ...reconstructedContinuationLines].join("\n");
  if (!validateMultiLineListItemCandidate(candidateText, projection.listKind)) {
    return { ok: false, reason: "unsafe-structure" };
  }
  return { ok: true, rawText: candidateText };
}
