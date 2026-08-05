/**
 * Shared by every Obsidian view in this plugin that needs "the markdown
 * editor this panel is currently about" (OutlineTreeView, PartialEditView
 * — Phase 3B): `workspace.getActiveViewOfType(MarkdownView)` only returns
 * non-null while a markdown leaf actually has focus, and interacting with
 * one of THIS plugin's own sidebar panels moves focus away from the note.
 * Relying on getActiveViewOfType alone would make a panel flash "no
 * active note" every time the user clicks inside it.
 *
 * This tracker caches the most recently focused markdown view and keeps
 * returning it until that leaf is verifiably closed, matching the
 * behavior of Obsidian's own core Outline panel. Originally private
 * methods on OutlineTreeView (Phase 2A); factored out here in Phase 3B so
 * PartialEditView can reuse the exact same logic instead of re-deriving
 * it.
 */
import { App, MarkdownView } from "obsidian";

export class ActiveMarkdownViewTracker {
  private lastView: MarkdownView | null = null;

  constructor(private readonly app: App) {}

  get(): MarkdownView | null {
    const active = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (active) {
      this.lastView = active;
      return active;
    }
    if (this.lastView && this.isStillOpen(this.lastView)) {
      return this.lastView;
    }
    this.lastView = null;
    return null;
  }

  private isStillOpen(view: MarkdownView): boolean {
    return this.app.workspace
      .getLeavesOfType("markdown")
      .some((leaf) => leaf.view === view);
  }
}
