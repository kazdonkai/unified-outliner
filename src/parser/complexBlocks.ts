/**
 * Phase 5C: Obsidian-free, pure-function recognition of "complex" Markdown
 * blocks — callout, blockquote, fenced-code (including Mermaid), table, and
 * paragraph — on top of an already-parsed ParsedDocument (see
 * parser/parseDocument.ts).
 *
 * SCOPE (unchanged from the initial Phase 5C revision, reconfirmed by the
 * follow-up ticket that added blockquote): this module ONLY recognizes and
 * classifies. It does not move, edit, render, or fold anything, and nothing
 * it exports is imported by view/OutlineTreeView.ts, view/PartialEditView.ts,
 * any move/* module, tree/ancestorPath.ts, tree/descendantPath.ts, or
 * main.ts's projection entry point. Tree display, icons, displayLabel
 * wiring, move/indent/outdent/drag & drop, hoist, and Partial Edit Pane
 * integration are Phase 5D+ concerns — see
 * docs/phase5c_block-model-and-tree-display-spec.md. See
 * model/complexBlock.ts's doc comment for why ComplexBlockKind is a
 * separate, scanner-only type rather than a rename/extension of BlockNode.
 *
 * ---- Ground truth reuse (never re-detected independently) ----
 *
 * Frontmatter and fenced-code line membership are NEVER re-derived here:
 * every scanner below treats `doc.frontmatterLines` and `doc.codeBlockLines`
 * (both already computed by parser/parseDocument.ts) as ground truth and
 * skips those lines outright. This is the mechanism that satisfies "fenced
 * code の内部を callout / blockquote / table / section / list と誤認識し
 * ない" — a line parseDocument.ts already decided is inside a fence can
 * never become a callout/blockquote/table/paragraph candidate here, by
 * construction. scanFencedCodeBlocks itself does not run a second,
 * independent fence-boundary algorithm — see that function's own doc
 * comment.
 *
 * HEADING_RE and LIST_RE below are intentionally BYTE-IDENTICAL copies of
 * parser/parseDocument.ts's own (private, unexported) regexes of the same
 * name. They are duplicated — not imported — because touching
 * parseDocument.ts is out of scope for Phase 5C (its existing boundary
 * logic must not be replaced or altered). Any future change to either
 * pattern in parseDocument.ts MUST be mirrored here.
 *
 * ---- Callout vs blockquote: classified together, never double-registered ----
 *
 * scanCalloutBlocks and scanBlockquoteBlocks both delegate to the internal
 * scanQuoteRuns helper, which walks every contiguous quote-prefixed
 * (`>`-prefixed) run EXACTLY ONCE and classifies it as callout (first line
 * matches Obsidian's `> [!type]` / `> [!type]+` / `> [!type]-` /
 * `> [!type] title` syntax) or blockquote (first line does not). Because
 * classification happens once, on the SAME scan, before either public
 * function sees the run, a given line range can never be reported under
 * both kinds — there is no merge-time "priority" needed between callout and
 * blockquote specifically, because they are disjoint by construction, not
 * by convention. (mergeBlockRangesSafely's priority order still lists
 * callout before blockquote, both ahead of fenced-code/table, ahead of
 * paragraph — see that function's own doc comment — but callout vs.
 * blockquote conflicts structurally cannot occur, so that ordering only
 * ever matters for conflicts against table/paragraph.)
 *
 * A quote run (of either kind) whose continuation lines contain a
 * callout-start pattern that the run's OWN first line didn't already
 * account for — a nested `> > [!tip]` inside a callout, or a `> [!note]`
 * appearing mid-stream inside what started as a plain blockquote — is
 * reported as editability "unsupported" (boundary known, internal content
 * not modeled) with an "unsupported-callout-nesting" diagnostic. Phase 5C
 * does not attempt to guess whether such embedded syntax means "nested
 * callout", "sibling callout", or "literal quoted text starting with
 * `[!...]`" — all three are plausible readings and guessing wrong would be
 * worse than refusing.
 *
 * ---- Priority / conflict policy (mergeBlockRangesSafely) ----
 *
 * Individual scanners (scanCalloutBlocks, scanBlockquoteBlocks,
 * scanTableBlocks, scanParagraphBlocks) run independently and do NOT know
 * about each other's output, EXCEPT for the callout/blockquote disjointness
 * guaranteed above. A line can still legitimately be claimed by more than
 * one scanner across kinds — e.g. scanParagraphBlocks has no special-case
 * exclusion for pipe-table-row-shaped or quote-prefixed lines, so it
 * legitimately produces paragraph candidates over the same lines a
 * successfully-recognized table or callout/blockquote occupies (see that
 * function's own doc comment; this is intentional, not a bug — paragraph is
 * the lowest-priority catch-all). scanComplexBlocks resolves this
 * explicitly and visibly via mergeBlockRangesSafely, using the fixed
 * priority order:
 *
 *   callout > blockquote > (fenced-code, table, thematic-break) > paragraph
 *
 *   1. callout is highest priority (a callout's own boundary rule is the
 *      most syntactically specific of the five kinds).
 *   2. blockquote is next (disjoint from callout by construction, as above,
 *      but still ranked above the remaining kinds since a plain blockquote
 *      is a stronger, more specific signal than a table/paragraph guess
 *      over the same lines).
 *   3. fenced-code and table are the same tier — in practice they can never
 *      overlap each other (fenced-code is derived from doc.codeBlockLines,
 *      which every other scanner already excludes), so their relative
 *      order doesn't matter; fenced-code is listed first only to match this
 *      module's original (pre-blockquote) ordering.
 *   4. paragraph is lowest priority, per its own doc comment.
 *
 * A lower-priority block that overlaps an already-accepted higher-priority
 * block is NEVER silently dropped and NEVER silently kept as "supported":
 * it is kept in the output with editability downgraded to "ambiguous" and
 * an "overlapping-range" diagnostic is emitted. This mirrors the same
 * "record what happened, refuse the operation, never guess" policy already
 * used throughout move/* and edit/partialEdit.ts. Because callout and
 * blockquote never conflict with EACH OTHER, and because table/fenced-code
 * cannot conflict with each other either, the only downgrades that actually
 * occur in practice are: (paragraph vs. callout/blockquote/table), and any
 * genuinely malformed/ambiguous individual block that already carried its
 * own downgrade before reaching merge. Table, callout, and blockquote are
 * therefore never unnecessarily marked ambiguous by merge for the cases
 * this ticket's tests exercise — see tests/complexBlocks.test.ts.
 *
 * ---- Boundary-crossing parentId policy ----
 *
 * resolveParentId (below) NEVER assigns parentId from a block's startLine
 * alone. It requires every line in the block's range to resolve (via
 * ParsedDocument.lineToOwningNodeId) to the SAME owner, and that owner's
 * own range to fully contain the block's range. A block whose lines
 * disagree on owner gets parentId = null AND editability downgraded to
 * "ambiguous" with an "ambiguous" diagnostic, rather than guessing which
 * owner "wins". This applies identically to callout, blockquote,
 * fenced-code, table, and paragraph — including a blockquote nested inside
 * a list item's continuation, which correctly resolves parentId to that
 * list item (the owner need not be a section).
 */
import { BlockNode, LineRange, ParsedDocument } from "../model/block";
import {
  BlockDiagnostic,
  ComplexBlockInfo,
  ComplexBlockKind,
  ComplexBlockRejection,
  ComplexBlockScanResult,
} from "../model/complexBlock";
import { isBlankLine } from "./parseDocument";

// Intentionally byte-identical to parser/parseDocument.ts's own HEADING_RE /
// LIST_RE — see this file's top doc comment for why these are duplicated
// rather than imported.
const HEADING_RE = /^(#{1,6})[ \t]+(.*)$/;
const LIST_RE = /^([ \t]*)([-*+]|\d+[.)])(?:[ \t]+.*)?$/;

const CALLOUT_START_RE = /^[ \t]*>[ \t]?\[!([^\]]+)\]([+-])?[ \t]*(.*)$/;
const NESTED_CALLOUT_RE = /^[ \t]*>[ \t]*>[ \t]?\[!/;
const QUOTE_PREFIX_RE = /^[ \t]*>/;

const FENCE_OPEN_RE = /^[ \t]*(`{3,}|~{3,})[ \t]*(.*)$/;

const DELIMITER_CELL_RE = /^:?-+:?$/;

// CommonMark thematic-break shape: up to 3 leading spaces, then 3+ of the
// SAME character among -, *, _ (optionally separated by spaces/tabs), and
// nothing else on the line. Captures the repeated character in group 1 so
// scanThematicBreakBlocks can single out the `-`-only case for the Setext
// heading disambiguation described in its own doc comment.
const THEMATIC_BREAK_RE =
  /^[ ]{0,3}(?:(-)[ \t]*(?:-[ \t]*){2,}|(\*)[ \t]*(?:\*[ \t]*){2,}|(_)[ \t]*(?:_[ \t]*){2,})$/;

function rangesOverlap(a: LineRange, b: LineRange): boolean {
  return a.startLine <= b.endLine && b.startLine <= a.endLine;
}

/**
 * Resolves a complex block's parentId by requiring FULL-RANGE agreement,
 * never just the block's first line: every line in `range` must resolve
 * (via doc.lineToOwningNodeId) to the exact same owner id, and that owner's
 * own BlockNode.range must fully contain `range`. If the lines disagree, or
 * the owner's range doesn't fully contain the block (defensive — in
 * practice implied by per-line agreement, since lineToOwningNodeId is only
 * ever set within an owner's own range), this returns
 * `{ parentId: null, boundaryAmbiguous: true }` so the caller can downgrade
 * editability rather than guess.
 *
 * A block whose lines all resolve to `null` (no enclosing section or list —
 * e.g. text before the first heading with no lists) is NOT ambiguous: it
 * legitimately has no parent, matching docs/mixed-structure-spec.md pattern
 * C's existing "no section" case for list items.
 */
function resolveParentId(
  doc: ParsedDocument,
  range: LineRange
): { parentId: string | null; boundaryAmbiguous: boolean } {
  const owners = new Set<string | null>();
  for (let line = range.startLine; line <= range.endLine; line++) {
    owners.add(doc.lineToOwningNodeId[line] ?? null);
  }
  if (owners.size !== 1) {
    return { parentId: null, boundaryAmbiguous: true };
  }
  const only = owners.values().next().value as string | null;
  if (only === null) {
    return { parentId: null, boundaryAmbiguous: false };
  }
  const ownerNode: BlockNode | undefined = doc.nodes.get(only);
  if (
    !ownerNode ||
    ownerNode.range.startLine > range.startLine ||
    ownerNode.range.endLine < range.endLine
  ) {
    return { parentId: null, boundaryAmbiguous: true };
  }
  return { parentId: only, boundaryAmbiguous: false };
}

/** Internal shape shared by scanCalloutBlocks and scanBlockquoteBlocks — see this module's top doc comment for why classification happens once, jointly. */
interface QuoteRun {
  startLine: number;
  endLine: number;
  isCalloutStart: boolean;
  /** True when a continuation line (any line after the first) itself matches a callout-start pattern at depth 1 or 2+, indicating unmodeled internal structure. */
  hasEmbeddedCalloutMarker: boolean;
}

/**
 * Walks every contiguous quote-prefixed (`>`-prefixed) run in the document
 * exactly once. A run:
 *   - Starts at a line matching QUOTE_PREFIX_RE that is not frontmatter or
 *     fenced-code.
 *   - Continues through consecutive QUOTE_PREFIX_RE-matching lines,
 *     including an empty quoted line (a bare `>`), stopping at the first
 *     line that is blank-of-quote-prefix, frontmatter, or fenced-code (a
 *     fence beginning mid-run always force-terminates the run — it is
 *     never swallowed into a callout/blockquote's range).
 *   - Is classified isCalloutStart = true iff its FIRST line matches
 *     CALLOUT_START_RE; scanCalloutBlocks and scanBlockquoteBlocks simply
 *     filter this list by that flag, so a given run is reported under
 *     exactly one of the two kinds.
 *   - Is flagged hasEmbeddedCalloutMarker = true if ANY line after the
 *     first matches CALLOUT_START_RE (depth-1 callout syntax reappearing
 *     mid-run — e.g. two `[!type]` markers in the same run with no
 *     separating non-quote line) or NESTED_CALLOUT_RE (depth-2+, `> >
 *     [!type]`). Both scanCalloutBlocks and scanBlockquoteBlocks use this
 *     to downgrade to "unsupported" rather than silently flattening
 *     unmodeled internal structure.
 */
function scanQuoteRuns(doc: ParsedDocument): QuoteRun[] {
  const runs: QuoteRun[] = [];
  const n = doc.lines.length;
  let j = 0;

  while (j < n) {
    if (doc.frontmatterLines[j] || doc.codeBlockLines[j] || !QUOTE_PREFIX_RE.test(doc.lines[j])) {
      j++;
      continue;
    }
    const start = j;
    const isCalloutStart = CALLOUT_START_RE.test(doc.lines[j]);
    let hasEmbeddedCalloutMarker = false;
    j++;
    while (
      j < n &&
      !doc.frontmatterLines[j] &&
      !doc.codeBlockLines[j] &&
      QUOTE_PREFIX_RE.test(doc.lines[j])
    ) {
      if (CALLOUT_START_RE.test(doc.lines[j]) || NESTED_CALLOUT_RE.test(doc.lines[j])) {
        hasEmbeddedCalloutMarker = true;
      }
      j++;
    }
    const end = j - 1;
    runs.push({ startLine: start, endLine: end, isCalloutStart, hasEmbeddedCalloutMarker });
  }

  return runs;
}

/** Shared classification/parentId logic for both scanCalloutBlocks and scanBlockquoteBlocks, given already-filtered runs of one kind. */
function buildQuoteBlocks(
  doc: ParsedDocument,
  runs: QuoteRun[],
  kind: Extract<ComplexBlockKind, "callout" | "blockquote">
): ComplexBlockScanResult {
  const blocks: ComplexBlockInfo[] = [];
  const diagnostics: BlockDiagnostic[] = [];
  let seq = 0;

  for (const run of runs) {
    const range: LineRange = { startLine: run.startLine, endLine: run.endLine };
    const id = `${kind}-${seq++}`;

    if (run.hasEmbeddedCalloutMarker) {
      diagnostics.push({
        kind: "unsupported-callout-nesting",
        fromLine: run.startLine,
        toLine: run.endLine,
        message:
          kind === "callout"
            ? "callout contains a nested callout; Phase 5C does not model nested callout structure"
            : "blockquote contains callout-like syntax mid-stream; Phase 5C does not model this structure",
      });
      blocks.push({
        id,
        kind,
        range,
        parentId: null,
        childIds: [],
        editability: "unsupported",
        reason:
          kind === "callout"
            ? "nested callout structure is not modeled in Phase 5C"
            : "embedded callout-like syntax inside a blockquote is not modeled in Phase 5C",
      });
      continue;
    }

    const { parentId, boundaryAmbiguous } = resolveParentId(doc, range);
    if (boundaryAmbiguous) {
      diagnostics.push({
        kind: "ambiguous",
        fromLine: run.startLine,
        toLine: run.endLine,
        message: `${kind} range crosses existing section/list boundaries`,
      });
      blocks.push({
        id,
        kind,
        range,
        parentId: null,
        childIds: [],
        editability: "ambiguous",
        reason: "block spans multiple existing section/list boundaries",
      });
      continue;
    }

    blocks.push({ id, kind, range, parentId, childIds: [], editability: "supported" });
  }

  return { blocks, diagnostics };
}

/**
 * Callout recognition (Obsidian callout syntax: `> [!type]`, `> [!type]+`,
 * `> [!type]-`, `> [!type] title`). See scanQuoteRuns's doc comment for the
 * exact boundary/classification rule shared with scanBlockquoteBlocks, and
 * this module's top doc comment for why callout and blockquote can never
 * double-register the same range.
 */
export function scanCalloutBlocks(doc: ParsedDocument): ComplexBlockScanResult {
  const runs = scanQuoteRuns(doc).filter((r) => r.isCalloutStart);
  return buildQuoteBlocks(doc, runs, "callout");
}

/**
 * Blockquote recognition: any contiguous quote-prefixed run whose FIRST
 * line does NOT match Obsidian's callout-start syntax. See scanQuoteRuns's
 * doc comment for the exact boundary/classification rule shared with
 * scanCalloutBlocks — callout detection always runs first in the sense
 * that classification checks isCalloutStart before anything is labeled
 * blockquote, and a run already classified as callout is never
 * re-examined or re-registered here.
 */
export function scanBlockquoteBlocks(doc: ParsedDocument): ComplexBlockScanResult {
  const runs = scanQuoteRuns(doc).filter((r) => !r.isCalloutStart);
  return buildQuoteBlocks(doc, runs, "blockquote");
}

/**
 * Fenced-code recognition (including Mermaid — see this module's own doc
 * comment and model/complexBlock.ts's ComplexBlockKind doc comment).
 *
 * Block BOUNDARIES are never re-detected: they are derived directly from
 * contiguous `doc.codeBlockLines === true` runs, which parser/
 * parseDocument.ts already computed as ground truth for section/list
 * parsing. This function only re-examines the run's first and last lines,
 * to (a) extract the opening fence's info string and (b) determine whether
 * the run actually closed with a matching fence marker or merely ran out
 * of document (unterminated).
 *
 * A run's LAST line is treated as a genuine close only if it matches
 * FENCE_OPEN_RE with the SAME leading fence character (backtick vs tilde)
 * as the run's first line — mirroring parseDocument.ts's own close check
 * (`m[1][0] === fenceChar`, first-character-only, not run-length). A
 * single-line run (open fence immediately followed by EOF, no separate
 * close line examined) is always unterminated, matching
 * parseDocument.ts's own algorithm where the close check only ever runs
 * starting from the line AFTER the opening line.
 *
 * An unterminated fence is a case Phase 5C's approved design explicitly
 * requires to be treated as boundary-UNCERTAIN, not merely
 * "recognized-but-unsupported": its editability is "ambiguous" (never
 * "supported"), with "unterminated-fence" as the PRIMARY diagnostic.
 */
export function scanFencedCodeBlocks(doc: ParsedDocument): ComplexBlockScanResult {
  const blocks: ComplexBlockInfo[] = [];
  const diagnostics: BlockDiagnostic[] = [];
  const n = doc.lines.length;
  let seq = 0;
  let j = 0;

  while (j < n) {
    if (!doc.codeBlockLines[j]) {
      j++;
      continue;
    }
    const start = j;
    while (j < n && doc.codeBlockLines[j]) j++;
    const end = j - 1;

    const openMatch = doc.lines[start].match(FENCE_OPEN_RE);
    const fenceChar = openMatch ? openMatch[1][0] : null;
    const infoString = openMatch ? openMatch[2].trim() : "";

    let terminated = false;
    if (end > start && fenceChar) {
      const closeMatch = doc.lines[end].match(FENCE_OPEN_RE);
      if (closeMatch && closeMatch[1][0] === fenceChar) terminated = true;
    }

    const range: LineRange = { startLine: start, endLine: end };
    const id = `fenced-${seq++}`;

    if (!terminated) {
      diagnostics.push({
        kind: "unterminated-fence",
        fromLine: start,
        toLine: end,
        message: "fenced code block has no matching closing fence before the end of the document",
      });
      blocks.push({
        id,
        kind: "fenced-code",
        range,
        parentId: null,
        childIds: [],
        editability: "ambiguous",
        reason: "unterminated fence: closing boundary could not be confirmed",
        infoString,
      });
      continue;
    }

    const { parentId, boundaryAmbiguous } = resolveParentId(doc, range);
    if (boundaryAmbiguous) {
      diagnostics.push({
        kind: "ambiguous",
        fromLine: start,
        toLine: end,
        message: "fenced code block range crosses existing section/list boundaries",
      });
      blocks.push({
        id,
        kind: "fenced-code",
        range,
        parentId: null,
        childIds: [],
        editability: "ambiguous",
        reason: "block spans multiple existing section/list boundaries",
        infoString,
      });
      continue;
    }

    blocks.push({
      id,
      kind: "fenced-code",
      range,
      parentId,
      childIds: [],
      editability: "supported",
      infoString,
    });
  }

  return { blocks, diagnostics };
}

function splitTableRow(line: string): string[] {
  let body = line.trim();
  if (body.startsWith("|")) body = body.slice(1);
  if (body.endsWith("|")) body = body.slice(0, -1);
  return body.split("|").map((c) => c.trim());
}

function looksLikeTableRow(line: string): boolean {
  return !isBlankLine(line) && line.includes("|");
}

function isDelimiterRow(line: string): boolean {
  const cells = splitTableRow(line);
  if (cells.length === 0) return false;
  return cells.every((c) => DELIMITER_CELL_RE.test(c));
}

/**
 * GFM-style pipe table recognition. A table is ONLY started when a
 * pipe-containing header candidate line is IMMEDIATELY followed by a valid
 * delimiter row (every cell matching `:?-+:?`) — a lone line containing a
 * stray `|` character (ordinary prose) is never enough on its own, which is
 * the mechanism that satisfies "table を通常 paragraph と安易に誤認識しな
 * い". Header and delimiter cell counts are compared; a mismatch is
 * reported as "malformed-table" and the block is downgraded to
 * "ambiguous" rather than "supported" — malformed structure must never be
 * classified as merely unsupported.
 *
 * Body rows continue for as long as subsequent non-blank lines contain a
 * `|` and are not frontmatter/fenced-code. List-marker lines (LIST_RE) are
 * excluded from candidacy at every step, so a list item whose text happens
 * to contain a `|` is never mistaken for a table row. This scanner does not
 * strip a leading `>` quote prefix, so a table written inside a callout or
 * blockquote's quoted lines is NOT recognized as a table by this function
 * (a known, deliberately conservative limitation — see
 * tests/complexBlocks.test.ts).
 */
export function scanTableBlocks(doc: ParsedDocument): ComplexBlockScanResult {
  const blocks: ComplexBlockInfo[] = [];
  const diagnostics: BlockDiagnostic[] = [];
  const n = doc.lines.length;
  let seq = 0;
  let j = 0;

  const isRowCandidate = (idx: number): boolean =>
    idx < n &&
    !doc.frontmatterLines[idx] &&
    !doc.codeBlockLines[idx] &&
    !LIST_RE.test(doc.lines[idx]) &&
    looksLikeTableRow(doc.lines[idx]);

  while (j < n) {
    if (doc.frontmatterLines[j] || doc.codeBlockLines[j] || LIST_RE.test(doc.lines[j])) {
      j++;
      continue;
    }
    const headerLine = doc.lines[j];
    if (!looksLikeTableRow(headerLine) || j + 1 >= n || !isRowCandidate(j + 1)) {
      j++;
      continue;
    }
    const delimLine = doc.lines[j + 1];
    if (!isDelimiterRow(delimLine)) {
      j++;
      continue;
    }

    const start = j;
    const headerCells = splitTableRow(headerLine);
    const delimCells = splitTableRow(delimLine);
    let k = j + 2;
    while (isRowCandidate(k)) k++;
    const end = k - 1;

    const range: LineRange = { startLine: start, endLine: end };
    const id = `table-${seq++}`;

    if (headerCells.length !== delimCells.length) {
      diagnostics.push({
        kind: "malformed-table",
        fromLine: start,
        toLine: end,
        message: `header has ${headerCells.length} column(s) but delimiter row has ${delimCells.length}`,
      });
      blocks.push({
        id,
        kind: "table",
        range,
        parentId: null,
        childIds: [],
        editability: "ambiguous",
        reason: "header/delimiter column count mismatch",
      });
      j = k;
      continue;
    }

    const { parentId, boundaryAmbiguous } = resolveParentId(doc, range);
    if (boundaryAmbiguous) {
      diagnostics.push({
        kind: "ambiguous",
        fromLine: start,
        toLine: end,
        message: "table range crosses existing section/list boundaries",
      });
      blocks.push({
        id,
        kind: "table",
        range,
        parentId: null,
        childIds: [],
        editability: "ambiguous",
        reason: "block spans multiple existing section/list boundaries",
      });
      j = k;
      continue;
    }

    blocks.push({ id, kind: "table", range, parentId, childIds: [], editability: "supported" });
    j = k;
  }

  return { blocks, diagnostics };
}

/**
 * Phase 5D-0: thematic-break recognition (`---`, `***`, `___`, optionally
 * space-separated, up to 3 leading spaces — see THEMATIC_BREAK_RE). Always
 * a single-line range.
 *
 * Candidate lines exclude frontmatter, fenced-code, heading lines
 * (HEADING_RE), and list-marker lines (LIST_RE) — the last exclusion
 * matters because a `-`-only run WITH internal spaces (e.g. "- - -") is
 * itself a valid LIST_RE match (marker "-", content "- -"), and
 * parser/parseDocument.ts already claims that line as a list item; this
 * scanner must never re-claim a line the base parser already turned into
 * "list" structure (list stays BlockNode's exclusive domain, same
 * principle as every other scanner in this module).
 *
 * Setext heading disambiguation (see
 * docs/phase5d0_basic-block-extension-and-composite-block-spec.md §2.2):
 * parser/parseDocument.ts does not parse Setext headings at all (ATX only),
 * and extending it to do so is out of this ticket's scope. A `-`-only run
 * (captured in THEMATIC_BREAK_RE's first alternative) is the ONLY case that
 * can also read as a Setext heading underline (`=`-only runs are not valid
 * thematic-break syntax at all, so they never reach this function; `*`/`_`
 * runs are never valid Setext underlines). When a `-`-only candidate is
 * IMMEDIATELY preceded (no blank line between) by a line that itself looks
 * like ordinary paragraph text — non-blank, not frontmatter/fenced-code,
 * and not itself a heading/list/thematic-break line — this function
 * deliberately does NOT report a thematic-break block for it, leaving the
 * line to fall through to scanParagraphBlocks (or an enclosing list item's
 * continuation) exactly as it already does today. This never produces a
 * WRONG positive claim; it only means some genuine thematic breaks that sit
 * directly under a paragraph (no blank line) are conservatively left
 * unrecognized, matching this whole module's "refuse rather than guess"
 * policy.
 */
export function scanThematicBreakBlocks(doc: ParsedDocument): ComplexBlockScanResult {
  const blocks: ComplexBlockInfo[] = [];
  const diagnostics: BlockDiagnostic[] = [];
  const n = doc.lines.length;
  let seq = 0;

  const isPlainCandidateLine = (idx: number): boolean => {
    if (idx < 0 || idx >= n) return false;
    if (doc.frontmatterLines[idx] || doc.codeBlockLines[idx]) return false;
    const line = doc.lines[idx];
    if (isBlankLine(line)) return false;
    if (HEADING_RE.test(line)) return false;
    if (LIST_RE.test(line)) return false;
    return true;
  };

  for (let j = 0; j < n; j++) {
    if (doc.frontmatterLines[j] || doc.codeBlockLines[j]) continue;
    const line = doc.lines[j];
    if (HEADING_RE.test(line) || LIST_RE.test(line)) continue;
    const m = line.match(THEMATIC_BREAK_RE);
    if (!m) continue;

    const isDashOnly = m[1] === "-";
    if (isDashOnly) {
      const prev = j - 1;
      const prevIsPlainText =
        isPlainCandidateLine(prev) && !THEMATIC_BREAK_RE.test(doc.lines[prev]);
      if (prevIsPlainText) {
        // Plausible Setext heading underline — see doc comment above.
        continue;
      }
    }

    const range: LineRange = { startLine: j, endLine: j };
    const id = `thematic-break-${seq++}`;
    const { parentId, boundaryAmbiguous } = resolveParentId(doc, range);

    if (boundaryAmbiguous) {
      diagnostics.push({
        kind: "ambiguous",
        fromLine: j,
        toLine: j,
        message: "thematic-break range crosses existing section/list boundaries",
      });
      blocks.push({
        id,
        kind: "thematic-break",
        range,
        parentId: null,
        childIds: [],
        editability: "ambiguous",
        reason: "block spans multiple existing section/list boundaries",
      });
      continue;
    }

    blocks.push({ id, kind: "thematic-break", range, parentId, childIds: [], editability: "supported" });
  }

  return { blocks, diagnostics };
}

/**
 * Paragraph recognition — diagnostic-only, per Phase 5C's approved policy:
 * paragraph blocks NEVER get editability "supported", only "read-only"
 * (boundary known, but structural operations on paragraphs are a permanent
 * non-goal — see docs/mixed-structure-spec.md §6) or "ambiguous" (boundary
 * genuinely uncertain). Nothing about this function's output is wired into
 * any UI or existing id-resolution path; it exists purely so a future
 * BlockIndex or diagnostic view has range information available. Paragraph
 * is NOT a Tree/Partial Edit addition target in any future phase unless a
 * separate, explicit design decision revisits docs/mixed-structure-spec.md
 * §6 — see docs/phase5c_block-model-and-tree-display-spec.md.
 *
 * A candidate line must be: non-blank; not frontmatter; not fenced-code;
 * not a heading line; not a list-marker line; and not owned (via
 * doc.lineToOwningNodeId) by a LIST node — list continuation text is
 * already treated as part of its owning list item by
 * docs/mixed-structure-spec.md and edit/listBodyRange.ts, so it is
 * deliberately excluded here rather than re-claimed as an independent
 * paragraph. A line owned by a SECTION (ordinary body text) or by nothing
 * (top-level text before any heading) IS a candidate. This function does
 * NOT exclude quote-prefixed or pipe-table-row-shaped lines — see this
 * module's top doc comment for why that redundancy is intentional and
 * resolved by mergeBlockRangesSafely, not by this scanner.
 */
export function scanParagraphBlocks(doc: ParsedDocument): ComplexBlockScanResult {
  const blocks: ComplexBlockInfo[] = [];
  const diagnostics: BlockDiagnostic[] = [];
  const n = doc.lines.length;
  let seq = 0;

  const isCandidate = (idx: number): boolean => {
    if (doc.frontmatterLines[idx] || doc.codeBlockLines[idx]) return false;
    const line = doc.lines[idx];
    if (isBlankLine(line)) return false;
    if (HEADING_RE.test(line)) return false;
    if (LIST_RE.test(line)) return false;
    const owner = doc.lineToOwningNodeId[idx];
    if (owner) {
      const ownerNode = doc.nodes.get(owner);
      if (ownerNode && ownerNode.type === "list") return false;
    }
    return true;
  };

  let j = 0;
  while (j < n) {
    if (!isCandidate(j)) {
      j++;
      continue;
    }
    const start = j;
    while (j < n && isCandidate(j)) j++;
    const end = j - 1;

    const range: LineRange = { startLine: start, endLine: end };
    const id = `paragraph-${seq++}`;
    const { parentId, boundaryAmbiguous } = resolveParentId(doc, range);

    if (boundaryAmbiguous) {
      diagnostics.push({
        kind: "ambiguous",
        fromLine: start,
        toLine: end,
        message: "paragraph range crosses existing section/list boundaries",
      });
      blocks.push({
        id,
        kind: "paragraph",
        range,
        parentId: null,
        childIds: [],
        editability: "ambiguous",
        reason: "block spans multiple existing section/list boundaries",
      });
      continue;
    }

    blocks.push({
      id,
      kind: "paragraph",
      range,
      parentId,
      childIds: [],
      editability: "read-only",
      reason:
        "paragraph blocks are recognized for diagnostics only; Phase 5C adds no paragraph structural-edit target (see docs/mixed-structure-spec.md §6)",
    });
  }

  return { blocks, diagnostics };
}

/**
 * Resolves overlaps between independently-run scanners' output using the
 * fixed priority order the arrays are passed in (highest priority first —
 * scanComplexBlocks calls this with
 * [callout, blockquote, fenced, table, paragraph]). A candidate whose range
 * overlaps any ALREADY-ACCEPTED (higher-priority) block is kept in the
 * output but downgraded to editability "ambiguous" with parentId cleared
 * and an "overlapping-range" diagnostic recorded — never silently dropped,
 * never silently kept as its original editability. See this module's top
 * doc comment for the full priority rationale, including why callout vs.
 * blockquote conflicts cannot occur in practice.
 */
export function mergeBlockRangesSafely(
  blockGroupsByPriority: ComplexBlockInfo[][]
): ComplexBlockScanResult {
  const accepted: ComplexBlockInfo[] = [];
  const diagnostics: BlockDiagnostic[] = [];

  for (const group of blockGroupsByPriority) {
    for (const candidate of group) {
      const conflict = accepted.find((a) => rangesOverlap(a.range, candidate.range));
      if (conflict) {
        diagnostics.push({
          kind: "overlapping-range",
          fromLine: candidate.range.startLine,
          toLine: candidate.range.endLine,
          message: `${candidate.kind} block at lines ${candidate.range.startLine}-${candidate.range.endLine} overlaps higher-priority ${conflict.kind} block at lines ${conflict.range.startLine}-${conflict.range.endLine}; downgraded to ambiguous`,
        });
        accepted.push({
          ...candidate,
          parentId: null,
          editability: "ambiguous",
          reason: `range overlaps a higher-priority ${conflict.kind} block`,
        });
      } else {
        accepted.push(candidate);
      }
    }
  }

  return { blocks: accepted, diagnostics };
}

/**
 * Runs every Phase 5C scanner over `doc` and merges their output with
 * mergeBlockRangesSafely, in the fixed priority order
 * callout > blockquote > (fenced-code, table, thematic-break) > paragraph (see this
 * module's top doc comment). This is the single entry point a future
 * caller should use; individual scan* functions are exported mainly for
 * isolated testing of each kind's boundary rules.
 */
export function scanComplexBlocks(doc: ParsedDocument): ComplexBlockScanResult {
  const callouts = scanCalloutBlocks(doc);
  const blockquotes = scanBlockquoteBlocks(doc);
  const fenced = scanFencedCodeBlocks(doc);
  const tables = scanTableBlocks(doc);
  const thematicBreaks = scanThematicBreakBlocks(doc);
  const paragraphs = scanParagraphBlocks(doc);

  const merged = mergeBlockRangesSafely([
    callouts.blocks,
    blockquotes.blocks,
    fenced.blocks,
    tables.blocks,
    thematicBreaks.blocks,
    paragraphs.blocks,
  ]);

  return {
    blocks: merged.blocks,
    diagnostics: [
      ...callouts.diagnostics,
      ...blockquotes.diagnostics,
      ...fenced.diagnostics,
      ...tables.diagnostics,
      ...thematicBreaks.diagnostics,
      ...paragraphs.diagnostics,
      ...merged.diagnostics,
    ],
  };
}

/**
 * Phase 5C safety helper for a FUTURE caller (e.g. a Tree context menu that
 * might one day let a user attempt "open in partial edit pane" on a
 * recognized complex block) that wants a clearer rejection reason than
 * edit/partialEdit.ts's generic "resolve-failed".
 *
 * ComplexBlockInfo ids are NEVER inserted into ParsedDocument.nodes (see
 * model/complexBlock.ts's doc comment), so extractSubtreeText /
 * applySubtreeEdit already refuse them safely and unconditionally with
 * reason "resolve-failed" — this function adds NO new runtime path into
 * edit/partialEdit.ts itself (that file's logic is unchanged; see its own
 * doc comment for the one-line pointer back to this function). It exists
 * purely so a caller who already has a ComplexBlockScanResult can
 * distinguish "this id doesn't exist at all" from "this id is a recognized
 * complex block Phase 5C does not (yet, or — for read-only kinds — ever)
 * support editing", before even attempting extractSubtreeText.
 */
export function describeComplexBlockRejection(
  scanResult: ComplexBlockScanResult,
  nodeId: string
): ComplexBlockRejection {
  const block = scanResult.blocks.find((b) => b.id === nodeId);
  if (!block) return { blocked: false };
  return {
    blocked: true,
    kind: block.kind,
    editability: block.editability,
    reason:
      block.reason ?? `${block.kind} blocks are not editable through the Partial Edit Pane in this version`,
  };
}
