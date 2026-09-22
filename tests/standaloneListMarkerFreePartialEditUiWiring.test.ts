/**
 * Phase 5L-1 ("Standalone Single-Line Unordered List Marker-Free Partial
 * Edit"): static-source-text checks for the wiring this ticket added to
 * view/PartialEditView.ts.
 *
 * Extracted (2026-09-14) out of tests/compositeBlockPartialEditUiWiring.test.ts,
 * where these two describe blocks originally lived — matching this
 * project's own established one-file-per-feature-area convention for
 * View-wiring test files (see e.g.
 * tests/quotePrefixPartialEditViewWiring.test.ts's own independent
 * `viewTs`/`bodyOf` pattern). Phase 5L-1 adds its OWN, separate
 * `standaloneListMarkerProjection` field/gate/branches to
 * view/PartialEditView.ts, distinct from Phase 5D-2C's CompositeBlock-only
 * `listMarkerProjection` field, so it gets its own dedicated wiring-test
 * file rather than continuing to live inside the CompositeBlock-scoped
 * one. This is a pure file-organization move — no test content changed
 * from how it read in compositeBlockPartialEditUiWiring.test.ts.
 *
 * Same constraint as the other View-wiring test files in this project:
 * PartialEditView (extends Obsidian's ItemView) cannot be constructed in
 * vitest, since "obsidian" is a types-only package in this repo. This file
 * inspects the raw source text of view/PartialEditView.ts rather than
 * instantiating it.
 *
 * The real, non-Obsidian-dependent logic this wiring calls into
 * (isStandaloneListItemEligibleForMarkerFreeProjection, and the reused
 * buildListMarkerProjection/invertListMarkerProjection pair) is
 * unit-tested directly, with real assertions, in
 * tests/standaloneListMarkerProjection.test.ts and
 * tests/standaloneListMarkerPartialEdit.test.ts — this file only confirms
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

describe("view/PartialEditView.ts: the standalone callout/blockquote invert and the plain applySubtreeEdit write-back path are completely unaffected by Phase 5D-2C's CompositeBlock-only marker-free projection (Phase 5L-1 adds its OWN, separate standalone-list projection to this same region instead — see the next describe block)", () => {
  it("everything after the composite branch closes never references the CompositeBlock-specific `this.listMarkerProjection` field, `compositeListInputEl`, or `compositeListOriginalText` — those stay exclusively composite-session concepts, untouched by Phase 5L-1", () => {
    const start = viewTs.indexOf("private applyEdit(): boolean {");
    expect(start).toBeGreaterThan(-1);
    const end = viewTs.indexOf("\n  /**\n   * Real-device follow-up: Apply/Cancel", start);
    expect(end).toBeGreaterThan(start);
    const full = viewTs.slice(start, end);
    const branchStart = full.indexOf("if (this.compositeAnchor) {");
    const branchEnd = full.indexOf("\n    }\n\n    // Phase 5D-0.5:", branchStart);
    expect(branchStart).toBeGreaterThan(-1);
    expect(branchEnd).toBeGreaterThan(branchStart);
    const standaloneRegion = full.slice(branchEnd);
    expect(standaloneRegion).toContain(
      "applySubtreeEdit(doc, this.nodeId!, this.originalText, newRawText)"
    );
    // "this.listMarkerProjection" (the exact CompositeBlock field
    // reference, dot-qualified) never appears here — deliberately NOT a
    // plain `.not.toContain("listMarkerProjection")`, since that bare
    // substring also matches Phase 5L-1's own, legitimate
    // `this.standaloneListMarkerProjection` references in this very
    // region (asserted below) and `buildListMarkerProjection`/
    // `invertListMarkerProjection` (the shared, kind-agnostic module both
    // Phase 5D-2C and Phase 5L-1 reuse — see the next test).
    expect(standaloneRegion).not.toContain("this.listMarkerProjection");
    expect(standaloneRegion).not.toContain("compositeListInputEl");
    expect(standaloneRegion).not.toContain("compositeListOriginalText");
  });

  it("loadNodeInternal and loadParagraphInternal only ever RESET the CompositeBlock-specific `this.listMarkerProjection` field to null (hygiene, matching compositeListOriginalText's own reset) — neither ever ASSIGNS it a built projection; that only ever happens from loadCompositeInternal/performAutoReload/applyEdit's composite branch", () => {
    const nodeBody = bodyOf(viewTs, "private loadNodeInternal(nodeId: string): void {", "loadNodeInternal");
    const paragraphBody = bodyOf(viewTs, "private loadParagraphInternal(", "loadParagraphInternal");
    expect(nodeBody).toContain("this.listMarkerProjection = null;");
    expect(paragraphBody).toContain("this.listMarkerProjection = null;");
    expect(nodeBody).not.toContain("this.listMarkerProjection = listBuilt");
    expect(nodeBody).not.toContain("this.listMarkerProjection = standaloneListMarkerProjection");
    expect(paragraphBody).not.toContain("buildListMarkerProjection");
  });
});

describe("view/PartialEditView.ts: Phase 5L-1 (Standalone Single-Line Unordered List Marker-Free Partial Edit)", () => {
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

  it("declares standaloneListMarkerProjection as its own field, independent of the CompositeBlock-only listMarkerProjection field", () => {
    expect(viewTs).toContain(
      "private standaloneListMarkerProjection: ListMarkerProjection | null = null;"
    );
  });

  it("resolveStandaloneListProjections (edit/standaloneProjectionResolver.ts) — not view/PartialEditView.ts directly — imports isStandaloneListItemEligibleForMarkerFreeProjection from edit/standaloneListMarkerProjection.ts, a dedicated, standalone-domain eligibility gate never merged into CompositeBlock's own compositeBlockMemberProjection.ts gate", () => {
    // 2026-09-22 (Phase 5L-12): view/PartialEditView.ts's own direct
    // import of this eligibility function was removed once every call
    // site that used it migrated to the shared reconcileStandaloneNodeState
    // pipeline — the View layer no longer evaluates standalone-list
    // eligibility itself at all; it only ever consults
    // resolveStandaloneListProjections' own already-resolved result. The
    // import lives, once, in edit/standaloneProjectionResolver.ts instead.
    expect(viewTs).not.toContain(
      'import { isStandaloneListItemEligibleForMarkerFreeProjection } from "../edit/standaloneListMarkerProjection";'
    );
    expect(resolverTs).toContain(
      'import { isStandaloneListItemEligibleForMarkerFreeProjection } from "./standaloneListMarkerProjection";'
    );
  });

  it("loadNodeInternal resolves the standalone projection via the shared reconcileStandaloneNodeState pipeline, with no early-return refusal path anywhere in the method — an ineligible item is always shown raw, never refused", () => {
    // 2026-09-22 (Phase 5L-12): the per-call-site inline "const
    // standaloneListEligible = ...; this.buildStandaloneListProjections(...)"
    // shape this test originally pinned down was consolidated, together
    // with the four sibling standalone-leaf/parent tiers and the
    // ancestors/directChildren/siblingState navigation trio, into the ONE
    // shared reconcileStandaloneNodeState method every load/reload/
    // post-Apply-rebuild site now calls — see that method's own doc
    // comment, and resolveStandaloneListProjections in
    // edit/standaloneProjectionResolver.ts for where the actual
    // isStandaloneListItemEligibleForMarkerFreeProjection(node) gate now
    // lives (behaviorally tested directly, with a real parseDocument, in
    // tests/standaloneProjectionResolver.test.ts). This test's INTENT —
    // eligibility resolution never early-returns; an ineligible item
    // always falls through to the raw display — is unchanged and re-pinned
    // below against the new call shape.
    const body = bodyOf(viewTs, "private loadNodeInternal(nodeId: string): void {", "loadNodeInternal");
    const reconcileIdx = body.indexOf(
      "this.reconcileStandaloneNodeState(doc, nodeId, node, extracted.text);"
    );
    expect(reconcileIdx).toBeGreaterThan(-1);
    // From the reconcile call through the rest of the method (the
    // remaining field resets and the final renderLoadedState() call) there
    // is no early return — ineligibility, discovered inside
    // reconcileStandaloneNodeState, can never abort the load; it only ever
    // results in every standalone field settling to null, falling through
    // to the raw display exactly as the original gate's own "no
    // early-return refusal path" contract required. (Earlier returns in
    // this method, before this call, exist for unrelated reasons — e.g. a
    // target that failed to resolve at all — and are out of scope here.)
    const tailRegion = body.slice(reconcileIdx);
    expect(tailRegion).not.toContain("return;");
    expect(resolverTs).toContain("isStandaloneListItemEligibleForMarkerFreeProjection(node)");
  });

  it("currentDisplayText() falls back to standaloneListMarkerProjection's projected body, after quoteProjection and before raw originalText", () => {
    const body = bodyOf(viewTs, "private currentDisplayText(): string {", "currentDisplayText()");
    expect(body).toContain(
      "if (this.standaloneListMarkerProjection) {\n      return projectedListBodyText(this.standaloneListMarkerProjection);\n    }"
    );
  });

  it("applyEdit's standalone branch inverts via invertListMarkerProjection, refuses with the SAME listBodyNewlineUnsupported Notice the CompositeBlock branch uses (no new i18n key) on multiline-body failure, and otherwise feeds the reconstructed line into the SAME, unmodified applySubtreeEdit call — no new write-back path", () => {
    const region = standaloneApplyRegion();
    expect(region).toContain("} else if (this.standaloneListMarkerProjection) {");
    expect(region).toContain(
      "invertListMarkerProjection(\n        this.standaloneListMarkerProjection,\n        this.textareaEl.value\n      )"
    );
    expect(region).toContain("if (!invertedList.ok) {");
    expect(region).toContain('this.plugin.t("partialEdit.listBodyNewlineUnsupported")');
    expect(region).toContain("newRawText = invertedList.rawLine;");
    const invertIdx = region.indexOf("invertListMarkerProjection(");
    const applyIdx = region.indexOf("applySubtreeEdit(doc, this.nodeId!, this.originalText, newRawText)");
    expect(invertIdx).toBeGreaterThan(-1);
    expect(applyIdx).toBeGreaterThan(invertIdx);
  });

  it("never introduces a UI to change a list item's marker — the reconstructed line always reuses the ORIGINAL marker captured at load time (invertListMarkerProjection's own contract), and no new input element is created for it", () => {
    const region = standaloneApplyRegion();
    expect(region).not.toContain("listMarkerSelectEl");
    expect(region).not.toContain("listMarkerInputEl");
  });

  it("after a successful Apply, rebuilds standaloneListMarkerProjection fresh via buildListMarkerProjection(newRawText), mirroring the quoteProjection rebuild immediately above it, and re-syncs the textarea via currentDisplayText()", () => {
    const region = standaloneApplyRegion();
    const rebuildIdx = region.indexOf("} else if (this.standaloneListMarkerProjection) {");
    expect(rebuildIdx).toBeGreaterThan(-1);
    const rebuildRegion = region.slice(rebuildIdx);
    expect(rebuildRegion).toContain("const rebuilt = buildListMarkerProjection(newRawText);");
    expect(rebuildRegion).toContain(
      "this.standaloneListMarkerProjection = rebuilt.ok ? rebuilt.projection : null;"
    );
    expect(rebuildRegion).toContain("this.textareaEl.value = this.currentDisplayText();");
  });

  it("resetLoadedState/loadParagraphInternal/loadCompositeInternal all reset standaloneListMarkerProjection to null — a paragraph or CompositeBlock session can never inherit a stale standalone-list projection", () => {
    const resetBody = bodyOf(viewTs, "private resetLoadedState(): void {", "resetLoadedState");
    const paragraphBody = bodyOf(viewTs, "private loadParagraphInternal(", "loadParagraphInternal");
    const compositeBody = bodyOf(viewTs, "private loadCompositeInternal(", "loadCompositeInternal");
    expect(resetBody).toContain("this.standaloneListMarkerProjection = null;");
    expect(paragraphBody).toContain("this.standaloneListMarkerProjection = null;");
    expect(compositeBody).toContain("this.standaloneListMarkerProjection = null;");
  });

  it("performAutoReload unconditionally re-resolves standaloneListMarkerProjection (and every sibling standalone tier) via reconcileStandaloneNodeState whenever this.nodeId is set — never gated on \"was a projection already active before this reload\" — re-deriving eligibility fresh from the just-reloaded doc.nodes", () => {
    // 2026-09-22 (Phase 5L-12, bug fix): the gate this test originally
    // pinned down (rebuild ONLY when this.nodeId AND at least one of the
    // five standalone fields was already truthy pre-reload) is exactly
    // the real-device bug class Phase 5L-9b's Bug #2 and this phase's own
    // investigation both found: a node reloading from a real PARENT
    // (Phase 5L-9b's own Mode-B-added child, external-Undo'd away) down to
    // a genuine childless LEAF starts the reload with all four leaf
    // fields null, so the old gate's OR-chain never fired even though
    // standaloneParentListItemProjection itself WAS truthy going in — see
    // performAutoReload's own doc comment for the full before/after. This
    // phase deliberately WIDENS the gate to fire unconditionally whenever
    // a node is loaded (proven safe by isDirty()'s own construction — see
    // reconcileStandaloneNodeState's doc comment), which is an intentional
    // behavior change, not just a refactor — this test's INTENT is updated
    // accordingly: reload now ALWAYS re-derives the standalone projection
    // fresh, rather than only when one was already active.
    const body = bodyOf(viewTs, "private performAutoReload(", "performAutoReload");
    expect(body).toContain(
      "if (this.nodeId) {\n" +
        "      const reloadedNode = doc.nodes.get(this.nodeId);\n" +
        "      this.reconcileStandaloneNodeState(doc, this.nodeId, reloadedNode, newText);\n" +
        "    }"
    );
    expect(body).not.toContain("this.standaloneListMarkerProjection ||");
  });
});
