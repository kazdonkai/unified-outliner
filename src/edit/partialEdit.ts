/**
 * Phase 3B: Partial Edit Pane. Extended in Phase 4C to cover list subtrees
 * as a second editable node kind, alongside sections.
 *
 * Pure, Obsidian-free logic for the Partial Edit Pane's two operations:
 * extracting a subtree's raw Markdown text so a separate pane can display
 * it, and later splicing an edited version of that text back into the
 * ORIGINAL note's matching range. Neither function knows anything about
 * panes, textareas, or editors — view/PartialEditView.ts is the only
 * Obsidian-dependent caller.
 *
 * The Partial Edit Pane is deliberately NOT an independent document: the
 * note is always the single source of truth, and this module treats a
 * "partial edit" as nothing more than "replace exactly this subtree's
 * line range with this new text" — never a rewrite of anything outside
 * that range. This mirrors move/relocateSection.ts's "resolve safely,
 * touch nothing else" philosophy, just for content instead of position.
 *
 * Node resolution is primarily `doc.nodes.get(nodeId)` +
 * `isSectionNode`/`isListNode` — the primitives every other tree/* and
 * move/* module already uses — for a section or list id.
 *
 * Phase 5C-2 (2026-08-14, behavior change from the Phase 5C note this
 * replaces): a callout/blockquote id (parser/complexBlocks.ts's
 * ComplexBlockInfo, never inserted into ParsedDocument.nodes) is now ALSO
 * resolvable here — see extractSubtreeText's own doc comment for the exact
 * fresh-scanComplexBlocks fallback and its `editability === "supported"`
 * gate. Phase 5E-1 (2026-09-22) added fenced-code to this same resolvable
 * set; Phase 5E-2A (2026-09-23) added table. paragraph/thematic-break
 * ComplexBlockInfo ids remain deliberately NOT resolvable (out of scope
 * for either ticket) and still resolve to "resolve-failed", unchanged
 * from before.
 *

 * Phase 4C (list subtrees): extractSubtreeText/applySubtreeEdit below are
 * the generalized core — they accept EITHER a section id or a list id,
 * since both ListBlockNode and SectionBlockNode carry the same `.range`
 * every other block-scoped command already treats as "the whole editable
 * unit" (section-subtree for sections; Phase 4A's relocateListSubtree already
 * established the equivalent for list items — item + nested children,
 * exactly what ListBlockNode.range spans, no extra collection needed).
 * extractSectionText/applySectionEdit — Phase 3B's original, section-only
 * functions — are kept UNCHANGED in behavior (same signatures, same
 * reason codes, same tests) by re-expressing extractSectionText as a thin
 * wrapper around extractSubtreeText that rejects anything except a
 * section (see its doc comment below for exactly how). applySectionEdit's
 * own body needed no changes at all, since it only ever calls
 * extractSectionText.
 *
 * Safety: a list subtree with unsafeIndent (mixed tab/space leading
 * whitespace — the same flag move/relocateListSubtree.ts already refuses
 * to relocate) is refused here too, both when the pane first loads it and
 * again when Apply re-extracts the current text for the conflict check —
 * the latter comes for free, since applySubtreeEdit's re-extraction is
 * just another call to extractSubtreeText. Sections have no equivalent
 * concept (heading indentation is never ambiguous), so this check only
 * ever applies to list nodes.
 *
 * Phase 4F boundary decision (docs/fold-state-conflict-resolution-spec.md
 * §3): this module deliberately has NO relationship with
 * persistence/foldStateManager.ts or persistence/foldStateStore.ts, and
 * none was added. The conflict check above (`current.text !==
 * originalText`) fingerprints only `doc.lines` — the note's actual
 * Markdown content — which fold/unfold actions never touch (fold state
 * lives in a completely separate data.json key, keyed by node identity,
 * never by line content). Symmetrically, applySubtreeEdit's line splice
 * never writes to that store either. The two conflict layers are
 * therefore structurally disjoint, not merely coincidentally non-
 * interacting: a fold toggle can never cause this module to report
 * "conflict", and an Apply here can never silently clobber persisted fold
 * data. The one place they touch at all is indirect and pre-existing
 * (Phase 4E, unchanged by Phase 4F): if an Apply changes a node's own
 * heading/first-line text, that node's fold IDENTITY changes (identity is
 * label-based — see tree/foldIdentity.ts), so any fold state recorded
 * under the OLD identity is simply orphaned and the node reverts to its
 * default expanded display under the new one — see
 * docs/fold-state-spec.md §5. See tests/foldStateConflict.test.ts for a
 * regression test pinning this separation down.
 */
import { isListNode, isSectionNode, ParsedDocument } from "../model/block";
import { ComplexBlockInfo } from "../model/complexBlock";
import { scanComplexBlocks } from "../parser/complexBlocks";

export type NoExtractReason = "resolve-failed" | "not-a-heading";

export interface ExtractSectionOutcome {
  ok: boolean;
  /** The section subtree's raw Markdown text (heading + body + children + lists). Empty when !ok. */
  text: string;
  startLine: number;
  endLine: number;
  reason?: NoExtractReason;
}

/**
 * Extract the raw Markdown text of the section subtree identified by
 * `sectionId` (heading line through the end of its whole subtree — same
 * range every block-scoped command already operates on).
 *
 * A thin wrapper around extractSubtreeText (below) that preserves this
 * function's original, section-only contract byte-for-byte: any id that
 * doesn't resolve to a SECTION — including a perfectly valid list item id
 * — is reported as "not-a-heading", exactly as it always was, rather than
 * exposing the newer, list-aware outcome shape to this function's callers.
 */
export function extractSectionText(
  doc: ParsedDocument,
  sectionId: string
): ExtractSectionOutcome {
  const result = extractSubtreeText(doc, sectionId);
  if (result.kind === "section") {
    return { ok: true, text: result.text, startLine: result.startLine, endLine: result.endLine };
  }
  if (result.reason === "resolve-failed") {
    return { ok: false, text: "", startLine: -1, endLine: -1, reason: "resolve-failed" };
  }
  // Resolves to something other than a section (a list item, possibly one
  // with unsafe indentation) — from this section-only function's
  // perspective, that's simply "not a heading".
  return { ok: false, text: "", startLine: -1, endLine: -1, reason: "not-a-heading" };
}

// Phase 5E-1 ("fenced code block の raw Partial Edit・移動・削除") added
// "fenced-code" — a standalone fenced code block (including Mermaid,
// Dataview, DataviewJS, or any other info string, since Phase 5C never
// makes Mermaid a distinct ComplexBlockKind) is resolvable and editable
// here, raw, exactly like callout/blockquote.
//
// Phase 5E-2A ("Markdown table の raw Partial Edit・Apply 検証・安全な書き
// 戻し") adds "table" the same way — resolvable and editable here, raw,
// via the same extractComplexBlockText path (see that function's own
// updated doc comment below). Unlike fenced-code, a table has no Move/
// Delete capability (see view/OutlineTreeView.ts's showStandaloneComplexBlockMenu
// and this ticket's design memo §3) — only Open in Partial Edit. Apply-time
// validation for table is table-shaped structural validation (row count,
// pipe presence, delimiter-row format, column-count consistency — see
// applySubtreeEdit's own table branch below), not a fence-integrity check
// like fenced-code's.
export type SubtreeKind = "section" | "list" | "callout" | "blockquote" | "fenced-code" | "table";

export type NoExtractSubtreeReason = "resolve-failed" | "not-editable" | "unsafe-indent";

/**
 * Phase 5E-3 ("Fenced Code Block Partial Edit の UX 改善"): the fence
 * metadata captured at extraction time for a "fenced-code" subtree, kept
 * separately from `ExtractSubtreeOutcome.text` (which, for fenced-code
 * only, is now BODY TEXT ONLY — see extractComplexBlockText's own updated
 * doc comment below). This is what lets the Partial Edit Pane hide the
 * fence lines from the editable textarea entirely and instead drive an
 * independent kind/info-string selector UI, while applySubtreeEdit's own
 * fenced-code branch still has everything it needs to reconstruct valid
 * open/close fence lines on Apply (see that function's own doc comment).
 */
export interface FencedCodeBodyExtraction {
  /** The opening line's info-string portion (e.g. "mermaid", "js", ""). */
  infoString: string;
  /** The block's content lines only (fence lines excluded), joined by "\n" — "" when the block has zero content lines. */
  bodyText: string;
  /** The fence character shared by the opening and closing lines: "`" or "~". */
  fenceChar: string;
  /** The opening fence's run length (>= 3) — the closing fence must reproduce at least this many. */
  fenceLength: number;
  /** The opening line's leading whitespace (tabs/spaces), reproduced verbatim on both the rebuilt open AND close lines. */
  openLineIndent: string;
}

export interface ExtractSubtreeOutcome {
  ok: boolean;
  /** Which kind of node this resolved to; null only when resolve-failed. */
  kind: SubtreeKind | null;
  /**
   * The subtree's raw Markdown text. Empty when !ok. Phase 5E-3: for kind
   * "fenced-code" this is now BODY TEXT ONLY (the fence lines themselves
   * are excluded — see `fencedCode` below and extractComplexBlockText's
   * own doc comment). Unchanged for every other kind.
   */
  text: string;
  startLine: number;
  endLine: number;
  reason?: NoExtractSubtreeReason;
  /**
   * Phase 5E-3: populated only when `kind === "fenced-code"` — the fence
   * metadata `text` itself no longer carries. Always undefined for every
   * other kind.
   */
  fencedCode?: FencedCodeBodyExtraction;
}

/**
 * Phase 4C: extract the raw Markdown text of the subtree identified by
 * `nodeId` — a SECTION (heading + body + child sections + lists, same as
 * extractSectionText) OR a LIST item (item + nested children, the exact
 * range move/relocateListSubtree.ts already treats as one unit — no extra
 * collection needed here either).
 *
 * A list item with unsafeIndent (mixed tab/space leading whitespace) is
 * refused with reason "unsafe-indent", mirroring
 * move/relocateListSubtree.ts's own refusal to relocate such an item —
 * the Partial Edit Pane shouldn't offer to round-trip text whose
 * indentation the rest of this plugin already treats as unsafe to
 * interpret. Sections have no equivalent concept.
 *
 * Phase 5C-2 (2026-08-14): when `nodeId` does not resolve in `doc.nodes`
 * (this module's Phase 5C note above already documented this as the
 * pre-existing behavior for ANY ComplexBlockInfo id), this now makes ONE
 * additional attempt before giving up: a fresh `scanComplexBlocks(doc)`
 * pass, looking for a callout/blockquote whose own id matches AND whose
 * `editability === "supported"` — the exact same eligibility gate
 * tree/buildOutlineTree.ts's isStandaloneComplexBlockEligible uses for
 * deciding whether to project a Tree row for it in the first place, kept
 * independently re-implemented here (not imported) for the same
 * "each layer re-verifies against current ground truth, never trusts a
 * caller's earlier judgment" reason edit/deleteCompositeBlock.ts's own top
 * doc comment gives for its own re-parse/re-scan/re-match design. A
 * complex block whose id doesn't resolve at all, or resolves but is no
 * longer "supported" (e.g. the note changed between Tree render and
 * Apply), still reports plain "resolve-failed" — this module intentionally
 * does not grow a THIRD failure-reason tier for that distinction; the
 * Partial Edit Pane has no different Notice text for "never existed" vs.
 * "existed but is no longer eligible" and treating both the same is
 * exactly the safe, no-guessing behavior every other boundary check in
 * this codebase already prefers. `scanComplexBlocks` takes only `doc` (no
 * settings/rules involved, unlike CompositeBlock matching), so running it
 * here has no dependency on the Outline Tree's own composite-rule
 * settings and is cheap enough to run per extract/apply call, matching how
 * every other edit/*CompositeBlock.ts module already re-derives its own
 * scan fresh rather than accepting one from the caller.
 */
export function extractSubtreeText(doc: ParsedDocument, nodeId: string): ExtractSubtreeOutcome {
  const node = doc.nodes.get(nodeId);
  if (!node) {
    const complexBlock = scanComplexBlocks(doc).blocks.find((b) => b.id === nodeId);
    return extractComplexBlockText(doc, complexBlock);
  }
  if (isListNode(node)) {
    if (node.unsafeIndent) {
      return {
        ok: false,
        kind: "list",
        text: "",
        startLine: -1,
        endLine: -1,
        reason: "unsafe-indent",
      };
    }
    const text = doc.lines.slice(node.range.startLine, node.range.endLine + 1).join("\n");
    return { ok: true, kind: "list", text, startLine: node.range.startLine, endLine: node.range.endLine };
  }
  if (isSectionNode(node)) {
    const text = doc.lines.slice(node.range.startLine, node.range.endLine + 1).join("\n");
    return {
      ok: true,
      kind: "section",
      text,
      startLine: node.range.startLine,
      endLine: node.range.endLine,
    };
  }
  // Unreachable given BlockNode = ListBlockNode | SectionBlockNode, kept
  // only so this function has a total, type-checked return for every
  // path.
  return { ok: false, kind: null, text: "", startLine: -1, endLine: -1, reason: "not-editable" };
}

/**
 * Phase 5C-2: the callout/blockquote counterpart of extractSubtreeText's
 * section/list branches above — only ever reached from there, when `nodeId`
 * is not a BlockNode id at all. `complexBlock` is `undefined` for a
 * completely unresolvable id; `editability !== "supported"` is refused
 * identically (both collapse to "resolve-failed" — see extractSubtreeText's
 * own doc comment for why this module does not distinguish the two).
 */
function extractComplexBlockText(
  doc: ParsedDocument,
  complexBlock: ComplexBlockInfo | undefined
): ExtractSubtreeOutcome {
  // Phase 5E-1 widened this to also accept kind "fenced-code". Phase
  // 5E-2A widens it again to also accept kind "table" — see SubtreeKind's
  // own updated doc comment above. This remains the SECOND, independent
  // defense layer for whichever kinds are NOT listed here (currently
  // none — every ComplexBlockKind produced by scanComplexBlocks for a
  // standalone row is now editable via this path); the first layer is
  // view/OutlineTreeView.ts's own context-menu kind guard, per this whole
  // codebase's established two-layer read-only convention. Table's
  // continued lack of Move/Delete is enforced entirely by those two
  // OTHER modules (edit/moveStandaloneComplexBlock.ts's own kind
  // allow-list, and showStandaloneComplexBlockMenu's `target.kind ===
  // "fenced-code"` Delete gate) — this function only ever decides
  // "resolvable for Partial Edit at all", never move/delete eligibility.
  if (
    !complexBlock ||
    (complexBlock.kind !== "callout" &&
      complexBlock.kind !== "blockquote" &&
      complexBlock.kind !== "fenced-code" &&
      complexBlock.kind !== "table") ||
    complexBlock.editability !== "supported"
  ) {
    return { ok: false, kind: null, text: "", startLine: -1, endLine: -1, reason: "resolve-failed" };
  }
  // Phase 5E-3 ("Fenced Code Block Partial Edit の UX 改善"): fenced-code
  // gets its own extraction branch here, ahead of the shared tail below
  // (still used unchanged by callout/blockquote/table) — `text` becomes
  // BODY TEXT ONLY (fence lines excluded) and `fencedCode` carries the
  // fence metadata the Apply-time reconstruction in applySubtreeEdit below
  // needs to rebuild valid open/close lines. See FencedCodeBodyExtraction's
  // own doc comment for the field-by-field rationale.
  if (complexBlock.kind === "fenced-code") {
    const rawLines = doc.lines.slice(complexBlock.range.startLine, complexBlock.range.endLine + 1);
    const openLine = rawLines[0] ?? "";
    // scanComplexBlocks only ever produces a "fenced-code" ComplexBlockInfo
    // for a range whose first line is already a genuine opening fence (its
    // own FENCE_OPEN_RE is byte-identical in shape to this module's
    // FENCE_OPEN_LINE_RE — see that constant's doc comment above), so this
    // match is never null in practice; the fallback below only keeps this
    // branch total under the type checker rather than asserting.
    const openMatch = openLine.match(FENCE_OPEN_LINE_RE);
    const openLineIndent = openMatch ? openMatch[1] : "";
    const fenceChar = openMatch ? openMatch[2][0] : "`";
    const fenceLength = openMatch ? openMatch[2].length : 3;
    const infoString = openMatch ? openMatch[3] : "";
    // rawLines always has at least 2 lines (a fenced block always has a
    // distinct open and close line) — slice(1, length-1) is therefore the
    // content lines only, and correctly yields [] (→ bodyText === "") for
    // a block with zero content lines (open line immediately followed by
    // close line).
    const contentLines = rawLines.slice(1, rawLines.length - 1);
    const bodyText = contentLines.join("\n");
    const fencedCode: FencedCodeBodyExtraction = { infoString, bodyText, fenceChar, fenceLength, openLineIndent };
    return {
      ok: true,
      kind: "fenced-code",
      text: bodyText,
      startLine: complexBlock.range.startLine,
      endLine: complexBlock.range.endLine,
      fencedCode,
    };
  }

  const text = doc.lines.slice(complexBlock.range.startLine, complexBlock.range.endLine + 1).join("\n");
  return {
    ok: true,
    kind: complexBlock.kind,
    text,
    startLine: complexBlock.range.startLine,
    endLine: complexBlock.range.endLine,
  };
}

export type NoApplySectionEditReason = NoExtractReason | "conflict";

export interface ApplySectionEditOutcome {
  changed: boolean;
  lines: string[];
  /** New start line of the replaced range (valid when changed). */
  newStartLine: number;
  reason?: NoApplySectionEditReason;
}

/**
 * Replace the section subtree identified by `sectionId` with `newText`,
 * against the CURRENT `doc` (a fresh parse of the note as it stands right
 * now — never a cached one, since line numbers and ids are only valid
 * within the parse they came from).
 *
 * `originalText` must be exactly what extractSectionText returned when
 * the Partial Edit Pane first loaded this section (i.e. the pane's own
 * "before editing" snapshot) — NOT the just-typed newText. Before
 * applying, this re-extracts the section fresh from `doc` and compares it
 * to `originalText`: any difference means the note changed elsewhere
 * (directly, via another command, etc.) since the pane opened, so the
 * edit is refused as a "conflict" rather than silently overwriting
 * whatever changed. This is a deliberately simple full-text fingerprint
 * check — no diffing or merge UI (out of scope for this phase; see
 * docs/README's Phase 3B section) — but it catches every case where
 * applying blindly could discard someone else's change.
 */
export function applySectionEdit(
  doc: ParsedDocument,
  sectionId: string,
  originalText: string,
  newText: string
): ApplySectionEditOutcome {
  const current = extractSectionText(doc, sectionId);
  if (!current.ok) {
    return {
      changed: false,
      lines: doc.lines,
      newStartLine: -1,
      reason: current.reason ?? "resolve-failed",
    };
  }
  if (current.text !== originalText) {
    return { changed: false, lines: doc.lines, newStartLine: -1, reason: "conflict" };
  }

  const newLines = newText.split("\n");
  const lines = [
    ...doc.lines.slice(0, current.startLine),
    ...newLines,
    ...doc.lines.slice(current.endLine + 1),
  ];
  return { changed: true, lines, newStartLine: current.startLine };
}

/**
 * Phase 5E-1 adds "fenced-code-invalid-open"/"fenced-code-invalid-close":
 * Apply-time shape validation specific to kind "fenced-code" (see
 * isValidFencedCodeOpenLine/isValidFencedCodeCloseLine and their call site
 * inside applySubtreeEdit below).
 *
 * Phase 5E-2A adds four more, specific to kind "table" (see
 * isValidTableDelimiterRow/splitPipeRowForValidation and their call site
 * inside applySubtreeEdit below, checked in this fixed order — the first
 * failing check wins, matching this module's existing fenced-code
 * ordering convention and this whole codebase's "first failing condition"
 * rejection-reason pattern):
 *   - "table-too-few-lines": fewer than 3 lines (a table needs at least a
 *     header row, a delimiter row, and one data row).
 *   - "table-missing-pipe": some line contains no `|` character at all.
 *   - "table-invalid-delimiter": the second line (the delimiter row) does
 *     not consist entirely of cells matching `/^:?-+:?$/` once split and
 *     trimmed — the same shape parser/complexBlocks.ts's own
 *     DELIMITER_CELL_RE requires (re-implemented locally here, not
 *     imported, since that constant is module-private — same convention
 *     as this module's own FENCE_OPEN_LINE_RE/FENCE_CLOSE_ONLY_LINE_RE).
 *   - "table-column-mismatch": not every line splits into the same number
 *     of cells (leading/trailing `|` normalized away before counting,
 *     exactly like parser/complexBlocks.ts's own splitTableRow already
 *     does, so `| a | b |` and `a | b` count as the same 2 columns).
 *
 * None of these six reasons is ever reachable for section/list/
 * callout/blockquote — those kinds have no equivalent "must match this
 * exact syntax" constraint for this pane to enforce.
 */
export type NoApplySubtreeEditReason =
  | NoExtractSubtreeReason
  | "conflict"
  | "fenced-code-invalid-open"
  | "fenced-code-invalid-close"
  | "table-too-few-lines"
  | "table-missing-pipe"
  | "table-invalid-delimiter"
  | "table-column-mismatch";

export interface ApplySubtreeEditOutcome {
  changed: boolean;
  lines: string[];
  /** New start line of the replaced range (valid when changed). */
  newStartLine: number;
  reason?: NoApplySubtreeEditReason;
}

/**
 * Phase 4C: replace the subtree identified by `nodeId` — a section OR a
 * list item — with `newText`, against the CURRENT `doc`. Generalizes
 * applySectionEdit above to both node kinds; the conflict-detection
 * design is identical (re-extract fresh, compare to the pane's own
 * "before editing" snapshot, refuse on any mismatch — see
 * applySectionEdit's doc comment for the full rationale, which applies
 * unchanged here). Re-extracting via extractSubtreeText also means a list
 * item that somehow became unsafeIndent between load and Apply (or was
 * unsafe all along and slipped past an earlier check) is caught here too,
 * for free — no separate check needed.
 */
/**
 * Phase 5E-1: the same opening-fence shape parser/complexBlocks.ts's own
 * FENCE_OPEN_RE recognizes (`[ \t]*(`{3,}|~{3,})[ \t]*(.*)$`) — deliberately
 * NOT imported (that constant is module-private to complexBlocks.ts), but
 * kept byte-identical in shape so this Apply-time check never disagrees
 * with what the scanner itself would recognize as an opening fence.
 */
const FENCE_OPEN_LINE_RE = /^([ \t]*)(`{3,}|~{3,})[ \t]*(.*)$/;

/**
 * True when `line` is a valid fenced-code OPENING line — 3+ of the same
 * fence character (backtick or tilde), optionally preceded by whitespace,
 * with anything (an info string) after it. Mirrors
 * parser/complexBlocks.ts's own FENCE_OPEN_RE shape exactly (see
 * FENCE_OPEN_LINE_RE's own doc comment above).
 *
 * Phase 5E-3 widened FENCE_OPEN_LINE_RE with a new leading capture group
 * for the indent (group 1); the fence-run group shifted from 1 to 2
 * accordingly (group 3 — the rest-of-line/info-string portion — is read
 * directly by extractComplexBlockText's own fenced-code branch below, not
 * through this function).
 */
function isValidFencedCodeOpenLine(line: string): { valid: boolean; fenceChar: string; fenceLength: number } {
  const m = line.match(FENCE_OPEN_LINE_RE);
  if (!m) return { valid: false, fenceChar: "", fenceLength: 0 };
  return { valid: true, fenceChar: m[2][0], fenceLength: m[2].length };
}

/**
 * Phase 5E-1's own dedicated, STRICTER closing-fence check — deliberately
 * NOT the same looseness as parser/complexBlocks.ts's own scanner-time
 * close check (which only compares the closing line's first fence
 * character, via `closeMatch[1][0] === fenceChar`, and never requires the
 * closing run's length to be >= the opening run's, nor requires the line
 * to contain nothing else). This ticket's design memo §2 requires: the
 * SAME fence character, a run of AT LEAST the opening fence's own length,
 * and NOTHING ELSE on the line besides optional leading/trailing
 * whitespace — i.e. a "pure" closing fence line, matching CommonMark's own
 * closing-fence requirement more closely than the scanner's boundary-
 * detection pass does. This intentional strictness only applies to what
 * the Partial Edit Pane will ACCEPT on Apply; it never changes how
 * parser/complexBlocks.ts itself detects a block's boundary.
 */
const FENCE_CLOSE_ONLY_LINE_RE = /^[ \t]*(`+|~+)[ \t]*$/;

function isValidFencedCodeCloseLine(line: string, fenceChar: string, minLength: number): boolean {
  const m = line.match(FENCE_CLOSE_ONLY_LINE_RE);
  if (!m) return false;
  if (m[1][0] !== fenceChar) return false;
  return m[1].length >= minLength;
}

/**
 * Phase 5E-2A: splits a pipe-table row into trimmed cells, normalizing
 * away an optional leading/trailing `|` before splitting — deliberately
 * kept byte-identical in behavior to parser/complexBlocks.ts's own
 * module-private `splitTableRow` (not imported; same "duplicated, not
 * imported" convention as this module's own FENCE_OPEN_LINE_RE — see that
 * constant's doc comment above), so this Apply-time check never disagrees
 * with how the scanner itself would split the same line. `| a | b |` and
 * `a | b` both split to `["a", "b"]`.
 */
function splitPipeRowForValidation(line: string): string[] {
  let body = line.trim();
  if (body.startsWith("|")) body = body.slice(1);
  if (body.endsWith("|")) body = body.slice(0, -1);
  return body.split("|").map((c) => c.trim());
}

/**
 * Phase 5E-2A: the same delimiter-cell shape parser/complexBlocks.ts's own
 * DELIMITER_CELL_RE recognizes (`^:?-+:?$` — one or more hyphens, with an
 * optional leading and/or trailing colon for GFM column-alignment syntax,
 * and nothing else) — deliberately NOT imported (module-private to
 * complexBlocks.ts), but kept byte-identical in shape, same reasoning as
 * splitPipeRowForValidation above.
 */
const TABLE_DELIMITER_CELL_RE = /^:?-+:?$/;

/**
 * True when `line`, once split into cells via splitPipeRowForValidation,
 * consists entirely of valid delimiter cells (and has at least one cell —
 * an all-blank line splits to a single empty-string cell, which fails
 * TABLE_DELIMITER_CELL_RE, so this is never vacuously true for a blank
 * line).
 */
function isValidTableDelimiterRow(line: string): boolean {
  const cells = splitPipeRowForValidation(line);
  if (cells.length === 0) return false;
  return cells.every((cell) => TABLE_DELIMITER_CELL_RE.test(cell));
}

export function applySubtreeEdit(
  doc: ParsedDocument,
  nodeId: string,
  originalText: string,
  newText: string,
  /**
   * Phase 5E-3: the info-string CURRENTLY selected in the Partial Edit
   * Pane's kind-selector UI at the moment Apply was clicked — always used
   * over the extraction-time value when this kind is "fenced-code", so a
   * user's in-UI kind change is honored even though `newText` itself is
   * now body-only and carries no fence/info-string information at all.
   * Omitted (or undefined) falls back to the extraction-time infoString
   * (`current.fencedCode.infoString`) — i.e. "no change". Ignored
   * entirely for every kind other than "fenced-code".
   */
  fencedCodeInfoString?: string
): ApplySubtreeEditOutcome {
  const current = extractSubtreeText(doc, nodeId);
  if (!current.ok) {
    return {
      changed: false,
      lines: doc.lines,
      newStartLine: -1,
      reason: current.reason ?? "resolve-failed",
    };
  }
  if (current.text !== originalText) {
    return { changed: false, lines: doc.lines, newStartLine: -1, reason: "conflict" };
  }

  const newLines = newText.split("\n");

  // Phase 5E-1: fenced-code-only Apply-time shape validation — see this
  // module's own SubtreeKind/isValidFencedCodeOpenLine/
  // isValidFencedCodeCloseLine doc comments above. Never runs for any
  // other SubtreeKind. Checked AFTER the conflict check (so a stale-note
  // conflict is always reported before a shape problem — matching this
  // codebase's "the first failing condition, in a fixed order" convention
  // seen throughout move/delete's own rejection-reason functions).
  // Phase 5E-3 ("Fenced Code Block Partial Edit の UX 改善"): fenced-code's
  // Apply branch no longer validates the CALLER's own newLines[0]/last
  // line — `newText` is now body-only (see extractComplexBlockText's own
  // updated doc comment), so this branch instead RECONSTRUCTS both fence
  // lines itself from `current.fencedCode`'s metadata plus
  // `fencedCodeInfoString` (falling back to the extraction-time info
  // string when omitted), then validates the two SYNTHESIZED lines with
  // the exact same isValidFencedCodeOpenLine/isValidFencedCodeCloseLine
  // checks as before — same validation target semantics, just now
  // checking reconstructed rather than user-typed lines. Because this
  // branch assembles and returns its own spliced `lines` array, it
  // returns directly here rather than falling through to this function's
  // shared tail below (which still handles every other kind unchanged).
  //
  // Note: with the closing line always synthesized as
  // `openLineIndent + fenceChar.repeat(fenceLength)` — pure fence
  // characters and leading whitespace, nothing else — it always matches
  // FENCE_CLOSE_ONLY_LINE_RE, making "fenced-code-invalid-close"
  // structurally unreachable through this path. The check is kept
  // unconditionally anyway, as defense-in-depth against any future change
  // to how the close line gets built, rather than deleted as dead code —
  // see this ticket's design memo §2 for the explicit call-out of this
  // design decision, and tests/phase5e1FencedCodePartialEditMoveDelete
  // .test.ts's own repurposed regression test for what's now DELIBERATELY
  // accepted instead (a body line that merely looks like a fence).
  if (current.kind === "fenced-code") {
    const meta = current.fencedCode;
    // current.fencedCode is always populated when current.kind ===
    // "fenced-code" (see extractComplexBlockText's own fenced-code branch
    // above) — the fallbacks below only keep this branch total under the
    // type checker rather than asserting.
    const openLineIndent = meta?.openLineIndent ?? "";
    const fenceChar = meta?.fenceChar ?? "`";
    const fenceLength = meta?.fenceLength ?? 3;
    const infoString = fencedCodeInfoString !== undefined ? fencedCodeInfoString : (meta?.infoString ?? "");

    const openLine = openLineIndent + fenceChar.repeat(fenceLength) + (infoString !== "" ? " " + infoString : "");
    const closeLine = openLineIndent + fenceChar.repeat(fenceLength);
    // A fully-cleared textarea (newText === "") must become ZERO content
    // lines, not a single empty line — mirrors extractComplexBlockText's
    // own "zero content lines" case exactly (rawLines.slice(1, len-1)
    // there vs. this explicit special case here, since "".split("\n")
    // would otherwise yield [""], one phantom blank line).
    const contentLines = newText === "" ? [] : newLines;
    const reconstructed = [openLine, ...contentLines, closeLine];

    const open = isValidFencedCodeOpenLine(reconstructed[0]);
    if (!open.valid) {
      return { changed: false, lines: doc.lines, newStartLine: -1, reason: "fenced-code-invalid-open" };
    }
    const lastLine = reconstructed[reconstructed.length - 1];
    if (!isValidFencedCodeCloseLine(lastLine, open.fenceChar, open.fenceLength)) {
      return { changed: false, lines: doc.lines, newStartLine: -1, reason: "fenced-code-invalid-close" };
    }

    const lines = [
      ...doc.lines.slice(0, current.startLine),
      ...reconstructed,
      ...doc.lines.slice(current.endLine + 1),
    ];
    return { changed: true, lines, newStartLine: current.startLine };
  }

  // Phase 5E-2A: table-only Apply-time structural validation — see this
  // module's own NoApplySubtreeEditReason/splitPipeRowForValidation/
  // isValidTableDelimiterRow doc comments above. Never runs for any other
  // SubtreeKind. Checked AFTER the conflict check (same fixed-order
  // convention as the fenced-code branch immediately above), and each of
  // the four checks below runs in the same order the design memo's §2
  // lists them, the first failing one winning — an empty Apply (newText
  // === "") falls straight through to "table-too-few-lines" via
  // newLines.length === 1, with no separate empty-string special case
  // needed.
  if (current.kind === "table") {
    if (newLines.length < 3) {
      return { changed: false, lines: doc.lines, newStartLine: -1, reason: "table-too-few-lines" };
    }
    if (!newLines.every((line) => line.includes("|"))) {
      return { changed: false, lines: doc.lines, newStartLine: -1, reason: "table-missing-pipe" };
    }
    if (!isValidTableDelimiterRow(newLines[1])) {
      return { changed: false, lines: doc.lines, newStartLine: -1, reason: "table-invalid-delimiter" };
    }
    const columnCounts = newLines.map((line) => splitPipeRowForValidation(line).length);
    if (columnCounts.some((count) => count !== columnCounts[0])) {
      return { changed: false, lines: doc.lines, newStartLine: -1, reason: "table-column-mismatch" };
    }
  }

  const lines = [
    ...doc.lines.slice(0, current.startLine),
    ...newLines,
    ...doc.lines.slice(current.endLine + 1),
  ];
  return { changed: true, lines, newStartLine: current.startLine };
}
