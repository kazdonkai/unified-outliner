/**
 * Phase 5D-2A ("Atomic CompositeBlock Partial Edit"): static-source-text
 * checks for the wiring this ticket added across main.ts,
 * view/PartialEditView.ts, and view/OutlineTreeView.ts.
 *
 * Phase 5D-2B ("CompositeBlock Structured Partial Edit Projection"): EXTENDED (not
 * replaced) by this ticket to also cover the structured, dual-member
 * editing this ticket added on top of Phase 5D-2A's own atomic extract/
 * apply/conflict-check backend (edit/compositeBlockPartialEdit.ts, still
 * completely unmodified). The composite-wide pane is NO LONGER
 * unconditionally raw-Markdown-only: when the loaded CompositeBlock's list
 * member and trailing callout/blockquote member can be cleanly split
 * (edit/compositeBlockMemberProjection.ts#splitCompositeBlockMembers) and
 * the trailing member successfully projects via the EXISTING, UNMODIFIED
 * edit/quotePrefixProjection.ts machinery already used for a STANDALONE
 * callout/blockquote, the pane shows a structured list-member input plus
 * the reused quote header/title/type/marker/body UI — never a second,
 * duplicated editor implementation. Any split/projection failure (an
 * unexpected member shape, a "nested" trailing member, a header-only
 * "no-body" trailing member) falls back to the original, unmodified
 * whole-range raw textarea — this file's old "always raw" assertions are
 * replaced below with assertions on this dual-mode behavior itself.
 *
 * Same constraint as tests/paragraphPartialEditViewWiring.test.ts and
 * tests/partialEditPanePlacementUiWiring.test.ts: UnifiedOutlinerPlugin
 * (extends Obsidian's Plugin), PartialEditView (extends Obsidian's
 * ItemView), and OutlineTreeView (extends Obsidian's ItemView) cannot be
 * constructed in vitest, since "obsidian" is a types-only package in this
 * repo. This file inspects the raw source text of all three files rather
 * than instantiating them.
 *
 * The real, non-Obsidian-dependent logic (extract/apply/reason-mapping,
 * and the new member-split/recompose pair) this wiring calls into is
 * unit-tested directly, with real assertions, in
 * tests/compositeBlockPartialEdit.test.ts and
 * tests/compositeBlockMemberProjection.test.ts — this file only confirms
 * the UI/command layer actually wires into that logic at the right place,
 * that the three-way nodeId/paragraphAnchor/compositeAnchor exclusivity
 * holds, that the structured composite UI reuses the existing standalone
 * quote-prefix-projection elements verbatim (never a duplicate textarea/
 * header of its own), and that a CompositeBlock member can no longer be
 * opened as its OWN standalone Partial Edit session (Phase 5D-2B's
 * atomicity requirement — see the OutlineTreeView.ts describe block near
 * the bottom of this file).
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

describe("view/PartialEditView.ts: loadCompositeInternal — dual-mode member reuse (structured when splittable+projectable, raw fallback otherwise)", () => {
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

  it("always resets quoteProjection/compositeListOriginalText to null as the raw-fallback baseline, BEFORE attempting the member split", () => {
    const body = bodyOf(viewTs, "private loadCompositeInternal(", "loadCompositeInternal");
    // Phase 5L-1 inserted its own unrelated
    // `this.standaloneListMarkerProjection = null;` reset between these
    // two lines (a CompositeBlock session never uses that field — see its
    // own doc comment), so this no longer asserts byte-adjacency; it
    // asserts the same ordering guarantee instead: both resets still
    // happen, in the same relative order, before the split is attempted.
    const quoteResetIdx = body.indexOf("this.quoteProjection = null;");
    const listResetIdx = body.indexOf("this.compositeListOriginalText = null;");
    const splitIdx = body.indexOf("splitCompositeBlockMembers(");
    expect(quoteResetIdx).toBeGreaterThan(-1);
    expect(listResetIdx).toBeGreaterThan(quoteResetIdx);
    expect(splitIdx).toBeGreaterThan(listResetIdx);
  });

  it("splits the CompositeBlock via splitCompositeBlockMembers(doc.lines, extracted.resolvedSnapshot) — pure line-slicing over the already-resolved snapshot, no new parsing", () => {
    const body = bodyOf(viewTs, "private loadCompositeInternal(", "loadCompositeInternal");
    expect(body).toContain("splitCompositeBlockMembers(doc.lines, extracted.resolvedSnapshot)");
  });

  it("on a successful split, projects the trailing member's raw text via buildQuotePrefixProjection — the exact same, unmodified function a standalone callout/blockquote already uses", () => {
    const body = bodyOf(viewTs, "private loadCompositeInternal(", "loadCompositeInternal");
    expect(body).toContain(
      "buildQuotePrefixProjection(\n        memberSplit.split.trailingRawText,\n        memberSplit.split.trailingKind\n      )"
    );
  });

  it("sets quoteProjection once the split and trailing projection succeed, and derives compositeListOriginalText from the marker-free list projection when available (Phase 5D-2C), or the raw list line otherwise", () => {
    const body = bodyOf(viewTs, "private loadCompositeInternal(", "loadCompositeInternal");
    const builtOkIdx = body.indexOf("if (built.ok) {");
    expect(builtOkIdx).toBeGreaterThan(-1);
    expect(body.slice(builtOkIdx)).toContain("this.quoteProjection = built.projection;");
    expect(body.slice(builtOkIdx)).toContain(
      "isListMemberEligibleForMarkerFreeProjection(\n          extracted.resolvedSnapshot.members[0].kind\n        )"
    );
    expect(body.slice(builtOkIdx)).toContain(
      "this.listMarkerProjection = listBuilt?.ok ? listBuilt.projection : null;"
    );
    expect(body.slice(builtOkIdx)).toContain(
      "this.compositeListOriginalText = this.listMarkerProjection\n          ? this.listMarkerProjection.body\n          : memberSplit.split.listLineText;"
    );
  });

  it("Phase 5D-2C: gates marker-free list projection via isListMemberEligibleForMarkerFreeProjection (edit/compositeBlockMemberProjection.ts), never an inline 'truthy' check", () => {
    const body = bodyOf(viewTs, "private loadCompositeInternal(", "loadCompositeInternal");
    expect(body).toContain("isListMemberEligibleForMarkerFreeProjection(");
    expect(body).not.toContain('listMemberKind === "single-line-list"');
  });

  it("never refuses to open the pane on a split/projection failure — unlike loadNodeInternal's standalone \"nested\" refusal, the pre-existing whole-range raw textarea is always a safe fallback", () => {
    const body = bodyOf(viewTs, "private loadCompositeInternal(", "loadCompositeInternal");
    // The structured attempt is a plain best-effort `if`, never gated by
    // an early `return` on failure (contrast loadNodeInternal, which DOES
    // return early for a standalone "nested" rejection).
    expect(body).not.toContain('extracted.reason === "nested"');
    expect(body).toContain("this.renderLoadedState();");
  });
});

describe("view/PartialEditView.ts: renderCompositeListSlot — structured composite list row visibility (2026-09-14: no longer labels the trailing member)", () => {
  it("is active only when nodeKind is \"composite\" AND compositeListOriginalText is non-null (never active for a raw-fallback composite session, or any other node kind)", () => {
    const body = bodyOf(viewTs, "private renderCompositeListSlot(): void {", "renderCompositeListSlot");
    expect(body).toContain(
      'const active = this.nodeKind === "composite" && this.compositeListOriginalText !== null;'
    );
  });

  it("toggles compositeListRowEl visibility and syncs compositeListInputEl's value/disabled state via the same `active` flag — no separate label element to toggle any more", () => {
    const body = bodyOf(viewTs, "private renderCompositeListSlot(): void {", "renderCompositeListSlot");
    expect(body).toContain("this.compositeListRowEl.toggleVisibility(active);");
    expect(body).toContain(
      'this.compositeListInputEl.value = active ? this.compositeListOriginalText! : "";'
    );
    expect(body).toContain("this.compositeListInputEl.disabled = !active;");
    // Real-device follow-up (2026-09-14): the redundant "List item" /
    // "Callout"/"Quote" read-only labels were removed — the pane's own
    // title and each row's own visual prefix already say the same thing.
    expect(body).not.toContain("compositeTrailingLabelEl");
    expect(body).not.toContain("compositeListLabelEl");
  });

  it("is called from renderEmptyState, renderLoadedState, applyEdit's composite success path, and performAutoReload — every state-refresh path, not just initial load", () => {
    const occurrences = viewTs.split("this.renderCompositeListSlot();").length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(4);
  });
});

describe("view/PartialEditView.ts: onOpen wires the new composite list-member row, reusing (never duplicating) the existing quote header/textarea for the trailing member", () => {
  it("creates compositeListRowEl/compositeListInputEl with the documented CSS classes, and an input listener that re-checks dirty state on every keystroke — no label element (removed 2026-09-14 as redundant with the pane title/row prefixes)", () => {
    expect(viewTs).toContain(
      'this.compositeListRowEl = this.contentEl.createDiv({\n      cls: "unified-outliner-partial-edit-composite-list-row",\n    });'
    );
    expect(viewTs).toContain(
      'this.compositeListInputEl = this.compositeListRowEl.createEl("input", {\n      type: "text",\n      cls: "unified-outliner-partial-edit-composite-list-input",\n    });'
    );
    expect(viewTs).toContain(
      'this.compositeListInputEl.addEventListener("input", () => this.updateDirtyState());'
    );
    // Real-device follow-up (2026-09-14): onOpen no longer creates any
    // label element for the list row (compositeListLabelEl removed) or
    // the trailing member (compositeTrailingLabelEl removed) — scoped to
    // this exact creation sequence rather than a whole-file search, since
    // both identifiers still legitimately appear in this file's own
    // historical doc comments explaining the removal.
    const listRowStart = viewTs.indexOf(
      'this.compositeListRowEl = this.contentEl.createDiv({'
    );
    expect(listRowStart).toBeGreaterThan(-1);
    const nextFieldAssignment = viewTs.indexOf('this.quoteHeaderEl', listRowStart);
    expect(nextFieldAssignment).toBeGreaterThan(listRowStart);
    const onOpenListRowSnippet = viewTs.slice(listRowStart, nextFieldAssignment);
    expect(onOpenListRowSnippet).not.toContain("compositeListLabelEl");
    expect(onOpenListRowSnippet).not.toContain("compositeTrailingLabelEl");
    expect(onOpenListRowSnippet).not.toContain('"partialEdit.compositeListLabel"');
  });

  it("never creates a second textarea/body editor for the trailing member — the reused textareaEl remains the only one for the composite/paragraph body", () => {
    // Exactly one <textarea> is ever created for the composite trailing
    // member's own body — the pre-existing textareaEl, reused verbatim.
    // A structured composite session must never spin up a second one for
    // ITSELF. (Phase 5L-8, 2026-09-16: a second, wholly unrelated
    // <textarea> — childInlineTextareaEl — was added for the parent
    // Partial Edit Pane's child-subtree inline structured editor. It is
    // a deliberately separate control for a selected DIRECT CHILD item,
    // never a substitute for or a second copy of the trailing member's
    // own textareaEl, so the total legitimately grew from 1 to 2. See
    // childInlineTextareaEl's own field doc comment. Phase 5L-9,
    // 2026-09-16: a THIRD, likewise wholly unrelated <textarea> —
    // newChildTextareaEl — was added for the pending NEW direct child's
    // own inline editor, a deliberately separate control from
    // childInlineTextareaEl (both must be able to show at once — see
    // ParentChildAddDeleteSession's own doc comment), so the total
    // legitimately grew from 2 to 3. See newChildTextareaEl's own field
    // doc comment.)
    const textareaCreations = viewTs.split('createEl("textarea"').length - 1;
    expect(textareaCreations).toBe(3);
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

  it("composes newCompositeText from both member editors via composeCompositeBlockMemberText for a STRUCTURED session, and falls back to this.textareaEl.value verbatim (Phase 5D-2A's original behavior) for a raw-fallback session", () => {
    const full = applyEditBody();
    const branchStart = full.indexOf("if (this.compositeAnchor) {");
    const branch = full.slice(branchStart);
    expect(branch).toContain(
      "if (this.quoteProjection && this.compositeListOriginalText !== null) {"
    );
    expect(branch).toContain(
      "newCompositeText = composeCompositeBlockMemberText(composedListLine, composedTrailingText);"
    );
    expect(branch).toContain("} else {\n        newCompositeText = this.textareaEl.value;\n      }");
  });

  it("inverts the trailing member's edited body via the exact same, unmodified invertQuotePrefixProjection the standalone branch uses — never a second, duplicated inversion", () => {
    const full = applyEditBody();
    const branchStart = full.indexOf("if (this.compositeAnchor) {");
    const branch = full.slice(branchStart);
    expect(branch).toContain(
      "invertQuotePrefixProjection(this.quoteProjection, this.textareaEl.value)"
    );
  });

  it("reconstructs the trailing member's header via the exact same, unmodified reconstructQuoteHeader used by the standalone branch, when a titleSlot is present", () => {
    const full = applyEditBody();
    const branchStart = full.indexOf("if (this.compositeAnchor) {");
    const branch = full.slice(branchStart);
    expect(branch).toContain(
      "reconstructQuoteHeader(\n            titleSlot,\n            newType,\n            newMarker,\n            this.quoteTitleInputEl.value\n          )"
    );
  });

  it("re-validates the composed trailing text in ISOLATION (a fresh parseDocument/scanComplexBlocks call, never shared mutable state) before it is ever composed with the list line", () => {
    const full = applyEditBody();
    const branchStart = full.indexOf("if (this.compositeAnchor) {");
    const branch = full.slice(branchStart);
    expect(branch).toContain("const candidateDoc = parseDocument(trailingRawText);");
    expect(branch).toContain("scanComplexBlocks(candidateDoc)");
    expect(branch).toContain('candidateBlock.editability === "supported"');
  });

  it("re-splits/re-projects its own structured state fresh after a successful Apply, mirroring the standalone branch's own post-Apply quoteProjection rebuild — a raw-fallback session stays raw, unaffected", () => {
    const full = applyEditBody();
    const branchStart = full.indexOf("if (this.compositeAnchor) {");
    const branch = full.slice(branchStart);
    expect(branch).toContain("if (composedListLine !== null && composedTrailingText !== null) {");
    expect(branch).toContain("buildQuotePrefixProjection(composedTrailingText, kind)");
  });

  it("rejects via compositePartialEditReasonText, never a plain \"reason.\" + outcome.reason concatenation", () => {
    const full = applyEditBody();
    const branchStart = full.indexOf("if (this.compositeAnchor) {");
    const branch = full.slice(branchStart);
    expect(branch).toContain("compositePartialEditReasonText(this.plugin.t.bind(this.plugin), outcome.reason)");
    expect(branch).not.toContain('("reason." + outcome.reason)');
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

describe("view/PartialEditView.ts: isDirty/cancelEdit track the structured composite list-member input", () => {
  it("isDirty is also true when compositeListOriginalText is non-null and compositeListInputEl.value differs from it (listDirty)", () => {
    const body = bodyOf(viewTs, "private isDirty(): boolean {", "isDirty");
    expect(body).toContain(
      "const listDirty =\n      this.compositeListOriginalText !== null &&\n      this.compositeListInputEl.value !== this.compositeListOriginalText;"
    );
    expect(body).toContain("listDirty");
    // Confirms it actually feeds the final OR-chain, not just computed
    // and discarded.
    const returnIdx = body.indexOf("return (");
    expect(returnIdx).toBeGreaterThan(-1);
    expect(body.slice(returnIdx)).toContain("listDirty");
  });

  it("cancelEdit's top guard also checks compositeAnchor (fixing a prior bug where Cancel was a no-op for every composite session) and reverts compositeListInputEl to compositeListOriginalText", () => {
    const body = bodyOf(viewTs, "private cancelEdit(): void {", "cancelEdit");
    expect(body).toContain(
      "if (!this.nodeId && !this.paragraphAnchor && !this.compositeAnchor) return;"
    );
    expect(body).toContain("if (this.compositeListOriginalText !== null) {");
    expect(body).toContain("this.compositeListInputEl.value = this.compositeListOriginalText;");
  });
});

describe("view/PartialEditView.ts: loadNodeInternal/loadParagraphInternal clear compositeListOriginalText on every fresh load (2026-09-14 regression fix)", () => {
  // Real-device regression: open a CompositeBlock's structured session
  // (which sets compositeListOriginalText to a non-null list-line
  // snapshot), then switch to a plain section/list node or a paragraph
  // WITHOUT editing anything. Neither loadNodeInternal nor
  // loadParagraphInternal ever ran resetLoadedState() (that only happens
  // via onClose/renderEmptyState — see resetLoadedState's own doc
  // comment), and neither of them cleared compositeListOriginalText
  // themselves, so it stayed at the previous composite's list-line text.
  // renderCompositeListSlot correctly blanks compositeListInputEl.value
  // to "" for the new, non-composite nodeKind, but isDirty()'s listDirty
  // check (`compositeListOriginalText !== null && compositeListInputEl.value
  // !== compositeListOriginalText`) then compared "" against that stale
  // non-null snapshot and read dirty on every single switch — surfacing
  // as an unconditional "unsaved changes" prompt with zero actual edits.
  it("loadNodeInternal resets compositeListOriginalText to null alongside quoteProjection, before this.label is assigned", () => {
    const body = bodyOf(viewTs, "private loadNodeInternal(nodeId: string): void {", "loadNodeInternal");
    // Phase 5L-1 inserted its own unrelated
    // `this.standaloneListMarkerProjection = standaloneListMarkerProjection;`
    // assignment directly after `this.quoteProjection = quoteProjection;`
    // (see that field's own doc comment), so the two are no longer
    // byte-adjacent; this asserts the same ordering guarantee via indices
    // instead.
    const quoteProjectionIdx = body.indexOf("this.quoteProjection = quoteProjection;");
    const resetIdx = body.indexOf("this.compositeListOriginalText = null;");
    const labelIdx = body.indexOf("this.label = label;");
    expect(quoteProjectionIdx).toBeGreaterThan(-1);
    expect(resetIdx).toBeGreaterThan(quoteProjectionIdx);
    expect(labelIdx).toBeGreaterThan(resetIdx);
  });

  it("loadParagraphInternal resets compositeListOriginalText to null alongside quoteProjection, before this.label is assigned", () => {
    const body = bodyOf(viewTs, "private loadParagraphInternal(", "loadParagraphInternal");
    const quoteProjectionIdx = body.indexOf("this.quoteProjection = null;");
    const resetIdx = body.indexOf("this.compositeListOriginalText = null;");
    const labelIdx = body.indexOf("this.label = paragraph.preview;");
    expect(quoteProjectionIdx).toBeGreaterThan(-1);
    expect(resetIdx).toBeGreaterThan(quoteProjectionIdx);
    expect(labelIdx).toBeGreaterThan(resetIdx);
  });

  it("switching from a loaded composite structured session straight into a plain node load leaves isDirty() false with zero edits (behavioral proof via the field-level contract above)", () => {
    // isDirty() itself is a private method with no exported pure
    // counterpart to unit-test directly against a real Obsidian Editor,
    // so this suite (matching every other test in this file) asserts the
    // exact field-reset contract isDirty()'s own listDirty branch relies
    // on: compositeListOriginalText === null after ANY non-composite load
    // completes, which is precisely what makes
    // `compositeListOriginalText !== null && ...` short-circuit to
    // false — see the two tests immediately above for where that reset
    // now happens in both loadNodeInternal and loadParagraphInternal.
    const isDirtyBody = bodyOf(viewTs, "private isDirty(): boolean {", "isDirty");
    expect(isDirtyBody).toContain(
      "const listDirty =\n      this.compositeListOriginalText !== null &&"
    );
    const nodeBody = bodyOf(viewTs, "private loadNodeInternal(nodeId: string): void {", "loadNodeInternal");
    const paragraphBody = bodyOf(viewTs, "private loadParagraphInternal(", "loadParagraphInternal");
    expect(nodeBody).toContain("this.compositeListOriginalText = null;");
    expect(paragraphBody).toContain("this.compositeListOriginalText = null;");
  });
});

describe("view/PartialEditView.ts: performAutoReload keeps the structured composite state in sync after an external edit", () => {
  it("re-derives compositeAnchor from extractCompositeBlockText, then re-splits/re-projects exactly like loadCompositeInternal's own initial load, before re-rendering the list slot", () => {
    const body = bodyOf(viewTs, "private performAutoReload(", "performAutoReload");
    expect(body).toContain("extractCompositeBlockText(doc, this.compositeAnchor, rules)");
    expect(body).toContain("splitCompositeBlockMembers(doc.lines, extracted.resolvedSnapshot)");
    expect(body).toContain("this.renderCompositeListSlot();");
  });

  it("degrades to the raw whole-range textarea (both fields null) on a split/projection failure here too, same as the initial load", () => {
    const body = bodyOf(viewTs, "private performAutoReload(", "performAutoReload");
    const compositeBranchStart = body.indexOf("if (this.compositeAnchor) {");
    expect(compositeBranchStart).toBeGreaterThan(-1);
    const compositeBranch = body.slice(compositeBranchStart);
    expect(compositeBranch).toContain("this.quoteProjection = null;\n        this.compositeListOriginalText = null;");
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

describe("view/OutlineTreeView.ts: showComplexMemberMenu no longer offers a standalone Partial Edit entry point for a CompositeBlock member (Phase 5D-2B atomicity)", () => {
  function showComplexMemberMenuBody(): string {
    const start = treeTs.indexOf("private showComplexMemberMenu(evt: MouseEvent, nodeId: string): void {");
    expect(start).toBeGreaterThan(-1);
    const end = treeTs.indexOf("\n  /**\n   * Phase 5C-3:", start);
    expect(end).toBeGreaterThan(start);
    return treeTs.slice(start, end);
  }

  it("no longer calls this.plugin.activatePartialEditView(nodeId) at all — a composite member can only be edited as part of its whole CompositeBlock, via showCompositeCommandMenu's activatePartialEditViewForComposite", () => {
    const body = showComplexMemberMenuBody();
    expect(body).not.toContain("this.plugin.activatePartialEditView(nodeId)");
    expect(body).not.toContain("tree.menu.openPartialEditPane");
  });

  it("still offers Move up/down, unaffected by the Partial Edit removal — evaluateStandaloneComplexBlockMovability/dispatchAndApplyStandaloneComplexBlockMove with allowComposedMember: true", () => {
    const body = showComplexMemberMenuBody();
    expect(body).toContain("evaluateStandaloneComplexBlockMovability(");
    expect(body).toContain("dispatchAndApplyStandaloneComplexBlockMove(snapshot, \"up\", rules, true)");
    expect(body).toContain("dispatchAndApplyStandaloneComplexBlockMove(snapshot, \"down\", rules, true)");
  });

  it("the standalone callout/blockquote menu (showStandaloneComplexBlockMenu) is unaffected — it still offers Partial Edit, since a genuinely standalone block has no atomicity constraint", () => {
    const start = treeTs.indexOf("private showStandaloneComplexBlockMenu(");
    expect(start).toBeGreaterThan(-1);
    const nextPrivate = treeTs.indexOf("\n  private ", start + 1);
    const body = treeTs.slice(start, nextPrivate === -1 ? undefined : nextPrivate);
    expect(body).toContain("tree.menu.openPartialEditPane");
    expect(body).toContain("void this.plugin.activatePartialEditView(nodeId)");
  });
});

describe("view/PartialEditView.ts: applyEdit's composite branch — Phase 5D-2C list-marker-free projection inversion", () => {
  function applyEditBody(): string {
    const start = viewTs.indexOf("private applyEdit(): boolean {");
    expect(start).toBeGreaterThan(-1);
    const end = viewTs.indexOf("\n  /**\n   * Real-device follow-up: Apply/Cancel", start);
    expect(end).toBeGreaterThan(start);
    return viewTs.slice(start, end);
  }

  function compositeBranch(): string {
    const full = applyEditBody();
    const branchStart = full.indexOf("if (this.compositeAnchor) {");
    expect(branchStart).toBeGreaterThan(-1);
    return full.slice(branchStart);
  }

  it("inverts the list-member input via invertListMarkerProjection ONLY when this.listMarkerProjection is set, and falls back to the raw input value verbatim for a raw-fallback list row (ordered/task-list marker, or a non-single-line-list member kind)", () => {
    const branch = compositeBranch();
    expect(branch).toContain("if (this.listMarkerProjection) {");
    expect(branch).toContain(
      "invertListMarkerProjection(\n            this.listMarkerProjection,\n            this.compositeListInputEl.value\n          )"
    );
    expect(branch).toContain("composedListLine = invertedList.rawLine;");
    expect(branch).toContain(
      "} else {\n          composedListLine = this.compositeListInputEl.value;\n        }"
    );
  });

  it("rejects Apply with the dedicated listBodyNewlineUnsupported Notice ONLY on invertListMarkerProjection failure — a genuine safety error, computed and refused BEFORE applyCompositeBlockEdit is ever called, never conflated with 方針A's own (non-rejecting) rule-mismatch outcome", () => {
    const branch = compositeBranch();
    const invertIdx = branch.indexOf("if (this.listMarkerProjection) {");
    const applyIdx = branch.indexOf("applyCompositeBlockEdit(");
    expect(invertIdx).toBeGreaterThan(-1);
    expect(applyIdx).toBeGreaterThan(invertIdx);
    const invertRegion = branch.slice(invertIdx, applyIdx);
    expect(invertRegion).toContain("if (!invertedList.ok) {");
    expect(invertRegion).toContain('this.plugin.t("partialEdit.listBodyNewlineUnsupported")');
    expect(invertRegion).toContain("return false;");
  });

  it("after a successful Apply, re-derives listMarkerProjection/compositeListOriginalText fresh from the just-composed list line, gated by the SAME composedListLine/composedTrailingText !== null check the trailing quoteProjection rebuild already uses — a raw-fallback session's fields are left null, untouched", () => {
    const branch = compositeBranch();
    const rebuildGateIdx = branch.indexOf(
      "if (composedListLine !== null && composedTrailingText !== null) {"
    );
    expect(rebuildGateIdx).toBeGreaterThan(-1);
    const rebuildRegion = branch.slice(rebuildGateIdx);
    expect(rebuildRegion).toContain("const listRebuilt = buildListMarkerProjection(composedListLine);");
    expect(rebuildRegion).toContain(
      "this.listMarkerProjection = listRebuilt.ok ? listRebuilt.projection : null;"
    );
    expect(rebuildRegion).toContain(
      "this.compositeListOriginalText = this.listMarkerProjection\n              ? this.listMarkerProjection.body\n              : composedListLine;"
    );
  });

  it("this list-marker rebuild is attempted unconditionally on any successful Apply, regardless of outcome.ruleStillMatches — 方針A itself is untouched by this ticket: the rebuild reads only composedListLine/composedTrailingText, never outcome.ruleStillMatches or outcome.resolvedSnapshot", () => {
    const branch = compositeBranch();
    const rebuildGateIdx = branch.indexOf(
      "if (composedListLine !== null && composedTrailingText !== null) {"
    );
    const ruleCheckIdx = branch.indexOf("outcome.ruleStillMatches === false");
    expect(rebuildGateIdx).toBeGreaterThan(-1);
    expect(ruleCheckIdx).toBeGreaterThan(rebuildGateIdx);
    const rebuildRegion = branch.slice(rebuildGateIdx, ruleCheckIdx);
    expect(rebuildRegion).not.toContain("outcome.ruleStillMatches");
    expect(rebuildRegion).not.toContain("outcome.resolvedSnapshot");
  });
});

describe("view/PartialEditView.ts: Cancel reverts BOTH the marker-free list-body draft and the trailing callout/blockquote draft, with no special-casing needed for Phase 5D-2C", () => {
  it("cancelEdit unconditionally reverts textareaEl (trailing member, via currentDisplayText()) and, whenever compositeListOriginalText is non-null, compositeListInputEl too — compositeListOriginalText itself already holds the marker-free body (never the raw line) whenever listMarkerProjection is active, so no listMarkerProjection-specific revert code is needed at all", () => {
    const body = bodyOf(viewTs, "private cancelEdit(): void {", "cancelEdit");
    expect(body).toContain("this.textareaEl.value = this.currentDisplayText();");
    expect(body).toContain("if (this.compositeListOriginalText !== null) {");
    expect(body).toContain("this.compositeListInputEl.value = this.compositeListOriginalText;");
    // Confirms the claim above by construction: cancelEdit's own source
    // never mentions listMarkerProjection — there is nothing it needs to
    // do differently for a marker-free list-body draft vs. a raw one.
    expect(body).not.toContain("listMarkerProjection");
  });
});

describe("i18n.ts: Phase 5D-2A/5D-2B keys", () => {
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
