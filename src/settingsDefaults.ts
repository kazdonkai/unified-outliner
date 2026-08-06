/**
 * Pure, Obsidian-free half of settings.ts: the settings shape, its
 * defaults, and the merge-with-defaults logic main.ts's loadSettings()
 * uses to reconcile them with whatever a real data.json contains. Split
 * out from settings.ts (which also defines UnifiedOutlinerSettingTab, an
 * Obsidian PluginSettingTab subclass) so this data and logic can be unit
 * tested directly: node_modules/obsidian has no runtime implementation
 * outside a real Obsidian process (its package.json's "main" is empty —
 * it ships types only), so any module that imports Obsidian classes as
 * VALUES (not just types), like settings.ts's own PluginSettingTab/Setting
 * import, cannot be imported from a vitest test at all. Every other
 * tests/*.ts file in this repo already follows that constraint by only
 * importing Obsidian-free modules (see foldStateAcceptance.test.ts's doc
 * comment for the same reasoning applied to persistence/foldStateStore.ts,
 * which exists for an identical reason relative to foldStateManager.ts).
 * settings.ts re-exports both of these unchanged, so nothing outside this
 * file and settings.ts needs to know the split exists.
 */
export interface UnifiedOutlinerSettings {
  /** Allow a root list item to hop across a heading boundary. */
  allowCrossSectionListMove: boolean;
  /** Normalize ordered markers to "1." after a list move (MVP policy). */
  normalizeOrderedLists: boolean;
  /** Show a Notice explaining why a command was a no-op. */
  showNoopNotices: boolean;
  /**
   * Phase 3C: show list items as nodes in the Outline Tree View, alongside
   * sections. Off by default — the tree has been heading-only since Phase
   * 2A, and this keeps that the default experience; users who want the
   * fuller view opt in here.
   */
  showListItemsInOutline: boolean;
  /**
   * Post-Phase-3D: when moving the Outline Tree View's keyboard selection
   * with Up/Down (and the "step into child" / "step out to parent"
   * branches of Right/Left), also preview the newly selected node into the
   * body editor — same jumpToLine(..., { focusEditor: false }) a row click
   * already does. On by default, since this is the current, already-
   * shipped behavior (matches what a mouse click does, and keeps the
   * selected row and the body editor's position in sync during normal
   * browsing/editing). Turning this off restores the pre-existing Phase 4D
   * behavior: arrow keys move only the tree's own selection, and only
   * Enter jumps into the body — a compatibility mode for users who prefer
   * to explore the tree structure without disturbing the body editor's
   * scroll position on every arrow press.
   */
  followKeyboardSelectionIntoBody: boolean;
  /**
   * Phase 3D's Outline Tree -> CM6 body editor fold sync
   * (OutlineTreeView.syncFoldToBodyEditor, invoked from the single control
   * point in setNodeCollapsed) is one-directional only: it never affects
   * the reverse direction. On by default, matching the already-shipped
   * behavior. Turning this off stops a Tree-initiated fold/unfold from
   * touching the body editor's own CM6 fold state at all — the Tree's own
   * collapsedIds and the persisted FoldStateManager entry are still
   * updated and still propagate to every other open Outline Tree View
   * leaf exactly as before, and folding/unfolding directly in the body
   * editor (gutter, or Obsidian's Fold/Unfold heading commands) still
   * flows back into the Tree via the separate, always-on CM6 -> Tree
   * sync (handleCm6FoldEffect) regardless of this setting.
   */
  syncOutlineTreeFoldingToEditor: boolean;
}

export const DEFAULT_SETTINGS: UnifiedOutlinerSettings = {
  allowCrossSectionListMove: true,
  normalizeOrderedLists: true,
  showNoopNotices: true,
  showListItemsInOutline: false,
  followKeyboardSelectionIntoBody: true,
  syncOutlineTreeFoldingToEditor: true,
};

/**
 * Merges a raw, possibly-partial settings object (typically data.json's
 * top-level keys minus `foldState` — see main.ts's loadSettings) over
 * DEFAULT_SETTINGS, so any key missing from `raw` (a pre-existing
 * data.json written before that key existed, or a hand-edited/corrupted
 * one) falls back to its default rather than becoming `undefined`. Pure
 * and side-effect-free — main.ts's loadSettings is the only real caller,
 * wiring this into `this.settings` alongside the actual Obsidian
 * loadData() call.
 */
export function mergeSettings(
  raw: Record<string, unknown>
): UnifiedOutlinerSettings {
  return Object.assign({}, DEFAULT_SETTINGS, raw);
}
