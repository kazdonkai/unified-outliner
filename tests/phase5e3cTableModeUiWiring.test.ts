/**
 * Phase 5E-3c ("軽量 Table Mode"): source-wiring checks for
 * view/PartialEditView.ts's Table Mode UI — the same "no real Obsidian
 * runtime, assert on the raw source" pattern as
 * tests/phase5e3aStructuredBlockInsertUiWiring.test.ts's own "source
 * wiring" describe block. Cell/row/column operation CORRECTNESS is
 * already covered by tests/phase5e3cTableModeOperations.test.ts (pure
 * functions) and tests/phase5e3bTableParserSerializer.test.ts
 * (parse/serialize round-trip) — this file only checks that
 * PartialEditView.ts actually wires those pure modules in per the
 * ticket's own explicit requirements.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { createTranslator, TranslationKey } from "../src/i18n";

const pane = readFileSync(join(__dirname, "../src/view/PartialEditView.ts"), "utf8");

describe("Table Mode tab only for a table block, never fenced-code", () => {
  it("renderTableModeRow gates the whole tab row on nodeKind === \"table\"", () => {
    const start = pane.indexOf("private renderTableModeRow(): void {");
    expect(start).toBeGreaterThan(0);
    const body = pane.slice(start, pane.indexOf("\n  }\n", start));
    expect(body).toContain('const isTable = this.nodeKind === "table";');
    expect(body).toContain("this.tableModeTabRowEl.toggleVisibility(isTable);");
    // Never gated on "fenced-code" — the ticket's own explicit non-goal.
    expect(body).not.toContain('"fenced-code"');
  });

  it("loadNodeInternal only ever populates tableModeTable for extracted.kind === \"table\"", () => {
    const idx = pane.indexOf('if (extracted.kind === "table") {\n      const parsed = parseMarkdownTable(');
    expect(idx).toBeGreaterThan(0);
  });
});

describe("parse failure disables the Table tab and shows the reason", () => {
  it("renderTableModeRow disables tableModeTableTabButtonEl exactly when tableModeTable is null", () => {
    const start = pane.indexOf("private renderTableModeRow(): void {");
    const body = pane.slice(start, pane.indexOf("\n  }\n", start));
    expect(body).toContain("this.tableModeTableTabButtonEl.disabled = this.tableModeTable === null;");
    expect(body).toContain("if (this.tableModeParseFailureReason) {");
    expect(body).toContain("this.tableModeParseFailureEl.setText(this.tableModeParseFailureReasonText(");
  });

  it("Raw->Table tab switch refuses on a failed parse and records the reason", () => {
    const start = pane.indexOf("private handleTableModeSwitchToTableTab(): void {");
    expect(start).toBeGreaterThan(0);
    const body = pane.slice(start, pane.indexOf("\n  }\n", start));
    expect(body).toContain("const parsed = parseMarkdownTable(this.textareaEl.value);");
    expect(body).toContain("if (!parsed.ok) {");
    expect(body).toContain("this.tableModeParseFailureReason = parsed.reason;");
    expect(body).toContain('this.tableModeActiveTab = "raw";');
  });

  it("every MarkdownTableParseFailureReason has i18n text via the parse-failure template key", () => {
    const reasons = [
      "no-header-row",
      "no-delimiter-row",
      "invalid-delimiter-row",
      "column-count-mismatch",
      "ambiguous-inline-code",
    ] as const;
    for (const locale of ["en", "ja"] as const) {
      const t = createTranslator(locale);
      const template = t("partialEdit.tableMode.parseFailure" as TranslationKey);
      expect(template).not.toBe("partialEdit.tableMode.parseFailure");
      for (const reason of reasons) {
        const text = t("partialEdit.tableMode.parseFailure" as TranslationKey, { reason });
        expect(text).toContain(reason);
      }
    }
  });
});

describe("Apply branches on the active tab to call serializeMarkdownTable — no new write path", () => {
  it("newRawText is overridden by serializeMarkdownTable only when nodeKind is table AND the Table tab is active", () => {
    const idx = pane.indexOf("let newRawText = this.textareaEl.value;");
    expect(idx).toBeGreaterThan(0);
    const nearby = pane.slice(idx, idx + 1500);
    expect(nearby).toContain(
      'if (this.nodeKind === "table" && this.tableModeActiveTab === "table" && this.tableModeTable) {'
    );
    expect(nearby).toContain("newRawText = serializeMarkdownTable(this.tableModeTable).join(\"\\n\");");
  });

  it("the table Apply path still flows through the shared applySubtreeEdit call, never a new write", () => {
    const applyIdx = pane.indexOf("const outcome = this.standaloneParentListItemProjection");
    expect(applyIdx).toBeGreaterThan(0);
    const body = pane.slice(applyIdx, applyIdx + 600);
    expect(body).toContain("applySubtreeEdit(");
    expect(body).not.toMatch(/vault\.(modify|process)|replaceRange\(/);
  });

  it("post-Apply rebuild re-parses newRawText for the table kind, mirroring the fenced-code rebuild", () => {
    const idx = pane.indexOf('} else if (this.nodeKind === "table") {');
    expect(idx).toBeGreaterThan(0);
    const body = pane.slice(idx, idx + 1800);
    expect(body).toContain("const parsed = parseMarkdownTable(newRawText);");
    expect(body).toContain("this.renderTableModeRow();");
  });
});

describe("delete-row/delete-column reject at the boundary", () => {
  it("handleTableModeDeleteRow shows a Notice and leaves tableModeTable untouched on rejection", () => {
    const start = pane.indexOf("private handleTableModeDeleteRow(rowIndex: number): void {");
    expect(start).toBeGreaterThan(0);
    const body = pane.slice(start, pane.indexOf("\n  }\n", start));
    expect(body).toContain("if (!result.ok) {");
    expect(body).toContain('new Notice(this.plugin.t("partialEdit.tableMode.lastRowUndeletable"));');
    expect(body).toContain("return;");
  });

  it("handleTableModeDeleteColumn shows a Notice and leaves tableModeTable untouched on rejection", () => {
    const start = pane.indexOf("private handleTableModeDeleteColumn(columnIndex: number): void {");
    expect(start).toBeGreaterThan(0);
    const body = pane.slice(start, pane.indexOf("\n  }\n", start));
    expect(body).toContain("if (!result.ok) {");
    expect(body).toContain('new Notice(this.plugin.t("partialEdit.tableMode.lastColumnUndeletable"));');
    expect(body).toContain("return;");
  });

  it("both rejection Notices have en/ja text", () => {
    for (const locale of ["en", "ja"] as const) {
      const t = createTranslator(locale);
      expect(t("partialEdit.tableMode.lastRowUndeletable" as TranslationKey).length).toBeGreaterThan(0);
      expect(t("partialEdit.tableMode.lastColumnUndeletable" as TranslationKey).length).toBeGreaterThan(0);
    }
  });
});

describe("field reset parity: tableModeTable/tableModeActiveTab/tableModeParseFailureReason reset alongside fencedCodeMeta everywhere", () => {
  it("every fencedCodeSelectedInfoString reset site also resets the three Table Mode fields", () => {
    const resetSites = [...pane.matchAll(/this\.fencedCodeSelectedInfoString = null;/g)];
    expect(resetSites.length).toBeGreaterThanOrEqual(3);
    for (const match of resetSites) {
      const idx = match.index!;
      const nearby = pane.slice(idx, idx + 700);
      expect(nearby).toContain("this.tableModeTable = null;");
      expect(nearby).toContain('this.tableModeActiveTab = "raw";');
      expect(nearby).toContain("this.tableModeParseFailureReason = null;");
    }
  });
});

describe("i18n coverage for every new Table Mode UI string", () => {
  const keys: TranslationKey[] = [
    "partialEdit.tableMode.rawTab",
    "partialEdit.tableMode.tableTab",
    "partialEdit.tableMode.parseFailure",
    "partialEdit.tableMode.addRow",
    "partialEdit.tableMode.deleteRow",
    "partialEdit.tableMode.moveRowUp",
    "partialEdit.tableMode.moveRowDown",
    "partialEdit.tableMode.addColumn",
    "partialEdit.tableMode.deleteColumn",
    "partialEdit.tableMode.alignLeft",
    "partialEdit.tableMode.alignCenter",
    "partialEdit.tableMode.alignRight",
    "partialEdit.tableMode.alignNone",
    "partialEdit.tableMode.lastRowUndeletable",
    "partialEdit.tableMode.lastColumnUndeletable",
  ];
  it.each(["en", "ja"] as const)("%s has non-empty text for every Table Mode key", (locale) => {
    const t = createTranslator(locale);
    for (const key of keys) {
      expect(t(key)).not.toBe(key);
      expect(t(key).length).toBeGreaterThan(0);
    }
  });
});

describe("isDirty considers the Table tab's own model", () => {
  // 2026-09-25 fix: the comparison target changed from originalText
  // verbatim to originalText's own CANONICAL serialization, so merely
  // switching to the Table tab no longer reads as an edit.
  it("tableModeDirty compares serializeMarkdownTable(tableModeTable) against the canonical serialization of originalText", () => {
    const idx = pane.indexOf("const tableModeDirty =");
    expect(idx).toBeGreaterThan(0);
    const body = pane.slice(idx, idx + 400);
    expect(body).toContain('this.nodeKind === "table"');
    expect(body).toContain('this.tableModeActiveTab === "table"');
    expect(body).toContain("serializeMarkdownTable(this.tableModeTable).join(\"\\n\") !== this.tableModeBaselineSerialized()");
    expect(pane).toMatch(/leafFirstChildDirty \|\|\s*fencedCodeInfoStringDirty \|\|\s*tableModeDirty\)/);
  });
});
