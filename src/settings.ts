import { App, PluginSettingTab, Setting } from "obsidian";
import type UnifiedOutlinerPlugin from "./main";
import {
  DEFAULT_SETTINGS,
  TreeKindHighlightSettings,
  UnifiedOutlinerSettings,
} from "./settingsDefaults";

// Re-exported unchanged so every existing importer of "./settings" (just
// main.ts today) keeps working without touching its own import line — see
// settingsDefaults.ts's doc comment for why the settings shape/defaults
// had to move to an Obsidian-free module. Split into a value export and a
// `export type` re-export because this file has `isolatedModules: true`
// (tsconfig.json) — a plain `export { A, B }` can't tell a type-only name
// apart from a real one when transpiled file-by-file.
export { DEFAULT_SETTINGS };
export type { UnifiedOutlinerSettings };

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

    new Setting(containerEl)
      .setName("Sync Outline Tree folding to editor")
      .setDesc(
        "When enabled, folding or unfolding a node in the Outline Tree also folds or unfolds the matching content in the active Markdown editor."
      )
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.syncOutlineTreeFoldingToEditor)
          .onChange(async (v) => {
            this.plugin.settings.syncOutlineTreeFoldingToEditor = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl).setName("Move & Outline Tree kind highlight").setHeading();

    new Setting(containerEl)
      .setName("Section background style in Outline Tree")
      .setDesc(
        "Always-on visual aid so section rows are easy to tell apart from list rows at a glance. Purely cosmetic — never changes what Move block / Move section actually operate on."
      )
      .addDropdown((d) =>
        d
          .addOption("subtle", "Subtle background")
          .addOption("stripe", "Left edge stripe")
          .addOption("off", "Off")
          .setValue(this.plugin.settings.treeKindHighlight.sectionMode)
          .onChange(async (v) => {
            this.plugin.settings.treeKindHighlight.sectionMode =
              v as TreeKindHighlightSettings["sectionMode"];
            await this.plugin.saveSettings();
            this.plugin.refreshOutlineTreeViews();
          })
      );

    new Setting(containerEl)
      .setName("List row highlight style in Outline Tree")
      .setDesc(
        "Deliberately weaker than the section style above (hover-only by default), so the tree doesn't get visually noisy when list items are shown."
      )
      .addDropdown((d) =>
        d
          .addOption("hover", "Highlight on hover/selection only")
          .addOption("subtle", "Always-on subtle background")
          .addOption("off", "Off")
          .setValue(this.plugin.settings.treeKindHighlight.listMode)
          .onChange(async (v) => {
            this.plugin.settings.treeKindHighlight.listMode =
              v as TreeKindHighlightSettings["listMode"];
            await this.plugin.saveSettings();
            this.plugin.refreshOutlineTreeViews();
          })
      );

    new Setting(containerEl)
      .setName("Preview move target in Outline Tree")
      .setDesc(
        "Briefly flash-highlight, in the Outline Tree, the block that Move block / Move section actually operated on."
      )
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.treeKindHighlight.showMoveTargetPreview)
          .onChange(async (v) => {
            this.plugin.settings.treeKindHighlight.showMoveTargetPreview = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Show move result toast")
      .setDesc(
        "Show a short notice naming what was moved (paragraph / list item / section) after Move block or Move section."
      )
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.treeKindHighlight.showMoveResultToast)
          .onChange(async (v) => {
            this.plugin.settings.treeKindHighlight.showMoveResultToast = v;
            await this.plugin.saveSettings();
          })
      );
  }
}
