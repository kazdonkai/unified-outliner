/**
 * Phase 5A-1 hardening §4 ("Partial Edit Pane hardening",
 * docs/phase5a1_partial_edit_stale_pane_synchronization_design.md's own
 * hardening appendix): pure, Obsidian-free decision logic extracted from
 * PartialEditView's stale-check pipeline (performStaleCheck /
 * evaluateAgainstText) so it can be covered by real-assertion unit tests
 * without a full Obsidian mock harness — this ticket's own explicit
 * requirement is that no such harness be built (PartialEditView extends
 * Obsidian's ItemView and imports "obsidian" at module scope, which has no
 * runtime in this repo's test environment — see
 * tests/partialEditStalePaneSyncUiWiring.test.ts's own doc comment for the
 * prior investigation confirming this). view/PartialEditView.ts is the
 * only caller; every side effect (mutating syncState/originalText/anchor/
 * textarea, scheduling a debounced re-check, showing a Notice) stays
 * there — this module only ever answers "what should happen", never
 * performs it, and never imports anything from "obsidian".
 *
 * Two separate decisions, mirroring the two separate gates the view
 * actually applies:
 *   - shouldRunStaleCheck: performStaleCheck's own top-level gate (closed
 *     pane / self-Apply suppression window / already-"unavailable" — see
 *     each field's own doc comment on PartialEditView for why each one is
 *     a hard stop rather than a state to re-evaluate here).
 *   - classifySyncOutcome: evaluateAgainstText's own classification of a
 *     resolveCurrentTarget() result into what the pane should transition
 *     to — see that method's own doc comment on PartialEditView for the
 *     full clean-Pane-auto-reload condition list this mirrors.
 */

export interface StaleCheckGateInput {
  /** PartialEditView#closed — set once in onClose. */
  closed: boolean;
  /**
   * PartialEditView#isApplyingOwnEdit — the self-Apply suppression window
   * (hardening §1) spanning applyEdit()'s own note-mutating call through
   * this pane's own re-anchoring completing.
   */
  suppressed: boolean;
  /** PartialEditView#syncState at the moment the check would run. */
  currentSyncState: "synced" | "stale" | "unavailable";
}

/**
 * Whether performStaleCheck should proceed at all. `false` in every case
 * covered here means "silently do nothing" — never an error, never a
 * Notice; each of the three gates is itself a normal, expected state (a
 * closed pane, a self-Apply currently in progress, or an already-
 * "unavailable" pane that only ever clears via an explicit Reload — see
 * PartialEditView#syncState's own doc comment for why "unavailable"
 * deliberately never auto-clears itself).
 */
export function shouldRunStaleCheck(input: StaleCheckGateInput): boolean {
  if (input.closed) return false;
  if (input.suppressed) return false;
  if (input.currentSyncState === "unavailable") return false;
  return true;
}

export interface ResolvedTargetLike {
  ok: boolean;
  text: string | null;
  ambiguous: boolean;
}

export interface SyncOutcomeInput {
  /** The result of PartialEditView#resolveCurrentTarget for the currently loaded target. */
  resolved: ResolvedTargetLike;
  /** PartialEditView#originalText (or the relevant anchor's own snapshot) at check time. */
  originalText: string;
  /** PartialEditView#isDirty()'s result at check time. */
  isDirty: boolean;
  /**
   * Whether the compared text came from a live, open Editor (E3) rather
   * than vault.cachedRead (E4) — see PartialEditView#performStaleCheck's
   * own doc comment for the E3/E4/E5 naming.
   */
  fromLiveEditor: boolean;
}

export type SyncOutcomeDecision = "unavailable" | "stale" | "already-synced" | "clean-pane-auto-reload";

/**
 * evaluateAgainstText's own classification, extracted verbatim — see that
 * method's doc comment on PartialEditView for the full rationale behind
 * each branch, in particular the six-condition clean-Pane auto-reload gate
 * (bullets 1-6 there), of which this function directly encodes bullet 1
 * (isDirty) and bullets 2/3 (fromLiveEditor). Bullets 4/5 (resolved.ok,
 * not unavailable) are already implied by reaching that branch at all —
 * classifySyncOutcome's own first check returns "unavailable"/"stale"
 * before either can matter — and bullet 6 (the reload itself being
 * read-only) is a property of the CALLER (performAutoReload), never of
 * this decision.
 *
 * `resolved.ambiguous` distinguishes a target that could not be safely,
 * uniquely re-identified at all (deletion, an ambiguous duplicate, or a
 * nearby structural change a paragraph anchor can hit — see
 * edit/paragraphPartialEdit.ts's resolveParagraphAnchorText) from a
 * section/list/callout/blockquote/CompositeBlock's more definitive
 * resolve-failure (never ambiguous — see resolveCurrentTarget's own
 * per-kind dispatch). Per this ticket's own explicit policy, an ambiguous
 * result leans toward "stale" rather than "unavailable" at mere detection
 * time — only a subsequent, explicit Reload attempt that ALSO fails
 * escalates to "unavailable" (see PartialEditView#executeReload).
 */
export function classifySyncOutcome(input: SyncOutcomeInput): SyncOutcomeDecision {
  if (!input.resolved.ok || input.resolved.text === null) {
    return input.resolved.ambiguous ? "stale" : "unavailable";
  }

  if (input.resolved.text === input.originalText) {
    return "already-synced";
  }

  // Content differs from this pane's own snapshot. Clean-Pane auto-reload
  // requires BOTH isDirty() === false (never silently overwrite an unsaved
  // edit) AND fromLiveEditor (auto-reload is restricted to the E3/open-
  // editor case only — the E4/vault.cachedRead path is always a read-only
  // comparison, never an auto-textarea-update, regardless of dirty state).
  // Either condition failing falls through to a stale display instead —
  // never blank, never guessed content.
  if (!input.isDirty && input.fromLiveEditor) {
    return "clean-pane-auto-reload";
  }
  return "stale";
}
