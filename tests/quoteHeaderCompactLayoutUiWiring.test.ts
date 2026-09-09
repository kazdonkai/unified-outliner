import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * UI-only follow-up (2026-09-09, "Partial Edit Pane（部分編集ペイン）の
 * コールアウト編集ヘッダー（quote header）のUI改善"): static source-text
 * checks for the three changes that together give quoteTitleInputEl the
 * horizontal room it was losing to raw Markdown punctuation and
 * over-wide controls:
 *
 * 1. src/view/PartialEditView.ts's renderQuoteHeader(): the titleSlot
 *    branch's label now shows the Outline Tree's own
 *    STANDALONE_CALLOUT_PREFIX glyph ("▣ ", buildOutlineTree.ts) instead
 *    of the raw `quotePrefix + "[!"` text, and quoteTypeCloseLabelEl's
 *    literal "]" is permanently dropped. This is a display-only change —
 *    see tests/quotePrefixPartialEditViewWiring.test.ts's own 2026-09-09
 *    additions for the exact renderQuoteHeader() source-text assertions;
 *    this file does not duplicate those, only the import + CSS side.
 * 2. src/i18n.ts: the three fold-marker <option> labels
 *    (quoteFoldMarkerNone/Expand/Collapse) shrank from long descriptive
 *    sentences to compact symbol-forward text, in both en and ja — the
 *    marker VALUES ("", "+", "-") and the separate quoteFoldMarkerLabel
 *    tooltip (still fully descriptive) are unchanged.
 * 3. styles.css: quote-type-input and quote-marker-select both got
 *    smaller, more predictable widths (the select in particular went
 *    from no explicit width at all — sized to its own longest option
 *    text — to an explicit `width`), freeing up space for
 *    quote-title-input's existing `flex: 1 1 auto` to actually use.
 *
 * These are static checks only: they confirm the intended declarations
 * exist in styles.css/i18n.ts/PartialEditView.ts's raw text, not that
 * the result actually renders as a visually balanced row on a real
 * device/theme — that still requires the manual real-device acceptance
 * pass. Same convention as every other *UiWiring.test.ts in this suite.
 */
describe("Partial Edit Pane callout header compact layout (static source check)", () => {
  const cssText = readFileSync(path.resolve(__dirname, "../styles.css"), "utf-8");
  const viewText = readFileSync(
    path.resolve(__dirname, "../src/view/PartialEditView.ts"),
    "utf-8"
  );
  const i18nText = readFileSync(path.resolve(__dirname, "../src/i18n.ts"), "utf-8");

  function getCssBlock(selector: string): string {
    const start = cssText.indexOf(`${selector} {`);
    expect(start).toBeGreaterThan(-1);
    const end = cssText.indexOf("}", start);
    return cssText.slice(start, end);
  }

  it("imports STANDALONE_CALLOUT_PREFIX from ../tree/buildOutlineTree, reusing the exact same glyph the Outline Tree uses for a callout row", () => {
    expect(viewText).toMatch(/from\s+"\.\.\/tree\/buildOutlineTree"/);
    expect(viewText).toContain("STANDALONE_CALLOUT_PREFIX");
  });

  it("shrinks quote-type-input to width: 6em / max-width: 32%, down from the original 8em / 45%", () => {
    const block = getCssBlock(".unified-outliner-partial-edit-quote-type-input");
    expect(block).toContain("width: 6em;");
    expect(block).toContain("max-width: 32%;");
    expect(block).not.toContain("width: 8em;");
    expect(block).not.toContain("max-width: 45%;");
    // Non-spacing properties this ticket must not disturb.
    expect(block).toContain("flex-shrink: 0;");
    expect(block).toContain("border: none;");
    expect(block).toContain("background: transparent;");
  });

  it("gives quote-marker-select an explicit compact width: 5em (it previously had none, sizing to its own longest <option> text) and tightens max-width from 45% to 28%", () => {
    const block = getCssBlock(".unified-outliner-partial-edit-quote-marker-select");
    expect(block).toContain("width: 5em;");
    expect(block).toContain("max-width: 28%;");
    expect(block).not.toContain("max-width: 45%;");
    // Non-spacing properties this ticket must not disturb.
    expect(block).toContain("flex-shrink: 0;");
    expect(block).toContain("border: 1px solid rgba(128, 128, 128, 0.3);");
    expect(block).toContain("border-radius: 4px;");
  });

  it("leaves quote-title-input's flex: 1 1 auto (already correct, just previously starved of room) untouched", () => {
    const block = getCssBlock(".unified-outliner-partial-edit-quote-title-input");
    expect(block).toContain("flex: 1 1 auto;");
    expect(block).toContain("min-width: 0;");
  });

  it("leaves quote-header-label's white-space: pre untouched — still needed by the titleSlot === null raw-header fallback branch, which this ticket does not change", () => {
    const block = getCssBlock(".unified-outliner-partial-edit-quote-header-label");
    expect(block).toContain("white-space: pre;");
  });

  it("shortens the fold-marker <option> labels (quoteFoldMarkerNone/Expand/Collapse) in both en and ja, while leaving the tooltip (quoteFoldMarkerLabel) fully descriptive in both", () => {
    expect(i18nText).toContain('"partialEdit.quoteFoldMarkerNone": "Fixed",');
    expect(i18nText).toContain('"partialEdit.quoteFoldMarkerExpand": "+ Expand",');
    expect(i18nText).toContain('"partialEdit.quoteFoldMarkerCollapse": "- Collapse",');
    expect(i18nText).toContain('"partialEdit.quoteFoldMarkerNone": "固定",');
    expect(i18nText).toContain('"partialEdit.quoteFoldMarkerExpand": "+ 展開",');
    expect(i18nText).toContain('"partialEdit.quoteFoldMarkerCollapse": "- 収納",');
    // The tooltip text is untouched in both locales — only the visible
    // <option> labels shrank.
    expect(i18nText).toContain('"partialEdit.quoteFoldMarkerLabel": "Callout fold behavior",');
    expect(i18nText).toContain('"partialEdit.quoteFoldMarkerLabel": "コールアウトの折りたたみ設定",');
  });

  it("does not touch quoteTypeLabel/quoteTitleLabel (unrelated tooltips/placeholders, out of this ticket's scope) in either locale", () => {
    expect(i18nText).toContain('"partialEdit.quoteTypeLabel": "Callout type",');
    expect(i18nText).toContain('"partialEdit.quoteTitleLabel": "Callout title",');
    expect(i18nText).toContain('"partialEdit.quoteTypeLabel": "コールアウトの種類",');
    expect(i18nText).toContain('"partialEdit.quoteTitleLabel": "コールアウトのタイトル",');
  });

  it("leaves reconstructQuoteHeader's call signature (titleSlot, newType, newMarker, quoteTitleInputEl.value) untouched — Apply still reads from the live input/select values, never from any display label", () => {
    const start = viewText.indexOf("const reconstructed = reconstructQuoteHeader(");
    expect(start).toBeGreaterThan(-1);
    const end = viewText.indexOf(");", start);
    const call = viewText.slice(start, end);
    expect(call).toContain("titleSlot,");
    expect(call).toContain("newType,");
    expect(call).toContain("newMarker,");
    expect(call).toContain("this.quoteTitleInputEl.value");
  });

  it("leaves the marker <select>'s closed-set option values (\"\", \"+\", \"-\") untouched — only the visible option text changed, per this ticket's own explicit constraint", () => {
    const start = viewText.indexOf('this.quoteMarkerSelectEl = this.quoteHeaderEl.createEl("select"');
    expect(start).toBeGreaterThan(-1);
    const end = viewText.indexOf("setTooltip(this.quoteMarkerSelectEl", start);
    expect(end).toBeGreaterThan(start);
    const block = viewText.slice(start, end);
    expect(block).toContain('value: "",');
    expect(block).toContain('value: "+",');
    expect(block).toContain('value: "-",');
  });
});
