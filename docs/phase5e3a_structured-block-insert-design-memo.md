# Phase 5E-3a 設計メモ：ツリーペインでの fenced-code / table 新規挿入

作成日: 2026-09-23 ／ ブランチ: `phase5e3a-structured-block-insert`（main 未マージ）
状態: **実装完了・ユーザー実機確認待ち**

## 1. 目的と範囲

Outline Tree のセクション見出しノード・リスト item ノードのコンテキストメニュー（右クリック／長押し）から、fenced code block と Markdown table を新規挿入し、挿入直後にそのブロックの Partial Edit を自動で開けるようにする。

対象外（チケットの非目標どおり）: table のセル編集 UI・Table Mode、Mermaid GUI 編集、Dataview クエリビルダー、D&D による挿入位置指定、複数ブロック同時挿入、挿入後の自動 rename。range parser・競合検知・`tree/insertionFramework.ts`（5E-0.5/5E-1 の fenced/table 起点の挿入リゾルバ、未接続のまま）・`edit/insertBlock.ts`・`edit/insertParagraph.ts` には変更を加えていない。

## 2. 追加・変更ファイル

| ファイル | 種別 | 内容 |
|---|---|---|
| `src/edit/codeBlockPresets.ts` | 新規（純粋） | CodeBlockPreset 登録表（13 種）、`buildFencedCodeBlockLines`、`validateCustomInfoString`、`buildTableTemplateLines`（1〜8 列 × 1 行） |
| `src/edit/insertStructuredBlock.ts` | 新規（純粋） | 共通挿入 API `insertBlockAtPosition`、`computeRequiredBlankLines`、挿入位置解決 `resolveStructuredInsertionPoint`、解決＋挿入＋構造保存検証 `insertStructuredBlockBelowNode`、挿入後 id 再解決 `findInsertedStructuredBlockId` |
| `src/view/CodeBlockPresetModal.ts` | 新規 | 言語セレクタ（プリセット＋Custom… 自由入力） |
| `src/view/TableTemplateModal.ts` | 新規 | 列数入力（1〜8）／最小テンプレート（2 列 × 1 行）挿入の選択ダイアログ |
| `src/view/OutlineTreeView.ts` | 変更 | セクション・リストのメニューに 2 項目追加、`runInsertStructuredBlockCommand` |
| `src/view/PartialEditView.ts` | 変更 | Phase 5E-3 の言語選択肢表を CodeBlockPreset 登録表からの派生に置換（順序・値・alias・ラベルキーは完全に同一） |
| `src/i18n.ts` / `styles.css` | 変更 | en/ja 文言、モーダルの最小スタイル |
| `tests/phase5e3aStructuredBlockInsert.test.ts` / `tests/phase5e3aStructuredBlockInsertUiWiring.test.ts` | 新規 | 純粋関数テスト 56 件、配線・単一 Undo・i18n テスト 9 件 |

## 3. 挿入位置の規則

- **セクション見出し**: 見出し行の直後（セクション内の最初の位置）に挿入する。見出しでない Markdown ブロックはセクションの「兄弟」として表現できない（セクション範囲の直後に置くと、最後の下位セクションに吸収される）ため、見出し直後のみを唯一の曖昧さのない位置として採用した。メニュー文言の「下に（below）」は見出し行の下を意味する。
- **リスト item**: item のサブツリー全体の直後に、リストの次のブロックとして挿入する。許可するのは「ルートレベルの item」かつ「そのリストの最後の item」（直後の最初の非空行がリスト行でもインデント行でもない）の場合のみである。途中の item の後に置くとリストが二分され、ネストした item の後に置くとリスト内部に入るため、いずれも `structured-insert-inside-list` で拒否する。
- 位置が不適格な項目はメニューに「— unavailable」付きで表示するが、クリックは可能とし、クリック時は Notice で理由を示すだけで何も書き込まない（チケット §1「no-op とし、Notice で理由を示す」）。

## 4. 空行の規則

`computeRequiredBlankLines` は、挿入点の直前・直後の既存行が非空行である側にだけ空行 1 行を付加する。既存の空行は十分とみなし、追加も削除もしない（既存本文の空行は正規化しない）。文書端では空行を付けない。`insertBlockAtPosition` は入力配列を変更せず、既存行の削除・結合を一切行わない。

## 5. 安全性：挿入後の構造保存検証

挿入位置の事前判定に加え、挿入結果を再パースして以下をすべて満たさなければ拒否し、原文を 1 バイトも変えない（`structured-insert-structure-changed` / `structured-insert-not-recognized`）。

1. 新ブロックが、期待した kind・`editability: "supported"` で、挿入した行範囲ちょうどに認識される。
2. 既存の全 section/list ノードが、同じ種別・深さで、行シフト後の開始行に存在する（ノード数も一致）。
3. 既存の全 complex block（fenced-code・table・callout・blockquote・paragraph 等）が、同じ kind・editability で、行シフト後の範囲に存在する。挿入区間内に完全に収まるブロック（table に対してスキャナが従来から出す重なり paragraph 候補など）は新ブロックの一部として比較から除外し、区間の縁をまたぐブロックは除外しない。
4. 既存の全 CompositeBlock が、同じ rule・同じ構成メンバー（シフト後範囲）で再マッチする。

これにより「既存 fence の開始・終了の対応関係が壊れる」「CompositeBlock の構成が変わる」場合は予測ではなく実測で拒否される（初期版ではユーザー確認なしで単純拒否。例: `single-line-list` + `callout` の複合ブロックの間への挿入）。なお現行 UI では複合ブロックのメンバー行は読み取り専用でメニュー自体が出ないため、この検証は主に防御層として働く（純粋関数テストで直接確認している）。

## 6. 書き戻しと Undo

書き込みは既存の `dispatchAndApply` → `applyLineEditOutcome` 経路のみを通る（新しい直接書き込み経路なし）。差分は 1 回の `Editor#replaceRange` にまとめられるため、挿入は Obsidian の Undo 1 回で取り消せる。`dispatchAndApply` はモーダルのコールバック時点で現在のエディタ内容を再パースするため、メニュー表示後にノートが変わっていても最新内容に対して判定・検証が行われる。

挿入成功後、complex block の id は連番（`fenced-N` / `table-N`）であるため、挿入範囲から id を再解決して `activatePartialEditView(id)` を呼ぶ。Partial Edit を開く操作はノートを編集しないので、挿入＋起動は Undo 1 単位のままである。fenced-code は Phase 5E-3 のフェンス非表示 UI（本文のみ・言語セレクタ）で、table は Phase 5E-2A の Raw Markdown 編集で開く。Tree 設定 `showFencedCodeInOutline` / `showTablesInOutline` が off でも Partial Edit は開ける（id を本文から直接再解決するため）。

## 7. CodeBlockPreset

チケット記載の最低限（Plain・Mermaid・Dataview・DataviewJS・JavaScript・TypeScript・Python・YAML・JSON・SQL・Custom…）に、Phase 5E-3 のセレクタに既にあった Shell(bash)・CSS・HTML を加えた 13 種＋Custom… とした。リポジトリに既存の `CodeBlockPreset` 定義は存在しなかったため、Phase 5E-3 の `FENCED_CODE_LANGUAGE_OPTIONS` を唯一の登録表 `CODE_BLOCK_PRESETS` へ移し、PartialEditView 側はそこから派生させた（挿入時と編集時の選択肢が乖離しない）。Mermaid のテンプレートは `flowchart TD\n`（本文 2 行 `flowchart TD` と空行）、他は空の本文 1 行である。Custom… の info string はトリム後、バッククォート・改行を含まず 64 文字以内であることを検証する（バッククォートを含むと開始行がフェンスとして成立しなくなるため）。フェンスは常に 3 バッククォートを用いる。

## 8. table テンプレート

`| Column 1 | Column 2 |` / `| --- | --- |` / `|  |  |` の 3 行（列数 n に応じて拡張）。1〜8 列のすべてでスキャナが supported な table として認識し、Phase 5E-2A の Apply 検証を通過することをテストで確認している。

## 9. 検証結果（自動）

- `npx tsc --noEmit` エラーなし
- `npx vitest run` 153 ファイル / 3153 件全通過（5E-3 時点の 151 ファイル / 3088 件から新規 2 ファイル・65 件追加、既存テストは無変更で全通過）
- `npm run lint` 0 エラー（警告 3 件は `src/settings.ts` の既存警告で本変更と無関係）
- `npm run build` 成功、`git diff --check` 問題なし

## 10. 実機確認（ユーザー実施）

### デプロイ手順（ターミナルで実行）

```bash
cd /Users/kazumikaizuka/Obsidian/unified-outliner-public && git switch phase5e3a-structured-block-insert && npm run build
cp main.js manifest.json styles.css ~/Obsidian/Method/.obsidian/plugins/unified-outliner/
cp main.js manifest.json styles.css /Users/kazumikaizuka/Obsidian/ipad-test/.obsidian/plugins/unified-outliner/
```

コピー後、Obsidian の Community plugins で Unified Outliner を off → on にして再読み込みする。検証ノートは `ipad-test/Test/phase5e3a-structured-block-insert-verification.md`。

### 確認項目

| # | 操作 | 期待結果 | 結果 (Pass/Fail/Not tested) | メモ |
|---|---|---|---|---|
| 1 | 見出し「## A」右クリック → Insert code block below → Mermaid | 見出し直後に ```` ```mermaid / flowchart TD / (空行) / ``` ```` が前後空行付きで入り、Partial Edit が開く（本文 `flowchart TD`、言語 Mermaid） | | |
| 2 | 同上で Plain / Python / Custom…（`rust`） | それぞれ info string が正しく、Partial Edit が開く | | |
| 3 | Custom… に `` a`b `` を入力 | エラー表示、挿入されない | | |
| 4 | 見出し右クリック → Insert table below → 列数 3 → Insert | 3 列 × 1 行の表が入り、Raw Markdown の Partial Edit が開く | | |
| 5 | 同上で「最小テンプレートを挿入（2列 × 1行）」 | 2 列 × 1 行の表が入る | | |
| 6 | 1・4 の直後に Cmd+Z 1 回 | 挿入が一発で消え、原文に完全に戻る | | |
| 7 | リスト「B 最後の項目」右クリック → Insert table below | リストの後に表が入り、リストは変化しない | | |
| 8 | リストの途中の項目・子項目で同メニュー | 「— unavailable」表示、クリックで理由の Notice、本文不変 | | |
| 9 | 見出し直後に既存コードブロックがある「## C」で Insert code block below → Plain | 新ブロックが既存コードブロックの前に入り、既存ブロックの開始・終了フェンスの対応が保たれる | | |
| 10 | 挿入後の本文を Reading view で表示 | コードブロック・表として正しく描画、前後の見出し・リスト・既存コードブロックが崩れない | | |
| 11 | iPad（ipad-test）で長押しメニューから 1・4 | デスクトップと同じ結果 | | |

### 完了判定基準

項目 1・4・6・7・8・10 が Pass であること（11 は iPad 実機が使える場合）。ユーザーの報告で基準を満たしたと判断された時点で本フェーズを「完了」とする。
