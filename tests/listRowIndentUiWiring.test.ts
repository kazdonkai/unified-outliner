import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * UI-only follow-up (2026-09-08, "Outline Treeのリスト項目のインデント幅
 * (字下げ量)"): static source-text checks for styles.css's new indentation
 * override. No TypeScript/DOM changes were made for this ticket — the
 * fix redefines two of Obsidian's own public CSS custom properties
 * (`--nav-item-children-padding-start`/`--nav-item-children-margin-start`,
 * https://docs.obsidian.md/Reference/CSS+variables/Components/Navigation),
 * scoped to this plugin's own `.unified-outliner-tree-root`, rather than
 * touching any `.tree-item-children`/`.tree-item-self` box-model property
 * directly or any TypeScript source — so this file only inspects
 * styles.css's raw text, same convention as every other *UiWiring.test.ts
 * in this suite.
 *
 * These are static checks only: they confirm the intended selector and
 * declarations exist in styles.css, not that the result actually renders
 * as an appropriately slim, non-cramped indentation on a real
 * device/theme, and not any collapse-arrow/drag-handle/guide-line
 * behavior — that still requires the manual real-device acceptance pass.
 */
describe("styles.css Outline Tree indent width (static source check)", () => {
  const cssText = readFileSync(path.resolve(__dirname, "../styles.css"), "utf-8");

  function getIndentBlock(): string {
    const start = cssText.indexOf(".unified-outliner-tree-root {");
    expect(start).toBeGreaterThan(-1);
    const end = cssText.indexOf("}", start);
    return cssText.slice(start, end);
  }

  it("redefines Obsidian's own --nav-item-children-padding-start / --nav-item-children-margin-start custom properties", () => {
    const block = getIndentBlock();
    expect(block).toMatch(/--nav-item-children-padding-start:\s*[\d.]+px;/);
    expect(block).toMatch(/--nav-item-children-margin-start:\s*[\d.]+px;/);
  });

  it("keeps the combined per-level indent step within the requested 12px-16px range", () => {
    const block = getIndentBlock();
    const paddingMatch = block.match(/--nav-item-children-padding-start:\s*([\d.]+)px;/);
    const marginMatch = block.match(/--nav-item-children-margin-start:\s*([\d.]+)px;/);
    expect(paddingMatch).not.toBeNull();
    expect(marginMatch).not.toBeNull();
    const combined = Number(paddingMatch![1]) + Number(marginMatch![1]);
    expect(combined).toBeGreaterThanOrEqual(12);
    expect(combined).toBeLessThanOrEqual(16);
  });

  it("scopes the redefinition to .unified-outliner-tree-root only — never to a bare :root or a bare .tree-item-children, so other Obsidian tree panels (File Explorer, core Outline) are never affected", () => {
    expect(cssText).toContain(".unified-outliner-tree-root {");
    expect(cssText).not.toMatch(/:root\s*\{[^}]*--nav-item-children/);
    expect(cssText).not.toMatch(/^\.tree-item-children\s*\{/m);
  });

  it("redefines only the CSS custom properties — never sets padding/margin/min-height/line-height directly on .tree-item-children or .tree-item-self for this ticket", () => {
    const block = getIndentBlock();
    expect(block).not.toMatch(/[^-]padding[^-:]*:/);
    expect(block).not.toMatch(/[^-]margin[^-:]*:/);
    expect(block).not.toMatch(/min-height/);
    expect(block).not.toMatch(/line-height/);
  });

  it("leaves the indentation guide line's own variables (--nav-indentation-guide-width/-color) untouched — this ticket only changes the indent step, not the guide line's appearance", () => {
    const block = getIndentBlock();
    expect(block).not.toMatch(/--nav-indentation-guide/);
  });

  it("leaves the collapse spacer and CompositeBlock group-indicator rules exactly as they were, untouched by this ticket", () => {
    // The drag handle's own `width` is deliberately NOT asserted here: a
    // later, separate ticket (2026-09-08/09, "段落行とリスト行のインデント
    // 差", see tests/paragraphListIndentAlignmentUiWiring.test.ts)
    // legitimately shrinks it from 28px to 24px for an unrelated reason
    // (drag-handle-box-width text-start alignment, not indent width) —
    // that change is covered by its own dedicated test file and must not
    // be flagged as a regression here.
    expect(cssText).toContain(".unified-outliner-drag-handle {");
    expect(cssText).toContain(".unified-outliner-collapse-spacer {");
    expect(cssText).toContain("visibility: hidden;");
    expect(cssText).toContain("border-left: 2px solid var(--uo-current-color);");
    expect(cssText).toContain("border-left-width: 3px;");
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

  it("introduces no new hardcoded color for this ticket (indentation-only change)", () => {
    const block = getIndentBlock();
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(block).not.toMatch(/rgba?\(/);
    expect(block).not.toMatch(/color-mix\(/);
  });
});
