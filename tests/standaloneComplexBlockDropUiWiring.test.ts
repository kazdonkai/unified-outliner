import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Phase 5D-3C ("Callout and Blockquote Drag and Drop", 案A approved):
 * static-source-text checks for view/OutlineTreeView.ts's callout/
 * blockquote D&D wiring — same constraint as
 * tests/paragraphOutlineTreeUiWiring.test.ts's own Phase 5T-2 describe
 * block (an Obsidian ItemView subclass cannot be constructed in vitest,
 * since "obsidian" is a types-only package here), so this file inspects
 * the raw source text of OutlineTreeView.ts rather than calling into it.
 *
 * The actual DECISION logic (resolveStandaloneComplexBlockDropTarget) and
 * the actual WRITE logic (dropStandaloneComplexBlock) are both unit-tested
 * with real assertions in tests/findStandaloneComplexBlockDropTarget.test.ts
 * and tests/dropStandaloneComplexBlock.test.ts respectively — this file
 * only confirms the view layer wires that pure logic in at the right
 * place, narrowly, without widening !readOnly, without introducing any
 * new rename/delete/insert/Partial-Edit affordance, and without adding a
 * new i18n key for a rejection reason (per this ticket's own approval).
 */
describe("Phase 5D-3C: callout/blockquote drag & drop wiring (narrow, v1-scope-only; desktop+mobile as of the 2026-09-24 mobile follow-up fix)", () => {
  const viewTs = readFileSync(path.resolve(__dirname, "../src/view/OutlineTreeView.ts"), "utf-8");
  const complexBlockTs = readFileSync(path.resolve(__dirname, "../src/model/complexBlock.ts"), "utf-8");
  const i18nTs = readFileSync(path.resolve(__dirname, "../src/i18n.ts"), "utf-8");
  const stylesCss = readFileSync(path.resolve(__dirname, "../styles.css"), "utf-8");

  function methodBody(name: string): string {
    const start = viewTs.indexOf(`private ${name}(`);
    expect(start).toBeGreaterThan(-1);
    const end = viewTs.indexOf("\n  }", start);
    expect(end).toBeGreaterThan(start);
    return viewTs.slice(start, end);
  }

  function standaloneBridgeBranch(): string {
    // Phase 5E-3d ("Table Move/Delete/DnD Parity") widens this branch's own
    // kind check to also admit "table" (reformatted across lines to fit),
    // so the search string below now matches that widened, multi-line
    // condition rather than the original single-line callout/blockquote-
    // only one. The 2026-09-24 mobile follow-up fix then REMOVED this
    // branch's own trailing `&& !Platform.isMobile` (the row is now a
    // valid D&D source/target on mobile too, via the handle created for it
    // — see the dragHandleEl generation condition's own updated doc
    // comment), so the search string below no longer includes it either.
    // The follow-up ticket "fenced-code D&D parity" (2026-09-24, same day,
    // same branch) then widened this branch's kind check once more to
    // also admit "fenced-code" — the search string below now matches that
    // further-widened condition.
    const start = viewTs.indexOf(
      "isComplexMember &&\n      node.isStandalone &&\n      (node.complexKind === \"callout\" ||\n        node.complexKind === \"blockquote\" ||\n        node.complexKind === \"table\" ||\n        node.complexKind === \"fenced-code\")\n    ) {"
    );
    expect(start).toBeGreaterThan(-1);
    const end = viewTs.indexOf(
      "isComplexMember &&\n      !node.isStandalone &&\n      (node.complexKind === \"callout\" || node.complexKind === \"blockquote\") &&\n      !Platform.isMobile",
      start
    );
    expect(end).toBeGreaterThan(start);
    return viewTs.slice(start, end);
  }

  function compositeMemberBranch(): string {
    const start = viewTs.indexOf(
      "isComplexMember &&\n      !node.isStandalone &&\n      (node.complexKind === \"callout\" || node.complexKind === \"blockquote\") &&\n      !Platform.isMobile"
    );
    expect(start).toBeGreaterThan(-1);
    const end = viewTs.indexOf("\n    }\n\n    if (hasChildren && !isCollapsed)", start);
    expect(end).toBeGreaterThan(start);
    return viewTs.slice(start, end);
  }

  it("declares calloutDragSession as a field SEPARATE from dragSourceId and paragraphDragSession", () => {
    expect(viewTs).toContain("private calloutDragSession: StandaloneComplexBlockDragSession | null = null;");
    expect(viewTs).toContain("interface StandaloneComplexBlockDragSession {");
    const ifaceStart = viewTs.indexOf("interface StandaloneComplexBlockDragSession {");
    const ifaceEnd = viewTs.indexOf("\n}", ifaceStart);
    const iface = viewTs.slice(ifaceStart, ifaceEnd);
    expect(iface).toContain("snapshot: StandaloneComplexBlockSnapshot;");
    expect(iface).toContain("sourceTreeNodeId: string;");
  });

  it("endDrag() clears calloutDragSession unconditionally, alongside dragSourceId and paragraphDragSession", () => {
    const body = methodBody("endDrag");
    expect(body).toContain("this.dragSourceId = null;");
    expect(body).toContain("this.paragraphDragSession = null;");
    expect(body).toContain("this.calloutDragSession = null;");
  });

  it("cancelCalloutDrag() is a no-op when no callout drag is active — mirrors cancelParagraphDrag() exactly, never disturbing an in-progress section/list or paragraph drag", () => {
    const body = methodBody("cancelCalloutDrag");
    expect(body).toContain("if (!this.calloutDragSession) return;");
    expect(body).toContain("this.endDrag();");
    expect(body).toContain("this.clearDropIndicator();");
  });

  it("refresh() cancels any in-progress callout drag UNCONDITIONALLY, immediately after cancelParagraphDrag() and before even the renameState early-return — so every refresh() trigger reliably tears a stale callout drag down too", () => {
    const start = viewTs.indexOf("refresh(): void {");
    expect(start).toBeGreaterThan(-1);
    const renameGuardIdx = viewTs.indexOf("if (this.renameState) return;", start);
    const paragraphCancelIdx = viewTs.indexOf("this.cancelParagraphDrag();", start);
    const calloutCancelIdx = viewTs.indexOf("this.cancelCalloutDrag();", start);
    expect(paragraphCancelIdx).toBeGreaterThan(start);
    expect(calloutCancelIdx).toBeGreaterThan(paragraphCancelIdx);
    expect(renameGuardIdx).toBeGreaterThan(calloutCancelIdx);
  });

  it("onClose() also cancels any in-progress callout drag session before tearing down the view's DOM", () => {
    const start = viewTs.indexOf("async onClose(): Promise<void> {");
    expect(start).toBeGreaterThan(-1);
    const end = viewTs.indexOf("this.contentEl.empty();", start);
    const body = viewTs.slice(start, end);
    expect(body).toContain("this.cancelParagraphDrag();");
    expect(body).toContain("this.cancelCalloutDrag();");
  });

  it("computeCalloutDropZone is a two-way (before/after) split — no 'inside' zone (inside drop is always rejected per the ticket: callout/blockquote has no child-block support path)", () => {
    const body = methodBody("computeCalloutDropZone");
    expect(body).not.toContain("inside");
    expect(body).toContain('"before"');
    expect(body).toContain('"after"');
    const zoneTypeStart = viewTs.indexOf("type StandaloneComplexBlockDropZone");
    // The zone TYPE itself lives in move/findStandaloneComplexBlockDropTarget.ts,
    // only imported here — re-confirm the resolver module's own union has
    // no "inside" member either.
    const resolverTs = readFileSync(
      path.resolve(__dirname, "../src/move/findStandaloneComplexBlockDropTarget.ts"),
      "utf-8"
    );
    const resolverZoneStart = resolverTs.indexOf("export type StandaloneComplexBlockDropZone");
    expect(resolverZoneStart).toBeGreaterThan(-1);
    const resolverZoneEnd = resolverTs.indexOf(";", resolverZoneStart);
    const resolverZoneType = resolverTs.slice(resolverZoneStart, resolverZoneEnd);
    expect(resolverZoneType).not.toContain("inside");
    expect(resolverZoneType).toContain('"before"');
    expect(resolverZoneType).toContain('"after"');
    expect(zoneTypeStart).toBe(-1); // the type is imported, not redeclared, in this file
  });

  it("calloutDropTargetHint never treats a section row or a CompositeBlock's own aggregate row as a valid v1 target — only list/paragraph/complex-member kinds are handled, and each is additionally rejected when nested inside a list item's continuation", () => {
    const body = methodBody("calloutDropTargetHint");
    expect(body).toContain("isOutlineListNode(node)");
    expect(body).toContain('node.kind === "paragraph"');
    expect(body).toContain('node.kind === "complex-member"');
    expect(body).not.toContain("isOutlineSectionNode(node)");
    expect(body).not.toContain("isComposite");
    // Every branch that returns a hint re-checks the resolved parentId
    // against a list-type owner and returns null when nested — appears at
    // least 3 times (once per eligible kind).
    const nestedGuardCount = (body.match(/owner\.type === "list"\) return null;/g) ?? []).length;
    expect(nestedGuardCount).toBe(3);
  });

  it("handleCalloutDragStart never checks composite membership (isComposedMember) — a CompositeBlock-member source is exactly as eligible as a standalone one, per this ticket's own approved 案A", () => {
    const body = methodBody("handleCalloutDragStart");
    expect(body).not.toContain("isComposedMember");
    expect(body).not.toContain("allowComposedMember");
    expect(body).toContain("buildStandaloneComplexBlockSnapshot(info)");
    expect(body).toContain('this.calloutDragSession = { snapshot, sourceTreeNodeId: node.id };');
  });

  it("handleCalloutDragStart uses the same empty-string setData sentinel convention as every other dragstart handler in this file (never the row's real internal id, to prevent leaking it as literal text when dropped outside the Tree)", () => {
    const body = methodBody("handleCalloutDragStart");
    expect(body).toContain('evt.dataTransfer.setData("text/plain", "");');
    expect(body).toContain('evt.dataTransfer.effectAllowed = "move";');
  });

  it("handleCalloutDragOverNode and handleCalloutDropNode both decide legality via resolveStandaloneComplexBlockDropTarget — never by re-implementing the resolver's own arithmetic inline", () => {
    const overBody = methodBody("handleCalloutDragOverNode");
    expect(overBody).toContain("resolveStandaloneComplexBlockDropTarget(doc, source, composites, target, zone)");
    const dropBody = methodBody("handleCalloutDropNode");
    expect(dropBody).toContain("this.dispatchAndApplyStandaloneComplexBlockDrop(session.snapshot, target, zone)");
  });

  it("dispatchAndApplyStandaloneComplexBlockDrop delegates entirely to dropStandaloneComplexBlock (edit/dropStandaloneComplexBlock.ts) — it never calls insertBlockAt/moveStandaloneComplexBlock/moveComplexBlock/swapBlocks itself, and never touches the editor directly via replaceRange", () => {
    const body = methodBody("dispatchAndApplyStandaloneComplexBlockDrop");
    expect(body).toContain("dropStandaloneComplexBlock(text, { snapshot, target, zone }, rules)");
    expect(body).not.toContain("insertBlockAt(");
    expect(body).not.toContain("moveStandaloneComplexBlock(");
    expect(body).not.toContain("moveComplexBlock(");
    expect(body).not.toContain("swapBlocks(");
    expect(body).not.toContain("editor.replaceRange");
  });

  it("dispatchAndApplyStandaloneComplexBlockDrop's notify callback is intentionally a no-op — no new i18n key was added for a rejected drop reason, per this ticket's own approval (a rejection is communicated purely by the drop indicator never appearing / the note staying byte-identical)", () => {
    const body = methodBody("dispatchAndApplyStandaloneComplexBlockDrop");
    const notifyIdx = body.indexOf("() => {");
    expect(notifyIdx).toBeGreaterThan(-1);
    const notifyBody = body.slice(notifyIdx, body.indexOf("}", notifyIdx) + 1);
    expect(notifyBody).not.toContain("this.notify(");
    expect(notifyBody).not.toContain('this.plugin.t(');
  });

  it("no new i18n key exists anywhere in i18n.ts for a StandaloneComplexBlockDropRejectReason (composite-internal-boundary or any other reason) — confirms the ticket's explicit 'i18n key を新設しない' instruction was honored", () => {
    expect(i18nTs).not.toContain("compositeInternalBoundary");
    expect(i18nTs).not.toContain("calloutDrop");
    expect(i18nTs).not.toContain("blockquoteDrop");
  });

  it("StandaloneComplexBlockDropRejectReason (model/complexBlock.ts) carries composite-internal-boundary but never a 'composite-member'-style reason for the drag source's OWN matching dissolution (案A tolerates that unconditionally — see this ticket's own approval)", () => {
    const typeStart = complexBlockTs.indexOf("export type StandaloneComplexBlockDropRejectReason");
    expect(typeStart).toBeGreaterThan(-1);
    const typeEnd = complexBlockTs.indexOf(";", typeStart);
    const type = complexBlockTs.slice(typeStart, typeEnd);
    expect(type).toContain("composite-internal-boundary");
    expect(type).not.toContain("composite-member");
    expect(type).not.toContain("invalid-target");
  });

  it("the standalone callout/blockquote/table bridge branch is gated by isStandalone && (callout|blockquote|table) — with NO !Platform.isMobile exclusion since the 2026-09-24 mobile follow-up fix — and REUSES handleParagraphDragOver/handleParagraphDrop for dragover/drop (not its own direct calloutDragSession check) — those methods themselves check calloutDragSession FIRST internally", () => {
    const branch = standaloneBridgeBranch();
    expect(branch).toContain("node.isStandalone &&");
    expect(branch).not.toContain("!Platform.isMobile");
    expect(branch).toContain('selfEl.setAttribute("draggable", "true");');
    expect(branch).toContain("this.handleCalloutDragStart(evt, node, itemEl)");
    expect(branch).toContain("this.handleParagraphDragOver(evt, node, selfEl)");
    expect(branch).toContain("this.handleParagraphDrop(evt, node, selfEl)");
    expect(branch).toContain('this.handleDragEnd()');
  });

  it("the standalone callout/blockquote/table bridge branch now also follows the section/list UXP-01 mobile-vs-desktop draggable split: dragHandleEl on mobile, selfEl on desktop", () => {
    const branch = standaloneBridgeBranch();
    expect(branch).toContain("if (Platform.isMobile) {");
    expect(branch).toContain('dragHandleEl?.setAttribute("draggable", "true");');
    expect(branch).toContain("} else {");
    expect(branch).toContain('selfEl.setAttribute("draggable", "true");');
  });

  it("2026-09-24 mobile follow-up fix: dragHandleEl's generation condition now also admits an eligible standalone callout/blockquote/table row (isEligibleStandaloneComplexMember), so it finally gets the mobile six-dot handle needed to lift it by touch", () => {
    const start = viewTs.indexOf("let dragHandleEl: HTMLElement | null = null;");
    expect(start).toBeGreaterThan(-1);
    const end = viewTs.indexOf("// Inline rename trigger", start);
    expect(end).toBeGreaterThan(start);
    const generationBody = viewTs.slice(start, end);
    expect(generationBody).toContain(
      "if (!readOnly || isComposite || isEligibleStandaloneComplexMember) {"
    );

    const constStart = viewTs.lastIndexOf(
      "const isEligibleStandaloneComplexMember =",
      start
    );
    expect(constStart).toBeGreaterThan(-1);
    const constEnd = viewTs.indexOf(";", constStart);
    const constBody = viewTs.slice(constStart, constEnd);
    expect(constBody).toContain("isComplexMember &&");
    expect(constBody).toContain("node.isStandalone &&");
    expect(constBody).toContain('node.complexKind === "callout"');
    expect(constBody).toContain('node.complexKind === "blockquote"');
    expect(constBody).toContain('node.complexKind === "table"');
    // fenced-code was deliberately NOT part of this allow-list at the
    // time of this mobile follow-up fix, per Phase 5E-1/5E-3d's own
    // explicit scope decision — that exclusion was itself lifted shortly
    // after (same day, same branch) by the follow-up ticket "fenced-code
    // D&D parity" (see the next test), so fenced-code now IS part of this
    // allow-list.
    expect(constBody).toContain('"fenced-code"');
  });

  it("fenced-code D&D parity follow-up: fenced-code is now admitted into BOTH isEligibleStandaloneComplexMember (which gates dragHandleEl creation) and the D&D bridge branch — on equal footing with callout/blockquote/table, lifting the exclusion the two tests above originally pinned", () => {
    const constStart = viewTs.indexOf("const isEligibleStandaloneComplexMember =");
    expect(constStart).toBeGreaterThan(-1);
    const constEnd = viewTs.indexOf(";", constStart);
    const constBody = viewTs.slice(constStart, constEnd);
    expect(constBody).toContain('"fenced-code"');

    const branch = standaloneBridgeBranch();
    expect(branch).toContain('"fenced-code"');
    // The branch's own doc comment explicitly documents and re-affirms
    // this inclusion in prose too, alongside a record of the earlier
    // exclusion it lifted.
    expect(branch).toContain("fenced-code D&D parity");
  });

  it("the NEW composite-member callout/blockquote branch is gated by !node.isStandalone && (callout|blockquote) && !Platform.isMobile, and checks this.calloutDragSession DIRECTLY for dragover/drop — it deliberately does NOT call handleParagraphDragOver/handleParagraphDrop, so a composite-member row never becomes a paragraph-drag drop target", () => {
    const branch = compositeMemberBranch();
    expect(branch).toContain("!node.isStandalone &&");
    expect(branch).toContain("!Platform.isMobile");
    expect(branch).toContain('selfEl.setAttribute("draggable", "true");');
    expect(branch).toContain("this.handleCalloutDragStart(evt, node, itemEl)");
    expect(branch).toContain("if (this.calloutDragSession) this.handleCalloutDragOverNode(evt, node, selfEl);");
    expect(branch).toContain("if (!this.calloutDragSession) return;");
    expect(branch).toContain("this.handleCalloutDropNode(session, evt, node, selfEl);");
    expect(branch).not.toContain("this.handleParagraphDragOver(");
    expect(branch).not.toContain("this.handleParagraphDrop(");
  });

  it("neither the standalone bridge branch nor the new composite-member branch widens the original section/list !readOnly gate — both are separate else-if arms reached only when !readOnly's own branch condition (isOutlineSectionNode/isOutlineListNode/isOutlineParagraphNode) does not match, and neither branch's own CODE tests readOnly at all", () => {
    for (const branch of [standaloneBridgeBranch(), compositeMemberBranch()]) {
      const codeOnly = branch
        .split("\n")
        .filter((line) => !line.trim().startsWith("//"))
        .join("\n");
      expect(codeOnly).not.toContain("!readOnly");
      expect(codeOnly).not.toContain("readOnly &&");
    }
  });

  it("handleDragOver and handleDrop (section/list rows) both check this.calloutDragSession FIRST, as an early additive branch delegating to the shared handleCalloutDragOverNode/handleCalloutDropNode core, before falling through to their pre-existing section/list logic", () => {
    const overBody = methodBody("handleDragOver");
    const overCalloutIdx = overBody.indexOf("if (this.calloutDragSession) {");
    const overDragSourceIdx = overBody.indexOf("if (!this.dragSourceId || !this.currentDoc) return;");
    expect(overCalloutIdx).toBeGreaterThan(-1);
    expect(overDragSourceIdx).toBeGreaterThan(overCalloutIdx);
    expect(overBody).toContain("this.handleCalloutDragOverNode(evt, node, selfEl);");

    const dropBody = methodBody("handleDrop");
    const dropCalloutIdx = dropBody.indexOf("if (this.calloutDragSession) {");
    const dropSourceIdx = dropBody.indexOf("const sourceId = this.dragSourceId;");
    expect(dropCalloutIdx).toBeGreaterThan(-1);
    expect(dropSourceIdx).toBeGreaterThan(dropCalloutIdx);
    expect(dropBody).toContain("this.handleCalloutDropNode(session, evt, node, selfEl);");
  });

  it("handleParagraphDragOver and handleParagraphDrop both check this.calloutDragSession FIRST too, before falling through to their pre-existing paragraph-drag logic — this is what lets a callout/blockquote be dropped relative to a paragraph or standalone complex-member row without a second, race-prone listener pair", () => {
    const overBody = methodBody("handleParagraphDragOver");
    const overCalloutIdx = overBody.indexOf("if (this.calloutDragSession) {");
    const overSessionIdx = overBody.indexOf("const session = this.paragraphDragSession;");
    expect(overCalloutIdx).toBeGreaterThan(-1);
    expect(overSessionIdx).toBeGreaterThan(overCalloutIdx);
    expect(overBody).toContain("this.handleCalloutDragOverNode(evt, node, selfEl);");

    const dropBody = methodBody("handleParagraphDrop");
    const dropCalloutIdx = dropBody.indexOf("if (this.calloutDragSession) {");
    const dropSessionIdx = dropBody.indexOf("const session = this.paragraphDragSession;");
    expect(dropCalloutIdx).toBeGreaterThan(-1);
    expect(dropSessionIdx).toBeGreaterThan(dropCalloutIdx);
    expect(dropBody).toContain("this.handleCalloutDropNode(calloutSession, evt, node, selfEl);");
  });

  it("no rename/delete/insert/indent/outdent/Tree-Partial-Edit affordance was introduced anywhere in the new callout D&D methods — the only capability added is a drop, delegated entirely to dispatchAndApplyStandaloneComplexBlockDrop", () => {
    const methodNames = [
      "cancelCalloutDrag",
      "computeCalloutDropZone",
      "resolveCalloutDragSource",
      "calloutDropTargetHint",
      "handleCalloutDragStart",
      "handleCalloutDragOverNode",
      "handleCalloutDropNode",
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

  it("styles.css's existing drop-indicator classes are REUSED as-is for callout/blockquote D&D — no new callout-specific CSS class was introduced", () => {
    expect(stylesCss).toContain(".unified-outliner-dragging");
    expect(stylesCss).toContain(".unified-outliner-drop-before");
    expect(stylesCss).toContain(".unified-outliner-drop-after");
  });

  it("[2026-09-24, feat/standalone-complex-dnd-cross-section] dispatchAndApplyStandaloneComplexBlockDrop still calls applyLineEditOutcome EXACTLY ONCE, even for a cross-section drop — the executor's own ensureBlankSeparation post-step (edit/dropStandaloneComplexBlock.ts) folds its blank-line insertion into the SAME single outcome.lines[], so a cross-section drop remains one edit / one Undo step, never a second, separate editor write", () => {
    const body = methodBody("dispatchAndApplyStandaloneComplexBlockDrop");
    const occurrences = (body.match(/applyLineEditOutcome\(/g) ?? []).length;
    expect(occurrences).toBe(1);
  });

  it("buildOutlineTree.ts needed NO changes for this ticket — it is never referenced by name in the new callout drag methods beyond the pre-existing isOutlineListNode/isOutlineParagraphNode type-guard imports every prior phase already used", () => {
    for (const name of ["calloutDropTargetHint", "handleCalloutDragStart", "resolveCalloutDragSource"]) {
      const body = methodBody(name);
      expect(body).not.toContain("collectReadOnlyOutlineNodeIds");
      expect(body).not.toContain("buildOutlineTree(");
    }
  });
});
