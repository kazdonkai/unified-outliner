/**
 * Phase 4E: Obsidian-dependent glue around persistence/foldStateStore.ts's
 * pure functions — owns the plugin-wide in-memory FoldStateData blob, and
 * is the only thing that knows how it gets to/from disk.
 *
 * ONE instance is created by UnifiedOutlinerPlugin and shared by every
 * OutlineTreeView leaf (`plugin.foldStateManager`), the same sharing
 * pattern view/activeMarkdownViewTracker.ts already established for
 * ActiveMarkdownViewTracker — see that class's doc comment for the
 * general rationale (one plugin-owned service instance, not one per
 * view). Here specifically: fold state is persisted per FILE, not per
 * view/leaf, so a single shared store is the only representation that
 * makes sense — two OutlineTreeView leaves showing the same file should
 * read/write the same underlying data.
 *
 * Multiple leaves concurrently open on the SAME file was explicitly out of
 * scope for Phase 4E (see docs/fold-state-spec.md §3/§6, and the Phase 4E
 * design report). Phase 4F (docs/fold-state-conflict-resolution-spec.md)
 * narrows, rather than removes, that gap:
 *   - Multiple OutlineTreeView leaves (e.g. a manually split/duplicated
 *     Tree panel) now stay in sync with each other on every Tree-origin
 *     write — see view/OutlineTreeView.ts's setNodeCollapsed and
 *     main.ts's refreshOtherOutlineTreeViews.
 *   - Multiple MARKDOWN leaves of the same file (a split view, or a
 *     future Phase 5 popout) remain simple, deliberate last-write-wins,
 *     scoped to whichever leaf is ACTIVE at the moment of the CM6 fold —
 *     see view/OutlineTreeView.ts's handleCm6FoldEffect and its
 *     "Active-leaf-only" comment. This class itself needed no change for
 *     that half: setNodeCollapsed here still just overwrites the
 *     identity's stored boolean unconditionally, exactly as before —
 *     Phase 4F's contribution was formalizing which CALLER is allowed to
 *     invoke it under which condition, not changing what this method
 *     does with what it's given.
 * The Partial Edit Pane's own conflict detection (edit/partialEdit.ts)
 * remains intentionally unintegrated with this class — see that module's
 * doc comment and docs/fold-state-conflict-resolution-spec.md §3.
 *
 * Persisted alongside plugin settings in the SAME data.json (see
 * main.ts's persistData/loadSettings) rather than a second file — this
 * plugin has exactly one JSON blob, and foldState is just one more key in
 * it, serialized/deserialized here but written to disk by the plugin
 * itself (persistData composes `{ ...settings, foldState }` before
 * calling saveData — this class never calls saveData directly, so it
 * never needs to know the settings shape).
 */
import { debounce } from "obsidian";
import type UnifiedOutlinerPlugin from "../main";
import {
  FoldStateData,
  getCollapsedIdentities,
  normalizeFoldStateData,
  withFileRenamed,
  withNodeCollapsed,
} from "./foldStateStore";

export class FoldStateManager {
  private data: FoldStateData = {};
  private dirty = false;

  constructor(private readonly plugin: UnifiedOutlinerPlugin) {}

  /** Called once from main.ts's loadSettings(), with the raw `foldState`
   * value read from data.json (may be undefined/malformed — see
   * normalizeFoldStateData). */
  load(raw: unknown): void {
    this.data = normalizeFoldStateData(raw);
  }

  /** Snapshot handed to main.ts's persistData() to fold into the single
   * saved data.json blob. Always the live in-memory data — callers that
   * need the on-disk copy to be current should call flush() first. */
  serialize(): FoldStateData {
    return this.data;
  }

  getCollapsedIdentities(filePath: string): Set<string> {
    return getCollapsedIdentities(this.data, filePath);
  }

  /**
   * Write-through: updates the in-memory store immediately (so the very
   * next OutlineTreeView.refresh() — even one that runs before the debounce
   * timer below fires — already sees the change), then schedules a
   * debounced disk save. Rapid toggling (e.g. holding an arrow key) only
   * incurs one disk write per debounce window, not one per keystroke.
   */
  setNodeCollapsed(filePath: string, identity: string, collapsed: boolean): void {
    const next = withNodeCollapsed(this.data, filePath, identity, collapsed);
    if (next === this.data) return; // no-op, already in the requested state
    this.data = next;
    this.dirty = true;
    this.scheduleSave();
  }

  /** Vault "rename" event handler (see main.ts's onload) — a rename/move
   * is just a path change from this store's point of view (see
   * foldStateStore.ts's withFileRenamed doc comment). */
  handleRename(oldPath: string, newPath: string): void {
    const next = withFileRenamed(this.data, oldPath, newPath);
    if (next === this.data) return;
    this.data = next;
    this.dirty = true;
    this.scheduleSave();
  }

  private readonly scheduleSave = debounce(
    () => {
      void this.flush();
    },
    500,
    true
  );

  /**
   * Immediate (non-debounced) write of any pending change. Called from
   * OutlineTreeView.onClose() and UnifiedOutlinerPlugin.onunload() so a
   * mutation made just before closing a leaf or disabling the plugin isn't
   * silently dropped by the still-pending debounce timer — see the Phase
   * 4E design report's explicit ask to confirm this path exists. Obsidian
   * doesn't guarantee awaiting onunload's own async work, so this is a
   * best-effort flush, not a hard guarantee under every shutdown path
   * (e.g. the OS killing the process) — the same caveat every Obsidian
   * plugin's onunload persistence is subject to.
   */
  async flush(): Promise<void> {
    if (!this.dirty) return;
    this.dirty = false;
    await this.plugin.persistData();
  }
}
