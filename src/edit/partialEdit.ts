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
 * Node resolution is entirely delegated to the existing
 * `doc.nodes.get(nodeId)` + `isSectionNode`/`isListNode` primitives already
 * used by every other tree/* and move/* module — no Markdown
 * re-interpretation happens here.
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

export type SubtreeKind = "section" | "list";

export type NoExtractSubtreeReason = "resolve-failed" | "not-editable" | "unsafe-indent";

export interface ExtractSubtreeOutcome {
  ok: boolean;
  /** Which kind of node this resolved to; null only when resolve-failed. */
  kind: SubtreeKind | null;
  /** The subtree's raw Markdown text. Empty when !ok. */
  text: string;
  startLine: number;
  endLine: number;
  reason?: NoExtractSubtreeReason;
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
 */
export function extractSubtreeText(doc: ParsedDocument, nodeId: string): ExtractSubtreeOutcome {
  const node = doc.nodes.get(nodeId);
  if (!node) {
    return { ok: false, kind: null, text: "", startLine: -1, endLine: -1, reason: "resolve-failed" };
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

export type NoApplySubtreeEditReason = NoExtractSubtreeReason | "conflict";

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
export function applySubtreeEdit(
  doc: ParsedDocument,
  nodeId: string,
  originalText: string,
  newText: string
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
  const lines = [
    ...doc.lines.slice(0, current.startLine),
    ...newLines,
    ...doc.lines.slice(current.endLine + 1),
  ];
  return { changed: true, lines, newStartLine: current.startLine };
}
