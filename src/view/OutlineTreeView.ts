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
import { BlockNode, isListNode, ParsedDocument } from "../model/block";
import {
  buildOutlineTree,
  isOutlineListNode,
  isOutlineSectionNode,
  OutlineTreeNode,
} from "../tree/buildOutlineTree";
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
import { findMoveTarget } from "../move/findMoveTarget";
import { findIndentTarget } from "../move/findIndentTarget";
import { findNodeOnlyMoveTarget } from "../move/findNodeOnlyMoveTarget";
import { findNodeOnlyLevelTarget } from "../level/findNodeOnlyLevelTarget";
import {
  runTreeBlockCommand,
  TreeBlockCommandOptions,
} from "../tree/treeBlockCommand";
import { runTreeNodeOnlyCommand } from "../tree/treeNodeOnlyCommand";
import { runTreeContextualCommand } from "../tree/treeContextualCommand";
import { TreeStructureOperation } from "../tree/treeOperation";
import { canDropOn, DropMode, relocateSection } from "../move/relocateSection";
import { canDropListOn, relocateListSubtree } from "../move/relocateListSubtree";
import { extractListItemBodyText } from "../edit/listBodyRange";
import {
  applyLineEditOutcome,
  LineEditOutcome,
  NOOP_MESSAGES,
} from "../commands/applyLineEditOutcome";

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

  // Phase 3A drag & drop state. All UI-only — the pure decision of where
  // a drop is even legal lives in move/relocateSection.ts's canDropOn, not
  // here; this view only tracks which element is mid-drag and which
  // element currently shows a drop indicator so it can clean both up
  // reliably (dragend always fires, even when a drop is cancelled).
  private dragSourceId: string | null = null;
  private draggingItemEl: HTMLElement | null = null;
  private dropIndicatorEl: HTMLElement | null = null;

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
    return "Unified Outliner: Outline";
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
    this.treeRootEl.setAttribute("aria-label", "Unified Outliner: Outline");
    this.registerDomEvent(this.treeRootEl, "keydown", this.handleTreeKeyDown);
    this.registerDomEvent(this.treeRootEl, "focus", () => {
      this.hasFocus = true;
      this.ensureSelection();
      this.renderTree();
    });
    this.registerDomEvent(this.treeRootEl, "blur", () => {
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
    const view = this.activeMarkdownView.get();
    if (!view) {
      this.currentDoc = null;
      this.currentTree = [];
      this.highlightedId = null;
      this.selectedId = null;
      this.nodeById = new Map();
      this.parentIdById = new Map();
      this.currentFilePath = null;
      this.nodeIdentityById = new Map();
      this.collapsedIds = new Set();
      this.renderEmptyState("アクティブな Markdown ノートがありません。");
      return;
    }

    const includeLists = this.plugin.settings.showListItemsInOutline;
    const text = view.editor.getValue();
    const doc: ParsedDocument = parseDocument(text);
    this.currentDoc = doc;
    this.currentTree = buildOutlineTree(doc, { includeLists });
    this.nodeById = buildNodeByIdMap(this.currentTree);
    this.parentIdById = buildParentIdMap(this.currentTree);

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

    this.renderTree();
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
    // fold sync. This is the single place setNodeCollapsed is ever called
    // from (toggleCollapse's chevron click, and the keyboard Left/Right
    // handlers below), so no other call site needs its own sync call.
    this.syncFoldToBodyEditor(nodeId, collapsed);
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
   *    design report; not implemented here).
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

    const cm = (view.editor as unknown as { cm?: EditorView }).cm;
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
        ? "このノートには見出しも list 項目もありません。"
        : "このノートには見出しがありません。";
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
    selfEl.setAttribute("role", "treeitem");
    selfEl.setAttribute("aria-selected", isSelected ? "true" : "false");
    if (hasChildren) {
      selfEl.setAttribute("aria-expanded", isCollapsed ? "false" : "true");
    }
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

    if (isOutlineSectionNode(node)) {
      const innerEl = selfEl.createDiv({
        cls: `tree-item-inner unified-outliner-level-${node.headingLevel}`,
      });
      innerEl.setText(node.headingText.length > 0 ? node.headingText : "(無題の見出し)");
    } else if (isOutlineListNode(node)) {
      const innerEl = selfEl.createDiv({
        cls: "tree-item-inner unified-outliner-list-text",
      });
      const displayText = node.text.length > 0 ? node.text : "(空の list 項目)";
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
    }

    selfEl.addEventListener("click", () => {
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
    if (isOutlineSectionNode(node)) {
      selfEl.addEventListener("contextmenu", (evt) => {
        evt.preventDefault();
        this.showStructureCommandMenu(evt, node.id);
      });
    } else if (isOutlineListNode(node)) {
      selfEl.addEventListener("contextmenu", (evt) => {
        evt.preventDefault();
        this.showListCommandMenu(evt, node.id);
      });
    }

    // Phase 3A (section) / Phase 4A (list): drag & drop. Both node kinds
    // share this exact same attribute + handler wiring — only the pure
    // resolve/relocate calls inside handleDragOver/handleDrop/
    // runRelocateCommand below branch on the DRAGGED node's kind.
    selfEl.setAttribute("draggable", "true");
    selfEl.addEventListener("dragstart", (evt) =>
      this.handleDragStart(evt, node.id, itemEl)
    );
    selfEl.addEventListener("dragover", (evt) => this.handleDragOver(evt, node.id, selfEl));
    selfEl.addEventListener("dragleave", () => this.handleDragLeave(selfEl));
    selfEl.addEventListener("drop", (evt) => this.handleDrop(evt, node.id, selfEl));
    selfEl.addEventListener("dragend", () => this.handleDragEnd());

    if (hasChildren && !isCollapsed) {
      const childrenEl = itemEl.createDiv({ cls: "tree-item-children" });
      childrenEl.setAttribute("role", "group");
      for (const child of node.children) {
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
   */
  private scrollSelectedIntoView(): void {
    const targetId = this.selectedId;
    if (!targetId) return;
    requestAnimationFrame(() => {
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
    const cm = (editor as unknown as { cm?: EditorView }).cm;
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
  private static readonly UNAVAILABLE_SUFFIX = " — unavailable";

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
    const doc = this.currentDoc;
    const node = doc?.nodes.get(sectionId);
    if (!doc || !node) return;

    const options: TreeBlockCommandOptions = {
      allowCrossSectionListMove: this.plugin.settings.allowCrossSectionListMove,
      normalizeOrderedLists: this.plugin.settings.normalizeOrderedLists,
    };
    const isCollapsed = this.collapsedIds.has(sectionId);
    const contextualMode: "block" | "node-only" = isCollapsed ? "block" : "node-only";
    const contextualModeLabel = isCollapsed ? "subtree" : "node-only";

    const menu = new Menu();

    const addMenuItem = (
      title: string,
      icon: string,
      feasible: boolean,
      onClick: () => void
    ) => {
      menu.addItem((item) =>
        item
          .setTitle(feasible ? title : `${title}${OutlineTreeView.UNAVAILABLE_SUFFIX}`)
          .setIcon(feasible ? icon : OutlineTreeView.UNAVAILABLE_ICON)
          .setDisabled(!feasible)
          .setWarning(!feasible)
          .onClick(onClick)
      );
    };

    const addContextualItem = (
      title: string,
      icon: string,
      operation: TreeStructureOperation
    ) => {
      addMenuItem(
        `${title} (contextual: ${contextualModeLabel})`,
        icon,
        this.canRunInMode(doc, node, operation, contextualMode, options),
        () => this.runContextualCommand(sectionId, operation)
      );
    };
    addContextualItem("Move up", "arrow-up", "move-up");
    addContextualItem("Move down", "arrow-down", "move-down");
    menu.addSeparator();
    addContextualItem("Indent", "indent", "indent");
    addContextualItem("Outdent", "outdent", "outdent");
    menu.addSeparator();

    const addExplicitBlockItem = (
      title: string,
      icon: string,
      operation: TreeStructureOperation
    ) => {
      addMenuItem(
        title,
        icon,
        this.canRunInMode(doc, node, operation, "block", options),
        () => this.runBlockCommand(sectionId, operation)
      );
    };
    addExplicitBlockItem("Move subtree up", "arrow-up", "move-up");
    addExplicitBlockItem("Move subtree down", "arrow-down", "move-down");
    menu.addSeparator();
    addExplicitBlockItem("Indent subtree", "indent", "indent");
    addExplicitBlockItem("Outdent subtree", "outdent", "outdent");
    menu.addSeparator();

    // Phase 3B: opens (or reuses, per main.ts's "one pane, not many"
    // policy) the Partial Edit Pane loaded with this section. A distinct
    // kind of action from the move/indent/outdent items above — it opens
    // another view rather than editing in place — so it's kept in its own
    // section at the bottom of the menu.
    menu.addItem((item) =>
      item
        .setTitle("Open partial edit pane")
        .setIcon("edit-3")
        .onClick(() => this.plugin.activatePartialEditView(sectionId))
    );

    menu.showAtMouseEvent(evt);
  }

  /**
   * Phase 4C: list nodes' own, minimal right-click menu — just the
   * Partial Edit Pane entry point, reusing the exact same
   * activatePartialEditView plumbing section nodes already use via
   * showStructureCommandMenu (it doesn't care about node kind — see
   * main.ts). Deliberately NOT the full move/indent/outdent/contextual
   * menu sections get; that stays section-only (see the contextmenu
   * wiring comment in renderNode above).
   *
   * Mirrors showStructureCommandMenu's own "check feasibility, then flag
   * an infeasible item rather than letting it silently no-op after the
   * click" pattern: a list item with unsafeIndent (mixed tab/space
   * indentation) is refused by extractSubtreeText/applySubtreeEdit
   * (edit/partialEdit.ts) regardless, but disabling the menu item up
   * front — same UNAVAILABLE_ICON / UNAVAILABLE_SUFFIX / setWarning
   * treatment as every other infeasible item in this view — tells the
   * user why before they click, rather than after.
   */
  private showListCommandMenu(evt: MouseEvent, listId: string): void {
    const doc = this.currentDoc;
    const node = doc?.nodes.get(listId);
    if (!doc || !node) return;

    const feasible = !(isListNode(node) && node.unsafeIndent);

    const menu = new Menu();
    menu.addItem((item) =>
      item
        .setTitle(
          feasible
            ? "Edit list subtree in pane"
            : `Edit list subtree in pane${OutlineTreeView.UNAVAILABLE_SUFFIX}`
        )
        .setIcon(feasible ? "edit-3" : OutlineTreeView.UNAVAILABLE_ICON)
        .setDisabled(!feasible)
        .setWarning(!feasible)
        .onClick(() => this.plugin.activatePartialEditView(listId))
    );
    menu.showAtMouseEvent(evt);
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
  ): void {
    const view = this.activeMarkdownView.get();
    if (!view) return;
    const editor: Editor = view.editor;

    if (editor.listSelections().length > 1) {
      this.notify("Unified Outliner: multiple cursors are not supported.");
      return;
    }

    const doc = parseDocument(editor.getValue());
    const node = doc.nodes.get(sectionId);
    if (!node) {
      this.notify(NOOP_MESSAGES["resolve-failed"]);
      return;
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
      (m) => this.notify(m)
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
  }

  private notify(message: string | undefined): void {
    if (this.plugin.settings.showNoopNotices && message) new Notice(message);
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
    const cm = (view.editor as unknown as { cm?: EditorView }).cm;
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
