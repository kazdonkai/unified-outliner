/**
 * Phase 3B: Partial Edit Pane (docs/別ペイン実装計画と当面の実装指示.md, forward-looking
 * §7 in spirit — this view is new territory beyond what that doc's earlier
 * phases covered).
 *
 * A focused editing pane for exactly ONE subtree at a time, opened from
 * the Outline Tree View's right-click menu. This is NOT an alternate
 * full-document editor: the original note is always the single source of
 * truth, and this pane only ever holds a temporary, explicitly-applied
 * copy of one subtree's raw Markdown (heading + body + child sections +
 * lists for a section, per section-subtree; item + nested children for a list, per
 * Phase 4A's relocateListSubtree — the exact same range every other
 * block-scoped command already treats as one unit).
 *
 * Deliberately explicit-save, not live-synced: edits made here stay local
 * to the pane's textarea until the user clicks Apply. There is no
 * autosave and no real-time two-way sync with the body editor — see the
 * README's Phase 3B section for the full list of what this phase
 * intentionally does not attempt (multi-node editing, cross-note editing,
 * diff/merge UI, conflict resolution beyond a simple before/after text
 * comparison).
 *
 * Node resolution and the actual text splice are both delegated to
 * ../edit/partialEdit.ts (Obsidian-free, unit-tested) — this view only
 * wires that pure logic to a textarea and to the active note's Editor via
 * ../commands/applyLineEditOutcome.ts, exactly like every other
 * tree-triggered command in this plugin.
 *
 * Phase 4C (list subtrees): originally section-only, this view now loads
 * either kind via the same loadNode()/applyEdit() path — the generalized
 * extractSubtreeText/applySubtreeEdit (edit/partialEdit.ts) don't care
 * which kind of node they're resolving, so nothing here branches on
 * section vs. list except the header label (renderLoadedState below) and
 * the small "(Empty list item)" vs "(Untitled heading)" placeholder text used
 * when a node's own label is empty. Everything else — the textarea, the
 * Apply/Cancel/Close buttons, the conflict check, the unsafeIndent
 * refusal for list nodes — is one shared code path.
 *
 * Real-device follow-up: the header's Apply/Cancel row also has a one-click
 * × (close) button, `this.leaf.detach()` under the hood — before this,
 * closing the pane required Obsidian's own tab-close affordances (the
 * tab's native × or the right-click "Close tab" menu item), a two-step
 * detour compared to every other button on this pane's own header. Closing
 * this way still never applies pending edits, exactly like Cancel and the
 * pre-existing onClose() already didn't.
 *
 * Further real-device follow-up: Apply/Cancel/Close are now each shown
 * conditionally rather than unconditionally whenever a node is loaded —
 * see updateDirtyState (Apply/Cancel only appear once the textarea
 * actually differs from the loaded snapshot) and updateCloseButtonVisibility
 * (this pane's own × only appears where Obsidian doesn't already draw a
 * native tab ×, i.e. while docked directly in the left/right sidebar —
 * see that method's doc comment for the sidebar-vs-tab/popout distinction).
 *
 * Phase 5B (docs/phase5-implementation-plan.md): adds an ancestor
 * breadcrumb below the header row, so the pane (including a popped-out
 * window with no Outline Tree in sight) still shows where the loaded node
 * sits in the document. The node-loading entry point is now split in two:
 * loadNodeInternal (private, unconditional — the old loadNode, renamed)
 * and requestLoadNode (public, the ONLY sanctioned external entry point),
 * which guards loadNodeInternal behind an Apply/Discard/Cancel prompt
 * whenever the pane has an unapplied edit. Every caller that used to reach
 * this pane's loadNode directly — main.ts's activatePartialEditView, and
 * now this file's own breadcrumb segment clicks — goes through
 * requestLoadNode instead, so "switch node" always means the same thing
 * regardless of which UI triggered it. See requestLoadNode's own doc
 * comment for the full rationale.
 *
 * Subtree Navigator (post-Phase-5B follow-up): the downward counterpart to
 * the ancestor breadcrumb above. A third header row (renderSubtreeNavigator)
 * shows the loaded node's own direct children (tree/descendantPath.ts) as
 * clickable chips, so a user can descend into a subtree one level at a
 * time from inside the pane — including a popped-out window with no
 * Outline Tree visible — the same way the breadcrumb lets them climb back
 * up. Every chip (and its overflow Menu, when there are more children than
 * fit inline) calls requestLoadNode, never loadNodeInternal directly, so
 * descending shares the exact same dirty-guard/Apply-Discard-Cancel
 * behavior as breadcrumb and Tree navigation — see requestLoadNode's doc
 * comment, unchanged by this addition.
 *
 * Sibling前後移動 (docs/phase5b_sibling-navigation-spec.md): the sideways
 * counterpart to both of the above. A fourth header row (renderSiblingNav),
 * between the breadcrumb and the Subtree Navigator, holds two buttons —
 * previous/next sibling of the loaded node, resolved by
 * tree/siblingNavigation.ts directly from the node's existing
 * `prevSiblingId`/`nextSiblingId` (no new sibling-order computation). Both
 * buttons call requestLoadNode exactly like every other navigation control
 * on this pane — no new projection path, no new dirty guard. Unlike the
 * breadcrumb and Subtree Navigator (hidden entirely when empty), this row
 * stays visible whenever a node is loaded and disables whichever button has
 * no target, per the spec's §3 UI 仕様.
 *
 * Phase 5C-4 (2026-08-14, "Standalone Callout / Blockquote の Partial Edit
 * Popout 完成と元ノート同一性の安全化"): adds an "Open in new window" menu
 * item for standalone (non-composite-member) callout/blockquote rows (see
 * view/OutlineTreeView.ts's showStandaloneComplexBlockMenu) — reusing this
 * pane's pre-existing, unchanged Phase 5A popout support
 * (activatePartialEditView's `openInNewWindow` option) rather than adding
 * any new window-management code here. This ticket also adds `sourcePath`
 * — the file path of the note this pane's currently-loaded node was
 * actually read from, recorded once per loadNodeInternal call — as an
 * ADDITIONAL, path-based safety valve checked by applyEdit before its
 * existing content-based conflict check, never a replacement for it. See
 * view/partialEditSourceNoteCheck.ts's own doc comment for the full
 * rationale (popout makes "switch notes in the other window, then Apply"
 * an easier mistake to make than it was while the pane was always docked).
 *
 * Phase 5P-2 (2026-08-17, paragraph Partial Edit hoist): adds a SECOND,
 * parallel "what is loaded" identity — `paragraphAnchor` — alongside the
 * existing `nodeId`/`nodeKind` pair above, rather than folding a paragraph
 * into the nodeId-based model. A paragraph has no BlockNode/ComplexBlockInfo
 * id known in advance (the only entry point is a body-editor cursor line —
 * resolver/resolveParagraphAtCursor.ts) and its Apply-time safety contract
 * needs extra parentId/depth re-verification callout/blockquote's existing
 * id-only path has no equivalent for (see edit/paragraphPartialEdit.ts's own
 * doc comment) — reusing extractSubtreeText/applySubtreeEdit's contract
 * as-is would silently drop that extra check. Exactly one of `nodeId` /
 * `paragraphAnchor` is ever non-null at a time (both loadNodeInternal and
 * loadParagraphInternal below clear the other). A loaded paragraph
 * deliberately shows none of the breadcrumb / sibling-nav / Subtree
 * Navigator rows — `ancestors`/`directChildren`/`siblingState` all stay at
 * their empty-state values (mirroring the existing standalone
 * callout/blockquote path, which also leaves them empty), and
 * renderSiblingNav's own visibility check already hinges on `nodeId`
 * specifically (null for a loaded paragraph), so it stays hidden with no
 * further change needed. This is intentional, approved 5P-2 scope — no
 * Tree-based paragraph selection, no always-on Tree display, no paragraph
 * D&D/rename/insert/delete; see resolver/resolveParagraphAtCursor.ts's own
 * doc comment for the full non-goal list.
 */
import {
  App,
  Editor,
  ItemView,
  MarkdownFileInfo,
  MarkdownView,
  Menu,
  Modal,
  Notice,
  TAbstractFile,
  TFile,
  WorkspaceLeaf,
  debounce,
  setIcon,
  setTooltip,
} from "obsidian";
import type UnifiedOutlinerPlugin from "../main";
import { parseDocument } from "../parser/parseDocument";
import { applySubtreeEdit, extractSubtreeText, SubtreeKind } from "../edit/partialEdit";
import {
  nodeDisplayLabel,
  standaloneComplexBlockLabel,
  STANDALONE_CALLOUT_PREFIX,
} from "../tree/buildOutlineTree";
import { scanComplexBlocks } from "../parser/complexBlocks";
import { BlockNode, isListNode, ListBlockNode, ParsedDocument } from "../model/block";
import { AncestorPathEntry, findAncestorPath } from "../tree/ancestorPath";
import { DescendantNavigationEntry, findDirectChildren } from "../tree/descendantPath";
import { SiblingNavigationState, getSiblingNavigationState } from "../tree/siblingNavigation";
import { applyLineEditOutcome } from "../commands/applyLineEditOutcome";
import { checkPartialEditSourceNote } from "./partialEditSourceNoteCheck";
import { TranslationKey } from "../i18n";
import { resolveParagraphAtCursor } from "../resolver/resolveParagraphAtCursor";
import {
  applyParagraphEdit,
  buildParagraphEditAnchor,
  ParagraphEditAnchor,
  resolveParagraphAnchorText,
} from "../edit/paragraphPartialEdit";
import { classifySyncOutcome, shouldRunStaleCheck } from "./partialEditSyncClassification";
import {
  buildQuotePrefixProjection,
  CalloutFoldMarker,
  invertQuotePrefixProjection,
  projectedDisplayText,
  QuotePrefixProjection,
  reconstructQuoteHeader,
} from "../edit/quotePrefixProjection";
import {
  applyCompositeBlockEdit,
  compositePartialEditReasonText,
  extractCompositeBlockText,
} from "../edit/compositeBlockPartialEdit";
import { CompositeBlockSnapshot } from "../edit/deleteCompositeBlock";
import {
  composeCompositeBlockMemberText,
  isListMemberEligibleForMarkerFreeProjection,
  splitCompositeBlockMembers,
} from "../edit/compositeBlockMemberProjection";
import {
  buildListMarkerProjection,
  invertListMarkerProjection,
  ListMarkerProjection,
  projectedListBodyText,
} from "../edit/listMarkerProjection";
import {
  buildTaskListProjection,
  invertTaskListProjection,
  projectedTaskBodyText,
  TaskListProjection,
} from "../edit/taskListProjection";
import {
  buildOrderedListProjection,
  invertOrderedListProjection,
  projectedOrderedBodyText,
  projectedOrderedNumberText,
  OrderedListProjection,
} from "../edit/orderedListProjection";
import {
  MultiLineListItemProjection,
  buildMultiLineListItemProjection,
  invertMultiLineListItemProjection,
  projectedMultiLineBodyText,
  projectedMultiLineChecked,
  projectedMultiLineNumberText,
} from "../edit/multiLineListItemProjection";
import {
  ParentChildPreviewNavigationTarget,
  ParentListItemProjection,
  applyParentListItemOwnTextEdit,
  invertParentListItemProjection,
  projectedParentBodyText,
  projectedParentChecked,
  projectedParentNumberText,
  resolveParentChildPreviewNavigationTarget,
} from "../edit/parentListItemProjection";
import { resolveStandaloneListProjections as resolveStandaloneListProjectionsPure } from "../edit/standaloneProjectionResolver";
import {
  ParentChildCombinedApplyRejectReason,
  ParentChildInlineEditSession,
  ParentChildLiveApplyRejectReason,
  applyParentChildInlineEditToDocument,
  buildParentChildInlineEditSession,
  childEffectiveControlKind,
  childProjectionRawText,
  evaluateChildInlineEditEligibility,
  invertAndValidateParentChildCombinedEdit,
  projectedChildBodyText,
  projectedChildChecked,
  projectedChildNumberText,
} from "../edit/parentChildInlineEditSession";
// Phase 5L-9 ("Direct Child Add/Delete in Parent Partial Edit Pane"):
// extends the SAME module — see that module's own Phase 5L-9 section for
// why this is additive to, never a duplicate of, everything imported
// immediately above.
import {
  ParentChildAddDeleteApplyRejectReason,
  ParentChildAddDeleteLiveApplyRejectReason,
  ParentChildAddDeleteSession,
  applyParentChildAddDeleteToDocument,
  buildNewChildDraft,
  buildParentChildAddDeleteSession,
  evaluateChildDeleteEligibility,
  invertAndValidateParentChildAddDeleteEdit,
} from "../edit/parentChildInlineEditSession";
// Phase 5L-10 ("Direct Child Leaf Reorder in Parent Partial Edit Pane"):
// extends the SAME module yet again — see that module's own Phase 5L-10
// section for why this is additive to, never a duplicate of, everything
// imported immediately above.
import {
  ChildReorderDirection,
  ReorderLiveApplyInput,
  evaluateChildReorderEligibility,
  isPendingReorderDirty,
  moveChildInPendingReorder,
} from "../edit/parentChildInlineEditSession";
// Phase 5L-11 ("Direct Child Leaf Indent/Outdent in Parent Partial Edit
// Pane"): extends the SAME module yet again — see that module's own
// Phase 5L-11 section for why this is additive to, never a duplicate of,
// everything imported immediately above.
import {
  ChildIndentOutdentApplyRejectReason,
  applyParentChildIndentOutdentToDocument,
  buildIndentOutdentPreviewText,
  buildPendingIndent,
  buildPendingOutdent,
  evaluateChildIndentEligibility,
  evaluateChildOutdentEligibility,
} from "../edit/parentChildInlineEditSession";
// Phase 5L-9b ("First Direct Child Addition for Leaf List Items — Mode
// B"): extends the SAME module yet again — see that module's own Phase
// 5L-9b section for why this is additive to, never a duplicate of,
// everything imported immediately above.
import {
  ApplyLeafFirstChildRejectReason,
  PendingLeafFirstChild,
  applyLeafFirstChildAdditionToDocument,
  buildPendingLeafFirstChild,
} from "../edit/parentChildInlineEditSession";
import { compositeBlockDisplayLabel, getCompositeBlockRuleById } from "../model/compositeBlock";
import { getEnabledCompositeBlockRules } from "../settingsDefaults";

export const PARTIAL_EDIT_VIEW_TYPE = "unified-outliner-partial-edit";

/**
 * Phase 5L-8: maps invertAndValidateParentChildCombinedEdit's own exhaustive
 * reason union onto this pane's Notice i18n keys — a small many-to-few
 * mapping (several structurally-related reasons share one user-facing
 * message), mirroring how applyEdit's existing standaloneParentListItemProjection
 * branch already maps invertParentListItemProjection's own reasons. Kept as
 * a free function (not a method) since it needs no `this` — pure dispatch.
 */
function parentChildCombinedApplyReasonKey(reason: ParentChildCombinedApplyRejectReason): TranslationKey {
  switch (reason) {
    case "parent-invalid-number":
    case "child-invalid-number":
      return "partialEdit.orderedNumberInvalid";
    case "parent-own-text-unsafe-structure":
      return "partialEdit.parentOwnTextStructureInvalid";
    case "parent-child-subtree-detached":
    case "parent-child-subtree-changed":
      return "partialEdit.parentChildSubtreeStructureInvalid";
    case "child-unsafe-structure":
      return "partialEdit.parentChildInlineEditChildStructureInvalid";
    case "candidate-structure-invalid":
    case "child-count-changed":
    case "child-no-longer-leaf":
    case "sibling-changed":
      return "partialEdit.parentChildInlineEditCandidateInvalid";
  }
}

/** Phase 5L-8: the LIVE-write counterpart of parentChildCombinedApplyReasonKey immediately above — see applyParentChildInlineEditToDocument's own reason type doc comment (edit/parentChildInlineEditSession.ts) for the exhaustive per-reason rationale. */
function parentChildLiveApplyReasonKey(reason: ParentChildLiveApplyRejectReason | undefined): TranslationKey {
  switch (reason) {
    case "parent-conflict":
    case "child-conflict":
      return "partialEdit.parentChildInlineEditConflict";
    case "parent-resolve-failed":
    case "child-resolve-failed":
    case "not-direct-child":
    case "child-has-children":
    case "child-unsafe-indent":
    case "range-overlap":
    case undefined:
      return "partialEdit.parentChildInlineEditResolveFailed";
  }
}

/**
 * Phase 5L-9: the add/delete counterpart of parentChildCombinedApplyReasonKey
 * above — reuses every one of that function's own mappings verbatim for
 * the ten reasons ParentChildAddDeleteApplyRejectReason inherits from
 * ParentChildCombinedApplyRejectReason (see that type's own doc comment
 * in edit/parentChildInlineEditSession.ts), and adds ONLY the three
 * genuinely new reasons this ticket introduces.
 */
function parentChildAddDeleteApplyReasonKey(reason: ParentChildAddDeleteApplyRejectReason): TranslationKey {
  switch (reason) {
    case "new-child-unsafe-structure":
      return "partialEdit.parentChildNewChildStructureInvalid";
    case "new-child-not-leaf":
    case "deletion-target-missing":
    // Phase 5L-10: both defensive-only reasons (see their own doc
    // comments in edit/parentChildInlineEditSession.ts) map to the same
    // generic "candidate invalid" Notice every other defensive
    // candidate-structure reason already uses — no new i18n key needed.
    // falls through
    case "reorder-not-available":
    case "reorder-target-missing":
      return "partialEdit.parentChildInlineEditCandidateInvalid";
    default:
      return parentChildCombinedApplyReasonKey(reason);
  }
}

/** Phase 5L-9: the LIVE-write counterpart of parentChildAddDeleteApplyReasonKey immediately above — see applyParentChildAddDeleteToDocument's own reason type doc comment (edit/parentChildInlineEditSession.ts) for the exhaustive per-reason rationale. Every reason maps to one of the SAME two Notices parentChildLiveApplyReasonKey above already uses (a conflict, or a structural resolve failure) — no new i18n key needed here. */
function parentChildAddDeleteLiveApplyReasonKey(reason: ParentChildAddDeleteLiveApplyRejectReason | undefined): TranslationKey {
  switch (reason) {
    case "parent-conflict":
    case "existing-child-conflict":
    case "deletion-target-conflict":
      return "partialEdit.parentChildInlineEditConflict";
    case "parent-resolve-failed":
    case "existing-child-resolve-failed":
    case "existing-child-not-direct-child":
    case "existing-child-has-children":
    case "existing-child-unsafe-indent":
    case "deletion-target-resolve-failed":
    case "deletion-target-not-direct-child":
    case "deletion-target-has-children":
    case "deletion-target-unsafe-indent":
    case "range-overlap":
    // Phase 5L-10: "reorder-target-resolve-failed" is the reorder's own
    // structural-resolve-failure counterpart of every reason immediately
    // above it, folded into one (see that reason's own doc comment in
    // edit/parentChildInlineEditSession.ts for why it is deliberately
    // coarse-grained) — same Notice.
    // falls through
    case "reorder-target-resolve-failed":
    case undefined:
      return "partialEdit.parentChildInlineEditResolveFailed";
    // Phase 5L-10: the reorder's own whole-subtree conflict check —
    // same Notice as every other conflict reason above.
    case "reorder-conflict":
      return "partialEdit.parentChildInlineEditConflict";
  }
}

/**
 * Phase 5L-11 ("Direct Child Leaf Indent/Outdent in Parent Partial Edit
 * Pane"): maps applyParentChildIndentOutdentToDocument's own exhaustive
 * reason union onto this pane's Notice i18n keys — deliberately reuses
 * the SAME two generic Notices every other structural conflict/
 * resolve-failure reason in this file already maps to (no new i18n key
 * needed here — see applyParentChildIndentOutdentToDocument's own reason
 * type doc comment in edit/parentChildInlineEditSession.ts for the
 * exhaustive per-reason rationale).
 */
function parentChildIndentOutdentApplyReasonKey(
  reason: ChildIndentOutdentApplyRejectReason | undefined
): TranslationKey {
  switch (reason) {
    case "parent-conflict":
    case "subtree-conflict":
      return "partialEdit.parentChildInlineEditConflict";
    case "parent-resolve-failed":
    case "target-resolve-failed":
    case "related-resolve-failed":
    case "candidate-structure-invalid":
    case "child-count-changed":
    case "sibling-changed":
    case undefined:
      return "partialEdit.parentChildInlineEditResolveFailed";
  }
}

/**
 * Phase 5L-9b ("First Direct Child Addition for Leaf List Items — Mode
 * B"): mirrors parentChildIndentOutdentApplyReasonKey's own identical
 * "reuse the two existing generic conflict/resolve-failed Notice texts,
 * never mint a distinct key per reason" convention — Mode B's own Apply
 * refusal set (LeafFirstChildEligibilityReason plus its own three
 * additions) collapses onto the exact same two user-facing messages
 * every sibling Apply-time refusal already shows, except
 * "new-child-unsafe-structure" — reused verbatim from Mode A's own
 * identical reason (`parentChildAddDeleteApplyReasonKey`), which already
 * has its own dedicated, more specific Notice text ("this new item's
 * text can't include a line break") rather than either generic message.
 */
function leafFirstChildApplyReasonKey(reason: ApplyLeafFirstChildRejectReason): TranslationKey {
  switch (reason) {
    case "own-text-conflict":
      return "partialEdit.parentChildInlineEditConflict";
    case "new-child-unsafe-structure":
      return "partialEdit.parentChildNewChildStructureInvalid";
    case "leaf-not-found":
    case "leaf-has-children":
    case "leaf-unsafe-indent":
    case "leaf-complex-block":
    case "candidate-structure-invalid":
      return "partialEdit.parentChildInlineEditResolveFailed";
  }
}

export class PartialEditView extends ItemView {
  // Shared with OutlineTreeView via plugin.activeMarkdownView, not a local
  // instance. A freshly constructed tracker has no cached view yet, and by
  // the time loadSection() below would call .get(), main.ts's
  // activatePartialEditView has already revealed this pane's own leaf —
  // which shifts workspace.getActiveViewOfType(MarkdownView) to null. The
  // shared, plugin-owned tracker is already warmed up by then (either by
  // OutlineTreeView's continuous refresh cycle, or by
  // activatePartialEditView's own explicit warm-up call), so it still
  // resolves correctly. See the doc comment on the field in main.ts.
  private get activeMarkdownView() {
    return this.plugin.activeMarkdownView;
  }

  private nodeId: string | null = null;
  private nodeKind: SubtreeKind | "paragraph" | "composite" | null = null;
  /**
   * Phase 5P-2: set instead of (never alongside) `nodeId` when the pane is
   * currently showing a paragraph loaded via requestLoadParagraphAtCursor —
   * see this class's own doc comment for why this is a separate field
   * rather than an extension of nodeId's own contract.
   */
  private paragraphAnchor: ParagraphEditAnchor | null = null;
  /**
   * Phase 5D-2A: set instead of (never alongside) `nodeId`/`paragraphAnchor`
   * when the pane is currently showing an ENTIRE CompositeBlock (list item
   * + callout/blockquote, loaded via requestLoadComposite) as one atomic
   * editing unit. Exactly one of nodeId/paragraphAnchor/compositeAnchor is
   * ever non-null at a time — see this class's own doc comment. Never
   * re-identified by any id (composite-N, or any member's own id) across a
   * re-parse — see edit/compositeBlockPartialEdit.ts's own top doc comment
   * for why a CompositeBlockSnapshot's CONTENT (ruleId/sectionId/range/
   * members) is the only safe re-identification basis.
   */
  private compositeAnchor: CompositeBlockSnapshot | null = null;
  private label = "";
  /** The pane's "before editing" snapshot — see edit/partialEdit.ts's applySubtreeEdit doc comment. */
  private originalText = "";
  /**
   * Phase 5D-0.5: set (never for a paragraph/section/list, and never for a
   * callout/blockquote that failed to project — see loadNodeInternal) when
   * the loaded node is a callout/blockquote whose body is currently shown
   * PREFIX-STRIPPED in the textarea. `originalText` above ALWAYS stays the
   * raw, `>`-prefixed snapshot regardless of this field — see
   * currentDisplayText's doc comment for the one place the two are
   * reconciled. null means "show `originalText` verbatim" (every non-quote
   * kind, a quote block with no body to project, and a fresh empty pane).
   */
  private quoteProjection: QuotePrefixProjection | null = null;
  /**
   * Phase 5L-1 ("Standalone Single-Line Unordered List Marker-Free
   * Partial Edit"): set (never for a section/paragraph/callout/
   * blockquote, and never for a list item ineligible per
   * edit/standaloneListMarkerProjection.ts#isStandaloneListItemEligibleForMarkerFreeProjection
   * or whose single line fails to build via
   * edit/listMarkerProjection.ts#buildListMarkerProjection — see
   * loadNodeInternal) when the loaded node is a STANDALONE (never part of
   * a CompositeBlock — that case uses the separate `listMarkerProjection`
   * field below, feeding the separate `compositeListInputEl`, never this
   * pane's shared `textareaEl`) single-line unordered leaf list item whose
   * marker is currently hidden from the textarea. `originalText` above
   * ALWAYS stays the raw, marker-included snapshot regardless of this
   * field — see currentDisplayText's doc comment for the one place the
   * two are reconciled, mirroring exactly how `quoteProjection` above
   * already relates to `originalText`. null means "show `originalText`
   * verbatim" (every non-eligible list item, every non-list kind, and a
   * fresh empty pane).
   */
  private standaloneListMarkerProjection: ListMarkerProjection | null = null;
  /**
   * Phase 5L-2 ("Task List Marker-Free Partial Edit"): the standalone
   * task-list-item counterpart of standaloneListMarkerProjection
   * immediately above — mutually exclusive with it by construction (see
   * buildStandaloneListProjections's own doc comment: at most one of the
   * two is ever non-null). Set when the loaded node is a STANDALONE
   * single-line unordered leaf task-list item whose marker AND checkbox
   * are both currently hidden from the shared textarea — the checkbox's
   * own completion state instead drives taskCheckboxInputEl.checked (see
   * renderTaskCheckboxRow). `originalText` above ALWAYS stays the raw,
   * marker+checkbox-included snapshot regardless of this field — see
   * currentDisplayText's own doc comment for the one place all of
   * quoteProjection/standaloneListMarkerProjection/this field are
   * reconciled. null means "show originalText verbatim, or
   * standaloneListMarkerProjection's own body if THAT is set instead"
   * (every non-task-list item, every ineligible item, every non-list
   * kind, and a fresh empty pane).
   */
  private standaloneTaskListProjection: TaskListProjection | null = null;
  /**
   * Phase 5L-3 ("Ordered List Marker-Free Partial Edit"): the standalone
   * ordered-list-item counterpart of standaloneListMarkerProjection/
   * standaloneTaskListProjection immediately above — mutually exclusive
   * with BOTH by construction (see buildStandaloneListProjections's own
   * doc comment: at most one of the three is ever non-null). Set when the
   * loaded node is a STANDALONE single-line ordered leaf list item whose
   * number marker is currently hidden from the shared textarea — the
   * item's own leading number instead drives orderedNumberInputEl.value
   * (see renderOrderedNumberRow). `originalText` above ALWAYS stays the
   * raw, number-marker-included snapshot regardless of this field — see
   * currentDisplayText's own doc comment for the one place all of
   * quoteProjection/standaloneListMarkerProjection/
   * standaloneTaskListProjection/this field are reconciled. null means
   * "show originalText verbatim, or one of the other two projections' own
   * body if THAT is set instead" (every non-ordered item, every
   * ineligible item, every non-list kind, and a fresh empty pane).
   */
  private standaloneOrderedListProjection: OrderedListProjection | null = null;
  /**
   * Phase 5L-4 ("Multi-Line Leaf List Item Partial Edit Projection"): the
   * standalone MULTI-line-leaf-item counterpart of
   * standaloneListMarkerProjection/standaloneTaskListProjection/
   * standaloneOrderedListProjection immediately above — mutually
   * exclusive with all three by construction (see loadNodeInternal's own
   * doc comment: this is only ever attempted once all three single-line
   * builders have already returned null for the same node). Set when the
   * loaded node is a STANDALONE, CHILD-LIST-FREE leaf list item whose own
   * range spans MORE than one line, and whose structural marker
   * (unordered/task/ordered) is currently hidden from the shared
   * textarea's own MULTI-line value — the item's own checkbox/number (for
   * a task/ordered kind) still drives taskCheckboxInputEl.checked/
   * orderedNumberInputEl.value exactly like the single-line case (see
   * renderTaskCheckboxRow/renderOrderedNumberRow). `originalText` above
   * ALWAYS stays the raw, marker-included multi-line snapshot regardless
   * of this field — see currentDisplayText's own doc comment for the one
   * place all four projection fields are reconciled. null means "show
   * originalText verbatim, or one of the other three projections' own
   * body if THAT is set instead" (every single-line-eligible item, every
   * ineligible item, every non-list kind, and a fresh empty pane).
   */
  private standaloneMultiLineListProjection: MultiLineListItemProjection | null = null;
  /**
   * Phase 5L-6 ("Parent List Item Structured Partial Edit"): the
   * standalone PARENT-item counterpart of standaloneListMarkerProjection/
   * standaloneTaskListProjection/standaloneOrderedListProjection/
   * standaloneMultiLineListProjection immediately above — mutually
   * exclusive with all four by construction (only ever attempted once all
   * four have already returned null for the same node, AND only for a node
   * with `childIds.length > 0` — see loadNodeInternal's own doc comment).
   * Set when the loaded node OWNS one or more nested child list items and
   * its own-text/child-subtree ranges can be safely separated (edit/
   * parentListItemProjection.ts's own resolveParentListItemOwnTextRange) —
   * the parent's own marker/checkbox/number stays hidden from the shared
   * textarea exactly like every sibling projection above, but the shared
   * textarea's own MULTI-line value here is ONLY the parent's own-text
   * (never any child-subtree content — see parentChildPreviewEl below for
   * the SEPARATE, read-only element that shows the child subtree).
   * `originalText` above ALWAYS stays the raw, FULL-SUBTREE (own-text +
   * every descendant line) snapshot regardless of this field — see
   * currentDisplayText's own doc comment for the one place all five
   * projection fields are reconciled. null means "show originalText
   * verbatim, or one of the other four projections' own body if THAT is
   * set instead" (every child-list-free item, every ineligible parent
   * item, every non-list kind, and a fresh empty pane).
   */
  private standaloneParentListItemProjection: ParentListItemProjection | null = null;
  /**
   * Phase 5L-8 ("Child Item Inline Structured Editing in Parent Partial
   * Edit Pane"): non-null ONLY while `standaloneParentListItemProjection`
   * is ALSO non-null (a child can only ever be inline-edited from inside a
   * successfully-projected parent) AND the user has explicitly opened
   * exactly one direct child's own inline editor via the small edit
   * affordance renderParentChildPreview now shows on each ELIGIBLE
   * (non-selected) row — see edit/parentChildInlineEditSession.ts's own
   * top doc comment for the full session/eligibility/Apply design. Reset
   * to null alongside standaloneParentListItemProjection everywhere that
   * field itself resets (resetLoadedState, loadNodeInternal,
   * loadParagraphInternal, loadCompositeInternal), plus on a successful
   * "stop editing this child" action (handleStopChildInlineEdit) and,
   * on a successful combined Apply, REBUILT fresh (never simply cleared —
   * see applyParentChildCombinedEdit's own doc comment) so a second Apply
   * within the same child-editing session starts from a fully current
   * basis, mirroring every sibling projection field's own post-Apply
   * rebuild convention.
   */
  private childInlineSession: ParentChildInlineEditSession | null = null;
  /**
   * Phase 5L-9 ("Direct Child Add/Delete in Parent Partial Edit Pane"):
   * the sibling-preservation baseline + at-most-one-pending-new-child-draft
   * + at-most-one-pending-deletion-target for the currently loaded parent
   * — non-null exactly when `standaloneParentListItemProjection` is
   * non-null (built alongside it — see buildParentChildAddDeleteSession's
   * own doc comment), reset to null everywhere THAT field itself resets.
   * Independent of `childInlineSession` above: a pending new-child draft
   * and/or a pending deletion target can coexist with an open EXISTING
   * child's own inline editor for a DIFFERENT child, all in the same
   * session — see ParentChildAddDeleteSession's own doc comment for the
   * exact "three independent slots" contract this field is one half of.
   */
  private childAddDeleteSession: ParentChildAddDeleteSession | null = null;
  /**
   * Phase 5L-9b ("First Direct Child Addition for Leaf List Items — Mode
   * B"): the ONE pending "promote this standalone leaf to a parent by
   * giving it a first child" draft — non-null only while one of the four
   * standalone-leaf projections (standaloneListMarkerProjection/
   * standaloneTaskListProjection/standaloneOrderedListProjection/
   * standaloneMultiLineListProjection) is active and
   * standaloneParentListItemProjection is still null (Mode B is never
   * reachable once the node is already a real parent — that is exactly
   * what Mode A/childAddDeleteSession above is for). Deliberately a
   * SEPARATE field from childAddDeleteSession, never a reuse of it — this
   * codebase's own established invariant is that childAddDeleteSession is
   * non-null EXACTLY when standaloneParentListItemProjection is (see that
   * field's own doc comment), which this field's own "only while there is
   * NO real parent projection yet" contract is the deliberate mirror
   * image of. Its own `draft` (a plain NewChildDraft, the exact same
   * shape Mode A's own newChildDraft already is) is read by
   * renderNewChildEditor/isNewChildDraftDirty ALONGSIDE (never instead
   * of) childAddDeleteSession?.newChildDraft — the two are mutually
   * exclusive by construction, so reusing the SAME pending-new-child
   * editor UI for both needed no new controls, only a second place for
   * that UI's own draft resolution to look. Reset to null everywhere
   * standaloneParentListItemProjection's own sibling fields already reset
   * (resetLoadedState, loadNodeInternal, loadParagraphInternal,
   * loadCompositeInternal), plus on a successful/discarded "stop this
   * pending first child" action and a full pane-level Cancel — see
   * handleStopNewChildDraft's/cancelEdit's own doc comments.
   */
  private pendingLeafFirstChild: PendingLeafFirstChild | null = null;
  /**
   * Phase 5D-2B ("CompositeBlock Structured Partial Edit Projection"): the structured
   * CompositeBlock session's own "before editing" snapshot for the LIST
   * member — the counterpart, for the list member, of what a callout's
   * own titleSlot.title plays for the trailing member's title. null
   * whenever nodeKind !== "composite", or for a composite that fell back
   * to the existing raw whole-range textarea (edit/
   * compositeBlockMemberProjection.ts#splitCompositeBlockMembers failed,
   * or the trailing member itself failed to project) — see
   * loadCompositeInternal. Always set together with (never independently
   * of) this.quoteProjection for a structured composite session: exactly
   * one of "both null" (raw fallback / non-composite) or "both non-null"
   * (structured composite) ever holds.
   *
   * Phase 5D-2C ("marker-free single-line-list member projection"): holds
   * `listMarkerProjection.body` (the marker-free editable text) whenever
   * listMarkerProjection below is ALSO non-null; holds the list member's
   * own RAW line (marker included, unchanged from 5D-2B's own original
   * behavior) whenever listMarkerProjection is null — a `single-line-list`
   * member whose marker is ordered, a task-list checkbox, or otherwise
   * unprojectable (see edit/listMarkerProjection.ts's own refusal
   * reasons), or a defensive non-"single-line-list" kind. Either way this
   * field is exactly what compositeListInputEl.value is loaded from and
   * compared against for dirty tracking (isDirty's own listDirty check) —
   * callers never need to know WHICH of the two states produced it.
   */
  private compositeListOriginalText: string | null = null;
  /**
   * Phase 5D-2C ("CompositeBlock single-line-list member marker-free
   * projection"): the structured composite session's own split of the
   * list member's raw line into indent/marker/markerSpacing/body (edit/
   * listMarkerProjection.ts, unmodified — see that module's own top doc
   * comment). null whenever compositeListOriginalText above is null
   * (nothing loaded, or raw-fallback whole-range textarea), AND also null
   * whenever compositeListOriginalText holds the list member's RAW line
   * instead of its marker-free body — i.e. this field being non-null is
   * exactly the condition that gates the list-member input showing
   * marker-free text; see renderCompositeListSlot/loadCompositeInternal
   * for where that gate is applied. Set ONLY for a member whose resolved
   * kind is "single-line-list" (never the defensive "list" kind — see
   * this field's own gating in loadCompositeInternal for why) AND whose
   * raw line builds successfully via buildListMarkerProjection.
   */
  private listMarkerProjection: ListMarkerProjection | null = null;
  /**
   * Phase 5C-4: the file path of the note `nodeId` was actually loaded
   * from, recorded once per loadNodeInternal call (never recomputed
   * mid-edit, same "static until the next load" policy as `ancestors`/
   * `directChildren`/`siblingState` below). `null` only before any node has
   * ever been loaded, or if the resolved MarkdownView had no file (see
   * loadNodeInternal). Read by applyEdit as the ADDITIONAL, path-based
   * safety check — see view/partialEditSourceNoteCheck.ts.
   */
  private sourcePath: string | null = null;
  /** Phase 5B: root-first ancestors of the currently loaded node, computed once at load time — see renderBreadcrumb's doc comment for why this is never recomputed mid-edit. */
  private ancestors: AncestorPathEntry[] = [];
  /** Subtree Navigator: the loaded node's own direct children, computed once at load time alongside `ancestors` — see renderSubtreeNavigator's doc comment. */
  private directChildren: DescendantNavigationEntry[] = [];
  /** Sibling前後移動: the loaded node's previous/next sibling, computed once at load time alongside `ancestors`/`directChildren` — see renderSiblingNav's doc comment. */
  private siblingState: SiblingNavigationState = { previous: null, next: null };

  /**
   * Phase 5A-1 ("Partial Edit Pane の stale 状態検知・安全な再読み込み"):
   * whether the note's actual content, at the range this pane last
   * loaded/re-anchored from, still matches `originalText` (or, for a
   * CompositeBlock/paragraph, its own anchor snapshot). "synced" is the
   * default and the only state that ever existed before this ticket
   * (unchanged clean/dirty semantics — see isDirty()). "stale" means the
   * note changed elsewhere and Apply would be refused as a conflict by
   * the existing, UNCHANGED fail-closed check inside
   * applySubtreeEdit/applyParagraphEdit/applyCompositeBlockEdit — this
   * field never gates or replaces that check, it only pre-emptively
   * disables the visible Apply button (see updateDirtyState) so the user
   * isn't invited to click a button that's guaranteed to fail. "unavailable"
   * means the target itself could not be resolved at all (the source note
   * was deleted, or the target range no longer resolves) — see
   * transitionToUnavailable's own doc comment for why this never clears
   * itself automatically. Reset to "synced" on every fresh load
   * (loadNodeInternal/loadParagraphInternal/loadCompositeInternal/
   * renderEmptyState) and on a successful performAutoReload/executeReload.
   */
  private syncState: "synced" | "stale" | "unavailable" = "synced";

  /**
   * Phase 5A-1: set once in onClose, checked at the top of every method
   * that may still run after this pane's DOM/leaf is gone — a pending
   * `vault.cachedRead` promise (performStaleCheck) or a debounced
   * `scheduleStaleCheck` callback can both still fire after close, since
   * neither is itself tied to this Component's registerEvent lifecycle
   * (only the workspace/vault event LISTENERS are — the debounced
   * function and any in-flight async read survive independently). Every
   * such method treats a closed pane as a safe no-op rather than touching
   * now-detached DOM or stale internal state.
   */
  private closed = false;

  /**
   * Phase 5A-1 hardening §1 (self-Apply suppression): true for the exact
   * span of applyEdit()'s own note-mutating call — set immediately before
   * applyLineEditOutcome and cleared (via try/finally, so an exception or
   * early return can never leave it stuck true) right after this pane's
   * own re-anchoring finishes — for every one of applyEdit()'s three
   * branches (paragraph/composite/node), success path only (a failed
   * Apply returns before ever reaching applyLineEditOutcome, so it never
   * sets this at all — see each branch's own comment).
   *
   * Closes a theoretical self-Apply race this ticket's own safety review
   * flagged: IF `editor-change` were ever to fire synchronously from
   * `editor.replaceRange` (unconfirmed) inside a leading-edge-synchronous
   * `debounce` (also unconfirmed — see scheduleStaleCheck's own doc
   * comment), a stale check could otherwise run inside applyEdit()'s own
   * call stack, BEFORE this.originalText / the relevant anchor is
   * reassigned to match the just-applied content, and incorrectly read
   * that gap as staleness — with no automatic path back to "synced"
   * afterward (see the now-retracted claim this ticket's review
   * explicitly walked back).
   *
   * Checked by BOTH performStaleCheck (via shouldRunStaleCheck, so a
   * suppressed synchronous re-entrant call is a cheap no-op before even
   * touching the vault) AND evaluateAgainstText itself (so an ALREADY
   * in-flight `vault.cachedRead` promise scheduled before this Apply
   * started, whose `.then()` callback could in principle still run later,
   * is equally inert — defense-in-depth that does not rely on any
   * assumption about microtask/debounce ordering). Events arriving during
   * suppression are fully discarded, never queued — see
   * scheduleStaleCheck's own doc comment for why an explicit, single
   * `scheduleStaleCheck()` call right after releasing suppression (inside
   * each applyEdit() branch, after the try/finally) is what guarantees a
   * fresh re-check still happens afterward, rather than relying on
   * whatever debounced call may or may not have been swallowed.
   */
  private isApplyingOwnEdit = false;

  /**
   * Phase 5A-1: the single per-Pane, per-instance debounced stale check —
   * every event source below (editor-change/vault modify/active-leaf-
   * change/file-open) schedules through this SAME debouncer, so a burst of
   * several events (e.g. Apply's own editor-change firing alongside a
   * near-simultaneous vault "modify" for the same edit) collapses into one
   * performStaleCheck() call rather than several redundant ones. 150ms,
   * `resetTimer: true` — the same call shape OutlineTreeView.ts's own
   * scheduleRefresh already uses for its own editor-change/active-leaf-
   * change/file-open debounce (see that file's own doc comment); reusing
   * the identical, already-proven-safe call shape here rather than
   * inventing a different debounce configuration.
   */
  private scheduleStaleCheck = debounce(() => this.performStaleCheck(), 150, true);

  /**
   * Phase 5B: how many of the nearest ancestors the breadcrumb shows
   * before collapsing the rest into a leading "…" segment (tooltip-only).
   * A single named constant per the implementation instruction's "マジック
   * ナンバーで散在させない" requirement — every place that needs this number
   * reads it from here.
   */
  private static readonly BREADCRUMB_VISIBLE_ANCESTORS = 3;

  /**
   * Subtree Navigator: how many direct children are shown inline as chips
   * before the rest collapse into a single "More…" chip that opens an
   * Obsidian Menu. Deliberately larger than BREADCRUMB_VISIBLE_ANCESTORS —
   * ancestor chains are usually shallow, but a node can easily have many
   * more direct children than it has ancestors, and the Menu fallback only
   * exists for that long tail.
   */
  private static readonly SUBTREE_VISIBLE_CHILDREN = 5;

  /**
   * Phase 5D-1C: the `id` shared between quoteTypeDatalistEl and
   * quoteTypeInputEl's own `list` attribute — this ticket's own approved
   * literal id string.
   */
  private static readonly QUOTE_TYPE_DATALIST_ID = "unified-outliner-callout-types";
  /**
   * Phase 5D-1C: the 13 standard Obsidian callout type keywords, per this
   * ticket's own approved candidate list — deliberately excludes type
   * aliases (e.g. "caution" for "warning"); alias coverage is explicitly
   * deferred to a future, separate UX ticket. Populates
   * quoteTypeDatalistEl's `<option>` children once, in onOpen.
   */
  private static readonly QUOTE_TYPE_DATALIST_OPTIONS = [
    "note",
    "abstract",
    "info",
    "todo",
    "tip",
    "success",
    "question",
    "warning",
    "failure",
    "danger",
    "bug",
    "example",
    "quote",
  ];

  private titleEl!: HTMLElement;
  /**
   * Phase 5A-1: the stale/unavailable indicator + Reload button row,
   * placed between the title/actions header and the ancestor breadcrumb
   * (see onOpen) — "near the Pane header/breadcrumb" per this ticket's own
   * UI placement requirement. Hidden entirely (toggleVisibility(false))
   * whenever `syncState === "synced"` or nothing is loaded — see
   * renderSyncStatus.
   */
  private syncStatusEl!: HTMLElement;
  private syncStatusLabelEl!: HTMLElement;
  private syncStatusReloadEl!: HTMLButtonElement;
  private breadcrumbEl!: HTMLElement;
  private siblingNavEl!: HTMLElement;
  private siblingPrevEl!: HTMLButtonElement;
  private siblingPrevTargetEl!: HTMLElement;
  private siblingNextEl!: HTMLButtonElement;
  private siblingNextTargetEl!: HTMLElement;
  private subtreeNavEl!: HTMLElement;
  /**
   * Phase 5D-0.5: container row shown ABOVE the textarea for a projecting
   * callout/blockquote — see renderQuoteHeader's doc comment. Stays
   * hidden for every other case (blockquote has no header; a raw-loaded
   * node has nothing to separate out).
   *
   * Phase 5D-1A: this container now holds `quoteHeaderLabelEl` (read-
   * only: quote prefix and the literal `[!`/`]` brackets, since 5D-1C —
   * originally also carried the type/fold marker/separator, see that
   * field's own doc comment) and `quoteTitleInputEl` (the editable
   * title). Never call `.setText()` on `quoteHeaderEl` itself any more —
   * that would wipe out its children as a side effect, since `setText`
   * replaces the element's entire text content including child elements.
   * Always target `quoteHeaderLabelEl` for the read-only text instead.
   *
   * Phase 5D-1B: a THIRD child, `quoteMarkerSelectEl`, sits between the
   * label and the title input — see that field's own doc comment.
   *
   * Phase 5D-1C: a FOURTH and FIFTH child, `quoteTypeInputEl` (editable
   * type combobox) and `quoteTypeCloseLabelEl` (read-only literal `]`),
   * sit between `quoteHeaderLabelEl` (now just quote prefix + literal
   * `[!`) and `quoteMarkerSelectEl` — see each field's own doc comment.
   * The row now reads left-to-right as "quote prefix + `[!`" ->
   * "type" -> "`]`" -> "fold behavior" -> "title".
   */
  private quoteHeaderEl!: HTMLElement;
  /** Phase 5D-1A: the read-only label child of quoteHeaderEl (see that field's own doc comment for why this exists as a separate child rather than text directly on quoteHeaderEl). Phase 5D-1B: no longer includes the fold marker or separator whitespace — those are represented by quoteMarkerSelectEl's own selected option, not rendered as raw text in this label. Phase 5D-1C: no longer includes `[!type]` either — only the quote prefix plus the literal `[!` opening bracket; the type itself is `quoteTypeInputEl`, and the closing `]` is `quoteTypeCloseLabelEl`. */
  private quoteHeaderLabelEl!: HTMLElement;
  /**
   * Phase 5D-1C: single-line, editable callout-type combobox — a plain
   * `<input type="text">` with a `list` attribute pointing at
   * `quoteTypeDatalistEl`'s id, per this ticket's own approved UI
   * decision (a closed-set `<select>`, like `quoteMarkerSelectEl`, was
   * explicitly rejected for TYPE specifically, because Obsidian callout
   * types are NOT a closed set — any string is syntactically valid, and
   * an unrecognized one merely falls back to `note`'s ICON/COLOR at
   * render time, never at the raw-text level; see
   * reconstructQuoteHeader's own doc comment). The `<datalist>` offers
   * the 13 standard type keywords purely as suggestions — it never
   * constrains what can actually be typed or pasted here, so any custom
   * type, alias, or unknown type already present in the user's vault
   * (e.g. the real `[!ai]` example that motivated this ticket) loads and
   * round-trips completely unmodified. Shown/hidden and enabled/disabled
   * in lockstep with `quoteTitleInputEl`/`quoteMarkerSelectEl` — all
   * three are gated on the exact same
   * `this.quoteProjection?.titleSlot != null` condition, since all three
   * are carved out of the same header line's same titleSlot.
   */
  private quoteTypeInputEl!: HTMLInputElement;
  /**
   * Phase 5D-1C: the `<datalist>` backing `quoteTypeInputEl`'s `list`
   * attribute — created once in onOpen with the 13 standard callout type
   * keywords (note/abstract/info/todo/tip/success/question/warning/
   * failure/danger/bug/example/quote) as its `<option>` children, per
   * this ticket's own approved candidate list. Deliberately does NOT
   * include type aliases (e.g. "caution", "tldr") — the ticket's own
   * explicit instruction defers alias coverage to a future, separate UX
   * ticket. Never itself shown/hidden — a `<datalist>` has no visual
   * presence of its own; only `quoteTypeInputEl`'s own visibility matters.
   */
  private quoteTypeDatalistEl!: HTMLDataListElement;
  /** Phase 5D-1C: the read-only label child rendering the literal closing `]` of `[!type]`, immediately after `quoteTypeInputEl` — shown/hidden in lockstep with it. Kept as its own element (rather than baked into `quoteHeaderLabelEl`, which sits BEFORE the now-editable type) so the header row's static bracket punctuation survives the type becoming an editable control in between. */
  private quoteTypeCloseLabelEl!: HTMLElement;
  /**
   * Phase 5D-1B: single-line fold-marker picker — a native tri-state
   * `<select>` (this view's first `<select>` element) offering exactly
   * the three values `CalloutFoldMarker` allows: `""` (not foldable),
   * `"+"` (foldable, expanded by default), `"-"` (foldable, collapsed by
   * default). A closed-set control by design — see reconstructQuoteHeader's
   * own doc comment for why this is what keeps "invalid-marker" a
   * defensive, effectively-unreachable path rather than something a user
   * can trigger from this UI (contrast `quoteTypeInputEl` above, whose
   * own "invalid-type" failure IS user-reachable). Shown/hidden and
   * enabled/disabled in lockstep with `quoteTitleInputEl`/
   * `quoteTypeInputEl` — all are gated on the exact same
   * `this.quoteProjection?.titleSlot != null` condition, since all are
   * carved out of the same header line's same titleSlot.
   */
  private quoteMarkerSelectEl!: HTMLSelectElement;
  /**
   * Phase 5D-1A: single-line, editable title input — the first
   * `<input type="text">` this view (or this plugin's view layer at all)
   * has ever needed; every other editable surface here is the one big
   * `<textarea>` below. Shown only when the loaded callout's title was
   * successfully split out (`this.quoteProjection?.titleSlot != null`) —
   * hidden and cleared for blockquote, non-projecting nodes, and a
   * header-only callout's raw fallback (title editing is explicitly out
   * of scope there — see renderQuoteHeader's doc comment).
   */
  private quoteTitleInputEl!: HTMLInputElement;
  /**
   * Phase 5D-2B ("CompositeBlock Structured Partial Edit Projection"): the structured
   * CompositeBlock session's own list-member row — a single raw-text
   * `<input>` holding the list member's own one raw line (marker,
   * indentation, content, all verbatim; this pane never restructures the
   * list line itself, matching how a standalone list Partial Edit already
   * shows its raw line unchanged elsewhere in this plugin). Shown ONLY
   * when this.nodeKind === "composite" AND the CompositeBlock was
   * successfully split into its two members AND its trailing member
   * successfully projected (this.quoteProjection !== null) — every other
   * case (a non-composite kind, or a composite that fell back to the
   * existing raw whole-range textarea) hides this row and leaves
   * compositeListOriginalText null. See renderCompositeListSlot, the
   * single place that toggles/populates it.
   *
   * 2026-09-14 (real-device follow-up): this row, and the trailing
   * member's own kind label (formerly a separate compositeTrailingLabelEl
   * field above the reused quoteHeaderEl/textareaEl pair), both
   * originally carried a read-only text label ("List item" / "Callout" /
   * "Quote"). Removed as redundant: the pane's own title already states
   * the kind ("編集中(拡張ブロック): List + Callout" / "List + Quote"), and
   * each row's own visual prefix (the list marker verbatim in this input;
   * the callout/blockquote symbol in quoteHeaderEl below) already says
   * the same thing at a glance. See
   * docs/phase5d2b_composite-block-structured-partial-edit.md for the
   * full record of this follow-up.
   */
  private compositeListRowEl!: HTMLElement;
  private compositeListInputEl!: HTMLInputElement;
  /**
   * Phase 5L-2 ("Task List Marker-Free Partial Edit"): the standalone
   * task-list item's own checkbox row — created once in onOpen (like
   * every other row in this class), visibility/content toggled per-load
   * by renderTaskCheckboxRow. Sits directly above the REUSED textareaEl
   * (the marker-free/checkbox-free body editor for the SAME item) — see
   * standaloneTaskListProjection's own field doc comment for the exact
   * condition that shows this row.
   */
  private taskCheckboxRowEl!: HTMLElement;
  private taskCheckboxInputEl!: HTMLInputElement;
  /**
   * Phase 5L-3 ("Ordered List Marker-Free Partial Edit"): the standalone
   * ordered-list item's own number row — created once in onOpen (like
   * every other row in this class), visibility/content toggled per-load
   * by renderOrderedNumberRow. Sits directly above the REUSED textareaEl
   * (the marker-free body editor for the SAME item) — see
   * standaloneOrderedListProjection's own field doc comment for the exact
   * condition that shows this row. A plain text input (never
   * type="number") — see edit/orderedListProjection.ts's own top doc
   * comment's "The number field" section for why this pane never relies
   * on an HTML number input's own browser-side coercion/validation for
   * correctness.
   */
  private orderedNumberRowEl!: HTMLElement;
  private orderedNumberInputEl!: HTMLInputElement;
  private textareaEl!: HTMLTextAreaElement;
  /**
   * Phase 5L-6 ("Parent List Item Structured Partial Edit"): the READ-ONLY
   * child-subtree preview — created once in onOpen, visibility/content
   * toggled per-load/per-reload by renderParentChildPreview. Sits directly
   * BELOW the shared textareaEl (which, for a parent item, shows ONLY the
   * parent's own-text — see standaloneParentListItemProjection's own field
   * doc comment), never above it, so the pane reads top-to-bottom as
   * "editable own text, then a read-only look at what's nested under it".
   * `parentChildPreviewBodyEl` renders the child subtree's raw Markdown
   * verbatim, one line per row (`white-space: pre` — see styles.css), which
   * is what makes the child hierarchy's own indentation visible without
   * this pane re-implementing any tree-drawing of its own (per this
   * ticket's own explicit "既存のインデント表現をそのまま活かす" design
   * choice — see edit/parentListItemProjection.ts's own top doc comment).
   * Every row carries `aria-readonly="true"`/`data-readonly="true"` and no
   * click handler of any kind is ever attached to it — per this ticket's
   * own explicit scope, a child item is never directly editable from
   * inside this preview; the pane's own PRE-EXISTING Subtree Navigator
   * (renderSubtreeNavigator, unmodified by this ticket) already offers a
   * safe, guarded (requestLoadNode-routed) way to open a child as its own
   * separate Partial Edit session, and this preview deliberately does not
   * duplicate or replace that. `parentChildPreviewTruncatedEl` shows a
   * visible "…and N more lines" indicator whenever the child subtree
   * exceeds PARENT_CHILD_PREVIEW_MAX_LINES, so an unexpectedly huge
   * subtree never makes this pane unusably tall.
   */
  private parentChildPreviewEl!: HTMLElement;
  private parentChildPreviewLabelEl!: HTMLElement;
  /**
   * Phase 5L-9 follow-up fix: the label TEXT lives in its own child span,
   * separate from parentChildPreviewLabelEl itself (the header ROW, which
   * also contains parentChildAddButtonEl as a sibling element). Renaming
   * the bug this fixes so it's easy to find later: renderParentChildPreview
   * used to call `this.parentChildPreviewLabelEl.setText(...)` directly on
   * every render — but `setText` replaces ALL of an element's children
   * with a single text node, which silently detached parentChildAddButtonEl
   * (created as that same element's child) from the DOM on every render,
   * making the "+" button invisible even though the code that configures
   * its disabled/tooltip state right after ran without error (it was still
   * mutating a live JS reference, just one no longer attached to the page).
   * renderParentChildPreview now calls `.setText` on THIS element instead,
   * leaving parentChildAddButtonEl (a sibling, not a child of this span)
   * untouched by every re-render.
   */
  private parentChildPreviewLabelTextEl!: HTMLElement;
  private parentChildPreviewBodyEl!: HTMLElement;
  private parentChildPreviewTruncatedEl!: HTMLElement;
  /** Phase 5L-6: see parentChildPreviewEl's own doc comment's last sentence. */
  private static readonly PARENT_CHILD_PREVIEW_MAX_LINES = 200;
  /**
   * Phase 5L-8: the ONE inline structured editor for the currently-selected
   * direct child (`childInlineSession` non-null) — created once in onOpen,
   * placed directly BELOW the read-only preview (parentChildPreviewEl),
   * toggled/populated per-load/per-reload/per-Apply by
   * renderChildInlineEditor. Deliberately a SEPARATE small set of controls
   * (its own checkbox/number-input/textarea), never a re-use of the
   * pane-level taskCheckboxInputEl/orderedNumberInputEl/textareaEl — those
   * three are already showing the PARENT's own own-text at the same time
   * this panel is open, and both must remain independently visible and
   * editable together (this ticket's own explicit "同時に編集可能" design).
   * Carries its own CSS modifier classes (styles.css) so it reads as
   * visually NESTED under the parent's own controls (indentation/
   * background/border), never confusable with them. No separate Apply/
   * Cancel of its own — only `childInlineStopButtonEl` ("stop editing this
   * child", discards ONLY the child draft — see handleStopChildInlineEdit)
   * and the pane-level Apply/Cancel buttons ever touch this panel's state.
   */
  private childInlineEditorEl!: HTMLElement;
  private childInlineEditorLabelEl!: HTMLElement;
  private childInlineStopButtonEl!: HTMLButtonElement;
  private childInlineTaskCheckboxRowEl!: HTMLElement;
  private childInlineTaskCheckboxInputEl!: HTMLInputElement;
  private childInlineOrderedNumberRowEl!: HTMLElement;
  private childInlineOrderedNumberInputEl!: HTMLInputElement;
  private childInlineTextareaEl!: HTMLTextAreaElement;
  /**
   * Phase 5L-9 ("Direct Child Add/Delete in Parent Partial Edit Pane"):
   * the small "Add child item" control — sits inside
   * parentChildPreviewLabelEl's own row (the child-preview HEADER, per
   * this ticket's own §10 placement choice), so it is visible whenever
   * the read-only child preview itself is (i.e. whenever
   * standaloneParentListItemProjection is non-null), usable even while
   * the preview currently has zero VISIBLE rows (every existing child
   * pending-deletion — see renderParentChildPreview). Disabled (never
   * hidden — a hidden control cannot explain itself via tooltip) while a
   * new-child draft is already pending, per this ticket's own
   * "prevent double-add" requirement.
   */
  private parentChildAddButtonEl!: HTMLButtonElement;
  /**
   * Phase 5L-9: the ONE inline structured editor for a pending NEW direct
   * child — created once here, toggled/populated per-load/per-reload/
   * per-Apply by renderNewChildEditor. Deliberately a SEPARATE small set
   * of controls from childInlineEditorEl immediately above (an existing
   * child's own inline editor) — both must be able to show at once (§6's
   * own "three independent slots" contract). Always just ONE textarea (no
   * checkbox/number row — the new child's own shape is fixed to
   * unordered/non-task, see edit/parentChildInlineEditSession.ts's own
   * NewChildDraft doc comment), unlike childInlineEditorEl's own three
   * possible control kinds.
   */
  private newChildEditorEl!: HTMLElement;
  private newChildEditorLabelEl!: HTMLElement;
  private newChildStopButtonEl!: HTMLButtonElement;
  private newChildTextareaEl!: HTMLTextAreaElement;
  /**
   * Phase 5L-9b ("First Direct Child Addition for Leaf List Items — Mode
   * B"): the "add a first child" row for a STANDALONE leaf item — a
   * SEPARATE control from parentChildAddButtonEl above (that one lives
   * inside parentChildPreviewEl, which stays hidden whenever there is no
   * REAL parent projection yet; this one is its own top-level row,
   * visible whenever one of the four standalone-leaf projections is
   * active — see renderLeafFirstChildAddRow's own doc comment). Sits
   * directly below the shared body textarea/checkbox/number rows, mirrors
   * parentChildAddButtonEl's own plus-icon/tooltip/stopPropagation
   * conventions exactly.
   */
  private leafFirstChildAddRowEl!: HTMLElement;
  private leafFirstChildAddButtonEl!: HTMLButtonElement;
  private applyButtonEl!: HTMLButtonElement;
  private cancelButtonEl!: HTMLButtonElement;
  private closeButtonEl!: HTMLElement;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: UnifiedOutlinerPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return PARTIAL_EDIT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.plugin.t("partialEdit.viewName");
  }

  getIcon(): string {
    return "edit-3";
  }

  /**
   * Real-device report, two rounds: (1) force-closing this pane after
   * Obsidian's startup layout restore (via workspace.onLayoutReady) caused
   * a visible flash — the leaf was already drawn once before being
   * removed; (2) leaving the restored, empty pane in place instead was
   * worse — it can end up as an orphaned, blank panel with no Outline Tree
   * View nearby to reload it from, which reads as broken rather than
   * merely idle.
   *
   * `workspace.layoutReady` is false only while Obsidian is still
   * reconstructing the saved workspace at startup, and is permanently true
   * for the rest of the session afterward (including every live open via
   * activatePartialEditView). Checking it here, synchronously, at the very
   * start of onOpen — before any DOM is built — means a restored instance
   * detaches itself before it is ever painted, instead of appearing and
   * then disappearing. A live, user-triggered open (layoutReady already
   * true by then) is completely unaffected and renders normally below.
   */
  async onOpen(): Promise<void> {
    if (!this.app.workspace.layoutReady) {
      this.leaf.detach();
      return;
    }

    this.contentEl.empty();
    this.contentEl.addClass("unified-outliner-partial-edit-view");

    const headerEl = this.contentEl.createDiv({ cls: "unified-outliner-partial-edit-header" });
    this.titleEl = headerEl.createDiv({ cls: "unified-outliner-partial-edit-title" });

    const actionsEl = headerEl.createDiv({ cls: "unified-outliner-partial-edit-actions" });
    this.applyButtonEl = actionsEl.createEl("button", {
      text: this.plugin.t("common.apply"),
      cls: "mod-cta",
    });
    this.applyButtonEl.addEventListener("click", () => this.applyEdit());
    this.cancelButtonEl = actionsEl.createEl("button", { text: this.plugin.t("common.cancel") });
    this.cancelButtonEl.addEventListener("click", () => this.cancelEdit());
    // One-click close, in addition to Obsidian's own tab-close affordances
    // (native tab × / right-click "Close tab"). Deliberately NOT gated by
    // whether a section is loaded — unlike Apply/Cancel, closing the pane
    // is always a valid action. Discards any unsaved edit exactly like
    // Cancel/onClose already do; no confirmation prompt (see onClose's doc
    // comment — Close has never applied pending edits in this pane).
    this.closeButtonEl = actionsEl.createDiv({
      cls: "unified-outliner-partial-edit-close clickable-icon",
    });
    setIcon(this.closeButtonEl, "x");
    setTooltip(this.closeButtonEl, this.plugin.t("partialEdit.close"));
    this.closeButtonEl.addEventListener("click", () => this.leaf.detach());

    // Phase 5A-1: the stale/unavailable indicator + Reload button row,
    // placed directly below the title/actions header and ABOVE the
    // breadcrumb — "near the Pane header/breadcrumb" per this ticket's own
    // placement requirement (R2). aria-live="polite" is this ticket's
    // minimal aria-live-equivalent announcement: when renderSyncStatus
    // below changes syncStatusLabelEl's text, a screen reader announces it
    // without the user needing to navigate to this row explicitly.
    this.syncStatusEl = this.contentEl.createDiv({
      cls: "unified-outliner-partial-edit-sync-status",
    });
    this.syncStatusEl.setAttribute("aria-live", "polite");
    this.syncStatusLabelEl = this.syncStatusEl.createSpan({
      cls: "unified-outliner-partial-edit-sync-status-label",
    });
    this.syncStatusReloadEl = this.syncStatusEl.createEl("button", {
      cls: "unified-outliner-partial-edit-sync-status-reload",
      text: this.plugin.t("partialEdit.reload"),
    });
    this.syncStatusReloadEl.addEventListener("click", () => {
      void this.performReload();
    });
    this.syncStatusEl.toggleVisibility(false);

    // Phase 5B: a second row below the title+actions header, dedicated to
    // the ancestor breadcrumb. Kept as its own element (not squeezed into
    // titleEl) so the existing header row's layout — title left, actions
    // right — stays exactly as it was; see renderBreadcrumb for what goes
    // in here.
    this.breadcrumbEl = this.contentEl.createDiv({
      cls: "unified-outliner-partial-edit-breadcrumb",
    });

    // Sibling前後移動: a row between the ancestor breadcrumb and the Subtree
    // Navigator, for moving sideways to the loaded node's previous/next
    // sibling. Its own element (not merged into breadcrumbEl) per the spec's
    // explicit requirement that breadcrumb's own structure stay untouched —
    // see renderSiblingNav for what goes in here. Unlike breadcrumbEl and
    // subtreeNavEl, its two buttons are created once here and only ever
    // toggled/relabeled by renderSiblingNav afterward, since there are
    // always exactly two of them (no variable-length list to rebuild).
    this.siblingNavEl = this.contentEl.createDiv({
      cls: "unified-outliner-partial-edit-sibling-nav",
    });
    this.siblingPrevEl = this.siblingNavEl.createEl("button", {
      cls: "unified-outliner-partial-edit-sibling-nav-button unified-outliner-partial-edit-sibling-nav-prev",
    });
    setIcon(this.siblingPrevEl, "chevron-left");
    this.siblingPrevEl.createSpan({
      cls: "unified-outliner-partial-edit-sibling-nav-label",
      text: this.plugin.t("partialEdit.previousSibling"),
    });
    // Preview of the previous sibling's own displayLabel, so the pane shows
    // where "Previous" actually goes before it's clicked — see
    // renderSiblingNav for how this span's text/visibility is kept in sync
    // with this.siblingState.previous. CSS-truncated (styles.css) rather
    // than JS-truncated, matching how renderBreadcrumb's segments and
    // appendSubtreeChip's labels already truncate; the button's own tooltip
    // (set in renderSiblingNav) still carries the untruncated label, same
    // pattern as those two.
    this.siblingPrevTargetEl = this.siblingPrevEl.createSpan({
      cls: "unified-outliner-partial-edit-sibling-nav-target",
    });
    // Reads this.siblingState.previous fresh at click time rather than
    // capturing it in a stale closure — renderSiblingNav updates that field
    // on every load without ever recreating this button. Same guarded
    // projection entry point as breadcrumb segments and Subtree Navigator
    // chips (see requestLoadNode's own doc comment) — never loadNodeInternal
    // directly.
    this.siblingPrevEl.addEventListener("click", () => {
      const target = this.siblingState.previous;
      if (target) this.requestLoadNode(target.nodeId);
    });

    this.siblingNextEl = this.siblingNavEl.createEl("button", {
      cls: "unified-outliner-partial-edit-sibling-nav-button unified-outliner-partial-edit-sibling-nav-next",
    });
    // Next sibling's target-label span is created FIRST (before the "Next"
    // word and its icon), so it sits closest to the row's center — mirrored
    // against siblingPrevTargetEl, which sits closest to the center on the
    // other side (right after "Previous", before nothing). Reading order
    // ends up "‹ Previous  [target]" / "[target]  Next ›", pointing outward
    // from the loaded node toward each sibling.
    this.siblingNextTargetEl = this.siblingNextEl.createSpan({
      cls: "unified-outliner-partial-edit-sibling-nav-target",
    });
    this.siblingNextEl.createSpan({
      cls: "unified-outliner-partial-edit-sibling-nav-label",
      text: this.plugin.t("partialEdit.nextSibling"),
    });
    // setIcon(el, ...) replaces ALL of el's existing children with just the
    // icon svg — harmless for siblingPrevEl above (its icon is set first,
    // while the button is still empty), but calling it directly on
    // siblingNextEl here — AFTER the target and label spans above already
    // exist — silently wiped both of them out, leaving "Next" with no
    // target-label preview ever rendered (reported: previous shows its
    // target label, next never does). Fixed by giving the icon its own
    // empty wrapper span that setIcon can safely clear/populate without
    // touching its siblings, instead of calling setIcon on siblingNextEl
    // itself.
    const siblingNextIconEl = this.siblingNextEl.createSpan({
      cls: "unified-outliner-partial-edit-sibling-nav-icon",
    });
    setIcon(siblingNextIconEl, "chevron-right");
    this.siblingNextEl.addEventListener("click", () => {
      const target = this.siblingState.next;
      if (target) this.requestLoadNode(target.nodeId);
    });

    // Subtree Navigator: a third header row, below the ancestor breadcrumb,
    // for descending into the loaded node's own direct children. Its own
    // element (not merged into breadcrumbEl) so the two are visually and
    // structurally distinct — "climb up" vs. "descend down" — per the
    // implementation instruction's explicit requirement that the two not
    // share one row. See renderSubtreeNavigator for what goes in here.
    this.subtreeNavEl = this.contentEl.createDiv({
      cls: "unified-outliner-partial-edit-subtree-nav",
    });

    // Phase 5D-2B ("CompositeBlock Structured Partial Edit Projection"): the structured
    // CompositeBlock session's own list-member row — created once here
    // (like every other row in this method), visibility/content toggled
    // per-load by renderCompositeListSlot. Sits directly above the REUSED
    // quoteHeaderEl/textareaEl pair below (also reused verbatim for the
    // trailing callout/blockquote member) — see compositeListRowEl's own
    // field doc comment for the exact condition that shows this row.
    this.compositeListRowEl = this.contentEl.createDiv({
      cls: "unified-outliner-partial-edit-composite-list-row",
    });
    this.compositeListInputEl = this.compositeListRowEl.createEl("input", {
      type: "text",
      cls: "unified-outliner-partial-edit-composite-list-input",
    });
    // Same dirty-tracking policy as quoteTitleInputEl/textareaEl's own
    // listeners further below — every keystroke here must also re-check
    // isDirty(), since isDirty() now considers this input too (see
    // isDirty's own listDirty computation).
    this.compositeListInputEl.addEventListener("input", () => this.updateDirtyState());

    // Phase 5D-0.5: created once here (like every other row in this
    // method), visibility/content toggled per-load by renderQuoteHeader —
    // same "create once in onOpen, mutate on each render" policy as
    // breadcrumbEl/siblingNavEl/subtreeNavEl above.
    //
    // Phase 5D-1A: now a multi-child row — quoteHeaderLabelEl (read-only)
    // and quoteTitleInputEl (editable) — see both fields' own doc
    // comments for why `.setText()` must never be called on
    // quoteHeaderEl itself any more.
    // Phase 5D-1B: quoteMarkerSelectEl is created BETWEEN the two, so the
    // header row reads left-to-right as "quote prefix + [!type]" ->
    // "fold behavior" -> "title".
    // Phase 5D-1C: quoteTypeInputEl (+ its quoteTypeDatalistEl) and
    // quoteTypeCloseLabelEl are created between quoteHeaderLabelEl and
    // quoteMarkerSelectEl, so the row now reads "quote prefix + [!" ->
    // "type" -> "]" -> "fold behavior" -> "title".
    this.quoteHeaderEl = this.contentEl.createDiv({
      cls: "unified-outliner-partial-edit-quote-header",
    });
    this.quoteHeaderLabelEl = this.quoteHeaderEl.createSpan({
      cls: "unified-outliner-partial-edit-quote-header-label",
    });
    // Phase 5D-1C: the editable type combobox and its backing datalist —
    // created BETWEEN quoteHeaderLabelEl (quote prefix + literal `[!`)
    // and quoteTypeCloseLabelEl (literal `]`), so the row's static
    // bracket punctuation still reads naturally around the now-editable
    // type. The datalist only ever offers suggestions — see
    // quoteTypeInputEl's own doc comment for why its `list` attribute
    // never constrains what can actually be typed/pasted here.
    this.quoteTypeDatalistEl = this.quoteHeaderEl.createEl("datalist", {
      attr: { id: PartialEditView.QUOTE_TYPE_DATALIST_ID },
    });
    for (const type of PartialEditView.QUOTE_TYPE_DATALIST_OPTIONS) {
      this.quoteTypeDatalistEl.createEl("option", { value: type });
    }
    this.quoteTypeInputEl = this.quoteHeaderEl.createEl("input", {
      type: "text",
      cls: "unified-outliner-partial-edit-quote-type-input",
      attr: { list: PartialEditView.QUOTE_TYPE_DATALIST_ID },
    });
    setTooltip(this.quoteTypeInputEl, this.plugin.t("partialEdit.quoteTypeLabel"));
    // Same dirty-tracking policy as quoteTitleInputEl/quoteMarkerSelectEl's
    // own listeners — every keystroke in the type combobox must also
    // re-check isDirty(), since isDirty() now considers the type input
    // too. It must ALSO re-filter the datalist's own suggestion list —
    // see refreshQuoteTypeDatalistOptions's own doc comment for why the
    // browser's native filtering isn't good enough here.
    this.quoteTypeInputEl.addEventListener("input", () => {
      this.refreshQuoteTypeDatalistOptions();
      this.updateDirtyState();
    });
    this.quoteTypeCloseLabelEl = this.quoteHeaderEl.createSpan({
      cls: "unified-outliner-partial-edit-quote-header-label",
    });
    this.quoteMarkerSelectEl = this.quoteHeaderEl.createEl("select", {
      cls: "unified-outliner-partial-edit-quote-marker-select",
    });
    this.quoteMarkerSelectEl.createEl("option", {
      value: "",
      text: this.plugin.t("partialEdit.quoteFoldMarkerNone"),
    });
    this.quoteMarkerSelectEl.createEl("option", {
      value: "+",
      text: this.plugin.t("partialEdit.quoteFoldMarkerExpand"),
    });
    this.quoteMarkerSelectEl.createEl("option", {
      value: "-",
      text: this.plugin.t("partialEdit.quoteFoldMarkerCollapse"),
    });
    setTooltip(this.quoteMarkerSelectEl, this.plugin.t("partialEdit.quoteFoldMarkerLabel"));
    // Same dirty-tracking policy as quoteTitleInputEl/textareaEl's own
    // listeners — every change to the select must also re-check
    // isDirty(), since isDirty() now considers the marker select too.
    this.quoteMarkerSelectEl.addEventListener("change", () => this.updateDirtyState());
    this.quoteTitleInputEl = this.quoteHeaderEl.createEl("input", {
      type: "text",
      cls: "unified-outliner-partial-edit-quote-title-input",
    });
    this.quoteTitleInputEl.setAttribute("placeholder", this.plugin.t("partialEdit.quoteTitleLabel"));
    setTooltip(this.quoteTitleInputEl, this.plugin.t("partialEdit.quoteTitleLabel"));
    // Same dirty-tracking policy as textareaEl's own input listener right
    // below — every keystroke in the title input must also re-check
    // isDirty(), since isDirty() now considers the title input too.
    this.quoteTitleInputEl.addEventListener("input", () => this.updateDirtyState());

    // Phase 5L-2 ("Task List Marker-Free Partial Edit"): created once here
    // (like every other row in this method), visibility/content toggled
    // per-load by renderTaskCheckboxRow. Sits directly above the shared
    // textareaEl below, which this same standalone task-list item's own
    // marker-free/checkbox-free BODY editor reuses unchanged.
    this.taskCheckboxRowEl = this.contentEl.createDiv({
      cls: "unified-outliner-partial-edit-task-checkbox-row",
    });
    this.taskCheckboxInputEl = this.taskCheckboxRowEl.createEl("input", {
      type: "checkbox",
      cls: "unified-outliner-partial-edit-task-checkbox-input",
    });
    setTooltip(this.taskCheckboxInputEl, this.plugin.t("partialEdit.taskCheckboxLabel"));
    // Same dirty-tracking policy as compositeListInputEl's own listener
    // above — every toggle here must also re-check isDirty(), since
    // isDirty() now considers this checkbox too (see isDirty's own
    // taskCheckedDirty check).
    this.taskCheckboxInputEl.addEventListener("change", () => this.updateDirtyState());

    // Phase 5L-3 ("Ordered List Marker-Free Partial Edit"): created once
    // here (like every other row in this method), visibility/content
    // toggled per-load by renderOrderedNumberRow. Sits directly above the
    // shared textareaEl below, which this same standalone ordered-list
    // item's own marker-free BODY editor reuses unchanged.
    this.orderedNumberRowEl = this.contentEl.createDiv({
      cls: "unified-outliner-partial-edit-ordered-number-row",
    });
    this.orderedNumberInputEl = this.orderedNumberRowEl.createEl("input", {
      type: "text",
      cls: "unified-outliner-partial-edit-ordered-number-input",
    });
    setTooltip(this.orderedNumberInputEl, this.plugin.t("partialEdit.orderedNumberLabel"));
    // Same dirty-tracking policy as taskCheckboxInputEl's own listener
    // above — every keystroke here must also re-check isDirty(), since
    // isDirty() now considers this input too (see isDirty's own
    // orderedNumberDirty check).
    this.orderedNumberInputEl.addEventListener("input", () => this.updateDirtyState());

    this.textareaEl = this.contentEl.createEl("textarea", {
      cls: "unified-outliner-partial-edit-textarea",
    });
    // See updateDirtyState's doc comment: Apply/Cancel are only shown once
    // there is something to Apply/Cancel, so every keystroke needs to
    // re-check whether the textarea still matches its loaded snapshot
    // (originalText, or — Phase 5D-0.5 — the projected displayText for a
    // projecting callout/blockquote; see isDirty/currentDisplayText).
    this.textareaEl.addEventListener("input", () => this.updateDirtyState());

    // Phase 5L-9b ("First Direct Child Addition for Leaf List Items —
    // Mode B"): the "add a first child" row for a STANDALONE leaf item —
    // sits directly below the shared body textarea (created immediately
    // above), BEFORE parentChildPreviewEl (created immediately below),
    // since that one only ever becomes visible once this leaf has
    // actually become a real parent (Apply). Toggled/populated
    // per-load/per-reload by renderLeafFirstChildAddRow. No `input`/
    // `change` listener of any kind on this row itself — only its own
    // button below has a click handler, mirroring parentChildAddButtonEl's
    // own identical structure.
    this.leafFirstChildAddRowEl = this.contentEl.createDiv({
      cls: "unified-outliner-partial-edit-leaf-first-child-add-row",
    });
    this.leafFirstChildAddButtonEl = this.leafFirstChildAddRowEl.createEl("button", {
      cls: "unified-outliner-partial-edit-leaf-first-child-add-button",
      attr: { type: "button" },
    });
    setIcon(this.leafFirstChildAddButtonEl, "plus");
    setTooltip(this.leafFirstChildAddButtonEl, this.plugin.t("partialEdit.leafFirstChildAddButtonLabel"));
    this.leafFirstChildAddButtonEl.addEventListener("click", (evt) => {
      evt.stopPropagation();
      this.handleRequestAddLeafFirstChild();
    });
    this.leafFirstChildAddRowEl.toggleVisibility(false);

    // Phase 5L-6 ("Parent List Item Structured Partial Edit"): the
    // read-only child-subtree preview — sits directly BELOW textareaEl
    // (created above), toggled per-load/per-reload by
    // renderParentChildPreview. See parentChildPreviewEl's own field doc
    // comment for the full rationale. No `input`/`change` listener of any
    // kind on this element or its children — it is never editable, so
    // isDirty()/updateDirtyState never need to observe it.
    this.parentChildPreviewEl = this.contentEl.createDiv({
      cls: "unified-outliner-partial-edit-parent-child-preview",
    });
    this.parentChildPreviewLabelEl = this.parentChildPreviewEl.createDiv({
      cls: "unified-outliner-partial-edit-parent-child-preview-label",
    });
    // Phase 5L-9 follow-up fix: dedicated text-only child span — see this
    // field's own doc comment for why renderParentChildPreview must never
    // call `.setText` on parentChildPreviewLabelEl itself once it also
    // holds parentChildAddButtonEl as a child.
    this.parentChildPreviewLabelTextEl = this.parentChildPreviewLabelEl.createSpan({
      cls: "unified-outliner-partial-edit-parent-child-preview-label-text",
    });
    // Phase 5L-9 ("Direct Child Add/Delete in Parent Partial Edit Pane"):
    // the "Add child item" control sits in the SAME row as the read-only
    // preview's own label (§10's own "child-preview header" placement) —
    // a genuinely separate control from anything in the parent's own
    // body textarea above it, so its own click handler always stops
    // propagation (see handleRequestAddChild) even though this label row
    // itself has no OTHER click handler to guard against today.
    this.parentChildAddButtonEl = this.parentChildPreviewLabelEl.createEl("button", {
      cls: "unified-outliner-partial-edit-parent-child-add-button",
      attr: { type: "button" },
    });
    setIcon(this.parentChildAddButtonEl, "plus");
    setTooltip(this.parentChildAddButtonEl, this.plugin.t("partialEdit.parentChildAddButtonLabel"));
    this.parentChildAddButtonEl.addEventListener("click", (evt) => {
      evt.stopPropagation();
      this.handleRequestAddChild();
    });
    this.parentChildPreviewBodyEl = this.parentChildPreviewEl.createDiv({
      cls: "unified-outliner-partial-edit-parent-child-preview-body",
    });
    this.parentChildPreviewBodyEl.setAttribute("aria-readonly", "true");
    this.parentChildPreviewBodyEl.setAttribute("data-readonly", "true");
    this.parentChildPreviewTruncatedEl = this.parentChildPreviewEl.createDiv({
      cls: "unified-outliner-partial-edit-parent-child-preview-truncated",
    });

    // Phase 5L-8 ("Child Item Inline Structured Editing in Parent Partial
    // Edit Pane"): the ONE inline structured editor for the currently-
    // selected direct child — created once here (like every other row in
    // this method), toggled/populated per-load/per-reload/per-Apply by
    // renderChildInlineEditor. See childInlineEditorEl's own field doc
    // comment for the full rationale.
    this.childInlineEditorEl = this.contentEl.createDiv({
      cls: "unified-outliner-partial-edit-child-inline-editor",
    });
    const childInlineHeaderEl = this.childInlineEditorEl.createDiv({
      cls: "unified-outliner-partial-edit-child-inline-header",
    });
    this.childInlineEditorLabelEl = childInlineHeaderEl.createSpan({
      cls: "unified-outliner-partial-edit-child-inline-label",
    });
    this.childInlineStopButtonEl = childInlineHeaderEl.createEl("button", {
      cls: "unified-outliner-partial-edit-child-inline-stop",
      text: this.plugin.t("partialEdit.parentChildInlineEditStopLabel"),
    });
    this.childInlineStopButtonEl.addEventListener("click", () => this.handleStopChildInlineEdit());

    this.childInlineTaskCheckboxRowEl = this.childInlineEditorEl.createDiv({
      cls: "unified-outliner-partial-edit-task-checkbox-row unified-outliner-partial-edit-child-inline-row",
    });
    this.childInlineTaskCheckboxInputEl = this.childInlineTaskCheckboxRowEl.createEl("input", {
      type: "checkbox",
      cls: "unified-outliner-partial-edit-task-checkbox-input",
    });
    setTooltip(this.childInlineTaskCheckboxInputEl, this.plugin.t("partialEdit.taskCheckboxLabel"));
    this.childInlineTaskCheckboxInputEl.addEventListener("change", () => this.updateDirtyState());

    this.childInlineOrderedNumberRowEl = this.childInlineEditorEl.createDiv({
      cls: "unified-outliner-partial-edit-ordered-number-row unified-outliner-partial-edit-child-inline-row",
    });
    this.childInlineOrderedNumberInputEl = this.childInlineOrderedNumberRowEl.createEl("input", {
      type: "text",
      cls: "unified-outliner-partial-edit-ordered-number-input",
    });
    setTooltip(this.childInlineOrderedNumberInputEl, this.plugin.t("partialEdit.orderedNumberLabel"));
    this.childInlineOrderedNumberInputEl.addEventListener("input", () => this.updateDirtyState());

    this.childInlineTextareaEl = this.childInlineEditorEl.createEl("textarea", {
      cls: "unified-outliner-partial-edit-textarea unified-outliner-partial-edit-child-inline-textarea",
    });
    this.childInlineTextareaEl.addEventListener("input", () => this.updateDirtyState());
    this.childInlineEditorEl.toggleVisibility(false);

    // Phase 5L-9 ("Direct Child Add/Delete in Parent Partial Edit Pane"):
    // the pending new-child's own inline editor — see newChildEditorEl's
    // own field doc comment for why this is a SEPARATE panel from
    // childInlineEditorEl immediately above. Just a header (label + a
    // "cancel this new item" button, mirroring childInlineStopButtonEl's
    // own row exactly) and one textarea — no checkbox/number row, since
    // the new child's own shape is always unordered/non-task.
    this.newChildEditorEl = this.contentEl.createDiv({
      cls: "unified-outliner-partial-edit-child-inline-editor unified-outliner-partial-edit-new-child-editor",
    });
    const newChildHeaderEl = this.newChildEditorEl.createDiv({
      cls: "unified-outliner-partial-edit-child-inline-header",
    });
    this.newChildEditorLabelEl = newChildHeaderEl.createSpan({
      cls: "unified-outliner-partial-edit-child-inline-label",
      text: this.plugin.t("partialEdit.parentChildNewChildPanelLabel"),
    });
    this.newChildStopButtonEl = newChildHeaderEl.createEl("button", {
      cls: "unified-outliner-partial-edit-child-inline-stop",
      text: this.plugin.t("partialEdit.parentChildNewChildStopLabel"),
    });
    // Phase 5L-9b: dispatches to whichever of the two mutually-exclusive
    // "stop this pending new-child draft" handlers actually applies —
    // see handleStopLeafFirstChildDraft's own doc comment.
    this.newChildStopButtonEl.addEventListener("click", () => {
      if (this.pendingLeafFirstChild) {
        this.handleStopLeafFirstChildDraft();
      } else {
        this.handleStopNewChildDraft();
      }
    });
    this.newChildTextareaEl = this.newChildEditorEl.createEl("textarea", {
      cls: "unified-outliner-partial-edit-textarea unified-outliner-partial-edit-child-inline-textarea",
    });
    this.newChildTextareaEl.addEventListener("input", () => this.updateDirtyState());
    this.newChildEditorEl.toggleVisibility(false);

    // Real-device follow-up: keep exactly one visible close affordance.
    // See updateCloseButtonVisibility's doc comment for why a lone leaf
    // docked in the sidebar needs this pane's own ×, while a leaf that's
    // been dragged into a normal tab or popped into its own window
    // (Phase 5A's "open in new window" support) already gets a native tab
    // × from Obsidian — showing both there would be a redundant, confusing
    // double close button. `layout-change` fires whenever a leaf moves
    // between containers (sidebar <-> tab <-> popout), so re-checking on
    // every one of those keeps this correct as the user drags the pane
    // around, not just at first open. registerEvent (not a raw
    // workspace.on) ties this listener's lifetime to the view via
    // Component, so it's automatically removed on close instead of
    // outliving this pane.
    this.registerEvent(
      this.app.workspace.on("layout-change", () => this.updateCloseButtonVisibility())
    );

    // Phase 5A-1: the sole authoritative sources for "did this pane's
    // loaded content go stale" — every one of them ultimately funnels into
    // the SAME debounced performStaleCheck() (see scheduleStaleCheck's own
    // doc comment), never `this.plugin.activeMarkdownView`
    // (ActiveMarkdownViewTracker), which is a PLUGIN-SHARED, single
    // "most-recently-focused" cache — not per-file — and was the v1
    // design's own root-cause bug (see the design doc's revision history).
    //
    // editor-change: fires for BOTH a user keystroke AND a programmatic
    // edit (Apply's own editor.replaceRange call — obsidian.d.ts's own doc
    // comment: "either programmatically or from a user event"), so this
    // pane's OWN Apply also fires this. That is not a false-positive risk
    // here: applyEdit() already reassigns `this.originalText` (or the
    // relevant anchor's originalText) SYNCHRONOUSLY, in the same call
    // stack as the replaceRange call that triggers this event — by the
    // time this debounced check actually runs (at least one full event
    // loop turn later), `this.originalText` and the live editor content
    // already agree, so performStaleCheck resolves to "synced", never a
    // spurious "stale". `info.file?.path === this.sourcePath` is the
    // match — never `activeMarkdownViewTracker` — so a background/
    // inactive/popped-out Pane still detects a change to its own
    // sourcePath.
    this.registerEvent(
      this.app.workspace.on("editor-change", (editor: Editor, info: MarkdownView | MarkdownFileInfo) =>
        this.handleEditorChange(editor, info)
      )
    );
    // vault "modify"/"rename"/"delete": path-based, so these catch a
    // change to `sourcePath` even while it has no open editor at all
    // (background file, or a file never opened in this window) — the
    // case editor-change alone can never cover.
    this.registerEvent(
      this.app.vault.on("modify", (file: TAbstractFile) => this.handleVaultModify(file))
    );
    this.registerEvent(
      this.app.vault.on("rename", (file: TAbstractFile, oldPath: string) =>
        this.handleVaultRename(file, oldPath)
      )
    );
    this.registerEvent(
      this.app.vault.on("delete", (file: TAbstractFile) => this.handleVaultDelete(file))
    );
    // active-leaf-change / file-open: deliberately ONLY a re-check
    // trigger, never the primary sourcePath-matching path — neither
    // handler inspects which file/leaf triggered it; both simply ask
    // performStaleCheck to re-verify THIS pane's own sourcePath, which
    // performStaleCheck itself no-ops on when nothing is loaded. Switching
    // to an unrelated file therefore never staleifies/unavailable-izes
    // this pane by itself.
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.scheduleStaleCheck()));
    this.registerEvent(this.app.workspace.on("file-open", () => this.scheduleStaleCheck()));

    this.renderEmptyState();
    this.updateCloseButtonVisibility();
  }

  async onClose(): Promise<void> {
    // Intentionally no auto-save here: per the Phase 3B design, Close
    // (like Cancel) never applies pending edits — only the Apply button
    // does.
    //
    // 2026-09-09 ("単独 Callout Partial Edit Pane の stale snapshot 表示
    // バグ修正"): explicitly clears every target/snapshot/draft field via
    // resetLoadedState() — see that method's own doc comment. Previously
    // this method cleared only `closed` and the DOM, leaving nodeId/
    // nodeKind/originalText/quoteProjection/label/sourcePath/ancestors/
    // directChildren/siblingState/syncState sitting at whatever they were
    // when this pane was last loaded. Per this ticket's own requirement
    // 3.2 ("明示的にpaneをClose/Delete/Disposeした場合は、未適用draftを
    // 保存・再利用しない"), an explicitly closed pane must never let a
    // later session reuse its draft/target — this now holds as a real
    // invariant of this method, not merely an assumption about whether
    // Obsidian happens to destroy and recreate this View instance on the
    // next open. (It does not, in at least one already-existing code
    // path this plugin itself uses: activatePartialEditView's
    // `openInNewWindow` branch calls `workspace.moveLeafToPopout(leaf)`
    // on an existing leaf, which moves this same View instance into a
    // popout window WITHOUT calling onClose/onOpen again.)
    //
    // Phase 5A-1: `closed` is checked at the top of every method that
    // might still run after this point (a pending vault.cachedRead
    // promise, or a debounced scheduleStaleCheck callback already queued
    // before this pane closed) — see that field's own doc comment for why
    // registerEvent's automatic unregistration alone isn't enough to make
    // those paths inert.
    this.closed = true;
    this.resetLoadedState();
    this.contentEl.empty();
  }

  /**
   * 2026-09-09 ("単独 Callout Partial Edit Pane の stale snapshot 表示
   * バグ修正"): the single place every "this pane has nothing loaded, and
   * holds no leftover target/snapshot/draft from a previous session" is
   * enforced — shared by onClose above (an explicit Close/Delete/Dispose)
   * and renderEmptyState below (onOpen's own "nothing loaded yet"
   * baseline, and the state every requestLoadNode/
   * requestLoadParagraphAtCursor/requestLoadComposite call implicitly
   * starts a fresh load from). Clears every field
   * loadNodeInternal/loadParagraphInternal/loadCompositeInternal ever
   * writes, so neither onClose nor renderEmptyState can leave a stale
   * target/snapshot/draft field behind for a later load to accidentally
   * inherit.
   *
   * Investigation note: renderEmptyState previously reset ancestors/
   * directChildren/siblingState/sourcePath/syncState/paragraphAnchor/
   * compositeAnchor/quoteProjection inline, but NOT nodeId/nodeKind/
   * originalText/label — a gap this ticket's own investigation found.
   * That gap was harmless for renderEmptyState's own caller (onOpen calls
   * it once, on a brand-new instance whose nodeId/originalText/label are
   * already at their class-field defaults), but left onClose with
   * nothing at all to reuse this shared reset from once onClose also
   * needed one. Consolidating both call sites onto this single method
   * closes that gap for both at once, rather than fixing renderEmptyState
   * alone and hand-duplicating a second, easy-to-drift-out-of-sync copy
   * for onClose.
   */
  private resetLoadedState(): void {
    this.nodeId = null;
    this.nodeKind = null;
    this.paragraphAnchor = null;
    this.compositeAnchor = null;
    this.originalText = "";
    this.quoteProjection = null;
    // Phase 5L-1: reset alongside quoteProjection above — see this
    // field's own doc comment.
    this.standaloneListMarkerProjection = null;
    // Phase 5L-2: reset alongside standaloneListMarkerProjection above —
    // see this field's own doc comment.
    this.standaloneTaskListProjection = null;
    // Phase 5L-3: reset alongside standaloneTaskListProjection above —
    // see this field's own doc comment.
    this.standaloneOrderedListProjection = null;
    // Phase 5L-4: reset alongside standaloneOrderedListProjection above —
    // see this field's own doc comment.
    this.standaloneMultiLineListProjection = null;
    // Phase 5L-6: reset alongside standaloneMultiLineListProjection above —
    // see this field's own doc comment.
    this.standaloneParentListItemProjection = null;
    // Phase 5L-8: reset alongside standaloneParentListItemProjection above
    // — see this field's own doc comment (a child inline session can only
    // ever exist alongside a live parent projection).
    this.childInlineSession = null;
    // Phase 5L-9: reset alongside childInlineSession above — see
    // ParentChildAddDeleteSession's own doc comment (its lifecycle exactly
    // mirrors standaloneParentListItemProjection/childInlineSession).
    this.childAddDeleteSession = null;
    this.pendingLeafFirstChild = null;
    this.compositeListOriginalText = null;
    // Phase 5D-2C: reset alongside compositeListOriginalText above — see
    // this field's own doc comment for why the two are never independent.
    this.listMarkerProjection = null;
    this.label = "";
    this.sourcePath = null;
    this.ancestors = [];
    this.directChildren = [];
    this.siblingState = { previous: null, next: null };
    this.syncState = "synced";
  }

  /**
   * Phase 5B: the guarded, PUBLIC entry point every external caller must
   * use to switch which node this pane displays — main.ts's
   * activatePartialEditView (itself called from OutlineTreeView's "Open
   * partial edit pane" / "Edit list subtree in pane" menu items), and this
   * file's own breadcrumb segment clicks (renderBreadcrumb below), both
   * call this instead of loadNodeInternal directly. This is the "single
   * common projection entry point" the implementation instruction calls
   * for: Tree-triggered switches and breadcrumb-triggered switches must
   * behave identically, including the unsaved-edit guard below, so neither
   * path may bypass it.
   *
   * When the pane has no unapplied edit (see isDirty), this is a same-tick
   * passthrough to loadNodeInternal — no behavior change from before
   * Phase 5B. When it does, an Apply/Discard/Cancel modal is shown first:
   * - Cancel: nothing happens; the pane stays exactly as it was.
   * - Discard: the unapplied edit is thrown away and `nodeId` loads.
   * - Apply: applyEdit() runs; `nodeId` only loads if that Apply actually
   *   succeeded (outcome.changed) — a failed Apply (conflict, refused
   *   edit, etc.) leaves the pane on its current node, exactly like
   *   clicking the Apply button directly already does, and applyEdit()
   *   has already shown the user a Notice explaining why.
   * Dismissing the modal any other way (Escape, clicking outside) is
   * treated as Cancel — see DiscardChangesModal's onClose.
   */
  requestLoadNode(nodeId: string): void {
    if (!this.isDirty()) {
      this.loadNodeInternal(nodeId);
      return;
    }
    new DiscardChangesModal(this.app, this.plugin, (choice) => {
      if (choice === "cancel") return;
      if (choice === "discard") {
        this.loadNodeInternal(nodeId);
        return;
      }
      // choice === "apply"
      if (this.applyEdit()) {
        this.loadNodeInternal(nodeId);
      }
    }).open();
  }

  /**
   * Phase 5P-2: the paragraph counterpart to requestLoadNode above — the
   * sole external entry point for loading a paragraph into this pane
   * (main.ts's activatePartialEditViewForParagraph, itself called from the
   * "Edit paragraph at cursor" command). Same unsaved-edit guard
   * (Apply/Discard/Cancel), reusing the exact same DiscardChangesModal —
   * deliberately not a second modal/flow.
   */
  requestLoadParagraphAtCursor(cursorLine: number): void {
    if (!this.isDirty()) {
      this.loadParagraphInternal(cursorLine);
      return;
    }
    new DiscardChangesModal(this.app, this.plugin, (choice) => {
      if (choice === "cancel") return;
      if (choice === "discard") {
        this.loadParagraphInternal(cursorLine);
        return;
      }
      // choice === "apply"
      if (this.applyEdit()) {
        this.loadParagraphInternal(cursorLine);
      }
    }).open();
  }

  /**
   * Phase 5D-2A: the CompositeBlock counterpart to requestLoadNode/
   * requestLoadParagraphAtCursor above — the sole external entry point for
   * loading an ENTIRE CompositeBlock (main.ts's
   * activatePartialEditViewForComposite, itself called from the CompositeBlock
   * parent's "Open extended block in partial edit" context-menu item).
   * Same unsaved-edit guard (Apply/Discard/Cancel), reusing the exact same
   * DiscardChangesModal — deliberately not a third modal/flow.
   */
  requestLoadComposite(snapshot: CompositeBlockSnapshot): void {
    if (!this.isDirty()) {
      this.loadCompositeInternal(snapshot);
      return;
    }
    new DiscardChangesModal(this.app, this.plugin, (choice) => {
      if (choice === "cancel") return;
      if (choice === "discard") {
        this.loadCompositeInternal(snapshot);
        return;
      }
      // choice === "apply"
      if (this.applyEdit()) {
        this.loadCompositeInternal(snapshot);
      }
    }).open();
  }

  /**
   * Load `nodeId` (a section OR a list item id) from the currently active
   * note into this pane, replacing whatever was loaded before (the pane
   * always holds at most one node — see the "reuse, don't multiply" leaf
   * policy in main.ts's activatePartialEditView, mirroring
   * activateOutlineTreeView).
   *
   * Phase 4C: renamed from loadSection, then dispatched to
   * extractSubtreeText rather than the section-only extractSectionText —
   * a list item with unsafeIndent is refused here (reason "unsafe-indent",
   * see edit/partialEdit.ts) exactly like an unresolvable id is.
   *
   * Phase 5B: renamed again, from loadNode to loadNodeInternal, and made
   * private — requestLoadNode above is now the only sanctioned way in from
   * outside this class. This method's own behavior is otherwise unchanged
   * (still unconditionally overwrites whatever was loaded before), which
   * is exactly why requestLoadNode's dirty guard has to sit in front of
   * it rather than being folded into it. Also now computes the
   * breadcrumb's ancestor list (findAncestorPath) alongside the existing
   * label lookup, both via the shared nodeDisplayLabel helper so the pane
   * title and the breadcrumb segments never disagree on how a node is
   * labeled. Post-Phase-5B: also computes the Subtree Navigator's direct
   * children (findDirectChildren) the same way — one fresh snapshot per
   * load, covering title, breadcrumb, and navigator together.
   */
  private loadNodeInternal(nodeId: string): void {
    const view = this.activeMarkdownView.get();
    if (!view) {
      // 2026-09-09 ("単独 Callout Partial Edit Pane の stale snapshot 表示
      // バグ修正", requirement 3.3/3.4): every failure return below this
      // point now calls renderEmptyState() before the Notice, so a
      // failed attempt to switch this pane's target NEVER leaves it
      // showing whatever it happened to have loaded before this call —
      // "解決不能なら...編集フォームを開かない／Apply不可状態にする" per
      // this ticket's own explicit requirement. This does not change the
      // already-existing "no active note" Notice text/behavior in any
      // other way.
      this.renderEmptyState();
      new Notice(this.plugin.t("partialEdit.noActiveNote"));
      return;
    }

    const doc = parseDocument(view.editor.getValue());
    const extracted = extractSubtreeText(doc, nodeId);
    if (!extracted.ok || !extracted.kind) {
      const reasonKey = ("reason." + (extracted.reason ?? "resolve-failed")) as TranslationKey;
      // 2026-09-09: see this method's own "no active note" branch above
      // for why renderEmptyState() now runs before every failure Notice.
      this.renderEmptyState();
      new Notice(this.plugin.t(reasonKey));
      return;
    }

    // Phase 5D-0.5: the quote-prefix-projection gate — deliberately BEFORE
    // any field on this pane is mutated below, so a "nested" refusal
    // leaves the pane exactly as it was (whatever was loaded before this
    // call, or the empty state) and never touches the note. Only
    // callout/blockquote ever attempt a projection; every other kind
    // (section/list) leaves `quoteProjection` at null, same as a
    // callout/blockquote whose reason is "no-body" (see
    // buildQuotePrefixProjection's own doc comment) — both fall through to
    // this pane's existing, unmodified raw-text load path below.
    let quoteProjection: QuotePrefixProjection | null = null;
    if (extracted.kind === "callout" || extracted.kind === "blockquote") {
      const built = buildQuotePrefixProjection(extracted.text, extracted.kind);
      if (!built.ok && built.reason === "nested") {
        // 2026-09-09 investigation note: deliberately NOT calling
        // renderEmptyState() here, unlike this method's other failure
        // branches. This gate runs strictly BEFORE any field on this pane
        // is mutated (see the comment above), so a "nested" refusal while
        // switching from an already-loaded target A to an unsupported
        // target B must leave A's display exactly as it was — a
        // pre-existing Phase 5D-0.5 contract this ticket's own scope does
        // not touch (this ticket's "stale snapshot on reopen" bug is about
        // a target that DOES resolve but shows outdated content, not about
        // this refusal path). Calling renderEmptyState() here would wipe
        // A's still-valid, still-displayed content out from under the
        // user for an unrelated target B's refusal — see
        // tests/quotePrefixPartialEditViewWiring.test.ts's own test name
        // for this exact invariant.
        new Notice(this.plugin.t("partialEdit.quoteNestedUnsupported"));
        return;
      }
      if (built.ok) {
        quoteProjection = built.projection;
      }
      // built.reason === "no-body": quoteProjection stays null, and
      // loadNodeInternal proceeds exactly as it always has — this specific
      // callout is shown raw, `>` prefix and all, via the untouched path
      // below (see renderLoadedState/currentDisplayText).
    }

    const t = this.plugin.t.bind(this.plugin);
    const node = doc.nodes.get(nodeId);
    let label: string;
    if (node) {
      label = nodeDisplayLabel(doc, node, t);
    } else {
      // Phase 5C-2: extracted.ok is true and node is undefined only for
      // the new standalone callout/blockquote path (see
      // extractSubtreeText's own doc comment). A fresh scanComplexBlocks()
      // re-lookup (rather than trusting extracted fields as an id-free
      // proxy) keeps this resolution independently re-verified, same
      // policy as every other CompositeBlock-adjacent module.
      const complexBlock = scanComplexBlocks(doc).blocks.find((b) => b.id === nodeId);
      label = complexBlock ? standaloneComplexBlockLabel(doc, complexBlock, t) : "";
    }

    // Phase 5L-1/5L-2: analogous gate for a standalone single-line
    // unordered leaf list item — deliberately AFTER the quote gate above
    // (mutually exclusive: extracted.kind is never simultaneously "list"
    // and "callout"/"blockquote") and, like it, strictly BEFORE any field
    // on this pane is mutated below. Unlike the quote gate, there is no
    // hard-refusal branch here at all — per Phase 5L-1's own explicit
    // scope (unchanged by Phase 5L-2), an ineligible list item is NEVER
    // refused opening, only shown raw (see
    // edit/standaloneListMarkerProjection.ts's own doc comment for why
    // structural eligibility alone can be decided from `node` without
    // looking at its text).
    //
    // Phase 5L-2: buildStandaloneListProjections (below) tries the
    // non-task ListMarkerProjection first and, ONLY on its own
    // "task-list-marker" refusal, the task-list TaskListProjection — see
    // that method's own doc comment for why the two are mutually
    // exclusive by construction, and why a structurally-eligible item can
    // still legitimately fall back to raw here (an ordered marker, or a
    // task checkbox whose own status character this ticket's minimal
    // scope doesn't support — edit/taskListProjection.ts's own
    // "unsupported-status" refusal).
    // Phase 5L-12: the five-tier eligibility-check-then-builder-call
    // chain that used to be duplicated inline here is now the single
    // shared resolveStandaloneListProjections — see its own doc comment.
    // `extracted.kind === "list"` (this method's own prior explicit gate
    // on every one of the five checks) is provably equivalent to
    // `node !== undefined && isListNode(node)` (extractSubtreeText's own
    // kind assignment is itself driven by that exact same check — see
    // edit/partialEdit.ts's own implementation), so dropping it here
    // changes nothing observable.
    this.nodeId = nodeId;
    this.nodeKind = extracted.kind;
    // Phase 5P-2/5D-2A: clear any previously-loaded paragraph/composite
    // identity — exactly one of nodeId/paragraphAnchor/compositeAnchor is
    // ever active at a time (see this class's own doc comment).
    this.paragraphAnchor = null;
    this.compositeAnchor = null;
    this.originalText = extracted.text;
    this.quoteProjection = quoteProjection;
    // Phase 5L-12: the five-tier projection chain
    // (standaloneListMarkerProjection/standaloneTaskListProjection/
    // standaloneOrderedListProjection/standaloneMultiLineListProjection/
    // standaloneParentListItemProjection), the Mode A/B session fields
    // (childAddDeleteSession/childInlineSession/pendingLeafFirstChild),
    // and the ancestors/directChildren/siblingState triple are all now
    // derived by the single shared reconcileStandaloneNodeState — see
    // its own doc comment. This replaces what used to be ~90 lines of
    // eligibility checks, builder calls, and field assignments
    // independently duplicated (and, before this phase, silently
    // drifting out of sync with) performAutoReload's and each Apply
    // success rebuild's own copies of the same logic.
    this.reconcileStandaloneNodeState(doc, nodeId, node, extracted.text);
    // 2026-09-14 (regression fix): a fresh node load must clear any
    // structured-composite list-member snapshot left behind by a PRIOR
    // composite session — otherwise isDirty()'s listDirty check compares
    // this unrelated node's (always-empty, since nodeKind !== "composite"
    // here) compositeListInputEl.value against that stale non-null
    // snapshot and reads dirty on every switch, even with zero edits.
    // Mirrors quoteProjection's own reset immediately above, which this
    // ticket's own investigation found was the ONLY field of its kind
    // being reset here — compositeListOriginalText was missed when
    // Phase 5D-2B added it (see loadParagraphInternal's identical fix).
    this.compositeListOriginalText = null;
    // Phase 5D-2C: reset alongside compositeListOriginalText above — see
    // this field's own doc comment for why the two are never independent.
    this.listMarkerProjection = null;
    this.label = label;
    // Phase 5C-4: recorded fresh on every load, from the SAME `view` this
    // method already resolved `doc` from above — see the class field's own
    // doc comment and view/partialEditSourceNoteCheck.ts for why this
    // exists and how applyEdit uses it.
    this.sourcePath = view.file?.path ?? null;
    // Phase 5A-1: a fresh load is by definition in sync with what it was
    // just read from — see the `syncState` field's own doc comment for
    // when this gets set to anything else.
    this.syncState = "synced";
    this.renderLoadedState();
  }

  /**
   * Phase 5P-2: paragraph counterpart to loadNodeInternal above — loads the
   * SINGLE paragraph at `cursorLine` in the currently active note into this
   * pane. Deliberately NOT a branch inside loadNodeInternal itself: a
   * paragraph has no BlockNode/ComplexBlockInfo id known in advance (the
   * caller only has a cursor line, resolved here via
   * resolver/resolveParagraphAtCursor.ts), and its Apply-time
   * re-resolution needs parentId/depth captured alongside the usual id +
   * "before editing" snapshot — see edit/paragraphPartialEdit.ts's own doc
   * comment for why that extra bookkeeping can't reuse
   * extractSubtreeText/applySubtreeEdit's existing id-only contract as-is.
   */
  private loadParagraphInternal(cursorLine: number): void {
    const view = this.activeMarkdownView.get();
    if (!view) {
      // 2026-09-09: see loadNodeInternal's identical "no active note"
      // branch for why renderEmptyState() now runs before every failure
      // Notice in this pane's load* methods.
      this.renderEmptyState();
      new Notice(this.plugin.t("partialEdit.noActiveNote"));
      return;
    }

    const doc = parseDocument(view.editor.getValue());
    const resolved = resolveParagraphAtCursor(doc, cursorLine);
    if (!resolved.paragraph) {
      const reasonKey = ("reason." + (resolved.reason ?? "no-paragraph")) as TranslationKey;
      this.renderEmptyState();
      new Notice(this.plugin.t(reasonKey));
      return;
    }
    const paragraph = resolved.paragraph;

    this.nodeId = null;
    this.paragraphAnchor = buildParagraphEditAnchor(doc, paragraph);
    // Phase 5D-2A: clear any previously-loaded composite identity — see
    // this class's own doc comment on the three-way exclusivity.
    this.compositeAnchor = null;
    this.nodeKind = "paragraph";
    this.originalText = paragraph.text;
    // Phase 5D-0.5: a paragraph never projects — see this class field's own
    // doc comment (quoteProjection is exclusively a callout/blockquote
    // concept). Reset alongside originalText/nodeKind above so a pane that
    // was just showing a projected quote body doesn't leave a stale
    // projection behind for currentDisplayText/isDirty to trip over.
    this.quoteProjection = null;
    // Phase 5L-1: reset alongside quoteProjection above — see this
    // field's own doc comment (a paragraph is never eligible for
    // marker-free list projection).
    this.standaloneListMarkerProjection = null;
    // Phase 5L-2: reset alongside standaloneListMarkerProjection above —
    // see this field's own doc comment.
    this.standaloneTaskListProjection = null;
    // Phase 5L-3: reset alongside standaloneTaskListProjection above —
    // see this field's own doc comment (a paragraph is never eligible for
    // ordered-list marker-free projection either).
    this.standaloneOrderedListProjection = null;
    // Phase 5L-4: reset alongside standaloneOrderedListProjection above —
    // see this field's own doc comment (a paragraph is never eligible for
    // multi-line marker-free projection either).
    this.standaloneMultiLineListProjection = null;
    // Phase 5L-6: reset alongside standaloneMultiLineListProjection above
    // — see this field's own doc comment (a paragraph is never eligible
    // for parent structured projection either).
    this.standaloneParentListItemProjection = null;
    // Phase 5L-8: reset alongside standaloneParentListItemProjection above
    // — see this field's own doc comment.
    this.childInlineSession = null;
    // Phase 5L-9: reset alongside childInlineSession above — see
    // ParentChildAddDeleteSession's own doc comment (its lifecycle exactly
    // mirrors standaloneParentListItemProjection/childInlineSession).
    this.childAddDeleteSession = null;
    this.pendingLeafFirstChild = null;
    // 2026-09-14 (regression fix): same reset, same reason, as
    // loadNodeInternal's identical fix above — a paragraph load must also
    // clear any structured-composite list-member snapshot left behind by
    // a prior composite session, or isDirty() reads dirty with zero edits
    // after switching away from a composite.
    this.compositeListOriginalText = null;
    // Phase 5D-2C: reset alongside compositeListOriginalText above — see
    // this field's own doc comment for why the two are never independent.
    this.listMarkerProjection = null;
    this.label = paragraph.preview;
    // Phase 5C-4 convention, reused as-is: recorded fresh on every load,
    // from the SAME `view` this method already resolved `doc` from above.
    this.sourcePath = view.file?.path ?? null;
    // Phase 5A-1: see loadNodeInternal's identical reset — a fresh load is
    // always in sync with what it was just read from.
    this.syncState = "synced";
    // Phase 5P-2 explicit scope: no breadcrumb / sibling nav / Subtree
    // Navigator for a paragraph — see this class's own doc comment.
    // renderSiblingNav's own visibility check hinges on `this.nodeId`
    // (null here), so it stays hidden with no further change needed;
    // renderBreadcrumb/renderSubtreeNavigator hide themselves whenever
    // their backing arrays are empty, which they are here too.
    this.ancestors = [];
    this.directChildren = [];
    this.siblingState = { previous: null, next: null };
    this.renderLoadedState();
  }

  /**
   * Phase 5D-2A: CompositeBlock counterpart to loadNodeInternal/
   * loadParagraphInternal above — loads the ENTIRE CompositeBlock (list
   * item + callout/blockquote) described by `snapshot` as ONE raw-Markdown
   * range. Never trusts `snapshot`'s own id/member ids as current truth —
   * extractCompositeBlockText re-parses/re-scans/re-matches fresh and
   * re-identifies the target purely by content (see that module's own top
   * doc comment). Deliberately NOT a branch inside loadNodeInternal: a
   * CompositeBlock has no BlockNode/ComplexBlockInfo id of its own (it is
   * a read-only VIEW over two other models — model/compositeBlock.ts's own
   * top doc comment), so its Apply-time re-resolution needs the whole
   * CompositeBlockSnapshot, not a single id — same reasoning
   * loadParagraphInternal's own doc comment gives for why IT can't reuse
   * extractSubtreeText/applySubtreeEdit's id-only contract either.
   *
   * Per this ticket's approved scope: no quote-prefix-projection, no
   * callout header title input/fold-marker select/type combobox, no
   * breadcrumb/sibling-nav/Subtree Navigator — the pane shows the whole
   * range as plain raw Markdown, at the same safety level as the existing
   * section/list raw Partial Edit, and nothing more.
   */
  private loadCompositeInternal(snapshot: CompositeBlockSnapshot): void {
    const view = this.activeMarkdownView.get();
    if (!view) {
      // 2026-09-09: see loadNodeInternal's identical "no active note"
      // branch for why renderEmptyState() now runs before every failure
      // Notice in this pane's load* methods.
      this.renderEmptyState();
      new Notice(this.plugin.t("partialEdit.noActiveNote"));
      return;
    }

    const doc = parseDocument(view.editor.getValue());
    const rules = getEnabledCompositeBlockRules(this.plugin.settings.compositeBlocks);
    const extracted = extractCompositeBlockText(doc, snapshot, rules);
    if (!extracted.ok || !extracted.resolvedSnapshot) {
      // Phase 5D-2A: see the Apply-time branch's identical use of
      // compositePartialEditReasonText below for why this is not a plain
      // "reason." + extracted.reason concatenation.
      //
      // 2026-09-09: see loadNodeInternal's identical "no active note"
      // branch above for why renderEmptyState() now runs before every
      // failure Notice.
      this.renderEmptyState();
      new Notice(compositePartialEditReasonText(this.plugin.t.bind(this.plugin), extracted.reason));
      return;
    }

    const t = this.plugin.t.bind(this.plugin);
    const rule = getCompositeBlockRuleById(rules, extracted.resolvedSnapshot.ruleId);
    const label = rule ? compositeBlockDisplayLabel(rule, t) : extracted.resolvedSnapshot.ruleId;

    this.nodeId = null;
    this.paragraphAnchor = null;
    this.compositeAnchor = extracted.resolvedSnapshot;
    this.nodeKind = "composite";
    this.originalText = extracted.text;
    // Phase 5D-2B ("CompositeBlock Structured Partial Edit Projection"): attempt to
    // split this CompositeBlock into its own list member + trailing
    // callout/blockquote member, and — only if that split succeeds — also
    // project the trailing member's body the exact same way a STANDALONE
    // callout/blockquote already is (edit/quotePrefixProjection.ts,
    // unmodified). Either failure (an unexpected member shape, or the
    // trailing member being "nested"/header-only-with-no-body) falls back
    // to the ORIGINAL, unmodified Phase 5D-2A behavior: quoteProjection
    // stays null, compositeListOriginalText stays null, and the pane shows
    // extracted.text verbatim in one raw textarea — see currentDisplayText/
    // renderCompositeListSlot for the two places that branch on these
    // fields. This never re-implements any parser/serializer logic of its
    // own — see edit/compositeBlockMemberProjection.ts's own top doc
    // comment for why splitting is pure line-slicing over the snapshot's
    // already-resolved member ranges.
    this.quoteProjection = null;
    // Phase 5L-1: reset alongside quoteProjection above — see this
    // field's own doc comment (a CompositeBlock session always uses the
    // separate `listMarkerProjection`/`compositeListOriginalText` fields
    // below for its own list member, never this one).
    this.standaloneListMarkerProjection = null;
    // Phase 5L-2: reset alongside standaloneListMarkerProjection above —
    // see this field's own doc comment.
    this.standaloneTaskListProjection = null;
    // Phase 5L-3: reset alongside standaloneTaskListProjection above —
    // see this field's own doc comment (same rationale — a CompositeBlock
    // session never uses this field either).
    this.standaloneOrderedListProjection = null;
    // Phase 5L-4: reset alongside standaloneOrderedListProjection above —
    // see this field's own doc comment (same rationale — a CompositeBlock
    // session never uses this field either).
    this.standaloneMultiLineListProjection = null;
    // Phase 5L-6: reset alongside standaloneMultiLineListProjection above
    // — see this field's own doc comment (same rationale — a
    // CompositeBlock session never uses this field either).
    this.standaloneParentListItemProjection = null;
    // Phase 5L-8: reset alongside standaloneParentListItemProjection above
    // — see this field's own doc comment.
    this.childInlineSession = null;
    // Phase 5L-9: reset alongside childInlineSession above — see
    // ParentChildAddDeleteSession's own doc comment (its lifecycle exactly
    // mirrors standaloneParentListItemProjection/childInlineSession).
    this.childAddDeleteSession = null;
    this.pendingLeafFirstChild = null;
    this.compositeListOriginalText = null;
    // Phase 5D-2C: reset alongside compositeListOriginalText above — see
    // this field's own doc comment for why the two are never independent.
    this.listMarkerProjection = null;
    const memberSplit = splitCompositeBlockMembers(doc.lines, extracted.resolvedSnapshot);
    if (memberSplit.ok) {
      const built = buildQuotePrefixProjection(
        memberSplit.split.trailingRawText,
        memberSplit.split.trailingKind
      );
      if (built.ok) {
        this.quoteProjection = built.projection;
        // Phase 5D-2C ("CompositeBlock single-line-list member marker-free
        // projection"): attempt to ALSO project the list member's own raw
        // line marker-free, gated on the list member's resolved kind
        // being exactly "single-line-list" — never the defensive "list"
        // kind, which permits continuation lines/nested children that
        // edit/listMarkerProjection.ts's pure one-line model cannot
        // safely represent (see that module's own top doc comment).
        // Either gate failing (wrong kind, or buildListMarkerProjection
        // itself refusing an ordered marker/task-list checkbox/
        // unrecognized shape) leaves listMarkerProjection null and
        // compositeListOriginalText holding the list member's RAW line
        // instead — Phase 5D-2B's own original, unmodified behavior for
        // the list row specifically. This is a NARROWER, member-local
        // fallback than splitCompositeBlockMembers/buildQuotePrefixProjection's
        // own failures above (which fall back to the whole-CompositeBlock
        // raw textarea instead) — the trailing member's own structured
        // editor is completely unaffected either way.
        const listBuilt = isListMemberEligibleForMarkerFreeProjection(
          extracted.resolvedSnapshot.members[0].kind
        )
          ? buildListMarkerProjection(memberSplit.split.listLineText)
          : null;
        this.listMarkerProjection = listBuilt?.ok ? listBuilt.projection : null;
        this.compositeListOriginalText = this.listMarkerProjection
          ? this.listMarkerProjection.body
          : memberSplit.split.listLineText;
      }
      // built.reason === "nested" | "no-body": both fall back to the
      // existing raw whole-range textarea, exactly like a standalone
      // callout/blockquote's own "no-body" fallback already does. Unlike
      // loadNodeInternal's standalone gate, a "nested" trailing member
      // here is NOT refused outright: the pre-existing, independently-safe
      // whole-CompositeBlock raw textarea (Phase 5D-2A, untouched) is
      // always available as a safe fallback, so there is no reason to
      // block the pane from opening at all.
    }
    // memberSplit.ok === false (member-count/list-member-kind/
    // list-member-not-single-line/trailing-member-kind): defensive — every
    // shipped rule produces the shape splitCompositeBlockMembers expects,
    // so this currently only matters for a hypothetical future rule
    // shape. Falls back to the same raw whole-range textarea.
    this.label = label;
    this.sourcePath = view.file?.path ?? null;
    // Phase 5A-1: see loadNodeInternal's identical reset — a fresh load is
    // always in sync with what it was just read from.
    this.syncState = "synced";
    // Phase 5D-2A explicit scope: no breadcrumb / sibling nav / Subtree
    // Navigator for a CompositeBlock — mirrors loadParagraphInternal's own
    // identical choice above.
    this.ancestors = [];
    this.directChildren = [];
    this.siblingState = { previous: null, next: null };
    this.renderLoadedState();
  }

  private renderEmptyState(): void {
    // 2026-09-09: now routed through the same resetLoadedState() onClose
    // uses — see that method's own doc comment. This also closes a gap
    // this ticket's own investigation found: the inline resets this
    // method used to do covered ancestors/directChildren/siblingState/
    // sourcePath/syncState/paragraphAnchor/compositeAnchor/quoteProjection
    // but NOT nodeId/nodeKind/originalText/label — harmless here (onOpen
    // only ever calls this once, on a brand-new instance where those four
    // are already at their class-field defaults), but a real gap once
    // onClose needed the exact same "nothing loaded" reset too.
    this.resetLoadedState();
    this.titleEl.setText(this.plugin.t("partialEdit.viewName"));
    this.textareaEl.value = "";
    this.textareaEl.disabled = true;
    this.applyButtonEl.disabled = true;
    this.cancelButtonEl.disabled = true;
    this.textareaEl.setAttribute("placeholder", this.plugin.t("partialEdit.emptyPlaceholder"));
    this.renderBreadcrumb();
    this.renderSiblingNav();
    this.renderSubtreeNavigator();
    this.renderQuoteHeader();
    this.renderCompositeListSlot();
    this.renderTaskCheckboxRow();
    this.renderOrderedNumberRow();
    this.renderParentChildPreview();
    this.renderLeafFirstChildAddRow();
    this.updateDirtyState();
  }

  /**
   * Phase 4C: the title now prefixes the node's kind (Section / List) so
   * the pane stays honest about what range Apply will replace, without
   * otherwise treating the two kinds differently — see class doc comment.
   */
  private renderLoadedState(): void {
    // Phase 5C-2: extended from a binary list/section ternary to cover the
    // two new standalone-complex-block kinds. kind display is otherwise
    // unified with section/list (same title template, same textarea/Apply/
    // Cancel wiring below) — see class doc comment.
    const kindLabel = ((): string => {
      switch (this.nodeKind) {
        case "list":
          return this.plugin.t("partialEdit.kindList");
        case "callout":
          return this.plugin.t("partialEdit.kindCallout");
        case "blockquote":
          return this.plugin.t("partialEdit.kindBlockquote");
        case "paragraph":
          return this.plugin.t("partialEdit.kindParagraph");
        case "composite":
          return this.plugin.t("partialEdit.kindComposite");
        case "section":
        default:
          return this.plugin.t("partialEdit.kindSection");
      }
    })();
    this.titleEl.setText(this.plugin.t("partialEdit.editingTitle", { kind: kindLabel, label: this.label }));
    this.textareaEl.disabled = false;
    this.applyButtonEl.disabled = false;
    this.cancelButtonEl.disabled = false;
    // Phase 5D-0.5: currentDisplayText() returns the prefix-stripped
    // projectedDisplayText for a projecting callout/blockquote, and
    // `this.originalText` verbatim for every other case (including a
    // callout/blockquote that fell back to raw editing) — see that
    // method's own doc comment.
    this.textareaEl.value = this.currentDisplayText();
    this.renderBreadcrumb();
    this.renderSiblingNav();
    this.renderSubtreeNavigator();
    this.renderQuoteHeader();
    this.renderCompositeListSlot();
    this.renderTaskCheckboxRow();
    this.renderOrderedNumberRow();
    this.renderParentChildPreview();
    this.renderLeafFirstChildAddRow();
    this.updateDirtyState();
  }

  /**
   * Phase 5L-6 ("Parent List Item Structured Partial Edit"): draw (or
   * hide) the read-only child-subtree preview below the shared textarea.
   * Shown ONLY when a parent item's own-text is currently projected
   * (`this.standaloneParentListItemProjection !== null`) — every other
   * case (every child-list-free item, every ineligible parent item that
   * fell back to raw editing, every non-list kind) hides this element
   * entirely, mirroring renderSubtreeNavigator's own "hide the whole row
   * when not applicable" policy.
   *
   * Renders `projection.childSubtreeText` verbatim, one raw line per row
   * (styles.css's `white-space: pre` is what keeps each row's own leading
   * indentation visually intact — see parentChildPreviewEl's own field doc
   * comment for why this, rather than a re-derived tree drawing, is this
   * ticket's own chosen "hierarchy stays visible" mechanism). Truncates at
   * PARENT_CHILD_PREVIEW_MAX_LINES with a visible indicator for an
   * unusually large subtree — this pane's own height staying bounded takes
   * priority over showing every single descendant line at once; the
   * pre-existing Subtree Navigator (renderSubtreeNavigator, unmodified)
   * remains available for actually navigating into a specific child
   * regardless of how this preview truncates.
   *
   * Called from renderLoadedState/renderEmptyState (fresh load / clear),
   * and — via the same re-render sequence every sibling render* method
   * already participates in — from applyEdit's own post-Apply rebuild and
   * performAutoReload, both of which rebuild
   * `standaloneParentListItemProjection` fresh before this runs, so this
   * method itself never needs to re-derive anything: it only ever reads
   * whatever is currently in that field.
   */
  /**
   * Phase 5L-9b ("First Direct Child Addition for Leaf List Items — Mode
   * B"): draw (or hide) the "add a first child" row below the shared
   * textarea. Shown ONLY while this pane currently projects the node as
   * ONE of the four standalone-leaf kinds (never while it is already a
   * real parent — standaloneParentListItemProjection non-null — which is
   * exactly what Mode A's own parentChildAddButtonEl inside
   * parentChildPreviewEl already covers instead). Deliberately checks the
   * four PROJECTION fields directly (never a separate structural
   * eligibility recomputation) — a node whose text failed to build ANY of
   * the four standalone projections already fell back to raw editing (see
   * loadNodeInternal's own five-tier priority chain), and Mode B has
   * nothing to promote in that case either.
   *
   * Disabled (never hidden — a hidden control cannot explain itself via
   * tooltip, mirroring parentChildAddButtonEl's own identical policy)
   * while a first-child draft is already pending, per this ticket's own
   * "prevent double-add" requirement.
   */
  private renderLeafFirstChildAddRow(): void {
    const eligible =
      !this.standaloneParentListItemProjection &&
      (!!this.standaloneListMarkerProjection ||
        !!this.standaloneTaskListProjection ||
        !!this.standaloneOrderedListProjection ||
        !!this.standaloneMultiLineListProjection);
    if (!eligible) {
      this.leafFirstChildAddRowEl.toggleVisibility(false);
      return;
    }
    this.leafFirstChildAddRowEl.toggleVisibility(true);
    const alreadyPending = !!this.pendingLeafFirstChild;
    this.leafFirstChildAddButtonEl.disabled = alreadyPending;
    setTooltip(
      this.leafFirstChildAddButtonEl,
      this.plugin.t(
        alreadyPending
          ? "partialEdit.leafFirstChildAddButtonAlreadyPendingLabel"
          : "partialEdit.leafFirstChildAddButtonLabel"
      )
    );
  }

  private renderParentChildPreview(): void {
    const projection = this.standaloneParentListItemProjection;
    this.parentChildPreviewBodyEl.empty();
    if (!projection) {
      this.parentChildPreviewEl.toggleVisibility(false);
      this.parentChildPreviewTruncatedEl.toggleVisibility(false);
      this.renderChildInlineEditor();
      // Phase 5L-9: reset alongside renderChildInlineEditor above —
      // childAddDeleteSession is null whenever projection is (see this
      // field's own doc comment), so renderNewChildEditor's own
      // `this.childAddDeleteSession?.newChildDraft` read below already
      // resolves to "hidden" here; called anyway for the same
      // "every render* method the pane owns always runs together"
      // consistency every sibling call in this method already follows.
      this.renderNewChildEditor();
      return;
    }
    this.parentChildPreviewEl.toggleVisibility(true);
    this.parentChildPreviewLabelTextEl.setText(this.plugin.t("partialEdit.parentChildPreviewLabel"));
    // Phase 5L-9 ("Direct Child Add/Delete in Parent Partial Edit Pane"):
    // the "Add child item" control is disabled (never hidden — see
    // parentChildAddButtonEl's own field doc comment) while a new-child
    // draft is already pending, per this ticket's own "prevent
    // double-add" requirement — the SAME control otherwise stays usable
    // even while every visible row below is empty/pending-deletion.
    const newChildAlreadyPending = !!this.childAddDeleteSession?.newChildDraft;
    // Phase 5L-11 ("Direct Child Leaf Indent/Outdent in Parent Partial
    // Edit Pane"): ALSO disabled while a pending indent/outdent exists —
    // §6's own "at most one pending structural transformation at a time"
    // scope limit extends to Add too, not just Delete/Reorder.
    const indentOutdentAlreadyPending = !!this.childAddDeleteSession?.pendingIndentOutdent;
    const addAlreadyPending = newChildAlreadyPending || indentOutdentAlreadyPending;
    this.parentChildAddButtonEl.disabled = addAlreadyPending;
    setTooltip(
      this.parentChildAddButtonEl,
      this.plugin.t(
        newChildAlreadyPending
          ? "partialEdit.parentChildAddButtonAlreadyPendingLabel"
          : indentOutdentAlreadyPending
            ? "partialEdit.parentChildIndentOutdentPendingOtherDisabledLabel"
            : "partialEdit.parentChildAddButtonLabel"
      )
    );

    const addDeleteSession = this.childAddDeleteSession;

    // Phase 5L-8: which direct child is currently ELIGIBLE — a fresh
    // check (never trusted from a stale prior render), via
    // evaluateChildInlineEditEligibility, the exact SAME eligibility gate
    // buildParentChildInlineEditSession itself re-runs when the
    // edit-pencil affordance is activated. Phase 5L-10 reuses this exact
    // same set for the up/down reorder affordance too (see
    // evaluateChildReorderEligibility's own doc comment for why the two
    // eligibility lists are identical, one-for-one). Also captures, as a
    // FALLBACK, each eligible child's own FIRST relative row against the
    // document's ORIGINAL (never-reordered) layout — used only when a
    // reordered preview cannot safely be reconstructed, see
    // `reorderAvailable` below.
    const eligibleIds = new Set<string>();
    const fallbackFirstRowById = new Map<number, string>();
    const previewView = this.activeMarkdownView.get();
    // Phase 5L-11 ("Direct Child Leaf Indent/Outdent in Parent Partial
    // Edit Pane"): `previewDoc`/`previewParentNode` are hoisted out of
    // the block below (previously locals of that `if` alone) so this
    // render's own indent/outdent eligibility computation and
    // buildIndentOutdentPreviewText call further down can reuse the SAME
    // fresh parse, rather than re-parsing the active note a second/third
    // time in the same render pass.
    let previewDoc: ParsedDocument | null = null;
    let previewParentNode: ListBlockNode | null = null;
    if (previewView && this.nodeId) {
      previewDoc = parseDocument(previewView.editor.getValue());
      const resolvedPreviewParentNode = previewDoc.nodes.get(this.nodeId);
      previewParentNode = resolvedPreviewParentNode && isListNode(resolvedPreviewParentNode) ? resolvedPreviewParentNode : null;
      if (previewParentNode) {
        for (const childId of previewParentNode.childIds) {
          const evaluated = evaluateChildInlineEditEligibility(previewDoc, previewParentNode, childId);
          if (!evaluated.ok) continue;
          eligibleIds.add(childId);
          const relativeRow = evaluated.childNode.range.startLine - projection.childSubtreeRange.startLine;
          fallbackFirstRowById.set(relativeRow, childId);
        }
      }
    }

    // Phase 5L-10 ("Direct Child Leaf Reorder in Parent Partial Edit
    // Pane"): whenever this parent's child subtree is reorder-eligible
    // at all (`reorderAvailable` — see ParentChildAddDeleteSession's own
    // doc comment for the "no gap between siblings" scope gate this
    // reflects), the preview is rendered by walking
    // `pendingReorderOrder` directly and joining each child's own
    // captured `childSlots` rawText — this is what makes an ACTUAL
    // pending reorder visible in the preview (this ticket's own explicit
    // §7 "Apply 前でも、ユーザーは並び替え結果を preview で確認できる
    // こと" requirement), and is a byte-for-byte no-op reproduction of
    // the ORIGINAL rendering whenever pendingReorderOrder still equals
    // its own identity order (the overwhelming common case — every
    // pre-existing 5L-1〜5L-9 scenario never touches pendingReorderOrder
    // at all). `childPreviewRowTargets` (Phase 5L-7's own row-click
    // navigation) is keyed to the ORIGINAL document's own line positions,
    // so it is only trustworthy for the ORIGINAL (non-reordered) layout —
    // navigation is deliberately suppressed below for a row rendered from
    // a REORDERED position (see the per-row loop's own `navigationSafe`
    // guard) rather than guessing at a remapped target; it becomes
    // available again the moment the reorder is Applied or Cancelled
    // (both rebuild this preview from a fresh, natural-order state).
    const reorderAvailable = !!addDeleteSession?.reorderAvailable;
    // Phase 5L-11 ("Direct Child Leaf Indent/Outdent in Parent Partial
    // Edit Pane"): whenever a pending indent/outdent exists, it takes
    // priority over the reorder-preview branch below — the two are
    // mutually exclusive by construction (handleRequestIndentChild/
    // handleRequestOutdentChild only ever start one while
    // isPendingReorderDirty is false — see that module's own Phase 5L-11
    // section top doc comment in edit/parentChildInlineEditSession.ts),
    // but checking this FIRST rather than relying on that invariant
    // alone follows this codebase's own "never guess, always verify"
    // convention.
    const indentOutdentPending = addDeleteSession?.pendingIndentOutdent ?? null;
    let allLines: string[];
    let eligibleFirstRowById: Map<number, string>;
    let navigationSafe: boolean;
    if (addDeleteSession && indentOutdentPending && previewDoc && previewParentNode) {
      allLines = buildIndentOutdentPreviewText(previewDoc, previewParentNode, projection, indentOutdentPending).split(
        "\n"
      );
      // Phase 5L-11 §8: "the UI must never suggest free movement" — every
      // OTHER row affordance (navigation, edit-start, delete, reorder,
      // and a SECOND indent/outdent) is suppressed entirely while one
      // transformation is already pending, simply by giving this render
      // pass no eligible ids to attach any of them to (every affordance
      // below is gated on `eligibleFirstRowById.get(i)` resolving to
      // something).
      eligibleFirstRowById = new Map();
      navigationSafe = false;
    } else if (addDeleteSession && reorderAvailable) {
      const slotByNodeId = new Map(addDeleteSession.childSlots.map((slot) => [slot.nodeId, slot] as const));
      const lines: string[] = [];
      const positionByRow = new Map<number, string>();
      for (const nodeId of addDeleteSession.pendingReorderOrder) {
        const slot = slotByNodeId.get(nodeId);
        if (!slot) continue; // defensive — pendingReorderOrder is always a permutation of childSlots' own ids.
        positionByRow.set(lines.length, nodeId);
        lines.push(...slot.rawText.split("\n"));
      }
      allLines = lines;
      eligibleFirstRowById = new Map();
      for (const [row, nodeId] of positionByRow) {
        if (eligibleIds.has(nodeId)) eligibleFirstRowById.set(row, nodeId);
      }
      navigationSafe = !isPendingReorderDirty(addDeleteSession);
    } else {
      allLines = projection.childSubtreeText.split("\n");
      eligibleFirstRowById = fallbackFirstRowById;
      navigationSafe = true;
    }

    // Phase 5L-11 ("Direct Child Leaf Indent/Outdent in Parent Partial
    // Edit Pane"): a NEW indent/outdent may only ever START while
    // nothing else is already mid-flight for this parent (§6's own "at
    // most one pending structural transformation, never freely composed
    // with add/delete/reorder/an open existing-child editor" scope
    // limit) — computed once here and reused by both the indent- and
    // outdent-eligible-id sets immediately below, so the two can never
    // drift apart from whatever handleRequestIndentChild/
    // handleRequestOutdentChild themselves re-check before actually
    // starting one.
    const canStartIndentOutdent =
      !indentOutdentPending &&
      !this.childInlineSession &&
      !addDeleteSession?.newChildDraft &&
      !addDeleteSession?.pendingDeletion &&
      !(addDeleteSession && isPendingReorderDirty(addDeleteSession));
    // Phase 5L-11: which DIRECT child rows offer an indent button (a
    // strict SUBSET of `eligibleIds` above — also needs a preceding
    // sibling, see evaluateChildIndentEligibility's own doc comment) and
    // which NESTED (exactly-one-level-deep) rows offer an outdent button
    // — the latter a population `eligibleIds`/`fallbackFirstRowById`
    // never cover at all (those two are direct-children-only). Both
    // computed only while `canStartIndentOutdent`, and only against the
    // natural (non-reordered, non-already-pending) layout — the SAME
    // `previewDoc`/`previewParentNode` fresh parse `eligibleIds` itself
    // used above, and the same relative-row convention
    // (`fallbackFirstRowById` uses) since indent/outdent buttons are
    // never shown while a reorder is pending either (canStartIndentOutdent
    // already excludes that case).
    const indentEligibleIds = new Set<string>();
    const outdentEligibleFirstRowById = new Map<number, string>();
    if (canStartIndentOutdent && previewDoc && previewParentNode) {
      for (const directChildId of previewParentNode.childIds) {
        if (evaluateChildIndentEligibility(previewDoc, previewParentNode, directChildId).ok) {
          indentEligibleIds.add(directChildId);
        }
        const directChildNode = previewDoc.nodes.get(directChildId);
        if (!directChildNode || !isListNode(directChildNode)) continue;
        for (const nestedChildId of directChildNode.childIds) {
          const evaluatedOutdent = evaluateChildOutdentEligibility(previewDoc, previewParentNode, nestedChildId);
          if (!evaluatedOutdent.ok) continue;
          const relativeRow = evaluatedOutdent.childNode.range.startLine - projection.childSubtreeRange.startLine;
          outdentEligibleFirstRowById.set(relativeRow, nestedChildId);
        }
      }
    }

    const maxLines = PartialEditView.PARENT_CHILD_PREVIEW_MAX_LINES;
    const visibleLines = allLines.slice(0, maxLines);
    for (let i = 0; i < visibleLines.length; i++) {
      const line = visibleLines[i];
      const rowEl = this.parentChildPreviewBodyEl.createDiv({
        cls: "unified-outliner-partial-edit-parent-child-preview-row",
      });
      rowEl.setAttribute("aria-readonly", "true");
      rowEl.setAttribute("data-readonly", "true");
      // Phase 5L-6: a blank raw line would otherwise render as a
      // zero-height row with nothing to anchor its own line-box to —
      // a literal non-breaking space keeps every row's own height
      // uniform, purely cosmetic, never part of the underlying data
      // (childSubtreeText itself is never touched by this).
      //
      // Phase 5L-10 fix (実機発見バグその3, found via real-device
      // verification): the row's own text now lives in its OWN span
      // (never bare text directly on rowEl) so this row can be laid out
      // as a flex row — the text on one side, a single grouped
      // "actions" span (rowActionsEl below) pinned to the other —
      // instead of the edit/delete/reorder controls each floating
      // independently. Independent floats could each wrap onto their
      // own line once the text and all three no longer fit side-by-
      // side (confirmed on-device: with a long enough child line, the
      // reorder buttons alone dropped to a visually separate line below
      // the pencil/trash pair, even though the earlier overflow: hidden
      // fix already stopped a row's floats from bleeding into the NEXT
      // row's own box). Grouping every control into one flex item that
      // can never split across lines fixes this whole class of "which
      // controls end up on which visual line" bugs at once, rather than
      // special-casing this one report — see this row's own CSS
      // doc comment in styles.css for the full rationale.
      rowEl.createSpan({
        cls: "unified-outliner-partial-edit-parent-child-preview-row-text",
        text: line.length > 0 ? line : " ",
      });
      // The ONE shared actions group every eligible row's edit/delete/
      // reorder controls below are appended into (never appended
      // directly onto rowEl any more) — always created, even for a row
      // with none of the three, so every row shares the exact same DOM
      // shape; an empty actions span has zero visual footprint.
      const rowActionsEl = rowEl.createSpan({
        cls: "unified-outliner-partial-edit-parent-child-preview-row-actions",
      });
      // Phase 5L-7 ("Read-Only Child Subtree Preview Navigation"): a row
      // stays exactly as read-only/static as it already was in Phase 5L-6
      // (no textarea/input/checkbox/contenteditable added here — see this
      // pane's own parentChildPreviewEl field doc comment) unless
      // childPreviewRowTargets identifies a safe navigation target for it,
      // in which case it ALSO becomes a focusable "open this child" control
      // — mirroring appendSubtreeChip's own tabIndex/role="button"/
      // setTooltip/click+Enter+Space pattern exactly, so this preview's own
      // navigation affordance never invents a second, inconsistent
      // interaction convention alongside the pane's pre-existing Subtree
      // Navigator chips.
      const eligibleChildId = eligibleFirstRowById.get(i);
      // Phase 5L-9 ("Direct Child Add/Delete in Parent Partial Edit
      // Pane"): a row whose own eligible child is the CURRENT pending-
      // deletion target becomes fully non-interactive — no nav, no edit
      // start, no re-triggerable delete — per this ticket's own §5/§10
      // "pending-deletion rows become read-only/non-navigable/non-
      // editable" requirement. Checked BEFORE the navigation/edit-start
      // wiring below so neither one is ever attached to this row at all.
      const isPendingDeletionRow =
        !!eligibleChildId && eligibleChildId === this.childAddDeleteSession?.pendingDeletion?.childNodeId;
      if (isPendingDeletionRow) {
        rowEl.addClass("unified-outliner-partial-edit-parent-child-preview-row-pending-deletion");
        setTooltip(rowEl, this.plugin.t("partialEdit.parentChildPendingDeletionLabel"));
      }

      // Phase 5L-10: childPreviewRowTargets is keyed to the ORIGINAL
      // document's own line positions — only trustworthy while this
      // render is showing the natural (non-reordered) layout, see
      // `navigationSafe`'s own doc comment above.
      const target = navigationSafe ? projection.childPreviewRowTargets[i] : undefined;
      if (target && !isPendingDeletionRow) {
        rowEl.addClass("unified-outliner-partial-edit-parent-child-preview-row-navigable");
        rowEl.tabIndex = 0;
        rowEl.setAttribute("role", "button");
        setTooltip(rowEl, this.plugin.t("partialEdit.parentChildPreviewRowOpenLabel"));
        const activate = (evt: Event) => {
          // Never let this bubble into any unrelated ancestor click
          // handler this pane's own contentEl might have — a preview row
          // activation is ALWAYS exactly this navigation request, never
          // anything else (this ticket's own explicit requirement).
          evt.stopPropagation();
          this.handleChildPreviewRowActivate(target);
        };
        rowEl.addEventListener("click", activate);
        rowEl.addEventListener("keydown", (evt) => {
          if (evt.key === "Enter" || evt.key === " ") {
            evt.preventDefault();
            activate(evt);
          }
        });
      }

      // Phase 5L-8 ("Child Item Inline Structured Editing in Parent
      // Partial Edit Pane"): the inline-edit-start affordance — a
      // GENUINELY SEPARATE control/code path from the navigation
      // click/Enter/Space handling immediately above (this ticket's own
      // explicit §5 requirement: edit-start and preview-navigation are
      // never the same interaction). Only rendered on an ELIGIBLE direct
      // child's own FIRST row, and never on the row currently being
      // inline-edited (that row is highlighted instead) or pending
      // deletion (Phase 5L-9).
      if (eligibleChildId && eligibleChildId === this.childInlineSession?.childNodeId) {
        rowEl.addClass("unified-outliner-partial-edit-parent-child-preview-row-editing");
      } else if (eligibleChildId && !isPendingDeletionRow) {
        const editButtonEl = rowActionsEl.createSpan({
          cls: "unified-outliner-partial-edit-parent-child-inline-edit-button",
          attr: { role: "button", tabindex: "0" },
        });
        setIcon(editButtonEl, "pencil");
        setTooltip(editButtonEl, this.plugin.t("partialEdit.parentChildInlineEditStartLabel"));
        const activateEdit = (evt: Event) => {
          // Never a navigation — see the comment immediately above.
          evt.stopPropagation();
          evt.preventDefault();
          this.handleStartChildInlineEdit(eligibleChildId);
        };
        editButtonEl.addEventListener("click", activateEdit);
        editButtonEl.addEventListener("keydown", (evt) => {
          if (evt.key === "Enter" || evt.key === " ") {
            activateEdit(evt);
          }
        });
      }

      // Phase 5L-9: the delete affordance — a THIRD genuinely separate
      // control/code path (never the navigation click, never the pencil
      // edit-start affordance — this ticket's own §5 explicit
      // requirement). Rendered on every ELIGIBLE direct child's own first
      // row, INCLUDING the row currently open for inline editing (§5:
      // confirming deletion there closes that inline editor first — see
      // handleRequestDeleteChild) — but never on an already-pending-
      // deletion row (no re-trigger).
      if (eligibleChildId && !isPendingDeletionRow) {
        const deleteButtonEl = rowActionsEl.createSpan({
          cls: "unified-outliner-partial-edit-parent-child-delete-button",
          attr: { role: "button", tabindex: "0" },
        });
        setIcon(deleteButtonEl, "trash-2");
        setTooltip(deleteButtonEl, this.plugin.t("partialEdit.parentChildDeleteButtonLabel"));
        const activateDelete = (evt: Event) => {
          // Never a navigation or an edit-start — see the comment
          // immediately above.
          evt.stopPropagation();
          evt.preventDefault();
          this.handleRequestDeleteChild(eligibleChildId);
        };
        deleteButtonEl.addEventListener("click", activateDelete);
        deleteButtonEl.addEventListener("keydown", (evt) => {
          if (evt.key === "Enter" || evt.key === " ") {
            activateDelete(evt);
          }
        });
      }

      // Phase 5L-10 ("Direct Child Leaf Reorder in Parent Partial Edit
      // Pane"): the up/down reorder affordance — a FOURTH genuinely
      // separate control/code path from navigation, edit-start, and
      // delete (this ticket's own explicit §7 "edit / delete /
      // navigation / reorder の4操作をイベント上で明確に分ける"
      // requirement). Rendered on every ELIGIBLE direct child's own first
      // row (same population as the edit/delete affordances — never on a
      // pending-deletion row), but ONLY while this parent's child subtree
      // is reorder-eligible at all (`reorderAvailable`). Each button's
      // own disabled state is computed via moveChildInPendingReorder's
      // OWN predicate (never a second, independently-drifting "can this
      // move" check) — see this ticket's own §2/§3 "先頭/末尾 disabled"
      // and "non-eligible neighbor never crossed" requirements.
      if (eligibleChildId && !isPendingDeletionRow && reorderAvailable && addDeleteSession) {
        const excludedId = addDeleteSession.pendingDeletion?.childNodeId ?? null;
        const currentOrder = addDeleteSession.pendingReorderOrder;
        const reorderButtonsEl = rowActionsEl.createSpan({
          cls: "unified-outliner-partial-edit-parent-child-reorder-buttons",
        });
        const makeReorderButton = (direction: ChildReorderDirection, icon: string, labelKey: TranslationKey) => {
          const canMove = moveChildInPendingReorder(currentOrder, eligibleIds, excludedId, eligibleChildId, direction).ok;
          const buttonEl = reorderButtonsEl.createSpan({
            cls: "unified-outliner-partial-edit-parent-child-reorder-button",
            attr: { role: "button", tabindex: canMove ? "0" : "-1", "aria-disabled": canMove ? "false" : "true" },
          });
          setIcon(buttonEl, icon);
          setTooltip(buttonEl, this.plugin.t(labelKey));
          buttonEl.toggleClass("unified-outliner-partial-edit-parent-child-reorder-button-disabled", !canMove);
          if (canMove) {
            const activateReorder = (evt: Event) => {
              // Never a navigation, edit-start, or delete — see the
              // comment immediately above.
              evt.stopPropagation();
              evt.preventDefault();
              this.handleReorderChild(eligibleChildId, direction);
            };
            buttonEl.addEventListener("click", activateReorder);
            buttonEl.addEventListener("keydown", (evt) => {
              if (evt.key === "Enter" || evt.key === " ") {
                activateReorder(evt);
              }
            });
          }
        };
        // Down first, then up — both float right (see styles.css), so
        // DOM-appending down first makes up render as the RIGHTMOST
        // (topmost-reading) control, mirroring the edit-pencil/delete-
        // trash pair's own right-to-left append order above.
        makeReorderButton("down", "arrow-down", "partialEdit.parentChildReorderDownLabel");
        makeReorderButton("up", "arrow-up", "partialEdit.parentChildReorderUpLabel");
      }

      // Phase 5L-11 ("Direct Child Leaf Indent/Outdent in Parent Partial
      // Edit Pane"): the indent affordance — appended into the SAME
      // shared rowActionsEl group as edit/delete/reorder above (this
      // ticket's own explicit "整合性を持たせて" precedent from Phase
      // 5L-10's own real-device follow-up), rendered ONLY on an eligible
      // DIRECT child's own first row, and only while canStartIndentOutdent
      // (no other pending structural transformation for this parent
      // right now — see that const's own doc comment above).
      if (eligibleChildId && !isPendingDeletionRow && canStartIndentOutdent && indentEligibleIds.has(eligibleChildId)) {
        const indentButtonEl = rowActionsEl.createSpan({
          cls: "unified-outliner-partial-edit-parent-child-indent-button",
          attr: { role: "button", tabindex: "0" },
        });
        setIcon(indentButtonEl, "indent");
        setTooltip(indentButtonEl, this.plugin.t("partialEdit.parentChildIndentButtonLabel"));
        const activateIndent = (evt: Event) => {
          // Never a navigation, edit-start, delete, or reorder — see the
          // comments above this row's own other affordances.
          evt.stopPropagation();
          evt.preventDefault();
          this.handleRequestIndentChild(eligibleChildId);
        };
        indentButtonEl.addEventListener("click", activateIndent);
        indentButtonEl.addEventListener("keydown", (evt) => {
          if (evt.key === "Enter" || evt.key === " ") {
            activateIndent(evt);
          }
        });
      }

      // Phase 5L-11: the outdent affordance — rendered on a NESTED
      // (exactly-one-level-deep) child's own first row instead, a
      // DIFFERENT population from every other affordance above (all of
      // which are direct-children-only) — see
      // outdentEligibleFirstRowById's own doc comment above for why this
      // needs its own lookup rather than reusing `eligibleChildId`. Every
      // row already owns its own (possibly empty) `rowActionsEl` from
      // this row's own setup above, so a nested row that has neither an
      // edit/delete/reorder affordance nor an indent one can still
      // receive this one.
      const outdentChildId = canStartIndentOutdent ? outdentEligibleFirstRowById.get(i) : undefined;
      if (outdentChildId) {
        const outdentButtonEl = rowActionsEl.createSpan({
          cls: "unified-outliner-partial-edit-parent-child-outdent-button",
          attr: { role: "button", tabindex: "0" },
        });
        setIcon(outdentButtonEl, "outdent");
        setTooltip(outdentButtonEl, this.plugin.t("partialEdit.parentChildOutdentButtonLabel"));
        const activateOutdent = (evt: Event) => {
          evt.stopPropagation();
          evt.preventDefault();
          this.handleRequestOutdentChild(outdentChildId);
        };
        outdentButtonEl.addEventListener("click", activateOutdent);
        outdentButtonEl.addEventListener("keydown", (evt) => {
          if (evt.key === "Enter" || evt.key === " ") {
            activateOutdent(evt);
          }
        });
      }
    }

    const truncatedCount = allLines.length - visibleLines.length;
    if (truncatedCount > 0) {
      this.parentChildPreviewTruncatedEl.toggleVisibility(true);
      this.parentChildPreviewTruncatedEl.setText(
        this.plugin.t("partialEdit.parentChildPreviewTruncated", { count: truncatedCount })
      );
    } else {
      this.parentChildPreviewTruncatedEl.toggleVisibility(false);
    }

    this.renderChildInlineEditor();
    // Phase 5L-9: see renderNewChildEditor's own doc comment.
    this.renderNewChildEditor();
  }

  /**
   * Phase 5L-8: populate/toggle the child inline editor panel
   * (childInlineEditorEl) from `this.childInlineSession` — the ONE place
   * that ever resets childInlineTextareaEl/childInlineTaskCheckboxInputEl/
   * childInlineOrderedNumberInputEl to the session's own loaded snapshot.
   * Called only from renderParentChildPreview (a fresh load, an Apply's
   * own post-Apply rebuild, and every other re-render that already
   * rebuilds standaloneParentListItemProjection/childInlineSession fresh
   * — never standalone from anywhere else), so this never clobbers an
   * in-progress, still-uncommitted child draft outside of those
   * already-safe moments.
   */
  private renderChildInlineEditor(): void {
    const session = this.childInlineSession;
    if (!session) {
      this.childInlineEditorEl.toggleVisibility(false);
      return;
    }
    this.childInlineEditorEl.toggleVisibility(true);
    const firstLine = childProjectionRawText(session.childProjection).split("\n")[0].trim();
    this.childInlineEditorLabelEl.setText(
      this.plugin.t("partialEdit.parentChildInlineEditPanelLabel", { text: firstLine })
    );
    const kind = childEffectiveControlKind(session.childProjection);
    this.childInlineTaskCheckboxRowEl.toggleVisibility(kind === "task");
    this.childInlineTaskCheckboxInputEl.disabled = kind !== "task";
    this.childInlineTaskCheckboxInputEl.checked = projectedChildChecked(session.childProjection);
    this.childInlineOrderedNumberRowEl.toggleVisibility(kind === "ordered");
    this.childInlineOrderedNumberInputEl.disabled = kind !== "ordered";
    this.childInlineOrderedNumberInputEl.value = projectedChildNumberText(session.childProjection);
    this.childInlineTextareaEl.value = projectedChildBodyText(session.childProjection);
  }

  /**
   * Phase 5L-9 ("Direct Child Add/Delete in Parent Partial Edit Pane"):
   * populate/toggle the pending new-child's own inline editor
   * (newChildEditorEl) from `this.childAddDeleteSession?.newChildDraft` —
   * the counterpart of renderChildInlineEditor immediately above, for the
   * NEW-child slot instead of the existing-child slot. Called from every
   * place renderChildInlineEditor itself is called (renderParentChildPreview's
   * own two call sites), so the two panels always stay in sync with each
   * other's own render cycle.
   */
  private renderNewChildEditor(): void {
    // Phase 5L-9b: Mode B's own pendingLeafFirstChild is checked as a
    // FALLBACK, never instead of — the two are mutually exclusive by
    // construction (see pendingLeafFirstChild's own doc comment), so
    // this reuses the exact same inline editor UI for either draft's
    // own NewChildDraft.
    const draft = this.childAddDeleteSession?.newChildDraft ?? this.pendingLeafFirstChild?.draft ?? null;
    if (!draft) {
      this.newChildEditorEl.toggleVisibility(false);
      return;
    }
    this.newChildEditorEl.toggleVisibility(true);
    this.newChildTextareaEl.value = projectedChildBodyText(draft.projection);
  }

  /**
   * Phase 5L-9: whether the pending new-child's own textarea currently
   * differs from its canonical loaded (always-empty) body — `false`
   * whenever no new-child draft is pending. Shared by isDirty() and
   * this pane's own combined-Apply dirty gating, mirroring
   * isChildInlineDraftDirty's own identical role for the EXISTING-child
   * slot.
   */
  private isNewChildDraftDirty(): boolean {
    // Phase 5L-9b: see renderNewChildEditor's own identical fallback —
    // childAddDeleteSession?.newChildDraft and pendingLeafFirstChild are
    // mutually exclusive, never both non-null at once.
    const draft = this.childAddDeleteSession?.newChildDraft ?? this.pendingLeafFirstChild?.draft;
    if (!draft) return false;
    return this.newChildTextareaEl.value !== projectedChildBodyText(draft.projection);
  }

  /**
   * Phase 5L-9: whether a new-child draft and/or a pending-deletion mark
   * is currently present — the condition applyEdit's own dispatch uses to
   * route Apply through this ticket's own generalized combined-apply
   * method (applyParentChildAddDeleteCombinedEdit) instead of either the
   * single-range parent-only path or Phase 5L-8's own fixed-two-range
   * path. Deliberately checks PRESENCE, not dirtiness — an untouched
   * (still-canonical-empty) new-child draft still needs to be INSERTED on
   * Apply (§4's own "untouched body Apply is allowed" contract), so it
   * must route through the combined path even when isNewChildDraftDirty()
   * itself is false.
   */
  private hasAddDeleteActivity(): boolean {
    const session = this.childAddDeleteSession;
    return (
      !!session?.newChildDraft ||
      !!session?.pendingDeletion ||
      // Phase 5L-10 ("Direct Child Leaf Reorder in Parent Partial Edit
      // Pane"): ALSO routes through the combined-apply path whenever a
      // reorder is genuinely dirty — see isPendingReorderDirty's own doc
      // comment for the "net-no-op is not dirty" contract this shares
      // with isDirty()/updateDirtyState (both of which call THIS method,
      // never isPendingReorderDirty directly, so the two can never drift
      // apart).
      (!!session && isPendingReorderDirty(session)) ||
      // Phase 5L-11 ("Direct Child Leaf Indent/Outdent in Parent Partial
      // Edit Pane"): a pending indent/outdent is ALWAYS activity (unlike
      // reorder, there is no "net-no-op" shape for it — it either exists
      // or it doesn't). applyEdit()'s own dispatch checks
      // `childAddDeleteSession?.pendingIndentOutdent` BEFORE this
      // method's own branch and routes to the dedicated
      // applyParentChildIndentOutdentEdit instead whenever it is set —
      // this addition here only keeps isDirty()/updateDirtyState (both
      // of which call ONLY this method, never the raw field) showing
      // Apply/Cancel while a pending indent/outdent is the ONLY activity
      // present.
      !!session?.pendingIndentOutdent
    );
  }

  /**
   * Phase 5L-9: the ONE entry point for starting a new-child draft — the
   * "Add child item" button's click handler (onOpen) is the only caller.
   * Re-resolves the parent fresh (never trusts a stale row/session) and
   * builds the new child's own canonical draft via
   * edit/parentChildInlineEditSession.ts#buildNewChildDraft. Deliberately
   * does NOT route through DiscardChangesModal — starting a new-child
   * draft never discards anything (it is purely additive, and can freely
   * coexist with an open existing-child editor and/or a pending deletion —
   * see ParentChildAddDeleteSession's own "three independent slots" doc
   * comment), so there is nothing here that dirty state could ever put at
   * risk of being silently lost.
   */
  private handleRequestAddChild(): void {
    if (this.childAddDeleteSession?.newChildDraft) return; // the button is disabled in this state — defensive no-op only.
    const view = this.activeMarkdownView.get();
    if (!view || !this.nodeId || !this.standaloneParentListItemProjection || !this.childAddDeleteSession) {
      new Notice(this.plugin.t("partialEdit.parentChildAddChildFailed"));
      return;
    }
    const doc = parseDocument(view.editor.getValue());
    const parentNode = doc.nodes.get(this.nodeId);
    if (!parentNode || !isListNode(parentNode)) {
      new Notice(this.plugin.t("partialEdit.parentChildAddChildFailed"));
      return;
    }
    const built = buildNewChildDraft(doc, parentNode);
    if (!built.ok) {
      new Notice(this.plugin.t("partialEdit.parentChildAddChildFailed"));
      return;
    }
    this.childAddDeleteSession.newChildDraft = built.draft;
    this.renderParentChildPreview();
    this.updateDirtyState();
  }

  /**
   * Phase 5L-9b ("First Direct Child Addition for Leaf List Items — Mode
   * B"): the ONE entry point for starting a Mode B "promote this leaf to
   * a parent" draft — the leafFirstChildAddButtonEl click handler. Mirrors
   * handleRequestAddChild immediately above (and buildPendingIndent/
   * buildPendingOutdent's own identical discipline): re-resolves the leaf
   * fresh from the CURRENT document via buildPendingLeafFirstChild, never
   * trusting the button's own row-level eligibility snapshot. Deliberately
   * does NOT route through DiscardChangesModal — starting this draft never
   * discards anything (purely additive, exactly like handleRequestAddChild
   * itself), it only ADDS a pending first-child slot alongside whatever
   * own-text edits are already in the shared textarea.
   */
  private handleRequestAddLeafFirstChild(): void {
    if (this.pendingLeafFirstChild) return; // the button is disabled in this state — defensive no-op only.
    const view = this.activeMarkdownView.get();
    if (
      !view ||
      !this.nodeId ||
      this.standaloneParentListItemProjection ||
      !(
        this.standaloneListMarkerProjection ||
        this.standaloneTaskListProjection ||
        this.standaloneOrderedListProjection ||
        this.standaloneMultiLineListProjection
      )
    ) {
      new Notice(this.plugin.t("partialEdit.leafFirstChildAddFailed"));
      return;
    }
    const doc = parseDocument(view.editor.getValue());
    const built = buildPendingLeafFirstChild(doc, this.nodeId);
    if (!built.ok) {
      new Notice(this.plugin.t("partialEdit.leafFirstChildAddFailed"));
      return;
    }
    this.pendingLeafFirstChild = built.pending;
    this.renderLeafFirstChildAddRow();
    this.renderNewChildEditor();
    this.updateDirtyState();
  }

  /**
   * Phase 5L-9: "cancel this new item" — the ONLY way to remove a pending
   * new-child draft other than a full pane-level Cancel (which also
   * reverts every other draft — see cancelEdit's own doc comment) or a
   * successful Apply. A CLEAN (untouched-body) draft is discarded
   * immediately, no prompt — mirrors handleStopChildInlineEdit's own
   * identical "clean closes immediately" contract for the EXISTING-child
   * slot.
   */
  private handleStopNewChildDraft(): void {
    if (!this.childAddDeleteSession?.newChildDraft) return;
    if (!this.isNewChildDraftDirty()) {
      this.childAddDeleteSession.newChildDraft = null;
      this.renderParentChildPreview();
      this.updateDirtyState();
      return;
    }
    new DiscardChangesModal(this.app, this.plugin, (choice) => {
      if (choice === "cancel") return;
      if (choice === "discard") {
        if (this.childAddDeleteSession) this.childAddDeleteSession.newChildDraft = null;
        this.renderParentChildPreview();
        this.updateDirtyState();
        return;
      }
      // choice === "apply": the same combined Apply this pane's own Apply
      // button already runs — closes the draft only once it actually
      // succeeded (a successful Apply already clears/rebuilds
      // childAddDeleteSession from scratch, see
      // applyParentChildAddDeleteCombinedEdit's own doc comment).
      this.applyEdit();
    }).open();
  }

  /**
   * Phase 5L-9b ("First Direct Child Addition for Leaf List Items — Mode
   * B"): "cancel this pending first child" — the Mode B counterpart of
   * handleStopNewChildDraft immediately above, sharing the SAME "cancel
   * this new item" control (newChildStopButtonEl.click already calls
   * handleStopNewChildDraft, which delegates to this method whenever
   * pendingLeafFirstChild — never childAddDeleteSession?.newChildDraft —
   * is the one actually set; the two are mutually exclusive by
   * construction, see pendingLeafFirstChild's own doc comment). A CLEAN
   * (untouched-body) draft is discarded immediately, no prompt — same
   * "clean closes immediately" contract as every sibling "stop this
   * draft" handler in this class. Discarding a DIRTY one reverts the
   * pane to plain standalone-leaf editing (re-shows
   * leafFirstChildAddButtonEl, re-enabled) — see this ticket's own §4
   * "Cancelで昇格を解消し、元の standalone leaf pane状態へ戻せること"
   * requirement.
   */
  private handleStopLeafFirstChildDraft(): void {
    if (!this.pendingLeafFirstChild) return;
    if (!this.isNewChildDraftDirty()) {
      this.pendingLeafFirstChild = null;
      this.renderLeafFirstChildAddRow();
      this.renderNewChildEditor();
      this.updateDirtyState();
      return;
    }
    new DiscardChangesModal(this.app, this.plugin, (choice) => {
      if (choice === "cancel") return;
      if (choice === "discard") {
        this.pendingLeafFirstChild = null;
        this.renderLeafFirstChildAddRow();
        this.renderNewChildEditor();
        this.updateDirtyState();
        return;
      }
      // choice === "apply": the same Mode B Apply this pane's own Apply
      // button already runs — closes the draft only once it actually
      // succeeded (a successful Apply reloads the node as a real parent
      // from scratch, see applyLeafFirstChildEdit's own doc comment).
      this.applyEdit();
    }).open();
  }

  /**
   * Phase 5L-9 (§5 "Delete: operation, confirmation, and structural
   * scope"): the ONE entry point for the delete affordance's click — a
   * GENUINELY SEPARATE control/code path from both row navigation and the
   * edit-start affordance (renderParentChildPreview's own three-way
   * `evt.stopPropagation()` guards). Re-verifies delete eligibility fresh
   * against the CURRENT document (never trusts the row's own build-time
   * eligibility snapshot — mirrors handleStartChildInlineEdit's own
   * identical re-verification discipline) BEFORE ever opening the
   * confirmation modal, so a row whose eligibility changed since the last
   * render never even offers a confirm dialog for something that could no
   * longer safely be deleted.
   */
  private handleRequestDeleteChild(childNodeId: string): void {
    const view = this.activeMarkdownView.get();
    if (!view || !this.nodeId || !this.childAddDeleteSession) {
      new Notice(this.plugin.t("partialEdit.parentChildDeleteFailed"));
      return;
    }
    const doc = parseDocument(view.editor.getValue());
    const parentNode = doc.nodes.get(this.nodeId);
    if (!parentNode || !isListNode(parentNode)) {
      new Notice(this.plugin.t("partialEdit.parentChildDeleteFailed"));
      return;
    }
    const evaluated = evaluateChildDeleteEligibility(doc, parentNode, childNodeId);
    if (!evaluated.ok) {
      new Notice(this.plugin.t("partialEdit.parentChildDeleteFailed"));
      return;
    }
    new ChildDeleteConfirmModal(this.app, this.plugin, (confirmed) => {
      if (confirmed) this.commitPendingDeletion(childNodeId);
    }).open();
  }

  /**
   * Phase 5L-9: marks `childNodeId` pending-deletion — called ONLY from
   * handleRequestDeleteChild's own confirm callback, itself only invoked
   * once the user chose "削除する" in ChildDeleteConfirmModal. Re-verifies
   * eligibility fresh ONE MORE TIME (belt-and-suspenders — the modal may
   * have sat open for a while) before actually marking anything, mirroring
   * every other "re-verify immediately before mutating state" call site in
   * this class. Closes that child's own inline editor first, if it was
   * open (§5's own explicit requirement) — the child is about to be
   * removed, so any in-progress edit to it is meaningless to keep open
   * (its OWN draft is discarded as a direct consequence of being deleted,
   * never silently kept around as a dangling reference to a soon-to-be-
   * gone node).
   */
  private commitPendingDeletion(childNodeId: string): void {
    const view = this.activeMarkdownView.get();
    if (!view || !this.nodeId || !this.childAddDeleteSession) {
      new Notice(this.plugin.t("partialEdit.parentChildDeleteFailed"));
      return;
    }
    const doc = parseDocument(view.editor.getValue());
    const parentNode = doc.nodes.get(this.nodeId);
    if (!parentNode || !isListNode(parentNode)) {
      new Notice(this.plugin.t("partialEdit.parentChildDeleteFailed"));
      return;
    }
    const evaluated = evaluateChildDeleteEligibility(doc, parentNode, childNodeId);
    if (!evaluated.ok) {
      new Notice(this.plugin.t("partialEdit.parentChildDeleteFailed"));
      return;
    }
    const childIndex = this.childAddDeleteSession.childSlots.findIndex((slot) => slot.nodeId === childNodeId);
    if (childIndex === -1) {
      new Notice(this.plugin.t("partialEdit.parentChildDeleteFailed"));
      return;
    }
    if (this.childInlineSession?.childNodeId === childNodeId) {
      this.childInlineSession = null;
    }
    this.childAddDeleteSession.pendingDeletion = { childNodeId, childIndex };
    this.renderParentChildPreview();
    this.updateDirtyState();
  }

  /**
   * Phase 5L-10 ("Direct Child Leaf Reorder in Parent Partial Edit
   * Pane"): the ONE entry point for the up/down reorder affordance's
   * click — re-verifies BOTH `reorderAvailable` AND the moving child's
   * (and its neighbor's) own eligibility fresh against the CURRENT
   * document (never trusts the row's own build-time eligibility
   * snapshot — mirrors handleStartChildInlineEdit's/
   * handleRequestDeleteChild's own identical re-verification discipline)
   * before ever mutating `pendingReorderOrder`. Deliberately does NOT
   * route through DiscardChangesModal — a reorder move never discards
   * anything, it only appends to this session's own pending plan (mirrors
   * handleRequestAddChild's own identical "purely additive" rationale) —
   * so there is nothing here that dirty state could ever put at risk of
   * being silently lost. A failure (the button SHOULD already be
   * disabled whenever this would fail — see renderParentChildPreview's
   * own `makeReorderButton`) is a safe, silent no-op, never a partial
   * reorder.
   */
  private handleReorderChild(childNodeId: string, direction: ChildReorderDirection): void {
    const addDeleteSession = this.childAddDeleteSession;
    const view = this.activeMarkdownView.get();
    if (!addDeleteSession || !addDeleteSession.reorderAvailable || !view || !this.nodeId) {
      new Notice(this.plugin.t("partialEdit.parentChildReorderFailed"));
      return;
    }
    const doc = parseDocument(view.editor.getValue());
    const parentNode = doc.nodes.get(this.nodeId);
    if (!parentNode || !isListNode(parentNode)) {
      new Notice(this.plugin.t("partialEdit.parentChildReorderFailed"));
      return;
    }
    const eligibleIds = new Set<string>();
    for (const id of parentNode.childIds) {
      if (evaluateChildReorderEligibility(doc, parentNode, id).ok) {
        eligibleIds.add(id);
      }
    }
    const excludedId = addDeleteSession.pendingDeletion?.childNodeId ?? null;
    const result = moveChildInPendingReorder(
      addDeleteSession.pendingReorderOrder,
      eligibleIds,
      excludedId,
      childNodeId,
      direction
    );
    if (!result.ok) {
      new Notice(this.plugin.t("partialEdit.parentChildReorderFailed"));
      return;
    }
    addDeleteSession.pendingReorderOrder = result.newOrder;
    this.renderParentChildPreview();
    this.updateDirtyState();
  }

  /**
   * Phase 5L-11 ("Direct Child Leaf Indent/Outdent in Parent Partial
   * Edit Pane"): the ONE entry point for the indent affordance's click —
   * re-verifies eligibility fresh via buildPendingIndent (never trusts
   * the row's own build-time eligibility snapshot, mirroring
   * handleReorderChild's/handleRequestDeleteChild's own identical
   * discipline) before ever setting `pendingIndentOutdent`. Deliberately
   * does NOT route through DiscardChangesModal — renderParentChildPreview
   * only ever offers this button while canStartIndentOutdent is true
   * (no other pending structural transformation, no open existing-child
   * editor, no pending add/delete/reorder), so there is nothing here
   * that dirty state could ever put at risk of being silently lost — a
   * pending indent/outdent is itself purely additive to whatever the
   * parent's own own-text draft may separately hold (see this ticket's
   * own §6 "MAY compose with a dirty parent own-text edit" scope note).
   * A failure (the button SHOULD already be hidden whenever this would
   * fail) is a safe, silent-to-the-document Notice, never a partial
   * transformation.
   */
  private handleRequestIndentChild(childNodeId: string): void {
    const addDeleteSession = this.childAddDeleteSession;
    const view = this.activeMarkdownView.get();
    if (!addDeleteSession || addDeleteSession.pendingIndentOutdent || !view || !this.nodeId) {
      new Notice(this.plugin.t("partialEdit.parentChildIndentFailed"));
      return;
    }
    const doc = parseDocument(view.editor.getValue());
    const parentNode = doc.nodes.get(this.nodeId);
    if (!parentNode || !isListNode(parentNode)) {
      new Notice(this.plugin.t("partialEdit.parentChildIndentFailed"));
      return;
    }
    const built = buildPendingIndent(doc, parentNode, childNodeId);
    if (!built.ok) {
      new Notice(this.plugin.t("partialEdit.parentChildIndentFailed"));
      return;
    }
    addDeleteSession.pendingIndentOutdent = built.pending;
    this.renderParentChildPreview();
    this.updateDirtyState();
  }

  /** Phase 5L-11: the outdent counterpart of handleRequestIndentChild immediately above — see that method's own doc comment. */
  private handleRequestOutdentChild(childNodeId: string): void {
    const addDeleteSession = this.childAddDeleteSession;
    const view = this.activeMarkdownView.get();
    if (!addDeleteSession || addDeleteSession.pendingIndentOutdent || !view || !this.nodeId) {
      new Notice(this.plugin.t("partialEdit.parentChildOutdentFailed"));
      return;
    }
    const doc = parseDocument(view.editor.getValue());
    const parentNode = doc.nodes.get(this.nodeId);
    if (!parentNode || !isListNode(parentNode)) {
      new Notice(this.plugin.t("partialEdit.parentChildOutdentFailed"));
      return;
    }
    const built = buildPendingOutdent(doc, parentNode, childNodeId);
    if (!built.ok) {
      new Notice(this.plugin.t("partialEdit.parentChildOutdentFailed"));
      return;
    }
    addDeleteSession.pendingIndentOutdent = built.pending;
    this.renderParentChildPreview();
    this.updateDirtyState();
  }

  /**
   * Phase 5L-8: the ONE entry point for opening a direct child's inline
   * editor — the edit-start affordance in renderParentChildPreview above
   * is the only caller. Re-verifies eligibility fresh via
   * buildParentChildInlineEditSession (never trusts the row's own
   * build-time eligibility snapshot), and — exactly like requestLoadNode's
   * own dirty guard — routes through the SAME DiscardChangesModal 3-choice
   * contract whenever this pane's COMBINED dirty state (the parent's own
   * draft AND/OR the currently-open child's own draft — isDirty() already
   * accounts for both, see that method's own doc comment) is dirty when
   * switching to a DIFFERENT child. Opening a first child, or re-opening
   * while nothing is dirty, proceeds immediately with no prompt.
   */
  private handleStartChildInlineEdit(childNodeId: string): void {
    if (this.childInlineSession?.childNodeId === childNodeId) return;
    const openSession = () => {
      const view = this.activeMarkdownView.get();
      if (!view || !this.nodeId || !this.standaloneParentListItemProjection) {
        new Notice(this.plugin.t("partialEdit.parentChildInlineEditFailed"));
        return;
      }
      const doc = parseDocument(view.editor.getValue());
      const parentNode = doc.nodes.get(this.nodeId);
      if (!parentNode || !isListNode(parentNode)) {
        new Notice(this.plugin.t("partialEdit.parentChildInlineEditFailed"));
        return;
      }
      const built = buildParentChildInlineEditSession(
        doc,
        parentNode,
        this.standaloneParentListItemProjection,
        childNodeId
      );
      if (!built.ok) {
        new Notice(this.plugin.t("partialEdit.parentChildInlineEditFailed"));
        return;
      }
      this.childInlineSession = built.session;
      this.renderParentChildPreview();
      this.updateDirtyState();
    };

    if (!this.isDirty()) {
      openSession();
      return;
    }
    new DiscardChangesModal(this.app, this.plugin, (choice) => {
      if (choice === "cancel") return;
      if (choice === "discard") {
        // Revert BOTH the parent's own draft and the current child's own
        // draft (cancelEdit() already reverts both — see that method's
        // own updated doc comment), then close the current session before
        // opening the newly-selected one.
        this.cancelEdit();
        this.childInlineSession = null;
        openSession();
        return;
      }
      // choice === "apply": the SAME combined parent+child Apply this
      // pane's own Apply button already runs — the new child's editor
      // only ever opens once that Apply actually succeeded; on failure,
      // applyEdit() has already shown its own failure Notice and BOTH
      // drafts remain exactly as they were.
      if (this.applyEdit()) {
        openSession();
      }
    }).open();
  }

  /**
   * Phase 5L-8: "stop editing this child" — the ONLY way to close the
   * child inline editor other than switching to editing a DIFFERENT child
   * (handleStartChildInlineEdit above). Discards ONLY the child's own
   * draft on the "discard" choice — the parent's own draft (if any) is
   * left completely untouched, per this ticket's own explicit §5
   * requirement. A CLEAN child draft closes immediately, no prompt.
   */
  private handleStopChildInlineEdit(): void {
    if (!this.childInlineSession) return;
    if (!this.isChildInlineDraftDirty()) {
      this.childInlineSession = null;
      this.renderParentChildPreview();
      this.updateDirtyState();
      return;
    }
    new DiscardChangesModal(this.app, this.plugin, (choice) => {
      if (choice === "cancel") return;
      if (choice === "discard") {
        this.childInlineSession = null;
        this.renderParentChildPreview();
        this.updateDirtyState();
        return;
      }
      // choice === "apply": the same combined parent+child Apply — closes
      // the session only once it actually succeeded.
      if (this.applyEdit()) {
        this.childInlineSession = null;
        this.renderParentChildPreview();
        this.updateDirtyState();
      }
    }).open();
  }

  /**
   * Phase 5L-8: whether the child inline editor's own controls currently
   * differ from `childInlineSession`'s loaded snapshot — `false` whenever
   * no session is open. Shared by isDirty() and
   * handleStopChildInlineEdit/applyParentChildCombinedEdit's own dirty
   * gating, so all three can never drift apart.
   */
  private isChildInlineDraftDirty(): boolean {
    const session = this.childInlineSession;
    if (!session) return false;
    const bodyDirty = this.childInlineTextareaEl.value !== projectedChildBodyText(session.childProjection);
    const kind = childEffectiveControlKind(session.childProjection);
    const checkedDirty =
      kind === "task" &&
      this.childInlineTaskCheckboxInputEl.checked !== projectedChildChecked(session.childProjection);
    const numberDirty =
      kind === "ordered" &&
      this.childInlineOrderedNumberInputEl.value !== projectedChildNumberText(session.childProjection);
    return bodyDirty || checkedDirty || numberDirty;
  }

  /**
   * Phase 5L-7 ("Read-Only Child Subtree Preview Navigation"): the ONE
   * place a child-preview row's click/Enter/Space activation ever reaches.
   * Re-parses the CURRENT active note fresh, re-resolves `target` against
   * it via resolveParentChildPreviewNavigationTarget (never trusts the
   * nodeId captured back when this preview was last built/reloaded — see
   * that function's own doc comment for the full identity-refresh
   * rationale), and only ever calls requestLoadNode — never
   * loadNodeInternal directly — once that re-resolution actually succeeds.
   * requestLoadNode is what already gives this its own entire clean/dirty
   * target-switching contract for free (Apply-then-move /
   * discard-then-move / cancel-stays-put via the existing
   * DiscardChangesModal — see requestLoadNode's own doc comment): this
   * method deliberately never re-implements any part of that itself, only
   * decides WHETHER it is safe to call requestLoadNode at all.
   *
   * A failed re-resolution (parent no longer eligible, target no longer
   * found, target reassigned elsewhere, or target content changed —
   * ParentChildPreviewNavigationResolveReason's own exhaustive list) shows
   * a Notice and returns without ever calling requestLoadNode — this pane
   * stays on its current node with its current draft completely untouched,
   * exactly like every other safe-refusal path in this class.
   */
  private handleChildPreviewRowActivate(target: ParentChildPreviewNavigationTarget): void {
    const view = this.activeMarkdownView.get();
    if (!view || !this.nodeId) {
      new Notice(this.plugin.t("partialEdit.parentChildPreviewNavigationFailed"));
      return;
    }
    const doc = parseDocument(view.editor.getValue());
    const resolved = resolveParentChildPreviewNavigationTarget(doc, this.nodeId, target);
    if (!resolved.ok) {
      new Notice(this.plugin.t("partialEdit.parentChildPreviewNavigationFailed"));
      return;
    }
    this.requestLoadNode(resolved.nodeId);
  }

  /**
   * Phase 5D-0.5: the pane's "what should the textarea currently show"
   * value. Deliberately the ONLY place these two are reconciled — every
   * other reader (applySubtreeEdit's conflict re-extraction inside
   * applyEdit, the paragraph branch's own originalText bookkeeping) keeps
   * reading `this.originalText` directly and must keep doing so, since
   * that field is the raw snapshot applySubtreeEdit's contract requires.
   * `quoteProjection` is non-null only for a callout/blockquote whose body
   * was successfully projected (see loadNodeInternal/buildQuotePrefixProjection);
   * every other case — section, list, paragraph, and a callout/blockquote
   * that fell back to raw editing (the "no-body" case) — has
   * `quoteProjection === null` and simply shows `originalText` verbatim,
   * exactly as this pane always has.
   */
  private currentDisplayText(): string {
    if (this.quoteProjection) return projectedDisplayText(this.quoteProjection);
    // Phase 5L-1: standaloneListMarkerProjection is only ever set for a
    // standalone list node (nodeId branch, nodeKind === "list") — a
    // structured CompositeBlock session's OWN list-member projection
    // lives in the separate `listMarkerProjection` field, which feeds
    // `compositeListInputEl`, never this shared `textareaEl` — so no
    // extra compositeAnchor guard is needed here; the two fields are
    // never both relevant to what this method returns.
    if (this.standaloneListMarkerProjection) {
      return projectedListBodyText(this.standaloneListMarkerProjection);
    }
    // Phase 5L-2: mutually exclusive with standaloneListMarkerProjection
    // above by construction (buildStandaloneListProjections) — the task
    // list item's own marker+checkbox-free body.
    if (this.standaloneTaskListProjection) {
      return projectedTaskBodyText(this.standaloneTaskListProjection);
    }
    // Phase 5L-3: mutually exclusive with standaloneListMarkerProjection/
    // standaloneTaskListProjection above by construction
    // (buildStandaloneListProjections) — the ordered-list item's own
    // number-marker-free body.
    if (this.standaloneOrderedListProjection) {
      return projectedOrderedBodyText(this.standaloneOrderedListProjection);
    }
    // Phase 5L-4: mutually exclusive with all three single-line
    // projections above by construction (only ever set once all three
    // returned null — see loadNodeInternal) — the multi-line leaf item's
    // own marker-free MULTI-line body.
    if (this.standaloneMultiLineListProjection) {
      return projectedMultiLineBodyText(this.standaloneMultiLineListProjection);
    }
    // Phase 5L-6: mutually exclusive with all four projections above by
    // construction (only ever set once all four returned null AND the
    // node owns children — see loadNodeInternal) — the parent item's own
    // marker-free own-text body ONLY (never the child subtree — see
    // parentChildPreviewEl's own field doc comment for where that's shown
    // instead).
    if (this.standaloneParentListItemProjection) {
      return projectedParentBodyText(this.standaloneParentListItemProjection);
    }
    return this.originalText;
  }

  /**
   * Phase 5L-12 ("Partial Edit Session Consolidation and External
   * Document Reconciliation"): the SINGLE authoritative implementation
   * of the five-tier standalone-list-item projection priority chain
   * (list-marker-free > task-list-marker-free > ordered-list-marker-free
   * > multi-line-leaf > parent-list-item — Phase 5L-1/5L-2/5L-3/5L-4/
   * 5L-6's own priority order, entirely unchanged). Before this phase,
   * this exact five-check/three-builder-call sequence was independently
   * re-implemented at FIVE call sites (loadNodeInternal's own initial
   * load, performAutoReload's own external-change reload, and three of
   * the post-Apply rebuild sites below) — the two of those five that
   * used a narrower, "only re-verify a projection that was ALREADY
   * active" gate (performAutoReload, before this phase) is exactly what
   * produced Phase 5L-9b's own real-device bug (a leaf reverting from a
   * just-undone parent started its reload with all four leaf fields
   * null, so that gate never fired — see
   * docs/phase5l12_partial-edit-external-reconciliation.md for the full
   * before/after). Every one of those five call sites now delegates
   * here instead, so the chain can never drift out of sync between them
   * again by construction, not by convention.
   *
   * Returns every field null for `node === undefined` or a non-list
   * node, exactly the same "fall back to raw" contract every prior call
   * site already had — this function never decides to REFUSE a target,
   * only which (if any) of the five structured projections currently
   * applies to it. `rawText` is the target's own already-isolated
   * subtree text (extractSubtreeText's own return shape) — only
   * consulted by the four LEAF builders, which is why an out-of-date
   * `rawText` for a node that is CURRENTLY a real parent (childIds.length
   * > 0) can never matter: every one of the four leaf eligibility checks
   * already independently requires `childIds.length === 0` before this
   * function ever looks at `rawText` at all.
   */
  private resolveStandaloneListProjections(
    doc: ParsedDocument,
    node: BlockNode | undefined,
    rawText: string
  ): {
    list: ListMarkerProjection | null;
    task: TaskListProjection | null;
    ordered: OrderedListProjection | null;
    multiLine: MultiLineListItemProjection | null;
    parent: ParentListItemProjection | null;
  } {
    // Phase 5L-12: the actual eligibility-check/builder-dispatch logic now
    // lives in edit/standaloneProjectionResolver.ts's own pure, Obsidian-
    // free resolveStandaloneListProjections — see that module's own doc
    // comment for why (behavioral testability with a real parseDocument,
    // with no Obsidian mock harness required). This method is now only a
    // thin call-through, kept so the class-field-facing doc comment above
    // stays where every OTHER field-adjacent doc comment in this file
    // already lives.
    return resolveStandaloneListProjectionsPure(doc, node, rawText);
  }

  /**
   * Phase 5L-12: the single authoritative "ancestors/directChildren/
   * siblingState triple, freshly derived from `doc`, for a
   * BlockNode-identified target" implementation — see
   * resolveStandaloneListProjections' own doc comment immediately above
   * for the identical rationale (the same five call sites that used to
   * duplicate the projection chain also duplicated this triple, or —
   * for three of the post-Apply rebuild sites, and performAutoReload
   * before this phase — omitted recomputing it entirely, which is what
   * left the Subtree Navigator/breadcrumb showing stale content after an
   * external change). `node === undefined` (a standalone callout/
   * blockquote target, or — defensively — a target that failed to
   * resolve) keeps this trio at its permanent empty state, exactly like
   * Phase 5C-2's own gate for those kinds.
   */
  private resolveNavigationState(
    doc: ParsedDocument,
    nodeId: string,
    node: BlockNode | undefined
  ): {
    ancestors: AncestorPathEntry[];
    directChildren: DescendantNavigationEntry[];
    siblingState: SiblingNavigationState;
  } {
    if (!node) {
      return { ancestors: [], directChildren: [], siblingState: { previous: null, next: null } };
    }
    const t = this.plugin.t.bind(this.plugin);
    return {
      ancestors: findAncestorPath(doc, nodeId, t),
      directChildren: findDirectChildren(doc, nodeId, t),
      siblingState: getSiblingNavigationState(doc, nodeId, t),
    };
  }

  /**
   * Phase 5L-12: the single authoritative "reconcile this pane's
   * node-kind (list/section) projection + Mode A/B session + navigation
   * state from a fresh `doc`" implementation — combines
   * resolveStandaloneListProjections and resolveNavigationState above
   * with the childAddDeleteSession/childInlineSession/
   * pendingLeafFirstChild derivation every one of the five call sites
   * below also independently duplicated. loadNodeInternal's own initial
   * load, performAutoReload's own external-change reload, and each of
   * the three post-Apply rebuild sites that edit an EXISTING parent's
   * own-text/child content (applyEdit's own standaloneParentListItemProjection
   * branch, applyParentChildCombinedEdit, applyParentChildAddDeleteCombinedEdit,
   * applyParentChildIndentOutdentEdit) all call this now, instead of each
   * re-deriving (and, before this phase, drifting out of sync with) the
   * same five-tier chain and the same three session fields. Two of those
   * Apply paths (add/delete's own "delete the last remaining child", and
   * indent/outdent's own "outdent the last remaining child") can
   * genuinely transition a real parent down to a childless leaf — before
   * this phase, their own narrow rebuilds only ever cleared
   * standaloneParentListItemProjection/childAddDeleteSession on that
   * transition, but never discovered the resulting leaf's own standalone
   * projection or refreshed the navigation trio, leaving the exact same
   * stale-Subtree-Navigator/missing-"＋"-button symptom Phase 5L-9b's own
   * real-device bug reported for the external-Undo case — see
   * docs/phase5l12_partial-edit-external-reconciliation.md §4-2 for the
   * full scenario list this now covers uniformly.
   *
   * Unconditionally resetting childInlineSession/pendingLeafFirstChild
   * here (rather than trying to preserve them) is safe for every one of
   * these callers: a fresh load's own "switching target discards local
   * drafts" contract already covered loadNodeInternal; each Apply-success
   * call site is, by definition, the very save that just committed
   * whatever child-inline/add/delete/indent-outdent/leaf-first-child
   * activity was pending (childAddDeleteSession/pendingLeafFirstChild are
   * always rebuilt fresh — or reopened, for childInlineSession, by the
   * caller's own post-call logic where applicable — immediately after);
   * and performAutoReload itself is only ever reached via
   * classifySyncOutcome's own clean-pane-auto-reload branch, which
   * requires `!isDirty()` — and isDirty() already folds in
   * pendingLeafFirstChild's own presence and childAddDeleteSession's own
   * activity (hasAddDeleteActivity()), so by the time performAutoReload
   * calls this there is nothing pending left to lose either.
   */
  private reconcileStandaloneNodeState(
    doc: ParsedDocument,
    nodeId: string,
    node: BlockNode | undefined,
    rawText: string
  ): void {
    const projections = this.resolveStandaloneListProjections(doc, node, rawText);
    this.standaloneListMarkerProjection = projections.list;
    this.standaloneTaskListProjection = projections.task;
    this.standaloneOrderedListProjection = projections.ordered;
    this.standaloneMultiLineListProjection = projections.multiLine;
    this.standaloneParentListItemProjection = projections.parent;
    this.childAddDeleteSession =
      projections.parent && node && isListNode(node)
        ? buildParentChildAddDeleteSession(doc, node, projections.parent)
        : null;
    this.childInlineSession = null;
    this.pendingLeafFirstChild = null;
    const nav = this.resolveNavigationState(doc, nodeId, node);
    this.ancestors = nav.ancestors;
    this.directChildren = nav.directChildren;
    this.siblingState = nav.siblingState;
  }

  /**
   * Phase 5D-1C fix: Chromium's own native `<datalist>` filtering matches
   * a candidate whenever the typed text appears ANYWHERE in it (e.g.
   * typing "n" also surfaces "warning"/"question"/"danger"), not just at
   * the start — so left on its own it does not give the prefix-only
   * suggestion behavior ("n" -> "note" alone) this ticket's UI is meant
   * to offer. This never touches what can actually be typed/pasted/
   * Applied (the datalist only ever offers candidates — see
   * quoteTypeInputEl's own doc comment); it only narrows which
   * `<option>` children quoteTypeDatalistEl currently exposes, so the
   * suggestion dropdown itself does prefix-only matching. Called on every
   * keystroke in quoteTypeInputEl, and again whenever its value is set
   * programmatically (render/cancel), so the suggestion list never goes
   * stale after a node switch or a revert.
   */
  private refreshQuoteTypeDatalistOptions(): void {
    const query = this.quoteTypeInputEl.value.toLowerCase();
    this.quoteTypeDatalistEl.empty();
    for (const type of PartialEditView.QUOTE_TYPE_DATALIST_OPTIONS) {
      if (type.startsWith(query)) {
        this.quoteTypeDatalistEl.createEl("option", { value: type });
      }
    }
  }

  /**
   * Phase 5D-0.5: draw (or hide) the callout-header row above the
   * textarea. Only ever visible for a projecting CALLOUT — a projecting
   * blockquote has no header concept at all (`quoteProjection.header` is
   * always null for kind "blockquote"; see QuotePrefixProjection's own
   * doc comment), and a non-projecting node of any kind has nothing to
   * separate out. Re-run only from loadNodeInternal's render call,
   * renderEmptyState, and applyEdit's post-apply rebuild — i.e. exactly
   * when the loaded node itself (or its just-applied raw text) changes —
   * never on every keystroke, matching renderBreadcrumb's own "static
   * until the next load" policy immediately below.
   *
   * Phase 5D-1A: the row is no longer uniformly read-only. When
   * `quoteProjection.titleSlot` is set (a callout whose title was
   * successfully split out — see buildQuoteHeaderTitleSlot), this shows
   * the READ-ONLY portion in `quoteHeaderLabelEl`, and reveals
   * `quoteTitleInputEl` pre-filled with the loaded `title` — type/prefix
   * stay exactly as read-only as they were before this ticket, only the
   * title itself becomes editable. Every other case (blockquote, non-
   * projecting, or a callout whose title slot failed to build — see
   * QuotePrefixProjection's own doc comment on `titleSlot`) hides
   * `quoteTitleInputEl` and falls back to the pre-5D-1A behavior: the
   * full raw header line shown read-only in `quoteHeaderLabelEl`, or
   * nothing at all.
   *
   * Phase 5D-1B: `quoteHeaderLabelEl` now shows ONLY `titleSlot.beforeMarker`
   * (quote prefix + `[!type]`) — the fold marker itself is no longer
   * rendered as raw `+`/`-` text here at all, since `quoteMarkerSelectEl`
   * (revealed/pre-filled in lockstep with `quoteTitleInputEl`, same
   * `titleSlot` gate) now represents it as a real, editable control
   * instead. `titleSlot.separator` is likewise never rendered literally —
   * it is a reconstruction-time concern only (see reconstructQuoteHeader),
   * with the header row's own visual spacing coming from CSS layout
   * (flex gap) between the three DOM children instead.
   *
   * Phase 5D-1C: `quoteHeaderLabelEl` originally showed ONLY
   * `titleSlot.quotePrefix + "[!"` — the type itself moved to
   * `quoteTypeInputEl` (revealed/pre-filled in lockstep, same `titleSlot`
   * gate) verbatim, with no case-folding/trimming/fallback-to-"note" of
   * any kind. The literal closing `]` was rendered by
   * `quoteTypeCloseLabelEl`, shown/hidden in the exact same lockstep.
   *
   * 2026-09-09 (Partial Edit Pane コールアウト編集ヘッダーUI改善):
   * `quoteHeaderLabelEl` now shows the Outline Tree's own callout glyph
   * (`STANDALONE_CALLOUT_PREFIX`, "▣ ") instead of the raw `quotePrefix +
   * "[!"` text, and `quoteTypeCloseLabelEl`'s "]" is permanently dropped
   * (left hidden/empty) — see this method's own inline comment for the
   * full rationale. `quoteTypeInputEl` itself is unaffected: still shows
   * `titleSlot.type` verbatim, still feeds `reconstructQuoteHeader`
   * unchanged.
   */
  private renderQuoteHeader(): void {
    const titleSlot = this.quoteProjection?.titleSlot ?? null;
    if (titleSlot) {
      this.quoteHeaderEl.toggleVisibility(true);
      // 2026-09-09 (Partial Edit Pane コールアウト編集ヘッダーUI改善):
      // previously showed the raw `titleSlot.quotePrefix + "[!"` (e.g.
      // "> [!"), with the matching literal "]" in quoteTypeCloseLabelEl
      // right after quoteTypeInputEl below. Real-device feedback: this
      // raw-Markdown punctuation read poorly and ate horizontal space
      // that quoteTitleInputEl badly needed on a narrow pane. Replaced
      // with STANDALONE_CALLOUT_PREFIX ("▣ ") — the exact same glyph the
      // Outline Tree already uses for a callout row (buildOutlineTree.ts)
      // — so a callout reads as the same kind of thing here as it does
      // there. This is a display-only substitution: reconstructQuoteHeader
      // (applyEdit, below) is fed `titleSlot` directly, never anything
      // read from this label's text, so the original quotePrefix/type
      // bracket are still reconstructed correctly on Apply regardless of
      // what this label shows.
      this.quoteHeaderLabelEl.setText(STANDALONE_CALLOUT_PREFIX);
      this.quoteTypeInputEl.toggleVisibility(true);
      this.quoteTypeInputEl.disabled = false;
      this.quoteTypeInputEl.value = titleSlot.type;
      this.refreshQuoteTypeDatalistOptions();
      // The literal closing "]" this label used to show is dropped along
      // with the opening "> [!" above — always left hidden/empty now (see
      // this branch's own doc comment). Kept as a real field/element
      // rather than deleted outright, since nothing here needs a bigger
      // structural change than "stop showing it".
      this.quoteTypeCloseLabelEl.toggleVisibility(false);
      this.quoteTypeCloseLabelEl.setText("");
      this.quoteMarkerSelectEl.toggleVisibility(true);
      this.quoteMarkerSelectEl.disabled = false;
      this.quoteMarkerSelectEl.value = titleSlot.marker;
      this.quoteTitleInputEl.toggleVisibility(true);
      this.quoteTitleInputEl.disabled = false;
      this.quoteTitleInputEl.value = titleSlot.title;
      return;
    }
    this.quoteTypeInputEl.toggleVisibility(false);
    this.quoteTypeInputEl.value = "";
    this.refreshQuoteTypeDatalistOptions();
    this.quoteTypeCloseLabelEl.toggleVisibility(false);
    this.quoteTypeCloseLabelEl.setText("");
    this.quoteMarkerSelectEl.toggleVisibility(false);
    this.quoteMarkerSelectEl.value = "";
    this.quoteTitleInputEl.toggleVisibility(false);
    this.quoteTitleInputEl.value = "";

    const header = this.quoteProjection?.header ?? null;
    if (header === null) {
      this.quoteHeaderEl.toggleVisibility(false);
      this.quoteHeaderLabelEl.setText("");
      return;
    }
    this.quoteHeaderEl.toggleVisibility(true);
    this.quoteHeaderLabelEl.setText(header);
  }

  /**
   * Phase 5D-2B ("CompositeBlock Structured Partial Edit Projection"): toggles/
   * populates the structured CompositeBlock session's own list-member row
   * (compositeListRowEl/compositeListInputEl) — this ticket's addition to
   * the pane's existing render pipeline. Called from renderEmptyState/
   * renderLoadedState alongside renderQuoteHeader (see both methods' own
   * shared tail), and from performAutoReload after a composite session's
   * own structured state is refreshed.
   *
   * Active (this.nodeKind === "composite" && this.compositeListOriginalText
   * !== null) only for a CompositeBlock that was successfully split AND
   * whose trailing member successfully projected — see
   * loadCompositeInternal's own doc comment. Every other case (a
   * non-composite kind, or a composite that fell back to the existing raw
   * whole-range textarea) hides this row and clears the input, leaving
   * the pane's pre-existing raw-textarea-only composite UI completely
   * unchanged in appearance and behavior.
   *
   * 2026-09-14 (real-device follow-up): previously also toggled/labeled a
   * separate compositeTrailingLabelEl above the reused quoteHeaderEl/
   * textareaEl pair ("Callout"/"Quote"). Removed — see compositeListRowEl's
   * own field doc comment for why both member labels were redundant.
   */
  private renderCompositeListSlot(): void {
    const active = this.nodeKind === "composite" && this.compositeListOriginalText !== null;
    this.compositeListRowEl.toggleVisibility(active);
    this.compositeListInputEl.value = active ? this.compositeListOriginalText! : "";
    this.compositeListInputEl.disabled = !active;
  }

  /**
   * Phase 5L-2 ("Task List Marker-Free Partial Edit"): mirrors
   * renderCompositeListSlot's own "toggle visibility/populate from the
   * loaded projection, once per render" pattern, for the standalone
   * task-list checkbox control instead of the CompositeBlock list-member
   * input. Shown ONLY when a standalone task-list item's checkbox is
   * currently hidden from the shared textarea
   * (this.standaloneTaskListProjection !== null) — every other case
   * (every non-task-list kind, and a task-list item that fell back to
   * raw editing) hides this row and leaves the checkbox unchecked/
   * disabled, mirroring compositeListRowEl's own hidden/empty default.
   */
  private renderTaskCheckboxRow(): void {
    // Phase 5L-4: ALSO active for a multi-line leaf item whose own first
    // line is a task line (this.standaloneMultiLineListProjection?.listKind
    // === "task") — the exact same checkbox control this row already
    // owns for the single-line case is reused unchanged (see this
    // ticket's own design doc §7: "新たな...checkbox status edit control
    // は作らないこと"). The two conditions are mutually exclusive by
    // construction (standaloneMultiLineListProjection is only ever set
    // once standaloneTaskListProjection is null — see loadNodeInternal).
    const multiLineTaskActive = this.standaloneMultiLineListProjection?.listKind === "task";
    // Phase 5L-6: ALSO active for a parent item whose own-text's first
    // line is a task line (this.standaloneParentListItemProjection?.ownText.listKind
    // === "task") — same reused-unchanged-control rationale as the
    // multi-line case immediately above. Mutually exclusive with every
    // condition above by construction (only ever set once all four
    // single-line/multi-line projections are null — see loadNodeInternal).
    const parentTaskActive = this.standaloneParentListItemProjection?.ownText.listKind === "task";
    const active = this.standaloneTaskListProjection !== null || multiLineTaskActive || parentTaskActive;
    this.taskCheckboxRowEl.toggleVisibility(active);
    this.taskCheckboxInputEl.checked = this.standaloneTaskListProjection
      ? this.standaloneTaskListProjection.checked
      : multiLineTaskActive
        ? projectedMultiLineChecked(this.standaloneMultiLineListProjection!)
        : parentTaskActive
          ? projectedParentChecked(this.standaloneParentListItemProjection!)
          : false;
    this.taskCheckboxInputEl.disabled = !active;
  }

  /**
   * Phase 5L-3 ("Ordered List Marker-Free Partial Edit"): mirrors
   * renderTaskCheckboxRow's own "toggle visibility/populate from the
   * loaded projection, once per render" pattern, for the standalone
   * ordered-list number control instead of the task-list checkbox. Shown
   * ONLY when a standalone ordered-list item's number marker is
   * currently hidden from the shared textarea
   * (this.standaloneOrderedListProjection !== null) — every other case
   * (every non-ordered-list kind, and an ordered-list item that fell back
   * to raw editing) hides this row and leaves the input empty/disabled,
   * mirroring taskCheckboxRowEl's own hidden/empty default. Always
   * populates from `projection.number` VERBATIM (see that field's own
   * doc comment) — never re-formatted/re-validated here; Apply-time
   * validation is this class's own applyEdit, via
   * isValidOrderedListNumberText.
   */
  private renderOrderedNumberRow(): void {
    // Phase 5L-4: ALSO active for a multi-line leaf item whose own first
    // line is an ordered line (this.standaloneMultiLineListProjection?.listKind
    // === "ordered") — the exact same number control this row already
    // owns for the single-line case is reused unchanged (see this
    // ticket's own design doc §7). Mutually exclusive with
    // standaloneOrderedListProjection by construction — see
    // renderTaskCheckboxRow's own identical comment immediately above.
    const multiLineOrderedActive = this.standaloneMultiLineListProjection?.listKind === "ordered";
    // Phase 5L-6: ALSO active for a parent item whose own-text's first
    // line is an ordered line — same rationale as renderTaskCheckboxRow's
    // own identical parent-case addition above.
    const parentOrderedActive = this.standaloneParentListItemProjection?.ownText.listKind === "ordered";
    const active =
      this.standaloneOrderedListProjection !== null || multiLineOrderedActive || parentOrderedActive;
    this.orderedNumberRowEl.toggleVisibility(active);
    this.orderedNumberInputEl.value = this.standaloneOrderedListProjection
      ? projectedOrderedNumberText(this.standaloneOrderedListProjection)
      : multiLineOrderedActive
        ? projectedMultiLineNumberText(this.standaloneMultiLineListProjection!)
        : parentOrderedActive
          ? projectedParentNumberText(this.standaloneParentListItemProjection!)
          : "";
    this.orderedNumberInputEl.disabled = !active;
  }

  /**
   * Phase 5B: draw the ancestor breadcrumb from `this.ancestors`, computed
   * once by loadNodeInternal at load time. Deliberately NOT recomputed on
   * every render or on a timer — the breadcrumb is a read-only aid derived
   * from the same "before editing" snapshot as the textarea, and Phase 5B's
   * design principle #5 is explicit that it must not be live-recalculated
   * against in-progress edits or Tree state before an Apply. Re-running
   * this only happens as part of loadNodeInternal/renderEmptyState, i.e.
   * exactly when the loaded node itself changes.
   *
   * The current node itself is never shown here (see class field doc
   * comment on `ancestors` and requestLoadNode) — titleEl already owns
   * that role, so breadcrumb and title stay complementary rather than
   * redundant.
   */
  private renderBreadcrumb(): void {
    this.breadcrumbEl.empty();
    if (this.ancestors.length === 0) {
      this.breadcrumbEl.toggleVisibility(false);
      return;
    }
    this.breadcrumbEl.toggleVisibility(true);

    const visibleCount = PartialEditView.BREADCRUMB_VISIBLE_ANCESTORS;
    const elided =
      this.ancestors.length > visibleCount
        ? this.ancestors.slice(0, this.ancestors.length - visibleCount)
        : [];
    const visible =
      elided.length > 0 ? this.ancestors.slice(elided.length) : this.ancestors;

    if (elided.length > 0) {
      const ellipsisEl = this.breadcrumbEl.createSpan({
        cls: "unified-outliner-partial-edit-breadcrumb-segment unified-outliner-partial-edit-breadcrumb-ellipsis",
        text: "…",
      });
      setTooltip(ellipsisEl, elided.map((a) => a.label).join(" › "));
      this.breadcrumbEl.createSpan({
        cls: "unified-outliner-partial-edit-breadcrumb-sep",
        text: "›",
      });
    }

    visible.forEach((ancestor, index) => {
      const segEl = this.breadcrumbEl.createSpan({
        cls: "unified-outliner-partial-edit-breadcrumb-segment",
        text: ancestor.label,
      });
      setTooltip(segEl, ancestor.label);
      // Phase 5B design principle #3/#5: a breadcrumb click must resolve
      // through the same guarded projection entry point as a Tree click —
      // never a direct loadNodeInternal call. See requestLoadNode's doc
      // comment for the full rationale (dirty-guard parity above all).
      segEl.addEventListener("click", () => this.requestLoadNode(ancestor.id));
      if (index < visible.length - 1) {
        this.breadcrumbEl.createSpan({
          cls: "unified-outliner-partial-edit-breadcrumb-sep",
          text: "›",
        });
      }
    });
  }

  /**
   * Sibling前後移動 (docs/phase5b_sibling-navigation-spec.md §3/§4): update
   * the two sibling-nav buttons from `this.siblingState`, computed once by
   * loadNodeInternal at load time — same "static snapshot until the next
   * load" policy as renderBreadcrumb/renderSubtreeNavigator's own fields,
   * for the same reason (a read-only navigation aid derived from the pane's
   * "before editing" snapshot, not live-recalculated against in-progress
   * edits).
   *
   * Unlike renderBreadcrumb/renderSubtreeNavigator, this never rebuilds the
   * DOM tree itself (no empty()/createSpan for the buttons) — the two
   * buttons, and their target-label spans, are created once in onOpen and
   * always exist; only `disabled` state, tooltip, and the target-label
   * text/visibility change here. Once a node is loaded AND it has a
   * sibling in at least one direction, the row stays visible and each
   * button disables itself independently when that direction has no
   * sibling — deliberately different from the breadcrumb and Subtree
   * Navigator's "hide the whole row when empty" policy, since a node with
   * siblings on only one side should still make that one direction
   * discoverable.
   *
   * 2026-09-09 (Partial Edit Pane 上部余白調整): the row is now ALSO hidden
   * — same as the breadcrumb/Subtree Navigator's own "hide when empty"
   * policy — when the loaded node has no sibling in EITHER direction.
   * Previously this row stayed visible even then, showing two permanently-
   * disabled buttons that could never lead anywhere. This was most visible
   * for a CompositeBlock: loadCompositeInternal always resets
   * `siblingState` to `{ previous: null, next: null }` (see its own "no
   * breadcrumb / sibling nav / Subtree Navigator for a CompositeBlock"
   * comment, Phase 5D-2A) — i.e. the intent was already documented there,
   * but this function's own condition never actually enforced it, so the
   * row rendered anyway for every CompositeBlock edit, contributing an
   * always-empty row's worth of height directly above the textarea. This
   * is the primary fix for the reported "vast blank space directly below
   * the header" when editing an extended block (see styles.css's
   * `.unified-outliner-partial-edit-view` doc comment for the accompanying
   * spacing/gap tightening).
   *
   * Target-label preview: each button's *TargetEl span shows the
   * destination sibling's own displayLabel (same field the breadcrumb and
   * Subtree Navigator already use — see AncestorPathEntry.label /
   * DescendantNavigationEntry.label), so the pane shows where "Previous" /
   * "Next" actually lead before either is clicked. CSS truncates a long
   * label (styles.css); the button's own tooltip below always carries the
   * full, untruncated label. When a direction has no sibling, its target
   * span is cleared and hidden rather than showing empty space — no target
   * label for a disabled button, matching the button's own disabled state.
   */
  private renderSiblingNav(): void {
    if (!this.nodeId || (!this.siblingState.previous && !this.siblingState.next)) {
      this.siblingNavEl.toggleVisibility(false);
      return;
    }
    this.siblingNavEl.toggleVisibility(true);

    const previous = this.siblingState.previous;
    this.siblingPrevEl.disabled = !previous;
    setTooltip(
      this.siblingPrevEl,
      previous ? previous.displayLabel : this.plugin.t("partialEdit.noPreviousSibling")
    );
    this.siblingPrevTargetEl.setText(previous ? previous.displayLabel : "");
    this.siblingPrevTargetEl.toggleVisibility(!!previous);

    const next = this.siblingState.next;
    this.siblingNextEl.disabled = !next;
    setTooltip(
      this.siblingNextEl,
      next ? next.displayLabel : this.plugin.t("partialEdit.noNextSibling")
    );
    this.siblingNextTargetEl.setText(next ? next.displayLabel : "");
    this.siblingNextTargetEl.toggleVisibility(!!next);
  }

  /**
   * Subtree Navigator: draw the loaded node's direct children
   * (`this.directChildren`, computed once by loadNodeInternal — same
   * "static snapshot until the next load" policy as renderBreadcrumb's
   * ancestors, and for the same reason: this is a read-only navigation aid
   * derived from the pane's "before editing" snapshot, not a live view of
   * in-progress edits). Hidden entirely when the loaded node has no
   * children — a leaf node gets no empty/disabled navigator row, per the
   * implementation instruction's explicit requirement.
   *
   * Up to SUBTREE_VISIBLE_CHILDREN children are shown inline as chips
   * (appendSubtreeChip); any remainder collapses into one "More…" chip
   * that opens an Obsidian Menu — Menu already provides keyboard
   * navigation and correct positioning in every window (main, sidebar
   * split, or popout), so no bespoke popover was written for the overflow
   * case.
   */
  private renderSubtreeNavigator(): void {
    this.subtreeNavEl.empty();
    if (this.directChildren.length === 0) {
      this.subtreeNavEl.toggleVisibility(false);
      return;
    }
    this.subtreeNavEl.toggleVisibility(true);

    this.subtreeNavEl.createSpan({
      cls: "unified-outliner-partial-edit-subtree-nav-label",
      text: this.plugin.t("partialEdit.subtreeLabel"),
    });

    const visibleCount = PartialEditView.SUBTREE_VISIBLE_CHILDREN;
    const overflow = this.directChildren.length > visibleCount;
    // Reserve one inline slot for the "More…" chip itself when overflowing,
    // so the row never shows more than SUBTREE_VISIBLE_CHILDREN chips total.
    const visible = overflow
      ? this.directChildren.slice(0, visibleCount - 1)
      : this.directChildren;
    const hidden = overflow ? this.directChildren.slice(visible.length) : [];

    for (const child of visible) {
      this.appendSubtreeChip(child);
    }

    if (hidden.length > 0) {
      const moreEl = this.subtreeNavEl.createSpan({
        cls: "unified-outliner-partial-edit-subtree-nav-chip unified-outliner-partial-edit-subtree-nav-more",
        text: this.plugin.t("partialEdit.moreChip", { count: hidden.length }),
      });
      moreEl.tabIndex = 0;
      moreEl.setAttribute("role", "button");
      setTooltip(moreEl, this.plugin.t("partialEdit.moreCount", { count: hidden.length }));

      const openOverflowMenu = (anchor: HTMLElement, mouseEvt?: MouseEvent) => {
        const menu = new Menu();
        for (const child of hidden) {
          menu.addItem((item) =>
            item
              .setTitle(child.hasChildren ? `${child.label} ›` : child.label)
              .setIcon(child.kind === "section" ? "heading" : "list")
              // Same guarded entry point as every other Subtree Navigator
              // chip — see appendSubtreeChip's doc comment.
              .onClick(() => this.requestLoadNode(child.id))
          );
        }
        if (mouseEvt) {
          menu.showAtMouseEvent(mouseEvt);
        } else {
          // Keyboard-triggered (no MouseEvent): position explicitly, and
          // pass the anchor's OWN document (not the implicit global one) so
          // this opens correctly in a popped-out Partial Edit Pane window
          // too — same cross-window-safety pattern as the rest of this
          // pane (see class doc comment / Phase 5A).
          const rect = anchor.getBoundingClientRect();
          menu.showAtPosition({ x: rect.left, y: rect.bottom }, anchor.ownerDocument);
        }
      };
      moreEl.addEventListener("click", (evt) => openOverflowMenu(moreEl, evt));
      moreEl.addEventListener("keydown", (evt) => {
        if (evt.key === "Enter" || evt.key === " ") {
          evt.preventDefault();
          openOverflowMenu(moreEl);
        }
      });
    }
  }

  /**
   * One Subtree Navigator chip: an icon (heading vs. list — see class doc
   * comment on why kind is never conveyed by color alone), the child's
   * label (CSS-truncated with a tooltip carrying the full text, same
   * pattern as renderBreadcrumb's segments), and a subtle "›" marker when
   * the child itself has further children (hasChildren) — a hint that
   * there's more to descend into below it, without committing to showing
   * that deeper level inline.
   *
   * Focusable (tabIndex + role="button") and Enter/Space-activatable, on
   * top of the click handler — the implementation instruction explicitly
   * requires keyboard operability and visible focus here (see
   * styles.css's :focus-visible rule for this chip class).
   *
   * Activating a chip always calls requestLoadNode, never loadNodeInternal
   * — descending into a child must go through the exact same dirty-guard /
   * Apply-Discard-Cancel path as Tree clicks and breadcrumb clicks. See
   * requestLoadNode's own doc comment for the full rationale; nothing
   * about that guard changes for this new caller.
   */
  private appendSubtreeChip(child: DescendantNavigationEntry): void {
    const chipEl = this.subtreeNavEl.createSpan({
      cls: "unified-outliner-partial-edit-subtree-nav-chip",
    });
    chipEl.tabIndex = 0;
    chipEl.setAttribute("role", "button");
    setTooltip(chipEl, child.label);

    const iconEl = chipEl.createSpan({
      cls: "unified-outliner-partial-edit-subtree-nav-chip-icon",
    });
    setIcon(iconEl, child.kind === "section" ? "heading" : "list");

    chipEl.createSpan({
      cls: "unified-outliner-partial-edit-subtree-nav-chip-label",
      text: child.label,
    });

    if (child.hasChildren) {
      chipEl.createSpan({
        cls: "unified-outliner-partial-edit-subtree-nav-chip-marker",
        text: "›",
      });
    }

    const activate = () => this.requestLoadNode(child.id);
    chipEl.addEventListener("click", activate);
    chipEl.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter" || evt.key === " ") {
        evt.preventDefault();
        activate();
      }
    });
  }

  /** Revert unsaved edits in the textarea (and, Phase 5D-1A, the title input) — does not close the pane or change which node is loaded. */
  private cancelEdit(): void {
    if (!this.nodeId && !this.paragraphAnchor && !this.compositeAnchor) return;
    // Phase 5D-0.5: reverts to the projected displayText (not the raw
    // originalText) for a projecting callout/blockquote — see
    // currentDisplayText's own doc comment. Every other kind is
    // unaffected, since currentDisplayText falls through to originalText
    // verbatim whenever quoteProjection is null.
    this.textareaEl.value = this.currentDisplayText();
    // Phase 5D-1A: revert the title input to its loaded value too, when a
    // title slot is active — a no-op (value already unchanged) otherwise,
    // since quoteTitleInputEl is empty/hidden whenever titleSlot is null.
    // Phase 5D-1B: revert the fold-marker select the same way, in the
    // same branch — both are carved out of the same titleSlot.
    // Phase 5D-1C: revert the type combobox the same way too — verbatim
    // back to the loaded titleSlot.type, no case/trim normalization.
    const titleSlot = this.quoteProjection?.titleSlot ?? null;
    if (titleSlot) {
      this.quoteTypeInputEl.value = titleSlot.type;
      this.refreshQuoteTypeDatalistOptions();
      this.quoteMarkerSelectEl.value = titleSlot.marker;
      this.quoteTitleInputEl.value = titleSlot.title;
    }
    // Phase 5D-2B: revert the structured composite session's own
    // list-member input too — a no-op (value already unchanged) whenever
    // compositeListOriginalText is null (every non-composite kind, and a
    // composite that fell back to the raw whole-range textarea).
    if (this.compositeListOriginalText !== null) {
      this.compositeListInputEl.value = this.compositeListOriginalText;
    }
    // Phase 5L-2: revert the standalone task-list checkbox control too —
    // a no-op (value already unchanged) whenever
    // standaloneTaskListProjection is null (every non-task-list kind).
    if (this.standaloneTaskListProjection) {
      this.taskCheckboxInputEl.checked = this.standaloneTaskListProjection.checked;
    }
    // Phase 5L-3: revert the standalone ordered-list number input too —
    // a no-op (value already unchanged) whenever
    // standaloneOrderedListProjection is null (every non-ordered-list
    // kind).
    if (this.standaloneOrderedListProjection) {
      this.orderedNumberInputEl.value = this.standaloneOrderedListProjection.number;
    }
    // Phase 5L-4: revert the checkbox/number controls when a multi-line
    // leaf item's own first line is task/ordered respectively — a no-op
    // whenever standaloneMultiLineListProjection is null, or whenever its
    // own listKind is not the relevant one (see
    // projectedMultiLineChecked/projectedMultiLineNumberText's own
    // "always-readable default" doc comment). textareaEl.value was
    // already reverted above (currentDisplayText already branches on
    // this projection — see that method's own doc comment), so no
    // separate textarea revert is needed here.
    if (this.standaloneMultiLineListProjection?.listKind === "task") {
      this.taskCheckboxInputEl.checked = projectedMultiLineChecked(this.standaloneMultiLineListProjection);
    }
    if (this.standaloneMultiLineListProjection?.listKind === "ordered") {
      this.orderedNumberInputEl.value = projectedMultiLineNumberText(this.standaloneMultiLineListProjection);
    }
    // Phase 5L-6: revert the checkbox/number controls when a parent
    // item's own-text first line is task/ordered respectively — same
    // rationale, same "textareaEl.value already reverted above" note, as
    // the multi-line case immediately above.
    if (this.standaloneParentListItemProjection?.ownText.listKind === "task") {
      this.taskCheckboxInputEl.checked = projectedParentChecked(this.standaloneParentListItemProjection);
    }
    if (this.standaloneParentListItemProjection?.ownText.listKind === "ordered") {
      this.orderedNumberInputEl.value = projectedParentNumberText(this.standaloneParentListItemProjection);
    }
    // Phase 5L-8: revert the child inline editor's own controls too, when
    // a child inline session is active — Cancel reverts BOTH the parent's
    // own draft (above) and the currently-open child's own draft (this
    // ticket's own explicit §8 requirement), WITHOUT closing the child
    // editor itself (mirrors how Cancel never unloads the parent node
    // either, only reverts its text).
    if (this.childInlineSession) {
      const session = this.childInlineSession;
      this.childInlineTextareaEl.value = projectedChildBodyText(session.childProjection);
      const kind = childEffectiveControlKind(session.childProjection);
      if (kind === "task") {
        this.childInlineTaskCheckboxInputEl.checked = projectedChildChecked(session.childProjection);
      }
      if (kind === "ordered") {
        this.childInlineOrderedNumberInputEl.value = projectedChildNumberText(session.childProjection);
      }
    }
    // Phase 5L-9 ("Direct Child Add/Delete in Parent Partial Edit Pane"):
    // a full pane-level Cancel discards BOTH a pending new-child draft
    // AND a pending deletion mark entirely (§4's own "Cancel before Apply
    // means it never existed" contract for Add; §5's own "A full
    // pane-level Cancel undoes a pending deletion" contract for Delete) —
    // unlike the existing-child revert immediately above (which reverts
    // VALUES but keeps that editor open), both of THESE are removed from
    // the session outright, so the preview must be re-rendered to reflect
    // that (toggle the new-child editor closed, un-mark the pending-
    // deletion row) — every other revert above only ever changes an
    // already-visible control's own value, never a row's own visibility/
    // interactivity, so this is the one addition that needs it.
    // Phase 5L-10: a full pane-level Cancel ALSO discards a pending
    // reorder plan entirely — same "Cancel before Apply means it never
    // existed" contract as the new-child-draft/pending-deletion revert
    // immediately below, extended to this ticket's own third pending
    // slot. Reset to the IDENTITY order (never simply left as-is), so
    // the read-only preview reverts to its original, un-reordered
    // sequence — see this ticket's own explicit §8 "Cancel すると順序
    // preview は元に戻ること" requirement.
    const addDeleteSession = this.childAddDeleteSession;
    if (
      addDeleteSession &&
      (addDeleteSession.newChildDraft ||
        addDeleteSession.pendingDeletion ||
        isPendingReorderDirty(addDeleteSession) ||
        // Phase 5L-11 ("Direct Child Leaf Indent/Outdent in Parent
        // Partial Edit Pane"): a full pane-level Cancel ALSO discards a
        // pending indent/outdent entirely — same "Cancel before Apply
        // means it never existed" contract as the new-child-draft/
        // pending-deletion/pending-reorder revert immediately below,
        // extended to this ticket's own fourth pending slot. See this
        // ticket's own explicit §8 "Cancel must fully revert the pending
        // transformation" requirement.
        addDeleteSession.pendingIndentOutdent)
    ) {
      addDeleteSession.newChildDraft = null;
      addDeleteSession.pendingDeletion = null;
      addDeleteSession.pendingReorderOrder = addDeleteSession.childSlots.map((slot) => slot.nodeId);
      addDeleteSession.pendingIndentOutdent = null;
      this.renderParentChildPreview();
    }
    // Phase 5L-9b ("First Direct Child Addition for Leaf List Items —
    // Mode B"): a full pane-level Cancel ALSO discards a pending Mode B
    // "promote this leaf to a parent" draft entirely — same "Cancel
    // before Apply means it never existed" contract as the addDeleteSession
    // block immediately above, extended to this ticket's own fifth
    // pending slot (deliberately a SEPARATE field/branch, never folded
    // into the addDeleteSession block above — the two are mutually
    // exclusive by construction, see pendingLeafFirstChild's own doc
    // comment).
    if (this.pendingLeafFirstChild) {
      this.pendingLeafFirstChild = null;
      this.renderLeafFirstChildAddRow();
      this.renderNewChildEditor();
    }
    this.updateDirtyState();
  }

  /**
   * Apply the textarea's current content back to the active note, via the
   * same resolve-fresh -> compute outcome -> applyLineEditOutcome pipeline
   * every other tree-triggered command in this plugin uses. Unlike a
   * passive no-op (which respects the "Show no-op notices" setting), a
   * failed Apply always shows a Notice — silently doing nothing in
   * response to an explicit Apply click would be actively confusing.
   *
   * Phase 5B: now returns whether the apply actually succeeded. The
   * Apply-button click handler still ignores this (a button click doesn't
   * need to react to it — the Notice already tells the user), but
   * requestLoadNode's "Apply and switch" path needs it to decide whether
   * proceeding to load the next node is safe: a failed Apply (conflict,
   * refused edit, no active note, etc.) must leave the pane on its
   * current node rather than discarding the edit that just failed to
   * save.
   */
  private applyEdit(): boolean {
    if (!this.nodeId && !this.paragraphAnchor && !this.compositeAnchor) {
      new Notice(this.plugin.t("partialEdit.noNodeLoaded"));
      return false;
    }
    const view = this.activeMarkdownView.get();
    if (!view) {
      new Notice(this.plugin.t("partialEdit.noActiveNoteToApply"));
      return false;
    }
    const editor = view.editor;
    if (editor.listSelections().length > 1) {
      new Notice(this.plugin.t("notice.multipleCursors"));
      return false;
    }

    // Phase 5C-4: an ADDITIONAL, path-based safety valve, checked BEFORE
    // the existing content-based conflict check below — never a
    // replacement for it (that check, in applySubtreeEdit, is completely
    // unchanged by this ticket). `view` here may already be a DIFFERENT
    // note than the one `this.sourcePath` was recorded from, if the active
    // note changed elsewhere (in another window, when this pane is popped
    // out) since this pane last loaded — see
    // view/partialEditSourceNoteCheck.ts's own doc comment for the full
    // rationale. Both "note changed" and "path unavailable" fail safe:
    // Apply is refused and the editor is left byte-for-byte untouched,
    // exactly like every other refusal reason in this method.
    const sourceNoteCheck = checkPartialEditSourceNote(this.sourcePath, view.file?.path ?? null);
    if (sourceNoteCheck !== "ok") {
      const reasonKey: TranslationKey =
        sourceNoteCheck === "changed"
          ? "reason.partialEditSourceNoteChanged"
          : "reason.partialEditSourceNoteUnknown";
      new Notice(this.plugin.t(reasonKey));
      return false;
    }

    const doc = parseDocument(editor.getValue());

    // Phase 5P-2: a loaded paragraph is a fully separate re-resolution path
    // — see edit/paragraphPartialEdit.ts's own doc comment for why it
    // cannot reuse applySubtreeEdit's id-only contract (a paragraph also
    // needs parentId/depth re-verified, not just its scan-local id and
    // content). This branch never touches this.nodeId/applySubtreeEdit
    // below, and the reverse is equally true — exactly one of
    // nodeId/paragraphAnchor is ever set (see this class's own doc
    // comment), so the two paths cannot interfere with each other.
    if (this.paragraphAnchor) {
      const outcome = applyParagraphEdit(doc, this.paragraphAnchor, this.textareaEl.value);
      if (!outcome.changed) {
        const reasonKey = ("reason." + (outcome.reason ?? "anchor-unresolved")) as TranslationKey;
        new Notice(this.plugin.t(reasonKey));
        return false;
      }

      // Phase 5A-1 hardening §1: suppress this pane's OWN stale-check
      // reaction to the editor-change this call is about to fire, for the
      // exact span from immediately before the note mutation through
      // re-anchoring completion — see isApplyingOwnEdit's own doc comment
      // for the full rationale. try/finally guarantees the flag is always
      // released, even if applyLineEditOutcome/re-anchoring/updateDirtyState
      // were ever to throw.
      this.isApplyingOwnEdit = true;
      try {
        applyLineEditOutcome(
          editor,
          { line: outcome.newStartLine, ch: 0 },
          outcome.newStartLine,
          doc.lines,
          outcome,
          () => {}
        );

        this.originalText = this.textareaEl.value;
        // Phase 5P-4 supplement: re-anchor from a FRESH re-resolution at the
        // outcome's own new position, rather than blindly spreading the old
        // anchor. applyParagraphEdit may have resolved via its Pass 2
        // structural re-search (a same-parent paragraph<->paragraph swap
        // happened elsewhere while this pane was open) — in that case the
        // OLD anchor's complexBlockId no longer points at this paragraph at
        // all, and spreading it forward would silently reintroduce the exact
        // staleness this fix exists to close. Re-resolving via
        // resolveParagraphAtCursor at outcome.newStartLine, against the
        // just-applied document, always yields the correct current id/
        // siblingCount — a SECOND Apply within the same pane session then
        // starts from a fully current anchor, not a stale one.
        const freshDoc = parseDocument(editor.getValue());
        const freshResolved = resolveParagraphAtCursor(freshDoc, outcome.newStartLine);
        this.paragraphAnchor = freshResolved.paragraph
          ? buildParagraphEditAnchor(freshDoc, freshResolved.paragraph)
          : { ...this.paragraphAnchor, originalText: this.textareaEl.value };
        // Phase 5A-1 hardening §1: this pane just re-anchored from its own
        // just-applied content, so it is synced by definition — set
        // explicitly rather than left to whatever it happened to be before
        // Apply (requestLoadNode's "Apply and switch" flow can reach this
        // branch even while stale — see class doc comment on
        // requestLoadNode's "apply" choice).
        this.syncState = "synced";
        this.updateDirtyState();
      } finally {
        this.isApplyingOwnEdit = false;
      }
      // Exactly one debounced re-check after releasing suppression — see
      // isApplyingOwnEdit's own doc comment for why this is what
      // guarantees a fresh check still happens even if an event arriving
      // during suppression was discarded rather than queued. Idempotent
      // and cheap when nothing actually changed concurrently (the common
      // case): performStaleCheck simply confirms "synced" again.
      this.scheduleStaleCheck();

      const lineLen = editor.getLine(outcome.newStartLine)?.length ?? 0;
      editor.scrollIntoView(
        { from: { line: outcome.newStartLine, ch: 0 }, to: { line: outcome.newStartLine, ch: lineLen } },
        true
      );

      // Phase 5T-5A: selection-follow — see UnifiedOutlinerPlugin
      // #queueOutlineTreeSelectionFollow's own doc comment. A no-op when
      // no Outline Tree View leaf currently has this paragraph selected;
      // resolveSelectionAfterRefresh re-resolves from CURRENT body content
      // on the next refresh, exactly like every other Tree-dispatched
      // move/edit.
      this.plugin.queueOutlineTreeSelectionFollow(outcome.newStartLine);

      new Notice(this.plugin.t("partialEdit.paragraphUpdated"));
      return true;
    }

    // Phase 5D-2A: a loaded CompositeBlock is a third, fully separate
    // re-resolution path — see edit/compositeBlockPartialEdit.ts's own top
    // doc comment for why it cannot reuse the node branch's nodeId-only
    // contract below (a CompositeBlockSnapshot re-identifies by ruleId/
    // sectionId/range/member kind-id-range, never by any scan-local id
    // alone). This branch never touches this.nodeId/this.paragraphAnchor,
    // or the node/paragraph branches' own apply calls, and the reverse is
    // equally true — exactly one of nodeId/paragraphAnchor/compositeAnchor
    // is ever set (see this class's own doc comment), so the three paths
    // cannot interfere with each other.
    //
    // Phase 5D-2B ("CompositeBlock Structured Partial Edit Projection"): a STRUCTURED
    // session (this.quoteProjection !== null && this.compositeListOriginalText
    // !== null — see loadCompositeInternal's own doc comment) composes
    // applyCompositeBlockEdit's `newText` from the two member editors
    // instead of reading it directly off this.textareaEl.value. A
    // RAW-fallback session (quoteProjection === null, Phase 5D-2A's own
    // original, unmodified behavior) is completely unaffected —
    // newCompositeText is simply this.textareaEl.value, exactly as before
    // this ticket. Either way, applyCompositeBlockEdit itself (imported,
    // never modified) still performs the one and only conflict check and
    // splice, against the SAME this.originalText whole-range snapshot as
    // always — this ticket only changes what candidate text is offered to
    // it, never how it is verified or applied.
    if (this.compositeAnchor) {
      const rules = getEnabledCompositeBlockRules(this.plugin.settings.compositeBlocks);

      let newCompositeText: string;
      // Set only for a STRUCTURED session, and only once composition below
      // succeeds — used after a successful Apply to rebuild this pane's
      // own structured state fresh, mirroring how the standalone branch
      // further below rebuilds its own quoteProjection after Apply.
      let composedListLine: string | null = null;
      let composedTrailingText: string | null = null;
      if (this.quoteProjection && this.compositeListOriginalText !== null) {
        // Phase 5D-1.5 parity: invert the trailing member's body back to
        // raw Markdown via the exact same, UNMODIFIED
        // edit/quotePrefixProjection.ts machinery the standalone branch
        // below uses for a standalone callout/blockquote — never a
        // second, duplicated implementation.
        const inverted = invertQuotePrefixProjection(this.quoteProjection, this.textareaEl.value);
        if (!inverted.ok) {
          new Notice(this.plugin.t("partialEdit.quoteBodyEmptyUnsupported"));
          return false;
        }
        let trailingRawText = inverted.rawText;

        // Phase 5D-1A/5D-1B/5D-1C parity: reconstruct the trailing
        // member's own header line from the title/type/marker controls'
        // CURRENT values — identical logic, and the identical
        // reconstructQuoteHeader call, as the standalone branch below.
        const titleSlot = this.quoteProjection.titleSlot;
        if (titleSlot) {
          const newType = this.quoteTypeInputEl.value;
          const newMarker = this.quoteMarkerSelectEl.value as CalloutFoldMarker;
          const reconstructed = reconstructQuoteHeader(
            titleSlot,
            newType,
            newMarker,
            this.quoteTitleInputEl.value
          );
          if (!reconstructed.ok) {
            if (reconstructed.reason === "newline") {
              new Notice(this.plugin.t("partialEdit.quoteTitleNewlineUnsupported"));
            } else if (reconstructed.reason === "invalid-type") {
              new Notice(this.plugin.t("partialEdit.quoteTypeInvalidUnsupported"));
            }
            return false;
          }
          const bodyOnlyLines = trailingRawText.split("\n").slice(1);
          trailingRawText = [reconstructed.header, ...bodyOnlyLines].join("\n");
        }

        // Same isolated re-verification the standalone branch performs
        // below (own parseDocument/scanComplexBlocks call, never shared
        // mutable state) — proves the trailing member's OWN edited text
        // alone still forms one clean, fully-supported callout/blockquote
        // BEFORE it is ever composed with the list line and handed to
        // applyCompositeBlockEdit.
        const candidateDoc = parseDocument(trailingRawText);
        const candidateBlock = scanComplexBlocks(candidateDoc).blocks.find(
          (b) => b.kind === this.quoteProjection!.kind
        );
        const expectedEndLine = trailingRawText.split("\n").length - 1;
        const structurallyValid =
          !!candidateBlock &&
          candidateBlock.range.startLine === 0 &&
          candidateBlock.range.endLine === expectedEndLine &&
          candidateBlock.editability === "supported";
        if (!structurallyValid) {
          new Notice(this.plugin.t("partialEdit.quoteEditStructureInvalid"));
          return false;
        }

        // Phase 5D-2C: when the list member is being edited marker-free
        // (this.listMarkerProjection !== null), invert the list-member
        // input's CURRENT body back to its own raw line via the exact
        // same, UNMODIFIED edit/listMarkerProjection.ts machinery
        // loadCompositeInternal already used to build it — mirrors the
        // trailing member's own invert-then-reconstruct flow immediately
        // above. A raw-fallback list row (this.listMarkerProjection ===
        // null — an ordered/task-list marker, or a non-"single-line-list"
        // kind) is completely unaffected: compositeListInputEl.value
        // already holds the FULL raw line in that case, exactly like
        // Phase 5D-2B's own original, unmodified behavior.
        if (this.listMarkerProjection) {
          const invertedList = invertListMarkerProjection(
            this.listMarkerProjection,
            this.compositeListInputEl.value
          );
          if (!invertedList.ok) {
            // "multiline-body": the only reason — see
            // edit/listMarkerProjection.ts's own top doc comment for why
            // a single-line-list item can never accept a newline in its
            // marker-free body. A genuine safety error (the list line
            // cannot be safely reconstructed), not a grouping-rule
            // concern — Apply is refused and every draft (list body,
            // trailing member) is left exactly as the user had it.
            new Notice(this.plugin.t("partialEdit.listBodyNewlineUnsupported"));
            return false;
          }
          composedListLine = invertedList.rawLine;
        } else {
          composedListLine = this.compositeListInputEl.value;
        }
        composedTrailingText = trailingRawText;
        newCompositeText = composeCompositeBlockMemberText(composedListLine, composedTrailingText);
      } else {
        newCompositeText = this.textareaEl.value;
      }

      const outcome = applyCompositeBlockEdit(
        doc,
        this.compositeAnchor,
        this.originalText,
        newCompositeText,
        rules
      );
      if (!outcome.changed) {
        // Phase 5D-2A: mapped via compositePartialEditReasonText, not a
        // plain "reason." + outcome.reason concatenation — see that
        // function's own doc comment (edit/compositeBlockPartialEdit.ts)
        // for why "range-invalid"/"snapshot-mismatch"/"conflict" each need
        // this module's own dedicated, non-reused i18n key.
        new Notice(compositePartialEditReasonText(this.plugin.t.bind(this.plugin), outcome.reason));
        return false;
      }

      // Phase 5A-1 hardening §1: same self-Apply suppression span as the
      // paragraph branch above — see isApplyingOwnEdit's own doc comment.
      this.isApplyingOwnEdit = true;
      try {
        applyLineEditOutcome(
          editor,
          { line: outcome.newStartLine, ch: 0 },
          outcome.newStartLine,
          doc.lines,
          outcome,
          () => {}
        );

        // Phase 5D-2A: re-anchor from outcome.resolvedSnapshot — present
        // only when the just-applied text still forms a CompositeBlock
        // matching the ORIGINAL ruleId at the same position (see that
        // field's own doc comment on ApplyCompositeBlockEditOutcome). When
        // it does not (方針A: a structure-breaking edit was permitted
        // through), compositeAnchor becomes null and any FURTHER Apply from
        // this same pane session correctly falls through to the top guard's
        // "no node loaded" refusal, rather than silently operating against a
        // CompositeBlock that no longer exists.
        this.originalText = newCompositeText;
        this.compositeAnchor = outcome.resolvedSnapshot ?? null;
        // Phase 5D-2B: re-split/re-project this pane's own structured state
        // fresh from the just-applied pieces (never a re-parse — the
        // pieces are already known from composition above), exactly like
        // the standalone branch below rebuilds its own quoteProjection
        // after Apply — a SECOND Apply within the same pane session then
        // starts from a fully current basis. A raw-fallback session
        // (composedListLine/composedTrailingText both null) stays raw,
        // unaffected.
        if (composedListLine !== null && composedTrailingText !== null) {
          const kind = this.quoteProjection!.kind;
          const rebuilt = buildQuotePrefixProjection(composedTrailingText, kind);
          this.quoteProjection = rebuilt.ok ? rebuilt.projection : null;
          if (rebuilt.ok) {
            // Phase 5D-2C: re-project the just-applied list line
            // marker-free too, exactly like loadCompositeInternal/
            // performAutoReload's own re-projection — attempted fresh
            // regardless of whether marker-free projection was active
            // BEFORE this Apply (the composedListLine here is always a
            // complete, valid single raw line — see the invert call
            // above — so re-attempting costs nothing and lets a list line
            // that only just NOW became eligible, e.g. a raw-edited task
            // checkbox the user removed, pick up marker-free editing on
            // the very next round within this same pane session).
            const listRebuilt = buildListMarkerProjection(composedListLine);
            this.listMarkerProjection = listRebuilt.ok ? listRebuilt.projection : null;
            this.compositeListOriginalText = this.listMarkerProjection
              ? this.listMarkerProjection.body
              : composedListLine;
          } else {
            this.listMarkerProjection = null;
            this.compositeListOriginalText = null;
          }
        }
        // Phase 5A-1 hardening §1: see the paragraph branch's identical
        // comment above — explicitly synced right after this pane's own
        // re-anchoring, regardless of what syncState held before Apply.
        this.syncState = "synced";
        this.renderQuoteHeader();
        this.renderCompositeListSlot();
        this.textareaEl.value = this.currentDisplayText();
        this.updateDirtyState();
      } finally {
        this.isApplyingOwnEdit = false;
      }
      // See the paragraph branch's identical comment above.
      this.scheduleStaleCheck();

      const lineLen = editor.getLine(outcome.newStartLine)?.length ?? 0;
      editor.scrollIntoView(
        { from: { line: outcome.newStartLine, ch: 0 }, to: { line: outcome.newStartLine, ch: lineLen } },
        true
      );

      // Phase 5T-5A: same selection-follow as the paragraph/node branches.
      this.plugin.queueOutlineTreeSelectionFollow(outcome.newStartLine);

      // Phase 5D-2A: the exact, user-required Notice text fires only when
      // ruleStillMatches is explicitly false — never on double-Apply,
      // Markdown auto-correction, or any automatic blank-line/member
      // repositioning (applyCompositeBlockEdit never performs any of
      // those; ruleStillMatches is a pure, non-gating re-derivation of
      // what the user's OWN edit produced — see that field's own doc
      // comment).
      new Notice(
        outcome.ruleStillMatches === false
          ? this.plugin.t("partialEdit.compositeRuleNoLongerMatches")
          : this.plugin.t("partialEdit.compositeUpdated")
      );
      return true;
    }

    // Phase 5D-0.5: for a projecting callout/blockquote, the textarea
    // holds prefix-stripped display text — invert it back to raw Markdown
    // BEFORE handing anything to the raw-text splice call below (unmodified
    // by this ticket — it only ever knows about raw text). Every other
    // kind (quoteProjection === null) is untouched: newRawText is simply
    // whatever the textarea already held, exactly as before this ticket.
    //
    // Phase 5D-1.5 ("単独 Callout / Blockquote Partial Edit Pane の可変長
    // 本文編集"): invertQuotePrefixProjection itself now accepts an edit
    // that adds, removes, or splits/joins body lines — see that
    // function's own doc comment for the full reconstruction policy. The
    // only remaining refusal here is "blockquote-empty" (the body was
    // fully cleared, and a blockquote — unlike a callout — has no header
    // to fall back to), with its own dedicated Notice; it never reaches
    // the splice call below, and no partial/best-effort splice is
    // attempted.
    let newRawText = this.textareaEl.value;
    // Phase 5L-9b ("First Direct Child Addition for Leaf List Items —
    // Mode B"): a pending "promote this leaf to a parent" draft is
    // present — checked BEFORE every other branch in this whole
    // if/else-if chain, since none of them know how to also insert a
    // brand-new first child (they only ever know how to write back the
    // leaf's OWN body). Routed through its own dedicated method (never
    // reusing `newRawText`/the generic outcome+applyLineEditOutcome tail
    // below — see applyLeafFirstChildEdit's own doc comment for why it
    // needs its own post-Apply full reload instead of that tail's own
    // narrower rebuild).
    if (this.pendingLeafFirstChild) {
      return this.applyLeafFirstChildEdit(doc, editor);
    } else if (this.quoteProjection) {
      const inverted = invertQuotePrefixProjection(this.quoteProjection, this.textareaEl.value);
      if (!inverted.ok) {
        new Notice(this.plugin.t("partialEdit.quoteBodyEmptyUnsupported"));
        return false;
      }
      newRawText = inverted.rawText;

      // Phase 5D-1A: when this callout's title was successfully split out
      // (titleSlot non-null), reconstruct its header from the title
      // input's CURRENT value (and, Phase 5D-1B, the fold-marker select's
      // CURRENT value) and splice it in as the new first line —
      // `inverted.rawText` above already reattached the OLD, unedited
      // header verbatim (invertQuotePrefixProjection itself is untouched
      // by this ticket), so this replaces exactly that one line, ONE
      // combined type+marker+title reconstruction, ONE splice — never
      // multiple separate rewrites. A validation failure on any of the
      // three refuses the WHOLE Apply here, before the raw-text splice
      // call below is ever reached — any body edit already computed
      // above is discarded along with it, matching the
      // quoteLineCountChanged refusal's own "reject the whole thing,
      // zero-byte-change" contract.
      // Blockquote/non-title-editable callouts (titleSlot null) leave
      // newRawText exactly as invertQuotePrefixProjection produced it,
      // unchanged from pre-5D-1A behavior.
      const titleSlot = this.quoteProjection.titleSlot;
      if (titleSlot) {
        // Phase 5D-1C: quoteTypeInputEl is free text — unlike
        // quoteMarkerSelectEl's closed-set <select> below, a user CAN
        // reach reconstructQuoteHeader's "invalid-type" refusal through
        // completely ordinary typing/pasting (clearing the field, or
        // pasting a string containing "]" or a line break), so this is a
        // real, user-facing failure mode — see the Notice branch below.
        const newType = this.quoteTypeInputEl.value;
        // Phase 5D-1B: quoteMarkerSelectEl is a closed-set <select> whose
        // only possible values are "", "+", "-" (see that field's own
        // doc comment) — this cast reflects that DOM-level guarantee.
        // reconstructQuoteHeader still runtime-guards against anything
        // else reaching it (e.g. via out-of-band DOM manipulation) and
        // returns reason "invalid-marker" rather than throwing; since
        // that path is unreachable through this view's own UI, it is
        // handled as a silent, safe no-op below rather than a new
        // user-facing Notice (no Notice text would accurately describe a
        // state the UI itself can never produce).
        const newMarker = this.quoteMarkerSelectEl.value as CalloutFoldMarker;
        const reconstructed = reconstructQuoteHeader(
          titleSlot,
          newType,
          newMarker,
          this.quoteTitleInputEl.value
        );
        if (!reconstructed.ok) {
          if (reconstructed.reason === "newline") {
            new Notice(this.plugin.t("partialEdit.quoteTitleNewlineUnsupported"));
          } else if (reconstructed.reason === "invalid-type") {
            new Notice(this.plugin.t("partialEdit.quoteTypeInvalidUnsupported"));
          }
          return false;
        }
        const bodyOnlyLines = newRawText.split("\n").slice(1);
        newRawText = [reconstructed.header, ...bodyOnlyLines].join("\n");
      }

      // Phase 5D-1.5, step 6 of the approved implementation plan: a
      // variable-length body edit has no per-line positional guarantee
      // left (see invertQuotePrefixProjection's own doc comment), so
      // before this candidate ever reaches applySubtreeEdit below, re-
      // verify it against the CURRENT parser/scanner — in ISOLATION
      // (parsed on its own, never spliced into the live document; this
      // only needs to know whether the candidate itself still forms one
      // clean, fully-supported block of the expected kind, never
      // anything about surrounding content, so there is no need to
      // resolve the real document-level range first). This is the safety
      // net for cases invertQuotePrefixProjection's own simpler "nested"
      // check does not fully cover — e.g. edited body content that itself
      // looks like a callout header (`[!type]`) once re-prefixed with
      // `>`, which parser/complexBlocks.ts's own hasEmbeddedCalloutMarker
      // detection downgrades a run's editability for. A same-line-count
      // edit (unchanged from before this ticket) is included here too,
      // for defense-in-depth — it should always already validate cleanly,
      // since it only ever reuses prefixes that were already valid.
      const candidateDoc = parseDocument(newRawText);
      const candidateBlock = scanComplexBlocks(candidateDoc).blocks.find(
        (b) => b.kind === this.quoteProjection!.kind
      );
      const expectedEndLine = newRawText.split("\n").length - 1;
      const structurallyValid =
        !!candidateBlock &&
        candidateBlock.range.startLine === 0 &&
        candidateBlock.range.endLine === expectedEndLine &&
        candidateBlock.editability === "supported";
      if (!structurallyValid) {
        new Notice(this.plugin.t("partialEdit.quoteEditStructureInvalid"));
        return false;
      }
    } else if (this.standaloneListMarkerProjection) {
      // Phase 5L-1: analogous to the CompositeBlock list-member inversion
      // in this method's compositeAnchor branch above — reuses the exact
      // same, unmodified edit/listMarkerProjection.ts machinery, and (per
      // this ticket's own explicit requirement) writes back through this
      // SAME applySubtreeEdit call below — no new Markdown write-back
      // path. Mutually exclusive with the quoteProjection branch above: a
      // node is never both a callout/blockquote and a list.
      // "multiline-body" is the ONLY refusal reason
      // invertListMarkerProjection can return — a genuine safety error
      // (the raw line cannot be safely reconstructed), refused here
      // BEFORE applySubtreeEdit is ever called, with every draft left
      // exactly as the user had it — same Notice text/key the
      // CompositeBlock branch already uses for the identical failure.
      const invertedList = invertListMarkerProjection(
        this.standaloneListMarkerProjection,
        this.textareaEl.value
      );
      if (!invertedList.ok) {
        new Notice(this.plugin.t("partialEdit.listBodyNewlineUnsupported"));
        return false;
      }
      newRawText = invertedList.rawLine;
    } else if (this.standaloneTaskListProjection) {
      // Phase 5L-2: analogous to the standaloneListMarkerProjection
      // branch immediately above — reuses the exact same, unmodified
      // edit/taskListProjection.ts machinery, and (per this ticket's own
      // explicit requirement) writes back through this SAME
      // applySubtreeEdit call below — no new Markdown write-back path.
      // Mutually exclusive with both branches above: a node is never
      // both a callout/blockquote and a list, and never both a
      // non-task-list and a task-list item at once (see
      // buildStandaloneListProjections's own doc comment).
      // "multiline-body" is the ONLY refusal reason
      // invertTaskListProjection can return — a genuine safety error
      // (the raw line cannot be safely reconstructed), refused here
      // BEFORE applySubtreeEdit is ever called, with every draft
      // (checkbox state AND body) left exactly as the user had it.
      const invertedTask = invertTaskListProjection(
        this.standaloneTaskListProjection,
        this.taskCheckboxInputEl.checked,
        this.textareaEl.value
      );
      if (!invertedTask.ok) {
        new Notice(this.plugin.t("partialEdit.taskBodyNewlineUnsupported"));
        return false;
      }
      newRawText = invertedTask.rawLine;
    } else if (this.standaloneOrderedListProjection) {
      // Phase 5L-3: analogous to the standaloneTaskListProjection branch
      // immediately above — reuses the exact same, unmodified
      // edit/orderedListProjection.ts machinery, and (per this ticket's
      // own explicit requirement) writes back through this SAME
      // applySubtreeEdit call below — no new Markdown write-back path.
      // Mutually exclusive with every branch above (see
      // buildStandaloneListProjections's own doc comment). Two distinct
      // refusal reasons here, each refused BEFORE applySubtreeEdit is
      // ever called, with every draft (number text AND body) left
      // exactly as the user had it: "multiline-body" (the raw line
      // cannot be safely reconstructed — a genuine safety error, same
      // class as the sibling branches above) and "invalid-number" (the
      // number input's current text fails
      // isValidOrderedListNumberText — see
      // edit/orderedListProjection.ts's own top doc comment's "The
      // number field" section for the exhaustive rejection-case
      // rationale). The delimiter itself is NEVER passed here — see that
      // module's own top doc comment for why it can never be edited this
      // phase.
      const invertedOrdered = invertOrderedListProjection(
        this.standaloneOrderedListProjection,
        this.orderedNumberInputEl.value,
        this.textareaEl.value
      );
      if (!invertedOrdered.ok) {
        new Notice(
          this.plugin.t(
            invertedOrdered.reason === "invalid-number"
              ? "partialEdit.orderedNumberInvalid"
              : "partialEdit.orderedBodyNewlineUnsupported"
          )
        );
        return false;
      }
      newRawText = invertedOrdered.rawLine;
    } else if (this.standaloneMultiLineListProjection) {
      // Phase 5L-4: analogous to the three single-line branches above —
      // reuses edit/multiLineListItemProjection.ts's own
      // invertMultiLineListItemProjection, and (per this ticket's own
      // explicit requirement — design doc §4) writes back through this
      // SAME applySubtreeEdit call below, no new Markdown write-back
      // path. Mutually exclusive with every branch above (see
      // loadNodeInternal's own doc comment). checked/number are ALWAYS
      // passed, regardless of this projection's own listKind — the
      // callee itself ignores whichever of the two does not apply (see
      // that function's own doc comment), mirroring how
      // taskCheckboxInputEl/orderedNumberInputEl are themselves always
      // present, just conditionally visible, for the single-line case.
      // "invalid-number" mirrors the standaloneOrderedListProjection
      // branch's own identical refusal above; "unsafe-structure" is this
      // module's own addition — a freshly reconstructed candidate that
      // would introduce a nested child list item, or a callout/
      // blockquote/fenced-code/table/thematic-break block, once
      // canonically re-indented and re-parsed (see
      // edit/multiLineListItemProjection.ts's own top doc comment and
      // its validateMultiLineListItemCandidate's own doc comment for the
      // exhaustive check list). Either way, every draft (checkbox/number
      // control AND the full multi-line body) is left exactly as the
      // user had it — no partial write of any kind.
      const invertedMultiLine = invertMultiLineListItemProjection(
        this.standaloneMultiLineListProjection,
        this.taskCheckboxInputEl.checked,
        this.orderedNumberInputEl.value,
        this.textareaEl.value
      );
      if (!invertedMultiLine.ok) {
        new Notice(
          this.plugin.t(
            invertedMultiLine.reason === "invalid-number"
              ? "partialEdit.orderedNumberInvalid"
              : "partialEdit.multiLineListStructureInvalid"
          )
        );
        return false;
      }
      newRawText = invertedMultiLine.rawText;
    } else if (this.standaloneParentListItemProjection && this.childAddDeleteSession?.pendingIndentOutdent) {
      // Phase 5L-11 ("Direct Child Leaf Indent/Outdent in Parent Partial
      // Edit Pane"): a pending indent/outdent is present — checked
      // BEFORE the hasAddDeleteActivity() branch immediately below
      // (hasAddDeleteActivity() itself now ALSO returns true whenever a
      // pending indent/outdent is set, purely so isDirty()/
      // updateDirtyState keep showing Apply/Cancel — see that method's
      // own doc comment), since applyParentChildAddDeleteCombinedEdit
      // has no idea how to write an indent/outdent transformation. A
      // pending indent/outdent NEVER coexists with a pending add/delete/
      // reorder/open-existing-child-editor by construction (§6's own
      // composition scope — see handleRequestIndentChild's/
      // handleRequestOutdentChild's own doc comments for where that is
      // enforced), so this dedicated method only ever needs to also
      // consider the parent's own own-text draft.
      return this.applyParentChildIndentOutdentEdit(doc, editor);
    } else if (this.standaloneParentListItemProjection && this.hasAddDeleteActivity()) {
      // Phase 5L-9 ("Direct Child Add/Delete in Parent Partial Edit Pane"):
      // a pending new-child draft and/or a pending deletion mark is
      // present — checked BEFORE the plain childInlineSession-only branch
      // immediately below (a pending add/delete may coexist with an open
      // existing-child editor too), routed through this ticket's own
      // generalized combined-apply method instead of either the
      // single-range parent-only path or 5L-8's own fixed-two-range path.
      return this.applyParentChildAddDeleteCombinedEdit(doc, editor);
    } else if (this.standaloneParentListItemProjection && this.childInlineSession) {
      // Phase 5L-8 ("Child Item Inline Structured Editing in Parent
      // Partial Edit Pane"): a child inline session is active — the
      // parent's own-text draft and the selected child's own-text draft
      // are saved TOGETHER by this ONE Apply action, as exactly one
      // atomic document mutation (never the single-range
      // standaloneParentListItemProjection path immediately below, which
      // knows nothing about a second, simultaneously-edited range).
      // applyParentChildCombinedEdit owns this entire flow end to end
      // (invert+validate, live write, editor mutation, state rebuild,
      // Notice) and returns applyEdit()'s own boolean result directly —
      // see that method's own doc comment.
      return this.applyParentChildCombinedEdit(doc, editor);
    } else if (this.standaloneParentListItemProjection) {
      // Phase 5L-6 ("Parent List Item Structured Partial Edit"): analogous
      // to the standaloneMultiLineListProjection branch immediately above,
      // but reuses edit/parentListItemProjection.ts's own
      // invertParentListItemProjection instead — see that module's own top
      // doc comment for the two-stage safety design (own-text-alone
      // re-parse, THEN own-text-spliced-with-the-ORIGINAL-child-subtree-
      // snapshot re-parse). Unlike every branch above, the generic
      // applySubtreeEdit call immediately below this whole if/else-if
      // chain is NOT used for this kind — see the outcome computation
      // immediately below for why (applySubtreeEdit's own whole-subtree
      // conflict check would spuriously refuse this Apply the moment the
      // CHILD subtree alone changes, which this ticket's own approved
      // scope explicitly forbids). checked/number are ALWAYS passed,
      // regardless of this projection's own ownText.listKind, mirroring
      // the standaloneMultiLineListProjection branch's own identical
      // convention. Every draft (checkbox/number control AND the own-text
      // body) is left exactly as the user had it on any refusal — no
      // partial write of any kind, and the child preview is never
      // re-serialized either way.
      const invertedParent = invertParentListItemProjection(
        this.standaloneParentListItemProjection,
        this.taskCheckboxInputEl.checked,
        this.orderedNumberInputEl.value,
        this.textareaEl.value
      );
      if (!invertedParent.ok) {
        new Notice(
          this.plugin.t(
            invertedParent.reason === "invalid-number"
              ? "partialEdit.orderedNumberInvalid"
              : invertedParent.reason === "own-text-unsafe-structure"
                ? "partialEdit.parentOwnTextStructureInvalid"
                : "partialEdit.parentChildSubtreeStructureInvalid"
          )
        );
        return false;
      }
      newRawText = invertedParent.ownTextRawText;
    }

    // Phase 5L-6: the parent kind deliberately does NOT go through the
    // generic applySubtreeEdit below — see the standaloneParentListItemProjection
    // branch's own comment immediately above for why. Both outcome shapes
    // expose the same `{changed, lines, newStartLine, reason?}` fields the
    // shared tail below already only ever reads, so no further branching
    // is needed past this point.
    const outcome = this.standaloneParentListItemProjection
      ? applyParentListItemOwnTextEdit(
          doc,
          this.nodeId!,
          this.standaloneParentListItemProjection.ownText.rawText,
          newRawText
        )
      : applySubtreeEdit(doc, this.nodeId!, this.originalText, newRawText);
    const node = doc.nodes.get(this.nodeId!);
    const startLine = node ? node.range.startLine : 0;

    if (!outcome.changed) {
      const reasonKey = ("reason." + (outcome.reason ?? "resolve-failed")) as TranslationKey;
      new Notice(this.plugin.t(reasonKey));
      return false;
    }

    // Phase 5A-1 hardening §1: same self-Apply suppression span as the
    // paragraph/composite branches above — see isApplyingOwnEdit's own
    // doc comment. outcome.changed is already true here, so
    // applyLineEditOutcome's own no-op branch never fires — the notify
    // callback is unreachable, but required by its signature.
    this.isApplyingOwnEdit = true;
    try {
      applyLineEditOutcome(
        editor,
        { line: startLine, ch: 0 },
        startLine,
        doc.lines,
        outcome,
        () => {}
      );

      // Phase 5D-0.5: originalText re-anchors to the RECONSTRUCTED raw text
      // (never the textarea's own, possibly prefix-stripped, value) — for
      // every non-projecting kind newRawText === this.textareaEl.value
      // already, so this is byte-identical to the pre-5D-0.5 behavior there.
      //
      // Phase 5L-6: for the parent kind, `newRawText` holds ONLY the
      // just-applied own-text candidate (never the child subtree — see the
      // standaloneParentListItemProjection branch above) — originalText
      // must still hold the FULL subtree snapshot (own-text + every
      // descendant line), exactly like every other kind, since that is
      // what extractSubtreeText/resolveCurrentTarget's own whole-subtree
      // staleness comparison (unchanged by this ticket — see
      // edit/parentListItemProjection.ts's own top doc comment for why
      // narrowing THAT shared mechanism is deliberately out of scope) keeps
      // comparing against. `this.standaloneParentListItemProjection` here
      // still refers to the PRE-apply projection (the rebuild below hasn't
      // run yet), so its own `childSubtreeText` is exactly the unchanged
      // child-subtree snapshot to reattach.
      this.originalText = newRawText;
      if (this.standaloneParentListItemProjection) {
        // Phase 5L-6: override the re-anchor above — `newRawText` here holds
        // ONLY the just-applied own-text candidate (never the child
        // subtree), but originalText must still hold the FULL subtree
        // snapshot (own-text + every descendant line), exactly like every
        // other kind, since that is what extractSubtreeText/
        // resolveCurrentTarget's own whole-subtree staleness comparison
        // (unchanged by this ticket — see edit/parentListItemProjection.ts's
        // own top doc comment for why narrowing THAT shared mechanism is
        // deliberately out of scope) keeps comparing against.
        // `this.standaloneParentListItemProjection` here still refers to the
        // PRE-apply projection (the rebuild below hasn't run yet), so its
        // own `childSubtreeText` is exactly the unchanged child-subtree
        // snapshot to reattach.
        this.originalText = newRawText + "\n" + this.standaloneParentListItemProjection.childSubtreeText;
      }
      if (this.quoteProjection) {
        // Rebuild the projection/line-mapping fresh from the just-applied
        // raw text, rather than trusting the pre-apply projection's now
        // possibly-stale prefixes — this is what guarantees a SECOND Apply
        // in the same pane session starts from a fully current basis (see
        // the class doc comment's originalText/quoteProjection contract).
        // A rebuild can fail here ONLY with reason "nested" — never
        // "no-body" (line count, and therefore body-line count, cannot
        // change on this path; see invertQuotePrefixProjection) — if the
        // user's own edited content happened to introduce a literal leading
        // `>` into a line (typed, not structural). That is not a data-loss
        // risk (the Apply above already succeeded and the note already
        // holds newRawText); this pane simply, safely degrades to showing
        // that node raw from here on, exactly like the "no-body" fallback
        // already does for a header-only callout.
        // Phase 5D-1A: the freshly rebuilt projection's own `titleSlot` is
        // recomputed from `newRawText`'s new header line (which already
        // reflects any title edit just applied above), so calling
        // renderQuoteHeader() right below also re-syncs quoteTitleInputEl
        // to the just-applied title — no separate title re-sync needed
        // here.
        const kind = this.quoteProjection.kind;
        const rebuilt = buildQuotePrefixProjection(newRawText, kind);
        this.quoteProjection = rebuilt.ok ? rebuilt.projection : null;
        this.renderQuoteHeader();
        // Keep the textarea itself in sync with whatever currentDisplayText()
        // now resolves to (projected again, or raw on the rare degrade
        // above) — normally a no-op, since projecting the just-reconstructed
        // raw text back should reproduce exactly what the textarea already
        // shows.
        this.textareaEl.value = this.currentDisplayText();
      } else if (this.standaloneListMarkerProjection) {
        // Phase 5L-1: rebuild fresh from the just-applied raw line, same
        // rationale as the quoteProjection rebuild immediately above — a
        // second Apply within the same pane session then starts from a
        // fully current basis. newRawText here is always exactly one
        // line (invertListMarkerProjection above guarantees no embedded
        // newline), so this can only ever fail via
        // buildListMarkerProjection's own "ordered-marker"/
        // "task-list-marker" refusals — unreachable in practice here,
        // since neither the marker (untouched by this Apply path; see
        // this method's own top-level requirement that marker changes
        // have no UI) nor task-list-checkbox syntax (an untouched body
        // prefix) can change as a RESULT of this edit — but handled the
        // same safe way regardless: degrade to showing the raw line from
        // here on, exactly like a rebuild failure already does for the
        // quoteProjection branch above.
        const rebuilt = buildListMarkerProjection(newRawText);
        this.standaloneListMarkerProjection = rebuilt.ok ? rebuilt.projection : null;
        this.textareaEl.value = this.currentDisplayText();
      } else if (this.standaloneTaskListProjection) {
        // Phase 5L-2: rebuild fresh from the just-applied raw line, same
        // rationale as the standaloneListMarkerProjection rebuild
        // immediately above — a second Apply within the same pane
        // session then starts from a fully current basis. newRawText
        // here is always exactly one line (invertTaskListProjection
        // above guarantees no embedded newline), so this can only ever
        // fail via buildTaskListProjection's own refusals — unreachable
        // in practice here for the same reasons the standalone list
        // branch's own comment above gives — but handled the same safe
        // way regardless: degrade to showing the raw line from here on.
        const rebuilt = buildTaskListProjection(newRawText);
        this.standaloneTaskListProjection = rebuilt.ok ? rebuilt.projection : null;
        this.textareaEl.value = this.currentDisplayText();
        this.renderTaskCheckboxRow();
      } else if (this.standaloneOrderedListProjection) {
        // Phase 5L-3: rebuild fresh from the just-applied raw line, same
        // rationale as the standaloneTaskListProjection rebuild
        // immediately above — a second Apply within the same pane
        // session then starts from a fully current basis. newRawText
        // here is always exactly one line (invertOrderedListProjection
        // above guarantees no embedded newline), and its number text
        // already passed isValidOrderedListNumberText, so this can only
        // ever fail via buildOrderedListProjection's own refusals —
        // unreachable in practice here for the same reasons the sibling
        // branches' own comments above give — but handled the same safe
        // way regardless: degrade to showing the raw line from here on.
        const rebuilt = buildOrderedListProjection(newRawText);
        this.standaloneOrderedListProjection = rebuilt.ok ? rebuilt.projection : null;
        this.textareaEl.value = this.currentDisplayText();
        this.renderOrderedNumberRow();
      } else if (this.standaloneMultiLineListProjection) {
        // Phase 5L-4: rebuild fresh from the just-applied raw text, same
        // rationale as the sibling rebuilds above — a second Apply within
        // the same pane session then starts from a fully current basis.
        // newRawText here already passed
        // validateMultiLineListItemCandidate (invertMultiLineListItemProjection
        // above never returns ok:true otherwise), so this can only ever
        // fail via buildMultiLineListItemProjection's own "single-line"
        // refusal — genuinely reachable here (the user may have deleted
        // every continuation line, collapsing the item to one line) —
        // handled the same safe way regardless: degrade to showing the
        // raw (now single-line) text from here on, via originalText;
        // this pane does NOT retroactively switch to a single-line
        // projection here (loadNodeInternal's own three-single-line
        // attempt only ever runs at LOAD time, not mid-session), matching
        // every sibling rebuild's own "degrade to raw, never silently
        // upgrade/downgrade to a different projection kind" contract.
        const rebuilt = buildMultiLineListItemProjection(newRawText);
        this.standaloneMultiLineListProjection = rebuilt.ok ? rebuilt.projection : null;
        this.textareaEl.value = this.currentDisplayText();
        this.renderTaskCheckboxRow();
        this.renderOrderedNumberRow();
      } else if (this.standaloneParentListItemProjection) {
        // Phase 5L-6: rebuild fresh from the just-applied, now-live editor
        // content — unlike every sibling rebuild above (which operate on
        // just `newRawText`, an already-isolated raw-text substring), this
        // needs a freshly re-parsed ParsedDocument to re-resolve the
        // own-text/child-subtree ranges via
        // resolveParentListItemOwnTextRange again (that function needs
        // `doc`/`node`, not raw text alone) — mirroring
        // loadNodeInternal/performAutoReload's own identical
        // re-derive-fresh-from-`doc` convention. A rebuild failure here
        // (e.g. the user's own edit collapsed the item's own-text in a way
        // that no longer resolves) degrades to showing the raw
        // FULL-SUBTREE text from here on, via originalText — the same
        // "degrade to raw, never silently upgrade/downgrade to a
        // different projection kind" contract every sibling rebuild above
        // already carries.
        // Phase 5L-12: rebuild via the single shared
        // reconcileStandaloneNodeState instead of this branch's own
        // narrow "only ever re-verify standaloneParentListItemProjection,
        // never discover a leaf projection" rebuild — see that method's
        // own doc comment. This own-text-only Apply path can never
        // actually change childIds.length (it never touches the child
        // subtree at all), so in practice this remains exactly
        // equivalent to the prior narrow rebuild; the only change is
        // that it is no longer a fourth independent copy of the same
        // eligibility-check/builder-call sequence.
        const freshDoc = parseDocument(editor.getValue());
        const freshNode = freshDoc.nodes.get(this.nodeId!);
        const freshExtracted = extractSubtreeText(freshDoc, this.nodeId!);
        this.reconcileStandaloneNodeState(
          freshDoc,
          this.nodeId!,
          freshNode,
          freshExtracted.ok ? freshExtracted.text : ""
        );
        this.textareaEl.value = this.currentDisplayText();
        this.renderTaskCheckboxRow();
        this.renderOrderedNumberRow();
        this.renderParentChildPreview();
      }
      // Phase 5A-1 hardening §1: see the paragraph branch's identical
      // comment above — explicitly synced right after this pane's own
      // re-anchoring, regardless of what syncState held before Apply.
      this.syncState = "synced";
      this.updateDirtyState();
    } finally {
      this.isApplyingOwnEdit = false;
    }
    // See the paragraph branch's identical comment above.
    this.scheduleStaleCheck();

    const lineLen = editor.getLine(outcome.newStartLine)?.length ?? 0;
    editor.scrollIntoView(
      { from: { line: outcome.newStartLine, ch: 0 }, to: { line: outcome.newStartLine, ch: lineLen } },
      true
    );

    // Phase 5T-5A: same selection-follow as the paragraph branch above,
    // for symmetry — a section/list subtree edit doesn't relocate the
    // node's own start line (applySubtreeEdit never moves content, only
    // rewrites it in place), so this is a low-risk, mostly-defensive
    // addition rather than the primary fix this ticket targets.
    this.plugin.queueOutlineTreeSelectionFollow(outcome.newStartLine);

    new Notice(
      this.nodeKind === "list"
        ? this.plugin.t("partialEdit.listSubtreeUpdated")
        : this.plugin.t("partialEdit.sectionUpdated")
    );
    return true;
  }

  /**
   * Phase 5L-8 ("Child Item Inline Structured Editing in Parent Partial
   * Edit Pane"): the ONE place a combined parent-own-text + selected-
   * child-own-text Apply is ever performed — called ONLY from applyEdit's
   * own `standaloneParentListItemProjection && childInlineSession` branch,
   * which returns this method's own result directly. Implements this
   * ticket's own §7 twelve-step Apply procedure on top of
   * edit/parentChildInlineEditSession.ts's own pure
   * invertAndValidateParentChildCombinedEdit (steps 1–9, operating on
   * snapshots) and applyParentChildInlineEditToDocument (steps 1–3, 6–7,
   * 10 again, operating on the LIVE document, as ONE atomic `lines` array
   * — see that function's own doc comment for why a partial write is
   * structurally impossible). On ANY failure at either stage, this method
   * returns `false` having shown a Notice and touched NEITHER the document
   * NOR any draft field (step 11) — the shared `isApplyingOwnEdit`
   * suppression span, `scheduleStaleCheck`, `scrollIntoView`, and
   * selection-follow calls below all mirror applyEdit's own existing
   * single-range branches exactly, so this pane's stale-detection/
   * cursor-follow behavior stays consistent regardless of which Apply path
   * actually ran.
   */
  private applyParentChildCombinedEdit(doc: ParsedDocument, editor: Editor): boolean {
    const projection = this.standaloneParentListItemProjection;
    const session = this.childInlineSession;
    if (!projection || !session || !this.nodeId) {
      new Notice(this.plugin.t("partialEdit.parentChildInlineEditFailed"));
      return false;
    }

    const parentDirty = this.textareaEl.value !== projectedParentBodyText(projection) ||
      (projection.ownText.listKind === "task" &&
        this.taskCheckboxInputEl.checked !== projectedParentChecked(projection)) ||
      (projection.ownText.listKind === "ordered" &&
        this.orderedNumberInputEl.value !== projectedParentNumberText(projection));
    const childDirty = this.isChildInlineDraftDirty();
    if (!parentDirty && !childDirty) {
      // Defensive only — Apply is only reachable while isDirty() (which
      // already folds in childInlineDirty) is true.
      return false;
    }

    // §7 steps 4–9: reconstruct both candidates from their ORIGINAL
    // snapshots plus whichever controls are dirty, and validate the
    // combined result — entirely off the live document.
    const combined = invertAndValidateParentChildCombinedEdit({
      parentProjection: projection,
      session,
      parentDirty,
      childDirty,
      editedParentChecked: this.taskCheckboxInputEl.checked,
      editedParentNumberText: this.orderedNumberInputEl.value,
      editedParentBody: this.textareaEl.value,
      editedChildChecked: this.childInlineTaskCheckboxInputEl.checked,
      editedChildNumberText: this.childInlineOrderedNumberInputEl.value,
      editedChildBody: this.childInlineTextareaEl.value,
    });
    if (!combined.ok) {
      new Notice(this.plugin.t(parentChildCombinedApplyReasonKey(combined.reason)));
      return false;
    }

    // §7 steps 1–3, 6–7, 10: re-resolve fresh against the CURRENT
    // document, re-check for an external conflict on whichever range is
    // dirty, and build the ONE atomic replacement.
    const liveOutcome = applyParentChildInlineEditToDocument(
      doc,
      this.nodeId,
      session.childNodeId,
      parentDirty,
      childDirty,
      projection.ownText.rawText,
      session.originalChildRawText,
      combined.parentOwnTextRawText,
      combined.childRawText
    );
    if (!liveOutcome.changed) {
      new Notice(this.plugin.t(parentChildLiveApplyReasonKey(liveOutcome.reason)));
      return false;
    }

    // §7 step 11 is satisfied by construction above (every failure
    // returned before this point, with `doc`/every draft untouched); from
    // here on this mirrors applyEdit's own existing branches' own
    // isApplyingOwnEdit-guarded mutation + rebuild sequence.
    this.isApplyingOwnEdit = true;
    try {
      applyLineEditOutcome(
        editor,
        { line: liveOutcome.parentNewStartLine, ch: 0 },
        liveOutcome.parentNewStartLine,
        doc.lines,
        { changed: true, lines: liveOutcome.lines, newStartLine: liveOutcome.parentNewStartLine },
        () => {}
      );

      // §7 step 12: re-open the session fresh against the just-saved
      // document — re-derive originalText (the FULL parent subtree
      // snapshot, own-text + entire child subtree, exactly like the
      // single-range parent branch already does), rebuild the parent
      // projection, the child preview list, and the selected-child
      // projection/session, all from a fresh parse of the now-live editor
      // content.
      // Phase 5L-12: rebuild via the single shared
      // reconcileStandaloneNodeState — see that method's own doc
      // comment. This Apply path edits an EXISTING child's own text
      // only (never adds/removes a child), so childIds.length cannot
      // actually change here; this remains exactly equivalent to the
      // prior narrow rebuild (parent projection + childAddDeleteSession
      // re-derived, childInlineSession reset to null), now via the same
      // shared implementation every other rebuild site in this class
      // uses instead of its own copy.
      const freshDoc = parseDocument(editor.getValue());
      const freshParentNode = freshDoc.nodes.get(this.nodeId);
      const freshExtracted = extractSubtreeText(freshDoc, this.nodeId);
      if (freshExtracted.ok) {
        this.originalText = freshExtracted.text;
      }
      this.reconcileStandaloneNodeState(
        freshDoc,
        this.nodeId,
        freshParentNode,
        freshExtracted.ok ? freshExtracted.text : ""
      );
      if (freshParentNode && isListNode(freshParentNode) && this.standaloneParentListItemProjection) {
        const rebuiltSession = buildParentChildInlineEditSession(
          freshDoc,
          freshParentNode,
          this.standaloneParentListItemProjection,
          session.childNodeId
        );
        if (rebuiltSession.ok) {
          this.childInlineSession = rebuiltSession.session;
        }
        // A failed rebuild (should be unreachable — liveOutcome.changed
        // already confirmed both the parent and the child structurally,
        // moments ago) simply closes the child inline editor, degrading
        // to the plain read-only preview — the same safe "degrade, never
        // guess" contract every sibling rebuild in this class already
        // carries.
      }
      this.textareaEl.value = this.currentDisplayText();
      this.renderTaskCheckboxRow();
      this.renderOrderedNumberRow();
      this.renderParentChildPreview();
      this.syncState = "synced";
      this.updateDirtyState();
    } finally {
      this.isApplyingOwnEdit = false;
    }
    this.scheduleStaleCheck();

    const lineLen = editor.getLine(liveOutcome.parentNewStartLine)?.length ?? 0;
    editor.scrollIntoView(
      {
        from: { line: liveOutcome.parentNewStartLine, ch: 0 },
        to: { line: liveOutcome.parentNewStartLine, ch: lineLen },
      },
      true
    );
    this.plugin.queueOutlineTreeSelectionFollow(liveOutcome.parentNewStartLine);
    new Notice(this.plugin.t("partialEdit.parentChildInlineEditApplied"));
    return true;
  }

  /**
   * Phase 5L-9 ("Direct Child Add/Delete in Parent Partial Edit Pane"):
   * the ONE place a combined parent-own-text + existing-selected-child +
   * new-child-insertion + pending-deletion Apply is ever performed —
   * called ONLY from applyEdit's own `hasAddDeleteActivity()` branch,
   * which returns this method's own result directly. Generalizes
   * applyParentChildCombinedEdit immediately above (Phase 5L-8's own
   * fixed-two-range case) to this ticket's own variable-length plan — see
   * edit/parentChildInlineEditSession.ts's own Phase 5L-9 section for the
   * full invert/validate/write design this method is a thin UI-layer
   * wrapper around. On ANY failure at either stage, this method returns
   * `false` having shown a Notice and touched NEITHER the document NOR
   * any draft (parent/existing-child/new-child/pending-deletion) at all.
   */
  private applyParentChildAddDeleteCombinedEdit(doc: ParsedDocument, editor: Editor): boolean {
    const projection = this.standaloneParentListItemProjection;
    const addDeleteSession = this.childAddDeleteSession;
    if (!projection || !addDeleteSession || !this.nodeId) {
      new Notice(this.plugin.t("partialEdit.parentChildAddChildFailed"));
      return false;
    }
    const existingChildSession = this.childInlineSession;

    const parentDirty =
      this.textareaEl.value !== projectedParentBodyText(projection) ||
      (projection.ownText.listKind === "task" &&
        this.taskCheckboxInputEl.checked !== projectedParentChecked(projection)) ||
      (projection.ownText.listKind === "ordered" &&
        this.orderedNumberInputEl.value !== projectedParentNumberText(projection));
    const existingChildDirty = this.isChildInlineDraftDirty();
    const newChildDirty = this.isNewChildDraftDirty();
    const hasDeletion = !!addDeleteSession.pendingDeletion;
    const hasNewChild = !!addDeleteSession.newChildDraft;
    // Phase 5L-10 ("Direct Child Leaf Reorder in Parent Partial Edit
    // Pane"): shared with hasAddDeleteActivity() — see that method's own
    // doc comment for the "net-no-op is not dirty" contract.
    const reorderDirty = isPendingReorderDirty(addDeleteSession);

    if (!parentDirty && !existingChildDirty && !hasDeletion && !hasNewChild && !reorderDirty) {
      // Defensive only — this method is only ever reached while
      // hasAddDeleteActivity() (hasNewChild || hasDeletion ||
      // reorderDirty) is true.
      return false;
    }

    // §7 steps 4–9: reconstruct every candidate that is actually present
    // from its own ORIGINAL snapshot plus whichever controls are dirty,
    // and validate the combined result — entirely off snapshots, never
    // the live document.
    const combined = invertAndValidateParentChildAddDeleteEdit({
      parentProjection: projection,
      addDeleteSession,
      existingChildSession,
      parentDirty,
      existingChildDirty,
      newChildDirty,
      reorderDirty,
      editedParentChecked: this.taskCheckboxInputEl.checked,
      editedParentNumberText: this.orderedNumberInputEl.value,
      editedParentBody: this.textareaEl.value,
      editedExistingChildChecked: this.childInlineTaskCheckboxInputEl.checked,
      editedExistingChildNumberText: this.childInlineOrderedNumberInputEl.value,
      editedExistingChildBody: this.childInlineTextareaEl.value,
      editedNewChildBody: this.newChildTextareaEl.value,
    });
    if (!combined.ok) {
      new Notice(this.plugin.t(parentChildAddDeleteApplyReasonKey(combined.reason)));
      return false;
    }

    // Phase 5L-10: the reorder's own live-apply input — non-null only
    // while reorderDirty, per ReorderLiveApplyInput's own null-means-
    // absent convention (mirrors `existingChild`/`deletion` immediately
    // below).
    const reorderInput: ReorderLiveApplyInput | null = reorderDirty
      ? { orderedChildNodeIds: addDeleteSession.pendingReorderOrder, originalChildSubtreeText: projection.childSubtreeText }
      : null;

    // §7 steps 1–3, 6–7, 10: re-resolve fresh against the CURRENT
    // document, re-check for an external conflict on whichever range is
    // dirty, and build the ONE atomic replacement.
    const liveOutcome = applyParentChildAddDeleteToDocument(
      doc,
      this.nodeId,
      parentDirty,
      projection.ownText.rawText,
      combined.parentOwnTextRawText,
      existingChildSession
        ? {
            childNodeId: existingChildSession.childNodeId,
            dirty: existingChildDirty,
            originalRawText: existingChildSession.originalChildRawText,
            newRawText: combined.existingChildRawText ?? existingChildSession.originalChildRawText,
          }
        : null,
      addDeleteSession.pendingDeletion
        ? {
            childNodeId: addDeleteSession.pendingDeletion.childNodeId,
            originalRawText:
              addDeleteSession.childSlots[addDeleteSession.pendingDeletion.childIndex]?.rawText ?? "",
          }
        : null,
      combined.newChildRawText,
      reorderInput
    );
    if (!liveOutcome.changed) {
      new Notice(this.plugin.t(parentChildAddDeleteLiveApplyReasonKey(liveOutcome.reason)));
      return false;
    }

    // §7 step 11 is satisfied by construction above (every failure
    // returned before this point, with `doc`/every draft untouched); from
    // here on this mirrors applyParentChildCombinedEdit's own existing
    // isApplyingOwnEdit-guarded mutation + rebuild sequence.
    this.isApplyingOwnEdit = true;
    try {
      applyLineEditOutcome(
        editor,
        { line: liveOutcome.parentNewStartLine, ch: 0 },
        liveOutcome.parentNewStartLine,
        doc.lines,
        { changed: true, lines: liveOutcome.lines, newStartLine: liveOutcome.parentNewStartLine },
        () => {}
      );

      // §7 step 13: rebuild everything fresh against the just-saved
      // document — parent projection, child-add/delete session (its own
      // childSlots — the pending draft/deletion themselves are always
      // cleared here, since a successful Apply is exactly what commits
      // them), and the existing-child session (if one was open for a
      // DIFFERENT child than the one just deleted).
      const freshDoc = parseDocument(editor.getValue());
      const freshParentNode = freshDoc.nodes.get(this.nodeId);
      const freshExtracted = extractSubtreeText(freshDoc, this.nodeId);
      if (freshExtracted.ok) {
        this.originalText = freshExtracted.text;
      }
      // Phase 5L-12: this rebuild used to hand-recompute only
      // standaloneParentListItemProjection/childAddDeleteSession/
      // childInlineSession=null via a narrow, locally-duplicated
      // `stillEligible` eligibility check. Deleting the LAST remaining
      // child here is a genuine parent->leaf transition
      // (freshParentNode.childIds.length drops to 0), and the narrow
      // rebuild never reconsidered the four leaf tiers or rebuilt
      // ancestors/directChildren/siblingState, leaving this pane's own
      // Apply able to strand it in a stale "neither parent nor leaf"
      // state -- the same defect class Phase 5L-9b's Bug #2 fixed for
      // the external-Undo case, now shown reachable from this pane's own
      // Apply too. reconcileStandaloneNodeState re-derives every
      // standalone projection tier plus navigation state fresh from
      // freshDoc, so a last-child deletion correctly falls through to
      // the leaf tiers instead of stranding the pane.
      this.reconcileStandaloneNodeState(
        freshDoc,
        this.nodeId,
        freshParentNode,
        freshExtracted.ok ? freshExtracted.text : ""
      );
      if (
        existingChildSession &&
        freshParentNode &&
        isListNode(freshParentNode) &&
        this.standaloneParentListItemProjection
      ) {
        const rebuiltSession = buildParentChildInlineEditSession(
          freshDoc,
          freshParentNode,
          this.standaloneParentListItemProjection,
          existingChildSession.childNodeId
        );
        if (rebuiltSession.ok) {
          this.childInlineSession = rebuiltSession.session;
        }
        // A failed rebuild (reachable here ONLY if the existing-child
        // editor was open for a child that itself just got deleted —
        // defensive otherwise, liveOutcome.changed already confirmed the
        // parent and every touched range structurally moments ago)
        // simply closes the child inline editor, degrading to the plain
        // read-only preview — the same safe "degrade, never guess"
        // contract every sibling rebuild in this class already carries.
      }
      this.textareaEl.value = this.currentDisplayText();
      this.renderTaskCheckboxRow();
      this.renderOrderedNumberRow();
      this.renderBreadcrumb();
      this.renderSiblingNav();
      this.renderSubtreeNavigator();
      this.renderParentChildPreview();
      this.renderLeafFirstChildAddRow();
      this.syncState = "synced";
      this.updateDirtyState();
    } finally {
      this.isApplyingOwnEdit = false;
    }
    this.scheduleStaleCheck();

    const lineLen = editor.getLine(liveOutcome.parentNewStartLine)?.length ?? 0;
    editor.scrollIntoView(
      {
        from: { line: liveOutcome.parentNewStartLine, ch: 0 },
        to: { line: liveOutcome.parentNewStartLine, ch: lineLen },
      },
      true
    );
    this.plugin.queueOutlineTreeSelectionFollow(liveOutcome.parentNewStartLine);
    new Notice(this.plugin.t("partialEdit.parentChildAddDeleteApplied"));
    return true;
  }

  /**
   * Phase 5L-9b ("First Direct Child Addition for Leaf List Items — Mode
   * B"): called ONLY from applyEdit's own `pendingLeafFirstChild` branch,
   * which returns this method's own result directly. Inverts the
   * CURRENTLY ACTIVE standalone-leaf own-text draft via the exact same
   * per-kind invert*Projection dispatch every one of applyEdit's own four
   * standalone-leaf branches already uses (never a fifth, duplicate
   * inversion path — see edit/parentChildInlineEditSession.ts's own Phase
   * 5L-9b section top doc comment), then hands the result plus the
   * pending draft to applyLeafFirstChildAdditionToDocument for the actual
   * (own-text + new-child, ONE ordinary applySubtreeEdit splice) write.
   *
   * On success, unlike every sibling combined-Apply method in this class
   * (which each do a narrow, hand-rebuilt "refresh just the fields this
   * kind of edit could have touched"), this one calls loadNodeInternal
   * directly — Mode B's own transition is categorically bigger than any
   * of theirs: the node crosses from ONE of the four leaf tiers to the
   * FIFTH, parent tier (see view/PartialEditView.ts's own loadNodeInternal
   * five-tier priority chain doc comment), which would otherwise require
   * hand-duplicating that same five-tier resolution here. A fresh
   * loadNodeInternal call already does exactly that resolution correctly,
   * for free, exactly as this ticket's own §6 design guidance anticipates
   * ("次回reloadで既存 parent projectionが自然にclaimする").
   */
  private applyLeafFirstChildEdit(doc: ParsedDocument, editor: Editor): boolean {
    if (!this.nodeId || !this.pendingLeafFirstChild) {
      new Notice(this.plugin.t("partialEdit.leafFirstChildAddFailed"));
      return false;
    }

    let newOwnTextRawText: string;
    if (this.standaloneListMarkerProjection) {
      const inverted = invertListMarkerProjection(this.standaloneListMarkerProjection, this.textareaEl.value);
      if (!inverted.ok) {
        new Notice(this.plugin.t("partialEdit.listBodyNewlineUnsupported"));
        return false;
      }
      newOwnTextRawText = inverted.rawLine;
    } else if (this.standaloneTaskListProjection) {
      const inverted = invertTaskListProjection(
        this.standaloneTaskListProjection,
        this.taskCheckboxInputEl.checked,
        this.textareaEl.value
      );
      if (!inverted.ok) {
        new Notice(this.plugin.t("partialEdit.taskBodyNewlineUnsupported"));
        return false;
      }
      newOwnTextRawText = inverted.rawLine;
    } else if (this.standaloneOrderedListProjection) {
      const inverted = invertOrderedListProjection(
        this.standaloneOrderedListProjection,
        this.orderedNumberInputEl.value,
        this.textareaEl.value
      );
      if (!inverted.ok) {
        new Notice(
          this.plugin.t(
            inverted.reason === "invalid-number"
              ? "partialEdit.orderedNumberInvalid"
              : "partialEdit.orderedBodyNewlineUnsupported"
          )
        );
        return false;
      }
      newOwnTextRawText = inverted.rawLine;
    } else if (this.standaloneMultiLineListProjection) {
      const inverted = invertMultiLineListItemProjection(
        this.standaloneMultiLineListProjection,
        this.taskCheckboxInputEl.checked,
        this.orderedNumberInputEl.value,
        this.textareaEl.value
      );
      if (!inverted.ok) {
        new Notice(
          this.plugin.t(
            inverted.reason === "invalid-number"
              ? "partialEdit.orderedNumberInvalid"
              : "partialEdit.multiLineListStructureInvalid"
          )
        );
        return false;
      }
      newOwnTextRawText = inverted.rawText;
    } else {
      // Defensive only — pendingLeafFirstChild is only ever set while
      // exactly one of the four standalone-leaf projections is active
      // (see handleRequestAddLeafFirstChild's own guard).
      new Notice(this.plugin.t("partialEdit.leafFirstChildAddFailed"));
      return false;
    }

    const outcome = applyLeafFirstChildAdditionToDocument(
      doc,
      this.nodeId,
      this.originalText,
      newOwnTextRawText,
      this.pendingLeafFirstChild,
      this.isNewChildDraftDirty(),
      this.newChildTextareaEl.value
    );
    if (!outcome.ok) {
      new Notice(this.plugin.t(leafFirstChildApplyReasonKey(outcome.reason)));
      return false;
    }

    this.isApplyingOwnEdit = true;
    try {
      applyLineEditOutcome(
        editor,
        { line: outcome.newStartLine, ch: 0 },
        outcome.newStartLine,
        doc.lines,
        { changed: true, lines: outcome.lines, newStartLine: outcome.newStartLine },
        () => {}
      );
      this.pendingLeafFirstChild = null;
      // See this method's own doc comment for why a full reload (rather
      // than a hand-rebuilt subset of fields) is the correct rebuild here.
      this.loadNodeInternal(this.nodeId);
    } finally {
      this.isApplyingOwnEdit = false;
    }
    this.scheduleStaleCheck();

    const lineLen = editor.getLine(outcome.newStartLine)?.length ?? 0;
    editor.scrollIntoView(
      {
        from: { line: outcome.newStartLine, ch: 0 },
        to: { line: outcome.newStartLine, ch: lineLen },
      },
      true
    );
    this.plugin.queueOutlineTreeSelectionFollow(outcome.newStartLine);
    new Notice(this.plugin.t("partialEdit.leafFirstChildAdded"));
    return true;
  }

  /**
   * Phase 5L-11 ("Direct Child Leaf Indent/Outdent in Parent Partial
   * Edit Pane"): called ONLY from applyEdit's own
   * `childAddDeleteSession?.pendingIndentOutdent` branch, which returns
   * this method's own result directly. A thin UI-layer wrapper around
   * edit/parentChildInlineEditSession.ts's own
   * applyParentChildIndentOutdentToDocument — see that function's own
   * doc comment for the full "why one fresh pass is enough" design. On
   * ANY failure, this method returns `false` having shown a Notice and
   * touched NEITHER the document NOR the pending transformation (nor the
   * parent's own draft) at all.
   */
  private applyParentChildIndentOutdentEdit(doc: ParsedDocument, editor: Editor): boolean {
    const projection = this.standaloneParentListItemProjection;
    const addDeleteSession = this.childAddDeleteSession;
    const pending = addDeleteSession?.pendingIndentOutdent ?? null;
    if (!projection || !addDeleteSession || !pending || !this.nodeId) {
      new Notice(this.plugin.t("partialEdit.parentChildInlineEditFailed"));
      return false;
    }

    const parentDirty =
      this.textareaEl.value !== projectedParentBodyText(projection) ||
      (projection.ownText.listKind === "task" &&
        this.taskCheckboxInputEl.checked !== projectedParentChecked(projection)) ||
      (projection.ownText.listKind === "ordered" &&
        this.orderedNumberInputEl.value !== projectedParentNumberText(projection));

    // §6/§7 (indent/outdent's own simplified composition scope): the
    // parent's own own-text draft, if dirty, is inverted+validated FIRST
    // — exactly like every other combined-Apply path in this file — a
    // failure here leaves both the parent's own draft AND the pending
    // indent/outdent completely untouched.
    let newParentOwnTextRaw = projection.ownText.rawText;
    if (parentDirty) {
      const inverted = invertParentListItemProjection(
        projection,
        this.taskCheckboxInputEl.checked,
        this.orderedNumberInputEl.value,
        this.textareaEl.value
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
        new Notice(this.plugin.t(parentChildCombinedApplyReasonKey(reason)));
        return false;
      }
      newParentOwnTextRaw = inverted.ownTextRawText;
    }

    const liveOutcome = applyParentChildIndentOutdentToDocument(
      doc,
      this.nodeId,
      parentDirty,
      projection.ownText.rawText,
      newParentOwnTextRaw,
      pending,
      projection.childSubtreeText
    );
    if (!liveOutcome.changed) {
      new Notice(this.plugin.t(parentChildIndentOutdentApplyReasonKey(liveOutcome.reason)));
      return false;
    }

    this.isApplyingOwnEdit = true;
    try {
      applyLineEditOutcome(
        editor,
        { line: liveOutcome.parentNewStartLine, ch: 0 },
        liveOutcome.parentNewStartLine,
        doc.lines,
        { changed: true, lines: liveOutcome.lines, newStartLine: liveOutcome.parentNewStartLine },
        () => {}
      );

      // §7 step 13: rebuild everything fresh against the just-saved
      // document — mirrors applyParentChildAddDeleteCombinedEdit's own
      // identical rebuild sequence (parent projection, child-add/delete
      // session — its own pendingIndentOutdent is always cleared here,
      // since a successful Apply is exactly what commits it — and the
      // existing-child session, always null here since a pending
      // indent/outdent never coexists with one — see this ticket's own
      // §6 composition scope).
      const freshDoc = parseDocument(editor.getValue());
      const freshParentNode = freshDoc.nodes.get(this.nodeId);
      const freshExtracted = extractSubtreeText(freshDoc, this.nodeId);
      if (freshExtracted.ok) {
        this.originalText = freshExtracted.text;
      }
      // Phase 5L-12: mirrors applyParentChildAddDeleteCombinedEdit's own
      // Phase 5L-12 rebuild shape (see that method's doc comment), but
      // for a DIFFERENT reason: unlike add/delete, indent/outdent can
      // never make freshParentNode.childIds.length itself drop to 0 --
      // evaluateChildIndentEligibility always requires a PRECEDING
      // SIBLING (so at least one direct child remains after an indent),
      // and evaluateChildOutdentEligibility only ever PROMOTES a
      // grandchild into a new direct child of freshParentNode (so
      // outdent only ever grows freshParentNode's own childIds, never
      // shrinks it) -- so this pane's own root target never transitions
      // parent->leaf through this method. What indent/outdent DOES
      // always change, though, is the target's own set of DIRECT
      // children (indent removes one, outdent adds one) -- and the OLD
      // narrow `stillEligible` rebuild never recomputed
      // ancestors/directChildren/siblingState at all, so the Subtree
      // Navigator (which lists exactly those direct children) kept
      // showing the PRE-transform set until the next unrelated reload.
      // reconcileStandaloneNodeState fixes that staleness and, for full
      // consistency with every sibling rebuild site in this class, also
      // re-resolves the standalone-projection tier fresh (a no-op here
      // in practice, since childIds.length never reaches 0, but it means
      // this call site can never silently drift out of sync with the
      // shared contract if that invariant ever changes).
      // childInlineSession/pendingLeafFirstChild are always safely reset
      // fresh here too: a pending indent/outdent never coexists with an
      // open existing-child editor or a pending Mode B draft (this
      // ticket's own §6 composition scope).
      this.reconcileStandaloneNodeState(
        freshDoc,
        this.nodeId,
        freshParentNode,
        freshExtracted.ok ? freshExtracted.text : ""
      );
      this.textareaEl.value = this.currentDisplayText();
      this.renderTaskCheckboxRow();
      this.renderOrderedNumberRow();
      this.renderBreadcrumb();
      this.renderSiblingNav();
      this.renderSubtreeNavigator();
      this.renderParentChildPreview();
      this.renderLeafFirstChildAddRow();
      this.syncState = "synced";
      this.updateDirtyState();
    } finally {
      this.isApplyingOwnEdit = false;
    }
    this.scheduleStaleCheck();

    const lineLen = editor.getLine(liveOutcome.parentNewStartLine)?.length ?? 0;
    editor.scrollIntoView(
      {
        from: { line: liveOutcome.parentNewStartLine, ch: 0 },
        to: { line: liveOutcome.parentNewStartLine, ch: lineLen },
      },
      true
    );
    this.plugin.queueOutlineTreeSelectionFollow(liveOutcome.parentNewStartLine);
    new Notice(this.plugin.t("partialEdit.parentChildAddDeleteApplied"));
    return true;
  }

  /**
   * Real-device follow-up: Apply/Cancel previously stayed visible (only
   * enabled/disabled) for as long as a node was loaded, regardless of
   * whether there was anything to Apply/Cancel. Showing them only while
   * the textarea actually differs from `originalText` (the pane's "before
   * editing" snapshot — see applySubtreeEdit's doc comment in
   * edit/partialEdit.ts) makes the pane read as clean immediately after a
   * fresh load, a successful Apply, or a Cancel, and only surface an
   * action once there's an actual pending edit. `nodeId` is checked too
   * (not just the text comparison) purely for clarity at the empty-state
   * call site — textareaEl.value and originalText are both "" before any
   * node is ever loaded, so the comparison alone would already resolve to
   * false there.
   */
  private updateDirtyState(): void {
    const dirty = this.isDirty();
    this.applyButtonEl.toggleVisibility(dirty);
    this.cancelButtonEl.toggleVisibility(dirty);

    // Phase 5A-1: Apply is ALSO disabled whenever this pane is stale or
    // unavailable — deliberately a UX-layer-only precaution, never a
    // replacement for (or weakening of) the existing, unchanged
    // fail-closed conflict check inside applySubtreeEdit/
    // applyParagraphEdit/applyCompositeBlockEdit, which would refuse the
    // exact same Apply anyway (that check is precisely WHAT makes a pane
    // "stale" in the first place — see resolveCurrentTarget). This only
    // pre-empts a click that is guaranteed to fail, with an explanatory
    // tooltip for both visual and non-visual (screen reader) users.
    // `anyLoaded` mirrors isDirty()'s own "something is loaded" condition
    // exactly, so an empty pane's Apply button stays disabled=true exactly
    // as it always has (renderEmptyState's own explicit `disabled = true`
    // is left untouched by this — this line simply reproduces the same
    // value for the empty case rather than overriding it differently).
    const anyLoaded = this.nodeId !== null || this.paragraphAnchor !== null || this.compositeAnchor !== null;
    const applyBlockedBySync = anyLoaded && this.syncState !== "synced";
    this.applyButtonEl.disabled = anyLoaded ? applyBlockedBySync : true;
    setTooltip(
      this.applyButtonEl,
      applyBlockedBySync
        ? this.plugin.t(
            this.syncState === "stale"
              ? "partialEdit.staleApplyDisabledReason"
              : "partialEdit.unavailableApplyDisabledReason"
          )
        : ""
    );

    this.renderSyncStatus();
  }

  /**
   * Phase 5A-1: renders the stale/unavailable indicator + Reload row
   * (syncStatusEl) from `this.syncState` — called from updateDirtyState so
   * every place that already re-renders dirty/Apply state (load, Cancel,
   * Apply, and this ticket's own transitionToStale/transitionToUnavailable/
   * performAutoReload) keeps this row in sync for free, with no separate
   * call site to remember. Hidden whenever synced or nothing is loaded —
   * mirrors the `anyLoaded` condition updateDirtyState above already uses
   * for the Apply button's own sync-based disabling.
   */
  private renderSyncStatus(): void {
    const anyLoaded = this.nodeId !== null || this.paragraphAnchor !== null || this.compositeAnchor !== null;
    const show = anyLoaded && this.syncState !== "synced";
    this.syncStatusEl.toggleVisibility(show);
    this.syncStatusEl.toggleClass(
      "unified-outliner-partial-edit-sync-status-stale",
      show && this.syncState === "stale"
    );
    this.syncStatusEl.toggleClass(
      "unified-outliner-partial-edit-sync-status-unavailable",
      show && this.syncState === "unavailable"
    );
    if (!show) return;
    this.syncStatusLabelEl.setText(
      this.plugin.t(this.syncState === "stale" ? "partialEdit.staleLabel" : "partialEdit.unavailableLabel")
    );
  }

  /**
   * Phase 5B: shared by updateDirtyState (Apply/Cancel button visibility)
   * and requestLoadNode (the unsaved-edit guard) — both need the exact
   * same "is there something to Apply/Cancel/lose right now" condition,
   * so it lives in one place instead of being duplicated inline.
   */
  private isDirty(): boolean {
    // Phase 5D-0.5: compares against currentDisplayText() (the projected
    // displayText for a projecting callout/blockquote, originalText
    // verbatim otherwise) — NEVER against raw originalText directly for a
    // projecting node, or every keystroke in the prefix-stripped textarea
    // would spuriously read as dirty relative to the still-`>`-prefixed
    // raw snapshot. See currentDisplayText's own doc comment.
    //
    // Phase 5D-1A: ALSO dirty when the title input differs from its
    // loaded titleSlot.title — titleSlot is null (titleDirty forced
    // false) for every case except a callout whose title was
    // successfully split out, so this is a no-op addition for
    // blockquote/section/list/paragraph/non-title-editable callouts.
    // Phase 5D-1B: ALSO dirty when the fold-marker select differs from
    // its loaded titleSlot.marker, same gating as titleDirty.
    // Phase 5D-1C: ALSO dirty when the type combobox differs from its
    // loaded titleSlot.type, same gating as titleDirty/markerDirty.
    const titleSlot = this.quoteProjection?.titleSlot ?? null;
    const titleDirty = titleSlot !== null && this.quoteTitleInputEl.value !== titleSlot.title;
    const markerDirty = titleSlot !== null && this.quoteMarkerSelectEl.value !== titleSlot.marker;
    const typeDirty = titleSlot !== null && this.quoteTypeInputEl.value !== titleSlot.type;
    // Phase 5D-2B: ALSO dirty when the structured composite session's own
    // list-member input differs from its loaded raw line —
    // compositeListOriginalText is null for every case except a
    // successfully-split-and-projected composite, so this is a no-op
    // addition for every other kind (including a composite that fell back
    // to the raw whole-range textarea).
    const listDirty =
      this.compositeListOriginalText !== null &&
      this.compositeListInputEl.value !== this.compositeListOriginalText;
    // Phase 5L-2: ALSO dirty when the standalone task-list checkbox
    // control's current .checked value differs from its loaded
    // projection's own checked state — standaloneTaskListProjection is
    // null for every case except a successfully-projected standalone
    // task-list item, so this is a no-op addition for every other kind.
    const taskCheckedDirty =
      this.standaloneTaskListProjection !== null &&
      this.taskCheckboxInputEl.checked !== this.standaloneTaskListProjection.checked;
    // Phase 5L-3: ALSO dirty when the standalone ordered-list number
    // input's current text differs from its loaded projection's own
    // number text — standaloneOrderedListProjection is null for every
    // case except a successfully-projected standalone ordered-list item,
    // so this is a no-op addition for every other kind. Deliberately a
    // plain STRING comparison against the ORIGINAL number text (never a
    // numeric comparison, and never gated on isValidOrderedListNumberText)
    // — the control is dirty the moment its raw text differs at all,
    // including a currently-invalid in-progress edit; Apply-time
    // validation (applyEdit, via invertOrderedListProjection) is what
    // actually decides whether that edit is acceptable, not this check.
    const orderedNumberDirty =
      this.standaloneOrderedListProjection !== null &&
      this.orderedNumberInputEl.value !== this.standaloneOrderedListProjection.number;
    // Phase 5L-4: ALSO dirty when a multi-line leaf item's own checkbox/
    // number control (task/ordered kind respectively) differs from its
    // loaded projection's own value — same rationale, same plain-string-
    // comparison policy, as taskCheckedDirty/orderedNumberDirty above.
    // The shared textarea's own body-dirtiness for a multi-line
    // projection is ALREADY covered by this function's own top-level
    // `this.textareaEl.value !== this.currentDisplayText()` check below
    // (currentDisplayText already branches on
    // standaloneMultiLineListProjection — see that method's own doc
    // comment), so no separate "multi-line body dirty" flag is needed
    // here.
    const multiLineTaskCheckedDirty =
      this.standaloneMultiLineListProjection?.listKind === "task" &&
      this.taskCheckboxInputEl.checked !== projectedMultiLineChecked(this.standaloneMultiLineListProjection);
    const multiLineNumberDirty =
      this.standaloneMultiLineListProjection?.listKind === "ordered" &&
      this.orderedNumberInputEl.value !== projectedMultiLineNumberText(this.standaloneMultiLineListProjection);
    // Phase 5L-6: ALSO dirty when a parent item's own-text checkbox/
    // number control (task/ordered kind respectively) differs from its
    // loaded projection's own value — same rationale, same plain-string-
    // comparison policy, as multiLineTaskCheckedDirty/multiLineNumberDirty
    // immediately above. The shared textarea's own own-text-body-dirtiness
    // is ALREADY covered by this function's own top-level
    // `this.textareaEl.value !== this.currentDisplayText()` check below
    // (currentDisplayText already branches on
    // standaloneParentListItemProjection), so no separate "parent body
    // dirty" flag is needed here. The read-only child preview never
    // participates in dirty tracking at all — it has no editable control
    // for this function to compare against.
    const parentTaskCheckedDirty =
      this.standaloneParentListItemProjection?.ownText.listKind === "task" &&
      this.taskCheckboxInputEl.checked !== projectedParentChecked(this.standaloneParentListItemProjection);
    const parentNumberDirty =
      this.standaloneParentListItemProjection?.ownText.listKind === "ordered" &&
      this.orderedNumberInputEl.value !== projectedParentNumberText(this.standaloneParentListItemProjection);
    // Phase 5L-8: ALSO dirty when the child inline editor's own controls
    // (body/checkbox/number, whichever apply to its own kind) differ from
    // `childInlineSession`'s loaded snapshot — `isChildInlineDraftDirty()`
    // is `false` whenever no child session is open, so this is a no-op
    // addition for every other case. This is what makes "the parent's own
    // draft AND/OR the currently-open child's own draft" ONE combined
    // dirty state for Apply/Cancel visibility, requestLoadNode's own
    // unsaved-edit guard, AND handleStartChildInlineEdit's own
    // switch-to-a-different-child guard — per this ticket's own explicit
    // §8 requirement.
    const childInlineDirty = this.isChildInlineDraftDirty();
    // Phase 5L-9: ALSO dirty whenever a new-child draft is PRESENT (even
    // if its own body is still untouched — §4's own "Apply with an
    // untouched body is allowed" contract means Apply must still be
    // reachable, so this counts as dirty by presence, not just by
    // isNewChildDraftDirty()) and/or a pending deletion is marked — both
    // gated on `childAddDeleteSession` itself being non-null (null for
    // every case except a currently-projected parent — see that field's
    // own doc comment), same "no-op addition for every other case"
    // pattern as childInlineDirty immediately above.
    const addDeleteDirty = this.hasAddDeleteActivity();
    // Phase 5L-9b: ALSO dirty whenever a Mode B "promote this leaf to a
    // parent" draft is PRESENT — same "presence, not just body-dirtiness"
    // rationale as addDeleteDirty's own newChildDraft half immediately
    // above (an untouched-body pending first child must still reach
    // Apply). `null` for every case except a currently-eligible
    // standalone leaf with a pending draft — see pendingLeafFirstChild's
    // own doc comment.
    const leafFirstChildDirty = this.pendingLeafFirstChild !== null;
    // Phase 5D-2A: ALSO counts a loaded CompositeBlock (compositeAnchor)
    // as "something is loaded" here — otherwise a composite-wide edit
    // would never register as dirty, silently defeating the unsaved-edit
    // guard every requestLoadNode/requestLoadParagraphAtCursor/
    // requestLoadComposite call already relies on via `if (!this.isDirty())`.
    return (
      (this.nodeId !== null || this.paragraphAnchor !== null || this.compositeAnchor !== null) &&
      (this.textareaEl.value !== this.currentDisplayText() ||
        titleDirty ||
        markerDirty ||
        typeDirty ||
        listDirty ||
        taskCheckedDirty ||
        orderedNumberDirty ||
        multiLineTaskCheckedDirty ||
        multiLineNumberDirty ||
        parentTaskCheckedDirty ||
        parentNumberDirty ||
        childInlineDirty ||
        addDeleteDirty ||
        leafFirstChildDirty)
    );
  }

  /**
   * Real-device follow-up: keep exactly one visible "close this pane"
   * control. Obsidian only draws a native tab header (with its own ×) for
   * leaves outside the left/right sidedock (`workspace.leftSplit` /
   * `rightSplit`) — a lone leaf docked directly in the sidebar (this
   * pane's default open location; see main.ts's activatePartialEditView)
   * gets no native close control at all, which is why this pane has its
   * own × in the first place. Once the user drags this pane into a normal
   * tab, or pops it into its own window (activatePartialEditView's
   * `openInNewWindow` support), Obsidian draws a native tab × too — this
   * pane's own × would then be a redundant second close button, so it
   * hides itself whenever `this.leaf.getRoot()` is NOT one of the two
   * sidedocks (i.e. whenever a native × is expected to already be
   * present).
   */
  private updateCloseButtonVisibility(): void {
    const { workspace } = this.app;
    const root = this.leaf.getRoot();
    const inSidebar = root === workspace.leftSplit || root === workspace.rightSplit;
    this.closeButtonEl.toggleVisibility(inSidebar);
  }

  // ---------------------------------------------------------------------
  // Phase 5A-1 ("Partial Edit Pane の stale 状態検知・安全な再読み込み"):
  // event handlers, the debounced stale check, and Reload. See this file's
  // top-level doc comment's Phase 5A-1 paragraph and
  // docs/phase5a1_partial_edit_stale_pane_synchronization_design.md for
  // the full design and rationale; each method below only carries the
  // parts of that rationale a reader needs locally.
  // ---------------------------------------------------------------------

  /**
   * editor-change handler — matches purely on `info.file?.path`, NEVER on
   * `this.plugin.activeMarkdownView` (see onOpen's own doc comment on this
   * registration for why). `info` is `MarkdownView | MarkdownFileInfo`
   * (obsidian.d.ts) — both expose `.file` uniformly, so no instanceof
   * check is needed before reading it.
   */
  private handleEditorChange(_editor: Editor, info: MarkdownView | MarkdownFileInfo): void {
    if (this.closed || !this.sourcePath) return;
    if (info.file?.path !== this.sourcePath) return;
    this.scheduleStaleCheck();
  }

  /** vault "modify" handler — path-based, works even with no open editor for sourcePath. */
  private handleVaultModify(file: TAbstractFile): void {
    if (this.closed || !this.sourcePath) return;
    if (!(file instanceof TFile) || file.path !== this.sourcePath) return;
    this.scheduleStaleCheck();
  }

  /**
   * vault "rename" handler — follows `sourcePath` to the file's new path
   * WITHOUT touching the textarea or any loaded content (a rename alone
   * says nothing about whether the CONTENT changed). `this.sourcePath` is
   * reassigned synchronously here, so every downstream read of it — this
   * debounced check's own eventual callback included, since that callback
   * always reads `this.sourcePath` live rather than closing over a local
   * copy — sees the new path, never a stale one, regardless of how much
   * later the debounced check actually executes.
   */
  private handleVaultRename(file: TAbstractFile, oldPath: string): void {
    if (this.closed || !this.sourcePath) return;
    if (!(file instanceof TFile) || oldPath !== this.sourcePath) return;
    this.sourcePath = file.path;
    this.scheduleStaleCheck();
  }

  /**
   * vault "delete" handler — an unambiguous, immediate transition to
   * "unavailable" (no debounce needed: there is nothing left to compare
   * against). Deliberately does NOT clear `nodeId`/`paragraphAnchor`/
   * `compositeAnchor`/`originalText`/the textarea's own buffered value —
   * an in-progress dirty edit is never force-discarded just because its
   * source note disappeared. See transitionToUnavailable's own doc
   * comment for why this state does not auto-clear if the path later
   * becomes valid again (e.g. a same-named file recreated, or an undo of
   * the deletion) — only an explicit Reload re-attempts resolution.
   */
  private handleVaultDelete(file: TAbstractFile): void {
    if (this.closed || !this.sourcePath) return;
    if (!(file instanceof TFile) || file.path !== this.sourcePath) return;
    this.transitionToUnavailable();
  }

  /**
   * E5 (design doc §3, "two-stage"): the first stage — search every open
   * MarkdownView (via `getLeavesOfType`, which per obsidian.d.ts's own doc
   * comment also searches leaves inside pop-out windows when no root is
   * given) for one whose `.file?.path` equals `this.sourcePath`. Returns
   * that view's live `Editor` when found (its `getValue()` reflects
   * every keystroke, even totally unsaved ones — the freshest possible
   * source), or `null` when `sourcePath` has no open editor anywhere
   * (background file, inactive tab never focused this session, etc.) —
   * callers fall back to `vault.cachedRead` in that case. Never trusts
   * `this.plugin.activeMarkdownView` — see onOpen's own doc comment.
   */
  private findOpenEditorForSourcePath(): Editor | null {
    if (!this.sourcePath) return null;
    const leaves = this.app.workspace.getLeavesOfType("markdown");
    for (const leaf of leaves) {
      const view = leaf.view;
      if (view instanceof MarkdownView && view.file?.path === this.sourcePath) {
        return view.editor;
      }
    }
    return null;
  }

  /**
   * The debounced target of `scheduleStaleCheck` — see that field's own
   * doc comment for the debounce configuration and why every event source
   * funnels here. Skips entirely once `syncState === "unavailable"`: per
   * this ticket's own requirement, "unavailable" never auto-clears itself
   * — only an explicit Reload (executeReload below) re-attempts
   * resolution. `vault.cachedRead` (E4, the no-open-editor fallback) is
   * used here ONLY for a safe, read-only staleness COMPARISON — never to
   * silently overwrite the textarea; see evaluateAgainstText's own
   * `fromLiveEditor` gate for where that distinction is enforced.
   */
  private performStaleCheck(): void {
    if (!this.sourcePath) return;
    if (!this.nodeId && !this.paragraphAnchor && !this.compositeAnchor) return;
    // Phase 5A-1 hardening §1: closed / self-Apply-suppressed / already-
    // "unavailable" are now one shared, Obsidian-free decision
    // (partialEditSyncClassification.ts#shouldRunStaleCheck) — see that
    // function's own doc comment, and isApplyingOwnEdit's own doc comment
    // for why a suppressed re-entrant call must no-op here BEFORE even
    // touching the vault, not just at evaluateAgainstText's own guard.
    if (
      !shouldRunStaleCheck({
        closed: this.closed,
        suppressed: this.isApplyingOwnEdit,
        currentSyncState: this.syncState,
      })
    ) {
      return;
    }

    const path = this.sourcePath;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      this.transitionToUnavailable();
      return;
    }

    const openEditor = this.findOpenEditorForSourcePath();
    if (openEditor) {
      this.evaluateAgainstText(openEditor.getValue(), path, true);
      return;
    }
    // Phase 5A-1 hardening §3: a rejected cachedRead (e.g. a transient I/O
    // error, or the file vanishing between getAbstractFileByPath above and
    // this read) must fail closed — this is the PASSIVE detection path
    // (never explicitly requested by the user), so the chosen behavior is
    // to change nothing at all: no textarea/quote-input/originalText/
    // anchor/snapshot mutation, no incorrect auto-reload, no substituted
    // or guessed content, and no syncState transition either (a transient
    // read failure here is not itself evidence the target is actually
    // unavailable — see executeReload's own doc comment for why an
    // EXPLICIT Reload's own read failure is treated differently). The
    // rejection is swallowed rather than surfaced as a Notice — a silent,
    // periodic background check failing once is not something the user
    // needs interrupted for, and the next debounced check (editor-change/
    // vault modify/active-leaf-change/file-open) will simply try again.
    void this.app.vault
      .cachedRead(file)
      .then((text) => {
        this.evaluateAgainstText(text, path, false);
      })
      .catch(() => {
        /* Fail closed — see this method's own comment above. */
      });
  }

  /**
   * Re-resolves the currently loaded target against a fresh parse of
   * `doc`, reusing exactly the same read-only resolvers
   * applySubtreeEdit/applyParagraphEdit/applyCompositeBlockEdit
   * themselves call for their own conflict check — see each branch's own
   * comment below. This is what guarantees stale-detection can never be
   * weaker than Apply's own fail-closed contract: it IS that contract's
   * own read side, never a separately re-implemented approximation of it.
   *
   * `ambiguous` distinguishes a paragraph whose position could not be
   * safely, uniquely re-identified (deletion, an ambiguous duplicate, or
   * a nearby structural change — see applyParagraphEdit's own doc
   * comment for "anchor-unresolved") from a section/list/callout/
   * blockquote/CompositeBlock's more definitive resolve-failure. Per this
   * ticket's own explicit instruction, an ambiguous case leans toward
   * "stale" rather than "unavailable" when merely DETECTED (see
   * evaluateAgainstText) — only a subsequent, explicit Reload attempt
   * that ALSO fails escalates it to "unavailable" (see executeReload).
   */
  private resolveCurrentTarget(doc: ParsedDocument): { ok: boolean; text: string | null; ambiguous: boolean } {
    if (this.nodeId) {
      const extracted = extractSubtreeText(doc, this.nodeId);
      return { ok: extracted.ok, text: extracted.ok ? extracted.text : null, ambiguous: false };
    }

    if (this.paragraphAnchor) {
      // Phase 5A-1 hardening §2: reuses edit/paragraphPartialEdit.ts's own
      // dedicated, explicitly read-only `resolveParagraphAnchorText` —
      // never the discarded-result no-op-probe pattern (re-splicing the
      // anchor's own snapshot text via the Apply-time function below,
      // purely to read its outcome) this ticket's own safety review
      // flagged as a responsibility-boundary risk: an "Apply"-named
      // function reused for reads, with no explicit read-only contract.
      // See resolveParagraphAnchorText's own doc comment for the full
      // two-pass identity-resolution algorithm (mirroring, but not
      // identical to, the Apply-time function's own — see ITS doc comment
      // for exactly how and why the two intentionally differ) and why it
      // is provably free of any Editor/Vault/DOM/Notice dependency.
      return resolveParagraphAnchorText(doc, this.paragraphAnchor);
    }

    if (this.compositeAnchor) {
      const rules = getEnabledCompositeBlockRules(this.plugin.settings.compositeBlocks);
      const extracted = extractCompositeBlockText(doc, this.compositeAnchor, rules);
      return { ok: extracted.ok, text: extracted.ok ? extracted.text : null, ambiguous: false };
    }

    return { ok: false, text: null, ambiguous: false };
  }

  /**
   * Classifies the result of one resolveCurrentTarget call against
   * `this.originalText` and either: (a) clears back to "synced" (content
   * matches), (b) silently, safely auto-reloads (see performAutoReload's
   * own doc comment for the full condition list this branch enforces), or
   * (c) marks stale/unavailable for display only, never touching the
   * textarea. `fromLiveEditor` is `true` only for the E3/open-editor path
   * (performStaleCheck) — auto-reload (silently updating the textarea
   * without a confirmation) is restricted to exactly that case, per this
   * ticket's own explicit instruction; the E4/vault.cachedRead path is
   * always read-only-comparison-only here, never an auto-textarea-update,
   * regardless of dirty state.
   */
  private evaluateAgainstText(text: string, path: string, fromLiveEditor: boolean): void {
    // Phase 5A-1 hardening §1: `isApplyingOwnEdit` is checked here too,
    // not just at performStaleCheck's own entry — a `vault.cachedRead`
    // promise scheduled BEFORE this Apply started could in principle still
    // have its `.then()` callback reach this method later; guarding here
    // as well makes that inert regardless of any assumption about
    // microtask/debounce ordering. See isApplyingOwnEdit's own doc comment.
    if (this.closed || this.isApplyingOwnEdit || this.sourcePath !== path) return;
    if (!this.nodeId && !this.paragraphAnchor && !this.compositeAnchor) return;

    const doc = parseDocument(text);
    const resolved = this.resolveCurrentTarget(doc);

    // Phase 5A-1 hardening §4: the actual classification decision is now a
    // pure, Obsidian-free function (partialEditSyncClassification.ts) —
    // see its own doc comment for the full decision table (mirrored from
    // this method's pre-hardening inline logic, unit-tested there with
    // real assertions rather than only via this file's own static-source
    // checks). Everything below is purely dispatch: apply whichever side
    // effect the decision calls for, never re-deciding anything itself.
    const decision = classifySyncOutcome({
      resolved,
      originalText: this.originalText,
      isDirty: this.isDirty(),
      fromLiveEditor,
    });

    switch (decision) {
      case "unavailable":
        this.transitionToUnavailable();
        return;
      case "stale":
        this.transitionToStale();
        return;
      case "already-synced":
        if (this.syncState !== "synced") {
          this.syncState = "synced";
          this.updateDirtyState();
        }
        return;
      case "clean-pane-auto-reload":
        // resolved.text is guaranteed non-null whenever classifySyncOutcome
        // returns "clean-pane-auto-reload" (see that function's own doc
        // comment) — this null check exists only so TypeScript can narrow
        // resolved.text's type across the pure-function boundary; it is
        // not a reachable runtime branch.
        if (resolved.text === null) return;
        this.performAutoReload(resolved.text, doc);
        return;
    }
  }

  /** See `syncState`'s own doc comment. Idempotent (a no-op re-render when already stale). */
  private transitionToStale(): void {
    if (this.closed) return;
    if (this.syncState === "stale") return;
    this.syncState = "stale";
    this.updateDirtyState();
  }

  /**
   * See `syncState`'s own doc comment for what "unavailable" means and
   * why it never clears itself automatically (performStaleCheck's own
   * early-return on `syncState === "unavailable"` is the other half of
   * that contract) — a deleted-then-recreated file, or a target that
   * starts resolving again for any other reason, is picked up again ONLY
   * via an explicit Reload (executeReload), never silently. Idempotent.
   */
  private transitionToUnavailable(): void {
    if (this.closed) return;
    if (this.syncState === "unavailable") return;
    this.syncState = "unavailable";
    this.updateDirtyState();
  }

  /**
   * Applies a freshly re-resolved `newText` to this pane's OWN in-memory
   * state — never to the note (no editor.replaceRange call anywhere in
   * this method) — from either the clean-Pane auto-reload path
   * (evaluateAgainstText) or an explicit Reload (executeReload). Mirrors
   * applyEdit()'s own existing post-Apply re-anchoring for each of the
   * three anchor kinds (see that method's own paragraph/composite/node
   * branches), reused here for the same reason: a second Apply (or a
   * second stale check) after this must start from a fully current basis.
   */
  private performAutoReload(newText: string, doc: ParsedDocument): void {
    this.originalText = newText;
    if (this.nodeId && this.quoteProjection) {
      const kind = this.quoteProjection.kind;
      const rebuilt = buildQuotePrefixProjection(newText, kind);
      this.quoteProjection = rebuilt.ok ? rebuilt.projection : null;
    }
    // Phase 5L-12: the five-tier standalone-list-item projection chain,
    // the Mode A/B session fields (childAddDeleteSession/
    // childInlineSession/pendingLeafFirstChild), and the ancestors/
    // directChildren/siblingState navigation trio are now ALL derived by
    // the single shared reconcileStandaloneNodeState — the SAME method
    // loadNodeInternal's own initial load now calls too (see that
    // method's own doc comment). This replaces what used to be two
    // separately-gated blocks here: a "leaf" block that only re-derived
    // the four standalone-leaf projections when at least one was ALREADY
    // active pre-reload, and a "parent" block that only re-derived
    // standaloneParentListItemProjection when IT was already active —
    // between them, a node that reloaded from real-parent state down to
    // a genuine childless leaf (Phase 5L-9b's own real-device bug: an
    // editor Undo right after this pane's own Mode B Apply removing the
    // only child it just added) started with all four leaf fields null,
    // so neither block's own gate ever fired, leaving the pane stuck
    // showing neither a parent NOR a leaf. reconcileStandaloneNodeState
    // is called here unconditionally instead (never gated on "was some
    // projection already active"), which is safe precisely because this
    // method is only ever reached via classifySyncOutcome's own
    // clean-pane-auto-reload branch (`!isDirty()`) — see
    // reconcileStandaloneNodeState's own doc comment for the full
    // argument for why nothing pending can be lost by this.
    if (this.nodeId) {
      const reloadedNode = doc.nodes.get(this.nodeId);
      this.reconcileStandaloneNodeState(doc, this.nodeId, reloadedNode, newText);
    }
    if (this.paragraphAnchor) {
      this.paragraphAnchor = { ...this.paragraphAnchor, originalText: newText };
    }
    if (this.compositeAnchor) {
      const rules = getEnabledCompositeBlockRules(this.plugin.settings.compositeBlocks);
      const extracted = extractCompositeBlockText(doc, this.compositeAnchor, rules);
      if (extracted.ok && extracted.resolvedSnapshot) {
        this.compositeAnchor = extracted.resolvedSnapshot;
        // Phase 5D-2B: re-split/re-project the structured composite
        // session's own state too, exactly like loadCompositeInternal's
        // own initial load does — otherwise an auto-reload would refresh
        // originalText/textareaEl but leave compositeListOriginalText/
        // compositeListInputEl showing stale content. A split/projection
        // failure here degrades to the raw whole-range textarea, same as
        // at initial load.
        this.quoteProjection = null;
        this.compositeListOriginalText = null;
        // Phase 5D-2C: reset alongside compositeListOriginalText above —
        // see this field's own doc comment.
        this.listMarkerProjection = null;
        const memberSplit = splitCompositeBlockMembers(doc.lines, extracted.resolvedSnapshot);
        if (memberSplit.ok) {
          const built = buildQuotePrefixProjection(
            memberSplit.split.trailingRawText,
            memberSplit.split.trailingKind
          );
          if (built.ok) {
            this.quoteProjection = built.projection;
            // Phase 5D-2C: re-project the list member's own raw line
            // marker-free too, exactly like loadCompositeInternal's own
            // initial-load gate (kind === "single-line-list" AND
            // buildListMarkerProjection succeeds) — see that method's own
            // doc comment for the full rationale.
            const listBuilt = isListMemberEligibleForMarkerFreeProjection(
              extracted.resolvedSnapshot.members[0].kind
            )
              ? buildListMarkerProjection(memberSplit.split.listLineText)
              : null;
            this.listMarkerProjection = listBuilt?.ok ? listBuilt.projection : null;
            this.compositeListOriginalText = this.listMarkerProjection
              ? this.listMarkerProjection.body
              : memberSplit.split.listLineText;
          }
        }
      }
    }
    // Phase 5L-12: the ancestors/directChildren/siblingState trio for the
    // node-target case is now recomputed by reconcileStandaloneNodeState
    // above (nothing left to do here for it) — this used to be a
    // separate, duplicate recompute added as Phase 5L-9b's own real-device
    // bug fix; see reconcileStandaloneNodeState's own doc comment for
    // where that logic now lives.
    this.syncState = "synced";
    this.textareaEl.value = this.currentDisplayText();
    // Phase 5L-9b (bug fix, same real-device finding as the trio
    // recompute immediately above): rendered here for the first time in
    // this method, alongside the recompute that now keeps their own
    // backing fields fresh — mirrors renderLoadedState's own call order
    // for these three (breadcrumb, then sibling nav, then Subtree
    // Navigator) exactly.
    this.renderBreadcrumb();
    this.renderSiblingNav();
    this.renderSubtreeNavigator();
    this.renderQuoteHeader();
    this.renderCompositeListSlot();
    this.renderTaskCheckboxRow();
    this.renderOrderedNumberRow();
    this.renderParentChildPreview();
    this.renderLeafFirstChildAddRow();
    this.updateDirtyState();
  }

  /**
   * The Reload button's click handler (syncStatusReloadEl, onOpen). Clean
   * Pane (isDirty() === false): reloads immediately, no confirmation — per
   * this ticket's own explicit requirement. Dirty Pane: reuses the EXISTING
   * DiscardChangesModal (R2 — see that class's own doc comment for the
   * `showApply` extension), but with `showApply: false` and Reload-specific
   * title/body text — Apply is never offered here, since a dirty+stale/
   * unavailable Apply is guaranteed to be refused by the very same
   * fail-closed check that made this pane stale in the first place, and
   * offering it would only give a false expectation. "Cancel" (the only
   * other reachable choice — "apply" is never sent when showApply is
   * false) preserves the buffered edit and current syncState exactly as
   * they were; only "discard" proceeds to executeReload.
   */
  private async performReload(): Promise<void> {
    if (this.closed || !this.sourcePath) return;
    if (!this.nodeId && !this.paragraphAnchor && !this.compositeAnchor) return;

    if (this.isDirty()) {
      new DiscardChangesModal(
        this.app,
        this.plugin,
        (choice) => {
          if (choice === "discard") {
            void this.executeReload();
          }
          // "cancel": no-op — the buffered edit and current syncState stay
          // exactly as they were. ("apply" is unreachable here since the
          // modal is opened with showApply: false below.)
        },
        {
          showApply: false,
          titleKey: "partialEdit.reloadConfirmTitle",
          bodyKey: "partialEdit.reloadConfirmBody",
          discardButtonKey: "partialEdit.reloadConfirmDiscardButton",
        }
      ).open();
      return;
    }

    await this.executeReload();
  }

  /**
   * The actual read-then-resolve-then-apply-locally reload, shared by both
   * performReload's clean-Pane immediate path and its dirty-Pane
   * post-Discard path. Unlike performStaleCheck/evaluateAgainstText (which
   * restrict auto-textarea-updates to the E3/open-editor case only), an
   * EXPLICIT Reload is allowed to use `vault.cachedRead` (E4) too — the
   * user asked for this, so it is no longer an unsolicited auto-update.
   * A resolution failure here (still unavailable, or the ambiguous
   * paragraph case still unresolved) is the one place this ticket
   * escalates an "ambiguous" result to "unavailable" — see
   * resolveCurrentTarget's own doc comment for why a mere DETECTION leans
   * toward "stale" instead, while a deliberate, explicit Reload attempt
   * that still fails is treated as more conclusive.
   */
  private async executeReload(): Promise<void> {
    if (this.closed) return;
    const path = this.sourcePath;
    if (!path) return;

    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      this.transitionToUnavailable();
      new Notice(this.plugin.t("partialEdit.reloadFailedNotice"));
      return;
    }

    const openEditor = this.findOpenEditorForSourcePath();
    // Phase 5A-1 hardening §3: unlike performStaleCheck's own passive
    // cachedRead (which silently swallows a rejection — see that method's
    // own comment), this IS an explicit, user-requested action, so a read
    // failure here is treated exactly like any other resolution failure
    // just below: transition to "unavailable" and show the same
    // reloadFailedNotice (never the raw error/path itself). The buffered
    // textarea/quote-inputs and current anchor are left completely
    // untouched either way — this catch returns before performAutoReload
    // is ever reached.
    let text: string;
    try {
      text = openEditor ? openEditor.getValue() : await this.app.vault.cachedRead(file);
    } catch {
      if (this.closed || this.sourcePath !== path) return;
      this.transitionToUnavailable();
      new Notice(this.plugin.t("partialEdit.reloadFailedNotice"));
      return;
    }
    if (this.closed || this.sourcePath !== path) return;

    const doc = parseDocument(text);
    const resolved = this.resolveCurrentTarget(doc);
    if (!resolved.ok || resolved.text === null) {
      this.transitionToUnavailable();
      new Notice(this.plugin.t("partialEdit.reloadFailedNotice"));
      return;
    }

    this.performAutoReload(resolved.text, doc);
    new Notice(this.plugin.t("partialEdit.reloadedNotice"));
  }
}

type DiscardChangesChoice = "apply" | "discard" | "cancel";

/**
 * Phase 5B: the Apply/Discard/Cancel prompt PartialEditView.requestLoadNode
 * shows when it's asked to switch nodes while the pane has an unapplied
 * edit. A plain Obsidian Modal rather than anything home-grown — Modal's
 * own `open()` already shows on the window that's currently active (per
 * its doc comment in obsidian.d.ts), so this needs no cross-window
 * plumbing of its own to work correctly from a popped-out Partial Edit
 * Pane (Phase 5A) exactly as it does from the sidebar-docked pane.
 *
 * `onChoice` fires exactly once per modal instance, either from an
 * explicit button click (choose()) or, if the modal is dismissed any other
 * way (Escape key, clicking the backdrop), from onClose() below — treated
 * the same as an explicit Cancel, since either way the answer to "should
 * the pending edit be discarded" is no.
 */
/**
 * Phase 5A-1 (R2, minimal-change extension): `showApply` defaults to
 * `true`, so every pre-existing call site (requestLoadNode/
 * requestLoadParagraphAtCursor/requestLoadComposite's own node-switch
 * guard, all THREE unchanged by this ticket, still calling
 * `new DiscardChangesModal(this.app, this.plugin, (choice) => {...})`
 * with no 4th argument) keeps its exact pre-5A-1 Apply/Discard/Cancel
 * behavior byte-for-byte. Only the NEW dirty+stale/unavailable Reload
 * confirmation (PartialEditView#performReload) passes
 * `{ showApply: false, titleKey: ..., bodyKey: ... }`, per this ticket's
 * own explicit requirement that a stale/unavailable Reload confirmation
 * must never offer Apply as a choice (a stale Apply is guaranteed to be
 * refused as a conflict by the existing, unchanged fail-closed check —
 * offering it would give the user a false expectation). `titleKey`/
 * `bodyKey` default to the original unsavedChanges* keys, so the
 * node-switch-guard call sites' wording is also completely unchanged.
 *
 * `discardButtonKey` (2026-09-08 UX fix, real-device B-1 feedback):
 * defaults to `undefined`, in which case onOpen falls back to
 * `common.discard` exactly as before — so all three node-switch call
 * sites, none of which pass this option, keep showing the shared plain
 * "Discard"/"破棄" label byte-for-byte unchanged. Only performReload's
 * Reload confirmation passes `partialEdit.reloadConfirmDiscardButton`
 * ("Discard changes and reload" / "変更を破棄して再読み込み"): a bare
 * "Discard" is ambiguous in a dialog whose only two choices are that
 * button and Cancel (does it discard the edits and leave the pane as-is,
 * or does it also reload?) — this dialog's one real action is BOTH
 * discarding the pane's unapplied edits AND reloading the current note
 * content, and the label says so explicitly. A separate key (rather than
 * changing `common.discard` itself, which is shared with the three
 * node-switch call sites) keeps their wording untouched. Deliberately
 * never uses "Apply"/"Reapply"/"Save"/"Overwrite" (or their ja
 * equivalents) — this modal's Reload context never offers Apply as a
 * choice (`showApply: false`), and a stale/unavailable Apply would be
 * refused as a conflict by the unchanged low-level fail-closed check
 * regardless, so such wording would only mislead the user about what this
 * dialog can do.
 */
/**
 * Button-row consolidation (2026-09-16 ticket, real-device UX feedback):
 * the Partial Edit Pane's own top-level toolbar has exactly two buttons,
 * "Apply"/"Cancel" (where its "Cancel" discards and closes). This modal
 * previously showed THREE buttons, "Apply"/"Discard"/"Cancel", where its
 * own "Cancel" meant something different (stay, do nothing) from the
 * pane's "Cancel" -- a semantic collision. Fixed by presentation only:
 *   - The explicit "Cancel" button (internal choice `"cancel"`) is
 *     REMOVED from the button row. "Stay here, keep editing" is reached
 *     only via x/Escape/outside-click, exactly as onClose() already
 *     implemented before this change (see its own comment below) -- no
 *     new code path, just one fewer redundant explicit control for it.
 *   - The "Discard" button's internal choice is UNCHANGED
 *     (`"discard"`); only its DISPLAYED label changes, via
 *     `discardButtonKey`'s new default `partialEdit
 *     .unsavedChangesDiscardButtonLabel` ("Cancel"/"キャンセル") instead
 *     of the old default `common.discard` ("Discard"/"破棄") -- so this
 *     button now reads "Cancel" to match the pane's own top-level button,
 *     while still meaning discard-and-proceed internally.
 *   - The "Apply" button (`"apply"`) is untouched.
 * DiscardChangesChoice's three values, and every caller's switch over
 * them (requestLoadNode/requestLoadParagraphAtCursor/requestLoadComposite/
 * performReload/the Phase 5L-8 and 5L-9 target-switch guards), are
 * UNCHANGED -- this is a wording/button-count change only, never a
 * remapping of what any internal choice means. One structural side
 * effect: performReload's Reload confirmation (`showApply: false`, its
 * own `discardButtonKey`) now shows a single visible button, since it
 * never had an explicit Cancel button of its own either -- stay-here for
 * that dialog was, and remains, x/Escape/outside-click only.
 */
interface DiscardChangesModalOptions {
  showApply?: boolean;
  titleKey?: TranslationKey;
  bodyKey?: TranslationKey;
  discardButtonKey?: TranslationKey;
}

class DiscardChangesModal extends Modal {
  private resolved = false;

  constructor(
    app: App,
    private readonly plugin: UnifiedOutlinerPlugin,
    private readonly onChoice: (choice: DiscardChangesChoice) => void,
    private readonly options: DiscardChangesModalOptions = {}
  ) {
    super(app);
  }

  onOpen(): void {
    const showApply = this.options.showApply ?? true;
    this.titleEl.setText(this.plugin.t(this.options.titleKey ?? "partialEdit.unsavedChangesTitle"));
    this.contentEl.createEl("p", {
      text: this.plugin.t(this.options.bodyKey ?? "partialEdit.unsavedChangesBody"),
    });

    const buttonsEl = this.contentEl.createDiv({
      cls: "unified-outliner-partial-edit-modal-buttons",
    });
    if (showApply) {
      const applyEl = buttonsEl.createEl("button", {
        text: this.plugin.t("common.apply"),
        cls: "mod-cta",
      });
      applyEl.addEventListener("click", () => this.choose("apply"));
    }
    const discardEl = buttonsEl.createEl("button", {
      text: this.plugin.t(this.options.discardButtonKey ?? "partialEdit.unsavedChangesDiscardButtonLabel"),
    });
    discardEl.addEventListener("click", () => this.choose("discard"));
  }

  private choose(choice: DiscardChangesChoice): void {
    this.resolved = true;
    this.close();
    this.onChoice(choice);
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.resolved) {
      this.onChoice("cancel");
    }
  }
}

/**
 * Phase 5L-9 ("Direct Child Add/Delete in Parent Partial Edit Pane"): the
 * delete confirmation Modal §5 requires ("a real Obsidian-style Modal with
 * at minimum '削除する'/'キャンセル' choices"). Deliberately a separate,
 * simpler two-choice Modal — never DiscardChangesModal reused with
 * `showApply: false` — because this one is not itself an unsaved-changes
 * guard at all (it fires REGARDLESS of whether the target child's own body
 * is empty, per §5's own "confirmation is required regardless of whether
 * the child's body is empty" requirement); reusing DiscardChangesModal's
 * own "apply/discard/cancel" vocabulary here would misleadingly imply an
 * Apply option exists. Dismissing any other way (Escape, clicking
 * outside) resolves to "not confirmed" — mirrors DiscardChangesModal's own
 * "any other dismissal is Cancel" contract exactly.
 */
class ChildDeleteConfirmModal extends Modal {
  private resolved = false;

  constructor(
    app: App,
    private readonly plugin: UnifiedOutlinerPlugin,
    private readonly onChoice: (confirmed: boolean) => void
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(this.plugin.t("partialEdit.parentChildDeleteConfirmTitle"));
    this.contentEl.createEl("p", { text: this.plugin.t("partialEdit.parentChildDeleteConfirmBody") });

    const buttonsEl = this.contentEl.createDiv({
      cls: "unified-outliner-partial-edit-modal-buttons",
    });
    const confirmEl = buttonsEl.createEl("button", {
      text: this.plugin.t("partialEdit.parentChildDeleteConfirmButton"),
      cls: "mod-warning",
    });
    confirmEl.addEventListener("click", () => this.choose(true));
    const cancelEl = buttonsEl.createEl("button", { text: this.plugin.t("common.cancel") });
    cancelEl.addEventListener("click", () => this.choose(false));
  }

  private choose(confirmed: boolean): void {
    this.resolved = true;
    this.close();
    this.onChoice(confirmed);
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.resolved) {
      this.onChoice(false);
    }
  }
}
