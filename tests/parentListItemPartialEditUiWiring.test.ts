/**
 * Phase 5L-6 ("Parent List Item Structured Partial Edit"): static-source-
 * text checks for the wiring this ticket added to view/PartialEditView.ts —
 * mirrors tests/multiLineListPartialEditUiWiring.test.ts's own structure
 * exactly, since this file is that one's parent-item counterpart.
 *
 * Same constraint as the other View-wiring test files in this project:
 * PartialEditView (extends Obsidian's ItemView) cannot be constructed in
 * vitest, since "obsidian" is a types-only package in this repo. This file
 * inspects the raw source text of view/PartialEditView.ts rather than
 * instantiating it.
 *
 * The real, non-Obsidian-dependent logic this wiring calls into
 * (resolveParentListItemOwnTextRange, buildParentListItemProjection,
 * invertParentListItemProjection, applyParentListItemOwnTextEdit,
 * isStandaloneParentListItemEligibleForProjection,
 * hasComplexBlockInParentOwnTextContinuation) is unit-tested directly, with
 * real assertions, in tests/parentListItemProjection.test.ts,
 * tests/standaloneParentListItemProjection.test.ts, and
 * tests/parentListItemStructuredPartialEdit.test.ts — this file only
 * confirms the View layer actually wires into that logic at the right
 * place, reuses the EXISTING checkbox/number controls rather than
 * introducing any new one, and never routes the parent kind through the
 * generic applySubtreeEdit.
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

function applyEditBody(): string {
  const start = viewTs.indexOf("private applyEdit(): boolean {");
  expect(start).toBeGreaterThan(-1);
  const end = viewTs.indexOf("\n  /**\n   * Real-device follow-up: Apply/Cancel", start);
  expect(end).toBeGreaterThan(start);
  return viewTs.slice(start, end);
}

function standaloneApplyRegion(): string {
  const full = applyEditBody();
  const branchStart = full.indexOf("if (this.compositeAnchor) {");
  const branchEnd = full.indexOf("\n    }\n\n    // Phase 5D-0.5:", branchStart);
  return full.slice(branchEnd);
}

describe("view/PartialEditView.ts: Phase 5L-6 (Parent List Item Structured Partial Edit)", () => {
  it("declares standaloneParentListItemProjection as its own field, independent of and mutually exclusive with the four pre-existing standalone projection fields", () => {
    expect(viewTs).toContain(
      "private standaloneParentListItemProjection: ParentListItemProjection | null = null;"
    );
  });

  it("imports ParentListItemProjection/applyParentListItemOwnTextEdit/invertParentListItemProjection/projectedParentBodyText/projectedParentChecked/projectedParentNumberText from its own edit/parentListItemProjection.ts; buildParentListItemProjection and isStandaloneParentListItemEligibleForProjection now live only inside resolveStandaloneListProjections (edit/standaloneProjectionResolver.ts), imported from their own dedicated modules", () => {
    // 2026-09-22 (Phase 5L-12): view/PartialEditView.ts no longer imports
    // buildParentListItemProjection or isStandaloneParentListItemEligibleForProjection
    // directly — its own buildStandaloneParentListItemProjection wrapper
    // (the last call site for either) was deleted once every call site
    // migrated to reconcileStandaloneNodeState/resolveStandaloneListProjections;
    // see taskListPartialEditUiWiring.test.ts's own identically-updated
    // import test for the sibling rationale.
    expect(viewTs).toContain('from "../edit/parentListItemProjection"');
    expect(viewTs).toContain("ParentListItemProjection");
    expect(viewTs).toContain("applyParentListItemOwnTextEdit");
    expect(viewTs).toContain("invertParentListItemProjection");
    expect(viewTs).toContain("projectedParentBodyText");
    expect(viewTs).toContain("projectedParentChecked");
    expect(viewTs).toContain("projectedParentNumberText");
    expect(viewTs).not.toContain("buildParentListItemProjection");
    expect(viewTs).not.toContain(
      'import { isStandaloneParentListItemEligibleForProjection } from "../edit/standaloneParentListItemProjection";'
    );
    expect(resolverTs).toContain("buildParentListItemProjection");
    expect(resolverTs).toContain(
      'import { isStandaloneParentListItemEligibleForProjection } from "./standaloneParentListItemProjection";'
    );
  });

  it("declares the four read-only child-subtree preview DOM element fields, never a new editable textarea/checkbox/number control", () => {
    expect(viewTs).toContain("private parentChildPreviewEl!: HTMLElement;");
    expect(viewTs).toContain("private parentChildPreviewLabelEl!: HTMLElement;");
    expect(viewTs).toContain("private parentChildPreviewBodyEl!: HTMLElement;");
    expect(viewTs).toContain("private parentChildPreviewTruncatedEl!: HTMLElement;");
    expect(viewTs).not.toContain("parentChildEditableEl");
    expect(viewTs).not.toContain("parentChildTextareaEl");
    expect(viewTs).not.toContain("parentChildInputEl");
  });

  it("marks the child-subtree preview body aria-readonly/data-readonly; per-row click/keyboard wiring (added by Phase 5L-7) is covered separately in tests/parentChildPreviewNavigationUiWiring.test.ts", () => {
    expect(viewTs).toContain('this.parentChildPreviewBodyEl.setAttribute("aria-readonly", "true");');
    expect(viewTs).toContain('this.parentChildPreviewBodyEl.setAttribute("data-readonly", "true");');
    // Phase 5L-7 ("Read-Only Child Subtree Preview Navigation") deliberately
    // adds a click/keydown handler to a NAVIGABLE row (one with a resolvable
    // childPreviewRowTargets entry) so it can safely open that child item via
    // the pane's own pre-existing requestLoadNode guard — see this ticket's
    // own design doc. That per-row wiring, and the fact that it never adds a
    // textarea/input/checkbox/contenteditable/drag handle to a row, is
    // asserted in tests/parentChildPreviewNavigationUiWiring.test.ts instead
    // of here; this file stays scoped to what Phase 5L-6 itself introduced.
  });

  it("loadNodeInternal resolves standaloneParentListItemProjection via the shared reconcileStandaloneNodeState pipeline, only ever active once all four prior standalone-leaf projections are null (as the fifth, lowest-priority tier), with no early-return refusal path from that call through the rest of the method", () => {
    // 2026-09-22 (Phase 5L-12): see standaloneListMarkerFreePartialEditUiWiring.test.ts's
    // own identically-updated test for the full rationale. The
    // "node.childIds.length > 0 AND isStandaloneParentListItemEligibleForProjection,
    // only once all four prior projections are null" priority-order INTENT
    // now lives inside edit/standaloneProjectionResolver.ts's own
    // resolveStandaloneListProjections (re-pinned below) as the fifth and
    // final tier, rather than as a caller-side boolean expression inside
    // loadNodeInternal.
    const body = bodyOf(viewTs, "private loadNodeInternal(nodeId: string): void {", "loadNodeInternal");
    const reconcileIdx = body.indexOf(
      "this.reconcileStandaloneNodeState(doc, nodeId, node, extracted.text);"
    );
    expect(reconcileIdx).toBeGreaterThan(-1);
    const tailRegion = body.slice(reconcileIdx);
    expect(tailRegion).not.toContain("return;");
    const parentIdx = resolverTs.indexOf("const parentEligible =");
    expect(parentIdx).toBeGreaterThan(-1);
    const parentRegion = resolverTs.slice(parentIdx);
    expect(parentRegion).toContain("node.childIds.length > 0 &&");
    expect(parentRegion).toContain("isStandaloneParentListItemEligibleForProjection(doc, node)");
    expect(parentRegion).toContain("!list && !task && !ordered && !multiLine && parentEligible");
    // Ordering: the parent tier is resolved strictly AFTER the multi-line
    // leaf tier inside the resolver, confirming it is the fifth/lowest-
    // priority tier.
    const multiLineIdx = resolverTs.indexOf("const multiLineEligible =");
    expect(multiLineIdx).toBeGreaterThan(-1);
    expect(parentIdx).toBeGreaterThan(multiLineIdx);
  });

  it("resolveStandaloneListProjections' own parent branch is a thin wrapper around buildParentListItemProjection(doc, node) alone at the point it actually builds — eligibility (node.childIds.length > 0 AND isStandaloneParentListItemEligibleForProjection) is derived once, earlier, into parentEligible, never re-derived at the build call itself", () => {
    // 2026-09-22 (Phase 5L-12): view/PartialEditView.ts's own
    // buildStandaloneParentListItemProjection wrapper method was deleted
    // once every call site migrated to reconcileStandaloneNodeState — see
    // taskListPartialEditUiWiring.test.ts's own identically-updated
    // buildStandaloneListProjections test for the sibling rationale.
    expect(viewTs).not.toContain("private buildStandaloneParentListItemProjection(");
    const parentIdx = resolverTs.indexOf("const parent =");
    expect(parentIdx).toBeGreaterThan(-1);
    const buildRegion = resolverTs.slice(parentIdx);
    expect(buildRegion).toContain("buildParentListItemProjection(doc, node)");
    expect(buildRegion).toContain("built.ok ? built.projection : null");
    const buildCallIdx = buildRegion.indexOf("buildParentListItemProjection(doc, node)");
    const afterBuildCall = buildRegion.slice(buildCallIdx);
    expect(afterBuildCall.indexOf("isStandaloneParentListItemEligibleForProjection")).toBe(-1);
  });

  it("currentDisplayText() falls back to standaloneParentListItemProjection's projected OWN-TEXT body (never the child subtree) — after all four prior projections but before raw originalText, the LAST branch in this method", () => {
    const body = bodyOf(viewTs, "private currentDisplayText(): string {", "currentDisplayText()");
    const multiLineIdx = body.indexOf(
      "if (this.standaloneMultiLineListProjection) {\n      return projectedMultiLineBodyText(this.standaloneMultiLineListProjection);\n    }"
    );
    const parentIdx = body.indexOf(
      "if (this.standaloneParentListItemProjection) {\n      return projectedParentBodyText(this.standaloneParentListItemProjection);\n    }"
    );
    const rawIdx = body.indexOf("return this.originalText;");
    expect(multiLineIdx).toBeGreaterThan(-1);
    expect(parentIdx).toBeGreaterThan(multiLineIdx);
    expect(rawIdx).toBeGreaterThan(parentIdx);
  });

  it("renderParentChildPreview is called from BOTH renderLoadedState and renderEmptyState, right alongside renderOrderedNumberRow — so a fresh load/clear always reconciles the preview's own visibility", () => {
    expect(viewTs).toContain("private renderParentChildPreview(): void {");
    const occurrences = viewTs.split("this.renderParentChildPreview();").length - 1;
    // renderLoadedState, renderEmptyState, the parent rebuild branch of
    // applyEdit, and performAutoReload's own tail — four call sites.
    expect(occurrences).toBeGreaterThanOrEqual(4);
  });

  it("renderTaskCheckboxRow ALSO activates for a parent item whose own-text's first line is a task line, reusing the SAME checkbox control the single-line/multi-line task cases already own", () => {
    const body = bodyOf(viewTs, "private renderTaskCheckboxRow(): void {", "renderTaskCheckboxRow");
    expect(body).toContain(
      'const parentTaskActive = this.standaloneParentListItemProjection?.ownText.listKind === "task";'
    );
    expect(body).toContain(
      "const active = this.standaloneTaskListProjection !== null || multiLineTaskActive || parentTaskActive;"
    );
    expect(body).toContain("projectedParentChecked(this.standaloneParentListItemProjection!)");
  });

  it("renderOrderedNumberRow ALSO activates for a parent item whose own-text's first line is an ordered line, reusing the SAME number control", () => {
    const body = bodyOf(viewTs, "private renderOrderedNumberRow(): void {", "renderOrderedNumberRow");
    expect(body).toContain(
      'const parentOrderedActive = this.standaloneParentListItemProjection?.ownText.listKind === "ordered";'
    );
    expect(body).toContain(
      "this.standaloneOrderedListProjection !== null || multiLineOrderedActive || parentOrderedActive;"
    );
    expect(body).toContain("projectedParentNumberText(this.standaloneParentListItemProjection!)");
  });

  it("isDirty() ALSO considers the checkbox/number controls dirty against a parent projection's own checked/number, and folds both new flags into the top-level dirty expression — the read-only child preview never participates in dirty tracking", () => {
    const body = bodyOf(viewTs, "private isDirty(): boolean {", "isDirty");
    expect(body).toContain("const parentTaskCheckedDirty =");
    expect(body).toContain(
      'this.standaloneParentListItemProjection?.ownText.listKind === "task" &&\n' +
        "      this.taskCheckboxInputEl.checked !== projectedParentChecked(this.standaloneParentListItemProjection);"
    );
    expect(body).toContain("const parentNumberDirty =");
    expect(body).toContain(
      'this.standaloneParentListItemProjection?.ownText.listKind === "ordered" &&\n' +
        "      this.orderedNumberInputEl.value !== projectedParentNumberText(this.standaloneParentListItemProjection);"
    );
    expect(body).toContain("parentTaskCheckedDirty ||\n        parentNumberDirty");
  });

  it("cancelEdit() reverts the checkbox/number controls back to the loaded parent projection's own checked/number when its ownText.listKind is task/ordered respectively", () => {
    const body = bodyOf(viewTs, "private cancelEdit(): void {", "cancelEdit");
    expect(body).toContain('if (this.standaloneParentListItemProjection?.ownText.listKind === "task") {');
    expect(body).toContain(
      "this.taskCheckboxInputEl.checked = projectedParentChecked(this.standaloneParentListItemProjection);"
    );
    expect(body).toContain('if (this.standaloneParentListItemProjection?.ownText.listKind === "ordered") {');
    expect(body).toContain(
      "this.orderedNumberInputEl.value = projectedParentNumberText(this.standaloneParentListItemProjection);"
    );
  });

  it("resetLoadedState/loadParagraphInternal/loadCompositeInternal all reset standaloneParentListItemProjection to null — a paragraph or CompositeBlock session can never inherit a stale standalone parent projection", () => {
    const resetBody = bodyOf(viewTs, "private resetLoadedState(): void {", "resetLoadedState");
    const paragraphBody = bodyOf(viewTs, "private loadParagraphInternal(", "loadParagraphInternal");
    const compositeBody = bodyOf(viewTs, "private loadCompositeInternal(", "loadCompositeInternal");
    expect(resetBody).toContain("this.standaloneParentListItemProjection = null;");
    expect(paragraphBody).toContain("this.standaloneParentListItemProjection = null;");
    expect(compositeBody).toContain("this.standaloneParentListItemProjection = null;");
  });

  it("applyEdit's parent branch inverts via invertParentListItemProjection with the checkbox's current .checked, the number input's current text, AND the textarea's current own-text body, and refuses with orderedNumberInvalid/parentOwnTextStructureInvalid/parentChildSubtreeStructureInvalid on the three respective rejection reasons", () => {
    const region = standaloneApplyRegion();
    expect(region).toContain("} else if (this.standaloneParentListItemProjection) {");
    expect(region).toContain(
      "const invertedParent = invertParentListItemProjection(\n        this.standaloneParentListItemProjection,\n        this.taskCheckboxInputEl.checked,\n        this.orderedNumberInputEl.value,\n        this.textareaEl.value\n      );"
    );
    expect(region).toContain("if (!invertedParent.ok) {");
    expect(region).toContain('invertedParent.reason === "invalid-number"');
    expect(region).toContain('"partialEdit.orderedNumberInvalid"');
    expect(region).toContain('invertedParent.reason === "own-text-unsafe-structure"');
    expect(region).toContain('"partialEdit.parentOwnTextStructureInvalid"');
    expect(region).toContain('"partialEdit.parentChildSubtreeStructureInvalid"');
    expect(region).toContain("newRawText = invertedParent.ownTextRawText;");
    const invertIdx = region.indexOf("invertParentListItemProjection(");
    const outcomeIdx = region.indexOf("const outcome = this.standaloneParentListItemProjection");
    expect(invertIdx).toBeGreaterThan(-1);
    expect(outcomeIdx).toBeGreaterThan(invertIdx);
  });

  it("the parent branch is the LAST arm in the standalone-node if/else-if chain, mutually exclusive with all four prior single-line/multi-line branches and with the quote/CompositeBlock branches above them", () => {
    const region = standaloneApplyRegion();
    const multiLineIdx = region.indexOf("} else if (this.standaloneMultiLineListProjection) {");
    const parentIdx = region.indexOf("} else if (this.standaloneParentListItemProjection) {");
    expect(multiLineIdx).toBeGreaterThan(-1);
    expect(parentIdx).toBeGreaterThan(multiLineIdx);
  });

  it("the outcome computation branches to applyParentListItemOwnTextEdit for the parent kind — deliberately NOT the generic applySubtreeEdit every other kind uses, since applySubtreeEdit's own whole-subtree conflict check would spuriously refuse this Apply the moment the child subtree alone changes", () => {
    const region = standaloneApplyRegion();
    expect(region).toContain(
      "const outcome = this.standaloneParentListItemProjection\n      ? applyParentListItemOwnTextEdit(\n          doc,\n          this.nodeId!,\n          this.standaloneParentListItemProjection.ownText.rawText,\n          newRawText\n        )\n      : applySubtreeEdit(doc, this.nodeId!, this.originalText, newRawText);"
    );
  });

  it("after a successful Apply, originalText re-anchors to newRawText, then is OVERRIDDEN for the parent kind to newRawText + the PRE-apply projection's own childSubtreeText — reconstructing the full-subtree snapshot the existing whole-subtree staleness comparison still expects", () => {
    const region = standaloneApplyRegion();
    // The literal unconditional assignment must still appear verbatim —
    // regression guard for the exact bug this ticket's own real-device
    // follow-up fixed (a conditional expression here previously broke
    // tests/quotePrefixPartialEditViewWiring.test.ts's own static check for
    // this exact non-parent-kind literal).
    expect(region).toContain("this.originalText = newRawText;");
    expect(region).toContain("if (this.standaloneParentListItemProjection) {");
    expect(region).toContain(
      "this.originalText = newRawText + \"\\n\" + this.standaloneParentListItemProjection.childSubtreeText;"
    );
    const reanchorIdx = region.indexOf("this.originalText = newRawText;");
    const overrideIdx = region.indexOf(
      "this.originalText = newRawText + \"\\n\" + this.standaloneParentListItemProjection.childSubtreeText;"
    );
    expect(reanchorIdx).toBeGreaterThan(-1);
    expect(overrideIdx).toBeGreaterThan(reanchorIdx);
  });

  it("after a successful Apply, rebuilds EVERY standalone tier (not just the parent one) fresh from a re-parsed ParsedDocument via the shared reconcileStandaloneNodeState — never just newRawText in isolation — re-syncs the textarea, checkbox row, number row, AND the child preview", () => {
    // 2026-09-22 (Phase 5L-12): this own-text-only Apply path can never
    // actually change childIds.length (it never touches the child subtree
    // at all — see reconcileStandaloneNodeState's call site's own doc
    // comment), so in practice this remains exactly equivalent to the
    // prior narrow "only ever re-verify standaloneParentListItemProjection"
    // rebuild; the difference is that it is no longer a fourth independent
    // copy of the eligibility-check/builder-call sequence, and — since
    // reconcileStandaloneNodeState always resolves all five tiers — a
    // hypothetical future path through this branch that DID remove the
    // last child would correctly fall through to a leaf projection instead
    // of stranding the pane, exactly like the two genuine parent->leaf
    // Apply sites (applyParentChildAddDeleteCombinedEdit,
    // applyParentChildIndentOutdentEdit) this phase fixed.
    const region = standaloneApplyRegion();
    const rebuildIdx = region.indexOf("} else if (this.standaloneParentListItemProjection) {");
    expect(rebuildIdx).toBeGreaterThan(-1);
    const rebuildRegion = region.slice(rebuildIdx);
    expect(rebuildRegion).toContain("const freshDoc = parseDocument(editor.getValue());");
    expect(rebuildRegion).toContain("const freshNode = freshDoc.nodes.get(this.nodeId!);");
    expect(rebuildRegion).toContain("const freshExtracted = extractSubtreeText(freshDoc, this.nodeId!);");
    expect(rebuildRegion).toContain(
      "this.reconcileStandaloneNodeState(\n" +
        "          freshDoc,\n" +
        "          this.nodeId!,\n" +
        "          freshNode,\n" +
        "          freshExtracted.ok ? freshExtracted.text : \"\"\n" +
        "        );"
    );
    expect(rebuildRegion).toContain("this.textareaEl.value = this.currentDisplayText();");
    expect(rebuildRegion).toContain("this.renderTaskCheckboxRow();");
    expect(rebuildRegion).toContain("this.renderOrderedNumberRow();");
    expect(rebuildRegion).toContain("this.renderParentChildPreview();");
  });

  it("performAutoReload unconditionally (RE-)DISCOVERS standaloneParentListItemProjection via reconcileStandaloneNodeState whenever this.nodeId is set — no longer gated on \"was a parent projection ALREADY active before the reload\" — re-deriving eligibility fresh from the reloaded doc.nodes; this widening is the exact real-device bug fix this phase makes (a node reloading from a real parent down to a genuine childless leaf, or vice versa, now always gets its NEW tier freshly discovered)", () => {
    // 2026-09-22 (Phase 5L-12, bug fix): the OLD gate this test originally
    // pinned down (`if (this.nodeId && this.standaloneParentListItemProjection)`)
    // could only ever RE-VERIFY a parent projection that was already
    // active — it could never newly DISCOVER one, and, symmetrically,
    // could never notice a parent that had just reverted to a leaf (Phase
    // 5L-9b's own Bug #2). See performAutoReload's own doc comment and
    // standaloneListMarkerFreePartialEditUiWiring.test.ts's own
    // identically-updated performAutoReload test for the full rationale.
    const body = bodyOf(viewTs, "private performAutoReload(", "performAutoReload");
    expect(body).not.toContain("if (this.nodeId && this.standaloneParentListItemProjection) {");
    expect(body).toContain(
      "if (this.nodeId) {\n" +
        "      const reloadedNode = doc.nodes.get(this.nodeId);\n" +
        "      this.reconcileStandaloneNodeState(doc, this.nodeId, reloadedNode, newText);\n" +
        "    }"
    );
    expect(body).not.toContain("this.buildStandaloneParentListItemProjection(");
    expect(resolverTs).toContain("isStandaloneParentListItemEligibleForProjection(doc, node)");
    expect(body).toContain("this.renderParentChildPreview();");
  });

  it("i18n.ts declares partialEdit.parentOwnTextStructureInvalid, partialEdit.parentChildSubtreeStructureInvalid, partialEdit.parentChildPreviewLabel, partialEdit.parentChildPreviewTruncated, reason.parent-own-text-range-unresolvable, and reason.parent-own-text-conflict in both the en and ja dictionaries", () => {
    const i18nTs = readFileSync(path.resolve(__dirname, "../src/i18n.ts"), "utf-8");
    const keys = [
      '"partialEdit.parentOwnTextStructureInvalid"',
      '"partialEdit.parentChildSubtreeStructureInvalid"',
      '"partialEdit.parentChildPreviewLabel"',
      '"partialEdit.parentChildPreviewTruncated"',
      '"reason.parent-own-text-range-unresolvable"',
      '"reason.parent-own-text-conflict"',
    ];
    for (const key of keys) {
      const occurrences = i18nTs.split(key).length - 1;
      expect(occurrences, `${key} should appear in both en and ja dictionaries`).toBeGreaterThanOrEqual(2);
    }
  });

  it("styles.css declares the parent-child-preview CSS classes this View creates, including the layout-space `[style*=\"visibility: hidden\"]` fix every other individually-toggled row already needs", () => {
    const stylesCss = readFileSync(path.resolve(__dirname, "../styles.css"), "utf-8");
    expect(stylesCss).toContain(".unified-outliner-partial-edit-parent-child-preview {");
    expect(stylesCss).toContain(".unified-outliner-partial-edit-parent-child-preview-label {");
    expect(stylesCss).toContain(".unified-outliner-partial-edit-parent-child-preview-body {");
    expect(stylesCss).toContain(".unified-outliner-partial-edit-parent-child-preview-row {");
    expect(stylesCss).toContain(".unified-outliner-partial-edit-parent-child-preview-truncated {");
    expect(stylesCss).toContain('.unified-outliner-partial-edit-parent-child-preview[style*="visibility: hidden"]');
    expect(stylesCss).toContain(
      '.unified-outliner-partial-edit-parent-child-preview-truncated[style*="visibility: hidden"]'
    );
  });

  it("never introduces child add/delete/move/reorder controls, marker-type-change, or sibling-renumbering anywhere in the parent branch — this ticket's own explicit non-goals", () => {
    const region = standaloneApplyRegion();
    const branchIdx = region.indexOf("} else if (this.standaloneParentListItemProjection) {");
    const branchEnd = region.indexOf("newRawText = invertedParent.ownTextRawText;", branchIdx);
    const branchRegion = region.slice(branchIdx, branchEnd);
    expect(branchRegion).not.toContain("renumber");
    expect(branchRegion).not.toContain("deleteChild");
    expect(branchRegion).not.toContain("moveChild");
    expect(branchRegion).not.toContain("reorderChild");
    expect(branchRegion).not.toContain("addChild");
  });
});
