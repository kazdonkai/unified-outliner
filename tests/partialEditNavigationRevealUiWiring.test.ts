/**
 * 2026-09-30 (Partial Edit Pane navigation -> body editor sync):
 * static-source wiring checks. PartialEditView / OutlineTreeView /
 * settings.ts extend Obsidian classes and cannot be instantiated in vitest
 * (see tests/compositeBlockPartialEditUiWiring.test.ts's header), so this
 * file pins WHERE the reveal is (and is not) triggered; the decision and
 * the revealer themselves are unit-tested in
 * tests/partialEditNavigationReveal.test.ts.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const read = (p: string) => readFileSync(path.resolve(__dirname, p), "utf-8");
const viewTs = read("../src/view/PartialEditView.ts");
const treeTs = read("../src/view/OutlineTreeView.ts");
const mainTs = read("../src/main.ts");
const settingsTs = read("../src/settings.ts");
const revealTs = read("../src/view/editorLineReveal.ts");

function bodyOf(source: string, needle: string, label: string): string {
  const start = source.indexOf(needle);
  if (start === -1) throw new Error(`${label} not found — has it been renamed or removed?`);
  const end = source.indexOf("\n  }", start);
  if (end === -1 || end <= start) throw new Error(`Could not find ${label}'s closing brace`);
  return source.slice(start, end);
}

const REVEAL_OPT = "{ revealInEditor: true }";

describe("settings.ts: syncEditorOnPartialEditNavigation toggle", () => {
  it("is a toggle bound to the setting with its own i18n name/desc, saved on change", () => {
    expect(settingsTs).toContain('.setName(this.plugin.t("settings.syncEditorOnPartialEditNavigation.name"))');
    expect(settingsTs).toContain('.setDesc(this.plugin.t("settings.syncEditorOnPartialEditNavigation.desc"))');
    expect(settingsTs).toContain(".setValue(this.plugin.settings.syncEditorOnPartialEditNavigation)");
    expect(settingsTs).toContain("this.plugin.settings.syncEditorOnPartialEditNavigation = v;");
  });

  it("sits in the editing/interaction group, right after followKeyboardSelectionIntoBody", () => {
    const heading = settingsTs.indexOf('this.plugin.t("settings.editingInteractionHeading")');
    const follow = settingsTs.indexOf('this.plugin.t("settings.followKeyboardSelectionIntoBody.name")');
    const ours = settingsTs.indexOf('this.plugin.t("settings.syncEditorOnPartialEditNavigation.name")');
    const fold = settingsTs.indexOf('this.plugin.t("settings.syncOutlineTreeFoldingToEditor.name")');
    expect(heading).toBeGreaterThan(-1);
    expect(follow).toBeGreaterThan(heading);
    expect(ours).toBeGreaterThan(follow);
    expect(fold).toBeGreaterThan(ours);
  });
});

describe("PartialEditView: explicit user navigation asks for a reveal", () => {
  it("every in-pane navigation entry point passes { revealInEditor: true }", () => {
    for (const snippet of [
      // sibling nav (BlockNode) Previous / Next
      `const target = this.siblingState.previous;\n      if (target) this.requestLoadNode(target.nodeId, ${REVEAL_OPT});`,
      `const target = this.siblingState.next;\n      if (target) this.requestLoadNode(target.nodeId, ${REVEAL_OPT});`,
      // breadcrumb segment
      `segEl.addEventListener("click", () => this.requestLoadNode(ancestor.id, ${REVEAL_OPT}));`,
      // Subtree Navigator "More…" menu entry and chip
      `.onClick(() => this.requestLoadNode(child.id, ${REVEAL_OPT}))`,
      `const activate = () => this.requestLoadNode(child.id, ${REVEAL_OPT});`,
      // child-preview row (Phase 5L-7)
      `this.requestLoadNode(resolved.nodeId, ${REVEAL_OPT});`,
    ]) {
      expect(viewTs).toContain(snippet);
    }
    // No requestLoadNode call inside the view is left without the option.
    const bare = viewTs.match(/this\.requestLoadNode\([^)]*\)(?!\s*,)/g) ?? [];
    expect(bare.filter((c) => !c.includes("revealInEditor"))).toEqual([]);
  });

  it("image-ocr Previous/Next reveals only after a successful move (inside proceed's target branch)", () => {
    const body = bodyOf(viewTs, "private requestLoadAdjacentImageOcr(", "requestLoadAdjacentImageOcr");
    const loadIdx = body.indexOf("this.loadCompositeInternal(target);");
    const revealIdx = body.indexOf(`this.revealAfterNavigation(${REVEAL_OPT}, keyBefore);`);
    const keyIdx = body.indexOf("const keyBefore = this.loadedTargetKey();");
    expect(keyIdx).toBeGreaterThan(-1);
    expect(loadIdx).toBeGreaterThan(keyIdx);
    expect(revealIdx).toBeGreaterThan(loadIdx);
    // Exactly one reveal call; the "no target" paths never reveal.
    expect(body.split("revealAfterNavigation(").length - 1).toBe(1);
  });

  it("requestLoadNode keeps its guard shape and reveals after every successful load path (clean / discard / apply)", () => {
    const body = bodyOf(
      viewTs,
      "  requestLoadNode(nodeId: string, options: PartialEditNavigationOptions = {}): void {",
      "requestLoadNode"
    );
    expect(body).toContain("const keyBefore = this.loadedTargetKey();");
    expect(body).toContain("this.loadNodeInternal(nodeId);");
    expect(body).toContain("this.revealAfterNavigation(options, keyBefore);");
    expect(body).toContain('if (choice === "cancel") return;');
    expect(body).toContain("if (this.applyEdit()) {");
    // Cancel -> nothing (no load, hence no reveal).
    const cancelLine = body.slice(body.indexOf('if (choice === "cancel")'), body.indexOf('if (choice === "discard")'));
    expect(cancelLine).not.toContain("load()");
  });
});

describe("PartialEditView: internal refreshes never reveal", () => {
  const internal: Array<[string, string]> = [
    ["private loadNodeInternal(nodeId: string): void {", "loadNodeInternal"],
    ["private loadCompositeInternal(", "loadCompositeInternal"],
    ["private loadParagraphInternal(", "loadParagraphInternal"],
    ["private performAutoReload(", "performAutoReload"],
    ["private applyEdit(): boolean {", "applyEdit"],
    ["private async executeReload(): Promise<void> {", "executeReload"],
    ["private async performReload(): Promise<void> {", "performReload"],
    ["requestLoadComposite(snapshot: CompositeBlockSnapshot): void {", "requestLoadComposite"],
    ["requestLoadParagraphAtCursor(cursorLine: number): void {", "requestLoadParagraphAtCursor"],
    ["private refreshCompositeNavigationState(", "refreshCompositeNavigationState"],
  ];
  for (const [needle, label] of internal) {
    it(`${label} does not reveal in the editor`, () => {
      const body = bodyOf(viewTs, needle, label);
      expect(body).not.toContain("revealAfterNavigation(");
      expect(body).not.toContain("editorLineRevealer");
      expect(body).not.toContain("revealInEditor");
    });
  }

  it("the Tree-triggered open (main.ts) calls requestLoadNode without the reveal option", () => {
    expect(mainTs).toContain("leaf.view.requestLoadNode(nodeId);");
    expect(mainTs).not.toContain("revealInEditor");
  });
});

describe("PartialEditView.revealAfterNavigation: gated, active-leaf-first, fail-safe, no focus/draft impact", () => {
  const body = bodyOf(viewTs, "private revealAfterNavigation(", "revealAfterNavigation");

  it("is gated by the explicit request, the setting and a real target change", () => {
    expect(body).toContain("revealRequested: options.revealInEditor === true,");
    expect(body).toContain("settingEnabled: this.plugin.settings.syncEditorOnPartialEditNavigation,");
    expect(body).toContain("keyAfter: this.loadedTargetKey(),");
  });

  it("uses the shared ActiveMarkdownViewTracker editor, only for the pane's own note, via the shared revealer", () => {
    expect(body).toContain("const view = this.activeMarkdownView.get();");
    expect(body).toContain("(view.file?.path ?? null) !== this.sourcePath");
    expect(body).toContain("revealLineSafely(this.editorLineRevealer, view.editor, line);");
  });

  it("never focuses the editor, never adds a Notice, never touches dirty/draft/Apply state, and swallows errors", () => {
    for (const forbidden of [
      "focus(",
      "new Notice(",
      "updateDirtyState",
      "textareaEl",
      "originalText",
      "applyButtonEl",
      "cancelButtonEl",
      "isDirty(",
    ]) {
      expect(body).not.toContain(forbidden);
    }
    expect(body).toContain("try {");
    expect(body).toContain("} catch {");
  });

  it("the pane cancels its own stabilizer window on close", () => {
    const close = viewTs.slice(viewTs.indexOf("async onClose(): Promise<void> {"));
    expect(close.slice(0, close.indexOf("\n  }"))).toContain("this.editorLineRevealer.cancel();");
  });
});

describe("Shared line revealer: the Outline Tree jump uses the same implementation (no regression)", () => {
  it("jumpToLine delegates cursor + scroll to EditorLineRevealer and keeps its focus/highlight behavior", () => {
    const body = bodyOf(treeTs, "  private jumpToLine(", "jumpToLine");
    expect(body).toContain("this.lineRevealer.revealLine(editor, line);");
    expect(body).toContain("if (options.focusEditor) {");
    expect(body).toContain("editor.focus();");
    expect(body).toContain("this.treeRootEl.focus();");
    expect(body).toContain("this.highlightedId = id;");
    expect(body).toContain("this.renderTree();");
  });

  it("the moved scroll logic lives only in editorLineReveal.ts (no duplicate left in OutlineTreeView)", () => {
    for (const name of ["scrollLineToTop(", "scrollOffscreenContentIntoView(", "stabilizeScrollToLine("]) {
      expect(revealTs).toContain(name);
      expect(treeTs).not.toContain(`private ${name}`);
    }
    expect(revealTs).toContain('cm.dispatch({ effects: EditorView.scrollIntoView(pos, { y: "start" }) });');
    expect(revealTs).toContain("computeOffscreenContentScrollTop({");
    expect(treeTs).not.toContain("function getEditorCmView(");
    expect(treeTs).toContain('import { EditorLineRevealer, getEditorCmView } from "./editorLineReveal";');
  });

  it("the Tree still cancels its stabilizer window on close", () => {
    expect(treeTs).toContain("this.lineRevealer.cancel();");
    expect(treeTs).not.toContain("cancelScrollStabilize");
  });
});
