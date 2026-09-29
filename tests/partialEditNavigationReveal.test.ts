/**
 * 2026-09-30 (Partial Edit Pane navigation -> body editor sync): real
 * assertions for the pure decision (view/partialEditNavigationReveal.ts),
 * the shared line revealer (view/editorLineReveal.ts, also used by the
 * Outline Tree's jumpToLine) and the new setting's default/merge/i18n.
 */
import { describe, expect, it, vi } from "vitest";
import {
  partialEditTargetKey,
  shouldRevealAfterNavigation,
} from "../src/view/partialEditNavigationReveal";
import { EditorLineRevealer, getEditorCmView, revealLineSafely } from "../src/view/editorLineReveal";
import { DEFAULT_SETTINGS, mergeSettings } from "../src/settingsDefaults";
import { createTranslator } from "../src/i18n";

describe("syncEditorOnPartialEditNavigation setting", () => {
  it("defaults to ON", () => {
    expect(DEFAULT_SETTINGS.syncEditorOnPartialEditNavigation).toBe(true);
  });

  it("an older data.json without the key merges to ON; an explicit OFF is kept", () => {
    expect(mergeSettings({}).syncEditorOnPartialEditNavigation).toBe(true);
    expect(mergeSettings({ showNoopNotices: false }).syncEditorOnPartialEditNavigation).toBe(true);
    expect(mergeSettings({ syncEditorOnPartialEditNavigation: false }).syncEditorOnPartialEditNavigation).toBe(false);
  });

  it("has an English and a Japanese name/description", () => {
    const en = createTranslator("en");
    const ja = createTranslator("ja");
    expect(en("settings.syncEditorOnPartialEditNavigation.name")).toBe(
      "Follow Partial Edit Pane navigation in the editor"
    );
    expect(ja("settings.syncEditorOnPartialEditNavigation.name")).toBe(
      "部分編集ペインでの移動に本文エディタを追従させる"
    );
    const enDesc = en("settings.syncEditorOnPartialEditNavigation.desc");
    const jaDesc = ja("settings.syncEditorOnPartialEditNavigation.desc");
    for (const word of ["parent", "child", "sibling", "breadcrumb", "Turn off"]) expect(enDesc).toContain(word);
    for (const word of ["親", "子", "兄弟", "パンくず", "オフ"]) expect(jaDesc).toContain(word);
    expect(jaDesc).not.toBe(enDesc);
  });
});

describe("shouldRevealAfterNavigation", () => {
  const base = { revealRequested: true, settingEnabled: true, keyBefore: "node:a", keyAfter: "node:b" };

  it("reveals for an explicit navigation to a different target with the setting ON", () => {
    expect(shouldRevealAfterNavigation(base)).toBe(true);
    expect(shouldRevealAfterNavigation({ ...base, keyBefore: "composite:10", keyAfter: "composite:40" })).toBe(true);
    expect(shouldRevealAfterNavigation({ ...base, keyBefore: null })).toBe(true);
  });

  it("never reveals with the setting OFF", () => {
    expect(shouldRevealAfterNavigation({ ...base, settingEnabled: false })).toBe(false);
  });

  it("never reveals when not requested (Tree-triggered open, auto-reload, post-Apply rebuild, manual reload)", () => {
    expect(shouldRevealAfterNavigation({ ...base, revealRequested: false })).toBe(false);
  });

  it("never reveals when the load failed (pane emptied) or the target did not change", () => {
    expect(shouldRevealAfterNavigation({ ...base, keyAfter: null })).toBe(false);
    expect(shouldRevealAfterNavigation({ ...base, keyAfter: "node:a" })).toBe(false);
  });

  it("partialEditTargetKey distinguishes node / composite / nothing", () => {
    expect(partialEditTargetKey("list-3", null)).toBe("node:list-3");
    expect(partialEditTargetKey(null, 12)).toBe("composite:12");
    expect(partialEditTargetKey(null, null)).toBeNull();
    expect(partialEditTargetKey("list-3", null)).not.toBe(partialEditTargetKey(null, 3));
  });
});

function fakeEditor(opts: { throwOn?: "setCursor" | "scroll" } = {}) {
  const calls: string[] = [];
  const editor = {
    setCursor: vi.fn((pos: { line: number; ch: number }) => {
      if (opts.throwOn === "setCursor") throw new Error("boom");
      calls.push(`setCursor:${pos.line}:${pos.ch}`);
    }),
    getLine: vi.fn(() => "- [ ] ![[files/p07.jpg]]"),
    scrollIntoView: vi.fn((range: { from: { line: number } }, center?: boolean) => {
      if (opts.throwOn === "scroll") throw new Error("boom");
      calls.push(`scroll:${range.from.line}:${String(center)}`);
    }),
  };
  return { editor, calls };
}

describe("EditorLineRevealer / revealLineSafely (shared with the Outline Tree jump)", () => {
  it("revealLine moves the cursor to the line start, then scrolls (center fallback when CM6 is unavailable) — without focusing", () => {
    const { editor, calls } = fakeEditor();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(getEditorCmView(editor as any)).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new EditorLineRevealer().revealLine(editor as any, 7);
    expect(calls).toEqual(["setCursor:7:0", "scroll:7:true"]);
    expect((editor as { focus?: unknown }).focus).toBeUndefined();
  });

  it("revealLineSafely reports success and delegates to revealLine", () => {
    const { editor, calls } = fakeEditor();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(revealLineSafely(new EditorLineRevealer(), editor as any, 3)).toBe(true);
    expect(calls).toEqual(["setCursor:3:0", "scroll:3:true"]);
  });

  it("is a silent no-op (false, no throw) for a missing editor/line or an editor that throws", () => {
    const r = new EditorLineRevealer();
    expect(revealLineSafely(r, null, 3)).toBe(false);
    expect(revealLineSafely(r, undefined, 3)).toBe(false);
    const { editor } = fakeEditor();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(revealLineSafely(r, editor as any, null)).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(revealLineSafely(r, editor as any, -1)).toBe(false);
    expect(editor.setCursor).not.toHaveBeenCalled();
    for (const throwOn of ["setCursor", "scroll"] as const) {
      const bad = fakeEditor({ throwOn });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(() => revealLineSafely(r, bad.editor as any, 2)).not.toThrow();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(revealLineSafely(r, bad.editor as any, 2)).toBe(false);
    }
  });

  it("cancel() with no active stabilizer window is a no-op", () => {
    expect(() => new EditorLineRevealer().cancel()).not.toThrow();
  });
});
