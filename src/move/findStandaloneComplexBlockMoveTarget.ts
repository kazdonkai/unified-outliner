/**
 * Phase 5C-3 (2026-08-14): resolves the full swap TARGET for a standalone
 * (non-composite-member) callout/blockquote move, given that
 * parser/compositeBlocks.ts#evaluateStandaloneComplexBlockMovability has
 * already confirmed a move in that direction is eligible.
 *
 * Deliberately mirrors move/findCompositeMoveTarget.ts's own judge/resolver
 * split exactly:
 *   - evaluateStandaloneComplexBlockMovability is the JUDGE: "may this
 *     standalone block move in this direction", with an explainable
 *     rejection reason when not.
 *   - findStandaloneComplexBlockMoveTarget (this file) is the RESOLVER:
 *     "given that it may, what is the exact LineRange to swap it with".
 * This module calls evaluateStandaloneComplexBlockMovability itself, as the
 * very first thing it does, and returns `null` immediately when it says
 * `eligible: false` — it never re-derives an equivalent judgment
 * independently. The actual adjacency scan reuses
 * parser/compositeBlocks.ts's own exported `skipBlankLines` and
 * `findAdjacentStandaloneComplexBlock` rather than a second, independently-
 * written implementation. Re-running the same scan a second time (once
 * inside evaluateStandaloneComplexBlockMovability, once again here) is
 * deliberate, not wasteful — mirrors findCompositeMoveTarget's own doc
 * comment and this whole codebase's "never guess, always re-verify against
 * current ground truth" policy.
 *
 * ---- No composite-widening here ----
 *
 * Unlike findCompositeMoveTarget, this module never widens its resolved
 * target: Phase 5C-3's approved adjacency candidates are limited to OTHER
 * standalone complex blocks only ("A案") — never a list item or another
 * CompositeBlock — so the adjacent block's own `range` (a single, atomic
 * complex block, never decomposed) is always exactly what gets swapped,
 * with no further resolution step needed. Originally callout/blockquote
 * only; Phase 5E-1 widened the eligible kind set to also include
 * fenced-code, and Phase 5E-3d widened it again to also include table —
 * this module itself required NO code change for either widening, since it
 * defers entirely to parser/compositeBlocks.ts's own
 * isStandaloneComplexBlockShapeEligible/evaluateStandaloneComplexBlockMovability/
 * findAdjacentStandaloneComplexBlock for every kind check (see this file's
 * own function below).
 *
 * ---- What this module does NOT do ----
 *
 * No doc.lines mutation, no move/moveBlock.ts#swapBlocks call, no command
 * wiring, no Notice — this module resolves WHICH range to swap with,
 * nothing more. Actually performing the swap (full no-op-on-failure
 * semantics included) is edit/moveStandaloneComplexBlock.ts's job.
 */
import { LineRange, ParsedDocument } from "../model/block";
import { ComplexBlockInfo, ComplexBlockScanResult } from "../model/complexBlock";
import { CompositeBlockInfo } from "../model/compositeBlock";
import {
  evaluateStandaloneComplexBlockMovability,
  findAdjacentStandaloneMoveNeighbor,
  skipBlankLines,
} from "../parser/compositeBlocks";

/** "up" | "down" — re-exported locally, same convention as move/findCompositeMoveTarget.ts's own CompositeMoveDirection, kept as an independent type so this narrower, standalone-specific API has no dependency on that composite-specific one. */
export type StandaloneMoveDirection = "up" | "down";

/**
 * The resolved swap target for a standalone complex-block move.
 *   - `range`: the adjacent standalone callout/blockquote's own full
 *     LineRange (never widened — see this module's own top doc comment).
 *   - `targetId`: the adjacent block's own id at resolution time — kept for
 *     caller convenience/debugging only, exactly like
 *     CompositeMoveTarget.anchorNodeId's own doc comment explains for the
 *     composite case (never trusted as a stable identity across a future
 *     re-parse).
 */
export interface StandaloneComplexBlockMoveTarget {
  range: LineRange;
  targetId: string;
}

/**
 * Resolves the swap target for moving `target` in `direction`, or `null`
 * when no safe target can be determined. Steps:
 *
 *   1. Defer entirely to evaluateStandaloneComplexBlockMovability for
 *      eligibility. `eligible: false` (any reason) -> `null`, immediately.
 *   2. Re-run the SAME adjacency scan the judge itself performed
 *      (skipBlankLines + findAdjacentStandaloneComplexBlock, both imported
 *      from parser/compositeBlocks.ts) to obtain the actual adjacent
 *      ComplexBlockInfo — `eligible: true` guarantees this succeeds, but
 *      the result is still defensively null-checked rather than assumed.
 *   3. `range` = the resolved adjacent block's own range, `targetId` = its
 *      own id.
 *
 * `allowComposedMember` (Phase 5D-3B, default `false`): passed straight
 * through to evaluateStandaloneComplexBlockMovability, unchanged — see that
 * function's own doc comment. This resolver adds no logic of its own around
 * it: the adjacency scan in step 2 is exactly the same standalone-only scan
 * regardless of this flag's value, since findAdjacentStandaloneComplexBlock
 * itself has no `allowComposedMember` concept — only the MOVING target's
 * own composite-membership check (inside the judge) is affected.
 */
export function findStandaloneComplexBlockMoveTarget(
  doc: ParsedDocument,
  complexScan: ComplexBlockScanResult,
  target: ComplexBlockInfo,
  direction: StandaloneMoveDirection,
  allComposites: CompositeBlockInfo[],
  allowComposedMember = false
): StandaloneComplexBlockMoveTarget | null {
  const movability = evaluateStandaloneComplexBlockMovability(
    doc,
    complexScan,
    target,
    direction,
    allComposites,
    allowComposedMember
  );
  if (!movability.eligible) {
    return null;
  }

  const boundaryLine = direction === "up" ? target.range.startLine - 1 : target.range.endLine + 1;
  const k = skipBlankLines(doc, boundaryLine, direction);
  if (k === null) {
    // Structurally unreachable given eligible === true — defensive only.
    return null;
  }

  // ADDENDUM (2026-09-24, fix/standalone-complex-move-adjacent-parity):
  // widened from findAdjacentStandaloneComplexBlock to
  // findAdjacentStandaloneMoveNeighbor, mirroring
  // evaluateStandaloneComplexBlockMovability's own identical change — see
  // that function's own doc comment in parser/compositeBlocks.ts. This
  // resolver's own "no composite-widening" doc comment, above, still holds
  // for CompositeBlock membership specifically: only the KIND of adjacent
  // unit is now broader (paragraph, standalone list item), never a
  // composite or a composite member.
  const adjacent = findAdjacentStandaloneMoveNeighbor(doc, complexScan, allComposites, k, direction);
  if (!adjacent) {
    // Structurally unreachable given eligible === true — defensive only.
    return null;
  }

  return {
    range: { startLine: adjacent.range.startLine, endLine: adjacent.range.endLine },
    targetId: adjacent.id,
  };
}
