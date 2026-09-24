# fix/standalone-complex-move-adjacent-parity — design memo

## 1. 背景

実機テスト中、ユーザーが standalone な callout / blockquote ブロックの右クリックメニューに
Move up / Move down が出ないケースに気づいた。調査の結果、原因は
`src/parser/compositeBlocks.ts` の `evaluateStandaloneComplexBlockMovability` にあることが
判明した。この関数は、対象ブロックの直前／直後（空行スキップ後）に **別の standalone complex
block（callout/blockquote/fenced-code のいずれか）が存在すること** を Move eligible の必須
条件としていた（Phase 5C-3 の「A案」スコープ）。隣が段落やリスト項目である場合は
`findAdjacentStandaloneComplexBlock` が `null` を返し、`reason: "no-adjacent-compatible-unit"`
となって Move メニューが非表示になっていた。

一方、同じブロックのドラッグ＆ドロップ（D&D）は別の独立したロジック
（`src/move/findStandaloneComplexBlockDropTarget.ts` と
`src/edit/dropStandaloneComplexBlock.ts`、および呼び出し元
`src/view/OutlineTreeView.ts#calloutDropTargetHint`）で判定されており、こちらは段落や
（最上位／section 直下の）リスト項目に対してもドロップ先として解決できる、より柔軟な作りに
なっていた。この非対称性（D&D はできるのに Move コマンドは使えない）はドラッグハンドルが
付いているにもかかわらず Move コマンドが使えないという矛盾を生んでおり、ユーザーからの正式な
実装指示により、Move 側を D&D 側に合わせて拡張することとした。

## 2. D&D と Move の隣接解決ロジックの差分調査結果

着手前に `findStandaloneComplexBlockDropTarget.ts` / `dropStandaloneComplexBlock.ts` /
`OutlineTreeView.ts#calloutDropTargetHint` を読み、Move 側の
`findAdjacentStandaloneComplexBlock`（`compositeBlocks.ts`）と対照した結果は次の通り。

| 項目 | D&D（既存） | Move（拡張前） |
|---|---|---|
| callout/blockquote/fenced-code | 対象（source 側は callout/blockquote のみ。table は D&D でも対象外） | 対象 |
| 標準の段落（paragraph） | 対象（`calloutDropTargetHint`の`node.kind === "paragraph"`分岐） | **対象外** |
| 最上位／section 直下のリスト項目 | 対象（`calloutDropTargetHint`の`isOutlineListNode`分岐、nested は除外） | **対象外** |
| リスト item にネストされた候補 | 除外 | 除外（変更なし） |
| CompositeBlock のメンバー | 除外（`resolveStandaloneComplexBlockDropTarget`の`composite-internal-boundary`チェック） | 除外（変更なし） |
| セクション境界越え | 禁止（`not-same-section`） | 禁止（`different-section`。ただし見出し行自体がどちらの候補プールにも存在しないため、実際には`no-adjacent-compatible-unit`として先に弾かれる） |
| table | 対象外（読み取り専用のまま、変更なし） | 対象外（読み取り専用のまま、変更なし） |

差分は「段落」と「最上位／section 直下のリスト項目」の2点のみであり、これが今回拡張する範囲。

## 3. 変更方針

Move up/down の隣接条件を、D&D が既に許容している範囲（段落・standaloneなリスト項目）まで
拡張する。ステップ1（target 自身の kind/editability/nested-in-list チェック）、ステップ2
（composite member 除外チェック）、ステップ4（parentId の同一 section チェック）は変更せず、
ステップ3（隣接候補の解決）のみを変更した。

既存の `findAdjacentStandaloneComplexBlock`（callout/blockquote/fenced-code のみを認識する
狭い候補プール）はシグネチャ・実装・エクスポートとも一切変更していない。代わりに、新しい
資源解決関数 `findAdjacentStandaloneMoveNeighbor` を追加し、
`evaluateStandaloneComplexBlockMovability` と
`move/findStandaloneComplexBlockMoveTarget.ts#findStandaloneComplexBlockMoveTarget` の
両方の呼び出しをこちらへ切り替えた。これにより:

- 対象ブロック自身の kind 許可リスト（callout/blockquote/fenced-code。table は対象外のまま）は
  一切変更していない。
- 隣接候補としてのみ、`paragraph`（editability "supported"、非ネスト、非 composite member）と
  standalone なリスト項目（`parentId` が list 型ノードでない、かつ非 composite member）を
  追加で認識する。
- `isStandaloneComplexBlockShapeEligible`（`edit/deleteStandaloneComplexBlock.ts` の Delete
  機能も再利用している共有関数）には一切手を入れていない。Delete の隣接判定は今回のスコープ外。

書き戻し側（`edit/moveStandaloneComplexBlock.ts`）は `move/moveBlock.ts#swapBlocks` を
そのまま使っており、これは任意の長さの2レンジを入れ替え、間の空行ギャップをそのまま保持する
汎用実装だったため、変更不要だった（段落・リスト項目のように行数が異なる相手でも、手動で
切り取り・貼り付けした場合と同じ結果になることを、追加したテストで確認済み）。

## 4. 変更したファイル一覧

- `src/parser/compositeBlocks.ts`: `findAdjacentStandaloneComplexBlock` の直後に、
  `StandaloneComplexBlockAdjacentNeighbor` 型、`isStandaloneMoveAdjacentComplexCandidate`、
  `isStandaloneMoveAdjacentListItemCandidate`、`findAdjacentStandaloneMoveNeighbor` を新規追加。
  `evaluateStandaloneComplexBlockMovability` のステップ3を
  `findAdjacentStandaloneMoveNeighbor` 呼び出しに変更（addendum コメント付き）。
- `src/move/findStandaloneComplexBlockMoveTarget.ts`: import と本体の呼び出しを
  `findAdjacentStandaloneComplexBlock` から `findAdjacentStandaloneMoveNeighbor` へ変更
  （addendum コメント付き）。
- `src/model/complexBlock.ts`: `StandaloneComplexBlockMoveRejectionReason` の
  `"no-adjacent-compatible-unit"` 説明コメントに、2026-09-24 付きの addendum を追記
  （旧説明は削除せず残置）。
- `docs/fix_standalone-complex-move-adjacent-parity-design-memo.md`: 本ファイル（新規）。
- `CHANGELOG.md`: `## [Unreleased]` セクションに Fixed エントリを追加。
- `tests/standaloneComplexBlockMovability.test.ts`: トップコメントに addendum、
  「隣がリスト項目」「隣が段落」の2ケースを `eligible: true` へ更新（挙動が意図的に変わる
  ケースのため）。
- `tests/findStandaloneComplexBlockMoveTarget.test.ts`: 「隣がリスト項目のとき null」を
  「リスト項目の range に解決される」テストへ更新。
- `tests/standaloneComplexBlockMoveUiWiring.test.ts`: 「隣がリスト項目のとき false」を
  「true」へ更新。
- `tests/moveStandaloneComplexBlock.test.ts`: import 追加、新規 describe ブロック
  「ADDENDUM (2026-09-24) — adjacent parity with paragraph/list-item」を追加（後述）。

`complexMemberMoveUiWiring.test.ts` など、CompositeBlock のメンバー自身を対象にした既存
テストは、隣接候補が常にその composite 自身のアンカー list item（= composite member）である
ため、`isComposedMember` による除外が引き続き効いて挙動が変わらないことを確認済み（変更不要）。

## 5. 追加したテストケース一覧

`tests/moveStandaloneComplexBlock.test.ts` に追加した4ケース（実装指示の受入基準に対応）:

1. callout を直前の段落と Move up で入れ替え、空行ポリシー（1行）が保たれることを確認。
2. callout を直後のリスト項目と Move down で入れ替え、リスト項目の継続行がマーカー行と共に
   移動し崩れないことを確認。
3. blockquote を直前のリスト項目と Move up で入れ替えられることを確認。
4. セクション境界を越える方向への Move は、隣が段落であっても
   `eligible: false` / `reason: "no-adjacent-compatible-unit"` のまま no-op であることを、
   judge（`evaluateStandaloneComplexBlockMovability`）と executor
   （`moveStandaloneComplexBlock`）の両方で確認。

既存の「complex block 同士のスワップ」テストは全件変更なしで引き続き成功することを
`npx vitest run`（156ファイル・3246テスト、全件成功）で確認済み。

## 6. 既知の制約・今後の検討事項

- `table` は今回もスコープ外のまま（Phase 5E-1 の決定を踏襲、read-only）。table の Move/Delete/
  D&D は並行ブランチ `phase5e3d-table-move-delete-dnd` の対象であり、本チケットでは一切
  触れていない。
- ordered list のマーカー再採番（`move/moveBlock.ts#normalizeOrderedMarkers`）は、
  `moveStandaloneComplexBlock.ts` の `swapBlocks` 経路では従来どおり行われない（callout同士の
  スワップでも元々行われていなかった）。段落・リスト項目との入れ替えでも同様で、手動で
  切り取り・貼り付けした場合と同じ挙動であるため、今回はそのままとした。
