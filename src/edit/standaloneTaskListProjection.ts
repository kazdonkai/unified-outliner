/**
 * Phase 5L-2 ("Task List Marker-Free Partial Edit"): the task-list
 * counterpart of edit/standaloneListMarkerProjection.ts — a small, pure
 * eligibility gate deciding whether a given STANDALONE list item (opened
 * on its own, never as part of a CompositeBlock) is STRUCTURALLY safe to
 * consider for task-list marker-free projection at all.
 *
 * Deliberately the exact same four-part structural test
 * edit/standaloneListMarkerProjection.ts#isStandaloneListItemEligibleForMarkerFreeProjection
 * already applies — kept here as this ticket's own INDEPENDENT copy
 * (never a shared import), for the identical reason that module's own top
 * doc comment already gives for not merging ITS gate with
 * compositeBlockMemberProjection.ts#isListMemberEligibleForMarkerFreeProjection:
 * this file must reference nothing but the raw ListBlockNode itself — no
 * CompositeBlock rule, trailing-member, or adjacency concept, per this
 * ticket's own explicit §4 requirement ("CompositeBlock 固有の rule、
 * trailing member、adjacency を参照しない") — and must stay free to diverge
 * from edit/standaloneListMarkerProjection.ts's own gate in the future
 * without forcing a simultaneous change there.
 *
 * Exactly like that module's own gate, this function says NOTHING about
 * whether the item's body actually IS a task-list checkbox at all (a
 * ListBlockNode has no structured field for that — see
 * edit/standaloneListMarkerProjection.ts's own doc comment for why: a
 * task-list checkbox is plain body TEXT this parser's ListBlockNode never
 * models as a distinct node concept). That text-level distinction is
 * decided entirely by which of edit/listMarkerProjection.ts's
 * buildListMarkerProjection or edit/taskListProjection.ts's
 * buildTaskListProjection succeeds on the item's own raw line — see
 * view/PartialEditView.ts's buildStandaloneListProjections, the one call
 * site that runs this structural gate ONCE and then tries both text-level
 * builders against the same eligible line.
 */
import { ListBlockNode } from "../model/block";

/**
 * True only for a list item that is:
 *   - unordered (`node.ordered === false`) — an ordered `1.`/`1)` marker
 *     is out of scope for a task-list checkbox too, per this ticket's own
 *     §2 ("ordered list ... は今回の対象外とします");
 *   - a single line with no nested children (`node.childIds.length === 0`
 *     AND `node.range.startLine === node.range.endLine`) — excludes both
 *     "owns a nested child list" and "owns a continuation paragraph" at
 *     once, per parser/parseDocument.ts's own line-scanning contract (see
 *     edit/standaloneListMarkerProjection.ts's own identical check for
 *     the full rationale, which applies unchanged here);
 *   - not mixed-tab/space indented (`!node.unsafeIndent`) — defensive
 *     self-containment only, mirroring
 *     edit/standaloneListMarkerProjection.ts's own identical defensive
 *     check (a node this true for is already refused upstream by
 *     edit/partialEdit.ts#extractSubtreeText's own "unsafe-indent" gate).
 */
export function isStandaloneTaskListItemEligibleForMarkerFreeProjection(
  node: ListBlockNode
): boolean {
  return (
    !node.ordered &&
    !node.unsafeIndent &&
    node.childIds.length === 0 &&
    node.range.startLine === node.range.endLine
  );
}
