# Phase 5E-3c: 軽量 Table Mode

## 1. 目的とスコープ

Phase 5E-3b（`src/edit/editableMarkdownTable.ts` の
`EditableMarkdownTable`/`parseMarkdownTable`/`serializeMarkdownTable`）を
Partial Edit View に配線し、table ブロックを Partial Edit で開いたとき
Raw Markdown 編集に加えてセル編集・行列操作ができる Table Mode を追加した。

設計原則（変更禁止、ticket 記載どおり）:

- Markdown 原文を唯一の正とする。`EditableMarkdownTable` は Partial Edit
  session の一時状態であり、保存形式にしない。
- Apply 時は `serializeMarkdownTable` の出力を既存の
  `applySubtreeEdit`/`dispatchAndApply` 経路のみを通じて書き戻す。新しい
  直接書き込み経路は追加していない。
- Apply / Cancel / conflict 検知は既存の Partial Edit と同一の安全モデル
  に従う。


## 2. 新規モジュール: `src/edit/tableModeOperations.ts`

`EditableMarkdownTable` に対する純粋関数を8つ実装した。いずれも Obsidian
に依存せず、DOM にも Partial Edit session state にも触れない。

- `setHeaderCellText(table, columnIndex, text)`
- `setDataCellText(table, rowIndex, columnIndex, text)`
- `setColumnAlignment(table, columnIndex, alignment)`
- `addRow(table)` / `deleteRow(table, rowIndex)`
- `moveRow(table, rowIndex, "up" | "down")`
- `addColumn(table)` / `deleteColumn(table, columnIndex)`

返り値は `{ok:true, table} | {ok:false, reason}` の discriminated union
（`parseMarkdownTable` と同じ規約）。拒否条件（ticket §拒否条件）はこの層
で強制する。

- `deleteRow`: 残り行数が1のとき `"last-row"` を返し拒否する（最後の1行
  は削除できない）。
- `deleteColumn`: 残り列数が1のとき `"last-column"` を返し拒否する。
- `moveRow`: 境界を超える移動（先頭行の上移動・末尾行の下移動）は拒否で
  はなく no-op success（テーブルをそのまま返す）— UI 側のボタン
  disabled 状態と対応する。

## 3. `view/PartialEditView.ts` への配線

### 3.1 新規 session state フィールド

- `tableModeTable: EditableMarkdownTable | null` — 現在の Table Mode 作業
  コピー。table kind かつ直近の parse が成功したときのみ非 null。
- `tableModeActiveTab: "raw" | "table"` — 現在表示中のタブ。ロード直後は
  常に `"raw"`。
- `tableModeParseFailureReason: MarkdownTableParseFailureReason | null` —
  直近の parse 失敗理由。Table タブの disabled 状態と理由表示を駆動する。

3フィールドとも `fencedCodeMeta`/`fencedCodeSelectedInfoString` と全く同
じ4箇所（`resetLoadedState`、`loadParagraphInternal`、
`loadCompositeInternal`、そして `loadNodeInternal` 自身のロード時re-populate）
でリセット/再構築される — このパリティは
`tests/phase5e3cTableModeUiWiring.test.ts` の「field reset parity」テス
トで機械的に検証している。


### 3.2 DOM / UI

`onOpen()` に以下を追加した（`fencedCodeLanguageRowEl` 等と同じ「once in
onOpen, mutate on each render」規約）:

- `tableModeTabRowEl`: Raw/Table タブボタン2つ + parse失敗理由の1行表示
  (`tableModeParseFailureEl`)。table kind 以外では非表示。
- `tableModeGridEl`: Table タブのセル・行・列グリッド。`textareaEl` とは
  別要素で、アクティブタブに応じて相互排他的に表示切り替えする。

`renderTableModeRow()`（`renderLoadedState`/`renderEmptyState`/
`performAutoReload` の呼び出し列に `renderFencedCodeLanguageRow()` の直後
に追加）がタブ行の表示・Table タブの disabled 状態・理由表示・
`textareaEl`/`tableModeGridEl` の相互排他表示を駆動する。

`renderTableModeGrid()` はグリッドを `empty()` して全再構築する
（`renderBreadcrumb` と同じ規約）。ヘッダー行の各列に削除ボタン +
alignment トグル(Left/Center/Right/None) を、データ行の各行に上下移動ボ
タン + 削除ボタンを配置し、テーブル右端に列追加、末尾に行追加ボタンを置
く。**セルのテキスト編集自体は毎キー入力でグリッド全体を再構築しない**
— `tableModeTable` を差し替えて `updateDirtyState()` を呼ぶだけで、フォ
ーカスを失わせない。構造変更（追加・削除・移動・alignment変更）のみ
`renderTableModeGrid()` の全再構築をトリガーする。

### 3.3 タブ切り替え（ticket §2「Raw タブとの同期」）

- Table → Raw: `serializeMarkdownTable(tableModeTable).join("\n")` を
  `textareaEl.value` に書き戻す。常に成功する。
- Raw → Table: `textareaEl.value`（切り替え前の最新の Raw 編集）を
  `parseMarkdownTable` で再パースする。成功すれば `tableModeTable` を更
  新してタブを切り替える。失敗すればタブ切り替えを拒否し、`tableModeActiveTab`
  は `"raw"` のまま、`tableModeParseFailureReason` に理由を格納して一行
  表示する。

### 3.4 Apply

`applyEdit()` の `let newRawText = this.textareaEl.value;` の直後に、
table kind かつ Table タブがアクティブなときだけ

```ts
newRawText = serializeMarkdownTable(this.tableModeTable).join("\n");
```

を上書きする一行を追加した。これ以降の処理（`applySubtreeEdit` 呼び出
し、conflict 検知、Undo 統合）は完全に既存のまま —
新しい書き込み経路は一切追加していない。Raw タブでの Apply は従来どお
り `textareaEl.value` をそのまま使う。

Apply 成功後の rebuild（`fencedCodeMeta` の rebuild 分岐の直後に
`else if (this.nodeKind === "table")` を追加）では、書き戻し済みの
`newRawText` を再度 `parseMarkdownTable` して `tableModeTable` を更新す
る。再パースが失敗した場合（Table Mode の操作は常に valid な Markdown
を生成するため通常発生しないが、防御的に処理）は Raw タブへフォールバッ
クする。

### 3.5 isDirty

`fencedCodeInfoStringDirty` と同じ「本文の dirty 判定は
`currentDisplayText()` の既存フォールバック（`originalText` そのまま）
で足りる」という前提のもと、Table タブ固有の dirty flag
（`tableModeDirty`）だけを追加した: Table タブがアクティブかつ
`serializeMarkdownTable(tableModeTable)` が `originalText` と異なるとき
true。


## 4. i18n

`src/i18n.ts` の `en`/`ja` 両辞書に `partialEdit.tableMode.*` キーを15個
追加した（タブラベル、行/列の追加・削除・移動、alignment トグル4種、
parse失敗の1行理由テンプレート、行/列削除拒否時の Notice 2種）。
parse失敗理由のテキスト自体は ticket の明示的な許可どおり英語のみ
（`reason` コード自体が英語識別子のため）。

## 5. CSS

`styles.css` に `.unified-outliner-partial-edit-table-mode-*` 系のクラス
を追加した。既存の `fenced-code-language-row`/`composite-list-row` と同
じ命名規約・トークン（`--uo-text-color`、`--interactive-accent` 等の
Obsidian テーマ変数、`rgba(128,128,128,...)` の中立背景）に従う。
`toggleVisibility()` で `visibility: hidden` になった `tableModeTabRowEl`/
`tableModeGridEl`/`textareaEl` を `display: none` に変換する既存の
selector list にも3つのクラスを追加した。

## 6. 拒否条件

- parse 失敗（`parseMarkdownTable` が `ok:false`）: Table タブを disabled
  にし、理由を1行表示する。Raw タブのみ使用可能。
- 列削除で列数が0になる場合: `deleteColumn` が `"last-column"` で拒否
  し、`handleTableModeDeleteColumn` が Notice を表示して `tableModeTable`
  を変更しない。
- 行削除で行数が0になる場合: `deleteRow` が `"last-row"` で拒否し、
  `handleTableModeDeleteRow` が Notice を表示して `tableModeTable` を変更
  しない。

## 7. テスト

- `tests/phase5e3cTableModeOperations.test.ts`（33件、新規）: 8つの純粋
  操作関数それぞれの単体テスト（cell 編集、alignment、行追加/削除/移動、
  列追加/削除、拒否条件、mutation-free）に加え、各操作後の
  `serializeMarkdownTable` 出力が `parseMarkdownTable` で valid に往復す
  ることを確認する「Apply-time validity」テスト群。Raw→Table→Raw の往復
  安定性自体は Phase 5E-3b の既存テストで保証済みのため再テストしていな
  い。
- `tests/phase5e3cTableModeUiWiring.test.ts`（15件、新規）: 実 Obsidian
  ランタイムなしのソースワイヤリングテスト
  （`phase5e3aStructuredBlockInsertUiWiring.test.ts` の手法を踏襲）。
  Table タブが table kind のみでレンダリングされ fenced-code では出現し
  ないこと、parse 失敗時のタブ無効化、Apply 時の
  `serializeMarkdownTable` 呼び出し分岐、行/列削除の境界拒否、フィール
  ドリセットのパリティ、i18n カバレッジ、isDirty の table フラグを検証
  する。

## 8. 自動検証

- `npx tsc --noEmit -skipLibCheck`: エラーなし
- `npx vitest run`: 156ファイル / 3242件全通過（既存 3194件 + 新規48件
  = 3242件、回帰なし）
- `npm run lint`: 0エラー（既存の `src/settings.ts` 警告3件のみ、本変更
  と無関係）
- `npm run build`: 成功

## 9. 非目標（次フェーズ以降に持ち越し）

ticket §非目標に明記のとおり、以下は本フェーズのスコープ外である: セル
内 Markdown の WYSIWYG レンダリング、列幅の自動整形・桁揃え、列のドラッ
グ並べ替え、CSV/TSV 変換、数式・データ型・フィルタ・ソート、Semantic
Card/BlockIndex との連携。

## 10. 実機確認

**確認日時**: 2026-09-24
**確認環境**: Method Vault（Test note）
**確認結果**: 正常。table ブロックの Partial Edit で Raw／Table タブ切
替、セル編集、行の追加・削除・移動、列の追加・削除、alignment 変更、
Apply による Markdown 書き戻しが期待どおり動作することをユーザー自身
が実機で確認した。
**追加の判断事項**: 行移動 `moveRow` が境界（先頭行を上へ／末尾行を下
へ）で no-op となる挙動（削除の0件拒否とは別扱い）は、UI 上自然な挙動
として承認済み。仕様逸脱ではなく妥当な設計判断として扱う。

なお、確認の過程で発見されたアラインメントトグルボタンの表示崩れ（日
本語ラベルがボタン幅で重なる問題）は、実機確認と並行してアイコンボタ
ン方式（setIcon + tooltip）に修正済みである（コミット `740d384`）。実
機確認はこの修正を含む状態で行われた。
