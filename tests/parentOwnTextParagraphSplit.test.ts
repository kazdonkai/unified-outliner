/**
 * 1.0.8 follow-up: List + Paragraph member split for a PARENT list item
 * (a list item with a child paragraph AND a child list — never a
 * List + Paragraph composite, see parser/compositeBlocks.ts condition 4).
 *
 * Real parseDocument-backed checks of the whole pure pipeline the pane
 * runs: eligibility gate → buildParentListItemProjection →
 * resolveParentOwnTextParagraphSplit → (two boxes) →
 * joinParentOwnTextParagraphSplit → invertParentListItemProjection →
 * applyParentListItemOwnTextEdit (ONE write for both boxes).
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { isListNode, ListBlockNode, ParsedDocument } from "../src/model/block";
import {
  applyParentListItemOwnTextEdit,
  buildParentListItemProjection,
  invertParentListItemProjection,
  ParentListItemProjection,
  projectedParentBodyText,
} from "../src/edit/parentListItemProjection";
import { isStandaloneParentListItemEligibleForProjection } from "../src/edit/standaloneParentListItemProjection";
import {
  joinParentOwnTextParagraphSplit,
  resolveParentOwnTextParagraphSplit,
} from "../src/edit/parentOwnTextParagraphSplit";
import { scanComplexBlocks } from "../src/parser/complexBlocks";
import { matchCompositeBlocks } from "../src/parser/compositeBlocks";
import { BUILTIN_COMPOSITE_BLOCK_RULES } from "../src/model/compositeBlock";

function listNodeAt(d: ParsedDocument, line: number): ListBlockNode {
  for (const n of d.nodes.values()) {
    if (isListNode(n) && n.range.startLine === line) return n;
  }
  throw new Error(`fixture error: no list item starts at line ${line}`);
}

function load(text: string, line: number) {
  const d = parseDocument(text);
  const n = listNodeAt(d, line);
  expect(isStandaloneParentListItemEligibleForProjection(d, n)).toBe(true);
  const built = buildParentListItemProjection(d, n);
  if (!built.ok) throw new Error(`projection refused: ${built.reason}`);
  return { d, n, projection: built.projection, split: resolveParentOwnTextParagraphSplit(d, built.projection) };
}

/** Apply exactly as the pane does: one invert + one own-text write for both boxes. */
function apply(
  d: ParsedDocument,
  projection: ParentListItemProjection,
  listBox: string,
  paragraphBox: string
): { ok: true; text: string } | { ok: false; reason: string } {
  const inverted = invertParentListItemProjection(projection, false, "", joinParentOwnTextParagraphSplit(listBox, paragraphBox));
  if (!inverted.ok) return { ok: false, reason: inverted.reason };
  const out = applyParentListItemOwnTextEdit(d, projection.nodeId, projection.ownText.rawText, inverted.ownTextRawText);
  if (!out.changed) return { ok: false, reason: out.reason ?? "unchanged" };
  return { ok: true, text: out.lines.join("\n") };
}

const BASIC = [
  "## 見出し",
  "- 主張A：甲は乙の土地を主張した。",
  "  [code:: 近世の主張][対象:: [[place/甲村]]] 典拠 [[#^ocr-p01|OCR-p.1]] ![[図1.png]] ^clause-001",
  "  - 子項目1",
  "  - 子項目2",
  "",
  "- 主張B",
].join("\n");

describe("resolveParentOwnTextParagraphSplit: the shape it splits", () => {
  it("1. a parent item = marker line + one child paragraph → two boxes (list line / paragraph), never a composite", () => {
    const { d, split } = load(BASIC, 1);
    // never a List + Paragraph composite (it has a child list)
    const composites = matchCompositeBlocks(d, scanComplexBlocks(d), BUILTIN_COMPOSITE_BLOCK_RULES);
    expect(composites.some((c) => c.range.startLine === 1)).toBe(false);
    expect(split).toEqual({
      listBody: "主張A：甲は乙の土地を主張した。",
      paragraphBody: "[code:: 近世の主張][対象:: [[place/甲村]]] 典拠 [[#^ocr-p01|OCR-p.1]] ![[図1.png]] ^clause-001",
    });
  });

  it("2. joining the unedited boxes gives back the projection's own-text body, and Apply of it writes nothing different", () => {
    const { d, projection, split } = load(BASIC, 1);
    expect(joinParentOwnTextParagraphSplit(split!.listBody, split!.paragraphBody)).toBe(projectedParentBodyText(projection));
    const inverted = invertParentListItemProjection(projection, false, "", projectedParentBodyText(projection));
    expect(inverted.ok && inverted.ownTextRawText).toBe(projection.ownText.rawText);
    void d;
  });

  it("multi-line paragraph, deeper indentation (nested parent item) and the lone-id-line shape split on the parsed paragraph range", () => {
    const text = [
      "- 祖先",
      "    - 主張C",
      "      一行目の本文。",
      "      二行目の本文。",
      "      ^clause-003",
      "        - 孫項目",
      "- 後続",
    ].join("\n");
    const { split } = load(text, 1);
    expect(split).toEqual({ listBody: "主張C", paragraphBody: "一行目の本文。\n二行目の本文。\n^clause-003" });
  });
});

describe("Apply: both boxes saved together through the existing parent own-text path", () => {
  it("3. list box only edited: the paragraph line, the children and the following blocks are byte-identical", () => {
    const { d, projection, split } = load(BASIC, 1);
    const r = apply(d, projection, "主張A（改）", split!.paragraphBody);
    expect(r).toEqual({ ok: true, text: BASIC.replace("- 主張A：甲は乙の土地を主張した。", "- 主張A（改）") });
  });

  it("4. paragraph box only edited (multi-line, Japanese, links, embed, inline property, block id kept at its end): the marker line is untouched", () => {
    const { d, projection, split } = load(BASIC, 1);
    const edited = "[code:: 近世の主張][対象:: [[place/甲村]]] 典拠 [[#^ocr-p01|OCR-p.1]]\n追記：![[図2.png]] [[note|別名]] ^clause-001";
    const r = apply(d, projection, split!.listBody, edited);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const lines = r.text.split("\n");
    expect(lines[1]).toBe("- 主張A：甲は乙の土地を主張した。");
    expect(lines[2]).toBe("  [code:: 近世の主張][対象:: [[place/甲村]]] 典拠 [[#^ocr-p01|OCR-p.1]]");
    expect(lines[3]).toBe("  追記：![[図2.png]] [[note|別名]] ^clause-001");
    expect(lines.slice(4)).toEqual(["  - 子項目1", "  - 子項目2", "", "- 主張B"]);
    // the id is still the paragraph's own (last line), never moved onto the list line
    const after = parseDocument(r.text);
    const para = scanComplexBlocks(after).blocks.find((b) => b.kind === "paragraph" && b.range.startLine === 2);
    expect(para?.range.endLine).toBe(3);
    expect(lines[1]).not.toContain("^clause-001");
  });

  it("5. both boxes edited → ONE own-text write containing both changes; reopening splits again with the new values", () => {
    const { d, projection } = load(BASIC, 1);
    const r = apply(d, projection, "主張A2", "新しい段落本文。 ^clause-001");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text.split("\n").slice(0, 3)).toEqual(["## 見出し", "- 主張A2", "  新しい段落本文。 ^clause-001"]);
    const again = load(r.text, 1);
    expect(again.split).toEqual({ listBody: "主張A2", paragraphBody: "新しい段落本文。 ^clause-001" });
  });

  it("7. an external change to the own text since load is refused as a conflict (nothing written; the boxes keep the draft)", () => {
    const { projection } = load(BASIC, 1);
    const external = parseDocument(BASIC.replace("甲は乙", "甲は丙"));
    const inverted = invertParentListItemProjection(projection, false, "", joinParentOwnTextParagraphSplit("主張A（改）", "x ^clause-001"));
    expect(inverted.ok).toBe(true);
    if (!inverted.ok) return;
    const out = applyParentListItemOwnTextEdit(external, projection.nodeId, projection.ownText.rawText, inverted.ownTextRawText);
    expect(out.changed).toBe(false);
    expect(out.reason).toBe("parent-own-text-conflict");
    expect(out.lines).toBe(external.lines);
  });

  it("a line break in the list box can never spill into the paragraph (it becomes a space)", () => {
    expect(joinParentOwnTextParagraphSplit("a\nb", "p")).toBe("a b\np");
  });
});

describe("10. edge edits follow the existing single-box contract exactly (same joined text → same result)", () => {
  it("an emptied paragraph box is the same as deleting every paragraph line in the single box", () => {
    expect(joinParentOwnTextParagraphSplit("主張A", "")).toBe("主張A");
    const { d, projection } = load(BASIC, 1);
    const r = apply(d, projection, "主張A：甲は乙の土地を主張した。", "");
    // existing contract: the paragraph lines (its block id included) are removed, as in the single box
    expect(r).toEqual({ ok: true, text: BASIC.split("\n").filter((_, i) => i !== 2).join("\n") });
  });

  it("a blank line or a heading typed into the paragraph box gets the same verdict as in the single box", () => {
    const { d, projection, split } = load(BASIC, 1);
    for (const para of ["一段落目\n\n二段落目 ^clause-001", "# 見出し化 ^clause-001"]) {
      const viaSplit = apply(d, projection, split!.listBody, para);
      const single = invertParentListItemProjection(projection, false, "", `${split!.listBody}\n${para}`);
      expect(viaSplit.ok).toBe(single.ok);
      if (!single.ok && !viaSplit.ok) expect(viaSplit.reason).toBe(single.reason);
    }
  });
});

describe("12. shapes that keep the existing single own-text box (no split)", () => {
  const cases: [string, string, number][] = [
    ["task item", ["- [ ] 課題", "  段落 ^a", "  - 子"].join("\n"), 0],
    ["ordered item", ["1. 順序", "   段落 ^a", "   - 子"].join("\n"), 0],
    ["marker line only (no paragraph)", ["- 親", "  - 子"].join("\n"), 0],
    ["blank line inside the own text", ["- 親", "  段落1", "", "  段落2", "  - 子"].join("\n"), 0],
  ];
  for (const [name, text, line] of cases) {
    it(name, () => {
      const d = parseDocument(text);
      const n = listNodeAt(d, line);
      // still the ordinary parent own-text editor (one box), exactly as before
      expect(isStandaloneParentListItemEligibleForProjection(d, n)).toBe(true);
      const built = buildParentListItemProjection(d, n);
      if (!built.ok) throw new Error(built.reason);
      expect(resolveParentOwnTextParagraphSplit(d, built.projection)).toBeNull();
    });
  }

  it("13. a List + Paragraph composite (no child list) is not a parent item, so this split never applies to it", () => {
    const d = parseDocument(["- 史料", "  段落 ^a"].join("\n"));
    const composites = matchCompositeBlocks(d, scanComplexBlocks(d), BUILTIN_COMPOSITE_BLOCK_RULES);
    expect(composites.map((c) => c.ruleId)).toEqual(["list-paragraph"]);
    expect(buildParentListItemProjection(d, listNodeAt(d, 0)).ok).toBe(false);
  });
});
