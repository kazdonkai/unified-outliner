# Phase 5L-5: Leaf List Item Blank-Line Continuation Projection

対象リポジトリ: `unified-outliner-public`
関連: `docs/統合実装ロードマップ_2026-08-05.md` §3.18（本ドキュメントの実装確定事項の正）、`docs/phase5l4_multiline-leaf-list-partial-edit-projection.md`（Phase 5L-4、本チケットが唯一拡張する対象モジュール）

## 1. 位置づけ — Phase 5L-4 との責務分離

Phase 5L-4（既存・無変更）は、child list・ComplexBlock を持たない standalone MULTI-LINE leaf list item（unordered/task/ordered の3 kind）について、marker/checkbox/number を本文編集欄（Partial Edit Pane の共有 `textareaEl`。以下このファイルで単に「本文編集欄」と呼ぶ）から分離する投影を実現した。その `edit/multiLineListItemProjection.ts` は、continuation 本文の**途中**（末尾ではない）に blank line がある場合をすでに正しく往復させていた——空行は編集済み本文の中で単なる空文字列の1行として扱われ、Apply 時も特別な indentation を付与せずそのまま空行として書き戻される。

しかし、**編集済み本文の末尾**にユーザーが blank line を残したまま Apply すると、未対応の隙間があった。`invertMultiLineListItemProjection` は編集後の全 continuation 行を無条件に候補テキストへ書き戻していたため、末尾に blank line が残っていればその blank line も候補テキストの最終行になる。ところが `validateMultiLineListItemCandidate` が候補を再パースする際、`parser/parseDocument.ts` 自身の list item range 確定処理は「末尾の blank line を決して item 自身の range に含めない」という実挙動を持つため、再パース結果の `range.endLine` は候補テキストの最終行番号より必ず小さくなり、`range.endLine === candidateLines.length - 1` という既存の一致チェックが常に失敗する。その結果、ユーザーが継続本文の末尾にたまたま改行を1つ残しただけの無害な編集が、`"unsafe-structure"` として毎回誤って拒否されてしまう。

Phase 5L-5 は、この一点のみを修正する。責務分離は次の通り。

| | Phase 5L-4（既存・無変更） | Phase 5L-5（本チケット） |
| --- | --- | --- |
| 1行目の marker/checkbox/number/delimiter の解析・復元 | `edit/listMarkerProjection.ts`/`edit/taskListProjection.ts`/`edit/orderedListProjection.ts` への委譲 | **無変更**——引き続き同じ3モジュールへそのまま委譲する |
| continuation 行の canonical indent 方針 | `edit/multiLineListItemProjection.ts` 自身が算出・付与 | **無変更** |
| 途中（末尾ではない）の blank line | すでに正しく往復（空行のまま、indent なし） | **無変更**——今回一切触れていない |
| 編集後本文の**末尾**に残る blank line | 無条件にそのまま候補へ書き戻され、再パース不一致で誤って `"unsafe-structure"` 拒否 | **新規**——`trimTrailingBlankContinuationLines` により候補生成前に取り除く |
| blank line 直後に ComplexBlock が続く場合の検出 | `hasComplexBlockInMultiLineListItemContinuation`（`node.range` 内をスキャン） | **無変更**——実機確認の結果、既存実装のまま正しく検出することを確認済み |
| blank line 直後に nested child list が続く場合の検出 | `isStandaloneMultiLineLeafListItemEligibleForProjection` の `childIds.length === 0` | **無変更**——同上 |
| 新規 projection モジュール | — | **追加していない**——`edit/multiLineListItemProjection.ts` 自身の責務のみを拡張 |

## 2. 実装前の実機挙動確認（設計指示 §6 に基づく）

実装着手前に、2本の使い捨て probe テストファイル（`tests/__probe.test.ts`・`tests/__probe2.test.ts`、実際の `parseDocument`/`scanComplexBlocks` の出力をダンプするだけの一時ファイル、確認後に削除済み）で、blank line を含む list item の実際のパーサー挙動を直接確認した。確認できた事実は次の3点。

1. **list item 自身の `range` は、末尾の blank line（複数可）を決して含めない。** その後に続くものが文書末・sibling item（同一または浅い indent）・見出し・dedent した段落のいずれであっても同じで、unordered/task/ordered いずれの kind でも同一の挙動だった。
2. **blank line の直後に非空行が続く場合（callout/blockquote/fenced code/table のような ComplexBlock を含む）、その blank line は item 自身の `range` に取り込まれる。** 末尾ではなく、より多くの内容が後続するため trim されない。
3. **blank line の直後により深い indentation の list-marker 行が続く場合、正真の nested child list item として認識される**（`childIds` が populate される）。

(1) が、Phase 5L-5 が対処する唯一のギャップの直接の原因である。(2)(3) は、Phase 5L-4 の既存ゲート（`hasComplexBlockInMultiLineListItemContinuation`・`childIds.length === 0` チェック）がすでに正しく処理することが、この実機確認と、後述する新規テストの両方で確認できたため、新しいロジックの追加は不要だった。

## 3. blank line の canonical serialization 契約

- **本文編集欄（Partial Edit Pane の共有 `textareaEl`）内での表現**: Phase 5L-4 の既存契約のまま無変更。blank continuation line は、editable body 内では単なる空文字列の1行として表現され、canonical indent は一切付与されない（build 時に剥離するものが無く、Apply 時も空行に indentation を synthesize しない）。
- **途中（interior）の blank line**: 前後に非空の continuation 行が存在する blank line。無条件にそのまま候補へ書き戻す——Phase 5L-4 の既存挙動のまま、今回変更していない。
- **末尾（trailing）の blank line**: 編集後本文の**最後**から連続する blank 行の並び。新規ヘルパー `trimTrailingBlankContinuationLines(continuationLines: readonly string[]): string[]` が、`invertMultiLineListItemProjection` が候補の continuation 行配列を組み立てる直前に、この末尾の連続 blank 行をすべて取り除く（新しい配列を返す純粋関数で、入力配列は変更しない）。全 continuation 行が blank（または continuation 行が0本）に帰着した場合は、既存の「単一行候補への収束」経路（`- 一行目のみ` のような1行だけの raw text）へそのまま自然に合流する。
- **なぜ「保持」ではなく「除去」を選んだか**: real parser 自身が末尾 blank line を item の一部として決して認識しない（§2 の(1)）以上、それを候補側で保持しても実際の Markdown 上の意味は一切変わらない——rendering にも影響しない、完全に無害な差分である。除去することで、候補テキストの構造が real parser の実際の解釈と常に一致し、`validateMultiLineListItemCandidate` の再パース照合が誤検知しなくなる。これは、continuation indentation について Phase 5L-4 がすでに採用している「文書ごとに異なりうる曖昧な実際の形式を推測せず、確認済みの安全な canonical 形式へ正規化する」という設計原則をそのまま踏襲するものである。

## 4. 既存 first-line projection の再利用方法

変更していない。`buildMultiLineListItemProjection`/`invertMultiLineListItemProjection` はいずれも、項目自身の1行目を `buildListMarkerProjection`/`buildTaskListProjection`/`buildOrderedListProjection` とその対応する `invert*Projection` へそのまま委譲する既存の経路を、Phase 5L-4 からそのまま引き継いでいる。blank line の扱いはすべて2行目以降の continuation 行にのみ関わる処理であり、1行目の marker/checkbox/number/delimiter の解析・復元ロジックには一切触れていない。

## 5. candidate reparse による構造安全性の確認方法

`validateMultiLineListItemCandidate` 自体は無変更のまま維持している。`trimTrailingBlankContinuationLines` によって、そこへ渡される候補テキストが常に「real parser が実際に item の一部と認識する行だけ」で構成されるようになった結果、この既存の再パース検証（line 0 の list node 存在・kind 一致・range 一致・`childIds.length === 0`・`unsafeIndent` でないこと・continuation 部分に disallowed ComplexBlock が重ならないこと、の6条件）が、blank line を含む編集についても誤検知なく機能するようになった。§2 で確認した(2)(3)のケース——blank line の直後に ComplexBlock や nested child list が続く場合——は、この既存の6条件のうち `childIds.length === 0` と disallowed ComplexBlock 非重複チェックによって、変更なしでそのまま `"unsafe-structure"` として正しく拒否されることを、新規の統合テストで実際のコードに対して確認した。

## 6. structured projection が有効になる条件

Phase 5L-4 の既存条件（`docs/phase5l4_multiline-leaf-list-partial-edit-projection.md` §3）に変更はない。blank line を含む continuation を持つ item も、以下をすべて満たせば構造化 projection の対象になる。

1. `extractSubtreeText` の結果が `kind === "list"` であること。
2. 3つの既存 single-line 投影がすべて `null` であること。
3. `isStandaloneMultiLineLeafListItemEligibleForProjection` が `true`（子リストを持たず、`unsafeIndent` でなく、`range` が複数行にまたがる）。
4. `hasComplexBlockInMultiLineListItemContinuation` が `false`（continuation 行のいずれにも callout/blockquote/fenced-code/table/thematic-break が重ならない——blank line の直後に続く場合を含む）。
5. `buildMultiLineListItemProjection` が `ok: true` を返すこと。

blank line 自体は、これら5条件のいずれの判定にも新しい特別扱いを追加していない——(1)(2)(3) の実機挙動により、既存の条件がそのまま正しく機能する。

## 7. raw fallback 条件と Apply 拒否条件の区別

Phase 5L-4 と同じ区別を維持している。

- **raw fallback（BUILD 時点、Apply を一切妨げない）**: 子リストを持つ親item、continuation に callout/blockquote/fenced-code/table/thematic-break を含む item（blank line の直後に続く場合を含む）、malformed indentation、unsafeIndent、1行目が3 kind いずれの投影としても成立しない item。これらはいずれも editor が raw テキストをそのまま表示し、既存の raw Partial Edit で引き続き編集できる。
- **Apply 拒否（読み込み時点では投影できていたが、編集内容が安全に書き戻せない場合）**: `"invalid-number"`（ordered number 検証失敗）と `"unsafe-structure"`（`validateMultiLineListItemCandidate` 失敗）の2種類のみ。blank line を挟んだ編集で新たに nested child list や callout/blockquote/fenced-code/table を生成しようとした場合は、`"unsafe-structure"` として Apply 全体が拒否され、checkbox・number・本文いずれの draft も編集直後のまま保持される。
- **blank-line-then-sibling-item / blank-line-then-heading は、raw fallback でも Apply 拒否でもない**: §2 の(1)により、これらのケースでは blank line 自体とそれに続く sibling item・heading のいずれも当該 item 自身の `range` に含まれない。item は blank line 以前の内容のみで完結する通常の(単一段落の) leaf item として通常どおり構造化 projection・Apply の対象になり、blank line 以降の内容には一切変更が及ばない——これが、設計指示が求める「既存 parser の実挙動に整合する安全側の結果」である。

## 8. fixture 配置方針

Phase 5L-4 と同じ方針を維持している（プロジェクトメモリ `unified-outliner-verification-fixture-placement-policy.md` 参照）。本チケットの実機検証用 fixture は `/Users/kazumikaizuka/Obsidian/ipad-test/Test/blank-line-list-marker-free-verification.md` として配置し、リポジトリ内やその他 vault への複製は行わない。

## 9. 変更・追加したファイル

- `src/edit/multiLineListItemProjection.ts`（既存・拡張）: 新規ヘルパー `trimTrailingBlankContinuationLines` の追加、`invertMultiLineListItemProjection` の候補生成箇所への組み込み、および top-of-file doc comment への Phase 5L-5 セクション追記。
- `tests/multiLineListItemProjection.test.ts`（既存・拡張）: trailing blank line trimming の純粋 projection 単体テストを追加。
- `tests/standaloneMultiLineListItemProjection.test.ts`（既存・拡張）: blank-line-then-ComplexBlock・blank-line-then-nested-child-list の eligibility/検出ゲート直接テストを追加。
- `tests/multiLineLeafListPartialEdit.test.ts`（既存・拡張）: 実パイプライン全体を通した blank line 関連の統合テストを追加。
- `docs/統合実装ロードマップ_2026-08-05.md`（既存・更新）: ヘッダー・フェーズ状況テーブル・新規 §3.18・§5 関連ドキュメント一覧を更新。
- `CHANGELOG.md`（既存・更新）: `### Added` に新規箇条書きを追加。
- `docs/phase5l5_blank-line-leaf-list-partial-edit-projection.md`（新規、本ファイル）。
- `/Users/kazumikaizuka/Obsidian/ipad-test/Test/blank-line-list-marker-free-verification.md`（新規、実機検証用 fixture）。

変更していないファイル（意図的、確認済み）: `src/edit/listMarkerProjection.ts`・`src/edit/taskListProjection.ts`・`src/edit/orderedListProjection.ts`・`src/edit/standaloneListMarkerProjection.ts`・`src/edit/standaloneTaskListProjection.ts`・`src/edit/standaloneOrderedListProjection.ts`・`src/edit/standaloneMultiLineListItemProjection.ts`・`src/edit/quotePrefixProjection.ts`・`src/edit/compositeBlockPartialEdit.ts`・`src/edit/partialEdit.ts`・`src/view/PartialEditView.ts`。

## 10. 将来候補（今回のスコープ外）

- 子リストを持つ親項目（サブツリー全体）への structured projection 対応拡大。
- nested list の structured editing。
- CompositeBlock 側 multi-line/blank-line list member への同種対応。
- callout/blockquote/fenced-code-block/table/heading/thematic-break を内包する item への structured projection。
- marker種別を変更する UI。
- task checkbox status の対応範囲拡大（unchecked/checked 以外）。
- ordered delimiter（`.`/`)`）を変更する UI。
- 兄弟 list item 間の自動採番・一括再採番機能。
- blank line をまたぐ block move・subtree split/merge の専用 UI。
- 汎用 Markdown AST ベースの WYSIWYG 編集。
- 利用者が blank line に意図的に空白文字を含める用途への対応（今回は構造上の空行として正規化する方針を採用し、この用途自体をスコープ外とした）。
