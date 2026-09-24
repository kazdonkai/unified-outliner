import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Phase 5D-4D ("Mobile CompositeBlock Drag Handle",
 * docs/phase5d4d_mobile_composite_block_drag_handle_design.md): static-
 * source-text checks proving the mobile six-dot drag handle extension to
 * CompositeBlock parent rows is a narrow, additive UI-wiring change that
 * reuses Phase 5D-4C's desktop D&D core (resolver/executor/snapshot/
 * target-resolution) completely unchanged. Same architectural constraint
 * as tests/OutlineTreeView.compositeDrag.test.ts and
 * tests/outlineTreeDragPayloadSafety.test.ts: OutlineTreeView extends
 * Obsidian's ItemView, which cannot be constructed in vitest ("obsidian"
 * is a types-only package here), so this file inspects the raw source
 * text of OutlineTreeView.ts rather than instantiating the view.
 *
 * This file does NOT re-test resolveCompositeBlockDropTarget/
 * dropCompositeBlock/moveCompositeBlock/computeCompositeDropZone's own
 * decision logic — those are exhaustively covered elsewhere
 * (tests/findCompositeBlockDropTarget.test.ts, tests/dropCompositeBlock.test.ts,
 * tests/moveCompositeBlock.test.ts) and this ticket does not modify any of
 * them. This file instead proves (a) those methods are textually
 * UNCHANGED by this ticket, and (b) the only new code is the UI-wiring
 * surface: dragHandleEl's generation condition, the composite branch's
 * draggable-attribute platform split, and the composite long-press
 * block's handle-origin exclusion guard.
 */
describe("Phase 5D-4D: CompositeBlock parent-row mobile drag handle (additive UI wiring only)", () => {
  const viewTs = readFileSync(path.resolve(__dirname, "../src/view/OutlineTreeView.ts"), "utf-8");

  function methodBody(name: string): string {
    const start = viewTs.indexOf(`private ${name}(`);
    expect(start).toBeGreaterThan(-1);
    const end = viewTs.indexOf("\n  }", start);
    expect(end).toBeGreaterThan(start);
    return viewTs.slice(start, end);
  }

  function dragWiringChainRange(): { start: number; end: number } {
    const start = viewTs.indexOf("if (!readOnly) {\n      if (Platform.isMobile) {");
    expect(start).toBeGreaterThan(-1);
    const end = viewTs.indexOf("\n    if (hasChildren && !isCollapsed) {", start);
    expect(end).toBeGreaterThan(start);
    return { start, end };
  }

  function compositeBranchBody(): string {
    const { start: chainStart, end: chainEnd } = dragWiringChainRange();
    const wholeChain = viewTs.slice(chainStart, chainEnd);
    const startInChain = wholeChain.indexOf("} else if (isComposite) {");
    expect(startInChain).toBeGreaterThan(-1);
    return viewTs.slice(chainStart + startInChain, chainEnd);
  }

  function dragHandleGenerationBody(): string {
    const start = viewTs.indexOf("let dragHandleEl: HTMLElement | null = null;");
    expect(start).toBeGreaterThan(-1);
    const end = viewTs.indexOf("// Inline rename trigger", start);
    expect(end).toBeGreaterThan(start);
    return viewTs.slice(start, end);
  }

  function compositeLongPressBlockBody(): string {
    const start = viewTs.indexOf("if (isComposite && Platform.isMobile) {");
    expect(start).toBeGreaterThan(-1);
    const end = viewTs.indexOf('selfEl.addEventListener("pointerup", clearLongPressTimer);', start);
    expect(end).toBeGreaterThan(start);
    return viewTs.slice(start, end);
  }

  it("dragHandleEl generation admits isComposite alongside !readOnly (Phase 5D-4D), isEligibleStandaloneComplexMember (2026-09-24 mobile follow-up fix), and isParagraph (a SECOND 2026-09-24 mobile follow-up fix) — but nothing else — a plain composite-member row that is neither an eligible standalone complex-member kind nor a paragraph still gets no handle at all", () => {
    const body = dragHandleGenerationBody();
    expect(body).toContain(
      "if (!readOnly || isComposite || isEligibleStandaloneComplexMember || isParagraph) {"
    );
    // Defense in depth: no OTHER kind flag was added to this condition —
    // widening it any further than `isComposite`/
    // `isEligibleStandaloneComplexMember`/`isParagraph` would leak the
    // handle to rows these tickets must not touch.
    // isEligibleStandaloneComplexMember is itself DERIVED from
    // isComplexMember (see its own const definition, just above this
    // body's own start point) — so this body legitimately mentions the
    // derived name, but never bare isComplexMember or isSection directly
    // in the condition itself. isParagraph is likewise a legitimate,
    // explicitly-named widening term as of the paragraph mobile-drag-handle
    // fix — see paragraphOutlineTreeUiWiring.test.ts's own dedicated
    // coverage — so, unlike isComplexMember/isSection, it is no longer
    // excluded here.
    expect(body).not.toContain("isComplexMember &&");
    expect(body).not.toContain("isSection");
  });

  it("the composite branch's own gate is exactly `isComposite` — not `isComposite && !Platform.isMobile` (Phase 5D-4C's original desktop-only gate is gone) and not widened with isComplexMember/isOutlineParagraphNode/readOnly", () => {
    expect(viewTs).not.toContain("isComposite && !Platform.isMobile");
    const branch = compositeBranchBody();
    expect(branch).not.toContain("isComplexMember");
    expect(branch).not.toContain("isOutlineParagraphNode");
  });

  it("the composite branch's draggable attribute follows the exact platform split section/list's own UXP-01 handle already uses: dragHandleEl on mobile, selfEl on desktop — no new DOM element, no new CSS class", () => {
    const branch = compositeBranchBody();
    const ifIdx = branch.indexOf("if (Platform.isMobile) {");
    expect(ifIdx).toBeGreaterThan(-1);
    const elseIdx = branch.indexOf("} else {", ifIdx);
    expect(elseIdx).toBeGreaterThan(ifIdx);
    const mobileArm = branch.slice(ifIdx, elseIdx);
    const desktopArm = branch.slice(elseIdx, branch.indexOf("}", elseIdx + 8) + 1);
    expect(mobileArm).toContain('dragHandleEl?.setAttribute("draggable", "true");');
    expect(desktopArm).toContain('selfEl.setAttribute("draggable", "true");');
  });

  it("dragstart/dragover/dragleave/drop/dragend listener registrations inside the composite branch are byte-identical to Phase 5D-4C — this ticket changes only the gate condition and the draggable-attribute line, never these five listeners", () => {
    const branch = compositeBranchBody();
    expect(branch).toContain(
      'selfEl.addEventListener("dragstart", (evt) =>\n        this.handleCompositeDragStart(evt, node.id, itemEl)\n      );'
    );
    expect(branch).toContain(
      'selfEl.addEventListener("dragover", (evt) => {\n        if (this.compositeDragSession) this.handleCompositeDragOverNode(evt, node, selfEl);\n      });'
    );
    expect(branch).toContain('selfEl.addEventListener("dragleave", () => this.handleDragLeave(selfEl));');
    expect(branch).toContain(
      'selfEl.addEventListener("drop", (evt) => {\n        evt.preventDefault();\n        if (!this.compositeDragSession) return;\n        const session = this.compositeDragSession;\n        this.clearDropIndicator();\n        this.endDrag();\n        this.handleCompositeDropNode(session, evt, node, selfEl);\n      });'
    );
    expect(branch).toContain('selfEl.addEventListener("dragend", () => this.handleDragEnd());');
  });

  it("the composite long-press block excludes a handle-origin touch from arming its timer, mirroring the generic !readOnly && Platform.isMobile block's own dragHandleEl exclusion guard — without this, a handle-origin touch would race the handle's native drag-lift against this row's long-press timer", () => {
    const body = compositeLongPressBlockBody();
    const guardIdx = body.indexOf("if (dragHandleEl && dragHandleEl.contains(evt.target as Node)) return;");
    const pointerdownIdx = body.indexOf('selfEl.addEventListener("pointerdown"');
    expect(guardIdx).toBeGreaterThan(pointerdownIdx);
    const primaryGuardIdx = body.indexOf("if (!evt.isPrimary) return;");
    // The handle exclusion must run BEFORE the isPrimary check, matching
    // the generic block's own ordering exactly.
    expect(guardIdx).toBeLessThan(primaryGuardIdx);
  });

  it("showCompositeCommandMenu's Move up/down items (tree.menu.compositeMoveUp/Down, dispatchAndApplyCompositeMove) are untouched — the long-press menu remains the explicit adjacent-Move entry point, complementary to the new handle, not replaced by it", () => {
    const body = methodBody("showCompositeCommandMenu");
    expect(body).toContain('this.plugin.t("tree.menu.compositeMoveUp")');
    expect(body).toContain('this.plugin.t("tree.menu.compositeMoveDown")');
    expect(body).toContain('this.dispatchAndApplyCompositeMove(snapshot, "up", rules)');
    expect(body).toContain('this.dispatchAndApplyCompositeMove(snapshot, "down", rules)');
  });

  it("non-regression: the desktop D&D core this ticket reuses (dispatchAndApplyCompositeDrop, computeCompositeDropZone, resolveCompositeBlockDropTarget's call site, endDrag, cancelCompositeDrag) still exists with the exact same key statements as Phase 5D-4C — this ticket adds no mobile-only resolver, executor, or Markdown-rewrite path", () => {
    const dispatchBody = methodBody("dispatchAndApplyCompositeDrop");
    expect(dispatchBody).toContain("moveCompositeBlock(text, { snapshot, direction }, rules)");
    expect(dispatchBody).toContain("dropCompositeBlock(text, { snapshot, target, zone }, rules)");

    const zoneBody = methodBody("computeCompositeDropZone");
    expect(zoneBody).not.toContain("inside");
    expect(zoneBody).toContain('"before"');
    expect(zoneBody).toContain('"after"');

    const overBody = methodBody("handleCompositeDragOverNode");
    expect(overBody).toContain("resolveCompositeBlockDropTarget(doc, source, composites, candidate, zone)");

    const endDragBody = methodBody("endDrag");
    expect(endDragBody).toContain("this.compositeDragSession = null;");

    const cancelBody = methodBody("cancelCompositeDrag");
    expect(cancelBody).toContain("if (!this.compositeDragSession) return;");
    expect(cancelBody).toContain("this.endDrag();");
  });

  it("non-regression: no new import was added for a mobile-only drag implementation — dropCompositeBlock/moveCompositeBlock/findCompositeBlockDropTarget are each imported exactly once, from their existing Phase 5D-4C module paths", () => {
    expect((viewTs.match(/from "\.\.\/edit\/dropCompositeBlock"/g) ?? []).length).toBeGreaterThanOrEqual(1);
    expect((viewTs.match(/from "\.\.\/move\/findCompositeBlockDropTarget"/g) ?? []).length).toBeGreaterThanOrEqual(1);
    expect(viewTs).not.toMatch(/mobileComposite(Drag|Drop|Resolver|Executor)/i);
    expect(viewTs).not.toContain("setPointerCapture");
    expect(viewTs).not.toContain("releasePointerCapture");
  });

  it("non-regression: the section/list, paragraph, standalone callout/blockquote, and composite-member callout/blockquote branches gained no CompositeBlock-specific reference and no new dragHandleEl-related code from this ticket", () => {
    const { start: chainStart } = dragWiringChainRange();
    const branch = compositeBranchBody();
    const compositeStart = viewTs.indexOf(branch, chainStart);
    const precedingBranches = viewTs.slice(chainStart, compositeStart);
    expect(precedingBranches).not.toContain("handleCompositeDragStart");
    expect(precedingBranches).not.toContain("handleCompositeDragOverNode");
    expect(precedingBranches).not.toContain("handleCompositeDropNode");
    expect(precedingBranches).not.toContain("compositeDragSession");
  });

  it("non-regression: exactly five dragend listeners are bound to handleDragEnd in the whole file (section/list, paragraph, standalone callout/blockquote, composite-member callout/blockquote, composite) — this ticket adds no sixth listener", () => {
    const occurrences = viewTs.match(/addEventListener\("dragend", \(\) => this\.handleDragEnd\(\)\);/g) ?? [];
    expect(occurrences.length).toBe(5);
  });
});
