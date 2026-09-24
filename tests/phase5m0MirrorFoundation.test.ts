import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseDocument } from "../src/parser/parseDocument";
import { scanComplexBlocks } from "../src/parser/complexBlocks";
import { parseMirrorEmbed } from "../src/mirror/parseMirrorEmbed";
import { detectMirrorCycle } from "../src/mirror/detectMirrorCycle";
import { MirrorNode } from "../src/mirror/mirrorTypes";
import {
  mirrorTargetLabel,
  normalizeMirrorHeading,
  resolveMirrorSource,
  scanMirrorEmbeds,
} from "../src/mirror/scanMirrorEmbeds";
import {
  buildOutlineTree,
  collectReadOnlyOutlineNodeIds,
  flattenOutlineTree,
  isOutlineMirrorNode,
  OutlineTreeMirrorNode,
} from "../src/tree/buildOutlineTree";
import { buildNodeIdentityMap } from "../src/tree/foldIdentity";
import { resolveCurrentPositionNodeId } from "../src/tree/resolveCurrentPositionNodeId";
import { DEFAULT_SETTINGS, mergeSettings } from "../src/settingsDefaults";
import { createTranslator } from "../src/i18n";

/**
 * Phase 5M-0 ("ミラーの基盤型定義と読み取り専用 Outline Tree 投影"):
 * real-assertion tests for the mirror parser, cycle detection, resolution
 * and the read-only Outline Tree projection. See
 * docs/phase5m-0_mirror-foundation-design-memo.md.
 */

const J = (...lines: string[]) => lines.join("\n");
const NOTE = "Notes/test.md";

// ---------------------------------------------------------------------------
describe("parseMirrorEmbed: accepted same-note embeds", () => {
  it("![[#Heading]] -> heading mirror", () => {
    expect(parseMirrorEmbed("![[#Heading]]", NOTE)).toEqual({
      notePath: NOTE,
      kind: "heading",
      headingText: "Heading",
      headingPath: ["Heading"],
      lineRange: null,
    });
  });

  it("keeps spaces and non-ASCII inside a heading name", () => {
    const r = parseMirrorEmbed("![[#土地 紛争の 記録]]", NOTE);
    expect(r?.kind).toBe("heading");
    expect(r?.headingText).toBe("土地 紛争の 記録");
  });

  it("![[#^block-id]] -> block-id mirror", () => {
    expect(parseMirrorEmbed("![[#^abc-123]]", NOTE)).toEqual({
      notePath: NOTE,
      kind: "block-id",
      blockId: "abc-123",
      lineRange: null,
    });
  });

  it("nested heading path ![[#Parent#Child]]", () => {
    const r = parseMirrorEmbed("![[#Parent#Child]]", NOTE);
    expect(r?.headingPath).toEqual(["Parent", "Child"]);
    expect(r?.headingText).toBe("Child");
  });

  it("an alias after | is accepted and ignored", () => {
    expect(parseMirrorEmbed("![[#Heading|shown text]]", NOTE)?.headingText).toBe("Heading");
    expect(parseMirrorEmbed("![[#^id1|alias]]", NOTE)?.blockId).toBe("id1");
  });

  it("surrounding whitespace on the line is allowed; the target is trimmed", () => {
    expect(parseMirrorEmbed("   ![[# Heading ]]  ", NOTE)?.headingText).toBe("Heading");
  });

  it("notePath is carried through unchanged", () => {
    expect(parseMirrorEmbed("![[#H]]", "a/b/c.md")?.notePath).toBe("a/b/c.md");
  });
});

describe("parseMirrorEmbed: rejected (returns null)", () => {
  const rejected: [string, string][] = [
    ["another note's heading", "![[Other note#Heading]]"],
    ["another note's block", "![[Other note#^abc]]"],
    ["a whole-file embed", "![[Other note]]"],
    ["a plain link (not an embed)", "[[#Heading]]"],
    ["an empty heading", "![[#]]"],
    ["an empty block id", "![[#^]]"],
    ["an invalid block id", "![[#^bad id]]"],
    ["a block id with underscores", "![[#^bad_id]]"],
    ["an empty path segment", "![[#A##B]]"],
    ["a heading path ending in a block id", "![[#A#^id]]"],
    ["text before the embed", "see ![[#Heading]]"],
    ["text after the embed", "![[#Heading]] and more"],
    ["two embeds on one line", "![[#A]]![[#B]]"],
    ["nested brackets", "![[#A[x]]]"],
    ["an unterminated embed", "![[#Heading"],
    ["a list item containing an embed", "- ![[#Heading]]"],
    ["an empty line", ""],
  ];
  for (const [name, line] of rejected) {
    it(name, () => {
      expect(parseMirrorEmbed(line, NOTE)).toBeNull();
    });
  }
});

// ---------------------------------------------------------------------------
function mirror(id: string, embedLine: number, range: [number, number] | null): MirrorNode {
  return {
    id,
    kind: "heading",
    embedLine,
    source: {
      notePath: NOTE,
      kind: "heading",
      headingText: id,
      headingPath: [id],
      lineRange: range ? { startLine: range[0], endLine: range[1] } : null,
    },
  };
}

describe("detectMirrorCycle", () => {
  it("no mirrors -> no cycles", () => {
    const r = detectMirrorCycle([]);
    expect(r.cyclicIds.size).toBe(0);
    expect(r.cycles).toEqual([]);
  });

  it("independent mirrors -> no cycles", () => {
    const r = detectMirrorCycle([mirror("a", 1, [10, 12]), mirror("b", 2, [20, 22])]);
    expect(r.cyclicIds.size).toBe(0);
  });

  it("a mirror whose target contains its own embed line is a one-step cycle", () => {
    const r = detectMirrorCycle([mirror("a", 11, [10, 12])]);
    expect([...r.cyclicIds]).toEqual(["a"]);
    expect(r.cycles).toEqual([["a"]]);
  });

  it("two mirrors referencing each other's containing block form a cycle", () => {
    const r = detectMirrorCycle([mirror("a", 21, [10, 12]), mirror("b", 11, [20, 22])]);
    expect(r.cyclicIds).toEqual(new Set(["a", "b"]));
    expect(r.cycles).toHaveLength(1);
  });

  it("a three-step cycle marks every member", () => {
    const r = detectMirrorCycle([mirror("a", 21, [10, 12]), mirror("b", 31, [20, 22]), mirror("c", 11, [30, 32])]);
    expect(r.cyclicIds).toEqual(new Set(["a", "b", "c"]));
  });

  it("a chain that merely LEADS INTO a cycle is not itself cyclic", () => {
    // x -> a <-> b ; x is outside the loop.
    const r = detectMirrorCycle([mirror("x", 50, [20, 22]), mirror("a", 21, [10, 12]), mirror("b", 11, [20, 22])]);
    expect(r.cyclicIds).toEqual(new Set(["a", "b"]));
  });

  it("a nested (non-circular) chain is not a cycle", () => {
    // a's target contains b's embed; b's target contains nothing.
    const r = detectMirrorCycle([mirror("a", 1, [10, 20]), mirror("b", 15, [30, 31])]);
    expect(r.cyclicIds.size).toBe(0);
  });

  it("unresolved mirrors (lineRange null) never form a cycle", () => {
    const r = detectMirrorCycle([mirror("a", 11, null), mirror("b", 12, null)]);
    expect(r.cyclicIds.size).toBe(0);
  });

  it("marks every member of a component even when reached through an already-finished node", () => {
    // a -> b, b -> a, b -> c, c -> b : one component {a,b,c}
    const r = detectMirrorCycle([mirror("a", 11, [20, 21]), mirror("b", 20, [10, 12]), mirror("c", 12, [20, 20])]);
    expect(r.cyclicIds).toEqual(new Set(["a", "b", "c"]));
  });
});

// ---------------------------------------------------------------------------
describe("resolution against the note", () => {
  const text = J(
    "# Doc", // 0
    "", // 1
    "## Alpha", // 2
    "alpha text ^a1", // 3
    "", // 4
    "### Child", // 5
    "child text", // 6
    "", // 7
    "## Beta", // 8
    "- item one ^li1", // 9
    "  - nested", // 10
    "", // 11
    "| a | b |", // 12
    "| - | - |", // 13
    "| 1 | 2 |", // 14
    "", // 15
    "^tbl", // 16
    "", // 17
    "## Alpha: Notes" // 18
  );
  const doc = parseDocument(text);
  const blocks = scanComplexBlocks(doc).blocks;
  const resolve = (line: string) => resolveMirrorSource(doc, blocks, parseMirrorEmbed(line, NOTE)!);

  it("a heading resolves to its whole section subtree", () => {
    const r = resolve("![[#Alpha]]");
    expect(r.status).toBe("resolved");
    if (r.status === "resolved") expect(r.source.lineRange).toEqual({ startLine: 2, endLine: 7 });
  });

  it("a nested heading path resolves through its ancestors", () => {
    const r = resolve("![[#Alpha#Child]]");
    expect(r.status === "resolved" && r.source.lineRange.startLine).toBe(5);
    expect(resolve("![[#Beta#Child]]").status).toBe("unresolved");
  });

  it("heading matching ignores link-special characters (Obsidian writes '#Alpha Notes' for 'Alpha: Notes')", () => {
    expect(normalizeMirrorHeading("Alpha: Notes")).toBe("Alpha Notes");
    const r = resolve("![[#Alpha Notes]]");
    expect(r.status === "resolved" && r.source.lineRange.startLine).toBe(18);
  });

  it("an inline block id resolves to its paragraph", () => {
    const r = resolve("![[#^a1]]");
    expect(r.status === "resolved" && r.source.lineRange).toEqual({ startLine: 3, endLine: 3 });
  });

  it("a block id on a list item resolves to the item with its children", () => {
    const r = resolve("![[#^li1]]");
    expect(r.status === "resolved" && r.source.lineRange).toEqual({ startLine: 9, endLine: 10 });
  });

  it("a standalone ^id line labels the block before it (a table)", () => {
    const r = resolve("![[#^tbl]]");
    expect(r.status === "resolved" && r.source.lineRange).toEqual({ startLine: 12, endLine: 16 });
  });

  it("a missing heading or block id is unresolved (not-found)", () => {
    expect(resolve("![[#Gamma]]")).toMatchObject({ status: "unresolved", reason: "not-found" });
    expect(resolve("![[#^nope]]")).toMatchObject({ status: "unresolved", reason: "not-found" });
  });

  it("a block id inside a fenced code block is not a target", () => {
    const t = J("```", "code ^inside", "```");
    const d = parseDocument(t);
    const r = resolveMirrorSource(d, scanComplexBlocks(d).blocks, parseMirrorEmbed("![[#^inside]]", NOTE)!);
    expect(r.status).toBe("unresolved");
  });

  it("mirrorTargetLabel shows the heading path or ^id", () => {
    expect(mirrorTargetLabel(parseMirrorEmbed("![[#A#B]]", NOTE)!)).toBe("A › B");
    expect(mirrorTargetLabel(parseMirrorEmbed("![[#^x1]]", NOTE)!)).toBe("^x1");
  });
});

// ---------------------------------------------------------------------------
describe("scanMirrorEmbeds", () => {
  const text = J(
    "# Doc", // 0
    "", // 1
    "## A", // 2
    "a text", // 3
    "", // 4
    "## B", // 5
    "![[#A]]", // 6  resolved
    "", // 7
    "![[#B]]", // 8  inside B -> cycle
    "", // 9
    "![[#Missing]]", // 10 unresolved
    "", // 11
    "- ![[#A]]", // 12 list item text, not a standalone paragraph
    "  ![[#A]]", // 13 list-owned paragraph -> excluded
    "", // 14
    "![[Other#A]]" // 15 other note -> excluded
  );
  const doc = parseDocument(text);
  const blocks = scanComplexBlocks(doc).blocks;
  const projections = scanMirrorEmbeds(doc, blocks, NOTE);

  it("recognizes only standalone, same-note, single-line embed paragraphs", () => {
    expect(projections.map((p) => p.node.embedLine)).toEqual([6, 8, 10]);
  });

  it("assigns ordinal ids in document order", () => {
    expect(projections.map((p) => p.node.id)).toEqual(["mirror-1", "mirror-2", "mirror-3"]);
  });

  it("reports resolved / cycle / unresolved per embed", () => {
    expect(projections.map((p) => p.resolution.status)).toEqual(["resolved", "cycle", "unresolved"]);
  });

  it("an embed of the section that contains it is circular", () => {
    const cyc = projections[1].resolution;
    expect(cyc.status === "cycle" && cyc.cycle).toEqual(["mirror-2"]);
  });

  it("scanning never changes the parsed document or complex-block scan", () => {
    expect(scanComplexBlocks(parseDocument(text)).blocks).toEqual(blocks);
  });
});

// ---------------------------------------------------------------------------
describe("Outline Tree projection (read-only, off by default)", () => {
  const text = J("# Doc", "", "## A", "a text", "", "## B", "intro", "", "![[#A]]", "", "![[#^zz]]");
  const doc = parseDocument(text);
  const blocks = scanComplexBlocks(doc).blocks;
  const mirrorRows = (tree: ReturnType<typeof buildOutlineTree>) =>
    flattenOutlineTree(tree).filter(isOutlineMirrorNode) as OutlineTreeMirrorNode[];

  it("the setting defaults to off, and an older data.json without it merges to off", () => {
    expect(DEFAULT_SETTINGS.showMirrorEmbedsInOutline).toBe(false);
    expect(mergeSettings({}).showMirrorEmbedsInOutline).toBe(false);
  });

  it("without the mirrors option, the tree is byte-identical to before (embed lines stay paragraphs)", () => {
    const plain = buildOutlineTree(doc, { includeLists: true, paragraphs: { blocks } });
    expect(mirrorRows(plain)).toHaveLength(0);
    const paragraphs = flattenOutlineTree(plain).filter((n) => n.kind === "paragraph");
    expect(paragraphs.map((n) => n.line)).toEqual([3, 6, 8, 10]);
  });

  it("with the option, each embed becomes one 'Mirror:' row under its section, in document order", () => {
    const tree = buildOutlineTree(doc, { includeLists: true, mirrors: { blocks, notePath: NOTE } });
    const rows = mirrorRows(tree);
    expect(rows.map((r) => [r.label, r.line, r.status, r.targetLine])).toEqual([
      ["Mirror: A", 8, "resolved", 2],
      ["Mirror: ^zz (not found)", 10, "unresolved", null],
    ]);
    const sectionB = flattenOutlineTree(tree).find((n) => n.kind === "section" && n.line === 5)!;
    expect(sectionB.children.map((c) => c.kind)).toEqual(["mirror", "mirror"]);
  });

  it("an embed line shown as a mirror row is not ALSO listed as a paragraph row", () => {
    const tree = buildOutlineTree(doc, { includeLists: true, paragraphs: { blocks }, mirrors: { blocks, notePath: NOTE } });
    const flat = flattenOutlineTree(tree);
    expect(flat.filter((n) => n.kind === "paragraph").map((n) => n.line)).toEqual([3, 6]);
    expect(flat.filter((n) => n.kind === "mirror").map((n) => n.line)).toEqual([8, 10]);
  });

  it("paragraph row ids are unchanged by toggling mirrors (ordinals computed over all paragraphs)", () => {
    const withoutMirrors = flattenOutlineTree(buildOutlineTree(doc, { paragraphs: { blocks } }));
    const withMirrors = flattenOutlineTree(buildOutlineTree(doc, { paragraphs: { blocks }, mirrors: { blocks, notePath: NOTE } }));
    const id = (list: typeof withMirrors, line: number) => list.find((n) => n.kind === "paragraph" && n.line === line)?.id;
    expect(id(withMirrors, 6)).toBe(id(withoutMirrors, 6));
  });

  it("mirror rows are read-only (collectReadOnlyOutlineNodeIds) and never get a fold identity", () => {
    const tree = buildOutlineTree(doc, { includeLists: true, mirrors: { blocks, notePath: NOTE } });
    const readOnly = collectReadOnlyOutlineNodeIds(tree);
    const ids = buildNodeIdentityMap(tree);
    for (const row of mirrorRows(tree)) {
      expect(readOnly.has(row.id)).toBe(true);
      expect(ids.has(row.id)).toBe(false);
    }
    // and existing section identities are the same with or without mirrors
    const plainIds = buildNodeIdentityMap(buildOutlineTree(doc, { includeLists: true }));
    for (const [id, identity] of plainIds) expect(ids.get(id)).toBe(identity);
  });

  it("a cursor on the embed line highlights the mirror row", () => {
    const tree = buildOutlineTree(doc, { includeLists: true, mirrors: { blocks, notePath: NOTE } });
    const nodeById = new Map(flattenOutlineTree(tree).map((n) => [n.id, n]));
    const id = resolveCurrentPositionNodeId(doc, 8, scanComplexBlocks(doc), nodeById, { includeLists: true });
    expect(id).toBe(mirrorRows(tree)[0].id);
  });

  it("labels are localized; the Japanese suffixes differ from English", () => {
    const ja = createTranslator("ja");
    const tree = buildOutlineTree(doc, { mirrors: { blocks, notePath: NOTE }, t: ja });
    expect(mirrorRows(tree)[1].label).toBe("Mirror: ^zz（参照先なし）");
  });
});

// ---------------------------------------------------------------------------
describe("view wiring (static source checks)", () => {
  const viewTs = readFileSync(path.resolve(__dirname, "../src/view/OutlineTreeView.ts"), "utf-8");
  const settingsTs = readFileSync(path.resolve(__dirname, "../src/settings.ts"), "utf-8");
  const mainTs = readFileSync(path.resolve(__dirname, "../src/main.ts"), "utf-8");

  it("refresh() passes the mirrors option only when the setting is on", () => {
    expect(viewTs).toContain("mirrors: this.plugin.settings.showMirrorEmbedsInOutline");
  });

  it("click and Enter jump to the referenced block via mirrorJumpLine", () => {
    expect(viewTs).toContain("this.jumpToLine(node.id, mirrorJumpLine(node), { focusEditor: false });");
    expect(viewTs).toContain("this.jumpToLine(node.id, mirrorJumpLine(node));");
  });

  it("no context-menu / drag / rename / Partial Edit branch is attached to a mirror row", () => {
    expect(viewTs).not.toMatch(/isOutlineMirrorNode\(node\)\)\s*\{\s*selfEl\.addEventListener\("contextmenu"/);
    expect(viewTs).not.toMatch(/kind === "mirror"[^\n]*(dragstart|contextmenu|beginRename|activatePartialEditView)/);
  });

  it("the settings tab exposes the toggle", () => {
    expect(settingsTs).toContain('this.plugin.t("settings.showMirrorEmbedsInOutline.name")');
  });

  it("mirror projection shares no state with the Phase 5E-Copy copy-pending field", () => {
    const mirrorSrc = ["mirrorTypes.ts", "parseMirrorEmbed.ts", "detectMirrorCycle.ts", "scanMirrorEmbeds.ts"]
      .map((f) => readFileSync(path.resolve(__dirname, "../src/mirror", f), "utf-8"))
      .join("\n");
    expect(mirrorSrc).not.toMatch(/\.pendingBlockCopy|from "\.\.\/edit\/copyBlock"|from "\.\.\/main"/);
    expect(mainTs).not.toMatch(/pendingBlockCopy[^\n]*mirror/i);
  });
});
