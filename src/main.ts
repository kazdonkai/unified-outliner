import { Editor, getLanguage, Notice, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import { parseDocument } from "./parser/parseDocument";
import { resolveCurrentBlock } from "./resolver/resolveCurrentBlock";
import { ParsedDocument } from "./model/block";
import { MoveDirection } from "./move/findMoveTarget";
import { moveBlock } from "./move/moveBlock";
import { moveNodeOnly } from "./move/moveNodeOnly";
import { indentBlock } from "./move/indentBlock";
import {
  MoveComplexBlockOutcome,
  ResolvedMoveUnit,
  describeMoveUnit,
  findEnclosingSectionId,
  moveComplexBlock,
  resolveEnclosingSectionId,
  resolveMoveUnit,
} from "./move/resolveMoveTarget";
import { IndentDirection } from "./level/direction";
import { setNodeOnlyLevel } from "./level/setNodeOnlyLevel";
import { deleteBlock } from "./edit/deleteBlock";
import {
  insertChildListItem,
  insertSiblingListItem,
  insertSiblingSection,
} from "./edit/insertBlock";
import {
  createCm6FoldSyncExtension,
  OUTLINE_TREE_VIEW_TYPE,
  OutlineTreeView,
} from "./view/OutlineTreeView";
import { PARTIAL_EDIT_VIEW_TYPE, PartialEditView } from "./view/PartialEditView";
import { HeadingLevelModal } from "./view/HeadingLevelModal";
import { ActiveMarkdownViewTracker } from "./view/activeMarkdownViewTracker";
import { FoldStateManager } from "./persistence/foldStateManager";
import { applyLineEditOutcome, LineEditOutcome } from "./commands/applyLineEditOutcome";
import {
  DEFAULT_SETTINGS,
  UnifiedOutlinerSettings,
  UnifiedOutlinerSettingTab,
} from "./settings";
import { mergeSettings } from "./settingsDefaults";
import {
  createTranslator,
  SupportedLocale,
  resolveLocale,
  TranslationKey,
  TranslationVars,
  Translator,
} from "./i18n";

/**
 * Best-effort read of Obsidian's own UI language for `language: "auto"`
 * resolution, via Obsidian's official `getLanguage()` accessor (public API
 * since 1.8.7 — this plugin's own minAppVersion, so no compatibility gap).
 * This replaces an earlier version that read the `language` localStorage
 * key directly, which worked but relied on an undocumented implementation
 * detail rather than a supported API surface. Still wrapped in try/catch
 * and returns null on any failure (headless test environment, ...), which
 * resolveLocale() already treats as "no hint, fall back to en".
 */
function detectObsidianLocale(): string | null {
  try {
    return getLanguage();
  } catch {
    return null;
  }
}

/**
 * One entry per plugin command — the single source of truth
 * UnifiedOutlinerPlugin#registerAllCommands() (re-)registers from on every
 * refreshLocale() call (fix, 2026-08-13, "重要なi18n不具合"). Deliberately
 * plain data (id/translationKey/callback), never a pre-resolved `name`
 * string: the whole point is that `name` is resolved fresh, via the
 * CURRENT translator, every time registerAllCommands() runs — see that
 * method's own doc comment for why that now happens more than once.
 * Exactly one of editorCallback/callback is set per entry, mirroring
 * Obsidian's own Command interface's "exactly one callback kind" contract.
 */
interface CommandSpec {
  id: string;
  translationKey: TranslationKey;
  editorCallback?: (editor: Editor) => void;
  callback?: () => void;
}

export default class UnifiedOutlinerPlugin extends Plugin {
  settings: UnifiedOutlinerSettings = { ...DEFAULT_SETTINGS };

  /** Concrete locale `this.settings.language` currently resolves to — see refreshLocale(). */
  locale: SupportedLocale = "en";
  private translator: Translator = createTranslator("en");

  /**
   * The ribbon icon's own DOM element, returned by addRibbonIcon() in
   * onload() below — kept so refreshLocale() can update its tooltip text
   * on a later language change, the same "re-localize what a one-shot
   * Obsidian API call fixed in place" problem registerAllCommands() solves
   * for Command Palette entries (fix, 2026-08-13). Still null the very
   * first time refreshLocale() runs (called from the top of onload(),
   * before addRibbonIcon() below has created it) — see refreshLocale()'s
   * own null-guard.
   */
  private ribbonIconEl: HTMLElement | null = null;

  /** Translate a UI string owned by this plugin. See src/i18n.ts. */
  t(key: TranslationKey, vars?: TranslationVars): string {
    return this.translator(key, vars);
  }

  /**
   * Resolves this.settings.language into a concrete locale, rebuilds the
   * translator, and — fix, 2026-08-13, "重要なi18n不具合" (English users
   * saw stale Japanese Command Palette entries even after switching the
   * language setting) — re-localizes the two things that used to be fixed
   * in place at an earlier one-shot registration call: every Command
   * Palette entry (via registerAllCommands() below) and the ribbon icon's
   * tooltip. Called once from onload() (right after loadSettings(), before
   * addSettingTab) and again from the settings tab whenever the language
   * setting itself changes.
   *
   * Whether Obsidian actually preserves a user's existing hotkey binding
   * for a command id across registerAllCommands()'s removeCommand()+
   * addCommand() cycle, and whether the ribbon attribute(s) set below are
   * the ones Obsidian's own UI actually reads for the tooltip, have NOT
   * been confirmed on a real Obsidian instance as of this fix — see this
   * ticket's completion report for exactly what still needs manual
   * verification and why the wording in notice.languageChanged
   * deliberately avoids promising instant, guaranteed localization.
   */
  refreshLocale(): void {
    this.locale = resolveLocale(this.settings.language, detectObsidianLocale());
    this.translator = createTranslator(this.locale);
    this.registerAllCommands();
    if (this.ribbonIconEl) {
      const tooltip = this.t("command.ribbonTooltip");
      // Obsidian's addRibbonIcon(icon, title, cb) sets the ribbon's
      // tooltip via its `title` argument, but which DOM attribute it
      // actually uses (aria-label, the native title attribute, or
      // something else) is not documented in obsidian.d.ts and has not
      // been confirmed on a real Obsidian instance — see this method's
      // own doc comment. Setting both is a safe superset: aria-label is
      // the convention Obsidian's own UI CSS uses for icon tooltips, and
      // title is the native HTML tooltip fallback; whichever one turns
      // out to be unused is simply inert, not harmful.
      this.ribbonIconEl.setAttribute("aria-label", tooltip);
      this.ribbonIconEl.setAttribute("title", tooltip);
    }
  }

  /** Translate a no-op/rejection reason (see NOOP_MESSAGES's key set) into the current locale. */
  private reasonText(reason: string | undefined): string | undefined {
    if (!reason) return undefined;
    return this.t(("reason." + reason) as TranslationKey);
  }

  /**
   * One-time notice shown by the settings tab (settings.ts) after the
   * language setting actually changes value — never gated by
   * showNoopNotices (this is not a no-op notice), and never shown for a
   * re-selection of the same value.
   *
   * Fix (2026-08-13): refreshLocale() (called immediately before this, by
   * the settings tab's onChange handler) now re-registers every command
   * and updates the ribbon tooltip itself, so this Notice deliberately no
   * longer tells the user a reload is required. It also deliberately does
   * NOT claim the change is instant/guaranteed for every affected element
   * — see notice.languageChanged's own i18n comment and refreshLocale()'s
   * doc comment for what has not yet been confirmed on a real Obsidian
   * instance (hotkey preservation in particular).
   */
  notifyLanguageChanged(): void {
    new Notice(this.t("notice.languageChanged"));
  }

  /**
   * Fix (2026-08-13, "重要なi18n不具合"): (re-)registers every command in
   * getCommandSpecs() against Obsidian's command registry, resolving each
   * `name` via the CURRENT translator (this.t()) at the moment this runs —
   * never a value captured earlier. Called from refreshLocale() — once at
   * the top of onload() (nothing is registered yet the very first time;
   * see the try/catch below) and again every time refreshLocale() runs
   * after a language-setting change — so Command Palette entries no
   * longer need a full plugin reload to pick up a new language.
   *
   * Uses the public, documented Plugin#removeCommand(commandId) (Obsidian
   * >= 1.7.2 — this plugin's own manifest.json minAppVersion is 1.8.7, so
   * no compatibility gap), never a private/internal API. Obsidian's own
   * command registry keys entries by "<plugin-id>:<command-id>", not the
   * bare id passed to addCommand (community-confirmed usage; not spelled
   * out in this method's own removeCommand doc comment in obsidian.d.ts),
   * so removeCommand is called with that same "<manifest.id>:<id>" prefix.
   *
   * Whether Obsidian preserves a user's existing hotkey binding for a
   * command id across this removeCommand()+addCommand() cycle has NOT been
   * confirmed on a real Obsidian instance as of this fix — see this
   * ticket's completion report. If hotkeys turn out to be lost, this
   * approach needs reconsidering (e.g. mutating the already-registered
   * Command object's own `.name` in place instead, if the Command Palette
   * turns out to honor that without a fresh addCommand() call — also
   * unconfirmed). The try/catch below is defensive only, in case
   * removeCommand throws for an id that was never registered (guaranteed
   * true on this method's very first call, from onload()): no behavior in
   * this codebase depends on which branch runs.
   */
  private registerAllCommands(): void {
    for (const spec of this.getCommandSpecs()) {
      try {
        this.removeCommand(`${this.manifest.id}:${spec.id}`);
      } catch {
        // Nothing registered yet under this id — see this method's own
        // doc comment.
      }
      if (spec.editorCallback) {
        this.addCommand({
          id: spec.id,
          name: this.t(spec.translationKey),
          editorCallback: spec.editorCallback,
        });
      } else if (spec.callback) {
        this.addCommand({
          id: spec.id,
          name: this.t(spec.translationKey),
          callback: spec.callback,
        });
      }
    }
  }

  /**
   * The plugin's full command table — id, i18n key, and callback wiring
   * for every command this plugin registers, in the same order they were
   * previously registered as 15 individual addCommand() calls in onload()
   * (command ids and their callback bodies are UNCHANGED by this refactor
   * — see this ticket's completion report for the id-by-id mapping).
   * Building this array touches neither this.t() nor Obsidian's command
   * registry by itself, so calling it once per registerAllCommands() call
   * is cheap and side-effect-free.
   */
  private getCommandSpecs(): CommandSpec[] {
    return [
      // CHANGELOG (2026-08-11, "Move block の対象を最小安全ブロックへ"):
      // this command's MEANING changed. Before that ticket, cursor position
      // anywhere inside a section (including a plain body paragraph)
      // resolved to "the whole section" — the same behavior "Move section
      // up/down" below now owns explicitly. As of that ticket, Move block
      // instead resolves to the smallest Markdown-safe unit at the cursor:
      // a heading line -> the section; a list item -> its subtree; inside
      // a callout/blockquote/fenced-code/table -> that whole block; an
      // ordinary paragraph -> just that paragraph. See
      // move/resolveMoveTarget.ts's top doc comment for the full
      // rationale. This id and any existing hotkeys are UNCHANGED (still
      // move-block-up/down) — only the resolved target differs.
      {
        id: "move-block-up",
        translationKey: "command.moveBlockUp",
        editorCallback: (editor) => this.moveCurrentBlock(editor, "up"),
      },
      {
        id: "move-block-down",
        translationKey: "command.moveBlockDown",
        editorCallback: (editor) => this.moveCurrentBlock(editor, "down"),
      },
      // New, explicit counterpart (2026-08-11 ticket) to the narrowed Move
      // block above: always moves the WHOLE enclosing section subtree
      // (heading + body + child sections + lists), no matter where inside
      // it the cursor is. This is exactly Move block's pre-ticket
      // behavior, now under its own name.
      {
        id: "move-section-up",
        translationKey: "command.moveSectionUp",
        editorCallback: (editor) => this.moveCurrentSection(editor, "up"),
      },
      {
        id: "move-section-down",
        translationKey: "command.moveSectionDown",
        editorCallback: (editor) => this.moveCurrentSection(editor, "down"),
      },
      // Node-only: swaps just the current heading LINE's text with the
      // previous/next heading line in whole-document order, ignoring level
      // and subtree structure entirely. The body/children physically stay
      // put — only the heading label moves. See docs §5–6.
      {
        id: "move-node-only-up",
        translationKey: "command.moveNodeOnlyUp",
        editorCallback: (editor) => this.moveCurrentNodeOnly(editor, "up"),
      },
      {
        id: "move-node-only-down",
        translationKey: "command.moveNodeOnlyDown",
        editorCallback: (editor) => this.moveCurrentNodeOnly(editor, "down"),
      },
      // Block-scoped: reindents/reparents a whole list subtree, or changes
      // a heading's level under the section-safety checks in
      // move/findIndentTarget.ts. See docs/別ペイン実装計画と当面の実装指示.md §6.2.
      {
        id: "indent-block",
        translationKey: "command.indentBlock",
        editorCallback: (editor) => this.indentCurrentBlock(editor, "indent"),
      },
      {
        id: "outdent-block",
        translationKey: "command.outdentBlock",
        editorCallback: (editor) => this.indentCurrentBlock(editor, "outdent"),
      },
      // Node-only: changes just the current heading line's level, ignoring
      // child sections / body / following blocks entirely. See docs §5.1,
      // §6.1.
      {
        id: "indent-node-only",
        translationKey: "command.indentNodeOnly",
        editorCallback: (editor) => this.changeNodeOnlyLevel(editor, "indent"),
      },
      {
        id: "outdent-node-only",
        translationKey: "command.outdentNodeOnly",
        editorCallback: (editor) => this.changeNodeOnlyLevel(editor, "outdent"),
      },
      // Phase 5C-1A/1B: block-level delete/insert common foundation
      // (section/list only — see edit/deleteBlock.ts, edit/insertBlock.ts).
      {
        id: "delete-block",
        translationKey: "command.deleteBlock",
        editorCallback: (editor) => this.deleteCurrentBlock(editor),
      },
      {
        id: "insert-sibling-block",
        translationKey: "command.insertSiblingBlock",
        editorCallback: (editor) => this.insertSiblingAfterCurrentBlock(editor),
      },
      {
        id: "insert-child-list-item",
        translationKey: "command.insertChildListItem",
        editorCallback: (editor) => this.insertChildListItemForCursor(editor),
      },
      {
        id: "open-outline-tree-view",
        translationKey: "command.openOutlineTreeView",
        callback: () => void this.activateOutlineTreeView(),
      },
      {
        id: "open-partial-edit-pane",
        translationKey: "command.openPartialEditPane",
        editorCallback: (editor) => this.openPartialEditForCursor(editor),
      },
    ];
  }

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
    // i18n実装: locale must be resolved before addSettingTab below — and,
    // as of the 2026-08-13 i18n fix, this call is also what actually
    // registers all 15 of this plugin's commands (see refreshLocale()'s
    // and registerAllCommands()'s own doc comments) — nothing left to do
    // here for that.
    this.refreshLocale();

    // Phase 2A: Outline Tree View — a right-sidebar panel that visualizes
    // the active note's heading structure and stays in sync with the body
    // editor. See view/OutlineTreeView.ts and docs §3.1. This phase is
    // read-mostly (no move/indent/outdent from the tree yet — Phase 2B).
    this.registerView(
      OUTLINE_TREE_VIEW_TYPE,
      (leaf) => new OutlineTreeView(leaf, this)
    );

    // `void` here is a deliberate marker, not a suppression: Obsidian's
    // addRibbonIcon callback type doesn't await whatever it returns, so
    // there is no caller to `await` this from — but activateOutlineTreeView
    // is still `async` (it awaits leaf.setViewState internally), so an
    // un-marked call here would be a floating Promise whose rejection
    // (if setViewState ever throws) goes unhandled. activateOutlineTreeView
    // itself now catches its own failures internally (see its try/catch
    // below) and reports them via Notice, so this call can never actually
    // reject in practice; `void` simply documents at the call site that
    // the returned Promise is intentionally not awaited, for readers and
    // for lint rules like no-floating-promises.
    //
    // Fix (2026-08-13): the returned HTMLElement is kept in
    // this.ribbonIconEl so refreshLocale() can update its tooltip on a
    // later language change — see that field's own doc comment.
    this.ribbonIconEl = this.addRibbonIcon(
      "list-tree",
      this.t("command.ribbonTooltip"),
      () => {
        void this.activateOutlineTreeView();
      }
    );

    // Phase 3B: Partial Edit Pane — a focused, explicit-save editing view
    // for exactly one section subtree at a time. Normally opened from the
    // Outline Tree View's right-click menu (which already has a specific
    // sectionId to hand it); its body-editor-side command entry point
    // (open-partial-edit-pane) is registered via getCommandSpecs() above,
    // like every other command. See view/PartialEditView.ts.
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
        new Notice(this.t("notice.couldNotOpenOutlineTreeView"));
      }
      return;
    }

    const leaf: WorkspaceLeaf | null = workspace.getRightLeaf(false);
    if (!leaf) {
      new Notice(this.t("notice.couldNotOpenRightSidebar"));
      return;
    }
    try {
      await leaf.setViewState({ type: OUTLINE_TREE_VIEW_TYPE, active: true });
      await workspace.revealLeaf(leaf);
    } catch (error) {
      console.error("Unified Outliner: failed to open the outline tree view.", error);
      new Notice(this.t("notice.couldNotOpenOutlineTreeView"));
    }
  }

  /**
   * Open the Partial Edit Pane in the right sidebar, reusing an existing
   * leaf of this view type if one is already open (same "reuse, don't
   * multiply" policy as activateOutlineTreeView — task 5's explicit
   * requirement: "毎回新しい pane を量産しないでください"), then load
   * `nodeId` into it. `nodeId` may be a section OR (Phase 4C) a list item
   * id — activatePartialEditView itself doesn't care which, since
   * PartialEditView.requestLoadNode (Phase 5B's guarded entry point)
   * resolves that generically. Called from
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
   *
   * Phase 5A follow-up: `options.openInNewWindow` collapses the previously
   * two-step "open the pane, then right-click its tab and choose 標準の
   * Move to new window" flow into one action, using the same official
   * `Workspace.openPopoutLeaf()` / `moveLeafToPopout()` APIs a user would
   * reach via that standard tab menu — no custom window manager is
   * introduced. If a Partial Edit Pane leaf already exists (docked or
   * already popped out), it is migrated via `moveLeafToPopout` rather than
   * creating a second leaf, preserving the existing "reuse, don't
   * multiply" policy used by the non-popout path below. Both popout APIs
   * throw on platforms without popout window support (mobile, or an old
   * Electron version) — caught here and surfaced via the same
   * console.error + Notice pattern as every other failure path in this
   * method, never left to escape as an unhandled exception from a UI
   * callback.
   */
  async activatePartialEditView(
    nodeId: string,
    options?: { openInNewWindow?: boolean }
  ): Promise<void> {
    const { workspace } = this.app;

    this.activeMarkdownView.get();

    const existing = workspace.getLeavesOfType(PARTIAL_EDIT_VIEW_TYPE);
    let leaf: WorkspaceLeaf;

    if (options?.openInNewWindow) {
      try {
        if (existing.length > 0) {
          leaf = existing[0];
          workspace.moveLeafToPopout(leaf);
        } else {
          leaf = workspace.openPopoutLeaf();
          await leaf.setViewState({ type: PARTIAL_EDIT_VIEW_TYPE, active: true });
        }
      } catch (error) {
        console.error(
          "Unified Outliner: failed to open the partial edit pane in a new window.",
          error
        );
        new Notice(this.t("notice.couldNotOpenPartialEditPaneNewWindow"));
        return;
      }
    } else if (existing.length > 0) {
      leaf = existing[0];
    } else {
      const newLeaf = workspace.getRightLeaf(true);
      if (!newLeaf) {
        new Notice(this.t("notice.couldNotOpenRightSidebar"));
        return;
      }
      leaf = newLeaf;
      try {
        await leaf.setViewState({ type: PARTIAL_EDIT_VIEW_TYPE, active: true });
      } catch (error) {
        console.error("Unified Outliner: failed to open the partial edit pane.", error);
        new Notice(this.t("notice.couldNotOpenPartialEditPane"));
        return;
      }
    }

    try {
      await workspace.revealLeaf(leaf);
    } catch (error) {
      console.error("Unified Outliner: failed to open the partial edit pane.", error);
      new Notice(this.t("notice.couldNotOpenPartialEditPane"));
      return;
    }
    if (leaf.view instanceof PartialEditView) {
      // Phase 5B: requestLoadNode (not loadNode/loadNodeInternal) is the
      // single sanctioned entry point for switching which node the pane
      // shows — it guards against silently discarding an unapplied edit
      // (Apply/Discard/Cancel prompt), the same guard the pane's own
      // breadcrumb segment clicks go through. See PartialEditView.ts's
      // requestLoadNode doc comment.
      leaf.view.requestLoadNode(nodeId);
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
      this.notice(this.t("notice.multipleCursors"));
      return;
    }

    const doc = parseDocument(editor.getValue());
    const resolved = resolveCurrentBlock(doc, editor.getCursor().line);
    if (!resolved.node) {
      this.notice(this.reasonText(resolved.reason ?? "no-block"));
      return;
    }
    if (resolved.node.type !== "section") {
      this.notice(this.t("reason.not-a-heading"));
      return;
    }

    // See activatePartialEditView's doc comment: it now catches its own
    // failures internally and reports them via Notice, so this floating
    // call (editorCallback has nothing to await it from) can no longer
    // produce an unhandled rejection; `void` documents that at the call
    // site.
    void this.activatePartialEditView(resolved.node.id);
  }

  /**
   * Resolves the cursor to the minimal safe unit (move/resolveMoveTarget.ts)
   * and moves exactly that — see the CHANGELOG comment on this command's
   * registration above for the behavior change this ticket introduced.
   * Section/list units are applied via the existing, unchanged
   * move/moveBlock.ts path; paragraph/callout/blockquote/fenced-code/table
   * units go through the new move/resolveMoveTarget.ts#moveComplexBlock
   * sibling-swap path. Both paths funnel through the same
   * applyLineEditOutcome, so undo/redo, cursor placement, and the no-op
   * Notice plumbing are identical regardless of which kind was resolved.
   */
  private moveCurrentBlock(editor: Editor, direction: MoveDirection): void {
    if (editor.listSelections().length > 1) {
      this.notice(this.t("notice.multipleCursors"));
      return;
    }

    const cursor = editor.getCursor();
    const doc = parseDocument(editor.getValue());

    const resolved = resolveMoveUnit(doc, cursor.line);
    if (!resolved.unit) {
      this.notice(this.reasonText(resolved.reason ?? "no-block"));
      return;
    }
    const unit = resolved.unit;

    const outcome: LineEditOutcome | MoveComplexBlockOutcome =
      unit.kind === "section" || unit.kind === "list"
        ? moveBlock(doc, unit.nodeId as string, direction, {
            allowCrossSectionListMove: this.settings.allowCrossSectionListMove,
            normalizeOrderedLists: this.settings.normalizeOrderedLists,
          })
        : moveComplexBlock(doc, unit, direction);

    // Queue the toast/flash BEFORE applyLineEditOutcome, not after — see
    // this method's own note below (mirrored in moveCurrentSection) on why
    // ordering matters here: applyLineEditOutcome's editor.replaceRange()
    // call is what fires Obsidian's "editor-change" workspace event, which
    // OutlineTreeView listens to via a LEADING-edge debounce (refresh()
    // fires synchronously on the first change after a quiet period — see
    // OutlineTreeView.ts's scheduleRefresh). If queueOutlineTreeMoveFlash
    // ran AFTER applyLineEditOutcome, that synchronous refresh could
    // already have happened and re-rendered the tree before
    // pendingMoveFlash was ever set, silently dropping the one-shot flash
    // (found via real-device testing — a scripted DevTools console check
    // showed queueMoveFlash's target was set but never consumed). outcome.changed
    // is known immediately (computed above, before any editor mutation) and is
    // exactly the same condition applyLineEditOutcome's own return value
    // (`applied`, used below) reduces to — see that function's own "if
    // (!outcome.changed) { ...; return false }" — so gating on it here
    // instead is equivalent, just correctly ordered.
    if (outcome.changed) {
      this.announceMoveResult(doc, unit, direction);
      this.queueOutlineTreeMoveFlash(doc, unit, outcome);
    }

    applyLineEditOutcome(
      editor,
      cursor,
      unit.range.startLine,
      doc.lines,
      outcome,
      () => this.notice(this.reasonText(outcome.reason))
    );
  }

  /**
   * Always moves the WHOLE enclosing section, regardless of where inside it
   * the cursor is — see move-section-up/down's registration comment. Reuses
   * the exact same move/moveBlock.ts path section units already used before
   * this ticket (unchanged).
   */
  private moveCurrentSection(editor: Editor, direction: MoveDirection): void {
    if (editor.listSelections().length > 1) {
      this.notice(this.t("notice.multipleCursors"));
      return;
    }

    const cursor = editor.getCursor();
    const doc = parseDocument(editor.getValue());

    const resolved = resolveEnclosingSectionId(doc, cursor.line);
    if (!resolved.sectionId) {
      this.notice(this.reasonText(resolved.reason ?? "no-block"));
      return;
    }
    const sectionNode = doc.nodes.get(resolved.sectionId);
    if (!sectionNode) {
      this.notice(this.t("reason.resolve-failed"));
      return;
    }

    const outcome = moveBlock(doc, sectionNode.id, direction, {
      allowCrossSectionListMove: this.settings.allowCrossSectionListMove,
      normalizeOrderedLists: this.settings.normalizeOrderedLists,
    });

    const unit: ResolvedMoveUnit = {
      kind: "section",
      range: sectionNode.range,
      parentId: sectionNode.parentId,
      nodeId: sectionNode.id,
    };

    // Ordering note: see moveCurrentBlock's matching comment — queue the
    // toast/flash BEFORE applyLineEditOutcome mutates the editor, since
    // that mutation can synchronously trigger OutlineTreeView's
    // leading-edge-debounced refresh() and consume this.pendingMoveFlash
    // before it would otherwise be set.
    if (outcome.changed) {
      this.announceMoveResult(doc, unit, direction);
      this.queueOutlineTreeMoveFlash(doc, unit, outcome);
    }

    applyLineEditOutcome(
      editor,
      cursor,
      sectionNode.range.startLine,
      doc.lines,
      outcome,
      () => this.notice(this.reasonText(outcome.reason))
    );
  }

  /**
   * Move-result toast (2026-08-11 ticket §5B): names what was actually
   * moved — e.g. "Unified Outliner: moved paragraph up.", "Unified
   * Outliner: moved list item (with 3 nested items) down.", "Unified
   * Outliner: moved section "Overview" up.". English, matching every
   * OTHER Notice in this plugin (NOOP_MESSAGES above) — an earlier
   * revision of this method used Japanese text per the ticket's own
   * (later corrected) example wording; that was reverted following an
   * explicit follow-up instruction establishing English as this plugin's
   * default user-facing language (this is a universal plugin, not
   * Japan-only) — see docs/統合実装ロードマップ_2026-08-05.md §1 for the
   * policy statement this applies going forward. Gated by its own setting
   * (showMoveResultToast), independent of showNoopNotices/this.notice,
   * since a successful move is not a no-op.
   */
  private announceMoveResult(
    doc: ParsedDocument,
    unit: ResolvedMoveUnit,
    direction: MoveDirection
  ): void {
    if (!this.settings.treeKindHighlight.showMoveResultToast) return;
    const unitLabel = describeMoveUnit(doc, unit, (key, vars) => this.t(key, vars));
    const directionLabel =
      direction === "up" ? this.t("notice.directionUp") : this.t("notice.directionDown");
    new Notice(this.t("notice.moved", { unit: unitLabel, direction: directionLabel }));
  }

  /**
   * Move target preview (2026-08-11 ticket §5B): queues a one-shot flash
   * highlight on every open Outline Tree View leaf for the row that now
   * represents the just-moved block. Section/list units have their own
   * Tree row, addressed by the outcome's newStartLine (node ids shift
   * across a re-parse — see model/complexBlock.ts's id-stability note —
   * so matching by line, not id, is what stays correct after the move).
   * Paragraph/complex-block units have no Tree row of their own (see
   * resolveMoveTarget.ts's top doc comment on why paragraph stays a
   * non-Tree-node concept) — the enclosing section's row is flashed
   * instead, resolved from the PRE-move doc (the section's own heading line
   * never moves when only content within it is swapped).
   */
  private queueOutlineTreeMoveFlash(
    doc: ParsedDocument,
    unit: ResolvedMoveUnit,
    outcome: LineEditOutcome | MoveComplexBlockOutcome
  ): void {
    if (!this.settings.treeKindHighlight.showMoveTargetPreview) return;
    if (!outcome.changed) return;

    let target: { line?: number; nodeIdHint?: string } | null = null;
    if (unit.kind === "section" || unit.kind === "list") {
      target = { line: outcome.newStartLine };
    } else {
      const ownerNode = unit.parentId ? doc.nodes.get(unit.parentId) : null;
      const sectionId = ownerNode ? findEnclosingSectionId(doc, ownerNode) : null;
      if (sectionId) target = { nodeIdHint: sectionId };
    }
    if (!target) return;

    for (const leaf of this.app.workspace.getLeavesOfType(OUTLINE_TREE_VIEW_TYPE)) {
      if (leaf.view instanceof OutlineTreeView) leaf.view.queueMoveFlash(target);
    }
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
      this.notice(this.t("notice.multipleCursors"));
      return;
    }

    const cursor = editor.getCursor();
    const doc = parseDocument(editor.getValue());

    const resolved = resolveCurrentBlock(doc, cursor.line);
    if (!resolved.node) {
      this.notice(this.reasonText(resolved.reason ?? "no-block"));
      return;
    }

    const outcome = moveNodeOnly(doc, resolved.node.id, direction);

    applyLineEditOutcome(
      editor,
      cursor,
      resolved.node.range.startLine,
      doc.lines,
      outcome,
      () => this.notice(this.reasonText(outcome.reason))
    );
  }

  private indentCurrentBlock(editor: Editor, direction: IndentDirection): void {
    if (editor.listSelections().length > 1) {
      this.notice(this.t("notice.multipleCursors"));
      return;
    }

    const cursor = editor.getCursor();
    const doc = parseDocument(editor.getValue());

    const resolved = resolveCurrentBlock(doc, cursor.line);
    if (!resolved.node) {
      this.notice(this.reasonText(resolved.reason ?? "no-block"));
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
      () => this.notice(this.reasonText(outcome.reason))
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
      this.notice(this.t("notice.multipleCursors"));
      return;
    }

    const cursor = editor.getCursor();
    const doc = parseDocument(editor.getValue());

    const resolved = resolveCurrentBlock(doc, cursor.line);
    if (!resolved.node) {
      this.notice(this.reasonText(resolved.reason ?? "no-block"));
      return;
    }

    const outcome = setNodeOnlyLevel(doc, resolved.node.id, direction);

    applyLineEditOutcome(
      editor,
      cursor,
      resolved.node.range.startLine,
      doc.lines,
      outcome,
      () => this.notice(this.reasonText(outcome.reason))
    );
  }

  /**
   * Phase 5C-1A: delete the section/list subtree at the cursor. Resolution
   * follows the same resolveCurrentBlock pattern as every other body-editor
   * command. deleteBlock's outcome always sets newCursorCh (see that
   * module's doc comment), so the {startLine, ch:0} passed here as
   * `cursor`/`resolvedNodeStartLine` is only a placeholder to satisfy
   * applyLineEditOutcome's signature — the real placement it computes
   * ignores them once newCursorCh is present.
   */
  private deleteCurrentBlock(editor: Editor): void {
    if (editor.listSelections().length > 1) {
      this.notice(this.t("notice.multipleCursors"));
      return;
    }

    const doc = parseDocument(editor.getValue());
    const resolved = resolveCurrentBlock(doc, editor.getCursor().line);
    if (!resolved.node) {
      this.notice(this.reasonText(resolved.reason ?? "no-block"));
      return;
    }

    const outcome = deleteBlock(doc, resolved.node.id);

    applyLineEditOutcome(
      editor,
      { line: resolved.node.range.startLine, ch: 0 },
      resolved.node.range.startLine,
      doc.lines,
      outcome,
      () => this.notice(this.reasonText(outcome.reason))
    );
  }

  /**
   * Phase 5C-1B: insert a new sibling immediately after the block at the
   * cursor — a new SECTION (heading level chosen via HeadingLevelModal,
   * never inferred) when the resolved block is a section, or a new LIST
   * ITEM (marker/indentation matched to the resolved item) when it's a
   * list. The modal path re-parses the editor fresh when its callback
   * fires (not the `doc` captured before the modal opened), so the target
   * is re-verified against live document state at the moment of
   * insertion — the editor may have changed while the modal was open.
   */
  private insertSiblingAfterCurrentBlock(editor: Editor): void {
    if (editor.listSelections().length > 1) {
      this.notice(this.t("notice.multipleCursors"));
      return;
    }

    const doc = parseDocument(editor.getValue());
    const resolved = resolveCurrentBlock(doc, editor.getCursor().line);
    if (!resolved.node) {
      this.notice(this.reasonText(resolved.reason ?? "no-block"));
      return;
    }

    if (resolved.node.type === "section") {
      const sectionId = resolved.node.id;
      new HeadingLevelModal(this.app, this, (level) => {
        if (level === null) return;
        const freshDoc = parseDocument(editor.getValue());
        const target = freshDoc.nodes.get(sectionId);
        if (!target) {
          this.notice(this.t("reason.resolve-failed"));
          return;
        }
        const outcome = insertSiblingSection(freshDoc, sectionId, level);
        applyLineEditOutcome(
          editor,
          { line: target.range.startLine, ch: 0 },
          target.range.startLine,
          freshDoc.lines,
          outcome,
          () => this.notice(this.reasonText(outcome.reason))
        );
      }).open();
      return;
    }

    const outcome = insertSiblingListItem(doc, resolved.node.id, {
      normalizeOrderedLists: this.settings.normalizeOrderedLists,
    });

    applyLineEditOutcome(
      editor,
      { line: resolved.node.range.startLine, ch: 0 },
      resolved.node.range.startLine,
      doc.lines,
      outcome,
      () => this.notice(this.reasonText(outcome.reason))
    );
  }

  /**
   * Phase 5C-1B: insert a new child list item under the list item at the
   * cursor. Refuses (via insertChildListItem's own "not-a-list-item"/
   * "unsafe-indent" reasons, surfaced through the shared NOOP_MESSAGES) when
   * the cursor isn't in a list item or the parent's indentation can't
   * safely be interpreted — see edit/insertBlock.ts's doc comment.
   */
  private insertChildListItemForCursor(editor: Editor): void {
    if (editor.listSelections().length > 1) {
      this.notice(this.t("notice.multipleCursors"));
      return;
    }

    const doc = parseDocument(editor.getValue());
    const resolved = resolveCurrentBlock(doc, editor.getCursor().line);
    if (!resolved.node) {
      this.notice(this.reasonText(resolved.reason ?? "no-block"));
      return;
    }
    if (resolved.node.type !== "list") {
      this.notice(this.t("reason.not-a-list-item"));
      return;
    }

    const outcome = insertChildListItem(doc, resolved.node.id, {
      normalizeOrderedLists: this.settings.normalizeOrderedLists,
    });

    applyLineEditOutcome(
      editor,
      { line: resolved.node.range.startLine, ch: 0 },
      resolved.node.range.startLine,
      doc.lines,
      outcome,
      () => this.notice(this.reasonText(outcome.reason))
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
