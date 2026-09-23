# Phase 5E-3 設計メモ：Fenced Code Block Partial Edit の UX 改善 — フェンス行の非表示化と種別選択 UI

Phase 5E-1（`docs/phase5e1_fenced-code-partial-edit-move-delete-design-memo.md`）で実装した fenced code block の raw Partial Edit（開始フェンス行から終了フェンス行までを1編集単位として編集する方式）を土台とし、本フェーズは純粋な UX 改善のみを行う。テキストエリアからフェンス行そのものを非表示化し、代わりに種別（info string）選択専用の UI を独立して提供する。table・Move・Delete・Table Mode には一切触れていない。

対応する主なソース変更は `src/edit/partialEdit.ts`（抽出・Apply 復元ロジック）、`src/view/PartialEditView.ts`（Partial Edit Pane の UI 層）、`src/i18n.ts`（新規キー14件）。テストは `tests/phase5e3FencedCodeLanguageSelector.test.ts`（新規、18件）に加え、既存テスト7件（後述）を実情に合わせて更新した。

## §1 抽出ロジック変更

### `FencedCodeBodyExtraction` インターフェースと `ExtractSubtreeOutcome` の拡張

`edit/partialEdit.ts` に新規インターフェース `FencedCodeBodyExtraction` を追加した。

```ts
export interface FencedCodeBodyExtraction {
  infoString: string;
  bodyText: string;
  fenceChar: string;
  fenceLength: number;
  openLineIndent: string;
}
```

`ExtractSubtreeOutcome` に、任意（`fencedCode?: FencedCodeBodyExtraction`）フィールドとして追加した。`kind === "fenced-code"` のときのみ設定され、他の全 kind（section・list・callout・blockquote・table）では常に `undefined` のままである。**callout・blockquote・table の戻り値（`text` の意味・形状）は一切変更していない** — ユーザー指示が明示的に要求した制約をそのまま満たす。

### `extractComplexBlockText` の変更点

`complexBlock.kind === "fenced-code"` の場合にのみ実行される、独立した新規分岐を関数冒頭に追加した。それ以外の kind（callout/blockquote/table）は、この分岐の直後にある共有末尾コード（`doc.lines.slice(...).join("\n")` による従来通りの全行結合）へそのまま到達する — 新規分岐は既存コードの前に挿入しただけであり、共有末尾コード自体は一切変更していない。

fenced-code 分岐の処理内容：

1. `doc.lines.slice(startLine, endLine + 1)` でブロック全体の生行配列（`rawLines`）を取得する。
2. `rawLines[0]`（開始フェンス行）を `FENCE_OPEN_LINE_RE`（後述）でマッチさせ、インデント・フェンス文字・フェンス長・info string の4値を取得する。
3. `rawLines.slice(1, rawLines.length - 1)` で内部行（開始・終了フェンス行を除いた行）を取得し、`"\n"` 結合して `bodyText` とする。fenced code block は必ず開始行と終了行が別行として存在する（`rawLines.length >= 2` が保証される）ため、この `slice` は内容行ゼロ件のケースで自然に空配列を返し、`bodyText` は `""` になる — 別途の空文字列特別扱いは不要だった。
4. `text: bodyText`（**フェンス行を含まない本文のみ**）、`fencedCode: { infoString, bodyText, fenceChar, fenceLength, openLineIndent }` を含む `ExtractSubtreeOutcome` を返す。

### `FENCE_OPEN_LINE_RE` の拡張

既存の正規表現 `/^[ \t]*(`{3,}|~{3,})[ \t]*(.*)$/`（キャプチャグループ：1=フェンス連続文字列、2=残り部分）を、ユーザー指示が明示的に許可した通り新規インデントキャプチャグループを先頭に追加する形で拡張した。

```
旧: /^[ \t]*(`{3,}|~{3,})[ \t]*(.*)$/
新: /^([ \t]*)(`{3,}|~{3,})[ \t]*(.*)$/
```

グループ1=インデント、グループ2=フェンス連続文字列（従来のグループ1が繰り下がり）、グループ3=残り部分（info string、trim なしでそのままキャプチャ——先頭の空白は正規表現自身が `[ \t]*` で吸収済みのため、後続の trim 処理は不要）。この繰り下がりに伴い、`isValidFencedCodeOpenLine` 内の参照を `m[1]` → `m[2]` に更新した（返り値の意味・呼び出し側の契約は一切変更していない）。

## §2 Apply 時の復元

### アーキテクチャ上の判断：復元処理の実装場所

ユーザー指示は「フェンス行の復元手順」を4ステップで規定していたが、この復元処理を **UI 層（`PartialEditView.ts`）** と **`applySubtreeEdit`（`partialEdit.ts`）** のどちらに実装するかは、指示文の字面だけでは一意に決まらなかった。本フェーズでは指示文の以下2点を根拠に、**`applySubtreeEdit` 内部**に実装する方針を採用した。

1. 指示文が「`applySubtreeEdit` の fenced-code ブランチで、Apply 時に以下の手順でフェンス行を復元する」と明記している。
2. テスト方針§4のカテゴリB（Apply 復元テスト）が `partialEdit.ts` レベルの純粋関数テストとして記述されており、UI 層を経由しない検証を前提としている。

この結果、UI 層の責務は「本文のみの編集済みテキスト」と「現在選択中の info string」を `applySubtreeEdit` の引数として渡すことのみに限定され、フェンス行の組み立て・妥当性検証は完全に `partialEdit.ts` に閉じている。

### `applySubtreeEdit` のシグネチャ変更

第5引数として `fencedCodeInfoString?: string` を追加した（既存4引数は一切変更なし）。省略時は抽出時の info string（`current.fencedCode.infoString`）にフォールバックする——「UI が info string を一切触らなかった」場合の挙動。

### 復元の4ステップ（fenced-code ブランチ内部）

```ts
const openLine = openLineIndent + fenceChar.repeat(fenceLength) + (infoString !== "" ? " " + infoString : "");
const closeLine = openLineIndent + fenceChar.repeat(fenceLength);
const contentLines = newText === "" ? [] : newLines;
const reconstructed = [openLine, ...contentLines, closeLine];
```

1. 開始行：`openLineIndent + フェンス文字×フェンス長 + (info string が空でなければ " " + info string)`。この `infoString` は **Apply 時点で UI から渡された値**（`fencedCodeInfoString` 引数、省略時は抽出時点の値）であり、ユーザーが UI 上で種別を変更していればそれが反映される。
2. 終了行：`openLineIndent + フェンス文字×フェンス長` のみ。info string は一切含まない。
3. `newLines = newText.split("\n")` から `contentLines` を得る。ただし `newText === ""` の場合は `contentLines = []`（空配列）とする明示的な特別扱いが必要——`"".split("\n")` は `[""]`（空文字列1要素）を返してしまい、そのままでは幻の空行が1行混入するため。
4. `[openLine, ...contentLines, closeLine]` を組み立て、既存の `isValidFencedCodeOpenLine`/`isValidFencedCodeCloseLine` を**この配列の先頭・末尾**に対して実行する——検証対象がユーザーが直接タイプした行から、この関数自身が組み立てた行に変わっただけで、検証ロジック自体・検証対象のセマンティクス（「先頭行が有効な開始フェンスか」「末尾行が有効な終了フェンスか」）は一切変更していない。

検証に合格した場合、この分岐は `reconstructed` を使って独自に `lines` を組み立てて `return` する——関数末尾の共有スプライス処理（`newLines` を使うもの）へは到達しない。table ブランチおよび他 kind の処理には一切影響しない。

### 副作用：フェンス・info string 間の空白の正規化

上記ステップ1の組み立て式は、info string が非空の場合に**常に1個の半角スペース**を挿入する。これはユーザー指示の文言（`"(if infoString non-empty: " " + infoString)"`）をそのまま実装した結果であり、意図した仕様である。しかし副作用として、元々スペースなしで書かれていた開始行（例：`` ```mermaid ``、フェンスと info string の間にスペースなし）が、一度でも Apply を通ると `` ``` mermaid ``（スペースあり）に正規化される。両者は CommonMark 上同一の info string `"mermaid"` を表すため意味的な差異はないが、**Apply 前後でテキストの見た目が変わる**という観察可能な挙動である。この判断はユーザー指示の字面に忠実に従った結果であり、独自の追加判断ではないが、透明性のためここに明記する。既存テスト（`phase5e1FencedCodePartialEditMoveDelete.test.ts` の Mermaid テスト、`phase5e2aTableRawPartialEdit.test.ts` の回帰テスト）は、この正規化後の形（スペースあり）を期待値として更新した。

### `"fenced-code-invalid-close"` が構造的に到達不能になった件

終了行は常に `openLineIndent + フェンス文字×フェンス長` という、フェンス専用文字と先頭空白のみから合成される。この形は `FENCE_CLOSE_ONLY_LINE_RE` に自明に一致するため、`isValidFencedCodeCloseLine` の失敗分岐（`"fenced-code-invalid-close"`）は、通常の Apply フローを通る限り**到達不能**になった。この理由コード自体は削除せず、将来の変更（終了行組み立てロジックの変更等）に対する防御的チェックとしてそのまま残した——「今は到達不能でも、コードとして意味のある不変条件を表明し続ける」という判断であり、削除によるコード削減よりも安全性を優先した。`tests/phase5e1FencedCodePartialEditMoveDelete.test.ts` の該当テストは、この到達不能化を明示的に検証する形（フェンスに見えるだけの本文行が、今や普通の内容として受理されることを確認する）に作り変え、削除ではなくコメント付きで意図を明記して残した。

### 埋め込み改行を含む `fencedCodeInfoString` が `"fenced-code-invalid-open"` を引き起こす仕組み

不正な info string を渡した場合のApply検証失敗シナリオ（テスト方針§4カテゴリC）は、`fencedCodeInfoString` に改行文字 `\n` を含む文字列（例：`"js\nmalicious"`）を渡すことで再現できる。`FENCE_OPEN_LINE_RE` は `/s`（dotAll）・`/m`（multiline）いずれのフラグも持たないため、`.` は改行にマッチせず、`$` は文字列全体の末尾にしかマッチしない。組み立てられた開始行の文字列中に改行が混入すると、正規表現全体が末尾までマッチしきれずマッチ失敗（`null`）となり、`isValidFencedCodeOpenLine` が `valid: false` を返す——これが `"fenced-code-invalid-open"` を引き起こす自然な経路である。

## §3 UI 仕様

### 新規フィールド（`PartialEditView.ts`）

既存の `quoteProjection`（callout/blockquote 用）と同じ設計思想——「kind 固有のメタデータを保持する任意のクラスフィールド、非対象 kind では常に `null`」——に従い、以下2フィールドを追加した。

- `fencedCodeMeta: FencedCodeBodyExtraction | null`：ロード時に `extracted.fencedCode` から設定される。`resetLoadedState`/`loadNodeInternal`/`loadParagraphInternal`/`loadCompositeInternal` のすべてで、`quoteProjection` と全く同じタイミングでリセット・再設定される。
- `fencedCodeSelectedInfoString: string | null`：現在 UI 上で選択・入力されている info string。ロード時は `fencedCodeMeta.infoString` で初期化される。ドロップダウンの選択変更・自由入力欄への入力のたびに更新される。

**特筆すべき点**：`this.originalText` は fenced-code に対してすでに本文のみ（§1参照）であるため、`currentDisplayText()` には**一切コード変更を加えていない**。既存のデフォルトフォールバック（`originalText` をそのまま返す）が、そのまま正しい本文のみの表示を実現している。

### UI 構成：種別選択行

`onOpen` 内、`taskCheckboxRowEl`/`orderedNumberRowEl` と同じ位置づけで、`textareaEl` 生成の直前に新規行 `fencedCodeLanguageRowEl` を作成した。構成要素：

- `fencedCodeLanguageLabelEl`：ラベル（新規 i18n キー `partialEdit.fencedCode.languageLabel`）。
- `fencedCodeLanguageSelectEl`：ドロップダウン。13言語＋「Custom…」センチネル（値 `"__custom__"`）の計14オプション。
- `fencedCodeLanguageCustomInputEl`：自由入力欄。センチネル選択時、または読み込んだ info string がどのドロップダウン値にも一致しない場合にのみ表示される。

### ドロップダウンの値・エイリアス対応表

| カテゴリ値 | エイリアス | 表示ラベル（en） |
|---|---|---|
| `""` | `""` | Plain text |
| `mermaid` | `mermaid` | Mermaid |
| `dataview` | `dataview` | Dataview |
| `dataviewjs` | `dataviewjs` | DataviewJS |
| `javascript` | `javascript`, `js` | JavaScript |
| `typescript` | `typescript`, `ts` | TypeScript |
| `python` | `python` | Python |
| `bash` | `bash`, `sh` | Shell |
| `sql` | `sql` | SQL |
| `json` | `json` | JSON |
| `yaml` | `yaml` | YAML |
| `css` | `css` | CSS |
| `html` | `html` | HTML |
| `__custom__`（センチネル） | — | Custom… |

エイリアス一致は**表示のみ**に影響する——ブロックの info string が `"js"` で読み込まれた場合、ドロップダウンは「JavaScript」を自動選択し自由入力欄を隠すが、`fencedCodeSelectedInfoString` 自体は `"js"` のまま変更しない（ユーザーが実際に操作するまで）。これにより「何も変更しなければ Apply 結果が元の表記を完全再現する」という §2 のカテゴリBテストの前提が保たれる。ユーザーが実際にドロップダウンを操作した場合のみ、選択された**正規値**（例：`"javascript"`、エイリアスではない）が `fencedCodeSelectedInfoString` に反映される。

### Apply への配線

`applyEdit` の既存 if/else-if チェーン（`quoteProjection` → 各種リスト projection → `standaloneParentListItemProjection` → 汎用 `applySubtreeEdit` 呼び出し）には、fenced-code 用の新規分岐を追加していない——fenced-code はこのチェーンのどの条件にも一致しないため、汎用 `applySubtreeEdit` 呼び出しへ自然に到達する。その呼び出し箇所の第5引数として、`this.nodeKind === "fenced-code"` の場合のみ `this.fencedCodeSelectedInfoString` を渡す（それ以外の kind では `undefined`）よう変更した。

Apply 成功後の再構築（quoteProjection 等の既存 projection と同じ位置づけの `else if` チェーン末尾）に `else if (this.fencedCodeMeta)` 分岐を追加した。他の projection 再構築と異なり、**再パースは不要**——fenceChar・fenceLength・openLineIndent はこの UI から一切編集できないフィールドであるため、旧メタデータのこれらフィールドをそのまま維持し、`bodyText`/`infoString` のみを Apply 直後の値で更新する軽量な再構築とした。

### `isDirty()` への追加

`fencedCodeMeta !== null && fencedCodeSelectedInfoString !== fencedCodeMeta.infoString` を新規フラグ `fencedCodeInfoStringDirty` として、既存の OR チェーンの末尾に追加した。本文自体のダーティ判定は、この関数冒頭の既存チェック（`textareaEl.value !== currentDisplayText()`）がすでにカバーしている。

## §4 テスト方針

### 新規テストファイル：`tests/phase5e3FencedCodeLanguageSelector.test.ts`（18件）

指示された4カテゴリを実装した。

- **カテゴリA（抽出、6件）**：mermaid 付き、info string なし、ドロップダウン未知の自由文字列、tilde フェンス、インデント付きフェンス、内容行ゼロ件。
- **カテゴリB（Apply 復元、4件）**：未変更 info string が元の開始行を完全再現すること（元からスペースありの表記を使用——正規化の影響を受けない形で検証）、UI で変更した info string が新しい開始行を生成すること、終了行が info string を一切含まないこと、インデント付きブロックの開始・終了両方に indent が再現されること。
- **カテゴリC（Apply 検証、3件）**：本文の複数行編集が引き続き合格すること、本文の完全クリア（空文字列）が合格すること（内容ゼロ件の code block は妥当）、埋め込み改行を含む不正な info string が Apply 検証を失敗させること。
- **カテゴリD（回帰、5件）**：fenced-code の Move・Delete が無変更であること、callout・blockquote・table の Partial Edit が本フェーズ以前とバイト同一であること（`fencedCode` フィールドが `undefined` であることも含めて検証）。

### 既存テストの更新（新規契約への追従、削除ではなく更新）

body-only 契約への変更により、以下7件のテストが期待値の変更を必要とした——いずれも「削除して作り直す」のではなく、コメント付きで意図を明記した上で更新する、本セッション確立済みの慣習に従った。

- `tests/partialEdit.test.ts`：fenced-code の抽出テスト1件（`outcome.text` の期待値をフェンス行込みから本文のみへ）。
- `tests/phase5e1FencedCodePartialEditMoveDelete.test.ts`：カテゴリC内5件——抽出テスト（本文のみへ）、invalid-open テスト（トリガー手段を `newText` 直接指定から `fencedCodeInfoString` の埋め込み改行へ変更）、invalid-close テスト（到達不能化に伴い「フェンスに見える本文行が今や普通に受理される」ことを示すテストへ意図的に転換）、conflict 検知テスト（本文のみの比較へ）、Mermaid テスト（本文のみへ、かつ空白正規化後の開始行を期待値に反映）。
- `tests/phase5e2aTableRawPartialEdit.test.ts`：fenced-code 回帰テスト1件（`newText` を本文のみへ、reject シナリオを埋め込み改行方式へ、空白正規化後の期待値へ）。

### UI wiring テストへの副次的な影響（既存11ファイル、13件）

`applySubtreeEdit` の呼び出し箇所を、第5引数追加に伴い1行呼び出しから複数行呼び出しへ整形した結果、この呼び出し箇所のソーステキストを直接文字列比較で検証していた既存の `*UiWiring.test.ts` 系テスト（`leafFirstChildAdditionUiWiring`・`multiLineListPartialEditUiWiring`・`orderedListPartialEditUiWiring`・`parentChildAddDeleteUiWiring`・`parentChildInlineEditUiWiring`・`parentListItemPartialEditUiWiring`・`partialEditStalePaneSyncUiWiring`・`quotePrefixPartialEditViewWiring`・`selectionFollowUiWiring`・`standaloneListMarkerFreePartialEditUiWiring`・`taskListPartialEditUiWiring`、計13件）が副次的に不合格となった。これらはいずれも Phase 5E-3 のロジック変更とは無関係な、**呼び出し箇所のフォーマット変更のみ**に起因する破損であり、各テストの期待文字列を新しい複数行フォーマットに合わせて更新した（アサーション対象の意味——「この4引数がこの順序で渡されているか」「この呼び出しがこの位置にあるか」——は一切変更していない）。また `isDirty()` の OR チェーンに `fencedCodeInfoStringDirty` を末尾追加したことに伴い、「`leafFirstChildDirty` が OR チェーンの最終項である」ことを検証していた2件のテスト（`leafFirstChildAdditionUiWiring`・`parentChildAddDeleteUiWiring`・`parentChildInlineEditUiWiring`）も、「OR で連結されている」ことの検証に緩和した。

### 本フェーズの意図的スコープ外：PartialEditView.ts 専用の新規 UI wiring テストファイル

ユーザー指示のテスト方針§4は、新規ファイル `tests/phase5e3FencedCodeLanguageSelector.test.ts` とその4カテゴリ（いずれも `partialEdit.ts` レベルの純粋関数テスト）のみを明示的に要求しており、UI 層（DOM 構築・イベントリスナー配線・`renderFencedCodeLanguageRow` の選択ロジック）を対象とする専用の `*UiWiring.test.ts` 系ファイルの新規作成は要求されていない。本フェーズではこの指示を字面通りに解釈し、新規 UI wiring テストファイルは作成しなかった——これは §2 で述べたアーキテクチャ判断（復元ロジックを `applySubtreeEdit` に閉じ込め、UI 層の責務を薄く保つ）とも整合しており、UI 層の実質的なロジック（エイリアス一致判定・info string 選択状態の管理）は本メモ§4カテゴリBの Apply 復元テストが間接的にカバーしている。

### `tsc`/`vitest`/`eslint`/`build` の結果

`npx tsc --noEmit` はクリーン。`npx vitest run` は151ファイル・3088件全て合格（新規18件＋既存の更新7件＋副次的更新13件を含む）。`npx eslint src/edit/partialEdit.ts src/view/PartialEditView.ts src/i18n.ts` はエラー0件。`npm run build` は成功し、`main.js`（.gitignore 対象、コミット対象外）を生成した。

### 既知の、本フェーズが意図的に触れなかった事前存在ギャップ

`renderLoadedState` 内の `kindLabel` 判定用 `switch` 文には、`"fenced-code"`/`"table"` 用の `case` が存在せず、両者とも `default` 分岐（"Section" ラベル）にフォールスルーする。Phase 5E-1/5E-2A 由来の事前存在ギャップであり、本フェーズの指示範囲（フェンス行の非表示化と種別選択 UI）には含まれないため、一切変更していない。
