/**
 * 1.0.8 follow-up: static wiring checks for the parent list item
 * List + Paragraph split in view/PartialEditView.ts (the view itself can't
 * be constructed in vitest — the pure pipeline is tested with real parses
 * in tests/parentOwnTextParagraphSplit.test.ts).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const viewTs = readFileSync(path.resolve(__dirname, "../src/view/PartialEditView.ts"), "utf-8");

function bodyOf(needle: string): string {
  const start = viewTs.indexOf(needle);
  expect(start).toBeGreaterThan(-1);
  return viewTs.slice(start, viewTs.indexOf("\n  }\n", start));
}

describe("parent own-text List + Paragraph split wiring", () => {
  it("the split is derived only in reconcileStandaloneNodeState from the fresh parent projection, and cleared with it on every other load", () => {
    expect(bodyOf("  private reconcileStandaloneNodeState(")).toContain(
      "this.parentOwnTextSplit = projections.parent ? resolveParentOwnTextParagraphSplit(doc, projections.parent) : null;"
    );
    expect(viewTs.split("this.standaloneParentListItemProjection = null;\n    this.parentOwnTextSplit = null;").length - 1).toBe(3);
  });

  it("every parent dirty check and every parent Apply path reads the JOINED body (no separate save path)", () => {
    expect(viewTs).not.toMatch(/invertParentListItemProjection\([^)]*this\.textareaEl\.value/);
    expect(viewTs).not.toContain("this.textareaEl.value !== projectedParentBodyText(projection)");
    expect(viewTs).not.toContain("editedParentBody: this.textareaEl.value,");
    expect(viewTs.split("editedParentBody: this.bodyEditorText(),").length - 1).toBe(2);
    expect(bodyOf("  private isDirty(): boolean {")).toContain("(this.bodyEditorText() !== this.currentDisplayText() ||");
    const join = bodyOf("  private bodyEditorText(): string {");
    expect(join).toContain("joinParentOwnTextParagraphSplit(this.compositeListInputEl.value, this.textareaEl.value)");
  });

  it("every reset of the body editor also resets both boxes (Cancel, load, post-Apply, auto-reload)", () => {
    const resets = viewTs.split("this.textareaEl.value = this.currentDisplayText();\n").length - 1;
    const synced = viewTs.split(/this\.textareaEl\.value = this\.currentDisplayText\(\);\n\s*this\.syncParentOwnTextSplitEditors\(\);/).length - 1;
    expect(resets).toBeGreaterThan(0);
    expect(synced).toBe(resets);
    const sync = bodyOf("  private syncParentOwnTextSplitEditors(): void {");
    expect(sync).toContain('if (this.nodeKind !== "list") return;');
    expect(sync).toContain("this.compositeListInputEl.value = split.listBody;");
    expect(sync).toContain("this.textareaEl.value = split.paragraphBody;");
  });

  it("the split is only ever active for a loaded list node with a parent projection; the list box reuses the composite list row (and its grip)", () => {
    const active = bodyOf("  private activeParentOwnTextSplit(): ParentOwnTextParagraphSplit | null {");
    expect(active).toContain('this.nodeKind === "list" && this.nodeId !== null && this.standaloneParentListItemProjection');
    expect(bodyOf("  private renderCompositeListSlot(): void {")).toContain("const split = this.activeParentOwnTextSplit();");
    expect(bodyOf("  private isCompositeFitActive(): boolean {")).toContain("this.activeParentOwnTextSplit() !== null");
    // 15: no new grip — the list row and the body textarea keep their existing attachResizeGrip registrations
    expect(viewTs.match(/this\.register\(\n\s+attachResizeGrip\(/g)).toHaveLength(3);
  });
});

describe("parent own-text split: box sizing balance (1.0.8 follow-up)", () => {
  it("the list box is fitted to at least 3 lines and the paragraph box is sized to its text (no longer pane-filling); composites keep 2", () => {
    expect(bodyOf("  private listRowMinLines(): number {")).toContain("return this.activeParentOwnTextSplit() !== null ? 3 : 2;");
    expect(viewTs.match(/fitTextareaToContent\(\S+, this\.listRowMinLines\(\), 1\)/g)).toHaveLength(2);
    expect(viewTs).not.toMatch(/fitTextareaToContent\([^)]*compositeList[^)]*, 2, 1\)/);
    expect(viewTs).not.toContain("fitTextareaToContent(el, 2, 1)");
    expect(bodyOf("  private isBodyFitActive(): boolean {")).toContain("this.activeParentOwnTextSplit() !== null");
  });
});
