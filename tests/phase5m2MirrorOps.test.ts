import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Editor } from "obsidian";
import { parseDocument } from "../src/parser/parseDocument";
import { scanComplexBlocks } from "../src/parser/complexBlocks";
import { evaluateStandaloneComplexBlockMovability, matchCompositeBlocks } from "../src/parser/compositeBlocks";
import { DEFAULT_COMPOSITE_BLOCK_RULES } from "../src/model/compositeBlock";
import { applyLineEditOutcome } from "../src/commands/applyLineEditOutcome";
import {
  buildMirrorOpSnapshots,
  deleteMirror,
  evaluateMirrorMove,
  findMirrorsReferencing,
  mirrorReferencesForTarget,
  moveMirror,
  nextMirrorJumpIndex,
  onlyEmbedLineRemoved,
  partialEditTargetStartLine,
} from "../src/mirror/mirrorOps";
import { isMirrorEmbedBlock } from "../src/mirror/isMirrorEmbedBlock";
import {
  buildMirrorEmbedDeleteSnapshot,
  buildStandaloneComplexBlockDeleteSnapshot,
  deleteStandaloneComplexBlock,
} from "../src/edit/deleteStandaloneComplexBlock";
import {
  buildMirrorEmbedMoveSnapshot,
  buildStandaloneComplexBlockSnapshot,
  moveStandaloneComplexBlock,
} from "../src/edit/moveStandaloneComplexBlock";
import { createMirrorBelow } from "../src/mirror/createMirror";
import { createTranslator } from "../src/i18n";

/**
 * Phase 5M-2 ("ミラー行に対する操作"): real-assertion tests for mirror
 * Delete / Move (thin wrappers over the EXISTING standalone pipelines) and
 * the Partial Edit Pane's "mirrors referencing this block" lookup. See
 * docs/phase5m-2_mirror-ops-design-memo.md.
 */

const rules = DEFAULT_COMPOSITE_BLOCK_RULES;
const J = (...lines: string[]) => lines.join("\n");
const NOTE = "Test/ops.md";

function snaps(text: string, embedLine: number) {
  const doc = parseDocument(text);
  const s = buildMirrorOpSnapshots(doc, scanComplexBlocks(doc), embedLine);
  if (!s) throw new Error(`no mirror embed at line ${embedLine}`);
  return s;
}

function moveJudge(text: string, embedLine: number, dir: "up" | "down") {
  const doc = parseDocument(text);
  const scan = scanComplexBlocks(doc);
  return evaluateMirrorMove(doc, scan, matchCompositeBlocks(doc, scan, rules), embedLine, dir);
}

// ---------------------------------------------------------------------------
describe("Delete mirror", () => {
  it("removes ONLY the embed line; the referenced heading section is byte-identical", () => {
    const t = J("## A", "alpha", "", "## B", "![[#A]]", "", "beta");
    const out = deleteMirror(t, snaps(t, 4).delete, rules);
    expect(out.changed).toBe(true);
    expect(out.lines).toEqual(["## A", "alpha", "", "## B", "", "beta"]);
  });

  it("never removes the referenced block's auto-assigned ^uo- id (inline)", () => {
    const t = J("## S", "para text ^uo-abcd1234", "", "![[#^uo-abcd1234]]", "", "tail");
    const out = deleteMirror(t, snaps(t, 3).delete, rules);
    expect(out.lines).toEqual(["## S", "para text ^uo-abcd1234", "", "", "tail"]);
    expect(out.lines).toContain("para text ^uo-abcd1234");
  });

  it("never removes a separate ^id line after a callout", () => {
    const t = J("> [!note] N", "> body", "", "^uo-abcd1234", "", "![[#^uo-abcd1234]]");
    const out = deleteMirror(t, snaps(t, 5).delete, rules);
    expect(out.lines).toEqual(["> [!note] N", "> body", "", "^uo-abcd1234", ""]);
  });

  it("round trip with Create mirror: create then delete leaves only the block id behind", () => {
    const t = J("## S", "para", "", "tail");
    const created = createMirrorBelow(t, { kind: "paragraph", range: { startLine: 1, endLine: 1 } }, rules, {
      generateBlockId: () => "uo-rtrt0000",
    });
    const text = created.lines.join("\n");
    const out = deleteMirror(text, snaps(text, created.embedLine!).delete, rules);
    // The two blank separators Create mirror added stay (a run of 2 is not
    // normalized — the same rule a callout/blockquote delete follows).
    expect(out.lines).toEqual(["## S", "para ^uo-rtrt0000", "", "", "tail"]);
  });

  it("normalizes a resulting run of 3+ blank lines to 2 (same rule as callout/blockquote delete)", () => {
    const t = J("para", "", "", "![[#^x]]", "", "", "end ^x");
    const out = deleteMirror(t, snaps(t, 3).delete, rules);
    expect(out.lines).toEqual(["para", "", "", "end ^x"]);
  });

  it("leaves 2 or fewer surrounding blank lines as they are", () => {
    const t = J("para ^x", "", "![[#^x]]", "", "end");
    const out = deleteMirror(t, snaps(t, 2).delete, rules);
    expect(out.lines).toEqual(["para ^x", "", "", "end"]);
  });

  it("other mirrors of the same block are untouched", () => {
    const t = J("## A", "a", "", "## B", "![[#A]]", "", "![[#A]]");
    const out = deleteMirror(t, snaps(t, 4).delete, rules);
    expect(out.lines.filter((l) => l === "![[#A]]")).toHaveLength(1);
  });

  it("refuses a stale snapshot (the embed line changed after the menu was built)", () => {
    const t = J("## A", "a", "", "## B", "![[#A]]");
    const s = snaps(t, 4).delete;
    const edited = J("## A", "a", "", "## B", "plain text now");
    const out = deleteMirror(edited, s, rules);
    expect(out.changed).toBe(false);
    expect(out.lines).toEqual(edited.split("\n"));
  });

  it("an ordinary paragraph is never deletable through the mirror path", () => {
    const t = J("## A", "just text", "", "![[#A]]");
    const doc = parseDocument(t);
    const scan = scanComplexBlocks(doc);
    expect(buildMirrorOpSnapshots(doc, scan, 1)).toBeNull();
    const para = scan.blocks.find((b) => b.kind === "paragraph" && b.range.startLine === 1)!;
    expect(buildMirrorEmbedDeleteSnapshot(doc, para)).toBeNull();
    // A forged "paragraph" snapshot pointing at an ordinary paragraph is refused by the pipeline itself.
    const forged = { id: para.id, kind: "paragraph" as const, range: para.range, parentId: para.parentId };
    expect(deleteStandaloneComplexBlock(t, forged, rules)).toMatchObject({ changed: false, reason: "not-supported" });
  });

  it("onlyEmbedLineRemoved accepts exactly 'embed line + blank lines removed'", () => {
    const before = ["a", "", "![[#A]]", "", "", "b"];
    expect(onlyEmbedLineRemoved(before, ["a", "", "", "b"], 2)).toBe(true);
    expect(onlyEmbedLineRemoved(before, ["a", "", "", "", "b"], 2)).toBe(true);
    expect(onlyEmbedLineRemoved(before, ["", "", "b"], 2)).toBe(false); // "a" lost
    expect(onlyEmbedLineRemoved(before, ["a", "", "![[#A]]", "b"], 2)).toBe(false); // embed kept
    expect(onlyEmbedLineRemoved(before, ["a", "x", "b"], 2)).toBe(false); // text added
  });

  it("existing callout/blockquote/fenced-code/table delete behavior is unchanged", () => {
    const t = J("## S", "> [!note] N", "> b", "", "after");
    const doc = parseDocument(t);
    const callout = scanComplexBlocks(doc).blocks.find((b) => b.kind === "callout")!;
    const out = deleteStandaloneComplexBlock(t, buildStandaloneComplexBlockDeleteSnapshot(callout)!, rules);
    expect(out.lines).toEqual(["## S", "", "after"]);
    expect(buildStandaloneComplexBlockDeleteSnapshot(scanComplexBlocks(doc).blocks.find((b) => b.kind === "paragraph")!)).toBeNull();
  });

  it("is one replaceRange — one Undo restores the note", () => {
    const t = J("## A", "a", "", "## B", "![[#A]]", "", "", "", "b");
    const out = deleteMirror(t, snaps(t, 4).delete, rules);
    const editor = new UndoableFakeEditor(t);
    expect(applyLineEditOutcome(editor as unknown as Editor, { line: 4, ch: 0 }, 4, t.split("\n"), out, () => {})).toBe(true);
    expect(editor.replaceCalls).toBe(1);
    editor.undo();
    expect(editor.getValue()).toBe(t);
  });
});

// ---------------------------------------------------------------------------
describe("Move mirror up / down (existing standalone Move, reused)", () => {
  it("swaps with the adjacent paragraph above (gap kept)", () => {
    const t = J("## S", "para", "", "![[#^x]]", "", "end ^x");
    const out = moveMirror(t, snaps(t, 3).move, "up", rules);
    expect(out.lines).toEqual(["## S", "![[#^x]]", "", "para", "", "end ^x"]);
    expect(out.newStartLine).toBe(1);
  });

  it("swaps with the adjacent paragraph below", () => {
    const t = J("## S", "![[#^x]]", "", "para", "", "end ^x");
    const out = moveMirror(t, snaps(t, 1).move, "down", rules);
    expect(out.lines).toEqual(["## S", "para", "", "![[#^x]]", "", "end ^x"]);
  });

  it("swaps with an adjacent callout", () => {
    const t = J("## S", "> [!note] N", "> b", "", "![[#^x]]", "", "end ^x");
    const out = moveMirror(t, snaps(t, 4).move, "up", rules);
    expect(out.lines).toEqual(["## S", "![[#^x]]", "", "> [!note] N", "> b", "", "end ^x"]);
  });

  it("swaps with another mirror", () => {
    const t = J("## A", "a", "", "## B", "![[#A]]", "", "![[#^z]]", "", "zz ^z");
    const out = moveMirror(t, snaps(t, 6).move, "up", rules);
    expect(out.lines.slice(4, 7)).toEqual(["![[#^z]]", "", "![[#A]]"]);
  });

  it("swaps with an adjacent list item", () => {
    const t = J("## S", "- item", "", "![[#^x]]", "", "end ^x");
    const out = moveMirror(t, snaps(t, 3).move, "up", rules);
    expect(out.lines.slice(1, 4)).toEqual(["![[#^x]]", "", "- item"]);
  });

  it("does not cross a section boundary (first in its section: Move up unavailable)", () => {
    const t = J("## A", "a ^x", "", "## B", "![[#^x]]", "", "b");
    expect(moveJudge(t, 4, "up").eligible).toBe(false);
    const out = moveMirror(t, snaps(t, 4).move, "up", rules);
    expect(out.changed).toBe(false);
    expect(out.lines).toEqual(t.split("\n"));
  });

  it("does not cross a section boundary (last in its section: Move down unavailable)", () => {
    const t = J("## A", "a ^x", "", "![[#^x]]", "", "## B", "b");
    expect(moveJudge(t, 3, "down").eligible).toBe(false);
  });

  it("menu-time judge and click-time move agree", () => {
    const t = J("## S", "para", "", "![[#^x]]", "", "end ^x");
    for (const dir of ["up", "down"] as const) {
      const judged = moveJudge(t, 3, dir).eligible;
      expect(moveMirror(t, snaps(t, 3).move, dir, rules).changed).toBe(judged);
    }
  });

  it("an ordinary paragraph still cannot use the standalone Move judge (regression)", () => {
    const t = J("## S", "para one", "", "para two");
    const doc = parseDocument(t);
    const scan = scanComplexBlocks(doc);
    const para = scan.blocks.find((b) => b.kind === "paragraph" && b.range.startLine === 3)!;
    expect(evaluateStandaloneComplexBlockMovability(doc, scan, para, "up", [])).toMatchObject({ eligible: false, reason: "not-supported" });
    expect(buildMirrorEmbedMoveSnapshot(doc, para)).toBeNull();
    expect(buildStandaloneComplexBlockSnapshot(para)).toBeNull();
  });

  it("existing callout Move is unchanged (regression)", () => {
    const t = J("## S", "para", "", "> [!note] N", "> b");
    const doc = parseDocument(t);
    const callout = scanComplexBlocks(doc).blocks.find((b) => b.kind === "callout")!;
    const out = moveStandaloneComplexBlock(t, { snapshot: buildStandaloneComplexBlockSnapshot(callout)!, direction: "up" }, rules);
    expect(out.lines).toEqual(["## S", "> [!note] N", "> b", "", "para"]);
  });

  it("never absorbs a CompositeBlock member into a swap", () => {
    const t = J("## S", "- ![[img.png]]", "> [!note] OCR", "> text", "", "![[#^x]]", "", "x ^x");
    expect(moveJudge(t, 5, "up").eligible).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("isMirrorEmbedBlock", () => {
  const cases: [string, string, number, boolean][] = [
    ["a heading embed line", J("## A", "", "![[#A]]"), 2, true],
    ["a block-id embed line", J("x ^i", "", "![[#^i]]"), 2, true],
    ["an other-note embed line", J("![[Other#A]]"), 0, false],
    ["ordinary text", J("hello"), 0, false],
    ["an embed inside a list item continuation", J("- item", "  ![[#A]]"), 1, false],
  ];
  for (const [name, text, line, expected] of cases) {
    it(name, () => {
      const doc = parseDocument(text);
      const block = scanComplexBlocks(doc).blocks.find((b) => b.kind === "paragraph" && b.range.startLine === line);
      expect(block ? isMirrorEmbedBlock(doc, block) : false).toBe(expected);
    });
  }
});

// ---------------------------------------------------------------------------
describe("Partial Edit Pane: mirrors referencing this block", () => {
  const t = J(
    "## A", // 0
    "alpha ^a1", // 1
    "", // 2
    "## B", // 3
    "![[#A]]", // 4
    "", // 5
    "![[#^a1]]", // 6
    "", // 7
    "![[#A]]", // 8
    "", // 9
    "![[#^missing]]", // 10
    "", // 11
    "![[#B]]" // 12  (inside B -> circular)
  );
  const doc = parseDocument(t);
  const blocks = scanComplexBlocks(doc).blocks;

  it("a section: every resolved heading mirror of it, in document order", () => {
    expect(findMirrorsReferencing(doc, blocks, NOTE, 0)).toEqual([4, 8]);
  });

  it("a block with an id: its block-id mirrors", () => {
    expect(findMirrorsReferencing(doc, blocks, NOTE, 1)).toEqual([6]);
  });

  it("circular and unresolved mirrors are not counted", () => {
    expect(findMirrorsReferencing(doc, blocks, NOTE, 3)).toEqual([]);
  });

  it("no mirrors -> empty (the link row is hidden)", () => {
    expect(mirrorReferencesForTarget(J("## A", "a"), NOTE, { kind: "node", nodeId: "sec-0" })).toEqual([]);
  });

  it("node target (section) resolves through the pane's node id", () => {
    expect(mirrorReferencesForTarget(t, NOTE, { kind: "node", nodeId: "sec-0" })).toEqual([4, 8]);
  });

  it("paragraph target resolves by parent + text", () => {
    expect(
      mirrorReferencesForTarget(t, NOTE, { kind: "paragraph", parentId: "sec-0", originalText: "alpha ^a1" })
    ).toEqual([6]);
  });

  it("an unlocatable paragraph (text changed) shows nothing rather than guessing", () => {
    expect(partialEditTargetStartLine(doc, { kind: "paragraph", parentId: "sec-0", originalText: "gone" })).toBeNull();
  });

  it("a CompositeBlock / nothing loaded ('none') never shows the row", () => {
    expect(mirrorReferencesForTarget(t, NOTE, { kind: "none" })).toEqual([]);
  });

  it("list item with an id: node target", () => {
    const t2 = J("- item ^li", "  - child", "", "![[#^li]]");
    const d2 = parseDocument(t2);
    const li = [...d2.nodes.values()].find((n) => n.type === "list" && n.range.startLine === 0)!;
    expect(mirrorReferencesForTarget(t2, NOTE, { kind: "node", nodeId: li.id })).toEqual([3]);
  });

  it("updates when the note changes (pure recomputation from the new text)", () => {
    const more = t + "\n\n![[#A]]";
    expect(mirrorReferencesForTarget(more, NOTE, { kind: "node", nodeId: "sec-0" })).toEqual([4, 8, 14]);
  });

  it("jump index cycles through the mirrors and loops", () => {
    expect(nextMirrorJumpIndex(-1, 3)).toBe(0);
    expect(nextMirrorJumpIndex(0, 3)).toBe(1);
    expect(nextMirrorJumpIndex(1, 3)).toBe(2);
    expect(nextMirrorJumpIndex(2, 3)).toBe(0);
    expect(nextMirrorJumpIndex(0, 1)).toBe(0);
    expect(nextMirrorJumpIndex(5, 0)).toBe(-1);
  });

  it("the link text is localized", () => {
    expect(createTranslator("ja")("partialEdit.mirrorReferences", { count: 2 })).toBe("このブロックを参照しているミラー: 2 件");
    expect(createTranslator("en")("partialEdit.mirrorReferences", { count: 2 })).toBe("Mirrors referencing this block: 2");
  });
});

// ---------------------------------------------------------------------------
describe("wiring (static source checks)", () => {
  const viewTs = readFileSync(path.resolve(__dirname, "../src/view/OutlineTreeView.ts"), "utf-8");
  const paneTs = readFileSync(path.resolve(__dirname, "../src/view/PartialEditView.ts"), "utf-8");
  const modalTs = readFileSync(path.resolve(__dirname, "../src/view/ConfirmFencedCodeDeleteModal.ts"), "utf-8");
  const opsTs = readFileSync(path.resolve(__dirname, "../src/mirror/mirrorOps.ts"), "utf-8");

  function body(src: string, signature: string): string {
    const start = src.indexOf(signature);
    expect(start, signature).toBeGreaterThan(-1);
    return src.slice(start, src.indexOf("\n  }\n", start));
  }

  it("the mirror row menu offers exactly Move up / Move down / Delete — no rename, Partial Edit or copy/paste", () => {
    const menu = body(viewTs, "private showMirrorMenu(");
    expect(menu).toContain('"tree.menu.moveMirrorUp"');
    expect(menu).toContain('"tree.menu.moveMirrorDown"');
    expect(menu).toContain('"tree.menu.deleteMirror"');
    expect(menu).not.toMatch(/beginRename|activatePartialEditView|addBlockCopyMenuItems|addMirrorCreateMenuItem|setPendingBlockCopy/);
    expect(menu).toContain("new ConfirmFencedCodeDeleteModal(");
  });

  it("mirror Move dispatch is the existing standalone Move dispatch", () => {
    expect(body(viewTs, "private dispatchAndApplyMirrorMove(")).toContain("this.dispatchAndApplyStandaloneComplexBlockMove(");
  });

  it("mirror Delete writes only through applyLineEditOutcome", () => {
    const d = body(viewTs, "private dispatchAndApplyMirrorDelete(");
    expect(d).toContain("deleteMirror(text, snapshot, rules)");
    expect(d).toContain("applyLineEditOutcome(");
    expect(d).not.toContain("replaceRange");
  });

  it("mirror rows stay read-only: no drag wiring or rename branch matches them", () => {
    expect(viewTs).not.toMatch(/isOutlineMirrorNode\(node\)[^\n]*(dragstart|draggable|beginRename)/);
  });

  it("the delete modal has a mirror title and states the referenced block is not changed", () => {
    expect(modalTs).toContain('"modal.deleteMirrorTitle"');
    expect(modalTs).toContain('"modal.deleteMirrorNote"');
  });

  it("the Partial Edit mirror row is display-only: never touches draft, dirty state or Apply", () => {
    for (const sig of ["private updateMirrorReferences(", "private renderMirrorReferences(", "private jumpToNextMirrorReference("]) {
      const b = body(paneTs, sig);
      expect(b, sig).not.toMatch(/updateDirtyState|originalText\s*=|textareaEl|syncState\s*=|applyEdit|cancelEdit|replaceRange/);
    }
    expect(body(paneTs, "private handleEditorChange(")).toContain("this.scheduleMirrorReferencesUpdate();");
    expect(body(paneTs, "private handleVaultModify(")).toContain("this.scheduleMirrorReferencesUpdate();");
  });

  it("mirror ops never touch the Phase 5E-Copy copy-pending state", () => {
    expect(opsTs).not.toMatch(/pendingBlockCopy/);
    expect(body(viewTs, "private showMirrorMenu(")).not.toMatch(/pendingBlockCopy/);
  });
});

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
