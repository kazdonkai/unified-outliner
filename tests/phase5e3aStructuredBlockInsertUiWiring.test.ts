/**
 * Phase 5E-3a: wiring checks that don't need a live Obsidian — the insert
 * reaches the note through exactly ONE Editor#replaceRange (a single Undo
 * step) via the shared applyLineEditOutcome path, every refusal reason has
 * en/ja text, and the Tree / Partial Edit selectors share one registry.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import type { Editor } from "obsidian";
import { applyLineEditOutcome } from "../src/commands/applyLineEditOutcome";
import { insertStructuredBlockBelowNode, NoStructuredInsertReason } from "../src/edit/insertStructuredBlock";
import { buildFencedCodeBlockLines, buildTableTemplateLines } from "../src/edit/codeBlockPresets";
import { parseDocument } from "../src/parser/parseDocument";
import { createTranslator, TranslationKey } from "../src/i18n";
import { getEnabledCompositeBlockRules, DEFAULT_COMPOSITE_BLOCK_SETTINGS } from "../src/settingsDefaults";

const RULES = getEnabledCompositeBlockRules(DEFAULT_COMPOSITE_BLOCK_SETTINGS);

/** Minimal Editor double: a line array + replaceRange/setCursor, counting edits. */
function fakeEditor(text: string) {
  let lines = text.split("\n");
  const calls = { replaceRange: 0 };
  const editor = {
    replaceRange(rep: string, from: { line: number; ch: number }, to: { line: number; ch: number }) {
      calls.replaceRange++;
      const full = lines.join("\n");
      const off = (p: { line: number; ch: number }) =>
        lines.slice(0, p.line).reduce((a, l) => a + l.length + 1, 0) + p.ch;
      lines = (full.slice(0, off(from)) + rep + full.slice(off(to))).split("\n");
    },
    setCursor() {},
  };
  return { editor: editor as unknown as Editor, calls, value: () => lines.join("\n") };
}

function applyInsert(text: string, line: number, blockLines: string[], kind: "fenced-code" | "table") {
  const doc = parseDocument(text);
  const id = [...doc.nodes.values()].find((n) => n.range.startLine === line)!.id;
  const outcome = insertStructuredBlockBelowNode(text, id, kind, blockLines, RULES);
  const fe = fakeEditor(text);
  const changed = applyLineEditOutcome(fe.editor, { line, ch: 0 }, line, doc.lines, outcome, () => {});
  return { outcome, changed, fe };
}

describe("single write path / single Undo step", () => {
  it.each([
    ["section start, fenced-code", ["# A", "body", "## B"].join("\n"), 0, buildFencedCodeBlockLines("python", ""), "fenced-code"],
    ["last list item, table", ["# A", "- x", "- y", "", "tail"].join("\n"), 2, buildTableTemplateLines(3)!, "table"],
    ["heading at EOF, table", ["x", "", "# Z"].join("\n"), 2, buildTableTemplateLines(1)!, "table"],
  ] as const)("%s: exactly one replaceRange and the editor text equals the outcome", (_l, text, line, block, kind) => {
    const r = applyInsert(text, line, [...block], kind);
    expect(r.changed).toBe(true);
    expect(r.fe.calls.replaceRange).toBe(1);
    expect(r.fe.value()).toBe(r.outcome.lines.join("\n"));
  });

  it("a refused insert performs no write at all", () => {
    const text = ["- a", "- b"].join("\n");
    const r = applyInsert(text, 0, buildTableTemplateLines(2)!, "table");
    expect(r.changed).toBe(false);
    expect(r.fe.calls.replaceRange).toBe(0);
    expect(r.fe.value()).toBe(text);
  });
});

describe("i18n coverage", () => {
  const reasons: NoStructuredInsertReason[] = [
    "resolve-failed",
    "structured-insert-not-a-target",
    "structured-insert-inside-list",
    "structured-insert-unsafe-position",
    "structured-insert-invalid-template",
    "structured-insert-structure-changed",
    "structured-insert-not-recognized",
  ];
  it.each(["en", "ja"] as const)("%s has text for every refusal reason and new UI key", (locale) => {
    const t = createTranslator(locale);
    for (const r of reasons) {
      const key = ("reason." + r) as TranslationKey;
      expect(t(key)).not.toBe(key);
      expect(t(key).length).toBeGreaterThan(0);
    }
    for (const key of [
      "tree.menu.insertCodeBlockBelow",
      "tree.menu.insertTableBelow",
      "modal.insertCodeBlockTitle",
      "modal.insertTableTitle",
      "modal.insertBlockConfirm",
    ] as TranslationKey[]) {
      expect(t(key)).not.toBe(key);
    }
  });
});

describe("source wiring", () => {
  const tree = readFileSync(join(__dirname, "../src/view/OutlineTreeView.ts"), "utf8");
  const pane = readFileSync(join(__dirname, "../src/view/PartialEditView.ts"), "utf8");

  it("section and list menus both offer the two insert items", () => {
    expect(tree.match(/this\.addStructuredInsertMenuItems\(menu, doc, (sectionId|listId)\)/g)).toHaveLength(2);
  });

  it("the insert goes through dispatchAndApply (no new direct write path)", () => {
    const start = tree.indexOf("private runInsertStructuredBlockCommand(");
    const end = tree.indexOf("\n  }\n", start);
    const body = tree.slice(start, end);
    expect(body).toContain("this.dispatchAndApply(");
    expect(body).not.toMatch(/replaceRange|vault\.(modify|process)|setValue\(/);
    expect(body).toMatch(/activatePartialEditView\(\s*newId/);
  });

  it("fix: the Tree hands pre/post insert text to the pane so the first Apply folds into the insert's Undo step", () => {
    expect(tree).toContain("pendingStructuredInsert: { preInsertText, postInsertText }");
    const main = readFileSync(join(__dirname, "../src/main.ts"), "utf8");
    expect(main).toContain("leaf.view.setPendingStructuredInsert({ nodeId, ...options.pendingStructuredInsert })");
    const start = pane.indexOf("const pending = this.pendingStructuredInsert;");
    expect(start).toBeGreaterThan(0);
    const block = pane.slice(start, start + 2000);
    // Only when the note is still exactly the post-insert text, and only if the undo lands on the pre-insert text.
    expect(block).toContain('doc.lines.join("\\n") === pending.postInsertText');
    expect(block.indexOf("editor.undo()")).toBeLessThan(block.indexOf("editor.getValue() === pending.preInsertText"));
    expect(block).toContain("editor.redo()");
    expect(pane).toContain("this.pendingStructuredInsert = null;\n    this.nodeId = null;");
  });

  it("fix: a loaded node never shows the empty-state guidance placeholder, and fenced/table get their own title kind", () => {
    expect(pane).toContain('this.textareaEl.setAttribute("placeholder", "");');
    expect(pane).toContain('return this.plugin.t("partialEdit.kindFencedCode");');
    expect(pane).toContain('return this.plugin.t("partialEdit.kindTable");');
  });

  it("Partial Edit's language selector is derived from the CodeBlockPreset registry", () => {
    expect(pane).toContain("CODE_BLOCK_PRESETS.map((preset) => ({");
  });
});
