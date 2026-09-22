/**
 * Phase 5L-12 ("Partial Edit Session Consolidation and External Document
 * Reconciliation"): the single, Obsidian-free, pure implementation of the
 * five-tier standalone-list-item projection priority chain (list-marker-
 * free > task-list-marker-free > ordered-list-marker-free > multi-line-
 * leaf > parent-list-item — Phase 5L-1/5L-2/5L-3/5L-4/5L-6's own priority
 * order, entirely unchanged by this phase).
 *
 * Before this phase, this exact five-eligibility-check/three-builder-call
 * sequence was independently re-implemented inline at FIVE call sites
 * inside view/PartialEditView.ts (loadNodeInternal's own initial load,
 * performAutoReload's own external-change reload, and three of the
 * post-Apply rebuild sites) — none of it ever depended on Obsidian, but
 * being written inline inside an ItemView subclass meant it could only
 * ever be exercised through brittle static-source-text checks (the
 * `bodyOf()`-based "*UiWiring.test.ts" convention — see
 * tests/partialEditStalePaneSyncUiWiring.test.ts's own doc comment for why
 * PartialEditView itself cannot be constructed in vitest), never with a
 * real parseDocument-backed behavioral test. This module extracts that
 * logic once, as a plain function over `ParsedDocument`/`BlockNode`, so it
 * can be unit-tested directly (see tests/standaloneProjectionResolver.test.ts)
 * and so every one of those five call sites can delegate to the SAME
 * implementation instead of each maintaining (and, before this phase,
 * silently drifting out of sync with) its own copy — see
 * docs/phase5l12_partial-edit-external-reconciliation.md for the full
 * before/after and the real-device bug this consolidation fixes.
 *
 * view/PartialEditView.ts's own private `resolveStandaloneListProjections`
 * method is now a thin call-through to this function — kept as a method
 * (rather than deleting it and importing this function at every call site
 * directly) only so its own doc comment can stay next to the class fields
 * it feeds, per this file's existing documentation convention.
 */

import { BlockNode, isListNode, ParsedDocument } from "../model/block";
import { buildListMarkerProjection, ListMarkerProjection } from "./listMarkerProjection";
import { isStandaloneListItemEligibleForMarkerFreeProjection } from "./standaloneListMarkerProjection";
import { buildTaskListProjection, TaskListProjection } from "./taskListProjection";
import { isStandaloneTaskListItemEligibleForMarkerFreeProjection } from "./standaloneTaskListProjection";
import { buildOrderedListProjection, OrderedListProjection } from "./orderedListProjection";
import { isStandaloneOrderedListItemEligibleForMarkerFreeProjection } from "./standaloneOrderedListProjection";
import { buildMultiLineListItemProjection, MultiLineListItemProjection } from "./multiLineListItemProjection";
import {
  hasComplexBlockInMultiLineListItemContinuation,
  isStandaloneMultiLineLeafListItemEligibleForProjection,
} from "./standaloneMultiLineListItemProjection";
import { buildParentListItemProjection, ParentListItemProjection } from "./parentListItemProjection";
import { isStandaloneParentListItemEligibleForProjection } from "./standaloneParentListItemProjection";

export interface StandaloneProjectionSet {
  list: ListMarkerProjection | null;
  task: TaskListProjection | null;
  ordered: OrderedListProjection | null;
  multiLine: MultiLineListItemProjection | null;
  parent: ParentListItemProjection | null;
}

/**
 * Resolves which (if any) of the five standalone list-item projections
 * currently applies to `node`, following the SAME priority order every
 * prior inline copy of this logic already used: a single-line unordered/
 * task/ordered marker-free projection is tried first (via
 * `buildListMarkerProjection`'s own "task-list-marker"/"ordered-marker"
 * refusal dispatch — see that function's own doc comment for why the
 * three are mutually exclusive by construction, never independently
 * re-checked here), then — only once all three returned null — a
 * multi-line-leaf projection, then — only once all four returned null,
 * AND only when the node actually owns one or more children — the parent
 * projection.
 *
 * Returns every field null for `node === undefined` or a non-list node —
 * this function never decides to REFUSE a target, only which (if any) of
 * the five structured projections currently applies to it; the caller's
 * existing raw-fallback display is unchanged either way. `rawText` is the
 * target's own already-isolated subtree text (extractSubtreeText's own
 * return shape) — only consulted by the four LEAF builders, which is why
 * a `rawText` that is stale relative to a node that is CURRENTLY a real
 * parent (`childIds.length > 0`) can never matter: every one of the four
 * leaf eligibility checks already independently requires
 * `childIds.length === 0` before this function ever looks at `rawText`
 * at all.
 */
export function resolveStandaloneListProjections(
  doc: ParsedDocument,
  node: BlockNode | undefined,
  rawText: string
): StandaloneProjectionSet {
  const listEligible = !!node && isListNode(node) && isStandaloneListItemEligibleForMarkerFreeProjection(node);
  const taskEligible = !!node && isListNode(node) && isStandaloneTaskListItemEligibleForMarkerFreeProjection(node);
  const orderedEligible =
    !!node && isListNode(node) && isStandaloneOrderedListItemEligibleForMarkerFreeProjection(node);

  let list: ListMarkerProjection | null = null;
  let task: TaskListProjection | null = null;
  let ordered: OrderedListProjection | null = null;
  if (listEligible || orderedEligible) {
    const built = buildListMarkerProjection(rawText);
    if (built.ok) {
      list = built.projection;
    } else if (built.reason === "task-list-marker" && taskEligible) {
      const taskBuilt = buildTaskListProjection(rawText);
      task = taskBuilt.ok ? taskBuilt.projection : null;
    } else if (built.reason === "ordered-marker" && orderedEligible) {
      const orderedBuilt = buildOrderedListProjection(rawText);
      ordered = orderedBuilt.ok ? orderedBuilt.projection : null;
    }
  }

  const multiLineEligible =
    !!node &&
    isListNode(node) &&
    isStandaloneMultiLineLeafListItemEligibleForProjection(node) &&
    !hasComplexBlockInMultiLineListItemContinuation(doc, node);
  const multiLine =
    !list && !task && !ordered && multiLineEligible
      ? (() => {
          const built = buildMultiLineListItemProjection(rawText);
          return built.ok ? built.projection : null;
        })()
      : null;

  const parentEligible =
    !!node && isListNode(node) && node.childIds.length > 0 && isStandaloneParentListItemEligibleForProjection(doc, node);
  const parent =
    !list && !task && !ordered && !multiLine && parentEligible && node && isListNode(node)
      ? (() => {
          const built = buildParentListItemProjection(doc, node);
          return built.ok ? built.projection : null;
        })()
      : null;

  return { list, task, ordered, multiLine, parent };
}
