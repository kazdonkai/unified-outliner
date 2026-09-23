/**
 * Phase 5L-9 ("Direct Child Add/Delete in Parent Partial Edit Pane"):
 * static-source-text checks for the wiring this ticket added to
 * view/PartialEditView.ts — mirrors tests/parentChildInlineEditUiWiring.test.ts's
 * own structure (same "PartialEditView can't be constructed in vitest"
 * constraint — see that file's own top doc comment).
 *
 * The real, non-Obsidian-dependent logic this wiring calls into
 * (computeNewChildIndent, buildCanonicalNewChildRawText, buildNewChildDraft,
 * evaluateChildDeleteEligibility, buildParentChildAddDeleteSession,
 * invertAndValidateParentChildAddDeleteEdit,
 * applyParentChildAddDeleteToDocument, etc. — all of
 * edit/parentChildInlineEditSession.ts's own Phase 5L-9 section) is
 * unit-tested directly, with real parseDocument-backed assertions, in
 * tests/parentChildAddDelete.test.ts — this file only confirms the View
 * layer wires into that logic at the right place: the add/delete
 * affordances are genuinely separate controls from row navigation and the
 * Phase 5L-8 edit-start affordance, opening/closing a new-child draft and
 * confirming a deletion reuse the existing DiscardChangesModal /
 * dedicated ChildDeleteConfirmModal contracts (never bespoke prompts),
 * Apply dispatches to the ONE generalized combined atomic path whenever
 * add/delete activity is present (checked BEFORE the plain
 * childInlineSession-only branch), isDirty()/cancelEdit() fold both new
 * slots in, and a pending-deletion row is fully non-interactive.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const viewTs = readFileSync(path.resolve(__dirname, "../src/view/PartialEditView.ts"), "utf-8");
const resolverTs = readFileSync(
  path.resolve(__dirname, "../src/edit/standaloneProjectionResolver.ts"),
  "utf-8"
);

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

function renderNewChildEditorBody(): string {
  return bodyOf(viewTs, "private renderNewChildEditor(): void {", "renderNewChildEditor");
}

function isNewChildDraftDirtyBody(): string {
  return bodyOf(viewTs, "private isNewChildDraftDirty(): boolean {", "isNewChildDraftDirty");
}

function hasAddDeleteActivityBody(): string {
  return bodyOf(viewTs, "private hasAddDeleteActivity(): boolean {", "hasAddDeleteActivity");
}

function handleRequestAddChildBody(): string {
  return bodyOf(viewTs, "private handleRequestAddChild(): void {", "handleRequestAddChild");
}

function handleStopNewChildDraftBody(): string {
  return bodyOf(viewTs, "private handleStopNewChildDraft(): void {", "handleStopNewChildDraft");
}

function handleStopLeafFirstChildDraftBody(): string {
  return bodyOf(viewTs, "private handleStopLeafFirstChildDraft(): void {", "handleStopLeafFirstChildDraft");
}

function handleRequestDeleteChildBody(): string {
  return bodyOf(
    viewTs,
    "private handleRequestDeleteChild(childNodeId: string): void {",
    "handleRequestDeleteChild"
  );
}

function commitPendingDeletionBody(): string {
  return bodyOf(viewTs, "private commitPendingDeletion(childNodeId: string): void {", "commitPendingDeletion");
}

function cancelEditBody(): string {
  return bodyOf(viewTs, "private cancelEdit(): void {", "cancelEdit");
}

function applyEditBody(): string {
  return bodyOf(viewTs, "private applyEdit(): boolean {", "applyEdit");
}

function applyParentChildAddDeleteCombinedEditBody(): string {
  return bodyOf(
    viewTs,
    "private applyParentChildAddDeleteCombinedEdit(doc: ParsedDocument, editor: Editor): boolean {",
    "applyParentChildAddDeleteCombinedEdit"
  );
}

function isDirtyBody(): string {
  return bodyOf(viewTs, "private isDirty(): boolean {", "isDirty");
}

describe("view/PartialEditView.ts: Phase 5L-9 (Direct Child Add/Delete in Parent Partial Edit Pane)", () => {
  it("imports the Phase 5L-9 session module's real logic from edit/parentChildInlineEditSession.ts — never reimplements it", () => {
    expect(viewTs).toContain("buildNewChildDraft");
    expect(viewTs).toContain("evaluateChildDeleteEligibility");
    expect(viewTs).toContain("buildParentChildAddDeleteSession");
    expect(viewTs).toContain("invertAndValidateParentChildAddDeleteEdit");
    expect(viewTs).toContain("applyParentChildAddDeleteToDocument");
  });

  it("declares a single childAddDeleteSession field, initialized to null", () => {
    expect(viewTs).toContain(
      "private childAddDeleteSession: ParentChildAddDeleteSession | null = null;"
    );
  });

  it("resets childAddDeleteSession to null in every place childInlineSession's own sibling reset already runs", () => {
    const resetSites = viewTs.split("this.childAddDeleteSession = null;").length - 1;
    // loadNodeInternal, loadParagraphInternal, loadCompositeInternal — the
    // same three sibling-reset sites childInlineSession's own doc comment
    // (Phase 5L-8) already establishes as the full set (resetLoadedState
    // does not separately null it — see that method's own call chain).
    expect(resetSites).toBeGreaterThanOrEqual(3);
  });

  it("performAutoReload unconditionally rebuilds childAddDeleteSession fresh (and resets childInlineSession/pendingLeafFirstChild to null) alongside standaloneParentListItemProjection, via the shared reconcileStandaloneNodeState — no longer gated on \"was a parent projection ALREADY active before the reload\" (bug found via real-device Phase 5L-10 verification: an external change reloading a clean pane, e.g. an editor Undo right after this pane's own Apply, previously left pendingReorderOrder/pendingDeletion/newChildDraft/childSlots pointing at pre-reload child ids — and, per this phase's own investigation, the OLD gate ALSO could never newly discover a parent projection that didn't exist pre-reload, e.g. a body edit that just turned a leaf into a parent)", () => {
    // 2026-09-22 (Phase 5L-12, bug fix): see
    // standaloneListMarkerFreePartialEditUiWiring.test.ts's own
    // identically-updated performAutoReload test for the full rationale.
    // reconcileStandaloneNodeState's own body (see its own doc comment
    // and edit/standaloneProjectionResolver.ts) is what now carries the
    // childAddDeleteSession-from-projections.parent construction this
    // test originally pinned down inline here.
    const body = bodyOf(viewTs, "private performAutoReload(", "performAutoReload");
    expect(body).not.toContain("if (this.nodeId && this.standaloneParentListItemProjection) {");
    expect(body).toContain(
      "if (this.nodeId) {\n" +
        "      const reloadedNode = doc.nodes.get(this.nodeId);\n" +
        "      this.reconcileStandaloneNodeState(doc, this.nodeId, reloadedNode, newText);\n" +
        "    }"
    );
    const reconcileBody = bodyOf(
      viewTs,
      "private reconcileStandaloneNodeState(",
      "reconcileStandaloneNodeState"
    );
    expect(reconcileBody).toContain(
      "this.childAddDeleteSession =\n" +
        "      projections.parent && node && isListNode(node)\n" +
        "        ? buildParentChildAddDeleteSession(doc, node, projections.parent)\n" +
        "        : null;"
    );
    expect(reconcileBody).toContain("this.childInlineSession = null;");
    expect(reconcileBody).toContain("this.pendingLeafFirstChild = null;");
  });

  it("onOpen creates the Add-child button inside the SAME row as the read-only preview's own label, and its click handler stops propagation before delegating to handleRequestAddChild", () => {
    const start = viewTs.indexOf(
      'this.parentChildAddButtonEl = this.parentChildPreviewLabelEl.createEl("button", {'
    );
    expect(start).toBeGreaterThan(-1);
    const end = viewTs.indexOf("});", start);
    const snippet = viewTs.slice(start, viewTs.indexOf("this.parentChildPreviewBodyEl", end));
    expect(snippet).toContain('setIcon(this.parentChildAddButtonEl, "plus");');
    expect(snippet).toContain("evt.stopPropagation();");
    expect(snippet).toContain("this.handleRequestAddChild();");
  });

  it("onOpen creates the new-child editor panel once, hidden at rest, reusing the SAME base classes as the existing-child inline editor (childInlineEditorEl) as modifiers — never inventing unstyled controls from scratch", () => {
    const start = viewTs.indexOf(
      'this.newChildEditorEl = this.contentEl.createDiv({\n      cls: "unified-outliner-partial-edit-child-inline-editor unified-outliner-partial-edit-new-child-editor",\n    });'
    );
    expect(start).toBeGreaterThan(-1);
    const end = viewTs.indexOf("// Real-device follow-up:", start);
    expect(end).toBeGreaterThan(start);
    const snippet = viewTs.slice(start, end);
    expect(snippet).toContain(
      "unified-outliner-partial-edit-textarea unified-outliner-partial-edit-child-inline-textarea"
    );
    // Phase 5L-9b: the click handler now dispatches between two
    // mutually-exclusive "stop this draft" methods (see the dedicated
    // "newChildStopButtonEl's click handler dispatches..." test above)
    // rather than calling handleStopNewChildDraft unconditionally.
    expect(snippet).toContain('this.newChildStopButtonEl.addEventListener("click", () => {');
    expect(snippet).toContain("this.handleStopLeafFirstChildDraft();");
    expect(snippet).toContain("this.handleStopNewChildDraft();");
    expect(snippet).toContain('this.newChildTextareaEl.addEventListener("input", () => this.updateDirtyState());');
    expect(snippet).toContain("this.newChildEditorEl.toggleVisibility(false);");
  });

  it("renderParentChildPreview disables (never hides) the Add-child button while a new-child draft is already pending, per the 'prevent double-add' requirement", () => {
    const body = renderParentChildPreviewBody();
    expect(body).toContain("const newChildAlreadyPending = !!this.childAddDeleteSession?.newChildDraft;");
    expect(body).toContain("this.parentChildAddButtonEl.disabled = addAlreadyPending;");
  });

  // Phase 5L-11 ("Direct Child Leaf Indent/Outdent in Parent Partial Edit
  // Pane"): the SAME Add-child button is ALSO disabled while a pending
  // indent/outdent is in flight (§6's own "at most one pending structural
  // transformation" scope limit) — a sibling assertion to the one
  // immediately above, never a replacement for it (both conditions feed
  // the SAME addAlreadyPending flag).
  it("renderParentChildPreview disables the Add-child button while a pending indent/outdent is in flight too", () => {
    const body = renderParentChildPreviewBody();
    expect(body).toContain("const indentOutdentAlreadyPending = !!this.childAddDeleteSession?.pendingIndentOutdent;");
    expect(body).toContain("const addAlreadyPending = newChildAlreadyPending || indentOutdentAlreadyPending;");
  });

  it("renderParentChildPreview computes isPendingDeletionRow fresh from childAddDeleteSession's own pendingDeletion, BEFORE the navigation/edit-start wiring — a pending-deletion row gets neither", () => {
    const body = renderParentChildPreviewBody();
    const pendingIdx = body.indexOf(
      "eligibleChildId === this.childAddDeleteSession?.pendingDeletion?.childNodeId;"
    );
    const navIdx = body.indexOf("if (target && !isPendingDeletionRow) {");
    const editIdx = body.indexOf("} else if (eligibleChildId && !isPendingDeletionRow) {");
    expect(pendingIdx).toBeGreaterThan(-1);
    expect(navIdx).toBeGreaterThan(pendingIdx);
    expect(editIdx).toBeGreaterThan(navIdx);
    expect(body).toContain(
      'rowEl.addClass("unified-outliner-partial-edit-parent-child-preview-row-pending-deletion");'
    );
  });

  it("renderParentChildPreview renders the delete affordance on every eligible row (including the one currently open for inline editing) but never on an already-pending-deletion row, wiring it to handleRequestDeleteChild via a genuinely separate stopPropagation/preventDefault handler", () => {
    const body = renderParentChildPreviewBody();
    const deleteSectionIdx = body.lastIndexOf(
      'cls: "unified-outliner-partial-edit-parent-child-delete-button"'
    );
    expect(deleteSectionIdx).toBeGreaterThan(-1);
    const guardIdx = body.lastIndexOf("if (eligibleChildId && !isPendingDeletionRow) {", deleteSectionIdx);
    expect(guardIdx).toBeGreaterThan(-1);
    const deleteBranch = body.slice(guardIdx, body.indexOf("}\n    }\n\n    const truncatedCount", guardIdx));
    expect(deleteBranch).toContain('setIcon(deleteButtonEl, "trash-2");');
    expect(deleteBranch).toContain("evt.stopPropagation();");
    expect(deleteBranch).toContain("evt.preventDefault();");
    expect(deleteBranch).toContain("this.handleRequestDeleteChild(eligibleChildId);");
    expect(deleteBranch).toContain('evt.key === "Enter" || evt.key === " "');
  });

  it("renderParentChildPreview calls renderNewChildEditor from both the empty-projection early-return path AND the normal end-of-method path, mirroring renderChildInlineEditor's own two call sites", () => {
    const body = renderParentChildPreviewBody();
    const occurrences = body.split("this.renderNewChildEditor();").length - 1;
    expect(occurrences).toBe(2);
  });

  it("renderNewChildEditor toggles the panel's visibility off with no draft, and on (populated from the draft's own projection) otherwise — Phase 5L-9b: also falls back to pendingLeafFirstChild's own draft, mutually exclusive with childAddDeleteSession's", () => {
    const body = renderNewChildEditorBody();
    expect(body).toContain(
      "const draft = this.childAddDeleteSession?.newChildDraft ?? this.pendingLeafFirstChild?.draft ?? null;"
    );
    expect(body).toContain("if (!draft) {");
    expect(body).toContain("this.newChildEditorEl.toggleVisibility(false);");
    expect(body).toContain("this.newChildEditorEl.toggleVisibility(true);");
    expect(body).toContain("this.newChildTextareaEl.value = projectedChildBodyText(draft.projection);");
  });

  it("isNewChildDraftDirty is false whenever no draft is pending, and otherwise compares the textarea against the draft's own canonical (always-empty) projected body — Phase 5L-9b: also falls back to pendingLeafFirstChild's own draft", () => {
    const body = isNewChildDraftDirtyBody();
    expect(body).toContain(
      "const draft = this.childAddDeleteSession?.newChildDraft ?? this.pendingLeafFirstChild?.draft;"
    );
    expect(body).toContain("if (!draft) return false;");
    expect(body).toContain(
      "return this.newChildTextareaEl.value !== projectedChildBodyText(draft.projection);"
    );
  });

  it("hasAddDeleteActivity checks PRESENCE (not dirtiness) of a new-child draft and/or a pending deletion, and ALSO (Phase 5L-10) whether a pending reorder is genuinely dirty — an untouched new-child draft still counts as activity, since it still needs to be inserted on Apply", () => {
    const body = hasAddDeleteActivityBody();
    expect(body).toContain("!!session?.newChildDraft ||");
    expect(body).toContain("!!session?.pendingDeletion ||");
    expect(body).toContain("(!!session && isPendingReorderDirty(session))");
  });

  it("handleRequestAddChild is a no-op while a new-child draft is already pending, re-resolves the parent fresh via buildNewChildDraft (never trusts a stale snapshot), and does NOT route through DiscardChangesModal — starting a draft is purely additive", () => {
    const body = handleRequestAddChildBody();
    expect(body).toContain("if (this.childAddDeleteSession?.newChildDraft) return;");
    expect(body).toContain("const doc = parseDocument(view.editor.getValue());");
    expect(body).toContain("const built = buildNewChildDraft(doc, parentNode);");
    expect(body).not.toContain("DiscardChangesModal");
    expect(body).toContain("this.childAddDeleteSession.newChildDraft = built.draft;");
    expect(body).toContain("this.renderParentChildPreview();");
    expect(body).toContain("this.updateDirtyState();");
  });

  it("handleStopNewChildDraft closes immediately with no prompt when the draft is clean, and reuses DiscardChangesModal's 3-choice contract when dirty — discard only nulls the new-child draft, never touches the existing-child session or pending deletion. Phase 5L-9b: this method's own body is unchanged, byte-for-byte — Mode B's own pending draft is handled by a SEPARATE sibling method, handleStopLeafFirstChildDraft (see its own UI-wiring test)", () => {
    const body = handleStopNewChildDraftBody();
    expect(body).not.toContain("pendingLeafFirstChild");
    expect(body).toContain("if (!this.isNewChildDraftDirty()) {");
    const cleanBranchEnd = body.indexOf("new DiscardChangesModal(");
    const cleanBranch = body.slice(0, cleanBranchEnd);
    expect(cleanBranch).toContain("this.childAddDeleteSession.newChildDraft = null;");
    expect(body).toContain("new DiscardChangesModal(this.app, this.plugin, (choice) => {");
    expect(body).toContain('if (choice === "cancel") return;');
    expect(body).toContain('if (choice === "discard") {');
    expect(body).toContain("if (this.childAddDeleteSession) this.childAddDeleteSession.newChildDraft = null;");
    expect(body).toContain('// choice === "apply"');
    expect(body).toContain("this.applyEdit();");
  });

  it("Phase 5L-9b: handleStopLeafFirstChildDraft mirrors handleStopNewChildDraft exactly, but for pendingLeafFirstChild — clean closes immediately, dirty reuses the same 3-choice DiscardChangesModal contract, and discard reverts to plain standalone-leaf editing", () => {
    const body = handleStopLeafFirstChildDraftBody();
    expect(body).toContain("if (!this.pendingLeafFirstChild) return;");
    expect(body).toContain("if (!this.isNewChildDraftDirty()) {");
    const cleanBranchEnd = body.indexOf("new DiscardChangesModal(");
    const cleanBranch = body.slice(0, cleanBranchEnd);
    expect(cleanBranch).toContain("this.pendingLeafFirstChild = null;");
    expect(cleanBranch).toContain("this.renderLeafFirstChildAddRow();");
    expect(body).toContain("new DiscardChangesModal(this.app, this.plugin, (choice) => {");
    expect(body).toContain('if (choice === "cancel") return;');
    expect(body).toContain('if (choice === "discard") {');
    expect(body).toContain('// choice === "apply"');
    expect(body).toContain("this.applyEdit();");
  });

  it("Phase 5L-9b: newChildStopButtonEl's click handler dispatches to handleStopLeafFirstChildDraft while pendingLeafFirstChild is set, and to handleStopNewChildDraft otherwise", () => {
    expect(viewTs).toContain(
      'this.newChildStopButtonEl.addEventListener("click", () => {\n      if (this.pendingLeafFirstChild) {\n        this.handleStopLeafFirstChildDraft();\n      } else {\n        this.handleStopNewChildDraft();\n      }\n    });'
    );
  });

  it("handleRequestDeleteChild re-verifies eligibility fresh via evaluateChildDeleteEligibility against the CURRENT document BEFORE opening ChildDeleteConfirmModal, and only marks the deletion when the user confirmed", () => {
    const body = handleRequestDeleteChildBody();
    expect(body).toContain("const doc = parseDocument(view.editor.getValue());");
    expect(body).toContain("const evaluated = evaluateChildDeleteEligibility(doc, parentNode, childNodeId);");
    expect(body).toContain("if (!evaluated.ok) {");
    expect(body).toContain("new ChildDeleteConfirmModal(this.app, this.plugin, (confirmed) => {");
    expect(body).toContain("if (confirmed) this.commitPendingDeletion(childNodeId);");
  });

  it("commitPendingDeletion re-verifies eligibility ONE MORE TIME before marking, closes that child's own inline editor first if it was open, and records both childNodeId and childIndex", () => {
    const body = commitPendingDeletionBody();
    expect(body).toContain("const evaluated = evaluateChildDeleteEligibility(doc, parentNode, childNodeId);");
    expect(body).toContain(
      "const childIndex = this.childAddDeleteSession.childSlots.findIndex((slot) => slot.nodeId === childNodeId);"
    );
    expect(body).toContain("if (childIndex === -1) {");
    expect(body).toContain("if (this.childInlineSession?.childNodeId === childNodeId) {");
    expect(body).toContain("this.childInlineSession = null;");
    expect(body).toContain("this.childAddDeleteSession.pendingDeletion = { childNodeId, childIndex };");
    expect(body).toContain("this.renderParentChildPreview();");
    expect(body).toContain("this.updateDirtyState();");
  });

  it("isDirty() folds hasAddDeleteActivity() into its own combined OR-chain (as addDeleteDirty), so a pending new-child draft and/or a pending deletion alone is enough to make the whole pane dirty. Phase 5L-9b: leafFirstChildDirty is ALSO folded in, right after it (Phase 5E-3: fencedCodeInfoStringDirty now follows leafFirstChildDirty as the chain's own new final term, so this checks the fixed three-in-a-row ordering via OR rather than asserting leafFirstChildDirty is literally the chain's own final term)", () => {
    const body = isDirtyBody();
    expect(body).toContain("const addDeleteDirty = this.hasAddDeleteActivity();");
    expect(body).toContain("const leafFirstChildDirty = this.pendingLeafFirstChild !== null;");
    expect(body).toContain("childInlineDirty ||\n        addDeleteDirty ||\n        leafFirstChildDirty ||");
  });

  it("cancelEdit discards BOTH a pending new-child draft AND a pending deletion mark outright (never just reverting a value), and (Phase 5L-10) resets a pending reorder plan back to identity order too — re-rendering the preview only when at least one of the three was actually present/dirty", () => {
    const body = cancelEditBody();
    const guardText = "addDeleteSession &&\n      (addDeleteSession.newChildDraft ||";
    expect(body).toContain(guardText);
    const guardIdx = body.indexOf(guardText);
    const guardedRegion = body.slice(guardIdx);
    expect(guardedRegion).toContain("addDeleteSession.pendingDeletion ||");
    expect(guardedRegion).toContain("isPendingReorderDirty(addDeleteSession) ||");
    expect(guardedRegion).toContain("addDeleteSession.newChildDraft = null;");
    expect(guardedRegion).toContain("addDeleteSession.pendingDeletion = null;");
    expect(guardedRegion).toContain(
      "addDeleteSession.pendingReorderOrder = addDeleteSession.childSlots.map((slot) => slot.nodeId);"
    );
    expect(guardedRegion).toContain("this.renderParentChildPreview();");
  });

  // Phase 5L-11 ("Direct Child Leaf Indent/Outdent in Parent Partial Edit
  // Pane"): a full pane-level Cancel ALSO discards a pending indent/
  // outdent entirely — a sibling assertion to the one immediately above,
  // never a replacement for it (all four pending slots share the SAME
  // guard condition and the SAME re-render call).
  it("cancelEdit ALSO discards a pending indent/outdent entirely, as a fourth condition on the SAME guard", () => {
    const body = cancelEditBody();
    const guardText = "addDeleteSession &&\n      (addDeleteSession.newChildDraft ||";
    const guardIdx = body.indexOf(guardText);
    expect(guardIdx).toBeGreaterThan(-1);
    const guardedRegion = body.slice(guardIdx);
    expect(guardedRegion).toContain("addDeleteSession.pendingIndentOutdent)");
    expect(guardedRegion).toContain("addDeleteSession.pendingIndentOutdent = null;");
  });

  it("applyEdit dispatches to the generalized combined-apply path whenever hasAddDeleteActivity() is true, and this branch is checked BEFORE the plain childInlineSession-only branch (5L-8's own fixed-two-range path)", () => {
    const body = applyEditBody();
    const addDeleteIdx = body.indexOf(
      "} else if (this.standaloneParentListItemProjection && this.hasAddDeleteActivity()) {"
    );
    const childOnlyIdx = body.indexOf(
      "} else if (this.standaloneParentListItemProjection && this.childInlineSession) {"
    );
    expect(addDeleteIdx).toBeGreaterThan(-1);
    expect(childOnlyIdx).toBeGreaterThan(addDeleteIdx);
    const addDeleteBranch = body.slice(addDeleteIdx, childOnlyIdx);
    expect(addDeleteBranch).toContain("return this.applyParentChildAddDeleteCombinedEdit(doc, editor);");
  });

  it("applyParentChildAddDeleteCombinedEdit validates off the ORIGINAL snapshots via invertAndValidateParentChildAddDeleteEdit before ever touching the live document, and only then re-resolves fresh + applies via applyParentChildAddDeleteToDocument", () => {
    const body = applyParentChildAddDeleteCombinedEditBody();
    const validateIdx = body.indexOf("invertAndValidateParentChildAddDeleteEdit({");
    const applyIdx = body.indexOf("applyParentChildAddDeleteToDocument(");
    expect(validateIdx).toBeGreaterThan(-1);
    expect(applyIdx).toBeGreaterThan(validateIdx);
    expect(body).toContain("if (!combined.ok) {");
    expect(body).toContain("if (!liveOutcome.changed) {");
  });

  it("applyParentChildAddDeleteCombinedEdit performs exactly ONE applyLineEditOutcome call (a single atomic multi-range write via one combined `lines` array) — never separate sequential range replacements", () => {
    const body = applyParentChildAddDeleteCombinedEditBody();
    const occurrences = body.split("applyLineEditOutcome(").length - 1;
    expect(occurrences).toBe(1);
  });

  it("applyParentChildAddDeleteCombinedEdit is a defensive no-op returning false when none of parent/existing-child/deletion/new-child/reorder is actually dirty or present — unreachable in practice since applyEdit only calls it while hasAddDeleteActivity() is true", () => {
    const body = applyParentChildAddDeleteCombinedEditBody();
    expect(body).toContain(
      "if (!parentDirty && !existingChildDirty && !hasDeletion && !hasNewChild && !reorderDirty) {"
    );
  });

  it("applyParentChildAddDeleteCombinedEdit's post-Apply rebuild re-parses the just-saved document fresh and delegates to the shared reconcileStandaloneNodeState (which rebuilds standaloneParentListItemProjection AND childAddDeleteSession from scratch, clearing any pending draft/deletion, since a successful Apply is what commits them), and re-opens the existing-child session only if it was for a DIFFERENT child than the one just deleted", () => {
    // 2026-09-22 (Phase 5L-12, bug fix): deleting the LAST remaining child
    // here is a genuine parent->leaf transition (freshParentNode.
    // childIds.length drops to 0) — the OLD narrow "stillEligible ...
    // buildStandaloneParentListItemProjection" rebuild this test
    // originally pinned down never reconsidered the four leaf tiers or
    // rebuilt ancestors/directChildren/siblingState, so this pane's own
    // Apply could strand it in a stale "neither parent nor leaf" state —
    // the same defect class Phase 5L-9b's Bug #2 fixed for the
    // external-Undo case, now shown reachable from this pane's own Apply
    // too. See applyParentChildAddDeleteCombinedEdit's own doc comment
    // for the full rationale.
    const body = applyParentChildAddDeleteCombinedEditBody();
    expect(body).not.toContain("const stillEligible =");
    expect(body).toContain("const freshDoc = parseDocument(editor.getValue());");
    expect(body).toContain("const freshExtracted = extractSubtreeText(freshDoc, this.nodeId);");
    expect(body).toContain(
      "this.reconcileStandaloneNodeState(\n" +
        "        freshDoc,\n" +
        "        this.nodeId,\n" +
        "        freshParentNode,\n" +
        "        freshExtracted.ok ? freshExtracted.text : \"\"\n" +
        "      );"
    );
    expect(body).toContain("if (\n        existingChildSession &&");
    expect(body).toContain("this.renderBreadcrumb();");
    expect(body).toContain("this.renderSiblingNav();");
    expect(body).toContain("this.renderSubtreeNavigator();");
    expect(body).toContain("this.renderParentChildPreview();");
    expect(body).toContain("this.renderLeafFirstChildAddRow();");
    expect(body).toContain('this.syncState = "synced";');
  });

  it("applyParentChildAddDeleteCombinedEdit shows the dedicated combined add/delete success Notice on success, and a translated reason-specific Notice on every failure path — never a silent no-op", () => {
    const body = applyParentChildAddDeleteCombinedEditBody();
    expect(body).toContain('new Notice(this.plugin.t("partialEdit.parentChildAddDeleteApplied"));');
    expect(body).toContain(
      "new Notice(this.plugin.t(parentChildAddDeleteApplyReasonKey(combined.reason)));"
    );
    expect(body).toContain(
      "new Notice(this.plugin.t(parentChildAddDeleteLiveApplyReasonKey(liveOutcome.reason)));"
    );
  });

  it("defines a distinct ChildDeleteConfirmModal class (never DiscardChangesModal reused) with a two-choice confirm/cancel contract that resolves to 'not confirmed' on any dismissal other than explicit confirm", () => {
    const classStart = viewTs.indexOf("class ChildDeleteConfirmModal extends Modal {");
    expect(classStart).toBeGreaterThan(-1);
    const classBody = viewTs.slice(classStart);
    expect(classBody).toContain('this.titleEl.setText(this.plugin.t("partialEdit.parentChildDeleteConfirmTitle"));');
    expect(classBody).toContain('text: this.plugin.t("partialEdit.parentChildDeleteConfirmBody")');
    expect(classBody).toContain('text: this.plugin.t("partialEdit.parentChildDeleteConfirmButton"),\n      cls: "mod-warning",');
    expect(classBody).toContain("confirmEl.addEventListener(\"click\", () => this.choose(true));");
    expect(classBody).toContain("cancelEl.addEventListener(\"click\", () => this.choose(false));");
    expect(classBody).toContain("if (!this.resolved) {\n      this.onChoice(false);\n    }");
  });

  it("parentChildAddDeleteApplyReasonKey reuses every one of parentChildCombinedApplyReasonKey's own mappings verbatim via its default branch, adding only the three genuinely new reasons", () => {
    const start = viewTs.indexOf("function parentChildAddDeleteApplyReasonKey(");
    expect(start).toBeGreaterThan(-1);
    const body = bodyOf(viewTs, "function parentChildAddDeleteApplyReasonKey(reason: ParentChildAddDeleteApplyRejectReason): TranslationKey {", "parentChildAddDeleteApplyReasonKey");
    expect(body).toContain('case "new-child-unsafe-structure":');
    expect(body).toContain('return "partialEdit.parentChildNewChildStructureInvalid";');
    expect(body).toContain('case "new-child-not-leaf":');
    expect(body).toContain('case "deletion-target-missing":');
    expect(body).toContain("default:\n      return parentChildCombinedApplyReasonKey(reason);");
  });

  it("defines the required Phase 5L-9 i18n keys in both dictionaries", () => {
    const i18nTs = readFileSync(path.resolve(__dirname, "../src/i18n.ts"), "utf-8");
    const keys = [
      "partialEdit.parentChildNewChildStructureInvalid",
      "partialEdit.parentChildAddButtonLabel",
      "partialEdit.parentChildAddButtonAlreadyPendingLabel",
      "partialEdit.parentChildNewChildPanelLabel",
      "partialEdit.parentChildNewChildStopLabel",
      "partialEdit.parentChildPendingDeletionLabel",
      "partialEdit.parentChildDeleteButtonLabel",
      "partialEdit.parentChildAddChildFailed",
      "partialEdit.parentChildDeleteFailed",
      "partialEdit.parentChildAddDeleteApplied",
      "partialEdit.parentChildDeleteConfirmTitle",
      "partialEdit.parentChildDeleteConfirmBody",
      "partialEdit.parentChildDeleteConfirmButton",
    ];
    for (const key of keys) {
      const count = i18nTs.split(`"${key}"`).length - 1;
      expect(count).toBe(2); // once in the EN dictionary, once in JA
    }
  });
});
