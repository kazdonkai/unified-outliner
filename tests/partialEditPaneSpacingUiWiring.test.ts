import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * UI-only follow-up (2026-09-09, "Partial Edit Pane（部分編集ペイン）の
 * 上部余白・入力ボックス配置に関するUI調整"): static source-text checks
 * for the changes that together close the reported "vast blank space
 * directly below the header, textarea pushed toward the bottom" gap:
 *
 * 1. styles.css: `.unified-outliner-partial-edit-view`'s six row children
 *    (header / sync-status / breadcrumb / sibling-nav / subtree-nav /
 *    quote-header) each used to declare their own `margin-bottom: 8px`.
 *    These are now consolidated into a single `gap: 6px` on the parent
 *    flex container — one source of truth for the row-to-row rhythm.
 * 2. PartialEditView.ts's renderSiblingNav(): the sibling-nav row used to
 *    stay visible whenever any node was loaded, even when the loaded node
 *    had no sibling in either direction (always true for a CompositeBlock
 *    — see loadCompositeInternal's own "no breadcrumb / sibling nav /
 *    Subtree Navigator for a CompositeBlock" comment, Phase 5D-2A), so it
 *    rendered a permanently-useless row of two disabled buttons. The row
 *    is now hidden in that case too.
 * 3. styles.css: the DOMINANT cause, found via live device console
 *    measurement AFTER (1)+(2) still left a 146px header→textarea gap on
 *    a plain paragraph edit. Obsidian's own toggleVisibility(false) sets
 *    inline `style="visibility: hidden;"`, not `display: none` — an
 *    invisible row still fully participates in layout (own height,
 *    padding, and gap share). A new rule forces any row Obsidian hid this
 *    way (matched via `[style*="visibility: hidden"]`, since CSS has no
 *    selector for "this element's own visibility is hidden") to
 *    `display: none !important`, actually collapsing its space.
 *
 * These are static checks only: they confirm the intended declarations
 * exist (and the ones that should be gone are gone) in styles.css and
 * PartialEditView.ts's raw text, not that the result actually renders as
 * a visually tight layout on a real device/theme — that still requires
 * the manual real-device acceptance pass. Same convention as every other
 * *UiWiring.test.ts in this suite.
 */
describe("Partial Edit Pane header-to-textarea spacing (static source check)", () => {
  const cssText = readFileSync(path.resolve(__dirname, "../styles.css"), "utf-8");
  const viewText = readFileSync(
    path.resolve(__dirname, "../src/view/PartialEditView.ts"),
    "utf-8"
  );

  function getCssBlock(selector: string): string {
    const start = cssText.indexOf(`${selector} {`);
    expect(start).toBeGreaterThan(-1);
    const end = cssText.indexOf("}", start);
    return cssText.slice(start, end);
  }

  it("gives .unified-outliner-partial-edit-view a single gap: 6px, replacing the six per-row margin-bottom declarations", () => {
    const block = getCssBlock(".unified-outliner-partial-edit-view");
    expect(block).toContain("gap: 6px;");
    // Layout/box-model properties this ticket must not disturb.
    expect(block).toContain("display: flex;");
    expect(block).toContain("flex-direction: column;");
    expect(block).toContain("height: 100%;");
    expect(block).toContain("box-sizing: border-box;");
    expect(block).toContain("padding: 8px;");
    expect(block).toContain("background-color: var(--uo-bg-color);");
  });

  it.each([
    ".unified-outliner-partial-edit-header",
    ".unified-outliner-partial-edit-sync-status",
    ".unified-outliner-partial-edit-breadcrumb",
    ".unified-outliner-partial-edit-sibling-nav",
    ".unified-outliner-partial-edit-subtree-nav",
    ".unified-outliner-partial-edit-quote-header",
  ])("removes the now-redundant margin-bottom from %s (spacing now comes from the parent's gap)", (selector) => {
    const block = getCssBlock(selector);
    expect(block).not.toMatch(/margin-bottom/);
  });

  it("leaves each row's own non-spacing layout properties untouched", () => {
    expect(getCssBlock(".unified-outliner-partial-edit-header")).toContain(
      "justify-content: space-between;"
    );
    expect(getCssBlock(".unified-outliner-partial-edit-sync-status")).toContain(
      "padding: 4px 8px;"
    );
    expect(getCssBlock(".unified-outliner-partial-edit-breadcrumb")).toContain("opacity: 0.75;");
    expect(getCssBlock(".unified-outliner-partial-edit-sibling-nav")).toContain(
      "justify-content: flex-start;"
    );
    expect(getCssBlock(".unified-outliner-partial-edit-subtree-nav")).toContain(
      "color: var(--uo-text-color);"
    );
    expect(getCssBlock(".unified-outliner-partial-edit-quote-header")).toContain(
      "background-color: rgba(128, 128, 128, 0.08);"
    );
  });

  it("leaves the textarea's own flex-grow/min-height sizing exactly as it was, untouched by this ticket", () => {
    const block = getCssBlock(".unified-outliner-partial-edit-textarea");
    expect(block).toContain("flex: 1 1 auto;");
    expect(block).toContain("min-height: 200px;");
    expect(block).not.toMatch(/margin/);
  });

  it("introduces no new hardcoded color for this ticket (spacing-only CSS change)", () => {
    const block = getCssBlock(".unified-outliner-partial-edit-view");
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("forces the five toggleVisibility(false)-hidden rows out of layout, since Obsidian's own hide() sets visibility:hidden (still participates in layout) rather than display:none", () => {
    const start = cssText.indexOf('.unified-outliner-partial-edit-sync-status[style*="visibility: hidden"]');
    expect(start).toBeGreaterThan(-1);
    const end = cssText.indexOf("}", start);
    const block = cssText.slice(start, end);
    expect(block).toContain('.unified-outliner-partial-edit-sync-status[style*="visibility: hidden"]');
    expect(block).toContain('.unified-outliner-partial-edit-breadcrumb[style*="visibility: hidden"]');
    expect(block).toContain('.unified-outliner-partial-edit-sibling-nav[style*="visibility: hidden"]');
    expect(block).toContain('.unified-outliner-partial-edit-subtree-nav[style*="visibility: hidden"]');
    expect(block).toContain('.unified-outliner-partial-edit-quote-header[style*="visibility: hidden"]');
    expect(block).toContain("display: none !important;");
  });

  it("hides the sibling-nav row when the loaded node has no sibling in either direction, not just when no node is loaded", () => {
    expect(viewText).toContain(
      'if (!this.nodeId || (!this.siblingState.previous && !this.siblingState.next)) {\n      this.siblingNavEl.toggleVisibility(false);'
    );
  });

  it("leaves the breadcrumb/Subtree Navigator's own existing hide-when-empty conditions untouched", () => {
    expect(viewText).toContain("if (this.ancestors.length === 0) {");
    expect(viewText).toContain("this.breadcrumbEl.toggleVisibility(false);");
    expect(viewText).toContain("if (this.directChildren.length === 0) {");
    expect(viewText).toContain("this.subtreeNavEl.toggleVisibility(false);");
  });

  it("leaves the per-button disabled/tooltip/target-label wiring inside renderSiblingNav untouched", () => {
    expect(viewText).toContain("this.siblingPrevEl.disabled = !previous;");
    expect(viewText).toContain("this.siblingNextEl.disabled = !next;");
    expect(viewText).toContain("this.siblingPrevTargetEl.toggleVisibility(!!previous);");
    expect(viewText).toContain("this.siblingNextTargetEl.toggleVisibility(!!next);");
  });

  it("leaves Apply/Cancel dirty-state visibility and the quote-header/sync-status toggle logic untouched", () => {
    expect(viewText).toContain("this.applyButtonEl.toggleVisibility(dirty);");
    expect(viewText).toContain("this.cancelButtonEl.toggleVisibility(dirty);");
    expect(viewText).toContain("this.syncStatusEl.toggleVisibility(show);");
    expect(viewText).toContain("this.quoteHeaderEl.toggleVisibility(true);");
  });

  it("leaves the textarea's own input listener (dirty-state tracking) untouched", () => {
    expect(viewText).toContain('this.textareaEl.addEventListener("input", () => this.updateDirtyState());');
  });
});
