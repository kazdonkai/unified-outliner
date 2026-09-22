import { App, PluginSettingTab, Setting } from "obsidian";
import type UnifiedOutlinerPlugin from "./main";
import {
  DEFAULT_SETTINGS,
  HeadingPrefixStyle,
  ListPrefixStyle,
  OutlineTreeSidebarPosition,
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
  // UXP-05 (2026-08-24, "設定 General タブの並び替え・カテゴリ分け"): every
  // Setting below keeps its own exact name/desc i18n keys, onChange body,
  // and persisted settings key from before this ticket — this remains a
  // *pure UI reorganization* per the class doc comment above. What changed
  // is (a) the ORDER of the `new Setting(...)` calls, and (b) the addition
  // of `.setHeading()` category dividers between them. Fixed leading pair
  // (no heading above them, per the ticket's explicit instruction): 表示言語
  // (language) then アウトラインツリーの既定のサイドバー位置
  // (outlineTreeSidebarPosition) — both are "which context every other
  // setting on this page is read/applied in" style settings, so they stay
  // first. Everything else is grouped into four named categories, each
  // setting appearing in exactly one category:
  //   - アウトラインツリーの表示内容: showListItemsInOutline,
  //     showParagraphsInOutline (what node kinds the Tree shows at all).
  //   - アウトラインツリーの見た目: sectionBackgroundStyle,
  //     listHighlightStyle, headingPrefixStyle, listPrefixStyle (purely
  //     cosmetic rendering of nodes the Tree already shows).
  //   - 移動操作: allowCrossSectionListMove, previewMoveTarget,
  //     showMoveResultToast (what Move block / Move section is allowed to
  //     do, and how its result is surfaced back to the user).
  //   - 編集・操作: normalizeOrderedLists, followKeyboardSelectionIntoBody,
  //     syncOutlineTreeFoldingToEditor, showNoopNotices (remaining editor-
  //     interaction behaviors that don't belong to any of the above three).
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

    // UXP-03 (2026-08-15, "Configurable Outline Tree Sidebar Placement"):
    // deliberately does NOT call refreshOutlineTreeViews() (unlike, e.g.,
    // showListItemsInOutline's onChange below) — this setting only decides
    // where a brand-new Outline Tree View leaf is created the NEXT time
    // activateOutlineTreeView opens one from scratch. Any Outline Tree
    // leaf already open (in either sidebar, or dragged elsewhere by the
    // user) is left exactly where it is; see
    // settingsDefaults.ts's outlineTreeSidebarPosition doc comment for the
    // full rationale and main.ts's activateOutlineTreeView for the read
    // site. UXP-05: kept as the second fixed leading item (right after
    // language), per this ticket's explicit instruction — moved up from
    // its previous position just before the old single "Move & Outline
    // Tree kind highlight" heading.
    new Setting(containerEl)
      .setName(this.plugin.t("settings.outlineTreeSidebarPosition.name"))
      .setDesc(this.plugin.t("settings.outlineTreeSidebarPosition.desc"))
      .addDropdown((d) =>
        d
          .addOption("right", this.plugin.t("settings.outlineTreeSidebarPosition.optionRight"))
          .addOption("left", this.plugin.t("settings.outlineTreeSidebarPosition.optionLeft"))
          .setValue(this.plugin.settings.outlineTreeSidebarPosition)
          .onChange(async (v) => {
            this.plugin.settings.outlineTreeSidebarPosition = v as OutlineTreeSidebarPosition;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(this.plugin.t("settings.outlineTreeContentsHeading"))
      .setHeading();

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

    // Phase 5P-3 ("本文 paragraph の任意 Outline Tree 表示"): same on/off ->
    // refreshOutlineTreeViews() shape as showListItemsInOutline just above,
    // so every already-open Outline Tree View leaf immediately reflects the
    // change in either direction (paragraph nodes appearing, or fully
    // disappearing — see tree/buildOutlineTree.ts's BuildOutlineTreeOptions
    // .paragraphs / view/OutlineTreeView.ts's refresh() for how the mere
    // presence/absence of that option is what gates paragraph projection).
    // The description string (i18n.ts) explicitly says this is read-only
    // navigation display only — it does not enable editing, adding,
    // deleting, or moving a paragraph from the Tree.
    new Setting(containerEl)
      .setName(this.plugin.t("settings.showParagraphsInOutline.name"))
      .setDesc(this.plugin.t("settings.showParagraphsInOutline.desc"))
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.showParagraphsInOutline)
          .onChange(async (v) => {
            this.plugin.settings.showParagraphsInOutline = v;
            await this.plugin.saveSettings();
            this.plugin.refreshOutlineTreeViews();
          })
      );

    // Phase 5E-0 ("Fenced Code Block / Markdown Table 読み取り専用 Outline
    // Tree 投影基盤"): same on/off -> refreshOutlineTreeViews() shape as
    // showParagraphsInOutline just above. Two SEPARATE toggles (not one
    // shared switch) per this ticket's own confirmed user decision — see
    // settingsDefaults.ts's showFencedCodeInOutline/showTablesInOutline
    // doc comments.
    new Setting(containerEl)
      .setName(this.plugin.t("settings.showFencedCodeInOutline.name"))
      .setDesc(this.plugin.t("settings.showFencedCodeInOutline.desc"))
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.showFencedCodeInOutline)
          .onChange(async (v) => {
            this.plugin.settings.showFencedCodeInOutline = v;
            await this.plugin.saveSettings();
            this.plugin.refreshOutlineTreeViews();
          })
      );

    new Setting(containerEl)
      .setName(this.plugin.t("settings.showTablesInOutline.name"))
      .setDesc(this.plugin.t("settings.showTablesInOutline.desc"))
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.showTablesInOutline)
          .onChange(async (v) => {
            this.plugin.settings.showTablesInOutline = v;
            await this.plugin.saveSettings();
            this.plugin.refreshOutlineTreeViews();
          })
      );

    new Setting(containerEl)
      .setName(this.plugin.t("settings.outlineTreeAppearanceHeading"))
      .setHeading();

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

    // UXP-04 (2026-08-15, "Configurable List Marker Prefix Display"): unlike
    // headingPrefixStyle just above, node.prefix is resolved at Tree-BUILD
    // time (buildOutlineTree.ts's listPrefixText), not at render time — but
    // this control still needs to call refreshOutlineTreeViews() on change,
    // same as headingPrefixStyle, since that's what re-runs buildOutlineTree
    // (via refresh()) against the new setting value for every open Outline
    // Tree View leaf.
    new Setting(containerEl)
      .setName(this.plugin.t("settings.listPrefixStyle.name"))
      .setDesc(this.plugin.t("settings.listPrefixStyle.desc"))
      .addDropdown((d) =>
        d
          .addOption("none", this.plugin.t("settings.listPrefixStyle.optionNone"))
          .addOption("marker", this.plugin.t("settings.listPrefixStyle.optionMarker"))
          .setValue(this.plugin.settings.listPrefixStyle)
          .onChange(async (v) => {
            this.plugin.settings.listPrefixStyle = v as ListPrefixStyle;
            await this.plugin.saveSettings();
            this.plugin.refreshOutlineTreeViews();
          })
      );

    new Setting(containerEl)
      .setName(this.plugin.t("settings.moveOperationsHeading"))
      .setHeading();

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

    new Setting(containerEl)
      .setName(this.plugin.t("settings.editingInteractionHeading"))
      .setHeading();

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
