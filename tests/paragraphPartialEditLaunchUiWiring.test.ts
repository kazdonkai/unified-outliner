import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Phase 5T-7A ("Outline Tree の paragraph Partial Edit をダブルクリック／
 * F2で起動する") originally introduced this file to cover the NEW
 * dblclick/F2 launch wiring in view/OutlineTreeView.ts via static
 * source-text checks (OutlineTreeView extends Obsidian's ItemView, which
 * cannot be constructed in vitest — "obsidian" is a types-only package
 * here — so this file inspects the raw source text rather than
 * instantiating the view and dispatching real DOM events, same convention
 * as tests/paragraphOutlineTreeUiWiring.test.ts and
 * tests/selectionFollowUiWiring.test.ts).
 *
 * Phase 5T-7C ("Outline Tree の native dblclick 依存をやめ、pointerdown ベー
 * スの独立二重クリック検出へ置き換える") replaced the native `dblclick`
 * listener this file originally tested with a shared pointerdown-based
 * detector (see src/view/rowDoubleClickDetector.ts and
 * docs/phase5t7b_dblclick_reliability_audit.md /
 * docs/phase5t7c_pointerdown_doubleclick_design.md for the full
 * background: real-device testing found native dblclick intermittently
 * swallowed by this row's own always-on `draggable="true"`, on both left-
 * and right-docked sidebars). The tests below were updated in place for
 * this new wiring; the pure detection logic itself
 * (isDoubleClickPointerDown / isEligibleRowBodyPointerDown) is unit-tested
 * directly, with real inputs/outputs, in tests/rowDoubleClickDetector.test.ts
 * — this file stays scoped to WIRING: which DOM branch attaches which
 * listener, what it delegates to, and what does/doesn't happen for
 * non-paragraph rows / excluded hit targets.
 *
 * This file remains deliberately SEPARATE from
 * tests/paragraphOutlineTreeUiWiring.test.ts (which covers the pre-existing
 * "段落を編集…" context menu item and openParagraphPartialEditFromTree's own
 * resolve/activate contract) — the file split predates 5T-7C and still
 * matches the same "resolve+activate logic tests vs. event wiring tests"
 * separation the original 5T-7A ticket asked for.
 *
 * Phase 5T-8A ("paragraph のダブルクリック動作を Partial Edit 起動から inline
 * rename へ統一する") changes ONLY the paragraph pointerdown branch's
 * onDoubleClick destination (openParagraphPartialEditFromTree ->
 * beginParagraphRenameForNode) — the detection wiring tests below are
 * otherwise untouched. beginParagraphRenameForNode's OWN resolve+open
 * contract (resolveParagraphFromTreeHint/buildParagraphMoveAnchor reuse,
 * beginRename's paragraph branch, commitRename's applyParagraphEdit branch)
 * is covered separately in tests/paragraphInlineRename.test.ts, mirroring
 * this same "wiring tests vs. resolve/activate logic tests" split.
 */
describe("OutlineTreeView.ts paragraph dblclick/F2 launch wiring (Phase 5T-7A, pointerdown-based since Phase 5T-7C)", () => {
  const viewTs = readFileSync(path.resolve(__dirname, "../src/view/OutlineTreeView.ts"), "utf-8");

  function renderNodeSlice(): string {
    const start = viewTs.indexOf("private renderNode(");
    expect(start).toBeGreaterThan(-1);
    // renderNode is one of the largest methods in the file; bound at the
    // next top-level method declaration rather than guessing a fixed
    // length. handleDragStart is the next `private` method after it.
    const end = viewTs.indexOf("\n  private handleDragStart(", start);
    expect(end).toBeGreaterThan(start);
    return viewTs.slice(start, end);
  }

  it("no native `dblclick` listener remains anywhere in renderNode — Phase 5T-7C removed both the rename branch's and the paragraph branch's native dblclick listeners in favor of the shared pointerdown-based detector", () => {
    const slice = renderNodeSlice();
    expect(slice).not.toContain('addEventListener("dblclick"');
  });

  it("the rename branch (`!readOnly`) and the paragraph branch (`else if (isParagraph)`) both attach a `pointerdown` listener that delegates to the SAME shared handleRowPointerDownForDoubleClick method — one detection implementation, not two independent ones", () => {
    const slice = renderNodeSlice();
    const occurrences = slice.split(
      "this.handleRowPointerDownForDoubleClick(evt, node.id, collapseEl, dragHandleEl, () =>"
    ).length - 1;
    expect(occurrences).toBe(2);
    const pointerdownOccurrences = slice.split('selfEl.addEventListener("pointerdown", (evt) => {').length - 1;
    // >= 2 rather than exactly 2: the mobile long-press gesture layer
    // (Platform.isMobile-gated, untouched by this ticket) also attaches its
    // own "pointerdown" listeners further down in renderNode for its own,
    // unrelated purpose.
    expect(pointerdownOccurrences).toBeGreaterThanOrEqual(2);
  });

  it("(Phase 5T-8A) the paragraph pointerdown branch lives in its OWN `else if (isParagraph)` branch, sibling to (never nested inside, never a relaxation of) the pre-existing `if (!readOnly)` rename branch, and its onDoubleClick callback now delegates to beginParagraphRenameForNode(node.id) — inline rename, matching heading/list — never openParagraphPartialEditFromTree (Partial Edit Pane) directly", () => {
    const slice = renderNodeSlice();
    const renameBranchIdx = slice.indexOf("if (!readOnly) {");
    expect(renameBranchIdx).toBeGreaterThan(-1);
    const paragraphBranchIdx = slice.indexOf("} else if (isParagraph) {", renameBranchIdx);
    expect(paragraphBranchIdx).toBeGreaterThan(renameBranchIdx);
    const nextTopLevelIdx = slice.indexOf("\n    if (isOutlineSectionNode(node)) {", paragraphBranchIdx);
    expect(nextTopLevelIdx).toBeGreaterThan(paragraphBranchIdx);
    const paragraphBranchBody = slice.slice(paragraphBranchIdx, nextTopLevelIdx);
    expect(paragraphBranchBody).toContain('selfEl.addEventListener("pointerdown"');
    expect(paragraphBranchBody).toContain("this.beginParagraphRenameForNode(node.id)");
    expect(paragraphBranchBody).not.toContain("this.openParagraphPartialEditFromTree(node.id)");
    expect(paragraphBranchBody).not.toContain("paragraph-edit-input");
    expect(paragraphBranchBody).not.toContain("contenteditable");
  });

  it("hit-target exclusion (collapse spacer / drag handle / non-primary button) is delegated entirely to the shared handler — renderNode itself no longer contains an inline `if (collapseEl.contains(...)) return;` guard for either branch", () => {
    const slice = renderNodeSlice();
    const renameBranchIdx = slice.indexOf("if (!readOnly) {");
    const paragraphBranchIdx = slice.indexOf("} else if (isParagraph) {", renameBranchIdx);
    const nextTopLevelIdx = slice.indexOf("\n    if (isOutlineSectionNode(node)) {", paragraphBranchIdx);
    const renameAndParagraphBody = slice.slice(renameBranchIdx, nextTopLevelIdx);
    expect(renameAndParagraphBody).not.toContain("if (collapseEl.contains(");
    // Both branches pass collapseEl AND dragHandleEl through to the shared
    // handler, which is where isEligibleRowBodyPointerDown actually applies
    // the exclusion (see the next test).
    expect(renameAndParagraphBody).toContain("collapseEl, dragHandleEl,");
  });

  it("handleRowPointerDownForDoubleClick delegates hit-target eligibility to isEligibleRowBodyPointerDown and double-click pairing to isDoubleClickPointerDown — no ad-hoc timing/distance/target logic duplicated in the view (the threshold constants themselves live only in rowDoubleClickDetector.ts, never re-declared here)", () => {
    const start = viewTs.indexOf("private handleRowPointerDownForDoubleClick(");
    expect(start).toBeGreaterThan(-1);
    const end = viewTs.indexOf("\n  }\n", start);
    const body = viewTs.slice(start, end);
    expect(body).toContain("isEligibleRowBodyPointerDown({");
    expect(body).toContain("isDoubleClickPointerDown(current, this.lastRowPointerDown)");
    expect(body).not.toMatch(/\b400\b/);
    expect(body).not.toMatch(/\b6\b/);
  });

  it("evt.stopPropagation() inside handleRowPointerDownForDoubleClick is called ONLY once a double click is actually recognized, never unconditionally on every pointerdown — matching the old native dblclick listener's own behavior, which by construction only ever ran on a real double click", () => {
    const start = viewTs.indexOf("private handleRowPointerDownForDoubleClick(");
    const end = viewTs.indexOf("\n  }\n", start);
    const body = viewTs.slice(start, end);
    const recognizedIdx = body.indexOf("if (isDoubleClickPointerDown(current, this.lastRowPointerDown)) {");
    expect(recognizedIdx).toBeGreaterThan(-1);
    const preamble = body.slice(0, recognizedIdx);
    expect(preamble).not.toContain("evt.stopPropagation()");
    const recognizedBranchEnd = body.indexOf("return;", recognizedIdx) + "return;".length;
    const recognizedBranch = body.slice(recognizedIdx, recognizedBranchEnd);
    expect(recognizedBranch).toContain("this.lastRowPointerDown = null;");
    expect(recognizedBranch).toContain("evt.stopPropagation();");
  });

  it("onDoubleClick is invoked via a deferred this.treeRootEl.win.setTimeout(...), never called synchronously inside the pointerdown handler — beginRenameForNode (heading/list) synchronously empties this row's own innerEl and steals focus onto a new <textarea>, which races the still-in-flight native mousedown/mouseup/click sequence of the SAME press if run synchronously on pointerdown (confirmed on a real device: heading/list dblclick silently did nothing, while paragraph's own onDoubleClick — which never touches this row's DOM/focus — was unaffected)", () => {
    const start = viewTs.indexOf("private handleRowPointerDownForDoubleClick(");
    const end = viewTs.indexOf("\n  }\n", start);
    const body = viewTs.slice(start, end);
    const recognizedIdx = body.indexOf("if (isDoubleClickPointerDown(current, this.lastRowPointerDown)) {");
    const recognizedBranchEnd = body.indexOf("return;", recognizedIdx) + "return;".length;
    const recognizedBranch = body.slice(recognizedIdx, recognizedBranchEnd);
    expect(recognizedBranch).not.toContain("      onDoubleClick();\n");
    expect(recognizedBranch).toContain("this.treeRootEl.win.setTimeout(() => onDoubleClick(), 0);");
  });

  it("the lastRowPointerDown state field exists exactly once, typed RowPointerDownRecord | null, so double-click state survives renderTree()'s full DOM rebuild across the two presses of a double click", () => {
    const occurrences = viewTs.split("private lastRowPointerDown: RowPointerDownRecord | null = null;").length - 1;
    expect(occurrences).toBe(1);
  });

  it("rowDoubleClickDetector.ts is imported with the expected named exports", () => {
    expect(viewTs).toContain('from "./rowDoubleClickDetector"');
    expect(viewTs).toContain("isDoubleClickPointerDown");
    expect(viewTs).toContain("isEligibleRowBodyPointerDown");
    expect(viewTs).toContain("RowPointerDownRecord");
    expect(viewTs).toContain("ContainsCheckable");
  });

  /**
   * Phase 5D-4D (2026-09, "CompositeBlock 親行へのモバイル六点ハンドル追加")
   * landmark update. dragHandleEl's own generation condition changed from
   * `if (!readOnly) {` to `if (!readOnly || isComposite) {` (widened so a
   * CompositeBlock parent row — always readOnly, per Phase 5D-0.3 §1 —
   * still gets a drag handle on mobile). The 2026-09-24 mobile follow-up
   * fix ("モバイルではD&Dができない") widened it once more, to
   * `if (!readOnly || isComposite || isEligibleStandaloneComplexMember) {`
   * — an eligible standalone callout/blockquote/table row (also always
   * readOnly, per the same §1) now gets a handle too, so it can finally be
   * lifted by touch on mobile (see
   * tests/standaloneComplexBlockDropUiWiring.test.ts and
   * tests/OutlineTreeView.mobileCompositeDragHandle.test.ts for that
   * widening's own dedicated coverage). The OLD fixed-200-character
   * proximity check for the literal text "if (!readOnly) {" therefore no
   * longer matches at all. The safety contract being verified is
   * UNCHANGED: dragHandleEl is created for a NON-readOnly row, a
   * CompositeBlock parent row, or an eligible standalone complex-member
   * row, and a paragraph row is NONE of those — so a paragraph row still
   * never has a drag handle element for isEligibleRowBodyPointerDown's own
   * dragHandleEl check to exclude in the first place. Replaced with a
   * structural check (unique landmark, explicit widening terms, paragraph
   * exclusion) rather than a fixed-distance substring probe, which would
   * either fail outright on the new text or, on some future unrelated
   * edit, pass by coincidence against nearby text it was never meant to
   * match.
   */
  it("(Phase 5D-4D / mobile follow-up landmark update) dragHandleEl's generation condition is found uniquely and is explicitly widened ONLY for CompositeBlock (isComposite) and eligible standalone complex-member rows (isEligibleStandaloneComplexMember) — never for paragraph — so a paragraph row still never receives a drag handle element for isEligibleRowBodyPointerDown's own dragHandleEl check to exclude in the first place", () => {
    const conditionLandmark = "if (!readOnly || isComposite || isEligibleStandaloneComplexMember) {";
    const creationLandmark =
      'dragHandleEl = selfEl.createDiv({ cls: "unified-outliner-drag-handle" });';

    const conditionOccurrences = viewTs.split(conditionLandmark).length - 1;
    if (conditionOccurrences === 0) {
      throw new Error(
        `dragHandleEl's generation condition landmark ${JSON.stringify(conditionLandmark)} not found — has it been renamed, removed, or restructured? Update this test's bounding logic.`
      );
    }
    // This is the ONE place dragHandleEl is gated — never a
    // general-purpose condition reused elsewhere. A second occurrence
    // would make the pairing with `creationLandmark` below ambiguous.
    expect(conditionOccurrences).toBe(1);

    const conditionIdx = viewTs.indexOf(conditionLandmark);
    const creationIdx = viewTs.indexOf(creationLandmark, conditionIdx);
    if (creationIdx === -1) {
      throw new Error(
        `dragHandleEl creation landmark ${JSON.stringify(creationLandmark)} not found after its own generation condition — has the guard/body pairing been restructured? Update this test's bounding logic.`
      );
    }
    // The condition must be the IMMEDIATE guard for this creation call —
    // nothing else (no unrelated statement, no second nested guard) sits
    // between the condition and dragHandleEl's own createDiv() call.
    const guardToCreation = viewTs.slice(conditionIdx, creationIdx);
    expect(guardToCreation.trim().replace(/\s+/g, " ")).toBe(conditionLandmark.trim());

    // The widening is explicitly, structurally scoped to CompositeBlock and
    // eligible standalone complex-member rows — never to paragraph.
    // isComposite/isParagraph are each derived from their own distinct
    // node-kind predicate (isOutlineCompositeNode / isOutlineParagraphNode)
    // on the same discriminated OutlineTreeNode — a node can only ever
    // satisfy one kind (enforced at the type level and exercised with real
    // fixtures in tests/buildOutlineTree.test.ts), so `isComposite` can
    // never be true when the row is a paragraph row.
    // isEligibleStandaloneComplexMember is likewise derived from
    // isComplexMember (isOutlineComplexMemberNode) plus node.isStandalone/
    // node.complexKind — also mutually exclusive with a paragraph row for
    // the same reason. This static check only confirms this file's OWN
    // condition text names isComposite/isEligibleStandaloneComplexMember,
    // never isParagraph, as the widening terms.
    expect(conditionLandmark).toContain("isComposite");
    expect(conditionLandmark).toContain("isEligibleStandaloneComplexMember");
    expect(conditionLandmark).not.toContain("isParagraph");
    expect(viewTs).toContain("const isComposite = isOutlineCompositeNode(node);");
    expect(viewTs).toContain("const isParagraph = isOutlineParagraphNode(node);");

    // Sanity: paragraph rows are always read-only (existing 5T-1/5T-2/5T-4A
    // contract, re-confirmed here as a precondition for the claim above).
    const readOnlyDeclIdx = viewTs.indexOf("const readOnly = this.readOnlyNodeIds.has(node.id);");
    expect(readOnlyDeclIdx).toBeGreaterThan(-1);
  });

  /**
   * Local, self-contained copy of the same structural bounding
   * tests/paragraphOutlineTreeUiWiring.test.ts's own Phase 5T-2 describe
   * block uses for its `paragraphDragBranch()` helper — duplicated here
   * (rather than imported) because this ticket's exceptional test-only-fix
   * authorization scopes changes to landmarks WITHIN each of the 3
   * approved files independently, not to introducing new cross-test-file
   * dependencies. See that file's own doc comment for why the OLD end
   * landmark (the end of the WHOLE if/else-if drag-wiring chain) is no
   * longer safe to use as a stand-in for "the paragraph branch's own end"
   * now that the CompositeBlock branch, five branches later, legitimately
   * references dragHandleEl in its own code.
   */
  function paragraphDragBranchBody(): string {
    const startLandmark = "} else if (isOutlineParagraphNode(node) && !Platform.isMobile) {";
    const start = viewTs.indexOf(startLandmark);
    if (start === -1) {
      throw new Error(
        `paragraph drag branch start landmark ${JSON.stringify(startLandmark)} not found — has it been renamed, removed, or reordered? Update this test's bounding logic.`
      );
    }
    expect(viewTs.split(startLandmark).length - 1).toBe(1);

    const endLandmark = "} else if (\n      isComplexMember &&\n      node.isStandalone &&";
    const end = viewTs.indexOf(endLandmark, start);
    if (end === -1) {
      throw new Error(
        `paragraph drag branch's own next-sibling-branch landmark ${JSON.stringify(endLandmark)} not found after the paragraph branch — has the standalone callout/blockquote branch been renamed, removed, or reordered? Update this test's bounding logic.`
      );
    }
    if (end <= start) {
      throw new Error(
        "paragraph drag branch's end landmark resolved to a position at or before its own start — bounding logic is broken."
      );
    }
    expect(viewTs.slice(start).split(endLandmark).length - 1).toBe(1);

    const branch = viewTs.slice(start, end);
    if (branch.trim().length === 0) {
      throw new Error("paragraph drag branch extracted as empty — bounding logic is broken.");
    }
    return branch;
  }

  it("(Phase 5D-4D) the paragraph drag branch (handleParagraphDragStart's own call site) still contains no dragHandleEl reference, and no CompositeBlock-specific drag wiring (handleCompositeDragStart/handleCompositeDragOverNode/handleCompositeDropNode/compositeDragSession) leaked into it — the new mobile CompositeBlock drag handle work is confined to its own, separate branch", () => {
    const branch = paragraphDragBranchBody();
    const codeOnly = branch
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    expect(codeOnly).toContain("this.handleParagraphDragStart(evt, node, itemEl)");
    expect(codeOnly).not.toContain("dragHandleEl");
    expect(codeOnly).not.toContain("handleCompositeDragStart");
    expect(codeOnly).not.toContain("handleCompositeDragOverNode");
    expect(codeOnly).not.toContain("handleCompositeDropNode");
    expect(codeOnly).not.toContain("compositeDragSession");
  });

  it("(Phase 5D-4D) the paragraph Partial Edit launch path itself (F2 case and openParagraphPartialEditFromTree) is untouched by the dragHandleEl generation-condition widening — both still exist and still resolve via resolveParagraphFromTreeHint / activatePartialEditViewForParagraph, exactly as the pre-existing tests above already establish; this test only re-confirms their presence was not disturbed by this ticket's landmark-only changes", () => {
    expect(viewTs).toContain('case "F2": {');
    expect(viewTs).toContain(
      "private openParagraphPartialEditFromTree(nodeId: string): void {"
    );
    expect(viewTs).toContain(
      "this.plugin.activatePartialEditViewForParagraph(target.range.startLine)"
    );
  });

  it("(Phase 5T-8A) openParagraphPartialEditFromTree is called from exactly ONE site now — handleTreeKeyDown's F2 case — since the paragraph pointerdown branch's onDoubleClick callback no longer calls it (it calls beginParagraphRenameForNode instead, per the ticket's explicit 'paragraph Partial Edit Pane はダブルクリックでは開かない' requirement)", () => {
    const occurrences = viewTs.split("this.openParagraphPartialEditFromTree(").length - 1;
    expect(occurrences).toBe(1);
    const f2CaseIdx = viewTs.indexOf('case "F2": {');
    const onlyCallIdx = viewTs.indexOf("this.openParagraphPartialEditFromTree(");
    expect(onlyCallIdx).toBeGreaterThan(f2CaseIdx);
  });

  it("(Phase 5T-8A, revised by Phase 5T-10A) beginParagraphRenameForNode is called from exactly TWO sites — the paragraph pointerdown branch's onDoubleClick callback, and Phase 5T-10A's autoRenameAfterParagraphInsert (the post-insert auto-rename entry point) — never from F2 or the context menu, which both keep opening Partial Edit", () => {
    const occurrences = viewTs.split("this.beginParagraphRenameForNode(").length - 1;
    // 2 call sites (the pointerdown branch's plain `this.beginParagraphRenameForNode(node.id)`,
    // and autoRenameAfterParagraphInsert's `this.beginParagraphRenameForNode(this.highlightedId, true)`)
    // + 1 for the method's own
    // `private beginParagraphRenameForNode(nodeId: string, pendingParagraphInsert = false): void {`
    // declaration line, which also contains the substring
    // "beginParagraphRenameForNode(" — split on the call-with-`this.`
    // form specifically avoids counting the declaration itself, so this
    // should be exactly 2.
    expect(occurrences).toBe(2);
    const autoRenameIdx = viewTs.indexOf(
      "private autoRenameAfterParagraphInsert(\n    originAnchor: ParagraphMoveAnchor,\n    originPosition: ParagraphInsertPosition\n  ): void {"
    );
    expect(autoRenameIdx).toBeGreaterThan(-1);
    const secondCallIdx = viewTs.indexOf(
      "this.beginParagraphRenameForNode(this.highlightedId, true, {"
    );
    expect(secondCallIdx).toBeGreaterThan(autoRenameIdx);
  });

  it("the paragraph row's existing right-click context menu (\"段落を編集…\", showParagraphMoveMenu) is untouched by this ticket — still wired via a plain `contextmenu` listener, entirely independent of the pointerdown double-click detector", () => {
    const elseIfIdx = viewTs.indexOf(
      "} else if (isComplexMember && node.isStandalone) {",
      viewTs.indexOf("private renderNode(")
    );
    const paragraphContextMenuIdx = viewTs.indexOf("} else if (isParagraph) {", elseIfIdx);
    expect(paragraphContextMenuIdx).toBeGreaterThan(-1);
    const nextIdx = viewTs.indexOf("\n    }\n\n    // ---- Mobile gesture layer", paragraphContextMenuIdx);
    expect(nextIdx).toBeGreaterThan(paragraphContextMenuIdx);
    const body = viewTs.slice(paragraphContextMenuIdx, nextIdx);
    expect(body).toContain('selfEl.addEventListener("contextmenu"');
    expect(body).toContain("this.showParagraphMoveMenu(evt, node.id)");
  });

  function f2CaseBody(): string {
    const caseIdx = viewTs.indexOf('case "F2": {');
    expect(caseIdx).toBeGreaterThan(-1);
    const caseEndIdx = viewTs.indexOf("\n    }\n  };", caseIdx);
    expect(caseEndIdx).toBeGreaterThan(caseIdx);
    return viewTs.slice(caseIdx, caseEndIdx);
  }

  it("F2 opens Paragraph Partial Edit ONLY when this.selectedId resolves (via this.nodeById) to a paragraph node — the check re-reads live selection state, never a cached/stale flag. Untouched by Phase 5T-7C (this ticket is dblclick-only).", () => {
    const body = f2CaseBody();
    expect(body).toContain("if (this.selectedId) {");
    expect(body).toContain("const selectedNode = this.nodeById.get(this.selectedId);");
    expect(body).toContain("if (selectedNode && isOutlineParagraphNode(selectedNode)) {");
  });

  it("F2's preventDefault/stopPropagation for the paragraph branch are called INSIDE that branch (only once the paragraph check has already passed), not hoisted above the branch check — while the pre-existing unconditional preventDefault/stopPropagation for section/list/no-selection is still present, unchanged, below the paragraph branch's own `break`", () => {
    const body = f2CaseBody();
    const branchIdx = body.indexOf("if (selectedNode && isOutlineParagraphNode(selectedNode)) {");
    const branchEndIdx = body.indexOf("break;", branchIdx) + "break;".length;
    const branchBody = body.slice(branchIdx, branchEndIdx);
    expect(branchBody).toContain("evt.preventDefault();");
    expect(branchBody).toContain("evt.stopPropagation();");
    expect(branchBody).toContain("this.openParagraphPartialEditFromTree(this.selectedId)");

    // Nothing (specifically no preventDefault/stopPropagation/case-handling
    // code) sits between the top of the case and the paragraph `if` check —
    // i.e. the case does NOT unconditionally preventDefault before deciding
    // which path to take.
    const preambleIdx = body.indexOf('case "F2": {');
    const preamble = body.slice(preambleIdx, branchIdx);
    expect(preamble).not.toContain("evt.preventDefault()");
    expect(preamble).not.toContain("evt.stopPropagation()");

    // The pre-existing fallback (unconditional prevent/stop + conditional
    // beginRenameForNode) still exists, textually AFTER the paragraph
    // branch's own break — i.e. only reached when the branch above did not
    // already break out.
    const fallback = body.slice(branchEndIdx);
    expect(fallback).toContain("evt.preventDefault();");
    expect(fallback).toContain("evt.stopPropagation();");
    expect(fallback).toContain("if (this.selectedId) this.beginRenameForNode(this.selectedId);");
  });

  it("F2's paragraph branch never calls beginRenameForNode, and the fallback rename branch never calls openParagraphPartialEditFromTree — the two destinations are mutually exclusive within one keypress", () => {
    const body = f2CaseBody();
    const branchIdx = body.indexOf("if (selectedNode && isOutlineParagraphNode(selectedNode)) {");
    const branchEndIdx = body.indexOf("break;", branchIdx) + "break;".length;
    const branchBody = body.slice(branchIdx, branchEndIdx);
    const fallback = body.slice(branchEndIdx);
    expect(branchBody).not.toContain("beginRenameForNode");
    expect(fallback).not.toContain("openParagraphPartialEditFromTree");
  });

  it("handleTreeKeyDown (the sole home of the F2 case) is still the ONLY keydown listener attached to treeRootEl — Phase 5T-7C adds no new keydown listener/registerDomEvent call (this ticket is pointerdown-only)", () => {
    const occurrences = (viewTs.match(/registerDomEvent\(this\.treeRootEl, "keydown"/g) ?? []).length;
    expect(occurrences).toBe(1);
  });

  it("openParagraphPartialEditFromTree never mutates this.selectedId, this.highlightedId, or this.collapsedIds — a failed resolution must leave Tree selection/current-position/fold state untouched, per the ticket's explicit contract. Untouched by Phase 5T-7C.", () => {
    const start = viewTs.indexOf("private openParagraphPartialEditFromTree(nodeId: string): void {");
    const end = viewTs.indexOf("\n  }\n", start);
    const body = viewTs.slice(start, end);
    expect(body).not.toContain("this.selectedId =");
    expect(body).not.toContain("this.highlightedId =");
    expect(body).not.toContain("this.collapsedIds");
    expect(body).not.toContain("this.refresh()");
    expect(body).not.toContain("this.renderTree()");
  });

  it("D&D wiring (handleDragStart/handleDragOver/computeDropMode/setDropIndicator/runRelocateCommand), the paragraph drag-session branch, and the `draggable` attribute assignments are textually untouched by this ticket — Phase 5T-7C is a pointerdown-based double-click detector only, no D&D judgment/movement logic changes", () => {
    expect(viewTs).toContain("private handleDragStart(evt: DragEvent, sectionId: string, itemEl: HTMLElement): void {");
    expect(viewTs).toContain("private computeDropMode(evt: DragEvent, el: HTMLElement): DropMode {");
    expect(viewTs).toContain("private runRelocateCommand(sourceId: string, targetId: string, mode: DropMode): void {");
    expect(viewTs).toContain("private handleParagraphDragStart(");
    expect(viewTs).toContain('selfEl.setAttribute("draggable", "true");');
    expect(viewTs).toContain('dragHandleEl?.setAttribute("draggable", "true");');
  });
});
