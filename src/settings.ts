import { App, PluginSettingTab, Setting } from "obsidian";
import type UnifiedOutlinerPlugin from "./main";
import {
  DEFAULT_SETTINGS,
  TreeKindHighlightSettings,
  UnifiedOutlinerSettings,
} from "./settingsDefaults";
import { isValidPluginLanguage, PluginLanguage } from "./i18n";

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

    // i18n実装 (2026-08-11): language switch, deliberately the FIRST control
    // in this tab (per the ticket's "分かりやすい位置（原則として先頭）"
    // requirement) — every OTHER setting's own label/description below is
    // itself translated via this.plugin.t(), so this is also the control
    // that determines how the rest of this very page reads.
    //
    // onChange ordering (ticket §4, exact sequence): 1) validate the raw
    // dropdown value, 2) update settings.language, 3) await saveSettings(),
    // 4) refresh the plugin's locale/translator, 5) re-render this tab via
    // display() so every label below reflects the new language immediately,
    // 6) show a one-time Notice — but ONLY when the value actually changed
    // (re-selecting the same option is a no-op, not a fresh "changed"
    // event), explaining that already-registered Command Palette names need
    // a reload to update (command ids/hotkeys themselves never change).
    new Setting(containerEl)
      .setName(this.plugin.t("settings.language.name"))
      .setDesc(this.plugin.t("settings.language.desc"))
      .addDropdown((d) =>
        d
          .addOption("auto", this.plugin.t("settings.language.optionAuto"))
          .addOption("ja", this.plugin.t("settings.language.optionJa"))
          .addOption("en", this.plugin.t("settings.language.optionEn"))
          .setValue(this.plugin.settings.language)
          .onChange(async (v) => {
            const next: PluginLanguage = isValidPluginLanguage(v) ? v : "auto";
            const previous = this.plugin.settings.language;
            this.plugin.settings.language = next;
            await this.plugin.saveSettings();
            this.plugin.refreshLocale();
            this.display();
            if (next !== previous) {
              this.plugin.notifyLanguageChanged();
            }
          })
      );

    new Setting(containerEl)
      .setName(this.plugin.t("settings.allowCrossSectionListMove.name"))
      .setDesc(this.plugin.t("settings.allowCrossSectionListMove.desc"))
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.allowCrossSectionListMove)
          .onChange(async (v) => {
            this.plugin.settings.allowCrossSectionListMove = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(this.plugin.t("settings.normalizeOrderedLists.name"))
      .setDesc(this.plugin.t("settings.normalizeOrderedLists.desc"))
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.normalizeOrderedLists)
          .onChange(async (v) => {
            this.plugin.settings.normalizeOrderedLists = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(this.plugin.t("settings.showNoopNotices.name"))
      .setDesc(this.plugin.t("settings.showNoopNotices.desc"))
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.showNoopNotices)
          .onChange(async (v) => {
            this.plugin.settings.showNoopNotices = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(this.plugin.t("settings.showListItemsInOutline.name"))
      .setDesc(this.plugin.t("settings.showListItemsInOutline.desc"))
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
      .setName(this.plugin.t("settings.followKeyboardSelectionIntoBody.name"))
      .setDesc(this.plugin.t("settings.followKeyboardSelectionIntoBody.desc"))
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.followKeyboardSelectionIntoBody)
          .onChange(async (v) => {
            this.plugin.settings.followKeyboardSelectionIntoBody = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(this.plugin.t("settings.syncOutlineTreeFoldingToEditor.name"))
      .setDesc(this.plugin.t("settings.syncOutlineTreeFoldingToEditor.desc"))
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.syncOutlineTreeFoldingToEditor)
          .onChange(async (v) => {
            this.plugin.settings.syncOutlineTreeFoldingToEditor = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl).setName(this.plugin.t("settings.moveHighlightHeading")).setHeading();

    new Setting(containerEl)
      .setName(this.plugin.t("settings.sectionBackgroundStyle.name"))
      .setDesc(this.plugin.t("settings.sectionBackgroundStyle.desc"))
      .addDropdown((d) =>
        d
          .addOption("subtle", this.plugin.t("settings.sectionBackgroundStyle.optionSubtle"))
          .addOption("stripe", this.plugin.t("settings.sectionBackgroundStyle.optionStripe"))
          .addOption("off", this.plugin.t("settings.sectionBackgroundStyle.optionOff"))
          .setValue(this.plugin.settings.treeKindHighlight.sectionMode)
          .onChange(async (v) => {
            this.plugin.settings.treeKindHighlight.sectionMode =
              v as TreeKindHighlightSettings["sectionMode"];
            await this.plugin.saveSettings();
            this.plugin.refreshOutlineTreeViews();
          })
      );

    new Setting(containerEl)
      .setName(this.plugin.t("settings.listHighlightStyle.name"))
      .setDesc(this.plugin.t("settings.listHighlightStyle.desc"))
      .addDropdown((d) =>
        d
          .addOption("hover", this.plugin.t("settings.listHighlightStyle.optionHover"))
          .addOption("subtle", this.plugin.t("settings.listHighlightStyle.optionSubtle"))
          .addOption("off", this.plugin.t("settings.listHighlightStyle.optionOff"))
          .setValue(this.plugin.settings.treeKindHighlight.listMode)
          .onChange(async (v) => {
            this.plugin.settings.treeKindHighlight.listMode =
              v as TreeKindHighlightSettings["listMode"];
            await this.plugin.saveSettings();
            this.plugin.refreshOutlineTreeViews();
          })
      );

    new Setting(containerEl)
      .setName(this.plugin.t("settings.previewMoveTarget.name"))
      .setDesc(this.plugin.t("settings.previewMoveTarget.desc"))
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.treeKindHighlight.showMoveTargetPreview)
          .onChange(async (v) => {
            this.plugin.settings.treeKindHighlight.showMoveTargetPreview = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(this.plugin.t("settings.showMoveResultToast.name"))
      .setDesc(this.plugin.t("settings.showMoveResultToast.desc"))
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.treeKindHighlight.showMoveResultToast)
          .onChange(async (v) => {
            this.plugin.settings.treeKindHighlight.showMoveResultToast = v;
            await this.plugin.saveSettings();
          })
      );

    // Phase 5D-0 / 5D-0.3: CompositeBlock rules — enable/disable toggles for
    // the two built-in default rules (model/compositeBlock.ts). Per the
    // 5D-0.3 approval (§4 — no separate "show composite blocks" toggle), a
    // rule's own enabled flag is the SOLE control for both matching AND
    // Outline Tree projection: turning a rule off here makes
    // OutlineTreeView.refresh() stop grouping its member blocks, which is
    // why (unlike most other flat toggles above) this one also calls
    // refreshOutlineTreeViews() so an already-open Tree reflects the change
    // immediately, matching showListItemsInOutline's own onChange below.
    new Setting(containerEl).setName(this.plugin.t("settings.compositeBlocksHeading")).setHeading();
    new Setting(containerEl).setDesc(this.plugin.t("settings.compositeBlocksIntro"));

    new Setting(containerEl)
      .setName(this.plugin.t("settings.compositeBlockImageOcr.name"))
      .setDesc(this.plugin.t("settings.compositeBlockImageOcr.desc"))
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.compositeBlocks.imageOcr)
          .onChange(async (v) => {
            this.plugin.settings.compositeBlocks.imageOcr = v;
            await this.plugin.saveSettings();
            this.plugin.refreshOutlineTreeViews();
          })
      );

    new Setting(containerEl)
      .setName(this.plugin.t("settings.compositeBlockImageQuote.name"))
      .setDesc(this.plugin.t("settings.compositeBlockImageQuote.desc"))
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.compositeBlocks.imageQuote)
          .onChange(async (v) => {
            this.plugin.settings.compositeBlocks.imageQuote = v;
            await this.plugin.saveSettings();
            this.plugin.refreshOutlineTreeViews();
          })
      );
  }
}
