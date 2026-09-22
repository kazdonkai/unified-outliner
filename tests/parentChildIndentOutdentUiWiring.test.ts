/**
 * Phase 5L-11 ("Direct Child Leaf Indent/Outdent in Parent Partial Edit
 * Pane"): static-source-text checks for the indent/outdent-specific
 * wiring this ticket added to view/PartialEditView.ts — mirrors
 * tests/parentChildReorderUiWiring.test.ts's own structure (same
 * "PartialEditView can't be constructed in vitest" constraint).
 *
 * The real, non-Obsidian-dependent indent/outdent logic this wiring
 * calls into (evaluateChildIndentEligibility,
 * evaluateChildOutdentEligibility, buildPendingIndent, buildPendingOutdent,
 * buildIndentOutdentPreviewText, applyParentChildIndentOutdentToDocument)
 * is unit-tested directly, with real parseDocument-backed assertions, in
 * tests/parentChildIndentOutdent.test.ts — this file only confirms the
 * View layer wires into that logic at the right place: the indent/outdent
 * affordances are a genuinely separate control/event path from row
 * navigation, the edit-start affordance, the delete affordance, and the
 * reorder affordance; a pending indent/outdent takes priority over the
 * reorder-preview branch and suppresses every OTHER row affordance while
 * pending (§8's own "never suggest free movement"); starting one always
 * re-verifies eligibility fresh and never routes through
 * DiscardChangesModal (purely additive, per §6); hasAddDeleteActivity()
 * treats a pending indent/outdent as unconditional activity (no
 * "net-no-op" shape, unlike reorder); applyEdit() dispatches to the
 * dedicated applyParentChildIndentOutdentEdit BEFORE the generic
 * hasAddDeleteActivity() combined-apply branch, since that combined path
 * has no idea how to write an indent/outdent transformation; and
 * applyParentChildIndentOutdentEdit composes with (at most) a dirty
 * parent own-text draft, inverting+validating it first via the SAME
 * reason mapping the combined add/delete path already uses.
 *
 * Two adjacent Phase 5L-11 wiring facts are deliberately NOT re-asserted
 * here because they already live as companion tests in
 * tests/parentChildAddDeleteUiWiring.test.ts (the file that owns
 * renderParentChildPreview's Add-button and cancelEdit's shared pending-
 * slot guard): the Add-child button's indentOutdentAlreadyPending
 * disable/tooltip branch, and cancelEdit's fourth
 * addDeleteSession.pendingIndentOutdent OR-condition.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const viewTs = readFileSync(path.resolve(__dirname, "../src/view/PartialEditView.ts"), "utf-8");

function bodyOf(source: string, needle: string, label: string): string {
  const start = source.indexOf(needle);
  if (start === -1) {
    throw new Error(`${label} not found -- has it been renamed or removed?`);
  }
  const end = source.indexOf("\n  }", start);
  if (end === -1 || end <= start) {
    throw new Error(
      `Could not find ${label}'s closing brace -- its shape may have changed; update this test's bounding logic.`
    );
  }
  return source.slice(start, end);
}

function renderParentChildPreviewBody(): string {
  return bodyOf(viewTs, "private renderParentChildPreview(): void {", "renderParentChildPreview");
}

function handleRequestIndentChildBody(): string {
  return bodyOf(viewTs, "private handleRequestIndentChild(childNodeId: string): void {", "handleRequestIndentChild");
}

function handleRequestOutdentChildBody(): string {
  return bodyOf(
    viewTs,
    "private handleRequestOutdentChild(childNodeId: string): void {",
    "handleRequestOutdentChild"
  );
}

function hasAddDeleteActivityBody(): string {
  return bodyOf(viewTs, "private hasAddDeleteActivity(): boolean {", "hasAddDeleteActivity");
}

function applyEditBody(): string {
  return bodyOf(viewTs, "private applyEdit(): boolean {", "applyEdit");
}

function applyParentChildIndentOutdentEditBody(): string {
  return bodyOf(
    viewTs,
    "private applyParentChildIndentOutdentEdit(doc: ParsedDocument, editor: Editor): boolean {",
    "applyParentChildIndentOutdentEdit"
  );
}

describe("view/PartialEditView.ts: Phase 5L-11 (Direct Child Leaf Indent/Outdent in Parent Partial Edit Pane)", () => {
  it("imports the Phase 5L-11 indent/outdent logic from edit/parentChildInlineEditSession.ts -- never reimplements it", () => {
    expect(viewTs).toContain("ChildIndentOutdentApplyRejectReason");
    expect(viewTs).toContain("applyParentChildIndentOutdentToDocument");
    expect(viewTs).toContain("buildIndentOutdentPreviewText");
    expect(viewTs).toContain("buildPendingIndent");
    expect(viewTs).toContain("buildPendingOutdent");
    expect(viewTs).toContain("evaluateChildIndentEligibility");
    expect(viewTs).toContain("evaluateChildOutdentEligibility");
  });

  describe("renderParentChildPreview", () => {
    it("gives a pending indent/outdent TOP priority over the reorder-preview branch -- its own `if` is checked before `reorderAvailable`'s own `else if`", () => {
      const body = renderParentChildPreviewBody();
      const indentOutdentBranchIdx = body.indexOf(
        "if (addDeleteSession && indentOutdentPending && previewDoc && previewParentNode) {"
      );
      const reorderBranchIdx = body.indexOf("} else if (addDeleteSession && reorderAvailable) {");
      expect(indentOutdentBranchIdx).toBeGreaterThan(-1);
      expect(reorderBranchIdx).toBeGreaterThan(indentOutdentBranchIdx);
    });

    it("while pending, builds the preview via buildIndentOutdentPreviewText against the fresh previewDoc/previewParentNode (never the raw childSubtreeText), and hands out NO eligible row ids at all -- suppressing every other affordance in one stroke (navigation, edit-start, delete, reorder, and a second indent/outdent)", () => {
      const body = renderParentChildPreviewBody();
      const indentOutdentBranchIdx = body.indexOf(
        "if (addDeleteSession && indentOutdentPending && previewDoc && previewParentNode) {"
      );
      const reorderBranchIdx = body.indexOf("} else if (addDeleteSession && reorderAvailable) {");
      const branch = body.slice(indentOutdentBranchIdx, reorderBranchIdx);
      expect(branch).toContain(
        "allLines = buildIndentOutdentPreviewText(previewDoc, previewParentNode, projection, indentOutdentPending).split("
      );
      expect(branch).toContain("eligibleFirstRowById = new Map();");
      expect(branch).toContain("navigationSafe = false;");
    });

    it("computes canStartIndentOutdent as requiring: no pending indent/outdent already, no open existing-child editor, no pending new-child draft, no pending deletion, and no dirty reorder -- the exact same 'nothing else mid-flight' scope §6 limits every new structural transformation to", () => {
      const body = renderParentChildPreviewBody();
      expect(body).toContain("const canStartIndentOutdent =");
      expect(body).toContain("!indentOutdentPending &&");
      expect(body).toContain("!this.childInlineSession &&");
      expect(body).toContain("!addDeleteSession?.newChildDraft &&");
      expect(body).toContain("!addDeleteSession?.pendingDeletion &&");
      expect(body).toContain("!(addDeleteSession && isPendingReorderDirty(addDeleteSession));");
    });

    it("computes indentEligibleIds/outdentEligibleFirstRowById ONLY while canStartIndentOutdent, walking the fresh previewParentNode's own direct children and re-verifying each via evaluateChildIndentEligibility/evaluateChildOutdentEligibility -- never trusting eligibleIds/fallbackFirstRowById (a direct-children-only population that cannot express a nested outdent target)", () => {
      const body = renderParentChildPreviewBody();
      expect(body).toContain("const indentEligibleIds = new Set<string>();");
      expect(body).toContain("const outdentEligibleFirstRowById = new Map<number, string>();");
      expect(body).toContain("if (canStartIndentOutdent && previewDoc && previewParentNode) {");
      expect(body).toContain("for (const directChildId of previewParentNode.childIds) {");
      expect(body).toContain(
        "if (evaluateChildIndentEligibility(previewDoc, previewParentNode, directChildId).ok) {"
      );
      expect(body).toContain("indentEligibleIds.add(directChildId);");
      expect(body).toContain("for (const nestedChildId of directChildNode.childIds) {");
      expect(body).toContain(
        "const evaluatedOutdent = evaluateChildOutdentEligibility(previewDoc, previewParentNode, nestedChildId);"
      );
      expect(body).toContain(
        "const relativeRow = evaluatedOutdent.childNode.range.startLine - projection.childSubtreeRange.startLine;"
      );
      expect(body).toContain("outdentEligibleFirstRowById.set(relativeRow, nestedChildId);");
    });

    it("renders the indent button ONLY on an eligible DIRECT child's own first row, and ONLY while canStartIndentOutdent -- appended into the SAME shared rowActionsEl group as edit/delete/reorder, with its own stopPropagation/preventDefault before delegating to handleRequestIndentChild", () => {
      const body = renderParentChildPreviewBody();
      expect(body).toContain(
        "if (eligibleChildId && !isPendingDeletionRow && canStartIndentOutdent && indentEligibleIds.has(eligibleChildId)) {"
      );
      const indentSectionIdx = body.indexOf(
        "if (eligibleChildId && !isPendingDeletionRow && canStartIndentOutdent && indentEligibleIds.has(eligibleChildId)) {"
      );
      const outdentLookupIdx = body.indexOf(
        "const outdentChildId = canStartIndentOutdent ? outdentEligibleFirstRowById.get(i) : undefined;"
      );
      expect(outdentLookupIdx).toBeGreaterThan(indentSectionIdx);
      const indentSection = body.slice(indentSectionIdx, outdentLookupIdx);
      expect(indentSection).toContain(
        'cls: "unified-outliner-partial-edit-parent-child-indent-button",'
      );
      expect(indentSection).toContain("rowActionsEl.createSpan({");
      expect(indentSection).toContain('setIcon(indentButtonEl, "indent");');
      expect(indentSection).toContain("evt.stopPropagation();");
      expect(indentSection).toContain("evt.preventDefault();");
      expect(indentSection).toContain("this.handleRequestIndentChild(eligibleChildId);");
    });

    it("renders the outdent button on a NESTED (one-level-deep) child's own first row via outdentEligibleFirstRowById.get(i) -- a genuinely DIFFERENT population from eligibleChildId (every other row affordance is direct-children-only) -- and delegates to handleRequestOutdentChild", () => {
      const body = renderParentChildPreviewBody();
      const outdentLookupIdx = body.indexOf(
        "const outdentChildId = canStartIndentOutdent ? outdentEligibleFirstRowById.get(i) : undefined;"
      );
      expect(outdentLookupIdx).toBeGreaterThan(-1);
      const outdentSection = body.slice(outdentLookupIdx);
      expect(outdentSection).toContain("if (outdentChildId) {");
      expect(outdentSection).toContain(
        'cls: "unified-outliner-partial-edit-parent-child-outdent-button",'
      );
      expect(outdentSection).toContain('setIcon(outdentButtonEl, "outdent");');
      expect(outdentSection).toContain("evt.stopPropagation();");
      expect(outdentSection).toContain("evt.preventDefault();");
      expect(outdentSection).toContain("this.handleRequestOutdentChild(outdentChildId);");
    });
  });

  describe("handleRequestIndentChild / handleRequestOutdentChild", () => {
    it("both refuse (with a Notice, never a throw) when a pendingIndentOutdent already exists, or the active view/nodeId can't be resolved", () => {
      const indentBody = handleRequestIndentChildBody();
      expect(indentBody).toContain(
        "if (!addDeleteSession || addDeleteSession.pendingIndentOutdent || !view || !this.nodeId) {"
      );
      expect(indentBody).toContain('new Notice(this.plugin.t("partialEdit.parentChildIndentFailed"));');

      const outdentBody = handleRequestOutdentChildBody();
      expect(outdentBody).toContain(
        "if (!addDeleteSession || addDeleteSession.pendingIndentOutdent || !view || !this.nodeId) {"
      );
      expect(outdentBody).toContain('new Notice(this.plugin.t("partialEdit.parentChildOutdentFailed"));');
    });

    it("both re-resolve the parent fresh via parseDocument(view.editor.getValue()) and re-verify eligibility through buildPendingIndent/buildPendingOutdent -- never trusting the row's own build-time eligibility snapshot -- before ever setting pendingIndentOutdent", () => {
      const indentBody = handleRequestIndentChildBody();
      expect(indentBody).toContain("const doc = parseDocument(view.editor.getValue());");
      expect(indentBody).toContain("const built = buildPendingIndent(doc, parentNode, childNodeId);");
      expect(indentBody).toContain("if (!built.ok) {");
      expect(indentBody).toContain("addDeleteSession.pendingIndentOutdent = built.pending;");

      const outdentBody = handleRequestOutdentChildBody();
      expect(outdentBody).toContain("const doc = parseDocument(view.editor.getValue());");
      expect(outdentBody).toContain("const built = buildPendingOutdent(doc, parentNode, childNodeId);");
      expect(outdentBody).toContain("if (!built.ok) {");
      expect(outdentBody).toContain("addDeleteSession.pendingIndentOutdent = built.pending;");
    });

    it("both re-render the preview and update dirty state on success -- neither ever routes through DiscardChangesModal (purely additive, mirroring handleRequestAddChild's/handleReorderChild's own identical rationale)", () => {
      const indentBody = handleRequestIndentChildBody();
      expect(indentBody).toContain("this.renderParentChildPreview();");
      expect(indentBody).toContain("this.updateDirtyState();");
      expect(indentBody).not.toContain("DiscardChangesModal");

      const outdentBody = handleRequestOutdentChildBody();
      expect(outdentBody).toContain("this.renderParentChildPreview();");
      expect(outdentBody).toContain("this.updateDirtyState();");
      expect(outdentBody).not.toContain("DiscardChangesModal");
    });
  });

  describe("hasAddDeleteActivity", () => {
    it("treats a pending indent/outdent as UNCONDITIONAL activity -- unlike a pending reorder (which only counts while genuinely dirty via isPendingReorderDirty), there is no 'net-no-op' shape for an indent/outdent: it either exists or it doesn't", () => {
      const body = hasAddDeleteActivityBody();
      expect(body).toContain("!!session?.pendingIndentOutdent");
    });
  });

  describe("applyEdit dispatch", () => {
    it("checks childAddDeleteSession?.pendingIndentOutdent and dispatches to the dedicated applyParentChildIndentOutdentEdit BEFORE the generic hasAddDeleteActivity() combined-apply branch -- the combined path has no idea how to write an indent/outdent transformation", () => {
      const body = applyEditBody();
      const indentOutdentIdx = body.indexOf(
        "} else if (this.standaloneParentListItemProjection && this.childAddDeleteSession?.pendingIndentOutdent) {"
      );
      const addDeleteIdx = body.indexOf(
        "} else if (this.standaloneParentListItemProjection && this.hasAddDeleteActivity()) {"
      );
      expect(indentOutdentIdx).toBeGreaterThan(-1);
      expect(addDeleteIdx).toBeGreaterThan(indentOutdentIdx);
      const branch = body.slice(indentOutdentIdx, addDeleteIdx);
      expect(branch).toContain("return this.applyParentChildIndentOutdentEdit(doc, editor);");
    });
  });

  describe("applyParentChildIndentOutdentEdit", () => {
    it("refuses safely (Notice, returns false, touches nothing) when the parent projection, the add/delete session, the pending transformation, or nodeId cannot be resolved", () => {
      const body = applyParentChildIndentOutdentEditBody();
      expect(body).toContain("const pending = addDeleteSession?.pendingIndentOutdent ?? null;");
      expect(body).toContain("if (!projection || !addDeleteSession || !pending || !this.nodeId) {");
      expect(body).toContain('new Notice(this.plugin.t("partialEdit.parentChildInlineEditFailed"));');
      expect(body).toContain("return false;");
    });

    it("when the parent's own own-text draft is dirty, inverts+validates it FIRST via invertParentListItemProjection, reusing the SAME parentChildCombinedApplyRejectReason mapping the combined add/delete path already uses -- a failure here leaves both the parent's draft and the pending indent/outdent completely untouched", () => {
      const body = applyParentChildIndentOutdentEditBody();
      expect(body).toContain("if (parentDirty) {");
      expect(body).toContain("const inverted = invertParentListItemProjection(");
      expect(body).toContain("const reason: ParentChildCombinedApplyRejectReason =");
      expect(body).toContain("new Notice(this.plugin.t(parentChildCombinedApplyReasonKey(reason)));");
      expect(body).toContain("return false;");
      expect(body).toContain("newParentOwnTextRaw = inverted.ownTextRawText;");
    });

    it("calls applyParentChildIndentOutdentToDocument with doc, nodeId, parentDirty, the ORIGINAL and possibly-new parent own-text, the pending transformation, and the original childSubtreeText snapshot -- surfacing any refusal via parentChildIndentOutdentApplyReasonKey", () => {
      const body = applyParentChildIndentOutdentEditBody();
      const callIdx = body.indexOf("const liveOutcome = applyParentChildIndentOutdentToDocument(");
      expect(callIdx).toBeGreaterThan(-1);
      const call = body.slice(callIdx, body.indexOf(");", callIdx) + 2);
      expect(call).toContain("doc,");
      expect(call).toContain("this.nodeId,");
      expect(call).toContain("parentDirty,");
      expect(call).toContain("projection.ownText.rawText,");
      expect(call).toContain("newParentOwnTextRaw,");
      expect(call).toContain("pending,");
      expect(call).toContain("projection.childSubtreeText");
      expect(body).toContain("if (!liveOutcome.changed) {");
      expect(body).toContain("new Notice(this.plugin.t(parentChildIndentOutdentApplyReasonKey(liveOutcome.reason)));");
      expect(body).toContain("return false;");
    });

    it("on success, rebuilds EVERY standalone tier (not just the parent projection), the child-add/delete session, and originalText fresh against the just-saved document via the shared reconcileStandaloneNodeState -- mirroring applyParentChildAddDeleteCombinedEdit's own identical Phase 5L-12 post-Apply rebuild, and always clears the existing-child session to null", () => {
      // 2026-09-22 (Phase 5L-12, bug fix -- corrected 2026-09-22): unlike
      // applyParentChildAddDeleteCombinedEdit's own delete-last-child
      // path, indent/outdent can NEVER make this pane's own root target
      // transition parent->leaf: evaluateChildIndentEligibility always
      // requires a preceding sibling (so indent never drops childIds
      // below 1), and evaluateChildOutdentEligibility only ever PROMOTES
      // a grandchild into a new direct child (so outdent only ever grows
      // childIds). What indent/outdent DOES always change is the
      // target's own set of DIRECT children -- and the OLD narrow
      // "stillEligible ... buildStandaloneParentListItemProjection"
      // rebuild this test originally pinned down never recomputed
      // ancestors/directChildren/siblingState at all, so the Subtree
      // Navigator (which lists exactly those direct children) kept
      // showing the PRE-transform set. See
      // applyParentChildIndentOutdentEdit's own doc comment for the full,
      // corrected rationale.
      const body = applyParentChildIndentOutdentEditBody();
      expect(body).not.toContain("const stillEligible =");
      expect(body).toContain("const freshDoc = parseDocument(editor.getValue());");
      expect(body).toContain("const freshParentNode = freshDoc.nodes.get(this.nodeId);");
      expect(body).toContain("const freshExtracted = extractSubtreeText(freshDoc, this.nodeId);");
      expect(body).toContain(
        "this.reconcileStandaloneNodeState(\n" +
          "        freshDoc,\n" +
          "        this.nodeId,\n" +
          "        freshParentNode,\n" +
          "        freshExtracted.ok ? freshExtracted.text : \"\"\n" +
          "      );"
      );
      expect(body).toContain("this.renderBreadcrumb();");
      expect(body).toContain("this.renderSiblingNav();");
      expect(body).toContain("this.renderSubtreeNavigator();");
      expect(body).toContain("this.renderParentChildPreview();");
      expect(body).toContain("this.renderLeafFirstChildAddRow();");
      expect(body).toContain('this.syncState = "synced";');
      expect(body).toContain("this.updateDirtyState();");
    });
  });
});
