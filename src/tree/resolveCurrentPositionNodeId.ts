/**
 * Phase 5T-5A (implements Phase 5T-5D's 案A): resolves which Tree node the
 * BODY EDITOR's cursor line CURRENTLY corresponds to, extended beyond the
 * pre-existing section/list-only resolveHighlightedSectionId.ts to also
 * cover the ComplexBlockKind values that have their own Tree row today —
 * paragraph, callout, blockquote, and, as of Phase 5E-0 and only when the
 * corresponding opt-in Outline Tree display setting is on, fenced-code
 * and table (see docs/phase5t5_cursor_to_tree_highlight_design.md §3-3
 * for the ORIGINAL, pre-5E-0 rationale, and
 * docs/phase5e0_fenced-code-table-tree-projection-design-memo.md for why
 * fenced-code/table were later added without needing to revisit anything
 * else in this file: thematic-break alone remains permanently without a
 * Tree row of any kind, standalone or as a composite member, so it is not
 * — and cannot be — resolved to anything more specific than the existing
 * section/list fallback below).
 *
 * This is a genuinely NEW file rather than an extension of
 * resolveHighlightedSectionId.ts itself (design doc §4, 案A vs 案B): that
 * module stays untouched and BlockNode-only, and this module composes on
 * top of it rather than absorbing its logic, mirroring the same
 * "paragraph gets its own dedicated branch, never merged into an existing
 * one" precedent Phase 5P-3 established for tree/buildOutlineTree.ts.
 *
 * Deliberately used for TWO purposes by view/OutlineTreeView.ts (Phase
 * 5T-5A): computing `highlightedId` from the live cursor line, AND
 * re-resolving `selectedId` from a move/edit outcome's own `newStartLine`
 * after a refresh (selection-follow — see that file's
 * resolveSelectionAfterRefresh). Both are fundamentally the same
 * question — "which currently-displayed Tree row does this one document
 * line best represent" — so sharing this one pure resolver for both
 * avoids two independently-drifting copies of the same priority logic.
 * `highlightedId` and `selectedId` remain otherwise fully independent
 * pieces of view state; only this stateless line->id computation is
 * shared.
 *
 * Correctness for "does this candidate actually have a Tree row right
 * now" is delegated entirely to `nodeById` (built by
 * tree/outlineNavigation.ts#buildNodeByIdMap from the CURRENT
 * buildOutlineTree() output) rather than re-deriving standalone/composite-
 * member eligibility here: a ComplexBlockInfo's own candidate id is only
 * ever accepted when `nodeById.has(candidateId)` is true, which is exactly
 * equivalent to "this content is displayed as some Tree row right now,
 * whether standalone or as a composite member" — see this module's own
 * resolveComplexBlockCandidate for why this sidesteps ever needing to
 * duplicate buildOutlineTree.ts's private isStandaloneComplexBlockEligible/
 * consumedComplexBlockIds logic (which stays private and unexported).
 */
import { ParsedDocument } from "../model/block";
import { ComplexBlockInfo, ComplexBlockScanResult } from "../model/complexBlock";
import { buildParagraphOrdinals, OutlineTreeNode, paragraphViewId } from "./buildOutlineTree";
import { resolveHighlightedNodeId } from "./resolveHighlightedSectionId";

export interface ResolveCurrentPositionOptions {
  /** Same meaning as resolveHighlightedNodeId's own includeLists — whether the section/list fallback should resolve to a list item or walk up to its enclosing section. */
  includeLists: boolean;
}

/**
 * The Tree node id `cursorLine` currently corresponds to, or null.
 *
 * Priority (design doc §3-3, confirmed by this module's own tests):
 *  1. A paragraph/callout/blockquote ComplexBlockInfo whose range contains
 *     `cursorLine` AND whose corresponding Tree id is present in
 *     `nodeById` — this includes a paragraph/callout/blockquote NESTED
 *     under a list item (its own dedicated Tree row, when
 *     showParagraphsInOutline/standalone projection put one there), which
 *     is deliberately MORE specific than falling back to that list item's
 *     own row. When more than one candidate's range contains the cursor
 *     (should not happen given this codebase's non-overlapping per-line
 *     ownership — design doc §3-3 point 6 — but handled defensively), the
 *     NARROWEST range wins.
 *  2. Otherwise, the pre-existing resolveHighlightedNodeId(doc, cursorLine,
 *     {includeLists}) result — unchanged section/list behavior, including
 *     its existing null cases (fenced-code interior, frontmatter,
 *     out-of-range).
 *
 * Never mutates fold state and never consults collapsedIds — visibility
 * (nearest-visible-ancestor fallback for highlight, or "hidden -> clear"
 * for selection-follow) is entirely the CALLER's concern (see
 * tree/outlineNavigation.ts#resolveNearestVisibleAncestorId /
 * isOutlineNodeVisible), keeping this resolver a pure function of
 * (doc, cursorLine, complexScan, nodeById) only, per the design doc's
 * §5-1 contract.
 */
export function resolveCurrentPositionNodeId(
  doc: ParsedDocument,
  cursorLine: number,
  complexScan: ComplexBlockScanResult,
  nodeById: ReadonlyMap<string, OutlineTreeNode>,
  options: ResolveCurrentPositionOptions
): string | null {
  // Phase 5M-0: a cursor on a mirror embed line highlights that line's own
  // read-only "Mirror:" row (present only while the display setting is on).
  for (const node of nodeById.values()) {
    if (node.kind === "mirror" && node.line === cursorLine) return node.id;
  }
  const complexCandidate = resolveComplexBlockCandidate(cursorLine, complexScan, nodeById);
  if (complexCandidate) return complexCandidate;
  return resolveHighlightedNodeId(doc, cursorLine, { includeLists: options.includeLists });
}

/**
 * The Tree node id `info` would be displayed under today, IF it is
 * displayed at all — paragraph uses its own document-wide ordinal view id
 * (tree/buildOutlineTree.ts#paragraphViewId, reusing the exact same
 * buildParagraphOrdinals computation buildOutlineTree() itself runs, so
 * this can never disagree with what was actually rendered); callout/
 * blockquote reuse their own ComplexBlockInfo.id verbatim (both standalone
 * and composite-member rows use `id: info.id` — see
 * buildStandaloneComplexNode/buildMemberNode). As of Phase 5E-0,
 * fenced-code/table do too, whenever they are currently projected as a
 * standalone row (opt-in display setting on) — see
 * buildStandaloneComplexNode's own prefix/kind handling, unchanged in
 * shape by this addition. thematic-break alone still has no Tree id form
 * at all and always returns null here — `nodeById` would never contain
 * such an id anyway, so this remains purely a defensive short-circuit for
 * that one kind, not a behavior difference.
 */
function candidateTreeId(
  info: ComplexBlockInfo,
  paragraphOrdinalById: ReadonlyMap<string, number>
): string | null {
  if (info.kind === "paragraph") {
    const ordinal = paragraphOrdinalById.get(info.id);
    return ordinal === undefined ? null : paragraphViewId(ordinal);
  }
  if (info.kind === "callout" || info.kind === "blockquote") {
    return info.id;
  }
  // Phase 5E-0: fenced-code/table now ALSO reuse ComplexBlockInfo.id
  // verbatim as their Tree row id, exactly like callout/blockquote —
  // see tree/buildOutlineTree.ts's buildStandaloneComplexNode, which
  // was already doing `id: info.id` for every standalone kind before
  // this phase; only isStandaloneComplexBlockEligible's own kind
  // allow-list (and the two opt-in display settings gating it) ever
  // decided whether such a row exists at all. The `nodeById.has(id)`
  // check in resolveComplexBlockCandidate below (unchanged by this
  // edit) is what correctly makes this a no-op when the corresponding
  // setting is off and no such row is currently displayed.
  if (info.kind === "fenced-code" || info.kind === "table") {
    return info.id;
  }
  return null;
}

function resolveComplexBlockCandidate(
  cursorLine: number,
  complexScan: ComplexBlockScanResult,
  nodeById: ReadonlyMap<string, OutlineTreeNode>
): string | null {
  // Recomputed here rather than threaded in from the caller: this keeps
  // the resolver a self-contained pure function of its 4 documented
  // inputs, at the cost of duplicating the same O(paragraphs) sort/assign
  // pass buildOutlineTree() already performs once per refresh — the same
  // accepted trade-off Phase 5C-2's scanComplexBlocks doc comment already
  // made for a comparably cheap per-refresh recomputation.
  const paragraphOrdinalById = buildParagraphOrdinals(complexScan.blocks);
  let best: { id: string; span: number } | null = null;
  for (const info of complexScan.blocks) {
    if (cursorLine < info.range.startLine || cursorLine > info.range.endLine) continue;
    const id = candidateTreeId(info, paragraphOrdinalById);
    if (!id || !nodeById.has(id)) continue;
    const span = info.range.endLine - info.range.startLine;
    if (!best || span < best.span) best = { id, span };
  }
  return best ? best.id : null;
}
