import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createTranslator } from "../src/i18n";

/**
 * Phase 5A-1 ("Partial Edit Pane の stale 状態検知・安全な再読み込み",
 * docs/phase5a1_partial_edit_stale_pane_synchronization_design.md):
 * static-source-text checks for the stale/unavailable detection, clean-Pane
 * auto-reload, dirty-Pane protection, and Reload wiring added to
 * view/PartialEditView.ts and i18n.ts.
 *
 * Same constraint as tests/paragraphPartialEditViewWiring.test.ts and every
 * other *UiWiring.test.ts in this suite: PartialEditView (extends
 * Obsidian's ItemView) cannot be constructed in vitest, since "obsidian" is
 * a types-only package in this repo (no runtime mock exists — see this
 * ticket's own investigation phase, which confirmed this via a zero-result
 * __mocks__ search). This file therefore inspects the raw source text of
 * view/PartialEditView.ts and src/i18n.ts instead of calling into them,
 * exactly like the existing precedent.
 *
 * Phase 5A-1 hardening round (self-Apply suppression / paragraph read-only
 * resolver extraction / fail-closed cachedRead handling / pure-function
 * classification): unlike the original Phase 5A-1 round, this hardening
 * round DOES introduce genuinely Obsidian-independent logic —
 * edit/paragraphPartialEdit.ts#resolveParagraphAnchorText (hardening §2)
 * and the new view/partialEditSyncClassification.ts module (hardening §4,
 * classifySyncOutcome/shouldRunStaleCheck) — both covered by their own,
 * separate real-assertion test files
 * (tests/paragraphPartialEditResolveReadOnly.test.ts and
 * tests/partialEditSyncClassification.test.ts) rather than by static
 * source-text checks here. This file keeps confirming the WIRING —
 * PartialEditView.ts calling into those pure functions (and into the
 * pre-existing, unchanged extractSubtreeText/applyParagraphEdit/
 * extractCompositeBlockText/applySubtreeEdit/applyCompositeBlockEdit) at
 * the right places — never re-deriving their own internal correctness,
 * which is what the dedicated pure-function test files are for.
 */
describe("PartialEditView.ts Phase 5A-1 stale-Pane sync wiring (static source check)", () => {
  const viewTs = readFileSync(path.resolve(__dirname, "../src/view/PartialEditView.ts"), "utf-8");
  const i18nTs = readFileSync(path.resolve(__dirname, "../src/i18n.ts"), "utf-8");

  function bodyOf(source: string, needle: string, label: string): string {
    const start = source.indexOf(needle);
    if (start === -1) {
      throw new Error(`${label} not found — has it been renamed or removed?`);
    }
    // Find the closing brace at the SAME indentation as the opening line
    // (two leading spaces, matching every other method in this class) —
    // robust to nested braces inside the method body.
    const end = source.indexOf("\n  }", start);
    if (end === -1 || end <= start) {
      throw new Error(
        `Could not find ${label}'s closing brace — its shape may have changed; update this test's bounding logic.`
      );
    }
    return source.slice(start, end);
  }

  // ---- Event subscriptions and sourcePath-based matching -----------------

  it("onOpen registers editor-change, vault modify/rename/delete, and active-leaf-change/file-open, all via registerEvent", () => {
    const onOpenBody = bodyOf(viewTs, "async onOpen(): Promise<void> {", "onOpen");
    expect(onOpenBody).toContain('this.app.workspace.on("editor-change"');
    expect(onOpenBody).toContain('this.app.vault.on("modify"');
    expect(onOpenBody).toContain('this.app.vault.on("rename"');
    expect(onOpenBody).toContain('this.app.vault.on("delete"');
    expect(onOpenBody).toContain('this.app.workspace.on("active-leaf-change"');
    expect(onOpenBody).toContain('this.app.workspace.on("file-open"');
    // Every one of the above is wrapped in this.registerEvent(...), not a
    // raw workspace.on/vault.on — same lifecycle-safety convention as the
    // pre-existing layout-change registration.
    const editorChangeIndex = onOpenBody.indexOf('this.app.workspace.on("editor-change"');
    const precedingRegisterEvent = onOpenBody.lastIndexOf("this.registerEvent(", editorChangeIndex);
    expect(precedingRegisterEvent).toBeGreaterThan(-1);
    expect(editorChangeIndex - precedingRegisterEvent).toBeLessThan(60);
  });

  it("handleEditorChange matches by info.file?.path === this.sourcePath, never activeMarkdownView", () => {
    const body = bodyOf(
      viewTs,
      "private handleEditorChange(_editor: Editor, info: MarkdownView | MarkdownFileInfo): void {",
      "handleEditorChange"
    );
    expect(body).toContain("info.file?.path !== this.sourcePath");
    expect(body).not.toContain("activeMarkdownView");
    expect(body).toContain("this.scheduleStaleCheck()");
  });

  it("handleVaultModify matches by TFile instanceof + file.path === this.sourcePath, and never touches the textarea directly", () => {
    const body = bodyOf(
      viewTs,
      "private handleVaultModify(file: TAbstractFile): void {",
      "handleVaultModify"
    );
    expect(body).toContain("file instanceof TFile");
    expect(body).toContain("file.path !== this.sourcePath");
    expect(body).toContain("this.scheduleStaleCheck()");
    expect(body).not.toContain("textareaEl.value =");
  });

  it("handleVaultRename follows sourcePath to the new path without touching the textarea, then re-checks", () => {
    const body = bodyOf(
      viewTs,
      "private handleVaultRename(file: TAbstractFile, oldPath: string): void {",
      "handleVaultRename"
    );
    expect(body).toContain("oldPath !== this.sourcePath");
    expect(body).toContain("this.sourcePath = file.path");
    expect(body).toContain("this.scheduleStaleCheck()");
    expect(body).not.toContain("textareaEl.value =");
  });

  it("handleVaultDelete transitions directly to unavailable without clearing any loaded/dirty state", () => {
    const body = bodyOf(
      viewTs,
      "private handleVaultDelete(file: TAbstractFile): void {",
      "handleVaultDelete"
    );
    expect(body).toContain("file.path !== this.sourcePath");
    expect(body).toContain("this.transitionToUnavailable()");
    // Must never null out nodeId/paragraphAnchor/compositeAnchor/
    // originalText, and must never touch the textarea — an in-progress
    // dirty edit is preserved even after its source note is deleted.
    expect(body).not.toContain("this.nodeId = null");
    expect(body).not.toContain("this.paragraphAnchor = null");
    expect(body).not.toContain("this.compositeAnchor = null");
    expect(body).not.toContain("textareaEl.value =");
  });

  it("active-leaf-change and file-open only ever call scheduleStaleCheck() — never inspect which file/leaf fired, never call a transition method directly", () => {
    const onOpenBody = bodyOf(viewTs, "async onOpen(): Promise<void> {", "onOpen");
    const activeLeafLine = onOpenBody
      .split("\n")
      .find((line) => line.includes('workspace.on("active-leaf-change"'));
    const fileOpenLine = onOpenBody.split("\n").find((line) => line.includes('workspace.on("file-open"'));
    expect(activeLeafLine).toBeDefined();
    expect(fileOpenLine).toBeDefined();
    expect(activeLeafLine).toContain("this.scheduleStaleCheck()");
    expect(fileOpenLine).toContain("this.scheduleStaleCheck()");
    expect(activeLeafLine).not.toContain("transitionToStale");
    expect(activeLeafLine).not.toContain("transitionToUnavailable");
    expect(fileOpenLine).not.toContain("transitionToStale");
    expect(fileOpenLine).not.toContain("transitionToUnavailable");
  });

  // ---- Debounce ------------------------------------------------------------

  it("scheduleStaleCheck debounces performStaleCheck at 150ms with resetTimer true, matching OutlineTreeView.ts's own precedent", () => {
    expect(viewTs).toContain(
      "private scheduleStaleCheck = debounce(() => this.performStaleCheck(), 150, true);"
    );
  });

  it("performStaleCheck skips entirely once unavailable (no auto-recovery on reappearance), while self-Apply-suppressed, or once closed — via the shared shouldRunStaleCheck gate — and still guards on sourcePath/loaded state", () => {
    const body = bodyOf(viewTs, "private performStaleCheck(): void {", "performStaleCheck");
    expect(body).toContain("if (!this.sourcePath) return;");
    // Phase 5A-1 hardening §1/§4: closed/suppressed/unavailable are now one
    // shared, pure decision (shouldRunStaleCheck) rather than three
    // separate inline checks — see
    // tests/partialEditSyncClassification.test.ts for its own
    // real-assertion coverage of all three gates.
    expect(body).toContain("shouldRunStaleCheck({");
    expect(body).toContain("closed: this.closed,");
    expect(body).toContain("suppressed: this.isApplyingOwnEdit,");
    expect(body).toContain("currentSyncState: this.syncState,");
    expect(body).toContain("this.findOpenEditorForSourcePath()");
    expect(body).toContain("this.app.vault");
    expect(body).toContain(".cachedRead(file)");
  });

  // ---- E5 authoritative source (open editor first, else cachedRead) -------

  it('findOpenEditorForSourcePath searches getLeavesOfType("markdown") (which also covers pop-out windows) and matches by view.file?.path, never activeMarkdownView', () => {
    const body = bodyOf(
      viewTs,
      "private findOpenEditorForSourcePath(): Editor | null {",
      "findOpenEditorForSourcePath"
    );
    expect(body).toContain('this.app.workspace.getLeavesOfType("markdown")');
    expect(body).toContain("view.file?.path === this.sourcePath");
    expect(body).not.toContain("activeMarkdownView");
  });

  // ---- Stale-comparison reuse of existing read-only resolvers -------------

  it("resolveCurrentTarget reuses extractSubtreeText/resolveParagraphAnchorText/extractCompositeBlockText — the exact same read-side each anchor kind's own conflict check is built on — never a separately re-implemented comparison", () => {
    const body = bodyOf(
      viewTs,
      "private resolveCurrentTarget(doc: ParsedDocument): { ok: boolean; text: string | null; ambiguous: boolean } {",
      "resolveCurrentTarget"
    );
    expect(body).toContain("extractSubtreeText(doc, this.nodeId)");
    // Phase 5A-1 hardening §2: the discarded-result
    // applyParagraphEdit(doc, anchor, anchor.originalText) no-op probe is
    // gone — replaced by the dedicated, explicitly read-only
    // resolveParagraphAnchorText (edit/paragraphPartialEdit.ts), whose own
    // real-assertion tests live in
    // tests/paragraphPartialEditResolveReadOnly.test.ts.
    expect(body).toContain("resolveParagraphAnchorText(doc, this.paragraphAnchor)");
    expect(body).not.toContain("applyParagraphEdit(");
    expect(body).toContain("extractCompositeBlockText(doc, this.compositeAnchor, rules)");
    // resolveCurrentTarget itself must never reach the editor — every
    // branch is read-only.
    expect(body).not.toContain("applyLineEditOutcome(");
  });

  it("evaluateAgainstText delegates its classification to the pure classifySyncOutcome, then only dispatches the returned decision — never re-deciding stale-vs-unavailable-vs-auto-reload inline", () => {
    // Phase 5A-1 hardening §4: the ambiguous-leans-stale policy and the
    // clean-Pane auto-reload condition list both now live in
    // view/partialEditSyncClassification.ts#classifySyncOutcome, covered
    // by real-assertion tests in
    // tests/partialEditSyncClassification.test.ts — this test only
    // confirms evaluateAgainstText actually wires into that pure function
    // (import + call + full switch dispatch), not the decision logic
    // itself.
    expect(viewTs).toContain(
      'import { classifySyncOutcome, shouldRunStaleCheck } from "./partialEditSyncClassification";'
    );
    const evalBody = bodyOf(
      viewTs,
      "private evaluateAgainstText(text: string, path: string, fromLiveEditor: boolean): void {",
      "evaluateAgainstText"
    );
    expect(evalBody).toContain("classifySyncOutcome({");
    expect(evalBody).toContain("resolved,");
    expect(evalBody).toContain("originalText: this.originalText,");
    expect(evalBody).toContain("isDirty: this.isDirty(),");
    expect(evalBody).toContain("fromLiveEditor,");
    expect(evalBody).toContain('case "unavailable":');
    expect(evalBody).toContain('case "stale":');
    expect(evalBody).toContain('case "already-synced":');
    expect(evalBody).toContain('case "clean-pane-auto-reload":');
    expect(evalBody).toContain("this.transitionToUnavailable();");
    expect(evalBody).toContain("this.transitionToStale();");
    expect(evalBody).toContain("this.performAutoReload(resolved.text, doc);");
  });

  it("executeReload (explicit Reload) escalates an unresolved target to unavailable, unlike mere detection, and ALSO fails closed on a rejected cachedRead", () => {
    const body = bodyOf(viewTs, "private async executeReload(): Promise<void> {", "executeReload");
    expect(body).toContain("this.transitionToUnavailable();");
    expect(body).toContain('this.plugin.t("partialEdit.reloadFailedNotice")');
    // Phase 5A-1 hardening §3: an explicit Reload's own cachedRead is now
    // wrapped in try/catch — a rejection is treated exactly like any other
    // resolution failure (transitionToUnavailable + reloadFailedNotice),
    // documented and verified by
    // tests/partialEditStalePaneSyncUiWiring.test.ts's own dedicated test
    // below and by the code comment at this exact call site.
    expect(body).toContain("try {");
    expect(body).toContain("await this.app.vault.cachedRead(file)");
    expect(body).toContain("} catch {");
    // The reloadFailedNotice text appears exactly three times: the
    // pre-existing "file not found" branch, the pre-existing resolve-
    // failure branch, and this hardening round's new cachedRead-rejection
    // branch — never exposing the raw error/path in any of the three.
    const noticeOccurrences = body.split('this.plugin.t("partialEdit.reloadFailedNotice")').length - 1;
    expect(noticeOccurrences).toBe(3);
  });

  it("performStaleCheck's own passive cachedRead fails closed silently on rejection — no Notice, no state mutation, never escalates to unavailable on a transient read failure", () => {
    const body = bodyOf(viewTs, "private performStaleCheck(): void {", "performStaleCheck");
    expect(body).toContain("this.app.vault");
    expect(body).toContain(".cachedRead(file)");
    expect(body).toContain(".catch(() => {");
    // Must not show a Notice or call any transition method from inside the
    // catch handler — verified by scoping to the .catch(...) block itself.
    const catchStart = body.indexOf(".catch(() => {");
    const catchBlock = body.slice(catchStart, body.indexOf("});", catchStart));
    expect(catchBlock).not.toContain("new Notice(");
    expect(catchBlock).not.toContain("transitionToStale");
    expect(catchBlock).not.toContain("transitionToUnavailable");
  });

  // ---- Clean-Pane auto-reload safety conditions ----------------------------

  it("the six-condition clean-Pane auto-reload contract is documented where the decision now actually lives (partialEditSyncClassification.ts), with real-assertion coverage in tests/partialEditSyncClassification.test.ts — evaluateAgainstText's own doc comment on PartialEditView.ts still cross-references it", () => {
    const classificationTs = readFileSync(
      path.resolve(__dirname, "../src/view/partialEditSyncClassification.ts"),
      "utf-8"
    );
    expect(classificationTs).toContain("Clean-Pane auto-reload");
    expect(classificationTs).toContain("BOTH isDirty() === false");
    expect(classificationTs).toContain("fromLiveEditor");
    // evaluateAgainstText's own doc comment on PartialEditView.ts (above
    // the method, untouched by this hardening round's body refactor)
    // still describes the same auto-reload/stale-display distinction in
    // prose, cross-referencing performAutoReload's own condition list.
    expect(viewTs).toContain("silently, safely auto-reloads");
  });

  it("performAutoReload never calls editor.replaceRange / applyLineEditOutcome — it only updates this pane's own in-memory fields", () => {
    const body = bodyOf(
      viewTs,
      "private performAutoReload(newText: string, doc: ParsedDocument): void {",
      "performAutoReload"
    );
    expect(body).not.toContain("applyLineEditOutcome");
    expect(body).not.toContain(".replaceRange(");
    expect(body).toContain('this.syncState = "synced";');
    expect(body).toContain("this.textareaEl.value = this.currentDisplayText();");
  });

  // ---- Dirty-Pane protection --------------------------------------------

  it("performStaleCheck/evaluateAgainstText path never auto-updates the textarea for the E4 (vault.cachedRead, no open editor) case, dirty or not", () => {
    // fromLiveEditor is false on the cachedRead branch (see performStaleCheck),
    // and evaluateAgainstText's auto-reload branch is gated on
    // `fromLiveEditor` — so the cachedRead path can only ever reach
    // transitionToStale/transitionToUnavailable, never performAutoReload.
    const staleCheckBody = bodyOf(viewTs, "private performStaleCheck(): void {", "performStaleCheck");
    expect(staleCheckBody).toContain("this.evaluateAgainstText(text, path, false)");
  });

  // ---- Apply disabled while stale/unavailable, UX-layer only ------------

  it("updateDirtyState disables Apply while stale/unavailable via a UX-layer flag, with an explanatory tooltip — never touching the low-level fail-closed checks", () => {
    const body = bodyOf(viewTs, "private updateDirtyState(): void {", "updateDirtyState");
    expect(body).toContain('this.syncState !== "synced"');
    expect(body).toContain("this.applyButtonEl.disabled = anyLoaded ? applyBlockedBySync : true;");
    expect(body).toContain("setTooltip(");
    expect(body).toContain('"partialEdit.staleApplyDisabledReason"');
    expect(body).toContain('"partialEdit.unavailableApplyDisabledReason"');
  });

  it("applyEdit's own low-level fail-closed conflict checks (applySubtreeEdit/applyParagraphEdit/applyCompositeBlockEdit) are untouched by this ticket — no NEW gate on syncState, only an unconditional post-success reset", () => {
    const body = bodyOf(viewTs, "private applyEdit(): boolean {", "applyEdit");
    expect(body).toContain("applyParagraphEdit(doc, this.paragraphAnchor, this.textareaEl.value)");
    expect(body).toContain("applyCompositeBlockEdit(");
    expect(body).toContain("applySubtreeEdit(doc, this.nodeId!, this.originalText, newRawText)");
    // Neither the original Phase 5A-1 round nor this hardening round ever
    // GATES any of the three refusal branches above on syncState — the
    // UX-layer button-disable in updateDirtyState remains the only such
    // gate. Verified by scanning for a conditional reference specifically
    // ("if (...syncState" / "&& ...syncState" / "|| ...syncState"), rather
    // than for the identifier's absence outright — hardening §1
    // deliberately ADDS an UNCONDITIONAL `this.syncState = "synced";`
    // after each branch's own successful re-anchoring (see the dedicated
    // occurrence-count test below), which is not a gate on anything.
    expect(body).not.toMatch(/(if|&&|\|\|)\s*\([^)]*this\.syncState/);
    expect(body).not.toMatch(/(if|&&|\|\|)\s*this\.syncState/);
  });

  it("applyEdit hardening §1: each of the three branches (paragraph/composite/node) wraps its own note mutation + re-anchoring in isApplyingOwnEdit try/finally, then schedules exactly one debounced re-check after releasing suppression", () => {
    const body = bodyOf(viewTs, "private applyEdit(): boolean {", "applyEdit");
    const setCount = body.split("this.isApplyingOwnEdit = true;").length - 1;
    const resetCount = body.split("this.isApplyingOwnEdit = false;").length - 1;
    const financeBlockCount = body.split("} finally {").length - 1;
    const rescheduleCount = body.split("this.scheduleStaleCheck();").length - 1;
    const syncedResetCount = body.split('this.syncState = "synced";').length - 1;
    // One occurrence of each, per branch — paragraph, composite, node.
    expect(setCount).toBe(3);
    expect(resetCount).toBe(3);
    expect(financeBlockCount).toBe(3);
    expect(rescheduleCount).toBe(3);
    expect(syncedResetCount).toBe(3);
    // isApplyingOwnEdit = false must live inside a finally block, never a
    // plain sequential statement that an early throw could skip — checked
    // structurally (whitespace-tolerant) so it matches all three branches
    // regardless of their own nesting depth (the node/section branch sits
    // one indentation level shallower than the paragraph/composite
    // branches, which are each inside their own `if` guard).
    const financeMatches = body.match(/\}\s*finally\s*\{\s*this\.isApplyingOwnEdit = false;\s*\}/g);
    expect(financeMatches?.length).toBe(3);
  });

  // ---- Reload UI (R2): DiscardChangesModal extension ---------------------

  it("DiscardChangesModal gains a showApply option defaulting to true, so its three pre-existing call sites are byte-for-byte unchanged", () => {
    expect(viewTs).toContain("interface DiscardChangesModalOptions {");
    expect(viewTs).toContain("showApply?: boolean;");
    expect(viewTs).toContain("const showApply = this.options.showApply ?? true;");
    expect(viewTs).toContain("if (showApply) {");

    // The three original call sites (requestLoadNode/
    // requestLoadParagraphAtCursor/requestLoadComposite) must still call
    // the constructor with exactly 3 arguments (no options object). The
    // literal `new DiscardChangesModal(` string appears 9 times total: the
    // 3 original constructor calls, the 1 new Reload constructor call,
    // the 2 new Phase 5L-8 child-inline-edit call sites (switching to a
    // different eligible child while the current one has an unsaved
    // structural edit, and stopping child-inline-editing altogether while
    // dirty — both reuse this exact same modal, never a reimplementation),
    // 1 more inside this class's own doc comment (documenting that exact
    // unchanged call shape in prose), 1 Phase 5L-9 handleStopNewChildDraft
    // call site (stopping a pending new-child draft while its own body is
    // dirty — reuses this exact same modal too, never a reimplementation),
    // and 1 new Phase 5L-9b handleStopLeafFirstChildDraft call site
    // (stopping a pending Mode B "promote this leaf to a parent" draft
    // while its own body is dirty — the exact same modal yet again). Like
    // the 3 original call sites, every new call site calls the
    // constructor with exactly 3 arguments (no options object, so
    // showApply stays at its default of true) — only the actual Reload
    // call site passes a 4th argument, verified separately below.
    const callSites = viewTs.split("new DiscardChangesModal(").length - 1;
    expect(callSites).toBe(9);
    // The exact call-site check (only performReload's own body actually
    // passes `showApply: false,` as a real constructor argument, not just
    // in prose) is covered by the dedicated "the new dirty+stale/
    // unavailable Reload confirmation passes showApply: false..." test
    // below, which bounds itself to performReload's own method body.
  });

  it("the new dirty+stale/unavailable Reload confirmation passes showApply: false and Reload-specific title/body keys — never offering Apply", () => {
    const body = bodyOf(viewTs, "private async performReload(): Promise<void> {", "performReload");
    expect(body).toContain("showApply: false");
    expect(body).toContain('titleKey: "partialEdit.reloadConfirmTitle"');
    expect(body).toContain('bodyKey: "partialEdit.reloadConfirmBody"');
  });

  // ---- Reload confirmation main-button wording (2026-09-08 UX fix,
  // real-device B-1 feedback) ------------------------------------------

  it("DiscardChangesModalOptions gains an optional discardButtonKey, defaulting to partialEdit.unsavedChangesDiscardButtonLabel (2026-09-16 button-row consolidation) so callers that don't override it show a 'Cancel'-labeled discard button", () => {
    expect(viewTs).toContain("interface DiscardChangesModalOptions {");
    expect(viewTs).toContain("discardButtonKey?: TranslationKey;");
    expect(viewTs).toContain(
      'text: this.plugin.t(this.options.discardButtonKey ?? "partialEdit.unsavedChangesDiscardButtonLabel"),'
    );
  });

  it("performReload's Reload confirmation passes discardButtonKey: partialEdit.reloadConfirmDiscardButton, distinct from the shared common.discard label", () => {
    const body = bodyOf(viewTs, "private async performReload(): Promise<void> {", "performReload");
    expect(body).toContain('discardButtonKey: "partialEdit.reloadConfirmDiscardButton"');
  });

  it("the Reload confirmation's main button label is never the bare 'Discard'/'破棄' wording alone — it explicitly names both actions (discard, then reload)", () => {
    const en = createTranslator("en");
    const ja = createTranslator("ja");
    const enLabel = en("partialEdit.reloadConfirmDiscardButton");
    const jaLabel = ja("partialEdit.reloadConfirmDiscardButton");
    expect(enLabel).not.toBe(en("common.discard"));
    expect(jaLabel).not.toBe(ja("common.discard"));
    expect(enLabel.toLowerCase()).toContain("reload");
    expect(jaLabel).toContain("再読み込み");
    // Never suggests the pane's own edits can still reach the note from
    // this dialog.
    for (const forbidden of ["apply", "reapply", "save", "overwrite"]) {
      expect(enLabel.toLowerCase()).not.toContain(forbidden);
    }
    for (const forbidden of ["適用", "再適用", "保存", "上書き"]) {
      expect(jaLabel).not.toContain(forbidden);
    }
  });

  it("the Reload confirmation's title/body never suggest the pane's edits can still be applied from this dialog", () => {
    const en = createTranslator("en");
    const ja = createTranslator("ja");
    const enTitle = en("partialEdit.reloadConfirmTitle");
    const enBody = en("partialEdit.reloadConfirmBody");
    const jaTitle = ja("partialEdit.reloadConfirmTitle");
    const jaBody = ja("partialEdit.reloadConfirmBody");
    for (const forbidden of ["reapply", "save", "overwrite"]) {
      expect(enTitle.toLowerCase()).not.toContain(forbidden);
      expect(enBody.toLowerCase()).not.toContain(forbidden);
    }
    // "apply" itself legitimately appears in the body in the negative
    // ("can no longer be applied") — checked as a whole phrase instead of
    // banning the bare word outright.
    expect(enBody.toLowerCase()).toContain("can no longer be applied");
    for (const forbidden of ["再適用", "保存", "上書き"]) {
      expect(jaTitle).not.toContain(forbidden);
      expect(jaBody).not.toContain(forbidden);
    }
    // Body must state, in ja, that unapplied changes are discarded on
    // reload (per this ticket's own explicit requirement, including for
    // any future short-form main-button wording).
    expect(jaBody).toContain("破棄");
    expect(enBody.toLowerCase()).toContain("discard");
  });

  it('performReload: clean Pane reloads with no confirmation; dirty Pane only proceeds on "discard", never "apply"/"cancel"', () => {
    const body = bodyOf(viewTs, "private async performReload(): Promise<void> {", "performReload");
    expect(body).toContain("if (this.isDirty()) {");
    expect(body).toContain('if (choice === "discard") {');
    expect(body).toContain("void this.executeReload();");
    expect(body).toContain("await this.executeReload();");
  });

  it("existing node-switch-guard DiscardChangesModal call sites (requestLoadNode/requestLoadParagraphAtCursor/requestLoadComposite) are untouched by this ticket", () => {
    const cases: Array<[string, string]> = [
      ["requestLoadNode(nodeId: string): void {", "this.loadNodeInternal(nodeId)"],
      [
        "requestLoadParagraphAtCursor(cursorLine: number): void {",
        "this.loadParagraphInternal(cursorLine)",
      ],
      [
        "requestLoadComposite(snapshot: CompositeBlockSnapshot): void {",
        "this.loadCompositeInternal(snapshot)",
      ],
    ];
    for (const [method, loadCall] of cases) {
      const body = bodyOf(viewTs, `  ${method}`, method);
      expect(body).toContain("new DiscardChangesModal(this.app, this.plugin, (choice) => {");
      expect(body).toContain(loadCall);
      expect(body).toContain("if (this.applyEdit())");
    }
  });

  // ---- Button-row consolidation (2026-09-16 ticket): DiscardChangesModal
  // goes from three visible buttons (Apply/Discard/Cancel) to two
  // (Apply/Cancel) — a presentation-only change. The internal
  // DiscardChangesChoice type, onClose()'s x/Escape/outside-click
  // fallback to "cancel", and every call site's own choice-handling logic
  // must all stay exactly as they were. --------------------------------

  function discardChangesModalClassBody(): string {
    const start = viewTs.indexOf("class DiscardChangesModal extends Modal {");
    if (start === -1) {
      throw new Error("DiscardChangesModal class not found — has it been renamed or removed?");
    }
    const end = viewTs.indexOf("class ChildDeleteConfirmModal extends Modal", start);
    if (end === -1 || end <= start) {
      throw new Error(
        "Could not bound DiscardChangesModal's class body — ChildDeleteConfirmModal may have moved."
      );
    }
    return viewTs.slice(start, end);
  }

  it("(1) DiscardChangesModal's button row creates exactly two buttons (Apply, Discard) and no longer creates an explicit third Cancel button", () => {
    const classBody = discardChangesModalClassBody();
    const onOpenBody = bodyOf(classBody, "onOpen(): void {", "DiscardChangesModal.onOpen");
    const buttonCreations = (onOpenBody.match(/buttonsEl\.createEl\("button"/g) ?? []).length;
    expect(buttonCreations).toBe(2); // applyEl (when showApply) + discardEl only
    expect(onOpenBody).not.toContain("cancelEl");
    expect(onOpenBody).not.toContain('this.plugin.t("common.cancel")');
  });

  it("(2) the remaining discard button (displayed as 'Cancel' by default) still resolves the internal choice 'discard', never 'cancel' — the internal DiscardChangesChoice mapping is unchanged", () => {
    const classBody = discardChangesModalClassBody();
    const onOpenBody = bodyOf(classBody, "onOpen(): void {", "DiscardChangesModal.onOpen");
    expect(onOpenBody).toContain(
      'text: this.plugin.t(this.options.discardButtonKey ?? "partialEdit.unsavedChangesDiscardButtonLabel"),'
    );
    expect(onOpenBody).toContain('discardEl.addEventListener("click", () => this.choose("discard"));');
  });

  it("(3)+(4) x/Escape/outside-click still resolve to the internal choice 'cancel' via onClose()'s unchanged fallback, and onClose() does nothing besides emptying the DOM and firing that fallback — no draft-clearing call was added, so drafts are preserved and the pane stays in place", () => {
    const classBody = discardChangesModalClassBody();
    const onCloseBody = bodyOf(classBody, "onClose(): void {", "DiscardChangesModal.onClose");
    expect(onCloseBody.replace(/\s+/g, " ").trim()).toBe(
      'onClose(): void { this.contentEl.empty(); if (!this.resolved) { this.onChoice("cancel"); }'
    );
  });

  it("(5) every existing DiscardChangesModal call site (node-switch guard x3, Reload confirmation, Phase 5L-8 child-inline-edit x2, Phase 5L-9 new-child-draft, Phase 5L-9b leaf-first-child-draft) is untouched — call-site count stays 9, none pass a 'cancel'-labeled button option", () => {
    const callSites = viewTs.split("new DiscardChangesModal(").length - 1;
    expect(callSites).toBe(9);
    expect(viewTs).not.toContain("cancelButtonKey");
  });

  it("(6) the internal DiscardChangesChoice type and the choose()/resolved-flag mechanics are byte-for-byte unchanged", () => {
    expect(viewTs).toContain('type DiscardChangesChoice = "apply" | "discard" | "cancel";');
    const classBody = discardChangesModalClassBody();
    const chooseBody = bodyOf(classBody, "private choose(choice: DiscardChangesChoice): void {", "DiscardChangesModal.choose");
    expect(chooseBody.replace(/\s+/g, " ").trim()).toBe(
      "private choose(choice: DiscardChangesChoice): void { this.resolved = true; this.close(); this.onChoice(choice);"
    );
  });

  it("partialEdit.unsavedChangesDiscardButtonLabel is defined exactly once in each of en/ja, reads 'Cancel'/'キャンセル' to match the pane's own top-level Cancel button, and common.discard/common.cancel keep their original, untouched values", () => {
    const occurrences = i18nTs.split('"partialEdit.unsavedChangesDiscardButtonLabel":').length - 1;
    expect(occurrences).toBe(2); // one in en, one in ja
    const en = createTranslator("en");
    const ja = createTranslator("ja");
    expect(en("partialEdit.unsavedChangesDiscardButtonLabel")).toBe("Cancel");
    expect(ja("partialEdit.unsavedChangesDiscardButtonLabel")).toBe("キャンセル");
    expect(en("common.discard")).toBe("Discard");
    expect(ja("common.discard")).toBe("破棄");
    expect(en("common.cancel")).toBe("Cancel");
    expect(ja("common.cancel")).toBe("キャンセル");
  });

  it("partialEdit.unsavedChangesBody describes the two visible choices (Apply / Cancel-to-discard) and a brief note that closing the dialog keeps editing here", () => {
    const en = createTranslator("en");
    const ja = createTranslator("ja");
    const enBody = en("partialEdit.unsavedChangesBody");
    const jaBody = ja("partialEdit.unsavedChangesBody");
    expect(enBody.toLowerCase()).toContain("apply");
    expect(enBody.toLowerCase()).toContain("cancel");
    expect(enBody.toLowerCase()).toContain("close this dialog");
    expect(jaBody).toContain("適用");
    expect(jaBody).toContain("キャンセル");
    expect(jaBody).toContain("閉じ");
  });

  // ---- Fresh load resets syncState ----------------------------------------

  it("every fresh load (node/paragraph/composite), the empty state, a re-sync back to matching content, a successful auto-reload, and a successful self-Apply's own re-anchoring all set syncState to synced", () => {
    const occurrences = viewTs.split('this.syncState = "synced";').length - 1;
    // loadNodeInternal, loadParagraphInternal, loadCompositeInternal,
    // renderEmptyState, evaluateAgainstText's own "already-synced" branch,
    // and performAutoReload — six call sites, unchanged from the original
    // Phase 5A-1 round — PLUS three more added by this hardening round's
    // §1: applyEdit's own paragraph/composite/node branches, each setting
    // this unconditionally right after its own successful re-anchoring
    // (see the dedicated applyEdit-scoped hardening §1 test above for why
    // this is a reset, never a gate) — PLUS one more added by Phase 5L-8's
    // applyParentChildCombinedEdit, right after its own §7 step 12 fresh
    // re-parse/re-anchor, mirroring every other successful-Apply branch —
    // PLUS one more added by Phase 5L-9's own
    // applyParentChildAddDeleteCombinedEdit, right after ITS OWN
    // equivalent §7 step 13 fresh re-parse/re-anchor, mirroring the exact
    // same successful-Apply convention — PLUS one more added by Phase
    // 5L-11's own applyParentChildIndentOutdentEdit, right after ITS OWN
    // equivalent §7 step 13 fresh re-parse/re-anchor, mirroring the
    // identical successful-Apply convention yet again.
    expect(occurrences).toBe(12);
  });

  // ---- Safe no-op after onClose --------------------------------------------

  it("onClose sets a closed flag, and every method that can run asynchronously after close checks it first", () => {
    const onCloseBody = bodyOf(viewTs, "async onClose(): Promise<void> {", "onClose");
    expect(onCloseBody).toContain("this.closed = true;");

    const cases: Array<[string, string]> = [
      ["private performStaleCheck(): void {", "performStaleCheck"],
      [
        "private evaluateAgainstText(text: string, path: string, fromLiveEditor: boolean): void {",
        "evaluateAgainstText",
      ],
      ["private transitionToStale(): void {", "transitionToStale"],
      ["private transitionToUnavailable(): void {", "transitionToUnavailable"],
      ["private async executeReload(): Promise<void> {", "executeReload"],
    ];
    for (const [needle, label] of cases) {
      const body = bodyOf(viewTs, needle, label);
      expect(body).toContain("this.closed");
    }
  });

  // ---- i18n key completeness ------------------------------------------------

  it("both en and ja dictionaries define every new partialEdit.* key this ticket introduces", () => {
    const newKeys = [
      "partialEdit.reload",
      "partialEdit.staleLabel",
      "partialEdit.staleApplyDisabledReason",
      "partialEdit.unavailableLabel",
      "partialEdit.unavailableApplyDisabledReason",
      "partialEdit.reloadedNotice",
      "partialEdit.reloadFailedNotice",
      "partialEdit.reloadConfirmTitle",
      "partialEdit.reloadConfirmBody",
      // 2026-09-08 UX fix (real-device B-1 feedback): the Reload
      // confirmation's own main-button label, distinct from the shared
      // common.discard used by the three node-switch call sites.
      "partialEdit.reloadConfirmDiscardButton",
    ];
    for (const key of newKeys) {
      const occurrences = i18nTs.split(`"${key}":`).length - 1;
      // Exactly one definition in `en` and one in `ja`.
      expect(occurrences).toBe(2);
    }
  });

  // ---- CSS naming convention ------------------------------------------------

  it("styles.css follows the existing unified-outliner-partial-edit-* naming convention for the new sync-status row", () => {
    const cssPath = path.resolve(__dirname, "../styles.css");
    const css = readFileSync(cssPath, "utf-8");
    expect(css).toContain(".unified-outliner-partial-edit-sync-status {");
    expect(css).toContain(".unified-outliner-partial-edit-sync-status-stale {");
    expect(css).toContain(".unified-outliner-partial-edit-sync-status-unavailable {");
    expect(css).toContain(".unified-outliner-partial-edit-sync-status-reload {");
  });

  // ---- No out-of-scope changes ---------------------------------------------

  it("preserves every pre-existing exported function signature in edit/partialEdit.ts, edit/paragraphPartialEdit.ts, and edit/compositeBlockPartialEdit.ts — and confirms hardening §2's new resolveParagraphAnchorText is exported alongside them, never replacing them", () => {
    const modules: Array<[string, string[]]> = [
      [
        "../src/edit/partialEdit.ts",
        ["extractSubtreeText", "applySubtreeEdit", "extractSectionText", "applySectionEdit"],
      ],
      [
        "../src/edit/paragraphPartialEdit.ts",
        [
          "buildParagraphEditAnchor",
          "applyParagraphEdit",
          "paragraphEditTextContainsBlankLine",
          // Phase 5A-1 hardening §2: the new read-only resolver — this
          // module is no longer untouched by this ticket (unlike the
          // original Phase 5A-1 round's own claim, updated in this file's
          // top doc comment), but every pre-existing export above is
          // unchanged — see tests/paragraphPartialEditResolveReadOnly.test.ts
          // for the non-regression coverage confirming applyParagraphEdit's
          // own reasons are provably unchanged.
          "resolveParagraphAnchorText",
        ],
      ],
      [
        "../src/edit/compositeBlockPartialEdit.ts",
        ["extractCompositeBlockText", "applyCompositeBlockEdit", "compositePartialEditReasonText"],
      ],
    ];
    for (const [file, exportedFns] of modules) {
      const source = readFileSync(path.resolve(__dirname, file), "utf-8");
      for (const fn of exportedFns) {
        expect(source).toContain(`export function ${fn}(`);
      }
    }
  });

  it("edit/paragraphPartialEdit.ts has zero 'obsidian' imports, even after hardening §2's addition — resolveParagraphAnchorText is provably read-only", () => {
    // Checks the actual structural guarantee (no import statement pulling
    // in the "obsidian" package) rather than a bare-word scan for
    // "Editor"/"Vault"/"Notice" — this module's own doc comments
    // legitimately use those words in prose to explain what it does NOT
    // depend on (see resolveParagraphAnchorText's own doc comment above),
    // so a bare-word check would trip on its own documentation, exactly
    // the false-positive class tests/paragraphPartialEdit.test.ts and this
    // file's own "resolveCurrentTarget reuses..." test above already learned
    // to avoid by checking call/import FORM, not identifier presence.
    const source = readFileSync(
      path.resolve(__dirname, "../src/edit/paragraphPartialEdit.ts"),
      "utf-8"
    );
    expect(source).not.toMatch(/from\s+["']obsidian["']/);
  });

  it("never references activeMarkdownView inside any of the new Phase 5A-1 event handlers", () => {
    for (const [needle, label] of [
      [
        "private handleEditorChange(_editor: Editor, info: MarkdownView | MarkdownFileInfo): void {",
        "handleEditorChange",
      ],
      ["private handleVaultModify(file: TAbstractFile): void {", "handleVaultModify"],
      [
        "private handleVaultRename(file: TAbstractFile, oldPath: string): void {",
        "handleVaultRename",
      ],
      ["private handleVaultDelete(file: TAbstractFile): void {", "handleVaultDelete"],
      ["private findOpenEditorForSourcePath(): Editor | null {", "findOpenEditorForSourcePath"],
    ] as const) {
      const body = bodyOf(viewTs, needle, label);
      expect(body).not.toContain("activeMarkdownView");
    }
  });
});
