/**
 * Phase 5L-8 ("Child Item Inline Structured Editing in Parent Partial Edit
 * Pane"): static-source-text checks for the wiring this ticket added to
 * view/PartialEditView.ts — mirrors
 * tests/parentChildPreviewNavigationUiWiring.test.ts's own structure (same
 * "PartialEditView can't be constructed in vitest" constraint — see that
 * file's own top doc comment).
 *
 * The real, non-Obsidian-dependent logic this wiring calls into
 * (evaluateChildInlineEditEligibility, buildParentChildInlineEditSession,
 * invertAndValidateParentChildCombinedEdit,
 * applyParentChildInlineEditToDocument, etc. — all of
 * edit/parentChildInlineEditSession.ts) is unit-tested directly, with real
 * parseDocument-backed assertions, in tests/parentChildInlineEdit.test.ts —
 * this file only confirms the View layer wires into that logic at the
 * right place: the edit-start affordance is a genuinely separate control
 * from row navigation, opening/closing a child session reuses the
 * existing DiscardChangesModal dirty guard (never a new one), Apply
 * dispatches to the ONE combined atomic path whenever a child session is
 * open, isDirty()/cancelEdit() fold the child draft in, and every place
 * standaloneParentListItemProjection itself resets also resets
 * childInlineSession.
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

function renderChildInlineEditorBody(): string {
  return bodyOf(viewTs, "private renderChildInlineEditor(): void {", "renderChildInlineEditor");
}

function handleStartChildInlineEditBody(): string {
  return bodyOf(
    viewTs,
    "private handleStartChildInlineEdit(childNodeId: string): void {",
    "handleStartChildInlineEdit"
  );
}

function handleStopChildInlineEditBody(): string {
  return bodyOf(viewTs, "private handleStopChildInlineEdit(): void {", "handleStopChildInlineEdit");
}

function isChildInlineDraftDirtyBody(): string {
  return bodyOf(viewTs, "private isChildInlineDraftDirty(): boolean {", "isChildInlineDraftDirty");
}

function cancelEditBody(): string {
  return bodyOf(viewTs, "private cancelEdit(): void {", "cancelEdit");
}

function applyEditBody(): string {
  return bodyOf(viewTs, "private applyEdit(): boolean {", "applyEdit");
}

function applyParentChildCombinedEditBody(): string {
  return bodyOf(
    viewTs,
    "private applyParentChildCombinedEdit(doc: ParsedDocument, editor: Editor): boolean {",
    "applyParentChildCombinedEdit"
  );
}

function isDirtyBody(): string {
  return bodyOf(viewTs, "private isDirty(): boolean {", "isDirty");
}

describe("view/PartialEditView.ts: Phase 5L-8 (Child Item Inline Structured Editing in Parent Partial Edit Pane)", () => {
  it("imports the Phase 5L-8 session module's real logic from edit/parentChildInlineEditSession.ts — never reimplements it", () => {
    expect(viewTs).toContain('from "../edit/parentChildInlineEditSession"');
    expect(viewTs).toContain("evaluateChildInlineEditEligibility");
    expect(viewTs).toContain("buildParentChildInlineEditSession");
    expect(viewTs).toContain("invertAndValidateParentChildCombinedEdit");
    expect(viewTs).toContain("applyParentChildInlineEditToDocument");
  });

  it("declares a single childInlineSession field, initialized to null", () => {
    expect(viewTs).toContain(
      "private childInlineSession: ParentChildInlineEditSession | null = null;"
    );
  });

  it("resets childInlineSession to null in every place standaloneParentListItemProjection's own sibling reset already runs (resetLoadedState/loadParagraphInternal/loadCompositeInternal directly; loadNodeInternal via the shared reconcileStandaloneNodeState it now delegates to)", () => {
    // 2026-09-22 (Phase 5L-12): loadNodeInternal no longer resets
    // childInlineSession with its own inline "this.childInlineSession =
    // null;" statement -- that reset now happens once, unconditionally,
    // inside reconcileStandaloneNodeState (which loadNodeInternal calls),
    // alongside the analogous pendingLeafFirstChild reset -- see that
    // method's own doc comment for why resetting both unconditionally is
    // safe. resetLoadedState/loadParagraphInternal/loadCompositeInternal
    // were untouched by this phase and still reset it inline exactly as
    // before.
    const directResetMethods: Array<[string, string]> = [
      ["private resetLoadedState(): void {", "resetLoadedState"],
      ["private loadParagraphInternal(cursorLine: number): void {", "loadParagraphInternal"],
      [
        "private loadCompositeInternal(snapshot: CompositeBlockSnapshot): void {",
        "loadCompositeInternal",
      ],
    ];
    for (const [needle, label] of directResetMethods) {
      const body = bodyOf(viewTs, needle, label);
      expect(body).toContain("this.childInlineSession = null;");
    }
    const loadNodeInternalBody = bodyOf(
      viewTs,
      "private loadNodeInternal(nodeId: string): void {",
      "loadNodeInternal"
    );
    expect(loadNodeInternalBody).toContain(
      "this.reconcileStandaloneNodeState(doc, nodeId, node, extracted.text);"
    );
    const reconcileBody = bodyOf(
      viewTs,
      "private reconcileStandaloneNodeState(",
      "reconcileStandaloneNodeState"
    );
    expect(reconcileBody).toContain("this.childInlineSession = null;");
  });

  it("renderParentChildPreview computes eligibility fresh (never trusts a stale prior render) via evaluateChildInlineEditEligibility, keyed by each row's relative line offset (Phase 5L-10: now captured into eligibleIds/fallbackFirstRowById, reused by both the edit/delete affordances and the up/down reorder affordance)", () => {
    const body = renderParentChildPreviewBody();
    expect(body).toContain("const eligibleIds = new Set<string>();");
    expect(body).toContain("const fallbackFirstRowById = new Map<number, string>();");
    expect(body).toContain(
      "evaluateChildInlineEditEligibility(previewDoc, previewParentNode, childId)"
    );
    expect(body).toContain("this.renderChildInlineEditor();");
  });

  it("renderParentChildPreview never puts the edit-start affordance and the row-editing highlight on the same row — they are mutually exclusive branches of the same if/else", () => {
    const body = renderParentChildPreviewBody();
    const editingIdx = body.indexOf(
      "if (eligibleChildId && eligibleChildId === this.childInlineSession?.childNodeId) {"
    );
    const elseIdx = body.indexOf("} else if (eligibleChildId && !isPendingDeletionRow) {");
    expect(editingIdx).toBeGreaterThan(-1);
    expect(elseIdx).toBeGreaterThan(editingIdx);
    const editingBranch = body.slice(editingIdx, elseIdx);
    expect(editingBranch).toContain(
      'rowEl.addClass("unified-outliner-partial-edit-parent-child-preview-row-editing");'
    );
    expect(editingBranch).not.toContain("createSpan");
    const affordanceBranch = body.slice(elseIdx);
    expect(affordanceBranch).toContain(
      'cls: "unified-outliner-partial-edit-parent-child-inline-edit-button"'
    );
    expect(affordanceBranch).not.toContain("-row-editing");
  });

  it("the edit-start affordance is a GENUINELY SEPARATE control from the row's own navigation click handler — it stops propagation and prevents default before doing anything else, and calls handleStartChildInlineEdit, never handleChildPreviewRowActivate", () => {
    const body = renderParentChildPreviewBody();
    const activateEditIdx = body.indexOf("const activateEdit = (evt: Event) => {");
    expect(activateEditIdx).toBeGreaterThan(-1);
    const activateEditBody = body.slice(activateEditIdx, body.indexOf("};", activateEditIdx));
    const stopIdx = activateEditBody.indexOf("evt.stopPropagation();");
    const preventIdx = activateEditBody.indexOf("evt.preventDefault();");
    const handleIdx = activateEditBody.indexOf("this.handleStartChildInlineEdit(eligibleChildId);");
    expect(stopIdx).toBeGreaterThan(-1);
    expect(preventIdx).toBeGreaterThan(stopIdx);
    expect(handleIdx).toBeGreaterThan(preventIdx);
    expect(activateEditBody).not.toContain("handleChildPreviewRowActivate");
  });

  it("the edit-start affordance uses setIcon(\"pencil\") and setTooltip with the dedicated start-label key, and wires both click and Enter/Space keydown — mirroring every other row-level affordance's own convention", () => {
    const body = renderParentChildPreviewBody();
    const elseIdx = body.indexOf("} else if (eligibleChildId && !isPendingDeletionRow) {");
    const affordanceBranch = body.slice(elseIdx);
    expect(affordanceBranch).toContain('setIcon(editButtonEl, "pencil");');
    expect(affordanceBranch).toContain(
      'setTooltip(editButtonEl, this.plugin.t("partialEdit.parentChildInlineEditStartLabel"));'
    );
    expect(affordanceBranch).toContain('editButtonEl.addEventListener("click", activateEdit);');
    expect(affordanceBranch).toContain('evt.key === "Enter" || evt.key === " "');
  });

  it("renderChildInlineEditor toggles the whole panel's visibility off whenever no session is open, and on (populated from the session's own projection) otherwise — never touches the panel while leaving it in a half-populated state", () => {
    const body = renderChildInlineEditorBody();
    expect(body).toContain("if (!session) {");
    expect(body).toContain("this.childInlineEditorEl.toggleVisibility(false);");
    expect(body).toContain("this.childInlineEditorEl.toggleVisibility(true);");
    expect(body).toContain(
      "this.childInlineTaskCheckboxRowEl.toggleVisibility(kind === \"task\");"
    );
    expect(body).toContain(
      "this.childInlineOrderedNumberRowEl.toggleVisibility(kind === \"ordered\");"
    );
    expect(body).toContain(
      "this.childInlineTextareaEl.value = projectedChildBodyText(session.childProjection);"
    );
  });

  it("handleStartChildInlineEdit is a no-op when the same child is already open, and re-verifies eligibility fresh via buildParentChildInlineEditSession — never trusts the affordance's own build-time snapshot", () => {
    const body = handleStartChildInlineEditBody();
    expect(body).toContain("if (this.childInlineSession?.childNodeId === childNodeId) return;");
    expect(body).toContain("const doc = parseDocument(view.editor.getValue());");
    expect(body).toContain(
      "buildParentChildInlineEditSession(\n        doc,\n        parentNode,\n        this.standaloneParentListItemProjection,\n        childNodeId\n      );"
    );
  });

  it("handleStartChildInlineEdit opens immediately when the combined pane is clean, and otherwise reuses the SAME DiscardChangesModal 3-choice contract requestLoadNode already uses — never a bespoke prompt", () => {
    const body = handleStartChildInlineEditBody();
    expect(body).toContain("if (!this.isDirty()) {");
    expect(body).toContain("openSession();");
    expect(body).toContain("new DiscardChangesModal(this.app, this.plugin, (choice) => {");
    expect(body).toContain('if (choice === "discard") {');
    expect(body).toContain("this.cancelEdit();");
    expect(body).toContain('// choice === "apply"');
    expect(body).toContain("if (this.applyEdit()) {\n        openSession();\n      }");
  });

  it("handleStopChildInlineEdit closes immediately with no prompt when the child draft is clean, and reuses DiscardChangesModal when dirty — discarding reverts ONLY the child session, never touching the parent's own draft", () => {
    const body = handleStopChildInlineEditBody();
    expect(body).toContain("if (!this.isChildInlineDraftDirty()) {");
    const cleanBranchEnd = body.indexOf("new DiscardChangesModal(");
    const cleanBranch = body.slice(0, cleanBranchEnd);
    expect(cleanBranch).toContain("this.childInlineSession = null;");
    expect(cleanBranch).not.toContain("this.cancelEdit()");
    expect(body).toContain("new DiscardChangesModal(this.app, this.plugin, (choice) => {");
    const modalIdx = body.indexOf("new DiscardChangesModal(");
    const modalBody = body.slice(modalIdx);
    expect(modalBody).not.toContain("this.cancelEdit()");
    expect(modalBody).toContain('if (choice === "discard") {\n        this.childInlineSession = null;');
    expect(modalBody).toContain("if (this.applyEdit()) {\n        this.childInlineSession = null;");
  });

  it("isChildInlineDraftDirty compares each of body/checkbox(task-only)/number(ordered-only) against the session's OWN loaded projection snapshot, and is false whenever no session is open", () => {
    const body = isChildInlineDraftDirtyBody();
    expect(body).toContain("if (!session) return false;");
    expect(body).toContain(
      "this.childInlineTextareaEl.value !== projectedChildBodyText(session.childProjection)"
    );
    expect(body).toContain('kind === "task" &&');
    expect(body).toContain(
      "this.childInlineTaskCheckboxInputEl.checked !== projectedChildChecked(session.childProjection)"
    );
    expect(body).toContain('kind === "ordered" &&');
    expect(body).toContain(
      "this.childInlineOrderedNumberInputEl.value !== projectedChildNumberText(session.childProjection)"
    );
  });

  it("isDirty() folds isChildInlineDraftDirty() into its own combined result — a dirty child alone is enough to make the whole pane dirty", () => {
    const body = isDirtyBody();
    expect(body).toContain("const childInlineDirty = this.isChildInlineDraftDirty();");
    // Phase 5L-9, 2026-09-16: childInlineDirty is no longer the LAST term
    // in isDirty()'s own combined OR-chain — hasAddDeleteActivity()'s own
    // addDeleteDirty now follows it (see that field's own doc comment) —
    // so this checks childInlineDirty is folded in via the OR operator
    // rather than asserting it is literally the chain's final term.
    // Phase 5L-9b, 2026-09-18: leafFirstChildDirty now follows
    // addDeleteDirty as the chain's own new final term — see that
    // field's own doc comment.
    // Phase 5E-3: fencedCodeInfoStringDirty now follows leafFirstChildDirty
    // as the chain's own new final term — leafFirstChildDirty is no
    // longer literally the last term, so this checks it is folded in via
    // OR instead.
    expect(body).toContain("childInlineDirty ||");
    expect(body).toContain("addDeleteDirty ||");
    expect(body).toContain("leafFirstChildDirty ||");
  });

  it("cancelEdit reverts the child inline editor's own controls back to the session's loaded snapshot WITHOUT closing the session (childInlineSession is never nulled out here) — Cancel keeps editing the same child, just discards its unsaved edits", () => {
    const body = cancelEditBody();
    expect(body).toContain("if (this.childInlineSession) {");
    const guardIdx = body.indexOf("if (this.childInlineSession) {");
    const guardedRegion = body.slice(guardIdx);
    expect(guardedRegion).toContain(
      "this.childInlineTextareaEl.value = projectedChildBodyText(session.childProjection);"
    );
    expect(guardedRegion).not.toContain("this.childInlineSession = null;");
  });

  it("applyEdit dispatches to the ONE combined atomic Apply path whenever a child session is open, and this branch is checked BEFORE the plain single-range standaloneParentListItemProjection branch", () => {
    const body = applyEditBody();
    const combinedIdx = body.indexOf(
      "} else if (this.standaloneParentListItemProjection && this.childInlineSession) {"
    );
    const singleIdx = body.indexOf("} else if (this.standaloneParentListItemProjection) {");
    expect(combinedIdx).toBeGreaterThan(-1);
    expect(singleIdx).toBeGreaterThan(combinedIdx);
    const combinedBranch = body.slice(combinedIdx, singleIdx);
    expect(combinedBranch).toContain("return this.applyParentChildCombinedEdit(doc, editor);");
  });

  it("applyParentChildCombinedEdit validates off the ORIGINAL snapshots via invertAndValidateParentChildCombinedEdit before ever touching the live document, and only then re-resolves fresh + applies via applyParentChildInlineEditToDocument", () => {
    const body = applyParentChildCombinedEditBody();
    const validateIdx = body.indexOf("invertAndValidateParentChildCombinedEdit({");
    const applyIdx = body.indexOf("applyParentChildInlineEditToDocument(");
    expect(validateIdx).toBeGreaterThan(-1);
    expect(applyIdx).toBeGreaterThan(validateIdx);
    expect(body).toContain("if (!combined.ok) {");
    expect(body).toContain("if (!liveOutcome.changed) {");
  });

  it("applyParentChildCombinedEdit performs exactly ONE applyLineEditOutcome call (a single atomic two-range write via one combined `lines` array) — never two sequential range replacements", () => {
    const body = applyParentChildCombinedEditBody();
    const occurrences = body.split("applyLineEditOutcome(").length - 1;
    expect(occurrences).toBe(1);
  });

  it("applyParentChildCombinedEdit's own post-Apply rebuild (§7 step 12) re-parses the just-saved document fresh, rebuilds standaloneParentListItemProjection AND re-opens childInlineSession (never simply clears it, degrading only on an unreachable rebuild failure), then re-renders the preview and sets syncState back to synced", () => {
    const body = applyParentChildCombinedEditBody();
    expect(body).toContain("const freshDoc = parseDocument(editor.getValue());");
    expect(body).toContain(
      "buildParentChildInlineEditSession(\n          freshDoc,\n          freshParentNode,\n          this.standaloneParentListItemProjection,\n          session.childNodeId\n        );"
    );
    expect(body).toContain("this.renderParentChildPreview();");
    expect(body).toContain('this.syncState = "synced";');
  });

  it("applyParentChildCombinedEdit shows the dedicated combined-Apply success Notice on success, and a translated reason-specific Notice on every failure path — never a silent no-op", () => {
    const body = applyParentChildCombinedEditBody();
    expect(body).toContain('new Notice(this.plugin.t("partialEdit.parentChildInlineEditApplied"));');
    expect(body).toContain("new Notice(this.plugin.t(parentChildCombinedApplyReasonKey(combined.reason)));");
    expect(body).toContain("new Notice(this.plugin.t(parentChildLiveApplyReasonKey(liveOutcome.reason)));");
  });

  it("onOpen creates the child inline editor panel once, hidden at rest, reusing the existing task-checkbox-row/ordered-number-row/textarea base classes as modifiers rather than inventing new unstyled controls from scratch", () => {
    const start = viewTs.indexOf(
      'this.childInlineEditorEl = this.contentEl.createDiv({\n      cls: "unified-outliner-partial-edit-child-inline-editor",\n    });'
    );
    expect(start).toBeGreaterThan(-1);
    const nextFieldAssignment = viewTs.indexOf("this.registerEvent(", start);
    expect(nextFieldAssignment).toBeGreaterThan(start);
    const onOpenSnippet = viewTs.slice(start, nextFieldAssignment);
    expect(onOpenSnippet).toContain(
      "unified-outliner-partial-edit-task-checkbox-row unified-outliner-partial-edit-child-inline-row"
    );
    expect(onOpenSnippet).toContain(
      "unified-outliner-partial-edit-ordered-number-row unified-outliner-partial-edit-child-inline-row"
    );
    expect(onOpenSnippet).toContain(
      "unified-outliner-partial-edit-textarea unified-outliner-partial-edit-child-inline-textarea"
    );
    expect(onOpenSnippet).toContain("this.childInlineEditorEl.toggleVisibility(false);");
  });

  it("defines the required Phase 5L-8 i18n keys in both dictionaries", () => {
    const i18nTs = readFileSync(path.resolve(__dirname, "../src/i18n.ts"), "utf-8");
    const keys = [
      "partialEdit.parentChildInlineEditStartLabel",
      "partialEdit.parentChildInlineEditStopLabel",
      "partialEdit.parentChildInlineEditPanelLabel",
      "partialEdit.parentChildInlineEditFailed",
      "partialEdit.parentChildInlineEditApplied",
      "partialEdit.parentChildInlineEditChildStructureInvalid",
      "partialEdit.parentChildInlineEditCandidateInvalid",
      "partialEdit.parentChildInlineEditConflict",
      "partialEdit.parentChildInlineEditResolveFailed",
    ];
    for (const key of keys) {
      const count = i18nTs.split(`"${key}"`).length - 1;
      expect(count).toBe(2); // once in the EN dictionary, once in JA
    }
  });
});
