/**
 * Phase 5L-2 ("Task List Marker-Free Partial Edit"): static-source-text
 * checks for the wiring this ticket added to view/PartialEditView.ts —
 * mirrors tests/standaloneListMarkerFreePartialEditUiWiring.test.ts's own
 * structure exactly, since this file is that one's task-list counterpart.
 *
 * Same constraint as the other View-wiring test files in this project:
 * PartialEditView (extends Obsidian's ItemView) cannot be constructed in
 * vitest, since "obsidian" is a types-only package in this repo. This file
 * inspects the raw source text of view/PartialEditView.ts rather than
 * instantiating it.
 *
 * The real, non-Obsidian-dependent logic this wiring calls into
 * (isStandaloneTaskListItemEligibleForMarkerFreeProjection, and the
 * buildTaskListProjection/invertTaskListProjection pair) is unit-tested
 * directly, with real assertions, in tests/taskListProjection.test.ts,
 * tests/standaloneTaskListProjection.test.ts, and
 * tests/taskListMarkerPartialEdit.test.ts — this file only confirms the
 * View layer actually wires into that logic at the right place.
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

describe("view/PartialEditView.ts: Phase 5L-2 (Task List Marker-Free Partial Edit)", () => {
  it("declares standaloneTaskListProjection as its own field, independent of the non-task standaloneListMarkerProjection field and the CompositeBlock-only listMarkerProjection field", () => {
    expect(viewTs).toContain(
      "private standaloneTaskListProjection: TaskListProjection | null = null;"
    );
  });

  it("imports buildTaskListProjection/invertTaskListProjection/projectedTaskBodyText/TaskListProjection from edit/taskListProjection.ts; isStandaloneTaskListItemEligibleForMarkerFreeProjection now lives only inside resolveStandaloneListProjections (edit/standaloneProjectionResolver.ts), imported from its own dedicated edit/standaloneTaskListProjection.ts — never merged into the CompositeBlock-only compositeBlockMemberProjection.ts gate", () => {
    // 2026-09-22 (Phase 5L-12): see standaloneListMarkerFreePartialEditUiWiring.test.ts's
    // own identically-updated import test for the full rationale.
    expect(viewTs).toContain(
      'import {\n  buildTaskListProjection,\n  invertTaskListProjection,\n  projectedTaskBodyText,\n  TaskListProjection,\n} from "../edit/taskListProjection";'
    );
    expect(viewTs).not.toContain(
      'import { isStandaloneTaskListItemEligibleForMarkerFreeProjection } from "../edit/standaloneTaskListProjection";'
    );
    expect(resolverTs).toContain(
      'import { isStandaloneTaskListItemEligibleForMarkerFreeProjection } from "./standaloneTaskListProjection";'
    );
  });

  it("declares a dedicated taskCheckboxRowEl/taskCheckboxInputEl pair, distinct from the CompositeBlock-only compositeListRowEl/compositeListInputEl pair", () => {
    expect(viewTs).toContain("private taskCheckboxRowEl!: HTMLElement;");
    expect(viewTs).toContain("private taskCheckboxInputEl!: HTMLInputElement;");
  });

  it("the checkbox input is created as type=\"checkbox\", wired to updateDirtyState on change, and never re-parses/replaces the shared textareaEl", () => {
    const idx = viewTs.indexOf("this.taskCheckboxRowEl = this.contentEl.createDiv({");
    expect(idx).toBeGreaterThan(-1);
    const region = viewTs.slice(idx, idx + 1200);
    expect(region).toContain('type: "checkbox"');
    expect(region).toContain(
      'this.taskCheckboxInputEl.addEventListener("change", () => this.updateDirtyState());'
    );
  });

  it("loadNodeInternal resolves standaloneTaskListProjection via the shared reconcileStandaloneNodeState pipeline, with no early-return refusal path from that call through the rest of the method", () => {
    // 2026-09-22 (Phase 5L-12): see standaloneListMarkerFreePartialEditUiWiring.test.ts's
    // own identically-updated test for the full rationale — the per-tier
    // inline eligibility computation + buildStandaloneListProjections call
    // this test originally pinned down now lives inside the shared
    // reconcileStandaloneNodeState/resolveStandaloneListProjections
    // pipeline; the task-list eligibility gate itself is re-pinned against
    // edit/standaloneProjectionResolver.ts instead, and separately
    // behavior-tested with a real parseDocument in
    // tests/standaloneProjectionResolver.test.ts.
    const body = bodyOf(viewTs, "private loadNodeInternal(nodeId: string): void {", "loadNodeInternal");
    const reconcileIdx = body.indexOf(
      "this.reconcileStandaloneNodeState(doc, nodeId, node, extracted.text);"
    );
    expect(reconcileIdx).toBeGreaterThan(-1);
    const tailRegion = body.slice(reconcileIdx);
    expect(tailRegion).not.toContain("return;");
    expect(resolverTs).toContain("isStandaloneTaskListItemEligibleForMarkerFreeProjection(node)");
  });

  it("resolveStandaloneListProjections (edit/standaloneProjectionResolver.ts) tries buildListMarkerProjection first and only attempts buildTaskListProjection on ITS OWN \"task-list-marker\" refusal — the mutual-exclusivity contract lives in exactly one place, now a plain Obsidian-free function rather than a PartialEditView-private method", () => {
    // 2026-09-22 (Phase 5L-12): view/PartialEditView.ts's own
    // buildStandaloneListProjections wrapper method (and its
    // buildStandaloneMultiLineListProjection/buildStandaloneParentListItemProjection
    // siblings) were deleted once every call site migrated to the shared
    // reconcileStandaloneNodeState/resolveStandaloneListProjections
    // pipeline — the dispatch logic this test pins down now lives, once,
    // in edit/standaloneProjectionResolver.ts's own exported
    // resolveStandaloneListProjections function.
    expect(viewTs).not.toContain("private buildStandaloneListProjections(");
    const listIdx = resolverTs.indexOf("buildListMarkerProjection(rawText)");
    const taskIdx = resolverTs.indexOf('built.reason === "task-list-marker"');
    const taskBuildIdx = resolverTs.indexOf("buildTaskListProjection(rawText)");
    expect(listIdx).toBeGreaterThan(-1);
    expect(taskIdx).toBeGreaterThan(listIdx);
    expect(taskBuildIdx).toBeGreaterThan(taskIdx);
  });

  it("currentDisplayText() falls back to standaloneTaskListProjection's projected body, after standaloneListMarkerProjection and before raw originalText", () => {
    const body = bodyOf(viewTs, "private currentDisplayText(): string {", "currentDisplayText()");
    const listIdx = body.indexOf("if (this.standaloneListMarkerProjection) {");
    const taskIdx = body.indexOf(
      "if (this.standaloneTaskListProjection) {\n      return projectedTaskBodyText(this.standaloneTaskListProjection);\n    }"
    );
    const rawIdx = body.indexOf("return this.originalText;");
    expect(listIdx).toBeGreaterThan(-1);
    expect(taskIdx).toBeGreaterThan(listIdx);
    expect(rawIdx).toBeGreaterThan(taskIdx);
  });

  it("isDirty() considers the checkbox control's own checked state against the loaded projection's checked value", () => {
    const body = bodyOf(viewTs, "private isDirty(): boolean {", "isDirty");
    expect(body).toContain("const taskCheckedDirty =");
    expect(body).toContain("this.taskCheckboxInputEl.checked !== this.standaloneTaskListProjection.checked");
    expect(body).toContain("taskCheckedDirty");
  });

  it("cancelEdit() reverts the checkbox control back to the loaded projection's own checked value", () => {
    const body = bodyOf(viewTs, "private cancelEdit(): void {", "cancelEdit");
    expect(body).toContain("if (this.standaloneTaskListProjection) {");
    expect(body).toContain(
      "this.taskCheckboxInputEl.checked = this.standaloneTaskListProjection.checked;"
    );
  });

  it("applyEdit's task-list branch inverts via invertTaskListProjection with BOTH the checkbox's current .checked and the textarea's current body, refuses with its OWN taskBodyNewlineUnsupported Notice on multiline-body failure, and otherwise feeds the reconstructed line into the SAME, unmodified applySubtreeEdit call — no new write-back path", () => {
    const region = standaloneApplyRegion();
    expect(region).toContain("} else if (this.standaloneTaskListProjection) {");
    expect(region).toContain(
      "invertTaskListProjection(\n        this.standaloneTaskListProjection,\n        this.taskCheckboxInputEl.checked,\n        this.textareaEl.value\n      )"
    );
    expect(region).toContain("if (!invertedTask.ok) {");
    expect(region).toContain('this.plugin.t("partialEdit.taskBodyNewlineUnsupported")');
    expect(region).toContain("newRawText = invertedTask.rawLine;");
    const invertIdx = region.indexOf("invertTaskListProjection(");
    const applyIdx = region.indexOf("applySubtreeEdit(doc, this.nodeId!, this.originalText, newRawText)");
    expect(invertIdx).toBeGreaterThan(-1);
    expect(applyIdx).toBeGreaterThan(invertIdx);
  });

  it("never introduces a UI to change a list item's marker or the checkbox's brackets — no new input element for either, only the existing textareaEl (body) and the new taskCheckboxInputEl (completion state)", () => {
    const region = standaloneApplyRegion();
    expect(region).not.toContain("taskMarkerSelectEl");
    expect(region).not.toContain("taskMarkerInputEl");
    expect(region).not.toContain("checkboxBracketInputEl");
  });

  it("after a successful Apply, rebuilds standaloneTaskListProjection fresh via buildTaskListProjection(newRawText), re-syncs the textarea via currentDisplayText(), and re-syncs the checkbox control via renderTaskCheckboxRow()", () => {
    const region = standaloneApplyRegion();
    const rebuildIdx = region.indexOf("} else if (this.standaloneTaskListProjection) {");
    expect(rebuildIdx).toBeGreaterThan(-1);
    const rebuildRegion = region.slice(rebuildIdx);
    expect(rebuildRegion).toContain("const rebuilt = buildTaskListProjection(newRawText);");
    expect(rebuildRegion).toContain(
      "this.standaloneTaskListProjection = rebuilt.ok ? rebuilt.projection : null;"
    );
    expect(rebuildRegion).toContain("this.textareaEl.value = this.currentDisplayText();");
    expect(rebuildRegion).toContain("this.renderTaskCheckboxRow();");
  });

  it("resetLoadedState/loadParagraphInternal/loadCompositeInternal all reset standaloneTaskListProjection to null — a paragraph or CompositeBlock session can never inherit a stale standalone task-list projection", () => {
    const resetBody = bodyOf(viewTs, "private resetLoadedState(): void {", "resetLoadedState");
    const paragraphBody = bodyOf(viewTs, "private loadParagraphInternal(", "loadParagraphInternal");
    const compositeBody = bodyOf(viewTs, "private loadCompositeInternal(", "loadCompositeInternal");
    expect(resetBody).toContain("this.standaloneTaskListProjection = null;");
    expect(paragraphBody).toContain("this.standaloneTaskListProjection = null;");
    expect(compositeBody).toContain("this.standaloneTaskListProjection = null;");
  });

  it("performAutoReload unconditionally re-resolves ALL standalone projections together via reconcileStandaloneNodeState whenever this.nodeId is set — never gated on \"was ANY already active before this reload\" — re-deriving all eligibility flags fresh from the just-reloaded doc.nodes", () => {
    // 2026-09-22 (Phase 5L-12, bug fix): see
    // standaloneListMarkerFreePartialEditUiWiring.test.ts's own
    // identically-updated performAutoReload test for the full real-device
    // bug rationale. This test's INTENT — reload re-derives every
    // standalone tier's eligibility fresh, never trusting the pre-reload
    // shape — is unchanged; only the gate is now unconditional rather than
    // "ANY was already active", which is the fix itself.
    const body = bodyOf(viewTs, "private performAutoReload(", "performAutoReload");
    expect(body).toContain(
      "if (this.nodeId) {\n" +
        "      const reloadedNode = doc.nodes.get(this.nodeId);\n" +
        "      this.reconcileStandaloneNodeState(doc, this.nodeId, reloadedNode, newText);\n" +
        "    }"
    );
    expect(body).not.toContain("this.buildStandaloneListProjections(");
    expect(resolverTs).toContain("isStandaloneTaskListItemEligibleForMarkerFreeProjection(node)");
    expect(resolverTs).toContain("isStandaloneOrderedListItemEligibleForMarkerFreeProjection(node)");
  });

  it("renderTaskCheckboxRow toggles the row's visibility and the checkbox's checked/disabled state from standaloneTaskListProjection alone, and is called from renderEmptyState/renderLoadedState/performAutoReload alongside the existing renderCompositeListSlot call", () => {
    const renderBody = bodyOf(viewTs, "private renderTaskCheckboxRow(): void {", "renderTaskCheckboxRow");
    expect(renderBody).toContain("this.standaloneTaskListProjection !== null");
    expect(renderBody).toContain("this.taskCheckboxRowEl.toggleVisibility(active);");
    expect(renderBody).toContain("this.taskCheckboxInputEl.checked =");
    expect(renderBody).toContain("this.taskCheckboxInputEl.disabled = !active;");

    const emptyBody = bodyOf(viewTs, "private renderEmptyState(): void {", "renderEmptyState");
    const loadedBody = bodyOf(viewTs, "private renderLoadedState(): void {", "renderLoadedState");
    expect(emptyBody).toContain("this.renderTaskCheckboxRow();");
    expect(loadedBody).toContain("this.renderTaskCheckboxRow();");
  });

  it("CompositeBlock's own structured list-member session (loadCompositeInternal, listMarkerProjection, compositeListInputEl) never BUILDS or USES a TaskListProjection — task-list marker-free projection is standalone-only this phase. loadCompositeInternal DOES reset this.standaloneTaskListProjection to null (hygiene, mirroring its identical standaloneListMarkerProjection reset), so this deliberately checks for a BUILD/USE call, never the bare substring \"TaskListProjection\" (which the reset's own field name legitimately contains)", () => {
    const compositeBody = bodyOf(viewTs, "private loadCompositeInternal(", "loadCompositeInternal");
    expect(compositeBody).toContain("this.standaloneTaskListProjection = null;");
    expect(compositeBody).not.toContain("buildTaskListProjection(");
    expect(compositeBody).not.toContain("invertTaskListProjection(");
    expect(compositeBody).not.toContain("taskCheckboxInputEl");
  });
});
