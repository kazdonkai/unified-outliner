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
  collectReadOnlyOutlineNodeIds,
  headingPrefixText,
  isOutlineCompositeNode,
  isOutlineComplexMemberNode,
  isOutlineListNode,
  isOutlineSectionNode,
  listItemDisplayText,
  OutlineTreeNode,
} from "../tree/buildOutlineTree";
import { scanComplexBlocks } from "../parser/complexBlocks";
import { matchCompositeBlocks } from "../parser/compositeBlocks";
import { getEnabledCompositeBlockRules } from "../settingsDefaults";
import { resolveHighlightedNodeId } from "../tree/resolveHighlightedSectionId";
import {
  buildNodeByIdMap,
  buildParentIdMap,
  flattenVisibleOutlineTree,
  nextVisibleId,
  prevVisibleId,
  shouldFollowKeyboardSelectionIntoBody,
} from "../tree/outlineNavigation";
import { buildNodeIdentityMap, findNodeIdAtStartLine } from "../tree/foldIdentity";
import {
  exceedsLongPressMoveThreshold,
  LONG_PRESS_DURATION_MS,
} from "../tree/longPressGesture";
import { findMoveTarget } from "../move/findMoveTarget";
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
import { applyLineEditOutcome, LineEditOutcome } from "../commands/applyLineEditOutcome";
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

  // Phase 3A drag & drop state. All UI-only — the pure decision of where
  // a drop is even legal lives in move/relocateSection.ts's canDropOn, not
  // here; this view only tracks which element is mid-drag and which
  // element currently shows a drop indicator so it can clean both up
  // reliably (dragend always fires, even when a drop is cancelled).
  private dragSourceId: string | null = null;
  private draggingItemEl: HTMLElement | null = null;
  private dropIndicatorEl: HTMLElement | null = null;

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
   * Inline rename state (section/list only — see edit/renameBlock.ts).
   * Non-null exactly while a row's label is replaced with a <textarea>.
   * `snapshot` is whichever of SectionRenameSnapshot/ListRenameSnapshot
   * matches `kind`, captured fresh when the rename began — never the
   * possibly-stale this.currentDoc — and re-verified against a FRESH
   * re-parse at commit time (see commitRename). While this is set,
   * refresh() bails out immediately (see its own guard) so an unrelated
   * debounced editor-change/active-leaf-change/keyup/mouseup refresh never
   * tears down the input mid-edit; only this view's own commitRename /
   * cancelRename ever clear it and re-render.
   */
  private renameState: {
    nodeId: string;
    kind: "section" | "list";
    inputEl: HTMLTextAreaElement;
    rowSelfEl: HTMLElement;
    snapshot: SectionRenameSnapshot | ListRenameSnapshot;
  } | null = null;

  /**
   * Move target preview (2026-08-11 ticket §5B). Queued by main.ts's
   * queueOutlineTreeMoveFlash right after a successful Move block/Move
   * section, consumed (and cleared) the NEXT time refresh() re-renders —
   * see applyPendingMoveFlash's own doc comment for why matching happens by
   * line/id hint rather than by a node id captured before the move (ids
   * shift across a re-parse whenever document order changes, which a
   * successful move always does for the swapped pair).
   */
  private pendingMoveFlash: { line?: number; nodeIdHint?: string } | null = null;

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
      this.nodeById = new Map();
      this.parentIdById = new Map();
      this.readOnlyNodeIds = new Set();
      this.currentFilePath = null;
      this.nodeIdentityById = new Map();
      this.collapsedIds = new Set();
      this.renderEmptyState("No active Markdown note.");
      return;
    }

    const includeLists = this.plugin.settings.showListItemsInOutline;
    const text = view.editor.getValue();
    const doc: ParsedDocument = parseDocument(text);
    this.currentDoc = doc;

    // Phase 5D-0.3: CompositeBlock projection (see buildOutlineTree.ts's
    // BuildOutlineTreeOptions.composites doc comment). Each rule's own
    // `enabled` flag is the ONLY switch for composite projection (approval
    // §4 — no separate showCompositeBlocksInOutline toggle), so when every
    // rule is disabled this skips scanComplexBlocks/matchCompositeBlocks
    // entirely rather than paying their cost on every refresh for users who
    // don't use the feature at all.
    const enabledRules = getEnabledCompositeBlockRules(this.plugin.settings.compositeBlocks);
    const composites =
      enabledRules.length > 0
        ? (() => {
            const complexScan = scanComplexBlocks(doc);
            const infos = matchCompositeBlocks(doc, complexScan, enabledRules);
            const complexBlocksById = new Map(complexScan.blocks.map((b) => [b.id, b]));
            return { infos, complexBlocksById, rules: enabledRules };
          })()
        : undefined;

    this.currentTree = buildOutlineTree(doc, {
      includeLists,
      composites,
      t: (key, vars) => this.plugin.t(key, vars),
    });
    this.nodeById = buildNodeByIdMap(this.currentTree);
    this.parentIdById = buildParentIdMap(this.currentTree);
    this.readOnlyNodeIds = collectReadOnlyOutlineNodeIds(this.currentTree);

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
    this.highlightedId = resolveHighlightedNodeId(doc, cursorLine, { includeLists });

    // Keep an already-valid keyboard selection exactly where it is (see
    // ensureSelection's doc comment) — this refresh may have been triggered
    // by something entirely unrelated to sidebar navigation (a debounced
    // editor-change, an unrelated keyup elsewhere), and must not silently
    // reset the user's place in the tree.
    this.ensureSelection();

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
   * queueOutlineTreeMoveFlash) against the tree that renderTree() JUST
   * rebuilt, and — if a match is found — adds a transient CSS class to that
   * row's DOM element for ~900ms (styles.css's
   * .unified-outliner-move-flash / @keyframes). Matching by `line` (not by
   * a node id captured before the move) is deliberate: section/list ids are
   * only stable within a single parseDocument() pass (see
   * parser/parseDocument.ts's `sec-N`/`li-N` counters), and a successful
   * move always changes document order for the swapped pair, so an id
   * captured pre-move would not exist in the post-move tree at all.
   * `nodeIdHint` (used for paragraph/complex-block moves, whose enclosing
   * section's own heading line does not move) is a plain id lookup instead,
   * since that id's identity IS stable across the move.
   */
  private applyPendingMoveFlash(): void {
    const pending = this.pendingMoveFlash;
    this.pendingMoveFlash = null;
    if (!pending) return;

    const visible = flattenVisibleOutlineTree(this.currentTree, this.collapsedIds);
    const match =
      pending.line !== undefined
        ? visible.find((n) => n.line === pending.line)
        : pending.nodeIdHint !== undefined
          ? visible.find((n) => n.id === pending.nodeIdHint)
          : undefined;
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
  queueMoveFlash(target: { line?: number; nodeIdHint?: string }): void {
    this.pendingMoveFlash = target;
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
    // Nothing below the node's own first line to fold (e.g. a heading with
    // an empty body and no children reachable this way in practice, since
    // callers only ever invoke this for nodes that have children — see the
    // call sites' own hasChildren/children.length guards — but checked
    // defensively here too rather than relying on that).
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
    if (hasChildren) {
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
    if (isSelected) {
      this.treeRootEl.setAttribute("aria-activedescendant", selfEl.id);
    }

    const collapseEl = selfEl.createDiv({
      cls:
        "tree-item-icon collapse-icon" +
        (hasChildren ? "" : " unified-outliner-collapse-spacer") +
        (isCollapsed ? " is-collapsed" : ""),
    });
    if (hasChildren) {
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
    // recognizer target. null for a readOnly row (composite/complex-member
    // — never a drag source, Phase 5D-0.3 approval §1), matching the
    // existing `if (!readOnly)` gate around the drag listeners further
    // down.
    let dragHandleEl: HTMLElement | null = null;
    if (!readOnly) {
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
      selfEl.addEventListener("dblclick", (evt) => {
        if (collapseEl.contains(evt.target as Node)) return;
        evt.stopPropagation();
        // Re-resolves the row's CURRENT DOM elements fresh by nodeId (see
        // beginRenameForNode's own doc comment) rather than closing over
        // selfEl/innerEl from this render pass directly: a dblclick's two
        // constituent clicks each already run this row's own "click" handler
        // below (jumpToLine / mobile tap logic), which can itself trigger a
        // re-render before "dblclick" is dispatched, leaving any closed-over
        // reference pointing at an already-detached previous render pass.
        this.beginRenameForNode(node.id);
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
      const displayText =
        node.text.length > 0 ? node.text : this.plugin.t("tree.emptyListItem");
      innerEl.setText(displayText);
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
      const innerEl = selfEl.createDiv({
        cls: "tree-item-inner unified-outliner-complex-member-text",
      });
      innerEl.setText(node.label);
    }

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
   * If selectedId is null, or no longer among the currently VISIBLE nodes
   * (e.g. its ancestor just got collapsed, or the underlying doc changed
   * enough to shift ids — see the currentDoc field's doc comment on id
   * stability), fall back to the cursor-synced node (if it's visible) or
   * else the first visible node. A no-op otherwise — this is deliberately
   * NOT "always sync selectedId to highlightedId", so an in-progress
   * keyboard navigation survives refreshes triggered by unrelated events
   * (see refresh()'s call site).
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
   * No-op on a leaf node (nothing to expand or step into).
   */
  private expandSelectionOrGoToFirstChild(): void {
    this.ensureSelection();
    if (!this.selectedId) return;
    const node = this.nodeById.get(this.selectedId);
    if (!node || node.children.length === 0) return;
    if (this.collapsedIds.has(node.id)) {
      this.setNodeCollapsed(node.id, false);
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
   * in place, or (already collapsed, or a leaf) step selection out to its
   * parent. No-op at the root of the tree.
   */
  private collapseSelectionOrGoToParent(): void {
    this.ensureSelection();
    if (!this.selectedId) return;
    const node = this.nodeById.get(this.selectedId);
    if (!node) return;
    if (node.children.length > 0 && !this.collapsedIds.has(node.id)) {
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
      case "F2":
        // Auxiliary rename trigger (see "---- Inline rename" section) — the
        // primary trigger is a row's own dblclick; F2 operates on whatever
        // is currently selected, matching standard tree/list-widget rename
        // conventions (Explorer, VS Code, etc.).
        evt.preventDefault();
        evt.stopPropagation();
        if (this.selectedId) this.beginRenameForNode(this.selectedId);
        break;
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
  private dispatchAndApply(
    sectionId: string,
    dispatch: (doc: ParsedDocument) => LineEditOutcome
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
    this.dispatchAndApply(nodeId, (doc) => deleteBlock(doc, nodeId));
  }

  private runInsertSiblingListItemCommand(afterListItemId: string): void {
    const changed = this.dispatchAndApply(afterListItemId, (doc) =>
      insertSiblingListItem(doc, afterListItemId, {
        normalizeOrderedLists: this.plugin.settings.normalizeOrderedLists,
      })
    );
    if (changed) this.autoRenameAfterInsert();
  }

  private runInsertChildListItemCommand(parentListItemId: string): void {
    const changed = this.dispatchAndApply(parentListItemId, (doc) =>
      insertChildListItem(doc, parentListItemId, {
        normalizeOrderedLists: this.plugin.settings.normalizeOrderedLists,
      })
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
      const changed = this.dispatchAndApply(afterSectionId, (doc) =>
        insertSiblingSection(doc, afterSectionId, level)
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
   * beginRenameForNode (F2 / context menu / auto-rename-after-insert)
   * re-locates them by the row's stable `unified-outliner-row-<id>` DOM id
   * first, then delegates here.
   */
  private beginRename(
    nodeId: string,
    kind: "section" | "list",
    innerEl: HTMLElement,
    rowSelfEl: HTMLElement
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

    let initialText: string;
    let snapshot: SectionRenameSnapshot | ListRenameSnapshot;
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
        evt.preventDefault();
        this.commitRename();
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

    this.renameState = { nodeId, kind, inputEl, rowSelfEl, snapshot };
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
   * the original text) also comes back as `changed === false` here — via
   * applyLineEditOutcome's own no-op guard, since renameSection/
   * renameListItem always report `changed: true` regardless of whether the
   * text actually differs — but the blur handler above intercepts that
   * exact case before ever calling commitRename() (comparing inputEl.value
   * against the initialText it captured at open time) and calls
   * cancelRename() instead, so the input still gets torn down cleanly for
   * the common "opened it, didn't touch anything, clicked away" case.
   * Reaching this function with a true no-op is only possible via Enter
   * (that path has no such pre-check), and simply leaves the box open with
   * silently no-op'd text, matching every other rejection above.
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
   */
  private commitRename(): void {
    const state = this.renameState;
    if (!state) return;

    const view = this.activeMarkdownView.get();
    if (!view) {
      this.notify(this.plugin.t("reason.no-active-editor"));
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
        : renameListItem(doc, state.nodeId, state.snapshot as ListRenameSnapshot, rawValue);

    const changed = applyLineEditOutcome(
      editor,
      { line: 0, ch: 0 },
      0,
      doc.lines,
      outcome,
      () => this.notify(this.reasonText(outcome.reason))
    );

    if (!changed) return;

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
    this.renameState.rowSelfEl.setAttribute("draggable", "true");
    this.renameState = null;
    this.renderTree();
  }

  // ---- Phase 3A: drag & drop ------------------------------------------

  private handleDragStart(evt: DragEvent, sectionId: string, itemEl: HTMLElement): void {
    this.dragSourceId = sectionId;
    this.draggingItemEl = itemEl;
    itemEl.addClass("unified-outliner-dragging");
    if (evt.dataTransfer) {
      // Required by the HTML5 DnD spec for the drag to be recognized by
      // some browsers/Electron builds; the actual move is driven entirely
      // by this.dragSourceId, not by reading this data back out.
      evt.dataTransfer.setData("text/plain", sectionId);
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
