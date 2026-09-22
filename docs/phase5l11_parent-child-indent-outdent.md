# Phase 5L-11: Direct Child Leaf Indent/Outdent in Parent Partial Edit Pane

## 1. 位置づけ — Phase 5L-6〜5L-10 との責務分離

Phase 5L-6（既存・無変更）は親 list item の own-text を構造化編集できるようにし、Phase 5L-7（既存・無変更）は子プレビューを読み取り専用ナビゲーション入口へ拡張し、Phase 5L-8（既存・無変更）は直接の子のうちちょうど1件をパネル内でインライン構造編集できるようにし、Phase 5L-9（既存・無変更）は直接の子リストの末尾への追加と既存の直接の子1件の削除を新設し、Phase 5L-10（既存・無変更）は直接の子どうしの兄弟順序の並び替えを新設した。しかしどのフェーズでも、親子関係（どの項目がどの項目の子であるか）自体を変えることはできなかった——階層を変えたい場合は常に Outline Tree 側の drag & drop に頼る必要があった。

Phase 5L-11 は、この「親子関係」を、ごく限定された1階層のみの範囲で、親の Partial Edit Pane から離れることなく変更できるようにする。具体的には、インデント（直接の子リーフを、その直前の兄弟の末尾の子にする）とアウトデント（ちょうど1階層ネストしたリーフを、元の親の直後の直接の子に戻す）の2操作のみを新設し、親own-text編集・Phase 5L-8の既存子インライン編集・Phase 5L-9の追加/削除・Phase 5L-10の並び替えと**同じApply**で同時に保存できるようにする（ただし追加/削除/並び替え自体とは同時に保留できない——§4参照）。

Phase 5L-6〜5L-10が確立した own-text range/child-subtree range の分離、既存4リーフ投影の再利用という設計は、Phase 5L-11でも一切変更していない。一方、Apply自体の書き込みパターンは、Phase 5L-8/5L-9/5L-10が共有していた「編集可能なdraftを持つための2段階snapshot-then-live比較」から意図的に離れ、Phase 5L-11専用の新しいパターン（§6）を採用した——理由は §5 で述べる。

## 2. スコープ: インデント／アウトデント対象のeligibility

### 2.1 操作モデル: 厳密に2つのみ、いずれも1階層に限定

- **インデント**: 対象の直接の子リーフを、その直前の兄弟（同じく直接の子。それ自身は孫を持っていてもよい）の末尾の子として、1階層だけ移動する。
- **アウトデント**: ちょうど1階層だけネストした子リーフを、Pane 自身の親の直接の子として、元の親の直後へ、1階層だけ移動する。

任意階層・任意親への移動、複数ノード同時移動、サブツリーごとの移動、ドラッグ＆ドロップはいずれも対象外である。ユーザー確認済みの想定例——`親→A→(B,C)` の B をアウトデントすると `親→A→(C), 親→B` になり（C は A の子のまま残る）、B と C が両方とも引きずられて `親→A,B→(C)` になってはならない——は、eligibility・プレビュー・実際の Apply の3段階すべてで個別にテストしている（`tests/parentChildIndentOutdent.test.ts`）。

### 2.2 インデント対象のeligibility（`evaluateChildIndentEligibility`）

対象自身は Phase 5L-8/5L-9/5L-10 と同じ leaf 条件（孫を持たない・既存4投影のいずれかで安全に投影できる・CompositeBlock member でない）を満たす必要がある。これに加えて新設した条件は次の通り:

- 直前の兄弟が存在すること（先頭の直接の子はインデント不可 — `"no-preceding-sibling"`）。
- その兄弟が CompositeBlock member でないこと、かつ `unsafeIndent` でないこと。

インデント先の兄弟自身は、対象と同じeligibility（leaf性など）を満たす必要は**ない**——既に孫を持っていてもよく、その末尾に新しい子として追加されるだけである（`tests/parentChildIndentOutdent.test.ts`の「accepts indenting into a preceding sibling that already owns its own child subtree」が対応）。対象自身が孫を持つ場合は `"child-has-children"` で拒否する。

### 2.3 アウトデント対象のeligibility（`evaluateChildOutdentEligibility`）

対象自身は同じく leaf 条件を満たす必要があり、加えて次を要求する新設条件:

- 対象がちょうど1階層だけネストしていること（対象の現在の親が、Pane 自身の親の直接の子であること）。2階層以上深いノードは `"not-nested-child"` で拒否する（親から見て2階層下——親の直接の子ではなく孫以下——であるため、これは「直接の子」であることを要求する既存の枠組みが自然に除外する）。
- 対象自身が子を持たない leaf であること（`"child-has-children"`）。

## 3. セッションモデルの拡張

`ParentChildAddDeleteSession`（Phase 5L-9由来）に、新設4番目のスロット `pendingIndentOutdent: PendingIndentOutdent | null` を追加した。

```
type PendingIndentOutdentKind = "indent" | "outdent";
interface PendingIndentOutdent {
  kind: PendingIndentOutdentKind;
  childNodeId: string;    // 移動対象自身
  relatedNodeId: string;  // indent: 移動先の兄弟 / outdent: 現在の親
}
```

既存の新規子下書き（`newChildDraft`）・削除保留（`pendingDeletion`）・並び替え保留（`pendingReorderOrder`のdirty分）のいずれとも**同時に保留できない**——構造的に高々1件のみ。`renderParentChildPreview` は次の条件をすべて満たす場合にのみ、新しいインデント／アウトデントの開始ボタンを表示する（`canStartIndentOutdent`）:

- 保留中のインデント／アウトデントがまだ無いこと。
- 既存子のインライン編集（`childInlineSession`）が開いていないこと。
- 新規子下書きが無いこと。
- 削除保留が無いこと。
- 並び替えが実際にdirtyでないこと（`isPendingReorderDirty`）。

## 4. Apply設計: なぜ「one fresh-document pass」なのか

Phase 5L-8/5L-9/5L-10 までの全てのApply経路は、ユーザーが編集可能なdraft（子own-textの編集内容、追加する子の本文など）を持つため、「ORIGINALスナップショットと現在の実文書との比較」という2段階の安全性検証（invert+validateしてから、現在の実文書に対してfreshに再解決してconflictをチェックする）を必要としていた。

インデント・アウトデントにはdraftが存在しない——ボタンを押した瞬間に「何をどこへ動かすか」が確定し、あとはApplyするかキャンセルするかのみである。この問題の形の違いを反映し、`applyParentChildIndentOutdentToDocument` は意図的に別のパターンを採用した:

1. 現在の実文書を1回だけフレッシュに再解決する（親own-text・対象ノード・関連ノードのいずれも、保留を作った時点のidではなく、Applyされる瞬間の実文書に対して再解決する）。
2. 親own-textがdirtyな場合は先に invert+validate する（親のみの既存パターンを流用）。
3. 対象・関連ノードのそれぞれについて、保留を作った時点のeligibilityがまだ成立しているかを再検証する。
4. 候補（変換後のchild subtreeテキスト）を構築する。
5. その候補を使い捨てミニドキュメントとして再パースし、`ExpectedCandidateSlot`（`"unchanged"`/`"related"`/`"inserted"` の3種）で期待される構造と実際の再パース結果を1件ずつ突き合わせる——親ノード・移動対象ノード・関連ノード・その他の兄弟すべてが保存されていることを確認する。
6. すべて通過して初めて、実文書へ1回だけ原子的に書き込む。

失敗する経路は8種類の理由（`ChildIndentOutdentApplyRejectReason`: `parent-resolve-failed`/`parent-conflict`/`subtree-conflict`/`target-resolve-failed`/`related-resolve-failed`/`candidate-structure-invalid`/`child-count-changed`/`sibling-changed`）のいずれかで拒否され、いずれの場合も文書・保留状態は完全に無変更のまま維持される。

## 5. インデント幅の計算: Outline Tree側の既存プリミティブを再利用

`move/indentBlock.ts`（Outline Tree の既存D&D move実装が持つ）の `growIndent`/`shrinkIndent`（既存export）に加え、`buildIndentPrefix`（本チケットのために新規export化——それまでは同ファイル内のprivateヘルパーだった）を直接importして使用する。`TAB_WIDTH`（`parser/parseDocument.ts`）・`ListBlockNode.indentColumns`（`model/block.ts`）に基づく列計算ロジックを再実装していない。

Phase 5L-9が新規子追加のために持つ `computeNewChildIndent` とは、パターンとしては似ているが「新しい兄弟をどこに置くか」という別の問題を解いているため、意図的に別関数のまま——本チケットでは既存の `buildIndentPrefix` を直接再利用する方を選んだ。

## 6. UI配線（`src/view/PartialEditView.ts`）

### 6.1 プレビューへの反映（`renderParentChildPreview`）と保留中の全アフォーダンス無効化

保留中のインデント／アウトデントは、並び替えプレビュー分岐よりも**優先度が高い**——両者は構造的に排他だが、この優先チェック自体は「never guess, always verify」の方針として独立に行っている。保留中は `buildIndentOutdentPreviewText`（現在の文書から変換後のchild subtreeテキストを構築し、再解決に失敗した場合は安全側に倒れて未変換の `childSubtreeText` へフォールバックする）が変換後の階層を表示し、`eligibleFirstRowById` を空のMapにすることで、他の全ての行アフォーダンス（ナビゲーション・編集開始・削除・並び替え・別のインデント/アウトデント）を一括で非表示にする。「＋（子を追加）」ボタンも、保留中は disabled になりツールチップの文言が変わる。

### 6.2 インデント／アウトデントボタンの描画

`canStartIndentOutdent` を満たす場合のみ、新設 `indentEligibleIds`（対象は直接の子のみ）と `outdentEligibleFirstRowById`（対象はちょうど1階層ネストした孫のみ——直接の子とは異なる母集団）を、fresh な `previewDoc`/`previewParentNode` に対して都度計算する。インデントボタンは対象の直接の子の行に、アウトデントボタンは対象の孫の行に、それぞれ鉛筆・ゴミ箱・上下並び替えボタンと同じ共有 `rowActionsEl` グループ内に描画され、`stopPropagation`/`preventDefault` を経てから `handleRequestIndentChild`/`handleRequestOutdentChild` を呼ぶ。

### 6.3 `handleRequestIndentChild`/`handleRequestOutdentChild`: fresh再検証

いずれも、現在の実文書を `parseDocument(view.editor.getValue())` で再パースし、`buildPendingIndent`/`buildPendingOutdent` で改めてeligibilityを再検証したうえで初めて `pendingIndentOutdent` を設定する——行の描画時点のeligibilityスナップショットを信用しない。失敗時はNoticeを表示するのみで安全なno-opとなる。Phase 5L-9の`handleRequestAddChild`・Phase 5L-10の`handleReorderChild`と同じ理由で、`DiscardChangesModal` を経由しない（何かを破棄する操作ではなく、純粋な追加操作であるため）。

### 6.4 Apply（`applyEdit`のディスパッチ順序と`applyParentChildIndentOutdentEdit`）

`applyEdit()` は `childAddDeleteSession?.pendingIndentOutdent` の分岐を、汎用の `hasAddDeleteActivity()` 分岐**より前**でチェックする——後者の `applyParentChildAddDeleteCombinedEdit` はインデント／アウトデント変形の書き込み方法を一切知らないため。`hasAddDeleteActivity()` 自身は `pendingIndentOutdent` の存在を無条件の activity として扱うよう拡張したが（並び替えと異なり「正味no-op」という形が無いため、存在すれば常にactivity）、これは `isDirty()`/`updateDirtyState` がApply/Cancelボタンを表示し続けるためだけの拡張であり、実際のApply処理は専用の `applyParentChildIndentOutdentEdit` が担う。

`applyParentChildIndentOutdentEdit` は、親own-textがdirtyなら先に `invertParentListItemProjection` で検証し（既存の `ParentChildCombinedApplyRejectReason` マッピングをそのまま再利用）、成功して初めて `applyParentChildIndentOutdentToDocument`（§4）を呼ぶ。成功時は、親projection・child-add/deleteセッション・`originalText` を実文書からフレッシュに再構築し、`childInlineSession` は常にnullへ戻す（保留中のインデント／アウトデントは既存子インライン編集と同時に存在し得ないため）。

## 7. 競合・Cancel・対象切り替え

- **Cancel**: `cancelEdit()`は、新規子下書き・削除保留・並び替え保留と同様に、`pendingIndentOutdent`をnullへ戻す——保留中の変形は完全に破棄され、プレビューは操作前の表示に戻る。
- **対象切り替え**: `hasAddDeleteActivity()`が`pendingIndentOutdent`の存在をORの一項として含むよう拡張されたことで、既存の`requestLoadNode`/`DiscardChangesModal`（Apply/Discard/Cancelの安全な切り替え契約、5L-10までに確立された「×/Escape/外側クリックはその場に留まり何も破棄しない」契約を含む）は、インデント／アウトデントの保留も他の未保存編集と全く同じに扱う——新しい分岐やUIは新設していない。
- **Apply拒否**: §4で述べた8種類の理由いずれについても、ノート・パネルの状態（親own-text draft・既存子draft・新規子下書き・削除保留・並び替え保留・インデント/アウトデント保留のすべて）は一切変更されない——部分的な書き込みは構造的に起こり得ない。

## 8. fixture配置方針

実機検証用fixtureは、既存のプロジェクトメモリ方針（`unified-outliner-verification-fixture-placement-policy.md`）通り、`/Users/kazumikaizuka/Obsidian/ipad-test/Test/parent-child-indent-outdent-verification.md`にのみ配置し、リポジトリ内やその他vaultへの複製は行っていない。

## 9. 変更・追加したファイル

- `src/move/indentBlock.ts`（既存・拡張）: `buildIndentPrefix`をexport化し、本チケットでの再利用理由をdocコメントに追記。
- `src/edit/parentChildInlineEditSession.ts`（既存・拡張）: 同じモジュールにPhase 5L-11セクションを追加。`evaluateChildIndentEligibility`/`evaluateChildOutdentEligibility`、`PendingIndentOutdentKind`/`PendingIndentOutdent`、`buildPendingIndent`/`buildPendingOutdent`、`buildIndentOutdentPreviewText`、`ChildIndentOutdentApplyRejectReason`、`applyParentChildIndentOutdentToDocument`（§4の「one fresh-document pass」設計）、`ParentChildAddDeleteSession`への`pendingIndentOutdent`フィールド追加。Phase 5L-8/5L-9/5L-10の既存エクスポートは一切変更していない。
- `src/view/PartialEditView.ts`（既存・拡張）: Phase 5L-11のimport追加、`renderParentChildPreview`への保留中優先分岐・`canStartIndentOutdent`・インデント/アウトデントボタン描画の追加、新規`handleRequestIndentChild`/`handleRequestOutdentChild`、`hasAddDeleteActivity`/`cancelEdit`/`applyEdit`のディスパッチ／`hasAddDeleteActivity`への配線、新規`applyParentChildIndentOutdentEdit`。
- `src/i18n.ts`（既存・拡張）: `partialEdit.parentChildIndentOutdentPendingOtherDisabledLabel`／`...IndentButtonLabel`／`...OutdentButtonLabel`／`...IndentFailed`／`...OutdentFailed`の5キーをen/ja両辞書に追加。
- `styles.css`（既存・拡張）: `.unified-outliner-partial-edit-parent-child-indent-button`／`-outdent-button`を新設（既存の並び替えボタンと同じem単位のサイズ・ホバー・フォーカス規約）。
- `tests/parentChildIndentOutdent.test.ts`（新規、31件）: 実`parseDocument`を使った、eligibility・pending構築・プレビュー・実文書へのapply（インデント単独・既存孫持ち兄弟への追加・タスク/序数の保存・conflict/resolve-failed・親own-text同時編集）の単体テスト。ユーザー確認済みの想定例を3段階で個別に検証。
- `tests/parentChildIndentOutdentUiWiring.test.ts`（新規、16件）: View配線の静的ソース確認。
- `tests/parentChildAddDeleteUiWiring.test.ts`（既存・更新）: 「＋」ボタンの`indentOutdentAlreadyPending`分岐、`cancelEdit()`の4番目のOR条件を確認する2件のテストを追加。
- `tests/partialEditStalePaneSyncUiWiring.test.ts`（既存・更新）: `syncState = "synced"`出現回数アサーションを11→12に更新（`applyParentChildIndentOutdentEdit`分を追加）。
- `docs/統合実装ロードマップ_2026-08-05.md`（既存・更新）: フェーズ状況テーブル・新規§3.24・§5関連ドキュメント一覧・最終更新欄。
- `CHANGELOG.md`（既存・更新）: `### Added`に新規箇条書きを追加。
- `docs/phase5l11_parent-child-indent-outdent.md`（新規、本ファイル）。
- `/Users/kazumikaizuka/Obsidian/ipad-test/Test/parent-child-indent-outdent-verification.md`（新規、実機検証用fixture）。

変更していないファイル（意図的、確認済み）: `src/edit/parentListItemProjection.ts`・`src/edit/standaloneParentListItemProjection.ts`・`src/edit/listMarkerProjection.ts`・`src/edit/taskListProjection.ts`・`src/edit/orderedListProjection.ts`・`src/edit/multiLineListItemProjection.ts`・4つの単独リーフ投影一式・`src/edit/quotePrefixProjection.ts`・`src/edit/compositeBlockPartialEdit.ts`・`src/edit/partialEdit.ts`・`src/model/block.ts`・`src/view/OutlineTreeView.ts`——Phase 5L-8/5L-9/5L-10のエクスポートも含め、いずれも完全に無変更のまま再利用のみ。

## 10. 将来候補（今回のスコープ外）

- **孫以下・より深い階層の移動**: 今回は「ちょうど1階層」のみ。
- **childIdsを持つノード（自身がさらに子を持つノード）自身の移動**: 対象は常にeligibleなleafのみ。
- **サブツリーごとの移動**: 対象の子1件のみが移動し、その子自身の子（アウトデントの場合は無いはずだが、念のため）は一切対象にならない。
- **ドラッグ＆ドロップによる移動**: 今回はボタンのみ。
- **任意の親への移動**: インデントは「直前の兄弟」のみ、アウトデントは「元の親の直後」のみに固定。
- **複数ノードの同時移動**: 今回も引き続き最大1件。
- **追加・削除・並び替えとの自由な組み合わせ**: 今回は意図的に排他のまま（§3）。
- **CompositeBlock階層の変更・CompositeBlock memberの移動**: 今回は完全に対象外。
- **兄弟の自動採番・ordered delimiterの変更**: 今回も引き続き一切実装しない。
- **子を持たない親への初回の子追加（Mode B）**: Phase 5L-9由来の既存の先送り事項で、本チケットのスコープにも含まれない。
- **checkbox status対応範囲の拡大・完全なMarkdown-AST WYSIWYG編集**: 今回のスコープ外。
