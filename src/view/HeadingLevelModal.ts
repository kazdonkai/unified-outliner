/**
 * Phase 5C-1A/1B: explicit heading-level picker for inserting a new
 * sibling section (edit/insertBlock.ts's insertSiblingSection). The level
 * is never inferred from context — this modal is the only place a level is
 * chosen, mirroring PartialEditView.ts's DiscardChangesModal pattern
 * (Modal subclass, `resolved` flag, onChoice fires exactly once whether
 * from an explicit button click or an implicit dismiss).
 *
 * Obsidian's Menu/MenuItem API (this plugin's target version) has no
 * submenu support, which is why this is a small Modal with one button per
 * level rather than a "Insert section ▸ H1..H6" submenu item.
 */
import { App, Modal } from "obsidian";

export class HeadingLevelModal extends Modal {
  private resolved = false;

  constructor(app: App, private readonly onChoice: (level: number | null) => void) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText("Unified Outliner: insert section");
    this.contentEl.createEl("p", {
      text: "Choose the heading level for the new section.",
    });

    const buttonsEl = this.contentEl.createDiv({
      cls: "unified-outliner-heading-level-modal-buttons",
    });
    for (let level = 1; level <= 6; level++) {
      const btn = buttonsEl.createEl("button", { text: `H${level}` });
      btn.addEventListener("click", () => this.choose(level));
    }
    const cancelEl = this.contentEl.createEl("button", {
      text: "Cancel",
      cls: "unified-outliner-heading-level-modal-cancel",
    });
    cancelEl.addEventListener("click", () => this.choose(null));
  }

  private choose(level: number | null): void {
    this.resolved = true;
    this.close();
    this.onChoice(level);
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.resolved) {
      this.onChoice(null);
    }
  }
}
