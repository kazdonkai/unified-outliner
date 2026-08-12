import { App, PluginSettingTab, Setting } from "obsidian";
import type UnifiedOutlinerPlugin from "./main";
import {
  DEFAULT_SETTINGS,
  HeadingPrefixStyle,
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

/**
 * Settings tab ids (2026-08-12 UI reorganization ticket). Purely a display
 * grouping — see this file's UnifiedOutlinerSettingTab doc comment. Kept as
 * a narrow union (not a generic string) so `renderTabBar`'s tab list and
 * `display()`'s switch stay exhaustive-checked by the compiler as more tabs
 * are added later.
 */
type SettingsTabId = "general" | "compositeBlock";

/**
 * Obsidian's PluginSettingTab has no official "sub-tabs" API, so this class
 * uses the same self-rolled pattern most large community plugins use: a row
 * of plain buttons at the top of `containerEl`, and a single content `div`
 * below it whose children are fully replaced on every tab switch. See the
 * 2026-08-12 "設定画面のタブ化" ticket — this is a *pure UI reorganization*:
 * every setting key, default value, persisted data shape, toggle, and
 * description string below is byte-for-byte identical to the pre-tab
 * version; only which top-level container each `Setting` is appended to
 * (and therefore which tab it's visible under) has changed. Do not fold
 * behavior changes into this class without a separate justification.
 */
export class UnifiedOutlinerSettingTab extends PluginSettingTab {
  plugin: UnifiedOutlinerPlugin;

  // Persisted only for the lifetime of this tab instance (not saved to
  // disk) — re-opening Settings always starts back on "general". Kept as
  // instance state (rather than a local in display()) specifically so that
  // display()'s own re-render calls (e.g. after changing the language,
  // below) keep the user on whichever tab they were already looking at
  // instead of snapping back to the first one.
  private activeTab: SettingsTabId = "general";

  constructor(app: App, plugin: UnifiedOutlinerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    this.renderTabBar(containerEl);

    const content = containerEl.createDiv({
      cls: "unified-outliner-settings-tab-content",
    });
    if (this.activeTab === "compositeBlock") {
      this.renderCompositeBlockTab(content);
    } else {
      this.renderGeneralTab(content);
    }
  }

  /**
   * Tab list is intentionally a plain array literal (not a loop over some
   * external registry) — with only two tabs today, a registry would be
   * premature generality. Add entries here directly when a third tab is
   * needed (see the ticket: fold-state settings were explicitly named as a
   * candidate, deferred until actually needed).
   */
  private renderTabBar(containerEl: HTMLElement): void {
    const tabBar = containerEl.createDiv({ cls: "unified-outliner-settings-tab-bar" });
    const tabs: Array<{ id: SettingsTabId; label: string }> = [
      { id: "general", label: this.plugin.t("settings.tabs.general") },
      { id: "compositeBlock", label: this.plugin.t("settings.tabs.compositeBlock") },
    ];
    for (const tab of tabs) {
      const isActive = this.activeTab === tab.id;
      const button = tabBar.createEl("button", {
        text: tab.label,
        cls:
          "unified-outliner-settings-tab-button" +
          (isActive ? " unified-outliner-settings-tab-button-active" : ""),
      });
      button.setAttribute("type", "button");
      button.setAttribute("aria-selected", String(isActive));
      button.addEventListener("click", () => {
        if (this.activeTab === tab.id) return;
        this.activeTab = tab.id;
        this.display();
      });
    }
  }

  // ---- "General" tab ------------------------------------------------------
  // Every Setting below is unchanged from the pre-tab display(): same
  // name/desc keys, same onChange bodies, same order relative to each
  // other. Only the destination container (the tab's content div instead
  // of the top-level containerEl) is new.
  private renderGeneralTab(containerEl: HTMLElement): void {
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
      .setName(this.plugin.t("settings.headingPrefixStyle.name"))
      .setDesc(this.plugin.t("settings.headingPrefixStyle.desc"))
      .addDropdown((d) =>
        d
          .addOption("none", this.plugin.t("settings.headingPrefixStyle.optionNone"))
          .addOption("hLevel", this.plugin.t("settings.headingPrefixStyle.optionHLevel"))
          .addOption("atx", this.plugin.t("settings.headingPrefixStyle.optionAtx"))
          .setValue(this.plugin.settings.headingPrefixStyle)
          .onChange(async (v) => {
            this.plugin.settings.headingPrefixStyle = v as HeadingPrefixStyle;
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
  }

  // ---- "Composite blocks" tab ---------------------------------------------
  // Split out verbatim from the old display() so future rules (per the
  // 2026-08-12 ticket's stated motivation — more built-in rules, and
  // eventually a free-form rule-editing UI) have a dedicated single-screen
  // home instead of being interleaved with unrelated general settings.
  private renderCompositeBlockTab(containerEl: HTMLElement): void {
    // Phase 5D-0 / 5D-0.3: CompositeBlock rules — enable/disable toggles for
    // the two built-in default rules (model/compositeBlock.ts). Per the
    // 5D-0.3 approval (§4 — no separate "show composite blocks" toggle), a
    // rule's own enabled flag is the SOLE control for both matching AND
    // Outline Tree projection: turning a rule off here makes
    // OutlineTreeView.refresh() stop grouping its member blocks, which is
    // why (unlike most other flat toggles above) this one also calls
    // refreshOutlineTreeViews() so an already-open Tree reflects the change
    // immediately, matching showListItemsInOutline's own onChange above.
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
