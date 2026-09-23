/**
 * Phase 5D-3C ("Callout and Blockquote Drag and Drop", 案A approved):
 * resolves whether a standalone or CompositeBlock-member callout/blockquote
 * may be safely dropped at a specific, user-chosen before/after position,
 * and if so, the exact `insertBeforeLine` to hand to
 * move/moveBlock.ts#insertBlockAt (UNCHANGED — no new text-splice/
 * range-rewrite primitive is introduced by this ticket).
 *
 * Deliberately a SEPARATE resolver from
 * move/findStandaloneComplexBlockMoveTarget.ts (Move, Phase 5C-3/5D-3B):
 * Move only ever resolves ONE candidate position per direction (the
 * immediately adjacent standalone callout/blockquote). D&D instead
 * validates an ARBITRARY, user-chosen before/after position against a
 * fixed safety rule set — a genuinely different question, so this module
 * introduces its own resolution function rather than widening Move's.
 *
 * ---- v1 scope (this ticket's own approval) ----
 *
 *   - Drop position is "before" or "after" only. "inside" is never
 *     represented in this module's own API at all — the caller
 *     (view/OutlineTreeView.ts) computes only a two-way zone split for a
 *     callout/blockquote drag session (mirroring paragraph D&D's own
 *     computeParagraphDropZone), so an "inside" position can never even
 *     reach this function.
 *   - Drop TARGET candidates are restricted to whatever the caller resolves
 *     into a StandaloneComplexBlockDropTargetHint — in practice (see
 *     view/OutlineTreeView.ts#standaloneComplexBlockDropTargetHint), a
 *     top-level-of-section list item, or any complex block (paragraph/
 *     callout/blockquote/fenced-code/table/thematic-break, standalone or
 *     CompositeBlock-member) whose own `editability === "supported"` and
 *     whose own `parentId` is NOT list-typed. A section heading, or a
 *     CompositeBlock's own aggregate row, is never a valid v1 target —
 *     deliberately out of scope for this ticket (whole-CompositeBlock D&D
 *     is a separate future ticket; dropping relative to a section heading
 *     raises its own "which section does this land in" questions this
 *     ticket does not need to answer to satisfy its approved scope).
 *   - Drop source and drop target must resolve to the SAME `parentId`
 *     (both null — top-of-document — also counts as equal) — D&D v1 never
 *     crosses a section boundary, exactly like Move's own
 *     "different-section" rejection.
 *   - A drop that would land STRICTLY INSIDE any existing CompositeBlock's
 *     own aggregate range (i.e. strictly after that composite's own first
 *     line, at or before its own last line) is rejected as
 *     "composite-internal-boundary" — this protects EVERY composite in
 *     `allComposites` uniformly (including, incidentally, whichever
 *     composite the SOURCE itself may currently belong to — checking
 *     self-drop FIRST, below, already keeps this rule from ever
 *     conflicting with the source's own permitted matching-dissolution:
 *     any position immediately adjacent to the source's own current range
 *     is rejected as "self-drop" before this check ever runs, so a
 *     genuinely different position inside the SAME composite the source
 *     belongs to — relevant only once a rule ever matches 3+ members — is
 *     correctly still rejected here, exactly like a position inside any
 *     OTHER composite would be).
 *
 * ---- What this module does NOT do ----
 *
 * No doc.lines mutation, no move/moveBlock.ts#insertBlockAt call, no
 * command wiring, no Notice, no snapshot re-resolution of source or target
 * (the caller — view/OutlineTreeView.ts at dragover time, and
 * edit/dropStandaloneComplexBlock.ts at drop time — is responsible for
 * handing this function an ALREADY freshly-resolved `source`/`target`
 * pair; this function only judges whether the position they describe is
 * safe).
 */
import { LineRange, ParsedDocument } from "../model/block";
import { ComplexBlockInfo, StandaloneComplexBlockDropRejectReason } from "../model/complexBlock";
import { CompositeBlockInfo } from "../model/compositeBlock";

/**
 * "before" | "after" — deliberately a separate, two-way-only type from
 * move/relocateSection.ts's own three-way DropMode ("before" | "after" |
 * "inside"): callout/blockquote D&D (v1) has no child/"inside" drop zone
 * at all. Mirrors edit/paragraphTreeMove.ts's own ParagraphDropZone
 * exactly in shape, independently declared to avoid an unwanted
 * cross-feature type dependency (same convention that module's own
 * ParagraphDropZone already established relative to DropMode).
 */
export type StandaloneComplexBlockDropZone = "before" | "after";

/**
 * A drop TARGET's own current range + parentId, already resolved by the
 * caller from the CURRENT doc/scan (see
 * view/OutlineTreeView.ts#standaloneComplexBlockDropTargetHint for how a
 * hovered Tree row of any eligible kind is turned into this shape). This
 * module treats both fields as ground truth for the single call it is used
 * in — it never itself re-resolves a target by id.
 */
export interface StandaloneComplexBlockDropTargetHint {
  range: LineRange;
  parentId: string | null;
}

export type StandaloneComplexBlockDropResolution =
  | { allowed: true; insertBeforeLine: number }
  | { allowed: false; reason: StandaloneComplexBlockDropRejectReason };

/**
 * Resolves whether `source` may be dropped at `zone` relative to `target`,
 * given the CURRENT `doc` and `allComposites` — and if so, the exact
 * `insertBeforeLine` (in the CURRENT, pre-cut line numbering — see
 * move/moveBlock.ts#insertBlockAt's own doc comment for why that function
 * itself expects, and correctly adjusts for, an insertBeforeLine expressed
 * in this same pre-cut coordinate space) to pass to it.
 *
 * Checked in this fixed order, mirroring every other rejection-reporting
 * function in this codebase (evaluateStandaloneComplexBlockMovability,
 * evaluateCompositeBlockMovability, ...) — the first failing condition
 * determines the single reported reason:
 *
 *   1. `source` itself must be kind callout/blockquote with
 *      `editability === "supported"` — otherwise "not-supported". Then its
 *      own `parentId`, if non-null, must NOT resolve to a list-typed node
 *      — otherwise "nested-in-list". (Deliberately inlined here, mirroring
 *      evaluateStandaloneComplexBlockMovability's own inline structure,
 *      rather than delegating to parser/compositeBlocks.ts's
 *      isStandaloneComplexBlockShapeEligible — this resolver needs the
 *      fine-grained reason that boolean helper doesn't return.
 *      Deliberately does NOT also check composite membership, unlike
 *      Move's own judge — see this module's own top doc comment for why.)
 *   2. The candidate `insertBeforeLine` (computed from `target.range` and
 *      `zone`: `zone === "before"` -> `target.range.startLine`,
 *      `zone === "after"` -> `target.range.endLine + 1`) must NOT fall
 *      inside `[source.range.startLine, source.range.endLine + 1]` —
 *      otherwise "self-drop" (dropping onto, or immediately adjacent to,
 *      the source's own current position is always a no-op or a
 *      degenerate self-drop; checked BEFORE the composite-boundary check
 *      below so it never competes with it for the same position — see
 *      this module's own top doc comment).
 *   3. `target.parentId` must equal `source.parentId` (both null counts as
 *      equal) — otherwise "not-same-section".
 *   4. `insertBeforeLine` must not fall strictly inside any
 *      `allComposites[i].range` — otherwise "composite-internal-boundary".
 */
export function resolveStandaloneComplexBlockDropTarget(
  doc: ParsedDocument,
  source: ComplexBlockInfo,
  allComposites: CompositeBlockInfo[],
  target: StandaloneComplexBlockDropTargetHint,
  zone: StandaloneComplexBlockDropZone
): StandaloneComplexBlockDropResolution {
  // Phase 5E-3d ("Table Move/Delete/DnD Parity") widens the source kind
  // gate to also accept "table" — table already has Tree projection
  // (isStandalone: true rows) and Move/Delete now reuse this same D&D
  // pipeline's structural-eligibility posture; its ComplexBlockInfo.range
  // is reused completely unchanged here. "fenced-code" is deliberately
  // LEFT OUT: unlike Move/Delete, this D&D resolver never gained
  // fenced-code support in Phase 5E-1 (that phase's own scope was Partial
  // Edit/Move/Delete only, not Drag and Drop — see
  // edit/deleteStandaloneComplexBlock.ts's own top doc comment), and
  // widening it here was not requested by this ticket, so a fenced-code
  // source stays "not-supported", unchanged (see
  // tests/findStandaloneComplexBlockDropTarget.test.ts's own pre-existing
  // "rejects (not-supported) when the source is not kind callout/
  // blockquote" case, which this phase leaves passing as-is).
  if (source.kind !== "callout" && source.kind !== "blockquote" && source.kind !== "table") {
    return { allowed: false, reason: "not-supported" };
  }
  if (source.editability !== "supported") {
    return { allowed: false, reason: "not-supported" };
  }
  if (source.parentId) {
    const owner = doc.nodes.get(source.parentId);
    if (owner && owner.type === "list") {
      return { allowed: false, reason: "nested-in-list" };
    }
  }

  const insertBeforeLine = zone === "before" ? target.range.startLine : target.range.endLine + 1;

  if (insertBeforeLine >= source.range.startLine && insertBeforeLine <= source.range.endLine + 1) {
    return { allowed: false, reason: "self-drop" };
  }

  if (target.parentId !== source.parentId) {
    return { allowed: false, reason: "not-same-section" };
  }

  for (const composite of allComposites) {
    if (insertBeforeLine > composite.range.startLine && insertBeforeLine <= composite.range.endLine) {
      return { allowed: false, reason: "composite-internal-boundary" };
    }
  }

  return { allowed: true, insertBeforeLine };
}
