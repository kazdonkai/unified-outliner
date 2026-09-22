# Phase 5L-6: Parent List Item Structured Partial Edit

対象リポジトリ: `unified-outliner-public`
関連: `docs/統合実装ロードマップ_2026-08-05.md` §3.19（本ドキュメントの実装確定事項の正）、`docs/phase5l4_multiline-leaf-list-partial-edit-projection.md`（Phase 5L-4、own-text の複数行投影を無変更のまま再利用する対象モジュール）、`docs/phase5l5_blank-line-leaf-list-partial-edit-projection.md`（Phase 5L-5、blank line 継続行の canonical serialization を無変更のまま継承）

## 1. 位置づけ — Phase 5L-1〜5L-5 との責務分離

Phase 5L-1〜5L-5（いずれも既存・無変更）は、standalone list item の marker-free / checkbox-free / number-free 投影を、`node.childIds.length === 0`（子リストを持たない leaf item）の形状に限って実現していた。子リストを1つ以上持つ「親 list item」は、この5フェーズすべてが明示的に対象外としており、Partial Edit Pane を開くと常に raw fallback（サブツリー全体が生の Markdown として編集される）となっていた。

Phase 5L-6 は、この隙間を埋める。ただし、既存5フェーズが扱ってきた「1つの list item の1行目＋continuation」という単位そのものを再定義するのではなく、親 list item の `ListBlockNode.range`（サブツリー全体）を、次の2つの別々の line range へ明確に分離することが本チケットの中心的な設計判断である。

| | own-text range | child-subtree range |
| --- | --- | --- |
| 内容 | 親自身の1行目＋continuation/blank line（子の行は一切含まない） | 最初の子の1行目〜親自身の `range.endLine` まで（全ての子孫を含む） |
| 編集可否 | 編集可能（既存の marker-free/checkbox-free/number-free 投影を再利用） | 編集不可（読み取り専用プレビューとしてのみ表示） |
| Apply の対象 | この範囲のみを1回でスプライス | 一切触れない |
| 既存モジュールとの関係 | own-text が1行なら本チケット新設の小さな dispatch、2行以上なら Phase 5L-4/5L-5 の `multiLineListItemProjection.ts` を完全に無変更のまま再利用 | 本チケットは何も再実装しない——既存の Outline Tree／Subtree Navigator のナビゲーションがそのまま子編集の手段 |

責務分離は次の通り。

| | Phase 5L-1〜5L-5（既存・無変更） | Phase 5L-6（本チケット） |
| --- | --- | --- |
| leaf item（子リストを持たない）の marker-free 投影 | `edit/listMarkerProjection.ts`/`edit/taskListProjection.ts`/`edit/orderedListProjection.ts`/`edit/multiLineListItemProjection.ts` | **無変更**——引き続きそのまま機能する |
| 親 item（`childIds.length > 0`）の own-text 投影 | 対象外（常に raw fallback） | **新規**——own-text range を分離した上で、上記4モジュールへ委譲・再利用する |
| 子 subtree 自体の表示・編集 | — | **新規（表示のみ）**——読み取り専用プレビュー。編集・Apply 対象には含めない |
| 子の追加・削除・並べ替え・字下げ変更 | Outline Tree／Subtree Navigator | **無変更**——本チケットは一切実装しない |
| 新規 projection モジュール | — | `edit/parentListItemProjection.ts`・`edit/standaloneParentListItemProjection.ts` の2本を追加 |

## 2. 実装前の実機挙動確認

実装着手前に、使い捨て probe テストファイル（実際の `parseDocument` の出力をダンプするだけの一時ファイル、確認後に削除済み）で、親 list item を含む実際のパーサー挙動を直接確認した。確認できた事実は次の4点。

1. **親の own-text と最初の子の間に blank line が1行挟まっても、子は正しく親の子として認識される。** 親の own-text range は、その blank line の行まで含む（例: `"- 親本文\n\n  - 子1\n  - 子2\n"` → `li-0`（親）の range は `[0, 3]`、`li-1`（子）の range は `[2, 2]`）。
2. **閉じた子の直後に、その子自身のマーカー列と同じ字下げの、マーカーを持たないプレーンな行が続くと、`parser/parseDocument.ts` 自身の line-ownership-fill 処理により、その行は親自身の own range へ再帰属される。** 位置的には最後の子の後ろに見えるにもかかわらず、である（例: `"- 親本文\n  - 子1\n  さらに親の続き？\n"` → `li-0`（親）の range は `[0, 2]`、子 `li-1` の range は `[1, 1]` のみ）。この結果、親の `range.endLine`（`2`）が最後の子の `range.endLine`（`1`）を超える——本チケットではこれを「interleaved-content」と呼び、own-text/child-subtree を安全に分離できない状態として検出する。
3. **孫を持つ子がいても、`node.childIds` は直接の子のみを保持する。** 孫は子自身の child subtree の内部に含まれるため、`resolveParentListItemOwnTextRange` が親の own-text/child-subtree の境界を計算する際、孫の存在は一切影響しない。
4. **文書末尾の trailing blank line は、既存の Phase 5L-4/5L-5 と同じく、parser 自身が親の range から常に除外する。**

(2) が、本チケットが新たに検出・防御する必要のある唯一の未知のケースだった。(1)(3)(4) は、`resolveParentListItemOwnTextRange` の実装がそのまま安全に処理できることを、この実機確認と後述する新規テストの両方で確認した。

## 3. own-text/child-subtree range 分離の契約

新規モジュール `edit/parentListItemProjection.ts` の `resolveParentListItemOwnTextRange(doc, node)` は、`node.childIds`/`node.range`/`doc.nodes` のみから2つの range を計算する純粋関数である（raw text は一切参照しない）。次の5種の理由のいずれかで、分離不能（`ok: false`）を返す。

- `"no-children"`: `node.childIds.length === 0`——このモジュールの対象外（leaf item は既存5フェーズの対象）。
- `"unsafe-indent"`: `node.unsafeIndent`——他の全ての standalone-* eligibility gate と同じ防御的チェック。
- `"child-not-found"`: `node.childIds[0]`/最後の子が `doc.nodes` に解決しない——防御的のみ。
- `"interleaved-content"`: §2(2) の実挙動——最後の直接の子の `range.endLine` が親自身の `range.endLine` と一致しない。
- `"empty-own-text"`: 防御的のみ（parser 自身の nesting 規則上、構造的に到達不能）。

分離が成功した場合、own-text range は「親自身の1行目〜最初の子の1行目の直前まで」、child-subtree range は「最初の子の1行目〜親自身の `range.endLine` まで」となる。

## 4. 既存 first-line/multi-line projection の再利用方法

own-text の raw substring を切り出した後、その行数に応じて次のいずれかへ完全に委譲する。

- **2行以上（continuation を持つ own-text）**: Phase 5L-4/5L-5 の `edit/multiLineListItemProjection.ts` の `buildMultiLineListItemProjection`/`invertMultiLineListItemProjection` を完全に無変更のまま呼び出す。blank line の canonical serialization（Phase 5L-5 の `trimTrailingBlankContinuationLines`）もそのまま適用される——own-text の末尾に残った blank line は、他の leaf item の場合と全く同じ規則で Apply 時に静かに取り除かれる。
- **1行のみ（own-text が自分自身の1行目だけで完結する、最も一般的なケース）**: 本チケット新設の `buildSingleLineParentFirstLineSlot`（`edit/listMarkerProjection.ts`/`edit/taskListProjection.ts`/`edit/orderedListProjection.ts` への3優先度 dispatch）を使う。これは `multiLineListItemProjection.ts` 自身が持つ同名の内部 dispatch と構造的に同一だが、「各 projection モジュールは共有ロジックを独自にコピーする」という本プロジェクト既存の方針（`multiLineListItemProjection.ts` 自身の冒頭 doc comment が明示）を踏襲し、import/export による共有はしていない。

いずれの経路でも、結果は既存の `MultiLineListItemProjection` と同じ形（`continuationIndent: ""`、改行を含まない `body` が1行own-textの場合の特徴）に正規化され、View 側（`view/PartialEditView.ts`）はこの2つの経路の違いを一切意識しない。

## 5. Apply 時の2段階安全性検証

own-text 単独の検証だけでは不十分である——この candidate は、実際には子 subtree の直前に再結合されることが前提のため、単独の再パースだけでは、結合後に何が起きるかを証明できない。そこで `invertParentListItemProjection` は次の2段階を行う。

1. **own-text candidate 単独の再パース検証**: `invertMultiLineListItemProjection`（2行以上）または3つの単一行 `invert*Projection`（1行のみ）が、それぞれ既に持つ検証（子リストを持たない、ComplexBlock を含まない、等）をそのまま適用する。失敗すると `"own-text-unsafe-structure"`（ordered の数値検証失敗のみ `"invalid-number"`）。
2. **own-text candidate ＋ 元の child-subtree snapshot の結合再パース検証（本チケット新設の唯一の追加チェック）**: own-text candidate を、Apply 前の（未編集の、ライブな現在のドキュメントではなく）child-subtree snapshot とだけ結合し、1つの使い捨て mini-document として再パースする。次のすべてを満たすことを確認する。
   - 行0にちょうど1つの list item が存在し、`unsafeIndent` でないこと。
   - その kind（unordered/task/ordered）が own-text の元の kind と一致すること。
   - `childIds.length` が読み込み時に記録した `expectedChildCount` と一致すること。
   - その list item の range が結合後の全行をちょうど覆うこと。
   - 再パース後の child-subtree 部分（`firstChild.range.startLine` から末尾まで）が、元の child-subtree snapshot と byte-for-byte 完全に一致すること。

   いずれかに失敗すると `"child-subtree-detached"`（または防御的な `"child-subtree-changed"`）として Apply 全体を拒否する。

いずれの失敗も **Apply 拒否**であり、§7 で区別する raw fallback（読み込み時点で own-text/child range を安全に分離できない場合）とは明確に異なる——構造化エディタは正しく開けたが、その特定の編集結果が親子構造を壊してしまう、というケースである。

## 6. own-text 専用の書き戻し（`applyParentListItemOwnTextEdit`）— `applySubtreeEdit` を使わない理由

既存の `edit/partialEdit.ts#applySubtreeEdit` は、対象ノードの**全 range**（own-text＋child subtree 全体）を現在のドキュメントから再抽出し、それを load 時の snapshot と比較して conflict を判定する。これをそのまま親 item の Apply に使うと、child subtree だけが外部で変更された瞬間に（own-text 自体は何も変わっていなくても）conflict として Apply が誤って拒否されてしまう——これは本チケットの承認済みスコープが明示的に禁止している挙動である（「child subtree が外部編集で変化した場合、親 own-text の snapshot が変化していなければ Apply を拒否しないこと」）。

新設した `applyParentListItemOwnTextEdit(doc, nodeId, originalOwnTextRawText, newOwnTextRawText)` は、代わりに次のように動作する。

1. `nodeId` を現在の `doc` からフレッシュに再解決する（呼び出し元が保持する古い node/range は一切信頼しない——行番号はそれが由来するパースの中でしか有効でないため）。
2. `resolveParentListItemOwnTextRange` を現在の `doc`/node に対して再実行し、own-text range をフレッシュに再導出する。
3. その own-text range だけを現在の `doc.lines` から再抽出し、`originalOwnTextRawText`（load 時の own-text snapshot）とだけ比較する——child subtree の内容は比較の対象に一切含まれない。
4. 一致すれば、own-text range だけを1回のスプライスで置き換える。child subtree を含む range 外の行は、現在どのような内容であっても一切変更しない。

own-text candidate 自体の構造的安全性は §5 で（生きている child subtree の現在の内容にではなく）own-text 自身の孤立した形と、load 時点の child-subtree snapshot との整合性だけに基づいて既に確認済みであるため、この「child subtree が今どうなっていても、own-text の snapshot さえ一致していればそのまま前に貼り付けてよい」という設計は安全である。

## 7. raw fallback 条件と Apply 拒否条件の区別

- **raw fallback（BUILD 時点、Apply を一切妨げない）**: `node.childIds.length === 0`（対象外）、`unsafeIndent`、interleaved-content（§2(2)）、own-text の continuation に callout/blockquote/fenced-code/table/thematic-break を含む、own-text の1行目がいずれの投影としても成立しない、own-text の continuation の indentation が malformed。これらはいずれも editor がサブツリー全体を raw テキストのまま表示し、既存の raw Partial Edit で引き続き編集できる。
- **Apply 拒否（読み込み時点では投影できていたが、編集内容が安全に書き戻せない場合）**: `"invalid-number"`・`"own-text-unsafe-structure"`・`"child-subtree-detached"`・`"child-subtree-changed"` の4種類のみ（§5）。own-text の draft（checkbox・number・本文）はいずれも編集直後のまま保持され、child subtree のプレビューは元より一切再直列化されない。

## 8. 既知の UX 上の限定事項（既存 stale 検知機構は意図的に無変更）

本チケットの承認済みスコープは「既存の共有機構を複雑化させない」ことを明示的に求めており、かつ「child subtree の外部変化の扱いは、既存の stale 検知と整合的であること」とも読める文言を含む。この2点を踏まえ、`view/PartialEditView.ts` の既存の subtree 全体スコープの stale 検知機構（`resolveCurrentTarget`/`classifySyncOutcome`/`evaluateAgainstText`）は、他の全ての Partial Edit 種別と全く同じく、依然として「own-text＋child subtree 全体」を `this.originalText` と比較し続ける——本チケットのために新しく再スコープしていない。

その結果、このパネルが開いている間に child subtree だけが外部変更されると、（`applyParentListItemOwnTextEdit` 自身の conflict 判定とは別に）既存の stale 検知により Apply ボタン自体が一時的に無効表示になる場合がある。これは UI 上の既知の限定事項であり、本チケットの核心的なデータ安全性要件（「child subtree の変化**だけ**で Apply を拒否しない」）への違反ではない——`applyParentListItemOwnTextEdit` 自身の conflict 判定は、ボタンの表示状態に関わらず、常に own-text のみを比較する。Apply 成功後、`this.originalText` は「直前に適用された own-text＋Apply 前の child-subtree snapshot」へ再構成され、次の stale チェックのための正しい比較対象が保たれる。

## 9. fixture 配置方針

既存フェーズと同じ方針を維持している（プロジェクトメモリ `unified-outliner-verification-fixture-placement-policy.md` 参照）。本チケットの実機検証用 fixture は `/Users/kazumikaizuka/Obsidian/ipad-test/Test/parent-list-item-structured-partial-edit-verification.md` として配置し、リポジトリ内やその他 vault への複製は行わない。配置前に、実際の `parseDocument`/`buildParentListItemProjection`/`isStandaloneParentListItemEligibleForProjection` へ通す使い捨て probe テストで、fixture 内の各項目が意図した eligible/raw-fallback の分類どおりに解釈されることを確認済み（確認後に probe は削除済み）。

## 10. 変更・追加したファイル

- `src/edit/parentListItemProjection.ts`（新規）: `resolveParentListItemOwnTextRange`・`buildParentListItemProjection`・`invertParentListItemProjection`・`applyParentListItemOwnTextEdit`、および `projectedParentBodyText`/`projectedParentChecked`/`projectedParentNumberText`。
- `src/edit/standaloneParentListItemProjection.ts`（新規）: `isStandaloneParentListItemEligibleForProjection`・`hasComplexBlockInParentOwnTextContinuation`。
- `src/view/PartialEditView.ts`（既存・拡張）: `standaloneParentListItemProjection` フィールド、読み取り専用 child-subtree プレビューの4つの DOM フィールドと `renderParentChildPreview()`、`loadNodeInternal`/`performAutoReload`/`resetLoadedState`/`loadParagraphInternal`/`loadCompositeInternal`/`currentDisplayText`/`renderTaskCheckboxRow`/`renderOrderedNumberRow`/`isDirty`/`cancelEdit`/`applyEdit` への配線。
- `src/i18n.ts`（既存・拡張）: `partialEdit.parentOwnTextStructureInvalid`・`partialEdit.parentChildSubtreeStructureInvalid`・`partialEdit.parentChildPreviewLabel`・`partialEdit.parentChildPreviewTruncated`・`reason.parent-own-text-range-unresolvable`・`reason.parent-own-text-conflict` を en/ja 両辞書に追加。
- `styles.css`（既存・拡張）: `.unified-outliner-partial-edit-parent-child-preview` 系クラスと、既存の `toggleVisibility` レイアウト空間バグ対策セレクタへの追加。
- `tests/parentListItemProjection.test.ts`（新規、37件）: 純粋関数の単体テスト。
- `tests/standaloneParentListItemProjection.test.ts`（新規、19件）: eligibility gate の単体テスト。
- `tests/parentListItemStructuredPartialEdit.test.ts`（新規、21件）: 実パイプライン統合テスト（child subtree 外部変化が Apply を阻害しないことの直接確認を含む）。
- `tests/parentListItemPartialEditUiWiring.test.ts`（新規、22件）: View 配線の静的ソース確認。
- `docs/統合実装ロードマップ_2026-08-05.md`（既存・更新）: ヘッダー・フェーズ状況テーブル・新規 §3.19・§5 関連ドキュメント一覧。
- `CHANGELOG.md`（既存・更新）: `### Added` に新規箇条書きを追加。
- `docs/phase5l6_parent-list-item-structured-partial-edit.md`（新規、本ファイル）。
- `/Users/kazumikaizuka/Obsidian/ipad-test/Test/parent-list-item-structured-partial-edit-verification.md`（新規、実機検証用 fixture）。

変更していないファイル（意図的、確認済み）: `src/edit/listMarkerProjection.ts`・`src/edit/taskListProjection.ts`・`src/edit/orderedListProjection.ts`・`src/edit/multiLineListItemProjection.ts`・`src/edit/standaloneListMarkerProjection.ts`・`src/edit/standaloneTaskListProjection.ts`・`src/edit/standaloneOrderedListProjection.ts`・`src/edit/standaloneMultiLineListItemProjection.ts`・`src/edit/quotePrefixProjection.ts`・`src/edit/compositeBlockPartialEdit.ts`・`src/edit/partialEdit.ts`（`applySubtreeEdit` 自体は無変更のまま、他の全ての種別が引き続きそのまま使う）。

## 11. 将来候補（今回のスコープ外）

- 本パネルからの子項目の追加・削除・並べ替え・字下げ変更。
- child subtree 自体の編集可能化（現状は常に読み取り専用プレビュー）。
- 孫以下を含めた複数階層の own-text 構造化編集（今回は直接の親子関係1段のみが対象——ただし、子自身が別の親である場合、その子を独立に開けばそちらの own-text は編集可能）。
- marker種別を変更する UI。
- task checkbox status の対応範囲拡大（unchecked/checked 以外）。
- ordered delimiter（`.`/`)`）を変更する UI。
- 兄弟 list item 間の自動採番・一括再採番機能。
- CompositeBlock 側 list member への同種対応。
- interleaved-content（§2(2)）を、raw fallback ではなく、何らかの形で構造化編集の対象に含める拡張。
- child subtree だけの外部変化に対する、専用の（既存の全種別共有ではない）よりきめ細かい stale 検知・自動リロード UI（§8 の既知の限定事項の解消）。
- 汎用 Markdown AST ベースの WYSIWYG 編集。

## 12. 実機報告への対応 — 11インチ iPad でのブランク表示バグ（2026-09-15）

実装完了後、ユーザーからの実機報告（スクリーンショット2枚添付）により、own-text がタスク/ordered 行である親項目を開いた際、デスクトップおよび13インチ iPad では正常に own-text フィールドと子項目プレビューが表示される一方、11インチ iPad では大きな空白領域のみが表示され、own-text フィールドも子項目プレビューも見えないという報告を受けた。

### 12.1 原因

新規に追加した `.unified-outliner-partial-edit-parent-child-preview`/`-truncated` 自体の問題ではなかった。真因は、本チケットより前から存在していた3つの行——`compositeListRowEl`（Phase 5D-2B）・`taskCheckboxRowEl`（Phase 5L-2）・`orderedNumberRowEl`（Phase 5L-3）——が、他の行（sync-status・breadcrumb・sibling-nav・subtree-nav・quote-header、および本チケットで追加した parent-child-preview 系）と全く同じ `toggleVisibility()` パターンで表示/非表示を切り替えられているにもかかわらず、2026-09-09 の「vast blank space」バグ対策セレクタ（`styles.css` の `[style*="visibility: hidden"] { display: none !important; }`）に含まれていなかったことにある。

Obsidian の `toggleVisibility(false)` は `display: none` ではなく inline `style="visibility: hidden;"` を設定するため、対策セレクタに含まれない要素は非表示のまま自身の padding・内容の高さ・`margin-bottom` を layout 上に確保し続ける。own-text がタスク/ordered 行である親項目では、この3行のうち実際に使う1行が表示され、残り2行が「見えないが場所だけ確保する」状態になる——親項目の own-text/子項目プレビューという Phase 5L-6 の新規UIより前の位置に、2行分の空白が積み上がる形になる。デスクトップや13インチ iPad の縦方向の余裕がある画面ではこの空白は単なる余白として吸収され気づかれにくいが、11インチ iPad の縦方向に余裕の少ない画面では own-text フィールドと子項目プレビューをビューポート外に押し出すのに十分な高さとなり、結果として「空白のみが見える」状態を再現した。

### 12.2 対応

`styles.css` の同セレクタリストに `.unified-outliner-partial-edit-composite-list-row`・`.unified-outliner-partial-edit-task-checkbox-row`・`.unified-outliner-partial-edit-ordered-number-row` の `[style*="visibility: hidden"]` を追加し、他の全ての行と同じく非表示時は layout から完全に除外されるようにした。新規 CSS ルールの追加や `@media` によるブレークポイントは用いていない——2026-09-09 に既に確立された対策パターンをそのまま拡張したのみであり、本チケット固有の新規ロジックの変更は行っていない。

対応後、`tsc -noEmit -skipLibCheck` + `esbuild`（`npm run build`）、既存 2651件のテスト全件（`npx vitest run`）、`eslint`（既存の無関係な警告3件のみ、エラー0件）を確認済み。CSS のみの変更であり、既存テストへの影響はない（このバグ自体、実機のレンダリング挙動に依存するため、既存の jsdom ベースのテストスイートでは元々再現・検出できない種類の不具合だった）。

実装完了・実機確認待ち。
