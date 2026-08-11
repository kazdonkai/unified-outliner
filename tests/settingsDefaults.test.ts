import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  DEFAULT_TREE_KIND_HIGHLIGHT,
  mergeSettings,
} from "../src/settingsDefaults";

/**
 * settingsDefaults.ts is the pure, Obsidian-free half of settings.ts
 * (split out specifically so it's importable from vitest — see its own
 * doc comment for why settings.ts itself, and anything under src/view or
 * src/main.ts, cannot be imported from a test at all). These tests cover
 * what R1.1-B-3 asked for that's actually testable without a real
 * Obsidian runtime:
 *
 *   1. syncOutlineTreeFoldingToEditor's default is true.
 *   2. A pre-existing data.json written before this setting existed (so
 *      it's simply absent from the raw object) still resolves to true
 *      after merging — this is the exact operation main.ts's
 *      loadSettings() performs on every plugin load.
 *   3. An explicit `false` in a raw settings object is preserved (not
 *      silently forced back to the default), so turning the setting off
 *      and reloading the plugin keeps it off.
 *   4. Merging never mutates the shared DEFAULT_SETTINGS object itself,
 *      which every call reads from — mutation there would leak between
 *      plugin instances/reloads sharing the same module.
 *
 * The remaining R1.1-B-3 items (Tree-origin setNodeCollapsed skipping the
 * CM6 body sync when the setting is off, while its in-memory/persisted
 * state still updates, and the reverse CM6 -> Tree sync staying on
 * regardless) are OutlineTreeView.ts behaviors that depend on a live CM6
 * EditorView and Obsidian's ItemView/Workspace — none of which have a
 * runtime outside a real Obsidian process, which is why no existing test
 * in this suite exercises src/view/OutlineTreeView.ts either (see
 * foldStateAcceptance.test.ts's doc comment for the same constraint
 * applied to persistence/foldStateManager.ts). Those are covered by the
 * real-device acceptance test plan instead (Fold setting items 1-8 in the
 * R1.1 request), not by a unit test that would otherwise have to
 * reimplement the guarded logic separately from production code just to
 * have something to assert on — which risks the copy silently drifting
 * from the real implementation.
 */

describe("settingsDefaults: syncOutlineTreeFoldingToEditor", () => {
  it("defaults to true", () => {
    expect(DEFAULT_SETTINGS.syncOutlineTreeFoldingToEditor).toBe(true);
  });

  it("mergeSettings resolves to true when a raw settings object omits the key entirely (pre-existing data.json)", () => {
    const raw: Record<string, unknown> = {
      allowCrossSectionListMove: false, // some other real field IS present
    };
    const merged = mergeSettings(raw);
    expect(merged.syncOutlineTreeFoldingToEditor).toBe(true);
    // Confirms this is a real merge, not just "return DEFAULT_SETTINGS":
    // the field that WAS present in raw is honored too.
    expect(merged.allowCrossSectionListMove).toBe(false);
  });

  it("mergeSettings preserves an explicit false from a raw settings object", () => {
    const raw: Record<string, unknown> = {
      syncOutlineTreeFoldingToEditor: false,
    };
    const merged = mergeSettings(raw);
    expect(merged.syncOutlineTreeFoldingToEditor).toBe(false);
  });

  it("mergeSettings never mutates the shared DEFAULT_SETTINGS object", () => {
    const before = { ...DEFAULT_SETTINGS };
    mergeSettings({ syncOutlineTreeFoldingToEditor: false });
    expect(DEFAULT_SETTINGS).toEqual(before);
    expect(DEFAULT_SETTINGS.syncOutlineTreeFoldingToEditor).toBe(true);
  });

  it("mergeSettings on a completely empty raw object (fresh install, no data.json yet) returns every default unchanged", () => {
    expect(mergeSettings({})).toEqual(DEFAULT_SETTINGS);
  });
});

/**
 * 2026-08-11 ticket ("Move block の対象を最小安全ブロックへ"): treeKindHighlight
 * is a NESTED settings object (unlike every other field above), added
 * specifically to verify mergeSettings's one-level-deeper merge — a naive
 * Object.assign({}, DEFAULT_SETTINGS, raw) would replace the whole nested
 * object wholesale with whatever raw.treeKindHighlight contains (or is
 * entirely missing, for a pre-existing data.json from before this ticket),
 * silently dropping any of ITS OWN sub-keys instead of falling back to
 * their individual defaults.
 */
describe("settingsDefaults: treeKindHighlight (nested settings object)", () => {
  it("defaults match the ticket's own recommended defaults", () => {
    expect(DEFAULT_SETTINGS.treeKindHighlight).toEqual({
      sectionMode: "subtle",
      listMode: "hover",
      showMoveTargetPreview: true,
      showMoveResultToast: true,
    });
  });

  it("mergeSettings resolves every sub-key to its default when raw omits treeKindHighlight entirely (pre-existing data.json)", () => {
    const merged = mergeSettings({ allowCrossSectionListMove: false });
    expect(merged.treeKindHighlight).toEqual(DEFAULT_TREE_KIND_HIGHLIGHT);
  });

  it("mergeSettings preserves a PARTIAL raw.treeKindHighlight, falling back to defaults for the missing sub-keys only", () => {
    const merged = mergeSettings({
      treeKindHighlight: { sectionMode: "off" },
    });
    expect(merged.treeKindHighlight).toEqual({
      sectionMode: "off",
      listMode: "hover",
      showMoveTargetPreview: true,
      showMoveResultToast: true,
    });
  });

  it("mergeSettings preserves a FULL raw.treeKindHighlight unchanged", () => {
    const custom = {
      sectionMode: "stripe" as const,
      listMode: "off" as const,
      showMoveTargetPreview: false,
      showMoveResultToast: false,
    };
    const merged = mergeSettings({ treeKindHighlight: custom });
    expect(merged.treeKindHighlight).toEqual(custom);
  });

  it("mergeSettings never mutates the shared DEFAULT_TREE_KIND_HIGHLIGHT object", () => {
    const before = { ...DEFAULT_TREE_KIND_HIGHLIGHT };
    mergeSettings({ treeKindHighlight: { sectionMode: "off" } });
    expect(DEFAULT_TREE_KIND_HIGHLIGHT).toEqual(before);
  });
});

/**
 * i18n実装 (2026-08-11 ticket, "Unified Outliner：日本語／英語 UI 切替の実装指示"):
 * the `language` field is a top-level SCALAR (unlike treeKindHighlight
 * above), so mergeSettings's shallow Object.assign alone would pass an
 * invalid raw.language value straight through instead of falling back to a
 * default the way the nested-object merge does structurally — these tests
 * cover the explicit isValidPluginLanguage() re-validation step that closes
 * that gap, per the ticket's own "不明な値は安全に auto へフォールバックする"
 * requirement.
 */
describe("settingsDefaults: language (i18n)", () => {
  it("defaults to \"auto\"", () => {
    expect(DEFAULT_SETTINGS.language).toBe("auto");
  });

  it("mergeSettings resolves to \"auto\" when raw omits language entirely (pre-existing, pre-i18n data.json)", () => {
    const merged = mergeSettings({ allowCrossSectionListMove: false });
    expect(merged.language).toBe("auto");
  });

  it("mergeSettings preserves an explicit \"ja\"", () => {
    expect(mergeSettings({ language: "ja" }).language).toBe("ja");
  });

  it("mergeSettings preserves an explicit \"en\"", () => {
    expect(mergeSettings({ language: "en" }).language).toBe("en");
  });

  it("mergeSettings falls back to \"auto\" for an invalid/corrupted language value", () => {
    expect(mergeSettings({ language: "fr" }).language).toBe("auto");
    expect(mergeSettings({ language: 123 }).language).toBe("auto");
    expect(mergeSettings({ language: null }).language).toBe("auto");
  });
});
