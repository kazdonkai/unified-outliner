/**
 * The child inline editor's textarea (opened from a child row's pencil in
 * a parent list item's Partial Edit pane) gets the same bottom-right
 * resize grip as the pane's own body textarea: the shared
 * attachResizeGrip (pointer events + pointer capture + touch-action: none,
 * so iPad touch works too) and the shared two-stroke marker.
 *
 * Static-source-text checks only (PartialEditView can't be constructed in
 * vitest) — the actual drawing and iPad dragging are checked on a device.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const paneTs = readFileSync(path.resolve(__dirname, "../src/view/PartialEditView.ts"), "utf-8");
const css = readFileSync(path.resolve(__dirname, "../styles.css"), "utf-8");

function methodBody(needle: string): string {
  const start = paneTs.indexOf(needle);
  expect(start).toBeGreaterThan(-1);
  return paneTs.slice(start, paneTs.indexOf("\n  }\n", start));
}

describe("child inline editor textarea resize grip", () => {
  it("is created once, right after the child textarea inside the child inline editor, with the shared grip classes", () => {
    const textareaIdx = paneTs.indexOf("this.childInlineTextareaEl = this.childInlineEditorEl.createEl(\"textarea\", {");
    const gripIdx = paneTs.indexOf("this.childInlineTextareaGripEl = this.childInlineEditorEl.createDiv({");
    const hideIdx = paneTs.indexOf("this.childInlineEditorEl.toggleVisibility(false);\n\n    // Phase 5L-9");
    expect(textareaIdx).toBeGreaterThan(-1);
    expect(gripIdx).toBeGreaterThan(textareaIdx);
    expect(hideIdx).toBeGreaterThan(gripIdx);
    expect(paneTs.split("this.childInlineTextareaGripEl = ").length - 1).toBe(1);
    expect(paneTs).toContain(
      'cls: "unified-outliner-partial-edit-resize-grip unified-outliner-partial-edit-child-inline-textarea-grip",'
    );
  });

  it("reuses attachResizeGrip (registered, so its observer is released with the view) and never touches the text or the dirty state", () => {
    const start = paneTs.indexOf("attachResizeGrip(\n        this.childInlineTextareaGripEl,\n        this.childInlineTextareaEl,");
    expect(start).toBeGreaterThan(-1);
    expect(paneTs.slice(start - 40, start)).toContain("this.register(\n      ");
    const call = paneTs.slice(start, paneTs.indexOf("BODY_TEXTAREA_GRIP_PLACEMENT\n      )", start));
    expect(call).not.toContain(".value");
    expect(call).not.toContain("updateDirtyState");
  });

  it("drops a dragged size only when another child (or no child) is shown — never on an ordinary re-render or on input", () => {
    const body = methodBody("  private renderChildInlineEditor(): void {");
    expect(body).toContain("if (session.childNodeId !== this.childInlineSizedChildId) {");
    expect(body).toContain('this.childInlineTextareaEl.style.removeProperty("height");');
    expect(body).toContain(
      "clearResizeGripWidth(this.childInlineTextareaGripEl, this.childInlineTextareaEl, BODY_TEXTAREA_GRIP_PLACEMENT);"
    );
    // the child textarea's only input listener is the dirty-state check (no auto-fit that would undo a drag)
    expect(paneTs.match(/this\.childInlineTextareaEl\.addEventListener\(/g)).toHaveLength(1);
  });

  it("the grip sits on the textarea's bottom-right corner; the shared grip rule keeps touch-action: none and the diagonal cursor", () => {
    const rule = css.slice(css.indexOf(".unified-outliner-partial-edit-child-inline-textarea-grip {"));
    const decl = rule.slice(0, rule.indexOf("}"));
    expect(decl).toContain("margin-left: auto;");
    expect(decl).toContain("margin-right: 3px;");
    expect(decl).toMatch(/margin-top:\s*-\d+px;/);
    const shared = css.slice(css.indexOf(".unified-outliner-partial-edit-resize-grip {"));
    const sharedDecl = shared.slice(0, shared.indexOf("}"));
    expect(sharedDecl).toContain("touch-action: none;");
    expect(sharedDecl).toContain("cursor: nwse-resize;");
  });
});
