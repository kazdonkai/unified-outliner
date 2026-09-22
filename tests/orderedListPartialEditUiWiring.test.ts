/**
 * Phase 5L-3 ("Ordered List Marker-Free Partial Edit"): static-source-text
 * checks for the wiring this ticket added to view/PartialEditView.ts —
 * mirrors tests/taskListPartialEditUiWiring.test.ts's own structure
 * exactly, since this file is that one's ordered-list counterpart.
 *
 * Same constraint as the other View-wiring test files in this project:
 * PartialEditView (extends Obsidian's ItemView) cannot be constructed in
 * vitest, since "obsidian" is a types-only package in this repo. This file
 * inspects the raw source text of view/PartialEditView.ts rather than
 * instantiating it.
 *
 * The real, non-Obsidian-dependent logic this wiring calls into
 * (isStandaloneOrderedListItemEligibleForMarkerFreeProjection, and the
 * buildOrderedListProjection/invertOrderedListProjection pair) is
 * unit-tested directly, with real assertions, in
 * tests/orderedListProjection.test.ts,
 * tests/standaloneOrderedListProjection.test.ts, and
 * tests/orderedListMarkerPartialEdit.test.ts — this file only confirms
 * the View layer actually wires into that logic at the right place.
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

describe("view/PartialEditView.ts: Phase 5L-3 (Ordered List Marker-Free Partial Edit)", () => {
  it("declares standaloneOrderedListProjection as its own field, independent of the non-task standaloneListMarkerProjection field, the standaloneTaskListProjection field, and the CompositeBlock-only listMarkerProjection field", () => {
    expect(viewTs).toContain(
      "private standaloneOrderedListProjection: OrderedListProjection | null = null;"
    );
  });

  it("imports buildOrderedListProjection/invertOrderedListProjection/isValidOrderedListNumberText/projectedOrderedBodyText/projectedOrderedNumberText/OrderedListProjection from edit/orderedListProjection.ts; isStandaloneOrderedListItemEligibleForMarkerFreeProjection now lives only inside resolveStandaloneListProjections (edit/standaloneProjectionResolver.ts), imported from its own dedicated edit/standaloneOrderedListProjection.ts — never merged into the CompositeBlock-only compositeBlockMemberProjection.ts gate, nor into edit/listMarkerProjection.ts/edit/taskListProjection.ts", () => {
    // 2026-09-22 (Phase 5L-12): see standaloneListMarkerFreePartialEditUiWiring.test.ts's
    // own identically-updated import test for the full rationale.
    expect(viewTs).toContain('from "../edit/orderedListProjection"');
    expect(viewTs).toContain("buildOrderedListProjection");
    expect(viewTs).toContain("invertOrderedListProjection");
    expect(viewTs).toContain("isValidOrderedListNumberText");
    expect(viewTs).toContain("projectedOrderedBodyText");
    expect(viewTs).toContain("projectedOrderedNumberText");
    expect(viewTs).not.toContain(
      'import { isStandaloneOrderedListItemEligibleForMarkerFreeProjection } from "../edit/standaloneOrderedListProjection";'
    );
    expect(resolverTs).toContain(
      'import { isStandaloneOrderedListItemEligibleForMarkerFreeProjection } from "./standaloneOrderedListProjection";'
    );
  });

  it("declares a dedicated orderedNumberRowEl/orderedNumberInputEl pair, distinct from the CompositeBlock-only compositeListRowEl/compositeListInputEl pair and from the task-list taskCheckboxRowEl/taskCheckboxInputEl pair", () => {
    expect(viewTs).toContain("private orderedNumberRowEl!: HTMLElement;");
    expect(viewTs).toContain("private orderedNumberInputEl!: HTMLInputElement;");
  });

  it("the number input is created as type=\"text\" (deliberately NOT type=\"number\" — see edit/orderedListProjection.ts's own top doc comment's \"The number field\" section for why Apply-time validation must never rely on browser-side number-input behavior alone), wired to updateDirtyState on input, and never re-parses/replaces the shared textareaEl", () => {
    const idx = viewTs.indexOf("this.orderedNumberRowEl = this.contentEl.createDiv({");
    expect(idx).toBeGreaterThan(-1);
    const region = viewTs.slice(idx, idx + 1200);
    expect(region).toContain('type: "text"');
    expect(region).not.toContain('type: "number"');
    expect(region).toContain(
      'this.orderedNumberInputEl.addEventListener("input", () => this.updateDirtyState());'
    );
  });

  it("loadNodeInternal resolves standaloneOrderedListProjection via the shared reconcileStandaloneNodeState pipeline, with no early-return refusal path from that call through the rest of the method", () => {
    // 2026-09-22 (Phase 5L-12): see standaloneListMarkerFreePartialEditUiWiring.test.ts's
    // own identically-updated test for the full rationale.
    const body = bodyOf(viewTs, "private loadNodeInternal(nodeId: string): void {", "loadNodeInternal");
    const reconcileIdx = body.indexOf(
      "this.reconcileStandaloneNodeState(doc, nodeId, node, extracted.text);"
    );
    expect(reconcileIdx).toBeGreaterThan(-1);
    const tailRegion = body.slice(reconcileIdx);
    expect(tailRegion).not.toContain("return;");
    expect(resolverTs).toContain("isStandaloneTaskListItemEligibleForMarkerFreeProjection(node)");
    expect(resolverTs).toContain("isStandaloneOrderedListItemEligibleForMarkerFreeProjection(node)");
  });

  it("resolveStandaloneListProjections (edit/standaloneProjectionResolver.ts) tries buildListMarkerProjection first and only attempts buildOrderedListProjection on ITS OWN \"ordered-marker\" refusal — the mutual-exclusivity contract lives in exactly one place, alongside (never overlapping with) the sibling \"task-list-marker\" branch, now a plain Obsidian-free function rather than a PartialEditView-private method", () => {
    // 2026-09-22 (Phase 5L-12): see taskListPartialEditUiWiring.test.ts's
    // own identically-updated test for the full rationale.
    expect(viewTs).not.toContain("private buildStandaloneListProjections(");
    const listIdx = resolverTs.indexOf("buildListMarkerProjection(rawText)");
    const taskReasonIdx = resolverTs.indexOf('built.reason === "task-list-marker"');
    const orderedReasonIdx = resolverTs.indexOf('built.reason === "ordered-marker"');
    const orderedBuildIdx = resolverTs.indexOf("buildOrderedListProjection(rawText)");
    expect(listIdx).toBeGreaterThan(-1);
    expect(taskReasonIdx).toBeGreaterThan(listIdx);
    expect(orderedReasonIdx).toBeGreaterThan(taskReasonIdx);
    expect(orderedBuildIdx).toBeGreaterThan(orderedReasonIdx);
  });

  it("currentDisplayText() falls back to standaloneOrderedListProjection's projected body, after standaloneListMarkerProjection and standaloneTaskListProjection but before raw originalText", () => {
    const body = bodyOf(viewTs, "private currentDisplayText(): string {", "currentDisplayText()");
    const listIdx = body.indexOf("if (this.standaloneListMarkerProjection) {");
    const taskIdx = body.indexOf(
      "if (this.standaloneTaskListProjection) {\n      return projectedTaskBodyText(this.standaloneTaskListProjection);\n    }"
    );
    const orderedIdx = body.indexOf(
      "if (this.standaloneOrderedListProjection) {\n      return projectedOrderedBodyText(this.standaloneOrderedListProjection);\n    }"
    );
    const rawIdx = body.indexOf("return this.originalText;");
    expect(listIdx).toBeGreaterThan(-1);
    expect(taskIdx).toBeGreaterThan(listIdx);
    expect(orderedIdx).toBeGreaterThan(taskIdx);
    expect(rawIdx).toBeGreaterThan(orderedIdx);
  });

  it("isDirty() considers the number control's own current text against the loaded projection's original number text, via a plain STRING comparison never gated on isValidOrderedListNumberText", () => {
    const body = bodyOf(viewTs, "private isDirty(): boolean {", "isDirty");
    expect(body).toContain("const orderedNumberDirty =");
    expect(body).toContain(
      "this.orderedNumberInputEl.value !== this.standaloneOrderedListProjection.number"
    );
    expect(body).toContain("orderedNumberDirty");
  });

  it("cancelEdit() reverts the number control back to the loaded projection's own original number text", () => {
    const body = bodyOf(viewTs, "private cancelEdit(): void {", "cancelEdit");
    expect(body).toContain("if (this.standaloneOrderedListProjection) {");
    expect(body).toContain(
      "this.orderedNumberInputEl.value = this.standaloneOrderedListProjection.number;"
    );
  });

  it("applyEdit's ordered-list branch inverts via invertOrderedListProjection with BOTH the number input's current text and the textarea's current body, refuses with orderedNumberInvalid on invalid-number and orderedBodyNewlineUnsupported on multiline-body, and otherwise feeds the reconstructed line into the SAME, unmodified applySubtreeEdit call — no new write-back path", () => {
    const region = standaloneApplyRegion();
    expect(region).toContain("} else if (this.standaloneOrderedListProjection) {");
    expect(region).toContain(
      "invertOrderedListProjection(\n        this.standaloneOrderedListProjection,\n        this.orderedNumberInputEl.value,\n        this.textareaEl.value\n      )"
    );
    expect(region).toContain("if (!invertedOrdered.ok) {");
    expect(region).toContain('this.plugin.t(');
    expect(region).toContain('invertedOrdered.reason === "invalid-number"');
    expect(region).toContain('"partialEdit.orderedNumberInvalid"');
    expect(region).toContain('"partialEdit.orderedBodyNewlineUnsupported"');
    expect(region).toContain("newRawText = invertedOrdered.rawLine;");
    const invertIdx = region.indexOf("invertOrderedListProjection(");
    const applyIdx = region.indexOf("applySubtreeEdit(doc, this.nodeId!, this.originalText, newRawText)");
    expect(invertIdx).toBeGreaterThan(-1);
    expect(applyIdx).toBeGreaterThan(invertIdx);
  });

  it("the delimiter is NEVER passed to invertOrderedListProjection — structurally impossible to edit this phase, no editedDelimiter-shaped argument anywhere in the standalone Apply branch", () => {
    const region = standaloneApplyRegion();
    const branchIdx = region.indexOf("} else if (this.standaloneOrderedListProjection) {");
    expect(branchIdx).toBeGreaterThan(-1);
    const branchRegion = region.slice(
      branchIdx,
      region.indexOf("newRawText = invertedOrdered.rawLine;", branchIdx)
    );
    expect(branchRegion).not.toContain("Delimiter");
    expect(branchRegion).not.toContain("delimiterInputEl");
  });

  it("never introduces a UI to change a list item's number-marker delimiter — no new input element for it, only the existing textareaEl (body) and the new orderedNumberInputEl (number)", () => {
    const region = standaloneApplyRegion();
    expect(region).not.toContain("orderedDelimiterSelectEl");
    expect(region).not.toContain("orderedDelimiterInputEl");
    expect(region).not.toContain("orderedMarkerInputEl");
  });

  it("after a successful Apply, rebuilds standaloneOrderedListProjection fresh via buildOrderedListProjection(newRawText), re-syncs the textarea via currentDisplayText(), and re-syncs the number control via renderOrderedNumberRow()", () => {
    const region = standaloneApplyRegion();
    const rebuildIdx = region.indexOf("} else if (this.standaloneOrderedListProjection) {");
    expect(rebuildIdx).toBeGreaterThan(-1);
    const rebuildRegion = region.slice(rebuildIdx);
    expect(rebuildRegion).toContain("const rebuilt = buildOrderedListProjection(newRawText);");
    expect(rebuildRegion).toContain(
      "this.standaloneOrderedListProjection = rebuilt.ok ? rebuilt.projection : null;"
    );
    expect(rebuildRegion).toContain("this.textareaEl.value = this.currentDisplayText();");
    expect(rebuildRegion).toContain("this.renderOrderedNumberRow();");
  });

  it("resetLoadedState/loadParagraphInternal/loadCompositeInternal all reset standaloneOrderedListProjection to null — a paragraph or CompositeBlock session can never inherit a stale standalone ordered-list projection", () => {
    const resetBody = bodyOf(viewTs, "private resetLoadedState(): void {", "resetLoadedState");
    const paragraphBody = bodyOf(viewTs, "private loadParagraphInternal(", "loadParagraphInternal");
    const compositeBody = bodyOf(viewTs, "private loadCompositeInternal(", "loadCompositeInternal");
    expect(resetBody).toContain("this.standaloneOrderedListProjection = null;");
    expect(paragraphBody).toContain("this.standaloneOrderedListProjection = null;");
    expect(compositeBody).toContain("this.standaloneOrderedListProjection = null;");
  });

  it("performAutoReload unconditionally re-resolves standaloneOrderedListProjection alongside every other standalone projection via reconcileStandaloneNodeState whenever this.nodeId is set — never gated on \"was ANY already active before this reload\" — re-deriving eligibility fresh from the just-reloaded doc.nodes", () => {
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
    expect(body).not.toContain("this.buildStandaloneListProjections(");
    expect(resolverTs).toContain("isStandaloneOrderedListItemEligibleForMarkerFreeProjection(node)");
  });

  it("renderOrderedNumberRow toggles the row's visibility and the input's value/disabled state from standaloneOrderedListProjection alone, populating verbatim from projection.number, and is called from renderEmptyState/renderLoadedState/performAutoReload alongside the existing renderTaskCheckboxRow call", () => {
    const renderBody = bodyOf(
      viewTs,
      "private renderOrderedNumberRow(): void {",
      "renderOrderedNumberRow"
    );
    expect(renderBody).toContain("this.standaloneOrderedListProjection !== null");
    expect(renderBody).toContain("this.orderedNumberRowEl.toggleVisibility(active);");
    expect(renderBody).toContain("this.orderedNumberInputEl.value =");
    // 2026-09-15 (Phase 5L-4): renderOrderedNumberRow was rewritten to
    // ALSO show a multi-line ordered item's own number
    // (projectedMultiLineNumberText(this.standaloneMultiLineListProjection!)
    // in the new else-if branch), so the single-line read is now inside a
    // truthy-narrowed ternary branch
    // (this.standaloneOrderedListProjection ? ... : ...) rather than
    // relying on a "!" non-null-assertion — re-pinned below without the
    // "!"; the INTENT (populated verbatim from standaloneOrderedListProjection
    // alone when that projection is active) is unchanged.
    expect(renderBody).toContain(
      "projectedOrderedNumberText(this.standaloneOrderedListProjection)"
    );
    expect(renderBody).toContain(
      "projectedMultiLineNumberText(this.standaloneMultiLineListProjection!)"
    );
    expect(renderBody).toContain("this.orderedNumberInputEl.disabled = !active;");

    const emptyBody = bodyOf(viewTs, "private renderEmptyState(): void {", "renderEmptyState");
    const loadedBody = bodyOf(viewTs, "private renderLoadedState(): void {", "renderLoadedState");
    expect(emptyBody).toContain("this.renderOrderedNumberRow();");
    expect(loadedBody).toContain("this.renderOrderedNumberRow();");
  });

  it("CompositeBlock's own structured list-member session (loadCompositeInternal, listMarkerProjection, compositeListInputEl) never BUILDS or USES an OrderedListProjection — ordered-list marker-free projection is standalone-only this phase. loadCompositeInternal DOES reset this.standaloneOrderedListProjection to null (hygiene, mirroring its identical standaloneListMarkerProjection/standaloneTaskListProjection resets), so this deliberately checks for a BUILD/USE call, never the bare substring \"OrderedListProjection\" (which the reset's own field name legitimately contains)", () => {
    const compositeBody = bodyOf(viewTs, "private loadCompositeInternal(", "loadCompositeInternal");
    expect(compositeBody).toContain("this.standaloneOrderedListProjection = null;");
    expect(compositeBody).not.toContain("buildOrderedListProjection(");
    expect(compositeBody).not.toContain("invertOrderedListProjection(");
    expect(compositeBody).not.toContain("orderedNumberInputEl");
  });
});
