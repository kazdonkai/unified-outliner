import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import {
  FoldStateData,
  getCollapsedIdentities,
  withNodeCollapsed,
} from "../src/persistence/foldStateStore";
import { applySubtreeEdit, extractSubtreeText } from "../src/edit/partialEdit";

/**
 * Phase 4F — fold-state 競合解決の3論点のうち、純粋関数レベルで検証できる
 * 部分の退行テスト。詳細な設計は docs/fold-state-conflict-resolution-spec.md
 * を参照。
 *
 * "アクティブ leaf のみが CM6 起点の書き込みを行う"（§2.2）というガード自体
 * は Obsidian の Workspace/CM6 ランタイムに依存するため、この codebase の
 * 他の Obsidian-glue コード（view/OutlineTreeView.ts 全体、
 * tests/foldStateAcceptance.test.ts の既存の注記を参照）と同じ理由で、ここ
 * では自動テストの対象外としている。
 */

function idOf(doc: ReturnType<typeof parseDocument>, headingText: string): string {
  for (const n of doc.nodes.values()) {
    if (n.type === "section" && n.headingText === headingText) return n.id;
  }
  throw new Error(`no section named ${headingText}`);
}

describe("Phase 4F §1: authoritative 判定 — 直近の書き込みが勝つ", () => {
  it("CM6 起点の書き込みの後に Tree 起点の書き込みが来た場合、Tree 側の値が最終状態になる", () => {
    let data: FoldStateData = {};
    // CM6 起点: このノードを collapsed にする
    data = withNodeCollapsed(data, "Notes/A.md", "section:H", true);
    // Tree 起点: 直後にユーザーが Outline Tree 側で同じノードを展開
    data = withNodeCollapsed(data, "Notes/A.md", "section:H", false);

    expect(getCollapsedIdentities(data, "Notes/A.md").has("section:H")).toBe(false);
  });

  it("Tree 起点の書き込みの後に CM6 起点の書き込みが来た場合、CM6 側の値が最終状態になる（起点は問わず、直近の呼び出しが常に勝つ対称なポリシー）", () => {
    let data: FoldStateData = {};
    // Tree 起点: このノードを collapsed にする
    data = withNodeCollapsed(data, "Notes/A.md", "section:H", true);
    // CM6 起点: 直後に本文ガターで同じノードを展開
    data = withNodeCollapsed(data, "Notes/A.md", "section:H", false);

    expect(getCollapsedIdentities(data, "Notes/A.md").has("section:H")).toBe(false);
  });

  it("同一ファイル内でも識別子（identity）が異なるノードへの書き込みは互いに干渉しない", () => {
    let data: FoldStateData = {};
    data = withNodeCollapsed(data, "Notes/A.md", "section:H1", true); // CM6 起点
    data = withNodeCollapsed(data, "Notes/A.md", "section:H2", true); // Tree 起点、別ノード

    const collapsed = getCollapsedIdentities(data, "Notes/A.md");
    expect(collapsed.has("section:H1")).toBe(true);
    expect(collapsed.has("section:H2")).toBe(true);
  });
});

describe("Phase 4F §3: fold-state と Partial Edit Pane の conflict 検知は分離している", () => {
  it("読み込みから Apply までの間に対象ノードの fold-state が何度変化しても、Apply の conflict 判定には一切影響しない", () => {
    const text = ["# H", "body line"].join("\n");
    const doc = parseDocument(text);
    const sectionId = idOf(doc, "H");

    const extracted = extractSubtreeText(doc, sectionId);
    expect(extracted.ok).toBe(true);

    // fold-state ストアを独立して操作する — extractSubtreeText/
    // applySubtreeEdit はこのストアを一切参照しないので（edit/partialEdit.ts
    // の doc comment 参照）、以下の変更は doc / extracted.text に何の影響も
    // 与えない。
    let foldData: FoldStateData = {};
    foldData = withNodeCollapsed(foldData, "Notes/A.md", "section:H", true);
    foldData = withNodeCollapsed(foldData, "Notes/A.md", "section:H", false);
    foldData = withNodeCollapsed(foldData, "Notes/A.md", "section:H", true);

    const outcome = applySubtreeEdit(doc, sectionId, extracted.text, "# H\nedited body");
    expect(outcome.changed).toBe(true);
    expect(outcome.reason).toBeUndefined();
    expect(outcome.lines).toEqual(["# H", "edited body"]);

    // fold-state 側も Apply によって一切変更されていないことを確認する
    // （applySubtreeEdit は FoldStateData を受け取ってすらいない — この
    // アサーションは「Apply 前後で fold-state ストアの内容が変わらない」
    // ことを明示的に固定するためのものである）。
    expect(getCollapsedIdentities(foldData, "Notes/A.md").has("section:H")).toBe(true);
  });

  it("実際に内容が食い違っている場合の conflict 判定は、fold-state と無関係に従来どおり機能する（本文テキストの不一致のみが理由になる）", () => {
    const text = ["# H", "body line"].join("\n");
    const doc = parseDocument(text);
    const sectionId = idOf(doc, "H");

    // originalText をわざと古いスナップショットのままにする（他経路での
    // 本文編集を検知するケースを模す） — fold-state を一切触っていなくて
    // も conflict になることを確認する。
    const staleOriginalText = "# H\nold body";

    const outcome = applySubtreeEdit(doc, sectionId, staleOriginalText, "# H\nnew body");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("conflict");
  });
});
