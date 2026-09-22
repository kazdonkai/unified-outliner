/**
 * Phase 5L-8 ("Child Item Inline Structured Editing in Parent Partial Edit
 * Pane"): lets the Partial Edit Pane's existing Phase 5L-6/5L-7 parent
 * projection also inline-edit exactly ONE of the parent's DIRECT children,
 * structurally, from inside the SAME pane — no leaving the parent, no
 * separate Partial Edit session, no raw textarea for the whole subtree.
 *
 * ---- Responsibility split vs. Phase 5L-6/5L-7 (unchanged by this module) ----
 *
 * edit/parentListItemProjection.ts's own own-text/child-subtree range split
 * is reused UNMODIFIED and untouched here — this module never re-derives
 * `ownTextRange`/`childSubtreeRange`/`childSubtreeText`, it only ever reads
 * them off an already-built `ParentListItemProjection`. Phase 5L-7's own
 * `childPreviewRowTargets`/`resolveParentChildPreviewNavigationTarget` (also
 * unmodified) remain the ONLY way a preview row's plain click/Enter/Space
 * activation ever navigates to a child as its own separate pane session —
 * this module adds a SECOND, deliberately distinct affordance (an explicit
 * "edit this child inline" control — see view/PartialEditView.ts's own
 * wiring) that opens a small structured editor for that ONE child directly
 * inside the still-open parent pane instead. The two are never triggered by
 * the same interaction (see this ticket's own design doc §5).
 *
 * ---- Reuse, never re-implementation ----
 *
 * Exactly like edit/parentListItemProjection.ts's own top doc comment
 * requires of itself, this module does NOT re-implement marker/checkbox/
 * number/continuation-indentation splitting, or a second callout/
 * blockquote/fenced-code/table/thematic-break scanner. A DIRECT child
 * eligible for inline editing is, by definition (see
 * evaluateChildInlineEditEligibility below), a LEAF item
 * (`childIds.length === 0`) — structurally identical to what a plain
 * STANDALONE leaf item already looks like to
 * edit/listMarkerProjection.ts/edit/taskListProjection.ts/
 * edit/orderedListProjection.ts/edit/multiLineListItemProjection.ts, so
 * building/inverting a child's own body is delegated to those four modules
 * entirely unchanged — `buildChildLeafProjection`/`invertChildLeafProjection`
 * below are pure DISPATCH, never a duplicate splitter. The complex-block
 * continuation gate reuses
 * edit/standaloneMultiLineListItemProjection.ts's own
 * `hasComplexBlockInMultiLineListItemContinuation` verbatim (that function
 * already takes any `(doc, node)` pair, not only a top-level standalone
 * one). The parent's own-text candidate is reconstructed via
 * edit/parentListItemProjection.ts's own `invertParentListItemProjection`,
 * completely unmodified — this module never re-implements the parent's own
 * two-stage safety net either.
 *
 * ---- The one NEW risk this module's own safety net exists for ----
 *
 * Mirroring edit/parentListItemProjection.ts's own "The one NEW risk this
 * module's own safety net exists for" section almost exactly: validating
 * the parent's own-text candidate alone (already done by
 * invertParentListItemProjection, against the ORIGINAL unedited child
 * subtree) and validating the child's own candidate alone (already done by
 * whichever leaf invert function built it) is not, by itself, enough once
 * BOTH may be edited in the SAME Apply — nothing about either isolated
 * check can prove that re-splicing an EDITED child back in among its
 * (unedited) siblings, under a possibly-also-edited parent, still yields
 * the exact same number of direct children, with the edited one still a
 * leaf at the same position and every sibling byte-for-byte untouched.
 * `invertAndValidateParentChildCombinedEdit` below is this module's own
 * ONE additional check, built the same way
 * edit/parentListItemProjection.ts's own final safety net is: splice the
 * (possibly edited) child candidate into the ORIGINAL child-subtree
 * snapshot at the target child's own captured position, splice THAT behind
 * the (possibly edited) parent own-text candidate, and re-parse the whole
 * thing as one throwaway mini-document.
 *
 * ---- Apply-time write-back: two ranges, one atomic splice, own conflict
 * check per range ----
 *
 * `applyParentChildInlineEditToDocument` below is this module's own
 * counterpart of edit/parentListItemProjection.ts's own
 * applyParentListItemOwnTextEdit — re-resolves BOTH the parent's own-text
 * range AND the child's own range FRESH from the CURRENT document (never
 * trusting a caller-held range from an earlier parse), and builds exactly
 * ONE new `lines` array covering both replacements in a single pass — never
 * two sequential, independently-committed edits, so a partial write (one
 * range saved, the other not) is structurally impossible: this function
 * either returns one fully-formed replacement or leaves `doc.lines`
 * untouched. A conflict check runs ONLY for whichever range is actually
 * DIRTY (about to be overwritten) — mirroring
 * applyParentListItemOwnTextEdit's own "an external change to the range
 * this Apply never touches can never block it" principle, applied
 * symmetrically to whichever of the two ranges is clean this time (a
 * clean range is spliced back with whatever the LIVE document currently
 * holds there, never a stale snapshot — see that function's own inline
 * comment for why). Sibling raw text and everything outside the parent's
 * own subtree is never read, compared, or written by this module at all.
 *
 * ---- What this module explicitly does NOT do ----
 *
 * No grandchild-and-deeper inline editing (a child with `childIds.length
 * > 0` is never eligible — see evaluateChildInlineEditEligibility below).
 * No multi-child-simultaneous editing (exactly one child session at a
 * time — enforced by view/PartialEditView.ts's own single
 * `childInlineSession` field, never by this module, which is itself
 * stateless). No child add/delete/move/reorder/indent-outdent. No marker-
 * kind change, no task-checkbox-status-range expansion beyond
 * edit/taskListProjection.ts's own existing support, no ordered-delimiter
 * change, no sibling renumbering — every one of those constraints is
 * inherited unchanged from the four leaf projection modules this module
 * reuses. See this ticket's own design doc
 * (docs/phase5l8_parent-child-inline-structured-edit.md) for the complete
 * list of deferred/out-of-scope candidates.
 */
import { isListNode, ListBlockNode, LineRange, ParsedDocument } from "../model/block";
import { parseDocument } from "../parser/parseDocument";
import {
  buildListMarkerProjection,
  invertListMarkerProjection,
  ListMarkerProjection,
  projectedListBodyText,
} from "./listMarkerProjection";
import {
  buildTaskListProjection,
  invertTaskListProjection,
  TaskListProjection,
  projectedTaskBodyText,
  projectedTaskChecked,
} from "./taskListProjection";
import {
  buildOrderedListProjection,
  invertOrderedListProjection,
  OrderedListProjection,
  projectedOrderedBodyText,
  projectedOrderedNumberText,
} from "./orderedListProjection";
import {
  buildMultiLineListItemProjection,
  invertMultiLineListItemProjection,
  MultiLineListItemProjection,
  projectedMultiLineBodyText,
  projectedMultiLineChecked,
  projectedMultiLineNumberText,
} from "./multiLineListItemProjection";
import { hasComplexBlockInMultiLineListItemContinuation } from "./standaloneMultiLineListItemProjection";
import {
  ParentListItemProjection,
  resolveParentListItemOwnTextRange,
  invertParentListItemProjection,
} from "./parentListItemProjection";
// Phase 5L-9 ("Direct Child Add/Delete in Parent Partial Edit Pane"): reused
// verbatim, never re-derived — leadingWhitespace/TAB_WIDTH are the SAME
// primitives move/indentBlock.ts's own buildIndentPrefix already computes a
// NEW child's indentation from (see this file's own Phase 5L-9 section,
// computeNewChildIndent, for the one-paragraph rationale for why the exact
// same "match an existing sibling's indent verbatim, or step one TAB_WIDTH
// past the parent's own indent when there is no sibling yet" policy applies
// here too).
import { leadingWhitespace, TAB_WIDTH } from "../parser/parseDocument";
// Phase 5L-11 ("Direct Child Leaf Indent/Outdent in Parent Partial Edit
// Pane"): reused verbatim, never re-derived — the SAME whitespace
// primitives the Outline Tree's own pre-existing indent/outdent command
// (move/indentBlock.ts) already uses. See this file's own Phase 5L-11
// section (near the bottom of this file) for the full rationale.
import { buildIndentPrefix, growIndent, shrinkIndent } from "../move/indentBlock";
import { applySubtreeEdit } from "./partialEdit";

// ---------------------------------------------------------------------
// The child's own leaf projection: pure dispatch over the four existing
// leaf projection modules — never a re-implementation of any of them.
// ---------------------------------------------------------------------

export type ChildLeafKind = "unordered" | "task" | "ordered" | "multiLine";

export type ChildLeafProjection =
  | { kind: "unordered"; projection: ListMarkerProjection }
  | { kind: "task"; projection: TaskListProjection }
  | { kind: "ordered"; projection: OrderedListProjection }
  | { kind: "multiLine"; projection: MultiLineListItemProjection };

/**
 * The ONE refusal reason this dispatch ever returns: none of the four
 * existing leaf builders accepted `rawText` (an unsupported task-checkbox
 * status character, a continuation line shallower than the canonical
 * continuation-indent length, etc. — see each of the four leaf modules'
 * own top doc comments for their own exhaustive per-builder reasons). A
 * caller MUST fall back to treating the child as navigation-only, no edit
 * affordance — this function never mutates anything, so that fallback is
 * always safe, mirroring every projection module in this codebase's
 * identical contract.
 */
export type ChildLeafProjectionBuildReason = "not-projectable";

export type ChildLeafProjectionBuildResult =
  | { ok: true; projection: ChildLeafProjection }
  | { ok: false; reason: ChildLeafProjectionBuildReason };

/**
 * Build a ChildLeafProjection from a LEAF list item's own full raw text
 * (one line, or a first line plus continuation/blank lines — exactly what
 * `doc.lines.slice(node.range.startLine, node.range.endLine + 1).join("\n")`
 * already returns for such an item). Multi-line text (2+ lines) is handed
 * to edit/multiLineListItemProjection.ts's own
 * buildMultiLineListItemProjection unchanged; single-line text tries
 * edit/listMarkerProjection.ts, then (on its own "task-list-marker"
 * refusal) edit/taskListProjection.ts, then (on its own "ordered-marker"
 * refusal) edit/orderedListProjection.ts — the SAME fixed priority order
 * edit/parentListItemProjection.ts's own buildSingleLineParentFirstLineSlot
 * already uses for a parent's own single-line own-text, kept here as this
 * module's own independent copy of that same dispatch (never imported —
 * this family's own "each projection module keeps its own copy of logic
 * it structurally shares with a sibling" convention; see
 * edit/parentListItemProjection.ts's own top doc comment).
 */
export function buildChildLeafProjection(rawText: string): ChildLeafProjectionBuildResult {
  const lineCount = rawText.split("\n").length;
  if (lineCount >= 2) {
    const built = buildMultiLineListItemProjection(rawText);
    if (!built.ok) {
      return { ok: false, reason: "not-projectable" };
    }
    return { ok: true, projection: { kind: "multiLine", projection: built.projection } };
  }
  const listBuilt = buildListMarkerProjection(rawText);
  if (listBuilt.ok) {
    return { ok: true, projection: { kind: "unordered", projection: listBuilt.projection } };
  }
  if (listBuilt.reason === "task-list-marker") {
    const taskBuilt = buildTaskListProjection(rawText);
    if (taskBuilt.ok) {
      return { ok: true, projection: { kind: "task", projection: taskBuilt.projection } };
    }
  } else if (listBuilt.reason === "ordered-marker") {
    const orderedBuilt = buildOrderedListProjection(rawText);
    if (orderedBuilt.ok) {
      return { ok: true, projection: { kind: "ordered", projection: orderedBuilt.projection } };
    }
  }
  return { ok: false, reason: "not-projectable" };
}

/** The child's own ORIGINAL raw text a built projection round-trips from — mirrors every sibling projection's own `rawLine`/`rawText` field, unified across the four kinds this dispatch can produce. */
export function childProjectionRawText(projection: ChildLeafProjection): string {
  return projection.kind === "multiLine" ? projection.projection.rawText : projection.projection.rawLine;
}

/** The child inline editor's shared textarea display value — dispatches to whichever of the four leaf modules' own `projected*BodyText` accessor matches `projection.kind`. */
export function projectedChildBodyText(projection: ChildLeafProjection): string {
  switch (projection.kind) {
    case "unordered":
      return projectedListBodyText(projection.projection);
    case "task":
      return projectedTaskBodyText(projection.projection);
    case "ordered":
      return projectedOrderedBodyText(projection.projection);
    case "multiLine":
      return projectedMultiLineBodyText(projection.projection);
  }
}

/** The child inline editor's checkbox control's own `.checked` value — `false` for every non-task-effective kind, mirroring projectedParentChecked/projectedMultiLineChecked's own "always-readable default" contract. */
export function projectedChildChecked(projection: ChildLeafProjection): boolean {
  if (projection.kind === "task") return projectedTaskChecked(projection.projection);
  if (projection.kind === "multiLine") return projectedMultiLineChecked(projection.projection);
  return false;
}

/** The child inline editor's number control's own display value — `""` for every non-ordered-effective kind, mirroring projectedParentNumberText/projectedMultiLineNumberText's own identical contract. */
export function projectedChildNumberText(projection: ChildLeafProjection): string {
  if (projection.kind === "ordered") return projectedOrderedNumberText(projection.projection);
  if (projection.kind === "multiLine") return projectedMultiLineNumberText(projection.projection);
  return "";
}

/** Which of the three CONTROL kinds (unordered/task/ordered) the child inline editor should show, regardless of whether the underlying projection is single-line or `multiLine` — mirrors MultiLineListItemProjection's own `listKind` field for the same reason. */
export function childEffectiveControlKind(projection: ChildLeafProjection): "unordered" | "task" | "ordered" {
  return projection.kind === "multiLine" ? projection.projection.listKind : projection.kind;
}

/** "invalid-number" mirrors every ordered-capable leaf module's own identical refusal. "unsafe-structure" folds together every other per-kind refusal (a newline in a single-line body, or a multi-line candidate that would manufacture a nested child/ComplexBlock — see edit/multiLineListItemProjection.ts's own validateMultiLineListItemCandidate) — a caller must reject Apply outright and preserve the child's draft exactly as the user had it, the same contract every sibling projection's own Apply-time refusal already carries. */
export type ChildLeafInvertReason = "invalid-number" | "unsafe-structure";

export type ChildLeafInvertResult =
  | { ok: true; rawText: string }
  | { ok: false; reason: ChildLeafInvertReason };

/** Reconstruct the child's own raw text from `projection` (the ORIGINAL, session-build-time split) and the child inline editor's CURRENT checkbox/number/body control values — pure dispatch to whichever of the four leaf modules' own invert function matches `projection.kind`, completely unmodified. */
export function invertChildLeafProjection(
  projection: ChildLeafProjection,
  editedChecked: boolean,
  editedNumberText: string,
  editedBody: string
): ChildLeafInvertResult {
  switch (projection.kind) {
    case "unordered": {
      const inverted = invertListMarkerProjection(projection.projection, editedBody);
      if (!inverted.ok) return { ok: false, reason: "unsafe-structure" };
      return { ok: true, rawText: inverted.rawLine };
    }
    case "task": {
      const inverted = invertTaskListProjection(projection.projection, editedChecked, editedBody);
      if (!inverted.ok) return { ok: false, reason: "unsafe-structure" };
      return { ok: true, rawText: inverted.rawLine };
    }
    case "ordered": {
      const inverted = invertOrderedListProjection(projection.projection, editedNumberText, editedBody);
      if (!inverted.ok) {
        return { ok: false, reason: inverted.reason === "invalid-number" ? "invalid-number" : "unsafe-structure" };
      }
      return { ok: true, rawText: inverted.rawLine };
    }
    case "multiLine": {
      const inverted = invertMultiLineListItemProjection(
        projection.projection,
        editedChecked,
        editedNumberText,
        editedBody
      );
      if (!inverted.ok) {
        return { ok: false, reason: inverted.reason === "invalid-number" ? "invalid-number" : "unsafe-structure" };
      }
      return { ok: true, rawText: inverted.rawText };
    }
  }
}

// ---------------------------------------------------------------------
// Eligibility: is a given direct child safe to offer inline editing for
// at all?
// ---------------------------------------------------------------------

/**
 * Every way a candidate direct child is refused inline-edit eligibility —
 * a caller (view/PartialEditView.ts's own renderParentChildPreview) MUST
 * treat every one of these identically: no edit affordance on that row,
 * plain Phase 5L-7 navigation-only preview row, never a hard error:
 *
 *   - "child-not-found"/"not-direct-child": defensive only in the common
 *     case (every id this is ever called with comes from
 *     `parentNode.childIds` or a freshly re-resolved child id), but
 *     genuinely reachable once re-verified against a LATER re-parse (see
 *     buildParentChildInlineEditSession's own doc comment) — the id no
 *     longer resolves, or resolves to a node that is no longer this
 *     parent's own direct child at all.
 *   - "child-has-children": the child itself owns one or more nested
 *     grandchildren (`childIds.length > 0`) — this whole ticket's own
 *     defining "direct child ONLY, never grandchild-and-deeper" scope
 *     boundary (see this module's own top doc comment).
 *   - "child-unsafe-indent": mirrors every sibling eligibility gate in
 *     this codebase's own identical mixed-tab/space defensive check.
 *   - "child-complex-block": a callout/blockquote/fenced-code/table/
 *     thematic-break block overlaps the child's own continuation lines —
 *     edit/standaloneMultiLineListItemProjection.ts's own
 *     hasComplexBlockInMultiLineListItemContinuation, reused verbatim (see
 *     this module's own top doc comment).
 *   - "child-not-projectable": buildChildLeafProjection itself refused the
 *     child's own raw text (an unsupported task-checkbox status character,
 *     an ordered number this ticket's own scope still requires be
 *     well-formed at BUILD time is not itself checked here — malformed
 *     numbers are an Apply-time-only concern, see invertChildLeafProjection
 *     — but a malformed continuation indent, or any other per-kind build
 *     refusal, is).
 */
export type ChildInlineEditEligibilityReason =
  | "child-not-found"
  | "not-direct-child"
  | "child-has-children"
  | "child-unsafe-indent"
  | "child-complex-block"
  | "child-not-projectable";

export type ChildInlineEditEligibilityResult =
  | { ok: true; childNode: ListBlockNode; projection: ChildLeafProjection }
  | { ok: false; reason: ChildInlineEditEligibilityReason };

/**
 * The ONE eligibility check both view/PartialEditView.ts's own per-row
 * "show an edit affordance at all" decision AND
 * buildParentChildInlineEditSession below ever run — never two
 * independently-drifting copies. Deliberately takes `parentNode.id`
 * (never a full ParentListItemProjection) so a cheap per-row check does
 * not need a rebuilt projection just to ask "is this ONE child eligible".
 */
export function evaluateChildInlineEditEligibility(
  doc: ParsedDocument,
  parentNode: ListBlockNode,
  childNodeId: string
): ChildInlineEditEligibilityResult {
  const childNode = doc.nodes.get(childNodeId);
  if (!childNode || !isListNode(childNode)) {
    return { ok: false, reason: "child-not-found" };
  }
  if (childNode.parentId !== parentNode.id) {
    return { ok: false, reason: "not-direct-child" };
  }
  if (childNode.childIds.length !== 0) {
    return { ok: false, reason: "child-has-children" };
  }
  if (childNode.unsafeIndent) {
    return { ok: false, reason: "child-unsafe-indent" };
  }
  if (hasComplexBlockInMultiLineListItemContinuation(doc, childNode)) {
    return { ok: false, reason: "child-complex-block" };
  }
  const rawText = doc.lines.slice(childNode.range.startLine, childNode.range.endLine + 1).join("\n");
  const built = buildChildLeafProjection(rawText);
  if (!built.ok) {
    return { ok: false, reason: "child-not-projectable" };
  }
  return { ok: true, childNode, projection: built.projection };
}

/** Pure `parentId` check — the direct-child relationship test every other function in this module already folds into its own gating, exposed standalone (per this ticket's own design doc §6) for direct, independent testing. */
export function isDirectChildOf(doc: ParsedDocument, parentNodeId: string, childNodeId: string): boolean {
  const childNode = doc.nodes.get(childNodeId);
  return !!childNode && isListNode(childNode) && childNode.parentId === parentNodeId;
}

/**
 * A leaf child's own "own-text range" and "subtree range" (see this
 * ticket's own design doc §6) — for THIS phase (grandchild-and-deeper
 * editing is out of scope — see this module's own top doc comment), the
 * two are always identical: the child's own `node.range`. Kept as two
 * distinct fields (never collapsed into one) purely so a future phase that
 * widens inline editing to a child WITH its own grandchildren can extend
 * `subtreeRange` alone without reshaping this type.
 */
export interface ChildOwnTextRangeResolution {
  ownTextRange: LineRange;
  subtreeRange: LineRange;
}

export function resolveChildOwnTextRange(childNode: ListBlockNode): ChildOwnTextRangeResolution {
  return { ownTextRange: childNode.range, subtreeRange: childNode.range };
}

/**
 * True only when `childRange` sits entirely AFTER `parentOwnTextRange` and
 * entirely INSIDE `childSubtreeRange` — the parent-child non-overlap
 * assertion this ticket's own design doc §6 calls for, exposed as its own
 * small, independently-testable function rather than inlined at each call
 * site (buildParentChildInlineEditSession, applyParentChildInlineEditToDocument).
 */
export function isChildRangeWithinParentChildSubtree(
  parentOwnTextRange: LineRange,
  childSubtreeRange: LineRange,
  childRange: LineRange
): boolean {
  return (
    childRange.startLine > parentOwnTextRange.endLine &&
    childRange.startLine >= childSubtreeRange.startLine &&
    childRange.endLine <= childSubtreeRange.endLine
  );
}

// ---------------------------------------------------------------------
// The session: everything captured once, at "open this child's inline
// editor" time, that both the child inline editor's own controls and the
// eventual combined Apply need.
// ---------------------------------------------------------------------

/** One OTHER direct child's own raw text, captured verbatim at session-build time — never re-derived, never compared against anything but a later candidate's own resolved range for the identical sibling position (see invertAndValidateParentChildCombinedEdit's own "sibling-changed" check). */
export interface ChildSiblingSnapshot {
  nodeId: string;
  rawText: string;
}

/**
 * Everything a parent+selected-child inline edit session needs, captured
 * once when the child's inline editor is opened (never recomputed
 * mid-session — exactly like `ParentListItemProjection` itself is only
 * ever rebuilt on a fresh load/reload/post-Apply cycle, never on every
 * keystroke).
 */
export interface ParentChildInlineEditSession {
  parentNodeId: string;
  childNodeId: string;
  childProjection: ChildLeafProjection;
  /** The child's own ORIGINAL raw text at session-build time — the "before editing" snapshot both the child inline editor's own dirty-check and the Apply-time conflict check (applyParentChildInlineEditToDocument) compare against. */
  originalChildRawText: string;
  /** The child's own range at session-build time, shifted to be relative to `ParentListItemProjection#childSubtreeRange.startLine` — i.e. `childSubtreeText.split("\n")[childRelativeRange.startLine]` is this child's own first line. Used only to splice an edited child candidate into `childSubtreeText` for the combined-candidate safety net below; never used to write to the LIVE document (applyParentChildInlineEditToDocument re-resolves the child's own range fresh instead). */
  childRelativeRange: LineRange;
  /** `parentNode.childIds.length` at session-build time — the count invertAndValidateParentChildCombinedEdit's own final candidate re-parse must still match. */
  expectedChildCount: number;
  /** This child's own index within `parentNode.childIds` at session-build time. */
  selectedChildIndex: number;
  /** Every OTHER direct child's own raw text, in original `childIds` order (the target child's own position simply omitted) — see ChildSiblingSnapshot's own doc comment. */
  otherChildrenSnapshots: ChildSiblingSnapshot[];
}

export type ParentChildInlineEditSessionBuildReason = ChildInlineEditEligibilityReason;

export type ParentChildInlineEditSessionBuildResult =
  | { ok: true; session: ParentChildInlineEditSession }
  | { ok: false; reason: ParentChildInlineEditSessionBuildReason };

/**
 * Build a ParentChildInlineEditSession for `childNodeId`, a candidate
 * direct child of `parentNode` — the ONE entry point
 * view/PartialEditView.ts's own "open this child's inline editor" handler
 * ever calls. Re-runs evaluateChildInlineEditEligibility fresh (never
 * trusts a caller-side "I already checked this row is eligible" claim —
 * this codebase's standing "never guess, always verify" convention), then
 * captures every OTHER direct child's own raw text as this session's own
 * sibling-preservation baseline.
 */
export function buildParentChildInlineEditSession(
  doc: ParsedDocument,
  parentNode: ListBlockNode,
  parentProjection: ParentListItemProjection,
  childNodeId: string
): ParentChildInlineEditSessionBuildResult {
  const evaluated = evaluateChildInlineEditEligibility(doc, parentNode, childNodeId);
  if (!evaluated.ok) {
    return { ok: false, reason: evaluated.reason };
  }
  const { childNode, projection } = evaluated;
  const selectedChildIndex = parentNode.childIds.indexOf(childNodeId);
  if (selectedChildIndex === -1) {
    // Defensive only — evaluateChildInlineEditEligibility's own
    // "not-direct-child" check (childNode.parentId === parentNode.id)
    // already guarantees membership in parentNode.childIds.
    return { ok: false, reason: "not-direct-child" };
  }

  const otherChildrenSnapshots: ChildSiblingSnapshot[] = [];
  for (const siblingId of parentNode.childIds) {
    if (siblingId === childNodeId) continue;
    const siblingNode = doc.nodes.get(siblingId);
    if (!siblingNode || !isListNode(siblingNode)) {
      // Defensive only — every id in parentNode.childIds always resolves
      // to a real list node in the SAME parse `doc` came from.
      return { ok: false, reason: "child-not-found" };
    }
    otherChildrenSnapshots.push({
      nodeId: siblingId,
      rawText: doc.lines.slice(siblingNode.range.startLine, siblingNode.range.endLine + 1).join("\n"),
    });
  }

  const originalChildRawText = doc.lines.slice(childNode.range.startLine, childNode.range.endLine + 1).join("\n");
  const childRelativeRange: LineRange = {
    startLine: childNode.range.startLine - parentProjection.childSubtreeRange.startLine,
    endLine: childNode.range.endLine - parentProjection.childSubtreeRange.startLine,
  };

  return {
    ok: true,
    session: {
      parentNodeId: parentNode.id,
      childNodeId,
      childProjection: projection,
      originalChildRawText,
      childRelativeRange,
      expectedChildCount: parentNode.childIds.length,
      selectedChildIndex,
      otherChildrenSnapshots,
    },
  };
}

// ---------------------------------------------------------------------
// Combined invert + candidate validation — this module's own additional
// safety net (see this module's own top doc comment).
// ---------------------------------------------------------------------

/**
 * Every way the combined parent+child candidate is refused — an
 * APPLY-TIME-ONLY refusal, never conflated with the (earlier, load-time)
 * ChildInlineEditEligibilityReason family above. A caller must reject
 * Apply outright and preserve EVERY draft field on BOTH the parent's own
 * controls and the child's own controls exactly as the user had them —
 * the same contract edit/parentListItemProjection.ts's own
 * ParentListItemApplyRejectReason already carries, extended to cover the
 * child side too:
 *
 *   - "parent-invalid-number"/"parent-own-text-unsafe-structure"/
 *     "parent-child-subtree-detached"/"parent-child-subtree-changed":
 *     invertParentListItemProjection's own four reasons, propagated
 *     verbatim (reused, not re-derived — see this module's own top doc
 *     comment).
 *   - "child-invalid-number"/"child-unsafe-structure": whichever leaf
 *     invert function built the child's candidate refused it — see
 *     invertChildLeafProjection's own doc comment.
 *   - "candidate-structure-invalid": the combined parent+child-subtree
 *     candidate, re-parsed as one mini-document, no longer resolves to a
 *     single list item at line 0 of the expected kind spanning the whole
 *     candidate — mirrors invertParentListItemProjection's own
 *     "child-subtree-detached" check, just re-run against the (possibly
 *     child-edited) combined candidate instead of the original snapshot.
 *   - "child-count-changed": the candidate's own direct-child count no
 *     longer matches `session.expectedChildCount` — this phase never adds
 *     or removes a child, so ANY edit (parent OR child) that would change
 *     this count is refused outright.
 *   - "child-no-longer-leaf": the target child, at its own captured index,
 *     no longer resolves to a leaf (`childIds.length === 0`) in the
 *     candidate — an edited child body that would itself manufacture a
 *     nested grandchild list item (this SHOULD already be unreachable,
 *     since invertChildLeafProjection's own multi-line path already
 *     refuses that in isolation via validateMultiLineListItemCandidate —
 *     kept and checked anyway, per this codebase's standing "never guess,
 *     always verify" convention).
 *   - "sibling-changed": some OTHER direct child's own raw text, sliced
 *     from the candidate at that same sibling POSITION, no longer matches
 *     `session.otherChildrenSnapshots`'s own captured raw text
 *     byte-for-byte — the "no sibling leakage" guarantee this ticket's
 *     own §3 requires.
 */
export type ParentChildCombinedApplyRejectReason =
  | "parent-invalid-number"
  | "parent-own-text-unsafe-structure"
  | "parent-child-subtree-detached"
  | "parent-child-subtree-changed"
  | "child-invalid-number"
  | "child-unsafe-structure"
  | "candidate-structure-invalid"
  | "child-count-changed"
  | "child-no-longer-leaf"
  | "sibling-changed";

export interface InvertParentChildCombinedEditInput {
  parentProjection: ParentListItemProjection;
  session: ParentChildInlineEditSession;
  /** Whether the PARENT's own controls currently differ from their loaded snapshot — when false, the parent's own-text candidate is `parentProjection.ownText.rawText` verbatim (the edited* fields below are then ignored for the parent side). */
  parentDirty: boolean;
  /** Whether the CHILD's own controls currently differ from `session`'s own loaded snapshot — when false, the child's own candidate is `session.originalChildRawText` verbatim (the editedChild* fields below are then ignored). */
  childDirty: boolean;
  editedParentChecked: boolean;
  editedParentNumberText: string;
  editedParentBody: string;
  editedChildChecked: boolean;
  editedChildNumberText: string;
  editedChildBody: string;
}

export type InvertParentChildCombinedEditResult =
  | { ok: true; parentOwnTextRawText: string; childRawText: string }
  | { ok: false; reason: ParentChildCombinedApplyRejectReason };

/**
 * Reconstruct BOTH candidates (parent own-text, child own-text) from their
 * respective ORIGINAL, session-time snapshots plus whichever controls are
 * currently dirty, and run this module's own combined-candidate safety net
 * — see this module's own top doc comment's "The one NEW risk" section.
 * Operates entirely on SNAPSHOTS (never the live document — that is
 * applyParentChildInlineEditToDocument's own job, run only AFTER this
 * function returns `ok: true`).
 */
export function invertAndValidateParentChildCombinedEdit(
  input: InvertParentChildCombinedEditInput
): InvertParentChildCombinedEditResult {
  const { parentProjection, session } = input;

  let parentOwnTextRawText = parentProjection.ownText.rawText;
  if (input.parentDirty) {
    const inverted = invertParentListItemProjection(
      parentProjection,
      input.editedParentChecked,
      input.editedParentNumberText,
      input.editedParentBody
    );
    if (!inverted.ok) {
      const reason: ParentChildCombinedApplyRejectReason =
        inverted.reason === "invalid-number"
          ? "parent-invalid-number"
          : inverted.reason === "own-text-unsafe-structure"
            ? "parent-own-text-unsafe-structure"
            : inverted.reason === "child-subtree-detached"
              ? "parent-child-subtree-detached"
              : "parent-child-subtree-changed";
      return { ok: false, reason };
    }
    parentOwnTextRawText = inverted.ownTextRawText;
  }

  let childCandidateRawText = session.originalChildRawText;
  if (input.childDirty) {
    const inverted = invertChildLeafProjection(
      session.childProjection,
      input.editedChildChecked,
      input.editedChildNumberText,
      input.editedChildBody
    );
    if (!inverted.ok) {
      return {
        ok: false,
        reason: inverted.reason === "invalid-number" ? "child-invalid-number" : "child-unsafe-structure",
      };
    }
    childCandidateRawText = inverted.rawText;
  }

  // This module's own additional safety net: splice the (possibly edited)
  // child candidate into the ORIGINAL child-subtree snapshot at the
  // target's own captured relative position — every other line (sibling
  // children, and any boundary blank lines between them) stays exactly as
  // it was, verbatim — then splice that behind the (possibly edited)
  // parent own-text candidate and re-parse the WHOLE thing as one
  // throwaway mini-document.
  const childSubtreeLines = parentProjection.childSubtreeText.split("\n");
  const newChildSubtreeLines = [
    ...childSubtreeLines.slice(0, session.childRelativeRange.startLine),
    ...childCandidateRawText.split("\n"),
    ...childSubtreeLines.slice(session.childRelativeRange.endLine + 1),
  ];
  const childSubtreeCandidateText = newChildSubtreeLines.join("\n");
  const fullCandidateText = parentOwnTextRawText + "\n" + childSubtreeCandidateText;
  const fullCandidateLines = fullCandidateText.split("\n");
  const candidateDoc = parseDocument(fullCandidateText);
  const candidateNode = candidateDoc.nodes.get("li-0");
  if (
    !candidateNode ||
    !isListNode(candidateNode) ||
    candidateNode.range.startLine !== 0 ||
    candidateNode.ordered !== (parentProjection.ownText.listKind === "ordered") ||
    candidateNode.unsafeIndent ||
    candidateNode.range.endLine !== fullCandidateLines.length - 1
  ) {
    return { ok: false, reason: "candidate-structure-invalid" };
  }
  if (candidateNode.childIds.length !== session.expectedChildCount) {
    return { ok: false, reason: "child-count-changed" };
  }
  for (let i = 0; i < candidateNode.childIds.length; i++) {
    const candidateChildId = candidateNode.childIds[i];
    const candidateChildNode = candidateDoc.nodes.get(candidateChildId);
    if (!candidateChildNode || !isListNode(candidateChildNode)) {
      return { ok: false, reason: "candidate-structure-invalid" };
    }
    if (i === session.selectedChildIndex) {
      if (candidateChildNode.childIds.length !== 0 || candidateChildNode.unsafeIndent) {
        return { ok: false, reason: "child-no-longer-leaf" };
      }
      continue;
    }
    const siblingSnapshotIndex = i < session.selectedChildIndex ? i : i - 1;
    const siblingSnapshot = session.otherChildrenSnapshots[siblingSnapshotIndex];
    const candidateSiblingRawText = fullCandidateLines
      .slice(candidateChildNode.range.startLine, candidateChildNode.range.endLine + 1)
      .join("\n");
    if (!siblingSnapshot || candidateSiblingRawText !== siblingSnapshot.rawText) {
      return { ok: false, reason: "sibling-changed" };
    }
  }

  return { ok: true, parentOwnTextRawText, childRawText: childCandidateRawText };
}

// ---------------------------------------------------------------------
// Apply-time write-back: two ranges, one atomic splice, per-range conflict
// check.
// ---------------------------------------------------------------------

/**
 * Every way the LIVE-document write is refused — always a SAFE REFUSAL
 * (`doc.lines` returned completely untouched), never a partial write:
 *
 *   - "parent-resolve-failed": the parent id no longer resolves to a list
 *     node, is now `unsafeIndent`, or resolveParentListItemOwnTextRange
 *     itself now refuses it (own-text/child-subtree can no longer be
 *     safely separated at all).
 *   - "child-resolve-failed"/"not-direct-child"/"child-has-children"/
 *     "child-unsafe-indent": the child id no longer resolves to a list
 *     node, is no longer this parent's own DIRECT child, now owns its own
 *     grandchild, or is now mixed-tab/space indented — re-verified fresh
 *     against the CURRENT document, exactly like every other structural
 *     check in this module.
 *   - "range-overlap": the freshly re-resolved child range no longer sits
 *     entirely inside the freshly re-resolved parent child-subtree range,
 *     after the parent's own-text range — defensive only in practice (the
 *     four checks immediately above should already exclude every way this
 *     could happen), kept per this codebase's "never guess, always verify"
 *     convention.
 *   - "parent-conflict": `parentDirty` is true AND the CURRENT document's
 *     own parent own-text range no longer matches
 *     `originalParentOwnTextRaw` byte-for-byte — an external edit to the
 *     parent's own text since this session was last (re)built. Never
 *     checked when `parentDirty` is false (mirrors
 *     applyParentListItemOwnTextEdit's own "a range this Apply never
 *     writes can never block it" principle).
 *   - "child-conflict": the same check, for the child's own range, gated
 *     on `childDirty` the same way.
 */
export type ParentChildLiveApplyRejectReason =
  | "parent-resolve-failed"
  | "child-resolve-failed"
  | "not-direct-child"
  | "child-has-children"
  | "child-unsafe-indent"
  | "range-overlap"
  | "parent-conflict"
  | "child-conflict";

export interface ApplyParentChildInlineEditOutcome {
  changed: boolean;
  lines: string[];
  /** New start line of the (possibly unchanged) parent own-text range — valid whenever `changed` is true. */
  parentNewStartLine: number;
  /** New start line of the (possibly unchanged) child's own range — valid whenever `changed` is true. */
  childNewStartLine: number;
  reason?: ParentChildLiveApplyRejectReason;
}

/**
 * Replace the parent's own-text range and/or the selected child's own
 * range — WHICHEVER of the two `parentDirty`/`childDirty` marks as
 * actually edited — against the CURRENT `doc` (a fresh parse of the note
 * as it stands right now), in exactly ONE atomic `lines` array
 * construction. `newParentOwnTextRaw`/`newChildOwnTextRaw` should be
 * `invertAndValidateParentChildCombinedEdit`'s own
 * `parentOwnTextRawText`/`childRawText` output — this function never
 * re-validates candidate STRUCTURE itself (that already happened, against
 * snapshots, before this was ever called); it only re-resolves fresh
 * POSITIONS, re-checks for an external CONFLICT on whichever range is
 * dirty, and performs the actual splice.
 *
 * A range that is NOT dirty is spliced back with whatever the LIVE
 * document CURRENTLY holds there (never `originalParentOwnTextRaw`/
 * `originalChildOwnTextRaw`, and never the corresponding `new*Raw`
 * argument either) — this is what guarantees a clean range is a true
 * byte-for-byte no-op regardless of what it presently contains, and can
 * never clobber an unrelated external edit to a range this Apply was
 * never asked to touch.
 */
export function applyParentChildInlineEditToDocument(
  doc: ParsedDocument,
  parentNodeId: string,
  childNodeId: string,
  parentDirty: boolean,
  childDirty: boolean,
  originalParentOwnTextRaw: string,
  originalChildOwnTextRaw: string,
  newParentOwnTextRaw: string,
  newChildOwnTextRaw: string
): ApplyParentChildInlineEditOutcome {
  const fail = (reason: ParentChildLiveApplyRejectReason): ApplyParentChildInlineEditOutcome => ({
    changed: false,
    lines: doc.lines,
    parentNewStartLine: -1,
    childNewStartLine: -1,
    reason,
  });

  const parentNode = doc.nodes.get(parentNodeId);
  if (!parentNode || !isListNode(parentNode) || parentNode.unsafeIndent) {
    return fail("parent-resolve-failed");
  }
  const resolvedParent = resolveParentListItemOwnTextRange(doc, parentNode);
  if (!resolvedParent.ok) {
    return fail("parent-resolve-failed");
  }
  const { ownTextRange: parentOwnTextRange, childSubtreeRange } = resolvedParent.resolution;

  const childNode = doc.nodes.get(childNodeId);
  if (!childNode || !isListNode(childNode)) {
    return fail("child-resolve-failed");
  }
  if (childNode.parentId !== parentNode.id) {
    return fail("not-direct-child");
  }
  if (childNode.childIds.length !== 0) {
    return fail("child-has-children");
  }
  if (childNode.unsafeIndent) {
    return fail("child-unsafe-indent");
  }
  const childRange = childNode.range;
  if (!isChildRangeWithinParentChildSubtree(parentOwnTextRange, childSubtreeRange, childRange)) {
    return fail("range-overlap");
  }

  if (parentDirty) {
    const currentParentOwnText = doc.lines
      .slice(parentOwnTextRange.startLine, parentOwnTextRange.endLine + 1)
      .join("\n");
    if (currentParentOwnText !== originalParentOwnTextRaw) {
      return fail("parent-conflict");
    }
  }
  if (childDirty) {
    const currentChildRaw = doc.lines.slice(childRange.startLine, childRange.endLine + 1).join("\n");
    if (currentChildRaw !== originalChildOwnTextRaw) {
      return fail("child-conflict");
    }
  }

  if (!parentDirty && !childDirty) {
    // Defensive only — a caller should never invoke this with nothing to
    // write; kept total and safe (a true no-op) regardless.
    return { changed: false, lines: doc.lines, parentNewStartLine: -1, childNewStartLine: -1 };
  }

  const parentReplacementLines = parentDirty
    ? newParentOwnTextRaw.split("\n")
    : doc.lines.slice(parentOwnTextRange.startLine, parentOwnTextRange.endLine + 1);
  const childReplacementLines = childDirty
    ? newChildOwnTextRaw.split("\n")
    : doc.lines.slice(childRange.startLine, childRange.endLine + 1);

  const lines = [
    ...doc.lines.slice(0, parentOwnTextRange.startLine),
    ...parentReplacementLines,
    ...doc.lines.slice(parentOwnTextRange.endLine + 1, childRange.startLine),
    ...childReplacementLines,
    ...doc.lines.slice(childRange.endLine + 1),
  ];
  const childNewStartLine =
    parentOwnTextRange.startLine +
    parentReplacementLines.length +
    (childRange.startLine - parentOwnTextRange.endLine - 1);

  return {
    changed: true,
    lines,
    parentNewStartLine: parentOwnTextRange.startLine,
    childNewStartLine,
  };
}

// =======================================================================
// Phase 5L-9 ("Direct Child Add/Delete in Parent Partial Edit Pane"):
// appends exactly ONE new canonical direct-child leaf at the end of the
// parent's own child subtree, and/or marks exactly ONE existing direct
// child leaf for deletion — both saved together with the parent's own-text
// draft and/or the Phase 5L-8 single-selected-child draft in ONE combined,
// atomic Apply. See docs/phase5l9_parent-child-add-delete.md for the full
// design record; this section's own doc comments carry the parts a reader
// needs locally.
//
// ---- Scope: Mode A only (a node that ALREADY owns ≥1 direct child) ----
//
// This whole section only ever operates on a node for which
// buildParentListItemProjection already succeeded — i.e. exactly the
// population Phase 5L-6 already established as "parent" (`node.childIds
// .length > 0` at the moment the Partial Edit Pane loaded/last reloaded
// this projection). A plain leaf item that currently owns ZERO children
// is edited through the entirely separate standalone single-line/
// multi-line leaf panes (edit/standaloneListMarkerProjection.ts and its
// three siblings) — this ticket's own approved scope deliberately does
// NOT extend THAT population to also offer a "become a parent by adding
// a first child" affordance: doing so would require either (a) widening
// resolveParentListItemOwnTextRange's own "no-children" refusal (relied
// on, unchanged, by Phase 5L-6/5L-7/5L-8's own already-verified
// eligibility gates and tests) to ALSO accept a zero-child leaf, which
// would silently change which of the FIVE mutually-exclusive projection
// fields loadNodeInternal assigns for every ordinary leaf list item in
// the vault (isStandaloneParentListItemEligibleForProjection's own
// `childIds.length === 0` exclusion is exactly what keeps those two
// populations disjoint today), or (b) duplicating this module's own
// combined-Apply machinery FOUR separate times, once per existing
// standalone leaf kind's own independent Apply call site in
// view/PartialEditView.ts. Both carry meaningfully higher regression risk
// to the already real-device-verified 5L-1〜5L-8 surface than this
// ticket's own §5-§9 atomicity/safety emphasis would justify guessing at
// without explicit user sign-off — see this ticket's own design doc for
// the full record of this scoping decision and how a future phase could
// revisit it. Concretely: every function below either takes a
// `ParentListItemProjection` (which only ever exists for a childIds > 0
// node) or a `ParentChildAddDeleteSession` built from one.
//
// A parent that starts Mode A-eligible (≥1 child at load time) but whose
// user-pending deletions (see PendingChildDeletion below) bring the
// IN-SESSION count to zero before Apply remains fully supported — the
// candidate reconstruction below (invertAndValidateParentChildAddDeleteEdit)
// treats an empty resulting child-subtree exactly like
// edit/parentListItemProjection.ts's own sibling functions already treat
// a genuinely-empty one, never emitting a spurious trailing blank line.
//
// ---- Reuse, never re-implementation ----
//
// The new child's own canonical raw Markdown is built via
// edit/listMarkerProjection.ts's own buildListMarkerProjection — the exact
// module this whole family already uses for an unordered, non-task leaf's
// own marker/body split — never a hand-formatted marker string.
// Reconstructing the new child's own edited body (once its inline editor
// is opened) reuses THIS module's own invertChildLeafProjection dispatch
// (unmodified — the new child is always `kind: "unordered"`, so this is
// simply invertListMarkerProjection under a stable, already-existing
// name). The parent's own-text candidate reuses
// edit/parentListItemProjection.ts's own invertParentListItemProjection,
// completely unmodified. An existing selected child's own candidate
// reuses THIS module's own invertChildLeafProjection, completely
// unmodified. Nothing in this section re-implements marker/checkbox/
// number/continuation-indentation splitting, or a second complex-block
// scanner.
//
// ---- The write primitive: a new function, not a literal signature reuse
// — see this rationale before assuming otherwise ----
//
// Phase 5L-8's own applyParentChildInlineEditToDocument (above) is a
// FIXED-arity, exactly-two-range primitive (`parentNodeId`/`childNodeId`
// are the only two ranges it ever knows how to splice). Phase 5L-9's own
// combined plan is variable-length (the parent's own-text range is always
// present; an existing-child-edit range, a deletion range, and a new-child
// insertion point are each independently OPTIONAL — see §6/§7 of this
// ticket's own design doc). A fixed two-argument function signature cannot
// express that without already being some other shape, so
// applyParentChildAddDeleteToDocument below is a NEW function — but it
// reuses every one of applyParentChildInlineEditToDocument's own
// techniques UNCHANGED: resolveParentListItemOwnTextRange for the fresh
// parent re-resolution, isChildRangeWithinParentChildSubtree for the
// range-containment assertion, a per-range dirty-gated conflict check
// (never checked for a range this Apply doesn't touch), and exactly ONE
// atomic `lines` array construction (back-to-front, offset-corrected,
// zero partial writes, complete no-op on any failure) — this is the
// "extend Phase 5L-8's own write primitive" this ticket's own §7 calls
// for, applied at the level of REUSED TECHNIQUE rather than a literal
// shared function body, since the two primitives' own arities are
// genuinely incompatible.
// =======================================================================

// ---------------------------------------------------------------------
// New-child canonical serialization (§3: fixed shape — unordered,
// non-task, marker "-", empty body, correct indentation — via
// listMarkerProjection.ts's own build/invert, never hand-formatted).
// ---------------------------------------------------------------------

/**
 * The new child's own leading whitespace — mirrors
 * move/indentBlock.ts#buildIndentPrefix's own two-case policy exactly
 * (reused as PATTERN, not by import — that function computes a DELTA to
 * ADD when re-indenting an EXISTING item being moved, a different problem
 * shape from this function's own "compute an absolute indent string for a
 * brand NEW line"):
 *
 *   - `lastChildNode` given (the parent already owns ≥1 direct child):
 *     match that LAST child's own leading whitespace byte-for-byte — the
 *     new child becomes its sibling at the exact same depth, tabs-vs-
 *     spaces style included, per this ticket's own explicit "at the same
 *     depth/indentation as the other direct children" requirement (§3).
 *     Never inferred from the FIRST child or any other sibling — the
 *     LAST child's own subtree is what the new child is appended
 *     immediately after (see resolveNewChildInsertionPoint below), so its
 *     own indent is the one this function trusts.
 *   - `lastChildNode` null (the parent's own child subtree is about to
 *     become empty-then-repopulated by this Add — either a fresh Mode A
 *     session whose only existing child(ren) are ALL pending-deletion, or
 *     — defensively — a genuinely zero-child parent, which this ticket's
 *     own approved scope never actually reaches via the UI, see this
 *     section's own top doc comment): one TAB_WIDTH step past the
 *     PARENT's own indent, tabs-vs-spaces style read from the PARENT's
 *     own line (there is no sibling to match instead) — the same
 *     "targetColumns = prev.indentColumns + TAB_WIDTH" fallback
 *     buildIndentPrefix itself falls back to when its own `prev` has no
 *     children yet.
 */
export function computeNewChildIndent(
  doc: ParsedDocument,
  parentNode: ListBlockNode,
  lastChildNode: ListBlockNode | null
): string {
  if (lastChildNode) {
    return leadingWhitespace(doc.lines[lastChildNode.range.startLine]);
  }
  const parentIndent = leadingWhitespace(doc.lines[parentNode.range.startLine]);
  const useTabs = parentIndent.includes("\t");
  return parentIndent + (useTabs ? "\t" : " ".repeat(TAB_WIDTH));
}

/**
 * The new child's own canonical raw Markdown — `indent + "-"`, a BARE
 * marker with no trailing whitespace and no body at all. Genuinely valid,
 * parseable Markdown on its own (parser/parseDocument.ts's own LIST_RE
 * makes everything after the marker optional), and round-trips
 * byte-for-byte through edit/listMarkerProjection.ts's own
 * invertListMarkerProjection on an untouched Apply (that function's own
 * "empty markerSpacing + still-empty editedBody" branch never synthesizes
 * a space unless the body actually becomes non-empty — see that module's
 * own top doc comment) — this is the "prefer true-empty if it works
 * cleanly" outcome this ticket's own §3 asks be checked for and preferred
 * over a placeholder, and it does: no placeholder text is ever needed or
 * used anywhere in this module.
 */
export function buildCanonicalNewChildRawText(indent: string): string {
  return indent + "-";
}

/**
 * A pending new-child draft — always `kind: "unordered"` (this.
 * projection.projection is a ListMarkerProjection, never task/ordered/
 * multiLine — §3's own fixed-shape requirement, enforced structurally by
 * this being the ONLY way a NewChildDraft is ever constructed). Kept as a
 * full `ChildLeafProjection` (not a bare `ListMarkerProjection`) purely so
 * the child inline editor UI (view/PartialEditView.ts) can reuse the
 * SAME projectedChildBodyText/invertChildLeafProjection dispatch it
 * already uses for an EXISTING child's own inline editor, without a
 * separate code path just for the new-child case.
 */
export interface NewChildDraft {
  projection: ChildLeafProjection;
}

/** Defensive only — buildCanonicalNewChildRawText's own fixed output is always projectable by buildListMarkerProjection (bare marker, unordered, no task-checkbox body); kept as a real, checked reason per this codebase's "never guess, always verify" convention rather than a non-null assertion. */
export type NewChildDraftBuildReason = "not-projectable";

export type NewChildDraftBuildResult =
  | { ok: true; draft: NewChildDraft }
  | { ok: false; reason: NewChildDraftBuildReason };

/**
 * Build a fresh NewChildDraft for `parentNode` — the ONE entry point
 * view/PartialEditView.ts's own "Add child item" button handler ever
 * calls. `doc` must be a FRESH parse of the CURRENT document (never a
 * stale one), mirroring buildParentChildInlineEditSession's own identical
 * "never trust a caller-held doc" convention — the new child's own
 * indentation (computeNewChildIndent) depends on the CURRENT last direct
 * child's own current indentation, not a load-time snapshot.
 */
export function buildNewChildDraft(doc: ParsedDocument, parentNode: ListBlockNode): NewChildDraftBuildResult {
  const lastChildId =
    parentNode.childIds.length > 0 ? parentNode.childIds[parentNode.childIds.length - 1] : null;
  const lastChildNodeRaw = lastChildId ? doc.nodes.get(lastChildId) : undefined;
  const lastChildNode = lastChildNodeRaw && isListNode(lastChildNodeRaw) ? lastChildNodeRaw : null;
  const indent = computeNewChildIndent(doc, parentNode, lastChildNode);
  const rawText = buildCanonicalNewChildRawText(indent);
  const built = buildChildLeafProjection(rawText);
  if (!built.ok) {
    return { ok: false, reason: "not-projectable" };
  }
  return { ok: true, draft: { projection: built.projection } };
}

// ---------------------------------------------------------------------
// Delete eligibility — deliberately an ALIAS of evaluateChildInlineEditEligibility
// (§2's own delete-eligibility list is, one-for-one, the same five
// conditions ChildInlineEditEligibilityReason already models), never a
// second, independently-drifting copy.
// ---------------------------------------------------------------------

/**
 * True/eligible-with-detail exactly when `childNodeId` is eligible for
 * Phase 5L-8's own inline STRUCTURED editing — leaf (`childIds.length ===
 * 0`), a direct child of `parentNode`, not `unsafeIndent`, no ComplexBlock
 * in its own continuation, and its own raw text builds via
 * buildChildLeafProjection. This ticket's own §2 delete-eligibility list
 * mirrors that exact set (see this function's own re-export for the
 * shared rationale) — a caller (view/PartialEditView.ts's own
 * renderParentChildPreview) MUST treat every refusal identically: no
 * delete affordance on that row, exactly like no edit-pencil affordance
 * either.
 */
export function evaluateChildDeleteEligibility(
  doc: ParsedDocument,
  parentNode: ListBlockNode,
  childNodeId: string
): ChildInlineEditEligibilityResult {
  return evaluateChildInlineEditEligibility(doc, parentNode, childNodeId);
}

// ---------------------------------------------------------------------
// Phase 5L-10 ("Direct Child Leaf Reorder in Parent Partial Edit Pane"):
// reorder eligibility is deliberately an ALIAS of
// evaluateChildInlineEditEligibility too (same rationale as
// evaluateChildDeleteEligibility immediately above) — this ticket's own
// §2 eligibility list is, one-for-one, the same conditions
// ChildInlineEditEligibilityReason already models (leaf, direct child,
// not unsafe-indent, no complex-block continuation, projectable). The
// ticket's own additional "CompositeBlock member ではない" condition needs
// no separate check: a CompositeBlock member is never even resolvable as
// a "child" through this whole module — see
// edit/parentListItemProjection.ts's own top doc comment ("No
// CompositeBlock involvement...structurally guaranteed upstream") for how
// that exclusion is already guaranteed before evaluateChildInlineEditEligibility
// is ever reached.
// ---------------------------------------------------------------------

/**
 * True/eligible-with-detail exactly when `childNodeId` is eligible for
 * Phase 5L-8's own inline structured editing — see
 * evaluateChildDeleteEligibility's own doc comment immediately above for
 * why this ticket's own eligibility list is identical, one-for-one, to
 * that one. A caller (view/PartialEditView.ts's own renderParentChildPreview)
 * MUST treat every refusal identically: no up/down reorder affordance on
 * that row, exactly like no edit-pencil/delete-trash affordance either.
 * Note this is necessary but not SUFFICIENT for a row to actually offer a
 * working up/down button — see moveChildInPendingReorder below, which
 * ALSO requires the specific neighbor being swapped with to itself be
 * eligible (never displacing a non-eligible sibling, even as a side
 * effect of swapping past it — see this ticket's own design doc §2/§4 for
 * why crossing a non-eligible sibling is never attempted at all, rather
 * than guessing at how to preserve ITS own position while working around
 * it).
 */
export function evaluateChildReorderEligibility(
  doc: ParsedDocument,
  parentNode: ListBlockNode,
  childNodeId: string
): ChildInlineEditEligibilityResult {
  return evaluateChildInlineEditEligibility(doc, parentNode, childNodeId);
}

/**
 * Phase 5L-10's own scope gate, independent of any ONE child's own
 * eligibility: reorder is offered for a parent's direct children AT ALL
 * only when their combined raw text, as captured in `childSlots` (see
 * ChildSubtreeSlot below), is CONTIGUOUS with the parent's own
 * child-subtree range — i.e. no blank "gap" line sits between one direct
 * child's own last line and the next one's own first line (or before the
 * first child, or after the last child).
 *
 * This module's own combined-candidate reconstruction, once a reorder is
 * pending, rebuilds the ENTIRE child subtree by joining each (possibly
 * reordered) child's own captured raw text with a single "
" — see
 * invertAndValidateParentChildAddDeleteEdit's own reorder branch below.
 * That join is only byte-for-byte faithful to the original document when
 * there was never any "boundary blank line between siblings" to begin
 * with (a real, already-documented case elsewhere in this module — see
 * invertAndValidateParentChildCombinedEdit's own top doc comment's
 * "sibling raw text and everything outside the parent's own subtree...").
 * Rather than guess at which sibling a stray gap line "belongs to" once
 * children start changing position, this ticket's own approved scope
 * simply never offers reorder at all for a parent whose child subtree
 * isn't already gap-free — the read-only preview, inline edit, and
 * add/delete affordances are all completely unaffected either way, this
 * only gates the NEW up/down controls. See docs/phase5l10_parent-child-reorder.md
 * for the full record of this scoping decision and how a future phase
 * could revisit it (e.g. by capturing each child's own trailing gap as
 * part of its own reorderable "unit").
 */
export function isChildSubtreeTightlyPacked(
  childSlots: ChildSubtreeSlot[],
  childSubtreeLineCount: number
): boolean {
  if (childSlots.length === 0) return true;
  if (childSlots[0].relativeRange.startLine !== 0) return false;
  for (let i = 0; i < childSlots.length - 1; i++) {
    if (childSlots[i].relativeRange.endLine + 1 !== childSlots[i + 1].relativeRange.startLine) {
      return false;
    }
  }
  const lastSlot = childSlots[childSlots.length - 1];
  return lastSlot.relativeRange.endLine === childSubtreeLineCount - 1;
}

/**
 * Phase 5L-10: which of the pending reorder plan's own two operations was
 * requested — "up" swaps `childNodeId` with its immediately PRECEDING
 * neighbor in the CURRENT pending order; "down" swaps it with its
 * immediately FOLLOWING neighbor. Never anything more than a single
 * adjacent-pair swap per call — repeated calls are how the UI composes a
 * multi-step reorder (see this ticket's own §3 "内部では「最終的な
 * sibling order」を一つの plan として保持する" requirement — each call
 * mutates the SAME running `currentOrder`, never a fresh one).
 */
export type ChildReorderDirection = "up" | "down";

/**
 * Every way a requested swap is refused — the caller (view/PartialEditView.ts's
 * own up/down button click handler AND its own per-row disabled-state
 * computation, which MUST use the exact same predicate — never a second,
 * independently-drifting "can this row's button be enabled" check) treats
 * every one of these identically: the button for that direction is
 * disabled for that child, and a direct call (defensive only — the UI
 * should never expose an enabled button that would refuse) is a safe
 * no-op, never a partial reorder.
 *
 *   - "not-in-order": `childNodeId` is not present in `currentOrder` at
 *     all — defensive only (every id this is ever called with comes from
 *     a row this session's own `childSlots` produced).
 *   - "not-eligible": `childNodeId` itself is not in `eligibleChildNodeIds`
 *     — mirrors renderParentChildPreview's own "no edit-pencil/delete-
 *     trash affordance" gate for the identical reason (see
 *     evaluateChildReorderEligibility's own doc comment).
 *   - "at-boundary": there is no neighbor in the requested direction at
 *     all (first child's own "up", last child's own "down" — this
 *     ticket's own explicit §3 "先頭 child に「上へ」は出さないか
 *     disabled" / "末尾 child に「下へ」は出さないか disabled"
 *     requirement, interpreted as "first/last AMONG the currently
 *     reorderable arrangement" — see this function's own top doc comment
 *     for why a non-eligible neighbor is never crossed either, which is
 *     the OTHER way a child can have no valid swap in a given direction,
 *     covered by the next reason instead).
 *   - "neighbor-not-eligible": the adjacent slot in the requested
 *     direction exists, but that neighbor itself is not in
 *     `eligibleChildNodeIds` (a grandchild-bearing child-parent item, an
 *     unsafe-indent/unresolved child, or — per this ticket's own §2 — any
 *     other non-eligible direct child) OR is the current pending-deletion
 *     target (passed as `excludedChildNodeId` — a row pending deletion
 *     renders with no reorder affordance either, per this ticket's own
 *     §7/§2 "対象外 row" treatment, so it must never be swapped INTO
 *     either, even though it still occupies a slot in `currentOrder`
 *     until Apply actually removes it). This whole module NEVER moves a
 *     non-eligible sibling, even as an incidental side effect of swapping
 *     an eligible leaf past it — see isChildSubtreeTightlyPacked's own
 *     doc comment for the parallel "never guess at gap ownership" design
 *     choice this mirrors.
 */
export type ChildReorderMoveRejectReason =
  | "not-in-order"
  | "not-eligible"
  | "at-boundary"
  | "neighbor-not-eligible";

export type ChildReorderMoveResult =
  | { ok: true; newOrder: string[] }
  | { ok: false; reason: ChildReorderMoveRejectReason };

/**
 * Compute the new pending order after swapping `childNodeId` with its
 * adjacent neighbor in `direction` — a PURE function over `currentOrder`
 * (never the live document, never `this`-bound state); the caller
 * (view/PartialEditView.ts) is the only place that ever assigns the
 * result back onto `childAddDeleteSession.pendingReorderOrder`. Given the
 * same eligible-id set, the same excluded (pending-deletion) id, and the
 * same current order, this always returns the same result — safe to call
 * repeatedly to determine a row's own up/down disabled state without
 * actually committing anything (the caller simply discards the result
 * when only checking `.ok`).
 */
export function moveChildInPendingReorder(
  currentOrder: string[],
  eligibleChildNodeIds: ReadonlySet<string>,
  excludedChildNodeId: string | null,
  childNodeId: string,
  direction: ChildReorderDirection
): ChildReorderMoveResult {
  const index = currentOrder.indexOf(childNodeId);
  if (index === -1) {
    return { ok: false, reason: "not-in-order" };
  }
  if (!eligibleChildNodeIds.has(childNodeId) || childNodeId === excludedChildNodeId) {
    return { ok: false, reason: "not-eligible" };
  }
  const neighborIndex = direction === "up" ? index - 1 : index + 1;
  if (neighborIndex < 0 || neighborIndex >= currentOrder.length) {
    return { ok: false, reason: "at-boundary" };
  }
  const neighborId = currentOrder[neighborIndex];
  if (!eligibleChildNodeIds.has(neighborId) || neighborId === excludedChildNodeId) {
    return { ok: false, reason: "neighbor-not-eligible" };
  }
  const newOrder = currentOrder.slice();
  newOrder[index] = neighborId;
  newOrder[neighborIndex] = childNodeId;
  return { ok: true, newOrder };
}

// ---------------------------------------------------------------------
// The add/delete session: the sibling-preservation + deletion-range
// baseline, captured fresh whenever the parent projection ITSELF was
// (re)built — independent of whether any individual child's OWN inline-
// edit session (ParentChildInlineEditSession, Phase 5L-8) happens to be
// open at the same time.
// ---------------------------------------------------------------------

/** One direct child's own raw text + its own range relative to `ParentListItemProjection#childSubtreeRange.startLine`, captured once at buildParentChildAddDeleteSession time — the deletion-range/sibling-preservation counterpart of ChildSiblingSnapshot above, captured for EVERY direct child (not just "every child other than the one currently being inline-edited"). */
export interface ChildSubtreeSlot {
  nodeId: string;
  rawText: string;
  relativeRange: LineRange;
}

/**
 * Exactly one child marked for deletion — `childIndex` is that child's own
 * index within `ParentChildAddDeleteSession#childSlots` (and, by
 * construction, within `parentNode.childIds`) AT THE MOMENT this was
 * marked. Apply-time re-verification (applyParentChildAddDeleteToDocument)
 * never trusts `childIndex`/`childSlots` alone for the LIVE write — it
 * re-resolves `childNodeId` fresh against the CURRENT document instead
 * (mirrors every other Apply-time re-resolution in this module); `childIndex`
 * is only ever used by invertAndValidateParentChildAddDeleteEdit's own
 * SNAPSHOT-based candidate reconstruction, exactly like
 * ParentChildInlineEditSession#selectedChildIndex is for the existing
 * 5L-8 case.
 */
export interface PendingChildDeletion {
  childNodeId: string;
  childIndex: number;
}

/**
 * Everything a parent's Add/Delete controls need across the pane's whole
 * session — built fresh alongside `ParentListItemProjection` (load,
 * reload, and every post-Apply rebuild — the exact same lifecycle
 * `standaloneParentListItemProjection` itself already has), then mutated
 * in place by view/PartialEditView.ts as the user starts/cancels an Add or
 * marks/confirms a Delete (mirrors how `childInlineSession` itself is a
 * plain field the view layer assigns directly, never routed through a
 * setter). At most one `newChildDraft` and at most one `pendingDeletion`
 * ever held at once (§6's own "at most one of each" requirement) — both
 * independent of, and able to coexist with, a Phase 5L-8
 * `ParentChildInlineEditSession` for a DIFFERENT child (§6's own "three
 * independent slots" requirement); by construction (view/PartialEditView.ts's
 * own handleRequestDeleteChild — see that method's own doc comment) a
 * `pendingDeletion` is never marked for the SAME child a
 * `ParentChildInlineEditSession` currently has open — confirming a delete
 * on that row closes its inline editor FIRST (§5), so the two conditions
 * can never coexist for the identical child by the time Apply runs.
 */
export interface ParentChildAddDeleteSession {
  parentNodeId: string;
  childSlots: ChildSubtreeSlot[];
  newChildDraft: NewChildDraft | null;
  pendingDeletion: PendingChildDeletion | null;
  /**
   * Phase 5L-10 ("Direct Child Leaf Reorder in Parent Partial Edit
   * Pane"): the pending reorder plan — ALWAYS a permutation of
   * `childSlots.map(s => s.nodeId)` (same set, same length, only the
   * ORDER differs), never a subset or superset. Initialized to the
   * IDENTITY order (`childSlots`'s own original order) by
   * buildParentChildAddDeleteSession below, so "is a reorder actually
   * pending" is always a plain array-equality comparison against that
   * same identity order — see isPendingReorderDirty below — rather than a
   * separate nullable flag that could drift out of sync with this array.
   * Mutated ONLY via moveChildInPendingReorder's own pure swap (never
   * assigned any other way), so it is always reachable from the original
   * order by zero or more adjacent-eligible-pair swaps.
   */
  pendingReorderOrder: string[];
  /**
   * Phase 5L-10: whether this parent's child subtree is even ELIGIBLE for
   * reorder at all (see isChildSubtreeTightlyPacked's own doc comment for
   * the "no gap between siblings" scope gate this captures) — computed
   * ONCE here, alongside `childSlots`, rather than re-derived on every
   * render. `false` means every up/down control is hidden/disabled for
   * every child of this parent, regardless of any individual child's own
   * evaluateChildReorderEligibility result.
   */
  reorderAvailable: boolean;
  /**
   * Phase 5L-11 ("Direct Child Leaf Indent/Outdent in Parent Partial Edit
   * Pane"): the ONE pending indent/outdent transformation this session
   * currently holds — `null` means none. At most one at a time (this
   * ticket's own explicit §6 scope limit); never set while `newChildDraft`/
   * `pendingDeletion` is non-null or `pendingReorderOrder` is dirty, and
   * vice versa — see edit/parentChildInlineEditSession.ts's own Phase
   * 5L-11 section doc comment for the full "composition scope" rationale,
   * and view/PartialEditView.ts's own handleRequestIndentChild/
   * handleRequestOutdentChild for where that mutual exclusion is actually
   * enforced (this field itself is a plain nullable slot, exactly like
   * `newChildDraft`/`pendingDeletion` above — never itself validated
   * against the other three).
   */
  pendingIndentOutdent: PendingIndentOutdent | null;
}

/**
 * Build a fresh ParentChildAddDeleteSession for `parentNode` — always
 * succeeds (unlike buildParentChildInlineEditSession, this never depends
 * on any ONE child's own eligibility; it merely enumerates every direct
 * child's own raw text/relative range, which parser/parseDocument.ts's
 * own `childIds` already guarantees resolve to real list nodes in the
 * SAME parse `doc` came from). Called alongside
 * buildStandaloneParentListItemProjection everywhere THAT is called (a
 * fresh load, a reload, and every post-Apply rebuild) — never
 * independently, so `childSlots` and `parentProjection.childSubtreeRange`/
 * `childSubtreeText` always describe the exact same moment.
 */
export function buildParentChildAddDeleteSession(
  doc: ParsedDocument,
  parentNode: ListBlockNode,
  parentProjection: ParentListItemProjection
): ParentChildAddDeleteSession {
  const childSlots: ChildSubtreeSlot[] = [];
  for (const childId of parentNode.childIds) {
    const childNode = doc.nodes.get(childId);
    if (!childNode || !isListNode(childNode)) {
      // Defensive only — every id in parentNode.childIds always resolves
      // to a real list node in the SAME parse `doc` came from.
      continue;
    }
    childSlots.push({
      nodeId: childId,
      rawText: doc.lines.slice(childNode.range.startLine, childNode.range.endLine + 1).join("\n"),
      relativeRange: {
        startLine: childNode.range.startLine - parentProjection.childSubtreeRange.startLine,
        endLine: childNode.range.endLine - parentProjection.childSubtreeRange.startLine,
      },
    });
  }
  const childSubtreeLineCount = parentProjection.childSubtreeText.length > 0
    ? parentProjection.childSubtreeText.split("\n").length
    : 0;
  return {
    parentNodeId: parentNode.id,
    childSlots,
    newChildDraft: null,
    pendingDeletion: null,
    pendingReorderOrder: childSlots.map((slot) => slot.nodeId),
    reorderAvailable: isChildSubtreeTightlyPacked(childSlots, childSubtreeLineCount),
    pendingIndentOutdent: null,
  };
}

/**
 * Phase 5L-10: whether `session.pendingReorderOrder` actually differs
 * from `session.childSlots`'s own original order — the "is there a
 * reorder to Apply/Cancel/guard-a-target-switch-for right now" condition
 * shared by view/PartialEditView.ts's own hasAddDeleteActivity/isDirty/
 * cancelEdit, mirroring isNewChildDraftDirty's own identical role for the
 * new-child slot. A net-no-op sequence of moves (e.g. up then down)
 * naturally reads as NOT dirty here, since it is a plain array-equality
 * comparison against the ORIGINAL order, never a "has any move ever
 * happened" flag.
 */
export function isPendingReorderDirty(session: ParentChildAddDeleteSession): boolean {
  const originalOrder = session.childSlots.map((slot) => slot.nodeId);
  if (session.pendingReorderOrder.length !== originalOrder.length) return true;
  for (let i = 0; i < originalOrder.length; i++) {
    if (session.pendingReorderOrder[i] !== originalOrder[i]) return true;
  }
  return false;
}

// ---------------------------------------------------------------------
// Combined invert + candidate validation — this section's own additional
// safety net, generalizing Phase 5L-8's own invertAndValidateParentChildCombinedEdit
// (above) from a fixed two-range plan to a variable-length one.
// ---------------------------------------------------------------------

/**
 * Every way the combined candidate is refused — an APPLY-TIME-ONLY
 * refusal, never conflated with a (load-time) eligibility reason. A
 * caller must reject Apply outright and preserve EVERY draft (the
 * parent's own controls, an open existing-child editor's own controls,
 * AND a pending new-child editor's own controls, AND a pending deletion
 * mark) exactly as the user had them:
 *
 *   - The first ten reasons are ParentChildCombinedApplyRejectReason's own
 *     (re-exported verbatim — see that type's own doc comment above for
 *     the exhaustive per-reason rationale); reached via the identical
 *     underlying checks (invertParentListItemProjection for the parent,
 *     invertChildLeafProjection for an open existing-child editor, the
 *     combined-candidate re-parse for candidate-structure-invalid/
 *     child-count-changed/child-no-longer-leaf/sibling-changed) — this
 *     section adds nothing new to any of those ten, it only ALSO runs
 *     them when an add/delete is present in the same Apply.
 *   - "new-child-unsafe-structure": the new child's own edited body,
 *     inverted via invertChildLeafProjection (kind: "unordered" always —
 *     see NewChildDraft's own doc comment), was refused — the ONLY way
 *     this is reachable in practice is a newline in the body (any other
 *     per-kind refusal this dispatch could return is structurally
 *     impossible for an "unordered" kind's own invertListMarkerProjection,
 *     which only ever has one refusal reason, "multiline-body").
 *   - "new-child-not-leaf": defensive only (invertListMarkerProjection's
 *     own newline refusal above already prevents the new child's own
 *     candidate from ever containing a second, more-deeply-indented line
 *     that could parse as a nested grandchild) — kept and checked anyway,
 *     per this codebase's standing "never guess, always verify"
 *     convention.
 *   - "deletion-target-missing": `session.pendingDeletion.childIndex` no
 *     longer resolves to a slot in `session.childSlots` whose own
 *     `nodeId` still matches `session.pendingDeletion.childNodeId` —
 *     defensive only (view/PartialEditView.ts's own
 *     handleRequestDeleteChild always marks a deletion using an index
 *     freshly computed against the SAME session/childSlots this function
 *     is about to read), kept per the same "never guess, always verify"
 *     convention as every other defensive reason in this family.
 */
export type ParentChildAddDeleteApplyRejectReason =
  | ParentChildCombinedApplyRejectReason
  | "new-child-unsafe-structure"
  | "new-child-not-leaf"
  | "deletion-target-missing"
  // Phase 5L-10 ("Direct Child Leaf Reorder in Parent Partial Edit
  // Pane"): "reorder-not-available" is defensive only — the UI is
  // expected to never let pendingReorderOrder diverge from identity
  // order while ParentChildAddDeleteSession#reorderAvailable is false
  // (moveChildInPendingReorder's own eligibility checks already prevent
  // this in practice), checked here anyway per this module's own
  // standing "never guess, always verify" convention.
  // "reorder-target-missing" is likewise defensive only —
  // pendingReorderOrder is, by construction (see that field's own doc
  // comment), always a permutation of childSlots' own ids.
  | "reorder-not-available"
  | "reorder-target-missing";

export interface InvertParentChildAddDeleteEditInput {
  parentProjection: ParentListItemProjection;
  addDeleteSession: ParentChildAddDeleteSession;
  /** The Phase 5L-8 existing-child session, if one happens to be open for a DIFFERENT child than any pendingDeletion (see ParentChildAddDeleteSession's own doc comment for why the two can never target the same child by Apply time). */
  existingChildSession: ParentChildInlineEditSession | null;
  parentDirty: boolean;
  existingChildDirty: boolean;
  /** Whether the new child's OWN inline editor's controls currently differ from its canonical loaded snapshot — ignored (treated as false) whenever `addDeleteSession.newChildDraft` is null. */
  newChildDirty: boolean;
  /** Phase 5L-10: whether `addDeleteSession.pendingReorderOrder` currently differs from `addDeleteSession.childSlots`'s own original order — pass `isPendingReorderDirty(addDeleteSession)` (never re-derive this inline; see that function's own doc comment for the exact "net-no-op is not dirty" contract callers must share). */
  reorderDirty: boolean;
  editedParentChecked: boolean;
  editedParentNumberText: string;
  editedParentBody: string;
  editedExistingChildChecked: boolean;
  editedExistingChildNumberText: string;
  editedExistingChildBody: string;
  editedNewChildBody: string;
}

export type InvertParentChildAddDeleteEditResult =
  | {
      ok: true;
      parentOwnTextRawText: string;
      /** Non-null only when `existingChildSession` was given. */
      existingChildRawText: string | null;
      /** Non-null only when `addDeleteSession.newChildDraft` was given. */
      newChildRawText: string | null;
    }
  | { ok: false; reason: ParentChildAddDeleteApplyRejectReason };

/**
 * Reconstruct every candidate that is actually PRESENT (parent own-text;
 * an open existing-child editor's own body; a pending new child's own
 * body) from their respective ORIGINAL snapshots plus whichever controls
 * are dirty, splice a pending deletion (if any) and a pending new child
 * (if any) into the ORIGINAL `parentProjection.childSubtreeText` snapshot
 * — never the live document, exactly like Phase 5L-8's own identically-
 * shaped safety net — and re-parse the WHOLE result as one throwaway
 * mini-document, validating every slot this ticket's own §7 step 10
 * requires. Operates entirely on SNAPSHOTS; the live-document write is
 * applyParentChildAddDeleteToDocument's own separate job, run only AFTER
 * this function returns `ok: true`.
 */
export function invertAndValidateParentChildAddDeleteEdit(
  input: InvertParentChildAddDeleteEditInput
): InvertParentChildAddDeleteEditResult {
  const { parentProjection, addDeleteSession, existingChildSession } = input;

  // ---- Stage 1: parent own-text candidate (5L-6's own invert, unmodified) ----
  let parentOwnTextRawText = parentProjection.ownText.rawText;
  if (input.parentDirty) {
    const inverted = invertParentListItemProjection(
      parentProjection,
      input.editedParentChecked,
      input.editedParentNumberText,
      input.editedParentBody
    );
    if (!inverted.ok) {
      const reason: ParentChildAddDeleteApplyRejectReason =
        inverted.reason === "invalid-number"
          ? "parent-invalid-number"
          : inverted.reason === "own-text-unsafe-structure"
            ? "parent-own-text-unsafe-structure"
            : inverted.reason === "child-subtree-detached"
              ? "parent-child-subtree-detached"
              : "parent-child-subtree-changed";
      return { ok: false, reason };
    }
    parentOwnTextRawText = inverted.ownTextRawText;
  }

  // ---- Stage 2: existing-child candidate (5L-8's own dispatch, unmodified) ----
  let existingChildRawText: string | null = null;
  if (existingChildSession) {
    existingChildRawText = existingChildSession.originalChildRawText;
    if (input.existingChildDirty) {
      const inverted = invertChildLeafProjection(
        existingChildSession.childProjection,
        input.editedExistingChildChecked,
        input.editedExistingChildNumberText,
        input.editedExistingChildBody
      );
      if (!inverted.ok) {
        return {
          ok: false,
          reason: inverted.reason === "invalid-number" ? "child-invalid-number" : "child-unsafe-structure",
        };
      }
      existingChildRawText = inverted.rawText;
    }
  }

  // ---- Stage 3: new-child candidate (this section's own new dispatch,
  // reusing invertChildLeafProjection unmodified — see NewChildDraft's own
  // doc comment for why this is always the "unordered" kind). ----
  let newChildRawText: string | null = null;
  if (addDeleteSession.newChildDraft) {
    newChildRawText = childProjectionRawText(addDeleteSession.newChildDraft.projection);
    if (input.newChildDirty) {
      const inverted = invertChildLeafProjection(addDeleteSession.newChildDraft.projection, false, "", input.editedNewChildBody);
      if (!inverted.ok) {
        return { ok: false, reason: "new-child-unsafe-structure" };
      }
      newChildRawText = inverted.rawText;
    }
  }

  // ---- Stage 4: splice deletion + existing-child-edit into the ORIGINAL
  // childSubtreeText snapshot (back-to-front, offset-safe — never the
  // live document), then append the new child (if any) at the very end.
  //
  // Phase 5L-10 ("Direct Child Leaf Reorder in Parent Partial Edit
  // Pane"): when a reorder is ALSO pending (`input.reorderDirty`), this
  // stage takes a genuinely different shape — position-based Replacement
  // splices can express an EDIT or a DELETION in place, but not a
  // PERMUTATION of sibling order, so the reordered case instead rebuilds
  // the whole child subtree by walking `pendingReorderOrder` directly
  // (see this function's own reorderDirty branch below). The ORIGINAL
  // (non-reorder) splice path immediately below is completely UNCHANGED
  // from before this ticket — every pre-existing 5L-9 Apply scenario
  // (parent/existing-child edit, add, delete, any combination, none of
  // them touching pendingReorderOrder) keeps taking this exact same code
  // path, byte-for-byte.
  const childSubtreeLines = parentProjection.childSubtreeText.length > 0 ? parentProjection.childSubtreeText.split("\n") : [];

  let deletedSlot: ChildSubtreeSlot | null = null;
  if (addDeleteSession.pendingDeletion) {
    const slot = addDeleteSession.childSlots[addDeleteSession.pendingDeletion.childIndex];
    if (!slot || slot.nodeId !== addDeleteSession.pendingDeletion.childNodeId) {
      return { ok: false, reason: "deletion-target-missing" };
    }
    deletedSlot = slot;
  }

  let combinedChildSubtreeText: string;
  if (input.reorderDirty) {
    // Defensive only (see ParentChildAddDeleteApplyRejectReason's own
    // "reorder-not-available" doc comment) — the UI never lets
    // pendingReorderOrder diverge from identity order while
    // reorderAvailable is false.
    if (!addDeleteSession.reorderAvailable) {
      return { ok: false, reason: "reorder-not-available" };
    }
    // Rebuild the WHOLE child subtree by walking the PENDING order
    // (never childSlots' own original order), substituting the edited
    // existing-child candidate where it applies and DROPPING the
    // pending-deletion target entirely. Each id's own candidate text is
    // joined by a single "\n" — byte-for-byte faithful to the original
    // document only because `reorderAvailable` already guarantees this
    // child subtree has no boundary gap line between siblings to lose or
    // misplace (see isChildSubtreeTightlyPacked's own doc comment).
    const slotByNodeId = new Map(addDeleteSession.childSlots.map((slot) => [slot.nodeId, slot] as const));
    const orderedTexts: string[] = [];
    for (const nodeId of addDeleteSession.pendingReorderOrder) {
      if (deletedSlot && nodeId === deletedSlot.nodeId) continue;
      if (existingChildSession && nodeId === existingChildSession.childNodeId && existingChildRawText !== null) {
        orderedTexts.push(existingChildRawText);
        continue;
      }
      const slot = slotByNodeId.get(nodeId);
      if (!slot) {
        return { ok: false, reason: "reorder-target-missing" };
      }
      orderedTexts.push(slot.rawText);
    }
    combinedChildSubtreeText = orderedTexts.join("\n");
  } else {
    interface Replacement {
      startLine: number;
      endLine: number;
      lines: string[];
    }
    const replacements: Replacement[] = [];
    if (existingChildSession && existingChildRawText !== null) {
      replacements.push({
        startLine: existingChildSession.childRelativeRange.startLine,
        endLine: existingChildSession.childRelativeRange.endLine,
        lines: existingChildRawText.split("\n"),
      });
    }
    if (deletedSlot) {
      replacements.push({ startLine: deletedSlot.relativeRange.startLine, endLine: deletedSlot.relativeRange.endLine, lines: [] });
    }
    replacements.sort((a, b) => b.startLine - a.startLine);
    let workingLines = childSubtreeLines.slice();
    for (const r of replacements) {
      workingLines = [...workingLines.slice(0, r.startLine), ...r.lines, ...workingLines.slice(r.endLine + 1)];
    }
    combinedChildSubtreeText = workingLines.join("\n");
  }
  if (newChildRawText !== null) {
    combinedChildSubtreeText =
      combinedChildSubtreeText.length > 0 ? combinedChildSubtreeText + "\n" + newChildRawText : newChildRawText;
  }

  // ---- Stage 5: re-parse the WHOLE candidate as one throwaway mini-document. ----
  const fullCandidateText =
    combinedChildSubtreeText.length > 0 ? parentOwnTextRawText + "\n" + combinedChildSubtreeText : parentOwnTextRawText;
  const fullCandidateLines = fullCandidateText.split("\n");
  const candidateDoc = parseDocument(fullCandidateText);
  const candidateNode = candidateDoc.nodes.get("li-0");
  if (
    !candidateNode ||
    !isListNode(candidateNode) ||
    candidateNode.range.startLine !== 0 ||
    candidateNode.ordered !== (parentProjection.ownText.listKind === "ordered") ||
    candidateNode.unsafeIndent ||
    candidateNode.range.endLine !== fullCandidateLines.length - 1
  ) {
    return { ok: false, reason: "candidate-structure-invalid" };
  }

  const expectedChildCount =
    addDeleteSession.childSlots.length - (deletedSlot ? 1 : 0) + (newChildRawText !== null ? 1 : 0);
  if (candidateNode.childIds.length !== expectedChildCount) {
    return { ok: false, reason: "child-count-changed" };
  }

  // ---- Stage 6: per-candidate-child validation. Phase 5L-10: when a
  // reorder is pending, `expectedSlots` is built by walking the PENDING
  // order instead of `childSlots`' own original order — this is what
  // makes this stage's own existing per-position rawText comparison
  // (below) also the "並び順だけが変わっている"/"depth・indentation・
  // parent 所属が変わっていない" check this ticket's own §6 step 10
  // requires: a "kept" slot's expected rawText is its ORIGINAL captured
  // text (indentation included), so any structural drift at that
  // position — not just a changed body, but a changed depth, a newly
  // non-leaf shape, or a completely different child ending up there —
  // is caught by the same byte-for-byte comparison every non-reorder
  // Apply already relies on. ----
  type ExpectedSlot = { kind: "kept"; rawText: string } | { kind: "edited" } | { kind: "new" };
  const expectedSlots: ExpectedSlot[] = [];
  if (input.reorderDirty) {
    for (const nodeId of addDeleteSession.pendingReorderOrder) {
      if (deletedSlot && nodeId === deletedSlot.nodeId) continue;
      if (existingChildSession && nodeId === existingChildSession.childNodeId) {
        expectedSlots.push({ kind: "edited" });
        continue;
      }
      const slot = addDeleteSession.childSlots.find((s) => s.nodeId === nodeId);
      if (!slot) {
        return { ok: false, reason: "reorder-target-missing" };
      }
      expectedSlots.push({ kind: "kept", rawText: slot.rawText });
    }
  } else {
    for (const slot of addDeleteSession.childSlots) {
      if (deletedSlot && slot.nodeId === deletedSlot.nodeId) continue;
      if (existingChildSession && slot.nodeId === existingChildSession.childNodeId) {
        expectedSlots.push({ kind: "edited" });
      } else {
        expectedSlots.push({ kind: "kept", rawText: slot.rawText });
      }
    }
  }
  if (newChildRawText !== null) {
    expectedSlots.push({ kind: "new" });
  }

  for (let i = 0; i < candidateNode.childIds.length; i++) {
    const candidateChildId = candidateNode.childIds[i];
    const candidateChildNode = candidateDoc.nodes.get(candidateChildId);
    if (!candidateChildNode || !isListNode(candidateChildNode)) {
      return { ok: false, reason: "candidate-structure-invalid" };
    }
    const expected = expectedSlots[i];
    if (!expected) {
      // Defensive only — expectedSlots.length === expectedChildCount ===
      // candidateNode.childIds.length by construction above.
      return { ok: false, reason: "candidate-structure-invalid" };
    }
    if (expected.kind === "edited") {
      if (candidateChildNode.childIds.length !== 0 || candidateChildNode.unsafeIndent) {
        return { ok: false, reason: "child-no-longer-leaf" };
      }
      continue;
    }
    if (expected.kind === "new") {
      if (candidateChildNode.childIds.length !== 0 || candidateChildNode.unsafeIndent) {
        return { ok: false, reason: "new-child-not-leaf" };
      }
      continue;
    }
    const candidateRawText = fullCandidateLines
      .slice(candidateChildNode.range.startLine, candidateChildNode.range.endLine + 1)
      .join("\n");
    if (candidateRawText !== expected.rawText) {
      return { ok: false, reason: "sibling-changed" };
    }
  }

  return { ok: true, parentOwnTextRawText, existingChildRawText, newChildRawText };
}

// ---------------------------------------------------------------------
// Apply-time write-back: a variable-length plan (parent range; an
// optional existing-child range; an optional deletion range; an optional
// zero-width new-child insertion point), one atomic splice, per-range
// conflict check — see this section's own top doc comment's "The write
// primitive" section for why this is a NEW function that reuses Phase
// 5L-8's own applyParentChildInlineEditToDocument's techniques rather
// than literally sharing its fixed two-argument signature.
// ---------------------------------------------------------------------

/**
 * Every way the LIVE-document write is refused — always a SAFE REFUSAL
 * (`doc.lines` returned completely untouched), never a partial write.
 * Mirrors ParentChildLiveApplyRejectReason's own exhaustive list above,
 * just re-derived per range (parent / existing-child / deletion-target)
 * instead of a fixed parent+child pair:
 *
 *   - "parent-resolve-failed": the parent id no longer resolves, is now
 *     unsafeIndent, or its own own-text/child-subtree ranges can no
 *     longer be safely separated at all.
 *   - "existing-child-resolve-failed"/"existing-child-not-direct-child"/
 *     "existing-child-has-children"/"existing-child-unsafe-indent": the
 *     Phase 5L-8 existing-child session's own target, re-verified fresh.
 *   - "deletion-target-resolve-failed"/"deletion-target-not-direct-child"/
 *     "deletion-target-has-children"/"deletion-target-unsafe-indent": the
 *     pending-deletion target, re-verified fresh, the identical way.
 *   - "range-overlap": a freshly re-resolved existing-child or deletion
 *     range no longer sits entirely inside the freshly re-resolved
 *     parent child-subtree range — defensive only in practice (every
 *     check immediately above should already exclude this), kept per
 *     this codebase's "never guess, always verify" convention.
 *   - "parent-conflict"/"existing-child-conflict"/"deletion-target-conflict":
 *     the CURRENT document's own range no longer matches the ORIGINAL
 *     snapshot this Apply was built against — checked ONLY for whichever
 *     range this Apply is actually about to touch (parentDirty for the
 *     parent; existingChild.dirty for the existing child; a deletion is
 *     ALWAYS conflict-checked, since a deletion always writes — mirrors
 *     applyParentListItemOwnTextEdit/applyParentChildInlineEditToDocument's
 *     own "a range this Apply never writes can never block it" principle,
 *     with a deletion counted as always-writing its own range).
 */
export type ParentChildAddDeleteLiveApplyRejectReason =
  | "parent-resolve-failed"
  | "existing-child-resolve-failed"
  | "existing-child-not-direct-child"
  | "existing-child-has-children"
  | "existing-child-unsafe-indent"
  | "deletion-target-resolve-failed"
  | "deletion-target-not-direct-child"
  | "deletion-target-has-children"
  | "deletion-target-unsafe-indent"
  | "range-overlap"
  | "parent-conflict"
  | "existing-child-conflict"
  | "deletion-target-conflict"
  // Phase 5L-10 ("Direct Child Leaf Reorder in Parent Partial Edit
  // Pane"): "reorder-target-resolve-failed" folds together the per-child
  // structural checks above (not found / not a direct child / now
  // unsafe-indent / range-overlap — deliberately NOT "now has children":
  // see this function's own reorder branch below for why a non-eligible,
  // grandchild-bearing sibling that never changes position is allowed to
  // simply pass through), for ANY id in the pending reorder's own order —
  // deliberately coarse (a reorder's own write touches every direct
  // child's own position at once, so ANY single one failing already
  // refuses the WHOLE reorder; see this function's own reorder branch
  // below). "reorder-conflict" is
  // the reorder's own whole-subtree conflict check — see
  // ReorderLiveApplyInput's own doc comment for why a reorder's conflict
  // check is necessarily whole-subtree, never per-child.
  | "reorder-target-resolve-failed"
  | "reorder-conflict";

export interface ExistingChildLiveApplyInput {
  childNodeId: string;
  dirty: boolean;
  originalRawText: string;
  newRawText: string;
}

export interface DeletionLiveApplyInput {
  childNodeId: string;
  originalRawText: string;
}

/**
 * Phase 5L-10: everything a pending reorder needs at Apply time — `null`
 * means "no reorder to apply" (mirrors `deletion`'s own null-means-absent
 * convention), never passed unless the caller already confirmed
 * `isPendingReorderDirty(addDeleteSession)` is true.
 */
export interface ReorderLiveApplyInput {
  /**
   * The pending reorder's own FULL order — `addDeleteSession.pendingReorderOrder`
   * verbatim, still including the pending-deletion target's own id (if
   * any) at whatever position it currently sits — this function filters
   * that id out itself (via `deletion`, resolved independently), mirroring
   * how every other structural check in this module re-derives its own
   * safety from raw inputs rather than trusting a caller to have already
   * filtered them identically.
   */
  orderedChildNodeIds: string[];
  /**
   * The FULL child-subtree raw text snapshot captured when this reorder
   * plan was built (`parentProjection.childSubtreeText`) — a reorder's
   * own conflict check compares this, byte-for-byte, against the CURRENT
   * live child-subtree text, rather than a per-child range check like
   * `existingChild`/`deletion` each use. A reorder's write touches every
   * direct child's own position at once, so there is no single "range
   * this Apply doesn't touch" left to reason about separately once a
   * reorder is present — any external change ANYWHERE in the child
   * subtree since this session was captured is a legitimate conflict for
   * a reorder specifically (an ordinary single-child edit, by contrast,
   * safely ignores an external change to an unrelated SIBLING's own
   * range — see this section's own top doc comment's "a clean range is a
   * true byte-for-byte no-op" guarantee, which a reorder cannot rely on
   * since every child's range is, by definition, about to move).
   */
  originalChildSubtreeText: string;
}

export interface ApplyParentChildAddDeleteOutcome {
  changed: boolean;
  lines: string[];
  /** New start line of the (possibly unchanged) parent own-text range — valid whenever `changed` is true. */
  parentNewStartLine: number;
  reason?: ParentChildAddDeleteLiveApplyRejectReason;
}

/**
 * Replace the parent's own-text range and/or the existing-child's own
 * range and/or remove the deletion target's own range and/or insert the
 * new child and/or rewrite the WHOLE child subtree in a new pending order
 * — WHICHEVER of those are actually present — against the CURRENT `doc`
 * (a fresh parse of the note as it stands right now), in exactly ONE
 * atomic `lines` array construction (back-to-front, offset-corrected —
 * see this section's own top doc comment). A range this call is not
 * asked to touch is spliced back with whatever the LIVE document
 * CURRENTLY holds there (never a stale snapshot) — the existing child's
 * own range when `existingChild.dirty` is false, mirroring
 * applyParentChildInlineEditToDocument's own identical "a clean range is
 * a true byte-for-byte no-op" guarantee.
 *
 * Phase 5L-10: when `reorder` is non-null, the existing-child and
 * deletion ranges are NEVER spliced independently — the whole
 * `childSubtreeRange` is replaced by ONE reconstructed block instead (see
 * the `reorder` branch below), since a reorder's own write already
 * repositions every direct child, existing-child-edit and deletion
 * included. `existingChild`/`deletion` are still independently RESOLVED
 * and STRUCTURALLY validated in that case (an existing-child edit still
 * needs to know its own live text is safe to substitute; a deletion
 * target still needs to be confirmed a real, still-eligible direct child
 * before being excluded) — only their OWN per-range conflict check and
 * span push are skipped, subsumed by the reorder's own whole-subtree
 * conflict check instead.
 */
export function applyParentChildAddDeleteToDocument(
  doc: ParsedDocument,
  parentNodeId: string,
  parentDirty: boolean,
  originalParentOwnTextRaw: string,
  newParentOwnTextRaw: string,
  existingChild: ExistingChildLiveApplyInput | null,
  deletion: DeletionLiveApplyInput | null,
  newChildRawText: string | null,
  reorder: ReorderLiveApplyInput | null = null
): ApplyParentChildAddDeleteOutcome {
  const fail = (reason: ParentChildAddDeleteLiveApplyRejectReason): ApplyParentChildAddDeleteOutcome => ({
    changed: false,
    lines: doc.lines,
    parentNewStartLine: -1,
    reason,
  });

  const parentNode = doc.nodes.get(parentNodeId);
  if (!parentNode || !isListNode(parentNode) || parentNode.unsafeIndent) {
    return fail("parent-resolve-failed");
  }
  const resolvedParent = resolveParentListItemOwnTextRange(doc, parentNode);
  if (!resolvedParent.ok) {
    return fail("parent-resolve-failed");
  }
  const { ownTextRange: parentOwnTextRange, childSubtreeRange } = resolvedParent.resolution;

  let existingChildNode: ListBlockNode | null = null;
  if (existingChild) {
    const node = doc.nodes.get(existingChild.childNodeId);
    if (!node || !isListNode(node)) return fail("existing-child-resolve-failed");
    if (node.parentId !== parentNode.id) return fail("existing-child-not-direct-child");
    if (node.childIds.length !== 0) return fail("existing-child-has-children");
    if (node.unsafeIndent) return fail("existing-child-unsafe-indent");
    if (!isChildRangeWithinParentChildSubtree(parentOwnTextRange, childSubtreeRange, node.range)) {
      return fail("range-overlap");
    }
    existingChildNode = node;
  }

  let deletionNode: ListBlockNode | null = null;
  if (deletion) {
    const node = doc.nodes.get(deletion.childNodeId);
    if (!node || !isListNode(node)) return fail("deletion-target-resolve-failed");
    if (node.parentId !== parentNode.id) return fail("deletion-target-not-direct-child");
    if (node.childIds.length !== 0) return fail("deletion-target-has-children");
    if (node.unsafeIndent) return fail("deletion-target-unsafe-indent");
    if (!isChildRangeWithinParentChildSubtree(parentOwnTextRange, childSubtreeRange, node.range)) {
      return fail("range-overlap");
    }
    deletionNode = node;
  }

  // Phase 5L-10: resolve every id the reorder plan still expects to be a
  // live direct child of this parent, fresh, BEFORE any conflict check —
  // reused below both to build the reconstructed block's own text and to
  // fail fast if ANY of them is no longer safely resolvable.
  //
  // Deliberately NOT a leaf-only check here: `reorder.orderedChildNodeIds`
  // is the WHOLE child subtree's own order (see ReorderLiveApplyInput's
  // own doc comment), which — per isChildSubtreeTightlyPacked's own "the
  // gate is about gaps, not leaf-ness" contract — may legitimately include
  // a non-eligible, grandchild-bearing sibling that simply never moves
  // (moveChildInPendingReorder never lets a non-eligible id become either
  // the moved child or the neighbor it swaps with, so such an id's own
  // position in `orderedChildNodeIds` is always its ORIGINAL one). That
  // sibling's own grandchild subtree is preserved verbatim below by
  // taking its current full multi-line raw text as-is (§4's own "grandchild
  // subtrees of non-eligible items are never touched") — requiring
  // childIds.length === 0 here would incorrectly refuse every reorder on
  // a tightly-packed subtree that merely CONTAINS a non-eligible sibling,
  // even when that sibling's own position never changes. A genuinely
  // unsafe change to any of these ids (this one included) is still caught
  // below by the reorder's own whole-subtree byte-for-byte conflict check
  // against `reorder.originalChildSubtreeText` — see this function's own
  // top doc comment and ReorderLiveApplyInput's own doc comment for why
  // that check is necessarily whole-subtree rather than per-child. A
  // dirty existing-child EDIT target is separately required to be a leaf
  // by its own dedicated resolution block above (`existingChildNode`), and
  // a deletion target by its own (`deletionNode`) — this loop never
  // substitutes either without having already gone through that check.
  let reorderLiveTexts: string[] | null = null;
  if (reorder) {
    reorderLiveTexts = [];
    for (const nodeId of reorder.orderedChildNodeIds) {
      if (deletion && nodeId === deletion.childNodeId) continue;
      const node = doc.nodes.get(nodeId);
      if (
        !node ||
        !isListNode(node) ||
        node.parentId !== parentNode.id ||
        node.unsafeIndent ||
        !isChildRangeWithinParentChildSubtree(parentOwnTextRange, childSubtreeRange, node.range)
      ) {
        return fail("reorder-target-resolve-failed");
      }
      if (existingChild && existingChild.dirty && nodeId === existingChild.childNodeId) {
        reorderLiveTexts.push(existingChild.newRawText);
      } else {
        reorderLiveTexts.push(doc.lines.slice(node.range.startLine, node.range.endLine + 1).join("\n"));
      }
    }
  }

  if (parentDirty) {
    const current = doc.lines.slice(parentOwnTextRange.startLine, parentOwnTextRange.endLine + 1).join("\n");
    if (current !== originalParentOwnTextRaw) return fail("parent-conflict");
  }
  if (reorder) {
    // Subsumes existingChild's/deletion's own per-range conflict checks
    // below — see this function's own top doc comment.
    const currentChildSubtreeText = doc.lines
      .slice(childSubtreeRange.startLine, childSubtreeRange.endLine + 1)
      .join("\n");
    if (currentChildSubtreeText !== reorder.originalChildSubtreeText) {
      return fail("reorder-conflict");
    }
  } else {
    if (existingChild && existingChild.dirty && existingChildNode) {
      const current = doc.lines
        .slice(existingChildNode.range.startLine, existingChildNode.range.endLine + 1)
        .join("\n");
      if (current !== existingChild.originalRawText) return fail("existing-child-conflict");
    }
    if (deletion && deletionNode) {
      const current = doc.lines.slice(deletionNode.range.startLine, deletionNode.range.endLine + 1).join("\n");
      if (current !== deletion.originalRawText) return fail("deletion-target-conflict");
    }
  }

  const anyWrite =
    parentDirty || (existingChild?.dirty ?? false) || !!deletion || newChildRawText !== null || !!reorder;
  if (!anyWrite) {
    // Defensive only — a caller should never invoke this with nothing to
    // write; kept total and safe (a true no-op) regardless.
    return { changed: false, lines: doc.lines, parentNewStartLine: -1 };
  }

  interface Span {
    startLine: number;
    endLine: number;
    lines: string[];
  }
  const spans: Span[] = [
    {
      startLine: parentOwnTextRange.startLine,
      endLine: parentOwnTextRange.endLine,
      lines: parentDirty
        ? newParentOwnTextRaw.split("\n")
        : doc.lines.slice(parentOwnTextRange.startLine, parentOwnTextRange.endLine + 1),
    },
  ];
  if (reorder && reorderLiveTexts) {
    // ONE consolidated span replacing the whole child-subtree range,
    // rather than the two independent existingChild/deletion spans below
    // — see this function's own top doc comment.
    const rebuiltText = reorderLiveTexts.join("\n");
    spans.push({
      startLine: childSubtreeRange.startLine,
      endLine: childSubtreeRange.endLine,
      lines: rebuiltText.length > 0 ? rebuiltText.split("\n") : [],
    });
  } else {
    if (existingChild && existingChildNode) {
      spans.push({
        startLine: existingChildNode.range.startLine,
        endLine: existingChildNode.range.endLine,
        lines: existingChild.dirty
          ? existingChild.newRawText.split("\n")
          : doc.lines.slice(existingChildNode.range.startLine, existingChildNode.range.endLine + 1),
      });
    }
    if (deletion && deletionNode) {
      spans.push({ startLine: deletionNode.range.startLine, endLine: deletionNode.range.endLine, lines: [] });
    }
  }
  if (newChildRawText !== null) {
    // A zero-width insertion immediately after the LIVE child-subtree's
    // own last line — always the LARGEST startLine among every span above
    // (every existing-child/deletion/reorder range sits at or before
    // childSubtreeRange.endLine by construction — the range-overlap/
    // reorder-target-resolve-failed checks above already confirm this),
    // so it never collides with any other span regardless of sort order.
    spans.push({
      startLine: childSubtreeRange.endLine + 1,
      endLine: childSubtreeRange.endLine,
      lines: newChildRawText.split("\n"),
    });
  }
  spans.sort((a, b) => b.startLine - a.startLine);
  let lines = doc.lines.slice();
  for (const s of spans) {
    lines = [...lines.slice(0, s.startLine), ...s.lines, ...lines.slice(s.endLine + 1)];
  }

  return { changed: true, lines, parentNewStartLine: parentOwnTextRange.startLine };
}

// ---------------------------------------------------------------------
// Phase 5L-11 ("Direct Child Leaf Indent/Outdent in Parent Partial Edit
// Pane"): a minimal, single-level indent/outdent of exactly ONE direct
// child leaf — deliberately NOT free tree transformation. See
// docs/phase5l11_parent-child-indent-outdent.md for the full scope
// record; the two operations this section implements:
//
//   - Indent: a direct-child leaf becomes the LAST child of its
//     immediately PRECEDING direct-child sibling (親/A,B → 親/A/B).
//   - Outdent: a nested leaf child exactly ONE level deep becomes a
//     direct child of the Partial Edit Pane's own parent item,
//     positioned immediately after its former parent (親/A/B → 親/A,B).
//
// Explicitly NOT implemented (see this ticket's own §12): arbitrary-depth
// moves, moving to an arbitrary parent, multi-level moves in one op,
// drag & drop, moving a node that itself owns a subtree.
//
// ---- Reuse, never re-implementation ----
//
// growIndent/shrinkIndent/buildIndentPrefix (imported from
// move/indentBlock.ts above) are reused VERBATIM — the exact same
// whitespace primitives the Outline Tree's own pre-existing indent/
// outdent command already uses to re-indent an EXISTING item being
// moved. This module never re-derives a second indentation policy.
//
// ---- Why this is ONE fresh-document pass, not the snapshot-then-live
// two-stage pattern every other pending edit in this module uses ----
//
// Every other pending edit here (inline edit, add, delete, reorder)
// carries a user-EDITABLE draft (a textarea's current value) that must
// be re-validated against a possibly-changed document at Apply time —
// hence the two-stage "invert+validate off a SNAPSHOT, then separately
// re-resolve+conflict-check+write against the LIVE document" shape those
// functions all share. Indent/outdent has no such draft: it is a single,
// fully mechanical structural move decided once (when the user presses
// the indent/outdent button) and either Applied verbatim or Cancelled
// outright — there is nothing a user could have "edited" in between. So
// `applyParentChildIndentOutdentToDocument` below collapses to ONE
// fresh-document pass — re-parse, re-resolve, build the candidate,
// validate it via a throwaway mini-reparse, and (only once valid) write
// the SAME transformation to the live document — matching this ticket's
// own §7 Apply procedure precisely, without the redundancy (and drift
// risk) of computing the transformation twice against two different
// document snapshots. `buildIndentOutdentPreviewText` below is the
// read-only preview's own counterpart, built the identical way but never
// re-parsed/validated/written (a failed re-resolution there simply falls
// back to the untransformed preview — see that function's own doc
// comment).
//
// ---- Composition scope (§6's own explicit simplification) ----
//
// A pending indent/outdent NEVER coexists with an open existing-child
// editor, a pending new-child draft, a pending deletion, or a dirty
// pending reorder — view/PartialEditView.ts's own handleRequestIndentChild/
// handleRequestOutdentChild only ever let a NEW indent/outdent start
// while none of those four are present, and hide every OTHER row
// affordance while one is already pending. It MAY compose with a dirty
// PARENT own-text edit, exactly like a pending reorder already can —
// applyParentChildIndentOutdentToDocument below accepts `parentDirty` for
// exactly that reason.
// ---------------------------------------------------------------------

export type ChildIndentEligibilityReason =
  | ChildInlineEditEligibilityReason
  | "no-preceding-sibling"
  | "preceding-sibling-not-found"
  | "preceding-sibling-unsafe-indent";

export type ChildIndentEligibilityResult =
  | { ok: true; childNode: ListBlockNode; projection: ChildLeafProjection; siblingNode: ListBlockNode }
  | { ok: false; reason: ChildIndentEligibilityReason };

/**
 * Phase 5L-11 §4-2: whether `childNodeId` — a candidate DIRECT child of
 * `parentNode` — can be indented at all right now. Reuses
 * evaluateChildInlineEditEligibility verbatim for the target's OWN five
 * conditions (leaf, direct child, not unsafe-indent, no complex-block
 * continuation, projectable — §3's own "eligible node conditions",
 * identical to every other Phase 5L-8/9/10 affordance's own target
 * gate), then adds the two conditions specific to indent (§4-1): an
 * immediately-preceding direct-child sibling must exist, and that
 * sibling itself must be a real, still-`unsafeIndent`-free list node.
 * The sibling is deliberately NOT required to be itself "eligible" by
 * evaluateChildInlineEditEligibility's own stricter definition — §4-1
 * only ever asks that the sibling "is a list item" and "is neither a
 * CompositeBlock member nor unsafeIndent"; a sibling that already owns
 * its own child subtree, or is itself a multi-line/task/ordered leaf, is
 * still a perfectly valid indent DESTINATION (this is exactly how
 * "indenting into a sibling that already has children" — §10's own
 * required fixture scenario — stays possible at all). A CompositeBlock
 * member is never even reachable as a value in `parentNode.childIds` in
 * the first place — see evaluateChildReorderEligibility's own doc
 * comment for why that exclusion needs no separate check here either.
 */
export function evaluateChildIndentEligibility(
  doc: ParsedDocument,
  parentNode: ListBlockNode,
  childNodeId: string
): ChildIndentEligibilityResult {
  const base = evaluateChildInlineEditEligibility(doc, parentNode, childNodeId);
  if (!base.ok) {
    return { ok: false, reason: base.reason };
  }
  const index = parentNode.childIds.indexOf(childNodeId);
  if (index <= 0) {
    // Defensive for index === -1 (base.ok already guarantees membership);
    // index === 0 is the real, reachable "first child, no preceding
    // sibling" case §4-2 requires be hidden/disabled.
    return { ok: false, reason: "no-preceding-sibling" };
  }
  const siblingId = parentNode.childIds[index - 1];
  const siblingNode = doc.nodes.get(siblingId);
  if (!siblingNode || !isListNode(siblingNode)) {
    // Defensive only — every id in parentNode.childIds always resolves
    // to a real list node in the SAME parse `doc` came from.
    return { ok: false, reason: "preceding-sibling-not-found" };
  }
  if (siblingNode.unsafeIndent) {
    return { ok: false, reason: "preceding-sibling-unsafe-indent" };
  }
  return { ok: true, childNode: base.childNode, projection: base.projection, siblingNode };
}

export type ChildOutdentEligibilityReason =
  | "child-not-found"
  | "not-nested-child"
  | "child-has-children"
  | "child-unsafe-indent"
  | "child-complex-block"
  | "child-not-projectable"
  | "current-parent-unsafe-indent";

export type ChildOutdentEligibilityResult =
  | { ok: true; childNode: ListBlockNode; projection: ChildLeafProjection; currentParentNode: ListBlockNode }
  | { ok: false; reason: ChildOutdentEligibilityReason };

/**
 * Phase 5L-11 §5-2: whether `childNodeId` — a candidate NESTED child
 * exactly ONE level below `parentNode` (i.e. a grandchild of
 * `parentNode`: a direct child of one of `parentNode`'s OWN direct
 * children) — can be outdented back to direct-child-of-`parentNode`
 * status right now. Deliberately its own dedicated function, never a
 * call to evaluateChildInlineEditEligibility (that function's own
 * "not-direct-child" check would always refuse `childNodeId` here, by
 * definition — an outdent TARGET is never itself a direct child of
 * `parentNode`, see §5-1's own "target is NOT a direct child... but IS
 * one level deeper" condition). Every one of the target's own leaf/
 * safety checks below is still the exact SAME shape
 * evaluateChildInlineEditEligibility itself runs (leaf, not
 * unsafe-indent, no complex-block continuation, projectable) — just
 * re-run directly here against `childNodeId` instead of delegating,
 * since the "is this a direct child of parentNode" half of that
 * function's own check doesn't apply. A node TWO OR MORE levels deep is
 * refused by the `currentParentNode.parentId !== parentNode.id` check
 * below (§5-2's own explicit "2+ level moves are out of scope" — a
 * grandchild-of-a-grandchild's own immediate parent is itself NOT a
 * direct child of `parentNode`, so this check refuses it exactly like it
 * refuses a direct child masquerading as "already nested"). A node with
 * `childIds.length > 0` is refused the same way evaluateChildInlineEditEligibility
 * refuses one, for the identical "no grandchild-and-deeper editing/
 * moving" reason.
 */
export function evaluateChildOutdentEligibility(
  doc: ParsedDocument,
  parentNode: ListBlockNode,
  childNodeId: string
): ChildOutdentEligibilityResult {
  const childNode = doc.nodes.get(childNodeId);
  if (!childNode || !isListNode(childNode)) {
    return { ok: false, reason: "child-not-found" };
  }
  const currentParentNode = childNode.parentId ? doc.nodes.get(childNode.parentId) : undefined;
  if (!currentParentNode || !isListNode(currentParentNode) || currentParentNode.parentId !== parentNode.id) {
    return { ok: false, reason: "not-nested-child" };
  }
  if (childNode.childIds.length !== 0) {
    return { ok: false, reason: "child-has-children" };
  }
  if (childNode.unsafeIndent) {
    return { ok: false, reason: "child-unsafe-indent" };
  }
  if (currentParentNode.unsafeIndent) {
    return { ok: false, reason: "current-parent-unsafe-indent" };
  }
  if (hasComplexBlockInMultiLineListItemContinuation(doc, childNode)) {
    return { ok: false, reason: "child-complex-block" };
  }
  const rawText = doc.lines.slice(childNode.range.startLine, childNode.range.endLine + 1).join("\n");
  const built = buildChildLeafProjection(rawText);
  if (!built.ok) {
    return { ok: false, reason: "child-not-projectable" };
  }
  return { ok: true, childNode, projection: built.projection, currentParentNode };
}

export type PendingIndentOutdentKind = "indent" | "outdent";

/**
 * Phase 5L-11: the ONE pending indent/outdent transformation a
 * ParentChildAddDeleteSession can hold at a time (§6's own "at most ONE
 * pending indent/outdent" scope limit) — `relatedNodeId` is the
 * DESTINATION parent for an indent (the preceding sibling `childNodeId`
 * is about to become the last child of) or the SOURCE parent for an
 * outdent (the node `childNodeId` is currently nested under, and is
 * about to leave). Deliberately just two ids, never a captured raw-text
 * snapshot of either — applyParentChildIndentOutdentToDocument/
 * buildIndentOutdentPreviewText below both re-derive everything else
 * fresh from the CURRENT document at read/Apply time (see this section's
 * own top doc comment for why one fresh pass is enough here, unlike
 * every draft-carrying pending edit above).
 */
export interface PendingIndentOutdent {
  kind: PendingIndentOutdentKind;
  childNodeId: string;
  relatedNodeId: string;
}

export type BuildPendingIndentReason = ChildIndentEligibilityReason;
export type BuildPendingIndentResult =
  | { ok: true; pending: PendingIndentOutdent }
  | { ok: false; reason: BuildPendingIndentReason };

/**
 * Phase 5L-11: the ONE entry point view/PartialEditView.ts's own
 * handleRequestIndentChild calls to start a pending indent — re-runs
 * evaluateChildIndentEligibility fresh (never trusts the row's own
 * build-time eligibility snapshot, per this codebase's standing "never
 * guess, always verify" convention) and captures just the two ids the
 * pending transform needs.
 */
export function buildPendingIndent(
  doc: ParsedDocument,
  parentNode: ListBlockNode,
  childNodeId: string
): BuildPendingIndentResult {
  const evaluated = evaluateChildIndentEligibility(doc, parentNode, childNodeId);
  if (!evaluated.ok) {
    return { ok: false, reason: evaluated.reason };
  }
  return { ok: true, pending: { kind: "indent", childNodeId, relatedNodeId: evaluated.siblingNode.id } };
}

export type BuildPendingOutdentReason = ChildOutdentEligibilityReason;
export type BuildPendingOutdentResult =
  | { ok: true; pending: PendingIndentOutdent }
  | { ok: false; reason: BuildPendingOutdentReason };

/** Phase 5L-11: the outdent counterpart of buildPendingIndent immediately above — see that function's own doc comment. */
export function buildPendingOutdent(
  doc: ParsedDocument,
  parentNode: ListBlockNode,
  childNodeId: string
): BuildPendingOutdentResult {
  const evaluated = evaluateChildOutdentEligibility(doc, parentNode, childNodeId);
  if (!evaluated.ok) {
    return { ok: false, reason: evaluated.reason };
  }
  return { ok: true, pending: { kind: "outdent", childNodeId, relatedNodeId: evaluated.currentParentNode.id } };
}

/**
 * Phase 5L-11 §8: "while a transformation is pending, the preview must
 * clearly show the POST-transform hierarchy" — the read-only counterpart
 * of applyParentChildIndentOutdentToDocument's own candidate-construction
 * logic below, built the same way but never re-parsed, validated, or
 * written. A failed re-resolution (the pending transform's own target/
 * related id no longer resolves the way it did when the button was
 * pressed) simply falls back to the UNTRANSFORMED
 * `parentProjection.childSubtreeText`, exactly like every other "can't
 * safely show this, don't guess" fallback in this module — Apply itself
 * independently re-verifies everything from scratch (via
 * applyParentChildIndentOutdentToDocument) and is the only place a stale
 * pending transform is ever actually refused outright.
 */
export function buildIndentOutdentPreviewText(
  doc: ParsedDocument,
  parentNode: ListBlockNode,
  parentProjection: ParentListItemProjection,
  pending: PendingIndentOutdent
): string {
  const fallback = parentProjection.childSubtreeText;
  if (pending.kind === "indent") {
    const evaluated = evaluateChildIndentEligibility(doc, parentNode, pending.childNodeId);
    if (!evaluated.ok || evaluated.siblingNode.id !== pending.relatedNodeId) {
      return fallback;
    }
    const { childNode, siblingNode } = evaluated;
    const childRawText = doc.lines.slice(childNode.range.startLine, childNode.range.endLine + 1).join("\n");
    const siblingRawText = doc.lines.slice(siblingNode.range.startLine, siblingNode.range.endLine + 1).join("\n");
    const prefix = buildIndentPrefix(doc, siblingNode, childNode);
    const childLines = childRawText.split("\n");
    const indentedChildText = growIndent(childLines, 0, childLines.length - 1, prefix).join("\n");
    const newSiblingText = siblingRawText.length > 0 ? siblingRawText + "\n" + indentedChildText : indentedChildText;
    const texts: string[] = [];
    for (const id of parentNode.childIds) {
      if (id === childNode.id) continue;
      if (id === siblingNode.id) {
        texts.push(newSiblingText);
        continue;
      }
      const node = doc.nodes.get(id);
      if (!node || !isListNode(node)) return fallback;
      texts.push(doc.lines.slice(node.range.startLine, node.range.endLine + 1).join("\n"));
    }
    return texts.join("\n");
  }
  const evaluated = evaluateChildOutdentEligibility(doc, parentNode, pending.childNodeId);
  if (!evaluated.ok || evaluated.currentParentNode.id !== pending.relatedNodeId) {
    return fallback;
  }
  const { childNode, currentParentNode } = evaluated;
  const aStart = currentParentNode.range.startLine;
  const aEnd = currentParentNode.range.endLine;
  const bStart = childNode.range.startLine;
  const bEnd = childNode.range.endLine;
  if (bStart < aStart || bEnd > aEnd) return fallback;
  const newSiblingLines = [...doc.lines.slice(aStart, bStart), ...doc.lines.slice(bEnd + 1, aEnd + 1)];
  const newSiblingText = newSiblingLines.join("\n");
  const childRawText = doc.lines.slice(bStart, bEnd + 1).join("\n");
  const columns = Math.max(childNode.indentColumns - currentParentNode.indentColumns, 1);
  const childLines = childRawText.split("\n");
  const dedentedChildText = shrinkIndent(childLines, 0, childLines.length - 1, columns).join("\n");
  const texts: string[] = [];
  for (const id of parentNode.childIds) {
    if (id === currentParentNode.id) {
      texts.push(newSiblingText);
      texts.push(dedentedChildText);
      continue;
    }
    const node = doc.nodes.get(id);
    if (!node || !isListNode(node)) return fallback;
    texts.push(doc.lines.slice(node.range.startLine, node.range.endLine + 1).join("\n"));
  }
  return texts.join("\n");
}

/**
 * Every way applyParentChildIndentOutdentToDocument below refuses to
 * write — always a SAFE REFUSAL (`doc.lines` returned completely
 * untouched, the pending transform itself left exactly as it was),
 * never a partial write:
 *
 *   - "parent-resolve-failed": the parent id no longer resolves, is now
 *     unsafeIndent, or its own own-text/child-subtree ranges can no
 *     longer be safely separated at all.
 *   - "parent-conflict": `parentDirty` was true and the CURRENT parent
 *     own-text range no longer matches `originalParentOwnTextRaw`.
 *   - "subtree-conflict": the CURRENT whole child-subtree text no longer
 *     matches `originalChildSubtreeText` — mirrors ReorderLiveApplyInput's
 *     own whole-subtree conflict check (see that type's own doc comment
 *     for why a structural, whole-shape-touching operation needs this
 *     rather than a per-range check): indent/outdent, like reorder,
 *     touches the whole child subtree's own shape, so ANY external change
 *     anywhere in it since the pending transform was built is a
 *     legitimate conflict.
 *   - "target-resolve-failed": the node being moved (indent: the direct
 *     child; outdent: the nested child) no longer re-resolves the same
 *     way (no longer found, no longer a leaf, now unsafeIndent, now
 *     containing a ComplexBlock in its own continuation).
 *   - "related-resolve-failed": the OTHER node the pending transform
 *     named (indent: the preceding sibling; outdent: the current parent)
 *     no longer resolves the same way, or the live relationship between
 *     it and the target has changed since the transform was built (a
 *     different sibling now immediately precedes the indent target; the
 *     outdent target's current parent is no longer the one recorded).
 *   - "candidate-structure-invalid": the reconstructed candidate, re-
 *     parsed as one mini-document, no longer resolves to a single list
 *     item at line 0 of the expected kind spanning the whole candidate,
 *     or the transformed slot's own new shape (indent: one more child,
 *     the new last one a leaf matching the indented text; outdent: one
 *     fewer child for the former parent, and the newly-INSERTED direct
 *     child a leaf matching the dedented text) doesn't hold.
 *   - "child-count-changed": the candidate's own direct-child count under
 *     `parentNode` doesn't match the expected delta (indent: -1; outdent:
 *     +1).
 *   - "sibling-changed": some OTHER (untouched) direct child's own raw
 *     text, sliced from the candidate at its own expected position, no
 *     longer matches its ORIGINAL raw text byte-for-byte.
 */
export type ChildIndentOutdentApplyRejectReason =
  | "parent-resolve-failed"
  | "parent-conflict"
  | "subtree-conflict"
  | "target-resolve-failed"
  | "related-resolve-failed"
  | "candidate-structure-invalid"
  | "child-count-changed"
  | "sibling-changed";

export interface ApplyParentChildIndentOutdentOutcome {
  changed: boolean;
  lines: string[];
  /** New start line of the (possibly unchanged) parent own-text range — valid whenever `changed` is true. */
  parentNewStartLine: number;
  reason?: ChildIndentOutdentApplyRejectReason;
}

/**
 * Phase 5L-11: the ONE Apply-time entry point for a pending indent/
 * outdent — re-parses/re-resolves everything fresh against `doc` (the
 * CURRENT document; see this section's own top doc comment for why one
 * fresh pass is enough here), builds the candidate the same way
 * buildIndentOutdentPreviewText above already does for the read-only
 * preview (kept as a separate, self-contained computation here since
 * this one additionally needs the mini-reparse validation and the live
 * splice the preview never needs), validates the candidate via one
 * throwaway mini-reparse, and — only once that succeeds — builds the ONE
 * atomic live `lines` replacement (parent own-text range + the whole
 * child-subtree range, exactly like the reorder branch of
 * applyParentChildAddDeleteToDocument above — a structural, whole-shape-
 * touching operation replaces the whole child subtree in one consolidated
 * span rather than several independent per-child splices). Any failure
 * returns `changed: false` with `doc.lines` completely untouched.
 */
export function applyParentChildIndentOutdentToDocument(
  doc: ParsedDocument,
  parentNodeId: string,
  parentDirty: boolean,
  originalParentOwnTextRaw: string,
  newParentOwnTextRaw: string,
  pending: PendingIndentOutdent,
  originalChildSubtreeText: string
): ApplyParentChildIndentOutdentOutcome {
  const fail = (reason: ChildIndentOutdentApplyRejectReason): ApplyParentChildIndentOutdentOutcome => ({
    changed: false,
    lines: doc.lines,
    parentNewStartLine: -1,
    reason,
  });

  const parentNode = doc.nodes.get(parentNodeId);
  if (!parentNode || !isListNode(parentNode) || parentNode.unsafeIndent) {
    return fail("parent-resolve-failed");
  }
  const resolvedParent = resolveParentListItemOwnTextRange(doc, parentNode);
  if (!resolvedParent.ok) {
    return fail("parent-resolve-failed");
  }
  const { ownTextRange: parentOwnTextRange, childSubtreeRange } = resolvedParent.resolution;

  if (parentDirty) {
    const current = doc.lines.slice(parentOwnTextRange.startLine, parentOwnTextRange.endLine + 1).join("\n");
    if (current !== originalParentOwnTextRaw) return fail("parent-conflict");
  }
  const currentChildSubtreeText = doc.lines
    .slice(childSubtreeRange.startLine, childSubtreeRange.endLine + 1)
    .join("\n");
  if (currentChildSubtreeText !== originalChildSubtreeText) {
    return fail("subtree-conflict");
  }

  type ExpectedCandidateSlot =
    | { kind: "unchanged"; originalText: string }
    | { kind: "related" }
    | { kind: "inserted" };

  const candidateChildTexts: string[] = [];
  const expectedSlots: ExpectedCandidateSlot[] = [];
  let expectedChildCount: number;
  let relatedOriginalChildCount: number;
  let newRelatedRawText: string;
  let movedRawText: string; // indented (indent) / dedented (outdent) own text of the moved leaf

  if (pending.kind === "indent") {
    const childNode = doc.nodes.get(pending.childNodeId);
    if (
      !childNode ||
      !isListNode(childNode) ||
      childNode.parentId !== parentNode.id ||
      childNode.childIds.length !== 0 ||
      childNode.unsafeIndent ||
      hasComplexBlockInMultiLineListItemContinuation(doc, childNode)
    ) {
      return fail("target-resolve-failed");
    }
    const index = parentNode.childIds.indexOf(childNode.id);
    if (index <= 0) return fail("target-resolve-failed");
    const siblingId = parentNode.childIds[index - 1];
    if (siblingId !== pending.relatedNodeId) return fail("related-resolve-failed");
    const siblingNode = doc.nodes.get(siblingId);
    if (!siblingNode || !isListNode(siblingNode) || siblingNode.unsafeIndent) {
      return fail("related-resolve-failed");
    }

    const childRawText = doc.lines.slice(childNode.range.startLine, childNode.range.endLine + 1).join("\n");
    const siblingRawText = doc.lines
      .slice(siblingNode.range.startLine, siblingNode.range.endLine + 1)
      .join("\n");
    const prefix = buildIndentPrefix(doc, siblingNode, childNode);
    const childLines = childRawText.split("\n");
    movedRawText = growIndent(childLines, 0, childLines.length - 1, prefix).join("\n");
    newRelatedRawText = siblingRawText + "\n" + movedRawText;
    relatedOriginalChildCount = siblingNode.childIds.length;

    for (const id of parentNode.childIds) {
      if (id === childNode.id) continue;
      if (id === siblingNode.id) {
        candidateChildTexts.push(newRelatedRawText);
        expectedSlots.push({ kind: "related" });
        continue;
      }
      const node = doc.nodes.get(id);
      if (!node || !isListNode(node)) return fail("target-resolve-failed");
      const text = doc.lines.slice(node.range.startLine, node.range.endLine + 1).join("\n");
      candidateChildTexts.push(text);
      expectedSlots.push({ kind: "unchanged", originalText: text });
    }
    expectedChildCount = parentNode.childIds.length - 1;
  } else {
    const childNode = doc.nodes.get(pending.childNodeId);
    if (
      !childNode ||
      !isListNode(childNode) ||
      childNode.childIds.length !== 0 ||
      childNode.unsafeIndent ||
      hasComplexBlockInMultiLineListItemContinuation(doc, childNode)
    ) {
      return fail("target-resolve-failed");
    }
    const currentParentNode = childNode.parentId ? doc.nodes.get(childNode.parentId) : undefined;
    if (
      !currentParentNode ||
      !isListNode(currentParentNode) ||
      currentParentNode.id !== pending.relatedNodeId ||
      currentParentNode.parentId !== parentNode.id ||
      currentParentNode.unsafeIndent
    ) {
      return fail("related-resolve-failed");
    }

    const aStart = currentParentNode.range.startLine;
    const aEnd = currentParentNode.range.endLine;
    const bStart = childNode.range.startLine;
    const bEnd = childNode.range.endLine;
    if (bStart < aStart || bEnd > aEnd) return fail("target-resolve-failed");
    const newSiblingLines = [...doc.lines.slice(aStart, bStart), ...doc.lines.slice(bEnd + 1, aEnd + 1)];
    newRelatedRawText = newSiblingLines.join("\n");
    const childRawText = doc.lines.slice(bStart, bEnd + 1).join("\n");
    const columns = Math.max(childNode.indentColumns - currentParentNode.indentColumns, 1);
    const childLines = childRawText.split("\n");
    movedRawText = shrinkIndent(childLines, 0, childLines.length - 1, columns).join("\n");
    relatedOriginalChildCount = currentParentNode.childIds.length;

    for (const id of parentNode.childIds) {
      if (id === currentParentNode.id) {
        candidateChildTexts.push(newRelatedRawText);
        expectedSlots.push({ kind: "related" });
        candidateChildTexts.push(movedRawText);
        expectedSlots.push({ kind: "inserted" });
        continue;
      }
      const node = doc.nodes.get(id);
      if (!node || !isListNode(node)) return fail("target-resolve-failed");
      const text = doc.lines.slice(node.range.startLine, node.range.endLine + 1).join("\n");
      candidateChildTexts.push(text);
      expectedSlots.push({ kind: "unchanged", originalText: text });
    }
    expectedChildCount = parentNode.childIds.length + 1;
  }

  const combinedChildSubtreeText = candidateChildTexts.join("\n");
  const parentOwnTextForCandidate = parentDirty ? newParentOwnTextRaw : originalParentOwnTextRaw;
  const fullCandidateText =
    combinedChildSubtreeText.length > 0
      ? parentOwnTextForCandidate + "\n" + combinedChildSubtreeText
      : parentOwnTextForCandidate;
  const fullCandidateLines = fullCandidateText.split("\n");
  const candidateDoc = parseDocument(fullCandidateText);
  const candidateNode = candidateDoc.nodes.get("li-0");
  if (
    !candidateNode ||
    !isListNode(candidateNode) ||
    candidateNode.range.startLine !== 0 ||
    candidateNode.ordered !== parentNode.ordered ||
    candidateNode.unsafeIndent ||
    candidateNode.range.endLine !== fullCandidateLines.length - 1
  ) {
    return fail("candidate-structure-invalid");
  }
  if (candidateNode.childIds.length !== expectedChildCount) {
    return fail("child-count-changed");
  }
  if (candidateNode.childIds.length !== expectedSlots.length) {
    // Defensive only — both are derived from the same walk above.
    return fail("candidate-structure-invalid");
  }

  for (let i = 0; i < candidateNode.childIds.length; i++) {
    const candidateChildId = candidateNode.childIds[i];
    const candidateChildNode = candidateDoc.nodes.get(candidateChildId);
    if (!candidateChildNode || !isListNode(candidateChildNode)) {
      return fail("candidate-structure-invalid");
    }
    const candidateRawText = fullCandidateLines
      .slice(candidateChildNode.range.startLine, candidateChildNode.range.endLine + 1)
      .join("\n");
    const expected = expectedSlots[i];
    if (expected.kind === "unchanged") {
      if (candidateRawText !== expected.originalText) {
        return fail("sibling-changed");
      }
      continue;
    }
    if (expected.kind === "inserted") {
      // Outdent only: the newly-arrived direct child must be a leaf
      // whose own raw text is exactly the dedented moved text.
      if (
        candidateChildNode.childIds.length !== 0 ||
        candidateChildNode.unsafeIndent ||
        candidateRawText !== movedRawText
      ) {
        return fail("candidate-structure-invalid");
      }
      continue;
    }
    // expected.kind === "related": the indent destination / outdent
    // source sibling — its own raw text must match what was constructed
    // (newRelatedRawText) byte-for-byte, AND its own child count must
    // reflect exactly the expected delta (indent: +1, with the new LAST
    // child a leaf matching the indented moved text; outdent: -1, its
    // pre-existing remaining children otherwise untouched — already
    // implied by the byte-for-byte match on `newRelatedRawText`, which
    // was itself built by literally removing the moved node's own
    // contiguous line range and nothing else).
    if (candidateRawText !== newRelatedRawText) {
      return fail("candidate-structure-invalid");
    }
    if (pending.kind === "indent") {
      if (candidateChildNode.childIds.length !== relatedOriginalChildCount + 1) {
        return fail("candidate-structure-invalid");
      }
      const lastChildId = candidateChildNode.childIds[candidateChildNode.childIds.length - 1];
      const lastChildNode = candidateDoc.nodes.get(lastChildId);
      if (!lastChildNode || !isListNode(lastChildNode) || lastChildNode.childIds.length !== 0 || lastChildNode.unsafeIndent) {
        return fail("candidate-structure-invalid");
      }
      const lastChildRawText = fullCandidateLines
        .slice(lastChildNode.range.startLine, lastChildNode.range.endLine + 1)
        .join("\n");
      if (lastChildRawText !== movedRawText) {
        return fail("candidate-structure-invalid");
      }
    } else {
      if (candidateChildNode.childIds.length !== relatedOriginalChildCount - 1) {
        return fail("candidate-structure-invalid");
      }
    }
  }

  // Every check above passed against a candidate built from the CURRENT
  // document (already confirmed, via the whole-subtree conflict check,
  // to be byte-for-byte identical to `originalChildSubtreeText`) — so the
  // SAME `combinedChildSubtreeText` is safe to write live as one
  // consolidated span replacing the whole child-subtree range, exactly
  // like the reorder branch of applyParentChildAddDeleteToDocument above.
  interface Span {
    startLine: number;
    endLine: number;
    lines: string[];
  }
  const spans: Span[] = [
    {
      startLine: parentOwnTextRange.startLine,
      endLine: parentOwnTextRange.endLine,
      lines: parentDirty
        ? newParentOwnTextRaw.split("\n")
        : doc.lines.slice(parentOwnTextRange.startLine, parentOwnTextRange.endLine + 1),
    },
    {
      startLine: childSubtreeRange.startLine,
      endLine: childSubtreeRange.endLine,
      lines: combinedChildSubtreeText.length > 0 ? combinedChildSubtreeText.split("\n") : [],
    },
  ];
  spans.sort((a, b) => b.startLine - a.startLine);
  let lines = doc.lines.slice();
  for (const s of spans) {
    lines = [...lines.slice(0, s.startLine), ...s.lines, ...lines.slice(s.endLine + 1)];
  }

  return { changed: true, lines, parentNewStartLine: parentOwnTextRange.startLine };
}

// =======================================================================
// Phase 5L-9b ("First Direct Child Addition for Leaf List Items — Mode
// B"): lets a STANDALONE leaf list item (`childIds.length === 0` — every
// node Phase 5L-1〜5L-5's own four standalone projections already project
// as an own-text-only leaf, see each of those modules' own top doc
// comments) gain its very first direct child from the SAME Partial Edit
// Pane, without ever leaving it. Phase 5L-9 ("Mode A", above) already
// lets an EXISTING parent (`childIds.length > 0`) add/delete/reorder/
// indent/outdent its direct children; this section is deliberately its
// own separate, narrower slice — the ONE case Mode A structurally cannot
// reach at all, since `buildParentChildAddDeleteSession` (and every
// sibling Phase 5L-8/10/11 entry point) only ever runs alongside a
// non-null `standaloneParentListItemProjection`, which
// view/PartialEditView.ts#loadNodeInternal only ever builds for a node
// with `childIds.length > 0` (see that method's own Phase 5L-6 doc
// comment on its five-tier priority chain).
//
// ---- Reuse, never re-implementation (mirrors every sibling section's
// own "Reuse, never re-implementation" discipline) ----
//
//   - Canonical first-child shape/indentation: `buildNewChildDraft`/
//     `computeNewChildIndent`/`buildCanonicalNewChildRawText` above (Mode
//     A's own new-child helpers) are called UNCHANGED, passing the leaf
//     node itself as `parentNode`. `computeNewChildIndent`'s own
//     `lastChildNode === null` branch (this leaf always has zero
//     children, so `lastChildId` is always null) is EXACTLY the "no
//     sibling to match — one TAB_WIDTH step past the parent's own indent"
//     fallback that branch already implements for a genuinely-empty
//     parent — Mode B needed no new indentation logic at all, only a
//     caller that happens to always land in that one pre-existing branch.
//   - The pending child's own inline editor UI
//     (view/PartialEditView.ts#newChildEditorEl/newChildTextareaEl):
//     reused verbatim — see this ticket's own design doc §7.6 for why a
//     `PendingLeafFirstChild`'s own `draft` field is read by
//     `renderNewChildEditor`/`isNewChildDraftDirty` alongside (never
//     instead of) `childAddDeleteSession?.newChildDraft`, the exact same
//     `NewChildDraft` shape either way.
//   - The leaf's own OWN-TEXT draft: never re-projected or re-invented —
//     `applyLeafFirstChildAdditionToDocument` below is handed the SAME
//     already-inverted raw text view/PartialEditView.ts's own four
//     existing standalone-leaf Apply branches already compute today (via
//     invertListMarkerProjection/invertTaskListProjection/
//     invertOrderedListProjection/invertMultiLineListItemProjection,
//     entirely unmodified), never a fifth, duplicate inversion path.
//   - The actual document splice: `edit/partialEdit.ts#applySubtreeEdit`
//     — the exact SAME generic "re-extract fresh, compare to the pane's
//     own before-editing snapshot, refuse on any mismatch, otherwise
//     splice" primitive every one of the four existing standalone-leaf
//     Apply branches already calls for a plain body-only edit. This is
//     what Mode A's own two-stage own-text/child-subtree-snapshot design
//     (edit/parentListItemProjection.ts's own top doc comment) exists to
//     avoid needing: an EXISTING parent's own-text range and its child
//     subtree range are two SEPARATE spans of an already-multi-child
//     node.range, so a combined Apply there needs a two-span splice.
//     Mode B's own leaf, by definition, still has `childIds.length ===
//     0` at the moment Apply runs (re-verified fresh below) — its own
//     `node.range` covers ONLY its own-text lines, nothing else — so
//     "the leaf's own edited own-text, plus the new child's own canonical
//     line(s), joined by one newline" is already the ENTIRE new range
//     content, appliable as a single ordinary applySubtreeEdit splice,
//     no new multi-span write primitive needed.
//
// ---- Eligibility: the union of the four existing standalone-leaf
// structural gates, never a fifth independently-drifting copy ----
//
// `evaluateLeafFirstChildEligibility` below checks exactly the three
// STRUCTURAL conditions every one of
// isStandaloneListItemEligibleForMarkerFreeProjection/
// isStandaloneTaskListItemEligibleForMarkerFreeProjection/
// isStandaloneOrderedListItemEligibleForMarkerFreeProjection/
// isStandaloneMultiLineLeafListItemEligibleForProjection already checks
// in common (`childIds.length === 0`, `!unsafeIndent`, and — for a
// multi-line item only — no ComplexBlock in its own continuation, via
// hasComplexBlockInMultiLineListItemContinuation, reused verbatim): the
// `.ordered`/single-vs-multi-line distinctions those four gates ALSO each
// check are irrelevant here, since Mode B does not care WHICH of the four
// shapes the leaf is, only that it is one of them. It deliberately does
// NOT re-check text-level projectability (buildChildLeafProjection or any
// per-kind builder) — view/PartialEditView.ts's own Add-button visibility
// is gated on one of the four `standalone*Projection` fields already
// being non-null (i.e. already having built successfully at load time —
// see that file's own renderLeafFirstChildAddRow), and Apply-time safety
// against a raw-text change since then is already fully covered by
// applySubtreeEdit's own byte-for-byte conflict check against the
// pane's own `originalText` snapshot — a node whose own-text is
// unchanged since a successful load necessarily still builds the exact
// same projection it did then.
// =======================================================================

export type LeafFirstChildEligibilityReason =
  | "leaf-not-found"
  | "leaf-has-children"
  | "leaf-unsafe-indent"
  | "leaf-complex-block";

export type LeafFirstChildEligibilityResult =
  | { ok: true; leafNode: ListBlockNode }
  | { ok: false; reason: LeafFirstChildEligibilityReason };

/**
 * Whether `leafNodeId` can gain a first direct child at all right now —
 * the ONE eligibility check both view/PartialEditView.ts's own "show the
 * Mode B Add-child affordance" decision and `buildPendingLeafFirstChild`/
 * `applyLeafFirstChildAdditionToDocument` below ever run, never
 * independently-drifting copies (mirrors evaluateChildInlineEditEligibility's
 * own identical "one check, every caller" role for Mode A). Resolves
 * `leafNodeId` fresh against `doc` every call — never trusts a caller-held
 * node — exactly like every sibling eligibility function in this module.
 */
export function evaluateLeafFirstChildEligibility(
  doc: ParsedDocument,
  leafNodeId: string
): LeafFirstChildEligibilityResult {
  const leafNode = doc.nodes.get(leafNodeId);
  if (!leafNode || !isListNode(leafNode)) {
    return { ok: false, reason: "leaf-not-found" };
  }
  if (leafNode.childIds.length !== 0) {
    return { ok: false, reason: "leaf-has-children" };
  }
  if (leafNode.unsafeIndent) {
    return { ok: false, reason: "leaf-unsafe-indent" };
  }
  if (hasComplexBlockInMultiLineListItemContinuation(doc, leafNode)) {
    return { ok: false, reason: "leaf-complex-block" };
  }
  return { ok: true, leafNode };
}

/**
 * A pending "promote this leaf to a parent by giving it a first child"
 * draft — `leafNodeId` is the leaf itself (which Apply will turn INTO the
 * parent; there is no separate "parent id" the way Mode A always has one
 * already), `draft` is the SAME `NewChildDraft` shape Mode A's own
 * `buildNewChildDraft` already produces (§3's own fixed canonical shape:
 * unordered, non-task, marker `-`, empty body).
 */
export interface PendingLeafFirstChild {
  leafNodeId: string;
  draft: NewChildDraft;
}

/** `"not-projectable"` is defensive only, same rationale as NewChildDraftBuildReason above — buildCanonicalNewChildRawText's own fixed output is always projectable. */
export type BuildPendingLeafFirstChildReason = LeafFirstChildEligibilityReason | "not-projectable";

export type BuildPendingLeafFirstChildResult =
  | { ok: true; pending: PendingLeafFirstChild }
  | { ok: false; reason: BuildPendingLeafFirstChildReason };

/**
 * Build a fresh `PendingLeafFirstChild` for `leafNodeId` — the ONE entry
 * point view/PartialEditView.ts's own Mode B "Add child item" button
 * handler ever calls (mirroring `buildPendingIndent`/`buildPendingOutdent`'s
 * own identical "re-verify fresh from the current document, never trust
 * the button's own row-level snapshot" discipline). `doc` must be a FRESH
 * parse of the CURRENT document, same convention as `buildNewChildDraft`
 * itself.
 */
export function buildPendingLeafFirstChild(
  doc: ParsedDocument,
  leafNodeId: string
): BuildPendingLeafFirstChildResult {
  const eligibility = evaluateLeafFirstChildEligibility(doc, leafNodeId);
  if (!eligibility.ok) {
    return { ok: false, reason: eligibility.reason };
  }
  const built = buildNewChildDraft(doc, eligibility.leafNode);
  if (!built.ok) {
    return { ok: false, reason: "not-projectable" };
  }
  return { ok: true, pending: { leafNodeId, draft: built.draft } };
}

/**
 * Every way Mode B's Apply is refused — an APPLY-TIME-ONLY refusal, never
 * conflated with a (load-time/click-time) eligibility reason, mirroring
 * every sibling ApplyRejectReason union's own identical split:
 *
 *   - the four `LeafFirstChildEligibilityReason` values: the leaf is no
 *     longer eligible at all by the time Apply actually runs (deleted,
 *     gained a child, became unsafeIndent, or grew a ComplexBlock
 *     continuation — each re-checked fresh, never trusted from
 *     click time).
 *   - `"own-text-conflict"`: the leaf's own current raw text (re-extracted
 *     fresh) no longer matches the pane's own "before editing" snapshot —
 *     applySubtreeEdit's own conflict check, surfaced under this
 *     module's own naming convention rather than the generic
 *     `"conflict"` reason a caller would otherwise have to translate.
 *   - `"candidate-structure-invalid"`: defensive only — a fresh re-parse
 *     of the just-spliced candidate did not show EXACTLY the expected
 *     shape (the leaf now a parent of exactly one direct child, that
 *     child itself a single-line unordered non-task leaf whose own raw
 *     text is byte-for-byte the canonical text this same Apply just
 *     inserted) — this codebase's standing "never guess, always verify"
 *     convention applied to a case this module's own author could not
 *     otherwise construct a real failing fixture for, same status as
 *     every sibling module's own analogous defensive reason.
 */
export type ApplyLeafFirstChildRejectReason =
  | LeafFirstChildEligibilityReason
  | "own-text-conflict"
  | "new-child-unsafe-structure"
  | "candidate-structure-invalid";

export type ApplyLeafFirstChildOutcome =
  | { ok: true; lines: string[]; newStartLine: number }
  | { ok: false; reason: ApplyLeafFirstChildRejectReason };

/**
 * Apply `pending` (Mode B's own single pending-first-child draft) to
 * `doc` — the ONE entry point view/PartialEditView.ts's own Mode B Apply
 * handler ever calls. `originalOwnText` is the pane's own "before
 * editing" snapshot (`this.originalText`, unchanged since load);
 * `newOwnTextRawText` is that SAME leaf's own-text, already inverted by
 * the caller via whichever of the four existing standalone-leaf
 * invert*Projection functions applies (never re-inverted here — see this
 * section's own top "Reuse, never re-implementation" doc comment).
 *
 * `childBodyDirty`/`editedChildBody` are the pending first child's own
 * inline-editor state — mirrors `invertAndValidateParentChildAddDeleteEdit`'s
 * own `newChildDirty`/`editedNewChildBody` handling of Mode A's new-child
 * draft EXACTLY: when the child's body is untouched (still the canonical
 * empty draft), `childProjectionRawText(pending.draft.projection)` is
 * used as-is; when it's dirty, `invertChildLeafProjection` (the SAME
 * generic per-kind dispatch Mode A's own new-child draft and the
 * existing-child inline editor both already use, called with
 * `editedChecked=false`/`editedNumberText=""` since `NewChildDraft` is
 * always the "unordered" kind — see that type's own doc comment)
 * reconstructs the child's real raw text from the edited body. A body
 * that can't be safely reconstructed (a newline, for the single-line
 * "unordered" kind this draft always has) is rejected via
 * `"new-child-unsafe-structure"` — the caller's draft/own-text are left
 * completely untouched, same as every other rejection reason below.
 *
 * Combines the parent's own (possibly-edited) own-text with the new
 * child's own (possibly-edited) raw text as ONE joined multi-line string
 * and hands it to `applySubtreeEdit` as a single ordinary splice — see
 * this section's own top doc comment for why a leaf with
 * `childIds.length === 0` never needs Mode A's own two-span own-text/
 * child-subtree design.
 */
export function applyLeafFirstChildAdditionToDocument(
  doc: ParsedDocument,
  leafNodeId: string,
  originalOwnText: string,
  newOwnTextRawText: string,
  pending: PendingLeafFirstChild,
  childBodyDirty: boolean,
  editedChildBody: string
): ApplyLeafFirstChildOutcome {
  const eligibility = evaluateLeafFirstChildEligibility(doc, leafNodeId);
  if (!eligibility.ok) {
    return { ok: false, reason: eligibility.reason };
  }
  let childRawText = childProjectionRawText(pending.draft.projection);
  if (childBodyDirty) {
    const inverted = invertChildLeafProjection(pending.draft.projection, false, "", editedChildBody);
    if (!inverted.ok) {
      return { ok: false, reason: "new-child-unsafe-structure" };
    }
    childRawText = inverted.rawText;
  }
  const combined = newOwnTextRawText + "\n" + childRawText;
  const outcome = applySubtreeEdit(doc, leafNodeId, originalOwnText, combined);
  if (!outcome.changed) {
    return { ok: false, reason: "own-text-conflict" };
  }

  // Candidate validation — re-parse the JUST-SPLICED result fresh and
  // confirm it shows exactly the expected shape. Node ids in this
  // parser are assigned by document-order sequence (parser/parseDocument.ts),
  // never randomly — since this splice only ever REPLACES `leafNodeId`'s
  // own existing range with itself plus one appended line (never
  // inserting anything BEFORE it), `leafNodeId` itself is guaranteed to
  // still resolve to the same logical node in this fresh re-parse, same
  // "id stays stable across a same-position edit" property every sibling
  // Phase 5L-9/5L-10/5L-11 candidate re-parse already relies on.
  const candidateDoc = parseDocument(outcome.lines.join("\n"));
  const candidateNode = candidateDoc.nodes.get(leafNodeId);
  if (!candidateNode || !isListNode(candidateNode) || candidateNode.childIds.length !== 1) {
    return { ok: false, reason: "candidate-structure-invalid" };
  }
  const candidateChildId = candidateNode.childIds[0];
  const candidateChildNode = candidateDoc.nodes.get(candidateChildId);
  if (
    !candidateChildNode ||
    !isListNode(candidateChildNode) ||
    candidateChildNode.ordered ||
    candidateChildNode.childIds.length !== 0 ||
    candidateChildNode.range.startLine !== candidateChildNode.range.endLine
  ) {
    return { ok: false, reason: "candidate-structure-invalid" };
  }
  const candidateChildRawText = candidateDoc.lines
    .slice(candidateChildNode.range.startLine, candidateChildNode.range.endLine + 1)
    .join("\n");
  if (candidateChildRawText !== childRawText) {
    return { ok: false, reason: "candidate-structure-invalid" };
  }

  return { ok: true, lines: outcome.lines, newStartLine: outcome.newStartLine };
}
