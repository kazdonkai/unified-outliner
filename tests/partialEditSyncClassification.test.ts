import { describe, expect, it } from "vitest";
import {
  classifySyncOutcome,
  shouldRunStaleCheck,
  SyncOutcomeInput,
  StaleCheckGateInput,
} from "../src/view/partialEditSyncClassification";

/**
 * Phase 5A-1 hardening §4: real-assertion coverage for the pure,
 * Obsidian-free decision logic extracted from
 * view/PartialEditView.ts's stale-check pipeline
 * (performStaleCheck/evaluateAgainstText). Unlike
 * tests/partialEditStalePaneSyncUiWiring.test.ts (which only confirms
 * PartialEditView.ts WIRES INTO these functions at the right places), this
 * file actually calls them and asserts on their return values — the
 * minimum decision-table coverage this hardening round's own requirements
 * call for.
 */
describe("shouldRunStaleCheck", () => {
  const base: StaleCheckGateInput = { closed: false, suppressed: false, currentSyncState: "synced" };

  it("runs when nothing blocks it", () => {
    expect(shouldRunStaleCheck(base)).toBe(true);
  });

  it("still runs while merely 'stale' (a stale Pane keeps re-checking, unlike 'unavailable')", () => {
    expect(shouldRunStaleCheck({ ...base, currentSyncState: "stale" })).toBe(true);
  });

  it("does not run once closed", () => {
    expect(shouldRunStaleCheck({ ...base, closed: true })).toBe(false);
  });

  it("does not run while a self-Apply is in progress (hardening §1 suppression window)", () => {
    expect(shouldRunStaleCheck({ ...base, suppressed: true })).toBe(false);
  });

  it("does not run once 'unavailable' (no auto-recovery on reappearance — only an explicit Reload re-attempts)", () => {
    expect(shouldRunStaleCheck({ ...base, currentSyncState: "unavailable" })).toBe(false);
  });

  it("stays false when multiple gates are simultaneously true", () => {
    expect(shouldRunStaleCheck({ closed: true, suppressed: true, currentSyncState: "unavailable" })).toBe(
      false
    );
  });
});

describe("classifySyncOutcome", () => {
  const base: SyncOutcomeInput = {
    resolved: { ok: true, text: "unchanged text", ambiguous: false },
    originalText: "unchanged text",
    isDirty: false,
    fromLiveEditor: true,
  };

  it("target unchanged -> already-synced", () => {
    expect(classifySyncOutcome(base)).toBe("already-synced");
  });

  it("target changed + clean Pane + live editor -> clean-pane-auto-reload", () => {
    const input: SyncOutcomeInput = {
      resolved: { ok: true, text: "new text", ambiguous: false },
      originalText: "old text",
      isDirty: false,
      fromLiveEditor: true,
    };
    expect(classifySyncOutcome(input)).toBe("clean-pane-auto-reload");
  });

  it("target changed + clean Pane + vault.cachedRead (not a live editor) -> stale, never auto-reload", () => {
    const input: SyncOutcomeInput = {
      resolved: { ok: true, text: "new text", ambiguous: false },
      originalText: "old text",
      isDirty: false,
      fromLiveEditor: false,
    };
    expect(classifySyncOutcome(input)).toBe("stale");
  });

  it("target changed + dirty Pane + live editor -> stale, never auto-overwrites an unsaved edit", () => {
    const input: SyncOutcomeInput = {
      resolved: { ok: true, text: "new text", ambiguous: false },
      originalText: "old text",
      isDirty: true,
      fromLiveEditor: true,
    };
    expect(classifySyncOutcome(input)).toBe("stale");
  });

  it("target changed + dirty Pane + vault.cachedRead -> stale", () => {
    const input: SyncOutcomeInput = {
      resolved: { ok: true, text: "new text", ambiguous: false },
      originalText: "old text",
      isDirty: true,
      fromLiveEditor: false,
    };
    expect(classifySyncOutcome(input)).toBe("stale");
  });

  it("definitive resolve-failure (ok: false, ambiguous: false) -> unavailable — covers section/list/callout/blockquote/CompositeBlock, none of which ever report ambiguous: true", () => {
    const input: SyncOutcomeInput = {
      resolved: { ok: false, text: null, ambiguous: false },
      originalText: "old text",
      isDirty: false,
      fromLiveEditor: true,
    };
    expect(classifySyncOutcome(input)).toBe("unavailable");
  });

  it("paragraph ambiguous-resolution-failure (ok: false, ambiguous: true) -> stale, never unavailable, at mere detection time", () => {
    const input: SyncOutcomeInput = {
      resolved: { ok: false, text: null, ambiguous: true },
      originalText: "old text",
      isDirty: false,
      fromLiveEditor: true,
    };
    expect(classifySyncOutcome(input)).toBe("stale");
  });

  it("an ambiguous, dirty result is still stale (ambiguous short-circuits before isDirty/fromLiveEditor are even consulted)", () => {
    const input: SyncOutcomeInput = {
      resolved: { ok: false, text: null, ambiguous: true },
      originalText: "old text",
      isDirty: true,
      fromLiveEditor: false,
    };
    expect(classifySyncOutcome(input)).toBe("stale");
  });
});
