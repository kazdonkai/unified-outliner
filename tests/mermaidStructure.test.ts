/**
 * Phase 5E-3M: edit/mermaidStructure.ts + edit/mermaidDiagramTypes.ts —
 * parse / serialize invariants, failure reasons, declaration-only edits and
 * template rules (design memo §2–§4).
 */
import { describe, expect, it } from "vitest";
import {
  applyMermaidTemplateIfBlank,
  buildMermaidTemplateText,
  getMermaidFlowchartDirection,
  getMermaidRawSuffixText,
  MermaidStructure,
  parseMermaidStructure,
  serializeMermaidStructure,
  setMermaidDiagramType,
  setMermaidFlowchartDirection,
  setMermaidRawSuffixText,
} from "../src/edit/mermaidStructure";
import { MERMAID_DIAGRAM_TYPES } from "../src/edit/mermaidDiagramTypes";

const J = (...lines: string[]) => lines.join("\n");

function ok(text: string): { structure: MermaidStructure; diagramTypeId: string } {
  const r = parseMermaidStructure(text);
  if (!r.ok) throw new Error(`expected ok, got ${r.reason} for ${JSON.stringify(text)}`);
  return r;
}

function roundTrip(text: string): string {
  return serializeMermaidStructure(ok(text).structure);
}

describe("1. 分解と組み立て直しで元の文字列に戻る", () => {
  it.each(MERMAID_DIAGRAM_TYPES.flatMap((t) => t.keywords.map((k) => [t.id, k] as const)))(
    "登録表の各図種 %s (%s) と、その雛形",
    (id, keyword) => {
      const text = J(keyword + (id === "flowchart" ? " LR" : ""), "    body line", "");
      expect(roundTrip(text)).toBe(text);
      expect(ok(text).diagramTypeId).toBe(id);
      const template = buildMermaidTemplateText(id)!;
      expect(roundTrip(template)).toBe(template);
      expect(ok(template).diagramTypeId).toBe(id);
    }
  );

  it.each([
    ["graph と flowchart", J("graph TD", "  A --> B")],
    ["flowchart 方向なし", J("flowchart", "  A --> B")],
    ["stateDiagram", J("stateDiagram", "  [*] --> S")],
    ["stateDiagram-v2", J("stateDiagram-v2", "  [*] --> S")],
    ["frontmatter", J("---", "title: X", "config:", "  theme: forest", "---", "flowchart LR", "  A --> B")],
    ["1行ディレクティブ", J("%%{init: {'theme':'dark'}}%%", "sequenceDiagram", "  A->>B: hi")],
    ["複数行ディレクティブ", J("%%{", "  init: {", "    'theme': 'dark'", "  }", "}%%", "mindmap", "  root")],
    ["%% コメント", J("%% comment", "pie showData", '  "A" : 1')],
    ["宣言前の空行", J("", "", "mindmap", "  root")],
    ["宣言行のインデント", J("    gantt", "    title X")],
    ["本文末尾の空行と末尾空白", J("timeline", "  2025 : a   ", "", "  ", "")],
    ["CRLF (parseDocument は \\n で分割し \\r を行末に残す)", "flowchart TD\r\n  A --> B\r\n  B --> C\r"],
    ["CRLF の宣言だけ", "mindmap\r"],
    ["本文なし", "journey"],
    ["pie title", J('pie title Pets', '  "Dogs" : 386')],
    ["gitGraph オプション", J("gitGraph LR:", "  commit")],
  ])("%s", (_label, text) => {
    expect(roundTrip(text)).toBe(text);
  });

  it("前置き・宣言・本文の分割位置", () => {
    const { structure } = ok(J("%% c", "---", "title: T", "---", "", "  flowchart TD", "  A --> B", ""));
    expect(structure.preambleLines).toEqual(["%% c", "---", "title: T", "---", ""]);
    expect(structure.declaration).toEqual({ rawLine: "  flowchart TD", indent: "  ", keyword: "flowchart", suffix: " TD" });
    expect(structure.bodyLines).toEqual(["  A --> B", ""]);
  });
});

describe("2. 失敗の理由", () => {
  it.each([
    ["empty (空)", "", "empty"],
    ["empty (空白だけ)", J("  ", ""), "empty"],
    ["no-declaration (コメントだけ)", J("%% only", "%% comments"), "no-declaration"],
    ["no-declaration (frontmatter だけ)", J("---", "title: x", "---"), "no-declaration"],
    ["unknown-diagram", J("quadrantChart", "  x-axis a"), "unknown-diagram"],
    ["unknown-diagram (xychart-beta)", "xychart-beta", "unknown-diagram"],
    ["unknown-diagram (大文字小文字を区別)", J("Flowchart TD", "A-->B"), "unknown-diagram"],
    ["unknown-diagram (2つ目の ---)", J("---", "a: 1", "---", "---", "flowchart"), "unknown-diagram"],
    ["unsupported-suffix (宣言行に本文)", "graph TD; A-->B", "unsupported-suffix"],
    ["unsupported-suffix (方向でない)", J("flowchart XY", "A"), "unsupported-suffix"],
    ["unsupported-suffix (空だけの図種)", J("mindmap root", "  a"), "unsupported-suffix"],
    ["unclosed-frontmatter", J("---", "title: x", "flowchart TD"), "unclosed-frontmatter"],
    ["unclosed-directive", J("%%{init: {", "'theme':'dark'", "flowchart TD"), "unclosed-directive"],
  ])("%s", (_label, text, reason) => {
    const r = parseMermaidStructure(text);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe(reason);
  });
});

describe("3. 図種を変えると宣言行だけが変わる", () => {
  const text = J("%%{init: {'theme':'dark'}}%%", "---", "title: T", "---", "graph TD", "  A --> B  ", "", "  B --> C");

  it("flowchart(graph) → mindmap: 前置きと本文は一字も変わらない", () => {
    const { structure } = ok(text);
    const next = setMermaidDiagramType(structure, "mindmap");
    const out = serializeMermaidStructure(next).split("\n");
    const orig = text.split("\n");
    expect(out.slice(0, 4)).toEqual(orig.slice(0, 4));
    expect(out[4]).toBe("mindmap");
    expect(out.slice(5)).toEqual(orig.slice(5));
  });

  it("同じ図種を選び直しても graph / stateDiagram の表記は変わらない", () => {
    expect(serializeMermaidStructure(setMermaidDiagramType(ok(text).structure, "flowchart"))).toBe(text);
    const st = J("stateDiagram", "  [*] --> A");
    expect(serializeMermaidStructure(setMermaidDiagramType(ok(st).structure, "state"))).toBe(st);
  });

  it("新しく選んだ図種は先頭のキーワードと既定の suffix で書く", () => {
    const { structure } = ok(J("mindmap", "  root"));
    expect(serializeMermaidStructure(setMermaidDiagramType(structure, "flowchart"))).toBe(J("flowchart TD", "  root"));
    expect(serializeMermaidStructure(setMermaidDiagramType(structure, "state"))).toBe(J("stateDiagram-v2", "  root"));
  });

  it("CRLF の宣言を書き換えても行末の \\r を保つ", () => {
    const { structure } = ok("mindmap\r\n  root\r");
    expect(serializeMermaidStructure(setMermaidDiagramType(structure, "timeline"))).toBe("timeline\r\n  root\r");
  });

  it("未登録の id では何も変えない", () => {
    const { structure } = ok(text);
    expect(setMermaidDiagramType(structure, "nope")).toBe(structure);
  });
});

describe("4. 方向・suffix だけを変える", () => {
  it("方向を変えると suffix だけが変わる", () => {
    const text = J("graph TD", "  A --> B");
    const { structure } = ok(text);
    expect(getMermaidFlowchartDirection(structure)).toBe("TD");
    const lr = setMermaidFlowchartDirection(structure, "LR");
    expect(serializeMermaidStructure(lr)).toBe(J("graph LR", "  A --> B"));
    expect(serializeMermaidStructure(setMermaidFlowchartDirection(structure, ""))).toBe(J("graph", "  A --> B"));
  });

  it("TB は TB のまま、同じ方向の選択では変わらない", () => {
    const { structure } = ok(J("flowchart TB", "A"));
    expect(setMermaidFlowchartDirection(structure, "TB")).toBe(structure);
  });

  it("方向なしから方向ありへ (空白1個を補う)、CRLF を保つ", () => {
    expect(serializeMermaidStructure(setMermaidFlowchartDirection(ok("flowchart\r\nA\r").structure, "RL"))).toBe(
      "flowchart RL\r\nA\r"
    );
  });

  it("方向の概念がない図種では null / 変更なし", () => {
    const { structure } = ok("mindmap");
    expect(getMermaidFlowchartDirection(structure)).toBeNull();
    expect(setMermaidFlowchartDirection(structure, "LR")).toBe(structure);
  });

  it("raw suffix (pie) は原文のまま編集でき、改行は拒否", () => {
    const { structure } = ok(J("pie  showData", '"A" : 1'));
    expect(getMermaidRawSuffixText(structure)).toBe("showData");
    expect(setMermaidRawSuffixText(structure, "showData")).toBe(structure);
    expect(serializeMermaidStructure(setMermaidRawSuffixText(structure, "title Pets")!)).toBe(J("pie  title Pets", '"A" : 1'));
    expect(serializeMermaidStructure(setMermaidRawSuffixText(structure, "")!)).toBe(J("pie", '"A" : 1'));
    expect(setMermaidRawSuffixText(structure, "a\nb")).toBeNull();
  });
});

describe("5. 雛形は本文が空のときだけ", () => {
  it("本文が空 (行なし・空白行だけ) なら雛形が入る", () => {
    for (const text of ["mindmap", J("mindmap", "", "   ")]) {
      const out = applyMermaidTemplateIfBlank(ok(text).structure);
      expect(out.bodyLines).toEqual(MERMAID_DIAGRAM_TYPES.find((t) => t.id === "mindmap")!.template);
    }
  });

  it("本文があれば雛形で上書きしない", () => {
    const { structure } = ok(J("mindmap", "  root"));
    expect(applyMermaidTemplateIfBlank(structure)).toBe(structure);
  });

  it("要求された雛形の大きさ (mindmap: 中心+枝2 / flowchart: ノード2+線1 / sequence: 登場者2+メッセージ1)", () => {
    expect(buildMermaidTemplateText("mindmap")).toBe(J("mindmap", "  root((Center))", "    Branch A", "    Branch B"));
    expect(buildMermaidTemplateText("flowchart")).toBe(J("flowchart TD", "    A[Start] --> B[End]"));
    expect(buildMermaidTemplateText("sequence")).toBe(
      J("sequenceDiagram", "    participant A", "    participant B", "    A->>B: Hello")
    );
    expect(buildMermaidTemplateText("nope")).toBeNull();
  });
});
