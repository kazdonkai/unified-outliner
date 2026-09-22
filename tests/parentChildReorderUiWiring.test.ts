/**
 * Phase 5L-10 ("Direct Child Leaf Reorder in Parent Partial Edit Pane"):
 * static-source-text checks for the reorder-specific wiring this ticket
 * added to view/PartialEditView.ts — mirrors
 * tests/parentChildAddDeleteUiWiring.test.ts's own structure (same
 * "PartialEditView can't be constructed in vitest" constraint).
 *
 * The real, non-Obsidian-dependent reorder logic this wiring calls into
 * (evaluateChildReorderEligibility, isChildSubtreeTightlyPacked,
 * moveChildInPendingReorder, isPendingReorderDirty, the reorderDirty
 * branch of invertAndValidateParentChildAddDeleteEdit, and the reorder
 * branch of applyParentChildAddDeleteToDocument) is unit-tested directly,
 * with real parseDocument-backed assertions, in
 * tests/parentChildReorder.test.ts — this file only confirms the View
 * layer wires into that logic at the right place: the up/down reorder
 * affordance is a genuinely separate control/event path from row
 * navigation, the edit-start affordance, and the delete affordance; a
 * reorder move re-verifies eligibility fresh and never routes through
 * DiscardChangesModal; the pending reorder is visible in the preview
 * BEFORE Apply and suppresses stale row-click navigation while dirty;
 * and applyParentChildAddDeleteCombinedEdit folds reorder into the same
 * ONE atomic candidate/live-apply path as parent/child/add/delete.
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

function handleReorderChildBody(): string {
  return bodyOf(
    viewTs,
    "private handleReorderChild(childNodeId: string, direction: ChildReorderDirection): void {",
    "handleReorderChild"
  );
}

function applyParentChildAddDeleteCombinedEditBody(): string {
  return bodyOf(
    viewTs,
    "private applyParentChildAddDeleteCombinedEdit(doc: ParsedDocument, editor: Editor): boolean {",
    "applyParentChildAddDeleteCombinedEdit"
  );
}

describe("view/PartialEditView.ts: Phase 5L-10 (Direct Child Leaf Reorder in Parent Partial Edit Pane)", () => {
  it("imports the Phase 5L-10 reorder logic from edit/parentChildInlineEditSession.ts — never reimplements it", () => {
    expect(viewTs).toContain("ChildReorderDirection");
    expect(viewTs).toContain("ReorderLiveApplyInput");
    expect(viewTs).toContain("evaluateChildReorderEligibility");
    expect(viewTs).toContain("isPendingReorderDirty");
    expect(viewTs).toContain("moveChildInPendingReorder");
  });

  describe("renderParentChildPreview", () => {
    it("gates the whole reordered-preview path on addDeleteSession.reorderAvailable — the same 'no gap between siblings' scope this ticket documents", () => {
      const body = renderParentChildPreviewBody();
      expect(body).toContain("const reorderAvailable = !!addDeleteSession?.reorderAvailable;");
      expect(body).toContain("if (addDeleteSession && reorderAvailable) {");
    });

    it("when reorder-available, builds the preview by walking pendingReorderOrder (never childSubtreeText.split) and restricts eligibleFirstRowById to eligible ids only", () => {
      const body = renderParentChildPreviewBody();
      const reorderBranchIdx = body.indexOf("if (addDeleteSession && reorderAvailable) {");
      const elseBranchIdx = body.indexOf("} else {", reorderBranchIdx);
      expect(reorderBranchIdx).toBeGreaterThan(-1);
      expect(elseBranchIdx).toBeGreaterThan(reorderBranchIdx);
      const reorderBranch = body.slice(reorderBranchIdx, elseBranchIdx);
      expect(reorderBranch).toContain("for (const nodeId of addDeleteSession.pendingReorderOrder) {");
      expect(reorderBranch).toContain("if (eligibleIds.has(nodeId)) eligibleFirstRowById.set(row, nodeId);");
      const elseBranch = body.slice(elseBranchIdx);
      expect(elseBranch).toContain("allLines = projection.childSubtreeText.split(\"\\n\");");
      expect(elseBranch).toContain("eligibleFirstRowById = fallbackFirstRowById;");
    });

    it("suppresses row-click navigation (navigationSafe) exactly while a reorder is actually dirty — never while it's merely available-but-untouched", () => {
      const body = renderParentChildPreviewBody();
      expect(body).toContain("navigationSafe = !isPendingReorderDirty(addDeleteSession);");
      expect(body).toContain("navigationSafe = true;");
      expect(body).toContain("const target = navigationSafe ? projection.childPreviewRowTargets[i] : undefined;");
    });

    it("renders the up/down reorder buttons ONLY on an eligible, non-pending-deletion row, and ONLY while reorderAvailable — a fourth control path, genuinely separate from navigation/edit/delete", () => {
      const body = renderParentChildPreviewBody();
      expect(body).toContain(
        "if (eligibleChildId && !isPendingDeletionRow && reorderAvailable && addDeleteSession) {"
      );
      expect(body).toContain(
        'cls: "unified-outliner-partial-edit-parent-child-reorder-buttons",'
      );
    });

    it("computes each reorder button's own disabled state via moveChildInPendingReorder's OWN predicate — never a second, independently-drifting check — and stops propagation before delegating to handleReorderChild", () => {
      const body = renderParentChildPreviewBody();
      expect(body).toContain(
        "const canMove = moveChildInPendingReorder(currentOrder, eligibleIds, excludedId, eligibleChildId, direction).ok;"
      );
      expect(body).toContain(
        'buttonEl.toggleClass("unified-outliner-partial-edit-parent-child-reorder-button-disabled", !canMove);'
      );
      const buttonSectionIdx = body.indexOf("const makeReorderButton = ");
      expect(buttonSectionIdx).toBeGreaterThan(-1);
      const buttonSection = body.slice(buttonSectionIdx);
      expect(buttonSection).toContain("evt.stopPropagation();");
      expect(buttonSection).toContain("evt.preventDefault();");
      expect(buttonSection).toContain("this.handleReorderChild(eligibleChildId, direction);");
    });

    it("excludes the current pending-deletion target from the neighbor a reorder button is willing to swap with", () => {
      const body = renderParentChildPreviewBody();
      expect(body).toContain("const excludedId = addDeleteSession.pendingDeletion?.childNodeId ?? null;");
    });
  });

  describe("handleReorderChild", () => {
    it("refuses (with a Notice, never a throw) when reorderAvailable is false, or the active view/nodeId can't be resolved", () => {
      const body = handleReorderChildBody();
      expect(body).toContain(
        "if (!addDeleteSession || !addDeleteSession.reorderAvailable || !view || !this.nodeId) {"
      );
      expect(body).toContain('new Notice(this.plugin.t("partialEdit.parentChildReorderFailed"));');
    });

    it("re-resolves eligibility fresh against the CURRENT document via evaluateChildReorderEligibility — never trusts a stale row-render snapshot", () => {
      const body = handleReorderChildBody();
      expect(body).toContain("const doc = parseDocument(view.editor.getValue());");
      expect(body).toContain("if (evaluateChildReorderEligibility(doc, parentNode, id).ok) {");
    });

    it("delegates the actual swap to the pure moveChildInPendingReorder, passing the current pending-deletion target as the excluded id, and is a safe no-op on refusal", () => {
      const body = handleReorderChildBody();
      expect(body).toContain("const excludedId = addDeleteSession.pendingDeletion?.childNodeId ?? null;");
      expect(body).toContain(
        [
          "const result = moveChildInPendingReorder(",
          "      addDeleteSession.pendingReorderOrder,",
          "      eligibleIds,",
          "      excludedId,",
          "      childNodeId,",
          "      direction",
          "    );",
        ].join("\n")
      );
      expect(body).toContain("if (!result.ok) {");
    });

    it("on success, assigns the new order back onto pendingReorderOrder and re-renders the preview + dirty state — never routes through DiscardChangesModal (purely additive, mirrors handleRequestAddChild's own rationale)", () => {
      const body = handleReorderChildBody();
      expect(body).toContain("addDeleteSession.pendingReorderOrder = result.newOrder;");
      expect(body).toContain("this.renderParentChildPreview();");
      expect(body).toContain("this.updateDirtyState();");
      expect(body).not.toContain("DiscardChangesModal");
    });
  });

  describe("applyParentChildAddDeleteCombinedEdit", () => {
    it("computes reorderDirty via isPendingReorderDirty and folds it into the combined-Apply no-op guard alongside parent/child/add/delete", () => {
      const body = applyParentChildAddDeleteCombinedEditBody();
      expect(body).toContain("const reorderDirty = isPendingReorderDirty(addDeleteSession);");
      expect(body).toContain(
        "if (!parentDirty && !existingChildDirty && !hasDeletion && !hasNewChild && !reorderDirty) {"
      );
    });

    it("passes reorderDirty into invertAndValidateParentChildAddDeleteEdit's own combined-candidate input", () => {
      const body = applyParentChildAddDeleteCombinedEditBody();
      expect(body).toContain("reorderDirty,");
    });

    it("builds the reorder live-apply input ONLY while reorderDirty (null-means-absent, mirroring existingChild/deletion), from the session's own pendingReorderOrder and the ORIGINAL childSubtreeText snapshot", () => {
      const body = applyParentChildAddDeleteCombinedEditBody();
      expect(body).toContain(
        "const reorderInput: ReorderLiveApplyInput | null = reorderDirty"
      );
      expect(body).toContain(
        "? { orderedChildNodeIds: addDeleteSession.pendingReorderOrder, originalChildSubtreeText: projection.childSubtreeText }"
      );
      expect(body).toContain(": null;");
    });

    it("passes reorderInput as applyParentChildAddDeleteToDocument's own trailing argument, alongside the existing parent/existingChild/deletion/newChild arguments", () => {
      const body = applyParentChildAddDeleteCombinedEditBody();
      const callIdx = body.indexOf("const liveOutcome = applyParentChildAddDeleteToDocument(");
      expect(callIdx).toBeGreaterThan(-1);
      const reorderInputIdx = body.indexOf("reorderInput", callIdx);
      expect(reorderInputIdx).toBeGreaterThan(callIdx);
      const closeIdx = body.indexOf(");", reorderInputIdx);
      // reorderInput is the LAST argument in the call — nothing else
      // between it and the call's own closing paren.
      expect(body.slice(reorderInputIdx, closeIdx).trim()).toBe("reorderInput");
    });
  });

  describe("renderParentChildPreview: row layout (fix for a real-device bug where edit/delete/reorder controls could split across two visual lines)", () => {
    it("gives each row's own text its OWN span (preview-row-text) instead of setting text directly on the row div, and creates ONE shared actions span (preview-row-actions) for every control the row's own branches append below", () => {
      const body = renderParentChildPreviewBody();
      expect(body).toContain(
        'cls: "unified-outliner-partial-edit-parent-child-preview-row-text",'
      );
      expect(body).toContain(
        'const rowActionsEl = rowEl.createSpan({\n' +
          '        cls: "unified-outliner-partial-edit-parent-child-preview-row-actions",'
      );
      // rowEl's own createDiv call must NOT set `text:` any more — the
      // row's text lives only in the dedicated span above now.
      const rowDivIdx = body.indexOf(
        'this.parentChildPreviewBodyEl.createDiv({\n        cls: "unified-outliner-partial-edit-parent-child-preview-row",\n      });'
      );
      expect(rowDivIdx).toBeGreaterThan(-1);
    });

    it("appends the edit/delete/reorder controls into the shared rowActionsEl — never directly onto rowEl any more — so all three are always laid out together and can never independently wrap onto separate visual lines", () => {
      const body = renderParentChildPreviewBody();
      expect(body).toContain('const editButtonEl = rowActionsEl.createSpan({');
      expect(body).toContain('const deleteButtonEl = rowActionsEl.createSpan({');
      expect(body).toContain('const reorderButtonsEl = rowActionsEl.createSpan({');
      expect(body).not.toContain('rowEl.createSpan({\n          cls: "unified-outliner-partial-edit-parent-child-inline-edit-button"');
      expect(body).not.toContain('rowEl.createSpan({\n          cls: "unified-outliner-partial-edit-parent-child-delete-button"');
      expect(body).not.toContain('rowEl.createSpan({\n          cls: "unified-outliner-partial-edit-parent-child-reorder-buttons"');
    });
  });
});
