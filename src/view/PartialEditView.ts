/**
 * Phase 3B: Partial Edit Pane (docs/別ペイン実装計画と当面の実装指示.md, forward-looking
 * §7 in spirit — this view is new territory beyond what that doc's earlier
 * phases covered).
 *
 * A focused editing pane for exactly ONE subtree at a time, opened from
 * the Outline Tree View's right-click menu. This is NOT an alternate
 * full-document editor: the original note is always the single source of
 * truth, and this pane only ever holds a temporary, explicitly-applied
 * copy of one subtree's raw Markdown (heading + body + child sections +
 * lists for a section, per section-subtree; item + nested children for a list, per
 * Phase 4A's relocateListSubtree — the exact same range every other
 * block-scoped command already treats as one unit).
 *
 * Deliberately explicit-save, not live-synced: edits made here stay local
 * to the pane's textarea until the user clicks Apply. There is no
 * autosave and no real-time two-way sync with the body editor — see the
 * README's Phase 3B section for the full list of what this phase
 * intentionally does not attempt (multi-node editing, cross-note editing,
 * diff/merge UI, conflict resolution beyond a simple before/after text
 * comparison).
 *
 * Node resolution and the actual text splice are both delegated to
 * ../edit/partialEdit.ts (Obsidian-free, unit-tested) — this view only
 * wires that pure logic to a textarea and to the active note's Editor via
 * ../commands/applyLineEditOutcome.ts, exactly like every other
 * tree-triggered command in this plugin.
 *
 * Phase 4C (list subtrees): originally section-only, this view now loads
 * either kind via the same loadNode()/applyEdit() path — the generalized
 * extractSubtreeText/applySubtreeEdit (edit/partialEdit.ts) don't care
 * which kind of node they're resolving, so nothing here branches on
 * section vs. list except the header label (renderLoadedState below) and
 * the small "(空の list 項目)" vs "(無題の見出し)" placeholder text used
 * when a node's own label is empty. Everything else — the textarea, the
 * Apply/Cancel/Close buttons, the conflict check, the unsafeIndent
 * refusal for list nodes — is one shared code path.
 *
 * Real-device follow-up: the header's Apply/Cancel row also has a one-click
 * × (close) button, `this.leaf.detach()` under the hood — before this,
 * closing the pane required Obsidian's own tab-close affordances (the
 * tab's native × or the right-click "Close tab" menu item), a two-step
 * detour compared to every other button on this pane's own header. Closing
 * this way still never applies pending edits, exactly like Cancel and the
 * pre-existing onClose() already didn't.
 */
import { ItemView, Notice, WorkspaceLeaf, setIcon, setTooltip } from "obsidian";
import type UnifiedOutlinerPlugin from "../main";
import { parseDocument } from "../parser/parseDocument";
import { isListNode, isSectionNode } from "../model/block";
import { applySubtreeEdit, extractSubtreeText, SubtreeKind } from "../edit/partialEdit";
import { listItemDisplayText } from "../tree/buildOutlineTree";
import { applyLineEditOutcome, NOOP_MESSAGES } from "../commands/applyLineEditOutcome";

export const PARTIAL_EDIT_VIEW_TYPE = "unified-outliner-partial-edit";

export class PartialEditView extends ItemView {
  // Shared with OutlineTreeView via plugin.activeMarkdownView, not a local
  // instance. A freshly constructed tracker has no cached view yet, and by
  // the time loadSection() below would call .get(), main.ts's
  // activatePartialEditView has already revealed this pane's own leaf —
  // which shifts workspace.getActiveViewOfType(MarkdownView) to null. The
  // shared, plugin-owned tracker is already warmed up by then (either by
  // OutlineTreeView's continuous refresh cycle, or by
  // activatePartialEditView's own explicit warm-up call), so it still
  // resolves correctly. See the doc comment on the field in main.ts.
  private get activeMarkdownView() {
    return this.plugin.activeMarkdownView;
  }

  private nodeId: string | null = null;
  private nodeKind: SubtreeKind | null = null;
  private label = "";
  /** The pane's "before editing" snapshot — see edit/partialEdit.ts's applySubtreeEdit doc comment. */
  private originalText = "";

  private titleEl!: HTMLElement;
  private textareaEl!: HTMLTextAreaElement;
  private applyButtonEl!: HTMLButtonElement;
  private cancelButtonEl!: HTMLButtonElement;
  private closeButtonEl!: HTMLElement;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: UnifiedOutlinerPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return PARTIAL_EDIT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Unified Outliner: Partial Edit";
  }

  getIcon(): string {
    return "edit-3";
  }

  /**
   * Real-device report, two rounds: (1) force-closing this pane after
   * Obsidian's startup layout restore (via workspace.onLayoutReady) caused
   * a visible flash — the leaf was already drawn once before being
   * removed; (2) leaving the restored, empty pane in place instead was
   * worse — it can end up as an orphaned, blank panel with no Outline Tree
   * View nearby to reload it from, which reads as broken rather than
   * merely idle.
   *
   * `workspace.layoutReady` is false only while Obsidian is still
   * reconstructing the saved workspace at startup, and is permanently true
   * for the rest of the session afterward (including every live open via
   * activatePartialEditView). Checking it here, synchronously, at the very
   * start of onOpen — before any DOM is built — means a restored instance
   * detaches itself before it is ever painted, instead of appearing and
   * then disappearing. A live, user-triggered open (layoutReady already
   * true by then) is completely unaffected and renders normally below.
   */
  async onOpen(): Promise<void> {
    if (!this.app.workspace.layoutReady) {
      this.leaf.detach();
      return;
    }

    this.contentEl.empty();
    this.contentEl.addClass("unified-outliner-partial-edit-view");

    const headerEl = this.contentEl.createDiv({ cls: "unified-outliner-partial-edit-header" });
    this.titleEl = headerEl.createDiv({ cls: "unified-outliner-partial-edit-title" });

    const actionsEl = headerEl.createDiv({ cls: "unified-outliner-partial-edit-actions" });
    this.applyButtonEl = actionsEl.createEl("button", { text: "Apply", cls: "mod-cta" });
    this.applyButtonEl.addEventListener("click", () => this.applyEdit());
    this.cancelButtonEl = actionsEl.createEl("button", { text: "Cancel" });
    this.cancelButtonEl.addEventListener("click", () => this.cancelEdit());
    // One-click close, in addition to Obsidian's own tab-close affordances
    // (native tab × / right-click "Close tab"). Deliberately NOT gated by
    // whether a section is loaded — unlike Apply/Cancel, closing the pane
    // is always a valid action. Discards any unsaved edit exactly like
    // Cancel/onClose already do; no confirmation prompt (see onClose's doc
    // comment — Close has never applied pending edits in this pane).
    this.closeButtonEl = actionsEl.createDiv({
      cls: "unified-outliner-partial-edit-close clickable-icon",
    });
    setIcon(this.closeButtonEl, "x");
    setTooltip(this.closeButtonEl, "Close");
    this.closeButtonEl.addEventListener("click", () => this.leaf.detach());

    this.textareaEl = this.contentEl.createEl("textarea", {
      cls: "unified-outliner-partial-edit-textarea",
    });

    this.renderEmptyState();
  }

  async onClose(): Promise<void> {
    // Intentionally no auto-save here: per the Phase 3B design, Close
    // (like Cancel) never applies pending edits — only the Apply button
    // does. Nothing to clean up beyond the DOM itself.
    this.contentEl.empty();
  }

  /**
   * Load `nodeId` (a section OR a list item id) from the currently active
   * note into this pane, replacing whatever was loaded before (the pane
   * always holds at most one node — see the "reuse, don't multiply" leaf
   * policy in main.ts's activatePartialEditView, mirroring
   * activateOutlineTreeView). Public so OutlineTreeView's "Open partial
   * edit pane" / "Edit list subtree in pane" menu items (and main.ts) can
   * drive it without reaching into private state.
   *
   * Phase 4C: renamed from loadSection, now dispatches to
   * extractSubtreeText rather than the section-only extractSectionText —
   * a list item with unsafeIndent is refused here (reason "unsafe-indent",
   * see edit/partialEdit.ts) exactly like an unresolvable id is.
   */
  loadNode(nodeId: string): void {
    const view = this.activeMarkdownView.get();
    if (!view) {
      new Notice("Unified Outliner: no active note to load a node from.");
      return;
    }

    const doc = parseDocument(view.editor.getValue());
    const extracted = extractSubtreeText(doc, nodeId);
    if (!extracted.ok || !extracted.kind) {
      new Notice(
        NOOP_MESSAGES[extracted.reason ?? "resolve-failed"] ??
          "Unified Outliner: could not load that node."
      );
      return;
    }

    const node = doc.nodes.get(nodeId);
    const label =
      node && isSectionNode(node)
        ? node.headingText.length > 0
          ? node.headingText
          : "(無題の見出し)"
        : node && isListNode(node)
          ? (() => {
              const text = listItemDisplayText(doc, node);
              return text.length > 0 ? text : "(空の list 項目)";
            })()
          : "";

    this.nodeId = nodeId;
    this.nodeKind = extracted.kind;
    this.originalText = extracted.text;
    this.label = label;
    this.renderLoadedState();
  }

  private renderEmptyState(): void {
    this.titleEl.setText("Unified Outliner: Partial Edit");
    this.textareaEl.value = "";
    this.textareaEl.disabled = true;
    this.applyButtonEl.disabled = true;
    this.cancelButtonEl.disabled = true;
    this.textareaEl.setAttribute(
      "placeholder",
      "Outline Tree View でノードを右クリックし、「Open partial edit pane」／「Edit list subtree in pane」を選ぶとここに編集対象が読み込まれます。"
    );
  }

  /**
   * Phase 4C: the title now prefixes the node's kind (Section / List) so
   * the pane stays honest about what range Apply will replace, without
   * otherwise treating the two kinds differently — see class doc comment.
   */
  private renderLoadedState(): void {
    const kindLabel = this.nodeKind === "list" ? "List" : "Section";
    this.titleEl.setText(`Editing (${kindLabel}): ${this.label}`);
    this.textareaEl.disabled = false;
    this.applyButtonEl.disabled = false;
    this.cancelButtonEl.disabled = false;
    this.textareaEl.value = this.originalText;
  }

  /** Revert unsaved edits in the textarea — does not close the pane or change which node is loaded. */
  private cancelEdit(): void {
    if (!this.nodeId) return;
    this.textareaEl.value = this.originalText;
  }

  /**
   * Apply the textarea's current content back to the active note, via the
   * same resolve-fresh -> compute outcome -> applyLineEditOutcome pipeline
   * every other tree-triggered command in this plugin uses. Unlike a
   * passive no-op (which respects the "Show no-op notices" setting), a
   * failed Apply always shows a Notice — silently doing nothing in
   * response to an explicit Apply click would be actively confusing.
   */
  private applyEdit(): void {
    if (!this.nodeId) {
      new Notice("Unified Outliner: no node loaded in this pane.");
      return;
    }
    const view = this.activeMarkdownView.get();
    if (!view) {
      new Notice("Unified Outliner: no active note to apply to.");
      return;
    }
    const editor = view.editor;
    if (editor.listSelections().length > 1) {
      new Notice("Unified Outliner: multiple cursors are not supported.");
      return;
    }

    const doc = parseDocument(editor.getValue());
    const outcome = applySubtreeEdit(doc, this.nodeId, this.originalText, this.textareaEl.value);
    const node = doc.nodes.get(this.nodeId);
    const startLine = node ? node.range.startLine : 0;

    if (!outcome.changed) {
      new Notice(
        NOOP_MESSAGES[outcome.reason ?? "resolve-failed"] ??
          "Unified Outliner: could not apply this edit."
      );
      return;
    }

    // outcome.changed is already true here, so applyLineEditOutcome's own
    // no-op branch never fires — the notify callback is unreachable, but
    // required by its signature.
    applyLineEditOutcome(
      editor,
      { line: startLine, ch: 0 },
      startLine,
      doc.lines,
      outcome,
      () => {}
    );

    this.originalText = this.textareaEl.value;

    const lineLen = editor.getLine(outcome.newStartLine)?.length ?? 0;
    editor.scrollIntoView(
      { from: { line: outcome.newStartLine, ch: 0 }, to: { line: outcome.newStartLine, ch: lineLen } },
      true
    );

    new Notice(
      this.nodeKind === "list" ? "Unified Outliner: list subtree updated." : "Unified Outliner: section updated."
    );
  }
}
