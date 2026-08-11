import { describe, expect, it } from "vitest";
import {
  createTranslator,
  defaultTranslator,
  isValidPluginLanguage,
  resolveLocale,
} from "../src/i18n";

/**
 * i18n実装 (2026-08-11 ticket, "Unified Outliner：日本語／英語 UI 切替の実装指示"):
 * src/i18n.ts is deliberately Obsidian-free (see its own doc comment), so
 * these tests exercise it directly — resolveLocale's "auto"/"ja"/"en"
 * resolution policy, isValidPluginLanguage's unknown-value guard,
 * createTranslator's key lookups for both dictionaries, and its minimal
 * `{name}`-style interpolation. Key-parity between `en` and `ja` is
 * enforced at COMPILE time (ja is typed as `Record<TranslationKey,
 * string>`, TranslationKey = keyof typeof en — see src/i18n.ts), so no
 * separate runtime "every key exists in both" test is needed; `tsc` itself
 * would fail the build first if a key were missing from one dictionary.
 */

describe("isValidPluginLanguage", () => {
  it("accepts auto/ja/en", () => {
    expect(isValidPluginLanguage("auto")).toBe(true);
    expect(isValidPluginLanguage("ja")).toBe(true);
    expect(isValidPluginLanguage("en")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isValidPluginLanguage("fr")).toBe(false);
    expect(isValidPluginLanguage("")).toBe(false);
    expect(isValidPluginLanguage(null)).toBe(false);
    expect(isValidPluginLanguage(undefined)).toBe(false);
    expect(isValidPluginLanguage(123)).toBe(false);
    expect(isValidPluginLanguage({})).toBe(false);
  });
});

describe("resolveLocale", () => {
  it("resolves an explicit \"ja\" to ja regardless of any detected hint", () => {
    expect(resolveLocale("ja")).toBe("ja");
    expect(resolveLocale("ja", "en-US")).toBe("ja");
    expect(resolveLocale("ja", null)).toBe("ja");
  });

  it("resolves an explicit \"en\" to en regardless of any detected hint", () => {
    expect(resolveLocale("en")).toBe("en");
    expect(resolveLocale("en", "ja")).toBe("en");
  });

  it('"auto" resolves to ja when the detected hint looks Japanese', () => {
    expect(resolveLocale("auto", "ja")).toBe("ja");
    expect(resolveLocale("auto", "ja-JP")).toBe("ja");
    // Case-insensitive, matching a real localStorage "language" value's
    // possible casing.
    expect(resolveLocale("auto", "JA")).toBe("ja");
  });

  it('"auto" falls back to en when the hint is missing, empty, or not Japanese', () => {
    expect(resolveLocale("auto")).toBe("en");
    expect(resolveLocale("auto", null)).toBe("en");
    expect(resolveLocale("auto", undefined)).toBe("en");
    expect(resolveLocale("auto", "en-US")).toBe("en");
    expect(resolveLocale("auto", "zh-CN")).toBe("en");
    expect(resolveLocale("auto", "")).toBe("en");
  });
});

describe("createTranslator", () => {
  it("looks up a plain (non-interpolated) key in English", () => {
    const t = createTranslator("en");
    expect(t("command.moveBlockUp")).toBe("Move block up (minimal safe unit at cursor)");
    expect(t("notice.multipleCursors")).toBe(
      "Unified Outliner: multiple cursors are not supported."
    );
  });

  it("looks up the same key in Japanese, and the wording actually differs from English", () => {
    const en = createTranslator("en");
    const ja = createTranslator("ja");
    expect(ja("notice.multipleCursors")).toBe(
      "Unified Outliner: 複数カーソルには対応していない。"
    );
    expect(ja("command.moveBlockUp")).not.toBe(en("command.moveBlockUp"));
  });

  it("interpolates a single {var}", () => {
    const t = createTranslator("en");
    expect(t("unit.sectionNamed", { heading: "Overview" })).toBe('section "Overview"');
  });

  it("interpolates multiple {vars} in one template", () => {
    const t = createTranslator("en");
    expect(t("notice.moved", { unit: "paragraph", direction: "up" })).toBe(
      "Unified Outliner: moved paragraph up."
    );
  });

  it("interpolates a numeric var via {count}", () => {
    const en = createTranslator("en");
    expect(en("unit.listItemWithNestedMany", { count: 3 })).toBe(
      "list item (with 3 nested items)"
    );
    const ja = createTranslator("ja");
    expect(ja("unit.listItemWithNestedMany", { count: 3 })).toBe(
      "リスト項目（子項目3件を含む）"
    );
  });

  it("leaves an unmatched {placeholder} untouched when no vars are supplied", () => {
    const t = createTranslator("en");
    // Calling a template key with no vars object at all must not throw and
    // must not silently blank out the placeholder text.
    expect(t("unit.sectionNamed")).toBe('section "{heading}"');
  });

  it("defaultTranslator is the English translator, matching every pre-existing caller's original behavior", () => {
    expect(defaultTranslator("unit.paragraph")).toBe("paragraph");
    expect(defaultTranslator("unit.paragraph")).toBe(createTranslator("en")("unit.paragraph"));
  });
});
