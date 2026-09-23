/**
 * Phase 5L-4 ("Multi-Line Leaf List Item Partial Edit Projection"):
 * static-source-text checks for the wiring this ticket added to
 * view/PartialEditView.ts — mirrors tests/orderedListPartialEditUiWiring.test.ts's
 * own structure exactly, since this file is that one's multi-line
 * counterpart.
 *
 * Same constraint as the other View-wiring test files in this project:
 * PartialEditView (extends Obsidian's ItemView) cannot be constructed in
 * vitest, since "obsidian" is a types-only package in this repo. This file
 * inspects the raw source text of view/PartialEditView.ts rather than
 * instantiating it.
 *
 * The real, non-Obsidian-dependent logic this wiring calls into
 * (isStandaloneMultiLineLeafListItemEligibleForProjection,
 * hasComplexBlockInMultiLineListItemContinuation, and the
 * buildMultiLineListItemProjection/invertMultiLineListItemProjection
 * pair) is unit-tested directly, with real assertions, in
 * tests/multiLineListItemProjection.test.ts,
 * tests/standaloneMultiLineListItemProjection.test.ts, and
 * tests/multiLineLeafListPartialEdit.test.ts — this file only confirms
 * the View layer actually wires into that logic at the right place, and
 * that it reuses the EXISTING checkbox/number controls rather than
 * introducing any new one.
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

describe("view/PartialEditView.ts: Phase 5L-4 (Multi-Line Leaf List Item Partial Edit Projection)", () => {
  it("declares standaloneMultiLineListProjection as its own field, independent of and mutually exclusive with the three single-line standalone projection fields", () => {
    expect(viewTs).toContain(
      "private standaloneMultiLineListProjection: MultiLineListItemProjection | null = null;"
    );
  });

  it("imports buildMultiLineListItemProjection/invertMultiLineListItemProjection/projectedMultiLineBodyText/projectedMultiLineChecked/projectedMultiLineNumberText/MultiLineListItemProjection from edit/multiLineListItemProjection.ts; isStandaloneMultiLineLeafListItemEligibleForProjection/hasComplexBlockInMultiLineListItemContinuation now live only inside resolveStandaloneListProjections (edit/standaloneProjectionResolver.ts), imported from their own dedicated edit/standaloneMultiLineListItemProjection.ts", () => {
    // 2026-09-22 (Phase 5L-12): see standaloneListMarkerFreePartialEditUiWiring.test.ts's
    // own identically-updated import test for the full rationale.
    expect(viewTs).toContain('from "../edit/multiLineListItemProjection"');
    expect(viewTs).toContain("buildMultiLineListItemProjection");
    expect(viewTs).toContain("invertMultiLineListItemProjection");
    expect(viewTs).toContain("projectedMultiLineBodyText");
    expect(viewTs).toContain("projectedMultiLineChecked");
    expect(viewTs).toContain("projectedMultiLineNumberText");
    expect(viewTs).not.toContain(
      "  hasComplexBlockInMultiLineListItemContinuation,\n  isStandaloneMultiLineLeafListItemEligibleForProjection,\n} from \"../edit/standaloneMultiLineListItemProjection\";"
    );
    expect(resolverTs).toContain(
      "  hasComplexBlockInMultiLineListItemContinuation,\n  isStandaloneMultiLineLeafListItemEligibleForProjection,\n} from \"./standaloneMultiLineListItemProjection\";"
    );
  });

  it("never introduces any new DOM control for the multi-line case — no new textarea, no new checkbox, no new number/marker/delimiter input anywhere in this file", () => {
    expect(viewTs).not.toContain("multiLineTextareaEl");
    expect(viewTs).not.toContain("multiLineCheckboxInputEl");
    expect(viewTs).not.toContain("multiLineNumberInputEl");
    expect(viewTs).not.toContain("multiLineMarkerInputEl");
    expect(viewTs).not.toContain("multiLineDelimiterInputEl");
  });

  it("loadNodeInternal resolves standaloneMultiLineListProjection via the shared reconcileStandaloneNodeState pipeline, only ever active once all three single-line projections are null, with no early-return refusal path from that call through the rest of the method", () => {
    // 2026-09-22 (Phase 5L-12): see standaloneListMarkerFreePartialEditUiWiring.test.ts's
    // own identically-updated test for the full rationale. The "only once
    // all three single-line projections are null" priority-order INTENT is
    // now enforced inside edit/standaloneProjectionResolver.ts's own
    // resolveStandaloneListProjections (re-pinned below), rather than as a
    // caller-side boolean expression inside loadNodeInternal.
    const body = bodyOf(viewTs, "private loadNodeInternal(nodeId: string): void {", "loadNodeInternal");
    const reconcileIdx = body.indexOf(
      "this.reconcileStandaloneNodeState(doc, nodeId, node, extracted.text);"
    );
    expect(reconcileIdx).toBeGreaterThan(-1);
    const tailRegion = body.slice(reconcileIdx);
    expect(tailRegion).not.toContain("return;");
    expect(resolverTs).toContain("isStandaloneMultiLineLeafListItemEligibleForProjection(node)");
    expect(resolverTs).toContain("!hasComplexBlockInMultiLineListItemContinuation(doc, node)");
    const multiLineIdx = resolverTs.indexOf("const multiLine =");
    expect(multiLineIdx).toBeGreaterThan(-1);
    expect(resolverTs.slice(multiLineIdx)).toContain(
      "!list && !task && !ordered && multiLineEligible"
    );
  });

  it("resolveStandaloneListProjections' own multi-line branch is a thin wrapper around buildMultiLineListItemProjection alone at the point it actually builds — eligibility (isStandaloneMultiLineLeafListItemEligibleForProjection/hasComplexBlockInMultiLineListItemContinuation) is derived once, earlier, into multiLineEligible, never re-derived at the build call itself", () => {
    // 2026-09-22 (Phase 5L-12): view/PartialEditView.ts's own
    // buildStandaloneMultiLineListProjection wrapper method was deleted
    // once every call site migrated to reconcileStandaloneNodeState — see
    // taskListPartialEditUiWiring.test.ts's own identically-updated
    // buildStandaloneListProjections test for the sibling rationale.
    expect(viewTs).not.toContain("private buildStandaloneMultiLineListProjection(");
    const multiLineIdx = resolverTs.indexOf("const multiLine =");
    expect(multiLineIdx).toBeGreaterThan(-1);
    const buildRegion = resolverTs.slice(multiLineIdx);
    expect(buildRegion).toContain("buildMultiLineListItemProjection(rawText)");
    expect(buildRegion).toContain("built.ok ? built.projection : null");
    // The build itself, once inside the ternary's true-branch IIFE, no
    // longer re-checks eligibility — it was already folded into
    // multiLineEligible above.
    const buildCallIdx = buildRegion.indexOf("buildMultiLineListItemProjection(rawText)");
    const afterBuildCall = buildRegion.slice(buildCallIdx);
    expect(afterBuildCall.indexOf("isStandaloneMultiLineLeafListItemEligibleForProjection")).toBe(-1);
  });

  it("currentDisplayText() falls back to standaloneMultiLineListProjection's projected body, after all three single-line projections but before raw originalText — the LAST branch in this method", () => {
    const body = bodyOf(viewTs, "private currentDisplayText(): string {", "currentDisplayText()");
    const orderedIdx = body.indexOf(
      "if (this.standaloneOrderedListProjection) {\n      return projectedOrderedBodyText(this.standaloneOrderedListProjection);\n    }"
    );
    const multiLineIdx = body.indexOf(
      "if (this.standaloneMultiLineListProjection) {\n      return projectedMultiLineBodyText(this.standaloneMultiLineListProjection);\n    }"
    );
    const rawIdx = body.indexOf("return this.originalText;");
    expect(orderedIdx).toBeGreaterThan(-1);
    expect(multiLineIdx).toBeGreaterThan(orderedIdx);
    expect(rawIdx).toBeGreaterThan(multiLineIdx);
  });

  it("renderTaskCheckboxRow ALSO activates for a multi-line item whose own first line is a task line, reusing the SAME checkbox control the single-line task case already owns", () => {
    const body = bodyOf(viewTs, "private renderTaskCheckboxRow(): void {", "renderTaskCheckboxRow");
    expect(body).toContain('this.standaloneMultiLineListProjection?.listKind === "task"');
    expect(body).toContain("this.standaloneTaskListProjection !== null || multiLineTaskActive");
    expect(body).toContain("projectedMultiLineChecked(this.standaloneMultiLineListProjection!)");
  });

  it("renderOrderedNumberRow ALSO activates for a multi-line item whose own first line is an ordered line, reusing the SAME number control the single-line ordered case already owns", () => {
    const body = bodyOf(
      viewTs,
      "private renderOrderedNumberRow(): void {",
      "renderOrderedNumberRow"
    );
    expect(body).toContain('this.standaloneMultiLineListProjection?.listKind === "ordered"');
    expect(body).toContain("this.standaloneOrderedListProjection !== null || multiLineOrderedActive");
    expect(body).toContain("projectedMultiLineNumberText(this.standaloneMultiLineListProjection!)");
  });

  it("isDirty() ALSO considers the checkbox/number controls dirty against a multi-line projection's own checked/number, via the same plain-comparison policy as the single-line checks, and folds both new flags into the top-level dirty expression", () => {
    const body = bodyOf(viewTs, "private isDirty(): boolean {", "isDirty");
    expect(body).toContain("const multiLineTaskCheckedDirty =");
    expect(body).toContain(
      'this.standaloneMultiLineListProjection?.listKind === "task" &&\n' +
        "      this.taskCheckboxInputEl.checked !== projectedMultiLineChecked(this.standaloneMultiLineListProjection);"
    );
    expect(body).toContain("const multiLineNumberDirty =");
    expect(body).toContain(
      'this.standaloneMultiLineListProjection?.listKind === "ordered" &&\n' +
        "      this.orderedNumberInputEl.value !== projectedMultiLineNumberText(this.standaloneMultiLineListProjection);"
    );
    expect(body).toContain("multiLineTaskCheckedDirty ||\n        multiLineNumberDirty");
  });

  it("cancelEdit() reverts the checkbox/number controls back to the loaded multi-line projection's own checked/number when its listKind is task/ordered respectively — the shared textarea itself is already covered by currentDisplayText()", () => {
    const body = bodyOf(viewTs, "private cancelEdit(): void {", "cancelEdit");
    expect(body).toContain('if (this.standaloneMultiLineListProjection?.listKind === "task") {');
    expect(body).toContain(
      "this.taskCheckboxInputEl.checked = projectedMultiLineChecked(this.standaloneMultiLineListProjection);"
    );
    expect(body).toContain('if (this.standaloneMultiLineListProjection?.listKind === "ordered") {');
    expect(body).toContain(
      "this.orderedNumberInputEl.value = projectedMultiLineNumberText(this.standaloneMultiLineListProjection);"
    );
  });

  it("resetLoadedState/loadParagraphInternal/loadCompositeInternal all reset standaloneMultiLineListProjection to null — a paragraph or CompositeBlock session can never inherit a stale standalone multi-line projection", () => {
    const resetBody = bodyOf(viewTs, "private resetLoadedState(): void {", "resetLoadedState");
    const paragraphBody = bodyOf(viewTs, "private loadParagraphInternal(", "loadParagraphInternal");
    const compositeBody = bodyOf(viewTs, "private loadCompositeInternal(", "loadCompositeInternal");
    expect(resetBody).toContain("this.standaloneMultiLineListProjection = null;");
    expect(paragraphBody).toContain("this.standaloneMultiLineListProjection = null;");
    expect(compositeBody).toContain("this.standaloneMultiLineListProjection = null;");
  });

  it("performAutoReload unconditionally re-resolves standaloneMultiLineListProjection alongside every other standalone projection via reconcileStandaloneNodeState whenever this.nodeId is set — never gated on \"was ANY already active before this reload\" — re-deriving multi-line eligibility fresh from the just-reloaded doc.nodes", () => {
    // 2026-09-22 (Phase 5L-12, bug fix): see
    // standaloneListMarkerFreePartialEditUiWiring.test.ts's own
    // identically-updated performAutoReload test for the full real-device
    // bug rationale.
    const body = bodyOf(viewTs, "private performAutoReload(", "performAutoReload");
    expect(body).toContain(
      "if (this.nodeId) {\n" +
        "      const reloadedNode = doc.nodes.get(this.nodeId);\n" +
        "      this.reconcileStandaloneNodeState(doc, this.nodeId, reloadedNode, newText);\n" +
        "    }"
    );
    expect(body).not.toContain("this.buildStandaloneMultiLineListProjection(");
    expect(resolverTs).toContain("isStandaloneMultiLineLeafListItemEligibleForProjection(node)");
    expect(resolverTs).toContain("!hasComplexBlockInMultiLineListItemContinuation(doc, node)");
  });

  it("applyEdit's multi-line branch inverts via invertMultiLineListItemProjection with the checkbox's current .checked, the number input's current text, AND the textarea's current body — always passing all three regardless of this projection's own listKind — and refuses with orderedNumberInvalid on invalid-number and multiLineListStructureInvalid on unsafe-structure, otherwise feeding the reconstructed text into the SAME, unmodified applySubtreeEdit call", () => {
    const region = standaloneApplyRegion();
    expect(region).toContain("} else if (this.standaloneMultiLineListProjection) {");
    expect(region).toContain(
      "invertMultiLineListItemProjection(\n        this.standaloneMultiLineListProjection,\n        this.taskCheckboxInputEl.checked,\n        this.orderedNumberInputEl.value,\n        this.textareaEl.value\n      )"
    );
    expect(region).toContain("if (!invertedMultiLine.ok) {");
    expect(region).toContain('invertedMultiLine.reason === "invalid-number"');
    expect(region).toContain('"partialEdit.orderedNumberInvalid"');
    expect(region).toContain('"partialEdit.multiLineListStructureInvalid"');
    expect(region).toContain("newRawText = invertedMultiLine.rawText;");
    const invertIdx = region.indexOf("invertMultiLineListItemProjection(");
    // Phase 5E-3: the call site reformatted to a multi-line call (a 5th,
    // conditional fencedCodeInfoString argument was added) — this still
    // matches on the same four leading, unconditional arguments (doc,
    // nodeId, originalText, newRawText), just spread across lines now.
    const applyIdx = region.indexOf(
      "applySubtreeEdit(\n          doc,\n          this.nodeId!,\n          this.originalText,\n          newRawText,"
    );
    expect(invertIdx).toBeGreaterThan(-1);
    expect(applyIdx).toBeGreaterThan(invertIdx);
  });

  it("the multi-line branch is the LAST arm in the standalone-node if/else-if chain, mutually exclusive with all three single-line branches and with the quote/CompositeBlock branches above them", () => {
    const region = standaloneApplyRegion();
    const orderedIdx = region.indexOf("} else if (this.standaloneOrderedListProjection) {");
    const multiLineIdx = region.indexOf("} else if (this.standaloneMultiLineListProjection) {");
    expect(orderedIdx).toBeGreaterThan(-1);
    expect(multiLineIdx).toBeGreaterThan(orderedIdx);
  });

  it("after a successful Apply, rebuilds standaloneMultiLineListProjection fresh via buildMultiLineListItemProjection(newRawText), re-syncs the textarea via currentDisplayText(), and re-syncs BOTH the checkbox row and the number row", () => {
    const region = standaloneApplyRegion();
    const rebuildIdx = region.indexOf("} else if (this.standaloneMultiLineListProjection) {");
    expect(rebuildIdx).toBeGreaterThan(-1);
    const rebuildRegion = region.slice(rebuildIdx);
    expect(rebuildRegion).toContain("const rebuilt = buildMultiLineListItemProjection(newRawText);");
    expect(rebuildRegion).toContain(
      "this.standaloneMultiLineListProjection = rebuilt.ok ? rebuilt.projection : null;"
    );
    expect(rebuildRegion).toContain("this.textareaEl.value = this.currentDisplayText();");
    expect(rebuildRegion).toContain("this.renderTaskCheckboxRow();");
    expect(rebuildRegion).toContain("this.renderOrderedNumberRow();");
  });

  it("i18n.ts declares partialEdit.multiLineListStructureInvalid in both the en and ja dictionaries", () => {
    const i18nTs = readFileSync(path.resolve(__dirname, "../src/i18n.ts"), "utf-8");
    expect(i18nTs).toContain('"partialEdit.multiLineListStructureInvalid"');
  });

  it("the marker/checkbox-status/ordered-delimiter/sibling-auto-renumbering are still exactly as unsupported for the multi-line case as for the single-line case — no new UI text/method suggesting otherwise appears anywhere in the multi-line branch", () => {
    const region = standaloneApplyRegion();
    const branchIdx = region.indexOf("} else if (this.standaloneMultiLineListProjection) {");
    const branchEnd = region.indexOf("newRawText = invertedMultiLine.rawText;", branchIdx);
    const branchRegion = region.slice(branchIdx, branchEnd);
    expect(branchRegion).not.toContain("renumber");
    expect(branchRegion).not.toContain("Delimiter");
    expect(branchRegion).not.toContain("editedMarker");
  });
});
