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
 *   - [2026-09-24 追記, feat/standalone-complex-dnd-cross-section] The
 *     bullet directly below this addendum described v1's own original
 *     restriction and is kept verbatim for history — it NO LONGER
 *     reflects this module's current behavior. That restriction has been
 *     lifted: resolveStandaloneComplexBlockDropTarget no longer requires
 *     `target.parentId === source.parentId` at all. Cross-section drops
 *     (dropping a standalone callout/blockquote/fenced-code/table
 *     relative to a target that lives under a DIFFERENT heading, or at a
 *     different top-level-vs-under-a-heading scope) are now allowed,
 *     following the exact same "cut the source's own line range, then
 *     insertBlockAt at the target-derived insertBeforeLine, let re-parsing
 *     resolve the new parentId naturally" approach
 *     move/findMoveTarget.ts's own `{ kind: "insert" }` cross-section list
 *     move already established — no parentId is ever written or read back
 *     out of this function; it is purely a derived, re-parsed fact. The
 *     ONLY remaining structural guard against an unsafe cross-section
 *     drop is condition 4 below (composite-internal-boundary), which
 *     already iterates ALL of `allComposites` regardless of which section
 *     each one belongs to, so it protects a THIRD PARTY CompositeBlock in
 *     the destination section exactly as it always protected one in the
 *     source's own section. Move up/down's own cross-section support
 *     (Move only ever resolves ONE adjacent candidate per direction) is a
 *     SEPARATE, not-yet-addressed follow-up ticket — this addendum, and
 *     this whole module, cover D&D only.
 *   - [ORIGINAL v1 SCOPE — SUPERSEDED, see addendum above] Drop source and
 *     drop target must resolve to the SAME `parentId` (both null —
 *     top-of-document — also counts as equal) — D&D v1 never crosses a
 *     section boundary, exactly like Move's own "different-section"
 *     rejection.
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
 *   3. [SUPERSEDED 2026-09-24, see this module's own top doc comment
 *      addendum] `target.parentId` no longer needs to equal
 *      `source.parentId` — cross-section drops are allowed, so this step
 *      is skipped entirely and numbering below keeps its original slot 4
 *      to minimize churn in cross-references to it.
 *   4. `insertBeforeLine` must not fall strictly inside any
 *      `allComposites[i].range` — otherwise "composite-internal-boundary".
 *      This is now the SOLE remaining structural safety check for a
 *      cross-section drop too (see the addendum above).
 */
export function resolveStandaloneComplexBlockDropTarget(
  doc: ParsedDocument,
  source: ComplexBlockInfo,
  allComposites: CompositeBlockInfo[],
  target: StandaloneComplexBlockDropTargetHint,
  zone: StandaloneComplexBlockDropZone
): StandaloneComplexBlockDropResolution {
  // Phase 5E-3d ("Table Move/Delete/DnD Parity") widened the source kind
  // gate to also accept "table" — table already has Tree projection
  // (isStandalone: true rows) and Move/Delete now reuse this same D&D
  // pipeline's structural-eligibility posture; its ComplexBlockInfo.range
  // is reused completely unchanged here. At that time "fenced-code" was
  // deliberately left out: unlike Move/Delete, this D&D resolver had not
  // gained fenced-code support in Phase 5E-1 (that phase's own scope was
  // Partial Edit/Move/Delete only, not Drag and Drop — see
  // edit/deleteStandaloneComplexBlock.ts's own top doc comment), and
  // widening it was not requested by that ticket.
  //
  // The follow-up ticket "fenced-code D&D parity" (2026-09-24) lifts that
  // exclusion: fenced-code is now accepted here too, on equal footing with
  // callout/blockquote/table. Its ComplexBlockInfo.range is reused
  // unchanged, exactly like table's was — no new resolution logic, only
  // this gate's own kind allow-list widened. See
  // tests/findStandaloneComplexBlockDropTarget.test.ts, which now asserts
  // a fenced-code source is accepted (that same "rejects (not-supported)
  // when the source is not kind callout/blockquote/table" case has been
  // updated accordingly, and its own comment corrected).
  if (
    source.kind !== "callout" &&
    source.kind !== "blockquote" &&
    source.kind !== "table" &&
    source.kind !== "fenced-code"
  ) {
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

  // [2026-09-24, feat/standalone-complex-dnd-cross-section] The
  // `target.parentId !== source.parentId` -> "not-same-section" rejection
  // that used to live here has been REMOVED — see this module's own top
  // doc comment addendum for the full rationale. Cross-section drops now
  // fall straight through to the composite-internal-boundary check below,
  // which is the only remaining safety gate they need.

  for (const composite of allComposites) {
    if (insertBeforeLine > composite.range.startLine && insertBeforeLine <= composite.range.endLine) {
      return { allowed: false, reason: "composite-internal-boundary" };
    }
  }

  return { allowed: true, insertBeforeLine };
}
