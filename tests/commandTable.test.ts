import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * fix/command-i18n-localization (2026-08-13): main.ts's getCommandSpecs()
 * — the id/translationKey/callback table registerAllCommands() (re-)
 * registers every Command Palette entry from — is a PRIVATE method of
 * UnifiedOutlinerPlugin, which extends Obsidian's Plugin/Component
 * classes. "obsidian" is a types-only package in this repo
 * (node_modules/obsidian/package.json has `"main": ""` — no runtime
 * implementation), so UnifiedOutlinerPlugin cannot be constructed in
 * vitest and getCommandSpecs() cannot be imported and called directly
 * (the same constraint already documented in
 * tests/compositeBlockDeleteUiWiring.test.ts for OutlineTreeView.ts).
 *
 * Extracting the id/translationKey pairs into fully plugin-independent,
 * standalone module-level data (with the 15 callbacks wired up
 * separately) was considered and rejected as beyond this fix's approved
 * scope: every callback closes over a PRIVATE instance method
 * (moveCurrentBlock, indentCurrentBlock, deleteCurrentBlock, ...), and a
 * plain exported table would either have to duplicate those method bodies
 * or make them public — neither of which this ticket asked for. See this
 * ticket's completion report for the full reasoning.
 *
 * Instead, this file does a lightweight STATIC TEXT check directly on
 * src/main.ts's own source: it extracts every `id: "..."` string that
 * appears inside getCommandSpecs()'s method body (via a regex bounded to
 * that one method, not the whole file) and asserts they are pairwise
 * unique and match the exact, unchanged set of 15 ids this refactor
 * started from. This is intentionally narrow — it cannot catch a callback
 * wired to the wrong method, for example — but it is a real regression
 * guard for exactly the failure mode a hand-maintained table like this is
 * most at risk of after a future edit (a copy-paste duplicate id, or an
 * accidental id rename that would silently orphan a user's existing
 * hotkey binding), without requiring any Obsidian runtime.
 *
 * translationKey existence-in-`en` is deliberately NOT checked here: it's
 * unnecessary, because CommandSpec's own `translationKey: TranslationKey`
 * field type already makes an unknown key a `tsc` compile error — the
 * same "compile-time guarantee is enough, no separate runtime check
 * needed" reasoning tests/i18n.test.ts's own top doc comment already uses
 * for en/ja key parity.
 */
describe("main.ts command table (static source check)", () => {
  const mainTs = readFileSync(path.resolve(__dirname, "../src/main.ts"), "utf-8");

  function getCommandSpecsBody(): string {
    const start = mainTs.indexOf("private getCommandSpecs(): CommandSpec[] {");
    if (start === -1) {
      throw new Error(
        "getCommandSpecs() not found in src/main.ts — has it been renamed or removed?"
      );
    }
    // Bounded to exactly this method's own closing brace (2-space class-
    // member indentation, no trailing comma) — every inner object's own
    // closing brace is indented 6 spaces AND followed by a comma
    // ("      },"), so it can never be mistaken for the method's end.
    const end = mainTs.indexOf("\n  }", start);
    if (end === -1 || end <= start) {
      throw new Error(
        "Could not find getCommandSpecs()'s closing brace — its shape may have changed; update this test's bounding logic."
      );
    }
    return mainTs.slice(start, end);
  }

  it("getCommandSpecs() exists in src/main.ts", () => {
    expect(mainTs).toContain("private getCommandSpecs(): CommandSpec[] {");
  });

  it("every command id declared inside getCommandSpecs() is unique", () => {
    const body = getCommandSpecsBody();
    const ids = [...body.matchAll(/\bid:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("command ids match the exact, unchanged set this refactor started from (id changes would silently orphan existing hotkeys)", () => {
    const body = getCommandSpecsBody();
    const ids = [...body.matchAll(/\bid:\s*"([^"]+)"/g)].map((m) => m[1]);

    expect(ids).toEqual([
      "move-block-up",
      "move-block-down",
      "move-section-up",
      "move-section-down",
      "move-node-only-up",
      "move-node-only-down",
      "indent-block",
      "outdent-block",
      "indent-node-only",
      "outdent-node-only",
      "delete-block",
      "insert-sibling-block",
      "insert-child-list-item",
      "open-outline-tree-view",
      "open-partial-edit-pane",
    ]);
  });

  it("every spec has exactly one of editorCallback/callback (mirrors Obsidian's own Command contract)", () => {
    const body = getCommandSpecsBody();
    // Split into per-entry chunks on the object literal boundaries used
    // throughout this table ("      {" ... "      },"), then check each
    // chunk has exactly one of the two callback kinds.
    const entries = body.split(/\n\s{6}\{/).slice(1);
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      // Property names are case-sensitive and distinct ("editorCallback:"
      // vs. "callback:"), so a plain \bcallback: match can never
      // accidentally match inside "editorCallback:".
      const hasEditorCallback = /\beditorCallback:/.test(entry);
      const hasCallback = /\bcallback:/.test(entry);
      expect(hasEditorCallback || hasCallback).toBe(true);
      expect(hasEditorCallback && hasCallback).toBe(false);
    }
  });
});
