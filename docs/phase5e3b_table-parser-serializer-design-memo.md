# Phase 5E-3b: Markdown Table parser / serializer 基盤

## 1. 目的とスコープ

Phase 5E-3c（軽量 Table Mode）の前提となる、Markdown table の raw 原文 ←→
構造化データモデルの往復変換を行う純粋関数を実装する。UI は一切持たず、
Partial Edit の保存経路（`applySubtreeEdit`/`dispatchAndApply`）・競合検知・
Tree 投影・range parser のいずれにも触れない。`src/edit/partialEdit.ts`・
`src/view/PartialEditView.ts`・`src/view/OutlineTreeView.ts` は無変更である。

## 2. データモデル

`src/edit/editableMarkdownTable.ts` に `EditableMarkdownTable` を定義した。

```ts
interface EditableMarkdownTable {
  headers: string[];
  alignments: TableColumnAlignment[]; // "left" | "center" | "right" | "none"
  rows: string[][];
}
```

この型は保存形式ではなく、Partial Edit session 内の一時状態としてのみ設計
されている旨を型定義自身の docstring に明記した（本フェーズでは
PartialEditView からの配線は行わない）。

## 3. parser（`parseMarkdownTable`）

- 1行目をヘッダー行、2行目を delimiter row、3行目以降をデータ行として解釈する。
- delimiter row の各セルを既存の `DELIMITER_CELL_RE`（`parser/complexBlocks.ts`・
  `edit/partialEdit.ts` と同一形状、意図的に重複定義・非 import）で検証し、
  `left`/`center`/`right`/`none` に変換する。
- 行の分割は新規実装の `splitTableRowCells` が担う。既存の
  `splitPipeRowForValidation`（単純な `split("|")`）とは異なり、1文字ずつ走査
  し、次を区別する。
  - `\|`（バックスラッシュエスケープされたパイプ）→ 区切り文字として扱わず、
    セルテキストには非エスケープの `|` 1文字として格納する（バックスラッシュ
    自体は破棄。serializer が書き戻し時に再エスケープする）。
  - inline code（同じ長さのバッククォート連続で開閉される範囲）内のパイプ →
    区切り文字として扱わず、バッククォートごとそのままセルテキストに格納する
    （エスケープの解釈も行わない — CommonMark の inline code 内でバックスラッ
    シュが特別扱いされないのと同じ）。
  - inline code のネスト・複数バッククォート対応（開いたスパン内で異なる長さの
    バッククォート連続に遭遇する、あるいは閉じられないまま行末に達する）は
    初期版の対象外とし、`ambiguous-inline-code` で parse を拒否する。
- 行頭・行末のパイプは任意（`splitTableRowLine` が単純に1文字だけ除去する）。
- 各セルは trim する。
- 列数が行によって異なる場合は `column-count-mismatch` で拒否する。
- delimiter row が存在しない場合は `no-delimiter-row`、不正な場合は
  `invalid-delimiter-row` で拒否する。
- ヘッダー行が空（入力全体が空文字列を含む）の場合は `no-header-row` で拒否する。
- 返り値は `{ok: true, table} | {ok: false, reason}` の discriminated union。

## 4. serializer（`serializeMarkdownTable`）

- 行頭・行末にパイプを付け、各セルの前後に半角スペース1個を付加する
  （`| cell | ... |`）。
- delimiter row は alignment に応じて `:---` / `---:` / `:---:` / `---` を出力
  する。
- セル内の「inline code の外側にある」パイプ文字だけをバックスラッシュで
  エスケープする（`escapeTableCellText`）。inline code スパン内のパイプは
  スパンによって既に保護されているため、エスケープを追加しない——これは
  `splitTableRowCells` の逆変換であり、両者が一致していることが往復安定性の
  根拠である。
- 列幅の自動整形（桁揃え）は行わない。最低限 valid な Markdown であることのみ
  保証する。
- 返り値は改行を含まない行の配列（結合方式は呼び出し側に委ねる、
  `insertStructuredBlock.ts` の `buildFencedCodeBlockLines`/
  `buildTableTemplateLines` と同じ規約）。

## 5. 往復安定性

`tests/phase5e3bTableParserSerializer.test.ts` の `describe("round-trip
stability")` で以下を保証する。

- `parseMarkdownTable(serializeMarkdownTable(model).join("\n"))` が `model` と
  完全一致する（6パターン：基本・複数alignment・pipe混じりセル・inline
  code・空セル・0行）。
- `serializeMarkdownTable(parseMarkdownTable(raw).table).join("\n")` を再度
  `parseMarkdownTable` した結果が、最初の parse 結果と同じ構造体になる
  （4パターン：基本・pipe省略・inline code混在・余分な空白）。

## 6. 拒否条件テスト

`describe("parseMarkdownTable: rejections")` で以下を網羅する。

- 空文字列入力（`no-header-row`）
- ヘッダー行が空白のみ（`no-header-row`）
- delimiter row が存在しない（`no-delimiter-row`、2パターン）
- delimiter row のセルが数字のみ／空文字（`invalid-delimiter-row`、2パターン）
- ヘッダー・delimiter・データ行間の列数不一致（`column-count-mismatch`、
  3パターン）
- 閉じられていない inline code（`ambiguous-inline-code`）
- 開いたスパン内で異なる長さのバッククォート連続に遭遇する（
  `ambiguous-inline-code`）

`describe("parseMarkdownTable: escaped pipes and inline code")` で、単一
バッククォート・二重バッククォートいずれの inline code でもパイプが正しく
保護されること、およびエスケープされたパイプが正しく非エスケープされること
を個別に確認している。

## 7. 自動検証

- `npx tsc --noEmit -skipLibCheck`：エラーなし
- `npx vitest run`：154 ファイル / 3194 件全通過（既存 153 ファイル /
  3156 件から新規 1 ファイル・38 件追加、既存テストは無変更で全通過）
- `npm run lint`：0 エラー（既存の `src/settings.ts` 警告 3 件のみ、本変更と
  無関係）
- `npm run build`：成功
- 変更ファイルは `src/edit/editableMarkdownTable.ts`（新規）と
  `tests/phase5e3bTableParserSerializer.test.ts`（新規）の2つのみ
  （`git diff --stat` で確認済み）。既存ファイルへの変更は一切なし。

## 8. 実機確認

UI を持たないため本フェーズでは不要（ticket §完了基準どおり）。

## 9. 次フェーズへの接続

Phase 5E-3c は本フェーズの `EditableMarkdownTable`・`parseMarkdownTable`・
`serializeMarkdownTable` を Partial Edit View から呼び出す配線を行い、セル・
行・列単位の軽量編集 UI を追加する想定である。本フェーズはその際に UI 側が
組み立てる `EditableMarkdownTable` の形と、それを Apply 時に Markdown へ戻す
経路を先に固めることが目的だった。
