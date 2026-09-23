/**
 * Phase 2A: Outline Tree View (docs/別ペイン実装計画と当面の実装指示.md §3.1).
 *
 * A sidebar panel that visualizes the active Markdown note's heading
 * structure as a tree, kept in sync with the body editor in both
 * directions (click a node -> jump the cursor there; move the cursor in
 * the body -> highlight the corresponding node).
 *
 * Phase 2B (docs §5–6) adds tree-triggered *block-scoped* structure editing
 * on top of that: right-click a node for "Move subtree up/down" and
 * "Indent/Outdent subtree", which cascade through the whole section subtree
 * exactly like the body-editor's move-block-up/down and indent-block /
 * outdent-block commands (section-subtree) — because they call the very same pure
 * functions (see tree/treeBlockCommand.ts).
 *
 * Phase 2C (docs §6.3) adds a second, *fold-aware contextual* layer on top
 * of that, in the same right-click menu: "Move up/down (contextual)" and
 * "Indent/Outdent (contextual)" resolve to the block-scoped command when
 * the clicked node is collapsed IN THIS TREE, or to the node-only command
 * (single heading line, no subtree cascade — see tree/treeNodeOnlyCommand.ts)
 * when it is expanded. This is purely a Tree View convenience: the fold
 * state consulted is this view's own local collapsedIds, never the body
 * editor's CM6 fold state, and the body editor's own commands never gain
 * this contextual behavior (docs §2.1/§2.2: body-editor command meaning
 * must never depend on fold state). The explicit, always-block-scoped
 * "Move/Indent/Outdent subtree" items from Phase 2B stay in the menu
 * unchanged, so a predictable, fold-independent operation is always one
 * click away regardless of what the contextual entries would do.
 *
 * The tree's own expand/collapse state is local UI state only, unrelated
 * to the CodeMirror fold state in the body editor (docs §2.2: fold state
 * must never change a body-editor command's meaning; this view doesn't
 * touch or read CM6 fold state at all).
 *
 * Structure logic lives in ../tree/ and ../move/ as plain functions with no
 * Obsidian dependency (buildOutlineTree, resolveHighlightedSectionId,
 * treeBlockCommand, treeNodeOnlyCommand, treeContextualCommand,
 * relocateSection) — this view only wires them to the Obsidian Editor via
 * ../commands/applyLineEditOutcome.ts, which is itself shared with
 * main.ts's body-editor commands.
 *
 * Phase 3A (docs §7, drag & drop) adds a direct-manipulation alternative to
 * the Phase 2B "Move/Indent/Outdent subtree" menu items: dragging a node's
 * row lets the user drop its whole section subtree before, after, or
 * inside another section, without opening a menu. The right-click menu is
 * left completely unchanged — drag & drop is an addition, not a
 * replacement, per the same "fast direct manipulation alongside a slower
 * but explicit and predictable command" philosophy Phase 2C already
 * established for contextual vs. explicit commands. Through Phase 3B, only
 * section subtrees could ever appear in the tree at all (never a single
 * node-only move, and never a list item).
 *
 * Phase 3C (docs, "Outline List Display & Basic Operations") adds list
 * items to the tree itself, opt-in via settings.showListItemsInOutline
 * (default off — see buildOutlineTree's includeLists option). This phase is
 * deliberately visualization-first: list nodes get click-to-jump, cursor
 * highlight sync, and fold like section nodes (all already generic over
 * node id in this view, so they needed no kind-specific branching), but do
 * NOT get the right-click structure menu, drag & drop, or Partial Edit
 * Pane — those stay section-only for now (see 今回実装しないもの in the
 * phase's spec). renderNode() below is the only place that branches on
 * node.kind to decide which of those behaviors to attach.
 *
 * Phase 4A ("List Subtree Relocation in Outline") promotes list nodes from
 * "visible" to "directly editable": they now get drag & drop too, reusing
 * the exact same drag-state management (dragSourceId, dropIndicatorEl,
 * computeDropMode, endDrag — none of that is section-specific) and the
 * exact same handler methods (handleDragStart/Over/Leave/Drop/End) as
 * section drag & drop. Only the pure resolve/relocate call differs by the
 * DRAGGED node's kind — canDropAny()/runRelocateCommand() below branch once
 * on that and delegate to move/relocateSection.ts (section source,
 * completely unchanged from Phase 3A) or move/relocateListSubtree.ts (list
 * source, new). A section can still only be dropped onto another section
 * (canDropOn's own type guard already enforces this, untouched); a list
 * item can be dropped onto another list item OR a section. The right-click
 * structure menu remains section-only, unchanged from Phase 3C.
 *
 * Phase 4B ("Multiline List Body Tooltip Design & Implementation") extends
 * a list node's tooltip beyond the single truncated first line Phase 3C.1
 * introduced: it now shows the item's own FULL body — first line plus any
 * continuation lines — via edit/listBodyRange.ts's extractListItemBodyText,
 * a pure function operating on this.currentDoc (never re-parsed here). The
 * Outline LABEL itself is unaffected (still one CSS-truncated line, per
 * Phase 3C.1's UX note that the tree must stay scannable); only the
 * tooltip's content grows. Nested child list items are intentionally
 * excluded from the tooltip text (they already have their own visible rows
 * in the tree when expanded), so the tooltip communicates "what text this
 * exact row's drag & drop would carry with it" — not the whole subtree.
 * Section node tooltips are untouched by this phase.
 *
 * Phase 4C ("List Subtree Partial Edit Pane") gives list nodes a right-
 * click menu of their own for the first time — a single item, "Edit list
 * subtree in pane" (showListCommandMenu below), which opens the exact same
 * Partial Edit Pane sections already use via activatePartialEditView
 * (main.ts). That pane's loadNode/applyEdit already accept either node
 * kind (edit/partialEdit.ts's extractSubtreeText/applySubtreeEdit are
 * kind-generic), so nothing on this view's side had to change beyond
 * adding this one menu and wiring it up — this deliberately does NOT fold
 * list support into showStructureCommandMenu's larger move/indent/outdent/
 * contextual menu, which remains section-only exactly as it was through
 * Phase 4B. A list item with unsafeIndent (mixed tab/space indentation)
 * shows this one menu item disabled, mirroring showStructureCommandMenu's
 * own feasibility-check-then-flag pattern for infeasible operations.
 * (Post-Phase-5A follow-up: showListCommandMenu later gained the
 * block-scoped Move/Indent/Outdent subset of that larger menu too — see
 * that method's own doc comment.)
 *
 * Keyboard navigation (post-Phase-4D) makes the tree itself operable
 * without a mouse: when this view's own root element has focus, Up/Down
 * moves a KEYBOARD SELECTION between the currently visible rows (fold-
 * aware — see tree/outlineNavigation.ts's flattenVisibleOutlineTree),
 * Right expands a collapsed node or steps into its first child, Left
 * collapses an expanded node or steps out to its parent, and Enter jumps
 * to the selected row exactly like clicking it (reuses jumpToLine). This
 * selection (`this.selectedId`, styled `.unified-outliner-selected`) is a
 * SEPARATE piece of state from the body-editor cursor sync
 * (`this.highlightedId`, styled `.unified-outliner-current`), and moving
 * the body editor's cursor never overrides an in-progress sidebar
 * selection (see ensureSelection's doc comment). The selection highlight
 * itself only renders while this view's root element actually has DOM
 * focus, mirroring how Obsidian's own File Explorer treats is-selected vs
 * is-active.
 *
 * Post-Phase-3D update (user-requested after manual testing of the
 * Phase 3D fold sync, then made configurable after further feedback):
 * moving the keyboard selection to a DIFFERENT node (Up/Down, or
 * Right/Left's "step into child"/"step out to parent" branches) ALSO
 * previews that node into the body editor exactly like a row click — same
 * `jumpToLine(..., { focusEditor: false })` call, so the body cursor/
 * scroll follows without stealing DOM focus away from the tree panel (see
 * followSelectionIntoBody). Toggling fold in place (Right/Left's other
 * branches) never triggers this, since selectedId doesn't change there.
 *
 * This is gated by `plugin.settings.followKeyboardSelectionIntoBody`
 * (default true — this IS the current shipped behavior described above).
 * Turning it off restores the original Phase 4D behavior verbatim: arrow
 * keys move only the tree's own selection, and only Enter jumps into the
 * body — a compatibility mode for users who'd rather explore the tree
 * structure without the body editor's scroll position jumping on every
 * arrow press. The gating decision itself (did selectedId actually change,
 * AND is the setting on) is centralized in the pure
 * `shouldFollowKeyboardSelectionIntoBody` (tree/outlineNavigation.ts) so
 * it's covered by tests/outlineNavigation.test.ts without any
 * Obsidian/DOM dependency — see that function's doc comment for why the
 * DOM-focus side of this story stays a manual/実機 verification concern
 * instead.
 */
import {
  Editor,
  ItemView,
  Menu,
  MarkdownView,
  Notice,
  Platform,
  TFile,
  WorkspaceLeaf,
  debounce,
  setIcon,
  setTooltip,
} from "obsidian";
import { EditorView, ViewUpdate } from "@codemirror/view";
import { foldEffect, unfoldEffect } from "@codemirror/language";
import { Annotation, Extension } from "@codemirror/state";
import type UnifiedOutlinerPlugin from "../main";
import { parseDocument } from "../parser/parseDocument";
import {
  BlockNode,
  isListNode,
  isSectionNode,
  ListBlockNode,
  ParsedDocument,
  SectionBlockNode,
} from "../model/block";
import {
  buildOutlineTree,
  BuildOutlineTreeOptions,
  collectReadOnlyOutlineNodeIds,
  collectCompositeGroupInfo,
  CompositeGroupInfo,
  headingPrefixText,
  isOutlineCompositeNode,
  isOutlineComplexMemberNode,
  isOutlineListNode,
  isOutlineParagraphNode,
  isOutlineSectionNode,
  listItemDisplayText,
  OutlineTreeComplexMemberNode,
  OutlineTreeNode,
  OutlineTreeParagraphNode,
  paragraphTreeLabel,
  standaloneComplexBlockLabel,
} from "../tree/buildOutlineTree";
import { canCollapseOutlineNode } from "../tree/hasFoldableContent";
import { complexBlockDepth, scanComplexBlocks } from "../parser/complexBlocks";
import {
  evaluateCompositeBlockDeletability,
  evaluateCompositeBlockMovability,
  evaluateStandaloneComplexBlockMovability,
  matchCompositeBlocks,
} from "../parser/compositeBlocks";
import { CompositeBlockInfo, CompositeBlockRule } from "../model/compositeBlock";
import { ComplexBlockInfo, ComplexBlockScanResult } from "../model/complexBlock";
import {
  buildCompositeBlockSnapshot,
  CompositeBlockSnapshot,
  deleteCompositeBlock,
} from "../edit/deleteCompositeBlock";
import { CompositeMoveDirection, findCompositeMoveTarget } from "../move/findCompositeMoveTarget";
import { compositeMoveReasonText, moveCompositeBlock } from "../edit/moveCompositeBlock";
import {
  CompositeBlockDropTargetCandidate,
  CompositeBlockDropTargetHint,
  CompositeBlockDropZone,
  resolveCompositeBlockDropTarget,
} from "../move/findCompositeBlockDropTarget";
import { dropCompositeBlock } from "../edit/dropCompositeBlock";
import { StandaloneMoveDirection } from "../move/findStandaloneComplexBlockMoveTarget";
import {
  buildStandaloneComplexBlockSnapshot,
  moveStandaloneComplexBlock,
  snapshotMatches,
  StandaloneComplexBlockSnapshot,
  standaloneComplexBlockMoveReasonText,
} from "../edit/moveStandaloneComplexBlock";
import { dropStandaloneComplexBlock } from "../edit/dropStandaloneComplexBlock";
import {
  buildStandaloneComplexBlockDeleteSnapshot,
  deleteStandaloneComplexBlock,
  StandaloneComplexBlockDeleteSnapshot,
  standaloneComplexBlockDeleteReasonText,
} from "../edit/deleteStandaloneComplexBlock";
import { ConfirmFencedCodeDeleteModal } from "./ConfirmFencedCodeDeleteModal";
import {
  resolveStandaloneComplexBlockDropTarget,
  StandaloneComplexBlockDropTargetHint,
  StandaloneComplexBlockDropZone,
} from "../move/findStandaloneComplexBlockDropTarget";
import {
  buildParagraphMoveAnchor,
  moveParagraphFromAnchor,
  ParagraphDropTargetHint,
  ParagraphDropZone,
  ParagraphMoveAnchor,
  paragraphTreeMoveReasonText,
  resolveParagraphDropDirection,
  resolveParagraphFromTreeHint,
} from "../edit/paragraphTreeMove";
import {
  buildSiblingTargetAnchor,
  listNonAdjacentMoveTargets,
  moveParagraphNonAdjacent,
  NonAdjacentMovePosition,
  paragraphNonAdjacentMoveReasonText,
  SiblingTargetAnchor,
} from "../edit/paragraphNonAdjacentMove";
import {
  deleteParagraph,
  isInScopeParagraphParent,
  paragraphDeleteReasonText,
} from "../edit/deleteParagraph";
import {
  canSafelyRollbackParagraphInsert,
  insertParagraph,
  ParagraphInsertPosition,
  paragraphInsertReasonText,
} from "../edit/insertParagraph";
import { ConfirmParagraphDeleteModal } from "./ConfirmParagraphDeleteModal";
import { findComplexSiblingTarget, ResolvedMoveUnit } from "../move/resolveMoveTarget";
import { getEnabledCompositeBlockRules } from "../settingsDefaults";
import { resolveCurrentPositionNodeId } from "../tree/resolveCurrentPositionNodeId";
import {
  buildNodeByIdMap,
  buildParentIdMap,
  flattenVisibleOutlineTree,
  isOutlineNodeVisible,
  nextVisibleId,
  prevVisibleId,
  resolveNearestVisibleAncestorId,
  shouldFollowKeyboardSelectionIntoBody,
} from "../tree/outlineNavigation";
import { buildNodeIdentityMap, findNodeIdAtStartLine } from "../tree/foldIdentity";
import {
  exceedsLongPressMoveThreshold,
  LONG_PRESS_DURATION_MS,
} from "../tree/longPressGesture";
import { findMoveTarget, MoveDirection } from "../move/findMoveTarget";
import { findIndentTarget } from "../move/findIndentTarget";
import { findNodeOnlyMoveTarget } from "../move/findNodeOnlyMoveTarget";
import { findNodeOnlyLevelTarget } from "../level/findNodeOnlyLevelTarget";
import {
  runTreeBlockCommand,
  TreeBlockCommandOptions,
} from "../tree/treeBlockCommand";
import { runTreeContextualCommand } from "../tree/treeContextualCommand";
import { TreeStructureOperation } from "../tree/treeOperation";
import { canDropOn, DropMode, relocateSection } from "../move/relocateSection";
import { canDropListOn, relocateListSubtree } from "../move/relocateListSubtree";
import { extractListItemBodyText } from "../edit/listBodyRange";
import { deleteBlock } from "../edit/deleteBlock";
import {
  contentColumnOf,
  insertChildListItem,
  insertSiblingListItem,
  insertSiblingSection,
} from "../edit/insertBlock";
import {
  ListRenameSnapshot,
  renameListItem,
  renameSection,
  SectionRenameSnapshot,
} from "../edit/renameBlock";
import { HeadingLevelModal } from "./HeadingLevelModal";
import { ConfirmCompositeDeleteModal } from "./ConfirmCompositeDeleteModal";
import {
  ContainsCheckable,
  isDoubleClickPointerDown,
  isEligibleRowBodyPointerDown,
  RowPointerDownRecord,
} from "./rowDoubleClickDetector";
import { applyLineEditOutcome, LineEditOutcome } from "../commands/applyLineEditOutcome";
import { applyParagraphEdit, paragraphEditTextContainsBlankLine } from "../edit/paragraphPartialEdit";
import { evaluateRenameNoteIdentity } from "../edit/renameNoteIdentityGuard";
import { TranslationKey } from "../i18n";

export const OUTLINE_TREE_VIEW_TYPE = "unified-outliner-outline-tree";

/**
 * Phase 3D stage 3: tags a CM6 transaction as originating from THIS
 * plugin's own Outline Tree -> body-editor fold sync (syncFoldToBodyEditor
 * below), so the CM6 -> Outline Tree listener (createCm6FoldSyncExtension,
 * bottom of this file) can recognize and ignore its own echo instead of
 * feeding it back into FoldStateManager. This is the infinite-loop guard:
 * without it, every Tree-initiated fold would immediately be re-observed
 * by the same listener that's supposed to be watching for the OPPOSITE
 * direction (fold changes the user made directly in the body editor), and
 * would round-trip back through setNodeCollapsed/refreshOutlineTreeViews
 * for no reason. A CM6 Annotation (not a StateEffect) is the correct tool
 * for this — it's metadata carried on the transaction itself, not part of
 * the document/fold state, so it doesn't affect what foldedRanges() or any
 * other consumer of the editor state sees.
 */
const outlineTreeFoldOrigin = Annotation.define<true>();

/**
 * Reaches into an Obsidian `Editor` to retrieve its underlying CM6
 * `EditorView`, via the `.cm` property Obsidian's Editor wrapper exposes —
 * an unofficial but extremely long-stable convention across the plugin
 * ecosystem, not part of obsidian.d.ts (see scrollLineToTop below for the
 * full rationale on why this is the sanctioned way to interoperate with
 * CM6). Centralized here (instead of repeating the cast at each call site)
 * so there is exactly one `unknown`-mediated cast in this file to review;
 * every caller still gets `EditorView | undefined` and must handle the
 * `undefined` case explicitly (the private `.cm` field could in principle
 * be renamed/removed by a future Obsidian version).
 */
function getEditorCmView(editor: Editor): EditorView | undefined {
  const withCm = editor as unknown as { cm?: EditorView };
  return withCm.cm;
}

/**
 * Phase 5T-2 ("Outline Tree paragraph の D&D による安全な隣接 swap", desktop
 * only, plan A only — docs/phase5t2_paragraph-tree-dnd-design.md): the
 * live state of an in-progress paragraph drag, captured entirely at
 * dragstart (see handleParagraphDragStart below) and never mutated
 * afterward — a rejection or a document change simply throws the whole
 * session away (cancelParagraphDrag) rather than trying to patch it.
 *
 * `anchor` is the ONLY field this session's own dragover/drop handlers
 * ever use to decide safety — it is re-resolved from scratch, three
 * stages deep, by resolveParagraphDropDirection/moveParagraphFromAnchor
 * every single time, exactly like the 5T-1 context-menu path. The other
 * fields exist purely so dragend/refresh/Escape cleanup can find and
 * unmark the right DOM row and so a self-drop can be recognized quickly —
 * they are NEVER used as a parser id, a fold id, a persistent selection
 * id, or any part of the actual move decision (design doc §2's "tree-
 * paragraph:N は...drag payload の永続キーとして使わない" applies verbatim
 * to `sourceTreeNodeId` here).
 */
interface ParagraphDragSession {
  /** Captured once at dragstart via buildParagraphMoveAnchor — see this module's paragraphTreeMove.ts import. Re-verified fresh (never trusted as-is) by resolveParagraphDropDirection/moveParagraphFromAnchor at every dragover and at drop. */
  anchor: ParagraphMoveAnchor;
  /** The dragged row's OWN Tree view id (`tree-paragraph:N`) — DOM cleanup / row-highlight bookkeeping ONLY, never a comparison key for identity or safety. */
  sourceTreeNodeId: string;
  /** Mirrors anchor.rangeStart/rangeEnd/parentId at the moment the drag began — used only as a UI-time hint (e.g. self-drop short-circuit) alongside the anchor; the anchor itself remains the sole safety-bearing field. */
  sourceRangeStart: number;
  sourceRangeEnd: number;
  sourceParentId: string | null;
}

/**
 * Phase 5D-3C ("Callout and Blockquote Drag and Drop", 案A approved):
 * drag session state for a standalone OR CompositeBlock-member callout/
 * blockquote row being dragged as a D&D SOURCE — the callout/blockquote
 * counterpart to ParagraphDragSession above, deliberately just as thin:
 * the ONLY safety-bearing field is `snapshot` (re-verified fresh, never
 * trusted as-is, by resolveStandaloneComplexBlockDropTarget/
 * dropStandaloneComplexBlock at every dragover and at drop — mirrors
 * ParagraphDragSession.anchor's own role exactly). Deliberately NOT the
 * SAME field as `paragraphDragSession`: a single native HTML5 drag
 * operation can only have one source, but keeping the two session types as
 * separate, independently-nullable fields (rather than a tagged union)
 * lets every existing paragraphDragSession call site stay byte-for-byte
 * unchanged — this ticket only ADDS a new field and new call sites that
 * check it, mirroring how endDrag() already clears both unconditionally
 * (see that method's own updated doc comment).
 */
interface StandaloneComplexBlockDragSession {
  /** Captured once at dragstart via buildStandaloneComplexBlockSnapshot — see this module's moveStandaloneComplexBlock.ts import (the EXACT same snapshot type/builder Move already uses, reused unchanged per this ticket's own approval). */
  snapshot: StandaloneComplexBlockSnapshot;
  /** The dragged row's OWN Tree view id — DOM cleanup / row-highlight bookkeeping ONLY, never a comparison key for identity or safety (mirrors ParagraphDragSession.sourceTreeNodeId's own role). */
  sourceTreeNodeId: string;
}

/**
 * Phase 5D-4C ("CompositeBlock Atomic Drag-and-Drop 最小実装", Phase 5D-4B
 * design approved): drag session state for a CompositeBlock PARENT row
 * being dragged as a D&D SOURCE — the CompositeBlock counterpart to
 * StandaloneComplexBlockDragSession above, deliberately just as thin: the
 * ONLY safety-bearing field is `snapshot` (re-verified fresh, never
 * trusted as-is, by resolveCompositeBlockDropTarget/dropCompositeBlock/
 * moveCompositeBlock at every dragover and at drop — mirrors
 * StandaloneComplexBlockDragSession.snapshot's own role exactly).
 * Deliberately a SEPARATE field from dragSourceId/paragraphDragSession/
 * calloutDragSession — a single native HTML5 drag operation can only have
 * one source, so only one of the four session fields is ever set at a
 * time, but keeping each as its own independently-nullable field (rather
 * than a tagged union) lets every existing session's call sites stay
 * byte-for-byte unchanged — this ticket only ADDS a new field and new
 * call sites that check it, mirroring how endDrag() already clears all
 * three existing sessions unconditionally (see that method's own updated
 * doc comment).
 */
interface CompositeDragSession {
  /** Captured once at dragstart via buildCompositeBlockSnapshot — the EXACT same snapshot type/builder showCompositeCommandMenu's own Move/Delete items already use. */
  snapshot: CompositeBlockSnapshot;
  /** The dragged row's OWN Tree view id (the composite's own `composite-N` id) — DOM cleanup / row-highlight bookkeeping ONLY, never a comparison key for identity or safety (mirrors the other drag sessions' own sourceTreeNodeId role). */
  sourceTreeNodeId: string;
}

export class OutlineTreeView extends ItemView {
  private treeRootEl!: HTMLElement;
  // Keyed by the CURRENT parse's node.id, exactly as every prior phase —
  // every existing consumer (renderNode, flattenVisibleOutlineTree, the
  // structure/list context menus' contextual-mode check) keeps working
  // unmodified. As of Phase 4E this field is reassigned wholesale at the
  // start of every refresh() (deriveCollapsedIds()) rather than surviving
  // across refreshes by itself — see that method's doc comment.
  private collapsedIds = new Set<string>();
  private highlightedId: string | null = null;
  private currentTree: OutlineTreeNode[] = [];
  // Cached alongside currentTree so Phase 2B commands can resolve a
  // clicked node's id against the SAME parse the tree was built from —
  // section ids (`sec-N`) are only stable within one parseDocument() call
  // (see parser/parseDocument.ts), not across separate re-parses.
  private currentDoc: ParsedDocument | null = null;
  // Shared with PartialEditView via plugin.activeMarkdownView — see the
  // doc comment on that field in main.ts for why this must be ONE
  // instance rather than one per view.
  private get activeMarkdownView() {
    return this.plugin.activeMarkdownView;
  }

  // Keyboard navigation state (post-Phase-4D — see class doc comment).
  // nodeById/parentIdById are rebuilt alongside currentTree/currentDoc in
  // refresh() (never stale relative to the tree currently on screen).
  // selectedId deliberately survives across refresh() calls that don't
  // invalidate it (see ensureSelection) so an in-progress sidebar
  // navigation isn't reset by an unrelated body-editor event debounce.
  private selectedId: string | null = null;
  private nodeById: Map<string, OutlineTreeNode> = new Map();
  private parentIdById: Map<string, string | null> = new Map();
  // Phase 5D-0.3 (2026-08-12 amendment §A/§E): every node id that must
  // render/behave read-only — a CompositeBlock's own row, every one of its
  // member rows, and any further-nested list item under one of those member
  // rows. Rebuilt alongside currentTree/nodeById in refresh() via the pure
  // tree/buildOutlineTree.ts#collectReadOnlyOutlineNodeIds (see that
  // function's own doc comment for why this replaced an earlier
  // insideComposite boolean threaded through renderNode's recursive calls).
  // Consulted both by renderNode (to skip attaching rename/drag-drop/
  // context-menu/mobile-long-press listeners) AND by the structural-command
  // entry points themselves (beginRenameForNode, showStructureCommandMenu,
  // showListCommandMenu) as a second, defense-in-depth check — so even a
  // call that bypasses the DOM listeners entirely (e.g. the F2 keyboard
  // shortcut acting on whatever is currently selectedId) still safely
  // refuses rather than reaching a structural-edit code path for a
  // composite/member node.
  private readOnlyNodeIds: Set<string> = new Set();
  // UI-only follow-up (2026-09-08, "Outline Tree の CompositeBlock 視認性改
  // 善"): display-only grouping info for the CompositeBlock left-accent-
  // border + tint indicator (renderNode's `compositeGroupMember`/
  // `compositeGroupEnd` locals, styles.css's
  // `.unified-outliner-composite-accent`) — rebuilt alongside
  // readOnlyNodeIds/currentTree in refresh() via the pure
  // tree/buildOutlineTree.ts#collectCompositeGroupInfo. Deliberately NOT
  // derived from readOnlyNodeIds itself: that set also contains every
  // "paragraph" row (Phase 5P-3), which must never get this visual
  // treatment — see collectCompositeGroupInfo's own doc comment. Carries no
  // edit-capability/read-only meaning of its own; purely a rendering input.
  private compositeGroupInfo: CompositeGroupInfo = { groupNodeIds: new Set(), groupEndNodeIds: new Set() };
  // Phase 5C-1 ticket 3b: the CompositeBlockInfo[] and ComplexBlockScanResult
  // this refresh() cycle computed — mirrors this.currentTree's composite rows
  // one-to-one via id, WITHIN this one refresh cycle only. MENU-BUILD-TIME
  // REFERENCE ONLY: showCompositeCommandMenu uses these solely to decide
  // whether to show the "Delete extended block" item and to build the
  // CompositeBlockSnapshot passed into the confirmation modal's closure. They
  // are NEVER consulted again once a snapshot exists — dispatchAndApplyCompositeDelete
  // always re-parses/re-scans/re-matches the editor's CURRENT text via
  // edit/deleteCompositeBlock.ts#deleteCompositeBlock at the moment of actual
  // deletion, and never trusts these fields (or the composite-N id they
  // momentarily carry) as the basis for whether that deletion is safe. See
  // that function's own doc comment for why a composite-N id cannot be
  // trusted to survive a re-parse.
  private currentComposites: CompositeBlockInfo[] = [];
  private currentComplexScan: ComplexBlockScanResult | null = null;
  // Phase 4E: fold-state persistence. currentFilePath is the vault-
  // relative path of the note this refresh's tree was built from (null
  // when there's no active note) — the key fold state is persisted under
  // (see persistence/foldStateManager.ts). nodeIdentityById maps this
  // parse's node.id to a content-based identity string stable ACROSS
  // re-parses and restarts (tree/foldIdentity.ts) — collapsedIds itself
  // stays keyed by node.id (unchanged, so every existing consumer of
  // collapsedIds needed no changes), but is now DERIVED each refresh from
  // the persisted identities rather than being a long-lived mutable field
  // — see deriveCollapsedIds()'s doc comment for why that also fixes a
  // latent cross-file bleed bug that predates this phase.
  private currentFilePath: string | null = null;
  private nodeIdentityById: Map<string, string> = new Map();
  // Whether this view's own root element currently holds DOM focus — the
  // selection highlight (.unified-outliner-selected) only renders while
  // true, so it never looks like a second, competing "current row" marker
  // when the user's actual focus (and thus their next keypress) is
  // somewhere else entirely (the body editor, another pane, etc.).
  private hasFocus = false;

  // Mobile gesture state (tap/long-press/menu — see renderNode's "Mobile
  // gesture" block for the full design). Set right before a long-press
  // timer opens the context menu, so the synthetic "click" event mobile
  // browsers dispatch on touch release (after the long-press's own
  // pointerup) is swallowed by the row's click handler instead of being
  // misread as a second tap on an already-selected row (which would
  // otherwise start an inline rename the user never asked for). Consumed
  // — reset back to false — the moment that one click handler runs, so it
  // never suppresses any click beyond the one immediately following a
  // long press.
  private suppressNextTapClick = false;

  // Phase 5T-7C ("Outline Tree の native dblclick 依存をやめ、pointerdown
  // ベースの独立二重クリック検出へ置き換える"): the single piece of state
  // this replacement detector needs — the most recent ELIGIBLE row-body
  // pointerdown (see rowDoubleClickDetector.ts's isEligibleRowBodyPointerDown),
  // regardless of which row/render pass produced it. Deliberately a single
  // instance field (not per-row closure state) so it survives renderTree()'s
  // unconditional full DOM rebuild on every click (see jumpToLine's own doc
  // comment) — the SAME requirement suppressNextTapClick above already meets
  // for the same reason. Consumed (reset to null) the moment a double click
  // is recognized, so a third rapid press starts a fresh pair rather than
  // re-pairing with an already-consumed press.
  private lastRowPointerDown: RowPointerDownRecord | null = null;

  // Phase 3A drag & drop state. All UI-only — the pure decision of where
  // a drop is even legal lives in move/relocateSection.ts's canDropOn, not
  // here; this view only tracks which element is mid-drag and which
  // element currently shows a drop indicator so it can clean both up
  // reliably (dragend always fires, even when a drop is cancelled).
  private dragSourceId: string | null = null;
  private draggingItemEl: HTMLElement | null = null;
  private dropIndicatorEl: HTMLElement | null = null;

  /**
   * Phase 5T-2: the in-progress paragraph drag, if any — see
   * ParagraphDragSession's own doc comment above. Deliberately a SEPARATE
   * field from dragSourceId (never string-id-keyed the way section/list
   * drag source is), but paragraph drags DO share draggingItemEl/
   * dropIndicatorEl above with section/list D&D (only one drag, of either
   * kind, is ever active at a time — see this field's own doc comment).
   */
  private paragraphDragSession: ParagraphDragSession | null = null;

  /**
   * Phase 5D-3C: the in-progress standalone/CompositeBlock-member
   * callout/blockquote drag, if any — see StandaloneComplexBlockDragSession's
   * own doc comment above. A SEPARATE field from both dragSourceId and
   * paragraphDragSession, for the same reason paragraphDragSession is its
   * own field rather than reusing dragSourceId (see that field's own doc
   * comment) — only one of the three is ever set at a time, and
   * endDrag() clears all three unconditionally (see that method's own
   * updated doc comment).
   */
  private calloutDragSession: StandaloneComplexBlockDragSession | null = null;

  /**
   * Phase 5D-4C: the in-progress CompositeBlock (parent row) drag, if any
   * — see CompositeDragSession's own doc comment. A SEPARATE field from
   * dragSourceId/paragraphDragSession/calloutDragSession, for the same
   * reason those are each their own field — only one of the four is ever
   * set at a time, and endDrag() clears all four unconditionally (see
   * that method's own updated doc comment).
   */
  private compositeDragSession: CompositeDragSession | null = null;

  /**
   * UXP-02 (2026-08-12, docs/uxp-02-long-press-menu-duplicate.md): the
   * single Menu instance THIS view most recently opened via
   * showTrackedMenu() below (showStructureCommandMenu's or
   * showListCommandMenu's contextmenu/long-press call sites), or null when
   * none is currently open. Neither Obsidian's own Menu class nor this
   * plugin previously tracked "the currently open menu" anywhere — each
   * call site just did `new Menu()...showAtMouseEvent(evt)` independently,
   * so long-pressing a second row before dismissing the first row's menu
   * left both open and stacked (confirmed as mobile-specific: desktop's
   * native OS-rendered context menu enforces "only one at a time" itself,
   * which is why this never surfaced there). Scoped ONLY to menus this
   * view itself creates — never touches Obsidian's own menus, other
   * plugins' menus, or any other view's menus (no DOM search, no global
   * menu registry, no Menu.prototype changes).
   */
  private activeMenu: Menu | null = null;

  /**
   * Inline rename state (section/list/paragraph — see edit/renameBlock.ts
   * for section/list and edit/paragraphPartialEdit.ts for paragraph).
   * Non-null exactly while a row's label is replaced with a <textarea>.
   * `snapshot` is whichever of SectionRenameSnapshot/ListRenameSnapshot/
   * ParagraphMoveAnchor matches `kind`, captured fresh when the rename
   * began — never the possibly-stale this.currentDoc — and re-verified
   * against a FRESH re-parse at commit time (see commitRename). While this
   * is set, refresh() bails out immediately (see its own guard) so an
   * unrelated debounced editor-change/active-leaf-change/keyup/mouseup
   * refresh never tears down the input mid-edit; only this view's own
   * commitRename / cancelRename ever clear it and re-render.
   *
   * Phase 5T-8A ("paragraph のダブルクリック動作を Partial Edit 起動から
   * inline rename へ統一する"): `kind: "paragraph"` reuses this SAME
   * textarea/keydown/blur/click UI and this SAME renameState shape as
   * section/list — only beginRename's own snapshot-construction branch and
   * commitRename's own outcome-dispatch branch differ per kind (see both
   * methods' own doc comments). `snapshot` for a paragraph rename is a
   * `ParagraphMoveAnchor` (edit/paragraphTreeMove.ts) — the exact same
   * anchor shape showParagraphMoveMenu/handleParagraphDragStart already
   * build via resolveParagraphFromTreeHint + buildParagraphMoveAnchor, and
   * a structural superset of edit/paragraphPartialEdit.ts's own
   * `ParagraphEditAnchor` (complexBlockId/parentId/depth/originalText), so
   * it can be passed directly to applyParagraphEdit at commit time with no
   * conversion.
   */
  private renameState: {
    nodeId: string;
    kind: "section" | "list" | "paragraph";
    inputEl: HTMLTextAreaElement;
    rowSelfEl: HTMLElement;
    snapshot: SectionRenameSnapshot | ListRenameSnapshot | ParagraphMoveAnchor;
    /**
     * Phase 5T-10A: true only for the inline rename auto-opened immediately
     * after a Tree-triggered paragraph insert (see
     * dispatchAndApplyParagraphInsert/autoRenameAfterParagraphInsert below).
     * Always false/undefined for every other rename (dblclick/F2/context
     * menu on an EXISTING section/list/paragraph, and section/list's own
     * pre-existing insert-then-auto-rename flow, which has no rollback
     * concept at all — see beginRenameForNode's own doc comment). When
     * true, cancelRename() branches to rollbackPendingParagraphInsert
     * instead of its normal "never touch the document" behavior — see that
     * method's own doc comment for the full rollback design.
     */
    pendingParagraphInsert?: boolean;
    /**
     * Phase 5T-10A follow-up (real-device feedback: confirming this rename
     * left a stray blank line behind after a single Undo, because insert
     * and confirm were two independent Undo steps): the ORIGINAL target
     * anchor + before/after position captured when the Tree's "段落を前/
     * 後に挿入" menu item was clicked — i.e. `dispatchAndApplyParagraphInsert`'s
     * own two parameters, threaded all the way through
     * autoRenameAfterParagraphInsert/beginParagraphRenameForNode/beginRename
     * so commitRename can reach them. Only ever set together with
     * `pendingParagraphInsert: true`. commitRename uses this to revert the
     * placeholder insert with `Editor#undo()` and re-insert the CONFIRMED
     * text fresh, in one single `replaceRange` — see
     * commitPendingParagraphInsert's own doc comment for the full design.
     */
    insertOrigin?: { anchor: ParagraphMoveAnchor; position: ParagraphInsertPosition };
  } | null = null;

  /**
   * Move target preview (2026-08-11 ticket §5B). Queued by main.ts's
   * queueOutlineTreeMoveFlash right after a successful Move block/Move
   * section, consumed (and cleared) the NEXT time refresh() re-renders —
   * see applyPendingMoveFlash's own doc comment for why matching happens by
   * line (not by a node id captured before the move: ids shift across a
   * re-parse whenever document order changes, which a successful move
   * always does for the swapped pair).
   *
   * Phase 5T-5A: simplified from `{ line?: number; nodeIdHint?: string }`
   * to a plain line number. The old `nodeIdHint` branch (an enclosing
   * SECTION id, used only for paragraph/complex-block moves) predates
   * paragraph/callout/blockquote having their own Tree row at all — it was
   * already stale by the time Phase 5T-3A/5T-4A gave paragraph its own row
   * (docs/phase5t5_cursor_to_tree_highlight_design.md §3-2, ticket
   * decision 6). Every move outcome type in this codebase already exposes
   * its own `newStartLine` (moveBlock/moveComplexBlock/indentBlock/
   * relocateListSubtree/relocateSection all share this convention), so a
   * plain line is both simpler and MORE precise now that paragraph/
   * callout/blockquote have their own rows to match against exactly.
   */
  private pendingMoveFlash: number | null = null;

  /**
   * Phase 5T-5A: one-shot "selection should follow to this line after the
   * next refresh()" signal — the selectedId counterpart of
   * pendingMoveFlash above, but a SEPARATE field (not reused for the
   * flash), since the two are different concerns with different
   * consumption semantics (a transient DOM class vs. persistent
   * `this.selectedId` state) even though they are very often queued with
   * the identical line value at the same call site. Queued by
   * queueSelectionFollow (below) right before every Tree-dispatched move/
   * indent/outdent (dispatchAndApply's own `followSelection` option) and
   * by main.ts/PartialEditView.ts's own move/Partial-Edit-save success
   * paths (via the plugin-level queueOutlineTreeSelectionFollow). Consumed
   * — and cleared — by resolveSelectionAfterRefresh, called from refresh()
   * in place of ensureSelection() whenever this is non-null (see that
   * method's own doc comment for the full contract, and
   * docs/phase5t5_cursor_to_tree_highlight_design.md §5-2). Deliberately
   * NOT queued for delete/insert dispatches — a deleted node has no
   * logical target left to follow (the design doc's own "別 node への近似
   * フォールバックは禁止" rules out landing selection on whatever
   * unrelated content happens to occupy the fallback line), and an
   * inserted node has no PRE-edit selection to have been following in the
   * first place; both keep relying on ensureSelection()'s pre-existing,
   * unchanged fallback behavior instead.
   */
  private pendingSelectionFollowLine: number | null = null;

  private readonly scheduleRefresh = debounce(
    () => this.refresh(),
    150,
    true
  );

  constructor(leaf: WorkspaceLeaf, private readonly plugin: UnifiedOutlinerPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return OUTLINE_TREE_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.plugin.t("tree.viewName");
  }

  getIcon(): string {
    return "list-tree";
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("unified-outliner-outline-view");
    this.treeRootEl = this.contentEl.createDiv({
      cls: "unified-outliner-tree-root",
    });
    // Keyboard navigation: the root element itself is the focus target and
    // keydown listener (a roving-tabindex-per-row setup was considered and
    // rejected — re-rendering the whole tree on every navigation step,
    // which this view already does via renderTree(), would constantly
    // fight roving tabindex bookkeeping for no benefit; aria-activedescendant
    // on this single stable element communicates the selected row to
    // assistive tech instead — see renderNode's isSelected branch).
    this.treeRootEl.tabIndex = 0;
    this.treeRootEl.setAttribute("role", "tree");
    this.treeRootEl.setAttribute("aria-label", this.plugin.t("tree.viewName"));
    this.registerDomEvent(this.treeRootEl, "keydown", this.handleTreeKeyDown);
    this.registerDomEvent(this.treeRootEl, "focus", () => {
      // Inline rename guard (see renameState's own doc comment / refresh()'s
      // matching guard): focusing the rename <input> itself never fires
      // this handler (focus is non-bubbling and targets the input, not
      // treeRootEl), but skip defensively anyway for symmetry with blur
      // below rather than relying on that asymmetry.
      if (this.renameState) return;
      this.hasFocus = true;
      this.ensureSelection();
      this.renderTree();
    });
    this.registerDomEvent(this.treeRootEl, "blur", () => {
      // Inline rename guard: beginRename's inputEl.focus() call moves DOM
      // focus from treeRootEl to the rename <input> it just created — that
      // <input> is a DESCENDANT of treeRootEl, but "blur" (unlike
      // "focusout") still fires on treeRootEl itself whenever it loses
      // focus, regardless of where focus lands. Without this guard, that
      // synchronous blur would call renderTree() and tear down the
      // just-created <input> before the user ever sees it — renderTree()
      // does not go through refresh()'s own renameState guard. Skipping
      // here is safe: cancelRename()/commitRename() are the only paths
      // that end a rename, and they already call renderTree()/refresh()
      // themselves once renameState is cleared.
      if (this.renameState) return;
      this.hasFocus = false;
      this.renderTree();
    });

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", this.scheduleRefresh)
    );
    this.registerEvent(
      this.app.workspace.on("file-open", this.scheduleRefresh)
    );
    this.registerEvent(
      this.app.workspace.on("editor-change", this.scheduleRefresh)
    );
    // Obsidian's public API has no dedicated "cursor moved" workspace
    // event; keyboard/mouse interaction on the active editor is the
    // standard, pragmatic proxy other community plugins use for this.
    // (This also fires for keyup events inside this view's own tree — see
    // refresh()'s note on why that's harmless to selectedId.)
    this.registerDomEvent(document, "keyup", this.scheduleRefresh);
    this.registerDomEvent(document, "mouseup", this.scheduleRefresh);

    this.refresh();
  }

  async onClose(): Promise<void> {
    // Phase 5T-11A (docs/phase5t11_rename_session_teardown_design.md §8
    // 案A, §10 第1段階): an in-progress rename session must not survive
    // this view closing — cancelRename() is exactly the existing
    // Escape/no-op-blur path (discard whatever's in the textarea, never
    // write to the document; for a pendingParagraphInsert rename it
    // delegates to rollbackPendingParagraphInsert, which is itself gated
    // on canSafelyRollbackParagraphInsert's byte-for-byte re-check before
    // ever calling Editor#undo()). Reusing it here — rather than adding a
    // new teardown path — means this inherits that same safety gate
    // unmodified. This must run FIRST, before contentEl.empty() below:
    // both cancelRename() and rollbackPendingParagraphInsert() end by
    // calling renderTree()/refresh() against this.treeRootEl, which is
    // only safe to touch while the existing DOM is still alive. Every
    // rename kind (heading/list/paragraph) is covered identically — this
    // was previously a known, unaddressed gap (see 5T-10A's
    // insertParagraph.ts top comment) affecting all of them, not just
    // paragraph insert.
    if (this.renameState) this.cancelRename();
    // UXP-02 (2026-08-12, docs/uxp-02-long-press-menu-duplicate.md): hide
    // any menu this view still has tracked as open before the view itself
    // tears down, so closing/switching away from this leaf while a
    // long-press/right-click menu is open doesn't leave an orphaned menu
    // element behind. menu.hide() itself triggers the onHide callback
    // registered in showTrackedMenu, which would otherwise just re-null an
    // already-nulled field — harmless, but set to null directly here too
    // so this cleanup doesn't depend on that callback having run.
    this.activeMenu?.hide();
    this.activeMenu = null;
    // Phase 5T-2: same reasoning as refresh()'s own cancelParagraphDrag()
    // call — a view close/unload must not leave a paragraph drag session
    // (and its DOM classes, on elements about to be emptied anyway) set.
    this.cancelParagraphDrag();
    // Phase 5D-3C: same reasoning for a callout/blockquote drag session.
    this.cancelCalloutDrag();
    // Phase 5D-4C: same reasoning for a CompositeBlock drag session.
    this.cancelCompositeDrag();
    this.contentEl.empty();
    // Phase 4E: flush any fold-state mutation still sitting inside the
    // debounce window rather than leaving it to onunload's synchronous,
    // best-effort fire-and-forget (see FoldStateManager.flush's doc
    // comment) — closing just this one tab is the common case, and
    // onClose is already async so it can genuinely await the write.
    await this.plugin.foldStateManager.flush();
  }

  /**
   * Public so settings.ts can call it directly when
   * showListItemsInOutline is toggled (see
   * UnifiedOutlinerPlugin.refreshOutlineTreeViews), in addition to being
   * this view's own internal refresh entry point.
   */
  refresh(): void {
    // Phase 5T-2 (design doc §4-1: "既存の section/list D&D は、この観点の
    // ガードを一切持っていない...paragraph の drag は...新しい保護を新設す
    // る必要がある"): unconditionally cancel any in-progress paragraph
    // drag session BEFORE anything else in this method runs — including
    // before the renameState early-return just below — so EVERY cause of
    // refresh() (editor-change, active-leaf-change, file-open, keyup/
    // mouseup, and settings-change via refreshOutlineTreeViews) reliably
    // tears the session down rather than leaving it pointing at a Tree row
    // that's about to be replaced. This is deliberately more conservative
    // than the pre-existing section/list D&D (which has no such guard at
    // all) — see cancelParagraphDrag's own doc comment for why paragraph
    // specifically needs this even though moveParagraphFromAnchor's own
    // re-verification would still reject a stale drop safely on its own.
    this.cancelParagraphDrag();
    // Phase 5D-3C: same unconditional, refresh()-cause-agnostic guard for
    // an in-progress callout/blockquote drag session — see
    // cancelCalloutDrag's own doc comment.
    this.cancelCalloutDrag();
    // Phase 5D-4C: same unconditional, refresh()-cause-agnostic guard for
    // an in-progress CompositeBlock drag session — see
    // cancelCompositeDrag's own doc comment.
    this.cancelCompositeDrag();

    // Inline rename in progress: never tear down the row's <input> out
    // from under the user for an unrelated refresh trigger (debounced
    // editor-change, active-leaf-change, keyup/mouseup elsewhere). Only
    // commitRename()/cancelRename() clear renameState and explicitly
    // re-render afterward — see that field's own doc comment.
    if (this.renameState) return;

    const view = this.activeMarkdownView.get();
    if (!view) {
      this.currentDoc = null;
      this.currentTree = [];
      this.highlightedId = null;
      this.selectedId = null;
      this.pendingSelectionFollowLine = null;
      this.nodeById = new Map();
      this.parentIdById = new Map();
      this.readOnlyNodeIds = new Set();
      this.compositeGroupInfo = { groupNodeIds: new Set(), groupEndNodeIds: new Set() };
      this.currentFilePath = null;
      this.nodeIdentityById = new Map();
      this.collapsedIds = new Set();
      this.currentComposites = [];
      this.currentComplexScan = null;
      this.renderEmptyState(this.plugin.t("tree.emptyNoActiveNote"));
      return;
    }

    const includeLists = this.plugin.settings.showListItemsInOutline;
    const text = view.editor.getValue();
    const doc: ParsedDocument = parseDocument(text);
    this.currentDoc = doc;

    // Phase 5C-2 (2026-08-14): scanComplexBlocks(doc) now always runs, not
    // just when a composite rule is enabled — standalone callout/blockquote
    // Tree projection (buildOutlineTree.ts's standaloneComplexBlocks option,
    // below) is independent of settings.compositeBlocks entirely, and needs
    // this scan regardless. This is a deliberate removal of the previous
    // "skip scanComplexBlocks/matchCompositeBlocks entirely when every
    // composite rule is disabled" optimization's scan half — a single
    // scanComplexBlocks pass is the same order of cost as parseDocument
    // itself (both single-pass line scans), and every command dispatch in
    // this plugin already re-runs it per click/keystroke, so paying it once
    // more per refresh() is not a new category of cost.
    const complexScan = scanComplexBlocks(doc);

    // Phase 5D-0.3: CompositeBlock projection (see buildOutlineTree.ts's
    // BuildOutlineTreeOptions.composites doc comment). Each rule's own
    // `enabled` flag is the ONLY switch for composite projection (approval
    // §4 — no separate showCompositeBlocksInOutline toggle), so when every
    // rule is disabled this still skips matchCompositeBlocks itself (the
    // pattern-matching step, more work than the scan above) rather than
    // paying its cost for users who don't use the feature at all.
    const enabledRules = getEnabledCompositeBlockRules(this.plugin.settings.compositeBlocks);
    let composites: BuildOutlineTreeOptions["composites"];
    if (enabledRules.length > 0) {
      const infos = matchCompositeBlocks(doc, complexScan, enabledRules);
      const complexBlocksById = new Map(complexScan.blocks.map((b) => [b.id, b]));
      composites = { infos, complexBlocksById, rules: enabledRules };
      // Phase 5C-1 ticket 3b: menu-build-time-only reference — see this
      // class's own doc comment on currentComposites/currentComplexScan for
      // why this is never treated as a source of delete-time safety.
      this.currentComposites = infos;
    } else {
      // matchCompositeBlocks(doc, complexScan, []) would also always
      // return [] here (an empty rule list can never match anything) —
      // hardcoding [] instead avoids paying that call's own candidate-
      // collection pass for users who have every composite rule disabled,
      // preserving the original "skip the more expensive matching step
      // entirely when unused" optimization this branch has always had.
      this.currentComposites = [];
    }
    // Phase 5C-3: cached UNCONDITIONALLY now (previously only inside the
    // `enabledRules.length > 0` branch above). showStandaloneComplexBlockMenu
    // needs a fresh complexScan (a standalone callout/blockquote's own
    // range/parentId, for building its move snapshot and running the
    // move judge) at menu-build time even when every composite rule is
    // disabled — standalone move's own safety checks (e.g. "is this
    // currently a composite member") must stay correct regardless of that
    // unrelated setting. `complexScan` itself already runs unconditionally
    // per the doc comment above this method's own complexScan computation
    // (Phase 5C-2), so this is just widening this ALREADY-computed value's
    // own caching condition, not adding a new computation.
    this.currentComplexScan = complexScan;

    this.currentTree = buildOutlineTree(doc, {
      includeLists,
      composites,
      // Phase 5C-2: independent of `composites` above — a standalone
      // callout/blockquote is projected regardless of whether any
      // composite rule is enabled. buildOutlineTree.ts's own
      // groupStandaloneComplexBlocks filters this full, unfiltered
      // `complexScan.blocks` list down to callout/blockquote +
      // editability "supported" + not-already-a-composite-member itself.
      // Phase 5E-0: each independently opt-in (settings.
      // showFencedCodeInOutline / showTablesInOutline — both default
      // false, so an existing vault's Tree is byte-identical to before
      // this phase until the user turns either on). See
      // tree/buildOutlineTree.ts's BuildOutlineTreeOptions
      // .standaloneComplexBlocks.includeFencedCode/includeTables doc
      // comments.
      standaloneComplexBlocks: {
        blocks: complexScan.blocks,
        includeFencedCode: this.plugin.settings.showFencedCodeInOutline,
        includeTables: this.plugin.settings.showTablesInOutline,
      },
      // Phase 5P-3 ("本文 paragraph の任意 Outline Tree 表示", design doc
      // §1/§3): "presence of the option is the gate" — same pattern as
      // standaloneComplexBlocks above, no separate boolean flag inside
      // BuildOutlineTreeOptions itself. When the setting is off, `undefined`
      // is passed and buildOutlineTree.ts never even adds a paragraph node
      // to its internal grouping map, so paragraph rows are not merely
      // hidden — they never exist in the projection model at all. Reuses
      // the SAME complexScan.blocks already computed above for
      // standaloneComplexBlocks (one scan, both projections read from it).
      paragraphs: this.plugin.settings.showParagraphsInOutline
        ? { blocks: complexScan.blocks }
        : undefined,
      // UXP-04 (2026-08-15, "Configurable List Marker Prefix Display"):
      // resolved once here at build time — see
      // BuildOutlineTreeOptions.listPrefixStyle's own doc comment for why
      // this, unlike headingPrefixStyle, is NOT read directly by this
      // view's own rendering code.
      listPrefixStyle: this.plugin.settings.listPrefixStyle,
      t: (key, vars) => this.plugin.t(key, vars),
    });
    this.nodeById = buildNodeByIdMap(this.currentTree);
    this.parentIdById = buildParentIdMap(this.currentTree);
    this.readOnlyNodeIds = collectReadOnlyOutlineNodeIds(this.currentTree);
    // UI-only follow-up (2026-09-08): see compositeGroupInfo's own field
    // doc comment — a separate derived Set from readOnlyNodeIds above,
    // display-only, never consulted for edit-capability decisions.
    this.compositeGroupInfo = collectCompositeGroupInfo(this.currentTree);

    // Phase 4E: file path is the fold-state persistence key; null (no
    // backing file — practically never for a MarkdownView, but Editor
    // instances aren't guaranteed to have one) simply means fold state
    // can't be looked up or saved for this refresh, handled by
    // deriveCollapsedIds()/setNodeCollapsed() both treating a null path
    // as "nothing to persist" rather than throwing.
    this.currentFilePath = view.file?.path ?? null;
    this.nodeIdentityById = buildNodeIdentityMap(this.currentTree);
    this.collapsedIds = this.deriveCollapsedIds();

    const cursorLine = view.editor.getCursor().line;
    // Phase 5T-5A (design doc §3-3/§5-1, 案A): resolveCurrentPositionNodeId
    // extends the old section/list-only resolveHighlightedNodeId with a
    // first pass over paragraph/standalone callout/standalone blockquote
    // candidates — see that module's own doc comment. The raw result is
    // then walked up to the nearest currently-VISIBLE ancestor (ticket
    // decision 4: permitted, not forced-open) rather than ever pointing at
    // a row hidden under a collapsed ancestor.
    const rawHighlighted = resolveCurrentPositionNodeId(doc, cursorLine, complexScan, this.nodeById, {
      includeLists,
    });
    this.highlightedId = resolveNearestVisibleAncestorId(
      rawHighlighted,
      this.parentIdById,
      this.collapsedIds
    );

    // Phase 5T-5A: when a Tree-dispatched move/edit/Partial-Edit-save just
    // queued a selection-follow target (this.pendingSelectionFollowLine),
    // resolve and consume it INSTEAD of the pre-existing ensureSelection()
    // id-presence check for this one refresh cycle — see
    // resolveSelectionAfterRefresh's own doc comment for the full
    // contract. Every other refresh() trigger (debounced editor-change,
    // active-leaf-change, an unrelated keyup elsewhere) leaves
    // pendingSelectionFollowLine null, so ensureSelection()'s existing
    // "keep an already-valid keyboard selection exactly where it is"
    // behavior is completely unchanged for those cases.
    this.resolveSelectionAfterRefresh(doc, complexScan, includeLists);

    this.applyTreeKindHighlightSettings();
    this.renderTree();
    this.applyPendingMoveFlash();
  }

  /**
   * Reflects settings.treeKindHighlight.sectionMode/listMode onto
   * .unified-outliner-tree-root as data attributes, read by styles.css's
   * [data-section-highlight]/[data-list-highlight] selectors (combined with
   * each row's own data-kind — see renderNode). Attribute-driven rather
   * than a per-row class toggle so one settings change re-styles the whole
   * tree via CSS alone, with no extra re-render — called on every refresh()
   * (cheap: two attribute writes) rather than only once in onOpen(), so a
   * settings change applied while this view is already open (see
   * settings.ts's onChange handlers, which call
   * plugin.refreshOutlineTreeViews()) takes effect immediately. No color
   * values are set here or anywhere else in this file — see styles.css's
   * own doc comment for the themeable CSS variables this feeds into.
   */
  private applyTreeKindHighlightSettings(): void {
    const cfg = this.plugin.settings.treeKindHighlight;
    this.treeRootEl.setAttribute("data-section-highlight", cfg.sectionMode);
    this.treeRootEl.setAttribute("data-list-highlight", cfg.listMode);
  }

  /**
   * Consumes this.pendingMoveFlash (queued by main.ts's
   * queueOutlineTreeMoveFlash, or by this view's own Tree-dispatched move
   * methods) against the tree that renderTree() JUST rebuilt, and — if a
   * match is found — adds a transient CSS class to that row's DOM element
   * for ~900ms (styles.css's .unified-outliner-move-flash / @keyframes).
   * Matching by `line` (not by a node id captured before the move) is
   * deliberate: every Tree node id in this codebase is only stable within
   * a single parseDocument()/buildOutlineTree() pass (see
   * parser/parseDocument.ts's `sec-N`/`li-N` counters and
   * tree/buildOutlineTree.ts's paragraph view-id ordinal), and a
   * successful move always changes document order for the moved content,
   * so an id captured pre-move would not reliably identify the same
   * content in the post-move tree. Phase 5T-5A: `pending` is now always a
   * plain post-move line (the old `nodeIdHint`-based enclosing-section
   * fallback for paragraph/complex-block moves is gone — see
   * this.pendingMoveFlash's own doc comment for why it was stale), so a
   * paragraph/callout/blockquote move now flashes its OWN row exactly,
   * not just its enclosing section.
   */
  private applyPendingMoveFlash(): void {
    const pending = this.pendingMoveFlash;
    this.pendingMoveFlash = null;
    if (pending === null) return;

    const visible = flattenVisibleOutlineTree(this.currentTree, this.collapsedIds);
    const match = visible.find((n) => n.line === pending);
    if (!match) return;

    const matchId = match.id;
    this.treeRootEl.win.requestAnimationFrame(() => {
      const rowEl = this.treeRootEl.querySelector<HTMLElement>(
        `#unified-outliner-row-${CSS.escape(matchId)}`
      );
      if (!rowEl) return;
      rowEl.addClass("unified-outliner-move-flash");
      window.setTimeout(() => rowEl.removeClass("unified-outliner-move-flash"), 900);
    });
  }

  /**
   * Public so main.ts's queueOutlineTreeMoveFlash can reach every open
   * Outline Tree View leaf right after a successful Move block/Move
   * section — see this.pendingMoveFlash's own doc comment for the
   * queue/consume lifecycle.
   */
  queueMoveFlash(line: number): void {
    this.pendingMoveFlash = line;
  }

  /**
   * Phase 5T-5A: queues a one-shot selection-follow target — see
   * this.pendingSelectionFollowLine's own doc comment for the full
   * queue/consume lifecycle and why this is a SEPARATE field from
   * pendingMoveFlash. Public (like queueMoveFlash above) so both
   * main.ts's command-triggered move dispatchers and
   * PartialEditView.ts's paragraph-edit-save success path can reach every
   * open Outline Tree View leaf — see
   * UnifiedOutlinerPlugin#queueOutlineTreeSelectionFollow in main.ts.
   * This view's OWN Tree-dispatched move/indent/outdent methods call this
   * directly instead (same instance, no need to go through the plugin).
   */
  queueSelectionFollow(line: number): void {
    this.pendingSelectionFollowLine = line;
  }

  /**
   * Phase 4E: rebuilds collapsedIds from scratch every refresh, from the
   * persisted per-file identity set (persistence/foldStateManager.ts) —
   * rather than letting collapsedIds survive as a long-lived mutable field
   * the way it did through Phase 4D. Two reasons this is correct, not
   * just "also correct":
   *
   * 1. Node ids (`sec-N`/`li-N`) are only valid within the CURRENT parse —
   *    reusing a Set keyed by them across a re-parse (let alone a file
   *    switch) was already relying on ids happening to come out the same,
   *    which is true when nothing changed but is not a guarantee.
   * 2. Before this phase, collapsedIds was never scoped by file at all —
   *    switching from note A to note B carried A's collapsed ids forward
   *    unchanged, so if B's first heading happened to also be `sec-0` (any
   *    two single-heading notes would collide), B would render that
   *    heading collapsed for no reason the user did anything to cause.
   *    Deriving fresh from a per-file persisted store on every refresh
   *    makes that collision structurally impossible: a node's collapsed-
   *    ness now always comes from ITS OWN file's entry, looked up by ITS
   *    OWN content identity, every single time.
   */
  private deriveCollapsedIds(): Set<string> {
    const collapsed = new Set<string>();
    if (!this.currentFilePath) return collapsed;
    const persisted = this.plugin.foldStateManager.getCollapsedIdentities(
      this.currentFilePath
    );
    if (persisted.size === 0) return collapsed;
    for (const [nodeId, identity] of this.nodeIdentityById) {
      if (persisted.has(identity)) collapsed.add(nodeId);
    }
    return collapsed;
  }

  /**
   * The one place collapsedIds is ever mutated (toggleCollapse, and the
   * keyboard Left/Right handlers) — always updates the in-memory Set AND
   * writes through to the persisted store in the same call, so the two
   * can never drift apart. A node whose identity can't be resolved (should
   * not happen for any node actually in nodeIdentityById, but defensively
   * checked) or whose file has no known path still updates collapsedIds
   * for THIS render; it just can't be persisted.
   *
   * Phase 4F: this remains the ONLY call site (besides the CM6-origin
   * handleCm6FoldEffect, bottom of this file) that ever invokes
   * FoldStateManager.setNodeCollapsed — see
   * docs/fold-state-conflict-resolution-spec.md §1 ("authoritative 判定")
   * for why that single-entry-point property is exactly what makes "last
   * synchronous call wins" a sufficient, correct conflict policy: both
   * origins are plain, synchronous DOM/CM6 event handlers, so they can
   * never truly interleave — whichever one's write reaches
   * FoldStateManager.setNodeCollapsed last simply overwrites the identity's
   * stored boolean, exactly like any other last-write-wins field. No
   * queueing, timestamping, or merge logic was added, because none is
   * needed on top of that existing guarantee.
   */
  private setNodeCollapsed(nodeId: string, collapsed: boolean): void {
    if (collapsed) {
      this.collapsedIds.add(nodeId);
    } else {
      this.collapsedIds.delete(nodeId);
    }
    const identity = this.nodeIdentityById.get(nodeId);
    if (identity && this.currentFilePath) {
      this.plugin.foldStateManager.setNodeCollapsed(
        this.currentFilePath,
        identity,
        collapsed
      );
      // Phase 4F: propagate this Tree-origin write to any OTHER open
      // Outline Tree View leaf (see main.ts's refreshOtherOutlineTreeViews
      // doc comment) — closes the one-sided gap where only CM6-origin
      // writes (handleCm6FoldEffect below, via the plain
      // refreshOutlineTreeViews()) used to refresh every open Tree leaf,
      // while a Tree-origin toggle only ever updated the instance that
      // received the click. `this` deliberately excluded: it still
      // finishes its own render via the caller's existing
      // this.renderTree() call right after this method returns
      // (toggleCollapse / expandSelectionOrGoToFirstChild /
      // collapseSelectionOrGoToParent), so refreshing it again here would
      // just be a redundant double-render for no behavioral difference.
      this.plugin.refreshOtherOutlineTreeViews(this);
    }
    // Phase 3D (stage 1): one-directional Outline Tree -> CM6 body editor
    // fold sync, gated by the "Sync Outline Tree folding to editor"
    // setting (settings.ts's syncOutlineTreeFoldingToEditor, default on).
    // This `if` is the ONLY place that setting is ever checked — this is
    // the single place setNodeCollapsed is ever called from (toggleCollapse's
    // chevron click, and the keyboard Left/Right handlers below), so no
    // other call site needs its own sync call or its own setting check.
    // Everything above this line (collapsedIds, FoldStateManager
    // persistence, refreshOtherOutlineTreeViews) always runs regardless of
    // the setting — only the CM6-facing half of this method is optional.
    if (this.plugin.settings.syncOutlineTreeFoldingToEditor) {
      this.syncFoldToBodyEditor(nodeId, collapsed);
    }
  }

  /**
   * Phase 3D (stage 1, one-directional only): mirror this node's fold
   * state into the body editor's own CM6 fold state, so collapsing a
   * section/list in the Outline Tree also visually folds it in the body
   * editor. Reuses the exact same `.cm` escape hatch as scrollLineToTop
   * (see that method's doc comment for why reaching into Editor's private
   * `.cm` property to talk to CM6 directly is the sanctioned way plugins
   * do this) and the same `@codemirror/language` fold primitives Obsidian's
   * own heading/list fold gutter is built on (`foldEffect`/`unfoldEffect`).
   *
   * Deliberately narrow for this stage:
   *  - One-directional only. Folding directly in the body editor (its own
   *    gutter, or Obsidian's Fold/Unfold heading commands) is NOT reflected
   *    back into this view's collapsedIds — that's Phase 3D stage 2,
   *    pending a live check of how to observe CM6 fold changes (see the
   *    design report; not implemented here). (That reverse direction is
   *    handled separately by handleCm6FoldEffect near the bottom of this
   *    file, and is always on — it does not read
   *    syncOutlineTreeFoldingToEditor at all, since that setting only
   *    controls THIS direction.)
   *  - Only called when the user has this behavior enabled — its one
   *    caller, setNodeCollapsed, wraps this call in an
   *    `if (this.plugin.settings.syncOutlineTreeFoldingToEditor)` check
   *    (the only place that setting is read), so this method itself has
   *    no setting-awareness of its own to keep that single control point
   *    real. When the setting is off, setNodeCollapsed's other effects
   *    (collapsedIds, FoldStateManager persistence, refreshing other Tree
   *    leaves) still run exactly as before; only this CM6-facing half is
   *    skipped.
   *  - No attempt to re-apply or re-map fold ranges across move/indent/
   *    drag/Partial-Edit-Pane edits. A fold that gets edited out from under
   *    it by one of those operations is simply left to whatever CM6 itself
   *    does with the mapped range (typically: the fold is dropped) — no
   *    special-casing here.
   *  - Silently no-ops (never a Notice) on anything that makes the sync
   *    itself impossible: no active view for this exact file (guards
   *    against a stale toggle racing a not-yet-refreshed file switch — see
   *    refresh()'s currentFilePath field), no resolvable node, a node with
   *    nothing below its own first line to fold, or no reachable CM6
   *    instance (e.g. the note isn't open in source/live-preview at all).
   *    This is a display-only convenience on top of the already-persisted
   *    Outline Tree fold state, never a data mutation, so there is nothing
   *    for the user to be notified about when it can't apply.
   */
  private syncFoldToBodyEditor(nodeId: string, collapsed: boolean): void {
    const view = this.activeMarkdownView.get();
    if (!view || view.file?.path !== this.currentFilePath) return;

    const node = this.currentDoc?.nodes.get(nodeId);
    if (!node) return;
    // Nothing below the node's own first line to fold — an empty heading.
    // canCollapseOutlineNode applies this same test before a row is given
    // a fold affordance at all, so in practice this is unreachable; kept as
    // the defensive guard it has always been, and as the single definition
    // of "has something to fold" that the affordance is derived from.
    if (node.range.endLine <= node.range.startLine) return;

    const cm = getEditorCmView(view.editor);
    if (!cm) return;

    // CM6's Text.line() is 1-indexed; this codebase's line numbers (and
    // ParsedDocument's LineRange) are 0-indexed throughout — same
    // conversion scrollLineToTop already does.
    const docLines = cm.state.doc.lines;
    const startLine = Math.min(Math.max(node.range.startLine, 0), docLines - 1);
    const endLine = Math.min(Math.max(node.range.endLine, 0), docLines - 1);
    // Fold from the END of the node's own first line (heading/marker text
    // itself stays visible) to the END of its last line — matching
    // Obsidian's own heading/list fold boundary, and lining up with how
    // ParsedDocument's range is already defined for this node.
    const from = cm.state.doc.line(startLine + 1).to;
    const to = cm.state.doc.line(endLine + 1).to;
    if (from >= to) return;

    cm.dispatch({
      effects: (collapsed ? foldEffect : unfoldEffect).of({ from, to }),
      // Phase 3D stage 3: identifies this dispatch as Tree-originated so
      // createCm6FoldSyncExtension's listener (bottom of this file) can
      // ignore it — see outlineTreeFoldOrigin's own doc comment.
      annotations: outlineTreeFoldOrigin.of(true),
    });
  }

  private renderEmptyState(message: string): void {
    this.treeRootEl.empty();
    this.treeRootEl.createDiv({
      cls: "unified-outliner-tree-empty",
      text: message,
    });
  }

  private renderTree(): void {
    this.treeRootEl.empty();
    // Cleared up front and re-set (at most once) inside renderNode below —
    // if nothing ends up selected/visible this refresh, no stale reference
    // to a removed row should linger on the container.
    this.treeRootEl.removeAttribute("aria-activedescendant");
    if (this.currentTree.length === 0) {
      const message = this.plugin.settings.showListItemsInOutline
        ? this.plugin.t("tree.emptyNoHeadingsOrList")
        : this.plugin.t("tree.emptyNoHeadings");
      this.renderEmptyState(message);
      return;
    }
    for (const node of this.currentTree) {
      this.renderNode(node, this.treeRootEl);
    }
  }

  /**
   * Renders both section and list nodes through one shared row structure
   * (click-to-jump, highlight sync, and fold are identical for both kinds,
   * since they only ever depend on node.id/node.line/node.children — none
   * of that needed a kind check). Only three things branch on node.kind:
   * the label styling (heading-level vs. muted list text), and — list
   * nodes intentionally do NOT get, per Phase 3C's scope — the right-click
   * structure menu and drag & drop, both of which stay section-only.
   */
  private renderNode(node: OutlineTreeNode, parentEl: HTMLElement): void {
    const hasChildren = node.children.length > 0;
    // Whether to offer a fold toggle — a broader question than "does this
    // row have child rows", since folding also folds the document section
    // itself. See canCollapseOutlineNode's doc comment. The two are kept
    // separate deliberately: `canCollapse` gates the chevron and its aria
    // state, `hasChildren` still gates whether there is a child list to
    // render at all (a childless collapsed row simply has nothing below it
    // in the tree, while its body is folded in the editor).
    const canCollapse = canCollapseOutlineNode(node, this.currentDoc);
    const isCollapsed = this.collapsedIds.has(node.id);
    const isHighlighted = node.id === this.highlightedId;
    // Selection highlight only while this view's own root actually has DOM
    // focus (see the hasFocus field's doc comment) — selectedId itself
    // persists across blur so navigation resumes where it left off, but
    // rendering it as focus moves elsewhere would look like a second,
    // conflicting "current row" marker.
    const isSelected = this.hasFocus && node.id === this.selectedId;
    const isSection = isOutlineSectionNode(node);
    const isComposite = isOutlineCompositeNode(node);
    const isComplexMember = isOutlineComplexMemberNode(node);
    // Phase 5T-1: used only to decide whether to attach the paragraph-only
    // context-menu listener below — never a source of move-time safety
    // itself (see showParagraphMoveMenu's own doc comment).
    const isParagraph = isOutlineParagraphNode(node);
    // Phase 5D-0.3 approval §1: a CompositeBlock's row itself, EVERY one of
    // its descendant rows (list items nested inside it, callout/blockquote
    // members), and — transitively — any FURTHER nested list item under one
    // of those member list items, all get none of the write-back operations
    // below (rename / drag & drop / context menu / mobile long-press menu).
    // 2026-08-12 amendment: this used to be threaded down through the
    // recursive render call as an `insideComposite` boolean parameter;
    // that's now precomputed ONCE per refresh() over the whole tree (see
    // this.readOnlyNodeIds's own doc comment — tree/buildOutlineTree.ts's
    // collectReadOnlyOutlineNodeIds), so this is now a plain lookup.
    const readOnly = this.readOnlyNodeIds.has(node.id);
    // UI-only follow-up (2026-09-08, "Outline Tree の CompositeBlock 視認性
    // 改善"): display-only — never gates rename/drag-drop/context-menu/
    // Move/Delete/Partial Edit (those all stay keyed off `readOnly`/
    // `isComposite`/`isComplexMember` above, completely unchanged). See
    // compositeGroupInfo's own field doc comment for why this is a
    // SEPARATE set from readOnlyNodeIds (which also includes "paragraph"
    // rows that must never get this treatment).
    const compositeGroupMember = this.compositeGroupInfo.groupNodeIds.has(node.id);
    const compositeGroupEnd = this.compositeGroupInfo.groupEndNodeIds.has(node.id);

    const itemEl = parentEl.createDiv({
      cls: "tree-item" + (isCollapsed ? " is-collapsed" : ""),
    });
    const selfEl = itemEl.createDiv({
      cls:
        "tree-item-self is-clickable" +
        (isSection ? "" : " unified-outliner-list-row") +
        (isHighlighted ? " is-active unified-outliner-current" : "") +
        (isSelected ? " is-selected unified-outliner-selected" : ""),
    });
    // DOM id + role/aria-* wiring so this row is addressable via
    // aria-activedescendant from the focus-holding treeRootEl (a roving
    // tabindex per row was considered and rejected — see onOpen's comment).
    selfEl.id = `unified-outliner-row-${node.id}`;
    // 2026-08-11 ticket §5A: a stable, CSS-only hook for the section/list
    // always-on visual aids — see styles.css's
    // [data-section-highlight]/[data-list-highlight] rules on
    // .unified-outliner-tree-root, which key off this attribute combined
    // with the settings-driven mode attributes applyTreeKindHighlightSettings
    // sets on the root. No color values live in this file — see that
    // method's own doc comment for why. Phase 5D-0.3: now just node.kind
    // itself (previously an isSection ternary) — equivalent for the
    // section/list kinds those existing selectors key off, and additionally
    // gives composite/complex-member rows their own accurate value (no CSS
    // selector keys off those two yet, so this is a no-op behavior change
    // for them today, but keeps this attribute truthful).
    selfEl.setAttribute("data-kind", node.kind);
    selfEl.setAttribute("role", "treeitem");
    selfEl.setAttribute("aria-selected", isSelected ? "true" : "false");
    if (canCollapse) {
      selfEl.setAttribute("aria-expanded", isCollapsed ? "false" : "true");
    }
    // 2026-08-12 amendment §A: an EXPLICIT read-only marker (not just the
    // absence of rename/drag/context-menu listeners below) — both a
    // standard ARIA state assistive tech can announce, and a stable
    // `data-*` hook this row's read-only-ness doesn't depend on inspecting
    // which listeners happen to be attached.
    if (readOnly) {
      selfEl.setAttribute("aria-readonly", "true");
      selfEl.setAttribute("data-readonly", "true");
    }
    // UXP-01 (2026-08-12, docs/uxp-01-ipad-drag-context-menu.md): CSS
    // hook so the drag handle below can be always-visible on touch and
    // hover-revealed on desktop without a JS media-query check per paint —
    // same "one data-* attribute, no color/behavior logic in this file"
    // convention as data-kind/data-readonly above.
    selfEl.setAttribute("data-platform", Platform.isMobile ? "mobile" : "desktop");
    // UI-only follow-up (2026-09-08, "Outline Tree の CompositeBlock 視認性
    // 改善"): a boolean data-* hook only — no ruleId or any other
    // CompositeBlock-specific identifier is ever exposed as a CSS selector
    // (same "one data-* attribute, no color/behavior logic in this file"
    // convention as data-kind/data-readonly above). `.unified-outliner-
    // composite-accent` (styles.css) is a REAL child element (not a
    // ::before/::after pseudo-element of selfEl) specifically because
    // selfEl's own ::before/::after slots are already claimed by the drag-
    // and-drop indicator classes (.unified-outliner-drop-before/-after/
    // -inside, above in this file) — a CompositeBlock PARENT row is a valid
    // D&D source/target (Phase 5D-4C/5D-4D) and so CAN show a drop
    // indicator at the same time this accent is shown; reusing the same
    // pseudo-element slot would let one silently override the other's
    // background-color/position properties (the exact class of bug
    // styles.css's own .unified-outliner-drop-inside doc comment already
    // documents for a different pair of rules). A separate real element has
    // no such collision: it paints its own translucent tint/border,
    // completely independent of selfEl's ::before/::after box.
    if (compositeGroupMember) {
      selfEl.setAttribute("data-composite-group", "true");
      if (compositeGroupEnd) {
        selfEl.setAttribute("data-composite-group-end", "true");
      }
      const compositeAccentEl = selfEl.createDiv({
        cls: "unified-outliner-composite-accent",
      });
      compositeAccentEl.setAttribute("aria-hidden", "true");
    }
    if (isSelected) {
      this.treeRootEl.setAttribute("aria-activedescendant", selfEl.id);
    }

    const collapseEl = selfEl.createDiv({
      cls:
        "tree-item-icon collapse-icon" +
        (canCollapse ? "" : " unified-outliner-collapse-spacer") +
        (isCollapsed ? " is-collapsed" : ""),
    });
    if (canCollapse) {
      setIcon(collapseEl, "right-triangle");
      collapseEl.addEventListener("click", (evt) => {
        evt.stopPropagation();
        this.toggleCollapse(node.id);
      });
    }

    // UXP-01 (2026-08-12, docs/uxp-01-ipad-drag-context-menu.md): dedicated
    // drag handle, spatially separated from the rest of the row so a touch
    // on the row BODY (long-press -> context menu, tier 2 below) and a
    // touch on the HANDLE (drag, further below) are never the same gesture
    // recognizer target. null for a readOnly row that is NOT a CompositeBlock
    // parent row (complex-member/paragraph member rows — never a drag
    // source, Phase 5D-0.3 approval §1), matching the existing `if
    // (!readOnly)` gate around the drag listeners further down.
    //
    // Phase 5D-4D (docs/phase5d4d_mobile_composite_block_drag_handle_design.md):
    // a CompositeBlock PARENT row (isComposite) is always `readOnly` (Phase
    // 5D-0.3 approval §1 — rename/indent/outdent stay excluded, unchanged),
    // yet is now also a valid D&D source/target (Phase 5D-4C on desktop;
    // this ticket extends the same handle to mobile). `isComposite` is a
    // deliberate, narrow widening of this one generation condition, layered
    // on top of the still-unrelaxed read-only contract — mirroring exactly
    // how the composite drag-wiring branch below is its own `else if`
    // rather than a relaxation of `!readOnly`. member/complex-member rows
    // remain excluded: `isComposite` is only ever true for the parent row.
    let dragHandleEl: HTMLElement | null = null;
    if (!readOnly || isComposite) {
      dragHandleEl = selfEl.createDiv({ cls: "unified-outliner-drag-handle" });
      setIcon(dragHandleEl, "grip-vertical");
      dragHandleEl.setAttribute("aria-hidden", "true");
    }

    // Inline rename trigger (2026-08-11 fix): lives on selfEl — the row's
    // FULL width/height, not just the text label's own innerEl — so a
    // double-click anywhere on the row starts a rename, not only when the
    // cursor happens to land precisely on the label's own glyphs. Reported
    // as "rename が中々編集に入れない" (double-click often fails to enter
    // edit mode): innerEl is only as wide as its own text content (see
    // styles.css's .tree-item-inner, `flex-grow: 0` outside of an active
    // rename — the earlier "rename input width" ticket's own fix scopes
    // `flex: 1 1 auto` to the renaming state specifically, for exactly this
    // reason), so double-clicking the empty space to the right of a short
    // label, or anywhere else in the row that isn't the label text itself,
    // used to land on selfEl/itemEl and never reach innerEl's listener at
    // all. The `collapseEl.contains(...)` check is the one exclusion this
    // still needs: without it, double-clicking the disclosure triangle
    // would both toggle-fold twice (a harmless no-op, click fires per each
    // of the two clicks) AND open a rename, which double-clicking a fold
    // arrow has no reason to do.
    // Phase 5D-0.3 approval §1: composite/complex-member rows, and any list
    // row currently nested inside a composite, never get inline rename —
    // beginRenameForNode itself already guards node.kind, but a member LIST
    // row still has kind "list" (it's a plain, reused list node — see
    // buildOutlineTree.ts's buildMemberNode), so that guard alone wouldn't
    // catch it; skipping the listener entirely here is what actually
    // enforces "read-only while inside a composite" for that case.
    if (!readOnly) {
      // Phase 5T-7C ("Outline Tree の native dblclick 依存をやめ、pointerdown
      // ベースの独立二重クリック検出へ置き換える"): replaces the old native
      // `dblclick` listener with the shared pointerdown-based double-click
      // detector below (see rowDoubleClickDetector.ts's own top doc comment
      // for the full rationale — real-device testing found native dblclick
      // intermittently swallowed by this row's own `draggable="true"`
      // drag-gesture detection, on both left- and right-docked sidebars).
      // Destination unchanged: beginRenameForNode(node.id), re-resolved
      // fresh by id — a double click's two constituent presses each already
      // run this row's own "click" handler below (jumpToLine / mobile tap
      // logic), which can itself trigger a re-render before the second
      // press is recognized, leaving any closed-over DOM/element reference
      // pointing at an already-detached previous render pass; only the
      // primitive node.id is safe to carry across that gap.
      selfEl.addEventListener("pointerdown", (evt) => {
        this.handleRowPointerDownForDoubleClick(evt, node.id, collapseEl, dragHandleEl, () =>
          this.beginRenameForNode(node.id)
        );
      });
    } else if (isParagraph) {
      // Phase 5T-7A originally wired this branch as a native `dblclick`
      // listener opening Paragraph Partial Edit; Phase 5T-7C replaced it
      // with the same shared pointerdown-based detector as the rename
      // branch above (for the native-dblclick-vs-draggable conflict — see
      // rowDoubleClickDetector.ts's own top doc comment). Phase 5T-8A
      // ("paragraph のダブルクリック動作を Partial Edit 起動から inline
      // rename へ統一する") now changes ONLY the destination: a recognized
      // double click delegates to beginParagraphRenameForNode (inline
      // rename, matching heading/list) instead of
      // openParagraphPartialEditFromTree (Partial Edit Pane) — the
      // detection mechanics themselves (handleRowPointerDownForDoubleClick,
      // the setTimeout(0) deferral, hit-target eligibility) are entirely
      // unchanged. Paragraph Partial Edit itself is NOT removed — it
      // remains reachable via the paragraph context menu's "段落を編集…"
      // item (showParagraphMoveMenu, untouched) and via F2
      // (handleTreeKeyDown's F2 case, untouched) — see
      // beginParagraphRenameForNode's own doc comment for the full role
      // split. Still layered on top of the read-only contract exactly like
      // the paragraph context menu (5T-1) and drag wiring (5T-2) — this
      // remains a separate `else if` branch, never a relaxation of
      // `!readOnly` above. dragHandleEl is always null here (paragraph rows
      // never have one — see its own creation above), so the shared
      // handler's drag-handle exclusion is simply a no-op for this branch,
      // exactly as it was before this ticket.
      selfEl.addEventListener("pointerdown", (evt) => {
        this.handleRowPointerDownForDoubleClick(evt, node.id, collapseEl, dragHandleEl, () =>
          this.beginParagraphRenameForNode(node.id)
        );
      });
    }

    if (isOutlineSectionNode(node)) {
      const innerEl = selfEl.createDiv({
        cls: `tree-item-inner unified-outliner-level-${node.headingLevel}`,
      });
      // 2026-08-12 "Heading prefix 表示設定" ticket: optional "H1".."H6" /
      // "#".."######" badge, off by default (settings.headingPrefixStyle
      // === "none"). Display-only — never part of the editable/matchable
      // heading text (nodeDisplayLabel, rename textarea, breadcrumb labels
      // all stay untouched), so it's rendered as its own <span>, skipped
      // entirely when headingPrefixText returns "" (same "no prefix -> no
      // element at all" pattern as the composite-block prefix span below).
      const prefixText = headingPrefixText(
        this.plugin.settings.headingPrefixStyle,
        node.headingLevel
      );
      if (prefixText.length > 0) {
        innerEl.createSpan({ cls: "unified-outliner-heading-prefix", text: prefixText });
      }
      innerEl.createSpan({
        text: node.headingText.length > 0 ? node.headingText : this.plugin.t("tree.untitledHeading"),
      });
    } else if (isOutlineListNode(node)) {
      const innerEl = selfEl.createDiv({
        cls: "tree-item-inner unified-outliner-list-text",
      });
      // UXP-04 (2026-08-15, "Configurable List Marker Prefix Display"):
      // node.prefix is resolved once at build time (tree/buildOutlineTree.ts's
      // listPrefixText, gated by settings.listPrefixStyle) — this branch
      // just renders it, the same "own <span>, skipped entirely when
      // absent, no separate CSS needed for the label span itself" pattern
      // the composite/complex-member branches below already use. Uses
      // createSpan (not setText, which would replace the whole innerEl's
      // content) for BOTH the prefix and the label so the two can coexist
      // as sibling spans.
      if (node.prefix) {
        innerEl.createSpan({
          cls: "unified-outliner-list-prefix",
          text: `${node.prefix} `,
        });
      }
      const displayText =
        node.text.length > 0 ? node.text : this.plugin.t("tree.emptyListItem");
      innerEl.createSpan({ cls: "unified-outliner-list-label", text: displayText });
      // Phase 3C.1: the label itself is CSS-truncated to one line (see
      // styles.css's unified-outliner-list-text), so long items always fit
      // the sidebar's current width without breaking the tree's
      // one-row-per-node scan-ability. setTooltip() (Obsidian's own
      // tooltip, not the native `title` attribute — same look/timing as
      // the rest of Obsidian's UI) reveals the fuller text on hover.
      // Phase 4B: the tooltip text itself now goes beyond the first line —
      // extractListItemBodyText (edit/listBodyRange.ts) returns the item's
      // own full body (first line + continuation lines, nested child list
      // items excluded — see that module's doc comment). Falls back to
      // displayText if currentDoc is unset or extraction fails/produces
      // nothing (e.g. right after a refresh that hasn't populated it yet).
      const bodyOutcome = this.currentDoc
        ? extractListItemBodyText(this.currentDoc, node.id)
        : { ok: false as const, text: "" };
      const tooltipText =
        bodyOutcome.ok && bodyOutcome.text.length > 0 ? bodyOutcome.text : displayText;
      // Phase 4B follow-up: Obsidian's tooltip is center-aligned by
      // default (fine for one short line, but reads oddly once the text
      // spans multiple lines — a centered block doesn't look like "title +
      // body" the way the source Markdown does). The `classes` option
      // (Obsidian 1.8.7+) scopes a left-align override to just this
      // tooltip via styles.css's .unified-outliner-list-tooltip rule,
      // without touching Obsidian's tooltip styling anywhere else.
      setTooltip(innerEl, tooltipText, { classes: ["unified-outliner-list-tooltip"] });
    } else if (isComposite) {
      // Phase 5D-0.3 approval §5: `node.prefix` must be a meaningful,
      // model-level string rendered via a dedicated <span> that stays part
      // of the label's semantic content (visible in textContent — so
      // copy/paste and the default accessible-name computation both include
      // it — not a CSS ::before decoration), while an EMPTY prefix must not
      // leave behind a stray empty element or stray whitespace. Putting the
      // trailing separator space INSIDE the prefix span's own text (rather
      // than as a sibling text node) is what achieves that: the span is
      // simply skipped altogether when there's no prefix, with nothing else
      // to clean up.
      const innerEl = selfEl.createDiv({
        cls: "tree-item-inner unified-outliner-composite-text",
      });
      if (node.prefix.length > 0) {
        innerEl.createSpan({
          cls: "unified-outliner-composite-prefix",
          text: `${node.prefix} `,
        });
      }
      innerEl.createSpan({ cls: "unified-outliner-composite-label", text: node.label });
    } else if (isComplexMember) {
      // Phase 5C-2: same "prefix as its own semantic <span>, skipped
      // entirely when absent" pattern as the composite branch above —
      // node.prefix already includes its own trailing separator space
      // (STANDALONE_CALLOUT_PREFIX/STANDALONE_BLOCKQUOTE_PREFIX) whenever
      // set, so no extra space is added here either. This branch itself
      // needs no per-kind logic of its own: tree/buildOutlineTree.ts's
      // buildMemberNode (Phase 5D-1L) already decides node.prefix is set
      // for a composite-member "callout" row (same STANDALONE_CALLOUT_PREFIX
      // a standalone callout gets) and left undefined for "blockquote" —
      // this rendering code is unchanged and shared by both.
      const innerEl = selfEl.createDiv({
        cls: "tree-item-inner unified-outliner-complex-member-text",
      });
      if (node.prefix) {
        innerEl.createSpan({
          cls: "unified-outliner-complex-member-prefix",
          text: node.prefix,
        });
      }
      innerEl.createSpan({ cls: "unified-outliner-complex-member-label", text: node.label });
    } else if (isOutlineParagraphNode(node)) {
      // Phase 5P-3 (design doc §4): "¶ " is a fixed, hardcoded symbol — NOT
      // read from headingPrefixStyle/listPrefixStyle or any other existing
      // prefix setting (those are section/list-specific display concerns;
      // conflating paragraph's marker with them was explicitly rejected by
      // the design). node.label is already the fully-resolved, truncated,
      // whitespace-normalized display text (tree/buildOutlineTree.ts's
      // paragraphTreeLabel) — this branch does no further text processing.
      const innerEl = selfEl.createDiv({
        cls: "tree-item-inner unified-outliner-paragraph-text",
      });
      innerEl.createSpan({
        cls: "unified-outliner-paragraph-prefix",
        text: "¶ ",
      });
      innerEl.createSpan({ cls: "unified-outliner-paragraph-label", text: node.label });
    }
    // Phase 5P-3 (design doc §6): deliberately NO further else branch here
    // (matches the pre-existing lack of a final else for composite/
    // complex-member above) — a paragraph row's label is rendered by the
    // branch just above, and its read-only status (readOnly, computed
    // above from collectReadOnlyOutlineNodeIds's explicit "paragraph"
    // inclusion) already gates it out of every rename/drag/context-menu/
    // mobile-long-press attachment point below without needing its own
    // exclusion at each site.

    selfEl.addEventListener("click", () => {
      // Mobile gesture layer, tier 1/3 of 3 (see the "Mobile gesture" block
      // below for tiers 2 and 3): swallow the one click a long press's own
      // touch-release synthesizes — see suppressNextTapClick's own doc
      // comment for why this must be checked, and reset, before anything
      // else in this handler runs.
      if (this.suppressNextTapClick) {
        this.suppressNextTapClick = false;
        return;
      }
      // Mobile gesture layer, tier 3 of 3: a tap landing on the row that's
      // ALREADY selected AND focused starts inline rename instead of
      // re-selecting it (a no-op selection change) — the same
      // `this.hasFocus && node.id === this.selectedId` pair renderNode's
      // own isSelected already uses to decide whether THIS row currently
      // renders with the "selected" highlight, so "already selected" here
      // means exactly what it visually looks like to the user, and both of
      // the spec's "解除条件" fall out of it for free: selecting a
      // DIFFERENT node changes selectedId away from this node's id, and
      // tapping outside the tree blurs treeRootEl (hasFocus → false) — see
      // onOpen's blur listener. Desktop is unaffected: double-click (an
      // entirely separate dblclick listener on innerEl, see below) remains
      // desktop's own primary rename trigger; this branch requires
      // Platform.isMobile on top of the already-selected check, so a
      // desktop click on an already-selected row keeps doing exactly what
      // it always did (re-preview into the body, harmless no-op selection
      // change).
      if (!readOnly && Platform.isMobile && this.hasFocus && node.id === this.selectedId) {
        this.beginRenameForNode(node.id);
        return;
      }
      // Mobile gesture layer, tier 1 of 3 / desktop's own click behavior,
      // unchanged: select + preview only, never edit or a menu.
      //
      // A mouse click is also a valid way to move the keyboard selection —
      // otherwise pressing an arrow key right after a click would jump
      // from whatever selectedId was left over from an earlier session
      // instead of the row the user just looked at / clicked.
      this.selectedId = node.id;
      // focusEditor: false — see jumpToLine's doc comment. A click is a
      // "preview/select" action: it moves the body cursor to this line and
      // scrolls it into view, but keeps DOM focus in the tree panel so an
      // immediately-following arrow key still navigates the tree instead
      // of silently being swallowed by the now-focused editor.
      this.jumpToLine(node.id, node.line, { focusEditor: false });
    });

    // Right-click structure menu: the full move/indent/outdent/contextual
    // menu (showStructureCommandMenu) stays section-only, unchanged from
    // Phase 3C ("list に対する新規の複雑な contextual コマンド" was
    // explicitly out of scope for Phase 4A too). Phase 4C gives list nodes
    // their own, deliberately minimal right-click menu instead — just the
    // Partial Edit Pane entry point (showListCommandMenu below) — rather
    // than folding list support into showStructureCommandMenu's much
    // larger menu.
    // Phase 5D-0.3 approval §1: no structure context menu for composite/
    // complex-member rows, and none for a list row currently inside a
    // composite either (readOnly covers all three).
    if (!readOnly && isOutlineSectionNode(node)) {
      selfEl.addEventListener("contextmenu", (evt) => {
        evt.preventDefault();
        this.showStructureCommandMenu(evt, node.id);
      });
    } else if (!readOnly && isOutlineListNode(node)) {
      selfEl.addEventListener("contextmenu", (evt) => {
        evt.preventDefault();
        this.showListCommandMenu(evt, node.id);
      });
    } else if (isComposite) {
      // Phase 5C-1 ticket 3b: a NEW, separate menu path for composite rows
      // — deliberately NOT gated by `!readOnly` (composite rows are always
      // in readOnlyNodeIds, which is what correctly keeps rename/drag/the
      // structure+list menus above off of them). Originally a delete-only
      // menu that showed nothing at all when not deletable; Phase 5D-2A
      // adds an always-shown "Open extended block in partial edit" item
      // (see showCompositeCommandMenu's own doc comment), so this menu is
      // no longer ever empty — move up/down/delete are still each
      // independently re-checked at menu-build time against this
      // refresh's currentComposites/currentComplexScan.
      selfEl.addEventListener("contextmenu", (evt) => {
        evt.preventDefault();
        this.showCompositeCommandMenu(evt, node.id);
      });
    } else if (
      isComplexMember &&
      node.isStandalone &&
      (node.complexKind === "callout" ||
        node.complexKind === "blockquote" ||
        node.complexKind === "fenced-code" ||
        node.complexKind === "table")
    ) {
      // Phase 5C-2: a THIRD, separate menu path — for a STANDALONE
      // callout/blockquote/fenced-code/table row only (node.isStandalone
      // === true).
      //
      // Phase 5E-0 ADDED the explicit complexKind guard above (originally
      // callout/blockquote only): once isStandaloneComplexBlockEligible
      // (tree/buildOutlineTree.ts) was widened to also produce
      // isStandalone: true rows for kind "fenced-code"/"table", this
      // branch would otherwise ALSO match those rows and unconditionally
      // call showStandaloneComplexBlockMenu — which itself unconditionally
      // offers "Open in Partial Edit"/"Open in new window". Phase 5E-1
      // widened the guard to also admit "fenced-code". Phase 5E-2A widens
      // it once more to admit "table" — every complexKind
      // isStandaloneComplexBlockEligible can produce for a standalone row
      // is now admitted here, so this guard's kind list and that
      // function's own kind list are, as of this phase, exactly the same
      // set (kept as an explicit allow-list here regardless, rather than
      // "anything complex-member and standalone", for the same defense-
      // in-depth reason the rest of this file re-verifies rather than
      // trusting an upstream classification).
      //
      // Per-kind capability matrix inside showStandaloneComplexBlockMenu
      // itself (see that method's own doc comment/body for exactly how
      // each is enforced):
      //   - callout / blockquote: Open in Partial Edit (+ new window),
      //     Move up/down when eligible. No Delete (never implemented for
      //     these two kinds).
      //   - fenced-code (Phase 5E-1): Open in Partial Edit (+ new
      //     window), Move up/down when eligible, Delete.
      //   - table (Phase 5E-2A): Open in Partial Edit (+ new window)
      //     ONLY — no Move (edit/moveStandaloneComplexBlock.ts's own
      //     StandaloneComplexBlockMoveKind allow-list, and
      //     parser/compositeBlocks.ts's evaluateStandaloneComplexBlockMovability,
      //     both still exclude "table" — UNCHANGED by this phase) and no
      //     Delete (showStandaloneComplexBlockMenu's Delete item is still
      //     gated `target.kind === "fenced-code"` exactly — UNCHANGED by
      //     this phase). Table's raw-Markdown Apply-time structural
      //     validation lives in edit/partialEdit.ts's own applySubtreeEdit
      //     table branch, not here.
      //
      // With every complex-member kind now admitted above, this branch's
      // only remaining gate against showing a menu for something that
      // should stay silent is isComplexMember && node.isStandalone itself
      // — a composite-member row (isStandalone === false) still falls to
      // the next branch below, and a plain paragraph/section/list row
      // never reaches this branch at all (already handled earlier in this
      // if/else chain). This is layer ONE of the required two-layer
      // defense for whatever a given kind is NOT allowed to do; layer TWO
      // is each capability's own independent module-level re-check
      // (edit/partialEdit.ts's extractComplexBlockText for Partial Edit,
      // edit/moveStandaloneComplexBlock.ts for Move, the Delete item's own
      // kind gate for Delete) — never this UI guard alone. Deliberately
      // NOT gated by `!readOnly` either, same reasoning as the composite
      // branch above (complex-member rows are always in readOnlyNodeIds —
      // neither Phase 5E-1 nor Phase 5E-2A alters
      // tree/buildOutlineTree.ts#collectReadOnlyOutlineNodeIds's kind-
      // inclusion logic; see this ticket's own design memo §3, and Phase
      // 5E-1's design memo §3 before it, for why: excluding a kind from
      // that set would silently also grant it several unrelated GENERIC
      // Tree capabilities — a drag handle, generic double-click rename,
      // and fully generic arbitrary-target drag-and-drop — none of which
      // either phase asked for. Every kind admitted here instead reaches
      // whatever capability it DOES have via this dedicated,
      // `!readOnly`-independent menu branch, never via exclusion from the
      // read-only set). Unlike showCompositeCommandMenu, this menu is
      // never empty and never re-checks eligibility at menu-build time —
      // its "Open in Partial Edit" item re-verifies its own target fresh
      // at click time anyway (activatePartialEditView -> PartialEditView's
      // own extractSubtreeText re-parse), matching how the section/list
      // "Open partial edit pane" items already work; its Move/Delete items
      // each independently re-verify at click time too (see
      // showStandaloneComplexBlockMenu's own doc comment).
      selfEl.addEventListener("contextmenu", (evt) => {
        evt.preventDefault();
        this.showStandaloneComplexBlockMenu(evt, node.id);
      });
    } else if (
      isComplexMember &&
      !node.isStandalone &&
      (node.complexKind === "callout" || node.complexKind === "blockquote")
    ) {
      // Phase 5D-0.4: a FOURTH complex-member menu path — for a
      // composite-member callout/blockquote row (node.isStandalone ===
      // false). matchCompositeBlocks (parser/compositeBlocks.ts) already
      // requires `editability === "supported"` for every member it
      // accepts, so a row reaching this branch is always resolvable by
      // extractSubtreeText exactly like a standalone row is — no
      // additional editability check is needed here. fenced-code/table/
      // thematic-break are excluded by the explicit kind check above even
      // though no shipped CompositeBlockRule currently produces them as a
      // second member (defensive, matches this ticket's own scope: only
      // callout/blockquote members get an editing entry point).
      //
      // Phase 5D-3B ("Composite Member Move Menu Parity") ADDED Move up/
      // down to this menu, reusing showStandaloneComplexBlockMenu's own
      // evaluateStandaloneComplexBlockMovability/
      // dispatchAndApplyStandaloneComplexBlockMove pipeline via the new,
      // opt-in `allowComposedMember: true` argument — see
      // parser/compositeBlocks.ts#evaluateStandaloneComplexBlockMovability's
      // doc comment for the full design. This menu (renamed
      // showComplexMemberMenu by Phase 5D-3B) is still deliberately NOT a
      // bare call to showStandaloneComplexBlockMenu: that method always
      // passes allowComposedMember's implicit default (false), so it would
      // keep rejecting a composite member with reason "composite-member"
      // — this menu instead computes movability itself, passing true, so
      // member Move can succeed when a genuine standalone sibling exists
      // while the moving-target-only, opt-in nature of the parameter
      // leaves the adjacent-candidate side (still standalone-only) and
      // every other standalone Tree Move call site completely unaffected.
      //
      // Phase 5D-2B ("CompositeBlock Structured Partial Edit Projection") REMOVED the
      // two "Open in Partial Edit" items this menu used to offer — see
      // showComplexMemberMenu's own doc comment for why a CompositeBlock
      // member must never be independently editable. This menu now only
      // ever offers Move up/down; editing this member happens exclusively
      // through the CompositeBlock's own parent-row menu
      // (showCompositeCommandMenu -> activatePartialEditViewForComposite).
      selfEl.addEventListener("contextmenu", (evt) => {
        evt.preventDefault();
        this.showComplexMemberMenu(evt, node.id);
      });
    } else if (isParagraph) {
      // Phase 5T-1 ("Outline Tree の paragraph context menu からの安全な上下
      // 移動"): a FIFTH, separate menu path — for a paragraph row only.
      // Deliberately NOT gated by `!readOnly`, same reasoning as the
      // composite/standalone branches above (paragraph rows are always in
      // readOnlyNodeIds — see collectReadOnlyOutlineNodeIds — and stay that
      // way; this menu is an explicit, narrow exception layered on top of
      // that read-only contract, not a relaxation of it). Unlike the other
      // three menus, this one has no delete/Partial-Edit/rename item at
      // all — see showParagraphMoveMenu's own doc comment — and, like
      // showCompositeCommandMenu, shows NO menu at all (not even an empty
      // one) when neither direction is currently eligible.
      selfEl.addEventListener("contextmenu", (evt) => {
        evt.preventDefault();
        this.showParagraphMoveMenu(evt, node.id);
      });
    }

    // ---- Mobile gesture layer (tier 2 of 3: long press → context menu) --
    //
    // Mobile has no right-click, so a long press stands in for it — opening
    // the EXACT SAME showStructureCommandMenu/showListCommandMenu used by
    // the desktop "contextmenu" listener just above (both already contain
    // a "Rename" item wired to beginRenameForNode, i.e. this ticket's
    // "編集" menu entry — no new menu items needed). Building this on
    // pointerdown/pointermove/pointerup rather than a "contextmenu" or
    // "touchstart" listener is deliberate: pointer events are the one
    // event family that fires uniformly for mouse, touch, and pen, so the
    // exact same timer/threshold logic below works whether Obsidian is
    // running as the desktop app (mouse) or the mobile app (touch) — the
    // `Platform.isMobile` guard is what actually keeps this mobile-only,
    // not the event family choice.
    //
    // Entirely additive: every listener here runs ALONGSIDE the click/
    // contextmenu listeners above, never replacing them, so nothing about
    // desktop's mouse-driven click/dblclick/contextmenu behavior changes.
    //
    // Phase 5D-0.3 approval §1: no long-press menu for composite/
    // complex-member rows or a list row inside a composite — skip attaching
    // this whole gesture layer for them rather than relying on the
    // timeout callback's isOutlineSectionNode/isOutlineListNode branches to
    // silently no-op (readOnly already implies that no-op today, but not
    // attaching the listeners at all is what actually matches the approval's
    // "付与しない" wording, and avoids the timer/suppressNextTapClick
    // machinery running for a gesture that can never open anything).
    if (!readOnly && Platform.isMobile) {
      let longPressTimerId: number | null = null;
      let longPressStart: { x: number; y: number } | null = null;

      const clearLongPressTimer = (): void => {
        if (longPressTimerId !== null) {
          window.clearTimeout(longPressTimerId);
          longPressTimerId = null;
        }
        longPressStart = null;
      };

      selfEl.addEventListener("pointerdown", (evt) => {
        // UXP-01: a touch starting ON the drag handle is never a
        // long-press-menu candidate — the handle is the ONLY mobile drag
        // trigger (see the draggable wiring further below), so arming this
        // timer for a handle-origin touch would race the handle's own
        // native drag-lift gesture, reintroducing exactly the bug this
        // ticket exists to fix. `evt.target` is the actual DOM node the
        // touch began on, not `selfEl` (the listener's attachment point),
        // so this correctly distinguishes "touched the handle" from
        // "touched anywhere else in the row" even though both dispatch
        // through this one selfEl-level listener.
        if (dragHandleEl && dragHandleEl.contains(evt.target as Node)) return;
        // Only the primary contact starts a long press — a second
        // simultaneous touch (e.g. the start of a pinch-zoom gesture)
        // shouldn't also arm a menu timer.
        if (!evt.isPrimary) return;
        clearLongPressTimer();
        longPressStart = { x: evt.clientX, y: evt.clientY };
        // Capture evt.clientX/evt.clientY now, in local consts, rather than
        // reading evt.* again once the timer fires: by then the original
        // PointerEvent object may already reflect a LATER pointer position
        // (browsers reuse/mutate some event objects), and we specifically
        // want the position where the press STARTED, not wherever the
        // finger happens to be 450ms later.
        const menuX = evt.clientX;
        const menuY = evt.clientY;
        longPressTimerId = window.setTimeout(() => {
          longPressTimerId = null;
          longPressStart = null;
          // Consumed once by the click handler above — see
          // suppressNextTapClick's own doc comment for why this is needed
          // (mobile browsers synthesize a "click" from the touch release
          // that follows, even though the long press already handled this
          // gesture).
          this.suppressNextTapClick = true;
          // Menu.showAtMouseEvent only ever reads clientX/clientY off its
          // argument, so a plain {clientX, clientY} object satisfies it
          // exactly as well as a real MouseEvent would, without having to
          // fabricate one just to match the parameter type. `unknown` as an
          // intermediate cast is required (rather than a direct `as
          // MouseEvent`) purely because TypeScript's structural-overlap
          // check rejects casting between two object types this different
          // in shape, even though the only property either call site
          // actually reads is present here.
          const menuEvt = { clientX: menuX, clientY: menuY } as unknown as MouseEvent;
          if (isOutlineSectionNode(node)) {
            this.showStructureCommandMenu(menuEvt, node.id);
          } else if (isOutlineListNode(node)) {
            this.showListCommandMenu(menuEvt, node.id);
          }
        }, LONG_PRESS_DURATION_MS);
      });

      // Movement past the threshold means "scroll/drag attempt, not a long
      // press" — cancel the pending timer so the menu doesn't pop open
      // underneath a finger that's mid-scroll.
      selfEl.addEventListener("pointermove", (evt) => {
        if (longPressTimerId === null || !longPressStart) return;
        if (
          exceedsLongPressMoveThreshold(
            longPressStart.x,
            longPressStart.y,
            evt.clientX,
            evt.clientY
          )
        ) {
          clearLongPressTimer();
        }
      });

      // Released, or the gesture was interrupted (an incoming call,
      // switching apps, the OS taking over for its own gesture, etc.)
      // before the duration threshold — either way, no menu should open.
      selfEl.addEventListener("pointerup", clearLongPressTimer);
      selfEl.addEventListener("pointercancel", clearLongPressTimer);
      selfEl.addEventListener("pointerleave", clearLongPressTimer);
    }

    // Phase 5C-1 ticket 3b: composite rows' own long-press → menu gesture.
    // A separate block from the `!readOnly && Platform.isMobile` one above
    // rather than folding composite in there, because that block's timer
    // callback only ever calls showStructureCommandMenu/showListCommandMenu
    // — composite rows are always `readOnly` (correctly, for rename/drag/
    // the structure+list menus), so they're excluded from that block
    // entirely, and need their own parallel wiring to reach
    // showCompositeCommandMenu.
    //
    // Phase 5D-4D (docs/phase5d4d_mobile_composite_block_drag_handle_design.md):
    // composite rows now DO have a mobile drag handle (dragHandleEl — see
    // its own creation above, generation condition widened to `!readOnly
    // || isComposite`), so a touch starting on that handle must be excluded
    // from arming this timer, exactly mirroring the generic `!readOnly &&
    // Platform.isMobile` block's own dragHandleEl exclusion above (this
    // block's own doc comment previously said no exclusion was needed —
    // that was true only while composite rows had no handle at all).
    // Without this guard, a handle-origin touch would race the handle's
    // own native drag-lift gesture against this row's long-press timer,
    // reintroducing the exact conflict UXP-01 already fixed for
    // section/list.
    if (isComposite && Platform.isMobile) {
      let longPressTimerId: number | null = null;
      let longPressStart: { x: number; y: number } | null = null;

      const clearLongPressTimer = (): void => {
        if (longPressTimerId !== null) {
          window.clearTimeout(longPressTimerId);
          longPressTimerId = null;
        }
        longPressStart = null;
      };

      selfEl.addEventListener("pointerdown", (evt) => {
        if (dragHandleEl && dragHandleEl.contains(evt.target as Node)) return;
        if (!evt.isPrimary) return;
        clearLongPressTimer();
        longPressStart = { x: evt.clientX, y: evt.clientY };
        const menuX = evt.clientX;
        const menuY = evt.clientY;
        longPressTimerId = window.setTimeout(() => {
          longPressTimerId = null;
          longPressStart = null;
          this.suppressNextTapClick = true;
          const menuEvt = { clientX: menuX, clientY: menuY } as unknown as MouseEvent;
          this.showCompositeCommandMenu(menuEvt, node.id);
        }, LONG_PRESS_DURATION_MS);
      });

      selfEl.addEventListener("pointermove", (evt) => {
        if (longPressTimerId === null || !longPressStart) return;
        if (
          exceedsLongPressMoveThreshold(
            longPressStart.x,
            longPressStart.y,
            evt.clientX,
            evt.clientY
          )
        ) {
          clearLongPressTimer();
        }
      });

      selfEl.addEventListener("pointerup", clearLongPressTimer);
      selfEl.addEventListener("pointercancel", clearLongPressTimer);
      selfEl.addEventListener("pointerleave", clearLongPressTimer);
    }

    // Phase 3A (section) / Phase 4A (list): drag & drop. Both node kinds
    // share this exact same attribute + handler wiring — only the pure
    // resolve/relocate calls inside handleDragOver/handleDrop/
    // runRelocateCommand below branch on the DRAGGED node's kind.
    //
    // UXP-01 (2026-08-12, superseding the 2026-08-11 mobile long-press
    // fix's approach — see docs/uxp-01-ipad-drag-context-menu.md): that
    // prior fix found that on iPadOS/mobile Safari, an element with
    // `draggable="true"` responds to a touch-and-hold with WebKit's OWN
    // native drag-lift gesture (which can hand the touch off to iPadOS as a
    // system-level drag, e.g. into a new Split View pane), racing against
    // this row's own pointerdown-timer-based long-press handling above for
    // the exact same gesture — confirmed on a real iPad as the cause of the
    // long-press context menu failing to open and a duplicated/ghosted pane
    // appearing instead. That fix's response was to never mark the ROW
    // draggable on mobile at all, removing touch drag-and-drop entirely.
    // UXP-01 instead marks ONLY dragHandleEl draggable on mobile — selfEl
    // itself stays non-draggable there — so the native drag-lift gesture
    // and the long-press timer are spatially separated onto two different
    // DOM elements (the timer's pointerdown handler above also explicitly
    // ignores handle-origin touches, so even bubbling can't re-couple
    // them). Confirmed working on a real iPad (finger and Apple Pencil) —
    // see the ticket's completion report for the full acceptance-criteria
    // results. Desktop is UNCHANGED: selfEl keeps `draggable` as before, so
    // mouse users keep grabbing the row from anywhere on it, not just the
    // handle.
    // Phase 5D-0.3 approval §1: composite/complex-member rows, and any list
    // row currently inside a composite, are neither a drag SOURCE nor a
    // drop TARGET — skipping every listener here (not just `draggable`)
    // means dragover/drop simply never fire on this row at all, which is
    // what actually makes it inert as a drop target too. (dragHandleEl is
    // already null for these rows — see its own creation above.)
    if (!readOnly) {
      if (Platform.isMobile) {
        dragHandleEl?.setAttribute("draggable", "true");
      } else {
        selfEl.setAttribute("draggable", "true");
      }
      selfEl.addEventListener("dragstart", (evt) =>
        this.handleDragStart(evt, node.id, itemEl)
      );
      selfEl.addEventListener("dragover", (evt) => this.handleDragOver(evt, node.id, selfEl));
      selfEl.addEventListener("dragleave", () => this.handleDragLeave(selfEl));
      selfEl.addEventListener("drop", (evt) => this.handleDrop(evt, node.id, selfEl));
      selfEl.addEventListener("dragend", () => this.handleDragEnd());
    } else if (isOutlineParagraphNode(node) && !Platform.isMobile) {
      // Phase 5T-2 ("Outline Tree paragraph の D&D による安全な隣接 swap",
      // docs/phase5t2_paragraph-tree-dnd-design.md): a FIFTH, entirely
      // separate drag-wiring branch — for a paragraph row only, desktop
      // only (see the 5T-2 ticket's §1/§8: "初期版はデスクトップ限定とし、
      // モバイル・タッチ・長押し D&D は実装しない" — Platform.isMobile is
      // excluded here rather than gated inside the handlers, so a mobile
      // paragraph row gets NO drag wiring/attribute at all, exactly like
      // it had none before this ticket). Deliberately NOT folded into the
      // `if (!readOnly)` block above: paragraph rows are ALWAYS in
      // readOnlyNodeIds (5T-2 design doc §2 — this ticket does not, and
      // must not, relax that), so widening that existing gate to admit
      // paragraph would also risk silently admitting rename/other
      // write-back wiring some future edit might add alongside it inside
      // that same block. This branch is a narrow, explicit, paragraph-only
      // exception layered on top of the read-only contract — mirroring
      // exactly how the paragraph context-menu branch above is its own
      // separate `else if (isParagraph)` rather than a relaxation of
      // `!readOnly` — never a general write-capability unlock.
      //
      // No dragHandleEl involvement at all: dragHandleEl is created only
      // for `!readOnly` rows (see its own creation above), and since this
      // is desktop-only, the row itself (`selfEl`) is the drag source —
      // exactly like desktop's existing section/list behavior already
      // uses `selfEl` rather than a handle.
      selfEl.setAttribute("draggable", "true");
      selfEl.addEventListener("dragstart", (evt) =>
        this.handleParagraphDragStart(evt, node, itemEl)
      );
      selfEl.addEventListener("dragover", (evt) => this.handleParagraphDragOver(evt, node, selfEl));
      // Reused verbatim from the section/list branch above — a purely
      // generic "if this row currently shows the shared drop indicator,
      // clear it" action with no dependency on dragSourceId/kind at all.
      selfEl.addEventListener("dragleave", () => this.handleDragLeave(selfEl));
      selfEl.addEventListener("drop", (evt) => this.handleParagraphDrop(evt, node, selfEl));
      // Also reused verbatim: handleDragEnd's endDrag() call now clears
      // paragraphDragSession too (see endDrag's own updated doc comment)
      // — no separate paragraph-specific dragend handler is needed. This
      // is also the SAME listener the HTML5 DnD spec's own Escape-cancels-
      // drag behavior relies on: pressing Escape mid-drag makes the
      // browser cancel the operation and fire "dragend" on the source
      // element exactly as if the drop had failed, so no dedicated
      // keydown/Escape handler is written for this feature at all.
      selfEl.addEventListener("dragend", () => this.handleDragEnd());
    } else if (
      isComplexMember &&
      node.isStandalone &&
      (node.complexKind === "callout" || node.complexKind === "blockquote") &&
      !Platform.isMobile
    ) {
      // Phase 5T-2 real-device-verification fix (found via the ticket's
      // own mandated 実機検証 pass, before this row's own D&D was ever
      // exercised against a live Obsidian instance): a standalone
      // callout/blockquote row is unconditionally in readOnlyNodeIds
      // (isComplexMember's own doc comment above), so it falls through
      // the `if (!readOnly)` branch exactly like a paragraph row does —
      // but it is never itself a paragraph node, so the
      // `isOutlineParagraphNode` branch above does not match it either.
      // Before this fix such a row therefore had NO drag wiring of any
      // kind attached (matching its pre-5T-2 "neither a drag source nor
      // a drop target" contract from Phase 5D-0.3 approval §1), which
      // silently made it impossible to ever drop a dragged paragraph
      // onto it: handleDragOver/handleParagraphDragOver never fired at
      // all on this row, so the browser's own "no listener called
      // preventDefault" behavior always cancelled the drop — this is
      // exactly the paragraph<->callout/blockquote non-swap the real
      // device pass first observed, root-caused here, and fixed by this
      // branch rather than merely documented as a known limitation.
      //
      // dragover/drop here handle BOTH an in-progress paragraph drag
      // session (this.paragraphDragSession — unchanged, original 5T-2
      // bridge behavior) AND, as of Phase 5D-3C, an in-progress callout/
      // blockquote drag session (this.calloutDragSession) targeting this
      // row — handleParagraphDragOver/handleParagraphDrop each check
      // this.calloutDragSession FIRST and delegate to the shared
      // handleCalloutDragOverNode/handleCalloutDropNode core when it is
      // set, before falling through to their original paragraph-only
      // logic (see either method's own updated doc comment).
      //
      // fenced-code/table/thematic-break are deliberately excluded here:
      // tree/buildOutlineTree.ts only ever computes `isStandalone: true`
      // for kind "callout"/"blockquote" (see that module's own
      // isStandaloneComplexBlock-equivalent check) — those other kinds
      // are never projected as their own Tree row at all, so there is no
      // row here to wire a listener onto for them. Paragraph D&D against
      // a fenced-code/table/thematic-break target therefore stays out of
      // reach via the Tree UI even after this fix — a known, pre-existing
      // Tree-view-model constraint (not a 5T-2 regression), recorded as
      // such in the 5T-2 completion report rather than silently
      // "verified" against a row that cannot exist.
      //
      // Phase 5D-3C ADDS `draggable`/`dragstart`/`dragend` here — a
      // standalone callout/blockquote row now ALSO becomes a valid D&D
      // SOURCE (not just a drop target), reusing handleCalloutDragStart
      // (the same dragstart handler the new composite-member branch below
      // uses too). This is purely additive: the row's pre-existing
      // drop-target behavior (for a paragraph drag) is completely
      // unchanged, and handleDragEnd's endDrag() already clears
      // calloutDragSession unconditionally (see that method's own updated
      // doc comment), so no new dragend logic was needed either.
      selfEl.setAttribute("draggable", "true");
      selfEl.addEventListener("dragstart", (evt) =>
        this.handleCalloutDragStart(evt, node, itemEl)
      );
      selfEl.addEventListener("dragover", (evt) =>
        this.handleParagraphDragOver(evt, node, selfEl)
      );
      selfEl.addEventListener("dragleave", () => this.handleDragLeave(selfEl));
      selfEl.addEventListener("drop", (evt) => this.handleParagraphDrop(evt, node, selfEl));
      selfEl.addEventListener("dragend", () => this.handleDragEnd());
    } else if (
      isComplexMember &&
      !node.isStandalone &&
      (node.complexKind === "callout" || node.complexKind === "blockquote") &&
      !Platform.isMobile
    ) {
      // Phase 5D-3C ("Callout and Blockquote Drag and Drop", 案A
      // approved): a SEVENTH, entirely new drag-wiring branch — for a
      // CompositeBlock-MEMBER callout/blockquote row (node.isStandalone
      // === false). Before this ticket such a row had NO drag wiring of
      // any kind (it fails every branch above: not `!readOnly`, not a
      // paragraph node, and the standalone bridge branch immediately
      // above requires `node.isStandalone`), matching the pre-5D-3C
      // Phase 5D-0.3 approval §1 contract
      // ("member child node...からの...drag & drop" intentionally
      // unaddressed — see docs/phase5d0_3_final-review.md §7).
      //
      // This ticket's own approval (案A) makes a composite-member row a
      // valid D&D SOURCE, on equal footing with a standalone row — reused
      // via the EXACT SAME handleCalloutDragStart used by the standalone
      // branch above. It deliberately does NOT join the standalone-only
      // paragraph<->callout/blockquote bridge as a drop TARGET for an
      // in-progress PARAGRAPH drag — that bridge's own `node.isStandalone`
      // gate (immediately above) is left untouched, so this ticket does
      // not widen paragraph D&D's own pre-existing target scope. This
      // row's own dragover/drop instead check ONLY
      // `this.calloutDragSession` directly (never paragraphDragSession),
      // via the same shared handleCalloutDragOverNode/handleCalloutDropNode
      // core every other eligible row kind uses.
      selfEl.setAttribute("draggable", "true");
      selfEl.addEventListener("dragstart", (evt) =>
        this.handleCalloutDragStart(evt, node, itemEl)
      );
      selfEl.addEventListener("dragover", (evt) => {
        if (this.calloutDragSession) this.handleCalloutDragOverNode(evt, node, selfEl);
      });
      selfEl.addEventListener("dragleave", () => this.handleDragLeave(selfEl));
      selfEl.addEventListener("drop", (evt) => {
        evt.preventDefault();
        if (!this.calloutDragSession) return;
        const session = this.calloutDragSession;
        this.clearDropIndicator();
        this.endDrag();
        this.handleCalloutDropNode(session, evt, node, selfEl);
      });
      selfEl.addEventListener("dragend", () => this.handleDragEnd());
    } else if (isComposite) {
      // Phase 5D-4C ("CompositeBlock Atomic Drag-and-Drop 最小実装", Phase
      // 5D-4B design approved): an EIGHTH, entirely new drag-wiring branch
      // — for a CompositeBlock PARENT row (isComposite).
      //
      // Phase 5D-4D (docs/phase5d4d_mobile_composite_block_drag_handle_design.md):
      // originally desktop only (`!Platform.isMobile`, mirroring Phase
      // 5T-2's own "初期版はデスクトップ限定" scope decision for paragraph
      // D&D — Phase 5D-4B design's approved minimum scope excluded
      // mobile/touch/long-press D&D for that earlier ticket). This ticket
      // widens the gate to admit mobile too, reusing the exact same UXP-01
      // handle pattern section/list already use (draggable on dragHandleEl
      // for mobile, on selfEl for desktop — see just below). An iPad real-
      // device spike (recorded in the design memo above) confirmed that
      // existing pattern's native HTML5 D&D already works reliably from a
      // standalone handle before this ticket extended it here. None of the
      // five listeners below change.
      //
      // A CompositeBlock parent row is ALWAYS in readOnlyNodeIds (Phase
      // 5D-0.3 approval §1 — rename/indent/outdent/delete/member-level
      // operations stay fully excluded, UNCHANGED by this ticket), so this
      // row matched none of the branches above (not `!readOnly`, not a
      // paragraph, not a complex-member) until now. This branch adds ONLY
      // drag wiring — no rename, no indent/outdent, no delete-via-drag —
      // on top of that still-unrelaxed read-only contract.
      //
      // A composite row is BOTH a valid D&D SOURCE (dragstart, via
      // handleCompositeDragStart, reusing buildCompositeBlockSnapshot —
      // the exact same snapshot builder showCompositeCommandMenu's own
      // Move/Delete items already use) AND a valid D&D TARGET for another
      // composite's own D&D (dragover/drop, via the shared
      // handleCompositeDragOverNode/handleCompositeDropNode core — see
      // those methods' own doc comments; the SAME core is also reached
      // from this class's own handleDragOver/handleDrop when a
      // compositeDragSession is hovering a plain LIST row instead). A
      // composite row is NEVER a valid target for any OTHER drag session
      // kind (paragraph/callout/section/list) — this branch intentionally
      // does not check this.paragraphDragSession/this.calloutDragSession/
      // this.dragSourceId at all, since none of those existing paths'
      // own target-resolution helpers ever recognized a composite row as
      // a target (calloutDropTargetHint explicitly excludes `isComposite`;
      // this row previously had no drag wiring of any kind) — this ticket
      // does not change any of that.
      //
      // Phase 5D-4D: `draggable` now follows the exact same platform split
      // as section/list's own UXP-01 wiring above — the handle is the sole
      // drag origin on mobile, `selfEl` stays the drag origin on desktop
      // (unchanged from Phase 5D-4C). `dragHandleEl` is guaranteed non-null
      // here: this branch only runs when `isComposite` is true, and the
      // generation condition above (`!readOnly || isComposite`) creates the
      // handle for exactly that case.
      if (Platform.isMobile) {
        dragHandleEl?.setAttribute("draggable", "true");
      } else {
        selfEl.setAttribute("draggable", "true");
      }
      selfEl.addEventListener("dragstart", (evt) =>
        this.handleCompositeDragStart(evt, node.id, itemEl)
      );
      selfEl.addEventListener("dragover", (evt) => {
        if (this.compositeDragSession) this.handleCompositeDragOverNode(evt, node, selfEl);
      });
      selfEl.addEventListener("dragleave", () => this.handleDragLeave(selfEl));
      selfEl.addEventListener("drop", (evt) => {
        evt.preventDefault();
        if (!this.compositeDragSession) return;
        const session = this.compositeDragSession;
        this.clearDropIndicator();
        this.endDrag();
        this.handleCompositeDropNode(session, evt, node, selfEl);
      });
      selfEl.addEventListener("dragend", () => this.handleDragEnd());
    }

    if (hasChildren && !isCollapsed) {
      const childrenEl = itemEl.createDiv({ cls: "tree-item-children" });
      childrenEl.setAttribute("role", "group");
      for (const child of node.children) {
        // 2026-08-12 amendment: read-only-ness for a composite's descendants
        // is now precomputed in this.readOnlyNodeIds (see refresh()), not
        // threaded through this recursive call — a plain, unparameterized
        // render.
        this.renderNode(child, childrenEl);
      }
    }
  }

  private toggleCollapse(id: string): void {
    this.setNodeCollapsed(id, !this.collapsedIds.has(id));
    this.renderTree();
  }

  /**
   * Phase 5T-5A (design doc §5-2, ticket decisions 2/3/5): consumes
   * this.pendingSelectionFollowLine, when set, by re-resolving it against
   * the JUST-REBUILT tree via the SAME resolveCurrentPositionNodeId used
   * for highlightedId (see that module's own doc comment on why sharing
   * one pure line->id resolver for both is intentional and safe — the two
   * STATE FIELDS stay fully independent; only this stateless computation
   * is shared). This is the actual fix for the reported bug: unlike
   * ensureSelection()'s pre-existing "is this id STRING still present in
   * the fresh tree" check (which can silently match a completely
   * different node that happens to reuse the same per-refresh ordinal
   * id — docs/phase5t5_cursor_to_tree_highlight_design.md §3-2), this
   * re-resolves the LOGICAL target from the operation's own post-edit
   * line, from scratch, every time.
   *
   * Ticket decision 2/5: when the line doesn't resolve to any Tree node at
   * all, OR resolves to a node that is currently hidden under a collapsed
   * ancestor, selectedId is cleared to null — never silently substituted
   * for a nearby/ancestor node (decision: "別 node への近似フォールバック
   * は禁止"), and fold state is never force-expanded to make the target
   * visible (decision 3). This is deliberately a STRICTER policy than
   * highlightedId's own nearest-visible-ancestor fallback (§5-4) — a
   * fold-hidden selection-follow target reads to the user as "selection
   * lost", which is the intended, honest signal here, not a silent jump to
   * an ancestor the user never selected.
   *
   * Falls through to the pre-existing ensureSelection() unchanged when no
   * follow line is pending (every refresh() trigger other than a
   * Tree-dispatched move/edit/Partial-Edit-save — debounced editor-change,
   * active-leaf-change, an unrelated keyup elsewhere).
   */
  private resolveSelectionAfterRefresh(
    doc: ParsedDocument,
    complexScan: ComplexBlockScanResult,
    includeLists: boolean
  ): void {
    const pendingLine = this.pendingSelectionFollowLine;
    this.pendingSelectionFollowLine = null;
    if (pendingLine !== null) {
      const candidate = resolveCurrentPositionNodeId(doc, pendingLine, complexScan, this.nodeById, {
        includeLists,
      });
      this.selectedId =
        candidate && isOutlineNodeVisible(candidate, this.parentIdById, this.collapsedIds)
          ? candidate
          : null;
      return;
    }
    this.ensureSelection();
  }

  /**
   * If selectedId is null, or no longer among the currently VISIBLE nodes
   * (e.g. its ancestor just got collapsed, or the underlying doc changed
   * enough to shift ids — see the currentDoc field's doc comment on id
   * stability), fall back to the cursor-synced node (if it's visible) or
   * else the first visible node. A no-op otherwise — this is deliberately
   * NOT "always sync selectedId to highlightedId", so an in-progress
   * keyboard navigation survives refreshes triggered by unrelated events
   * (see refresh()'s call site). Phase 5T-5A: this pre-existing id-presence
   * check is now used only as the FALLBACK path (no
   * pendingSelectionFollowLine pending) — see
   * resolveSelectionAfterRefresh, above, for the primary repair path this
   * ticket added.
   */
  private ensureSelection(): void {
    const visible = flattenVisibleOutlineTree(this.currentTree, this.collapsedIds);
    if (visible.length === 0) {
      this.selectedId = null;
      return;
    }
    if (this.selectedId && visible.some((n) => n.id === this.selectedId)) return;
    const highlighted = this.highlightedId;
    this.selectedId =
      highlighted && visible.some((n) => n.id === highlighted) ? highlighted : visible[0].id;
  }

  /**
   * Deferred to the next animation frame rather than querying/scrolling
   * synchronously right after renderTree()'s DOM rebuild — reading layout
   * (querySelector + scrollIntoView) immediately after a bulk DOM mutation
   * forces the browser to flush pending layout work synchronously (a
   * "forced reflow"), which shows up as a real, measurable stall on larger
   * trees. Letting the browser's own paint/layout cycle settle first (one
   * rAF tick, imperceptible — well under a frame) avoids that stall
   * without changing the visible behavior at all.
   *
   * Scheduled via `this.treeRootEl.win.requestAnimationFrame` rather than
   * the bare/global `requestAnimationFrame` — Obsidian augments every
   * HTMLElement with a `.win` property that is the Window that actually
   * owns that element's document (see obsidian.d.ts; this is the same
   * distinction the platform's own `activeWindow`/`activeDocument`
   * globals exist for: "usually the same as `window`, but will be
   * different when using popout windows"). When this Outline Tree View's
   * leaf has been moved to a popout window, `this.treeRootEl` lives in
   * that popout's document — scheduling against the wrong window's paint
   * cycle would tie this callback to a window that isn't the one actually
   * being redrawn, which is exactly the popout-compatibility bug this
   * distinction exists to prevent. Reading `.win` off the element itself
   * (rather than, say, `activeWindow`) also keeps this correct even if
   * the popout isn't the currently-focused window when the frame fires.
   */
  private scrollSelectedIntoView(): void {
    const targetId = this.selectedId;
    if (!targetId) return;
    this.treeRootEl.win.requestAnimationFrame(() => {
      if (this.selectedId !== targetId) return; // superseded by a newer navigation
      const rowEl = this.treeRootEl.querySelector<HTMLElement>(
        `#unified-outliner-row-${CSS.escape(targetId)}`
      );
      rowEl?.scrollIntoView({ block: "nearest" });
    });
  }

  /**
   * Up/Down move the keyboard selection between the rows currently on
   * screen (fold-aware, see flattenVisibleOutlineTree). Post-Phase-3D:
   * when the selection actually moves to a different node AND the
   * followKeyboardSelectionIntoBody setting is on (default), also previews
   * the newly selected row into the body editor exactly like a row click
   * does (see followSelectionIntoBody) — moves the body cursor/scroll, but
   * never steals DOM focus away from the tree panel, so arrow-key
   * browsing keeps working immediately afterward. Clamped at both ends,
   * no wraparound, matching standard tree/listbox widget behavior.
   */
  private moveSelection(delta: 1 | -1): void {
    const visible = flattenVisibleOutlineTree(this.currentTree, this.collapsedIds);
    if (visible.length === 0) return;
    this.ensureSelection();
    const previousId = this.selectedId;
    this.selectedId =
      delta === 1
        ? nextVisibleId(visible, this.selectedId)
        : prevVisibleId(visible, this.selectedId);
    if (this.shouldFollowInto(previousId, this.selectedId)) {
      this.followSelectionIntoBody();
    }
    this.renderTree();
    this.scrollSelectedIntoView();
  }

  /**
   * Reads plugin.settings.followKeyboardSelectionIntoBody and delegates the
   * actual decision to the pure `shouldFollowKeyboardSelectionIntoBody`
   * (tree/outlineNavigation.ts) — kept as a one-line wrapper here purely so
   * every call site reads the same way, rather than each one spelling out
   * `shouldFollowKeyboardSelectionIntoBody(this.plugin.settings...., ...)`.
   * See that function's doc comment for the two conditions it checks (the
   * setting, and whether selectedId actually changed) and why the
   * DOM-focus consequence of "should follow" stays a manual/実機
   * verification concern rather than something unit-tested here.
   */
  private shouldFollowInto(previousId: string | null, nextId: string | null): boolean {
    return shouldFollowKeyboardSelectionIntoBody(
      this.plugin.settings.followKeyboardSelectionIntoBody,
      previousId,
      nextId
    );
  }

  /**
   * Preview `this.selectedId` into the body editor the same way a row
   * click does: `jumpToLine(..., { focusEditor: false })`, so the body
   * cursor and scroll position follow the selection without moving DOM
   * focus out of treeRootEl (see jumpToLine's own doc comment on why
   * `focusEditor: false` is what keeps subsequent arrow keys navigating
   * the tree instead of the editor).
   *
   * Callers (moveSelection's Up/Down, and the "step into child" / "step
   * out to parent" branches of Right/Left below) are responsible for
   * checking shouldFollowInto() first — this method itself has no
   * setting/no-op guard beyond "is there actually a selected, resolvable
   * node", so it must never be called from the in-place fold/unfold
   * branches (setNodeCollapsed) of expandSelectionOrGoToFirstChild /
   * collapseSelectionOrGoToParent below, where selectedId doesn't change:
   * calling it there would re-jump to the same line, resetting the body
   * editor's scroll position to the top (scrollLineToTop) on every fold
   * toggle for no reason.
   */
  private followSelectionIntoBody(): void {
    if (!this.selectedId) return;
    const node = this.nodeById.get(this.selectedId);
    if (!node) return;
    this.jumpToLine(node.id, node.line, { focusEditor: false });
  }

  /**
   * Right arrow: standard tree widget behavior — expand a collapsed node
   * in place, or (already expanded) step selection into its first child.
   * No-op on an expanded leaf node (nothing to step into). A *collapsed*
   * leaf is not a no-op: a childless heading with a body can be folded
   * (canCollapseOutlineNode), so it has to be unfoldable from here too.
   */
  private expandSelectionOrGoToFirstChild(): void {
    this.ensureSelection();
    if (!this.selectedId) return;
    const node = this.nodeById.get(this.selectedId);
    if (!node) return;
    // A collapsed row expands whether or not it has child rows — a
    // childless heading can now be collapsed (see canCollapseOutlineNode),
    // so it must be re-expandable by the same key that expands any other
    // row. Only the "step into first child" branch below still requires
    // actual children.
    if (this.collapsedIds.has(node.id)) {
      if (!canCollapseOutlineNode(node, this.currentDoc)) return;
      this.setNodeCollapsed(node.id, false);
    } else if (node.children.length === 0) {
      return;
    } else {
      const previousId = this.selectedId;
      this.selectedId = node.children[0].id;
      if (this.shouldFollowInto(previousId, this.selectedId)) {
        this.followSelectionIntoBody();
      }
    }
    this.renderTree();
    this.scrollSelectedIntoView();
  }

  /**
   * Left arrow: standard tree widget behavior — collapse an expanded node
   * in place, or (already collapsed, or nothing to collapse) step selection
   * out to its parent. No-op at the root of the tree. "Expanded node" is
   * canCollapseOutlineNode's sense of it — a heading whose body is only
   * prose or a code block collapses here as well, matching the chevron.
   */
  private collapseSelectionOrGoToParent(): void {
    this.ensureSelection();
    if (!this.selectedId) return;
    const node = this.nodeById.get(this.selectedId);
    if (!node) return;
    if (canCollapseOutlineNode(node, this.currentDoc) && !this.collapsedIds.has(node.id)) {
      this.setNodeCollapsed(node.id, true);
      this.renderTree();
      this.scrollSelectedIntoView();
      return;
    }
    const parentId = this.parentIdById.get(node.id) ?? null;
    if (!parentId) return;
    const previousId = this.selectedId;
    this.selectedId = parentId;
    if (this.shouldFollowInto(previousId, this.selectedId)) {
      this.followSelectionIntoBody();
    }
    this.renderTree();
    this.scrollSelectedIntoView();
  }

  /**
   * Enter: commit the selected row into the body editor — unlike a row
   * click (see renderNode's click handler), this DOES hand focus to the
   * editor (focusEditor defaults to true), since Enter is the explicit
   * "I'm done browsing the tree, take me into the text" action called out
   * in the keyboard-nav spec ("Enterで選択中項目へ本文ジャンプ").
   */
  private activateSelection(): void {
    this.ensureSelection();
    if (!this.selectedId) return;
    const node = this.nodeById.get(this.selectedId);
    if (!node) return;
    this.jumpToLine(node.id, node.line);
  }

  /**
   * The sole keydown listener on treeRootEl (see onOpen). Only intercepts
   * the five keys this feature defines — every other key (Tab, Home/End,
   * a11y AT shortcuts, etc.) passes through untouched, matching how the
   * rest of this view only ever adds behavior on top of standard browser/
   * Obsidian defaults rather than replacing them wholesale.
   */
  private readonly handleTreeKeyDown = (evt: KeyboardEvent): void => {
    if (this.currentTree.length === 0) return;
    switch (evt.key) {
      case "ArrowDown":
        evt.preventDefault();
        evt.stopPropagation();
        this.moveSelection(1);
        break;
      case "ArrowUp":
        evt.preventDefault();
        evt.stopPropagation();
        this.moveSelection(-1);
        break;
      case "ArrowRight":
        evt.preventDefault();
        evt.stopPropagation();
        this.expandSelectionOrGoToFirstChild();
        break;
      case "ArrowLeft":
        evt.preventDefault();
        evt.stopPropagation();
        this.collapseSelectionOrGoToParent();
        break;
      case "Enter":
        evt.preventDefault();
        evt.stopPropagation();
        this.activateSelection();
        break;
      case "F2": {
        // Phase 5T-7A: F2 now has TWO possible destinations depending on
        // what is currently selected. When the selection resolves to a
        // paragraph Tree row, F2 opens the existing Paragraph Partial Edit
        // (the same destination this.selectedId's own dblclick and the
        // "段落を編集…" context menu item already use) INSTEAD of the
        // rename path below — beginRenameForNode already silently no-ops
        // for a paragraph node's kind (see its own guard), so today's F2
        // on a selected paragraph does nothing visible at all; this gives
        // it a real destination without touching beginRenameForNode or its
        // section/list contract.
        //
        // preventDefault()/stopPropagation() for THIS branch are scoped
        // inside it (called only once we've confirmed the selection is a
        // paragraph and are about to act on it), per the ticket's explicit
        // "paragraph の F2 を実際に処理した場合だけ適用する" contract. The
        // pre-existing, UNCONDITIONAL preventDefault()/stopPropagation()
        // for every other case (section/list/no-selection) below this is
        // left completely untouched — same lines, same order, same
        // behavior as before this phase.
        if (this.selectedId) {
          const selectedNode = this.nodeById.get(this.selectedId);
          if (selectedNode && isOutlineParagraphNode(selectedNode)) {
            evt.preventDefault();
            evt.stopPropagation();
            this.openParagraphPartialEditFromTree(this.selectedId);
            break;
          }
        }
        // Auxiliary rename trigger (see "---- Inline rename" section) — the
        // primary trigger is a row's own dblclick; F2 operates on whatever
        // is currently selected, matching standard tree/list-widget rename
        // conventions (Explorer, VS Code, etc.). Unchanged since before
        // Phase 5T-7A.
        evt.preventDefault();
        evt.stopPropagation();
        if (this.selectedId) this.beginRenameForNode(this.selectedId);
        break;
      }
    }
  };

  /**
   * Moves the body editor's cursor to `line` and scrolls it into view.
   *
   * Bug fix (post-Phase-4E user report): a row CLICK used to call this with
   * an unconditional `editor.focus()`. Since this view's keydown listener
   * lives solely on `treeRootEl` (see onOpen), that focus() call silently
   * moved DOM focus OUT of the tree panel and into the CodeMirror editor
   * on every click — so the very next arrow-key press (which the user
   * naturally expects to keep navigating the tree, per the keyboard-nav
   * spec's "サイドパネルにフォーカスがある状態で") was instead delivered
   * to the editor, moving its own cursor there. That's exactly the
   * reported symptom: "outline tree をカーソルで移動しても本文に変化がな
   * く、行っているうちに本文エディタにカーソルが移って移動してしまう。"
   *
   * Fix: `focusEditor` defaults to true (preserving Enter's "commit into
   * the editor" behavior — activateSelection relies on this default), but
   * a row click now explicitly passes `focusEditor: false`, which instead
   * refocuses `treeRootEl` — moving the body cursor/scroll position as a
   * preview without surrendering the panel's own keyboard focus, so
   * keyboard navigation keeps working immediately after a click.
   */
  private jumpToLine(
    id: string,
    line: number,
    options: { focusEditor: boolean } = { focusEditor: true }
  ): void {
    // Inline rename guard: a single click's whole job is "selection + body
    // sync + navigation" (see this method's own callers) — it must never
    // interact with an in-progress rename. In the ordinary case, clicking
    // elsewhere already blurs the rename <input> first (native focus
    // semantics fire that blur synchronously, before this "click" handler
    // even runs), and that blur's own guard already calls cancelRename()
    // and re-renders — so by the time control reaches here renameState is
    // already null and this bails out for the ordinary reason of "nothing
    // to guard". This check exists for the same defensive reason as
    // refresh()'s and the focus/blur handlers' own renameState guards: it
    // costs nothing and closes any remaining path (rapid/synthetic click
    // sequences, a click landing on the currently-renaming row's own
    // non-input area) where this method's unconditional renderTree() below
    // could otherwise tear down an open rename <input> without going
    // through cancelRename()/commitRename().
    if (this.renameState) return;

    const view = this.activeMarkdownView.get();
    if (!view) return;
    const editor = view.editor;
    editor.setCursor({ line, ch: 0 });
    this.scrollLineToTop(editor, line);
    if (options.focusEditor) {
      editor.focus();
    } else {
      this.treeRootEl.focus();
    }

    // Reflect the jump immediately rather than waiting for the next
    // keyup/mouseup-triggered refresh.
    this.highlightedId = id;
    this.renderTree();
  }

  /**
   * Scrolls the body editor so `line` lands at the TOP of the visible
   * viewport, rather than Obsidian's public `Editor.scrollIntoView`, whose
   * `center` boolean only offers "center it" or "minimal/nearest-edge
   * scroll" — neither of which reliably puts the target line at the top
   * (user report: after a tree jump, the target line could end up
   * anywhere in the viewport depending on where the previous scroll
   * position happened to be).
   *
   * `Editor.scrollIntoView` has no "align to start" option, so this reaches
   * into the underlying CM6 `EditorView` (via the `.cm` property that
   * Obsidian's Editor wrapper exposes — an unofficial but extremely
   * long-stable convention across the plugin ecosystem, not part of
   * obsidian.d.ts) and dispatches CM6's own `EditorView.scrollIntoView(pos,
   * { y: "start" })`, which is CM6's native, precise "top-align" primitive.
   * `@codemirror/view` is bundled by Obsidian itself and listed as an
   * esbuild `external` (see esbuild.config.mjs), so importing it here
   * resolves to the exact same module/prototypes Obsidian's own editor
   * uses — this is the standard, sanctioned way plugins interoperate with
   * CM6, not a bundling hack.
   *
   * Falls back to the previous `Editor.scrollIntoView(..., true)` (center)
   * behavior if `.cm` is ever absent — keeps this from throwing even if
   * that private property is renamed/removed in a future Obsidian version.
   */
  private scrollLineToTop(editor: Editor, line: number): void {
    const cm = getEditorCmView(editor);
    if (!cm) {
      const lineLength = editor.getLine(line)?.length ?? 0;
      editor.scrollIntoView(
        { from: { line, ch: 0 }, to: { line, ch: lineLength } },
        true
      );
      return;
    }
    // CM6's Text.line() is 1-indexed; Obsidian's Editor line numbers (and
    // this view's own `node.line`) are 0-indexed throughout.
    const clampedLine = Math.min(Math.max(line, 0), cm.state.doc.lines - 1);
    const pos = cm.state.doc.line(clampedLine + 1).from;
    cm.dispatch({ effects: EditorView.scrollIntoView(pos, { y: "start" }) });
  }

  /**
   * Icon substituted for a menu item's own icon when it would no-op, and
   * the text suffix appended to its title. `setDisabled` alone renders as
   * a small opacity change in Obsidian's default styling, which some
   * themes make hard to distinguish from an enabled item at a glance —
   * so infeasible items also get a distinct icon and an explicit text
   * marker, and are additionally flagged via setWarning() so themes that
   * do style "is-warning" (most do, since it is core Obsidian UI) render
   * them in a clearly different color as well. All three signals point
   * the same way, so no single theme quirk can make an unavailable item
   * look identical to an available one.
   */
  private static readonly UNAVAILABLE_ICON = "ban";
  // i18n実装: the " — unavailable" suffix text itself now lives in
  // src/i18n.ts as "tree.menu.unavailableSuffix" (this.plugin.t(...)), not
  // as a static English constant here — every call site above reads it via
  // the plugin's translator so it follows the language setting.

  /**
   * Right-click menu offering, top to bottom: the four Phase 2C fold-aware
   * contextual commands (labeled with the mode they will actually resolve
   * to, so the outcome stays predictable — docs §6.3), then the four
   * Phase 2B explicit, always-block-scoped "...subtree" commands. Every
   * item's feasibility is checked up front via canRunInMode (the same
   * findMoveTarget / findIndentTarget / findNodeOnlyMoveTarget /
   * findNodeOnlyLevelTarget predicates the dispatch layers themselves use)
   * purely to flag entries that would no-op — the actual commands still
   * no-op safely on their own if this check and the real attempt ever
   * disagree (e.g. the note changed in between).
   */
  private showStructureCommandMenu(evt: MouseEvent, sectionId: string): void {
    // 2026-08-12 amendment §E (defense in depth): renderNode's own
    // `!readOnly` gate already keeps this from ever being wired to a
    // composite/complex-member/composite-member row's contextmenu/long-press
    // listener in the first place; this second check is what refuses safely
    // even if some future caller reaches this method directly with such an
    // id (e.g. a keyboard shortcut added later that isn't as careful as
    // handleTreeKeyDown is today).
    if (this.readOnlyNodeIds.has(sectionId)) return;
    const doc = this.currentDoc;
    const node = doc?.nodes.get(sectionId);
    if (!doc || !node) return;

    const options: TreeBlockCommandOptions = {
      allowCrossSectionListMove: this.plugin.settings.allowCrossSectionListMove,
      normalizeOrderedLists: this.plugin.settings.normalizeOrderedLists,
    };
    const isCollapsed = this.collapsedIds.has(sectionId);
    const contextualMode: "block" | "node-only" = isCollapsed ? "block" : "node-only";
    const contextualModeLabel = this.plugin.t(
      isCollapsed ? "tree.menu.modeSubtree" : "tree.menu.modeNodeOnly"
    );

    const menu = new Menu();

    const addContextualItem = (
      title: string,
      icon: string,
      operation: TreeStructureOperation
    ) => {
      this.addMenuItem(
        menu,
        this.plugin.t("tree.menu.contextual", { title, mode: contextualModeLabel }),
        icon,
        this.canRunInMode(doc, node, operation, contextualMode, options),
        () => this.runContextualCommand(sectionId, operation)
      );
    };
    addContextualItem(this.plugin.t("tree.menu.moveUp"), "arrow-up", "move-up");
    addContextualItem(this.plugin.t("tree.menu.moveDown"), "arrow-down", "move-down");
    menu.addSeparator();
    addContextualItem(this.plugin.t("tree.menu.indent"), "indent", "indent");
    addContextualItem(this.plugin.t("tree.menu.outdent"), "outdent", "outdent");
    menu.addSeparator();

    this.addExplicitBlockItem(menu, doc, node, sectionId, options, this.plugin.t("tree.menu.moveSubtreeUp"), "arrow-up", "move-up");
    this.addExplicitBlockItem(menu, doc, node, sectionId, options, this.plugin.t("tree.menu.moveSubtreeDown"), "arrow-down", "move-down");
    menu.addSeparator();
    this.addExplicitBlockItem(menu, doc, node, sectionId, options, this.plugin.t("tree.menu.indentSubtree"), "indent", "indent");
    this.addExplicitBlockItem(menu, doc, node, sectionId, options, this.plugin.t("tree.menu.outdentSubtree"), "outdent", "outdent");
    menu.addSeparator();

    // Phase 3B: opens (or reuses, per main.ts's "one pane, not many"
    // policy) the Partial Edit Pane loaded with this section. A distinct
    // kind of action from the move/indent/outdent items above — it opens
    // another view rather than editing in place — so it's kept in its own
    // section at the bottom of the menu.
    menu.addItem((item) =>
      item
        .setTitle(this.plugin.t("tree.menu.openPartialEditPane"))
        .setIcon("edit-3")
        // void: onClick doesn't await its callback's return value, and
        // activatePartialEditView already catches its own failures
        // internally (see its doc comment in main.ts) and reports them
        // via Notice, so this is an intentional non-await, not a
        // suppressed error path.
        .onClick(() => void this.plugin.activatePartialEditView(sectionId))
    );

    // Phase 5A follow-up: collapses the previously two-step "open the
    // pane, then right-click its tab and choose the standard Move to new
    // window" flow into one click. Goes through the exact same
    // activatePartialEditView entry point (same load/Apply/Cancel/Close
    // plumbing) with { openInNewWindow: true } — see that method's doc
    // comment in main.ts for how it uses the official
    // openPopoutLeaf/moveLeafToPopout APIs and reports its own failures.
    menu.addItem((item) =>
      item
        .setTitle(this.plugin.t("tree.menu.openPartialEditPaneNewWindow"))
        .setIcon("picture-in-picture-2")
        .onClick(() =>
          void this.plugin.activatePartialEditView(sectionId, { openInNewWindow: true })
        )
    );

    // Phase 5C-1A/1B: block-level delete/insert common foundation. Insert
    // always asks for an explicit heading level via HeadingLevelModal (see
    // that class's doc comment for why a Modal, not a Menu submenu) —
    // dispatchAndApply's own fresh reparse inside the modal's callback is
    // what re-verifies sectionId still resolves after the modal closes, so
    // no extra re-check is needed here. Delete has no confirmation step,
    // consistent with this menu's existing move/indent/outdent items —
    // it's a normal editor.replaceRange edit, fully undoable via Obsidian's
    // own undo stack.
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle(this.plugin.t("tree.menu.insertSectionAfter"))
        .setIcon("plus")
        .onClick(() => this.runInsertSiblingSectionCommand(sectionId))
    );
    menu.addItem((item) =>
      item
        .setTitle(this.plugin.t("tree.menu.deleteSectionSubtree"))
        .setIcon("trash-2")
        .setWarning(true)
        .onClick(() => this.runDeleteCommand(sectionId))
    );
    // Auxiliary rename trigger (see "---- Inline rename" section) — the
    // primary trigger is a dblclick on the row's own label.
    menu.addItem((item) =>
      item
        .setTitle(this.plugin.t("tree.menu.rename"))
        .setIcon("pencil")
        .onClick(() => this.beginRenameForNode(sectionId))
    );

    this.showTrackedMenu(menu, evt);
  }

  /**
   * UXP-02 (2026-08-12, docs/uxp-02-long-press-menu-duplicate.md): the sole
   * entry point every menu this view opens (showStructureCommandMenu's and
   * showListCommandMenu's contextmenu/long-press call sites) must use
   * instead of calling `menu.showAtMouseEvent(evt)` directly. Hides
   * whatever menu this view previously had open — if any — before
   * recording and showing the new one, and clears the tracking field again
   * once the new menu itself is hidden (dismissed, an item clicked, or
   * superseded by a later call here), using an identity check so a stale
   * `onHide` firing after `activeMenu` has already moved on to a newer
   * menu can never null out that newer menu's own tracking. Does not touch
   * `Menu.prototype`, does not search the DOM for other menus, and never
   * hides/tracks a menu this view did not itself create — Obsidian's own
   * menus, other plugins' menus, and other views' menus are untouched.
   */
  private showTrackedMenu(menu: Menu, evt: MouseEvent): void {
    this.activeMenu?.hide();
    this.activeMenu = menu;
    menu.onHide(() => {
      if (this.activeMenu === menu) this.activeMenu = null;
    });
    menu.showAtMouseEvent(evt);
  }

  /**
   * Phase 4C: list nodes' own right-click menu — originally just the
   * Partial Edit Pane entry point, reusing the exact same
   * activatePartialEditView plumbing section nodes already use via
   * showStructureCommandMenu (it doesn't care about node kind — see
   * main.ts). Originally deliberately NOT the full move/indent/outdent/
   * contextual menu sections get — see the "Post-Phase-5A follow-up" note
   * below for why the block-scoped subset of that was added later, and why
   * the contextual (node-only) half is still intentionally absent.
   *
   * Mirrors showStructureCommandMenu's own "check feasibility, then flag
   * an infeasible item rather than letting it silently no-op after the
   * click" pattern: a list item with unsafeIndent (mixed tab/space
   * indentation) is refused by extractSubtreeText/applySubtreeEdit
   * (edit/partialEdit.ts) regardless, but disabling the menu item up
   * front — same UNAVAILABLE_ICON / UNAVAILABLE_SUFFIX / setWarning
   * treatment as every other infeasible item in this view — tells the
   * user why before they click, rather than after.
   *
   * Post-Phase-5A follow-up (UI-only, not a Phase 5B item): the
   * block-scoped Move up/down/Indent/Outdent this menu was missing —
   * findIndentTarget.ts/indentBlock.ts/findMoveTarget.ts/moveBlock.ts have
   * always been kind-agnostic (list items nest under their previous
   * sibling and outdent when they're their parent's last child, exactly
   * like a section subtree changes heading level), only the Outline Tree
   * View's own menu never exposed them here. This reuses the identical
   * addExplicitBlockItem/canRunInMode/runBlockCommand path
   * showStructureCommandMenu's "Move subtree up/down"/"Indent/Outdent
   * subtree" items already use — no list-specific feasibility or dispatch
   * logic was written for this. Deliberately still NOT the contextual
   * (node-only) variants: findNodeOnlyLevelTarget/findNodeOnlyMoveTarget
   * are heading-only by design (see their own doc comments), so a
   * node-only item here would just always render disabled.
   */
  private showListCommandMenu(evt: MouseEvent, listId: string): void {
    // 2026-08-12 amendment §E (defense in depth) — see the identical guard
    // at the top of showStructureCommandMenu above for the full rationale.
    // Here it also specifically covers a member list row (kind "list" but
    // currently inside a composite), which the section/list KIND checks
    // elsewhere in this file cannot distinguish on their own.
    if (this.readOnlyNodeIds.has(listId)) return;
    const doc = this.currentDoc;
    const node = doc?.nodes.get(listId);
    if (!doc || !node) return;

    const options: TreeBlockCommandOptions = {
      allowCrossSectionListMove: this.plugin.settings.allowCrossSectionListMove,
      normalizeOrderedLists: this.plugin.settings.normalizeOrderedLists,
    };
    const feasible = !(isListNode(node) && node.unsafeIndent);
    // Precise feasibility for "Insert child list item" (edit/insertBlock.ts's
    // insertChildListItem): unlike Partial Edit / the block-scoped Move/
    // Indent items above, unsafeIndent only actually blocks the "parent has
    // no children yet" branch (deriving a fresh contentColumn requires
    // column math) — when the parent already has children, the new item
    // mirrors the last child's own leading whitespace verbatim, which is
    // safe regardless of the parent's own unsafeIndent-ness.
    const childInsertFeasible =
      isListNode(node) && (node.childIds.length > 0 || !node.unsafeIndent);

    const menu = new Menu();

    this.addExplicitBlockItem(menu, doc, node, listId, options, this.plugin.t("tree.menu.moveSubtreeUp"), "arrow-up", "move-up");
    this.addExplicitBlockItem(menu, doc, node, listId, options, this.plugin.t("tree.menu.moveSubtreeDown"), "arrow-down", "move-down");
    menu.addSeparator();
    this.addExplicitBlockItem(menu, doc, node, listId, options, this.plugin.t("tree.menu.indentSubtree"), "indent", "indent");
    this.addExplicitBlockItem(menu, doc, node, listId, options, this.plugin.t("tree.menu.outdentSubtree"), "outdent", "outdent");
    menu.addSeparator();

    menu.addItem((item) =>
      item
        .setTitle(
          feasible
            ? this.plugin.t("tree.menu.editListSubtreeInPane")
            : `${this.plugin.t("tree.menu.editListSubtreeInPane")}${this.plugin.t("tree.menu.unavailableSuffix")}`
        )
        .setIcon(feasible ? "edit-3" : OutlineTreeView.UNAVAILABLE_ICON)
        .setDisabled(!feasible)
        .setWarning(!feasible)
        // void: same rationale as the "Open partial edit pane" item
        // above — onClick doesn't await its callback, and
        // activatePartialEditView already reports its own failures via
        // Notice internally.
        .onClick(() => void this.plugin.activatePartialEditView(listId))
    );

    // Phase 5A follow-up: same one-click popout shortcut as the section
    // menu's "Open partial edit pane in new window" — see the comment
    // there and activatePartialEditView's doc comment in main.ts. Subject
    // to the same feasibility check (unsafeIndent) as the docked variant
    // above, since it resolves to the exact same load/Apply path.
    menu.addItem((item) =>
      item
        .setTitle(
          feasible
            ? this.plugin.t("tree.menu.editListSubtreeInNewWindow")
            : `${this.plugin.t("tree.menu.editListSubtreeInNewWindow")}${this.plugin.t("tree.menu.unavailableSuffix")}`
        )
        .setIcon(feasible ? "picture-in-picture-2" : OutlineTreeView.UNAVAILABLE_ICON)
        .setDisabled(!feasible)
        .setWarning(!feasible)
        .onClick(() =>
          void this.plugin.activatePartialEditView(listId, { openInNewWindow: true })
        )
    );

    // Phase 5C-1A/1B: block-level delete/insert common foundation. Sibling
    // insert has no unsafeIndent restriction (verbatim leading-whitespace
    // copy, no column math — see edit/insertBlock.ts's insertListItemAfter
    // doc comment); child insert IS gated on feasibility here, mirroring
    // this menu's existing unsafeIndent-driven `feasible` flag, since a
    // childless parent with mixed tab/space indentation can't safely derive
    // a new contentColumn.
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle(this.plugin.t("tree.menu.insertListItemAfter"))
        .setIcon("plus")
        .onClick(() => this.runInsertSiblingListItemCommand(listId))
    );
    this.addMenuItem(
      menu,
      this.plugin.t("tree.menu.insertChildListItem"),
      "plus",
      childInsertFeasible,
      () => this.runInsertChildListItemCommand(listId)
    );
    menu.addItem((item) =>
      item
        .setTitle(this.plugin.t("tree.menu.deleteListSubtree"))
        .setIcon("trash-2")
        .setWarning(true)
        .onClick(() => this.runDeleteCommand(listId))
    );
    // Auxiliary rename trigger (see "---- Inline rename" section) — the
    // primary trigger is a dblclick on the row's own label.
    menu.addItem((item) =>
      item
        .setTitle(this.plugin.t("tree.menu.rename"))
        .setIcon("pencil")
        .onClick(() => this.beginRenameForNode(listId))
    );

    this.showTrackedMenu(menu, evt);
  }

  /**
   * Phase 5C-1 ticket 3b: composite rows' own right-click/long-press menu —
   * deliberately a delete-only menu, and deliberately separate from
   * showStructureCommandMenu/showListCommandMenu rather than folded into
   * either (composite rows are always in readOnlyNodeIds, which correctly
   * keeps them out of both of those). Not gated by readOnlyNodeIds itself —
   * that set is what this menu exists alongside, not what it's conditioned
   * on.
   *
   * MENU-BUILD-TIME ONLY: this.currentComposites/this.currentComplexScan
   * (this refresh cycle's own scan/match results) are used ONLY to decide
   * whether to show the delete item and to build the CompositeBlockSnapshot
   * passed into the confirmation modal. Once that snapshot exists, it is
   * never re-validated against these fields again — actual delete-time
   * safety is entirely deleteCompositeBlock's own re-parse/re-scan/re-match/
   * re-verify job (dispatchAndApplyCompositeDelete below), run against the
   * editor's content at the moment "Delete" is actually clicked. See this
   * class's own doc comment on currentComposites/currentComplexScan.
   *
   * If the composite cannot currently be resolved, this method returns
   * without opening any menu (an unresolvable composite has no snapshot to
   * act on at all). Otherwise the menu is NEVER empty: Phase 5D-2A adds a
   * brand-new, always-shown "Open extended block in partial edit" item
   * (this composite PARENT node's own new entry point — see
   * activatePartialEditViewForComposite's doc comment in main.ts; NOT
   * added to any other row's menu), mirroring
   * showStandaloneComplexBlockMenu's own "Partial Edit has no eligibility
   * concept of its own, so this menu is never empty" policy — the old
   * MVP-era "no menu at all when nothing is available" guard (§3) is
   * retired along with it, since there is now always at least this one
   * item. Move up / move down / delete remain gated exactly as before,
   * each INDEPENDENTLY (Phase 5C-1 ticket 4-4) — a composite can be
   * movable in one or both directions while not deletable, or vice versa,
   * since evaluateCompositeBlockMovability and
   * evaluateCompositeBlockDeletability are deliberately separate,
   * independently-re-derived judgments (see
   * evaluateCompositeBlockMovability's own doc comment).
   */
  private showCompositeCommandMenu(evt: MouseEvent, compositeId: string): void {
    const node = this.nodeById.get(compositeId);
    if (!node || !isOutlineCompositeNode(node)) return;

    const doc = this.currentDoc;
    const complexScan = this.currentComplexScan;
    const composite = this.currentComposites.find((c) => c.id === compositeId);
    if (!doc || !complexScan || !composite) return;

    const deletability = evaluateCompositeBlockDeletability(doc, complexScan, composite);
    const movabilityUp = evaluateCompositeBlockMovability(
      doc,
      complexScan,
      composite,
      "up",
      this.currentComposites
    );
    const movabilityDown = evaluateCompositeBlockMovability(
      doc,
      complexScan,
      composite,
      "down",
      this.currentComposites
    );

    const snapshot = buildCompositeBlockSnapshot(composite);
    const rules = getEnabledCompositeBlockRules(this.plugin.settings.compositeBlocks);
    const label = node.label;

    const menu = new Menu();

    // Phase 5D-2A: always shown, no eligibility concept of its own — see
    // this method's own doc comment above. PartialEditView re-resolves
    // `snapshot` independently against current ground truth
    // (extractCompositeBlockText) at load time, so no extra re-check is
    // needed here, exactly like showStandaloneComplexBlockMenu's identical
    // "Open in Partial Edit" item above.
    menu.addItem((item) =>
      item
        .setTitle(this.plugin.t("tree.menu.openCompositeInPartialEdit"))
        .setIcon("edit-3")
        .onClick(() => void this.plugin.activatePartialEditViewForComposite(snapshot))
    );

    if (movabilityUp.eligible) {
      menu.addItem((item) =>
        item
          .setTitle(this.plugin.t("tree.menu.compositeMoveUp"))
          .setIcon("arrow-up")
          .onClick(() => this.dispatchAndApplyCompositeMove(snapshot, "up", rules))
      );
    }
    if (movabilityDown.eligible) {
      menu.addItem((item) =>
        item
          .setTitle(this.plugin.t("tree.menu.compositeMoveDown"))
          .setIcon("arrow-down")
          .onClick(() => this.dispatchAndApplyCompositeMove(snapshot, "down", rules))
      );
    }
    if (deletability.deletable) {
      menu.addItem((item) =>
        item
          .setTitle(this.plugin.t("tree.menu.deleteCompositeBlock"))
          .setIcon("trash-2")
          .setWarning(true)
          .onClick(() => {
            new ConfirmCompositeDeleteModal(this.app, this.plugin, label, snapshot, (confirmed) => {
              if (confirmed) this.dispatchAndApplyCompositeDelete(snapshot, rules);
            }).open();
          })
      );
    }

    this.showTrackedMenu(menu, evt);
  }

  /**
   * Phase 5C-2: a standalone (non-composite-member) callout/blockquote
   * row's own right-click/long-press menu. Phase 5C-3 added move up/down
   * to what was, until then, a fixed single-item menu ("Open in Partial
   * Edit" only) — see this ticket's own approved scope. Kept entirely
   * separate from showCompositeCommandMenu (composite-member rows) rather
   * than folded into it, since node.isStandalone is what distinguishes the
   * two at the call site (see renderNode's `isComplexMember &&
   * node.isStandalone` branch) and their allowed actions are deliberately
   * disjoint (composite rows: delete + move, no Partial Edit; standalone
   * rows: Partial Edit + move, no delete/insert/duplicate).
   *
   * "Open in Partial Edit" reuses the exact tree.menu.openPartialEditPane
   * i18n key and activatePartialEditView entry point that
   * showStructureCommandMenu/showListCommandMenu's own "Open in Partial
   * Edit" items already use, and is ALWAYS shown, unconditionally —
   * activatePartialEditView's own re-parse (via extractSubtreeText) is
   * what re-verifies this id still resolves to a supported standalone
   * callout/blockquote at click time, no extra re-check needed here. Move
   * up/down are each independently gated by
   * evaluateStandaloneComplexBlockMovability, mirroring
   * showCompositeCommandMenu's own per-direction gating — but UNLIKE that
   * method, this one never suppresses the whole menu when both directions
   * are ineligible: Partial Edit has no eligibility concept of its own, so
   * a standalone row's menu is never empty (Phase 5C-3 approval: "Partial
   * Edit しか出ない状態は正常" — a deliberate, accepted asymmetry with
   * showCompositeCommandMenu's "show nothing at all when every item is
   * unavailable" behavior).
   *
   * `this.currentComplexScan`/`this.currentComposites` (refresh()-time
   * cached values, Phase 5C-3 widened to be unconditionally populated — see
   * refresh()'s own doc comment) are used ONLY to decide which move items
   * to show and to build the move snapshot, exactly like
   * showCompositeCommandMenu's own use of the same two fields — never
   * treated as a source of move-time safety themselves. Actual move safety
   * is entirely moveStandaloneComplexBlock's/
   * evaluateStandaloneComplexBlockMovability's re-parse/re-scan/re-match/
   * re-evaluate job, run against the editor's content at the moment "Move
   * up"/"Move down" is actually clicked.
   *
   * No readOnlyNodeIds gate here: standalone complex-member rows are
   * unconditionally in that set (see collectReadOnlyOutlineNodeIds), so
   * this menu exists alongside that gate, not conditioned on it — same
   * relationship showCompositeCommandMenu has with the set.
   *
   * Phase 5C-4 ("Standalone Callout / Blockquote の Partial Edit Popout 完成
   * と元ノート同一性の安全化"): adds a second, also-unconditional item,
   * "Open in new window" — the exact same popout shortcut
   * showStructureCommandMenu's/showListCommandMenu's own
   * tree.menu.openPartialEditPaneNewWindow items already provide for
   * section/list, reusing that same i18n key (deliberately not a new
   * standalone-specific key — the wording is kind-neutral) and the exact
   * same, unchanged activatePartialEditView(nodeId, { openInNewWindow:
   * true }) entry point. No new eligibility gate: like "Open in Partial
   * Edit" above, this has no movability/deletability concept of its own,
   * so it is always shown whenever this menu is reached at all — the same
   * "never suppress the whole menu" asymmetry with showCompositeCommandMenu
   * this class doc comment above already establishes for this method.
   *
   * Phase 5E-1 ("fenced code block の raw Partial Edit・移動・削除") widened
   * this menu's reach to standalone fenced-code rows too (via renderNode's
   * own widened complexKind guard — see that branch's doc comment) and
   * added the kind-gated "Delete" item at the bottom of this method's body
   * (`target.kind === "fenced-code"` only).
   *
   * Phase 5E-2A ("Markdown table の raw Partial Edit・Apply 検証・安全な書き
   * 戻し") widens this menu's reach once more, to standalone table rows.
   * "Open in Partial Edit" (+ new window) above needs NO code change to
   * cover table — it was already kind-neutral, and
   * edit/partialEdit.ts#extractComplexBlockText now resolves "table" the
   * same way it resolves "fenced-code". Move up/down and Delete need NO
   * change either, for the opposite reason: `buildStandaloneComplexBlockSnapshot`
   * (edit/moveStandaloneComplexBlock.ts) still returns null for kind
   * "table" (its own StandaloneComplexBlockMoveKind allow-list is
   * unchanged), so the `if (snapshot)` block below never runs for a table
   * target; and the Delete item's own `target.kind === "fenced-code"`
   * gate below excludes "table" by construction. A table row's menu is
   * therefore always exactly one item long in practice ("Open in Partial
   * Edit" + "Open in new window"), with no move/delete capability — this
   * falls out of the existing per-kind gates already in this method's
   * body, not from any new table-specific branch.
   */
  private showStandaloneComplexBlockMenu(evt: MouseEvent, nodeId: string): void {
    const menu = new Menu();
    menu.addItem((item) =>
      item
        .setTitle(this.plugin.t("tree.menu.openPartialEditPane"))
        .setIcon("edit-3")
        // void: onClick doesn't await its callback's return value, and
        // activatePartialEditView already catches its own failures
        // internally and reports them via Notice — see its doc comment
        // in main.ts, and showStructureCommandMenu's identical item
        // above for the same pattern.
        .onClick(() => void this.plugin.activatePartialEditView(nodeId))
    );
    // Phase 5C-4: see this method's own doc comment above.
    menu.addItem((item) =>
      item
        .setTitle(this.plugin.t("tree.menu.openPartialEditPaneNewWindow"))
        .setIcon("picture-in-picture-2")
        .onClick(() =>
          void this.plugin.activatePartialEditView(nodeId, { openInNewWindow: true })
        )
    );

    const doc = this.currentDoc;
    const complexScan = this.currentComplexScan;
    const target = complexScan?.blocks.find((b) => b.id === nodeId);
    if (doc && complexScan && target) {
      const snapshot = buildStandaloneComplexBlockSnapshot(target);
      if (snapshot) {
        const rules = getEnabledCompositeBlockRules(this.plugin.settings.compositeBlocks);
        const movabilityUp = evaluateStandaloneComplexBlockMovability(
          doc,
          complexScan,
          target,
          "up",
          this.currentComposites
        );
        const movabilityDown = evaluateStandaloneComplexBlockMovability(
          doc,
          complexScan,
          target,
          "down",
          this.currentComposites
        );
        if (movabilityUp.eligible) {
          menu.addItem((item) =>
            item
              .setTitle(this.plugin.t("tree.menu.standaloneMoveUp"))
              .setIcon("arrow-up")
              .onClick(() => this.dispatchAndApplyStandaloneComplexBlockMove(snapshot, "up", rules))
          );
        }
        if (movabilityDown.eligible) {
          menu.addItem((item) =>
            item
              .setTitle(this.plugin.t("tree.menu.standaloneMoveDown"))
              .setIcon("arrow-down")
              .onClick(() => this.dispatchAndApplyStandaloneComplexBlockMove(snapshot, "down", rules))
          );
        }
      }

      // Phase 5E-1: a "Delete" item, fenced-code ONLY — deliberately not
      // offered for callout/blockquote (no such capability was requested
      // for those kinds this phase; see
      // edit/deleteStandaloneComplexBlock.ts's own top doc comment for why
      // this is intentionally a NEW, narrowly kind-scoped module rather
      // than a widened reuse of anything callout/blockquote already has).
      // Phase 5E-2A (table's Partial-Edit-only widening) leaves this exact
      // `target.kind === "fenced-code"` check UNCHANGED — table was never
      // asked to gain Delete, so it simply never reaches this block; no
      // additional exclusion logic is needed here for that.
      // Mirrors showCompositeCommandMenu's own delete item exactly:
      // build the delete snapshot at menu-build time, gate on it being
      // buildable at all (mirrors that method's `deletability.deletable`
      // gate), and defer all actual re-verification to
      // deleteStandaloneComplexBlock's own re-parse/re-scan/re-match job,
      // run only once "Delete" is confirmed in the modal.
      if (target.kind === "fenced-code") {
        const deleteSnapshot = buildStandaloneComplexBlockDeleteSnapshot(target);
        if (deleteSnapshot) {
          const rowNode = this.nodeById.get(nodeId);
          const label = rowNode && isOutlineComplexMemberNode(rowNode) ? rowNode.label : "";
          menu.addItem((item) =>
            item
              .setTitle(this.plugin.t("tree.menu.deleteFencedCodeBlock"))
              .setIcon("trash-2")
              .setWarning(true)
              .onClick(() => {
                new ConfirmFencedCodeDeleteModal(
                  this.app,
                  this.plugin,
                  label,
                  deleteSnapshot.range,
                  (confirmed) => {
                    if (confirmed) {
                      this.dispatchAndApplyStandaloneComplexBlockDelete(
                        deleteSnapshot,
                        getEnabledCompositeBlockRules(this.plugin.settings.compositeBlocks)
                      );
                    }
                  }
                ).open();
              })
          );
        }
      }
    }

    this.showTrackedMenu(menu, evt);
  }

  /**
   * Phase 5D-0.4: the composite-member counterpart of
   * showStandaloneComplexBlockMenu above — for a callout/blockquote row
   * that IS a CompositeBlock member (node.isStandalone === false).
   *
   * Phase 5D-2B ("CompositeBlock Structured Partial Edit Projection") REMOVED the two
   * "Open in Partial Edit" items this menu used to offer here — opening a
   * CompositeBlock member as its OWN, independent Partial Edit session let
   * a caller Apply just the list row, or just the callout/blockquote row,
   * in complete isolation, which directly breaks this ticket's "one
   * CompositeBlock, one session, one snapshot, one Apply" atomicity
   * requirement. Editing this member now only ever happens through the
   * CompositeBlock's OWN parent-row menu (showCompositeCommandMenu below
   * -> activatePartialEditViewForComposite), which loads and Applies the
   * list member and this trailing member together as one atomic unit —
   * see view/PartialEditView.ts#loadCompositeInternal/applyEdit's own doc
   * comments for how that pane internally reuses this exact member's
   * existing quote-prefix-projection UI without duplicating it. A
   * genuinely STANDALONE callout/blockquote (node.isStandalone === true)
   * is unaffected — showStandaloneComplexBlockMenu above still offers
   * Partial Edit, since a standalone block carries no atomicity
   * constraint of its own.
   *
   * Phase 5D-3B ("Composite Member Move Menu Parity") RENAMED this method
   * from showComplexMemberPartialEditMenu (it is no longer Partial-Edit-
   * only) and ADDED Move up/down items, mirroring
   * showStandaloneComplexBlockMenu's own Move-item block above almost
   * verbatim — same buildStandaloneComplexBlockSnapshot/
   * evaluateStandaloneComplexBlockMovability/
   * dispatchAndApplyStandaloneComplexBlockMove calls, same
   * tree.menu.standaloneMoveUp/standaloneMoveDown i18n keys (deliberately
   * reused, not duplicated — the wording ("Move up"/"Move down") carries no
   * "standalone"-specific phrasing and applies equally well here), same
   * "arrow-up"/"arrow-down" icons. The one difference: both
   * evaluateStandaloneComplexBlockMovability and
   * dispatchAndApplyStandaloneComplexBlockMove are called with
   * `allowComposedMember: true`, the new Phase 5D-3B opt-in that bypasses
   * ONLY the "composite-member" rejection for the MOVING target — every
   * other check (kind/editability, nested-in-list, the adjacency scan for
   * a genuine standalone sibling, different-section) is unchanged from the
   * standalone menu's own gate, and the adjacent-CANDIDATE side stays
   * standalone-only regardless. In the common 2-member composite-rule case
   * (image-ocr/image-quote) this naturally — never via a hardcoded
   * rejection — leaves Move up ineligible (the member's own anchor list
   * item is not a complex-block candidate) while Move down becomes
   * eligible exactly when a real standalone callout/blockquote member
   * follows in the same parent. A successful move reuses
   * moveStandaloneComplexBlock/swapBlocks unchanged: the member is moved
   * as one raw-range unit, with no correction to its `>` prefix, header,
   * fold marker, title, body, or blank-line gaps, and CompositeBlock
   * matching is allowed to dissolve — the Tree simply reprojects the moved
   * row to a standalone node on next refresh, per 案A (Phase 5D-3A).
   */
  private showComplexMemberMenu(evt: MouseEvent, nodeId: string): void {
    const menu = new Menu();

    // Phase 5D-2B ("CompositeBlock Structured Partial Edit Projection"): the two
    // standalone "Open in Partial Edit" items that used to live here were
    // REMOVED — see this method's own doc comment above for why a
    // CompositeBlock member must never be opened as its own, independent
    // Partial Edit session. Move up/down (below) are UNAFFECTED by this
    // removal — they operate on this member's own raw range as a
    // unit-move, never on its internal content, so they carry no
    // atomicity conflict of their own.

    const doc = this.currentDoc;
    const complexScan = this.currentComplexScan;
    const target = complexScan?.blocks.find((b) => b.id === nodeId);
    if (doc && complexScan && target) {
      const snapshot = buildStandaloneComplexBlockSnapshot(target);
      if (snapshot) {
        const rules = getEnabledCompositeBlockRules(this.plugin.settings.compositeBlocks);
        const movabilityUp = evaluateStandaloneComplexBlockMovability(
          doc,
          complexScan,
          target,
          "up",
          this.currentComposites,
          true
        );
        const movabilityDown = evaluateStandaloneComplexBlockMovability(
          doc,
          complexScan,
          target,
          "down",
          this.currentComposites,
          true
        );
        if (movabilityUp.eligible) {
          menu.addItem((item) =>
            item
              .setTitle(this.plugin.t("tree.menu.standaloneMoveUp"))
              .setIcon("arrow-up")
              .onClick(() =>
                this.dispatchAndApplyStandaloneComplexBlockMove(snapshot, "up", rules, true)
              )
          );
        }
        if (movabilityDown.eligible) {
          menu.addItem((item) =>
            item
              .setTitle(this.plugin.t("tree.menu.standaloneMoveDown"))
              .setIcon("arrow-down")
              .onClick(() =>
                this.dispatchAndApplyStandaloneComplexBlockMove(snapshot, "down", rules, true)
              )
          );
        }
      }
    }

    this.showTrackedMenu(menu, evt);
  }

  /**
   * Phase 5C-3: dedicated, thin dispatch for standalone (non-composite-
   * member) callout/blockquote move — mirrors dispatchAndApplyCompositeMove
   * exactly (same multi-cursor guard, same "read the editor's CURRENT text
   * and hand it to the pure function along with the menu-time snapshot"
   * shape, same applyLineEditOutcome/scroll/refresh tail). All Markdown
   * re-parsing, block re-resolution, snapshot comparison, movability
   * re-verification, and target/range resolution are
   * moveStandaloneComplexBlock's/evaluateStandaloneComplexBlockMovability's/
   * findStandaloneComplexBlockMoveTarget's job (see
   * edit/moveStandaloneComplexBlock.ts) — nothing here duplicates any of
   * it.
   *
   * Phase 5C-3 approval's own explicit, formal decision (SUPERSEDED by
   * Phase 5T-5A): Tree row selection follow-through used to not be
   * guaranteed by this method, since the cursor-follow resolver only
   * understood BlockNode ids (section/list) and could not resolve to a
   * complex-member row. Phase 5T-5A (docs/phase5t5_cursor_to_tree_highlight_design.md)
   * fixed this generally, for every Tree-dispatched move/edit in this
   * file, not specifically here — see this.queueSelectionFollow's own doc
   * comment and this method's own `this.queueSelectionFollow(outcome.newStartLine)`
   * call below. Body-editor cursor scroll (below) was never affected by
   * the old limitation, since it never depended on Tree node resolution
   * at all.
   *
   * `snapshot` reaches this function only via a closure captured at
   * menu-build time (showStandaloneComplexBlockMenu → here) — never a bare
   * complex-block id, for the same reason dispatchAndApplyCompositeDelete's
   * own doc comment explains for composites.
   *
   * Phase 5D-3B added the optional `allowComposedMember` parameter (default
   * `false`, so both existing call sites inside showStandaloneComplexBlockMenu
   * are unchanged and keep passing `false` implicitly) purely to thread it
   * through to moveStandaloneComplexBlock's own request object — see that
   * function's doc comment (edit/moveStandaloneComplexBlock.ts) for what the
   * flag does. Only showComplexMemberMenu's own Move up/down items pass
   * `true` here.
   */
  private dispatchAndApplyStandaloneComplexBlockMove(
    snapshot: StandaloneComplexBlockSnapshot,
    direction: StandaloneMoveDirection,
    rules: CompositeBlockRule[],
    allowComposedMember = false
  ): boolean {
    const view = this.activeMarkdownView.get();
    if (!view) return false;
    const editor: Editor = view.editor;

    if (editor.listSelections().length > 1) {
      this.notify(this.plugin.t("notice.multipleCursors"));
      return false;
    }

    const text = editor.getValue();
    const outcome = moveStandaloneComplexBlock(
      text,
      { snapshot, direction, allowComposedMember },
      rules
    );

    const cursor = { line: snapshot.range.startLine, ch: 0 };
    const changed = applyLineEditOutcome(
      editor,
      cursor,
      snapshot.range.startLine,
      text.split("\n"),
      outcome,
      () => this.notify(standaloneComplexBlockMoveReasonText((k) => this.plugin.t(k), outcome.reason))
    );

    if (changed) {
      const cur = editor.getCursor();
      const lineLen = editor.getLine(cur.line)?.length ?? 0;
      editor.scrollIntoView(
        { from: { line: cur.line, ch: 0 }, to: { line: cur.line, ch: lineLen } },
        true
      );
      this.queueSelectionFollow(outcome.newStartLine);
      this.refresh();
    }
    return changed;
  }

  /**
   * Phase 5E-1: dedicated, thin dispatch for standalone fenced-code-block
   * delete — mirrors dispatchAndApplyCompositeDelete's own structure
   * exactly (same multi-cursor guard, same "read the editor's CURRENT
   * text and hand it to the pure function along with the menu-time
   * snapshot" shape, same applyLineEditOutcome/scroll/refresh tail). All
   * Markdown re-parsing, ComplexBlock re-scan, snapshot re-match, and
   * shape/composite-membership re-verification are
   * deleteStandaloneComplexBlock's own job (see
   * edit/deleteStandaloneComplexBlock.ts) — nothing here duplicates any of
   * it.
   *
   * Reason -> Notice text goes through
   * edit/deleteStandaloneComplexBlock.ts's own exported
   * standaloneComplexBlockDeleteReasonText, not this view's own
   * reasonText — mirrors dispatchAndApplyStandaloneComplexBlockMove's
   * identical choice for the exact same reason (dedicated wording per
   * NoStandaloneComplexBlockDeleteReason value, not the generic
   * "reason." + reason lookup every other outcome in this view shares).
   *
   * `snapshot` reaches this function only via a closure captured at
   * menu-build time (showStandaloneComplexBlockMenu ->
   * ConfirmFencedCodeDeleteModal -> here) — never a bare complex-block id,
   * for the same reason dispatchAndApplyCompositeDelete's own doc comment
   * explains.
   */
  private dispatchAndApplyStandaloneComplexBlockDelete(
    snapshot: StandaloneComplexBlockDeleteSnapshot,
    rules: CompositeBlockRule[]
  ): boolean {
    const view = this.activeMarkdownView.get();
    if (!view) return false;
    const editor: Editor = view.editor;

    if (editor.listSelections().length > 1) {
      this.notify(this.plugin.t("notice.multipleCursors"));
      return false;
    }

    const text = editor.getValue();
    const outcome = deleteStandaloneComplexBlock(text, snapshot, rules);

    const cursor = { line: snapshot.range.startLine, ch: 0 };
    const changed = applyLineEditOutcome(
      editor,
      cursor,
      snapshot.range.startLine,
      text.split("\n"),
      outcome,
      () => this.notify(standaloneComplexBlockDeleteReasonText((k) => this.plugin.t(k), outcome.reason))
    );

    if (changed) {
      const cur = editor.getCursor();
      const lineLen = editor.getLine(cur.line)?.length ?? 0;
      editor.scrollIntoView(
        { from: { line: cur.line, ch: 0 }, to: { line: cur.line, ch: lineLen } },
        true
      );
      this.refresh();
    }
    return changed;
  }

  /**
   * Phase 5T-1: a paragraph row's own, deliberately narrow right-click
   * menu — originally "Move up"/"Move down" only, with no Partial Edit/
   * hoist entry point of any kind (5T-1 ticket §1: "Tree 起点の Partial
   * Edit is never added"). Still no delete/rename/insert/indent-outdent of
   * any kind. Never attached at all unless `isOutlineParagraphNode(node)`
   * is true (see renderNode's own context-menu chain above), and a
   * paragraph Tree node only ever exists in `this.currentTree` when
   * `settings.showParagraphsInOutline` is true (tree/buildOutlineTree.ts's
   * own "never even considered when off" design, confirmed unchanged by
   * Phase 5P-3) — so this method needs no separate settings check of its
   * own.
   *
   * Phase 5T-4A ("Tree paragraph → Partial Edit の最小実装",
   * docs/phase5t4_tree_paragraph_partial_edit_design.md): the 5T-1-era
   * "Tree 起点の Partial Edit is never added" boundary above was
   * explicitly, deliberately revisited by that ticket — this method now
   * ALSO adds one unconditional "段落を編集…" item that opens the paragraph
   * in the EXISTING Partial Edit Pane. This is deliberately NOT a new
   * editing model: no new anchor type, no new save/apply function, no Tree
   * row inline editor. The item's onClick hands `target.range.startLine`
   * (a plain line-number hint, freshly re-resolved by
   * `resolveParagraphFromTreeHint` just above) to the pre-existing, entirely
   * unmodified `main.ts#activatePartialEditViewForParagraph(cursorLine)` —
   * the exact same entry point the body-editor "Edit paragraph at cursor"
   * command already uses. That method's own paragraph-loading chain (see
   * view/PartialEditView.ts's `requestLoadParagraphAtCursor` /
   * `loadParagraphInternal`, and the cursor-based paragraph resolver those
   * call into) re-resolves the paragraph a SECOND time, independently, from
   * the CURRENT body text — so this call site only ever supplies a hint,
   * never a trusted identity. This method itself does not construct a
   * paragraph edit anchor, does not import the body-editor's cursor-based
   * paragraph resolver, and does not reference the Pane's own
   * paragraph-anchor field — see
   * tests/paragraphOutlineTreeUiWiring.test.ts's own "Phase 5T-4A" describe
   * block for the static checks that pin this down.
   *
   * `this.currentDoc`/`this.currentComplexScan` (refresh()-time cached
   * values) are used ONLY to decide which move items to show and to build
   * `anchor` — exactly like showCompositeCommandMenu's/
   * showStandaloneComplexBlockMenu's own use of the same fields, never
   * treated as move-time safety themselves. Actual move safety is entirely
   * edit/paragraphTreeMove.ts#moveParagraphFromAnchor's own re-parse/
   * re-scan/three-stage-re-verification job, run against the editor's
   * CURRENT content at the moment "Move up"/"Move down" is actually
   * clicked (see dispatchAndApplyParagraphMove below); paragraph edit
   * safety is entirely `edit/paragraphPartialEdit.ts#applyParagraphEdit`'s
   * own job, run again independently at Apply time inside the Partial Edit
   * Pane — nothing here duplicates either.
   *
   * Like showStandaloneComplexBlockMenu (which always has its own
   * unconditional Partial-Edit items to fall back on), this method now
   * ALWAYS shows at least the "段落を編集…" item once `target`/`anchor`
   * resolve successfully — the previous "no menu at all unless a move is
   * eligible" behavior (Phase 5T-1/5T-3A) no longer applies, since there is
   * now an unconditional item for an otherwise-empty menu to degrade to.
   * The method still shows NO menu at all when the paragraph itself cannot
   * be resolved (see the early `return`s below) — that guard is unchanged.
   *
   * `findComplexSiblingTarget` (move/resolveMoveTarget.ts, Phase 5P-4) is
   * reused verbatim here purely to decide menu-time ELIGIBILITY (which
   * move items to show) — the exact same function
   * edit/paragraphTreeMove.ts#moveParagraphFromAnchor calls again,
   * independently, at click time. No new adjacency/eligibility logic is
   * written in this file. The "段落を編集…" item has no adjacency/eligibility
   * concept of its own — it is available whenever the paragraph itself
   * resolves, exactly like showStandaloneComplexBlockMenu's own
   * unconditional "Open in Partial Edit" item.
   */
  private showParagraphMoveMenu(evt: MouseEvent, nodeId: string): void {
    const doc = this.currentDoc;
    const complexScan = this.currentComplexScan;
    // Real-device verification (Phase 5T-1 post-commit fix): a paragraph
    // Tree row's OWN `node.id` is `tree-paragraph:<ordinal>`
    // (tree/buildOutlineTree.ts's paragraphViewId) — a document-wide
    // display-ordinal id, NOT the scan-local `ComplexBlockInfo.id` that
    // standalone complex-member rows use as their Tree node id (those are
    // built with `id: info.id` directly — see buildStandaloneComplexNode).
    // Looking a paragraph up by `b.id === nodeId` against complexScan.blocks
    // therefore never matches anything, which silently produced an empty
    // menu for every paragraph row until this was caught by right-clicking
    // an actual paragraph node on a real device. The correct resolution —
    // and the one the 5T-1 ticket's own §3 already calls for ("Tree ノード
    // の開始位置をヒントとして、現在の本文から段落を解決する") — is to treat
    // the Tree node's own `rangeStart`/`rangeEnd`/`parentId` (available on
    // `OutlineTreeParagraphNode`, looked up via `nodeById`) as a HINT for
    // which live `ComplexBlockInfo` to resolve from the current scan, never
    // its `id` string.
    //
    // Phase 5T-1R: this resolution glue is no longer inline here — it is
    // now edit/paragraphTreeMove.ts#resolveParagraphFromTreeHint, a small
    // standalone pure function directly unit-tested (combining real
    // buildOutlineTree() output with real scanComplexBlocks() output —
    // see tests/paragraphTreeMove.test.ts) without needing a DOM or an
    // OutlineTreeView instance. This call site now only supplies the hint
    // and handles the null case; see that function's own doc comment for
    // the full root-cause writeup and the resolution contract this locks
    // in for every future Tree-triggered paragraph operation.
    const treeNode = this.nodeById.get(nodeId);
    if (!treeNode || !isOutlineParagraphNode(treeNode)) return;
    if (!doc || !complexScan) return;
    const target = resolveParagraphFromTreeHint(
      {
        rangeStart: treeNode.rangeStart,
        rangeEnd: treeNode.rangeEnd,
        parentId: treeNode.parentId,
      },
      complexScan
    );
    if (!target) return;

    const anchor = buildParagraphMoveAnchor(doc, target);
    if (!anchor) return;

    const unit: ResolvedMoveUnit = {
      kind: "paragraph",
      range: target.range,
      parentId: target.parentId,
      complexBlockId: target.id,
    };
    const upEligible = findComplexSiblingTarget(doc, unit, "up", complexScan).kind === "swap";
    const downEligible = findComplexSiblingTarget(doc, unit, "down", complexScan).kind === "swap";

    // Phase 5T-3A: the non-adjacent-move sibling group — every OTHER
    // paragraph/callout/blockquote sharing this paragraph's own parentId/
    // depth (edit/paragraphNonAdjacentMove.ts#listNonAdjacentMoveTargets),
    // in document order. Menu-time convenience only, exactly like
    // upEligible/downEligible above — the actual move always re-resolves
    // both source and target independently at click time (see
    // dispatchAndApplyParagraphNonAdjacentMove below).
    const depth = complexBlockDepth(doc, target.parentId);
    const siblingGroup = listNonAdjacentMoveTargets(complexScan, target.range, target.parentId, depth, doc);

    // Phase 5T-4A: no eligibility guard here — "段落を編集…" below is
    // unconditional once `target`/`anchor` resolved (checked above), so
    // there is always at least one item to show. The previous "no menu at
    // all when no move is eligible" early return (Phase 5T-1/5T-3A) is
    // removed accordingly — see this method's own doc comment.
    const menu = new Menu();

    // Phase 5T-4A: unconditional — opens the EXISTING paragraph Partial
    // Edit path (main.ts#activatePartialEditViewForParagraph), never a new
    // one. `target.range.startLine` is a plain line-number hint; the Pane
    // re-resolves the paragraph independently from the current body text
    // before ever showing it, so a stale hint here can only ever produce a
    // safe Notice, never a wrong paragraph loaded — see this method's own
    // doc comment for the full contract.
    menu.addItem((item) =>
      item
        .setTitle(this.plugin.t("tree.menu.paragraphEdit"))
        .setIcon("edit-3")
        .onClick(() =>
          void this.plugin.activatePartialEditViewForParagraph(target.range.startLine)
        )
    );

    // Phase 5T-10A: insert-before/insert-after items — the SAME in-scope
    // gate 5T-9A's own delete item uses (isInScopeParagraphParent),
    // computed once here and reused below for delete's own gate too, so
    // the two can never drift apart. Positioned right after "段落を編集…"
    // and before Move up/down — see edit/insertParagraph.ts's own top doc
    // comment for the full insert contract; choosing either item creates
    // the placeholder immediately and opens inline rename on it (no
    // confirmation modal — the rename commit/cancel itself IS the
    // confirm/rollback gate, per the 5T-10A ticket's own §4/§6).
    const inScopeForInsertAndDelete = isInScopeParagraphParent(doc, target.parentId);
    if (inScopeForInsertAndDelete) {
      menu.addItem((item) =>
        item
          .setTitle(this.plugin.t("tree.menu.insertParagraphBefore"))
          .setIcon("plus")
          .onClick(() => this.dispatchAndApplyParagraphInsert(anchor, "before"))
      );
      menu.addItem((item) =>
        item
          .setTitle(this.plugin.t("tree.menu.insertParagraphAfter"))
          .setIcon("plus")
          .onClick(() => this.dispatchAndApplyParagraphInsert(anchor, "after"))
      );
    }

    if (upEligible) {
      menu.addItem((item) =>
        item
          .setTitle(this.plugin.t("tree.menu.paragraphMoveUp"))
          .setIcon("arrow-up")
          .onClick(() => this.dispatchAndApplyParagraphMove(anchor, "up"))
      );
    }
    if (downEligible) {
      menu.addItem((item) =>
        item
          .setTitle(this.plugin.t("tree.menu.paragraphMoveDown"))
          .setIcon("arrow-down")
          .onClick(() => this.dispatchAndApplyParagraphMove(anchor, "down"))
      );
    }

    if (siblingGroup.length > 0) {
      const first = siblingGroup[0];
      const last = siblingGroup[siblingGroup.length - 1];
      const firstAnchor = buildSiblingTargetAnchor(doc, first);
      const lastAnchor = buildSiblingTargetAnchor(doc, last);
      if (firstAnchor) {
        menu.addItem((item) =>
          item
            .setTitle(this.plugin.t("tree.menu.paragraphMoveToTop"))
            .setIcon("chevrons-up")
            .onClick(() =>
              this.dispatchAndApplyParagraphNonAdjacentMove(anchor, firstAnchor, "before")
            )
        );
      }
      if (lastAnchor) {
        menu.addItem((item) =>
          item
            .setTitle(this.plugin.t("tree.menu.paragraphMoveToBottom"))
            .setIcon("chevrons-down")
            .onClick(() =>
              this.dispatchAndApplyParagraphNonAdjacentMove(anchor, lastAnchor, "after")
            )
        );
      }
      menu.addItem((item) =>
        item
          .setTitle(this.plugin.t("tree.menu.paragraphMoveBeforeSibling"))
          .setIcon("arrow-up-to-line")
          .onClick(() => this.showParagraphMoveTargetPicker(evt, doc, anchor, siblingGroup, "before"))
      );
      menu.addItem((item) =>
        item
          .setTitle(this.plugin.t("tree.menu.paragraphMoveAfterSibling"))
          .setIcon("arrow-down-to-line")
          .onClick(() => this.showParagraphMoveTargetPicker(evt, doc, anchor, siblingGroup, "after"))
      );
    }

    // Phase 5T-9A: delete item — shown ONLY for a top-level or
    // section-direct paragraph (edit/deleteParagraph.ts's own in-scope
    // check, reused verbatim here so this menu-time gate can never drift
    // from the pure function's own scope contract). A list-item-child
    // paragraph's menu simply never gets this item, the same "omit rather
    // than show disabled" convention showCompositeCommandMenu already
    // establishes. `treeNode.label` is the exact same truncated preview
    // text already shown in the Tree row — passed straight through to the
    // confirmation modal, never re-derived.
    if (inScopeForInsertAndDelete) {
      menu.addItem((item) =>
        item
          .setTitle(this.plugin.t("tree.menu.deleteParagraph"))
          .setIcon("trash-2")
          .setWarning(true)
          .onClick(() => {
            new ConfirmParagraphDeleteModal(this.app, this.plugin, treeNode.label, anchor, (confirmed) => {
              if (confirmed) this.dispatchAndApplyParagraphDelete(anchor);
            }).open();
          })
      );
    }

    this.showTrackedMenu(menu, evt);
  }

  /**
   * Phase 5T-7A: the single shared resolve+activate path for BOTH the
   * paragraph row's own dblclick listener and the F2 keyboard shortcut —
   * deliberately the exact same two steps showParagraphMoveMenu's own
   * unconditional "段落を編集…" item already performs (Phase 5T-4A):
   * re-resolve the Tree node's rangeStart/rangeEnd/parentId HINT against a
   * fresh scan via resolveParagraphFromTreeHint, then hand the resolved
   * paragraph's own current start line to the pre-existing, unmodified
   * main.ts#activatePartialEditViewForParagraph. No new anchor type, no
   * new save/apply function, no new resolution logic — this method only
   * decides WHEN to call the existing entry point, never HOW.
   *
   * Unlike the context menu (which simply omits/degrades its own item when
   * `target` fails to resolve — see that method's own doc comment), a
   * dblclick or F2 press is a single direct action with no menu to degrade
   * to, so this method shows an explicit Notice on the same failure modes
   * the ticket calls out ("解決不能・曖昧一致"): resolveParagraphFromTreeHint
   * returns null uniformly for both a fully-unresolvable hint AND an
   * ambiguous multi-match (see that function's own doc comment) — one
   * Notice covers both, matching how the ticket itself groups them. The
   * "active Markdown view 不在" case needs no handling here at all:
   * activatePartialEditViewForParagraph's own downstream call chain
   * (PartialEditView#loadParagraphInternal) already re-checks
   * activeMarkdownView and shows its own "partialEdit.noActiveNote" Notice
   * — duplicating that check here would just race a second, redundant
   * check against the same live state.
   *
   * Never mutates this.selectedId/this.highlightedId/collapsedIds itself —
   * a failed resolution simply returns after the Notice, leaving Tree
   * selection/current-position/fold state exactly as they were (the
   * ticket's own "起動失敗時に Tree selection / highlightedId / fold state
   * を壊さない" contract), and a successful call only ever opens/reveals
   * the Partial Edit Pane — refresh()/selection-follow for the Outline Tree
   * itself are untouched by this method.
   */
  private openParagraphPartialEditFromTree(nodeId: string): void {
    const treeNode = this.nodeById.get(nodeId);
    if (!treeNode || !isOutlineParagraphNode(treeNode)) return;
    const complexScan = this.currentComplexScan;
    if (!complexScan) {
      this.notify(this.plugin.t("reason.paragraphTreeMoveResolveFailed"));
      return;
    }
    const target = resolveParagraphFromTreeHint(
      {
        rangeStart: treeNode.rangeStart,
        rangeEnd: treeNode.rangeEnd,
        parentId: treeNode.parentId,
      },
      complexScan
    );
    if (!target) {
      this.notify(this.plugin.t("reason.paragraphTreeMoveResolveFailed"));
      return;
    }
    void this.plugin.activatePartialEditViewForParagraph(target.range.startLine);
  }

  /**
   * Phase 5T-7C: the single shared pointerdown handler behind BOTH the
   * rename-dblclick-replacement branch and the paragraph-dblclick-
   * replacement branch in renderNode above — the only difference between
   * the two call sites is which existing action `onDoubleClick` ultimately
   * invokes (beginRenameForNode vs. openParagraphPartialEditFromTree); the
   * detection mechanics themselves (hit-target eligibility, timing/distance
   * pairing, cross-render state bookkeeping) are identical and written
   * exactly once here.
   *
   * Pure decision logic lives in rowDoubleClickDetector.ts
   * (isEligibleRowBodyPointerDown / isDoubleClickPointerDown) — this method
   * is the thin DOM/view-state wiring around it: reads the event and
   * this.lastRowPointerDown, calls the pure functions, and either records
   * the current press as the new "previous" (first press of a pair, or an
   * unrelated single press elsewhere) or consumes it and fires
   * `onDoubleClick` (second press of a recognized pair).
   *
   * `evt.stopPropagation()` is called ONLY when a double click is actually
   * recognized — matching the old native `dblclick` listener's own
   * behavior, which by construction only ever ran once a real double click
   * had already happened. This deliberately leaves EVERY individual
   * pointerdown/click free to keep doing whatever it already does — this
   * row's own "click" listener still fires normally for both presses of a
   * double click, exactly as it did back when dblclick was native (see this
   * method's call sites' own doc comments).
   */
  private handleRowPointerDownForDoubleClick(
    evt: PointerEvent,
    nodeId: string,
    collapseEl: ContainsCheckable,
    dragHandleEl: ContainsCheckable | null,
    onDoubleClick: () => void
  ): void {
    if (
      !isEligibleRowBodyPointerDown({
        target: evt.target,
        button: evt.button,
        isPrimary: evt.isPrimary,
        collapseEl,
        dragHandleEl,
      })
    ) {
      return;
    }
    const current: RowPointerDownRecord = {
      nodeId,
      time: evt.timeStamp,
      x: evt.clientX,
      y: evt.clientY,
    };
    if (isDoubleClickPointerDown(current, this.lastRowPointerDown)) {
      this.lastRowPointerDown = null;
      evt.stopPropagation();
      // Real-device fix (post-5T-7C initial ship): `onDoubleClick` is
      // deferred to the next task rather than called synchronously here.
      // beginRenameForNode (heading/list) synchronously empties the row's
      // `innerEl` — the very element this `pointerdown` targeted — and
      // steals DOM focus onto a brand-new <textarea> (see beginRename's own
      // `innerEl.empty()` / `inputEl.focus()`). Doing that WHILE this
      // second press's own native mousedown→mouseup→click sequence is still
      // in flight (pointerdown fires before that sequence completes) races
      // the browser's own click/blur handling: the mousedown's original
      // target is gone by the time mouseup/click would fire for it, and the
      // textarea's own blur-cancels-when-unchanged guard (see its "blur"
      // listener's own doc comment) can fire before the user ever typed
      // anything, silently closing the rename the instant it opened —
      // confirmed on a real device as "dblclick does nothing" for
      // heading/list specifically (paragraph's own onDoubleClick,
      // openParagraphPartialEditFromTree, never touches this row's DOM/focus
      // at all, so it was unaffected). Deferring by one task lets this
      // press's native mouseup/click finish first, so beginRenameForNode
      // only ever mutates the DOM/focus once no mouse gesture is still in
      // flight — the same "clean" ordering the old native `dblclick` event
      // always had for free (dblclick only ever fires AFTER both full
      // click sequences have already completed). `this.treeRootEl.win` (not
      // the bare global `window`) matches this file's own established
      // popout-window convention — see scrollSelectedIntoView's own doc
      // comment. onDoubleClick's own closures only ever carry a primitive
      // node id (never a DOM/element reference), and both
      // beginRenameForNode and openParagraphPartialEditFromTree already
      // re-resolve fresh from that id on every call — see their own doc
      // comments — so this deferral is safe even if a `renderTree()`
      // happens to run (e.g. from this same click's own "click" listener)
      // before the deferred callback fires.
      this.treeRootEl.win.setTimeout(() => onDoubleClick(), 0);
      return;
    }
    this.lastRowPointerDown = current;
  }

  /**
   * Phase 5T-3A: the "指定 sibling の前へ/後へ移動…" two-step picker — a
   * SECOND `Menu`, shown at the SAME mouse-event coordinates immediately
   * after the first menu's item is clicked (Obsidian's `Menu` in this
   * codebase's pinned API version has no native submenu support — see the
   * ticket's own §3 candidate list, which explicitly allows "既存 menu か
   * ら二段階選択" as the minimal-diff option). Each entry reuses this
   * paragraph's own existing Tree label functions
   * (`paragraphTreeLabel`/`standaloneComplexBlockLabel`) so a sibling shows
   * with the exact same text it already has as a Tree row — no new label
   * logic is invented here. `doc`/`anchor`/`siblingGroup` are all captured
   * from the FIRST menu's build time; like every other menu-time
   * eligibility check in this view, this is display-only — the actual move
   * always re-resolves source AND target independently
   * (moveParagraphNonAdjacent's own job), so a stale label here can never
   * cause a wrong or unsafe write.
   */
  private showParagraphMoveTargetPicker(
    evt: MouseEvent,
    doc: ParsedDocument,
    sourceAnchor: ParagraphMoveAnchor,
    siblingGroup: ComplexBlockInfo[],
    position: NonAdjacentMovePosition
  ): void {
    const menu = new Menu();
    for (const info of siblingGroup) {
      // The "段落 N" ordinal fallback (paragraphTreeLabel's tier-3 label,
      // used only when the paragraph's own text has no letters/digits to
      // preview) is not re-derived here — this picker has no cheap access
      // to buildOutlineTree's document-wide paragraph ordinal without a
      // second full Tree build. `0` is passed instead: a label-worthy
      // paragraph (the overwhelming common case) never reaches that
      // fallback tier at all, so this only affects the rare
      // symbols/whitespace-only-paragraph case, and even then only this
      // picker ROW's display text — never move safety, which is entirely
      // `moveParagraphNonAdjacent`'s own re-resolution job.
      const label =
        info.kind === "paragraph"
          ? paragraphTreeLabel(
              doc.lines.slice(info.range.startLine, info.range.endLine + 1).join("\n"),
              0,
              (key) => this.plugin.t(key)
            )
          : standaloneComplexBlockLabel(doc, info, (key) => this.plugin.t(key));
      const targetAnchor = buildSiblingTargetAnchor(doc, info);
      if (!targetAnchor) continue;
      menu.addItem((item) =>
        item
          .setTitle(label)
          .onClick(() => this.dispatchAndApplyParagraphNonAdjacentMove(sourceAnchor, targetAnchor, position))
      );
    }
    this.showTrackedMenu(menu, evt);
  }

  /**
   * Phase 5T-3A: dedicated, thin dispatch for a paragraph non-adjacent
   * move — mirrors dispatchAndApplyParagraphMove exactly (same
   * multi-cursor guard, same "read the editor's CURRENT text and hand it
   * to the pure function along with the menu-time anchors" shape, same
   * applyLineEditOutcome/scroll/refresh tail). All re-parsing, the
   * source/target three-stage re-verification, the overlap/parent/depth
   * rejection, the cut-and-reinsert, and the blank-line safety step are
   * edit/paragraphNonAdjacentMove.ts#moveParagraphNonAdjacent's job —
   * nothing here duplicates any of it.
   */
  private dispatchAndApplyParagraphNonAdjacentMove(
    sourceAnchor: ParagraphMoveAnchor,
    targetAnchor: SiblingTargetAnchor,
    position: NonAdjacentMovePosition
  ): boolean {
    const view = this.activeMarkdownView.get();
    if (!view) return false;
    const editor: Editor = view.editor;

    if (editor.listSelections().length > 1) {
      this.notify(this.plugin.t("notice.multipleCursors"));
      return false;
    }

    const text = editor.getValue();
    const outcome = moveParagraphNonAdjacent(text, sourceAnchor, targetAnchor, position);

    const cursor = { line: sourceAnchor.rangeStart, ch: 0 };
    const changed = applyLineEditOutcome(
      editor,
      cursor,
      sourceAnchor.rangeStart,
      text.split("\n"),
      outcome,
      () => this.notify(paragraphNonAdjacentMoveReasonText((k) => this.plugin.t(k), outcome.reason))
    );

    if (changed) {
      const cur = editor.getCursor();
      const lineLen = editor.getLine(cur.line)?.length ?? 0;
      editor.scrollIntoView(
        { from: { line: cur.line, ch: 0 }, to: { line: cur.line, ch: lineLen } },
        true
      );
      this.queueSelectionFollow(outcome.newStartLine);
      this.refresh();
    }
    return changed;
  }

  /**
   * Phase 5T-1: dedicated, thin dispatch for a paragraph Tree-triggered
   * move — mirrors dispatchAndApplyCompositeMove/
   * dispatchAndApplyStandaloneComplexBlockMove exactly (same multi-cursor
   * guard, same "read the editor's CURRENT text and hand it to the pure
   * function along with the menu-time anchor" shape, same
   * applyLineEditOutcome/scroll/refresh tail). All re-parsing, the
   * three-stage re-verification, and the actual swap are
   * edit/paragraphTreeMove.ts#moveParagraphFromAnchor's job — nothing here
   * duplicates any of it.
   *
   * `anchor` reaches this function only via a closure captured at
   * menu-build time (showParagraphMoveMenu -> here) — never a bare
   * scan-local id, for the same reason the composite/standalone dispatch
   * methods' own doc comments explain. Per 5T-1 ticket §6 ("Tree の
   * paragraph selection を無理に復元しない"), Tree row selection
   * follow-through after a successful move used NOT to be guaranteed here
   * — SUPERSEDED by Phase 5T-5A, which added a general selection-follow
   * repair mechanism covering paragraph moves too (see
   * this.queueSelectionFollow's own doc comment and this method's own
   * `this.queueSelectionFollow(outcome.newStartLine)` call below). Body-
   * editor cursor scroll (below) was never affected by the old
   * limitation, since it never depended on Tree node resolution at all.
   */
  private dispatchAndApplyParagraphMove(
    anchor: ParagraphMoveAnchor,
    direction: MoveDirection
  ): boolean {
    const view = this.activeMarkdownView.get();
    if (!view) return false;
    const editor: Editor = view.editor;

    if (editor.listSelections().length > 1) {
      this.notify(this.plugin.t("notice.multipleCursors"));
      return false;
    }

    const text = editor.getValue();
    const outcome = moveParagraphFromAnchor(text, anchor, direction);

    const cursor = { line: anchor.rangeStart, ch: 0 };
    const changed = applyLineEditOutcome(
      editor,
      cursor,
      anchor.rangeStart,
      text.split("\n"),
      outcome,
      () => this.notify(paragraphTreeMoveReasonText((k) => this.plugin.t(k), outcome.reason))
    );

    if (changed) {
      const cur = editor.getCursor();
      const lineLen = editor.getLine(cur.line)?.length ?? 0;
      editor.scrollIntoView(
        { from: { line: cur.line, ch: 0 }, to: { line: cur.line, ch: lineLen } },
        true
      );
      this.queueSelectionFollow(outcome.newStartLine);
      this.refresh();
    }
    return changed;
  }

  /**
   * Phase 5T-9A: dedicated, thin dispatch for a paragraph Tree-triggered
   * delete — mirrors dispatchAndApplyParagraphMove immediately above almost
   * exactly (same multi-cursor guard, same "read the editor's CURRENT text
   * and hand it to the pure function along with the menu-time anchor"
   * shape, same applyLineEditOutcome/scroll/refresh tail). All re-parsing,
   * the three-stage re-verification, the scope/composite-member checks, the
   * blank-line-merge safety fix, and the post-delete fallback line are
   * edit/deleteParagraph.ts#deleteParagraph's job — nothing here duplicates
   * any of it.
   *
   * Unlike runDeleteCommand's own dispatchAndApply call (which passes
   * `followSelection = false`, since a generic section/list delete has "no
   * logical target left to follow"), this method DOES call
   * `queueSelectionFollow(outcome.newStartLine)` on success — the 5T-9A
   * ticket's own §6 explicitly defines a post-delete selection target
   * (next sibling → previous sibling → parent section, computed inside
   * deleteParagraph itself), so following it is the deliberately correct
   * choice here, not an oversight relative to the generic-delete pattern.
   *
   * `anchor` reaches this function only via a closure captured at
   * menu-build time (showParagraphMoveMenu -> ConfirmParagraphDeleteModal ->
   * here) — never a bare scan-local id, for the same reason every other
   * paragraph dispatch method in this class already requires.
   */
  private dispatchAndApplyParagraphDelete(anchor: ParagraphMoveAnchor): boolean {
    const view = this.activeMarkdownView.get();
    if (!view) return false;
    const editor: Editor = view.editor;

    if (editor.listSelections().length > 1) {
      this.notify(this.plugin.t("notice.multipleCursors"));
      return false;
    }

    const text = editor.getValue();
    const rules = getEnabledCompositeBlockRules(this.plugin.settings.compositeBlocks);
    const outcome = deleteParagraph(text, anchor, rules);

    const cursor = { line: anchor.rangeStart, ch: 0 };
    const changed = applyLineEditOutcome(
      editor,
      cursor,
      anchor.rangeStart,
      text.split("\n"),
      outcome,
      () => this.notify(paragraphDeleteReasonText((k) => this.plugin.t(k), outcome.reason))
    );

    if (changed) {
      const cur = editor.getCursor();
      const lineLen = editor.getLine(cur.line)?.length ?? 0;
      editor.scrollIntoView(
        { from: { line: cur.line, ch: 0 }, to: { line: cur.line, ch: lineLen } },
        true
      );
      this.queueSelectionFollow(outcome.newStartLine);
      this.refresh();
    }
    return changed;
  }

  private dispatchAndApplyParagraphInsert(
    anchor: ParagraphMoveAnchor,
    position: ParagraphInsertPosition
  ): boolean {
    const view = this.activeMarkdownView.get();
    if (!view) return false;
    const editor: Editor = view.editor;

    if (editor.listSelections().length > 1) {
      this.notify(this.plugin.t("notice.multipleCursors"));
      return false;
    }

    const text = editor.getValue();
    const rules = getEnabledCompositeBlockRules(this.plugin.settings.compositeBlocks);
    const outcome = insertParagraph(text, anchor, position, rules);

    const cursor = { line: anchor.rangeStart, ch: 0 };
    const changed = applyLineEditOutcome(
      editor,
      cursor,
      anchor.rangeStart,
      text.split("\n"),
      outcome,
      () => this.notify(paragraphInsertReasonText((k) => this.plugin.t(k), outcome.reason))
    );

    if (changed) {
      const cur = editor.getCursor();
      const lineLen = editor.getLine(cur.line)?.length ?? 0;
      editor.scrollIntoView(
        { from: { line: cur.line, ch: 0 }, to: { line: cur.line, ch: lineLen } },
        true
      );
      this.refresh();
      this.autoRenameAfterParagraphInsert(anchor, position);
    }
    return changed;
  }

  /**
   * Shared menu-item renderer: feasible items show the plain title/icon and
   * run `onClick`; infeasible ones get the same disabled/warning treatment
   * (UNAVAILABLE_SUFFIX/UNAVAILABLE_ICON) every no-op-able item in this view
   * uses, so a user sees why an action can't run before clicking rather
   * than after. Originally a local closure inside showStructureCommandMenu;
   * pulled out to a method so showListCommandMenu's block-scoped Move/
   * Indent/Outdent items (added post-Phase-5A) can render with the exact
   * same feasibility-then-flag pattern instead of a second implementation.
   */
  private addMenuItem(
    menu: Menu,
    title: string,
    icon: string,
    feasible: boolean,
    onClick: () => void
  ): void {
    menu.addItem((item) =>
      item
        .setTitle(
          feasible ? title : `${title}${this.plugin.t("tree.menu.unavailableSuffix")}`
        )
        .setIcon(feasible ? icon : OutlineTreeView.UNAVAILABLE_ICON)
        .setDisabled(!feasible)
        .setWarning(!feasible)
        .onClick(onClick)
    );
  }

  /**
   * Shared explicit-block-scoped menu item: always dispatches through
   * `runBlockCommand` (tree/treeBlockCommand.ts, kind-agnostic — see that
   * module's doc comment) regardless of fold state, unlike the section
   * menu's separate "contextual" items above. `canRunInMode(..., "block",
   * ...)` already handles both SectionBlockNode and ListBlockNode targets
   * (findMoveTarget.ts/findIndentTarget.ts have always branched on
   * `isListNode`), so this single method is what both
   * showStructureCommandMenu's "Move subtree up/down"/"Indent/Outdent
   * subtree" items and showListCommandMenu's identically-labeled items
   * (added post-Phase-5A to give list items the same UI entry point) call
   * — no separate list-specific feasibility or dispatch path exists.
   */
  private addExplicitBlockItem(
    menu: Menu,
    doc: ParsedDocument,
    node: BlockNode,
    nodeId: string,
    options: TreeBlockCommandOptions,
    title: string,
    icon: string,
    operation: TreeStructureOperation
  ): void {
    this.addMenuItem(
      menu,
      title,
      icon,
      this.canRunInMode(doc, node, operation, "block", options),
      () => this.runBlockCommand(nodeId, operation)
    );
  }

  /** Feasibility check for the given operation under a given dispatch mode. */
  private canRunInMode(
    doc: ParsedDocument,
    node: BlockNode,
    operation: TreeStructureOperation,
    mode: "block" | "node-only",
    options: TreeBlockCommandOptions
  ): boolean {
    if (mode === "block") {
      switch (operation) {
        case "move-up":
          return findMoveTarget(doc, node, "up", options).kind !== "none";
        case "move-down":
          return findMoveTarget(doc, node, "down", options).kind !== "none";
        case "indent":
          return findIndentTarget(doc, node, "indent").kind !== "none";
        case "outdent":
          return findIndentTarget(doc, node, "outdent").kind !== "none";
      }
    }
    switch (operation) {
      case "move-up":
        return findNodeOnlyMoveTarget(doc, node, "up").kind !== "none";
      case "move-down":
        return findNodeOnlyMoveTarget(doc, node, "down").kind !== "none";
      case "indent":
        return findNodeOnlyLevelTarget(node, "indent").kind !== "none";
      case "outdent":
        return findNodeOnlyLevelTarget(node, "outdent").kind !== "none";
    }
  }

  /**
   * Explicit, always-block-scoped command (Phase 2B) — ignores this node's
   * fold state entirely, always calling tree/treeBlockCommand.ts.
   */
  private runBlockCommand(sectionId: string, operation: TreeStructureOperation): void {
    this.dispatchAndApply(sectionId, (doc) =>
      runTreeBlockCommand(doc, sectionId, operation, {
        allowCrossSectionListMove: this.plugin.settings.allowCrossSectionListMove,
        normalizeOrderedLists: this.plugin.settings.normalizeOrderedLists,
      })
    );
  }

  /**
   * Fold-aware contextual command (Phase 2C) — routes through
   * tree/treeContextualCommand.ts, which itself picks block vs. node-only
   * based on `isCollapsed`. Read fresh at click time (not cached from when
   * the menu was built) so a collapse toggled while the menu happened to
   * be open can't produce a stale routing decision.
   */
  private runContextualCommand(sectionId: string, operation: TreeStructureOperation): void {
    const isCollapsed = this.collapsedIds.has(sectionId);
    this.dispatchAndApply(sectionId, (doc) =>
      runTreeContextualCommand(doc, sectionId, operation, isCollapsed, {
        allowCrossSectionListMove: this.plugin.settings.allowCrossSectionListMove,
        normalizeOrderedLists: this.plugin.settings.normalizeOrderedLists,
      })
    );
  }

  /**
   * Shared tail end for every tree-triggered command (Phase 2B block,
   * Phase 2C contextual — and, by construction, the node-only dispatch
   * Phase 2C's "expanded" branch resolves to): resolve `sectionId` against
   * a FRESH parse of the active note (not the possibly-stale
   * this.currentDoc — the tree only refreshes on a 150ms debounce, and
   * section ids are only meaningful within the parse they came from), run
   * `dispatch` to get an outcome, apply it via the same
   * applyLineEditOutcome the body-editor commands use, and rebuild the
   * tree immediately so the panel reflects the new structure without
   * waiting for the next debounced refresh. `dispatch` is the only thing
   * that differs between callers, so no move/indent logic — or its no-op
   * handling — is duplicated here.
   */
  /**
   * Phase 5T-5A: `followSelection` (default true) gates whether a
   * successful outcome also queues a selection-follow target
   * (this.queueSelectionFollow(outcome.newStartLine)) — true for every
   * move/indent/outdent call site (runBlockCommand/runContextualCommand/
   * runRelocateCommand: the operated-on content still exists afterward, so
   * "follow the same logical target" is well-defined), explicitly false
   * for every delete/insert call site (runDeleteCommand/
   * runInsertSiblingListItemCommand/runInsertChildListItemCommand/
   * runInsertSiblingSectionCommand: a deleted node has no logical target
   * left to follow, and an inserted node has no PRE-edit selection to have
   * been following — see this.pendingSelectionFollowLine's own doc
   * comment for why "no follow" is the deliberately correct choice for
   * both, not merely an omission).
   */
  private dispatchAndApply(
    sectionId: string,
    dispatch: (doc: ParsedDocument) => LineEditOutcome,
    followSelection = true
  ): boolean {
    const view = this.activeMarkdownView.get();
    if (!view) return false;
    const editor: Editor = view.editor;

    if (editor.listSelections().length > 1) {
      this.notify(this.plugin.t("notice.multipleCursors"));
      return false;
    }

    const doc = parseDocument(editor.getValue());
    const node = doc.nodes.get(sectionId);
    if (!node) {
      this.notify(this.plugin.t("reason.resolve-failed"));
      return false;
    }

    const outcome = dispatch(doc);

    // Unlike the body-editor commands, the triggering click doesn't imply
    // any particular editor cursor position, so there is no meaningful
    // "offset within the block" to preserve — land the cursor on the
    // operated-on node's own (new) start line instead (offset 0). This is
    // correct for both block outcomes (newStartLine = the subtree's new
    // position) and node-only outcomes (newStartLine is always the node's
    // original line, since node-only never relocates lines — see
    // move/moveNodeOnly.ts / level/setNodeOnlyLevel.ts), so no special
    // casing is needed between the two.
    const changed = applyLineEditOutcome(
      editor,
      { line: node.range.startLine, ch: 0 },
      node.range.startLine,
      doc.lines,
      outcome,
      () => this.notify(this.reasonText(outcome.reason))
    );

    if (changed) {
      const cur = editor.getCursor();
      const lineLen = editor.getLine(cur.line)?.length ?? 0;
      editor.scrollIntoView(
        { from: { line: cur.line, ch: 0 }, to: { line: cur.line, ch: lineLen } },
        true
      );
      if (followSelection) this.queueSelectionFollow(outcome.newStartLine);
      this.refresh();
    }
    return changed;
  }

  /**
   * Phase 5C-1 ticket 3b: dedicated, thin dispatch for composite-block
   * delete — deliberately NOT folded into dispatchAndApply above (approval
   * §1's "既存の dispatchAndApply は変更しないこと" plus a dedicated
   * function documenting more clearly, in one place, that it does none of
   * the actual re-parsing/re-matching/safety work itself). Its own
   * responsibilities stop at: resolve the active editor, reject multiple
   * cursors (same guard dispatchAndApply uses), read the editor's CURRENT
   * text, hand it to deleteCompositeBlock along with the snapshot built at
   * menu-time, apply the result via the SAME applyLineEditOutcome every
   * other tree command uses, and — success only — scroll + refresh() once.
   * All Markdown re-parsing, CompositeBlock re-resolution, snapshot
   * comparison, range computation, and deletability re-verification are
   * deleteCompositeBlock's/evaluateCompositeBlockDeletability's job (see
   * edit/deleteCompositeBlock.ts) — nothing here duplicates any of it.
   *
   * `snapshot` reaches this function only via a closure captured at
   * menu-build time (showCompositeCommandMenu → ConfirmCompositeDeleteModal
   * → here) — never a bare composite-N id, which cannot be trusted to
   * survive a re-parse (see CompositeBlockSnapshot's own doc comment).
   */
  private dispatchAndApplyCompositeDelete(
    snapshot: CompositeBlockSnapshot,
    rules: CompositeBlockRule[]
  ): boolean {
    const view = this.activeMarkdownView.get();
    if (!view) return false;
    const editor: Editor = view.editor;

    if (editor.listSelections().length > 1) {
      this.notify(this.plugin.t("notice.multipleCursors"));
      return false;
    }

    const text = editor.getValue();
    const outcome = deleteCompositeBlock(text, { snapshot }, rules);

    const cursor = { line: snapshot.range.startLine, ch: 0 };
    const changed = applyLineEditOutcome(
      editor,
      cursor,
      snapshot.range.startLine,
      text.split("\n"),
      outcome,
      () => this.notify(this.reasonText(outcome.reason))
    );

    if (changed) {
      const cur = editor.getCursor();
      const lineLen = editor.getLine(cur.line)?.length ?? 0;
      editor.scrollIntoView(
        { from: { line: cur.line, ch: 0 }, to: { line: cur.line, ch: lineLen } },
        true
      );
      this.refresh();
    }
    return changed;
  }

  /**
   * Phase 5C-1 ticket 4-4: dedicated, thin dispatch for composite-block
   * move — mirrors dispatchAndApplyCompositeDelete's own structure exactly
   * (same multi-cursor guard, same "read the editor's CURRENT text and
   * hand it to the pure function along with the menu-time snapshot" shape,
   * same applyLineEditOutcome/scroll/refresh tail). All Markdown
   * re-parsing, CompositeBlock re-resolution, snapshot comparison,
   * movability re-verification, and target/range resolution are
   * moveCompositeBlock's/evaluateCompositeBlockMovability's/
   * findCompositeMoveTarget's job (see edit/moveCompositeBlock.ts) —
   * nothing here duplicates any of it.
   *
   * Two differences from dispatchAndApplyCompositeDelete, both per this
   * ticket's approved design: (1) no confirmation modal — a move is
   * non-destructive and undoable the exact same way every other Tree move
   * already is (Obsidian's own Undo), unlike delete which removes content;
   * (2) reason -> Notice text goes through edit/moveCompositeBlock.ts's
   * exported compositeMoveReasonText, not this view's own reasonText — see
   * that function's own doc comment for why several of NoCompositeMoveReason's
   * values need move-specific wording rather than the ordinary "reason." +
   * reason lookup every other outcome in this view shares. Ticket 4-5
   * (2026-08-14) extracted that mapping out of this class (it was originally
   * a private method here) into a shared, Obsidian-independent function so
   * main.ts's own new cursor/selection-driven composite move commands could
   * reuse the exact same mapping instead of duplicating it.
   *
   * `snapshot` reaches this function only via a closure captured at
   * menu-build time (showCompositeCommandMenu → here) — never a bare
   * composite-N id, for the same reason dispatchAndApplyCompositeDelete's
   * own doc comment explains.
   */
  private dispatchAndApplyCompositeMove(
    snapshot: CompositeBlockSnapshot,
    direction: CompositeMoveDirection,
    rules: CompositeBlockRule[]
  ): boolean {
    const view = this.activeMarkdownView.get();
    if (!view) return false;
    const editor: Editor = view.editor;

    if (editor.listSelections().length > 1) {
      this.notify(this.plugin.t("notice.multipleCursors"));
      return false;
    }

    const text = editor.getValue();
    const outcome = moveCompositeBlock(text, { snapshot, direction }, rules);

    const cursor = { line: snapshot.range.startLine, ch: 0 };
    const changed = applyLineEditOutcome(
      editor,
      cursor,
      snapshot.range.startLine,
      text.split("\n"),
      outcome,
      () => this.notify(compositeMoveReasonText((k) => this.plugin.t(k), outcome.reason))
    );

    if (changed) {
      const cur = editor.getCursor();
      const lineLen = editor.getLine(cur.line)?.length ?? 0;
      editor.scrollIntoView(
        { from: { line: cur.line, ch: 0 }, to: { line: cur.line, ch: lineLen } },
        true
      );
      this.queueSelectionFollow(outcome.newStartLine);
      this.refresh();
    }
    return changed;
  }

  private notify(message: string | undefined): void {
    if (this.plugin.settings.showNoopNotices && message) new Notice(message);
  }

  /** Translate a no-op/rejection reason (see NOOP_MESSAGES's key set in commands/applyLineEditOutcome.ts) into the current locale. */
  private reasonText(reason: string | undefined): string | undefined {
    if (!reason) return undefined;
    return this.plugin.t(("reason." + reason) as TranslationKey);
  }

  // ---- Phase 5C-1A/1B: block-level delete/insert ------------------------

  /**
   * Delete a section or list subtree. Both node kinds share this one
   * dispatch since edit/deleteBlock.ts's deleteBlock() is already
   * kind-agnostic (BlockNode's range/prevSiblingId/nextSiblingId/parentId
   * are defined identically for both) — no separate section/list dispatch
   * was needed, mirroring runBlockCommand/runRelocateCommand's own
   * kind-agnostic dispatch pattern.
   */
  private runDeleteCommand(nodeId: string): void {
    // Phase 5T-5A: followSelection=false — a deleted node has no logical
    // target left to follow (see dispatchAndApply's own doc comment).
    this.dispatchAndApply(nodeId, (doc) => deleteBlock(doc, nodeId), false);
  }

  private runInsertSiblingListItemCommand(afterListItemId: string): void {
    // Phase 5T-5A: followSelection=false — an inserted node has no
    // pre-edit selection to have been following (see dispatchAndApply's
    // own doc comment). autoRenameAfterInsert below still relies on
    // highlightedId, unaffected by this.
    const changed = this.dispatchAndApply(
      afterListItemId,
      (doc) =>
        insertSiblingListItem(doc, afterListItemId, {
          normalizeOrderedLists: this.plugin.settings.normalizeOrderedLists,
        }),
      false
    );
    if (changed) this.autoRenameAfterInsert();
  }

  private runInsertChildListItemCommand(parentListItemId: string): void {
    // Phase 5T-5A: followSelection=false — see runInsertSiblingListItemCommand's own comment.
    const changed = this.dispatchAndApply(
      parentListItemId,
      (doc) =>
        insertChildListItem(doc, parentListItemId, {
          normalizeOrderedLists: this.plugin.settings.normalizeOrderedLists,
        }),
      false
    );
    if (changed) this.autoRenameAfterInsert();
  }

  /**
   * Opens HeadingLevelModal first (the level is never inferred — see that
   * class's doc comment), then dispatches through the exact same
   * dispatchAndApply tail every other tree command uses. dispatchAndApply
   * re-parses the editor's CURRENT content when the modal's callback
   * fires (not whatever was current when the menu was opened), so
   * afterSectionId is re-verified against live document state at the
   * moment of insertion, satisfying the "re-verify immediately before
   * mutating" requirement without any extra code here.
   */
  private runInsertSiblingSectionCommand(afterSectionId: string): void {
    new HeadingLevelModal(this.app, this.plugin, (level) => {
      if (level === null) return;
      // Phase 5T-5A: followSelection=false — see runInsertSiblingListItemCommand's own comment.
      const changed = this.dispatchAndApply(
        afterSectionId,
        (doc) => insertSiblingSection(doc, afterSectionId, level),
        false
      );
      if (changed) this.autoRenameAfterInsert();
    }).open();
  }

  /**
   * Insert 直後の自動 rename: dispatchAndApply's own internal refresh()
   * (already run by the time this is called) re-parses the note and
   * recomputes this.highlightedId from the EDITOR CURSOR — which
   * applyLineEditOutcome just placed exactly on the newly inserted block
   * via its newCursorCh (see edit/insertBlock.ts's InsertOutcome and
   * commands/applyLineEditOutcome.ts's newCursorCh handling). So
   * highlightedId already IS the new node's id here, with no separate
   * "which node did I just insert" tracking needed. beginRenameForNode
   * itself handles the (structurally unexpected) case where the row isn't
   * found in the freshly-rendered DOM by silently doing nothing.
   */
  private autoRenameAfterInsert(): void {
    if (this.highlightedId) this.beginRenameForNode(this.highlightedId);
  }

  // ---- Inline rename (section / list only) ------------------------------
  //
  // Layering (see this ticket's explicit separation requirement):
  //   1. Trigger layer: renderNode's dblclick listener (direct innerEl/
  //      selfEl references), handleTreeKeyDown's F2 case, and the
  //      "Rename" context-menu items — all funnel into either beginRename
  //      (has DOM references already) or beginRenameForNode (re-locates
  //      them by the row's stable DOM id first).
  //   2. UI layer: beginRename itself — builds the <textarea>, wires
  //      Enter/Escape/blur, toggles draggable off while open.
  //   3. Text adapter + re-verification: edit/renameBlock.ts (pure).
  //   4. Commit service: commitRename — one fresh re-parse, one
  //      applyLineEditOutcome call, success/failure.
  //   5. Tree refresh / selection restore: refresh()/ensureSelection(),
  //      entirely pre-existing — refresh() gains one early-return guard
  //      (see its own doc comment) and nothing else.
  //
  // Future callout/blockquote label editing (Phase 5D+) could reuse steps
  // 1/2/4/5 largely as-is; only step 3 (the adapter) would need a new
  // per-kind implementation, kept in its own module exactly like
  // renameSection/renameListItem are kept separate from each other now.

  /**
   * Begin renaming `nodeId`. `innerEl`/`rowSelfEl` are the row's own DOM
   * elements — renderNode's dblclick listener already has them on hand;
   * beginRenameForNode (F2 / context menu / auto-rename-after-insert) /
   * beginParagraphRenameForNode re-locate them by the row's stable
   * `unified-outliner-row-<id>` DOM id first, then delegate here.
   *
   * Phase 5T-8A: `kind: "paragraph"` is a NEW third arm, added ONLY as a
   * sibling to the pre-existing section/list snapshot-construction branch
   * below — that branch's own code (the `else` block just below) is
   * unmodified line-for-line by this ticket, satisfying "heading / list の
   * 既存 rename 契約を変えない". `paragraphSnapshot` is required (and always
   * provided by beginParagraphRenameForNode) exactly when `kind ===
   * "paragraph"`; the caller has already re-resolved it fresh via
   * resolveParagraphFromTreeHint + buildParagraphMoveAnchor (the same
   * pair showParagraphMoveMenu/handleParagraphDragStart already use), so
   * this method does not re-derive it from `nodeId`/`doc.nodes` the way it
   * does for section/list — a paragraph has no entry in `doc.nodes` at all
   * (it is a ComplexBlockInfo, not a BlockNode). Everything from
   * `innerEl.empty()` onward (textarea construction, keydown/input/blur/
   * click wiring, the "already renaming this node -> refocus" / "different
   * row -> cancel" guards above, and the final `this.renameState =`
   * assignment) is fully kind-agnostic and shared, unchanged, across all
   * three kinds — this is the literal "既存 inline rename UI を再利用す
   * る" the ticket calls for, not a parallel reimplementation.
   */
  private beginRename(
    nodeId: string,
    kind: "section" | "list" | "paragraph",
    innerEl: HTMLElement,
    rowSelfEl: HTMLElement,
    paragraphSnapshot?: ParagraphMoveAnchor,
    pendingParagraphInsert = false,
    insertOrigin?: { anchor: ParagraphMoveAnchor; position: ParagraphInsertPosition }
  ): void {
    // Already renaming this exact node (e.g. a second dblclick landed on
    // the now-open input, which is still inside innerEl and still carries
    // the dblclick listener attached in renderNode): refocus rather than
    // resetting in-progress typed text back to the original value.
    if (this.renameState && this.renameState.nodeId === nodeId) {
      this.renameState.inputEl.focus();
      this.renameState.inputEl.select();
      return;
    }
    // A different row is already mid-rename: starting a new one is a focus
    // move away from the old input, so cancel it first — same rule as
    // "input 外へのフォーカス移動は cancel を既定とする" applied to switching targets.
    if (this.renameState) this.cancelRename();

    let initialText: string;
    let snapshot: SectionRenameSnapshot | ListRenameSnapshot | ParagraphMoveAnchor;

    if (kind === "paragraph") {
      // Structurally unreachable given beginParagraphRenameForNode's own
      // contract (it never calls beginRename with kind "paragraph" unless
      // it already has a resolved anchor in hand) — defensive rather than
      // trusted blindly, same convention as this method's other guards.
      if (!paragraphSnapshot) {
        this.notify(this.plugin.t("reason.resolve-failed"));
        return;
      }
      initialText = paragraphSnapshot.originalText;
      snapshot = paragraphSnapshot;
    } else {
      const view = this.activeMarkdownView.get();
      if (!view) {
        this.notify(this.plugin.t("reason.no-active-editor"));
        return;
      }
      const doc = parseDocument(view.editor.getValue());
      const node = doc.nodes.get(nodeId);
      if (!node) {
        this.notify(this.plugin.t("reason.resolve-failed"));
        return;
      }
      if ((kind === "section") !== isSectionNode(node)) {
        this.notify(this.plugin.t("reason.type-changed"));
        return;
      }

      if (kind === "section") {
        const section = node as SectionBlockNode;
        // The REAL heading text, never the "(Untitled heading)" fallback
        // display string — per this ticket's explicit requirement.
        initialText = section.headingText;
        snapshot = { headingLevel: section.headingLevel };
      } else {
        const item = node as ListBlockNode;
        initialText = listItemDisplayText(doc, item);
        snapshot = {
          marker: item.listMarker,
          indentColumns: item.indentColumns,
          contentColumn: contentColumnOf(doc, item),
        };
      }
    }

    // textContent-only DOM construction throughout (innerEl.empty() +
    // createEl + the input's own .value property) — no innerHTML anywhere
    // in this rename path, including for user-typed content on commit
    // (renameSection/renameListItem treat it as an opaque string, never
    // re-interpreted as Markdown or HTML).
    innerEl.empty();
    // A <textarea>, not an <input> — a first version of this feature grew
    // the box horizontally into one long unbroken line sized to the text's
    // own character count, but that hides the rest of the Outline Tree pane
    // behind it for anything longer than the pane is wide. This element
    // instead stays capped at the row's own width (styles.css: `width:
    // 100%`) and wraps the text within it (`white-space: pre-wrap` +
    // `overflow-wrap: anywhere` — the latter matters because this vault's
    // own test fixtures include long runs of the same character with no
    // spaces to break on, e.g. "333...3", which would otherwise overflow
    // even with wrapping enabled). The `rows`/height below then grow
    // vertically to fit however many wrapped lines that produces, so the
    // full text stays visible without ever hiding the tree beside it.
    const inputEl = innerEl.createEl("textarea", {
      cls: "unified-outliner-rename-input",
    });
    inputEl.rows = 1;
    inputEl.value = initialText;

    // Grows the textarea's HEIGHT to fit however many lines its own text
    // wraps into at the row's current (CSS-capped) width — `scrollHeight`
    // already reflects the wrapped layout the browser just computed, so
    // this just copies that measured height onto the element's own style
    // so nothing is clipped or internally scrollable. Resetting `height` to
    // "auto" first (rather than reading scrollHeight against whatever
    // height happens to be set already) is required for shrinking: without
    // it, scrollHeight can never report smaller than the previously-set
    // height, which would make the box unable to shrink back down after the
    // user deletes text. Called once immediately below for the initial
    // text, and again from the "input" listener further down on every
    // keystroke/paste — typing can both grow AND shrink the wrapped line
    // count as the user edits.
    const resizeRenameTextareaToContent = (): void => {
      inputEl.setCssProps({ height: "auto" });
      inputEl.setCssProps({ height: `${inputEl.scrollHeight}px` });
    };
    resizeRenameTextareaToContent();

    // Lifts the row's own text-overflow/ellipsis/overflow:hidden styling
    // (both this plugin's — see .unified-outliner-list-text in styles.css —
    // and whatever Obsidian's own theme applies to .tree-item-self/
    // .tree-item-inner) for exactly as long as this row is being renamed,
    // so a textarea taller than the row's normal single-line height isn't
    // clipped back down vertically. Removed implicitly on both commit and
    // cancel: both paths end in a renderTree() rebuild that discards this
    // exact DOM node and recreates the row from scratch with its normal
    // classes.
    rowSelfEl.addClass("unified-outliner-renaming-row");

    // Prevent HTML5 drag from starting while interacting with the row's own
    // text field — a mousedown+move inside the input could otherwise be
    // interpreted as an attempt to drag the whole row. Restored by
    // cancelRename (renderTree also implicitly "restores" it on commit, by
    // rebuilding the row from scratch with its normal draggable="true").
    rowSelfEl.setAttribute("draggable", "false");

    inputEl.addEventListener("keydown", (evt) => {
      // Every key while renaming belongs to the input's own text editing —
      // never to treeRootEl's ArrowUp/Down/Left/Right/Enter navigation
      // handler (handleTreeKeyDown), which would otherwise also fire since
      // keydown bubbles from the input up through selfEl to treeRootEl.
      evt.stopPropagation();
      if (evt.key === "Enter") {
        // Unlike the <input> this replaced, a <textarea> natively accepts
        // Enter/Shift+Enter as a literal line break — this branch matches
        // on evt.key === "Enter" regardless of Shift, so preventDefault()
        // here is load-bearing: it stops that native newline insertion for
        // BOTH Enter and Shift+Enter, and commits instead. A pasted literal
        // newline is the only remaining way one could reach commitRename's
        // value — renameSection/renameListItem still reject that
        // defensively (see hasNewline in edit/renameBlock.ts).
        //
        // Phase 5T-11A follow-up (real-device feedback, 2026-08-21): an
        // unchanged Enter press used to reach commitRename() regardless —
        // which, via applyLineEditOutcome's own no-op guard, silently left
        // the box open with a no-op notice instead of closing it. The blur
        // handler below already special-cases exactly this ("opened it,
        // didn't touch anything") by comparing against initialText and
        // calling cancelRename() instead; Enter never had the same check.
        // Applying it here too makes Enter behave consistently with blur:
        // unchanged text closes the box cleanly via cancelRename() (still
        // never touches the document, and still correctly routes a
        // pendingParagraphInsert rename through its own rollback), while
        // any actual change still goes through commitRename() as before.
        evt.preventDefault();
        if (inputEl.value === initialText) {
          this.cancelRename();
        } else {
          this.commitRename();
        }
      } else if (evt.key === "Escape") {
        // IME safety net (Phase 5C-1A/1B follow-up "inline rename の安全復帰
        // 措置"): while an IME composition is in progress (typing a kana
        // sequence before it's converted to kanji, still-uncommitted
        // candidate text underlined in the textarea), Escape's job is to
        // cancel THAT composition/candidate — a distinct, lower-level
        // browser/OS behavior that must run un-intercepted. Without this
        // guard, evt.preventDefault()+cancelRename() below would fire on
        // the very same Escape press, discarding the ENTIRE rename (every
        // character typed so far, converted or not) instead of just the
        // in-flight conversion — surprising and destructive for exactly the
        // users this feature is meant to protect. Only once composition has
        // ended (a second, later Escape press, now with isComposing false)
        // does Escape mean "cancel this rename" — see cancelRename's own
        // doc comment for why that's always fully safe to do (it never
        // touches the document).
        if (evt.isComposing) return;
        evt.preventDefault();
        this.cancelRename();
      }
      // Every other key is left to the <textarea>'s own native text editing
      // (typing, arrow-key caret movement, selection, etc.); the "input"
      // listener below keeps the box's height in sync with the result.
    });
    // Typing/pasting/deleting can change how many lines the text wraps into
    // at the row's fixed width — re-measure and re-apply the height on
    // every such change so the box never lags behind what's actually being
    // typed (see resizeRenameTextareaToContent's own doc comment above for
    // why this can't just be computed once at open time).
    inputEl.addEventListener("input", resizeRenameTextareaToContent);
    inputEl.addEventListener("blur", () => {
      // Guard against a late/synchronous blur firing after commitRename
      // already cleared renameState (removing this very input from the
      // DOM via refresh()'s renderTree() can itself trigger a blur on the
      // element being detached) — and against it firing for a node other
      // than the one THIS input belongs to, in the unlikely event a new
      // rename already started elsewhere by the time this fires.
      //
      // Moving focus outside the input COMMITS the edit if the text
      // actually changed, and otherwise just closes the box like Escape
      // (2026-08-11 fix): clicking any other row, scrolling the pane,
      // switching panes, etc. ends the rename the same way pressing Enter
      // does. An earlier version of this handler unconditionally called
      // cancelRename() here — on the theory that leaving the input should
      // default to discarding whatever was typed — but that silently threw
      // away real edits the moment the user clicked elsewhere in the tree
      // (confirmed via a screen recording: editing a row's text, then
      // clicking a different row to look at it, made the edit vanish with
      // no notice and nothing ever reached the note body). Every other
      // inline-rename UI a user is likely to have muscle memory for
      // (Finder, Explorer, VS Code's own tree views) commits on blur, not
      // cancel. The inputEl.value === initialText check keeps a genuinely
      // untouched box (opened, then blurred without typing anything) a
      // clean cancel rather than a same-text "commit" that would otherwise
      // leave the textarea sitting open-but-unfocused — commitRename()
      // returning early on a true no-op (see applyLineEditOutcome's own
      // no-op guard) doesn't itself tear the box down, only a successful
      // write-back does. Escape (see the keydown handler above) remains
      // the explicit, always-cancels path regardless of whether the text
      // changed.
      if (this.renameState && this.renameState.nodeId === nodeId) {
        if (inputEl.value === initialText) {
          this.cancelRename();
        } else {
          this.commitRename();
        }
      }
    });
    // A click inside the input is text-cursor placement, not a row
    // click/selection change — kept from bubbling to selfEl's own click
    // handler (harmless either way, since that would just re-jump to the
    // same line, but this is the more literally correct scoping).
    inputEl.addEventListener("click", (evt) => evt.stopPropagation());

    this.renameState = {
      nodeId,
      kind,
      inputEl,
      rowSelfEl,
      snapshot,
      pendingParagraphInsert,
      insertOrigin,
    };
    inputEl.focus();
    inputEl.select();
  }

  /**
   * F2 / context menu "Rename" / auto-rename-after-insert entry point —
   * these callers don't already have the row's DOM elements on hand (F2
   * only has this.selectedId; the menu and auto-rename paths only have a
   * nodeId), so this re-locates them via the row's stable
   * `unified-outliner-row-<id>` DOM id (set in renderNode) and delegates
   * to beginRename. Silently does nothing if the row isn't currently
   * rendered (e.g. collapsed under a folded ancestor) — this is a normal,
   * safe no-op rather than an error, since F2 only ever targets
   * this.selectedId which ensureSelection() already keeps within the
   * visible set.
   */
  private beginRenameForNode(nodeId: string): void {
    const node = this.nodeById.get(nodeId);
    if (!node) return;
    // Phase 5D-0.3 approval §1: composite/complex-member rows are read-only
    // — no rename trigger (double-click/F2/context-menu/auto-rename-after-
    // insert) is ever allowed to reach them. Every one of those triggers
    // funnels through this one method, so this single guard covers all of
    // them.
    if (node.kind !== "section" && node.kind !== "list") return;
    // 2026-08-12 amendment §E (defense in depth): the kind check above does
    // NOT catch a "list" node that's currently a composite's member — F2
    // (the one rename trigger that isn't gated by a per-row DOM listener;
    // see handleTreeKeyDown) acts on whatever this.selectedId currently is,
    // and selection itself is never restricted to non-read-only nodes. This
    // second check is what actually closes that path: even if some future
    // caller reaches this method with a read-only list node's id, it's
    // refused here too, never just at the DOM-listener-attachment layer.
    if (this.readOnlyNodeIds.has(nodeId)) return;
    const rowSelfEl = this.treeRootEl.querySelector<HTMLElement>(
      `#${CSS.escape("unified-outliner-row-" + nodeId)}`
    );
    const innerEl = rowSelfEl?.querySelector<HTMLElement>(".tree-item-inner") ?? null;
    if (!rowSelfEl || !innerEl) return;
    this.beginRename(nodeId, node.kind, innerEl, rowSelfEl);
  }

  /**
   * Phase 5T-8A ("paragraph のダブルクリック動作を Partial Edit 起動から
   * inline rename へ統一する"): the paragraph counterpart to
   * beginRenameForNode above — a SEPARATE entry point, not a relaxation of
   * that method's own `node.kind !== "section" && node.kind !== "list"`
   * guard, because a paragraph has no persistent id in `doc.nodes` at all
   * (see edit/paragraphPartialEdit.ts's own top doc comment) and resolves
   * through a structurally different path.
   *
   * Resolution mirrors showParagraphMoveMenu's / handleParagraphDragStart's
   * own anchor construction EXACTLY — the same resolveParagraphFromTreeHint
   * + buildParagraphMoveAnchor pair, over `this.currentDoc`/
   * `this.currentComplexScan` (the last refresh()'s own live state, not a
   * fresh re-parse — same convention every other Tree-triggered paragraph
   * anchor construction in this file already uses), no new resolution
   * logic. `this.readOnlyNodeIds.has(nodeId)` is deliberately NOT checked
   * here (unlike beginRenameForNode): every paragraph node is
   * unconditionally in that set (collectReadOnlyOutlineNodeIds — Phase
   * 5P-3's "a paragraph row is read-only navigation only" default), so the
   * same check here would always be true and would make this method a
   * permanent no-op; paragraph eligibility for inline rename is instead
   * governed entirely by isOutlineParagraphNode + a successful
   * resolveParagraphFromTreeHint/buildParagraphMoveAnchor resolution —
   * exactly the same two-function gate Partial Edit's own paragraph launch
   * (openParagraphPartialEditFromTree) already relies on, which already
   * excludes CompositeBlock members, callout/blockquote/fenced-code/table-
   * internal lines, and boundary-ambiguous paragraphs by construction (see
   * parser/complexBlocks.ts's scanParagraphBlocks/mergeBlockRangesSafely —
   * those lines never reach editability "supported" kind "paragraph" in
   * the first place, so they never become an OutlineTreeParagraphNode to
   * begin with).
   *
   * Silently no-ops (never a Notice) on every failure mode — unresolved
   * hint, ambiguous match, missing rowSelfEl/innerEl (row not currently
   * rendered) — matching this ticket's own "再解決不能・曖昧状態では no-op
   * とする" requirement; a double-click has no menu to degrade to and no
   * user-visible "did nothing" signal is worse here than for
   * openParagraphPartialEditFromTree's own explicit Notice (that Notice
   * exists because a dblclick/F2 there is the ONLY way to open Partial
   * Edit and silent failure would be confusing; inline rename failing here
   * simply leaves the row showing its normal read-only paragraph text,
   * which is self-explanatory).
   *
   * Paragraph Partial Edit itself is entirely unaffected: it remains
   * reachable via the paragraph context menu ("段落を編集…",
   * showParagraphMoveMenu) and via F2 (handleTreeKeyDown's F2 case) —
   * neither of those call sites is touched by this method or by this
   * ticket. Role split: double-click -> quick inline rename of this one
   * paragraph's own text (this method); F2 / context menu -> full Partial
   * Edit Pane; body editor -> ordinary text editing. See
   * docs/phase5t8a_paragraph_dblclick_inline_rename_design.md for the full
   * writeup.
   */
  private beginParagraphRenameForNode(
    nodeId: string,
    pendingParagraphInsert = false,
    insertOrigin?: { anchor: ParagraphMoveAnchor; position: ParagraphInsertPosition }
  ): void {
    const treeNode = this.nodeById.get(nodeId);
    if (!treeNode || !isOutlineParagraphNode(treeNode)) return;
    const doc = this.currentDoc;
    const complexScan = this.currentComplexScan;
    if (!doc || !complexScan) return;
    const target = resolveParagraphFromTreeHint(
      {
        rangeStart: treeNode.rangeStart,
        rangeEnd: treeNode.rangeEnd,
        parentId: treeNode.parentId,
      },
      complexScan
    );
    if (!target) return;
    const anchor = buildParagraphMoveAnchor(doc, target);
    if (!anchor) return;
    const rowSelfEl = this.treeRootEl.querySelector<HTMLElement>(
      `#${CSS.escape("unified-outliner-row-" + nodeId)}`
    );
    const innerEl = rowSelfEl?.querySelector<HTMLElement>(".tree-item-inner") ?? null;
    if (!rowSelfEl || !innerEl) return;
    this.beginRename(
      nodeId,
      "paragraph",
      innerEl,
      rowSelfEl,
      anchor,
      pendingParagraphInsert,
      insertOrigin
    );
  }

  /**
   * Phase 5T-10A: the paragraph counterpart to autoRenameAfterInsert
   * (which cannot itself handle paragraph — beginRenameForNode's own
   * `node.kind !== "section" && node.kind !== "list"` guard rejects it).
   * Called only from dispatchAndApplyParagraphInsert, only after its own
   * refresh() has already recomputed this.highlightedId from the editor
   * cursor insertParagraph placed exactly on the new placeholder (5T-5A's
   * resolveCurrentPositionNodeId) — same "highlightedId already IS the new
   * node's id here" reasoning autoRenameAfterInsert's own doc comment
   * documents. `pendingParagraphInsert = true` is the one thing that
   * differs from an ordinary paragraph double-click rename.
   *
   * `originAnchor`/`originPosition` are `dispatchAndApplyParagraphInsert`'s
   * own two parameters, passed straight through (untouched by refresh()) so
   * a later commitPendingParagraphInsert can re-run the insert against the
   * ORIGINAL target — see renameState.insertOrigin's own doc comment for
   * why this is threaded all the way through rather than re-derived from
   * the placeholder's own (post-insert) anchor.
   */
  private autoRenameAfterParagraphInsert(
    originAnchor: ParagraphMoveAnchor,
    originPosition: ParagraphInsertPosition
  ): void {
    if (this.highlightedId) {
      this.beginParagraphRenameForNode(this.highlightedId, true, {
        anchor: originAnchor,
        position: originPosition,
      });
    }
  }

  /**
   * Commit service: re-resolves nodeId against a FRESH re-parse of the
   * active editor's CURRENT content (never the snapshot's own doc, never
   * this.currentDoc) and re-verifies structure via
   * renameSection/renameListItem before ever calling
   * applyLineEditOutcome — exactly the same "re-resolve, re-verify, apply
   * via the one shared write-back path" shape as dispatchAndApply, just
   * without reusing dispatchAndApply itself (its refresh() call would fire
   * BEFORE this method gets to clear renameState, and refresh() bails out
   * early whenever renameState is set — see that guard's own doc comment).
   *
   * On rejection (outcome.changed === false): returns without clearing
   * renameState or touching the DOM at all — the input stays open with
   * whatever the user typed, and NOOP_MESSAGES reports why, satisfying
   * "拒否時は原文を変更せず、input を保持したまま notice 等で理由を通知する" with no
   * special-casing beyond what applyLineEditOutcome already does for
   * every other no-op reason in this view. A true no-op (rawValue equal to
   * the original text) would also come back as `changed === false` here —
   * via applyLineEditOutcome's own no-op guard, since renameSection/
   * renameListItem always report `changed: true` regardless of whether the
   * text actually differs — but as of the Phase 5T-11A Enter-key follow-up
   * below, this function is no longer reachable with a true no-op at all:
   * both the blur handler and the keydown Enter handler now compare
   * inputEl.value against initialText BEFORE ever calling commitRename(),
   * and route the unchanged case to cancelRename() instead. This doc
   * comment's no-op-guard description is kept for callers other than those
   * two (there are none today) and as a record of why applyLineEditOutcome
   * still carries that guard at all.
   *
   * Undo/Redo ("inline rename の安全復帰措置" requirement): a successful
   * commit makes exactly ONE `editor.replaceRange()` call, inside
   * applyLineEditOutcome — no separate/parallel write path was added for
   * rename specifically, per that requirement's "既存の安全な apply 経路を
   * そのまま踏襲し、新たな直接ファイル書き込み経路は追加しない" constraint. This
   * turns out to already be sufficient on its own: verified empirically
   * against this Obsidian version (via `editor.replaceRange`/`.undo()`/
   * `.redo()` calls against a scratch note in the DevTools console — see
   * this ticket's investigation notes) that Obsidian's Editor API treats
   * every individual `editor.replaceRange()` call as its own isolated Undo
   * step, regardless of the `origin` argument (present or absent, equal or
   * different across calls) and regardless of how close together in time
   * two calls happen — even two `replaceRange` calls issued back-to-back in
   * the same synchronous tick landed as two separate Undo steps. So a
   * rename's single `replaceRange` call is already guaranteed to be its own
   * Undo/Redo unit that never merges with whatever edit happened
   * immediately before or after it (move, indent, another rename, etc.) —
   * no CM6 `isolateHistory` annotation or other extra plumbing was needed
   * or added.
   *
   * Phase 5T-8A: `state.kind === "paragraph"` is a NEW third arm in the
   * outcome dispatch just below — it calls
   * edit/paragraphPartialEdit.ts#applyParagraphEdit (the EXACT SAME
   * function view/PartialEditView.ts's own Apply already calls for a
   * paragraph, per this ticket's explicit "Partial Edit と同じ source 再解
   * 決契約を再利用すること" requirement) rather than a new write primitive.
   * `applyParagraphEdit` re-scans `doc` fresh and independently re-verifies
   * complexBlockId/parentId/depth/content before ever splicing — the exact
   * same "never trust the caller's snapshot, always re-resolve against a
   * fresh parse" contract renameSection/renameListItem already apply for
   * section/list, just via a different (paragraph-specific) re-resolution
   * module. `ApplyParagraphEditOutcome`'s shape ({changed, lines,
   * newStartLine, reason?}) is a structural subset of `LineEditOutcome`
   * (no `newCursorCh`), so applyLineEditOutcome below accepts it unchanged
   * — a paragraph commit lands the cursor at column 0 of the paragraph's
   * new start line (the "preserve caller's offset within the block" branch
   * with cursor/resolvedNodeStartLine both `{line: 0, ch: 0}`/`0`, same as
   * section/list here), which refresh()'s own ensureSelection/highlightedId
   * fallback then takes over from exactly like every other Tree-dispatched
   * edit.
   */
  private commitRename(): void {
    const state = this.renameState;
    if (!state) return;

    // Phase 5T-10A follow-up (real-device feedback: a single Undo right
    // after confirming this rename left a stray blank line behind instead
    // of cleanly reverting) — a rename that began as a post-insert
    // auto-rename AND still carries its origin commits through a dedicated
    // path that collapses the insert + confirm into a single Undo step.
    // Every other rename (section/list, an ordinary EXISTING paragraph
    // dblclick rename, or a pendingParagraphInsert rename that lost its
    // insertOrigin — structurally shouldn't happen, but defensively falls
    // through to the unchanged code below) is completely unaffected.
    if (state.kind === "paragraph" && state.pendingParagraphInsert && state.insertOrigin) {
      this.commitPendingParagraphInsert(state.insertOrigin);
      return;
    }

    const view = this.activeMarkdownView.get();
    if (!view) {
      this.notify(this.plugin.t("reason.no-active-editor"));
      return;
    }
    // Phase 5T-12A note identity guard (docs/phase5t12_rename_note_leaf_switch_safety_design.md
    // §10 案A): view is confirmed non-null above, so a rejection here means
    // either view.file is null or this.currentFilePath no longer matches
    // it — i.e. the note this rename began against is not the one
    // ActiveMarkdownViewTracker currently reports as active. Reject BEFORE
    // ever calling parseDocument or applying the outcome against this
    // view's editor, so a mismatched note's body is never read, let alone
    // written.
    if (!evaluateRenameNoteIdentity(this.currentFilePath, view.file?.path).allowed) {
      this.abortRenameForNoteSwitch();
      return;
    }
    const editor = view.editor;
    if (editor.listSelections().length > 1) {
      this.notify(this.plugin.t("notice.multipleCursors"));
      return;
    }

    const rawValue = state.inputEl.value;
    const doc = parseDocument(editor.getValue());
    const outcome =
      state.kind === "section"
        ? renameSection(doc, state.nodeId, state.snapshot as SectionRenameSnapshot, rawValue)
        : state.kind === "list"
          ? renameListItem(doc, state.nodeId, state.snapshot as ListRenameSnapshot, rawValue)
          : applyParagraphEdit(doc, state.snapshot as ParagraphMoveAnchor, rawValue);

    const changed = applyLineEditOutcome(
      editor,
      { line: 0, ch: 0 },
      0,
      doc.lines,
      outcome,
      () => this.notify(this.reasonText(outcome.reason))
    );

    if (!changed) return;
    this.finishRenameCommit(editor);
  }

  /**
   * Phase 5T-10A follow-up: commitRename's dedicated path for a rename
   * that began as a post-insert auto-rename (`pendingParagraphInsert` +
   * `insertOrigin` both set — see renameState's own doc comment).
   *
   * Real-device feedback on the original design (insert the placeholder
   * via its own `replaceRange`, later patch its text in place via a
   * SECOND, independent `replaceRange` on confirm) was that a single Undo
   * right after confirming reverted only the second edit, leaving the
   * placeholder's own blank-line separator(s) behind in the note and a
   * lingering paragraph row in the Tree — technically the documented
   * "2-step Undo" behavior (5T-10A §13), but confusing in practice: the
   * user expects one Undo to cleanly restore the note to exactly how it
   * looked before the insert.
   *
   * This method collapses the two edits into one: it first reverts the
   * ORIGINAL placeholder insert with `Editor#undo()` (the exact same
   * mechanism, and the exact same `canSafelyRollbackParagraphInsert`
   * safety check, rollbackPendingParagraphInsert already uses for
   * Cancel/Escape — see that method's own doc comment for the full
   * "why undo() is safe here" reasoning, which applies identically at
   * commit time: nothing can have interleaved between the insert and this
   * confirm either), then performs a SINGLE fresh `insertParagraph` call
   * against the now-reverted (pre-insert) text, passing the user's
   * CONFIRMED value as `bodyText` instead of the placeholder constant, and
   * applies that as one `applyLineEditOutcome` write. Net result: exactly
   * one `replaceRange` call reaches the editor for the whole
   * insert-then-rename gesture, so exactly one Undo now reverts it
   * completely (text, separators, and all) — matching every other
   * Tree-triggered command in this codebase, where one user-visible action
   * is one Undo step.
   *
   * If the safety check fails (something else changed the placeholder in
   * the meantime — the same "resolve不能な場合は安全側no-op" allowance
   * rollbackPendingParagraphInsert already documents), this falls back to
   * the ORIGINAL two-step behavior: patch the placeholder's own text in
   * place via `applyParagraphEdit`, exactly as commitRename's own
   * pre-5T-10A-follow-up code did. That fallback is still fully correct,
   * just not collapsed into a single Undo step.
   */
  private commitPendingParagraphInsert(insertOrigin: {
    anchor: ParagraphMoveAnchor;
    position: ParagraphInsertPosition;
  }): void {
    const state = this.renameState;
    if (!state) return;

    const view = this.activeMarkdownView.get();
    if (!view) {
      this.notify(this.plugin.t("reason.no-active-editor"));
      return;
    }
    // Phase 5T-12A note identity guard — see commitRename()'s identical
    // check just above for the full rationale. Rejecting here BEFORE the
    // canSafelyRollbackParagraphInsert/editor.undo() call below is what
    // guarantees a note switch during a paragraph-insert auto-rename can
    // never Undo a DIFFERENT note's history: the placeholder stays exactly
    // as it already was in the origin note (an intentional safe no-op —
    // see docs/phase5t12_rename_note_leaf_switch_safety_design.md §10).
    if (!evaluateRenameNoteIdentity(this.currentFilePath, view.file?.path).allowed) {
      this.abortRenameForNoteSwitch();
      return;
    }
    const editor = view.editor;
    if (editor.listSelections().length > 1) {
      this.notify(this.plugin.t("notice.multipleCursors"));
      return;
    }

    const rawValue = state.inputEl.value;
    if (paragraphEditTextContainsBlankLine(rawValue)) {
      this.notify(this.reasonText("blank-line-not-allowed"));
      return;
    }

    const placeholderAnchor = state.snapshot as ParagraphMoveAnchor;
    const canCollapse = canSafelyRollbackParagraphInsert(editor.getValue(), placeholderAnchor);

    const commitInPlace = (): void => {
      const doc = parseDocument(editor.getValue());
      const outcome = applyParagraphEdit(doc, placeholderAnchor, rawValue);
      const changed = applyLineEditOutcome(editor, { line: 0, ch: 0 }, 0, doc.lines, outcome, () =>
        this.notify(this.reasonText(outcome.reason))
      );
      if (changed) this.finishRenameCommit(editor);
    };

    if (!canCollapse) {
      commitInPlace();
      return;
    }

    editor.undo();
    const revertedText = editor.getValue();
    const rules = getEnabledCompositeBlockRules(this.plugin.settings.compositeBlocks);
    const outcome = insertParagraph(
      revertedText,
      insertOrigin.anchor,
      insertOrigin.position,
      rules,
      rawValue
    );

    if (!outcome.changed) {
      // Structurally unreachable given the same "nothing can interleave"
      // invariant rollbackPendingParagraphInsert's own doc comment already
      // proves for Cancel/Escape — kept defensively: redo the placeholder
      // back rather than leave the note mid-undo with the user's confirmed
      // text dropped, then fall back to the in-place patch above.
      editor.redo();
      commitInPlace();
      return;
    }

    const changed = applyLineEditOutcome(
      editor,
      { line: 0, ch: 0 },
      0,
      revertedText.split("\n"),
      outcome,
      () => this.notify(paragraphInsertReasonText((k) => this.plugin.t(k), outcome.reason))
    );
    if (changed) this.finishRenameCommit(editor);
  }

  /**
   * Shared commit tail: clear renameState, scroll the new cursor position
   * into view, and refresh() the Tree — factored out of commitRename so
   * commitPendingParagraphInsert's several success paths (in-place patch,
   * collapsed single insert, redo-then-in-place-patch fallback) can share
   * it rather than duplicate it.
   */
  private finishRenameCommit(editor: Editor): void {
    this.renameState = null;
    const cur = editor.getCursor();
    const lineLen = editor.getLine(cur.line)?.length ?? 0;
    editor.scrollIntoView(
      { from: { line: cur.line, ch: 0 }, to: { line: cur.line, ch: lineLen } },
      true
    );
    this.refresh();
  }

  /** Cancel: original text untouched, tree re-rendered back to its normal
   * (non-editing) row for this node — since nothing in the document
   * changed, this.currentDoc/this.currentTree are still fully valid, so a
   * plain renderTree() (not a full refresh()) is enough to restore it.
   *
   * "inline rename の安全復帰措置" requirement: this function never calls
   * applyLineEditOutcome, editor.replaceRange, or any other body-writing
   * API — whatever the user had typed into the textarea (however long, and
   * regardless of how the cancel was triggered: Escape, a no-op blur — see
   * the blur handler's own comment for why blur only cancels rather than
   * commits when the text is unchanged — or starting a rename on a
   * different row) is simply discarded along with the
   * textarea DOM node itself. There is nothing here that could leave a
   * partial edit in the Markdown source, and nothing here that could ever
   * create an Undo history entry — the accident this whole feature exists
   * to make trivially recoverable from never reaches the document in the
   * first place. */
  private cancelRename(): void {
    if (!this.renameState) return;
    // Phase 5T-10A: a rename that began as a post-insert auto-rename must
    // roll back the insert itself on Cancel/Escape (ticket §6/§7) rather
    // than fall through to this method's own pre-existing "never touch the
    // document" behavior below — see rollbackPendingParagraphInsert's own
    // doc comment for the full design. Every other rename (this branch not
    // taken) is completely unaffected, byte-for-byte, by this addition.
    if (this.renameState.pendingParagraphInsert && this.renameState.kind === "paragraph") {
      this.rollbackPendingParagraphInsert(this.renameState.snapshot as ParagraphMoveAnchor);
      return;
    }
    this.renameState.rowSelfEl.setAttribute("draggable", "true");
    this.renameState = null;
    this.renderTree();
  }

  /**
   * Phase 5T-12A: shared rejection path for commitRename()/
   * commitPendingParagraphInsert() when evaluateRenameNoteIdentity()
   * disallows the write — i.e. the active Markdown view no longer points
   * at the note this rename began against (this.currentFilePath, frozen by
   * refresh()'s early-return guard for the duration of the rename). Never
   * touches editor/document state: mirrors cancelRename()'s own plain
   * "never write" teardown (draggable restore, renameState = null,
   * renderTree()) so this stays exactly as safe as an ordinary Escape, just
   * reachable from the two write paths too. Shows exactly one Notice
   * (reason.note-switched) so the discard is never silent — per the 5T-12D
   * §12 judgment question, the user chose "notify" over "silent no-op" for
   * this specific case.
   *
   * NOT used by rollbackPendingParagraphInsert(): that method already has
   * its own final teardown (refresh() vs renderTree() depending on whether
   * an Undo actually happened) and its own, narrower Notice condition (see
   * that method's own doc comment) — duplicating this helper there would
   * either lose that refresh()/renderTree() distinction or require passing
   * extra flags through it for no benefit.
   */
  private abortRenameForNoteSwitch(): void {
    const state = this.renameState;
    if (!state) return;
    this.notify(this.plugin.t("reason.note-switched"));
    state.rowSelfEl.setAttribute("draggable", "true");
    this.renameState = null;
    this.renderTree();
  }

  /**
   * Phase 5T-10A: rolls back a paragraph insert whose immediately-following
   * inline rename was cancelled (Escape, or blur-with-unchanged-placeholder
   * text — beginRename's own blur handler already routes both to
   * cancelRename, which is this method's only caller for a
   * pendingParagraphInsert rename).
   *
   * Uses Obsidian's own `Editor#undo()` rather than a manual reverse-splice:
   * the rename textarea is a DOM-only overlay that never touches editor
   * content until commitRename() runs; beginRename's own "already renaming
   * -> cancel first" guard means no OTHER Tree-triggered edit can interleave
   * while this rename is open; and clicking into the body editor itself
   * fires this same textarea's blur handler FIRST (routing here, since the
   * placeholder text is unchanged), before any body edit could happen. So
   * the editor's most-recent Undo-history entry, at the moment this runs,
   * is guaranteed to be exactly the insertParagraph replaceRange call this
   * rename followed — editor.undo() reverts precisely that (placeholder
   * plus whichever separator blank line(s) were actually added), with ZERO
   * new Undo-history entries, and a subsequent Redo naturally restores it.
   *
   * canSafelyRollbackParagraphInsert (edit/insertParagraph.ts) runs first as
   * a lightweight safety check: if the placeholder can no longer be
   * re-resolved as itself, unedited (some external change to the note in
   * the interim), this refuses to call undo() and instead just closes the
   * rename box, leaving the placeholder as ordinary, permanent body text —
   * the ticket's own explicit "resolve不能な場合は安全側no-op" allowance.
   */
  private rollbackPendingParagraphInsert(anchor: ParagraphMoveAnchor): void {
    const state = this.renameState;
    if (!state) return;
    const view = this.activeMarkdownView.get();
    // Phase 5T-12A note identity guard: unlike commitRename()/
    // commitPendingParagraphInsert() above, this path is reached from
    // Escape/blur-unchanged (via cancelRename()), where "no active view at
    // all" has always been a silent, benign no-op (5T-10A's own "resolve
    // 不能な場合は安全側no-op" allowance) — that stays silent here too. Only
    // the NEW "an active view exists, but it's a different note than the
    // one this rename began against" case gets the Notice, since that is
    // the actual cross-note-Undo risk this guard exists to close; a bare
    // missing view isn't a note-switch, it's simply nothing to roll back
    // against.
    const identity = evaluateRenameNoteIdentity(this.currentFilePath, view?.file?.path);
    const canRollback =
      identity.allowed && !!view && canSafelyRollbackParagraphInsert(view.editor.getValue(), anchor);
    if (canRollback && view) {
      view.editor.undo();
    }
    if (!identity.allowed && identity.reason === "note-switched") {
      this.notify(this.plugin.t("reason.note-switched"));
    }
    state.rowSelfEl.setAttribute("draggable", "true");
    this.renameState = null;
    if (canRollback) {
      this.refresh();
    } else {
      this.renderTree();
    }
  }

  // ---- Phase 3A: drag & drop ------------------------------------------

  private handleDragStart(evt: DragEvent, sectionId: string, itemEl: HTMLElement): void {
    this.dragSourceId = sectionId;
    this.draggingItemEl = itemEl;
    itemEl.addClass("unified-outliner-dragging");
    if (evt.dataTransfer) {
      // Phase 5T-2R: the payload is an intentionally empty sentinel, never
      // the real sectionId. A real-device pass during Phase 5T-2 proved
      // that dropping a Tree row outside the Tree (e.g. onto the body
      // editor) is never intercepted by any Tree-side dragover/drop
      // listener, so the browser/Electron/CodeMirror's own default
      // text/plain drop-handling runs and inserts this payload as literal
      // text. Writing the real id here would corrupt the Markdown body
      // with strings like "sec-1". An empty string still satisfies the
      // HTML5 DnD spec's requirement that some browsers/Electron builds
      // need at least one setData() call to recognize the drag at all,
      // while guaranteeing zero textual leakage under default drop
      // handling. The actual move is driven entirely by this.dragSourceId
      // (private instance state), never by reading this data back out.
      evt.dataTransfer.setData("text/plain", "");
      evt.dataTransfer.effectAllowed = "move";
    }
  }

  /**
   * Section source -> move/relocateSection.ts's canDropOn (unchanged from
   * Phase 3A: section targets only). List source -> Phase 4A's
   * canDropListOn (list or section targets). The dragged node's kind
   * (looked up fresh from `doc`, not cached) decides which pure check
   * runs — this is the ONLY place that branches by kind for drop
   * feasibility, so section behavior is byte-for-byte identical to before.
   */
  private canDropAny(doc: ParsedDocument, sourceId: string, targetId: string): boolean {
    const source = doc.nodes.get(sourceId);
    if (!source) return false;
    return source.type === "list"
      ? canDropListOn(doc, sourceId, targetId)
      : canDropOn(doc, sourceId, targetId);
  }

  /**
   * Fires continuously while hovering a potential drop target. Splits the
   * row into thirds (top -> before, middle -> inside, bottom -> after) and
   * shows the corresponding indicator — but only for rows canDropAny (the
   * same pure structural checks relocateSection()/relocateListSubtree()
   * themselves enforce at drop time) says are legal, so an invalid target
   * never shows an indicator and never gets Obsidian's default drop-allowed
   * cursor (achieved simply by NOT calling preventDefault() there, which is
   * what makes a drop illegal per the HTML5 DnD spec).
   */
  private handleDragOver(evt: DragEvent, targetId: string, selfEl: HTMLElement): void {
    // Phase 5D-4C: a CompositeBlock drag session hovering a section or
    // list row is resolved through the shared handleCompositeDragOverNode
    // core — an early, purely additive branch ahead of every other branch
    // below, which never runs at all while a CompositeBlock drag is active
    // (only one drag session of any kind is ever active at once). A
    // SECTION row target is rejected by handleCompositeDragOverNode itself
    // (via compositeDropTargetHint, which only recognizes list/composite
    // row kinds) — no separate exclusion is needed here.
    if (this.compositeDragSession) {
      const node = this.nodeById.get(targetId);
      if (!node) {
        if (this.dropIndicatorEl === selfEl) this.clearDropIndicator();
        return;
      }
      this.handleCompositeDragOverNode(evt, node, selfEl);
      return;
    }
    // Phase 5D-3C: a callout/blockquote drag session hovering a section or
    // list row is resolved through the SAME shared core every other row
    // kind uses (handleCalloutDragOverNode) — an early, purely additive
    // branch ahead of this method's own pre-existing section/list logic
    // below, which never runs at all while a callout/blockquote drag is
    // active (this.dragSourceId is never set at the same time
    // this.calloutDragSession is — only one drag session of any kind is
    // ever active at once).
    if (this.calloutDragSession) {
      const node = this.nodeById.get(targetId);
      if (!node) {
        if (this.dropIndicatorEl === selfEl) this.clearDropIndicator();
        return;
      }
      this.handleCalloutDragOverNode(evt, node, selfEl);
      return;
    }
    if (!this.dragSourceId || !this.currentDoc) return;
    if (!this.canDropAny(this.currentDoc, this.dragSourceId, targetId)) {
      if (this.dropIndicatorEl === selfEl) this.clearDropIndicator();
      return;
    }
    evt.preventDefault();
    if (evt.dataTransfer) evt.dataTransfer.dropEffect = "move";
    this.setDropIndicator(selfEl, this.computeDropMode(evt, selfEl));
  }

  private handleDragLeave(selfEl: HTMLElement): void {
    if (this.dropIndicatorEl === selfEl) this.clearDropIndicator();
  }

  private handleDrop(evt: DragEvent, targetId: string, selfEl: HTMLElement): void {
    evt.preventDefault();
    // Phase 5D-4C: same early, additive branch as handleDragOver above —
    // a CompositeBlock drag session dropped onto a section or list row is
    // resolved through the shared handleCompositeDropNode core.
    if (this.compositeDragSession) {
      const session = this.compositeDragSession;
      this.clearDropIndicator();
      this.endDrag();
      const node = this.nodeById.get(targetId);
      if (node) this.handleCompositeDropNode(session, evt, node, selfEl);
      return;
    }
    // Phase 5D-3C: same early, additive branch as handleDragOver above —
    // a callout/blockquote drag session dropped onto a section or list row
    // is resolved through the shared handleCalloutDropNode core.
    if (this.calloutDragSession) {
      const session = this.calloutDragSession;
      this.clearDropIndicator();
      this.endDrag();
      const node = this.nodeById.get(targetId);
      if (node) this.handleCalloutDropNode(session, evt, node, selfEl);
      return;
    }
    const sourceId = this.dragSourceId;
    const doc = this.currentDoc;
    this.clearDropIndicator();
    this.endDrag();

    if (!sourceId || !doc || !this.canDropAny(doc, sourceId, targetId)) return;
    const mode = this.computeDropMode(evt, selfEl);
    this.runRelocateCommand(sourceId, targetId, mode);
  }

  private handleDragEnd(): void {
    this.endDrag();
    this.clearDropIndicator();
  }

  private endDrag(): void {
    if (this.draggingItemEl) this.draggingItemEl.removeClass("unified-outliner-dragging");
    this.draggingItemEl = null;
    this.dragSourceId = null;
    // Phase 5T-2: unified cleanup for whichever drag kind was actually
    // active — only one of dragSourceId/paragraphDragSession is ever set
    // at a time (a single native HTML5 drag operation can only have one
    // source), so clearing both here unconditionally is safe and lets
    // every existing call site of endDrag() (handleDragEnd, handleDrop)
    // reliably clean up a paragraph drag too without needing its own
    // parallel copy of this method.
    this.paragraphDragSession = null;
    // Phase 5D-3C: same unconditional-clear treatment for a callout/
    // blockquote drag session — see calloutDragSession's own doc comment.
    this.calloutDragSession = null;
    // Phase 5D-4C: same unconditional-clear treatment for a CompositeBlock
    // drag session — see compositeDragSession's own doc comment.
    this.compositeDragSession = null;
  }

  /**
   * Phase 5T-2 (design doc §4-1): cancels an in-progress PARAGRAPH drag
   * specifically — called from refresh() (any cause) and onClose(), never
   * from a native drag event (those already go through handleDragEnd/
   * endDrag above). Deliberately a no-op when no paragraph drag is
   * active, so this never disturbs an in-progress SECTION/LIST drag
   * (Phase 3A/4A) — those keep their own pre-existing behavior
   * unchanged; this ticket adds NO new cancellation behavior for them.
   */
  private cancelParagraphDrag(): void {
    if (!this.paragraphDragSession) return;
    this.endDrag();
    this.clearDropIndicator();
  }

  /**
   * Phase 5D-3C: cancels an in-progress callout/blockquote drag session
   * specifically — mirrors cancelParagraphDrag's own doc comment/role
   * exactly, called from the exact same two call sites (refresh(),
   * onClose()), never from a native drag event.
   */
  private cancelCalloutDrag(): void {
    if (!this.calloutDragSession) return;
    this.endDrag();
    this.clearDropIndicator();
  }

  /**
   * Phase 5D-4C: cancels an in-progress CompositeBlock (parent row) drag
   * session specifically — mirrors cancelCalloutDrag's own doc comment/
   * role exactly, called from the exact same two call sites (refresh(),
   * onClose()), never from a native drag event.
   */
  private cancelCompositeDrag(): void {
    if (!this.compositeDragSession) return;
    this.endDrag();
    this.clearDropIndicator();
  }

  /** Phase 5T-2 (design doc §4-2): upper half -> "before", lower half -> "after". Deliberately a SEPARATE two-way split from computeDropMode's three-way (before/inside/after) below — paragraph D&D has no "inside"/child zone at all. */
  private computeParagraphDropZone(evt: DragEvent, el: HTMLElement): ParagraphDropZone {
    const rect = el.getBoundingClientRect();
    const ratio = rect.height > 0 ? (evt.clientY - rect.top) / rect.height : 0.5;
    return ratio < 0.5 ? "before" : "after";
  }

  /**
   * Phase 5T-2 dragstart for a paragraph row. Builds a `ParagraphMoveAnchor`
   * from the CURRENT refresh()-time doc/scan — exactly like
   * showParagraphMoveMenu's own menu-build-time anchor (same
   * resolveParagraphFromTreeHint + buildParagraphMoveAnchor pair, reused
   * verbatim, no new resolution logic here) — and stores it as this
   * session's sole safety-bearing field. If either resolution step fails
   * (the paragraph the Tree row displayed no longer safely resolves right
   * now), the drag is cancelled at the browser level via preventDefault()
   * — per the HTML5 DnD spec, cancelling a "dragstart" event stops the
   * drag-and-drop operation from starting at all, so the user never sees
   * a ghost-drag with nowhere valid to drop it.
   */
  private handleParagraphDragStart(
    evt: DragEvent,
    node: OutlineTreeParagraphNode,
    itemEl: HTMLElement
  ): void {
    const doc = this.currentDoc;
    const complexScan = this.currentComplexScan;
    if (!doc || !complexScan) {
      evt.preventDefault();
      return;
    }
    const info = resolveParagraphFromTreeHint(
      { rangeStart: node.rangeStart, rangeEnd: node.rangeEnd, parentId: node.parentId },
      complexScan
    );
    if (!info) {
      evt.preventDefault();
      return;
    }
    const anchor = buildParagraphMoveAnchor(doc, info);
    if (!anchor) {
      evt.preventDefault();
      return;
    }

    this.paragraphDragSession = {
      anchor,
      sourceTreeNodeId: node.id,
      sourceRangeStart: node.rangeStart,
      sourceRangeEnd: node.rangeEnd,
      sourceParentId: node.parentId,
    };
    this.draggingItemEl = itemEl;
    itemEl.addClass("unified-outliner-dragging");
    if (evt.dataTransfer) {
      // Phase 5T-2R: intentionally empty sentinel, never the real node.id
      // (a Tree-view-only id like "tree-paragraph:2"). Same rationale as
      // handleDragStart above — a real-device pass during Phase 5T-2 proved
      // dropping a paragraph row onto the body editor inserts this payload
      // as literal text via the browser/Electron/CodeMirror's default
      // text/plain drop-handling when no Tree-side listener intercepts the
      // drop. An empty string keeps the required setData() call (needed by
      // some browsers/Electron builds to recognize the drag at all) while
      // guaranteeing zero textual leakage. The actual decision is driven
      // entirely by this.paragraphDragSession (private instance state),
      // never by reading this back out (same convention handleDragStart
      // above already uses for section/list).
      evt.dataTransfer.setData("text/plain", "");
      evt.dataTransfer.effectAllowed = "move";
    }
  }

  /**
   * Phase 5T-2 dragover for a paragraph row. Re-derives, from the
   * refresh()-time cached `this.currentDoc` (safe to reuse without a fresh
   * re-parse here — see cancelParagraphDrag's own doc comment for why any
   * document change since drag-start would already have torn this session
   * down before this handler could ever run again), whether `node` is
   * right now a true adjacent sibling of the drag source in the hovered
   * zone. Only calls preventDefault()/shows an indicator when
   * resolveParagraphDropDirection says the drop would actually be
   * allowed — an invalid target gets no indicator and no drop-allowed
   * cursor at all (same "don't call preventDefault -> browser shows its
   * own not-allowed affordance" mechanism handleDragOver above already
   * relies on for section/list).
   */
  private handleParagraphDragOver(
    evt: DragEvent,
    node: OutlineTreeParagraphNode | OutlineTreeComplexMemberNode,
    selfEl: HTMLElement
  ): void {
    // Phase 5D-3C: a callout/blockquote drag session hovering a paragraph
    // or complex-member row is resolved through the shared
    // handleCalloutDragOverNode core — an early, purely additive branch
    // ahead of this method's own pre-existing paragraph-drag logic below,
    // which never runs at all while a callout/blockquote drag is active
    // (this.paragraphDragSession is never set at the same time
    // this.calloutDragSession is).
    if (this.calloutDragSession) {
      this.handleCalloutDragOverNode(evt, node, selfEl);
      return;
    }
    const session = this.paragraphDragSession;
    const doc = this.currentDoc;
    if (!session || !doc) return;
    const target = this.paragraphDropTargetHint(node);
    if (!target) {
      if (this.dropIndicatorEl === selfEl) this.clearDropIndicator();
      return;
    }
    const zone = this.computeParagraphDropZone(evt, selfEl);
    const resolution = resolveParagraphDropDirection(doc.lines.join("\n"), session.anchor, target, zone);
    if (!resolution.allowed) {
      // Phase 5P-6: the ONLY reject reason eligible for a fallback to the
      // new non-adjacent cut-and-insert preview is "not-adjacent" — every
      // other reason (self-drop/wrong-zone/source-side resolve failures)
      // keeps the exact pre-5P-6 "no indicator" behavior below, unchanged.
      // This branch never runs at all for a target that IS a true
      // adjacent sibling (resolution.allowed would already be true above),
      // so the existing swapBlocks-based path this method's own tail
      // implements is completely unreachable from here — see the 5P-6
      // design note on why the two paths are never unified (adjacent
      // swaps preserve the existing gap in place; cut-and-insert does
      // not, and would otherwise change the blank-line result of an
      // adjacent reorder).
      if (resolution.reason === "not-adjacent") {
        const nonAdjacent = this.resolveParagraphNonAdjacentDragTarget(session, doc, node, zone);
        if (nonAdjacent) {
          evt.preventDefault();
          if (evt.dataTransfer) evt.dataTransfer.dropEffect = "move";
          this.setDropIndicator(selfEl, zone);
          return;
        }
      }
      if (this.dropIndicatorEl === selfEl) this.clearDropIndicator();
      return;
    }
    evt.preventDefault();
    if (evt.dataTransfer) evt.dataTransfer.dropEffect = "move";
    // Phase 5T-2S-B: show the indicator at the edge the paragraph will
    // actually land on after the swap completes, not the raw hover zone
    // that merely triggered this decision. For an adjacent-only swap, the
    // "trigger zone" and the "landing edge" are always on OPPOSITE sides
    // of the same target row: e.g. a down-sibling target only validates
    // when hovering its "before" (top) half, but the paragraph itself
    // will land AFTER (below) that target once the swap runs — drawing
    // the indicator on the raw `zone` therefore always rendered the line
    // on the boundary immediately touching the drag source's OWN current
    // position (since the two rows are adjacent), which real-device
    // verification showed users misread as "this will not move" rather
    // than as a preview of the destination. Deriving the drawn edge from
    // `resolution.direction` instead fixes this without touching the
    // validity check above (`zone` is still exactly what
    // resolveParagraphDropDirection uses to decide before/after
    // eligibility) or any execution logic in handleParagraphDrop/
    // moveParagraphFromAnchor.
    const indicatorMode: DropMode = resolution.direction === "down" ? "after" : "before";
    this.setDropIndicator(selfEl, indicatorMode);
  }

  /**
   * Phase 5T-2 drop for a paragraph row. Cleans up drag/indicator state
   * FIRST, unconditionally — matching handleDrop's own "clean up, then
   * decide" ordering below — then re-derives the drop direction ONE MORE
   * TIME against the editor's actual CURRENT text (`editor.getValue()`,
   * not the cached `this.currentDoc` dragover uses — this is the one call
   * in this whole path that insists on a fully fresh read, immediately
   * before the only place that can mutate the note). If still allowed,
   * delegates entirely to `dispatchAndApplyParagraphMove` — the exact
   * same execution path the 5T-1 context-menu "Move up"/"Move down" items
   * already use, which performs its OWN complete independent
   * three-stage re-verification and shows its own Notice on rejection. No
   * new text-splice/swap primitive is written here or anywhere in this
   * ticket. A resolution that is no longer allowed at this exact instant
   * (the document changed in the brief window since the last dragover —
   * expected to be exceedingly rare, since any such change would already
   * have cancelled this session via refresh()) is silently treated as a
   * no-op: the body is not touched, and no Notice is shown, matching
   * dragover's own silent "just don't show an indicator" behavior for the
   * identical condition.
   */
  private handleParagraphDrop(
    evt: DragEvent,
    node: OutlineTreeParagraphNode | OutlineTreeComplexMemberNode,
    selfEl: HTMLElement
  ): void {
    evt.preventDefault();
    // Phase 5D-3C: same early, additive branch as handleParagraphDragOver
    // above — a callout/blockquote drag session dropped onto a paragraph
    // or complex-member row is resolved through the shared
    // handleCalloutDropNode core.
    if (this.calloutDragSession) {
      const calloutSession = this.calloutDragSession;
      this.clearDropIndicator();
      this.endDrag();
      this.handleCalloutDropNode(calloutSession, evt, node, selfEl);
      return;
    }
    const session = this.paragraphDragSession;
    this.clearDropIndicator();
    this.endDrag();
    if (!session) return;

    const view = this.activeMarkdownView.get();
    if (!view) return;
    const target = this.paragraphDropTargetHint(node);
    if (!target) return;
    const zone = this.computeParagraphDropZone(evt, selfEl);
    const resolution = resolveParagraphDropDirection(view.editor.getValue(), session.anchor, target, zone);
    if (!resolution.allowed) {
      // Phase 5P-6: mirrors handleParagraphDragOver's own "not-adjacent
      // only" fallback gate above — see that method's doc comment for why
      // every other reject reason stays a silent no-op here too (drop
      // already unconditionally cleaned up the drag/indicator state above,
      // matching this method's own pre-5P-6 "no Notice on this path"
      // convention). The candidate SiblingTargetAnchor built here is, like
      // dragover's own candidate, never itself trusted as final — the
      // actual write-safety re-verification is entirely
      // dispatchAndApplyParagraphNonAdjacentMove's own job (it re-reads
      // editor.getValue() fresh and calls moveParagraphNonAdjacent, which
      // independently re-resolves BOTH source and target one more time —
      // the exact same "cached candidate, fresh final check" split the
      // existing context-menu path already relies on).
      // handleParagraphDrop (unlike handleParagraphDragOver) has no local
      // `doc` of its own — resolveParagraphDropDirection above already
      // reads `view.editor.getValue()` directly instead. The candidate
      // anchor built here still only ever needs `this.currentDoc` (the
      // same render-time-cached snapshot dragover's own preview already
      // uses), never a fresh re-parse: see this branch's own doc comment
      // above for why that candidate is safe despite being cached.
      const cachedDoc = this.currentDoc;
      if (resolution.reason === "not-adjacent" && cachedDoc) {
        const nonAdjacent = this.resolveParagraphNonAdjacentDragTarget(session, cachedDoc, node, zone);
        if (nonAdjacent) {
          this.dispatchAndApplyParagraphNonAdjacentMove(
            session.anchor,
            nonAdjacent.targetAnchor,
            nonAdjacent.position
          );
        }
      }
      return;
    }
    this.dispatchAndApplyParagraphMove(session.anchor, resolution.direction);
  }

  /**
   * Phase 5T-2 real-device-verification fix: resolves the
   * (rangeStart, rangeEnd, parentId) hint `resolveParagraphDropDirection`
   * needs for whichever kind of row is currently being hovered/dropped
   * on. A paragraph row (OutlineTreeParagraphNode) carries these fields
   * directly. A standalone callout/blockquote row
   * (OutlineTreeComplexMemberNode) does not — that type has no
   * rangeStart/rangeEnd/parentId fields at all (see its own doc comment)
   * — but its `id` IS the underlying ComplexBlockInfo's own id from the
   * SAME scan (`this.currentComplexScan`) this Tree was last rendered
   * from, so looking it back up there by id is an exact match, not a
   * guess: mirrors how a paragraph row's own rangeStart/rangeEnd/parentId
   * are themselves just a render-time-cached hint, re-verified fresh
   * inside resolveParagraphDropDirection's own resolveAnchorUnit/
   * findComplexSiblingTarget calls, never trusted as final identity by
   * themselves. Returns null when the node kind isn't recognized as a
   * valid paragraph-drop target at all, or when the id can no longer be
   * found in the cached scan (the row is stale) — either way the caller
   * treats that exactly like "not a valid drop target right now".
   */
  private paragraphDropTargetHint(
    node: OutlineTreeParagraphNode | OutlineTreeComplexMemberNode
  ): ParagraphDropTargetHint | null {
    if (node.kind === "paragraph") {
      return { rangeStart: node.rangeStart, rangeEnd: node.rangeEnd, parentId: node.parentId };
    }
    const scan = this.currentComplexScan;
    if (!scan) return null;
    const block = scan.blocks.find((b) => b.id === node.id);
    if (!block) return null;
    return { rangeStart: block.range.startLine, rangeEnd: block.range.endLine, parentId: block.parentId };
  }

  /**
   * Phase 5P-6 ("Paragraph Non-Adjacent Drag and Drop Wiring"): the scope
   * gate for BOTH the drag source and the drop target of the non-adjacent
   * D&D adapter below — deliberately its own private helper, NOT a reuse
   * of edit/deleteParagraph.ts#isInScopeParagraphParent, because that
   * function was widened by the (separately-numbered, already-shipped)
   * Phase 5P-5 ("list item 子 paragraph の Tree insert/delete 解禁") to
   * also accept a `"list"`-type parent — exactly the scope Phase 5P-6's
   * own approved audit explicitly excludes for non-adjacent D&D ("list
   * item 子 paragraph は...Phase 5P-6 の対象外とする"). `parentId === null`
   * (top-level paragraph) and a `"section"`-type parent (section-direct
   * paragraph) are the only two admitted shapes; a `"list"`-type parent,
   * or any other/unresolved parent, is rejected. This is a preview-time
   * convenience gate only — like every other check in this adapter, it
   * never substitutes for moveParagraphNonAdjacent's own re-resolution at
   * drop time (see resolveParagraphNonAdjacentDragTarget's own doc
   * comment below).
   */
  private isTopLevelOrSectionDirectParagraphParent(doc: ParsedDocument, parentId: string | null): boolean {
    if (parentId === null) return true;
    const parent = doc.nodes.get(parentId);
    return parent?.type === "section";
  }

  /**
   * Phase 5P-6: the ENTIRE new D&D-specific adapter surface this ticket
   * adds — resolves whether `node` (the row currently under the pointer
   * during a paragraph drag session already found NOT to be a true
   * adjacent sibling by resolveParagraphDropDirection — see both call
   * sites below, which only ever reach this method after that check has
   * already returned `{ allowed: false, reason: "not-adjacent" }`, never
   * on any other reject reason) is a safe candidate for the existing
   * moveParagraphNonAdjacent engine, and if so, builds the exact
   * `SiblingTargetAnchor` + `NonAdjacentMovePosition` pair that engine
   * already expects — the SAME two types edit/paragraphNonAdjacentMove.ts
   * already defines and showParagraphMoveTargetPicker/
   * dispatchAndApplyParagraphNonAdjacentMove already consume for the
   * existing context-menu path. No new anchor shape, no new resolution
   * logic, no new reject-reason vocabulary is introduced here.
   *
   * Four gates, in order, ALL preview-only (never themselves a green
   * light to write — moveParagraphNonAdjacent's own three-stage source/
   * target re-resolution, called from dispatchAndApplyParagraphNonAdjacentMove
   * at actual drop time against `editor.getValue()`, remains the sole
   * authority, exactly like every other caller of that function):
   *
   *   1. `node.kind === "paragraph"` — Phase 5P-6's own D&D-target
   *      restriction. A standalone callout/blockquote row
   *      (OutlineTreeComplexMemberNode) is a valid non-adjacent-move
   *      TARGET via the existing context menu (NON_ADJACENT_TARGET_KINDS
   *      includes "callout"/"blockquote", unchanged by this ticket) but
   *      is deliberately NOT offered as a D&D target — this gate is the
   *      one place that restriction lives, applied only here, never
   *      inside buildSiblingTargetAnchor/resolveTargetAnchor/
   *      NON_ADJACENT_TARGET_KINDS themselves.
   *   2. `isTopLevelOrSectionDirectParagraphParent` on BOTH the drag
   *      session's own source parentId (`session.anchor.parentId`) and
   *      the hovered target's parentId — Phase 5P-6's source/target scope
   *      restriction (list-item-child paragraphs excluded from THIS new
   *      path; the existing adjacent-swap D&D's own handling of such rows,
   *      whatever it already is, is untouched).
   *   3. `node.parentId === session.anchor.parentId` — "same section
   *      scope" per the approved design: since both sides are already
   *      constrained to top-level (`parentId === null`) or section-direct
   *      (`parentId` = that section's id) by gate 2, parentId equality
   *      IS exactly "same section, or both top-level" — no separate
   *      enclosing-section walk is needed. This is also exactly the same
   *      condition moveParagraphNonAdjacent's own `parent-mismatch`
   *      rejection re-checks independently at drop time — this gate is a
   *      preview optimization only (skip showing an indicator for a drop
   *      that would certainly be rejected), never a substitute for it.
   *   4. `resolveParagraphFromTreeHint` + `buildSiblingTargetAnchor` — the
   *      EXACT SAME pair used at dragstart for the source anchor
   *      (handleParagraphDragStart) and inside showParagraphMoveMenu for
   *      the picker's own sibling entries, reused verbatim. Returns null
   *      on anything resolveParagraphFromTreeHint/buildSiblingTargetAnchor
   *      themselves already refuse (ambiguous hint, wrong kind,
   *      editability !== "supported", etc.) — no new refusal condition is
   *      invented in THIS method beyond gates 1–3 above.
   *
   * `zone` maps directly to `NonAdjacentMovePosition` with NO inversion —
   * unlike the adjacent-swap path's own "landing edge" indicator fix
   * (Phase 5T-2S-B, see handleParagraphDragOver's own doc comment), a
   * cut-and-reinsert has no swap-landing illusion to correct for: hovering
   * the top half of a row and choosing "before" means the source lands
   * immediately above that row, which IS the top edge being hovered — the
   * zone and the landing edge are the same edge here.
   */
  private resolveParagraphNonAdjacentDragTarget(
    session: ParagraphDragSession,
    doc: ParsedDocument,
    node: OutlineTreeParagraphNode | OutlineTreeComplexMemberNode,
    zone: ParagraphDropZone
  ): { targetAnchor: SiblingTargetAnchor; position: NonAdjacentMovePosition } | null {
    if (node.kind !== "paragraph") return null;
    if (!this.isTopLevelOrSectionDirectParagraphParent(doc, session.anchor.parentId)) return null;
    if (!this.isTopLevelOrSectionDirectParagraphParent(doc, node.parentId)) return null;
    if (node.parentId !== session.anchor.parentId) return null;

    const complexScan = this.currentComplexScan;
    if (!complexScan) return null;
    const info = resolveParagraphFromTreeHint(
      { rangeStart: node.rangeStart, rangeEnd: node.rangeEnd, parentId: node.parentId },
      complexScan
    );
    if (!info) return null;
    const targetAnchor = buildSiblingTargetAnchor(doc, info);
    if (!targetAnchor) return null;

    return { targetAnchor, position: zone === "before" ? "before" : "after" };
  }

  private clearDropIndicator(): void {
    if (this.dropIndicatorEl) {
      this.dropIndicatorEl.removeClass(
        "unified-outliner-drop-before",
        "unified-outliner-drop-after",
        "unified-outliner-drop-inside"
      );
    }
    this.dropIndicatorEl = null;
  }

  private setDropIndicator(el: HTMLElement, mode: DropMode): void {
    if (this.dropIndicatorEl && this.dropIndicatorEl !== el) this.clearDropIndicator();
    el.removeClass(
      "unified-outliner-drop-before",
      "unified-outliner-drop-after",
      "unified-outliner-drop-inside"
    );
    el.addClass(`unified-outliner-drop-${mode}`);
    this.dropIndicatorEl = el;
  }

  /** Top third -> before, middle third -> inside, bottom third -> after. */
  private computeDropMode(evt: DragEvent, el: HTMLElement): DropMode {
    const rect = el.getBoundingClientRect();
    const ratio = rect.height > 0 ? (evt.clientY - rect.top) / rect.height : 0.5;
    if (ratio < 1 / 3) return "before";
    if (ratio > 2 / 3) return "after";
    return "inside";
  }

  /**
   * Relocate the dragged subtree (sourceId) relative to the drop target,
   * via the same dispatchAndApply tail every other tree command uses —
   * dispatchAndApply resolves sourceId in a FRESH parse (so the dispatched
   * kind check below is against current data, not a possibly-stale
   * this.currentDoc) and positions the cursor at the outcome's
   * newStartLine, which for both relocateSection() and
   * relocateListSubtree() is exactly the moved node's own new start line,
   * so the usual apply -> refresh sequence already leaves the right node
   * highlighted with no special-casing needed here.
   */
  private runRelocateCommand(sourceId: string, targetId: string, mode: DropMode): void {
    this.dispatchAndApply(sourceId, (doc) => {
      const source = doc.nodes.get(sourceId);
      if (source?.type === "list") {
        return relocateListSubtree(doc, sourceId, targetId, mode, {
          normalizeOrderedLists: this.plugin.settings.normalizeOrderedLists,
        });
      }
      return relocateSection(doc, sourceId, targetId, mode);
    });
  }

  // ---- Phase 5D-3C ("Callout and Blockquote Drag and Drop", 案A
  // approved): standalone / CompositeBlock-member callout/blockquote D&D
  // -------------------------------------------------------------------
  //
  // A SIXTH drag-wiring family, alongside section/list (Phase 3A/4A),
  // paragraph (Phase 5T-2), and the standalone-callout/blockquote-as-
  // paragraph-drop-target bridge (Phase 5T-2 fix) already defined above.
  // Reuses move/moveBlock.ts#insertBlockAt (UNCHANGED, via
  // edit/dropStandaloneComplexBlock.ts) rather than any new text-splice
  // primitive, and reuses edit/moveStandaloneComplexBlock.ts's own
  // StandaloneComplexBlockSnapshot/buildStandaloneComplexBlockSnapshot/
  // snapshotMatches (also UNCHANGED) for source identity — see this
  // ticket's own approval for why both reuses are required, not merely
  // convenient.
  //
  // The two methods below (handleCalloutDragOverNode/handleCalloutDropNode)
  // are the SHARED resolution core, called from FOUR places: this class's
  // own handleDragOver/handleDrop (section/list rows) and
  // handleParagraphDragOver/handleParagraphDrop (paragraph/complex-member
  // rows) — each of those four methods checks `this.calloutDragSession`
  // FIRST, as a new early branch, before falling through to its
  // pre-existing (untouched) behavior. This lets a callout/blockquote be
  // dropped relative to ANY of those row kinds via ONE single resolution
  // path, without duplicating the resolve-source/resolve-target/zone/
  // resolver sequence four times, and without ever letting two separate
  // 'dragover'/'drop' listeners on the same row race each other (a real
  // risk that was deliberately designed around — see this method's own
  // git history / the ticket's pre-commit report for why a SECOND,
  // independent listener pair was rejected in favor of this shared-branch
  // approach).

  /** Phase 5D-3C (v1 scope): upper half -> "before", lower half -> "after". Deliberately mirrors computeParagraphDropZone's own two-way split (own independent type — see StandaloneComplexBlockDropZone's own doc comment for why it is not shared with ParagraphDropZone). */
  private computeCalloutDropZone(evt: DragEvent, el: HTMLElement): StandaloneComplexBlockDropZone {
    const rect = el.getBoundingClientRect();
    const ratio = rect.height > 0 ? (evt.clientY - rect.top) / rect.height : 0.5;
    return ratio < 0.5 ? "before" : "after";
  }

  /**
   * Phase 5D-3C: resolves the CURRENT source ComplexBlockInfo for the
   * active callout/blockquote drag session, by re-finding a
   * this.currentComplexScan block that structurally matches the session's
   * own snapshot (snapshotMatches, reused unchanged from
   * edit/moveStandaloneComplexBlock.ts). Uses the CACHED
   * this.currentComplexScan, not a fresh re-parse — safe for the same
   * reason handleParagraphDragOver's own doc comment gives for reusing
   * this.currentDoc: any document change since drag-start would already
   * have torn this session down via cancelCalloutDrag()/refresh(). Returns
   * null when no session is active or it can no longer be resolved this
   * way (dragover simply shows no indicator in that case — the actual
   * DROP still re-verifies everything again from a fully fresh parse, via
   * edit/dropStandaloneComplexBlock.ts).
   */
  private resolveCalloutDragSource(): ComplexBlockInfo | null {
    const session = this.calloutDragSession;
    const complexScan = this.currentComplexScan;
    if (!session || !complexScan) return null;
    return complexScan.blocks.find((b) => snapshotMatches(session.snapshot, b)) ?? null;
  }

  /**
   * Phase 5D-3C: resolves a hovered/dropped-on Tree row of ANY kind into a
   * StandaloneComplexBlockDropTargetHint, or null when that row's kind or
   * current shape is not a valid v1 drop target. Mirrors
   * move/findStandaloneComplexBlockDropTarget.ts's own top doc comment's
   * v1 target scope exactly:
   *
   *   - a top-level-of-section list item (NOT nested inside another list
   *     item's continuation) -> eligible.
   *   - a paragraph or complex-member (callout/blockquote/fenced-code/
   *     table/thematic-break, standalone OR CompositeBlock-member) Tree
   *     row, resolved fresh against this.currentComplexScan (a paragraph
   *     row's own id is a Tree-view-only identity — see
   *     OutlineTreeParagraphNode's own doc comment — so its cached
   *     rangeStart/rangeEnd/parentId fields are used directly instead, the
   *     same fields paragraphDropTargetHint's own paragraph branch already
   *     relies on) -> eligible only when NOT nested inside a list item's
   *     continuation.
   *   - a section, or a CompositeBlock's own aggregate row -> never
   *     eligible in this v1 (see this ticket's own approval for why both
   *     are explicitly out of scope).
   */
  private calloutDropTargetHint(node: OutlineTreeNode): StandaloneComplexBlockDropTargetHint | null {
    const doc = this.currentDoc;
    if (!doc) return null;

    if (isOutlineListNode(node)) {
      const listNode = doc.nodes.get(node.id);
      if (!listNode || listNode.type !== "list") return null;
      if (listNode.parentId) {
        const owner = doc.nodes.get(listNode.parentId);
        if (owner && owner.type === "list") return null;
      }
      return {
        range: { startLine: listNode.range.startLine, endLine: listNode.range.endLine },
        parentId: listNode.parentId,
      };
    }

    if (node.kind === "paragraph") {
      if (node.parentId) {
        const owner = doc.nodes.get(node.parentId);
        if (owner && owner.type === "list") return null;
      }
      return {
        range: { startLine: node.rangeStart, endLine: node.rangeEnd },
        parentId: node.parentId,
      };
    }

    if (node.kind === "complex-member") {
      const scan = this.currentComplexScan;
      if (!scan) return null;
      const block = scan.blocks.find((b) => b.id === node.id);
      if (!block) return null;
      if (block.parentId) {
        const owner = doc.nodes.get(block.parentId);
        if (owner && owner.type === "list") return null;
      }
      return {
        range: { startLine: block.range.startLine, endLine: block.range.endLine },
        parentId: block.parentId,
      };
    }

    return null;
  }

  /**
   * Phase 5D-3C dragstart for a standalone or CompositeBlock-member
   * callout/blockquote row. Builds a StandaloneComplexBlockSnapshot from
   * the CURRENT refresh()-time complexScan (the EXACT SAME snapshot
   * builder Move's own Tree menu already uses — see
   * buildStandaloneComplexBlockSnapshot's own doc comment) and stores it as
   * this session's sole safety-bearing field. If resolution or snapshot-
   * building fails, the drag is cancelled at the browser level via
   * preventDefault() — mirrors handleParagraphDragStart's own exact
   * failure-handling shape.
   *
   * Deliberately does NOT check composite membership here (or anywhere
   * else in this ticket's own source-eligibility path) — a
   * CompositeBlock-member row is just as valid a D&D source as a
   * standalone one, per this ticket's own approved 案A. Kind/editability/
   * nested-in-list re-verification still happens, at both dragover
   * (resolveStandaloneComplexBlockDropTarget) and drop
   * (edit/dropStandaloneComplexBlock.ts), never trusted from this
   * dragstart-time snapshot alone.
   */
  private handleCalloutDragStart(
    evt: DragEvent,
    node: OutlineTreeComplexMemberNode,
    itemEl: HTMLElement
  ): void {
    const complexScan = this.currentComplexScan;
    if (!complexScan) {
      evt.preventDefault();
      return;
    }
    const info = complexScan.blocks.find((b) => b.id === node.id);
    if (!info) {
      evt.preventDefault();
      return;
    }
    const snapshot = buildStandaloneComplexBlockSnapshot(info);
    if (!snapshot) {
      evt.preventDefault();
      return;
    }
    this.calloutDragSession = { snapshot, sourceTreeNodeId: node.id };
    this.draggingItemEl = itemEl;
    itemEl.addClass("unified-outliner-dragging");
    if (evt.dataTransfer) {
      // Same intentionally-empty-sentinel convention as handleDragStart/
      // handleParagraphDragStart above — see either of their own doc
      // comments for the real-device rationale (dropping outside the Tree
      // must never leak a raw internal id into the body as literal text).
      evt.dataTransfer.setData("text/plain", "");
      evt.dataTransfer.effectAllowed = "move";
    }
  }

  /**
   * Phase 5D-3C: shared dragover resolution for a callout/blockquote drag
   * session hovering `node` (of ANY row kind — see calloutDropTargetHint's
   * own doc comment for the exact v1-eligible kinds). Called from
   * handleDragOver (section/list rows), handleParagraphDragOver (paragraph/
   * complex-member rows), and this ticket's own new composite-member
   * branch in renderNode. Only calls preventDefault()/shows an indicator
   * when resolveStandaloneComplexBlockDropTarget says the drop would
   * actually be allowed — an invalid target gets no indicator and no
   * drop-allowed cursor at all, matching every other D&D path in this
   * file's own "don't call preventDefault -> browser shows its own
   * not-allowed affordance" convention.
   */
  private handleCalloutDragOverNode(evt: DragEvent, node: OutlineTreeNode, selfEl: HTMLElement): void {
    const doc = this.currentDoc;
    const composites = this.currentComposites;
    const source = this.resolveCalloutDragSource();
    const target = source ? this.calloutDropTargetHint(node) : null;
    if (!doc || !composites || !source || !target) {
      if (this.dropIndicatorEl === selfEl) this.clearDropIndicator();
      return;
    }
    const zone = this.computeCalloutDropZone(evt, selfEl);
    const resolution = resolveStandaloneComplexBlockDropTarget(doc, source, composites, target, zone);
    if (!resolution.allowed) {
      if (this.dropIndicatorEl === selfEl) this.clearDropIndicator();
      return;
    }
    evt.preventDefault();
    if (evt.dataTransfer) evt.dataTransfer.dropEffect = "move";
    this.setDropIndicator(selfEl, zone);
  }

  /**
   * Phase 5D-3C: shared drop resolution — mirrors handleCalloutDragOverNode's
   * own role but for the drop event. `session` must be captured by the
   * CALLER before invoking `clearDropIndicator()`/`endDrag()` (which null
   * `this.calloutDragSession`) — every call site does this, mirroring
   * handleParagraphDrop's own identical ordering requirement for
   * `this.paragraphDragSession`.
   */
  private handleCalloutDropNode(
    session: StandaloneComplexBlockDragSession,
    evt: DragEvent,
    node: OutlineTreeNode,
    selfEl: HTMLElement
  ): void {
    const target = this.calloutDropTargetHint(node);
    if (!target) return;
    const zone = this.computeCalloutDropZone(evt, selfEl);
    this.dispatchAndApplyStandaloneComplexBlockDrop(session.snapshot, target, zone);
  }

  /**
   * Phase 5D-3C: dedicated, thin dispatch for a standalone/CompositeBlock-
   * member callout/blockquote drop — mirrors
   * dispatchAndApplyStandaloneComplexBlockMove's own exact shape (same
   * multi-cursor guard, same "read the editor's CURRENT text and hand it
   * to the pure function along with the drag-time snapshot/target/zone"
   * pattern, same applyLineEditOutcome/scroll/refresh tail). All Markdown
   * re-parsing, block re-resolution, target re-verification, and
   * resolver/insertBlockAt invocation are
   * edit/dropStandaloneComplexBlock.ts's job — nothing here duplicates any
   * of it.
   *
   * The `notify` callback passed to applyLineEditOutcome is intentionally
   * a no-op: per this ticket's own approval, no new i18n key was added
   * for StandaloneComplexBlockDropRejectReason (see that type's own top
   * doc comment in model/complexBlock.ts) — a rejected drop is
   * communicated purely by the drop indicator never having appeared
   * (dragover already filtered it out before drop could even be attempted
   * in the ordinary case) and by the note staying byte-identical, matching
   * this codebase's pre-existing convention for section/list D&D's own
   * NoRelocateReason (confirmed, before this ticket, to have zero i18n
   * bindings).
   */
  private dispatchAndApplyStandaloneComplexBlockDrop(
    snapshot: StandaloneComplexBlockSnapshot,
    target: StandaloneComplexBlockDropTargetHint,
    zone: StandaloneComplexBlockDropZone
  ): boolean {
    const view = this.activeMarkdownView.get();
    if (!view) return false;
    const editor: Editor = view.editor;

    if (editor.listSelections().length > 1) {
      this.notify(this.plugin.t("notice.multipleCursors"));
      return false;
    }

    const text = editor.getValue();
    const rules = getEnabledCompositeBlockRules(this.plugin.settings.compositeBlocks);
    const outcome = dropStandaloneComplexBlock(text, { snapshot, target, zone }, rules);

    const cursor = { line: snapshot.range.startLine, ch: 0 };
    const changed = applyLineEditOutcome(
      editor,
      cursor,
      snapshot.range.startLine,
      text.split("\n"),
      outcome,
      () => {
        /* Phase 5D-3C: intentionally silent — see this method's own doc comment. */
      }
    );

    if (changed) {
      const cur = editor.getCursor();
      const lineLen = editor.getLine(cur.line)?.length ?? 0;
      editor.scrollIntoView(
        { from: { line: cur.line, ch: 0 }, to: { line: cur.line, ch: lineLen } },
        true
      );
      this.queueSelectionFollow(outcome.newStartLine);
      this.refresh();
    }
    return changed;
  }

  // ---- Phase 5D-4C ("CompositeBlock Atomic Drag-and-Drop 最小実装",
  // Phase 5D-4B design approved): CompositeBlock (parent row) D&D --------
  //
  // An EIGHTH drag-wiring family, alongside section/list (Phase 3A/4A),
  // paragraph (Phase 5T-2), and standalone/composite-member callout/
  // blockquote (Phase 5D-3C) already defined above. Reuses
  // move/moveBlock.ts's existing primitives exclusively — swapBlocks (via
  // the UNCHANGED edit/moveCompositeBlock.ts, for the adjacent case) and
  // insertBlockAt (via the new edit/dropCompositeBlock.ts, for the
  // non-adjacent case) — never a new text-splice primitive.
  //
  // Unlike the callout/blockquote D&D family (whose shared resolution core
  // is reached from FOUR row kinds), this family's shared core
  // (handleCompositeDragOverNode/handleCompositeDropNode, below) is reached
  // from only TWO: this class's own handleDragOver/handleDrop (a plain
  // list row as target) and this class's own renderNode composite-row
  // branch (another CompositeBlock's own parent row as target). Every
  // other row kind (section, paragraph, standalone/composite-member
  // callout/blockquote, and any list/composite row nested inside another
  // composite) rejects a CompositeBlock drag session WITHOUT any new code
  // in this ticket — see this class's own renderNode doc comment on the
  // new composite-row branch, and compositeDropTargetHint's own doc
  // comment below, for why.

  /** Phase 5D-4C (v1 scope): upper half -> "before", lower half -> "after". Mirrors computeCalloutDropZone's own two-way split exactly (own independent type — see CompositeBlockDropZone's own doc comment in move/findCompositeBlockDropTarget.ts for why it is not shared with StandaloneComplexBlockDropZone/ParagraphDropZone). */
  private computeCompositeDropZone(evt: DragEvent, el: HTMLElement): CompositeBlockDropZone {
    const rect = el.getBoundingClientRect();
    const ratio = rect.height > 0 ? (evt.clientY - rect.top) / rect.height : 0.5;
    return ratio < 0.5 ? "before" : "after";
  }

  /**
   * Phase 5D-4C: UI-time-only "is this the same CompositeBlock" check —
   * mirrors edit/moveCompositeBlock.ts's own private snapshotMatches
   * exactly (same fields compared, same deliberate exclusion of `id`),
   * reimplemented locally rather than imported since that function is not
   * exported (each CompositeBlock-editing module in this codebase keeps
   * its own independent copy — see moveCompositeBlock.ts's own top doc
   * comment). Used ONLY for dragover-time preview/source-resolution
   * (resolveCompositeDragSource, below) against the CACHED
   * this.currentComposites — never for the actual drop's own safety
   * decision, which is entirely edit/dropCompositeBlock.ts's/
   * edit/moveCompositeBlock.ts's own re-parse-based re-verification job.
   */
  private compositeSnapshotMatches(snapshot: CompositeBlockSnapshot, composite: CompositeBlockInfo): boolean {
    if (composite.ruleId !== snapshot.ruleId) return false;
    if (composite.sectionId !== snapshot.sectionId) return false;
    if (
      composite.range.startLine !== snapshot.range.startLine ||
      composite.range.endLine !== snapshot.range.endLine
    ) {
      return false;
    }
    if (composite.members.length !== snapshot.members.length) return false;
    for (let i = 0; i < composite.members.length; i++) {
      const actual = composite.members[i];
      const expected = snapshot.members[i];
      if (actual.kind !== expected.kind) return false;
      if (actual.id !== expected.id) return false;
      if (
        actual.range.startLine !== expected.range.startLine ||
        actual.range.endLine !== expected.range.endLine
      ) {
        return false;
      }
    }
    return true;
  }

  /**
   * Phase 5D-4C: resolves the CURRENT source CompositeBlockInfo for the
   * active CompositeBlock drag session, by re-finding a
   * this.currentComposites entry that structurally matches the session's
   * own snapshot. Uses the CACHED this.currentComposites, not a fresh
   * re-parse — safe for the same reason resolveCalloutDragSource's own doc
   * comment gives: any document change since drag-start would already
   * have torn this session down via cancelCompositeDrag()/refresh().
   * Returns null when no session is active or it can no longer be resolved
   * this way (dragover simply shows no indicator in that case — the
   * actual DROP still re-verifies everything again from a fully fresh
   * parse, via edit/dropCompositeBlock.ts / edit/moveCompositeBlock.ts).
   */
  private resolveCompositeDragSource(): CompositeBlockInfo | null {
    const session = this.compositeDragSession;
    if (!session) return null;
    return this.currentComposites.find((c) => this.compositeSnapshotMatches(session.snapshot, c)) ?? null;
  }

  /**
   * Phase 5D-4C: resolves a hovered/dropped-on Tree row into a
   * CompositeBlockDropTargetHint, or null when that row's kind is not a
   * valid v1 CompositeBlock D&D target. Only TWO row kinds are ever
   * eligible:
   *
   *   - a plain list item row (isOutlineListNode) -> its own current
   *     range/parentId, read directly from this.currentDoc.
   *   - a CompositeBlock parent row (isOutlineCompositeNode) -> that OTHER
   *     composite's own full range, and its own anchor member's parentId
   *     — i.e. already "widened" to the whole other composite, by
   *     construction (see this class's own renderNode composite-row
   *     branch and Phase 5D-4B design §4 for why widening is this
   *     method's job, not the resolver's).
   *
   * Every other row kind (section, paragraph, standalone/composite-member
   * callout/blockquote) returns null — a section row and a
   * CompositeBlock's own aggregate row are both explicitly out of scope
   * for OTHER D&D families' own target hints too (see
   * calloutDropTargetHint's own doc comment), and paragraph/callout rows
   * were never wired to check this.compositeDragSession at all (see this
   * class's own new drag-wiring branch's doc comment).
   */
  private compositeDropTargetHint(node: OutlineTreeNode): CompositeBlockDropTargetHint | null {
    const doc = this.currentDoc;
    if (!doc) return null;

    if (isOutlineListNode(node)) {
      const listNode = doc.nodes.get(node.id);
      if (!listNode || listNode.type !== "list") return null;
      return {
        range: { startLine: listNode.range.startLine, endLine: listNode.range.endLine },
        parentId: listNode.parentId,
      };
    }

    if (isOutlineCompositeNode(node)) {
      const composite = this.currentComposites.find((c) => c.id === node.id);
      if (!composite) return null;
      const anchor = doc.nodes.get(composite.members[0].id);
      if (!anchor || anchor.type !== "list") return null;
      return {
        range: { startLine: composite.range.startLine, endLine: composite.range.endLine },
        parentId: anchor.parentId,
      };
    }

    return null;
  }

  /**
   * Phase 5D-4C: dragover-time-only re-resolution of `target` (a
   * range+parentId hint from compositeDropTargetHint) into a full
   * CompositeBlockDropTargetCandidate (adding depth/indentColumns),
   * against the CACHED this.currentDoc/this.currentComposites — mirrors
   * edit/dropCompositeBlock.ts's own resolveTargetCandidate exactly in
   * logic, independently reimplemented here since it operates on cached
   * view-layer state rather than a fresh parse (same Obsidian/pure
   * boundary split calloutDropTargetHint (view) vs.
   * dropTargetHintStillValid (executor) already established). Used ONLY
   * for the dragover indicator preview — the actual drop always re-derives
   * this fresh via edit/dropCompositeBlock.ts's own re-parse.
   */
  private resolveCompositeDropCandidate(
    doc: ParsedDocument,
    composites: CompositeBlockInfo[],
    target: CompositeBlockDropTargetHint
  ): CompositeBlockDropTargetCandidate | null {
    for (const node of doc.nodes.values()) {
      if (node.type !== "list") continue;
      if (
        node.range.startLine === target.range.startLine &&
        node.range.endLine === target.range.endLine &&
        node.parentId === target.parentId
      ) {
        return {
          range: { startLine: node.range.startLine, endLine: node.range.endLine },
          parentId: node.parentId,
          depth: node.depth,
          indentColumns: node.indentColumns,
        };
      }
    }
    for (const composite of composites) {
      if (
        composite.range.startLine === target.range.startLine &&
        composite.range.endLine === target.range.endLine
      ) {
        const anchor = doc.nodes.get(composite.members[0].id);
        if (anchor && anchor.type === "list" && anchor.parentId === target.parentId) {
          return {
            range: { startLine: composite.range.startLine, endLine: composite.range.endLine },
            parentId: anchor.parentId,
            depth: anchor.depth,
            indentColumns: anchor.indentColumns,
          };
        }
      }
    }
    return null;
  }

  /**
   * Phase 5D-4C dragstart for a CompositeBlock parent row. Builds a
   * CompositeBlockSnapshot from the CURRENT refresh()-time
   * this.currentComposites (the EXACT SAME snapshot builder
   * showCompositeCommandMenu's own Move/Delete items already use) and
   * stores it as this session's sole safety-bearing field. If the
   * composite can no longer be resolved, the drag is cancelled at the
   * browser level via preventDefault() — mirrors handleCalloutDragStart's
   * own exact failure-handling shape. Takes `compositeId` (not the node
   * object) — mirrors showCompositeCommandMenu's own signature, and avoids
   * any need to narrow OutlineTreeNode to OutlineTreeCompositeNode at the
   * renderNode call site.
   */
  private handleCompositeDragStart(evt: DragEvent, compositeId: string, itemEl: HTMLElement): void {
    const composite = this.currentComposites.find((c) => c.id === compositeId);
    if (!composite) {
      evt.preventDefault();
      return;
    }
    const snapshot = buildCompositeBlockSnapshot(composite);
    this.compositeDragSession = { snapshot, sourceTreeNodeId: compositeId };
    this.draggingItemEl = itemEl;
    itemEl.addClass("unified-outliner-dragging");
    if (evt.dataTransfer) {
      // Same intentionally-empty-sentinel convention as every other
      // dragstart handler in this file — see handleDragStart's own doc
      // comment for the real-device rationale.
      evt.dataTransfer.setData("text/plain", "");
      evt.dataTransfer.effectAllowed = "move";
    }
  }

  /**
   * Phase 5D-4C: shared dragover resolution for a CompositeBlock drag
   * session hovering `node` (a plain list row OR another CompositeBlock's
   * own parent row — see compositeDropTargetHint's own doc comment).
   * Called from handleDragOver (list rows) and this class's own new
   * composite-row branch in renderNode (composite-row targets). Only
   * calls preventDefault()/shows an indicator when
   * resolveCompositeBlockDropTarget says the drop would actually be
   * allowed — an invalid target gets no indicator and no drop-allowed
   * cursor at all, matching every other D&D path in this file's own
   * "don't call preventDefault -> browser shows its own not-allowed
   * affordance" convention.
   */
  private handleCompositeDragOverNode(evt: DragEvent, node: OutlineTreeNode, selfEl: HTMLElement): void {
    const doc = this.currentDoc;
    const composites = this.currentComposites;
    const source = this.resolveCompositeDragSource();
    const target = source ? this.compositeDropTargetHint(node) : null;
    if (!doc || !source || !target) {
      if (this.dropIndicatorEl === selfEl) this.clearDropIndicator();
      return;
    }
    const candidate = this.resolveCompositeDropCandidate(doc, composites, target);
    if (!candidate) {
      if (this.dropIndicatorEl === selfEl) this.clearDropIndicator();
      return;
    }
    const zone = this.computeCompositeDropZone(evt, selfEl);
    const resolution = resolveCompositeBlockDropTarget(doc, source, composites, candidate, zone);
    if (!resolution.allowed) {
      if (this.dropIndicatorEl === selfEl) this.clearDropIndicator();
      return;
    }
    evt.preventDefault();
    if (evt.dataTransfer) evt.dataTransfer.dropEffect = "move";
    this.setDropIndicator(selfEl, zone);
  }

  /**
   * Phase 5D-4C: shared drop resolution — mirrors
   * handleCompositeDragOverNode's own role but for the drop event.
   * `session` must be captured by the CALLER before invoking
   * `clearDropIndicator()`/`endDrag()` (which null
   * `this.compositeDragSession`) — every call site does this, mirroring
   * handleCalloutDropNode's own identical ordering requirement.
   */
  private handleCompositeDropNode(
    session: CompositeDragSession,
    evt: DragEvent,
    node: OutlineTreeNode,
    selfEl: HTMLElement
  ): void {
    const target = this.compositeDropTargetHint(node);
    if (!target) return;
    const zone = this.computeCompositeDropZone(evt, selfEl);
    const rules = getEnabledCompositeBlockRules(this.plugin.settings.compositeBlocks);
    this.dispatchAndApplyCompositeDrop(session.snapshot, target, zone, rules);
  }

  /**
   * Phase 5D-4C: dedicated, thin dispatch for a CompositeBlock drop —
   * mirrors dispatchAndApplyStandaloneComplexBlockDrop's own exact shape
   * (same multi-cursor guard, same "read the editor's CURRENT text and
   * hand it to the pure function(s) along with the drag-time snapshot/
   * target/zone" pattern, same applyLineEditOutcome/scroll/refresh tail).
   *
   * Unlike every other dispatchAndApply* method in this file, this one
   * chooses BETWEEN TWO pure functions before applying an outcome — see
   * Phase 5D-4B design doc §5's own "隣接・非隣接の判定（dispatch 層）"
   * section for the full rationale. Re-parses the editor's current text
   * once, re-resolves the source snapshot against it, and (only when that
   * resolution succeeds) asks the EXISTING, UNCHANGED
   * move/findCompositeMoveTarget.ts#findCompositeMoveTarget whether the
   * drop target's own range is EXACTLY the adjacent target it would
   * itself resolve for the implied direction. A match dispatches through
   * the EXISTING, UNCHANGED edit/moveCompositeBlock.ts#moveCompositeBlock
   * (adjacent case, swapBlocks-based); anything else — including a source
   * that can no longer be resolved at all — dispatches through the new
   * edit/dropCompositeBlock.ts#dropCompositeBlock (non-adjacent case,
   * insertBlockAt-based). This routing choice is never itself
   * safety-critical: BOTH pure functions independently re-parse/re-scan/
   * re-match/re-resolve everything from scratch and are each fully
   * fail-closed on their own, so a wrong routing guess here can never
   * produce an unsafe write — at worst it would produce a "no-target"/
   * rejection outcome from whichever function was called, exactly as if
   * that function had been called directly.
   *
   * The `notify` callback passed to applyLineEditOutcome is intentionally
   * a no-op: per Phase 5D-4B design §6, CompositeBlock D&D is a silent
   * rejection, mirroring every other existing D&D path in this codebase
   * (section/list, paragraph, callout/blockquote). The existing
   * menu/command-driven dispatchAndApplyCompositeMove (unchanged) keeps
   * its own existing Notice behavior via compositeMoveReasonText.
   */
  private dispatchAndApplyCompositeDrop(
    snapshot: CompositeBlockSnapshot,
    target: CompositeBlockDropTargetHint,
    zone: CompositeBlockDropZone,
    rules: CompositeBlockRule[]
  ): boolean {
    const view = this.activeMarkdownView.get();
    if (!view) return false;
    const editor: Editor = view.editor;

    if (editor.listSelections().length > 1) {
      this.notify(this.plugin.t("notice.multipleCursors"));
      return false;
    }

    const text = editor.getValue();
    const doc = parseDocument(text);
    const complexScan = scanComplexBlocks(doc);
    const composites = matchCompositeBlocks(doc, complexScan, rules);
    const resolvedSource = composites.find((c) => this.compositeSnapshotMatches(snapshot, c));

    let outcome: LineEditOutcome;
    if (resolvedSource) {
      const insertBeforeLine = zone === "before" ? target.range.startLine : target.range.endLine + 1;
      const direction: CompositeMoveDirection =
        insertBeforeLine <= resolvedSource.range.startLine ? "up" : "down";
      const adjacentTarget = findCompositeMoveTarget(doc, complexScan, resolvedSource, direction, composites);
      const isAdjacentMatch =
        !!adjacentTarget &&
        adjacentTarget.range.startLine === target.range.startLine &&
        adjacentTarget.range.endLine === target.range.endLine;
      outcome = isAdjacentMatch
        ? moveCompositeBlock(text, { snapshot, direction }, rules)
        : dropCompositeBlock(text, { snapshot, target, zone }, rules);
    } else {
      outcome = dropCompositeBlock(text, { snapshot, target, zone }, rules);
    }

    const cursor = { line: snapshot.range.startLine, ch: 0 };
    const changed = applyLineEditOutcome(
      editor,
      cursor,
      snapshot.range.startLine,
      text.split("\n"),
      outcome,
      () => {
        /* Phase 5D-4C: intentionally silent — see this method's own doc comment. */
      }
    );

    if (changed) {
      const cur = editor.getCursor();
      const lineLen = editor.getLine(cur.line)?.length ?? 0;
      editor.scrollIntoView(
        { from: { line: cur.line, ch: 0 }, to: { line: cur.line, ch: lineLen } },
        true
      );
      this.queueSelectionFollow(outcome.newStartLine);
      this.refresh();
    }
    return changed;
  }
}

// ---- Phase 3D stage 3: CM6 -> Outline Tree fold sync ----------------------
//
// One-directional in Phase 3D stage 1 (Outline Tree -> CM6,
// syncFoldToBodyEditor above); this closes the loop the OTHER way — when
// the user folds/unfolds directly in the body editor (gutter arrow, or any
// other path that ends up dispatching CM6's own foldEffect/unfoldEffect —
// real-device investigation, 2026-08-04, confirmed the gutter path does
// this for both headings and list items in both Live Preview and Source
// Mode identically), reflect that into this plugin's own persisted fold state and
// re-render any open Outline Tree View.
//
// registerEditorExtension is a Plugin-level API, so the actual
// `plugin.registerEditorExtension(...)` call has to live in main.ts's
// onload() — but the extension itself, and all its resolution logic, is
// defined here rather than there, since it operates entirely in terms of
// this view's own domain (OutlineTreeNode, fold identity) and existing
// plugin-level infrastructure (foldStateManager, refreshOutlineTreeViews).
// main.ts just imports createCm6FoldSyncExtension and registers it, the
// same as every other piece of this plugin's Obsidian-glue wiring.

/**
 * Finds the markdown leaf whose CM6 EditorView instance is exactly
 * `cmView` — a focus-independent way to answer "which file does this CM6
 * update belong to" (plain object-identity comparison, not anything
 * DOM-focus dependent). Returns null if no open markdown leaf's editor
 * matches, or if the matching leaf's view has no backing file yet.
 */
function resolveOwningLeaf(
  plugin: UnifiedOutlinerPlugin,
  cmView: EditorView
): { leaf: WorkspaceLeaf; file: TFile } | null {
  for (const leaf of plugin.app.workspace.getLeavesOfType("markdown")) {
    const view = leaf.view;
    if (!(view instanceof MarkdownView)) continue;
    const cm = getEditorCmView(view.editor);
    if (cm !== cmView) continue;
    if (!view.file) return null;
    return { leaf, file: view.file };
  }
  return null;
}

/**
 * Resolves a single fold/unfold effect's {from, to} range into this
 * plugin's own node identity (tree/foldIdentity.ts's findNodeIdAtStartLine
 * + buildNodeIdentityMap) and, if found, writes it through
 * FoldStateManager and triggers a refresh of any open Outline Tree View —
 * the same two steps OutlineTreeView.setNodeCollapsed already performs for
 * a Tree-initiated toggle, reused here rather than duplicated (no new
 * collapsedIds-mutation path was added). Deliberately does NOT call
 * syncFoldToBodyEditor: the body editor already has this fold applied
 * (that's how this was observed in the first place), so dispatching it
 * back would be redundant at best and could re-trigger this very listener
 * at worst — this function only ever writes to persistence/re-renders the
 * tree, never back to CM6, which is what keeps the two directions from
 * feeding each other (together with outlineTreeFoldOrigin guarding the
 * other direction).
 *
 * Silently no-ops (no Notice) if the owning file can't be resolved, isn't
 * the active leaf, or no node starts exactly at the affected line — all
 * treated as "nothing to safely reflect", consistent with this being a
 * display-only sync feature rather than a user-initiated command.
 */
function handleCm6FoldEffect(
  plugin: UnifiedOutlinerPlugin,
  update: ViewUpdate,
  range: { from: number; to: number },
  collapsed: boolean
): void {
  const owning = resolveOwningLeaf(plugin, update.view);
  if (!owning) return;

  // Active-leaf-only. getActiveViewOfType is the officially recommended
  // replacement for the deprecated workspace.activeLeaf; comparing leaf
  // REFERENCES (not just "is some markdown view active") is what actually
  // restricts this to the specific leaf the fold happened in.
  //
  // Phase 4F formalizes this guard as the deliberate policy for the
  // "multiple markdown leaves of the same file" case (e.g. a split view,
  // or a future Phase 5 popout window) — see
  // docs/fold-state-conflict-resolution-spec.md §2 ("複数 leaf からの
  // ほぼ同時書き込み"). Each markdown leaf owns its own independent CM6
  // fold state (standard Obsidian behavior, unrelated to this plugin), so
  // a fold/unfold performed in a BACKGROUND leaf of the same file is
  // intentionally never written to FoldStateManager or reflected in the
  // Outline Tree: with N independently-folded background leaves, there is
  // no principled way to pick one as "more correct" than the others, and
  // persisting whichever one's CM6 update event happened to fire would
  // make the stored state timing-dependent rather than tied to deliberate
  // user attention (the pane they are actually looking at). This never
  // records a WRONG state — it simply narrows "what gets captured" to the
  // pane the user is currently working in, which will itself set the
  // correct state going forward the next time it's folded there.
  const activeView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
  if (!activeView || activeView.leaf !== owning.leaf) return;

  // CM6's Text.lineAt/.line are 1-indexed; this codebase's line numbers
  // are 0-indexed throughout — same conversion syncFoldToBodyEditor and
  // scrollLineToTop already do, just in reverse here.
  const fromLineOneIndexed = update.state.doc.lineAt(range.from).number;
  const zeroIndexedLine = fromLineOneIndexed - 1;

  // Parsed independently from update.state.doc (the CM6 state already in
  // hand) rather than via this.currentDoc of any particular OutlineTreeView
  // instance — this function is a free function precisely because it must
  // not assume any specific view's cache is fresh relative to the CM6
  // transaction that just happened.
  const parsed = parseDocument(update.state.doc.toString());
  const tree = buildOutlineTree(parsed, { includeLists: true });
  const nodeId = findNodeIdAtStartLine(tree, zeroIndexedLine);
  if (!nodeId) return;

  const identity = buildNodeIdentityMap(tree).get(nodeId);
  if (!identity) return;

  plugin.foldStateManager.setNodeCollapsed(owning.file.path, identity, collapsed);
  plugin.refreshOutlineTreeViews();
}

/**
 * The extension itself — registered once via plugin.registerEditorExtension
 * in main.ts's onload(), applying to every CM6 editor instance Obsidian
 * creates. Filters down to transactions carrying a fold/unfold effect that
 * did NOT originate from this plugin's own Tree -> CM6 sync
 * (outlineTreeFoldOrigin), then hands each one to handleCm6FoldEffect.
 * EditorView.updateListener (not registerEditorExtension's own polling, or
 * any Workspace event) is used because real-device investigation confirmed
 * "editor-change" never fires for a fold-only transaction (docChanged:
 * false).
 */
export function createCm6FoldSyncExtension(plugin: UnifiedOutlinerPlugin): Extension {
  return EditorView.updateListener.of((update: ViewUpdate) => {
    for (const tr of update.transactions) {
      if (tr.annotation(outlineTreeFoldOrigin)) continue;
      for (const effect of tr.effects) {
        if (effect.is(foldEffect)) {
          handleCm6FoldEffect(plugin, update, effect.value, true);
        } else if (effect.is(unfoldEffect)) {
          handleCm6FoldEffect(plugin, update, effect.value, false);
        }
      }
    }
  });
}
