import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * UI-only follow-up (2026-09-08, "段落行とリスト行のインデント差（テキスト開始
 * 位置のズレ）"): static source-text checks for styles.css's two-part
 * "歩み寄り" adjustment. No TypeScript/DOM changes were made for this
 * ticket — the fix is (1) a new `padding-left` on
 * `.tree-item-self[data-kind="paragraph"]` (paragraph rows never get a
 * drag handle, so this shifts their text right) and (2) shrinking the
 * existing `.unified-outliner-drag-handle`'s own `width` from `28px` to
 * `24px` (list rows' text shifts left slightly), so this file only
 * inspects styles.css's raw text, same convention as every other
 * *UiWiring.test.ts in this suite.
 *
 * 2026-09-09 correction: the first attempt at half (2) only trimmed the
 * drag handle's interior `padding` (`4px`→`2px` per side) while leaving
 * `width: 28px` untouched — live `getComputedStyle` inspection of the
 * deployed CSS (in the actual Outline Tree DOM, not just this static
 * source check) confirmed that shipped with ZERO visible effect: a fixed
 * `width` reserves the same flex-layout slot regardless of interior
 * padding, and `justify-content: center` centers the icon regardless of
 * symmetric padding either way. Shrinking the box's own `width` is the
 * actual load-bearing change, hence the tests below assert `width: 24px`
 * rather than the padding value.
 *
 * 2026-09-09 second amendment ("段落行とリスト行第一階層は同じレベルの
 * はずなので、ほとんど同じ位置に見えるようにしてほしい" — an explicit,
 * later instruction superseding this ticket's own original "not
 * pixel-perfect equality" framing with a near-equality target): live
 * `getBoundingClientRect` measurement (real on-screen CSS px, NOT a
 * screenshot pixel count — this investigation separately found screenshot
 * pixel counts on this device read roughly double the true CSS px, which
 * is what caused an earlier false "the fix did nothing" conclusion) of
 * `.unified-outliner-paragraph-label` vs. a sibling row's own
 * `.unified-outliner-list-label` showed the `12px` first attempt left a
 * real 33px gap. `padding-left` is raised from `12px` to `45px`
 * (`12 + 33`) to actually close that live-measured gap to ~0px, so the
 * tests below assert the wider range this produces rather than the
 * original ticket's `10px`-`16px`.
 *
 * These are static checks only: they confirm the intended selectors and
 * declarations exist in styles.css, not that the result actually renders
 * as a visually balanced paragraph/list alignment on a real device/theme,
 * and not any drag operability — that still requires the manual
 * real-device acceptance pass.
 */
describe("styles.css paragraph/list row text-start alignment (static source check)", () => {
  const cssText = readFileSync(path.resolve(__dirname, "../styles.css"), "utf-8");

  function getParagraphBlock(): string {
    const start = cssText.indexOf('.tree-item-self[data-kind="paragraph"] {');
    expect(start).toBeGreaterThan(-1);
    const end = cssText.indexOf("}", start);
    return cssText.slice(start, end);
  }

  function getDragHandleBlock(): string {
    const start = cssText.indexOf(".unified-outliner-drag-handle {");
    expect(start).toBeGreaterThan(-1);
    const end = cssText.indexOf("}", start);
    return cssText.slice(start, end);
  }

  it("adds a padding-left to .tree-item-self[data-kind=\"paragraph\"] of exactly 45px — the value the 2026-09-09 near-equality amendment derived from the live-measured 33px residual gap on top of the original 12px", () => {
    const block = getParagraphBlock();
    const match = block.match(/padding-left:\s*([\d.]+)px;/);
    expect(match).not.toBeNull();
    const value = Number(match![1]);
    expect(value).toBe(45);
    // Sanity range, in case the exact value is ever re-tuned after a fresh
    // real-device measurement: comfortably above the original ticket's
    // 10px-16px "visual balance" range, since the goal is now near-equality
    // with the sibling list row's own text-start position, not just "closer
    // than before".
    expect(value).toBeGreaterThanOrEqual(30);
    expect(value).toBeLessThanOrEqual(60);
  });

  it("scopes the new padding-left to exactly [data-kind=\"paragraph\"] — never to list/composite/complex-member/section", () => {
    // The selector itself must be the precise attribute-equals form, not a
    // broader attribute-presence or multi-value selector.
    expect(cssText).toContain('.tree-item-self[data-kind="paragraph"] {');
    expect(cssText).not.toMatch(/\[data-kind="paragraph"\]\s*,\s*\.tree-item-self\[data-kind="(list|composite|complex-member|section)"\]/);
    expect(cssText).not.toMatch(/\.tree-item-self\[data-kind="(list|composite|complex-member|section)"\]\s*,\s*\.tree-item-self\[data-kind="paragraph"\]/);
  });

  it("sets no other box-model property (padding-top/bottom/right, margin, min-height, line-height) on the new paragraph rule", () => {
    const block = getParagraphBlock();
    expect(block).not.toMatch(/padding-top/);
    expect(block).not.toMatch(/padding-bottom/);
    expect(block).not.toMatch(/padding-right/);
    expect(block).not.toMatch(/margin/);
    expect(block).not.toMatch(/min-height/);
    expect(block).not.toMatch(/line-height/);
  });

  it("shrinks the drag handle's own width to 24px (not its interior padding — see the 2026-09-09 correction) while min-height stays exactly 28px", () => {
    // The first attempt at this half of the fix only trimmed interior
    // `padding` while leaving `width: 28px` untouched — a no-op, since
    // `justify-content: center` centers the icon regardless of symmetric
    // padding, and a fixed width still reserves the same flex-layout slot
    // either way. Live getComputedStyle inspection of the deployed CSS
    // confirmed this shipped with zero visible effect, so the real fix is
    // shrinking the box itself.
    const block = getDragHandleBlock();
    expect(block).toContain("width: 24px;");
    expect(block).not.toContain("width: 28px;");
    expect(block).toContain("min-height: 28px;");
    expect(block).toContain("padding: 0 4px;");
  });

  it("leaves the drag handle's other properties (display/align/justify/flex-shrink/height/touch-action/color/cursor/opacity) untouched", () => {
    const block = getDragHandleBlock();
    expect(block).toContain("display: flex;");
    expect(block).toContain("align-items: center;");
    expect(block).toContain("justify-content: center;");
    expect(block).toContain("flex-shrink: 0;");
    expect(block).toContain("height: 100%;");
    expect(block).toContain("touch-action: none;");
    expect(block).toContain("color: var(--uo-muted-text-color);");
    expect(block).toContain("cursor: grab;");
    expect(block).toContain("opacity: 0;");
  });

  it("leaves the previously-tuned list row density rule (padding-top/padding-bottom/min-height) exactly as it was, untouched by this ticket", () => {
    const start = cssText.indexOf('.tree-item-self[data-kind="list"]:not([data-composite-group="true"]) {');
    expect(start).toBeGreaterThan(-1);
    const end = cssText.indexOf("}", start);
    const block = cssText.slice(start, end);
    expect(block).toContain("padding-top: 1px;");
    expect(block).toContain("padding-bottom: 1px;");
    expect(block).toContain("min-height: 28px;");
  });

  it("leaves the Outline Tree indent-step custom properties (--nav-item-children-padding-start/-margin-start) exactly as they were, untouched by this ticket", () => {
    const start = cssText.indexOf(".unified-outliner-tree-root {");
    expect(start).toBeGreaterThan(-1);
    const end = cssText.indexOf("}", start);
    const block = cssText.slice(start, end);
    expect(block).toContain("--nav-item-children-padding-start: 8px;");
    expect(block).toContain("--nav-item-children-margin-start: 6px;");
  });

  it("leaves the collapse spacer and CompositeBlock group-indicator rules exactly as they were, untouched by this ticket", () => {
    expect(cssText).toContain(".unified-outliner-collapse-spacer {");
    expect(cssText).toContain("visibility: hidden;");
    expect(cssText).toContain("border-left: 2px solid var(--uo-current-color);");
    expect(cssText).toContain("border-left-width: 3px;");
  });

  it("introduces no new hardcoded color for this ticket (spacing-only change)", () => {
    const block = getParagraphBlock();
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(block).not.toMatch(/rgba?\(/);
    expect(block).not.toMatch(/color-mix\(/);
  });
});
