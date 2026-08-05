import { App, PluginSettingTab, Setting } from "obsidian";
import type UnifiedOutlinerPlugin from "./main";

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
}

export const DEFAULT_SETTINGS: UnifiedOutlinerSettings = {
  allowCrossSectionListMove: true,
  normalizeOrderedLists: true,
  showNoopNotices: true,
  showListItemsInOutline: false,
  followKeyboardSelectionIntoBody: true,
};

export class UnifiedOutlinerSettingTab extends PluginSettingTab {
  plugin: UnifiedOutlinerPlugin;

  constructor(app: App, plugin: UnifiedOutlinerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Allow list moves across sections")
      .setDesc(
        "When a root list item has no sibling in the move direction, let it hop across the adjacent heading into the neighboring section."
      )
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.allowCrossSectionListMove)
          .onChange(async (v) => {
            this.plugin.settings.allowCrossSectionListMove = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Normalize ordered list markers to \"1.\"")
      .setDesc(
        "After moving a list block, rewrite ordered markers in the affected range to \"1.\" (renderers auto-number). Sequential renumbering is planned."
      )
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.normalizeOrderedLists)
          .onChange(async (v) => {
            this.plugin.settings.normalizeOrderedLists = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Show no-op notices")
      .setDesc("Show a small notice when a move command does nothing and why.")
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.showNoopNotices)
          .onChange(async (v) => {
            this.plugin.settings.showNoopNotices = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Show list items in Outline Tree View")
      .setDesc(
        "Show list items as nodes in the right-sidebar Outline Tree View, alongside headings. Off by default (headings only, as in earlier versions of this plugin)."
      )
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.showListItemsInOutline)
          .onChange(async (v) => {
            this.plugin.settings.showListItemsInOutline = v;
            await this.plugin.saveSettings();
            this.plugin.refreshOutlineTreeViews();
          })
      );

    new Setting(containerEl)
      .setName("Follow keyboard selection into body editor")
      .setDesc(
        "When navigating the Outline Tree with arrow keys, also move the body editor's cursor and scroll position, the same way clicking a row does. Turn off to keep arrow-key navigation confined to the tree panel (Enter still jumps to the body)."
      )
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.followKeyboardSelectionIntoBody)
          .onChange(async (v) => {
            this.plugin.settings.followKeyboardSelectionIntoBody = v;
            await this.plugin.saveSettings();
          })
      );
  }
}
