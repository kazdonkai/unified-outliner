/**
 * Phase 5E-1 ("fenced code block の raw Partial Edit・移動・削除"): confirmation
 * modal shown before deleting a standalone fenced-code (or, as of Phase
 * 5E-3d, table) block from the Outline Tree. Deliberately mirrors
 * view/ConfirmParagraphDeleteModal.ts
 * byte-for-byte in structure (itself mirroring
 * view/ConfirmCompositeDeleteModal.ts) — same `resolved` flag, same
 * `onChoice` firing exactly once whether from an explicit button click
 * (choose()) or an implicit dismiss (onClose(), Escape/backdrop click),
 * with the implicit-dismiss case always resolving to the SAFE choice
 * ("not confirmed").
 *
 * Shows only a minimal summary — the block's own short Tree-row label and
 * its 1-based line range — never the fenced-code block's own body text.
 * Exactly like ConfirmParagraphDeleteModal's own doc comment explains:
 * this is display-only information for the user's own judgment; it plays
 * no role in whether the deletion is actually safe — that is decided
 * entirely by edit/deleteStandaloneComplexBlock.ts's own
 * re-parse/re-scan/re-resolve/re-verify pipeline at the moment "Delete" is
 * clicked (see view/OutlineTreeView.ts#dispatchAndApplyStandaloneComplexBlockDelete).
 *
 * No `.focus()` call is made on either button, for the exact same reason
 * ConfirmParagraphDeleteModal's own doc comment gives: Obsidian's Modal API
 * gives no documented guarantee about which element (if any) receives
 * initial keyboard focus, so Enter is intentionally left unbound to
 * "Delete".
 *
 * Phase 5E-3d ("Table Move/Delete/DnD Parity") widens this modal to also
 * cover a standalone table block, reusing this exact same class rather
 * than a parallel modal — the constructor now takes a `kind` parameter
 * ("fenced-code" | "table", the same StandaloneComplexBlockDeleteKind
 * edit/deleteStandaloneComplexBlock.ts itself uses) that selects only the
 * TITLE text (`modal.deleteFencedCodeTitle` vs the new
 * `modal.deleteTableTitle`); the body and undo-note copy were already
 * kind-neutral ("This will remove ... from the note." / "This can be
 * undone with Obsidian's own Undo.") and are reused unchanged for both
 * kinds.
 *
 * > **2026-09-24 追記（follow-up ticket, standalone callout/blockquote
 * > Delete）**: `kind` now also admits "callout"/"blockquote" — this
 * > class needed no structural change at all, only two more TITLE-key
 * > branches (`modal.deleteCalloutTitle`/`modal.deleteBlockquoteTitle`),
 * > reusing the same already-kind-neutral body/undo-note copy a fourth
 * > time. See edit/deleteStandaloneComplexBlock.ts's own dated addendum
 * > for why this widening is safe.
 */
import { App, Modal } from "obsidian";
import type UnifiedOutlinerPlugin from "../main";
import { LineRange } from "../model/block";
import { StandaloneComplexBlockDeleteKind } from "../edit/deleteStandaloneComplexBlock";

export class ConfirmFencedCodeDeleteModal extends Modal {
  private resolved = false;

  constructor(
    app: App,
    private readonly plugin: UnifiedOutlinerPlugin,
    private readonly kind: StandaloneComplexBlockDeleteKind,
    private readonly label: string,
    private readonly range: LineRange,
    private readonly onChoice: (confirmed: boolean) => void
  ) {
    super(app);
  }

  onOpen(): void {
    // Phase 5M-2: "paragraph" is only ever a mirror embed line (see
    // edit/deleteStandaloneComplexBlock.ts#buildMirrorEmbedDeleteSnapshot).
    const titleKey =
      this.kind === "paragraph"
        ? "modal.deleteMirrorTitle"
        : this.kind === "table"
        ? "modal.deleteTableTitle"
        : this.kind === "callout"
          ? "modal.deleteCalloutTitle"
          : this.kind === "blockquote"
            ? "modal.deleteBlockquoteTitle"
            : "modal.deleteFencedCodeTitle";
    this.titleEl.setText(this.plugin.t(titleKey));

    // 1-based, human-facing line numbers — range.startLine/endLine
    // themselves are the existing 0-based ParsedDocument convention used
    // everywhere else in this codebase; this is display-only, never fed
    // back into deleteStandaloneComplexBlock.
    this.contentEl.createEl("p", {
      text: this.plugin.t("modal.deleteFencedCodeBody", {
        label: this.label,
        startLine: this.range.startLine + 1,
        endLine: this.range.endLine + 1,
      }),
    });
    if (this.kind === "paragraph") {
      this.contentEl.createEl("p", { text: this.plugin.t("modal.deleteMirrorNote") });
    }
    this.contentEl.createEl("p", {
      text: this.plugin.t("modal.deleteFencedCodeUndoNote"),
      cls: "unified-outliner-fenced-code-delete-modal-undo-note",
    });

    const buttonsEl = this.contentEl.createDiv({
      cls: "unified-outliner-fenced-code-delete-modal-buttons",
    });
    // Cancel listed first (the safe default) and intentionally NOT
    // `.focus()`ed — see this class's own doc comment.
    const cancelEl = buttonsEl.createEl("button", { text: this.plugin.t("common.cancel") });
    cancelEl.addEventListener("click", () => this.choose(false));
    const deleteEl = buttonsEl.createEl("button", {
      text: this.plugin.t("common.delete"),
      cls: "mod-warning",
    });
    deleteEl.addEventListener("click", () => this.choose(true));
  }

  private choose(confirmed: boolean): void {
    this.resolved = true;
    this.close();
    this.onChoice(confirmed);
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.resolved) {
      this.onChoice(false);
    }
  }
}
