import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * UI-only follow-up (2026-09-08, "Outline Tree の CompositeBlock 視認性改
 * 善"): static-source-text checks for view/OutlineTreeView.ts's rendering
 * wiring of the CompositeBlock left-accent-border + tint group indicator,
 * and for styles.css's own selectors — same constraint as every other
 * *UiWiring.test.ts in this suite (see e.g.
 * tests/paragraphOutlineTreeUiWiring.test.ts's own top doc comment):
 * OutlineTreeView extends Obsidian's ItemView, which cannot be constructed
 * in vitest ("obsidian" is a types-only package here), so this file
 * inspects the raw source text of OutlineTreeView.ts/styles.css instead of
 * calling into them.
 *
 * The actual grouping DECISION logic (which node ids belong to a
 * CompositeBlock's group, and which one is the group's end) is a pure,
 * Obsidian-free function — tree/buildOutlineTree.ts#collectCompositeGroupInfo
 * — and is covered with real assertions in tests/buildOutlineTree.test.ts.
 * This file only confirms:
 *   1. renderNode actually consults that function's output
 *      (this.compositeGroupInfo) and sets the resulting data-* attributes /
 *      creates the accent element at the right place.
 *   2. refresh() actually recomputes/resets compositeGroupInfo alongside
 *      readOnlyNodeIds/currentTree.
 *   3. This indicator is purely additive: it does not touch, gate, or
 *      relax any existing rename/drag-and-drop/context-menu/click/keyboard
 *      wiring, and never exposes ruleId (or any other CompositeBlock-
 *      specific identifier) as a literal CSS selector.
 *   4. styles.css defines the expected selectors, uses --uo-current-color
 *      (never a bare hex literal outside the existing .theme-light/
 *      .theme-dark blocks), and does not remove/relax the pre-existing
 *      drag-and-drop indicator rules it was designed to coexist with.
 */
describe("OutlineTreeView.ts CompositeBlock group indicator wiring (static source check)", () => {
  const viewTs = readFileSync(path.resolve(__dirname, "../src/view/OutlineTreeView.ts"), "utf-8");

  function getRenderNodeBody(): string {
    const start = viewTs.indexOf("private renderNode(node: OutlineTreeNode, parentEl: HTMLElement): void {");
    const end = viewTs.indexOf("private toggleCollapse(id: string): void {", start);
    if (start === -1) {
      throw new Error("renderNode() not found in src/view/OutlineTreeView.ts — has it been renamed or removed?");
    }
    if (end === -1 || end <= start) {
      throw new Error(
        "Could not find renderNode()'s end boundary (toggleCollapse) — its shape may have changed; update this test's bounding logic."
      );
    }
    return viewTs.slice(start, end);
  }

  it("imports collectCompositeGroupInfo and the CompositeGroupInfo type from tree/buildOutlineTree", () => {
    expect(viewTs).toContain("collectCompositeGroupInfo");
    expect(viewTs).toContain("CompositeGroupInfo");
  });

  it("declares a compositeGroupInfo field, initialized to empty Sets", () => {
    expect(viewTs).toMatch(
      /private compositeGroupInfo: CompositeGroupInfo = \{ groupNodeIds: new Set\(\), groupEndNodeIds: new Set\(\) \};/
    );
  });

  it("refresh() recomputes compositeGroupInfo via collectCompositeGroupInfo(this.currentTree), right alongside readOnlyNodeIds", () => {
    const readOnlyRecompute = viewTs.indexOf("this.readOnlyNodeIds = collectReadOnlyOutlineNodeIds(this.currentTree);");
    expect(readOnlyRecompute).toBeGreaterThan(-1);
    const groupRecompute = viewTs.indexOf(
      "this.compositeGroupInfo = collectCompositeGroupInfo(this.currentTree);",
      readOnlyRecompute
    );
    expect(groupRecompute).toBeGreaterThan(readOnlyRecompute);
    // Must appear shortly after (same statement block), not buried
    // somewhere unrelated later in the file.
    expect(groupRecompute - readOnlyRecompute).toBeLessThan(300);
  });

  it("refresh()'s no-active-note reset path also resets compositeGroupInfo, alongside readOnlyNodeIds", () => {
    const resetIdx = viewTs.indexOf("this.readOnlyNodeIds = new Set();");
    expect(resetIdx).toBeGreaterThan(-1);
    const groupResetIdx = viewTs.indexOf(
      "this.compositeGroupInfo = { groupNodeIds: new Set(), groupEndNodeIds: new Set() };",
      resetIdx
    );
    expect(groupResetIdx).toBeGreaterThan(resetIdx);
    expect(groupResetIdx - resetIdx).toBeLessThan(200);
  });

  it("renderNode reads compositeGroupMember/compositeGroupEnd from this.compositeGroupInfo (not from readOnlyNodeIds — the two are deliberately independent, see collectCompositeGroupInfo's own doc comment)", () => {
    const body = getRenderNodeBody();
    expect(body).toContain("this.compositeGroupInfo.groupNodeIds.has(node.id)");
    expect(body).toContain("this.compositeGroupInfo.groupEndNodeIds.has(node.id)");
  });

  it("renderNode sets data-composite-group=\"true\" (a plain boolean hook, never a value derived from node.ruleId/prefix/label)", () => {
    const body = getRenderNodeBody();
    expect(body).toContain('selfEl.setAttribute("data-composite-group", "true");');
    // The literal string "true" is hardcoded — never string-templated from
    // any CompositeBlock-specific identifier.
    expect(body).not.toMatch(/setAttribute\("data-composite-group",\s*node\./);
  });

  it("renderNode sets data-composite-group-end=\"true\" only inside the compositeGroupEnd branch, and creates the dedicated accent child element with aria-hidden", () => {
    const body = getRenderNodeBody();
    expect(body).toContain('selfEl.setAttribute("data-composite-group-end", "true");');
    expect(body).toContain('cls: "unified-outliner-composite-accent"');
    expect(body).toContain('compositeAccentEl.setAttribute("aria-hidden", "true");');
  });

  it("never renders ruleId (or any other CompositeBlock-specific identifier) as a literal CSS class/data-attribute selector value for the group indicator", () => {
    const body = getRenderNodeBody();
    // The only place ruleId legitimately appears in renderNode at all is
    // unrelated to this indicator (it is never read by this ticket's own
    // additions) — this asserts the two new attributes/element never
    // interpolate it.
    expect(body).not.toMatch(/data-composite-group[^"]*"\s*,\s*[^"]*ruleId/);
    expect(body).not.toMatch(/unified-outliner-composite-accent[^"]*\$\{/);
  });

  it("does not alter the pre-existing readOnly / isComposite / drag-handle wiring this indicator is layered on top of", () => {
    const body = getRenderNodeBody();
    // The read-only contract (Phase 5D-0.3 approval §1) is untouched: still
    // gates rename/drag-drop/context-menu exactly as before.
    expect(body).toContain("const readOnly = this.readOnlyNodeIds.has(node.id);");
    // 2026-09-24 mobile follow-up fix widened this condition once more (to
    // also admit an eligible standalone callout/blockquote/table row) —
    // see OutlineTreeView.mobileCompositeDragHandle.test.ts and
    // standaloneComplexBlockDropUiWiring.test.ts for that widening's own
    // dedicated coverage; this test only re-confirms the indicator itself
    // did not touch this condition further.
    expect(body).toContain("if (!readOnly || isComposite || isEligibleStandaloneComplexMember) {");
    expect(body).toContain('dragHandleEl = selfEl.createDiv({ cls: "unified-outliner-drag-handle" });');
  });

  it("the new data-composite-group attribute is set unconditionally from compositeGroupMember, never gated by isCollapsed — so the parent row keeps the indicator whether expanded or collapsed", () => {
    const body = getRenderNodeBody();
    const attrIdx = body.indexOf('selfEl.setAttribute("data-composite-group", "true");');
    expect(attrIdx).toBeGreaterThan(-1);
    // This assignment must be reached purely from the `if (compositeGroupMember)`
    // guard directly above it, not from inside any isCollapsed-conditional
    // branch — the nearest preceding `if (` before it must be exactly the
    // compositeGroupMember check.
    const precedingIf = body.lastIndexOf("if (compositeGroupMember) {", attrIdx);
    expect(precedingIf).toBeGreaterThan(-1);
    expect(body.slice(precedingIf, attrIdx)).not.toContain("isCollapsed");
  });
});

describe("styles.css CompositeBlock group indicator (static source check)", () => {
  const cssText = readFileSync(path.resolve(__dirname, "../styles.css"), "utf-8");

  it("defines the group indicator selectors", () => {
    expect(cssText).toContain('.tree-item-self[data-composite-group="true"]');
    expect(cssText).toContain(".unified-outliner-composite-accent");
    expect(cssText).toContain('.tree-item-self[data-composite-group-end="true"] .unified-outliner-composite-accent');
  });

  it("uses --uo-current-color (the codebase's own existing 'grouped unit' color, already used by .unified-outliner-composite-prefix) for the accent, not a newly hardcoded color", () => {
    const accentBlockStart = cssText.indexOf(".unified-outliner-composite-accent {");
    expect(accentBlockStart).toBeGreaterThan(-1);
    const accentBlockEnd = cssText.indexOf("}", accentBlockStart);
    const accentBlock = cssText.slice(accentBlockStart, accentBlockEnd);
    expect(accentBlock).toContain("var(--uo-current-color)");
  });

  it("scopes position: relative to [data-composite-group=\"true\"] only, never applied unconditionally to .tree-item-self", () => {
    expect(cssText).not.toMatch(/^\.tree-item-self\s*\{[^}]*position:\s*relative/m);
  });

  it("does not remove the pre-existing drag-and-drop indicator rules this accent is designed to coexist with", () => {
    expect(cssText).toContain(".unified-outliner-drop-before,");
    expect(cssText).toContain(".unified-outliner-drop-inside::before");
    expect(cssText).toContain(".unified-outliner-drop-inside::after");
  });

  it("the group indicator's own rules never redeclare :before/:after on .tree-item-self itself (the accent is a real child element, not a pseudo-element of the row, precisely to avoid colliding with the drop-indicator pseudo-elements above)", () => {
    expect(cssText).not.toMatch(/\.tree-item-self\[data-composite-group[^\]]*\]::(before|after)/);
  });
});

/**
 * CSS-only refinement (2026-09-08, real-device follow-up): the parent row,
 * ordinary member rows, and the group's terminus row previously all shared
 * one identical accent (same border-left width/tint/opacity), which
 * real-device review found read as a single uniform pale band. These tests
 * cover the role-tiered styles.css rules added to fix that — still on the
 * same real `.unified-outliner-composite-accent` child element, the same
 * `--uo-current-color`/`color-mix()` pattern, and the same two pre-existing
 * `data-composite-group`/`data-composite-group-end` attributes; nothing
 * changed on the TypeScript side (see the describe block above, unchanged).
 *
 * As with every other test in this file, these are static source-text
 * checks only: they confirm the intended selectors/declarations exist in
 * styles.css, not that the result actually renders as intended in a real
 * browser/theme/screen size, and not any drag-and-drop, mobile, or
 * popout-window behavior — that still requires the manual real-device
 * acceptance pass (docs/composite_block_tree_visual_grouping_manual_acceptance_test.md).
 */
describe("styles.css CompositeBlock group indicator — 2026-09-08 role-tiered refinement (static source check)", () => {
  const cssText = readFileSync(path.resolve(__dirname, "../styles.css"), "utf-8");

  it("gives the parent (\"header\") row its own tier via [data-kind=\"composite\"], distinct from the plain member baseline", () => {
    const parentBlockStart = cssText.indexOf(
      '.tree-item-self[data-composite-group="true"][data-kind="composite"] .unified-outliner-composite-accent {'
    );
    expect(parentBlockStart).toBeGreaterThan(-1);
    const parentBlockEnd = cssText.indexOf("}", parentBlockStart);
    const parentBlock = cssText.slice(parentBlockStart, parentBlockEnd);
    expect(parentBlock).toContain("border-left-width: 3px;");
    expect(parentBlock).toContain("border-top-left-radius: 4px;");
    expect(parentBlock).toContain("border-top-right-radius: 4px;");
    // Top-only: the parent tier must not also round its bottom corners
    // (that would blur the distinction from the terminus row's own
    // bottom-only rounding below).
    expect(parentBlock).not.toContain("border-bottom-left-radius");
    expect(parentBlock).not.toContain("border-bottom-right-radius");
  });

  it("keeps the parent tier's stronger tint on the --uo-current-color color-mix() pattern (no new hardcoded color, no new custom property)", () => {
    const supportsIdx = cssText.indexOf(
      '@supports (background-color: color-mix(in srgb, red 10%, transparent)) {'
    );
    expect(supportsIdx).toBeGreaterThan(-1);
    const supportsEnd = cssText.indexOf("}", cssText.indexOf("}", supportsIdx) + 1);
    const supportsBlock = cssText.slice(supportsIdx, supportsEnd);
    expect(supportsBlock).toContain("color-mix(in srgb, var(--uo-current-color) 10%, transparent)");
  });

  it("gives the terminus row (data-composite-group-end) a treatment beyond opacity alone: a bottom-only border and bottom-only rounded corner", () => {
    const endBlockStart = cssText.indexOf(
      '.tree-item-self[data-composite-group-end="true"] .unified-outliner-composite-accent {'
    );
    expect(endBlockStart).toBeGreaterThan(-1);
    const endBlockEnd = cssText.indexOf("}", endBlockStart);
    const endBlock = cssText.slice(endBlockStart, endBlockEnd);
    expect(endBlock).toContain("border-bottom: 2px solid var(--uo-current-color);");
    expect(endBlock).toContain("border-bottom-left-radius: 4px;");
    expect(endBlock).toContain("border-bottom-right-radius: 4px;");
    // Bottom-only: the terminus tier must not also round its top corners
    // (that is the parent tier's own, separate signal).
    expect(endBlock).not.toContain("border-top-left-radius");
    expect(endBlock).not.toContain("border-top-right-radius");
  });

  it("never lets the terminus row's own tint opacity reach or exceed the parent tier's opacity (a terminus must never outrank the parent, and must stay only a small step above the plain member baseline)", () => {
    const baselineOpacityMatch = cssText.match(/\.unified-outliner-composite-accent\s*\{[^}]*opacity:\s*([\d.]+);/);
    const parentOpacityMatch = cssText.match(
      /\.tree-item-self\[data-composite-group="true"\]\[data-kind="composite"\] \.unified-outliner-composite-accent\s*\{[^}]*opacity:\s*([\d.]+);/
    );
    const endOpacityMatch = cssText.match(
      /\.tree-item-self\[data-composite-group-end="true"\] \.unified-outliner-composite-accent\s*\{[^}]*opacity:\s*([\d.]+);/
    );
    expect(baselineOpacityMatch).not.toBeNull();
    expect(parentOpacityMatch).not.toBeNull();
    expect(endOpacityMatch).not.toBeNull();
    const baseline = Number(baselineOpacityMatch![1]);
    const parent = Number(parentOpacityMatch![1]);
    const end = Number(endOpacityMatch![1]);
    expect(parent).toBeGreaterThan(baseline);
    expect(end).toBeGreaterThan(baseline);
    expect(end).toBeLessThan(parent);
  });

  it("suppresses the accent's own background-color (never the left-accent border) whenever the row is also current or keyboard-selected, so those two signals stay visually dominant", () => {
    const priorityBlockStart = cssText.indexOf(
      '.tree-item-self[data-composite-group="true"].unified-outliner-current .unified-outliner-composite-accent,'
    );
    expect(priorityBlockStart).toBeGreaterThan(-1);
    const priorityBlockEnd = cssText.indexOf("}", priorityBlockStart);
    const priorityBlock = cssText.slice(priorityBlockStart, priorityBlockEnd);
    expect(priorityBlock).toContain(".unified-outliner-selected .unified-outliner-composite-accent");
    // Explicitly repeats the parent tier's own two attribute selectors so
    // this rule's specificity is guaranteed >= the parent tier rule's,
    // regardless of any future reordering of this file (see this rule's
    // own doc comment in styles.css).
    expect(priorityBlock).toContain(
      '.tree-item-self[data-composite-group="true"][data-kind="composite"].unified-outliner-current .unified-outliner-composite-accent'
    );
    expect(priorityBlock).toContain(
      '.tree-item-self[data-composite-group="true"][data-kind="composite"].unified-outliner-selected .unified-outliner-composite-accent'
    );
    expect(priorityBlock).toContain("background-color: transparent;");
    // Never touches border-left here — the border stays the primary,
    // always-visible signal even on a current/selected CompositeBlock row.
    expect(priorityBlock).not.toMatch(/border-left/);
  });

  it("still does not introduce any new CSS custom property for this indicator — only --uo-current-color is read, matching the original implementation", () => {
    const sectionStart = cssText.indexOf('/* UI-only follow-up (2026-09-08, "Outline Tree の CompositeBlock');
    const sectionEnd = cssText.indexOf("/* Phase 5P-3 (", sectionStart);
    expect(sectionStart).toBeGreaterThan(-1);
    expect(sectionEnd).toBeGreaterThan(sectionStart);
    const section = cssText.slice(sectionStart, sectionEnd);
    const customPropertyUses = section.match(/var\(--[a-zA-Z0-9-]+/g) ?? [];
    for (const use of customPropertyUses) {
      expect(use).toBe("var(--uo-current-color");
    }
  });
});
