import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Phase 5D-0.5 ("Quote Prefix Projection for Partial Edit"): static-
 * source-text checks pinning view/PartialEditView.ts's wiring to
 * edit/quotePrefixProjection.ts, and the exact ORDER of operations at
 * each of the hook points the approved implementation scope itemized.
 *
 * Same constraint as tests/paragraphPartialEditViewWiring.test.ts and
 * tests/commandTable.test.ts: PartialEditView extends Obsidian's ItemView
 * and cannot be constructed in vitest ("obsidian" is a types-only package
 * in this repo), so this file inspects the raw source text instead of
 * calling into the class. Real behavioral coverage of the projection
 * pipeline itself (build/invert/apply, conflict, resolve-failed, two
 * consecutive Applies) lives in
 * tests/quotePrefixPartialEditApply.test.ts and
 * tests/quotePrefixProjection.test.ts — this file only confirms the View
 * layer actually calls into that logic at the right place, in the right
 * order, and that no hook point was missed.
 */
describe("view/PartialEditView.ts quote-prefix-projection wiring (static source check, Phase 5D-0.5)", () => {
  const viewTs = readFileSync(path.resolve(__dirname, "../src/view/PartialEditView.ts"), "utf-8");

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

  it("imports buildQuotePrefixProjection/invertQuotePrefixProjection/projectedDisplayText from edit/quotePrefixProjection", () => {
    expect(viewTs).toContain('from "../edit/quotePrefixProjection"');
    expect(viewTs).toContain("buildQuotePrefixProjection");
    expect(viewTs).toContain("invertQuotePrefixProjection");
    expect(viewTs).toContain("projectedDisplayText");
  });

  it("declares a quoteProjection field, initialized to null", () => {
    expect(viewTs).toMatch(/private quoteProjection: QuotePrefixProjection \| null = null;/);
  });

  it("currentDisplayText() returns projectedDisplayText(quoteProjection) when set, else raw originalText — never the reverse", () => {
    const body = bodyOf(viewTs, "private currentDisplayText(): string {", "currentDisplayText()");
    expect(body).toContain(
      "if (this.quoteProjection) return projectedDisplayText(this.quoteProjection);"
    );
    // Phase 5L-1: quoteProjection is still checked FIRST, then the new
    // standalone-list marker-free projection, then plain originalText —
    // a node is never both a callout/blockquote and a list, but pinning
    // this ordering down makes a future third projection kind less likely
    // to be inserted ahead of quoteProjection by accident.
    const quoteIdx = body.indexOf(
      "if (this.quoteProjection) return projectedDisplayText(this.quoteProjection);"
    );
    const listIdx = body.indexOf("if (this.standaloneListMarkerProjection)");
    const rawIdx = body.indexOf("return this.originalText;");
    expect(quoteIdx).toBeGreaterThan(-1);
    expect(listIdx).toBeGreaterThan(quoteIdx);
    expect(rawIdx).toBeGreaterThan(listIdx);
  });

  it("loadNodeInternal: buildQuotePrefixProjection runs, and a 'nested' refusal returns, strictly BEFORE this.nodeId is ever assigned — a refusal must leave the pane's prior state completely untouched", () => {
    const body = bodyOf(viewTs, "private loadNodeInternal(nodeId: string): void {", "loadNodeInternal()");
    const buildIndex = body.indexOf("buildQuotePrefixProjection(extracted.text, extracted.kind)");
    const nestedNoticeIndex = body.indexOf('this.plugin.t("partialEdit.quoteNestedUnsupported")');
    const nodeIdAssignIndex = body.indexOf("this.nodeId = nodeId;");
    expect(buildIndex).toBeGreaterThan(-1);
    expect(nestedNoticeIndex).toBeGreaterThan(-1);
    expect(nodeIdAssignIndex).toBeGreaterThan(-1);
    expect(buildIndex).toBeLessThan(nestedNoticeIndex);
    expect(nestedNoticeIndex).toBeLessThan(nodeIdAssignIndex);
  });

  it("loadNodeInternal: this.quoteProjection is assigned alongside this.originalText (same load, one snapshot)", () => {
    const body = bodyOf(viewTs, "private loadNodeInternal(nodeId: string): void {", "loadNodeInternal()");
    const originalTextIndex = body.indexOf("this.originalText = extracted.text;");
    const quoteProjectionIndex = body.indexOf("this.quoteProjection = quoteProjection;");
    expect(originalTextIndex).toBeGreaterThan(-1);
    expect(quoteProjectionIndex).toBeGreaterThan(-1);
    expect(originalTextIndex).toBeLessThan(quoteProjectionIndex);
  });

  it("loadParagraphInternal resets quoteProjection to null — a paragraph never projects", () => {
    const body = bodyOf(
      viewTs,
      "private loadParagraphInternal(cursorLine: number): void {",
      "loadParagraphInternal()"
    );
    expect(body).toContain("this.quoteProjection = null;");
  });

  it("renderEmptyState resets quoteProjection to null (via the shared resetLoadedState helper) and calls renderQuoteHeader", () => {
    // 2026-09-09 ("単独 Callout Partial Edit Pane の stale snapshot 表示
    // バグ修正"): see compositeBlockPartialEditUiWiring.test.ts's identical
    // note — quoteProjection's reset moved off renderEmptyState's own
    // inline resets and into the new shared resetLoadedState() method
    // (also called from onClose); renderEmptyState now delegates to it.
    const emptyStateBody = bodyOf(viewTs, "private renderEmptyState(): void {", "renderEmptyState()");
    expect(emptyStateBody).toContain("this.resetLoadedState();");
    expect(emptyStateBody).toContain("this.renderQuoteHeader();");
    const resetBody = bodyOf(viewTs, "private resetLoadedState(): void {", "resetLoadedState()");
    expect(resetBody).toContain("this.quoteProjection = null;");
  });

  it("renderLoadedState sets the textarea from currentDisplayText(), never from raw originalText directly, and calls renderQuoteHeader", () => {
    const body = bodyOf(viewTs, "private renderLoadedState(): void {", "renderLoadedState()");
    expect(body).toContain("this.textareaEl.value = this.currentDisplayText();");
    expect(body).not.toContain("this.textareaEl.value = this.originalText;");
    expect(body).toContain("this.renderQuoteHeader();");
  });

  it("cancelEdit reverts the textarea to currentDisplayText(), never to raw originalText directly", () => {
    const body = bodyOf(viewTs, "private cancelEdit(): void {", "cancelEdit()");
    expect(body).toContain("this.textareaEl.value = this.currentDisplayText();");
    expect(body).not.toContain("this.textareaEl.value = this.originalText;");
  });

  it("isDirty() compares the textarea against currentDisplayText(), never against raw originalText directly", () => {
    const body = bodyOf(viewTs, "private isDirty(): boolean {", "isDirty()");
    expect(body).toContain("this.textareaEl.value !== this.currentDisplayText()");
    expect(body).not.toContain("this.textareaEl.value !== this.originalText");
  });

  it("applyEdit's non-paragraph branch inverts the projection (when present), refuses on a 'blockquote-empty' failure, and re-verifies the reconstructed candidate against the current parser/scanner — all strictly BEFORE ever calling applySubtreeEdit (Phase 5D-1.5)", () => {
    const body = bodyOf(viewTs, "private applyEdit(): boolean {", "applyEdit()");
    const invertIndex = body.indexOf(
      "invertQuotePrefixProjection(this.quoteProjection, this.textareaEl.value)"
    );
    const emptyNoticeIndex = body.indexOf(
      'this.plugin.t("partialEdit.quoteBodyEmptyUnsupported")'
    );
    // Phase 5D-1.5: the "quoteLineCountChanged" refusal this test used to
    // pin is gone — invertQuotePrefixProjection now reconstructs a
    // variable-length edit instead of refusing it outright (see that
    // function's own doc comment). The only remaining invert-stage
    // refusal is "blockquote-empty".
    const structureNoticeIndex = body.indexOf(
      'this.plugin.t("partialEdit.quoteEditStructureInvalid")'
    );
    // Phase 5E-3: the call site reformatted to a multi-line call (a 5th,
    // conditional fencedCodeInfoString argument was added) — this still
    // matches on the same four leading, unconditional arguments.
    const applySubtreeEditIndex = body.indexOf(
      "applySubtreeEdit(\n          doc,\n          this.nodeId!,\n          this.originalText,\n          newRawText,"
    );
    expect(invertIndex).toBeGreaterThan(-1);
    expect(emptyNoticeIndex).toBeGreaterThan(-1);
    expect(structureNoticeIndex).toBeGreaterThan(-1);
    expect(applySubtreeEditIndex).toBeGreaterThan(-1);
    expect(invertIndex).toBeLessThan(emptyNoticeIndex);
    expect(emptyNoticeIndex).toBeLessThan(structureNoticeIndex);
    expect(structureNoticeIndex).toBeLessThan(applySubtreeEditIndex);
  });

  it("applyEdit's non-paragraph success path re-anchors originalText to the reconstructed raw text (newRawText), never to the textarea's own (possibly prefix-stripped) value", () => {
    const body = bodyOf(viewTs, "private applyEdit(): boolean {", "applyEdit()");
    expect(body).toContain("this.originalText = newRawText;");
    // The OLD pre-5D-0.5 line must be gone from this branch — keeping it
    // would silently re-introduce raw/display desync for a projecting
    // node the very next time isDirty()/currentDisplayText() runs.
    const nonParagraphTail = body.slice(body.indexOf("const outcome = applySubtreeEdit(doc, this.nodeId!"));
    expect(nonParagraphTail).not.toContain("this.originalText = this.textareaEl.value;");
  });

  it("applyEdit's non-paragraph success path rebuilds quoteProjection fresh from the just-applied raw text when a projection was active", () => {
    const body = bodyOf(viewTs, "private applyEdit(): boolean {", "applyEdit()");
    const reanchorIndex = body.indexOf("this.originalText = newRawText;");
    const rebuildIndex = body.indexOf("buildQuotePrefixProjection(newRawText, kind)");
    expect(reanchorIndex).toBeGreaterThan(-1);
    expect(rebuildIndex).toBeGreaterThan(-1);
    expect(reanchorIndex).toBeLessThan(rebuildIndex);
  });

  it("renderQuoteHeader hides the header row when quoteProjection has no header (blockquote / non-projecting) and shows it verbatim for a projecting callout with no titleSlot", () => {
    const body = bodyOf(viewTs, "private renderQuoteHeader(): void {", "renderQuoteHeader()");
    expect(body).toContain("this.quoteHeaderEl.toggleVisibility(false);");
    expect(body).toContain("this.quoteHeaderEl.toggleVisibility(true);");
    // Phase 5D-1A: renderQuoteHeader now targets quoteHeaderLabelEl (the
    // read-only child), never quoteHeaderEl itself — see
    // quoteHeaderLabelEl's own doc comment for why. This is an
    // intentional 5D-1A call-site change, not a regression: the OLD
    // `this.quoteHeaderEl.setText(header)` call site is gone.
    expect(body).toContain("this.quoteHeaderLabelEl.setText(header);");
  });

  it("renderQuoteHeader (Phase 5D-1C, superseded 2026-09-09 — see below): when quoteProjection.titleSlot is non-null, it shows the row, reveals+enables the type input pre-filled with the loaded type, reveals+enables the title input, and pre-fills it with the loaded title", () => {
    const body = bodyOf(viewTs, "private renderQuoteHeader(): void {", "renderQuoteHeader()");
    expect(body).toContain("this.quoteTypeInputEl.toggleVisibility(true);");
    expect(body).toContain("this.quoteTypeInputEl.disabled = false;");
    expect(body).toContain("this.quoteTypeInputEl.value = titleSlot.type;");
    expect(body).toContain("this.quoteTitleInputEl.toggleVisibility(true);");
    expect(body).toContain("this.quoteTitleInputEl.disabled = false;");
    expect(body).toContain("this.quoteTitleInputEl.value = titleSlot.title;");
  });

  it("renderQuoteHeader (2026-09-09, Partial Edit Pane コールアウト編集ヘッダーUI改善): when titleSlot is non-null, the label is set to the Outline Tree's own STANDALONE_CALLOUT_PREFIX glyph instead of the raw quotePrefix + \"[!\" text, and quoteTypeCloseLabelEl's literal \"]\" is permanently dropped (kept hidden/empty even in this branch) — this legitimately supersedes this same file's earlier Phase 5D-1C assertion of the old raw-punctuation display, per this ticket's approved scope", () => {
    const body = bodyOf(viewTs, "private renderQuoteHeader(): void {", "renderQuoteHeader()");
    expect(body).toContain("this.quoteHeaderLabelEl.setText(STANDALONE_CALLOUT_PREFIX);");
    expect(body).not.toContain('this.quoteHeaderLabelEl.setText(titleSlot.quotePrefix + "[!");');
    // The old "reveal with `]`" call sites (toggleVisibility(true) +
    // setText("]")) for quoteTypeCloseLabelEl no longer exist anywhere in
    // this function — every remaining toggleVisibility call for that
    // element is now `false`, in both branches.
    expect(body).not.toContain("this.quoteTypeCloseLabelEl.toggleVisibility(true);");
    expect(body).not.toContain('this.quoteTypeCloseLabelEl.setText("]");');
  });

  it("renderQuoteHeader (Phase 5D-1A): hides and clears the title input whenever titleSlot is null (blockquote, non-projecting, or a callout header with no title slot)", () => {
    const body = bodyOf(viewTs, "private renderQuoteHeader(): void {", "renderQuoteHeader()");
    expect(body).toContain("this.quoteTitleInputEl.toggleVisibility(false);");
    expect(body).toContain('this.quoteTitleInputEl.value = "";');
  });

  it("renderQuoteHeader (Phase 5D-1C): hides and clears the type input and its close label whenever titleSlot is null", () => {
    const body = bodyOf(viewTs, "private renderQuoteHeader(): void {", "renderQuoteHeader()");
    expect(body).toContain("this.quoteTypeInputEl.toggleVisibility(false);");
    expect(body).toContain('this.quoteTypeInputEl.value = "";');
    expect(body).toContain("this.quoteTypeCloseLabelEl.toggleVisibility(false);");
    expect(body).toContain('this.quoteTypeCloseLabelEl.setText("");');
  });

  it("renderQuoteHeader (Phase 5D-1B): when titleSlot is non-null, it also reveals+enables the fold-marker select and pre-fills it with the loaded marker", () => {
    const body = bodyOf(viewTs, "private renderQuoteHeader(): void {", "renderQuoteHeader()");
    expect(body).toContain("this.quoteMarkerSelectEl.toggleVisibility(true);");
    expect(body).toContain("this.quoteMarkerSelectEl.disabled = false;");
    expect(body).toContain("this.quoteMarkerSelectEl.value = titleSlot.marker;");
  });

  it("renderQuoteHeader (Phase 5D-1B): hides the fold-marker select and resets it to the empty (not-foldable) option whenever titleSlot is null", () => {
    const body = bodyOf(viewTs, "private renderQuoteHeader(): void {", "renderQuoteHeader()");
    expect(body).toContain("this.quoteMarkerSelectEl.toggleVisibility(false);");
    expect(body).toContain('this.quoteMarkerSelectEl.value = "";');
  });

  it("onOpen (Phase 5D-1A): creates quoteHeaderLabelEl and quoteTitleInputEl as children of quoteHeaderEl, and wires the title input's own 'input' listener to updateDirtyState", () => {
    const body = bodyOf(viewTs, "async onOpen(): Promise<void> {", "onOpen()");
    expect(body).toContain("this.quoteHeaderLabelEl = this.quoteHeaderEl.createSpan(");
    expect(body).toContain('this.quoteTitleInputEl = this.quoteHeaderEl.createEl("input"');
    expect(body).toContain(
      'this.quoteTitleInputEl.addEventListener("input", () => this.updateDirtyState());'
    );
  });

  it("onOpen (Phase 5D-1B): creates quoteMarkerSelectEl as a child of quoteHeaderEl, with exactly the three closed-set options (\"\", \"+\", \"-\"), a tooltip, and its own 'change' listener wired to updateDirtyState", () => {
    const body = bodyOf(viewTs, "async onOpen(): Promise<void> {", "onOpen()");
    expect(body).toContain('this.quoteMarkerSelectEl = this.quoteHeaderEl.createEl("select"');
    expect(body).toContain('value: "",');
    expect(body).toContain('text: this.plugin.t("partialEdit.quoteFoldMarkerNone"),');
    expect(body).toContain('value: "+",');
    expect(body).toContain('text: this.plugin.t("partialEdit.quoteFoldMarkerExpand"),');
    expect(body).toContain('value: "-",');
    expect(body).toContain('text: this.plugin.t("partialEdit.quoteFoldMarkerCollapse"),');
    expect(body).toContain(
      'setTooltip(this.quoteMarkerSelectEl, this.plugin.t("partialEdit.quoteFoldMarkerLabel"));'
    );
    expect(body).toContain(
      'this.quoteMarkerSelectEl.addEventListener("change", () => this.updateDirtyState());'
    );
  });

  it("onOpen (Phase 5D-1B): quoteMarkerSelectEl is created BEFORE quoteTitleInputEl — the fold-behavior control sits between the read-only label and the title input", () => {
    const body = bodyOf(viewTs, "async onOpen(): Promise<void> {", "onOpen()");
    const selectIndex = body.indexOf('this.quoteMarkerSelectEl = this.quoteHeaderEl.createEl("select"');
    const titleInputIndex = body.indexOf('this.quoteTitleInputEl = this.quoteHeaderEl.createEl("input"');
    expect(selectIndex).toBeGreaterThan(-1);
    expect(titleInputIndex).toBeGreaterThan(-1);
    expect(selectIndex).toBeLessThan(titleInputIndex);
  });

  it("onOpen (Phase 5D-1C): creates quoteTypeDatalistEl with the QUOTE_TYPE_DATALIST_ID id and populates it with all 13 standard callout type <option> values", () => {
    const body = bodyOf(viewTs, "async onOpen(): Promise<void> {", "onOpen()");
    expect(body).toContain('this.quoteTypeDatalistEl = this.quoteHeaderEl.createEl("datalist"');
    expect(body).toContain("attr: { id: PartialEditView.QUOTE_TYPE_DATALIST_ID }");
    expect(body).toContain("for (const type of PartialEditView.QUOTE_TYPE_DATALIST_OPTIONS)");
    expect(body).toContain('this.quoteTypeDatalistEl.createEl("option", { value: type });');
  });

  it("onOpen (Phase 5D-1C, updated by the datalist-filtering fix): creates quoteTypeInputEl as a free-text input wired to the datalist via its list attribute, with a tooltip and an 'input' listener wired to BOTH refreshQuoteTypeDatalistOptions AND updateDirtyState", () => {
    const body = bodyOf(viewTs, "async onOpen(): Promise<void> {", "onOpen()");
    expect(body).toContain('this.quoteTypeInputEl = this.quoteHeaderEl.createEl("input"');
    expect(body).toContain("attr: { list: PartialEditView.QUOTE_TYPE_DATALIST_ID }");
    expect(body).toContain(
      'setTooltip(this.quoteTypeInputEl, this.plugin.t("partialEdit.quoteTypeLabel"));'
    );
    const listenerIndex = body.indexOf('this.quoteTypeInputEl.addEventListener("input", () => {');
    expect(listenerIndex).toBeGreaterThan(-1);
    const listenerEnd = body.indexOf("});", listenerIndex);
    expect(listenerEnd).toBeGreaterThan(-1);
    const listenerBody = body.slice(listenerIndex, listenerEnd + "});".length);
    expect(listenerBody).toContain("this.refreshQuoteTypeDatalistOptions();");
    expect(listenerBody).toContain("this.updateDirtyState();");
  });

  it("refreshQuoteTypeDatalistOptions (fix applied after real-device verification): filters quoteTypeDatalistEl's <option> children to only the standard types that START WITH the current (lower-cased) input value, rebuilding it from PartialEditView.QUOTE_TYPE_DATALIST_OPTIONS every call — this takes over from the browser's own native <datalist> filtering (which matches ANY substring position, not just the start) but never restricts what can actually be typed/pasted/Applied", () => {
    const body = bodyOf(
      viewTs,
      "private refreshQuoteTypeDatalistOptions(): void {",
      "refreshQuoteTypeDatalistOptions()"
    );
    expect(body).toContain("const query = this.quoteTypeInputEl.value.toLowerCase();");
    expect(body).toContain("this.quoteTypeDatalistEl.empty();");
    expect(body).toContain("for (const type of PartialEditView.QUOTE_TYPE_DATALIST_OPTIONS) {");
    expect(body).toContain("if (type.startsWith(query)) {");
    expect(body).toContain('this.quoteTypeDatalistEl.createEl("option", { value: type });');
  });

  it("renderQuoteHeader (fix applied after real-device verification): re-filters the datalist immediately after setting quoteTypeInputEl.value, in BOTH the titleSlot-present and titleSlot-null branches, so the suggestion list never goes stale across a node switch", () => {
    const body = bodyOf(viewTs, "private renderQuoteHeader(): void {", "renderQuoteHeader()");
    const presentValueIndex = body.indexOf("this.quoteTypeInputEl.value = titleSlot.type;");
    expect(presentValueIndex).toBeGreaterThan(-1);
    const presentRefreshIndex = body.indexOf(
      "this.refreshQuoteTypeDatalistOptions();",
      presentValueIndex
    );
    expect(presentRefreshIndex).toBeGreaterThan(-1);
    // 2026-09-09: the old boundary marker here, quoteTypeCloseLabelEl's
    // `toggleVisibility(true)` reveal, no longer exists in this branch
    // (see this file's own 2026-09-09 test above) — quoteMarkerSelectEl's
    // `toggleVisibility(true)` reveal is the next distinct, still-unique
    // step in the titleSlot-present branch and serves the same purpose.
    expect(presentRefreshIndex).toBeLessThan(
      body.indexOf("this.quoteMarkerSelectEl.toggleVisibility(true);")
    );

    const nullValueIndex = body.indexOf('this.quoteTypeInputEl.value = "";');
    expect(nullValueIndex).toBeGreaterThan(-1);
    const nullRefreshIndex = body.indexOf("this.refreshQuoteTypeDatalistOptions();", nullValueIndex);
    expect(nullRefreshIndex).toBeGreaterThan(-1);
    // 2026-09-09: quoteTypeCloseLabelEl.toggleVisibility(false) now
    // appears in BOTH branches (see this file's own 2026-09-09 test
    // above), so the search must start from nullValueIndex to find the
    // null-branch's own occurrence rather than the earlier, titleSlot-
    // present branch's one.
    expect(nullRefreshIndex).toBeLessThan(
      body.indexOf("this.quoteTypeCloseLabelEl.toggleVisibility(false);", nullValueIndex)
    );
  });

  it("cancelEdit (fix applied after real-device verification): re-filters the datalist immediately after reverting quoteTypeInputEl.value back to titleSlot.type", () => {
    const body = bodyOf(viewTs, "private cancelEdit(): void {", "cancelEdit()");
    const valueIndex = body.indexOf("this.quoteTypeInputEl.value = titleSlot.type;");
    expect(valueIndex).toBeGreaterThan(-1);
    const refreshIndex = body.indexOf("this.refreshQuoteTypeDatalistOptions();", valueIndex);
    expect(refreshIndex).toBeGreaterThan(-1);
  });

  it("onOpen (Phase 5D-1C): creates quoteTypeCloseLabelEl as a read-only span reusing the quote-header-label CSS class", () => {
    const body = bodyOf(viewTs, "async onOpen(): Promise<void> {", "onOpen()");
    expect(body).toContain("this.quoteTypeCloseLabelEl = this.quoteHeaderEl.createSpan(");
    expect(body).toContain('cls: "unified-outliner-partial-edit-quote-header-label"');
  });

  it("onOpen (Phase 5D-1C): quoteTypeDatalistEl and quoteTypeInputEl are created BEFORE quoteMarkerSelectEl — the type combobox sits between the read-only \"[!\" label and the fold-marker select", () => {
    const body = bodyOf(viewTs, "async onOpen(): Promise<void> {", "onOpen()");
    const datalistIndex = body.indexOf('this.quoteTypeDatalistEl = this.quoteHeaderEl.createEl("datalist"');
    const typeInputIndex = body.indexOf('this.quoteTypeInputEl = this.quoteHeaderEl.createEl("input"');
    const selectIndex = body.indexOf('this.quoteMarkerSelectEl = this.quoteHeaderEl.createEl("select"');
    expect(datalistIndex).toBeGreaterThan(-1);
    expect(typeInputIndex).toBeGreaterThan(-1);
    expect(selectIndex).toBeGreaterThan(-1);
    expect(datalistIndex).toBeLessThan(typeInputIndex);
    expect(typeInputIndex).toBeLessThan(selectIndex);
  });

  it("cancelEdit (Phase 5D-1A): reverts the title input back to the loaded titleSlot's own title whenever a titleSlot is active", () => {
    const body = bodyOf(viewTs, "private cancelEdit(): void {", "cancelEdit()");
    expect(body).toContain("this.quoteTitleInputEl.value = titleSlot.title;");
  });

  it("cancelEdit (Phase 5D-1B): also reverts the fold-marker select back to the loaded titleSlot's own marker, in the same titleSlot-gated branch as the title revert", () => {
    const body = bodyOf(viewTs, "private cancelEdit(): void {", "cancelEdit()");
    expect(body).toContain("this.quoteMarkerSelectEl.value = titleSlot.marker;");
    const markerRevertIndex = body.indexOf("this.quoteMarkerSelectEl.value = titleSlot.marker;");
    const titleRevertIndex = body.indexOf("this.quoteTitleInputEl.value = titleSlot.title;");
    const ifTitleSlotIndex = body.lastIndexOf("if (titleSlot)", markerRevertIndex);
    expect(ifTitleSlotIndex).toBeGreaterThan(-1);
    expect(ifTitleSlotIndex).toBeLessThan(markerRevertIndex);
    expect(ifTitleSlotIndex).toBeLessThan(titleRevertIndex);
  });

  it("cancelEdit (Phase 5D-1C): also reverts the type input back to the loaded titleSlot's own type, in the same titleSlot-gated branch as the marker/title revert", () => {
    const body = bodyOf(viewTs, "private cancelEdit(): void {", "cancelEdit()");
    expect(body).toContain("this.quoteTypeInputEl.value = titleSlot.type;");
    const typeRevertIndex = body.indexOf("this.quoteTypeInputEl.value = titleSlot.type;");
    const ifTitleSlotIndex = body.lastIndexOf("if (titleSlot)", typeRevertIndex);
    expect(ifTitleSlotIndex).toBeGreaterThan(-1);
    expect(ifTitleSlotIndex).toBeLessThan(typeRevertIndex);
  });

  it("isDirty (Phase 5D-1A): considers the title input dirty too — the pane is dirty if EITHER the textarea OR the title input differs from its own loaded value", () => {
    const body = bodyOf(viewTs, "private isDirty(): boolean {", "isDirty()");
    expect(body).toContain("this.quoteTitleInputEl.value !== titleSlot.title");
    expect(body).toMatch(/this\.textareaEl\.value !== this\.currentDisplayText\(\)\s*\|\|\s*titleDirty/);
  });

  it("isDirty (Phase 5D-1B): also considers the fold-marker select dirty — markerDirty is computed from quoteMarkerSelectEl vs. titleSlot.marker, gated the same way as titleDirty, and included in the same OR chain", () => {
    const body = bodyOf(viewTs, "private isDirty(): boolean {", "isDirty()");
    expect(body).toContain(
      "const markerDirty = titleSlot !== null && this.quoteMarkerSelectEl.value !== titleSlot.marker;"
    );
    expect(body).toMatch(
      /this\.textareaEl\.value !== this\.currentDisplayText\(\)\s*\|\|\s*titleDirty\s*\|\|\s*markerDirty/
    );
  });

  it("isDirty (Phase 5D-1C): also considers the type input dirty — typeDirty is computed from quoteTypeInputEl vs. titleSlot.type, gated the same way as titleDirty/markerDirty, and included in the same OR chain", () => {
    const body = bodyOf(viewTs, "private isDirty(): boolean {", "isDirty()");
    expect(body).toContain(
      "const typeDirty = titleSlot !== null && this.quoteTypeInputEl.value !== titleSlot.type;"
    );
    expect(body).toMatch(
      /this\.textareaEl\.value !== this\.currentDisplayText\(\)\s*\|\|\s*titleDirty\s*\|\|\s*markerDirty\s*\|\|\s*typeDirty/
    );
  });

  it("applyEdit (Phase 5D-1C): when titleSlot is active, reconstructs the header from the type input's, fold-marker select's, and title input's CURRENT values via a single reconstructQuoteHeader(titleSlot, newType, newMarker, title) call, refuses (returns false) on failure BEFORE ever calling applySubtreeEdit, and otherwise splices the reconstructed header in as newRawText's first line", () => {
    const body = bodyOf(viewTs, "private applyEdit(): boolean {", "applyEdit()");
    const newTypeIndex = body.indexOf("const newType = this.quoteTypeInputEl.value;");
    const newMarkerCastIndex = body.indexOf(
      "const newMarker = this.quoteMarkerSelectEl.value as CalloutFoldMarker;"
    );
    const reconstructCallIndex = body.indexOf("const reconstructed = reconstructQuoteHeader(");
    expect(newTypeIndex).toBeGreaterThan(-1);
    expect(newMarkerCastIndex).toBeGreaterThan(-1);
    expect(reconstructCallIndex).toBeGreaterThan(-1);
    expect(newTypeIndex).toBeLessThan(newMarkerCastIndex);
    expect(newMarkerCastIndex).toBeLessThan(reconstructCallIndex);
    // The call spans multiple lines — confirm it passes titleSlot,
    // newType, newMarker, and the title input's current value, in that
    // exact order.
    const reconstructCallBlock = body.slice(
      reconstructCallIndex,
      body.indexOf(");", reconstructCallIndex) + 2
    );
    expect(reconstructCallBlock).toMatch(
      /reconstructQuoteHeader\(\s*titleSlot,\s*newType,\s*newMarker,\s*this\.quoteTitleInputEl\.value\s*\)/
    );
    const noticeIndex = body.indexOf('this.plugin.t("partialEdit.quoteTitleNewlineUnsupported")');
    // Phase 5E-3: the call site reformatted to a multi-line call (a 5th,
    // conditional fencedCodeInfoString argument was added) — this still
    // matches on the same four leading, unconditional arguments.
    const applySubtreeEditIndex = body.indexOf(
      "applySubtreeEdit(\n          doc,\n          this.nodeId!,\n          this.originalText,\n          newRawText,"
    );
    expect(noticeIndex).toBeGreaterThan(-1);
    expect(applySubtreeEditIndex).toBeGreaterThan(-1);
    expect(reconstructCallIndex).toBeLessThan(noticeIndex);
    expect(noticeIndex).toBeLessThan(applySubtreeEditIndex);
    expect(body).toContain("const bodyOnlyLines = newRawText.split(\"\\n\").slice(1);");
    expect(body).toContain("newRawText = [reconstructed.header, ...bodyOnlyLines].join(\"\\n\");");
  });

  it("applyEdit (Phase 5D-1C): a reconstructQuoteHeader failure shows a Notice for reason \"newline\" AND for reason \"invalid-type\" — the unreachable \"invalid-marker\" reason remains a silent, safe no-op with no Notice of its own", () => {
    const body = bodyOf(viewTs, "private applyEdit(): boolean {", "applyEdit()");
    const failureStart = body.indexOf("if (!reconstructed.ok) {");
    expect(failureStart).toBeGreaterThan(-1);
    const returnFalseIndex = body.indexOf("return false;", failureStart);
    expect(returnFalseIndex).toBeGreaterThan(-1);
    const failureBlock = body.slice(failureStart, returnFalseIndex + "return false;".length);
    expect(failureBlock).toContain('if (reconstructed.reason === "newline") {');
    expect(failureBlock).toContain('} else if (reconstructed.reason === "invalid-type") {');
    expect(failureBlock).toContain(
      'new Notice(this.plugin.t("partialEdit.quoteTypeInvalidUnsupported"));'
    );
    // Exactly two Notice calls in the whole failure-handling block — one
    // for "newline", one for the newly-reachable "invalid-type". The
    // "invalid-marker" reason (structurally unreachable through this
    // view's own closed-set <select>) still falls through to the bare
    // `return false;` with no Notice of its own, per the ticket's
    // explicit "既存のNoticeを増やさない" instruction (extended, not
    // broken, by this phase).
    const noticeCallCount = (failureBlock.match(/new Notice\(/g) ?? []).length;
    expect(noticeCallCount).toBe(2);
  });

  it("the i18n keys this ticket introduces (quoteNestedUnsupported / quoteBodyEmptyUnsupported / quoteEditStructureInvalid) exist with non-empty en/ja text", () => {
    // Phase 5D-1.5: quoteLineCountChanged is retired (adding/removing
    // lines is now supported) in favor of quoteBodyEmptyUnsupported (a
    // blockquote's body was fully cleared) and quoteEditStructureInvalid
    // (the reconstructed candidate failed re-verification against the
    // current parser/scanner).
    const i18nTs = readFileSync(path.resolve(__dirname, "../src/i18n.ts"), "utf-8");
    for (const key of [
      "partialEdit.quoteNestedUnsupported",
      "partialEdit.quoteBodyEmptyUnsupported",
      "partialEdit.quoteEditStructureInvalid",
    ]) {
      const matches = i18nTs.match(new RegExp(`"${key}":\\s*\\n?\\s*"([^"]+)"`, "g")) ?? [];
      // Present in both the en and ja dictionaries.
      expect(matches.length).toBe(2);
      for (const m of matches) {
        const textMatch = m.match(/"([^"]+)"\s*$/);
        expect(textMatch?.[1]?.length).toBeGreaterThan(0);
      }
    }
  });

  it("the i18n keys Phase 5D-1B introduces (quoteFoldMarkerLabel / quoteFoldMarkerNone / quoteFoldMarkerExpand / quoteFoldMarkerCollapse) exist with non-empty en/ja text", () => {
    const i18nTs = readFileSync(path.resolve(__dirname, "../src/i18n.ts"), "utf-8");
    for (const key of [
      "partialEdit.quoteFoldMarkerLabel",
      "partialEdit.quoteFoldMarkerNone",
      "partialEdit.quoteFoldMarkerExpand",
      "partialEdit.quoteFoldMarkerCollapse",
    ]) {
      const matches = i18nTs.match(new RegExp(`"${key}":\\s*\\n?\\s*"([^"]+)"`, "g")) ?? [];
      // Present in both the en and ja dictionaries.
      expect(matches.length).toBe(2);
      for (const m of matches) {
        const textMatch = m.match(/"([^"]+)"\s*$/);
        expect(textMatch?.[1]?.length).toBeGreaterThan(0);
      }
    }
  });

  it("the i18n keys Phase 5D-1C introduces (quoteTypeLabel / quoteTypeInvalidUnsupported) exist with non-empty en/ja text", () => {
    const i18nTs = readFileSync(path.resolve(__dirname, "../src/i18n.ts"), "utf-8");
    // quoteTypeInvalidUnsupported's own wording (per the ticket) contains
    // a literal double-quoted "]" inside the message, so — unlike every
    // other key checked in this file — its dictionary entries are
    // single-quoted string literals rather than double-quoted ones; this
    // regex accepts either quote style around the value.
    for (const key of ["partialEdit.quoteTypeLabel", "partialEdit.quoteTypeInvalidUnsupported"]) {
      const matches =
        i18nTs.match(new RegExp(`"${key}":\\s*\\n?\\s*(?:"[^"]+"|'[^']+')`, "g")) ?? [];
      // Present in both the en and ja dictionaries.
      expect(matches.length).toBe(2);
      for (const m of matches) {
        const textMatch = m.match(/["']([^"']+)["']\s*$/);
        expect(textMatch?.[1]?.length).toBeGreaterThan(0);
      }
    }
  });
});
