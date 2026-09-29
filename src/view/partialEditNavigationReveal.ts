/**
 * 2026-09-30 (Partial Edit Pane navigation -> body editor sync): the pure,
 * Obsidian-free decision of WHEN the Partial Edit Pane moves the body
 * editor after a target switch. See settingsDefaults.ts's
 * syncEditorOnPartialEditNavigation for the user-facing setting.
 *
 * Only user-initiated navigation INSIDE the pane asks for a reveal
 * (`revealInEditor: true` — breadcrumb segments, previous/next sibling,
 * Subtree Navigator chips, child-preview rows, image-ocr Previous/Next).
 * Every other load path never passes it: the Tree-triggered open (the
 * Tree has already jumped the editor itself), auto-reload, the
 * post-Apply rebuild and manual Reload do not go through a navigation
 * entry point at all.
 */

/** Option bag for PartialEditView's navigation entry points. */
export interface PartialEditNavigationOptions {
  /** True only for an explicit user navigation inside the pane. */
  revealInEditor?: boolean;
}

/**
 * A comparable identity for "what the pane has loaded", used to tell a
 * real target switch from reloading the same target. Null when nothing
 * (or a paragraph, which has no in-pane navigation) is loaded.
 */
export function partialEditTargetKey(nodeId: string | null, compositeStartLine: number | null): string | null {
  if (nodeId !== null) return `node:${nodeId}`;
  if (compositeStartLine !== null) return `composite:${compositeStartLine}`;
  return null;
}

export interface RevealAfterNavigationInput {
  /** The caller passed `revealInEditor: true` (explicit user navigation). */
  revealRequested: boolean;
  /** settings.syncEditorOnPartialEditNavigation. */
  settingEnabled: boolean;
  /** partialEditTargetKey before the load was attempted. */
  keyBefore: string | null;
  /** partialEditTargetKey after the load (null when the load failed and the pane emptied). */
  keyAfter: string | null;
}

/**
 * Reveal only when explicitly requested, enabled in settings, the load
 * actually succeeded (something is loaded afterwards) and it is a
 * DIFFERENT target than before (never on a same-target reload).
 */
export function shouldRevealAfterNavigation(input: RevealAfterNavigationInput): boolean {
  return (
    input.revealRequested &&
    input.settingEnabled &&
    input.keyAfter !== null &&
    input.keyAfter !== input.keyBefore
  );
}
