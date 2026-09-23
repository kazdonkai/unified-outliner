import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Phase 5T-5A ("current-position highlight 拡張 + Tree selection follow/
 * repair の最小実装"): static-source-text checks for the view-layer wiring
 * this ticket added — same constraint as every other *UiWiring.test.ts
 * file in this suite (OutlineTreeView.ts/main.ts/PartialEditView.ts are
 * Obsidian classes that cannot be constructed in vitest, since "obsidian"
 * is a types-only package here), so this file inspects raw source text
 * rather than calling into these classes.
 *
 * The pure resolver logic itself (resolveCurrentPositionNodeId,
 * isOutlineNodeVisible/resolveNearestVisibleAncestorId) is unit-tested
 * with real assertions in tests/resolveCurrentPositionNodeId.test.ts and
 * tests/outlineNavigation.test.ts — this file only confirms the view/
 * plugin layer actually wires those pure functions in at the right call
 * sites, per the design doc's §5-2/§5-3 contract and the ticket's own
 * decisions 2/3/5/6/7.
 */
const viewTs = readFileSync(path.resolve(__dirname, "../src/view/OutlineTreeView.ts"), "utf-8");
const mainTs = readFileSync(path.resolve(__dirname, "../src/main.ts"), "utf-8");
const partialEditTs = readFileSync(
  path.resolve(__dirname, "../src/view/PartialEditView.ts"),
  "utf-8"
);

describe("OutlineTreeView.ts: current-position highlight (Phase 5T-5A)", () => {
  it("refresh() computes highlightedId via resolveCurrentPositionNodeId, then resolveNearestVisibleAncestorId — never the bare resolveHighlightedNodeId call directly", () => {
    const refreshStart = viewTs.indexOf("refresh(): void {");
    expect(refreshStart).toBeGreaterThan(-1);
    const refreshEnd = viewTs.indexOf("\n  private toggleCollapse", refreshStart);
    const body = viewTs.slice(refreshStart, refreshEnd);
    expect(body).toContain("resolveCurrentPositionNodeId(doc, cursorLine, complexScan, this.nodeById");
    expect(body).toContain("resolveNearestVisibleAncestorId(");
    expect(body).toContain("this.highlightedId = resolveNearestVisibleAncestorId(");
    // The old direct call this ticket replaced must be gone.
    expect(body).not.toContain("resolveHighlightedNodeId(doc, cursorLine");
  });

  it("imports resolveCurrentPositionNodeId from the new dedicated module (not merged into resolveHighlightedSectionId.ts — design doc 案A, not 案B)", () => {
    expect(viewTs).toContain(
      'import { resolveCurrentPositionNodeId } from "../tree/resolveCurrentPositionNodeId";'
    );
    // resolveHighlightedSectionId.ts itself is no longer imported directly by this view.
    expect(viewTs).not.toContain('from "../tree/resolveHighlightedSectionId"');
  });
});

describe("OutlineTreeView.ts: selection follow / repair (Phase 5T-5A)", () => {
  it("declares pendingSelectionFollowLine and a public queueSelectionFollow(line) setter", () => {
    expect(viewTs).toContain("private pendingSelectionFollowLine: number | null = null;");
    expect(viewTs).toContain("queueSelectionFollow(line: number): void {");
    expect(viewTs).toContain("this.pendingSelectionFollowLine = line;");
  });

  it("refresh() calls resolveSelectionAfterRefresh(doc, complexScan, includeLists) in place of a bare ensureSelection() call", () => {
    const refreshStart = viewTs.indexOf("refresh(): void {");
    const refreshEnd = viewTs.indexOf("\n  private toggleCollapse", refreshStart);
    const body = viewTs.slice(refreshStart, refreshEnd);
    expect(body).toContain("this.resolveSelectionAfterRefresh(doc, complexScan, includeLists);");
    // ensureSelection() is still reachable as resolveSelectionAfterRefresh's
    // own internal fallback, but refresh() itself must not call it directly
    // anymore — only resolveSelectionAfterRefresh may.
    expect(body).not.toContain("this.ensureSelection();");
  });

  it("resolveSelectionAfterRefresh re-resolves via resolveCurrentPositionNodeId and clears to null (never an ancestor fallback) when the target is unresolvable or hidden", () => {
    const start = viewTs.indexOf("private resolveSelectionAfterRefresh(");
    expect(start).toBeGreaterThan(-1);
    const end = viewTs.indexOf("\n  private ensureSelection(", start);
    const body = viewTs.slice(start, end);
    expect(body).toContain("this.pendingSelectionFollowLine = null;");
    expect(body).toContain("resolveCurrentPositionNodeId(doc, pendingLine, complexScan, this.nodeById");
    expect(body).toContain("isOutlineNodeVisible(candidate, this.parentIdById, this.collapsedIds)");
    expect(body).toContain("? candidate\n          : null;");
    // Must fall through to the pre-existing ensureSelection() when nothing is pending.
    expect(body).toContain("this.ensureSelection();");
    // Must NEVER use the nearest-visible-ANCESTOR fallback for selection
    // repair (ticket decision: "別 node への近似フォールバックは禁止") —
    // that helper is reserved for highlightedId only.
    expect(body).not.toContain("resolveNearestVisibleAncestorId");
  });

  it("every Tree-dispatched move method (paragraph move/non-adjacent-move, standalone complex move, composite move) queues selection-follow with outcome.newStartLine right before this.refresh()", () => {
    for (const marker of [
      "this.notify(standaloneComplexBlockMoveReasonText((k) => this.plugin.t(k), outcome.reason))",
      "this.notify(paragraphNonAdjacentMoveReasonText((k) => this.plugin.t(k), outcome.reason))",
      "this.notify(paragraphTreeMoveReasonText((k) => this.plugin.t(k), outcome.reason))",
      "this.notify(compositeMoveReasonText((k) => this.plugin.t(k), outcome.reason))",
    ]) {
      const idx = viewTs.indexOf(marker);
      expect(idx).toBeGreaterThan(-1);
      const refreshIdx = viewTs.indexOf("this.refresh();", idx);
      const followIdx = viewTs.indexOf("this.queueSelectionFollow(outcome.newStartLine);", idx);
      expect(followIdx).toBeGreaterThan(-1);
      expect(followIdx).toBeLessThan(refreshIdx);
    }
  });

  it("dispatchAndApply (the generic move/indent/outdent/delete/insert dispatcher) gates selection-follow behind a followSelection parameter, defaulting to true", () => {
    const start = viewTs.indexOf("private dispatchAndApply(");
    expect(start).toBeGreaterThan(-1);
    const end = viewTs.indexOf("\n  /**\n   * Phase 5C-1 ticket 3b: dedicated, thin dispatch for composite-block\n   * delete", start);
    const body = viewTs.slice(start, end);
    expect(body).toContain("followSelection = true");
    expect(body).toContain("if (followSelection) this.queueSelectionFollow(outcome.newStartLine);");
  });

  it("delete/insert call sites explicitly opt OUT of selection-follow (followSelection: false) — a deleted node has nothing to follow, an inserted node has no pre-edit selection to follow from", () => {
    expect(viewTs).toContain(
      'this.dispatchAndApply(nodeId, (doc) => deleteBlock(doc, nodeId), false);'
    );
    const insertSibling = viewTs.indexOf("private runInsertSiblingListItemCommand(");
    const insertChild = viewTs.indexOf("private runInsertChildListItemCommand(");
    const insertSection = viewTs.indexOf("private runInsertSiblingSectionCommand(");
    for (const [label, start] of [
      ["runInsertSiblingListItemCommand", insertSibling],
      ["runInsertChildListItemCommand", insertChild],
      ["runInsertSiblingSectionCommand", insertSection],
    ] as const) {
      expect(start, label).toBeGreaterThan(-1);
      const end = viewTs.indexOf("\n  }", viewTs.indexOf("this.autoRenameAfterInsert();", start));
      const body = viewTs.slice(start, end);
      expect(body, label).toContain("false");
    }
  });

  it("dispatchAndApplyCompositeDelete never queues selection-follow (delete has no logical target to follow)", () => {
    const start = viewTs.indexOf("private dispatchAndApplyCompositeDelete(");
    expect(start).toBeGreaterThan(-1);
    const end = viewTs.indexOf("\n  private dispatchAndApplyCompositeMove(", start);
    const body = viewTs.slice(start, end);
    expect(body).not.toContain("queueSelectionFollow");
  });

  it("runRelocateCommand (section/list D&D) and handleParagraphDrop (paragraph D&D) reuse dispatchAndApply/dispatchAndApplyParagraphMove — both therefore already covered by the selection-follow wiring above, with no separate D&D-specific opt-out", () => {
    const relocateStart = viewTs.indexOf("private runRelocateCommand(");
    const relocateEnd = viewTs.indexOf("\n}", relocateStart);
    expect(viewTs.slice(relocateStart, relocateEnd)).toContain("this.dispatchAndApply(sourceId, (doc) => {");

    const dropStart = viewTs.indexOf("private handleParagraphDrop(");
    const dropEnd = viewTs.indexOf("\n  }", dropStart);
    expect(viewTs.slice(dropStart, dropEnd)).toContain("this.dispatchAndApplyParagraphMove(session.anchor, resolution.direction);");
  });
});

describe("OutlineTreeView.ts: pendingMoveFlash simplification (Phase 5T-5A, ticket decision 6)", () => {
  it("pendingMoveFlash is a plain number, queueMoveFlash takes a plain line, applyPendingMoveFlash no longer branches on a nodeIdHint TYPE (doc-comment mentions of the old, removed concept are fine)", () => {
    expect(viewTs).toContain("private pendingMoveFlash: number | null = null;");
    expect(viewTs).toContain("queueMoveFlash(line: number): void {");
    expect(viewTs).toContain("this.pendingMoveFlash = line;");
    const applyStart = viewTs.indexOf("private applyPendingMoveFlash(): void {");
    const applyEnd = viewTs.indexOf("\n  }", applyStart);
    const applyBody = viewTs.slice(applyStart, applyEnd);
    expect(applyBody).not.toContain("nodeIdHint");
    expect(applyBody).toContain("visible.find((n) => n.line === pending)");
  });
});

describe("main.ts: selection follow wiring (Phase 5T-5A)", () => {
  it("queueOutlineTreeMoveFlash takes only an outcome and passes outcome.newStartLine straight through — no more doc/unit/nodeIdHint", () => {
    const start = mainTs.indexOf("private queueOutlineTreeMoveFlash(");
    expect(start).toBeGreaterThan(-1);
    const end = mainTs.indexOf("\n  }", start);
    const body = mainTs.slice(start, end);
    expect(mainTs.slice(start, start + 120)).toContain(
      "queueOutlineTreeMoveFlash(outcome: LineEditOutcome | MoveComplexBlockOutcome): void {"
    );
    expect(body).toContain("queueMoveFlash(outcome.newStartLine)");
  });

  it("declares a public queueOutlineTreeSelectionFollow(line) that fans out to every open Outline Tree View leaf", () => {
    const start = mainTs.indexOf("queueOutlineTreeSelectionFollow(line: number): void {");
    expect(start).toBeGreaterThan(-1);
    const end = mainTs.indexOf("\n  }", start);
    const body = mainTs.slice(start, end);
    expect(body).toContain("leaf.view.queueSelectionFollow(line)");
  });

  it("moveCurrentBlock and moveCurrentSection both call queueOutlineTreeSelectionFollow(outcome.newStartLine) alongside queueOutlineTreeMoveFlash, gated the same way (outcome.changed)", () => {
    const occurrences = mainTs.split("this.queueOutlineTreeSelectionFollow(outcome.newStartLine);").length - 1;
    expect(occurrences).toBe(2);
    const flashOccurrences = mainTs.split("this.queueOutlineTreeMoveFlash(outcome);").length - 1;
    expect(flashOccurrences).toBe(2);
  });

  it("findEnclosingSectionId is no longer imported (the nodeIdHint/enclosing-section-fallback concept it existed for is gone)", () => {
    expect(mainTs).not.toContain("findEnclosingSectionId");
  });
});

describe("PartialEditView.ts: selection follow wiring (Phase 5T-5A)", () => {
  it("the paragraph save-success path calls plugin.queueOutlineTreeSelectionFollow(outcome.newStartLine)", () => {
    const anchorIdx = partialEditTs.indexOf("if (this.paragraphAnchor) {");
    expect(anchorIdx).toBeGreaterThan(-1);
    const noticeIdx = partialEditTs.indexOf('this.plugin.t("partialEdit.paragraphUpdated")', anchorIdx);
    expect(noticeIdx).toBeGreaterThan(-1);
    const followIdx = partialEditTs.indexOf(
      "this.plugin.queueOutlineTreeSelectionFollow(outcome.newStartLine);",
      anchorIdx
    );
    expect(followIdx).toBeGreaterThan(-1);
    expect(followIdx).toBeLessThan(noticeIdx);
  });

  it("the section/list subtree save-success path also calls plugin.queueOutlineTreeSelectionFollow(outcome.newStartLine)", () => {
    // Phase 5D-0.5: this call now passes `newRawText` (the textarea's raw
    // Markdown, inverse-projected back from prefix-stripped display text
    // for a projecting callout/blockquote — byte-identical to
    // `this.textareaEl.value` for every other kind) rather than
    // `this.textareaEl.value` directly — see
    // tests/quotePrefixPartialEditViewWiring.test.ts for the dedicated
    // wiring coverage of that change itself.
    // Phase 5E-3: the call site reformatted to a multi-line call (a 5th,
    // conditional fencedCodeInfoString argument was added) — this still
    // matches on the same four leading, unconditional arguments.
    const subtreeIdx = partialEditTs.indexOf(
      "applySubtreeEdit(\n          doc,\n          this.nodeId!,\n          this.originalText,\n          newRawText,"
    );
    expect(subtreeIdx).toBeGreaterThan(-1);
    const followIdx = partialEditTs.indexOf(
      "this.plugin.queueOutlineTreeSelectionFollow(outcome.newStartLine);",
      subtreeIdx
    );
    expect(followIdx).toBeGreaterThan(-1);
  });
});
