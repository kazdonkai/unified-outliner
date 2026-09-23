/**
 * Phase 5E-3a: language selector shown before inserting a new fenced code
 * block from the Outline Tree. Options come from the single CodeBlockPreset
 * registry (edit/codeBlockPresets.ts) plus a "Custom…" entry that reveals a
 * free-text info-string input (validated by validateCustomInfoString).
 *
 * Same Modal contract as HeadingLevelModal: `onChoice` fires exactly once —
 * with the chosen { infoString, bodyTemplate }, or null on Cancel / dismiss.
 * Nothing is written to the note from here; the caller does the insert.
 */
import { App, Modal } from "obsidian";
import type UnifiedOutlinerPlugin from "../main";
import { CODE_BLOCK_PRESETS, findCodeBlockPreset, validateCustomInfoString } from "../edit/codeBlockPresets";

export interface CodeBlockPresetChoice {
  infoString: string;
  bodyTemplate: string;
}

const CUSTOM_VALUE = "__custom__";

export class CodeBlockPresetModal extends Modal {
  private resolved = false;

  constructor(
    app: App,
    private readonly plugin: UnifiedOutlinerPlugin,
    private readonly onChoice: (choice: CodeBlockPresetChoice | null) => void
  ) {
    super(app);
  }

  onOpen(): void {
    const t = this.plugin.t.bind(this.plugin);
    this.titleEl.setText(t("modal.insertCodeBlockTitle"));
    this.contentEl.addClass("unified-outliner-insert-block-modal");

    const row = this.contentEl.createDiv({ cls: "unified-outliner-insert-block-modal-row" });
    row.createEl("label", { text: t("partialEdit.fencedCode.languageLabel") });
    const selectEl = row.createEl("select", { cls: "dropdown" });
    for (const preset of CODE_BLOCK_PRESETS) {
      selectEl.createEl("option", { value: preset.id, text: t(preset.labelKey) });
    }
    selectEl.createEl("option", { value: CUSTOM_VALUE, text: t("partialEdit.fencedCode.lang.custom") });

    const customInputEl = this.contentEl.createEl("input", {
      type: "text",
      cls: "unified-outliner-insert-block-modal-custom",
      attr: { placeholder: t("modal.insertCodeBlockCustomPlaceholder") },
    });
    customInputEl.toggleVisibility(false);
    const errorEl = this.contentEl.createDiv({ cls: "unified-outliner-insert-block-modal-error" });

    selectEl.addEventListener("change", () => {
      const isCustom = selectEl.value === CUSTOM_VALUE;
      customInputEl.toggleVisibility(isCustom);
      errorEl.setText("");
      if (isCustom) customInputEl.focus();
    });

    const submit = () => {
      if (selectEl.value === CUSTOM_VALUE) {
        const v = validateCustomInfoString(customInputEl.value);
        if (!v.ok) {
          errorEl.setText(t("modal.insertCodeBlockInvalidInfoString"));
          return;
        }
        this.choose({ infoString: v.infoString, bodyTemplate: "" });
        return;
      }
      const preset = findCodeBlockPreset(selectEl.value);
      if (!preset) return;
      this.choose({ infoString: preset.infoString, bodyTemplate: preset.bodyTemplate });
    };
    customInputEl.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter" && !evt.isComposing) {
        evt.preventDefault();
        submit();
      }
    });

    const buttonsEl = this.contentEl.createDiv({ cls: "modal-button-container" });
    const insertEl = buttonsEl.createEl("button", { text: t("modal.insertBlockConfirm"), cls: "mod-cta" });
    insertEl.addEventListener("click", submit);
    const cancelEl = buttonsEl.createEl("button", { text: t("common.cancel") });
    cancelEl.addEventListener("click", () => this.choose(null));
    selectEl.focus();
  }

  private choose(choice: CodeBlockPresetChoice | null): void {
    this.resolved = true;
    this.close();
    this.onChoice(choice);
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.resolved) {
      this.resolved = true;
      this.onChoice(null);
    }
  }
}
