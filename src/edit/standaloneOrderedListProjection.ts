/**
 * Phase 5L-3 ("Ordered List Marker-Free Partial Edit"): the ordered-list
 * counterpart of edit/standaloneListMarkerProjection.ts and
 * edit/standaloneTaskListProjection.ts — a small, pure eligibility gate
 * deciding whether a given STANDALONE list item (opened on its own, never
 * as part of a CompositeBlock) is STRUCTURALLY safe to consider for
 * ordered-list marker-free projection at all.
 *
 * Deliberately the exact same four-part structural test
 * edit/standaloneListMarkerProjection.ts#isStandaloneListItemEligibleForMarkerFreeProjection
 * and edit/standaloneTaskListProjection.ts#isStandaloneTaskListItemEligibleForMarkerFreeProjection
 * already apply (with `node.ordered` inverted) — kept here as this
 * ticket's own INDEPENDENT copy (never a shared import), for the
 * identical reason those two modules' own top doc comments already give
 * for not merging their gates with
 * compositeBlockMemberProjection.ts#isListMemberEligibleForMarkerFreeProjection
 * or with each other: this file must reference nothing but the raw
 * ListBlockNode itself — no CompositeBlock rule, trailing-member, or
 * adjacency concept, no task-list concept — and must stay free to
 * diverge from either sibling gate in the future without forcing a
 * simultaneous change there.
 *
 * Exactly like those two modules' own gates, this function says NOTHING
 * about whether the item's body actually IS a task-list checkbox (an
 * ordered task-list item, e.g. `1. [ ] text`, is out of this ticket's
 * own scope — see edit/orderedListProjection.ts's own top doc comment).
 * That text-level distinction is decided entirely by which of
 * edit/listMarkerProjection.ts's buildListMarkerProjection,
 * edit/taskListProjection.ts's buildTaskListProjection, or
 * edit/orderedListProjection.ts's buildOrderedListProjection succeeds on
 * the item's own raw line — see view/PartialEditView.ts's
 * buildStandaloneListProjections, the one call site that runs this
 * structural gate ONCE and then tries the appropriate text-level
 * builder(s) against the same eligible line.
 */
import { ListBlockNode } from "../model/block";

/**
 * True only for a list item that is:
 *   - ordered (`node.ordered === true`) — an unordered `-`/`*`/`+` marker
 *     is edit/standaloneListMarkerProjection.ts's own domain entirely
 *     (and, separately, edit/standaloneTaskListProjection.ts's own domain
 *     for an unordered task-list item) — this gate must never overlap
 *     with either;
 *   - a single line with no nested children (`node.childIds.length === 0`
 *     AND `node.range.startLine === node.range.endLine`) — excludes both
 *     "owns a nested child list" and "owns a continuation paragraph" at
 *     once, per parser/parseDocument.ts's own line-scanning contract (see
 *     edit/standaloneListMarkerProjection.ts's own identical check for
 *     the full rationale, which applies unchanged here). This is also
 *     this ticket's own explicit scope boundary: "複数行 list item、
 *     continuation paragraph、子 list を持つ parent item ... は今回の
 *     対象外です";
 *   - not mixed-tab/space indented (`!node.unsafeIndent`) — defensive
 *     self-containment only, mirroring the two sibling gates' own
 *     identical defensive check (a node this true for is already refused
 *     upstream by edit/partialEdit.ts#extractSubtreeText's own
 *     "unsafe-indent" gate).
 */
export function isStandaloneOrderedListItemEligibleForMarkerFreeProjection(
  node: ListBlockNode
): boolean {
  return (
    node.ordered &&
    !node.unsafeIndent &&
    node.childIds.length === 0 &&
    node.range.startLine === node.range.endLine
  );
}
