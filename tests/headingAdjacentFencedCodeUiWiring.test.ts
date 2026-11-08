/**
 * fix/heading-adjacent-fenced-code: source-level wiring checks for the
 * body-editor "Open partial edit pane" command and the corrected setting
 * descriptions (see tests/headingAdjacentFencedCode.test.ts for behavior).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createTranslator } from "../src/i18n";
import { DEFAULT_SETTINGS } from "../src/settingsDefaults";

const mainTs = readFileSync(path.resolve(__dirname, "../src/main.ts"), "utf-8");

function methodBody(src: string, signature: string): string {
  const start = src.indexOf(signature);
  if (start < 0) throw new Error(`missing ${signature}`);
  const next = src.indexOf("\n  private ", start + signature.length);
  return src.slice(start, next < 0 ? undefined : next);
}

describe("openPartialEditForCursor wiring", () => {
  const body = methodBody(mainTs, "private openPartialEditForCursor(editor: Editor): void {");

  it("resolves through resolvePartialEditTargetAtCursor, not the move-oriented resolveCurrentBlock refusal", () => {
    expect(body).toContain("resolvePartialEditTargetAtCursor(doc, editor.getCursor().line)");
    expect(body).not.toContain("resolveCurrentBlock(");
    expect(body).toContain("this.activatePartialEditView(resolved.target.nodeId)");
  });

  it("an unresolved fence uses the dedicated Partial Edit notice (never the 'cannot move' text)", () => {
    expect(body).toContain('"reason.partial-edit-code-block-unresolved"');
  });

  it("the command id is unchanged (hotkeys keep working)", () => {
    expect(mainTs).toContain('id: "open-partial-edit-pane"');
  });
});

describe("i18n and settings", () => {
  for (const locale of ["en", "ja"] as const) {
    const t = createTranslator(locale);
    it(`${locale}: the code-block notice exists and mentions neither moving nor sections`, () => {
      const text = t("reason.partial-edit-code-block-unresolved");
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toMatch(/move|移動/i);
    });
    it(`${locale}: fenced-code/table setting descriptions no longer claim the rows cannot be edited`, () => {
      for (const key of ["settings.showFencedCodeInOutline.desc", "settings.showTablesInOutline.desc"] as const) {
        const text = t(key);
        expect(text).not.toMatch(/nothing can be renamed, edited|一切できない|read-only navigation|読み取り専用のナビゲーション/);
      }
    });
  }

  it("showFencedCodeInOutline stays off by default (no silent default change)", () => {
    expect(DEFAULT_SETTINGS.showFencedCodeInOutline).toBe(false);
  });
});
