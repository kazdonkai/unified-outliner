import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * UI-only follow-up (2026-09-08, "通常list行の縦方向の余白を適切に縮める"):
 * static source-text checks for styles.css's new list-row vertical-padding
 * override. No TypeScript/DOM changes were made for this ticket (the
 * existing `data-kind`/`data-composite-group` attributes already set by
 * view/OutlineTreeView.ts's renderNode are reused as-is), so this file only
 * inspects styles.css's raw text — same convention as every other
 * *UiWiring.test.ts in this suite.
 *
 * These are static checks only: they confirm the intended selector and
 * declarations exist in styles.css, not that the result actually renders
 * as an appropriately tightened, non-cramped row on a real
 * device/theme/screen size, and not any drag-and-drop, hover, keyboard
 * selection, or tap-target behavior — that still requires the manual
 * real-device acceptance pass.
 */
describe("styles.css list row density (static source check)", () => {
  const cssText = readFileSync(path.resolve(__dirname, "../styles.css"), "utf-8");

  function getListDensityBlock(): string {
    const start = cssText.indexOf('.tree-item-self[data-kind="list"]:not([data-composite-group="true"]) {');
    expect(start).toBeGreaterThan(-1);
    const end = cssText.indexOf("}", start);
    return cssText.slice(start, end);
  }

  it("defines a padding + min-height override scoped to plain list rows", () => {
    const block = getListDensityBlock();
    expect(block).toContain("padding-top: 1px;");
    expect(block).toContain("padding-bottom: 1px;");
    expect(block).toContain("min-height: 28px;");
  });

  it("excludes CompositeBlock member rows via :not([data-composite-group=\"true\"]), so the group-indicator tiers are never touched", () => {
    expect(cssText).toContain(
      '.tree-item-self[data-kind="list"]:not([data-composite-group="true"]) {'
    );
  });

  it("never sets line-height or margin in the new rule (deliberately not touched — see this ticket's own root-cause finding)", () => {
    const block = getListDensityBlock();
    expect(block).not.toMatch(/line-height/);
    expect(block).not.toMatch(/margin/);
  });

  it("the new min-height matches the drag handle's own min-height exactly (28px) — it caps out any larger Obsidian-core default without ever going below the drag handle's own already-accepted tap-target floor", () => {
    const listBlock = getListDensityBlock();
    const listMinHeightMatch = listBlock.match(/min-height:\s*([\d.]+)px;/);
    expect(listMinHeightMatch).not.toBeNull();

    const handleStart = cssText.indexOf(".unified-outliner-drag-handle {");
    expect(handleStart).toBeGreaterThan(-1);
    const handleEnd = cssText.indexOf("}", handleStart);
    const handleBlock = cssText.slice(handleStart, handleEnd);
    const handleMinHeightMatch = handleBlock.match(/min-height:\s*([\d.]+)px;/);
    expect(handleMinHeightMatch).not.toBeNull();

    expect(Number(listMinHeightMatch![1])).toBe(Number(handleMinHeightMatch![1]));
  });

  it("never touches horizontal padding (left/right) — only padding-top/padding-bottom are declared", () => {
    const block = getListDensityBlock();
    expect(block).not.toMatch(/padding-left/);
    expect(block).not.toMatch(/padding-right/);
    expect(block).not.toMatch(/\bpadding:/);
  });

  it("this padding override is the only padding-top declaration in the whole file (it is not accidentally duplicated onto section/composite/complex-member/paragraph rows)", () => {
    const occurrences = cssText.match(/padding-top: 1px;/g) ?? [];
    expect(occurrences).toHaveLength(1);
  });

  it("does not add a bare .tree-item-self padding rule (row kinds other than plain list must keep inheriting Obsidian's own default padding, unmodified)", () => {
    expect(cssText).not.toMatch(/^\.tree-item-self\s*\{[^}]*padding/m);
  });

  it("leaves data-kind=\"section\"/\"composite\"/\"complex-member\" selectors free of any new padding declaration", () => {
    // "paragraph" is deliberately excluded from this check: a later, separate
    // ticket (2026-09-08, "段落行とリスト行のインデント差", see
    // tests/paragraphListIndentAlignmentUiWiring.test.ts) intentionally adds
    // `padding-left` to `[data-kind="paragraph"]` for an unrelated reason
    // (drag-handle-absence text-start alignment, not row density) — that
    // addition is legitimate and covered by its own dedicated test file, so
    // it must not be flagged as a regression here.
    for (const kind of ["section", "composite", "complex-member"]) {
      const re = new RegExp(`\\[data-kind="${kind}"\\][^{]*\\{[^}]*padding`, "g");
      expect(cssText.match(re)).toBeNull();
    }
  });

  it("leaves the CompositeBlock group-indicator tiers (border-left widths, background opacity, corner radii) exactly as they were, untouched by this ticket", () => {
    expect(cssText).toContain("border-left: 2px solid var(--uo-current-color);");
    expect(cssText).toContain("border-left-width: 3px;");
    expect(cssText).toContain("opacity: 0.55;");
    expect(cssText).toContain("opacity: 0.85;");
    expect(cssText).toContain("opacity: 0.7;");
    expect(cssText).toContain("border-top-left-radius: 4px;");
    expect(cssText).toContain("border-bottom-left-radius: 4px;");
  });

  it("leaves the drag handle's own vertical tap-target floor (UXP-01, min-height: 28px) completely untouched — it is what keeps a tightened list row's live tap target from ever shrinking below the already-accepted minimum", () => {
    // The drag handle's own `width` is deliberately NOT asserted here: a
    // later, separate ticket (2026-09-08/09, "段落行とリスト行のインデント
    // 差", see tests/paragraphListIndentAlignmentUiWiring.test.ts)
    // legitimately shrinks it from 28px to 24px for an unrelated,
    // horizontal-alignment reason — that change is covered by its own
    // dedicated test file and must not be flagged as a regression here.
    // `min-height` (the vertical floor this ticket's own density change
    // cares about) is unaffected by that later ticket and stays asserted.
    const start = cssText.indexOf(".unified-outliner-drag-handle {");
    expect(start).toBeGreaterThan(-1);
    const end = cssText.indexOf("}", start);
    const block = cssText.slice(start, end);
    expect(block).toContain("min-height: 28px;");
  });

  it("introduces no new CSS custom property, Style Settings variable, or hardcoded color for this ticket", () => {
    const start = cssText.indexOf('/* UI-only follow-up (2026-09-08, "通常list行の縦方向の余白を適切に縮める"');
    expect(start).toBeGreaterThan(-1);
    const end = cssText.indexOf('.tree-item-self[data-kind="list"]:not([data-composite-group="true"]) {', start);
    const commentAndSelector = cssText.slice(start, end);
    expect(commentAndSelector).not.toMatch(/--[a-zA-Z0-9-]+:\s/);
    const block = getListDensityBlock();
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(block).not.toMatch(/rgba?\(/);
  });
});
