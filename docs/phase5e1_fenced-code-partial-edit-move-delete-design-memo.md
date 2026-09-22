# Phase 5E-1 設計メモ：fenced code block の raw Partial Edit・移動・削除

Phase 5E-0（`docs/phase5e0_fenced-code-table-tree-projection-design-memo.md`）で実装した読み取り専用Outline Tree投影と、Phase 5E-0.5（`docs/phase5e0_5_insert-framework-design-memo.md`）で定義した挿入フレームワークの型/スタブを土台とし、fenced code blockに限り「移動（前後兄弟との入れ替え）」「削除（ブロック全体の一括削除）」「raw Partial Edit（フェンス記法を含むMarkdownそのものを1編集単位として開く）」の3操作を実装する。table は本フェーズでは一切変更せず、引き続き読み取り専用のままとする。

対応する主なソース変更は `src/parser/compositeBlocks.ts`、`src/edit/moveStandaloneComplexBlock.ts`、`src/edit/deleteStandaloneComplexBlock.ts`（新規）、`src/edit/partialEdit.ts`、`src/tree/insertionFramework.ts`、`src/view/OutlineTreeView.ts`、`src/view/ConfirmFencedCodeDeleteModal.ts`（新規）、`src/i18n.ts`。テストは `tests/phase5e1FencedCodePartialEditMoveDelete.test.ts`（新規）に加え、既存テスト5件（後述）を実情に合わせて更新した。

## §1 操作対象の特定

### 移動：`moveStandaloneComplexBlock.ts` / `parser/compositeBlocks.ts` の変更点

移動操作は、Phase 5C-3が確立した「standalone callout/blockquoteの入れ替え」パイプラインをそのまま再利用し、対象kindを拡張する方式を取った。新しい移動エンジンは一切作っていない。

- `parser/compositeBlocks.ts` の `isStandaloneComplexBlockShapeEligible(doc, info)`：kind判定を `info.kind === "callout" || info.kind === "blockquote"` から `... || info.kind === "fenced-code"` に拡張した。それ以外（editability判定、list入れ子判定）は無変更。
- 同ファイルの `evaluateStandaloneComplexBlockMovability(...)` の先頭kindガードも同様に拡張し、fenced-codeを対象として通過させる。
- `edit/moveStandaloneComplexBlock.ts` の `StandaloneComplexBlockMoveKind` 型を `Extract<ComplexBlockKind, "callout" | "blockquote" | "fenced-code">` に拡張。
- 同ファイルの `buildStandaloneComplexBlockSnapshot(info)`：`info.kind !== "callout" && info.kind !== "blockquote"` の場合に `null` を返していたガードに `&& info.kind !== "fenced-code"` を追加し、fenced-codeのスナップショット構築を許可した。
- 同ファイルの `findRangeInvalidReason(...)` も同じ3kind許可リストに拡張。
- 実行本体の `moveStandaloneComplexBlock` 関数（実際にテキストをsplice/入れ替えする処理）と `snapshotMatches` は、いずれもkindに関する分岐を一切持たない汎用実装のため、**無変更のまま** fenced-codeにも正しく機能する。

この結果、移動操作は「開始フェンス行・本文・終了フェンス行」をまとめた `ComplexBlockInfo.range`（`scanComplexBlocks`が未閉鎖fenceを`editability: "unsupported"`または`"ambiguous"`として除外する既存ロジックをそのまま利用）を単位として、既存のcallout/blockquote入れ替えと全く同じ再パース→再スキャン→構造一致→再検証→実行のパイプラインで動作する。空行境界の保持も、既存の `moveStandaloneComplexBlock` 本体が持つ「移動元・移動先の行をそのまま入れ替える」処理により、callout/blockquoteと同一の保証が得られる。

### 削除：`edit/deleteStandaloneComplexBlock.ts`（新規モジュール）

削除操作については、**再利用すべき既存のstandalone callout/blockquote削除パイプラインがコードベース中に存在しないことが調査で判明した**（`showStandaloneComplexBlockMenu` はPhase 5E-1着手前まで「Open in Partial Edit」「Open in new window」「Move up」「Move down」のみを提供しており、削除項目は一度も実装されていない）。そのため、削除は完全新規のモジュール `src/edit/deleteStandaloneComplexBlock.ts` として実装した。ただし、その内部構造は既存の `moveStandaloneComplexBlock.ts`・`deleteCompositeBlock.ts`・`deleteParagraph.ts` が共通して持つ「再パース→再スキャン→構造一致（id不使用）→再検証→実行」の形をそのまま踏襲しており、**新規に考案したのはこの1モジュールの中身のみ**で、既存のeligibility判定（`isStandaloneComplexBlockShapeEligible`／`isComposedMember`）は無変更のまま再利用している。

この判断の詳細な経緯と、callout/blockquoteに削除機能を波及させなかった理由は §3 で述べる。

主なエクスポート：

- `StandaloneComplexBlockDeleteKind = "fenced-code"`（moveの `StandaloneComplexBlockMoveKind` より意図的に狭い、fenced-code専用のリテラル型）
- `buildStandaloneComplexBlockDeleteSnapshot(info)`：kindが`"fenced-code"`かつ`editability === "supported"`の場合のみスナップショットを構築
- `deleteStandaloneComplexBlock(text, snapshot, rules)`：削除の実行本体
- `standaloneComplexBlockDeleteReasonText(t, reason)`：拒否理由のi18n変換

削除は開始フェンス行から終了フェンス行までを1単位として一括削除し、部分削除は行わない。削除対象の確定に失敗した場合（`"boundary-changed"`：再スキャンで一致するブロックが見つからない、`"range-invalid"`：スナップショット自体が自己矛盾、`"not-supported"`：再検証でeligibleでなくなった、`"composite-member"`：再検証で複合ブロックのメンバーになっていた）は削除を拒否し、原文を一切変更しない（`changed: false`、`lines`は入力そのまま）。

### Partial Edit：`edit/partialEdit.ts` の変更点

- `SubtreeKind` 型に `"fenced-code"` を追加。
- `extractComplexBlockText(doc, complexBlock)`：kind判定を拡張し、fenced-codeかつ`editability === "supported"`の場合にブロック全体（開始フェンス行〜終了フェンス行）の生テキストを返すようにした。callout/blockquoteと全く同じ抽出ロジック（`doc.lines.slice(startLine, endLine + 1).join("\n")`相当）をそのまま通過する。
- `extractSubtreeText` は `extractComplexBlockText` を内部で呼び出す既存の分岐をそのまま利用するため、追加変更は不要だった。

Apply時の検証規則（`applySubtreeEdit`内の新規分岐）は §2 で述べる。conflict検知（Partial Edit Pane を開いた後に本文が外部で変更されていた場合の拒否）は、callout/blockquoteと全く同じ既存の汎用メカニズム（`current`の再抽出結果と、Paneが保持する開封時テキストとの不一致検出）をそのまま利用しており、fenced-code専用の追加ロジックは一切ない。

## §2 Apply 検証規則

raw Partial Edit の Apply 時、編集結果（`newLines: string[]`）に対して以下を検証する（`edit/partialEdit.ts` の `isValidFencedCodeOpenLine` / `isValidFencedCodeCloseLine` として実装）。

```ts
const FENCE_OPEN_LINE_RE = /^[ \t]*(`{3,}|~{3,})[ \t]*(.*)$/;
function isValidFencedCodeOpenLine(line: string): { valid: boolean; fenceChar: string; fenceLength: number } {
  const m = line.match(FENCE_OPEN_LINE_RE);
  if (!m) return { valid: false, fenceChar: "", fenceLength: 0 };
  return { valid: true, fenceChar: m[1][0], fenceLength: m[1].length };
}

const FENCE_CLOSE_ONLY_LINE_RE = /^[ \t]*(`+|~+)[ \t]*$/;
function isValidFencedCodeCloseLine(line: string, fenceChar: string, minLength: number): boolean {
  const m = line.match(FENCE_CLOSE_ONLY_LINE_RE);
  if (!m) return false;
  if (m[1][0] !== fenceChar) return false;
  return m[1].length >= minLength;
}
```

判定手順：

1. `newLines[0]`（編集結果の先頭行）が `FENCE_OPEN_LINE_RE` に一致しない場合、Apply を拒否し理由 `"fenced-code-invalid-open"` を返す。一致した場合、そのフェンス文字種（`` ` `` または `~`）と個数（3以上）を記録する。
2. 編集結果が2行未満、または末尾行が `FENCE_CLOSE_ONLY_LINE_RE` に一致しない場合、Apply を拒否し理由 `"fenced-code-invalid-close"` を返す。この正規表現は「フェンス文字のみで構成される行（前後の空白は許容するが、他に何も書かれていない行＝"だけの行"）」であることを要求する——ユーザー指示の「開始フェンスと同数以上のバッククォートのみの行」を字義通り実装したもの。
3. 末尾行のフェンス文字が開始フェンスと同じ文字種であること、かつ個数が開始フェンスの個数以上であることを要求する。

**既存スキャナー（`parser/complexBlocks.ts`の`FENCE_OPEN_RE`によるクローズ判定）との意図的な差異**：スキャナー自身のクローズ判定は「先頭のフェンス文字が一致するか」のみを見るゆるい判定であり、行の長さや「他に何もないか」までは検査しない。本Apply検証はそれよりも厳格であり、ユーザー指示の字義（「だけの行」）を優先して、スキャナーより厳しい基準を意図的に採用している。この差異はコード中のdoc commentに明記した。

conflict検知（Pane を開いた後に本文が外部変更されていた場合の拒否）は、callout/blockquoteが使う既存の汎用メカニズムをそのまま再利用しており、fenced-code専用の新規ロジックは持たない。

## §3 読み取り専用の残存対象

### table が引き続き読み取り専用である理由

table に関する投影ロジック・読み取り専用防御（`tree/buildOutlineTree.ts`の table 投影、`tree/resolveCurrentPositionNodeId.ts`の table 分岐）はユーザー指示により変更禁止であり、本フェーズでは一切触れていない。table を読み取り専用のまま維持するために変更した唯一の箇所は、`view/OutlineTreeView.ts` の1箇所の右クリックメニュー kindガード（後述）であり、このガードは元々 `(complexKind === "callout" || complexKind === "blockquote")` という**許可リスト**方式（このコードベース全体で一貫している、`!==`否定ではなく`===`肯定の許可リストで表現するスタイル）だったものに `"fenced-code"` を追加しただけであり、table は最初から許可リストに含まれていないため、このガードを変更した後も table は自動的に除外され続ける。

### `collectReadOnlyOutlineNodeIds` の変更内容についての判断

ユーザー指示は「`collectReadOnlyOutlineNodeIds` は table の complex-member ノードのみを読み取り専用集合に含め、fenced-code の complex-member ノードは含めないよう修正する」というものだった。しかし、この関数のkind包含ロジックを字義通り修正することは**行わなかった**。理由は以下の通りである。

`view/OutlineTreeView.ts` の `renderNode` を精査した結果、`readOnly`（`collectReadOnlyOutlineNodeIds`が返す集合に含まれるか否か）は「そのノードがPartial Edit/移動/削除といった機能を一切持てない」という意味ではなく、「汎用Tree操作サーフェス（ドラッグハンドルの表示、汎用ダブルクリックリネーム、汎用の任意ターゲットドラッグ&ドロップ並べ替え、汎用キーボードショートカット）から除外される」という意味であることが判明した。standalone callout/blockquoteは、Phase 5C-2以来ずっとこの読み取り専用集合に含まれ続けているにもかかわらず、`showStandaloneComplexBlockMenu`という専用の、`!readOnly`に依存しないコンテキストメニュー経路を通じて、Partial Edit・移動という完全な機能を持っている——これがこのコードベースの「二層防御」パターンの実体である（層1：読み取り専用集合が汎用サーフェスを遮断する。層2：許可された種別に限り、専用メニューが独立して安全性を再検証しながら機能を提供する）。

もし `collectReadOnlyOutlineNodeIds` を字義通り修正し、fenced-codeノードをこの集合から除外した場合、`renderNode` 内の複数の独立した `if (!readOnly)` 分岐（ドラッグハンドル要素の描画、汎用ダブルクリックによるリネーム開始、汎用の任意ターゲットドラッグ&ドロップ配線）が**同時に**有効化されてしまう。これらはいずれも本フェーズの指示に一度も現れておらず、特に「汎用の任意ターゲットドラッグ&ドロップ」は、ユーザー自身が明記した「移動は同一親の下での前後兄弟との入れ替えのみを許可する。異なる親・異なる section への移動は本フェーズの対象外とする」という制約と直接矛盾する（汎用ドラッグ&ドロップは任意ターゲットへの移動を許してしまうため）。

そのため、`collectReadOnlyOutlineNodeIds` のkind包含ロジックは**一切変更せず**、fenced-codeはcallout/blockquoteと全く同じ理由で、恒久的にこの読み取り専用集合に含まれたままとする方針を採った。fenced-codeがMove/Delete/Partial Editの完全な機能を得る経路は、callout/blockquoteと全く同じ、専用の`!readOnly`非依存メニュー（`showStandaloneComplexBlockMenu`）であり、この集合からの除外によってではない。この方針は、ユーザー指示が要求した**機能的な結果**（fenced-codeでMove/Delete/Partial Editが使える、tableは読み取り専用のまま）を100%達成しつつ、指示に無い副作用（汎用リネーム・汎用ドラッグ&ドロップの意図しない解禁）を避けるための、意図的な逸脱である。

### 実際に変更した唯一の箇所：`view/OutlineTreeView.ts` の1箇所のkindガード

`renderNode` 内、standalone complex-memberノード（`isComplexMember && node.isStandalone`）に対する右クリックメニュー接続の条件を、

```ts
(node.complexKind === "callout" || node.complexKind === "blockquote")
```

から

```ts
(node.complexKind === "callout" || node.complexKind === "blockquote" || node.complexKind === "fenced-code")
```

に拡張した。この1箇所のみが、ユーザー指示の「UI変更の仕様」節が触れた箇所のうち、実際に機能を変える変更である。同じファイル内の他の3箇所（複合ブロックメンバー行のメニュー接続ガード、および2箇所のドラッグ&ドロップ配線ガード）はいずれも意図的に無変更のままとした——複合ブロックメンバー行のガードはfenced-codeが複合ブロックのメンバーになることが構造上あり得ない（`DEFAULT_COMPOSITE_BLOCK_RULES`のいずれもfenced-codeを対象候補として収集しない）ため無関係であり、ドラッグ&ドロップの2箇所は本フェーズの明示的なスコープ外（「異なる親・異なる sectionへの移動は本フェーズの対象外」）である。

### `showStandaloneComplexBlockMenu` への追加：Delete項目

上記のkindガード拡張により、standalone fenced-code行は `showStandaloneComplexBlockMenu` に到達するようになった。同メニューにはPhase 5E-1で新たに「Delete」項目を追加したが、これは `target.kind === "fenced-code"` の場合にのみ表示されるようガードしており、callout/blockquoteの標準的な挙動には一切影響しない。これは、既存の削除機能をcallout/blockquoteに波及させる意図的な選択ではなく、単に「本フェーズが要求していない機能を、ついでに他のkindへも解禁しない」という既存コードベースの慎重な拡張方針（本メモ内の他の判断とも一貫する）に従ったものである。

## §4 Phase 5E-0.5 との接続

`src/tree/insertionFramework.ts` の `resolveInsertion` スタブに、`kind` が `"fenced-code"` および `"fenced-code-mermaid"` の場合の実装を追加した（`position`は`"before"`/`"after"`いずれにも対応）。`"table"`・`"heading"`・`"list-item"`は引き続きスタブのまま（呼び出すと throw する）で、Phase 5E-0.5の設計メモが定めた仕様（`§1`/`§3`）通りの実装である。

実装の要点：

1. `request.targetNodeId`を現在のドキュメントに対して`scanComplexBlocks`で再解決する。見つからない場合（idが古い、または空ドキュメントの場合を含む）は`{ ok: false, reason: "target-not-found" }`を返す。
2. 解決したブロックの`editability`が`"supported"`でない場合、そのブロック自身の`reason`（診断メッセージ）をそのまま転用して返す。
3. 挿入先行番号は、`position === "before"`なら対象ブロックの`range.startLine`、`"after"`なら`range.endLine + 1`。
4. 親が`"list"`ノードの場合、`listItemContentColumn`（`parser/listContentColumn.ts`——`edit/insertParagraph.ts`と共有する唯一の権威）でインデント列を算出し、`unsafeIndent`な親は`{ ok: false, reason: "unsafe-indent" }`で拒否する。親が`"section"`またはnullの場合はインデント0列。
5. 挿入するブロックの近い境界（対象ブロックに直接隣接する側）には常に空行を1行追加し、遠い境界（挿入によって新たに隣接することになる、既存のブロックとの境界）は、その隣接行が既に空行でない場合のみ空行を1行追加する（既存の空行を二重にしない）。

### 有効化したテスト

Phase 5E-0.5で `it.todo` として保留されていた `tests/phase5e05InsertionFramework.test.ts` 内の2件を、実装の完了に伴い有効化（`it.todo`→`it`）し、実際のアサーションを追記した。

- 「未閉鎖fenceのケース」：閉じフェンスを持たない```\ncode```のみのドキュメントに対し、`resolveInsertion({ kind: "fenced-code", position: "after", targetNodeId: ... }, text, undefined)`が`ok: false`を返すことを確認（対象ブロック自身の`editability`が`"unsupported"`または`"ambiguous"`になるため、そのブロックの`reason`がそのまま返る）。
- 「空文字列ドキュメントのケース」：空文字列のドキュメントに対し、いかなる`targetNodeId`を指定しても`{ ok: false, reason: "target-not-found" }`が返ることを確認。

またこれに伴い、同ファイル内の3件の既存テスト（Phase 5E-0.5当時「fenced-codeは常にthrowする」という前提で書かれていたもの）を実情に合わせて更新した：シグネチャ呼び出し可能性テストの対象kindを`"fenced-code"`から引き続きスタブのままの`"table"`に変更、「全kind×全positionでthrowする」テストの対象kindリストを`["table", "heading", "list-item"]`に縮小した上で、fenced-code/fenced-code-mermaidがthrowしない（構造化された結果を返す）ことを確認する新規テストを追加した。throwメッセージ自体の文言（`"(Phase 5E-0.5 stub)"`）は、tableに対する既存テストの正規表現アサーションと完全に一致させるため、変更していない。
