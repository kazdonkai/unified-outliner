/**
 * Phase 5E-3M: the Structured/Source session state machine
 * (edit/mermaidStructuredSession.ts) and its wiring into
 * view/PartialEditView.ts, CodeBlockPresetModal and i18n.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  changeMermaidDiagramType,
  changeMermaidFlowchartDirection,
  changeMermaidRawSuffix,
  initMermaidSession,
  isMermaidInfoString,
  isMermaidSessionDirty,
  mermaidBaselineEditorText,
  mermaidDirectionSelectValue,
  mermaidFullText,
  switchMermaidToSource,
  switchMermaidToStructured,
} from "../src/edit/mermaidStructuredSession";
import { MERMAID_DIAGRAM_TYPES } from "../src/edit/mermaidDiagramTypes";
import { buildMermaidTemplateText } from "../src/edit/mermaidStructure";
import { resolveCodeBlockPresetBody } from "../src/edit/codeBlockPresets";
import { createTranslator, TranslationKey } from "../src/i18n";
import { parseDocument } from "../src/parser/parseDocument";
import { scanComplexBlocks } from "../src/parser/complexBlocks";
import { applySubtreeEdit, extractSubtreeText } from "../src/edit/partialEdit";

const J = (...lines: string[]) => lines.join("\n");
const viewTs = readFileSync(path.resolve(__dirname, "../src/view/PartialEditView.ts"), "utf-8");
const modalTs = readFileSync(path.resolve(__dirname, "../src/view/CodeBlockPresetModal.ts"), "utf-8");
const i18nTs = readFileSync(path.resolve(__dirname, "../src/i18n.ts"), "utf-8");

function bodyOf(signature: string): string {
  const start = viewTs.indexOf(signature);
  if (start < 0) throw new Error(`missing ${signature}`);
  const next = viewTs.indexOf("\n  private ", start + signature.length);
  return viewTs.slice(start, next < 0 ? undefined : next);
}

const ORIGINAL = J("%%{init: {'theme':'dark'}}%%", "graph TD", "  A --> B", "  B --> C");

describe("1. 構造化 ⇄ ソースの切り替えで未保存の編集が保たれる", () => {
  it("構造化で本文と方向を変えてからソースへ: 組み立て直した全文が編集欄に入る", () => {
    let { state, editorValue } = initMermaidSession(ORIGINAL);
    expect(state.view).toBe("structured");
    expect(editorValue).toBe(J("  A --> B", "  B --> C"));
    editorValue = J("  A --> B", "  B --> D");
    state = changeMermaidFlowchartDirection(state, "LR");
    const toSource = switchMermaidToSource(state, editorValue);
    expect(toSource.state.view).toBe("source");
    expect(toSource.editorValue).toBe(J("%%{init: {'theme':'dark'}}%%", "graph LR", "  A --> B", "  B --> D"));
  });

  it("ソースで編集してから構造化へ: 分解し直し、未保存の編集は失われない", () => {
    const init = initMermaidSession(ORIGINAL);
    const src = switchMermaidToSource(init.state, init.editorValue);
    const edited = src.editorValue.replace("graph TD", "graph BT") + "\n  C --> A";
    const back = switchMermaidToStructured(src.state, edited);
    expect(back.ok).toBe(true);
    expect(back.state.view).toBe("structured");
    expect(back.editorValue).toBe(J("  A --> B", "  B --> C", "  C --> A"));
    expect(mermaidFullText(back.state, back.editorValue)).toBe(edited);
  });

  it("ソースから構造化へ失敗するとソースのまま、理由を持ち、本文はそのまま", () => {
    const init = initMermaidSession(ORIGINAL);
    const src = switchMermaidToSource(init.state, init.editorValue);
    const broken = J("quadrantChart", "  x-axis a");
    const back = switchMermaidToStructured(src.state, broken);
    expect(back.ok).toBe(false);
    expect(back.state.view).toBe("source");
    expect(back.state.failure).toBe("unknown-diagram");
    expect(back.editorValue).toBe(broken);
  });

  it("分解できないブロックは最初からソース表示 (理由つき)", () => {
    const { state, editorValue } = initMermaidSession("xychart-beta\n  x-axis a");
    expect(state.view).toBe("source");
    expect(state.failure).toBe("unknown-diagram");
    expect(editorValue).toBe("xychart-beta\n  x-axis a");
    expect(mermaidFullText(state, editorValue)).toBe(editorValue);
  });

  it("PartialEditView の切り替えハンドラは状態機械を使い、編集欄の値を受け渡す", () => {
    expect(bodyOf("  private handleMermaidSwitchToSource(): void {")).toContain(
      "switchMermaidToSource(this.mermaidSession, this.textareaEl.value)"
    );
    const toStructured = bodyOf("  private handleMermaidSwitchToStructured(): void {");
    expect(toStructured).toContain("switchMermaidToStructured(this.mermaidSession, this.textareaEl.value)");
    expect(toStructured).toContain('"partialEdit.mermaid.structureFailedNotice"');
  });
});

describe("1b. 構造化／ソースのどちらが選ばれているかを独自スタイルで示す", () => {
  const css = readFileSync(path.resolve(__dirname, "../styles.css"), "utf-8");

  it("2つのボタンは独自クラスのセグメントにまとめ、Table Mode のクラスに依存しない", () => {
    expect(viewTs).toContain('cls: "unified-outliner-partial-edit-mermaid-view-switch"');
    expect(viewTs).not.toMatch(/table-mode-tab[^"]*mermaid-view-button/);
  });

  it("renderMermaidRow は選択中の側に active クラスと aria-pressed を付ける", () => {
    const render = bodyOf("  private renderMermaidRow(): void {");
    expect(render).toContain('this.mermaidStructuredButtonEl.toggleClass("unified-outliner-partial-edit-mermaid-view-button-active", structured);');
    expect(render).toContain('this.mermaidSourceButtonEl.toggleClass("unified-outliner-partial-edit-mermaid-view-button-active", !structured);');
    expect(render).toContain('this.mermaidStructuredButtonEl.setAttr("aria-pressed", structured ? "true" : "false");');
    expect(render).toContain('this.mermaidSourceButtonEl.setAttr("aria-pressed", structured ? "false" : "true");');
  });

  it("active の側は accent で塗り、テーマのボタン規則より強い詳細度で定義する (!important なし)", () => {
    const selector =
      ".unified-outliner-partial-edit-mermaid-row .unified-outliner-partial-edit-mermaid-view-switch .unified-outliner-partial-edit-mermaid-view-button.unified-outliner-partial-edit-mermaid-view-button-active,";
    const i = css.indexOf(selector);
    expect(i).toBeGreaterThan(0);
    const rule = css.slice(i, css.indexOf("}", i));
    expect(rule).toContain("background-color: var(--interactive-accent);");
    expect(rule).toContain("color: var(--text-on-accent);");
    const section = css.slice(css.indexOf("/* Phase 5E-3M view switch")).replace(/\/\*[\s\S]*?\*\//g, "");
    expect(section).not.toContain("!important");
  });
});

describe("2. Cancel で元に戻る", () => {
  it("図種と本文を変えても、読み込み時の状態から作り直せば元の宣言と本文", () => {
    const init = initMermaidSession(ORIGINAL);
    const changed = changeMermaidDiagramType(init.state, J("x"), "mindmap");
    expect(mermaidFullText(changed.state, "x")).toContain("mindmap");
    const restored = initMermaidSession(ORIGINAL);
    expect(mermaidFullText(restored.state, restored.editorValue)).toBe(ORIGINAL);
    expect(mermaidBaselineEditorText(restored.state, ORIGINAL)).toBe(restored.editorValue);
  });

  it("cancelEdit は info string と Mermaid セッションを読み込み時へ戻してから編集欄を戻す", () => {
    const body = bodyOf("  private cancelEdit(): void {");
    const revert = body.indexOf("this.fencedCodeSelectedInfoString = this.fencedCodeMeta.infoString;");
    const session = body.indexOf("this.mermaidSession = this.loadedMermaidSession();");
    const textarea = body.indexOf("this.textareaEl.value = this.currentDisplayText();");
    expect(revert).toBeGreaterThan(0);
    expect(session).toBeGreaterThan(revert);
    expect(textarea).toBeGreaterThan(session);
    expect(body).toContain("this.renderFencedCodeLanguageRow();");
  });
});

describe("3. 汚れ判定 (組み立て直した文字列 vs 元の文字列)", () => {
  it("何もしなければ汚れていない", () => {
    const { state, editorValue } = initMermaidSession(ORIGINAL);
    expect(isMermaidSessionDirty(state, editorValue, ORIGINAL)).toBe(false);
  });

  it("図種を変えて元に戻すと汚れていない (graph の表記も戻る)", () => {
    const init = initMermaidSession(ORIGINAL);
    const a = changeMermaidDiagramType(init.state, init.editorValue, "mindmap");
    expect(a.state.typeChangedNotice).toBe(true);
    expect(isMermaidSessionDirty(a.state, a.editorValue, ORIGINAL)).toBe(true);
    const b = changeMermaidDiagramType(a.state, a.editorValue, "flowchart");
    expect(isMermaidSessionDirty(b.state, b.editorValue, ORIGINAL)).toBe(false);
  });

  it("方向を変えて戻すと汚れていない。TB は「上から下」(TD) と表示し、選び直しでは変わらない", () => {
    const tb = J("flowchart TB", "A --> B");
    const init = initMermaidSession(tb);
    expect(mermaidDirectionSelectValue(init.state)).toBe("TD");
    const same = changeMermaidFlowchartDirection(init.state, "TD");
    expect(isMermaidSessionDirty(same, init.editorValue, tb)).toBe(false);
    const lr = changeMermaidFlowchartDirection(init.state, "LR");
    expect(mermaidFullText(lr, init.editorValue)).toBe(J("flowchart LR", "A --> B"));
    const back = changeMermaidFlowchartDirection(lr, "TD");
    expect(mermaidFullText(back, init.editorValue)).toBe(tb);
  });

  it("raw suffix を変えて戻すと汚れていない (元の空白も戻る)", () => {
    const pie = J("pie   showData", '  "A" : 1');
    const init = initMermaidSession(pie);
    const cleared = changeMermaidRawSuffix(init.state, "");
    expect(mermaidFullText(cleared, init.editorValue)).toBe(J("pie", '  "A" : 1'));
    const back = changeMermaidRawSuffix(cleared, "showData");
    expect(isMermaidSessionDirty(back, init.editorValue, pie)).toBe(false);
  });

  it("isDirty は構造化表示のとき isMermaidSessionDirty を使う", () => {
    const body = bodyOf("  private isDirty(): boolean {");
    expect(body).toContain("isMermaidSessionDirty(this.mermaidSession, this.textareaEl.value, this.originalText)");
    expect(body).toContain("if (mermaidStructuredDirty) return true;");
  });
});

describe("4. 図種の変更・雛形・Apply の配線", () => {
  it("本文がある時は宣言だけを変え、注意を出す。本文が空なら雛形を入れ、注意は出さない", () => {
    const init = initMermaidSession(ORIGINAL);
    const withBody = changeMermaidDiagramType(init.state, init.editorValue, "sequence");
    expect(withBody.editorValue).toBe(init.editorValue);
    expect(withBody.state.typeChangedNotice).toBe(true);
    expect(mermaidFullText(withBody.state, withBody.editorValue)).toBe(
      J("%%{init: {'theme':'dark'}}%%", "sequenceDiagram", "  A --> B", "  B --> C")
    );
    const empty = initMermaidSession("flowchart TD\n");
    const tpl = changeMermaidDiagramType(empty.state, "  ", "mindmap");
    expect(tpl.state.typeChangedNotice).toBe(false);
    expect(mermaidFullText(tpl.state, tpl.editorValue)).toBe(buildMermaidTemplateText("mindmap"));
  });

  it("Apply は構造化表示の全文 (mermaidFullText) を既存の applySubtreeEdit 経路へ渡す", () => {
    const apply = bodyOf("  private applyEdit(): boolean {");
    expect(apply).toContain("newRawText = mermaidFullText(this.mermaidSession, this.textareaEl.value);");
    expect(apply).toContain("this.mermaidSession = this.mermaidSessionAfterApply(newRawText, appliedInfoString);");
    expect(bodyOf("  private currentDisplayText(): string {")).toContain(
      "return mermaidBaselineEditorText(this.mermaidSession, this.originalText);"
    );
  });

  it("言語を mermaid から外すと組み立て直した全文を本文として扱う", () => {
    const body = bodyOf("  private handleMermaidLanguageChanged(): void {");
    expect(body).toContain("this.textareaEl.value = mermaidFullText(this.mermaidSession, this.textareaEl.value);");
    expect(body).toContain("this.mermaidSession = null;");
    expect(isMermaidInfoString("mermaid")).toBe(true);
    expect(isMermaidInfoString("js")).toBe(false);
  });

  it("構造化 → applySubtreeEdit: 何も変えなければ原文と一字も違わない (```mermaid を保持)", () => {
    const note = J("# H", "```mermaid", ORIGINAL, "```", "after");
    const doc = parseDocument(note);
    const info = scanComplexBlocks(doc).blocks.find((b) => b.kind === "fenced-code")!;
    const ex = extractSubtreeText(doc, info.id);
    const { state, editorValue } = initMermaidSession(ex.text);
    const out = applySubtreeEdit(doc, info.id, ex.text, mermaidFullText(state, editorValue), "mermaid");
    expect(out.lines.join("\n")).toBe(note);
  });

  it("1-7(3): 本文にブロックを途中で閉じる行があれば Apply を拒否し、原文を変えない", () => {
    const note = J("# H", "```mermaid", "mindmap", "  root", "```");
    const doc = parseDocument(note);
    const info = scanComplexBlocks(doc).blocks.find((b) => b.kind === "fenced-code")!;
    const ex = extractSubtreeText(doc, info.id);
    for (const bad of ["```", "````", "``` js", "  ```"]) {
      const out = applySubtreeEdit(doc, info.id, ex.text, J("mindmap", bad, "  root"));
      expect(out.changed).toBe(false);
      expect(out.reason).toBe("fenced-code-premature-close");
      expect(out.lines).toEqual(doc.lines);
    }
    // A different fence character is ordinary content.
    expect(applySubtreeEdit(doc, info.id, ex.text, J("mindmap", "~~~", "  root")).changed).toBe(true);
  });

  it("Mermaid 以外のブロックでは Mermaid 行を出さない (renderMermaidRow は session=null で隠す)", () => {
    const render = bodyOf("  private renderMermaidRow(): void {");
    expect(render).toContain("if (!session) {");
    expect(render).toContain("this.mermaidRowEl.toggleVisibility(false);");
    expect(bodyOf("  private loadedMermaidSession(): MermaidSessionState | null {")).toContain(
      "isMermaidInfoString(this.fencedCodeMeta.infoString)"
    );
  });
});

describe("5. 注意の文言と i18n キー (日本語・英語)", () => {
  const en = createTranslator("en");
  const ja = createTranslator("ja");
  const keys = [
    "partialEdit.mermaid.viewStructured",
    "partialEdit.mermaid.viewSource",
    "partialEdit.mermaid.diagramTypeLabel",
    "partialEdit.mermaid.directionLabel",
    "partialEdit.mermaid.direction.none",
    "partialEdit.mermaid.direction.TD",
    "partialEdit.mermaid.direction.BT",
    "partialEdit.mermaid.direction.LR",
    "partialEdit.mermaid.direction.RL",
    "partialEdit.mermaid.suffixLabel",
    "partialEdit.mermaid.preambleSummary",
    "partialEdit.mermaid.typeChangedNotice",
    "partialEdit.mermaid.sourceReason",
    "partialEdit.mermaid.structureFailedNotice",
    "reason.fenced-code-premature-close",
    "modal.insertCodeBlockDiagramTypeLabel",
    "modal.insertCodeBlockDiagramTypeNone",
    ...["no-declaration", "unknown-diagram", "unsupported-suffix", "unclosed-frontmatter", "unclosed-directive", "empty"].map(
      (r) => `partialEdit.mermaid.reason.${r}`
    ),
    ...MERMAID_DIAGRAM_TYPES.map((t) => t.labelKey as string),
  ] as TranslationKey[];

  it.each(keys)("%s が日英ともに定義されている", (key) => {
    expect(en(key)).not.toBe(key);
    expect(ja(key)).not.toBe(key);
    expect(en(key).length).toBeGreaterThan(0);
    expect(ja(key).length).toBeGreaterThan(0);
  });

  it("図種変更の注意は指示どおりの文言", () => {
    expect(ja("partialEdit.mermaid.typeChangedNotice")).toBe(
      "図の種類だけを変えました。本文は自動では変換されません。新しい図の種類に合わせて本文を直してください。"
    );
  });

  it("プルダウンは「表示名（キーワード）」、言語ごとの表示名", () => {
    expect(ja("mermaid.typeOption", { label: ja("mermaid.type.mindmap"), keyword: "mindmap" })).toBe("マインドマップ（mindmap）");
    expect(en("mermaid.typeOption", { label: en("mermaid.type.mindmap"), keyword: "mindmap" })).toBe("Mindmap (mindmap)");
  });

  it("「変換」を思わせるボタン・ラベルを使わない (注意文以外)", () => {
    for (const key of keys.filter((k) => k !== "partialEdit.mermaid.typeChangedNotice")) {
      expect(ja(key)).not.toMatch(/変換/);
      expect(en(key)).not.toMatch(/convert/i);
    }
    expect(i18nTs).not.toMatch(/"partialEdit\.mermaid\.[^"]*convert/i);
  });
});

describe("6. 挿入時に図種を選ぶ段", () => {
  it("図種を選べば宣言+雛形、選ばなければ従来の bodyTemplate", () => {
    expect(resolveCodeBlockPresetBody("mermaid", "sequence")).toBe(buildMermaidTemplateText("sequence"));
    expect(resolveCodeBlockPresetBody("mermaid", null)).toBe("flowchart TD\n");
    expect(resolveCodeBlockPresetBody("mermaid", "")).toBe("flowchart TD\n");
    expect(resolveCodeBlockPresetBody("javascript", "sequence")).toBe("");
    expect(resolveCodeBlockPresetBody("nope", null)).toBeNull();
  });

  it("CodeBlockPresetModal は Mermaid 選択時だけ図種の段を出し、選択を resolveCodeBlockPresetBody に渡す", () => {
    expect(modalTs).toContain('const isMermaid = selectEl.value === "mermaid";');
    expect(modalTs).toContain("diagramRow.toggleVisibility(isMermaid);");
    expect(modalTs).toContain("resolveCodeBlockPresetBody(preset.id, diagramTypeId)");
    expect(modalTs).toContain('t("modal.insertCodeBlockDiagramTypeNone")');
  });

  it("挿入された雛形は構造化表示で開ける", () => {
    for (const type of MERMAID_DIAGRAM_TYPES) {
      const body = resolveCodeBlockPresetBody("mermaid", type.id)!;
      expect(initMermaidSession(body).state.view).toBe("structured");
    }
    expect(initMermaidSession("flowchart TD\n").state.view).toBe("structured");
  });
});
