/**
 * Phase 5L-6 ("Parent List Item Structured Partial Edit"): the
 * parent-item counterpart of edit/standaloneMultiLineListItemProjection.ts
 * — a small, pure eligibility gate deciding whether a given STANDALONE list
 * item (opened on its own, never as part of a CompositeBlock — see below
 * for how that exclusion is structurally guaranteed, unchanged, by this
 * whole family's existing call-site convention) is safe to consider for
 * edit/parentListItemProjection.ts's own structured parent projection at
 * all.
 *
 * "STANDALONE (never a CompositeBlock member)" is never checked directly
 * in this file — exactly like every sibling standalone-* eligibility gate
 * in this family (edit/standaloneListMarkerProjection.ts,
 * edit/standaloneTaskListProjection.ts,
 * edit/standaloneOrderedListProjection.ts,
 * edit/standaloneMultiLineListItemProjection.ts — none of them inspect
 * CompositeBlock membership either). view/PartialEditView.ts's own
 * loadNodeInternal (the only call site this function is ever reached from)
 * is itself only ever reached for a plain BlockNode id, via requestLoadNode
 * — a CompositeBlock is loaded through the entirely separate
 * requestLoadComposite/loadCompositeInternal path, which never calls this
 * function or builds edit/parentListItemProjection.ts's own projection at
 * all (see loadCompositeInternal's own doc comment: "この ticket's own
 * approved scope: no...新しい list marker-free extension"). So a
 * CompositeBlock's own list member can never reach this file in the first
 * place, by construction — no redundant re-check needed here, mirroring
 * every sibling gate's identical reliance on that same upstream exclusion.
 *
 * isStandaloneParentListItemEligibleForProjection below is a NECESSARY, not
 * sufficient, condition for attempting
 * edit/parentListItemProjection.ts#buildParentListItemProjection — exactly
 * the same relationship every sibling eligibility gate in this family
 * already has with its own text-level builder (see
 * edit/standaloneMultiLineListItemProjection.ts's own top doc comment for
 * the general principle this file inherits unchanged). A structurally-
 * eligible-per-this-file parent item can still legitimately fail to build
 * (e.g. an unsupported task-checkbox status character on its own first
 * line, or a continuation line whose own leading whitespace is shallower
 * than the canonical continuation-indent length) — the caller falls back
 * to raw editing for the WHOLE item either way, indistinguishable to the
 * user from this file's own gate returning `false` in the first place.
 */
import { ListBlockNode, ParsedDocument } from "../model/block";
import { scanComplexBlocks } from "../parser/complexBlocks";
import { resolveParentListItemOwnTextRange } from "./parentListItemProjection";

/**
 * True only for a list item that is:
 *   - a PARENT (`node.childIds.length > 0`) — this whole ticket's own
 *     defining scope boundary, the structural complement of every sibling
 *     gate's own `childIds.length === 0` requirement;
 *   - not mixed-tab/space indented (`!node.unsafeIndent`) — defensive
 *     self-containment only, mirroring every sibling gate's own identical
 *     defensive check;
 *   - one whose own-text/child-subtree ranges can be safely separated at
 *     all — edit/parentListItemProjection.ts's own
 *     resolveParentListItemOwnTextRange succeeds. A failure there (most
 *     notably "interleaved-content" — see that function's own doc comment)
 *     means this item is NOT eligible, per this ticket's own explicit
 *     "own-text と子サブツリーが明確に分離可能であること" requirement;
 *   - one whose own-text continuation (if any) contains no callout/
 *     blockquote/fenced-code/table/thematic-break block —
 *     hasComplexBlockInParentOwnTextContinuation below, the parent-specific
 *     counterpart of
 *     edit/standaloneMultiLineListItemProjection.ts#hasComplexBlockInMultiLineListItemContinuation,
 *     re-scoped to the resolved own-text range instead of a leaf item's
 *     whole `node.range` (a parent's own-text range never includes any
 *     child-subtree line, by construction, so there is no risk of this
 *     check ever flagging a ComplexBlock that actually lives inside a
 *     CHILD's own continuation instead — that is explicitly none of this
 *     gate's concern, per this ticket's own design doc §2: "child subtree
 *     自体の内部構造は問わない").
 */
export function isStandaloneParentListItemEligibleForProjection(
  doc: ParsedDocument,
  node: ListBlockNode
): boolean {
  if (node.childIds.length === 0 || node.unsafeIndent) {
    return false;
  }
  const resolved = resolveParentListItemOwnTextRange(doc, node);
  if (!resolved.ok) {
    return false;
  }
  return !hasComplexBlockInParentOwnTextContinuation(doc, resolved.resolution.ownTextRange);
}

/** ComplexBlock kinds this ticket's own approved scope excludes from the parent's own-text continuation — identical set to edit/standaloneMultiLineListItemProjection.ts's own COMPLEX_BLOCK_KINDS_EXCLUDED_FROM_MULTILINE_PROJECTION (an independent copy, per this family's own "no cross-module sharing of a shape two modules only structurally overlap in" convention). */
const COMPLEX_BLOCK_KINDS_EXCLUDED_FROM_PARENT_OWN_TEXT = new Set([
  "callout",
  "blockquote",
  "fenced-code",
  "table",
  "thematic-break",
]);

/**
 * True when a fresh parser/complexBlocks.ts#scanComplexBlocks pass over
 * `doc` finds ANY callout/blockquote/fenced-code/table/thematic-break block
 * whose own line range overlaps `ownTextRange`'s own CONTINUATION lines
 * (`ownTextRange.startLine + 1` through `ownTextRange.endLine` — the first
 * line is never included: it is always the parent's own marker line,
 * structurally impossible to also be one of those five kinds). Returns
 * `false` (never a match) when `ownTextRange` is a single line (no
 * continuation lines exist to check at all) — mirrors
 * edit/standaloneMultiLineListItemProjection.ts#hasComplexBlockInMultiLineListItemContinuation's
 * own identical defensive early return.
 *
 * Re-runs scanComplexBlocks fresh on every call (never accepts a cached
 * result from the caller) — the same "each layer re-verifies against
 * current ground truth" discipline every sibling gate in this family
 * already applies.
 */
export function hasComplexBlockInParentOwnTextContinuation(
  doc: ParsedDocument,
  ownTextRange: { startLine: number; endLine: number }
): boolean {
  if (ownTextRange.startLine === ownTextRange.endLine) {
    return false;
  }
  const continuationStartLine = ownTextRange.startLine + 1;
  const continuationEndLine = ownTextRange.endLine;
  return scanComplexBlocks(doc).blocks.some(
    (block) =>
      COMPLEX_BLOCK_KINDS_EXCLUDED_FROM_PARENT_OWN_TEXT.has(block.kind) &&
      block.range.startLine <= continuationEndLine &&
      block.range.endLine >= continuationStartLine
  );
}
