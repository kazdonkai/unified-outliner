/**
 * Phase 5D-2A ("Atomic CompositeBlock Partial Edit"): static-source-text
 * checks for the wiring this ticket added across main.ts,
 * view/PartialEditView.ts, and view/OutlineTreeView.ts.
 *
 * Same constraint as tests/paragraphPartialEditViewWiring.test.ts and
 * tests/partialEditPanePlacementUiWiring.test.ts: UnifiedOutlinerPlugin
 * (extends Obsidian's Plugin), PartialEditView (extends Obsidian's
 * ItemView), and OutlineTreeView (extends Obsidian's ItemView) cannot be
 * constructed in vitest, since "obsidian" is a types-only package in this
 * repo. This file inspects the raw source text of all three files rather
 * than instantiating them.
 *
 * The real, non-Obsidian-dependent logic (extract/apply/reason-mapping)
 * this wiring calls into is unit-tested directly, with real assertions, in
 * tests/compositeBlockPartialEdit.test.ts — this file only confirms the
 * UI/command layer actually wires into that logic at the right place, that
 * the three-way nodeId/paragraphAnchor/compositeAnchor exclusivity holds,
 * that the composite-wide pane stays raw-Markdown-only (no quote
 * projection / title input / marker select / type combobox), and that the
 * new "Open extended block in partial edit" menu item is scoped to the
 * CompositeBlock parent row ONLY.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const mainTs = readFileSync(path.resolve(__dirname, "../src/main.ts"), "utf-8");
const viewTs = readFileSync(path.resolve(__dirname, "../src/view/PartialEditView.ts"), "utf-8");
const treeTs = readFileSync(path.resolve(__dirname, "../src/view/OutlineTreeView.ts"), "utf-8");

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

describe("main.ts: activatePartialEditViewForComposite", () => {
  it("imports CompositeBlockSnapshot alongside buildCompositeBlockSnapshot from edit/deleteCompositeBlock", () => {
    expect(mainTs).toContain(
      'import { buildCompositeBlockSnapshot, CompositeBlockSnapshot } from "./edit/deleteCompositeBlock";'
    );
  });

  it("exists, is a fully independent method (does not delegate to activatePartialEditView/ForParagraph or any shared helper), and hands off to requestLoadComposite", () => {
    const body = bodyOf(
      mainTs,
      "async activatePartialEditViewForComposite(",
      "activatePartialEditViewForComposite"
    );
    expect(body).toContain("leaf.view.requestLoadComposite(snapshot)");
    expect(body).not.toContain("this.activatePartialEditView(");
    expect(body).not.toContain("this.activatePartialEditViewForParagraph(");
    // Owns its own leaf-open/reveal/popout logic, mirroring
    // activatePartialEditViewForParagraph's own independent copy.
    expect(body).toContain("PARTIAL_EDIT_VIEW_TYPE");
    expect(body).toContain("workspace.revealLeaf(leaf)");
  });

  it("takes a CompositeBlockSnapshot and an optional openInNewWindow option, exactly like the other two activate methods' own signatures", () => {
    expect(mainTs).toContain(
      "async activatePartialEditViewForComposite(\n    snapshot: CompositeBlockSnapshot,\n    options?: { openInNewWindow?: boolean }\n  ): Promise<void> {"
    );
  });
});

describe("view/PartialEditView.ts: three-way nodeId/paragraphAnchor/compositeAnchor exclusivity", () => {
  it("declares a compositeAnchor field alongside nodeId/paragraphAnchor", () => {
    expect(viewTs).toContain("private compositeAnchor: CompositeBlockSnapshot | null = null;");
  });

  it("loadNodeInternal clears both paragraphAnchor and compositeAnchor", () => {
    const body = bodyOf(viewTs, "private loadNodeInternal(", "loadNodeInternal");
    expect(body).toContain("this.paragraphAnchor = null;");
    expect(body).toContain("this.compositeAnchor = null;");
  });

  it("loadParagraphInternal clears compositeAnchor (and sets paragraphAnchor, not nodeId)", () => {
    const body = bodyOf(viewTs, "private loadParagraphInternal(", "loadParagraphInternal");
    expect(body).toContain("this.nodeId = null;");
    expect(body).toContain("this.compositeAnchor = null;");
  });

  it("loadCompositeInternal clears both nodeId and paragraphAnchor (and sets compositeAnchor, not nodeId)", () => {
    const body = bodyOf(viewTs, "private loadCompositeInternal(", "loadCompositeInternal");
    expect(body).toContain("this.nodeId = null;");
    expect(body).toContain("this.paragraphAnchor = null;");
    expect(body).toContain("this.compositeAnchor = extracted.resolvedSnapshot;");
  });

  it("renderEmptyState resets compositeAnchor alongside paragraphAnchor (via the shared resetLoadedState helper)", () => {
    // 2026-09-09 ("単独 Callout Partial Edit Pane の stale snapshot 表示
    // バグ修正"): renderEmptyState's field resets — including
    // paragraphAnchor/compositeAnchor — were consolidated into a new
    // shared resetLoadedState() method (also called from onClose, so an
    // explicitly closed pane can't leak a stale target/draft into its
    // next session). renderEmptyState no longer resets these fields
    // inline; it delegates to resetLoadedState() instead.
    const emptyStateBody = bodyOf(viewTs, "private renderEmptyState(): void {", "renderEmptyState");
    expect(emptyStateBody).toContain("this.resetLoadedState();");
    const resetBody = bodyOf(viewTs, "private resetLoadedState(): void {", "resetLoadedState");
    expect(resetBody).toContain("this.paragraphAnchor = null;");
    expect(resetBody).toContain("this.compositeAnchor = null;");
  });

  it("applyEdit's top guard refuses when none of nodeId/paragraphAnchor/compositeAnchor is set", () => {
    expect(viewTs).toContain(
      "if (!this.nodeId && !this.paragraphAnchor && !this.compositeAnchor) {"
    );
  });

  it("isDirty treats a loaded compositeAnchor as \"something is loaded\", alongside nodeId/paragraphAnchor", () => {
    const body = bodyOf(viewTs, "private isDirty(): boolean {", "isDirty");
    expect(body).toContain(
      "(this.nodeId !== null || this.paragraphAnchor !== null || this.compositeAnchor !== null)"
    );
  });
});

describe("view/PartialEditView.ts: requestLoadComposite (unsaved-edit guard, same DiscardChangesModal)", () => {
  it("exists, guards on isDirty, and reuses DiscardChangesModal rather than a third modal/flow", () => {
    const body = bodyOf(viewTs, "requestLoadComposite(snapshot: CompositeBlockSnapshot): void {", "requestLoadComposite");
    expect(body).toContain("if (!this.isDirty())");
    expect(body).toContain("this.loadCompositeInternal(snapshot)");
    expect(body).toContain("new DiscardChangesModal(");
    expect(body).toContain('if (choice === "cancel") return;');
    expect(body).toContain('if (choice === "discard")');
    expect(body).toContain("if (this.applyEdit())");
  });
});

describe("view/PartialEditView.ts: loadCompositeInternal stays raw-Markdown-only (no quote projection, no breadcrumb/sibling-nav)", () => {
  it("always sets quoteProjection to null — never applies quote-prefix projection to a CompositeBlock session", () => {
    const body = bodyOf(viewTs, "private loadCompositeInternal(", "loadCompositeInternal");
    expect(body).toContain("this.quoteProjection = null;");
  });

  it("clears ancestors/directChildren/siblingState — no breadcrumb, Subtree Navigator, or sibling nav for a CompositeBlock", () => {
    const body = bodyOf(viewTs, "private loadCompositeInternal(", "loadCompositeInternal");
    expect(body).toContain("this.ancestors = [];");
    expect(body).toContain("this.directChildren = [];");
    expect(body).toContain("this.siblingState = { previous: null, next: null };");
  });

  it("sets nodeKind to \"composite\" (not reusing \"section\"/\"list\"/\"callout\"/\"blockquote\"/\"paragraph\")", () => {
    const body = bodyOf(viewTs, "private loadCompositeInternal(", "loadCompositeInternal");
    expect(body).toContain('this.nodeKind = "composite";');
  });
});

describe("view/PartialEditView.ts: renderLoadedState's kindLabel switch covers \"composite\"", () => {
  it("has a case \"composite\" branch returning partialEdit.kindComposite", () => {
    expect(viewTs).toContain('case "composite":\n          return this.plugin.t("partialEdit.kindComposite");');
  });
});

describe("view/PartialEditView.ts: applyEdit's composite branch", () => {
  function applyEditBody(): string {
    const start = viewTs.indexOf("private applyEdit(): boolean {");
    expect(start).toBeGreaterThan(-1);
    const end = viewTs.indexOf("\n  /**\n   * Real-device follow-up: Apply/Cancel", start);
    expect(end).toBeGreaterThan(start);
    return viewTs.slice(start, end);
  }

  it("is gated on this.compositeAnchor and never touches nodeId/paragraphAnchor/applySubtreeEdit/applyParagraphEdit inside that branch", () => {
    const full = applyEditBody();
    const branchStart = full.indexOf("if (this.compositeAnchor) {");
    expect(branchStart).toBeGreaterThan(-1);
    const branchEnd = full.indexOf("\n    }\n\n    // Phase 5D-0.5:", branchStart);
    expect(branchEnd).toBeGreaterThan(branchStart);
    const branch = full.slice(branchStart, branchEnd);
    expect(branch).toContain("applyCompositeBlockEdit(");
    expect(branch).not.toContain("applySubtreeEdit(");
    expect(branch).not.toContain("applyParagraphEdit(");
    expect(branch).toContain("this.compositeAnchor = outcome.resolvedSnapshot ?? null;");
  });

  it("rejects via compositePartialEditReasonText, never a plain \"reason.\" + outcome.reason concatenation", () => {
    const full = applyEditBody();
    const branchStart = full.indexOf("if (this.compositeAnchor) {");
    const branch = full.slice(branchStart, branchStart + 800);
    expect(branch).toContain("compositePartialEditReasonText(this.plugin.t.bind(this.plugin), outcome.reason)");
  });

  it("shows the exact required rule-no-longer-matches Notice only when outcome.ruleStillMatches === false, and the ordinary compositeUpdated Notice otherwise", () => {
    const full = applyEditBody();
    const branchStart = full.indexOf("if (this.compositeAnchor) {");
    const branch = full.slice(branchStart);
    expect(branch).toContain("outcome.ruleStillMatches === false");
    expect(branch).toContain('this.plugin.t("partialEdit.compositeRuleNoLongerMatches")');
    expect(branch).toContain('this.plugin.t("partialEdit.compositeUpdated")');
  });

  it("re-fetches enabled composite rules fresh at Apply time via getEnabledCompositeBlockRules (never cached)", () => {
    const full = applyEditBody();
    const branchStart = full.indexOf("if (this.compositeAnchor) {");
    const branch = full.slice(branchStart, branchStart + 400);
    expect(branch).toContain("getEnabledCompositeBlockRules(this.plugin.settings.compositeBlocks)");
  });

  it("queues an Outline Tree selection follow after a successful composite Apply, mirroring the paragraph/node branches", () => {
    const full = applyEditBody();
    const branchStart = full.indexOf("if (this.compositeAnchor) {");
    const branch = full.slice(branchStart);
    expect(branch).toContain("this.plugin.queueOutlineTreeSelectionFollow(outcome.newStartLine);");
  });
});

describe("view/PartialEditView.ts: no quote-prefix-projection UI reused for the composite-wide pane", () => {
  it("loadCompositeInternal never touches quoteTitleInputEl/quoteMarkerSelectEl/quoteTypeInputEl (no title/marker/type UI for a CompositeBlock)", () => {
    const body = bodyOf(viewTs, "private loadCompositeInternal(", "loadCompositeInternal");
    expect(body).not.toContain("quoteTitleInputEl");
    expect(body).not.toContain("quoteMarkerSelectEl");
    expect(body).not.toContain("quoteTypeInputEl");
  });
});

describe("view/OutlineTreeView.ts: \"Open extended block in partial edit\" is scoped to the CompositeBlock parent row ONLY", () => {
  function showCompositeCommandMenuBody(): string {
    const start = treeTs.indexOf("private showCompositeCommandMenu(evt: MouseEvent, compositeId: string): void {");
    expect(start).toBeGreaterThan(-1);
    const end = treeTs.indexOf("\n  /**\n   * Phase 5C-2: a standalone", start);
    expect(end).toBeGreaterThan(start);
    return treeTs.slice(start, end);
  }

  it("showCompositeCommandMenu always adds the new item (menu.addItem is no longer gated behind the old delete/move eligibility early return)", () => {
    const body = showCompositeCommandMenuBody();
    expect(body).toContain('this.plugin.t("tree.menu.openCompositeInPartialEdit")');
    expect(body).toContain('.setIcon("edit-3")');
    expect(body).toContain("void this.plugin.activatePartialEditViewForComposite(snapshot)");
    // The old MVP-era "show nothing at all" guard is gone — the menu is
    // never empty now that Partial Edit has no eligibility concept.
    expect(body).not.toContain(
      "if (!deletability.deletable && !movabilityUp.eligible && !movabilityDown.eligible) return;"
    );
  });

  it("openCompositeInPartialEdit is used as a menu item exactly once in the whole file, and only inside showCompositeCommandMenu", () => {
    const occurrences = treeTs.split('"tree.menu.openCompositeInPartialEdit"').length - 1;
    expect(occurrences).toBe(1);
    expect(showCompositeCommandMenuBody()).toContain("tree.menu.openCompositeInPartialEdit");
  });

  it("activatePartialEditViewForComposite is called exactly once in the whole file", () => {
    const occurrences = treeTs.split("activatePartialEditViewForComposite(").length - 1;
    expect(occurrences).toBe(1);
  });

  it("is NOT added to showStandaloneComplexBlockMenu, showListCommandMenu, or showStructureCommandMenu (the new entry point is composite-parent-only)", () => {
    const standaloneStart = treeTs.indexOf("private showStandaloneComplexBlockMenu(");
    const listStart = treeTs.indexOf("private showListCommandMenu(");
    const structureStart = treeTs.indexOf("private showStructureCommandMenu(");
    expect(standaloneStart).toBeGreaterThan(-1);
    expect(listStart).toBeGreaterThan(-1);
    expect(structureStart).toBeGreaterThan(-1);

    // Bounded by whichever comes first: the next `private` method
    // declaration, or the next JSDoc block (`\n  /**`) — a doc comment
    // always directly precedes the method it describes, and (as
    // showCompositeCommandMenu's own doc comment demonstrates) can itself
    // mention "activatePartialEditViewForComposite" in prose without that
    // being a real call from the PRECEDING method — so the slice must stop
    // before the next method's doc comment starts, not just before its
    // `private` keyword.
    function sliceToNextPrivateMethod(start: number): string {
      const nextPrivate = treeTs.indexOf("\n  private ", start + 1);
      const nextDocComment = treeTs.indexOf("\n  /**", start + 1);
      const candidates = [nextPrivate, nextDocComment].filter((n) => n !== -1);
      const next = candidates.length > 0 ? Math.min(...candidates) : -1;
      return treeTs.slice(start, next === -1 ? undefined : next);
    }

    expect(sliceToNextPrivateMethod(standaloneStart)).not.toContain("activatePartialEditViewForComposite");
    expect(sliceToNextPrivateMethod(listStart)).not.toContain("activatePartialEditViewForComposite");
    expect(sliceToNextPrivateMethod(structureStart)).not.toContain("activatePartialEditViewForComposite");
  });
});

describe("i18n.ts: Phase 5D-2A keys", () => {
  const i18nTs = readFileSync(path.resolve(__dirname, "../src/i18n.ts"), "utf-8");

  it("defines every new key in both the en and ja translation tables", () => {
    const keys = [
      "tree.menu.openCompositeInPartialEdit",
      "partialEdit.kindComposite",
      "partialEdit.compositeUpdated",
      "partialEdit.compositeRuleNoLongerMatches",
      "reason.compositePartialEditRangeInvalid",
      "reason.compositePartialEditSnapshotMismatch",
      "reason.compositePartialEditConflict",
    ];
    for (const key of keys) {
      const occurrences = i18nTs.split(`"${key}"`).length - 1;
      expect(occurrences).toBeGreaterThanOrEqual(2); // once in en, once in ja
    }
  });

  it("partialEdit.compositeRuleNoLongerMatches has the EXACT required en/ja Notice text, verbatim", () => {
    expect(i18nTs).toContain(
      '"Unified Outliner: this edit no longer matches the CompositeBlock rule. The blocks are now shown separately."'
    );
    expect(i18nTs).toContain(
      "Unified Outliner: この編集後の内容は CompositeBlock の規則に一致しません。各 block は個別に表示されます。"
    );
  });
});
