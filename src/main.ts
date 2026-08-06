import { Editor, Notice, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import { parseDocument } from "./parser/parseDocument";
import { resolveCurrentBlock } from "./resolver/resolveCurrentBlock";
import { MoveDirection } from "./move/findMoveTarget";
import { moveBlock } from "./move/moveBlock";
import { moveNodeOnly } from "./move/moveNodeOnly";
import { indentBlock } from "./move/indentBlock";
import { IndentDirection } from "./level/direction";
import { setNodeOnlyLevel } from "./level/setNodeOnlyLevel";
import {
  createCm6FoldSyncExtension,
  OUTLINE_TREE_VIEW_TYPE,
  OutlineTreeView,
} from "./view/OutlineTreeView";
import { PARTIAL_EDIT_VIEW_TYPE, PartialEditView } from "./view/PartialEditView";
import { ActiveMarkdownViewTracker } from "./view/activeMarkdownViewTracker";
import { FoldStateManager } from "./persistence/foldStateManager";
import {
  applyLineEditOutcome,
  NOOP_MESSAGES,
} from "./commands/applyLineEditOutcome";
import {
  DEFAULT_SETTINGS,
  UnifiedOutlinerSettings,
  UnifiedOutlinerSettingTab,
} from "./settings";
import { mergeSettings } from "./settingsDefaults";

export default class UnifiedOutlinerPlugin extends Plugin {
  settings: UnifiedOutlinerSettings = { ...DEFAULT_SETTINGS };

  /**
   * Single, plugin-owned ActiveMarkdownViewTracker shared by every view
   * this plugin registers (OutlineTreeView, PartialEditView). This is
   * deliberately ONE instance, not one-per-view: a freshly constructed
   * tracker starts with no cached view, and both OutlineTreeView and
   * PartialEditView reveal their own sidebar leaf as part of opening,
   * which shifts `workspace.getActiveViewOfType(MarkdownView)` to null
   * (the active leaf is now the panel, not the note) before the view gets
   * a chance to call .get(). A tracker that's already been "warmed up" by
   * OutlineTreeView's continuous refresh cycle (or by this class's own
   * warm-up call in activatePartialEditView, below) still has the correct
   * cached view at that point, so sharing one instance is what makes
   * opening the Partial Edit Pane from the tree's context menu actually
   * load a section instead of silently landing on the empty state.
   */
  readonly activeMarkdownView = new ActiveMarkdownViewTracker(this.app);

  /**
   * Phase 4E: single, plugin-owned store for Outline Tree View fold state,
   * shared by every OutlineTreeView leaf — see
   * persistence/foldStateManager.ts's class doc comment for why one
   * shared instance (not one per view) is correct here, mirroring
   * activeMarkdownView above. Persisted in the SAME data.json as
   * `settings` (see persistData/loadSettings below), not a separate file.
   */
  readonly foldStateManager = new FoldStateManager(this);

  async onload(): Promise<void> {
    await this.loadSettings();

    // Block-scoped: for a heading, moves the whole section subtree (heading
    // + body + child sections + lists) past the adjacent sibling section.
    // For a list item, moves its subtree past the adjacent sibling (with
    // the existing cross-section hop for root items — section-subtree movement, unchanged
    // by this task). Command ids are unchanged from the original MVP
    // move-block-up/down, so existing hotkeys keep working; see README for
    // the node-only vs block-scoped naming note.
    this.addCommand({
      id: "move-block-up",
      name: "Move block up (section / list subtree)",
      editorCallback: (editor) => this.moveCurrentBlock(editor, "up"),
    });

    this.addCommand({
      id: "move-block-down",
      name: "Move block down (section / list subtree)",
      editorCallback: (editor) => this.moveCurrentBlock(editor, "down"),
    });

    // Node-only: swaps just the current heading LINE's text with the
    // previous/next heading line in whole-document order, ignoring level
    // and subtree structure entirely. The body/children physically stay
    // put — only the heading label moves. See docs §5–6 and the README's
    // node-only vs block-scoped move note (advanced operation).
    this.addCommand({
      id: "move-node-only-up",
      name: "Move heading label up (current line only)",
      editorCallback: (editor) => this.moveCurrentNodeOnly(editor, "up"),
    });

    this.addCommand({
      id: "move-node-only-down",
      name: "Move heading label down (current line only)",
      editorCallback: (editor) => this.moveCurrentNodeOnly(editor, "down"),
    });

    // Block-scoped: reindents/reparents a whole list subtree, or changes a
    // heading's level under the section-safety checks in
    // move/findIndentTarget.ts (no subsections, needs a previous sibling to
    // indent, etc.). See docs/別ペイン実装計画と当面の実装指示.md §6.2.
    this.addCommand({
      id: "indent-block",
      name: "Indent block (list subtree / safe-scope heading)",
      editorCallback: (editor) => this.indentCurrentBlock(editor, "indent"),
    });

    this.addCommand({
      id: "outdent-block",
      name: "Outdent block (list subtree / safe-scope heading)",
      editorCallback: (editor) => this.indentCurrentBlock(editor, "outdent"),
    });

    // Node-only: changes just the current heading line's level, ignoring
    // child sections / body / following blocks entirely. See docs §5.1,
    // §6.1. Command ids are new and additive — existing indent-block /
    // outdent-block ids and any hotkeys bound to them are unaffected.
    this.addCommand({
      id: "indent-node-only",
      name: "Indent heading level (current line only)",
      editorCallback: (editor) => this.changeNodeOnlyLevel(editor, "indent"),
    });

    this.addCommand({
      id: "outdent-node-only",
      name: "Outdent heading level (current line only)",
      editorCallback: (editor) => this.changeNodeOnlyLevel(editor, "outdent"),
    });

    // Phase 2A: Outline Tree View — a right-sidebar panel that visualizes
    // the active note's heading structure and stays in sync with the body
    // editor. See view/OutlineTreeView.ts and docs §3.1. This phase is
    // read-mostly (no move/indent/outdent from the tree yet — Phase 2B).
    this.registerView(
      OUTLINE_TREE_VIEW_TYPE,
      (leaf) => new OutlineTreeView(leaf, this)
    );

    // `void` here (and at the other addCommand callback below, and at
    // openPartialEditForCursor's call to activatePartialEditView) is a
    // deliberate marker, not a suppression: Obsidian's addRibbonIcon /
    // addCommand callback types don't await whatever they return, so
    // there is no caller to `await` this from — but activateOutlineTreeView
    // is still `async` (it awaits leaf.setViewState internally), so an
    // un-marked call here would be a floating Promise whose rejection
    // (if setViewState ever throws) goes unhandled. activateOutlineTreeView
    // itself now catches its own failures internally (see its try/catch
    // below) and reports them via Notice, so this call can never actually
    // reject in practice; `void` simply documents at the call site that
    // the returned Promise is intentionally not awaited, for readers and
    // for lint rules like no-floating-promises.
    this.addRibbonIcon("list-tree", "Open Unified Outliner outline", () => {
      void this.activateOutlineTreeView();
    });

    this.addCommand({
      id: "open-outline-tree-view",
      name: "Open outline tree view",
      callback: () => void this.activateOutlineTreeView(),
    });

    // Phase 3B: Partial Edit Pane — a focused, explicit-save editing view
    // for exactly one section subtree at a time. Normally opened from the
    // Outline Tree View's right-click menu (which already has a specific
    // sectionId to hand it); this command is the body-editor-side entry
    // point, resolving "current section" the same way every other
    // body-editor command resolves its target (resolveCurrentBlock). See
    // view/PartialEditView.ts.
    this.registerView(
      PARTIAL_EDIT_VIEW_TYPE,
      (leaf) => new PartialEditView(leaf, this)
    );

    // Deliberately no restart-cleanup logic here. An earlier version force-
    // detached any Partial Edit Pane leaf once the saved layout finished
    // loading, to avoid leaving a permanently empty pane behind after
    // restarting Obsidian — but that produced a visible flash (render, then
    // immediate removal) that can't be fully eliminated, since
    // onLayoutReady only fires after the leaf has already been drawn. It
    // also discarded the split's resized height every restart. Since the
    // pane already renders a clear, fully-disabled empty state when no
    // section is loaded (see PartialEditView.renderEmptyState) — the same
    // pattern Obsidian's own Backlinks/Outline core panels use for "no
    // target yet" — letting it simply persist like any other sidebar leaf
    // is both simpler and more consistent with standard Obsidian behavior.
    this.addCommand({
      id: "open-partial-edit-pane",
      name: "Open partial edit pane for current section",
      editorCallback: (editor) => this.openPartialEditForCursor(editor),
    });

    this.addSettingTab(new UnifiedOutlinerSettingTab(this.app, this));

    // Phase 4E: a rename (or move — Obsidian fires the same event for
    // both, `oldPath` is simply whatever the path used to be) must carry
    // that file's persisted fold state over to the new path, or it would
    // silently orphan under the old key forever. See
    // persistence/foldStateStore.ts's withFileRenamed — a no-op (no save
    // scheduled) if the renamed file had no fold-state entry to begin
    // with, or isn't a markdown file (nothing here would have an entry).
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (!(file instanceof TFile) || file.extension !== "md") return;
        this.foldStateManager.handleRename(oldPath, file.path);
      })
    );

    // Outline Tree View's colors/font-size are exposed to the Style
    // Settings community plugin (https://github.com/community-archive/
    // obsidian-style-settings) via the @settings block at the top of
    // styles.css. This event tells Style Settings (if installed) to
    // (re-)scan our CSS now, per that plugin's documented integration
    // step — harmless no-op if Style Settings isn't installed.
    this.app.workspace.trigger("parse-style-settings");

    // Phase 3D stage 3: CM6 -> Outline Tree fold sync (the reverse
    // direction of syncFoldToBodyEditor in view/OutlineTreeView.ts, Phase
    // 3D stage 1). registerEditorExtension is a Plugin-level API, so the
    // registration call has to live here, but the extension itself and
    // all of its resolution logic is defined in view/OutlineTreeView.ts
    // (createCm6FoldSyncExtension) — see that function's doc comment.
    this.registerEditorExtension(createCm6FoldSyncExtension(this));
  }

  onunload(): void {
    // Deliberately NOT calling detachLeavesOfType(OUTLINE_TREE_VIEW_TYPE) /
    // detachLeavesOfType(PARTIAL_EDIT_VIEW_TYPE) here anymore. Per the
    // Obsidian Community Plugins review guidance, detaching a plugin's own
    // leaves in onunload() resets them to their default location the next
    // time the plugin loads, even if the user had moved that leaf
    // elsewhere (a different sidebar, a split, a popout window) — because
    // the leaf itself is destroyed, so there is nothing left for onload()
    // to reconnect to; activateOutlineTreeView() / activatePartialEditView()
    // would then have no choice but to create a brand-new leaf in the
    // default right-sidebar location on next open.
    //
    // Leaving the leaves alone is safe: `registerView()` above already
    // registers its own unregister-on-unload cleanup via the Component
    // base class's `register()` (see Obsidian's Plugin/Component API —
    // "Registers a callback to be called when unloading"), so the view
    // TYPE is still correctly unregistered when this plugin unloads;
    // nothing here needs to duplicate that. The leaf itself simply keeps
    // showing whatever it last rendered while the plugin is disabled
    // (the same "persist like any other sidebar leaf" approach this file
    // already uses for the Partial Edit Pane — see the onLayoutReady note
    // above). When the plugin is re-enabled (or Obsidian reloads it), the
    // same view type is registered again and Obsidian reconstructs a
    // fresh view for that SAME leaf in its SAME position via the
    // registered view factory — the leaf was never destroyed, so there is
    // nothing to duplicate. activateOutlineTreeView() and
    // activatePartialEditView() also each reuse an existing leaf of their
    // view type (see their `existing.length > 0` checks) rather than
    // creating a new one, so re-opening the panel manually after a
    // disable/enable cycle can't produce a duplicate leaf either.
    //
    // Phase 4E: best-effort flush of any fold-state mutation still sitting
    // inside the debounce window (e.g. the user toggled a fold right
    // before disabling the plugin / quitting Obsidian). onunload() is
    // synchronous per Obsidian's API, so this can't be awaited here — a
    // fire-and-forget call is the most this hook can do, same caveat as
    // any plugin's onunload persistence. Each OutlineTreeView.onClose()
    // also flushes (see that class) for the more common case of closing
    // just the tab rather than the whole plugin/app; this call is the
    // only flush attempt left for the plugin-disable path now that this
    // hook no longer detaches (and therefore no longer closes) those
    // leaves itself.
    void this.foldStateManager.flush();
  }

  /**
   * Phase 3C: re-render every open Outline Tree View immediately. Used by
   * the settings tab when showListItemsInOutline is toggled, since that
   * setting changes what buildOutlineTree() produces and the tree
   * otherwise only re-parses on the next debounced refresh (cursor
   * move / edit / tab switch) — without this, toggling the setting would
   * appear to do nothing until the user happened to trigger a refresh some
   * other way.
   */
  refreshOutlineTreeViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(OUTLINE_TREE_VIEW_TYPE)) {
      if (leaf.view instanceof OutlineTreeView) leaf.view.refresh();
    }
  }

  /**
   * Phase 4F: same as refreshOutlineTreeViews() above, but skips `except`
   * itself. Every OutlineTreeView instance tracks the SAME globally shared
   * "active markdown view" (via this.activeMarkdownView — see that field's
   * doc comment), so if more than one Outline Tree View leaf happens to be
   * open at once (a user manually splitting/duplicating the panel — this
   * plugin's own activateOutlineTreeView reuses a single leaf, but does not
   * prevent Obsidian's own "open in new window" / duplicate-leaf affordances
   * from creating a second one), they are always showing the SAME file's
   * tree, never two different files'.
   *
   * Used by OutlineTreeView.setNodeCollapsed (a Tree-origin fold write) to
   * propagate the change to any OTHER open Tree leaf, exactly mirroring
   * what handleCm6FoldEffect (view/OutlineTreeView.ts, CM6-origin writes)
   * already did via the plain refreshOutlineTreeViews() above — see
   * docs/fold-state-conflict-resolution-spec.md §2 for the full authoritative-
   * write-propagation policy this closes the last gap in. `except` is
   * deliberately left to finish its OWN render via its caller's existing
   * this.renderTree() call (toggleCollapse / the arrow-key handlers), so
   * the common single-Tree-leaf case gets no extra work out of this method
   * — it is a no-op loop when `except` is the only Tree leaf open.
   */
  refreshOtherOutlineTreeViews(except: OutlineTreeView): void {
    for (const leaf of this.app.workspace.getLeavesOfType(OUTLINE_TREE_VIEW_TYPE)) {
      if (leaf.view instanceof OutlineTreeView && leaf.view !== except) leaf.view.refresh();
    }
  }

  /**
   * Open the Outline Tree View in the right sidebar, reusing an existing
   * leaf of this view type if one is already open anywhere (per-workspace,
   * not per-window) rather than creating a duplicate. Creates a new leaf
   * in the right sidebar (`getRightLeaf(false)`) only when none exists.
   *
   * Both `setViewState` AND `workspace.revealLeaf` (also `Promise<void>`
   * per Obsidian's type definitions) are awaited inside try/catch, on
   * both the "reuse an existing leaf" and "create a new leaf" paths, so
   * this method itself never rejects: its two callers (the ribbon icon
   * and the "open-outline-tree-view" command, both above) are Obsidian UI
   * callbacks with nothing to `await` their Promise or catch a rejection
   * from — leaving either call un-awaited would risk an unhandled
   * rejection even though the caller never sees it via this method's own
   * return value. Reporting it via Notice (plus console.error for the
   * stack trace) matches how the "no right sidebar" case just above is
   * already surfaced to the user.
   */
  async activateOutlineTreeView(): Promise<void> {
    const { workspace } = this.app;

    const existing = workspace.getLeavesOfType(OUTLINE_TREE_VIEW_TYPE);
    if (existing.length > 0) {
      try {
        await workspace.revealLeaf(existing[0]);
      } catch (error) {
        console.error("Unified Outliner: failed to open the outline tree view.", error);
        new Notice("Unified Outliner: could not open the outline tree view.");
      }
      return;
    }

    const leaf: WorkspaceLeaf | null = workspace.getRightLeaf(false);
    if (!leaf) {
      new Notice("Unified Outliner: could not open the right sidebar.");
      return;
    }
    try {
      await leaf.setViewState({ type: OUTLINE_TREE_VIEW_TYPE, active: true });
      await workspace.revealLeaf(leaf);
    } catch (error) {
      console.error("Unified Outliner: failed to open the outline tree view.", error);
      new Notice("Unified Outliner: could not open the outline tree view.");
    }
  }

  /**
   * Open the Partial Edit Pane in the right sidebar, reusing an existing
   * leaf of this view type if one is already open (same "reuse, don't
   * multiply" policy as activateOutlineTreeView — task 5's explicit
   * requirement: "毎回新しい pane を量産しないでください"), then load
   * `nodeId` into it. `nodeId` may be a section OR (Phase 4C) a list item
   * id — activatePartialEditView itself doesn't care which, since
   * PartialEditView.loadNode resolves that generically. Called from
   * OutlineTreeView's "Open partial edit pane" / "Edit list subtree in
   * pane" menu items, and from openPartialEditForCursor below (section
   * only, via resolveCurrentBlock's body-editor resolution).
   *
   * Two real-device-reported fixes live here:
   *
   * 1. `this.activeMarkdownView.get()` is called BEFORE any leaf is
   *    created/revealed, to warm up the shared tracker while the active
   *    leaf is still the note itself. `workspace.revealLeaf(leaf)` below
   *    makes the new Partial Edit leaf the active leaf, which means
   *    `getActiveViewOfType(MarkdownView)` would return null from that
   *    point on — without this warm-up (or without the tracker already
   *    having been warmed up elsewhere, e.g. by OutlineTreeView), the
   *    pane would open into its permanent empty state, since it would
   *    have no cached view to fall back on either.
   * 2. `getRightLeaf(true)` (split) rather than `getRightLeaf(false)`
   *    (tab), so the pane opens as a genuine, independently resizable
   *    split stacked under whatever else is already in the right
   *    sidebar (typically the Outline Tree View), not as another tab in
   *    the same leaf — per explicit feedback that a shared tab made it
   *    impossible to see the tree and the edit pane at the same time.
   *
   * Like activateOutlineTreeView above, both `setViewState` (new-leaf path
   * only) and `workspace.revealLeaf` (also `Promise<void>` per Obsidian's
   * type definitions, common to both the existing-leaf and new-leaf
   * paths) are awaited inside try/catch, so this method never rejects:
   * its callers — openPartialEditForCursor below (an editorCallback) and
   * OutlineTreeView.ts's context-menu click handlers — don't await or
   * catch a rejection from it, so leaving either call un-awaited would
   * risk an unhandled rejection instead of the same user-facing Notice
   * every other failure path in this method already uses.
   */
  async activatePartialEditView(nodeId: string): Promise<void> {
    const { workspace } = this.app;

    this.activeMarkdownView.get();

    const existing = workspace.getLeavesOfType(PARTIAL_EDIT_VIEW_TYPE);
    let leaf: WorkspaceLeaf;
    if (existing.length > 0) {
      leaf = existing[0];
    } else {
      const newLeaf = workspace.getRightLeaf(true);
      if (!newLeaf) {
        new Notice("Unified Outliner: could not open the right sidebar.");
        return;
      }
      leaf = newLeaf;
      try {
        await leaf.setViewState({ type: PARTIAL_EDIT_VIEW_TYPE, active: true });
      } catch (error) {
        console.error("Unified Outliner: failed to open the partial edit pane.", error);
        new Notice("Unified Outliner: could not open the partial edit pane.");
        return;
      }
    }

    try {
      await workspace.revealLeaf(leaf);
    } catch (error) {
      console.error("Unified Outliner: failed to open the partial edit pane.", error);
      new Notice("Unified Outliner: could not open the partial edit pane.");
      return;
    }
    if (leaf.view instanceof PartialEditView) {
      leaf.view.loadNode(nodeId);
    }
  }

  /**
   * Body-editor-side entry point for the Partial Edit Pane: resolves
   * "current section" via the same resolveCurrentBlock every other
   * body-editor command uses, then hands its id to
   * activatePartialEditView. A cursor inside a list item (not a heading)
   * correctly no-ops, since the Partial Edit Pane only ever edits section
   * subtrees (see edit/partialEdit.ts).
   */
  private openPartialEditForCursor(editor: Editor): void {
    if (editor.listSelections().length > 1) {
      this.notice("Unified Outliner: multiple cursors are not supported.");
      return;
    }

    const doc = parseDocument(editor.getValue());
    const resolved = resolveCurrentBlock(doc, editor.getCursor().line);
    if (!resolved.node) {
      this.notice(NOOP_MESSAGES[resolved.reason ?? "no-block"]);
      return;
    }
    if (resolved.node.type !== "section") {
      this.notice(NOOP_MESSAGES["not-a-heading"]);
      return;
    }

    // See activatePartialEditView's doc comment: it now catches its own
    // failures internally and reports them via Notice, so this floating
    // call (editorCallback has nothing to await it from) can no longer
    // produce an unhandled rejection; `void` documents that at the call
    // site.
    void this.activatePartialEditView(resolved.node.id);
  }

  private moveCurrentBlock(editor: Editor, direction: MoveDirection): void {
    if (editor.listSelections().length > 1) {
      this.notice("Unified Outliner: multiple cursors are not supported.");
      return;
    }

    const cursor = editor.getCursor();
    const doc = parseDocument(editor.getValue());

    const resolved = resolveCurrentBlock(doc, cursor.line);
    if (!resolved.node) {
      this.notice(NOOP_MESSAGES[resolved.reason ?? "no-block"]);
      return;
    }

    const outcome = moveBlock(doc, resolved.node.id, direction, {
      allowCrossSectionListMove: this.settings.allowCrossSectionListMove,
      normalizeOrderedLists: this.settings.normalizeOrderedLists,
    });

    applyLineEditOutcome(
      editor,
      cursor,
      resolved.node.range.startLine,
      doc.lines,
      outcome,
      (m) => this.notice(m)
    );
  }

  /**
   * Node-only heading move (docs §5–6): swaps the current heading line's
   * text with the previous/next heading line in document order. Unlike
   * moveCurrentBlock, this never touches anything but those two lines —
   * bodies, child sections, and lists stay exactly where they physically
   * are. Resolution follows the same resolveCurrentBlock pattern as every
   * other command (cursor anywhere in the section resolves to it; cursor
   * in a list item resolves to that list item, which then correctly no-ops
   * via "not-a-heading" since this command is heading-only).
   */
  private moveCurrentNodeOnly(editor: Editor, direction: MoveDirection): void {
    if (editor.listSelections().length > 1) {
      this.notice("Unified Outliner: multiple cursors are not supported.");
      return;
    }

    const cursor = editor.getCursor();
    const doc = parseDocument(editor.getValue());

    const resolved = resolveCurrentBlock(doc, cursor.line);
    if (!resolved.node) {
      this.notice(NOOP_MESSAGES[resolved.reason ?? "no-block"]);
      return;
    }

    const outcome = moveNodeOnly(doc, resolved.node.id, direction);

    applyLineEditOutcome(
      editor,
      cursor,
      resolved.node.range.startLine,
      doc.lines,
      outcome,
      (m) => this.notice(m)
    );
  }

  private indentCurrentBlock(editor: Editor, direction: IndentDirection): void {
    if (editor.listSelections().length > 1) {
      this.notice("Unified Outliner: multiple cursors are not supported.");
      return;
    }

    const cursor = editor.getCursor();
    const doc = parseDocument(editor.getValue());

    const resolved = resolveCurrentBlock(doc, cursor.line);
    if (!resolved.node) {
      this.notice(NOOP_MESSAGES[resolved.reason ?? "no-block"]);
      return;
    }

    const outcome = indentBlock(doc, resolved.node.id, direction, {
      normalizeOrderedLists: this.settings.normalizeOrderedLists,
    });

    applyLineEditOutcome(
      editor,
      cursor,
      resolved.node.range.startLine,
      doc.lines,
      outcome,
      (m) => this.notice(m)
    );
  }

  /**
   * Node-only heading level change (docs §5.1). Deliberately reuses the
   * same resolveCurrentBlock resolution as every other command (cursor
   * anywhere in a section's own body resolves to that section — cursor
   * inside a nested list resolves to the list item instead, which this
   * command then correctly no-ops on via "not-a-heading", since node-only
   * level changes are heading-specific; list nesting stays a block-only
   * concept, see move/indentBlock.ts). This command never depends on fold
   * state, per docs §2.1/§2.2 — that stays reserved for the future outline
   * pane's contextual commands.
   */
  private changeNodeOnlyLevel(editor: Editor, direction: IndentDirection): void {
    if (editor.listSelections().length > 1) {
      this.notice("Unified Outliner: multiple cursors are not supported.");
      return;
    }

    const cursor = editor.getCursor();
    const doc = parseDocument(editor.getValue());

    const resolved = resolveCurrentBlock(doc, cursor.line);
    if (!resolved.node) {
      this.notice(NOOP_MESSAGES[resolved.reason ?? "no-block"]);
      return;
    }

    const outcome = setNodeOnlyLevel(doc, resolved.node.id, direction);

    applyLineEditOutcome(
      editor,
      cursor,
      resolved.node.range.startLine,
      doc.lines,
      outcome,
      (m) => this.notice(m)
    );
  }

  private notice(message: string | undefined): void {
    if (this.settings.showNoopNotices && message) new Notice(message);
  }

  /**
   * Loads the single data.json blob and splits it between `settings`
   * (flat top-level fields, unchanged shape/location since the MVP — see
   * settings.ts) and the Phase 4E `foldState` key (nested, handed to
   * foldStateManager.load() as-is; that method is responsible for
   * validating/defaulting it). Splitting `foldState` out BEFORE merging
   * into `settings` (via settingsDefaults.ts's mergeSettings, a pure
   * Object.assign-over-DEFAULT_SETTINGS helper — see its doc comment)
   * keeps it from leaking into the `UnifiedOutlinerSettings`-shaped
   * object as a stray extra property.
   */
  async loadSettings(): Promise<void> {
    const raw = ((await this.loadData()) ?? {}) as Record<string, unknown>;
    const { foldState, ...settingsRaw } = raw;
    this.settings = mergeSettings(settingsRaw);
    this.foldStateManager.load(foldState);
  }

  async saveSettings(): Promise<void> {
    await this.persistData();
  }

  /**
   * The single write path to data.json — always writes the FULL blob
   * (settings' flat fields + the nested `foldState` key), since
   * Obsidian's saveData() has no partial-update mode. Called by
   * saveSettings() (existing settings.ts toggles) and by
   * FoldStateManager.flush() (Phase 4E) — neither one is allowed to call
   * this.saveData() directly, or it would silently clobber whichever half
   * of the data the OTHER one owns with a stale in-memory copy.
   */
  async persistData(): Promise<void> {
    await this.saveData({ ...this.settings, foldState: this.foldStateManager.serialize() });
  }
}
