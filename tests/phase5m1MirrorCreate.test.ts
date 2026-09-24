import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Editor } from "obsidian";
import { parseDocument } from "../src/parser/parseDocument";
import { scanComplexBlocks } from "../src/parser/complexBlocks";
import { matchCompositeBlocks } from "../src/parser/compositeBlocks";
import { DEFAULT_COMPOSITE_BLOCK_RULES } from "../src/model/compositeBlock";
import { applyLineEditOutcome } from "../src/commands/applyLineEditOutcome";
import {
  createMirrorBelow,
  generateMirrorBlockId,
  MIRROR_BLOCK_ID_RE,
  MIRROR_CREATE_REJECT_REASONS,
  MirrorCreateOutcome,
} from "../src/mirror/createMirror";
import { resolveMirrorSource } from "../src/mirror/resolveMirrorSource";
import { parseMirrorEmbed } from "../src/mirror/parseMirrorEmbed";
import { scanMirrorEmbeds } from "../src/mirror/scanMirrorEmbeds";
import { buildOutlineTree, flattenOutlineTree, isOutlineMirrorNode } from "../src/tree/buildOutlineTree";
import { createTranslator } from "../src/i18n";

/**
 * Phase 5M-1 ("ミラーの作成 UI と参照先解決"): real-assertion tests for
 * src/mirror/createMirror.ts (Create mirror: embed insertion, block-id
 * auto-assignment, resolution, cycle refusal) and
 * src/mirror/resolveMirrorSource.ts. See
 * docs/phase5m-1_mirror-create-design-memo.md.
 */

const rules = DEFAULT_COMPOSITE_BLOCK_RULES;
const J = (...lines: string[]) => lines.join("\n");
const NOTE = "Test/mirror.md";

/** Deterministic id generator: yields the given ids in order, then "uo-zzzzzzzz". */
function ids(...list: string[]) {
  let i = 0;
  return () => list[i++] ?? "uo-zzzzzzzz";
}

type Kind = "section" | "list" | "callout" | "blockquote" | "fenced-code" | "table" | "paragraph";

function refAt(text: string, kind: Kind, startLine: number) {
  const doc = parseDocument(text);
  if (kind === "section" || kind === "list") {
    const n = [...doc.nodes.values()].find((x) => x.type === kind && x.range.startLine === startLine);
    if (!n) throw new Error(`no ${kind} at ${startLine}`);
    return { kind, range: n.range };
  }
  const b = scanComplexBlocks(doc).blocks.find((x) => x.kind === kind && x.range.startLine === startLine);
  if (!b) throw new Error(`no ${kind} at ${startLine}`);
  return { kind, range: b.range };
}

function create(text: string, kind: Kind, startLine: number, gen = ids("uo-aaaa1111")): MirrorCreateOutcome {
  return createMirrorBelow(text, refAt(text, kind, startLine), rules, { generateBlockId: gen, notePath: NOTE });
}

/** The new document's mirror at the outcome's embed line. */
function mirrorAtEmbed(out: MirrorCreateOutcome) {
  const doc = parseDocument(out.lines.join("\n"));
  return scanMirrorEmbeds(doc, scanComplexBlocks(doc).blocks, NOTE).find((m) => m.node.embedLine === out.embedLine);
}

// ---------------------------------------------------------------------------
describe("Create mirror: embed insertion per block kind", () => {
  it("section: ![[#Heading]] is inserted directly ABOVE the heading (outside its own section)", () => {
    const t = J("# Doc", "", "## A", "alpha", "", "## B", "beta");
    const out = create(t, "section", 5);
    expect(out.changed).toBe(true);
    expect(out.lines).toEqual(["# Doc", "", "## A", "alpha", "", "![[#B]]", "## B", "beta"]);
    expect(out.placement).toBe("above");
    expect(out.embedLine).toBe(5);
    expect(out.blockId).toBeUndefined();
    expect(out.blockIdAdded).toBe(false);
  });

  it("section: the created mirror resolves to the heading's (shifted) section", () => {
    const t = J("# Doc", "", "## A", "alpha", "", "## B", "beta");
    const out = create(t, "section", 5);
    expect(out.resolution?.status).toBe("resolved");
    if (out.resolution?.status === "resolved") expect(out.resolution.source.lineRange).toEqual({ startLine: 6, endLine: 7 });
  });

  it("section: a heading with link-special characters gets the Obsidian link form", () => {
    const t = J("# Doc", "", "## Alpha: Notes", "x");
    const out = create(t, "section", 2);
    expect(out.embedText).toBe("![[#Alpha Notes]]");
    expect(out.resolution?.status).toBe("resolved");
  });

  it("section: never adds a block id to a heading", () => {
    const t = J("## A", "x");
    const out = create(t, "section", 0);
    expect(out.lines.some((l) => /\^uo-/.test(l))).toBe(false);
  });

  it("paragraph: id appended to its last line, embed directly after it with blank separation", () => {
    const t = J("## S", "para line one", "para line two", "", "next para");
    const out = create(t, "paragraph", 1);
    expect(out.lines).toEqual([
      "## S", "para line one", "para line two ^uo-aaaa1111", "", "![[#^uo-aaaa1111]]", "", "next para",
    ]);
    expect(out.blockIdAdded).toBe(true);
    expect(out.embedText).toBe("![[#^uo-aaaa1111]]");
  });

  it("callout: separate ^id line after a blank line (Obsidian's convention), then the embed", () => {
    const t = J("## S", "> [!note] T", "> body", "", "after");
    const out = create(t, "callout", 1);
    expect(out.lines).toEqual(["## S", "> [!note] T", "> body", "", "^uo-aaaa1111", "", "![[#^uo-aaaa1111]]", "", "after"]);
  });

  it("blockquote", () => {
    const t = J("## S", "> quoted", "> more");
    const out = create(t, "blockquote", 1);
    expect(out.lines).toEqual(["## S", "> quoted", "> more", "", "^uo-aaaa1111", "", "![[#^uo-aaaa1111]]"]);
  });

  it("fenced-code", () => {
    const t = J("## S", "```js", "x()", "```", "", "tail");
    const out = create(t, "fenced-code", 1);
    expect(out.lines).toEqual(["## S", "```js", "x()", "```", "", "^uo-aaaa1111", "", "![[#^uo-aaaa1111]]", "", "tail"]);
    expect(out.resolution?.status === "resolved" && out.resolution.source.lineRange.startLine).toBe(1);
  });

  it("table", () => {
    const t = J("## S", "| a | b |", "| - | - |", "| 1 | 2 |");
    const out = create(t, "table", 1);
    expect(out.lines).toEqual(["## S", "| a | b |", "| - | - |", "| 1 | 2 |", "", "^uo-aaaa1111", "", "![[#^uo-aaaa1111]]"]);
    expect(out.resolution?.status === "resolved" && out.resolution.source.lineRange).toEqual({ startLine: 1, endLine: 5 });
  });

  it("list item: id on the item's own line, embed after the WHOLE root list (never splitting it)", () => {
    const t = J("## S", "- one", "  - child", "- two", "", "tail");
    const out = create(t, "list", 1);
    expect(out.lines).toEqual(["## S", "- one ^uo-aaaa1111", "  - child", "- two", "", "![[#^uo-aaaa1111]]", "", "tail"]);
    const m = mirrorAtEmbed(out)!;
    expect(m.resolution.status === "resolved" && m.resolution.source.lineRange).toEqual({ startLine: 1, endLine: 2 });
  });

  it("nested list item: id on the nested item, embed still after the root list", () => {
    const t = J("- one", "  - child", "- two");
    const out = create(t, "list", 1);
    expect(out.lines).toEqual(["- one", "  - child ^uo-aaaa1111", "- two", "", "![[#^uo-aaaa1111]]"]);
  });

  it("list item with continuation text: id goes on the last line of its own text", () => {
    const t = J("- one", "  more of one", "  - child", "- two");
    const out = create(t, "list", 0);
    expect(out.lines[1]).toBe("  more of one ^uo-aaaa1111");
    expect(out.lines[0]).toBe("- one");
  });

  it("blank-separated root siblings count as one list: the embed goes after the last of them", () => {
    const t = J("- a", "", "- b", "", "para");
    const out = create(t, "list", 0);
    expect(out.lines).toEqual(["- a ^uo-aaaa1111", "", "- b", "", "![[#^uo-aaaa1111]]", "", "para"]);
  });

  it("frontmatter is never touched (first heading right after it)", () => {
    const t = J("---", "tags: [x]", "---", "# A", "x");
    const out = create(t, "section", 3);
    expect(out.lines).toEqual(["---", "tags: [x]", "---", "", "![[#A]]", "# A", "x"]);
  });

  it("trailing whitespace on the id line is replaced by exactly one space before the id", () => {
    const t = J("para   ");
    const out = create(t, "paragraph", 0);
    expect(out.lines[0]).toBe("para ^uo-aaaa1111");
  });
});

// ---------------------------------------------------------------------------
describe("Create mirror: block-id auto-assignment", () => {
  it("generated ids have the ^uo-<8 alphanumerics> form", () => {
    for (let i = 0; i < 20; i++) expect(generateMirrorBlockId()).toMatch(MIRROR_BLOCK_ID_RE);
    expect(generateMirrorBlockId(() => 0)).toBe("uo-aaaaaaaa");
  });

  it("an existing inline id is reused — no second id added", () => {
    const t = J("my para ^old-id");
    const out = create(t, "paragraph", 0);
    expect(out.lines).toEqual(["my para ^old-id", "", "![[#^old-id]]"]);
    expect(out.blockIdAdded).toBe(false);
    expect(out.blockId).toBe("old-id");
  });

  it("an existing separate ^id line after a callout is reused", () => {
    const t = J("> [!tip] T", "> b", "", "^tip1", "", "after");
    const out = create(t, "callout", 0);
    expect(out.lines).toEqual(["> [!tip] T", "> b", "", "^tip1", "", "![[#^tip1]]", "", "after"]);
    expect(out.blockIdAdded).toBe(false);
  });

  it("an existing id on a list item is reused", () => {
    const t = J("- item ^li9", "- other");
    const out = create(t, "list", 0);
    expect(out.blockId).toBe("li9");
    expect(out.lines).toEqual(["- item ^li9", "- other", "", "![[#^li9]]"]);
  });

  it("regenerates when the candidate id already exists in the note", () => {
    const t = J("taken ^uo-aaaa1111", "", "target para");
    const out = create(t, "paragraph", 2, ids("uo-aaaa1111", "uo-bbbb2222"));
    expect(out.blockId).toBe("uo-bbbb2222");
    expect(out.lines).toContain("target para ^uo-bbbb2222");
  });

  it("an id-like token anywhere (even inside code) counts as a collision", () => {
    const t = J("```", "see ^uo-aaaa1111", "```", "", "target para");
    const out = create(t, "paragraph", 4, ids("uo-aaaa1111", "uo-cccc3333"));
    expect(out.blockId).toBe("uo-cccc3333");
  });

  it("gives up with mirror-id-collision when no unique id can be found", () => {
    const t = J("taken ^uo-aaaa1111", "", "target para");
    const out = createMirrorBelow(t, refAt(t, "paragraph", 2), rules, {
      generateBlockId: () => "uo-aaaa1111",
      maxIdAttempts: 3,
    });
    expect(out.changed).toBe(false);
    expect(out.reason).toBe("mirror-id-collision");
    expect(out.lines).toEqual(t.split("\n"));
  });

  it("after creation the new id occurs exactly once in the note", () => {
    const t = J("## S", "p1", "", "p2");
    const out = create(t, "paragraph", 3);
    expect(out.lines.filter((l) => l.includes("^uo-aaaa1111") && !l.startsWith("![[")).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe("resolveMirrorSource (Phase 5M-1 module)", () => {
  const src = (line: string) => parseMirrorEmbed(line, NOTE)!;

  it("duplicate heading text: resolves to the FIRST, and reports matchCount", () => {
    const t = J("## Same", "one", "## Other", "## Same", "two");
    const doc = parseDocument(t);
    const r = resolveMirrorSource(doc, scanComplexBlocks(doc).blocks, src("![[#Same]]"));
    expect(r.status).toBe("resolved");
    if (r.status === "resolved") {
      expect(r.source.lineRange.startLine).toBe(0);
      expect(r.matchCount).toBe(2);
    }
  });

  it("a unique heading reports matchCount 1", () => {
    const doc = parseDocument(J("## A", "x"));
    const r = resolveMirrorSource(doc, scanComplexBlocks(doc).blocks, src("![[#A]]"));
    expect(r.status === "resolved" && r.matchCount).toBe(1);
  });

  it("a block id resolves to the line carrying ^id (its block)", () => {
    const doc = parseDocument(J("## S", "text ^x1", "", "other"));
    const r = resolveMirrorSource(doc, scanComplexBlocks(doc).blocks, src("![[#^x1]]"));
    expect(r.status === "resolved" && r.source.lineRange).toEqual({ startLine: 1, endLine: 1 });
  });

  it("not found -> unresolved / not-found", () => {
    const doc = parseDocument(J("## S", "text"));
    expect(resolveMirrorSource(doc, scanComplexBlocks(doc).blocks, src("![[#^missing]]"))).toMatchObject({
      status: "unresolved",
      reason: "not-found",
    });
    expect(resolveMirrorSource(doc, scanComplexBlocks(doc).blocks, src("![[#Nope]]")).status).toBe("unresolved");
  });

  it("scanMirrorEmbeds still marks cycles (detectMirrorCycle via applyMirrorCycles)", () => {
    const doc = parseDocument(J("## A", "![[#A]]"));
    expect(scanMirrorEmbeds(doc, scanComplexBlocks(doc).blocks, NOTE)[0].resolution.status).toBe("cycle");
  });
});

// ---------------------------------------------------------------------------
describe("Create mirror: warnings (the insert is kept)", () => {
  it("duplicate heading text -> duplicate-heading warning; mirror shows the first", () => {
    const t = J("## Same", "one", "", "## Other", "", "## Same", "two");
    const out = create(t, "section", 5);
    expect(out.changed).toBe(true);
    expect(out.warnings).toEqual(["duplicate-heading"]);
    expect(out.resolution?.status === "resolved" && out.resolution.source.lineRange.startLine).toBe(0);
  });

  it("a reused id that occurs twice -> duplicate-block-id warning", () => {
    const t = J("first ^dup", "", "second ^dup");
    const out = create(t, "paragraph", 2);
    expect(out.changed).toBe(true);
    expect(out.warnings).toEqual(["duplicate-block-id"]);
  });

  it("an ordinary creation has no warnings", () => {
    const out = create(J("## A", "x", "", "## B"), "section", 3);
    expect(out.warnings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe("Create mirror: circular references are refused", () => {
  it("refuses a mirror that would close a loop with an existing mirror", () => {
    // Section A already embeds B. A mirror of A would go right above "## A",
    // i.e. at the end of section B — B would embed A while A embeds B.
    const t = J("## B", "b text", "", "## A", "![[#B]]");
    const out = create(t, "section", 3);
    expect(out.changed).toBe(false);
    expect(out.reason).toBe("mirror-cycle");
    expect(out.lines).toEqual(t.split("\n"));
  });

  it("a cycle that ALREADY exists is not blamed on a new, unrelated mirror", () => {
    const t = J("## S", "![[#S]]", "", "p ^pp");
    const doc = parseDocument(t);
    expect(scanMirrorEmbeds(doc, scanComplexBlocks(doc).blocks, NOTE)[0].resolution.status).toBe("cycle");
    const out = create(t, "paragraph", 3);
    expect(out.changed).toBe(true);
  });

  it("a nested section's mirror above its heading lands in the parent — not circular", () => {
    const t = J("## P", "intro", "", "### C", "child");
    const out = create(t, "section", 3);
    expect(out.changed).toBe(true);
    expect(out.resolution?.status).toBe("resolved");
  });

  it("a list item's mirror is placed after the whole list, so it never references itself", () => {
    // Inside the list (as the item's continuation) it would be a
    // self-reference; after the list it is an ordinary, resolved mirror.
    const t = J("- item", "- other");
    const out = create(t, "list", 0);
    expect(out.changed).toBe(true);
    expect(mirrorAtEmbed(out)!.resolution.status).toBe("resolved");
  });

  it("a mirror of the whole top section placed above it (document start) is not circular", () => {
    const t = J("# Top", "![[#P]]", "", "## P", "x");
    expect(create(t, "section", 0).changed).toBe(true);
  });

  it("refuses a mirror that closes a LONGER loop through existing mirrors (C→A→… →C)", () => {
    // C embeds A, A embeds B. A mirror of C goes above "## C", i.e. into A:
    // A would embed C while C embeds A.
    const refused = create(J("## B", "b", "", "## A", "![[#B]]", "", "## C", "![[#A]]"), "section", 6);
    expect(refused.changed).toBe(false);
    expect(refused.reason).toBe("mirror-cycle");
  });
});

// ---------------------------------------------------------------------------
describe("Create mirror: refused targets", () => {
  it("a CompositeBlock member (anchor list item or its callout)", () => {
    const t = J("## S", "- ![[img.png]]", "> [!note] OCR", "> text");
    const doc = parseDocument(t);
    const scan = scanComplexBlocks(doc);
    const c = matchCompositeBlocks(doc, scan, rules)[0];
    for (const m of c.members) {
      const kind = m.kind === "single-line-list" || m.kind === "list" ? "list" : m.kind;
      const out = createMirrorBelow(t, { kind, range: m.range }, rules, {});
      expect(out.reason).toBe("mirror-composite-member");
    }
  });

  it("a callout nested inside a list item", () => {
    const t = J("- item", "", "  > [!note] nested", "  > body");
    const out = create(t, "callout", 2);
    expect(out.reason).toBe("mirror-nested-in-list");
  });

  it("a line that is already a mirror embed", () => {
    const t = J("## A", "x", "", "## B", "![[#A]]");
    const out = create(t, "paragraph", 4);
    expect(out.reason).toBe("mirror-of-mirror");
  });

  it("a paragraph that is only a block-id line", () => {
    const t = J("> q", "", "^qid");
    const out = create(t, "paragraph", 2);
    expect(out.reason).toBe("mirror-unsupported-kind");
  });

  it("a stale target (the note changed since the menu was built)", () => {
    const t = J("## S", "para");
    const out = createMirrorBelow(J("## S", "para", "grown"), refAt(t, "paragraph", 1), rules, {});
    expect(out.reason).toBe("mirror-target-changed");
  });

  it("an unsupported kind", () => {
    const out = createMirrorBelow("---\n", { kind: "thematic-break", range: { startLine: 0, endLine: 0 } }, rules, {});
    expect(out.reason).toBe("mirror-unsupported-kind");
  });

  it("every rejection reason has English and Japanese text", () => {
    const en = createTranslator("en");
    const ja = createTranslator("ja");
    for (const r of MIRROR_CREATE_REJECT_REASONS) {
      expect(en(`reason.${r}`)).toMatch(/^Unified Outliner: /);
      expect(ja(`reason.${r}`)).not.toBe(en(`reason.${r}`));
    }
  });
});

// ---------------------------------------------------------------------------
describe("Create mirror: structure preservation and one Undo step", () => {
  it("every existing line is kept; only the id suffix and inserted lines differ", () => {
    const t = J("# Doc", "", "## A", "alpha", "", "> [!note] N", "> b", "", "- x", "- y", "", "## B", "beta");
    for (const [kind, line] of [["section", 11], ["paragraph", 3], ["callout", 5], ["list", 8]] as const) {
      const out = create(t, kind, line);
      expect(out.changed).toBe(true);
      const kept = out.lines.map((l) => l.replace(/ \^uo-aaaa1111$/, ""));
      // removing inserted lines (embed / "^id" line / blanks) leaves the original
      const original = t.split("\n");
      let j = 0;
      for (const l of kept) if (j < original.length && l === original[j]) j++;
      expect(j).toBe(original.length);
    }
  });

  it("the new mirror immediately appears as a read-only Mirror row in the Outline Tree", () => {
    const t = J("## A", "alpha", "", "## B", "beta");
    const out = create(t, "section", 3);
    const doc = parseDocument(out.lines.join("\n"));
    const blocks = scanComplexBlocks(doc).blocks;
    const rows = flattenOutlineTree(buildOutlineTree(doc, { mirrors: { blocks, notePath: NOTE } })).filter(isOutlineMirrorNode);
    expect(rows.map((r) => [r.label, r.line, r.targetLine])).toEqual([["Mirror: B", 3, 4]]);
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

  const undoDoc = J("## S", "para", "", "> [!note] N", "> b", "", "## T", "x");
  for (const [name, kind, line] of [
    ["paragraph (id added on one line + embed inserted further down)", "paragraph", 1],
    ["callout (separate id line + embed)", "callout", 3],
    ["section (embed above heading)", "section", 6],
  ] as const) {
    it(`${name}: exactly one replaceRange; one undo restores the original`, () => {
      const out = create(undoDoc, kind, line);
      expect(out.changed).toBe(true);
      const editor = new UndoableFakeEditor(undoDoc);
      expect(applyLineEditOutcome(editor as unknown as Editor, { line: 0, ch: 0 }, 0, undoDoc.split("\n"), out, () => {})).toBe(true);
      expect(editor.replaceCalls).toBe(1);
      expect(editor.lines).toEqual(out.lines);
      editor.undo();
      expect(editor.getValue()).toBe(undoDoc);
    });
  }
});

// ---------------------------------------------------------------------------
describe("Create mirror: wiring (static source checks)", () => {
  const viewTs = readFileSync(path.resolve(__dirname, "../src/view/OutlineTreeView.ts"), "utf-8");
  const mainTs = readFileSync(path.resolve(__dirname, "../src/main.ts"), "utf-8");
  const createTs = readFileSync(path.resolve(__dirname, "../src/mirror/createMirror.ts"), "utf-8");

  function methodBody(src: string, signature: string): string {
    const start = src.indexOf(signature);
    expect(start, signature).toBeGreaterThan(-1);
    return src.slice(start, src.indexOf("\n  }\n", start));
  }

  it("section / list / standalone complex / paragraph menus offer it; composite and composite-member menus do not", () => {
    for (const sig of [
      "private showStructureCommandMenu(",
      "private showListCommandMenu(",
      "private showStandaloneComplexBlockMenu(",
      "private showParagraphMoveMenu(",
    ]) {
      expect(methodBody(viewTs, sig), sig).toContain("this.addMirrorCreateMenuItem(menu,");
    }
    for (const sig of ["private showCompositeCommandMenu(", "private showComplexMemberMenu("]) {
      expect(methodBody(viewTs, sig), sig).not.toContain("addMirrorCreateMenuItem");
    }
  });

  it("the click path re-reads the editor and writes only through plugin.applyMirrorCreateOutcome -> applyLineEditOutcome", () => {
    const click = methodBody(viewTs, "private runCreateMirrorCommand(");
    expect(click).toContain("editor.getValue()");
    expect(click).toContain("this.plugin.applyMirrorCreateOutcome(");
    expect(click).not.toContain("replaceRange");
    const apply = methodBody(mainTs, "  applyMirrorCreateOutcome(");
    expect(apply).toContain("applyLineEditOutcome(editor,");
    expect(apply).not.toContain("replaceRange");
    expect(apply).not.toContain("pendingBlockCopy");
  });

  it("the Command Palette command is registered", () => {
    expect(mainTs).toContain('id: "create-mirror-below"');
    expect(createTranslator("en")("command.createMirrorBelow")).toBe("Create mirror: insert embed below cursor block");
  });

  it("mirror creation never touches the Phase 5E-Copy copy-pending state", () => {
    expect(createTs).not.toMatch(/pendingBlockCopy/);
    expect(methodBody(viewTs, "private addMirrorCreateMenuItem(")).not.toMatch(/pendingBlockCopy|setPendingBlockCopy/);
  });
});
