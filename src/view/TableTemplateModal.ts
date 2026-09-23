/**
 * Phase 5E-3a: small dialog shown before inserting a new Markdown table
 * from the Outline Tree — either enter a column count
 * (MIN_TABLE_COLUMNS..MAX_TABLE_COLUMNS) or insert the minimum template
 * (DEFAULT_TABLE_COLUMNS columns × 1 row) as-is.
 *
 * Same Modal contract as HeadingLevelModal: `onChoice` fires exactly once —
 * with the column count, or null on Cancel / dismiss. Nothing is written
 * to the note from here; the caller does the insert.
 */
import { App, Modal } from "obsidian";
import type UnifiedOutlinerPlugin from "../main";
import { DEFAULT_TABLE_COLUMNS, MAX_TABLE_COLUMNS, MIN_TABLE_COLUMNS } from "../edit/codeBlockPresets";

export class TableTemplateModal extends Modal {
  private resolved = false;

  constructor(
    app: App,
    private readonly plugin: UnifiedOutlinerPlugin,
    private readonly onChoice: (columns: number | null) => void
  ) {
    super(app);
  }

  onOpen(): void {
    const t = this.plugin.t.bind(this.plugin);
    this.titleEl.setText(t("modal.insertTableTitle"));
    this.contentEl.addClass("unified-outliner-insert-block-modal");

    const row = this.contentEl.createDiv({ cls: "unified-outliner-insert-block-modal-row" });
    row.createEl("label", {
      text: t("modal.insertTableColumnsLabel", { min: MIN_TABLE_COLUMNS, max: MAX_TABLE_COLUMNS }),
    });
    const inputEl = row.createEl("input", {
      type: "number",
      value: String(DEFAULT_TABLE_COLUMNS),
      attr: { min: String(MIN_TABLE_COLUMNS), max: String(MAX_TABLE_COLUMNS), step: "1" },
    });
    const errorEl = this.contentEl.createDiv({ cls: "unified-outliner-insert-block-modal-error" });

    const submitColumns = () => {
      const n = Number(inputEl.value);
      if (!Number.isInteger(n) || n < MIN_TABLE_COLUMNS || n > MAX_TABLE_COLUMNS) {
        errorEl.setText(t("modal.insertTableInvalidColumns", { min: MIN_TABLE_COLUMNS, max: MAX_TABLE_COLUMNS }));
        return;
      }
      this.choose(n);
    };
    inputEl.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter" && !evt.isComposing) {
        evt.preventDefault();
        submitColumns();
      }
    });

    const buttonsEl = this.contentEl.createDiv({ cls: "modal-button-container" });
    const insertEl = buttonsEl.createEl("button", { text: t("modal.insertBlockConfirm"), cls: "mod-cta" });
    insertEl.addEventListener("click", submitColumns);
    const defaultEl = buttonsEl.createEl("button", {
      text: t("modal.insertTableDefault", { columns: DEFAULT_TABLE_COLUMNS }),
    });
    defaultEl.addEventListener("click", () => this.choose(DEFAULT_TABLE_COLUMNS));
    const cancelEl = buttonsEl.createEl("button", { text: t("common.cancel") });
    cancelEl.addEventListener("click", () => this.choose(null));
    inputEl.focus();
    inputEl.select();
  }

  private choose(columns: number | null): void {
    this.resolved = true;
    this.close();
    this.onChoice(columns);
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.resolved) {
      this.resolved = true;
      this.onChoice(null);
    }
  }
}
