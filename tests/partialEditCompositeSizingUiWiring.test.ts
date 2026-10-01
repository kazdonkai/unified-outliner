/**
 * 1.0.6: Partial Edit Pane sizing for extended-block (composite) sessions —
 * static source checks: the list row is a wrapping, one-line-only textarea,
 * the list row and the body textarea are fitted to their text, and both get
 * a bottom-right resize grip that works with pointer (touch) events.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const paneTs = readFileSync(path.resolve(__dirname, "../src/view/PartialEditView.ts"), "utf-8");
const css = readFileSync(path.resolve(__dirname, "../styles.css"), "utf-8");

function body(signature: string): string {
  const start = paneTs.indexOf(signature);
  expect(start).toBeGreaterThan(-1);
  return paneTs.slice(start, paneTs.indexOf("\n  }\n", start));
}

describe("list row editor", () => {
  it("is a textarea, never accepts a newline (Enter swallowed, pasted newlines become spaces)", () => {
    expect(paneTs).toContain("private compositeListInputEl!: HTMLTextAreaElement;");
    expect(paneTs).toContain('if (evt.key === "Enter" && !evt.isComposing && !listImeComposing) evt.preventDefault();');
    expect(paneTs).toContain('this.compositeListInputEl.addEventListener("compositionend", () => {');
    expect(paneTs).toContain('el.value = el.value.replace(/\\r?\\n|\\r/g, " ");');
  });

  it("wraps long text and has no native resize handle (the plugin grip replaces it)", () => {
    const rule = css.slice(css.indexOf(".unified-outliner-partial-edit-composite-list-input {\n  resize: none;"));
    expect(rule).toContain("white-space: pre-wrap;");
    expect(rule).toContain("overflow-wrap: anywhere;");
  });
});

describe("fit-to-text sizing", () => {
  it("fit-to-text applies to extended blocks and single blocks; sections / list subtrees fill the pane until the grip is dragged", () => {
    const b = body("  private renderCompositeEditorSizing(): void {");
    expect(b).toContain('this.textareaEl.toggleClass("unified-outliner-partial-edit-textarea-fit", bodyFit || keepUserHeight);');
    expect(b).toContain('this.textareaEl.style.removeProperty("height");');
    expect(b).toContain("fitTextareaToContent(this.compositeListInputEl, 2, 1);");
    expect(b).toContain("if (this.isBodyFitActive() && !this.textareaUserSized) this.fitBodyTextarea();");
    const kinds = body("  private isBodyFitActive(): boolean {");
    for (const k of ["composite", "callout", "blockquote", "fenced-code", "table", "paragraph"]) {
      expect(kinds).toContain(`k === "${k}"`);
    }
    expect(kinds).not.toContain('"section"');
    expect(kinds).not.toContain('"list"');
    expect(body("  private renderCompositeListSlot(): void {")).toContain("this.renderCompositeEditorSizing();");
  });

  it("sections and list subtrees also get the grip; dragging it switches them to the dragged height", () => {
    expect(paneTs).toContain(
      'this.textareaUserSized = true;\n      // A section / list subtree editor fills the pane until it is dragged;\n      // from then on it keeps the dragged height (fit class = no flex-grow).\n      this.textareaEl.addClass("unified-outliner-partial-edit-textarea-fit");'
    );
    expect(body("  private renderCompositeEditorSizing(): void {")).toContain(
      "const keepUserHeight = this.nodeKind !== null && this.textareaUserSized;"
    );
  });

  it("auto-fit is capped at 70% of the pane so a long block never pushes the pane's controls away", () => {
    expect(body("  private fitBodyTextarea(): void {")).toContain("Math.round(this.contentEl.clientHeight * 0.7)");
  });

  it("every newly loaded block (node, paragraph, extended block) starts fitted again", () => {
    expect(paneTs).toContain('this.nodeKind = extracted.kind;\n    // 1.0.6: a newly loaded block starts fitted to its own text.\n    this.compositeListUserSized = false;\n    this.textareaUserSized = false;');
    expect(paneTs).toContain('this.nodeKind = "paragraph";\n    // 1.0.6: a newly loaded block starts fitted to its own text.\n    this.compositeListUserSized = false;\n    this.textareaUserSized = false;');
  });

  it("the body grip is hidden whenever the textarea is (e.g. a table's Table Mode tab)", () => {
    expect(css).toContain(
      '.unified-outliner-partial-edit-textarea[style*="visibility: hidden"] + .unified-outliner-partial-edit-textarea-grip {'
    );
  });

  it("a newly loaded extended block starts fitted again", () => {
    const load = paneTs.slice(paneTs.indexOf("  private loadCompositeInternal("));
    expect(load.slice(0, load.indexOf("this.originalText = extracted.text;"))).toContain(
      "this.compositeListUserSized = false;\n    this.textareaUserSized = false;"
    );
  });

  it("the fit class stops the body textarea from filling the pane", () => {
    const rule = css.slice(css.indexOf(".unified-outliner-partial-edit-textarea.unified-outliner-partial-edit-textarea-fit {"));
    expect(rule).toContain("flex: 0 0 auto;");
    expect(rule).toContain("min-height: 0;");
  });
});

describe("resize grips", () => {
  it("both editors get a grip; dragging marks the editor as user-sized", () => {
    expect(paneTs).toContain("attachResizeGrip(this.compositeListGripEl, this.compositeListInputEl, () => {\n      this.compositeListUserSized = true;");
    expect(paneTs).toContain("attachResizeGrip(this.textareaGripEl, this.textareaEl, () => {\n      this.textareaUserSized = true;");
    expect(body("  private renderCompositeEditorSizing(): void {")).toContain("this.textareaGripEl.toggleVisibility(this.nodeKind !== null);");
  });

  it("uses pointer events with pointer capture and touch-action: none, so it works on iPad", () => {
    const fn = paneTs.slice(paneTs.indexOf("function attachResizeGrip("));
    expect(fn).toContain('grip.addEventListener("pointerdown"');
    expect(fn).toContain("grip.setPointerCapture(evt.pointerId);");
    const rule = css.slice(css.indexOf(".unified-outliner-partial-edit-resize-grip {"));
    expect(rule.slice(0, rule.indexOf("}"))).toContain("touch-action: none;");
    expect(css).toContain('.unified-outliner-partial-edit-textarea-grip[style*="visibility: hidden"],');
  });
});

describe("editor backgrounds", () => {
  it("the list row editor always has its own background (not only on focus), themeable via Style Settings", () => {
    expect(css).toContain(
      ".unified-outliner-partial-edit-composite-list-input,\n.unified-outliner-partial-edit-composite-list-input:hover,\n.unified-outliner-partial-edit-composite-list-input:focus {\n  background-color: var(--uo-partial-edit-list-bg, var(--uo-bg-color));\n}"
    );
  });

  it("the body editor uses its own Style Settings variable, falling back to the pane background", () => {
    expect(css).toContain("background-color: var(--uo-partial-edit-body-bg, var(--uo-bg-color));");
  });

  it("both variables are declared as separate Style Settings colors", () => {
    const settings = css.slice(css.indexOf("/* @settings"), css.indexOf("*/", css.indexOf("/* @settings")));
    expect(settings).toContain("id: uo-partial-edit-list-bg");
    expect(settings).toContain("id: uo-partial-edit-body-bg");
  });
});

describe("Block ID field look (1.0.6)", () => {
  it("uses the plugin's own style on every platform, out-ranking Obsidian's mobile form-field rules without !important", () => {
    const sel = "body .unified-outliner-partial-edit-view input.unified-outliner-partial-edit-block-id-input";
    const start = css.indexOf(sel + ",\n");
    expect(start).toBeGreaterThan(-1);
    const rule = css.slice(start, css.indexOf("}", start));
    expect(rule).toContain(sel + ":focus");
    expect(rule).toContain("appearance: none;");
    expect(rule).toContain("background-color: var(--uo-partial-edit-blockid-bg, var(--uo-partial-edit-body-bg, var(--uo-bg-color)));");
    expect(rule).toContain("border-radius: 4px;");
    expect(rule).not.toContain("!important");
  });

  it("has its own Style Settings color", () => {
    const settings = css.slice(css.indexOf("/* @settings"), css.indexOf("*/", css.indexOf("/* @settings")));
    expect(settings).toContain("id: uo-partial-edit-blockid-bg");
  });
});
