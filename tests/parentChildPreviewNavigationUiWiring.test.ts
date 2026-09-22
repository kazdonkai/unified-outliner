/**
 * Phase 5L-7 ("Read-Only Child Subtree Preview Navigation"): static-
 * source-text checks for the wiring this ticket added to
 * view/PartialEditView.ts — mirrors
 * tests/parentListItemPartialEditUiWiring.test.ts's own structure (same
 * "PartialEditView can't be constructed in vitest" constraint — see that
 * file's own top doc comment).
 *
 * The real, non-Obsidian-dependent logic this wiring calls into
 * (buildChildPreviewRowTargets via buildParentListItemProjection,
 * resolveParentChildPreviewNavigationTarget) is unit-tested directly, with
 * real parseDocument-backed assertions, in
 * tests/parentChildPreviewNavigation.test.ts — this file only confirms the
 * View layer wires into that logic at the right place, reuses the
 * EXISTING requestLoadNode/DiscardChangesModal target-switching guard
 * rather than inventing a new one, and never turns a preview row into an
 * editable control of any kind.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const viewTs = readFileSync(path.resolve(__dirname, "../src/view/PartialEditView.ts"), "utf-8");

function bodyOf(source: string, needle: string, label: string): string {
  const start = source.indexOf(needle);
  if (start === -1) {
    throw new Error(`${label} not found — has it been renamed or removed?`);
  }
  const end = source.indexOf("\n  }", start);
  if (end === -1 || end <= start) {
    throw new Error(
      `Could not find ${label}'s closing brace — its shape may have changed; update this test's bounding logic.`
    );
  }
  return source.slice(start, end);
}

function renderParentChildPreviewBody(): string {
  return bodyOf(viewTs, "private renderParentChildPreview(): void {", "renderParentChildPreview");
}

function handleChildPreviewRowActivateBody(): string {
  return bodyOf(
    viewTs,
    "private handleChildPreviewRowActivate(target: ParentChildPreviewNavigationTarget): void {",
    "handleChildPreviewRowActivate"
  );
}

describe("view/PartialEditView.ts: Phase 5L-7 (Read-Only Child Subtree Preview Navigation)", () => {
  it("imports ParentChildPreviewNavigationTarget/resolveParentChildPreviewNavigationTarget from the same edit/parentListItemProjection.ts Phase 5L-6 already imports from", () => {
    expect(viewTs).toContain('from "../edit/parentListItemProjection"');
    expect(viewTs).toContain("ParentChildPreviewNavigationTarget");
    expect(viewTs).toContain("resolveParentChildPreviewNavigationTarget");
  });

  it("renderParentChildPreview only wires click/keydown handling onto a row that HAS a resolvable childPreviewRowTargets entry — a row without one stays exactly as inert as Phase 5L-6 left it", () => {
    const body = renderParentChildPreviewBody();
    expect(body).toContain("projection.childPreviewRowTargets[i]");
    expect(body).toContain("if (target && !isPendingDeletionRow) {");
    // The click/keydown wiring must be textually INSIDE the `if (target)`
    // guard, not applied unconditionally to every row.
    const guardIdx = body.indexOf("if (target && !isPendingDeletionRow) {");
    const guardedRegion = body.slice(guardIdx);
    expect(guardedRegion).toContain('rowEl.addEventListener("click"');
    expect(guardedRegion).toContain('rowEl.addEventListener("keydown"');
    expect(guardedRegion).toContain('evt.key === "Enter" || evt.key === " "');
    expect(guardedRegion).toContain("this.handleChildPreviewRowActivate(target)");
  });

  it("never adds a textarea/input/checkbox/contenteditable/drag-handle/context-menu to a child preview row", () => {
    const body = renderParentChildPreviewBody();
    // Actual DOM/attribute usage only — deliberately NOT a bare substring
    // check against the whole body, since this method's own doc comments
    // (immediately above) reference several of these words in PROSE
    // explaining what this ticket does NOT add; a bare "not.toContain"
    // would false-positive on that prose the moment it's written down.
    expect(body).not.toContain('createEl("textarea"');
    expect(body).not.toContain('createEl("input"');
    expect(body).not.toContain(".contentEditable");
    expect(body).not.toContain('setAttribute("contenteditable"');
    expect(body).not.toContain(".draggable = ");
    expect(body).not.toContain('setAttribute("draggable"');
    expect(body).not.toContain('addEventListener("dragstart"');
    expect(body).not.toContain('addEventListener("dragover"');
    expect(body).not.toContain('addEventListener("drop"');
    expect(body).not.toContain('addEventListener("contextmenu"');
    expect(body).not.toContain("new Menu()");
  });

  it("a navigable row keeps the SAME aria-readonly/data-readonly contract every row already had, and additionally gets role=button + a tooltip, mirroring appendSubtreeChip's own convention", () => {
    const body = renderParentChildPreviewBody();
    expect(body).toContain('rowEl.setAttribute("aria-readonly", "true");');
    expect(body).toContain('rowEl.setAttribute("data-readonly", "true");');
    const guardIdx = body.indexOf("if (target && !isPendingDeletionRow) {");
    const guardedRegion = body.slice(guardIdx);
    expect(guardedRegion).toContain('rowEl.setAttribute("role", "button");');
    expect(guardedRegion).toContain("rowEl.tabIndex = 0;");
    expect(guardedRegion).toContain('setTooltip(rowEl, this.plugin.t("partialEdit.parentChildPreviewRowOpenLabel"));');
    expect(guardedRegion).toContain(
      'rowEl.addClass("unified-outliner-partial-edit-parent-child-preview-row-navigable");'
    );
  });

  it("a navigable row's activation stops event propagation before doing anything else, so it can never also trigger an unrelated ancestor click handler", () => {
    const body = renderParentChildPreviewBody();
    const activateIdx = body.indexOf("const activate = (evt: Event) => {");
    expect(activateIdx).toBeGreaterThan(-1);
    const activateBody = body.slice(activateIdx, body.indexOf("};", activateIdx));
    const stopIdx = activateBody.indexOf("evt.stopPropagation();");
    const handleIdx = activateBody.indexOf("this.handleChildPreviewRowActivate(target);");
    expect(stopIdx).toBeGreaterThan(-1);
    expect(handleIdx).toBeGreaterThan(stopIdx);
  });

  it("handleChildPreviewRowActivate re-parses the CURRENT active note fresh and re-resolves the target via resolveParentChildPreviewNavigationTarget before ever navigating — it never trusts the target's captured nodeId directly", () => {
    const body = handleChildPreviewRowActivateBody();
    expect(body).toContain("parseDocument(view.editor.getValue())");
    expect(body).toContain("resolveParentChildPreviewNavigationTarget(doc, this.nodeId, target)");
    // The nodeId ACTUALLY navigated to must come from the resolver's own
    // fresh result, never from `target.nodeId` directly.
    expect(body).toContain("this.requestLoadNode(resolved.nodeId)");
    expect(body).not.toContain("this.requestLoadNode(target.nodeId)");
  });

  it("handleChildPreviewRowActivate only ever calls requestLoadNode — the pane's own existing clean/dirty (Apply/Discard/Cancel via DiscardChangesModal) target-switching guard — and NEVER loadNodeInternal directly, so a dirty parent draft can never be silently discarded by a child-preview click", () => {
    const body = handleChildPreviewRowActivateBody();
    expect(body).toContain("this.requestLoadNode(");
    expect(body).not.toContain("this.loadNodeInternal(");
  });

  it("handleChildPreviewRowActivate shows a Notice and returns without navigating whenever resolution fails, leaving the parent's own nodeId/draft state completely untouched", () => {
    const body = handleChildPreviewRowActivateBody();
    const failIdx = body.indexOf("if (!resolved.ok) {");
    expect(failIdx).toBeGreaterThan(-1);
    const failBranch = body.slice(failIdx, body.indexOf("}", body.indexOf("return;", failIdx)) + 1);
    expect(failBranch).toContain('new Notice(this.plugin.t("partialEdit.parentChildPreviewNavigationFailed"));');
    expect(failBranch).toContain("return;");
    expect(failBranch).not.toContain("this.nodeId =");
    expect(failBranch).not.toContain("this.textareaEl.value =");
  });

  it("defines the required Phase 5L-7 i18n keys in both dictionaries", () => {
    const i18nTs = readFileSync(path.resolve(__dirname, "../src/i18n.ts"), "utf-8");
    const enCount = i18nTs.split('"partialEdit.parentChildPreviewRowOpenLabel"').length - 1;
    const failedCount = i18nTs.split('"partialEdit.parentChildPreviewNavigationFailed"').length - 1;
    expect(enCount).toBe(2); // once in the EN dictionary, once in JA
    expect(failedCount).toBe(2);
  });
});
