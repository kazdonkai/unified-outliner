# Phase 5E-2A 設計メモ：Markdown table の raw Partial Edit・Apply 検証・安全な書き戻し

Phase 5E-0（`docs/phase5e0_fenced-code-table-tree-projection-design-memo.md`）で実装した読み取り専用Outline Tree投影、Phase 5E-0.5（`docs/phase5e0_5_insert-framework-design-memo.md`）で定義した挿入フレームワークの型/スタブ、Phase 5E-1（`docs/phase5e1_fenced-code-partial-edit-move-delete-design-memo.md`）でfenced code blockに実装した「raw Partial Editをブロック全体1編集単位として開く」パターンを土台とし、本フェーズではMarkdown table（GFM形式のパイプテーブル）に限り「Outline Treeからraw Partial Editを開く」「Apply時にtableとして最小限に妥当な構造かどうかを検証し、不合格なら原文を変更せず拒否する」の2操作のみを実装する。table の移動・削除・新規挿入UI・セル単位編集・Table Mode（GUI的な表編集）は本フェーズの対象外であり、一切実装していない。

対応する主なソース変更は `src/edit/partialEdit.ts`、`src/i18n.ts`、`src/view/OutlineTreeView.ts`、`src/tree/insertionFramework.ts`。テストは `tests/phase5e2aTableRawPartialEdit.test.ts`（新規）に加え、既存テスト3件（後述）を実情に合わせて更新した。

## §1 操作対象の特定

### `edit/partialEdit.ts` の変更箇所

Phase 5E-1がfenced-codeに対して行ったのと全く同じ方式——専用の新規編集エンジンを作らず、既存の`extractComplexBlockText`/`extractSubtreeText`のkind許可リストを拡張する方式——をtableにもそのまま適用した。

- `SubtreeKind` 型（`"section" | "list" | "callout" | "blockquote" | "fenced-code"`）に `"table"` を追加。
- `extractComplexBlockText(doc, complexBlock)`：kind判定の条件式（`complexBlock.kind === "callout" || complexBlock.kind === "blockquote" || complexBlock.kind === "fenced-code"`）に `|| complexBlock.kind === "table"` を追加した。これにより、`editability === "supported"` なtableブロックについて、ヘッダー行から最終データ行までの生テキスト（`doc.lines.slice(startLine, endLine + 1).join("\n")`相当）がそのまま1つの編集単位として返るようになる。callout/blockquote/fenced-codeと全く同じ抽出ロジックを通過するのみで、table専用の抽出処理は一切追加していない。
- `extractSubtreeText` は `extractComplexBlockText` を呼び出す既存の分岐をそのまま利用するため、この関数自体への追加変更は不要だった（Phase 5E-1と全く同じ経緯）。

### table 許可の前提条件（admission condition）

table がPartial Editの対象になるのは、`parser/complexBlocks.ts`の`scanTableBlocks`が確定させた`ComplexBlockInfo`の`editability`が`"supported"`である場合のみである。`editability`の判定条件（ヘッダー行と区切り行の列数一致など）自体はPhase 5E-0/5Cで既に確立済みであり、本フェーズでは一切変更していない。tableの`range`（`{startLine, endLine}`）は境界に空行を一切含まない——ヘッダー行から連続する最終データ行までのみを指す——ことをスキャナーのソースで確認済みであり、Partial Editが展開する範囲もこれに完全に一致する。

### fenced-code との実装上の差異について

Phase 5E-1のfenced-codeは、Apply検証が「開始フェンス行・終了フェンス行という2つの境界行の整合性」のみを見る、行数に依存しない検証だった。これに対しtableのApply検証（§2）は、「全行が共通の列数を持つか」という、**編集結果の行数・各行の内容全体に依存する構造検証**であり、性質が異なる。このためtable用の検証ロジックは、fenced-codeの`isValidFencedCodeOpenLine`/`isValidFencedCodeCloseLine`とは独立した、新規の2つのヘルパー関数（`splitPipeRowForValidation`・`isValidTableDelimiterRow`）として実装した。ただし「`applySubtreeEdit`内で、対象kindごとに独立した検証ブロックを置き、不合格なら`{changed: false, lines: doc.lines, newStartLine: -1, reason: ...}`を返す」という制御構造自体はfenced-codeの検証ブロックと完全に同型であり、この意味では新規の編集エンジンではなく既存パターンの踏襲である。

`splitTableRow`（`parser/complexBlocks.ts`内、モジュール非公開）と同等のセル分割処理を行う`splitPipeRowForValidation`を`partialEdit.ts`側に独自実装した。これはインポートではなく意図的な再実装であり、fenced-code検証の`FENCE_OPEN_LINE_RE`がスキャナー側の`FENCE_OPEN_RE`を再実装せず独自定義したのと同じ、このコードベースで確立された慣習に従ったものである（スキャナー側の受理判定とApply検証側の受理判定は目的が異なるため独立して保守する）。

### i18n：4つの新規拒否理由キー

`NoApplySubtreeEditReason`型に `"table-too-few-lines" | "table-missing-pipe" | "table-invalid-delimiter" | "table-column-mismatch"` の4リテラルを追加し、`src/i18n.ts`の`en`/`ja`両方に対応するキーを追加した（既存キーの変更・削除は一切行っていない）。

## §2 Apply 検証規則

raw Partial Edit の Apply 時、編集結果（`newLines: string[]`）に対して以下の4検証を**この順序で**行い、最初に不合格となった時点でApplyを拒否し、原文（`doc.lines`）を一切変更せずに返す（`changed: false`）。実装は`edit/partialEdit.ts`の`applySubtreeEdit`内、`current.kind === "table"`の分岐。

```ts
function splitPipeRowForValidation(line: string): string[] {
  let body = line.trim();
  if (body.startsWith("|")) body = body.slice(1);
  if (body.endsWith("|")) body = body.slice(0, -1);
  return body.split("|").map((c) => c.trim());
}

const TABLE_DELIMITER_CELL_RE = /^:?-+:?$/;
function isValidTableDelimiterRow(line: string): boolean {
  const cells = splitPipeRowForValidation(line);
  if (cells.length === 0) return false;
  return cells.every((cell) => TABLE_DELIMITER_CELL_RE.test(cell));
}
```

### 検証1：行数

`newLines.length < 3` の場合、拒否理由 `"table-too-few-lines"`。ヘッダー行・区切り行・データ行1行以上の最低3行を要求する。

拒否メッセージ（日本語）：「Unified Outliner: table にはヘッダー行・区切り行・データ行の最低3行が必要である。」

### 検証2：パイプ文字の存在

`newLines.every((line) => line.includes("|"))` が偽の場合、拒否理由 `"table-missing-pipe"`。全行に最低1つの`|`文字が含まれることを要求する。

拒否メッセージ（日本語）：「Unified Outliner: table の全行に少なくとも1つの「|」文字が含まれている必要がある。」

### 検証3：区切り行（2行目）の妥当性

`isValidTableDelimiterRow(newLines[1])` が偽の場合、拒否理由 `"table-invalid-delimiter"`。2行目を`splitPipeRowForValidation`で分割・トリムした各セルが、正規表現 `/^:?-+:?$/`（前後に任意のコロン1個、中央にハイフン1個以上、他に何もない）に一致することを全セルについて要求する。セルが0個（分割結果が空配列）の場合も不合格とする。

拒否メッセージ（日本語）：「Unified Outliner: 2行目は有効な区切り行（各列がハイフン1文字以上、前後に任意のコロンを許可し、他に何もないこと）である必要がある。」

### 検証4：列数の一致

`newLines.map((line) => splitPipeRowForValidation(line).length)` で各行の列数を算出し、全行が先頭行と同じ列数でない場合、拒否理由 `"table-column-mismatch"`。`splitPipeRowForValidation`が先頭・末尾のパイプの有無を正規化してから分割するため、`| a | b |`のような前後パイプ付き記法と`a | b`のような前後パイプなし記法は、同じ2列として扱われ、混在していても列数不一致とは判定されない。

拒否メッセージ（日本語）：「Unified Outliner: すべての行の列数が一致している必要がある。」

### 検証5：conflict検知

Partial Edit Pane を開いた後に本文が外部で変更されていた場合の拒否は、callout/blockquote/fenced-codeが使う既存の汎用メカニズム（`applySubtreeEdit`内、`current`の再抽出結果とPaneが保持する開封時テキストとの不一致検出）をそのまま再利用しており、table専用の新規conflict検知ロジックは一切追加していない。ユーザー指示が要求した「既存メカニズムの完全再利用」をそのまま満たす。

## §3 読み取り専用の残存範囲

### table の移動・削除が本フェーズの対象外である理由

ユーザー指示により、table の移動・削除・新規挿入UI・セル単位編集・Table Modeは明示的に本フェーズの対象外とされている。この対象外方針は、コード変更を一切加えないことによってではなく、**既存の、Phase 5E-1でも一切変更されなかった2つの独立したkind許可リストが、そのまま自動的にtableを除外し続けることによって**実現されている。

- `src/edit/moveStandaloneComplexBlock.ts`の`StandaloneComplexBlockMoveKind`型は`Extract<ComplexBlockKind, "callout" | "blockquote" | "fenced-code">`のまま——Phase 5E-1がfenced-codeを追加した際の状態から本フェーズは一切変更していない。この型が`"table"`を含まないため、`buildStandaloneComplexBlockSnapshot`はtableに対して恒久的に`null`を返し続け、Move up/downはtableに対して機能しない。
- `showStandaloneComplexBlockMenu`のDelete項目の表示ガード（`target.kind === "fenced-code"`）も同様に一切変更していない。tableはこの条件に一致しないため、Delete項目自体が表示されない。

つまり本フェーズがtableに新たに与えた機能は「Open in Partial Edit」1つのみであり、Move/Deleteという既存の2つの許可リストには一切手を加えていないため、tableは自動的にこれらの機能から除外され続ける。これはPhase 5E-1がfenced-codeに対して確立した「許可リストへの追加のみで機能を波及させ、無関係な許可リストは触らない」という設計原則を、そのままtableにも適用した結果である。

### `collectReadOnlyOutlineNodeIds` を無変更のまま維持する判断

ユーザー指示は本関数を「意図的に無変更のまま」とすることを明示的に要求しており、Phase 5E-1が確立した二層防御パターン（層1：`collectReadOnlyOutlineNodeIds`が汎用Tree操作サーフェス——ドラッグハンドル表示、汎用ダブルクリックリネーム、汎用の任意ターゲットドラッグ&ドロップ——を遮断する。層2：許可された種別に限り、`showStandaloneComplexBlockMenu`という専用の`!readOnly`非依存経路が、各機能ごとに独立したkind許可リストで安全性を再検証しながら機能を提供する）の理解に基づく判断でもある。

table のcomplex-memberノードは、本フェーズの前後を通じて一貫してこの読み取り専用集合に含まれ続ける。これにより、table行に対する汎用ドラッグハンドル・汎用ダブルクリックリネーム・汎用の任意ターゲットドラッグ&ドロップ並べ替えは、Partial Edit機能の解禁後も一切有効化されない。table が新たに得る「Open in Partial Edit」は、この読み取り専用集合からの除外によってではなく、次で述べる専用メニュー経由の1点のみの機能追加として実現される。

### 実際に変更した唯一のUI箇所：`view/OutlineTreeView.ts` の1箇所のkindガード

`renderNode`内、standalone complex-memberノードに対する右クリックメニュー接続条件を、Phase 5E-1時点の

```ts
(node.complexKind === "callout" || node.complexKind === "blockquote" || node.complexKind === "fenced-code")
```

から

```ts
(node.complexKind === "callout" || node.complexKind === "blockquote" || node.complexKind === "fenced-code" || node.complexKind === "table")
```

に拡張した。この1箇所のみが、本フェーズがOutline Tree UIに加えた唯一の機能変更である。拡張後、このガードの許可リストは`tree/buildOutlineTree.ts`の`isStandaloneComplexBlockEligible`自身の許可リスト（`includeFencedCode`/`includeTables`オプションで制御される投影対象kind）と完全に一致する状態になった。

`showStandaloneComplexBlockMenu`メソッド自身の内部には、このガード拡張に伴うコード変更は一切不要だった——「Open in Partial Edit」項目はもともとkind非依存（対象が`extractSubtreeText`で解決できさえすれば動作する）であり、Move/Deleteは前述の通り別モジュールの許可リストによって既にtableを除外しているため、このメソッドの内部ロジックへ到達したtable行は「Open in Partial Editのみ表示・Move/Deleteは表示されない」という結果に自然に落ち着く。

### "Move up"/"Move down"/"Delete" が table に対して引き続き非表示である確認

`tests/phase5e2aTableRawPartialEdit.test.ts`のカテゴリDにて、`buildStandaloneComplexBlockSnapshot(tableInfo)`が`null`を返すこと（Move不可）、`tableInfo.kind !== "fenced-code"`であることを根拠にDelete項目が表示されないこと、`collectReadOnlyOutlineNodeIds`の返す集合に引き続きtableノードが含まれることの3点を明示的にテストしている。

## §4 Phase 5E-0.5 との接続

`src/tree/insertionFramework.ts`の`resolveInsertion`スタブに、`kind`が`"table"`の場合の実装を追加した（`position`は`"before"`/`"after"`いずれにも対応）。`"heading"`・`"list-item"`は引き続きスタブのまま（呼び出すとthrowする）。

### 実装方式：生コンテンツ行配列への汎用化

Phase 5E-1時点の実装は、fenced-code専用に「開始フェンス行・終了フェンス行」という2行を直接組み立てるコードだった。本フェーズでは、このブロック内容構築部分を、kindに応じた`rawContentLines: string[]`配列を先に確定し、そのあとでインデント接頭辞を`.map((line) => \`${prefix}${line}\`)`により一括付与する形に汎用化した：

```ts
const rawContentLines: string[] =
  request.kind === "table"
    ? ["| Header |", "| --- |", "|  |"]
    : [`\`\`\`${request.kind === "fenced-code-mermaid" ? "mermaid" : ""}`, "```"];
const blockLines = rawContentLines.map((line) => `${prefix}${line}`);
```

table の初期テンプレートは、ヘッダー行・区切り行・空データ行1行の計3行——検証1（最低3行）を初期状態から満たす、最小限に妥当な形——とした。これ以外の`insertAtLine`算出処理・近い境界/遠い境界の空行パディング処理は、fenced-codeの2行コンテンツと完全に共有された既存ロジックであり、table用に一切変更していない。

### 実装の要点（table・fenced-codeで共有）

1. `request.targetNodeId`を現在のドキュメントに対して`scanComplexBlocks`で再解決する。見つからない場合は`{ ok: false, reason: "target-not-found" }`を返す。
2. 解決したブロックの`editability`が`"supported"`でない場合、そのブロック自身の診断理由をそのまま転用して返す。
3. 挿入先行番号は、`position === "before"`なら対象ブロックの`range.startLine`、`"after"`なら`range.endLine + 1`。
4. 親が`"list"`ノードの場合、`listItemContentColumn`でインデント列を算出し、`unsafeIndent`な親は`{ ok: false, reason: "unsafe-indent" }`で拒否する。親が`"section"`またはnullの場合はインデント0列。
5. 挿入するブロックの近い境界には常に空行を1行追加し、遠い境界は、その隣接行が既に空行でない場合のみ空行を1行追加する（既存の空行を二重にしない）。この安全規則は`blockLines`の行数に依存しない汎用処理であり、fenced-codeの2行・tableの3行のいずれに対しても同一に適用される。

### 有効化したテスト

Phase 5E-0.5で保留されていた`it.todo`のうちtableに関するものは既にPhase 5E-1到達時点で消化済みであり、本フェーズで新たに有効化した`it.todo`はない。代わりに`tests/phase5e05InsertionFramework.test.ts`内の4件の既存テスト（Phase 5E-1時点で「tableは引き続きスタブ」という前提で書かれていたもの）を実情に合わせて更新した：シグネチャ呼び出し可能性テストの対象kindを`"table"`から引き続きスタブのままの`"heading"`に変更、「全kind×全positionでthrowする」テストの対象kindリストを`["heading", "list-item"]`に縮小、「fenced-code/fenced-code-mermaidはthrowしない」テストの対象kindリストに`"table"`を追加、throwメッセージ文言の確認テストの対象kindを`"table"`から`"heading"`に変更した。throwメッセージ自体の文言（`"(Phase 5E-0.5 stub)"`）は変更していない。

新規`tests/phase5e2aTableRawPartialEdit.test.ts`のカテゴリEにて、table「before」（近い境界=対象ブロックのstartLine側、遠い境界=挿入によって新たに隣接する側の双方が空行でパディングされるケース）と table「after」（近い境界のみパディングが必要で、遠い境界は既存の空行によりパディング不要なケース）の2パターンを、`insertAtLine`と`insertText`の完全一致アサーションで検証している。
