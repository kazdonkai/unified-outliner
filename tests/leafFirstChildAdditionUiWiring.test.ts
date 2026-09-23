/**
 * Phase 5L-9b ("First Direct Child Addition for Leaf List Items — Mode
 * B"): static-source-text checks for the View-layer wiring this ticket
 * added to view/PartialEditView.ts — mirrors
 * tests/parentChildIndentOutdentUiWiring.test.ts's own structure (same
 * "PartialEditView can't be constructed in vitest" constraint, same
 * bodyOf()-based literal-substring approach).
 *
 * The real, non-Obsidian-dependent Mode B logic this wiring calls into
 * (evaluateLeafFirstChildEligibility, buildPendingLeafFirstChild,
 * applyLeafFirstChildAdditionToDocument) is unit-tested directly, with
 * real parseDocument-backed assertions, in
 * tests/leafFirstChildAddition.test.ts — this file only confirms the
 * View layer wires into that logic at the right place: the "add a first
 * child" row is a genuinely separate top-level control from
 * parentChildPreviewEl's own Mode A Add-child button (visible only while
 * the node projects as one of the four standalone-leaf kinds, never once
 * it is already a real parent); starting a Mode B draft never routes
 * through DiscardChangesModal (purely additive, mirroring
 * handleRequestAddChild); pendingLeafFirstChild and
 * childAddDeleteSession?.newChildDraft are mutually exclusive by
 * construction, so renderNewChildEditor/isNewChildDraftDirty fall back
 * from one to the other rather than needing a second inline-editor UI;
 * isDirty()/cancelEdit() treat pendingLeafFirstChild as a fifth,
 * independent pending slot; and applyEdit() dispatches to the dedicated
 * applyLeafFirstChildEdit BEFORE every other branch, since none of them
 * know how to also insert a brand-new first child.
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

function renderLeafFirstChildAddRowBody(): string {
  return bodyOf(viewTs, "private renderLeafFirstChildAddRow(): void {", "renderLeafFirstChildAddRow");
}

function handleRequestAddLeafFirstChildBody(): string {
  return bodyOf(viewTs, "private handleRequestAddLeafFirstChild(): void {", "handleRequestAddLeafFirstChild");
}

function handleStopLeafFirstChildDraftBody(): string {
  return bodyOf(viewTs, "private handleStopLeafFirstChildDraft(): void {", "handleStopLeafFirstChildDraft");
}

function renderNewChildEditorBody(): string {
  return bodyOf(viewTs, "private renderNewChildEditor(): void {", "renderNewChildEditor");
}

function isNewChildDraftDirtyBody(): string {
  return bodyOf(viewTs, "private isNewChildDraftDirty(): boolean {", "isNewChildDraftDirty");
}

function isDirtyBody(): string {
  return bodyOf(viewTs, "private isDirty(): boolean {", "isDirty");
}

function cancelEditBody(): string {
  return bodyOf(viewTs, "private cancelEdit(): void {", "cancelEdit");
}

function applyEditBody(): string {
  return bodyOf(viewTs, "private applyEdit(): boolean {", "applyEdit");
}

function applyLeafFirstChildEditBody(): string {
  return bodyOf(
    viewTs,
    "private applyLeafFirstChildEdit(doc: ParsedDocument, editor: Editor): boolean {",
    "applyLeafFirstChildEdit"
  );
}

function performAutoReloadBody(): string {
  return bodyOf(viewTs, "private performAutoReload(newText: string, doc: ParsedDocument): void {", "performAutoReload");
}

describe("view/PartialEditView.ts: Phase 5L-9b (First Direct Child Addition for Leaf List Items — Mode B)", () => {
  it("imports the Phase 5L-9b logic from edit/parentChildInlineEditSession.ts -- never reimplements it", () => {
    expect(viewTs).toContain("ApplyLeafFirstChildRejectReason");
    expect(viewTs).toContain("PendingLeafFirstChild");
    expect(viewTs).toContain("applyLeafFirstChildAdditionToDocument");
    expect(viewTs).toContain("buildPendingLeafFirstChild");
  });

  it("declares pendingLeafFirstChild as its own dedicated field, and leafFirstChildAddRowEl/leafFirstChildAddButtonEl as its own dedicated DOM fields -- never reusing childAddDeleteSession or parentChildAddButtonEl, which stay scoped to a REAL parent projection only", () => {
    expect(viewTs).toContain("private pendingLeafFirstChild: PendingLeafFirstChild | null = null;");
    expect(viewTs).toContain("private leafFirstChildAddRowEl!: HTMLElement;");
    expect(viewTs).toContain("private leafFirstChildAddButtonEl!: HTMLButtonElement;");
  });

  it("constructs leafFirstChildAddRowEl/leafFirstChildAddButtonEl as a plus-icon button with a tooltip, a stopPropagation click handler delegating to handleRequestAddLeafFirstChild, and starts hidden", () => {
    expect(viewTs).toContain(
      'this.leafFirstChildAddRowEl = this.contentEl.createDiv({\n      cls: "unified-outliner-partial-edit-leaf-first-child-add-row",\n    });'
    );
    expect(viewTs).toContain(
      'this.leafFirstChildAddButtonEl = this.leafFirstChildAddRowEl.createEl("button", {\n      cls: "unified-outliner-partial-edit-leaf-first-child-add-button",'
    );
    expect(viewTs).toContain('setIcon(this.leafFirstChildAddButtonEl, "plus");');
    expect(viewTs).toContain(
      'setTooltip(this.leafFirstChildAddButtonEl, this.plugin.t("partialEdit.leafFirstChildAddButtonLabel"));'
    );
    const clickIdx = viewTs.indexOf("this.leafFirstChildAddButtonEl.addEventListener(\"click\", (evt) => {");
    expect(clickIdx).toBeGreaterThan(-1);
    const clickHandler = viewTs.slice(clickIdx, viewTs.indexOf("});", clickIdx) + 3);
    expect(clickHandler).toContain("evt.stopPropagation();");
    expect(clickHandler).toContain("this.handleRequestAddLeafFirstChild();");
    expect(viewTs).toContain("this.leafFirstChildAddRowEl.toggleVisibility(false);");
  });

  it("newChildStopButtonEl's click handler dispatches between handleStopLeafFirstChildDraft and handleStopNewChildDraft based on which of pendingLeafFirstChild/childAddDeleteSession?.newChildDraft is actually set -- the two share ONE physical 'stop this draft' control since they never coexist", () => {
    const idx = viewTs.indexOf('this.newChildStopButtonEl.addEventListener("click", () => {');
    expect(idx).toBeGreaterThan(-1);
    const handler = viewTs.slice(idx, viewTs.indexOf("});", idx) + 3);
    expect(handler).toContain("if (this.pendingLeafFirstChild) {");
    expect(handler).toContain("this.handleStopLeafFirstChildDraft();");
    expect(handler).toContain("} else {");
    expect(handler).toContain("this.handleStopNewChildDraft();");
  });

  describe("renderLeafFirstChildAddRow", () => {
    it("is eligible ONLY while there is no real parent projection yet and at least one of the four standalone-leaf projections is active -- hidden otherwise", () => {
      const body = renderLeafFirstChildAddRowBody();
      expect(body).toContain("const eligible =");
      expect(body).toContain("!this.standaloneParentListItemProjection &&");
      expect(body).toContain("(!!this.standaloneListMarkerProjection ||");
      expect(body).toContain("!!this.standaloneTaskListProjection ||");
      expect(body).toContain("!!this.standaloneOrderedListProjection ||");
      expect(body).toContain("!!this.standaloneMultiLineListProjection);");
      expect(body).toContain("if (!eligible) {");
      expect(body).toContain("this.leafFirstChildAddRowEl.toggleVisibility(false);");
      expect(body).toContain("return;");
    });

    it("while eligible, stays visible but DISABLES the button (never hides it -- a hidden control can't explain itself via tooltip) and swaps its tooltip to the already-pending label whenever a draft is already pending, mirroring parentChildAddButtonEl's own identical policy", () => {
      const body = renderLeafFirstChildAddRowBody();
      expect(body).toContain("this.leafFirstChildAddRowEl.toggleVisibility(true);");
      expect(body).toContain("const alreadyPending = !!this.pendingLeafFirstChild;");
      expect(body).toContain("this.leafFirstChildAddButtonEl.disabled = alreadyPending;");
      expect(body).toContain("setTooltip(");
      expect(body).toContain("this.leafFirstChildAddButtonEl,");
      expect(body).toContain('? "partialEdit.leafFirstChildAddButtonAlreadyPendingLabel"');
      expect(body).toContain(': "partialEdit.leafFirstChildAddButtonLabel"');
    });
  });

  describe("handleRequestAddLeafFirstChild", () => {
    it("is a defensive no-op when a draft is already pending (the button is disabled in this state)", () => {
      const body = handleRequestAddLeafFirstChildBody();
      expect(body).toContain("if (this.pendingLeafFirstChild) return;");
    });

    it("refuses (with a Notice) when the active view/nodeId can't be resolved, the node is ALREADY a real parent, or none of the four standalone-leaf projections is active", () => {
      const body = handleRequestAddLeafFirstChildBody();
      expect(body).toContain("if (");
      expect(body).toContain("!view ||");
      expect(body).toContain("!this.nodeId ||");
      expect(body).toContain("this.standaloneParentListItemProjection ||");
      expect(body).toContain("!(");
      expect(body).toContain("this.standaloneListMarkerProjection ||");
      expect(body).toContain("this.standaloneTaskListProjection ||");
      expect(body).toContain("this.standaloneOrderedListProjection ||");
      expect(body).toContain("this.standaloneMultiLineListProjection");
      expect(body).toContain('new Notice(this.plugin.t("partialEdit.leafFirstChildAddFailed"));');
    });

    it("re-resolves the leaf fresh via parseDocument(view.editor.getValue()) and re-verifies eligibility through buildPendingLeafFirstChild -- never trusting the button's own row-level eligibility snapshot -- before ever setting pendingLeafFirstChild", () => {
      const body = handleRequestAddLeafFirstChildBody();
      expect(body).toContain("const doc = parseDocument(view.editor.getValue());");
      expect(body).toContain("const built = buildPendingLeafFirstChild(doc, this.nodeId);");
      expect(body).toContain("if (!built.ok) {");
      expect(body).toContain("this.pendingLeafFirstChild = built.pending;");
    });

    it("on success, re-renders both the add-row and the new-child inline editor and updates dirty state -- never routes through DiscardChangesModal (purely additive, mirroring handleRequestAddChild's own identical rationale)", () => {
      const body = handleRequestAddLeafFirstChildBody();
      expect(body).toContain("this.renderLeafFirstChildAddRow();");
      expect(body).toContain("this.renderNewChildEditor();");
      expect(body).toContain("this.updateDirtyState();");
      expect(body).not.toContain("DiscardChangesModal");
    });
  });

  describe("handleStopLeafFirstChildDraft", () => {
    it("is a no-op when nothing is pending, and discards a CLEAN (untouched-body) draft immediately with no prompt -- reverting the add-row and the new-child editor and updating dirty state", () => {
      const body = handleStopLeafFirstChildDraftBody();
      expect(body).toContain("if (!this.pendingLeafFirstChild) return;");
      expect(body).toContain("if (!this.isNewChildDraftDirty()) {");
      expect(body).toContain("this.pendingLeafFirstChild = null;");
      expect(body).toContain("this.renderLeafFirstChildAddRow();");
      expect(body).toContain("this.renderNewChildEditor();");
      expect(body).toContain("this.updateDirtyState();");
      expect(body).toContain("return;");
    });

    it("routes a DIRTY draft through DiscardChangesModal, with discard clearing pendingLeafFirstChild and re-rendering, and apply delegating to the pane's own applyEdit()", () => {
      const body = handleStopLeafFirstChildDraftBody();
      expect(body).toContain("new DiscardChangesModal(this.app, this.plugin, (choice) => {");
      expect(body).toContain('if (choice === "cancel") return;');
      expect(body).toContain('if (choice === "discard") {');
      expect(body).toContain('// choice === "apply":');
      expect(body).toContain("this.applyEdit();");
      expect(body).toContain("}).open();");
    });
  });

  describe("renderNewChildEditor / isNewChildDraftDirty", () => {
    it("both fall back from childAddDeleteSession?.newChildDraft to pendingLeafFirstChild?.draft -- the two are mutually exclusive by construction, so this reuses the exact same inline-editor UI for either draft rather than building a second one", () => {
      const renderBody = renderNewChildEditorBody();
      expect(renderBody).toContain(
        "const draft = this.childAddDeleteSession?.newChildDraft ?? this.pendingLeafFirstChild?.draft ?? null;"
      );

      const dirtyBody = isNewChildDraftDirtyBody();
      expect(dirtyBody).toContain(
        "const draft = this.childAddDeleteSession?.newChildDraft ?? this.pendingLeafFirstChild?.draft;"
      );
    });
  });

  describe("isDirty", () => {
    it("treats a pending Mode B draft as an unconditional dirty contributor -- leafFirstChildDirty is simply `pendingLeafFirstChild !== null`, and is OR'd in alongside addDeleteDirty (Phase 5E-3: no longer the OR-chain's final term -- fencedCodeInfoStringDirty was appended after it, see that phase's own isDirty test coverage in partialEdit UI wiring)", () => {
      const body = isDirtyBody();
      expect(body).toContain("const leafFirstChildDirty = this.pendingLeafFirstChild !== null;");
      expect(body).toContain("addDeleteDirty ||");
      expect(body).toContain("leafFirstChildDirty ||");
    });
  });

  describe("cancelEdit", () => {
    it("also discards a pending Mode B draft entirely -- a SEPARATE branch from the addDeleteSession revert block (the two are mutually exclusive by construction), reverting the add-row and the new-child editor", () => {
      const body = cancelEditBody();
      expect(body).toContain("if (this.pendingLeafFirstChild) {");
      expect(body).toContain("this.pendingLeafFirstChild = null;");
      expect(body).toContain("this.renderLeafFirstChildAddRow();");
      expect(body).toContain("this.renderNewChildEditor();");
      expect(body).toContain("}");
      expect(body).toContain("this.updateDirtyState();");
    });
  });

  describe("applyEdit dispatch", () => {
    it("checks pendingLeafFirstChild FIRST, before every other branch in the if/else-if chain, and routes directly to applyLeafFirstChildEdit -- none of the other branches know how to also insert a brand-new first child", () => {
      const body = applyEditBody();
      const leafFirstChildIdx = body.indexOf("if (this.pendingLeafFirstChild) {");
      const quoteProjectionIdx = body.indexOf("} else if (this.quoteProjection) {");
      expect(leafFirstChildIdx).toBeGreaterThan(-1);
      expect(quoteProjectionIdx).toBeGreaterThan(leafFirstChildIdx);
      const branch = body.slice(leafFirstChildIdx, quoteProjectionIdx);
      expect(branch).toContain("return this.applyLeafFirstChildEdit(doc, editor);");
    });
  });

  describe("applyLeafFirstChildEdit", () => {
    it("refuses safely (Notice, returns false) when nodeId or pendingLeafFirstChild cannot be resolved", () => {
      const body = applyLeafFirstChildEditBody();
      expect(body).toContain("if (!this.nodeId || !this.pendingLeafFirstChild) {");
      expect(body).toContain('new Notice(this.plugin.t("partialEdit.leafFirstChildAddFailed"));');
      expect(body).toContain("return false;");
    });

    it("inverts the CURRENTLY ACTIVE standalone-leaf own-text draft via the exact same per-kind invert*Projection dispatch applyEdit's own four standalone-leaf branches already use -- never a fifth, duplicate inversion path -- with a defensive final else for the impossible case", () => {
      const body = applyLeafFirstChildEditBody();
      expect(body).toContain("if (this.standaloneListMarkerProjection) {");
      expect(body).toContain("invertListMarkerProjection(this.standaloneListMarkerProjection, this.textareaEl.value);");
      expect(body).toContain("} else if (this.standaloneTaskListProjection) {");
      expect(body).toContain("invertTaskListProjection(");
      expect(body).toContain("} else if (this.standaloneOrderedListProjection) {");
      expect(body).toContain("invertOrderedListProjection(");
      expect(body).toContain("} else if (this.standaloneMultiLineListProjection) {");
      expect(body).toContain("invertMultiLineListItemProjection(");
      expect(body).toContain("} else {");
      expect(body).toContain(
        "// Defensive only — pendingLeafFirstChild is only ever set while\n      // exactly one of the four standalone-leaf projections is active"
      );
    });

    it("calls applyLeafFirstChildAdditionToDocument with doc, nodeId, the pane's own originalText snapshot, the freshly-inverted own-text, and the pending draft -- surfacing any refusal via leafFirstChildApplyReasonKey and touching nothing on failure", () => {
      const body = applyLeafFirstChildEditBody();
      const callIdx = body.indexOf("const outcome = applyLeafFirstChildAdditionToDocument(");
      expect(callIdx).toBeGreaterThan(-1);
      const call = body.slice(callIdx, body.indexOf(");", callIdx) + 2);
      expect(call).toContain("doc,");
      expect(call).toContain("this.nodeId,");
      expect(call).toContain("this.originalText,");
      expect(call).toContain("newOwnTextRawText,");
      expect(call).toContain("this.pendingLeafFirstChild");
      expect(body).toContain("if (!outcome.ok) {");
      expect(body).toContain("new Notice(this.plugin.t(leafFirstChildApplyReasonKey(outcome.reason)));");
      expect(body).toContain("return false;");
    });

    it("on success, writes via applyLineEditOutcome, clears pendingLeafFirstChild, and — UNLIKE every sibling combined-Apply method's own narrow hand-rebuild — calls loadNodeInternal directly for a full five-tier reload, since the node crosses from a leaf tier all the way to the parent tier", () => {
      const body = applyLeafFirstChildEditBody();
      expect(body).toContain("this.isApplyingOwnEdit = true;");
      expect(body).toContain("applyLineEditOutcome(");
      expect(body).toContain("this.pendingLeafFirstChild = null;");
      expect(body).toContain("this.loadNodeInternal(this.nodeId);");
      expect(body).toContain("} finally {");
      expect(body).toContain("this.isApplyingOwnEdit = false;");
      expect(body).toContain('new Notice(this.plugin.t("partialEdit.leafFirstChildAdded"));');
      expect(body).toContain("return true;");
    });
  });

  describe("render call sites", () => {
    it("renderEmptyState, renderLoadedState, and performAutoReload's success path each call renderLeafFirstChildAddRow immediately after renderParentChildPreview -- the pane's own three shared render-tail call sites", () => {
      const occurrences = viewTs.split("this.renderParentChildPreview();\n    this.renderLeafFirstChildAddRow();").length - 1;
      expect(occurrences).toBeGreaterThanOrEqual(3);
    });
  });

  describe("performAutoReload (real-device bug fix: an editor Undo right after this pane's own Mode B Apply reverts a leaf's only child, but the pane never re-loads via loadNodeInternal)", () => {
    it("Phase 5L-12 widens this further: the standalone-leaf-projection rebuild is no longer gated behind an OR-chain of \"was any of the five already active\" at all -- it fires unconditionally via reconcileStandaloneNodeState whenever this.nodeId is set -- so a node that reloads from parent back down to a genuine childless leaf (or the reverse) always gets its NEW tier freshly discovered, never stuck on the pre-reload shape", () => {
      // 2026-09-22 (Phase 5L-12): this test originally pinned the Phase
      // 5L-9b fix's own 5-way "(this.standaloneListMarkerProjection || ...
      // || this.standaloneParentListItemProjection)" OR-chain gate. That
      // gate was itself found, during this phase's own investigation, to
      // still be insufficiently wide: a node reloading from a real PARENT
      // down to a genuine childless LEAF starts the reload with all four
      // leaf fields null, so even the 5-way OR-chain's own
      // "|| this.standaloneParentListItemProjection" arm firing only
      // re-verified the (about-to-be-wrong) parent projection, rather than
      // discovering the correct leaf one. See performAutoReload's own doc
      // comment and standaloneListMarkerFreePartialEditUiWiring.test.ts's
      // own identically-updated performAutoReload test for the full
      // before/after. This test's INTENT -- reload correctly discovers the
      // pane's CURRENT tier even when it differs from the pre-reload one --
      // is unchanged; the gate is now simply unconditional.
      const body = performAutoReloadBody();
      expect(body).not.toContain("this.standaloneListMarkerProjection ||");
      expect(body).toContain(
        "if (this.nodeId) {\n" +
          "      const reloadedNode = doc.nodes.get(this.nodeId);\n" +
          "      this.reconcileStandaloneNodeState(doc, this.nodeId, reloadedNode, newText);\n" +
          "    }"
      );
    });

    it("recomputes the breadcrumb/sibling-nav/Subtree Navigator trio (ancestors/directChildren/siblingState) fresh from the just-reloaded doc via the shared resolveNavigationState helper (called from inside reconcileStandaloneNodeState) -- the SAME three doc.nodes-based helpers loadNodeInternal itself uses, via the SAME shared method loadNodeInternal itself now calls too -- rather than leaving them pointing at pre-reload state", () => {
      // 2026-09-22 (Phase 5L-12): this test originally pinned down a
      // SEPARATE inline "if (this.nodeId) { const reloadedNode = ...; if
      // (reloadedNode) { ... findAncestorPath/findDirectChildren/
      // getSiblingNavigationState ... } else { ... } }" block added as
      // this Bug #2's own original fix, positioned in performAutoReload
      // AFTER the compositeAnchor handling. That block has since been
      // consolidated away: reconcileStandaloneNodeState's own
      // resolveNavigationState call (see both methods' doc comments) now
      // does exactly this same recompute, once, for every one of
      // loadNodeInternal/performAutoReload/all four Apply-rebuild sites --
      // this test's INTENT (the trio is recomputed fresh from the
      // just-reloaded doc via the same three helpers loadNodeInternal
      // itself uses, never left pointing at pre-reload state) is
      // unchanged; only WHERE that recompute now lives has moved.
      const body = performAutoReloadBody();
      expect(body).toContain(
        "if (this.nodeId) {\n" +
          "      const reloadedNode = doc.nodes.get(this.nodeId);\n" +
          "      this.reconcileStandaloneNodeState(doc, this.nodeId, reloadedNode, newText);\n" +
          "    }"
      );
      // resolveNavigationState's own multi-line return-TYPE literal
      // ends with its own flush "  }" (before the method body's opening
      // brace), which the shared bodyOf() helper's naive "first \n  }
      // after the needle" search would mistake for the method's own
      // closing brace -- sliced by hand here instead, up to the start of
      // the next method (reconcileStandaloneNodeState) declared
      // immediately after it.
      const resolveNavStart = viewTs.indexOf("private resolveNavigationState(");
      expect(resolveNavStart).toBeGreaterThan(-1);
      const resolveNavEnd = viewTs.indexOf("private reconcileStandaloneNodeState(", resolveNavStart);
      expect(resolveNavEnd).toBeGreaterThan(resolveNavStart);
      const resolveNavBody = viewTs.slice(resolveNavStart, resolveNavEnd);
      expect(resolveNavBody).toContain("if (!node) {");
      expect(resolveNavBody).toContain(
        "return { ancestors: [], directChildren: [], siblingState: { previous: null, next: null } };"
      );
      expect(resolveNavBody).toContain("const t = this.plugin.t.bind(this.plugin);");
      expect(resolveNavBody).toContain("ancestors: findAncestorPath(doc, nodeId, t),");
      expect(resolveNavBody).toContain("directChildren: findDirectChildren(doc, nodeId, t),");
      expect(resolveNavBody).toContain("siblingState: getSiblingNavigationState(doc, nodeId, t),");
      const reconcileBody = bodyOf(
        viewTs,
        "private reconcileStandaloneNodeState(",
        "reconcileStandaloneNodeState"
      );
      expect(reconcileBody).toContain("const nav = this.resolveNavigationState(doc, nodeId, node);");
      expect(reconcileBody).toContain("this.ancestors = nav.ancestors;");
      expect(reconcileBody).toContain("this.directChildren = nav.directChildren;");
      expect(reconcileBody).toContain("this.siblingState = nav.siblingState;");
    });

    it("re-renders the breadcrumb, sibling nav, and Subtree Navigator too -- previously only rendered from a fresh loadNodeInternal load, never from this silent-reload path -- in the SAME order renderLoadedState itself uses, before the pre-existing renderQuoteHeader/.../renderLeafFirstChildAddRow tail", () => {
      const body = performAutoReloadBody();
      const breadcrumbIdx = body.indexOf("this.renderBreadcrumb();");
      const siblingNavIdx = body.indexOf("this.renderSiblingNav();");
      const subtreeNavIdx = body.indexOf("this.renderSubtreeNavigator();");
      const quoteHeaderIdx = body.indexOf("this.renderQuoteHeader();");
      expect(breadcrumbIdx).toBeGreaterThan(-1);
      expect(siblingNavIdx).toBeGreaterThan(breadcrumbIdx);
      expect(subtreeNavIdx).toBeGreaterThan(siblingNavIdx);
      expect(quoteHeaderIdx).toBeGreaterThan(subtreeNavIdx);
    });
  });
});
