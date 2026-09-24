import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Phase 5D-4C ("CompositeBlock Atomic Drag-and-Drop 最小実装", Phase 5D-4B
 * design approved): static-source-text checks for view/OutlineTreeView.ts's
 * CompositeBlock parent-row D&D wiring — same constraint as
 * tests/standaloneComplexBlockDropUiWiring.test.ts's own (an Obsidian
 * ItemView subclass cannot be constructed in vitest, since "obsidian" is a
 * types-only package here), so this file inspects the raw source text of
 * OutlineTreeView.ts rather than calling into it. Mirrors that file's own
 * structure closely — same methodBody()-style bounding helpers, same
 * "confirm the view layer wires pure logic in at the right place, narrowly"
 * scope discipline.
 *
 * The actual DECISION logic (resolveCompositeBlockDropTarget) and the
 * actual WRITE logic (dropCompositeBlock, moveCompositeBlock) are each
 * unit-tested with real assertions in tests/findCompositeBlockDropTarget.test.ts,
 * tests/dropCompositeBlock.test.ts, and tests/moveCompositeBlock.test.ts
 * respectively — this file only confirms the view layer wires that pure
 * logic in at the right place, narrowly, without widening the composite
 * parent row's existing read-only contract (rename/indent/outdent/delete/
 * member-level Move/member-level D&D/Partial Edit all stay exactly as they
 * were before this ticket).
 */
describe("Phase 5D-4C: CompositeBlock parent-row drag & drop wiring (narrow, desktop-only, v1-scope-only)", () => {
  const viewTs = readFileSync(path.resolve(__dirname, "../src/view/OutlineTreeView.ts"), "utf-8");
  const resolverTs = readFileSync(path.resolve(__dirname, "../src/move/findCompositeBlockDropTarget.ts"), "utf-8");
  const i18nTs = readFileSync(path.resolve(__dirname, "../src/i18n.ts"), "utf-8");
  const stylesCss = readFileSync(path.resolve(__dirname, "../styles.css"), "utf-8");

  function methodBody(name: string): string {
    const start = viewTs.indexOf(`private ${name}(`);
    expect(start).toBeGreaterThan(-1);
    const end = viewTs.indexOf("\n  }", start);
    expect(end).toBeGreaterThan(start);
    return viewTs.slice(start, end);
  }

  /**
   * Bounds the CompositeBlock parent-row drag-wiring branch from its own
   * condition to the "if (hasChildren..." landmark that unconditionally
   * follows the whole renderNode drag-wiring if/else-if chain — mirrors
   * tests/outlineTreeDragPayloadSafety.test.ts's own getDragWiringChainRange
   * bounding strategy (that file independently verifies this same landmark
   * is unique in the file).
   *
   * Phase 5D-4D (docs/phase5d4d_mobile_composite_block_drag_handle_design.md):
   * the branch's own gate widened from `isComposite && !Platform.isMobile`
   * to plain `isComposite` (mobile is no longer excluded). The bare string
   * "} else if (isComposite) {" is NOT globally unique in this file (an
   * unrelated label-rendering branch and an unrelated desktop contextmenu
   * branch, both earlier in renderNode, also match it) — so the search for
   * the branch's start is scoped to [chainStart, chainEnd) first.
   */
  function compositeBranchBody(): string {
    const chainStart = viewTs.indexOf("if (!readOnly) {\n      if (Platform.isMobile) {");
    expect(chainStart).toBeGreaterThan(-1);
    const chainEnd = viewTs.indexOf("\n    if (hasChildren && !isCollapsed) {", chainStart);
    expect(chainEnd).toBeGreaterThan(chainStart);
    const wholeChain = viewTs.slice(chainStart, chainEnd);
    const startInChain = wholeChain.indexOf("} else if (isComposite) {");
    expect(startInChain).toBeGreaterThan(-1);
    const start = chainStart + startInChain;
    return viewTs.slice(start, chainEnd);
  }

  /** The other four drag-wiring branches (section/list, paragraph, standalone callout/blockquote, composite-member callout/blockquote), as ONE combined text range preceding the composite branch. */
  function nonCompositeDragWiringBranchesBody(): string {
    const chainStart = viewTs.indexOf("if (!readOnly) {\n      if (Platform.isMobile) {");
    expect(chainStart).toBeGreaterThan(-1);
    const chainEnd = viewTs.indexOf("\n    if (hasChildren && !isCollapsed) {", chainStart);
    const wholeChain = viewTs.slice(chainStart, chainEnd);
    const compositeStart = chainStart + wholeChain.indexOf("} else if (isComposite) {");
    expect(compositeStart).toBeGreaterThan(chainStart);
    return viewTs.slice(chainStart, compositeStart);
  }

  it("declares compositeDragSession as a field SEPARATE from dragSourceId, paragraphDragSession, and calloutDragSession", () => {
    expect(viewTs).toContain("private compositeDragSession: CompositeDragSession | null = null;");
    expect(viewTs).toContain("interface CompositeDragSession {");
    const ifaceStart = viewTs.indexOf("interface CompositeDragSession {");
    const ifaceEnd = viewTs.indexOf("\n}", ifaceStart);
    const iface = viewTs.slice(ifaceStart, ifaceEnd);
    expect(iface).toContain("snapshot: CompositeBlockSnapshot;");
    expect(iface).toContain("sourceTreeNodeId: string;");
  });

  it("endDrag() clears all FOUR session fields unconditionally — dragSourceId, paragraphDragSession, calloutDragSession, AND compositeDragSession — this is the sole unconditional-clear point for every drag kind", () => {
    const body = methodBody("endDrag");
    expect(body).toContain("this.dragSourceId = null;");
    expect(body).toContain("this.paragraphDragSession = null;");
    expect(body).toContain("this.calloutDragSession = null;");
    expect(body).toContain("this.compositeDragSession = null;");
  });

  it("cancelCompositeDrag() is a no-op when no composite drag is active — mirrors cancelParagraphDrag()/cancelCalloutDrag() exactly, never disturbing an in-progress drag of another kind", () => {
    const body = methodBody("cancelCompositeDrag");
    expect(body).toContain("if (!this.compositeDragSession) return;");
    expect(body).toContain("this.endDrag();");
    expect(body).toContain("this.clearDropIndicator();");
  });

  it("refresh() cancels any in-progress composite drag UNCONDITIONALLY, immediately after cancelParagraphDrag()/cancelCalloutDrag() and before even the renameState early-return — so every refresh() trigger reliably tears a stale composite drag down too", () => {
    const start = viewTs.indexOf("refresh(): void {");
    expect(start).toBeGreaterThan(-1);
    const renameGuardIdx = viewTs.indexOf("if (this.renameState) return;", start);
    const paragraphCancelIdx = viewTs.indexOf("this.cancelParagraphDrag();", start);
    const calloutCancelIdx = viewTs.indexOf("this.cancelCalloutDrag();", start);
    const compositeCancelIdx = viewTs.indexOf("this.cancelCompositeDrag();", start);
    expect(paragraphCancelIdx).toBeGreaterThan(start);
    expect(calloutCancelIdx).toBeGreaterThan(paragraphCancelIdx);
    expect(compositeCancelIdx).toBeGreaterThan(calloutCancelIdx);
    expect(renameGuardIdx).toBeGreaterThan(compositeCancelIdx);
  });

  it("onClose() also cancels any in-progress composite drag session before tearing down the view's DOM, after cancelParagraphDrag()/cancelCalloutDrag()", () => {
    const start = viewTs.indexOf("async onClose(): Promise<void> {");
    expect(start).toBeGreaterThan(-1);
    const end = viewTs.indexOf("this.contentEl.empty();", start);
    const body = viewTs.slice(start, end);
    const paragraphCancelIdx = body.indexOf("this.cancelParagraphDrag();");
    const calloutCancelIdx = body.indexOf("this.cancelCalloutDrag();");
    const compositeCancelIdx = body.indexOf("this.cancelCompositeDrag();");
    expect(paragraphCancelIdx).toBeGreaterThan(-1);
    expect(calloutCancelIdx).toBeGreaterThan(paragraphCancelIdx);
    expect(compositeCancelIdx).toBeGreaterThan(calloutCancelIdx);
  });


  it("the CompositeBlock parent-row branch (isComposite) wires ALL FIVE of dragstart/dragover/drop/dragend/draggable, using handleCompositeDragStart/handleCompositeDragOverNode/handleCompositeDropNode/handleDragEnd — the dragstart/dragover/dragleave/drop/dragend listener registrations themselves are unchanged from Phase 5D-4C", () => {
    const branch = compositeBranchBody();
    expect(branch).toContain("this.handleCompositeDragStart(evt, node.id, itemEl)");
    expect(branch).toContain("if (this.compositeDragSession) this.handleCompositeDragOverNode(evt, node, selfEl);");
    expect(branch).toContain("if (!this.compositeDragSession) return;");
    expect(branch).toContain("this.handleCompositeDropNode(session, evt, node, selfEl);");
    expect(branch).toContain("this.handleDragEnd()");
  });

  it("the composite branch is gated ONLY by isComposite — never Platform.isMobile, isComplexMember, isOutlineParagraphNode, or readOnly at the OUTER gate — proving it is a wholly separate branch, open to both platforms (Phase 5D-4D widens Phase 5D-4C's desktop-only gate to admit mobile too)", () => {
    expect(viewTs).not.toContain("} else if (isComposite && !Platform.isMobile) {");
    const branch = compositeBranchBody();
    expect(branch).not.toContain("isComplexMember");
    expect(branch).not.toContain("isOutlineParagraphNode");
    const codeOnly = branch
      .split("\n")
      .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
      .join("\n");
    expect(codeOnly).not.toContain("!readOnly");
    expect(codeOnly).not.toContain("readOnly &&");
  });

  it("Phase 5D-4D: the composite branch's draggable attribute follows the EXACT SAME platform split as section/list's own UXP-01 handle wiring — dragHandleEl on mobile, selfEl on desktop — reusing the existing dragHandleEl instance, never a new element", () => {
    const branch = compositeBranchBody();
    const ifIdx = branch.indexOf("if (Platform.isMobile) {");
    expect(ifIdx).toBeGreaterThan(-1);
    const dragstartIdx = branch.indexOf('selfEl.addEventListener("dragstart"');
    expect(dragstartIdx).toBeGreaterThan(ifIdx);
    // The platform-split block must be the thing that IMMEDIATELY precedes
    // the dragstart listener registration — i.e. no unconditional (both-
    // platform) `selfEl.setAttribute("draggable", "true");` line sits
    // between them, the way Phase 5D-4C originally had at the top of this
    // branch.
    const between = branch.slice(ifIdx, dragstartIdx);
    expect(between).toContain('dragHandleEl?.setAttribute("draggable", "true");');
    expect(between).toContain('selfEl.setAttribute("draggable", "true");');
    expect(between.trim().startsWith("if (Platform.isMobile) {")).toBe(true);
  });

  it("Phase 5D-4D: dragHandleEl's own generation condition widens from `!readOnly` to `!readOnly || isComposite` (further widened by two 2026-09-24 mobile follow-up fixes to also admit isEligibleStandaloneComplexMember and isParagraph) — CompositeBlock parent rows now get the handle even though they stay readOnly; a plain composite-member row that is neither an eligible standalone complex-member kind nor a paragraph still gets none", () => {
    const start = viewTs.indexOf("let dragHandleEl: HTMLElement | null = null;");
    expect(start).toBeGreaterThan(-1);
    const end = viewTs.indexOf("// Inline rename trigger", start);
    expect(end).toBeGreaterThan(start);
    const body = viewTs.slice(start, end);
    expect(body).toContain(
      "if (!readOnly || isComposite || isEligibleStandaloneComplexMember || isParagraph) {"
    );
    expect(body).not.toContain("if (!readOnly) {\n      dragHandleEl = selfEl.createDiv");
  });

  it("Phase 5D-4D: the composite-only long-press block (isComposite && Platform.isMobile) now excludes a handle-origin touch from arming its timer, mirroring the generic !readOnly && Platform.isMobile block's own dragHandleEl exclusion guard exactly", () => {
    const start = viewTs.indexOf("if (isComposite && Platform.isMobile) {");
    expect(start).toBeGreaterThan(-1);
    const end = viewTs.indexOf("selfEl.addEventListener(\"pointerup\", clearLongPressTimer);", start);
    expect(end).toBeGreaterThan(start);
    const body = viewTs.slice(start, end);
    expect(body).toContain('if (dragHandleEl && dragHandleEl.contains(evt.target as Node)) return;');
  });

  it("member/complex-member/paragraph/section/plain-list rows never get CompositeBlock-specific wiring — handleCompositeDragStart/handleCompositeDragOverNode/handleCompositeDropNode appear NOWHERE in the four PRECEDING drag-wiring branches (section/list, paragraph, standalone callout/blockquote, composite-member callout/blockquote)", () => {
    const others = nonCompositeDragWiringBranchesBody();
    expect(others).not.toContain("handleCompositeDragStart");
    expect(others).not.toContain("handleCompositeDragOverNode");
    expect(others).not.toContain("handleCompositeDropNode");
    expect(others).not.toContain("compositeDragSession");
  });

  it("every occurrence of handleCompositeDragStart/handleCompositeDragOverNode/handleCompositeDropNode inside renderNode's whole drag-wiring chain (code AND doc comments) is CONFINED to the composite branch — none leaks into the four preceding branches — position-based proof mirroring outlineTreeDragPayloadSafety.test.ts's own single-occurrence discipline", () => {
    const chainStart = viewTs.indexOf("if (!readOnly) {\n      if (Platform.isMobile) {");
    const chainEnd = viewTs.indexOf("\n    if (hasChildren && !isCollapsed) {", chainStart);
    const wholeChain = viewTs.slice(chainStart, chainEnd);
    const composite = compositeBranchBody();
    for (const name of ["handleCompositeDragStart", "handleCompositeDragOverNode", "handleCompositeDropNode"]) {
      const chainCount = (wholeChain.match(new RegExp(name, "g")) ?? []).length;
      const compositeCount = (composite.match(new RegExp(name, "g")) ?? []).length;
      expect(chainCount).toBeGreaterThan(0);
      expect(chainCount).toBe(compositeCount);
    }
  });

  it("computeCompositeDropZone is a two-way (before/after) split — never 'inside'; the CompositeBlockDropZone type it returns (declared independently in move/findCompositeBlockDropTarget.ts) also has no 'inside' member", () => {
    const body = methodBody("computeCompositeDropZone");
    expect(body).not.toContain("inside");
    expect(body).toContain('"before"');
    expect(body).toContain('"after"');
    const zoneTypeStart = resolverTs.indexOf("export type CompositeBlockDropZone");
    expect(zoneTypeStart).toBeGreaterThan(-1);
    const zoneTypeEnd = resolverTs.indexOf(";", zoneTypeStart);
    const zoneType = resolverTs.slice(zoneTypeStart, zoneTypeEnd);
    expect(zoneType).not.toContain("inside");
    expect(zoneType).toContain('"before"');
    expect(zoneType).toContain('"after"');
  });

  it("compositeDropTargetHint recognizes ONLY a plain list row (isOutlineListNode) or another CompositeBlock's own parent row (isOutlineCompositeNode) as a valid v1 target — section/paragraph/complex-member rows are never even checked", () => {
    const body = methodBody("compositeDropTargetHint");
    expect(body).toContain("isOutlineListNode(node)");
    expect(body).toContain("isOutlineCompositeNode(node)");
    expect(body).not.toContain("isOutlineSectionNode");
    expect(body).not.toContain('"paragraph"');
    expect(body).not.toContain('"complex-member"');
    expect(body).not.toContain("isComplexMember");
  });

  it("compositeDropTargetHint widens a CompositeBlock-row target to that OTHER composite's own FULL range (not just its anchor row) — the widening the resolver itself deliberately does not perform (see resolveCompositeBlockDropTarget's own doc comment: 'No widening of a plain-list-item target into some OTHER composite's own range either — that is the caller's job')", () => {
    const body = methodBody("compositeDropTargetHint");
    expect(body).toContain("composite.range.startLine");
    expect(body).toContain("composite.range.endLine");
    const resolverDoc = resolverTs.slice(0, resolverTs.indexOf("import {"));
    const normalizedDoc = resolverDoc.replace(/\n\s*\*\s?/g, " ");
    expect(normalizedDoc).toContain(
      "No widening of a plain-list-item target into some OTHER composite's own range either — that is the caller's job"
    );
  });

  it("handleCompositeDragStart uses the same empty-string setData sentinel convention as every other dragstart handler in this file, and never leaks the composite's internal id as literal drag payload text", () => {
    const body = methodBody("handleCompositeDragStart");
    expect(body).toContain('evt.dataTransfer.setData("text/plain", "");');
    expect(body).toContain('evt.dataTransfer.effectAllowed = "move";');
    expect(body).toContain("this.compositeDragSession = { snapshot, sourceTreeNodeId: compositeId };");
  });

  it("handleCompositeDragOverNode decides legality via resolveCompositeBlockDropTarget — never by reimplementing the resolver's own arithmetic inline — and handleCompositeDropNode delegates entirely to dispatchAndApplyCompositeDrop", () => {
    const overBody = methodBody("handleCompositeDragOverNode");
    expect(overBody).toContain("resolveCompositeBlockDropTarget(doc, source, composites, candidate, zone)");
    const dropBody = methodBody("handleCompositeDropNode");
    expect(dropBody).toContain("this.dispatchAndApplyCompositeDrop(session.snapshot, target, zone, rules)");
  });

  it("dispatchAndApplyCompositeDrop calls BOTH moveCompositeBlock (adjacent case) and dropCompositeBlock (non-adjacent case) from two DIFFERENT branches — the two executors are never unified into one, and the routing itself is never treated as safety-critical (both re-verify independently)", () => {
    const body = methodBody("dispatchAndApplyCompositeDrop");
    expect(body).toContain("moveCompositeBlock(text, { snapshot, direction }, rules)");
    expect(body).toContain("dropCompositeBlock(text, { snapshot, target, zone }, rules)");
    expect(body).toContain("findCompositeMoveTarget(doc, complexScan, resolvedSource, direction, composites)");
    expect(body).toContain("isAdjacentMatch");
    expect(body).not.toContain("insertBlockAt(");
    expect(body).not.toContain("swapBlocks(");
  });

  it("dispatchAndApplyCompositeDrop's notify callback is intentionally a no-op — CompositeBlock D&D is a silent rejection, matching every other existing D&D path (section/list, paragraph, callout/blockquote); no new Notice/i18n call was added for a rejected drop", () => {
    const body = methodBody("dispatchAndApplyCompositeDrop");
    const notifyIdx = body.indexOf("() => {");
    expect(notifyIdx).toBeGreaterThan(-1);
    const notifyBody = body.slice(notifyIdx, body.indexOf("}", notifyIdx) + 1);
    expect(notifyBody).not.toContain("this.notify(");
    expect(notifyBody).not.toContain("this.plugin.t(");
  });

  it("no new i18n key exists anywhere in i18n.ts for a CompositeBlockDropRejectReason (composite-internal-boundary or any other reason) — confirms this ticket introduced no translated rejection message", () => {
    expect(i18nTs).not.toContain("compositeBlockDrop");
    expect(i18nTs).not.toContain("compositeDropReject");
  });

  it("CompositeBlockDropRejectReason (move/findCompositeBlockDropTarget.ts) reuses the exact same string values as CompositeBlockMoveRejectionReason and StandaloneComplexBlockDropRejectReason for shared conditions, and introduces no unlisted reason such as 'invalid-target' or 'ambiguous-target'", () => {
    const typeStart = resolverTs.indexOf("export type CompositeBlockDropRejectReason");
    expect(typeStart).toBeGreaterThan(-1);
    const typeEnd = resolverTs.indexOf(";", typeStart);
    const type = resolverTs.slice(typeStart, typeEnd);
    expect(type).toContain('"nested-in-list"');
    expect(type).toContain('"unsafe-indent"');
    expect(type).toContain('"self-drop"');
    expect(type).toContain('"different-parent-or-depth"');
    expect(type).toContain('"composite-internal-boundary"');
    expect(type).not.toContain("invalid-target");
    expect(type).not.toContain("ambiguous-target");
    expect(type).not.toContain("not-same-section");
  });

  it("handleDragOver and handleDrop (section/list rows) both check this.compositeDragSession FIRST — before this.calloutDragSession and before the pre-existing dragSourceId-based section/list logic — so a CompositeBlock drag hovering/dropped-on a plain list row is resolved through the shared composite core ahead of every other path", () => {
    const overBody = methodBody("handleDragOver");
    const overCompositeIdx = overBody.indexOf("if (this.compositeDragSession) {");
    const overCalloutIdx = overBody.indexOf("if (this.calloutDragSession) {");
    const overDragSourceIdx = overBody.indexOf("if (!this.dragSourceId || !this.currentDoc) return;");
    expect(overCompositeIdx).toBeGreaterThan(-1);
    expect(overCalloutIdx).toBeGreaterThan(overCompositeIdx);
    expect(overDragSourceIdx).toBeGreaterThan(overCalloutIdx);
    expect(overBody).toContain("this.handleCompositeDragOverNode(evt, node, selfEl);");

    const dropBody = methodBody("handleDrop");
    const dropCompositeIdx = dropBody.indexOf("if (this.compositeDragSession) {");
    const dropCalloutIdx = dropBody.indexOf("if (this.calloutDragSession) {");
    const dropSourceIdx = dropBody.indexOf("const sourceId = this.dragSourceId;");
    expect(dropCompositeIdx).toBeGreaterThan(-1);
    expect(dropCalloutIdx).toBeGreaterThan(dropCompositeIdx);
    expect(dropSourceIdx).toBeGreaterThan(dropCalloutIdx);
    expect(dropBody).toContain("this.handleCompositeDropNode(session, evt, node, selfEl);");
  });

  it("no rename/delete/insert/indent/outdent/Tree-Partial-Edit affordance was introduced anywhere in the new composite D&D methods — the only capability added is a drop, delegated entirely to dispatchAndApplyCompositeDrop", () => {
    const methodNames = [
      "compositeSnapshotMatches",
      "resolveCompositeDragSource",
      "compositeDropTargetHint",
      "resolveCompositeDropCandidate",
      "handleCompositeDragStart",
      "handleCompositeDragOverNode",
      "handleCompositeDropNode",
      "computeCompositeDropZone",
      "cancelCompositeDrag",
    ];
    const forbidden = [
      "beginRenameForNode",
      "deleteBlock(",
      "insertBlock",
      "indentBlock",
      "outdentBlock",
      "PartialEditView",
      "activatePartialEditView",
    ];
    for (const name of methodNames) {
      const body = methodBody(name);
      for (const bad of forbidden) {
        expect(body).not.toContain(bad);
      }
    }
  });

  it("styles.css's existing drop-indicator classes are REUSED as-is for CompositeBlock D&D — no new composite-specific CSS class was introduced", () => {
    expect(stylesCss).toContain(".unified-outliner-dragging");
    expect(stylesCss).toContain(".unified-outliner-drop-before");
    expect(stylesCss).toContain(".unified-outliner-drop-after");
  });

  it("buildOutlineTree.ts needed no changes for this ticket's new composite drag methods — they never call buildOutlineTree/collectReadOnlyOutlineNodeIds themselves", () => {
    for (const name of [
      "compositeDropTargetHint",
      "handleCompositeDragStart",
      "resolveCompositeDragSource",
      "resolveCompositeDropCandidate",
    ]) {
      const body = methodBody(name);
      expect(body).not.toContain("buildOutlineTree(");
      expect(body).not.toContain("collectReadOnlyOutlineNodeIds");
    }
  });

  it("non-regression: the three PRE-EXISTING drag-source dragstart handlers (section/list, paragraph, callout/blockquote) and their own cancel methods are all still present, unweakened, alongside the new composite ones — five dragstart wiring sites total (1 section/list + 1 paragraph + 2 callout/blockquote + 1 composite)", () => {
    expect(viewTs).toContain("this.handleDragStart(evt, node.id, itemEl)");
    expect(viewTs).toContain("this.handleParagraphDragStart(evt, node, itemEl)");
    const calloutStartCount = (viewTs.match(/this\.handleCalloutDragStart\(evt, node, itemEl\)/g) ?? []).length;
    expect(calloutStartCount).toBe(2);
    expect(viewTs).toContain("this.handleCompositeDragStart(evt, node.id, itemEl)");
    expect(viewTs).toContain("private cancelParagraphDrag(");
    expect(viewTs).toContain("private cancelCalloutDrag(");
    expect(viewTs).toContain("private cancelCompositeDrag(");
  });

  it("non-regression: member-level operations (rename, indent, outdent, delete, member-level Move via showCompositeCommandMenu, member-level D&D via handleCalloutDragStart on a composite-member row, and Partial Edit) are untouched by this ticket — buildCompositeBlockSnapshot is reused as-is by BOTH the pre-existing command menu and the new dragstart handler, never duplicated", () => {
    expect(viewTs).toContain("showCompositeCommandMenu");
    const buildSnapshotCount = (viewTs.match(/buildCompositeBlockSnapshot\(/g) ?? []).length;
    expect(buildSnapshotCount).toBeGreaterThanOrEqual(2);
    expect(viewTs).toContain("activatePartialEditView");
  });
});
