/**
 * Phase 5L-4 ("Multi-Line Leaf List Item Partial Edit Projection"): the
 * multi-line counterpart of edit/standaloneListMarkerProjection.ts,
 * edit/standaloneTaskListProjection.ts, and
 * edit/standaloneOrderedListProjection.ts — two small, independent gates
 * deciding whether a given STANDALONE list item (opened on its own, never
 * as part of a CompositeBlock) is STRUCTURALLY safe to consider for
 * edit/multiLineListItemProjection.ts's own multi-line marker-free
 * projection at all.
 *
 * `isStandaloneMultiLineLeafListItemEligibleForProjection` below is
 * deliberately the exact same `!node.unsafeIndent &&
 * node.childIds.length === 0` structural test every one of the three
 * single-line gates already applies — kept here as this ticket's own
 * INDEPENDENT copy (never a shared import), for the identical reason
 * those three modules' own top doc comments already give for not merging
 * their gates with each other or with
 * compositeBlockMemberProjection.ts#isListMemberEligibleForMarkerFreeProjection.
 * The ONE deliberate difference from all three: this gate requires
 * `node.range.startLine !== node.range.endLine` (MORE than one line) —
 * the exact structural COMPLEMENT of every one of the three single-line
 * gates' own `node.range.startLine === node.range.endLine` requirement.
 * This gate also says nothing about `node.ordered` at all (unlike the
 * single-line ordered gate) — a multi-line leaf item's own KIND
 * (unordered/task/ordered) is decided entirely at the text level, by
 * which of the three single-line builders succeeds on its own first line
 * — see edit/multiLineListItemProjection.ts's own
 * buildMultiLineListItemProjection for exactly where that happens.
 *
 * `hasComplexBlockInMultiLineListItemContinuation` below is this ticket's
 * own SECOND, separate gate — deliberately NOT folded into the first
 * function's own signature, because it is the one eligibility check in
 * this whole family that genuinely needs the surrounding ParsedDocument
 * (to run parser/complexBlocks.ts's own scanComplexBlocks), unlike every
 * other gate in this family, which intentionally takes nothing but the
 * raw ListBlockNode itself. A multi-line leaf item's own base
 * ParsedDocument range (parser/parseDocument.ts's own line-scanning pass)
 * has NO concept of callout/blockquote/fenced-code/table/thematic-break
 * at all — those are recognized entirely separately, by
 * parser/complexBlocks.ts's own scanners, which do not themselves exclude
 * lines a list item's own range already claims. So a continuation line
 * that happens to start with `>` / a fence marker / a table row is, to
 * the BASE parser, ordinary continuation prose — but this ticket's own
 * approved scope explicitly excludes any such item from structured
 * multi-line projection (raw fallback instead — see this ticket's own
 * design doc §6), so the caller (view/PartialEditView.ts's
 * loadNodeInternal/performAutoReload, the only two call sites) must run
 * BOTH this function's structural check AND this one before attempting
 * edit/multiLineListItemProjection.ts's own build function.
 *
 * Exactly like the three single-line gates' own doc comments already
 * note, this file says NOTHING about whether the item's own first line
 * actually IS a supported unordered/task/ordered marker shape at all —
 * that text-level distinction is decided entirely by
 * edit/multiLineListItemProjection.ts's own
 * buildMultiLineListItemProjection, which a structurally-eligible-per-this-file
 * item can still legitimately fail against (e.g. an unsupported task
 * checkbox status character, or a continuation line whose own leading
 * whitespace is shallower than the canonical continuation-indent length —
 * see that module's own top doc comment). Both this file's own gates
 * returning `true` is therefore a NECESSARY, not sufficient, condition for
 * showing the structured multi-line UI — exactly the same "eligible but
 * build could still fail, and that's fine" relationship every other
 * eligibility gate in this codebase already has with its own text-level
 * builder.
 */
import { ListBlockNode, ParsedDocument } from "../model/block";
import { scanComplexBlocks } from "../parser/complexBlocks";

/**
 * True only for a list item that is:
 *   - a MULTI-line item (`node.range.startLine !== node.range.endLine`) —
 *     the structural complement of every single-line gate's own
 *     `startLine === endLine` requirement; this is this ticket's own
 *     defining scope boundary;
 *   - a single-line-item's-worth of nesting: no nested children
 *     (`node.childIds.length === 0`) — per
 *     parser/parseDocument.ts's own line-scanning contract, a
 *     ListBlockNode with `childIds.length === 0` whose range still spans
 *     more than one line can ONLY be a continuation-paragraph item (never
 *     a "child list" item — see edit/standaloneListMarkerProjection.ts's
 *     own identical reasoning for the general principle, which this
 *     ticket's own scope narrows further: a multi-line item WITH child
 *     list items, i.e. `childIds.length > 0`, is always raw fallback,
 *     per this ticket's own design doc §2/§6, "subtree 全体の structured
 *     projection" being explicitly out of scope);
 *   - not mixed-tab/space indented (`!node.unsafeIndent`) — defensive
 *     self-containment only, mirroring every sibling gate's own identical
 *     defensive check (a node this true for is already refused entirely
 *     by edit/partialEdit.ts#extractSubtreeText's own "unsafe-indent"
 *     gate before this function could ever run against it).
 */
export function isStandaloneMultiLineLeafListItemEligibleForProjection(
  node: ListBlockNode
): boolean {
  return (
    !node.unsafeIndent &&
    node.childIds.length === 0 &&
    node.range.startLine !== node.range.endLine
  );
}

/** ComplexBlock kinds this ticket's own approved scope excludes from multi-line structured projection entirely — see this module's own top doc comment. */
const COMPLEX_BLOCK_KINDS_EXCLUDED_FROM_MULTILINE_PROJECTION = new Set([
  "callout",
  "blockquote",
  "fenced-code",
  "table",
  "thematic-break",
]);

/**
 * True when a fresh parser/complexBlocks.ts#scanComplexBlocks pass over
 * `doc` finds ANY callout/blockquote/fenced-code/table/thematic-break
 * block whose own line range overlaps `node`'s own CONTINUATION lines
 * (`node.range.startLine + 1` through `node.range.endLine` — the first
 * line is never included in this check: it is always this same item's
 * own marker line, structurally impossible to also be one of those five
 * kinds). Returns `false` (never a match) for a single-line item
 * (`node.range.startLine === node.range.endLine`, i.e. no continuation
 * lines exist to check at all) — defensive only, since this function's
 * only real caller already gates on
 * isStandaloneMultiLineLeafListItemEligibleForProjection returning `true`
 * first, but kept total (a well-defined answer for every ListBlockNode)
 * rather than assuming its caller's own gating order.
 *
 * Re-runs scanComplexBlocks fresh on every call (never accepts a cached
 * result from the caller) — the same "each layer re-verifies against
 * current ground truth, never trusts a caller's earlier judgment"
 * discipline edit/partialEdit.ts's own extractSubtreeText already applies
 * for its own callout/blockquote id resolution, and every
 * edit/*CompositeBlock.ts module already applies for its own re-scans.
 */
export function hasComplexBlockInMultiLineListItemContinuation(
  doc: ParsedDocument,
  node: ListBlockNode
): boolean {
  if (node.range.startLine === node.range.endLine) {
    return false;
  }
  const continuationStartLine = node.range.startLine + 1;
  const continuationEndLine = node.range.endLine;
  return scanComplexBlocks(doc).blocks.some(
    (block) =>
      COMPLEX_BLOCK_KINDS_EXCLUDED_FROM_MULTILINE_PROJECTION.has(block.kind) &&
      block.range.startLine <= continuationEndLine &&
      block.range.endLine >= continuationStartLine
  );
}

