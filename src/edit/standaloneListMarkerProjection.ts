/**
 * Phase 5L-1 ("Standalone Single-Line Unordered List Marker-Free Partial
 * Edit"): the STANDALONE-list-domain counterpart of
 * edit/compositeBlockMemberProjection.ts#isListMemberEligibleForMarkerFreeProjection
 * — a small, pure eligibility gate deciding whether a given list item,
 * opened on its OWN (never as part of a CompositeBlock) in the Partial
 * Edit Pane, may show its Markdown marker (`-`/`*`/`+`) hidden from the
 * editable body, the same treatment Phase 5D-2C already gave a
 * CompositeBlock's leading `single-line-list` member.
 *
 * This file deliberately does NOT reuse
 * isListMemberEligibleForMarkerFreeProjection, and does NOT introduce any
 * shared predicate merging the two: the two gates take fundamentally
 * different input shapes; forcing them onto one signature would either
 * leak CompositeBlock-only concepts (CompositeMemberKind, itself derived
 * by an entirely different scan — parser/compositeBlocks.ts's own
 * range-matching over ComplexBlockInfo-shaped composite members) into
 * this file, or leak standalone-only concepts (a raw ListBlockNode's own
 * childIds/range/ordered fields, as this parser's general list model
 * represents ANY list item, composed or not) into
 * compositeBlockMemberProjection.ts, which this ticket's own approved
 * scope explicitly forbids ("単独 list 側の eligibility をそこへ混ぜない
 * こと"). Keeping the two gates independent, each colocated with the
 * domain whose data it actually reads, is the smaller and clearer change.
 *
 * Reuses edit/listMarkerProjection.ts (buildListMarkerProjection/
 * invertListMarkerProjection/ListMarkerProjection/projectedListBodyText)
 * completely unmodified as the ONLY marker-separation/restoration logic —
 * exactly as that module's own top doc comment already anticipated when
 * it called itself "independent of CompositeBlock... reusable later by a
 * standalone marker-free list Partial Edit". This file adds nothing to
 * that contract; it only decides WHEN it's safe to invoke it for a
 * standalone list node, using information (childIds, range, ordered) that
 * only a real ListBlockNode carries and buildListMarkerProjection itself
 * has no way to see (it only ever receives one already-isolated raw
 * line).
 */
import { ListBlockNode } from "../model/block";

/**
 * True only for a list item that is:
 *   - unordered (`node.ordered === false` — an ordered `1.`/`1)` marker is
 *     out of scope this phase, per this ticket's own §4; also enforced
 *     independently, and redundantly on purpose, by
 *     buildListMarkerProjection's own "ordered-marker" refusal — this
 *     structural pre-check just avoids ever attempting the build for a
 *     case that can never succeed);
 *   - a single line with no nested children (`node.childIds.length === 0`
 *     AND `node.range.startLine === node.range.endLine`) — per
 *     parser/parseDocument.ts's own line-scanning contract (see that
 *     module's own top doc comment), a ListBlockNode's range grows past
 *     its own start line for exactly two reasons: it owns one or more
 *     nested child list items (captured in childIds), or it owns a
 *     continuation paragraph (extra non-blank lines deeper than the
 *     item's own indent, with no child list item created for them). This
 *     ONE check therefore excludes both "child list" and "continuation
 *     paragraph" list items at once, per this ticket's own §4 — there is
 *     no need for a second, separate continuation-paragraph check;
 *   - not mixed-tab/space indented (`!node.unsafeIndent`) — defensive
 *     self-containment only: a node this true for would already have been
 *     refused entirely by edit/partialEdit.ts#extractSubtreeText's own
 *     "unsafe-indent" gate before this function could ever run against
 *     it, so this never actually changes today's observable behavior. It
 *     is included so this function's own contract stays correct and
 *     independently testable even if that upstream gate is ever loosened,
 *     rather than silently depending on a caller-side ordering guarantee.
 *
 * Deliberately says nothing about task-list checkboxes (`- [ ]`) — that is
 * plain body TEXT (part of `(?:[ \t]+.*)?` in parser/parseDocument.ts's
 * own LIST_RE, never a distinct node concept this parser's ListBlockNode
 * models), so it cannot be checked structurally here. It is instead
 * caught by buildListMarkerProjection's own "task-list-marker" refusal —
 * a structurally-eligible item whose single line happens to be a task
 * list still safely falls back to raw display, exactly like an ordered
 * item does, just one layer later. Both fallbacks look identical to a
 * caller: eligible-but-build-failed and ineligible both simply mean "use
 * the raw line" (see view/PartialEditView.ts#loadNodeInternal).
 */
export function isStandaloneListItemEligibleForMarkerFreeProjection(
  node: ListBlockNode
): boolean {
  return (
    !node.ordered &&
    !node.unsafeIndent &&
    node.childIds.length === 0 &&
    node.range.startLine === node.range.endLine
  );
}
