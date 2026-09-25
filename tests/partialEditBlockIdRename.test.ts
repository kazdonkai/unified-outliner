import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Editor } from "obsidian";
import { parseDocument } from "../src/parser/parseDocument";
import { scanComplexBlocks } from "../src/parser/complexBlocks";
import { applyLineEditOutcome } from "../src/commands/applyLineEditOutcome";
import { applySubtreeEdit, extractSubtreeText } from "../src/edit/partialEdit";
import { resolveParagraphAtCursor } from "../src/resolver/resolveParagraphAtCursor";
import { applyParagraphEdit, buildParagraphEditAnchor } from "../src/edit/paragraphPartialEdit";
import {
  countSameFileBlockIdMirrors,
  findCrossFileBlockIdReferences,
  NoteLinkReference,
  renameBlockIdInText,
} from "../src/edit/blockIdRename";
import { createTranslator } from "../src/i18n";

/**
 * Partial Edit Pane — Block ID field follow-up: renaming a block id also
 * rewrites the same-note mirror embeds (one Undo step); references from
 * other notes, and same-note references left broken by a removal, are
 * reported. See docs/partial-edit-block-id-field-design-memo.md §8.
 */

const J = (...lines: string[]) => lines.join("\n");
const NOTE = "Test/note.md";

// ---------------------------------------------------------------------------
describe("renameBlockIdInText", () => {
  it("rewrites a single ![[#^old-id]]", () => {
    const r = renameBlockIdInText(J("text ^old-id", "", "![[#^old-id]]"), "old-id", "new-id");
    expect(r.text).toBe(J("text ^old-id", "", "![[#^new-id]]"));
    expect(r.replacedLines).toEqual([2]);
  });

  it("rewrites every matching embed", () => {
    const r = renameBlockIdInText(J("![[#^a]]", "x", "![[#^a]]", "", "  ![[#^a]]  "), "a", "b");
    expect(r.text).toBe(J("![[#^b]]", "x", "![[#^b]]", "", "  ![[#^b]]  "));
    expect(r.replacedLines).toEqual([0, 2, 4]);
  });

  it("keeps an alias", () => {
    expect(renameBlockIdInText("![[#^old|shown text]]", "old", "new").text).toBe("![[#^new|shown text]]");
  });

  it("leaves lines that do not reference the old id unchanged", () => {
    const text = J("![[#^other]]", "![[#^old-id-2]]", "![[#Heading]]", "![[Other#^old-id]]", "see ![[#^old-id]] inline");
    const r = renameBlockIdInText(text, "old-id", "new");
    expect(r.text).toBe(text);
    expect(r.replacedLines).toEqual([]);
  });

  it("newId null (id removed) rewrites nothing", () => {
    const text = J("p ^x", "", "![[#^x]]");
    expect(renameBlockIdInText(text, "x", null)).toEqual({ text, replacedLines: [] });
  });

  it("never touches the block's own id (inline suffix or standalone line) — applySubtreeEdit/applyParagraphEdit do that", () => {
    const text = J("Paragraph ^old", "", "> [!note] C", "> body", "", "^old", "", "![[#^old]]");
    const r = renameBlockIdInText(text, "old", "new");
    expect(r.text).toBe(J("Paragraph ^old", "", "> [!note] C", "> body", "", "^old", "", "![[#^new]]"));
  });

  it("skips frontmatter and fenced code", () => {
    const text = J("---", "x: ![[#^old]]", "---", "```", "![[#^old]]", "```", "![[#^old]]");
    const r = renameBlockIdInText(text, "old", "new");
    expect(r.replacedLines).toEqual([6]);
    expect(r.text.split("\n")[4]).toBe("![[#^old]]");
  });
});

describe("countSameFileBlockIdMirrors", () => {
  it("counts same-note mirror embeds of the id, resolved or not", () => {
    const text = J("p ^x", "", "![[#^x]]", "", "![[#^x]]", "", "![[#^y]]");
    expect(countSameFileBlockIdMirrors(text, NOTE, "x")).toBe(2);
    expect(countSameFileBlockIdMirrors(text, NOTE, "z")).toBe(0);
    // unresolved (the id line is gone) still counts: the reference text remains
    expect(countSameFileBlockIdMirrors(J("p", "", "![[#^x]]"), NOTE, "x")).toBe(1);
  });
});

describe("findCrossFileBlockIdReferences", () => {
  const resolve = (linkpath: string): string | null =>
    ({ note: NOTE, "Test/note": NOTE, other: "Other.md" } as Record<string, string>)[linkpath] ?? null;

  it("only same-file references -> false", () => {
    const links: NoteLinkReference[] = [
      { sourcePath: NOTE, link: "#^blk" },
      { sourcePath: NOTE, link: "note#^blk" },
    ];
    expect(findCrossFileBlockIdReferences(links, NOTE, "blk", resolve)).toBe(false);
  });

  it("a reference from another file -> true (embed or link, path forms)", () => {
    expect(findCrossFileBlockIdReferences([{ sourcePath: "A.md", link: "note#^blk" }], NOTE, "blk", resolve)).toBe(true);
    expect(findCrossFileBlockIdReferences([{ sourcePath: "A.md", link: "Test/note#^blk" }], NOTE, "blk", resolve)).toBe(
      true
    );
  });

  it("no reference -> false", () => {
    const links: NoteLinkReference[] = [
      { sourcePath: "A.md", link: "note#^other" },
      { sourcePath: "A.md", link: "other#^blk" },
      { sourcePath: "A.md", link: "note" },
      { sourcePath: "A.md", link: "#^blk" }, // A's own block, not this note's
    ];
    expect(findCrossFileBlockIdReferences(links, NOTE, "blk", resolve)).toBe(false);
    expect(findCrossFileBlockIdReferences([], NOTE, "blk", resolve)).toBe(false);
  });

  it("an unresolved link path does not count", () => {
    expect(findCrossFileBlockIdReferences([{ sourcePath: "A.md", link: "missing#^blk" }], NOTE, "blk", resolve)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
class UndoableFakeEditor {
  lines: string[];
  history: string[][] = [];
  replaceCalls = 0;
  constructor(text: string) {
    this.lines = text.split("\n");
  }
  replaceRange(text: string, from: { line: number; ch: number }, to: { line: number; ch: number }): void {
    this.replaceCalls++;
    this.history.push([...this.lines]);
    const head = this.lines[from.line].slice(0, from.ch);
    const tail = this.lines[to.line].slice(to.ch);
    this.lines = [...this.lines.slice(0, from.line), ...(head + text + tail).split("\n"), ...this.lines.slice(to.line + 1)];
  }
  undo(): void {
    const prev = this.history.pop();
    if (prev) this.lines = prev;
  }
  setCursor(): void {}
  getValue(): string {
    return this.lines.join("\n");
  }
}

/** The applyEdit flow: rename embeds in the live text, apply against it, write ONCE diffing against the live lines. */
function applyWithRename(
  liveText: string,
  oldId: string,
  newId: string,
  apply: (doc: ReturnType<typeof parseDocument>) => { changed: boolean; lines: string[]; newStartLine: number }
): UndoableFakeEditor {
  const editor = new UndoableFakeEditor(liveText);
  const renamed = renameBlockIdInText(liveText, oldId, newId);
  const doc = parseDocument(renamed.text);
  const outcome = apply(doc);
  expect(outcome.changed).toBe(true);
  applyLineEditOutcome(
    editor as unknown as Editor,
    { line: outcome.newStartLine, ch: 0 },
    outcome.newStartLine,
    liveText.split("\n"),
    outcome,
    () => {}
  );
  return editor;
}

describe("applyEdit flow: id rename + same-note embed rewrite in ONE edit", () => {
  it("callout (standalone id, Create mirror layout): embeds renamed with the id, one replaceRange, one Undo", () => {
    const live = J("## Src", "> [!note] Callout source", "> body", "", "^src-callout", "", "## M", "![[#^src-callout]]", "", "![[#^src-callout|alias]]");
    const editor = applyWithRename(live, "src-callout", "renamed", (doc) => {
      const info = scanComplexBlocks(doc).blocks.find((b) => b.kind === "callout")!;
      const x = extractSubtreeText(doc, info.id);
      return applySubtreeEdit(doc, info.id, x.text, x.text, undefined, "renamed", true, "src-callout");
    });
    expect(editor.getValue()).toBe(
      J("## Src", "> [!note] Callout source", "> body", "", "^renamed", "", "## M", "![[#^renamed]]", "", "![[#^renamed|alias]]")
    );
    expect(editor.replaceCalls).toBe(1);
    editor.undo();
    expect(editor.getValue()).toBe(live);
  });

  it("paragraph (inline id) with the embed ABOVE the block: still one replaceRange / one Undo", () => {
    const live = J("![[#^p1]]", "", "Para text ^p1", "", "end");
    const r = resolveParagraphAtCursor(parseDocument(live), 2).paragraph!;
    const anchor = buildParagraphEditAnchor(parseDocument(live), r);
    const editor = applyWithRename(live, "p1", "p2", (doc) => applyParagraphEdit(doc, anchor, "Para text", "p2", false));
    expect(editor.getValue()).toBe(J("![[#^p2]]", "", "Para text ^p2", "", "end"));
    expect(editor.replaceCalls).toBe(1);
    editor.undo();
    expect(editor.getValue()).toBe(live);
  });

  it("the edited block's own conflict check still passes against the renamed text", () => {
    const live = J("```js", "a()", "```", "", "^cid", "", "![[#^cid]]");
    const editor = applyWithRename(live, "cid", "cid-2", (doc) => {
      const info = scanComplexBlocks(doc).blocks.find((b) => b.kind === "fenced-code")!;
      const x = extractSubtreeText(doc, info.id);
      return applySubtreeEdit(doc, info.id, x.text, "b()", undefined, "cid-2", true, "cid");
    });
    expect(editor.getValue()).toBe(J("``` js", "b()", "```", "", "^cid-2", "", "![[#^cid-2]]"));
  });
});

// ---------------------------------------------------------------------------
describe("i18n and view wiring", () => {
  const viewTs = readFileSync(path.resolve(__dirname, "../src/view/PartialEditView.ts"), "utf-8");

  it("the four messages exist in English and Japanese", () => {
    const en = createTranslator("en");
    const ja = createTranslator("ja");
    for (const k of [
      "partialEdit.blockIdCrossFileWarning",
      "partialEdit.blockIdSameFileRenamed",
      "partialEdit.blockIdDeletedCrossFileWarning",
      "partialEdit.blockIdDeletedSameFileWarning",
    ] as const) {
      expect(en(k)).toMatch(/^Unified Outliner: /);
      expect(ja(k)).toMatch(/^Unified Outliner: /);
    }
    expect(ja("partialEdit.blockIdSameFileRenamed", { count: "2" })).toContain("2 件");
  });

  it("applyEdit renames embeds in the parsed text but diffs the write against the untouched live lines", () => {
    const i = viewTs.indexOf("private applyEdit(): boolean {");
    const body = viewTs.slice(i, viewTs.indexOf("\n  }\n", i));
    expect(body).toContain("const blockIdRename = this.prepareBlockIdRename(this.loadedBlockId, this.blockIdForApply(), liveText);");
    expect(body).toContain("const doc = parseDocument(blockIdRename.renamedText);");
    expect(body.split("this.notifyBlockIdRename(blockIdRename);").length - 1).toBe(2);
    expect(body.split("liveLines,").length - 1).toBe(2);
  });

  it("prepareBlockIdRename only acts on an actual change and never blocks Apply", () => {
    const i = viewTs.indexOf("private prepareBlockIdRename(");
    const body = viewTs.slice(i, viewTs.indexOf("\n  }\n", i));
    expect(body).toContain("if (oldId === null || newId === undefined) return none;");
    expect(body).toContain("if (!normalized.ok || normalized.blockId === oldId) return none;");
    expect(body).not.toMatch(/return false|throw /);
  });
});
