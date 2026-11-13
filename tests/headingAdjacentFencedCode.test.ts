/**
 * fix/heading-adjacent-fenced-code (2026-11-07): a fenced code block
 * (including Mermaid) placed DIRECTLY under a heading, with no blank line
 * between, must stay an independent unit inside its section — recognized,
 * projected, resolved from the cursor, and partially edited on its own —
 * while the section keeps containing it.
 *
 * Investigation result recorded here so the tests document it: the parser
 * and scanner were already correct (A); the Outline Tree row only exists
 * when showFencedCodeInOutline is on (B); the body-editor "Open partial
 * edit pane" command used to refuse every code line with the move-specific
 * "code-block" reason, so a cursor inside the fence could never reach the
 * fenced-code Partial Edit — fixed via resolvePartialEditTargetAtCursor (C).
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { scanComplexBlocks } from "../src/parser/complexBlocks";
import { ComplexBlockInfo } from "../src/model/complexBlock";
import { createTranslator } from "../src/i18n";
import {
  buildOutlineTree,
  flattenOutlineTree,
  isOutlineComplexMemberNode,
  isOutlineSectionNode,
  OutlineTreeNode,
} from "../src/tree/buildOutlineTree";
import { resolvePartialEditTargetAtCursor } from "../src/resolver/resolvePartialEditTargetAtCursor";
import { resolveCurrentBlock } from "../src/resolver/resolveCurrentBlock";
import { resolveMoveUnit } from "../src/move/resolveMoveTarget";
import { applySubtreeEdit, extractSubtreeText } from "../src/edit/partialEdit";

const BT = "```";

/** The ticket's minimum reproduction (L1..L11 → 0-based 0..10). */
const REPRO = [
  "### 構造図解（Mermaid連携）",
  BT + "mermaid",
  "graph TD",
  "  A[行政] -->|管理・許可| B[村]",
  "  B -.->|対立| C[利用者]",
  BT,
  "![[nakano_magusaba_riot.png]]",
  "---",
  "",
  "### 次のセクション",
  "次のセクションの本文",
];

function fencedBlocks(text: string): { doc: ReturnType<typeof parseDocument>; fenced: ComplexBlockInfo[] } {
  const doc = parseDocument(text);
  return { doc, fenced: scanComplexBlocks(doc).blocks.filter((b) => b.kind === "fenced-code") };
}

function tree(text: string, includeFencedCode: boolean, includeLists = false) {
  const doc = parseDocument(text);
  const scan = scanComplexBlocks(doc);
  return buildOutlineTree(doc, {
    includeLists,
    standaloneComplexBlocks: { blocks: scan.blocks, includeFencedCode, includeTables: false },
    t: createTranslator("ja"),
  });
}

function fencedRows(nodes: OutlineTreeNode[]) {
  return flattenOutlineTree(nodes).filter(
    (n) => isOutlineComplexMemberNode(n) && n.complexKind === "fenced-code"
  );
}

describe("A. 構文と範囲 (parser / scanner)", () => {
  it("見出し直後・空行なしの Mermaid fence は L2〜L6 の1ブロック、section は L10 直前まで", () => {
    const { doc, fenced } = fencedBlocks(REPRO.join("\n"));
    expect(fenced).toHaveLength(1);
    expect(fenced[0].range).toEqual({ startLine: 1, endLine: 5 });
    expect(fenced[0].infoString).toBe("mermaid");
    expect(fenced[0].editability).toBe("supported");
    expect(fenced[0].parentId).toBe(doc.lineToOwningNodeId[0]);
    const section = doc.nodes.get(doc.lineToOwningNodeId[0]!)!;
    expect(section.type).toBe("section");
    expect(section.range).toEqual({ startLine: 0, endLine: 8 });
    // L7 (image) / L8 (---) are outside the code, L10+ are another section.
    expect(doc.codeBlockLines[6]).toBe(false);
    expect(doc.codeBlockLines[7]).toBe(false);
    expect(doc.lineToOwningNodeId[9]).not.toBe(section.id);
  });

  it("見出しと fence の間に空行があっても同じ範囲判定", () => {
    const text = ["### H", "", BT + "mermaid", "graph TD", BT, "after"].join("\n");
    const { fenced } = fencedBlocks(text);
    expect(fenced.map((b) => b.range)).toEqual([{ startLine: 2, endLine: 4 }]);
  });

  it.each([
    ["ts", BT + "ts", BT],
    ["言語指定なし", BT, BT],
    ["チルダ", "~~~python", "~~~"],
  ])("Mermaid 以外 (%s) も共通経路で認識される", (_label, open, close) => {
    const text = ["## H", open, "x = 1", close, "本文"].join("\n");
    const { fenced } = fencedBlocks(text);
    expect(fenced).toHaveLength(1);
    expect(fenced[0].range).toEqual({ startLine: 1, endLine: 3 });
    expect(fenced[0].editability).toBe("supported");
  });

  it("コード内部の空行・見出し風の行・--- を外部ブロックとして扱わない", () => {
    const text = ["## H", BT + "mermaid", "graph TD", "", "## not a heading", "---", "> not a quote", BT, "## Next"].join("\n");
    const doc = parseDocument(text);
    const scan = scanComplexBlocks(doc);
    const fenced = scan.blocks.filter((b) => b.kind === "fenced-code");
    expect(fenced.map((b) => b.range)).toEqual([{ startLine: 1, endLine: 7 }]);
    // No other block overlaps the fence's lines.
    const others = scan.blocks.filter((b) => b.kind !== "fenced-code");
    for (const b of others) expect(b.range.endLine < 1 || b.range.startLine > 7).toBe(true);
    // Only the two real headings are sections.
    expect([...doc.nodes.values()].filter((n) => n.type === "section").map((n) => n.range.startLine)).toEqual([0, 8]);
  });

  it("閉じフェンス直後の画像・本文をコードに取り込まない", () => {
    const text = ["### H", BT + "mermaid", "graph TD", BT, "![[img.png]]", "本文"].join("\n");
    const { fenced } = fencedBlocks(text);
    expect(fenced[0].range.endLine).toBe(3);
  });

  it("次の同レベル／上位見出しで section 境界が切れる", () => {
    for (const next of ["### Same", "## Upper", "# Top"]) {
      const text = ["### H", BT + "js", "a", BT, next, "b"].join("\n");
      const doc = parseDocument(text);
      expect(doc.nodes.get(doc.lineToOwningNodeId[0]!)!.range).toEqual({ startLine: 0, endLine: 3 });
    }
  });

  it("未閉鎖 fence は ambiguous のまま (既存の安全側動作)", () => {
    const text = ["### H", BT + "mermaid", "graph TD", "### looks like heading"].join("\n");
    const { fenced } = fencedBlocks(text);
    expect(fenced).toHaveLength(1);
    expect(fenced[0].editability).toBe("ambiguous");
  });

  it("表示用の解析・投影だけでは原文が変化しない", () => {
    const text = REPRO.join("\n");
    const doc = parseDocument(text);
    tree(text, true);
    tree(text, false);
    expect(doc.lines.join("\n")).toBe(text);
  });
});

describe("B. Outline Tree 投影と設定", () => {
  it("showFencedCodeInOutline 相当 (includeFencedCode) が on なら正しい section 配下に一度だけ現れる", () => {
    const nodes = tree(REPRO.join("\n"), true);
    const rows = fencedRows(nodes);
    expect(rows).toHaveLength(1);
    const first = nodes[0];
    if (!isOutlineSectionNode(first)) throw new Error("expected section");
    expect(first.children.filter((c) => isOutlineComplexMemberNode(c))).toHaveLength(1);
    const second = nodes[1];
    if (!isOutlineSectionNode(second)) throw new Error("expected section");
    expect(fencedRows(second.children)).toHaveLength(0);
  });

  it("off のときは行が出ないが、スキャナは認識している (非表示と認識失敗の区別)", () => {
    const text = REPRO.join("\n");
    expect(fencedRows(tree(text, false))).toHaveLength(0);
    expect(fencedBlocks(text).fenced[0].editability).toBe("supported");
  });

  it("list 配下の fenced-code は list item の親子関係を壊さない", () => {
    const text = ["## H", "- item", "  " + BT + "js", "  code", "  " + BT, "- next"].join("\n");
    const doc = parseDocument(text);
    const fenced = scanComplexBlocks(doc).blocks.find((b) => b.kind === "fenced-code")!;
    const owner = doc.nodes.get(fenced.parentId!)!;
    expect(owner.type).toBe("list");
    expect(owner.range.startLine).toBe(1);
    // The list item still spans its fence.
    expect(owner.range.endLine).toBeGreaterThanOrEqual(4);
  });
});

describe("C. カーソルからの部分編集対象解決 (resolvePartialEditTargetAtCursor)", () => {
  const doc = parseDocument(REPRO.join("\n"));

  it.each([1, 2, 3, 4, 5])("コード行 L%i → コード単体 (section へフォールバックしない)", (line) => {
    const r = resolvePartialEditTargetAtCursor(doc, line);
    expect(r.target?.kind).toBe("fenced-code");
    if (r.target?.kind === "fenced-code") {
      expect(r.target.range).toEqual({ startLine: 1, endLine: 5 });
      expect(r.target.infoString).toBe("mermaid");
      // The id resolves through the same Partial Edit extractor the Tree row uses.
      const ex = extractSubtreeText(doc, r.target.nodeId);
      expect(ex.ok).toBe(true);
      expect(ex.kind).toBe("fenced-code");
      expect(ex.startLine).toBe(1);
      expect(ex.endLine).toBe(5);
    }
  });

  it.each([0, 6, 7, 8])("見出し・画像・区切り・空行 L%i → section 全体 (既存契約)", (line) => {
    const r = resolvePartialEditTargetAtCursor(doc, line);
    expect(r.target).toEqual({ kind: "section", nodeId: doc.lineToOwningNodeId[0] });
    const ex = extractSubtreeText(doc, r.target!.nodeId);
    expect(ex.kind).toBe("section");
    expect([ex.startLine, ex.endLine]).toEqual([0, 8]);
  });

  it("未閉鎖 fence 内は code-block-unresolved で拒否し、section を返さない", () => {
    const d = parseDocument(["### H", BT + "mermaid", "graph TD"].join("\n"));
    expect(resolvePartialEditTargetAtCursor(d, 2)).toEqual({ target: null, reason: "code-block-unresolved" });
  });

  it("list 行は従来どおり not-a-heading、list 配下の fence 内はコード単体", () => {
    const d = parseDocument(["## H", "- item", "  " + BT + "js", "  code", "  " + BT].join("\n"));
    expect(resolvePartialEditTargetAtCursor(d, 1).reason).toBe("not-a-heading");
    expect(resolvePartialEditTargetAtCursor(d, 3).target?.kind).toBe("fenced-code");
  });

  it("範囲外は out-of-range", () => {
    expect(resolvePartialEditTargetAtCursor(doc, 99).reason).toBe("out-of-range");
  });

  it("他コマンド用の resolveCurrentBlock / resolveMoveUnit の意味は変わらない", () => {
    expect(resolveCurrentBlock(doc, 3).reason).toBe("code-block");
    expect(resolveMoveUnit(doc, 3).unit?.kind).toBe("fenced-code");
    expect(resolveMoveUnit(doc, 3).unit?.range).toEqual({ startLine: 1, endLine: 5 });
    expect(resolveMoveUnit(doc, 0).unit?.kind).toBe("section");
    expect(resolveMoveUnit(doc, 0).unit?.range).toEqual({ startLine: 0, endLine: 8 });
  });
});

describe("D. 書き戻し (Apply)", () => {
  const text = REPRO.join("\n");

  function fencedId(d: ReturnType<typeof parseDocument>) {
    const r = resolvePartialEditTargetAtCursor(d, 2);
    if (r.target?.kind !== "fenced-code") throw new Error("expected fenced-code");
    return r.target.nodeId;
  }

  it("コード単体の Apply はコード範囲だけを書き換え、見出し・画像・区切り・次 section を保持する", () => {
    const doc = parseDocument(text);
    const id = fencedId(doc);
    const original = extractSubtreeText(doc, id);
    const outcome = applySubtreeEdit(doc, id, original.text, "graph LR\n  A --> B");
    expect(outcome.changed).toBe(true);
    // Phase 5E-3M §1-1: the original "```mermaid" opening line is kept
    // verbatim (the earlier "``` mermaid" normalization was approved away).
    expect(outcome.lines).toEqual([
      REPRO[0],
      BT + "mermaid",
      "graph LR",
      "  A --> B",
      BT,
      ...REPRO.slice(6),
    ]);
  });

  it("未変更テキストでの Apply は原文を一字も変えない (Phase 5E-3M §1-1 で開始行も保持)", () => {
    const doc = parseDocument(text);
    const id = fencedId(doc);
    const original = extractSubtreeText(doc, id);
    const outcome = applySubtreeEdit(doc, id, original.text, original.text);
    expect(outcome.lines).toEqual(REPRO);
  });

  it("スペースありの開始行なら未変更 Apply は完全に原文どおり", () => {
    const spaced = [...REPRO];
    spaced[1] = BT + " mermaid";
    const doc = parseDocument(spaced.join("\n"));
    const id = fencedId(doc);
    const original = extractSubtreeText(doc, id);
    expect(applySubtreeEdit(doc, id, original.text, original.text).lines).toEqual(spaced);
  });

  it("開いた後にコードが外部で変わっていたら conflict で拒否し、何も書かない", () => {
    const doc = parseDocument(text);
    const id = fencedId(doc);
    const original = extractSubtreeText(doc, id);
    const changed = [...REPRO];
    changed[2] = "graph BT";
    const doc2 = parseDocument(changed.join("\n"));
    const outcome = applySubtreeEdit(doc2, id, original.text, "edited");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("conflict");
    expect(outcome.lines).toEqual(changed);
  });

  it("対象のコードが消えていたら resolve-failed で拒否し、別範囲へ書き込まない", () => {
    const doc = parseDocument(text);
    const id = fencedId(doc);
    const original = extractSubtreeText(doc, id);
    const removed = [REPRO[0], ...REPRO.slice(6)];
    const doc2 = parseDocument(removed.join("\n"));
    const outcome = applySubtreeEdit(doc2, id, original.text, "edited");
    expect(outcome.changed).toBe(false);
    expect(outcome.lines).toEqual(removed);
  });

  it("section 全体の Apply は引き続き section 全体 (L1〜L9) を対象にする", () => {
    const doc = parseDocument(text);
    const sectionId = doc.lineToOwningNodeId[0]!;
    const original = extractSubtreeText(doc, sectionId);
    expect(original.text).toBe(REPRO.slice(0, 9).join("\n"));
    const outcome = applySubtreeEdit(doc, sectionId, original.text, original.text.replace("graph TD", "graph LR"));
    expect(outcome.changed).toBe(true);
    expect(outcome.lines.slice(9)).toEqual(REPRO.slice(9));
    expect(outcome.lines[2]).toBe("graph LR");
  });
});
