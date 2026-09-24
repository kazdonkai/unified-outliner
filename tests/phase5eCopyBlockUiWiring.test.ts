import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createTranslator } from "../src/i18n";
import { BLOCK_COPY_REJECT_REASONS, blockCopyLabel, isBlockCopySourceLost } from "../src/edit/copyBlock";

/**
 * Phase 5E-Copy: static-source-text checks for the Outline Tree / Command
 * Palette wiring of block copy (an Obsidian ItemView / Plugin cannot be
 * constructed in vitest — "obsidian" is a types-only package here — so,
 * like tests/standaloneComplexBlockDropUiWiring.test.ts, this inspects the
 * raw source). The copy/paste decision and write logic itself is unit-
 * tested with real assertions in tests/phase5eCopyBlock.test.ts.
 */
const viewTs = readFileSync(path.resolve(__dirname, "../src/view/OutlineTreeView.ts"), "utf-8");
const mainTs = readFileSync(path.resolve(__dirname, "../src/main.ts"), "utf-8");
const stylesCss = readFileSync(path.resolve(__dirname, "../styles.css"), "utf-8");

function methodBody(src: string, signature: string): string {
  const start = src.indexOf(signature);
  expect(start, signature).toBeGreaterThan(-1);
  const end = src.indexOf("\n  }\n", start);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

describe("Phase 5E-Copy: Outline Tree context menu wiring", () => {
  it("every row menu (section, list, composite, standalone complex, composite member, paragraph) gets the copy/paste items", () => {
    for (const sig of [
      "private showStructureCommandMenu(",
      "private showListCommandMenu(",
      "private showCompositeCommandMenu(",
      "private showStandaloneComplexBlockMenu(",
      "private showComplexMemberMenu(",
      "private showParagraphMoveMenu(",
    ]) {
      const body = methodBody(viewTs, sig);
      expect(body, sig).toMatch(/this\.addBlockCopyMenuItems\(menu, \w+\);\n\s+this\.showTrackedMenu\(menu, evt\);/);
    }
  });

  it("menu items use the dedicated i18n keys, and unavailable items explain themselves via a Notice", () => {
    const body = methodBody(viewTs, "private addBlockCopyMenuItems(");
    for (const key of [
      "tree.menu.copyBlock",
      "tree.menu.duplicateBelow",
      "tree.menu.pasteBlock",
      "tree.menu.pasteBlockAbove",
      "tree.menu.pasteBlockAsChild",
      "tree.menu.cancelBlockCopy",
    ]) {
      expect(body).toContain(`"${key}"`);
    }
    expect(body).toContain("this.plugin.blockCopyReasonNotice(reason)");
    expect(body).toContain("tree.menu.unavailableSuffix");
  });

  it("click-time handlers re-read the editor's CURRENT text and write only through plugin.applyBlockCopyOutcome", () => {
    for (const sig of ["private runDuplicateBlockCommand(", "private runPasteBlockCommand("]) {
      const body = methodBody(viewTs, sig);
      expect(body).toContain("editor.getValue()");
      expect(body).toContain("this.plugin.applyBlockCopyOutcome(");
      expect(body).not.toContain("replaceRange");
      expect(body).not.toContain("vault.modify");
      expect(body).toContain("listSelections().length > 1");
    }
  });

  it("the copy-pending state is the plugin's own field — not selection/highlight/drag/rename state", () => {
    const copyBody = methodBody(viewTs, "private runCopyBlockCommand(");
    expect(copyBody).toContain("this.plugin.setPendingBlockCopy(");
    expect(copyBody).not.toMatch(/selectedId|highlightedId|dragSourceId|renameState/);
    const addBody = methodBody(viewTs, "private addBlockCopyMenuItems(");
    expect(addBody).not.toMatch(/this\.selectedId\s*=|this\.highlightedId\s*=|this\.dragSourceId\s*=/);
    expect(mainTs).toContain("pendingBlockCopy: PendingBlockCopy | null = null;");
  });

  it("paste is refused (with a Notice) in a different note than the one copied from", () => {
    expect(methodBody(viewTs, "private runPasteBlockCommand(")).toContain("notice.blockCopyOtherNote");
    expect(methodBody(mainTs, "private pasteBlockAtCursor(")).toContain("notice.blockCopyOtherNote");
  });

  it("renders a banner with a cancel button, and marks the source row, both driven by refresh()", () => {
    expect(viewTs).toContain('this.copyBannerEl = this.contentEl.createDiv({ cls: "unified-outliner-copy-banner" });');
    const refreshBody = methodBody(viewTs, "  refresh(): void {");
    expect(refreshBody).toContain("this.renderCopyBanner();");
    expect(refreshBody).toContain("this.pendingCopySourceNodeId = this.resolvePendingCopySourceNodeId(");
    expect(viewTs).toContain('(node.id === this.pendingCopySourceNodeId ? " unified-outliner-copy-source" : "")');
    const banner = methodBody(viewTs, "private renderCopyBanner(");
    expect(banner).toContain("clearPendingBlockCopy({ notify: true })");
    expect(stylesCss).toContain(".unified-outliner-copy-banner:empty");
    expect(stylesCss).toContain(".unified-outliner-copy-source");
  });
});

describe("Phase 5E-Copy: plugin-level wiring (main.ts)", () => {
  it("registers the Command Palette commands with the same names as the menu items", () => {
    const en = createTranslator("en");
    expect(en("command.copyBlock")).toBe(en("tree.menu.copyBlock"));
    expect(en("command.duplicateBlockBelow")).toBe(en("tree.menu.duplicateBelow"));
    expect(en("command.pasteBlock")).toBe(en("tree.menu.pasteBlock"));
    const ja = createTranslator("ja");
    expect(ja("command.copyBlock")).toBe(ja("tree.menu.copyBlock"));
    expect(ja("command.duplicateBlockBelow")).toBe(ja("tree.menu.duplicateBelow"));
    expect(ja("command.pasteBlock")).toBe(ja("tree.menu.pasteBlock"));
  });

  it("Escape cancels a pending copy — capture phase, never while a menu/modal is open, never during IME composition or in a text field", () => {
    const start = mainTs.indexOf('if (evt.key !== "Escape" || !this.pendingBlockCopy) return;');
    expect(start).toBeGreaterThan(-1);
    const block = mainTs.slice(start, mainTs.indexOf("{ capture: true }", start));
    expect(block).toContain("evt.isComposing");
    expect(block).toContain(".menu, .modal-container, .suggestion-container");
    expect(block).toContain("HTMLInputElement");
    expect(block).toContain("this.clearPendingBlockCopy({ notify: true })");
    expect(block).not.toContain("preventDefault");
  });

  it("applyBlockCopyOutcome writes only through applyLineEditOutcome (one replaceRange = one Undo step)", () => {
    const body = methodBody(mainTs, "  applyBlockCopyOutcome(");
    expect(body).toContain("applyLineEditOutcome(editor,");
    expect(body).not.toContain("replaceRange");
    expect(body).not.toContain("vault.modify");
    expect(body).toContain("isBlockCopySourceLost(outcome.reason)");
  });

  it("rejection Notices are always shown (not gated by showNoopNotices)", () => {
    const body = methodBody(mainTs, "  blockCopyReasonNotice(");
    expect(body).toContain("new Notice(");
    expect(body).not.toContain("showNoopNotices");
  });
});

describe("Phase 5E-Copy: i18n and helpers", () => {
  it("every rejection reason has an English and a Japanese message", () => {
    const en = createTranslator("en");
    const ja = createTranslator("ja");
    for (const reason of BLOCK_COPY_REJECT_REASONS) {
      const key = `reason.${reason}` as const;
      expect(en(key)).toMatch(/^Unified Outliner: /);
      expect(ja(key)).toMatch(/^Unified Outliner: /);
      expect(ja(key)).not.toBe(en(key));
    }
  });

  it("blockCopyLabel strips Markdown markers and truncates", () => {
    expect(blockCopyLabel(["", "## Heading text"])).toBe("Heading text");
    expect(blockCopyLabel(["- [ ] task item"])).toBe("task item");
    expect(blockCopyLabel(["> [!note] Title"])).toBe("[!note] Title");
    expect(blockCopyLabel(["x".repeat(60)]).length).toBe(40);
  });

  it("only a lost/ambiguous source drops the pending copy after a failed paste", () => {
    expect(isBlockCopySourceLost("copy-source-changed")).toBe(true);
    expect(isBlockCopySourceLost("copy-source-ambiguous")).toBe(true);
    expect(isBlockCopySourceLost("copy-inside-source")).toBe(false);
    expect(isBlockCopySourceLost(undefined)).toBe(false);
  });
});
