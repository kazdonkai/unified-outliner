# Phase 5L-8: Child Item Inline Structured Editing in Parent Partial Edit Pane

## 1. 位置づけ — Phase 5L-6/5L-7 との責務分離

Phase 5L-6（既存・無変更）は、子リストを1つ以上持つ「親 list item」の own-text を marker-free/checkbox-free/number-free で構造化編集できるようにし、child subtree（子リスト自身）は own-text 編集欄の直下に、読み取り専用のプレビューとして表示するのみだった。Phase 5L-7（既存・無変更）は、このプレビューを「表示専用」から「安全なナビゲーション入口」へ拡張し、プレビュー行のクリック／タップ／Enter/Space で、その子項目自身を新しい Partial Edit 対象として開けるようにした。しかしどちらのフェーズでも、子項目を実際に編集するには、常に別のパネルとして開き直す必要があった。

Phase 5L-8 は、このプレビュー内の直接の子のうち、ちょうど1件だけを、パネルを離れることなくインライン構造編集できるようにする。子・孫以下の他の項目（選択中でない子、孫以下すべて）は引き続き親 session 内では一切編集不可のままであり、この点は Phase 5L-6/5L-7 の契約から一切後退していない。選択した1件の子については、既存4つのリーフ投影のいずれかによる marker-free/checkbox-free/number-free 編集を、親のown-text編集と並行して行え、Apply は親・子両方を1回の操作で同時に保存する。

Phase 5L-6 が確立した own-text range/child-subtree range の分離、own-text 専用の Apply/conflict 判定、既存 subtree 全体スコープの stale 検知、Phase 5L-7 が確立した navigation target identity・`requestLoadNode`/`DiscardChangesModal` によるナビゲーションガード——これらはすべて Phase 5L-8 でも一切変更していない。Phase 5L-8 が新設したのは、選択中の1件の子について、own-text 編集と同じ構造化投影を「同じパネル内で、同じ Apply で」行える経路のみである。

## 2. 対象範囲 — 「直接の子」かつ「leaf」かつ「既存投影で安全」

新設した `evaluateChildInlineEditEligibility(doc, parentNode, childNodeId)`（`src/edit/parentChildInlineEditSession.ts`）は、以下の3条件をすべて満たした場合にのみ、対応するリーフ投影を返す。

1. **直接の子であること**: `childNode.parentId === parentNode.id`。`BlockNode` が既に持つ `parentId` フィールドから自明に判定する（`isDirectChildOf`）——新規のツリー走査は行わない。孫以下は、たとえプレビュー内に表示されていても、この時点で `not-direct-child` として拒否する。
2. **leaf であること（孫を持たない）**: `childNode.childIds.length === 0`。孫を持つ子は `has-children` として拒否する——このチケットは「直接の子 1 件」を対象とし、その子自身がさらに子リストを持つケースは今回のスコープ外である。
3. **既存4つの standalone eligibility ゲートのいずれかを通過すること**: `isStandaloneListItemEligibleForMarkerFreeProjection`／`isStandaloneTaskListItemEligibleForMarkerFreeProjection`／`isStandaloneOrderedListItemEligibleForMarkerFreeProjection`／`isStandaloneMultiLineLeafListItemEligibleForProjection`＋`hasComplexBlockInMultiLineListItemContinuation`（いずれも `src/edit/standaloneMultiLineListItemProjection.ts` 等の既存関数）。これら4関数はいずれも `(doc, node)` という汎用シグネチャを持ち、トップレベル項目専用のロジックを一切含まないことを確認済みで、直接の子ノードに対してもそのまま呼び出せる。すべて失敗すれば `no-eligible-projection` として拒否する。

3条件すべてを満たした場合のみ、`buildChildLeafProjection(doc, childNode)`（既存4つの `build*Projection` への薄い dispatch、後述 §3）を呼び、その結果を含めて `{ ok: true, childNode, projection }` を返す。

## 3. 既存4リーフ投影の再利用 — 新しい投影ロジックは実装していない

`ChildLeafProjection`（判別可能 union、`kind: "list" | "task" | "ordered" | "multiLine"`）と、対応する `buildChildLeafProjection`/`invertChildLeafProjection` は、`src/edit/listMarkerProjection.ts`／`src/edit/taskListProjection.ts`／`src/edit/orderedListProjection.ts`／`src/edit/multiLineListItemProjection.ts`（4モジュールいずれも無変更のまま）の `build*Projection`/`invert*Projection` へ、対象の kind に応じて処理を委譲するだけの薄い dispatch 層である。marker／checkbox／number／indentation の可逆復元ロジック自体は一切複製していない——Phase 5L-6 の own-text 側 dispatch（`parentListItemProjection.ts` 自身の3優先度 dispatch）と対をなす、同じ設計方針の子側版である。

`projectedChildBodyText`／`projectedChildChecked`／`projectedChildNumberText`／`childEffectiveControlKind` は、この判別可能 union から UI が必要とする値を取り出すだけの薄いヘルパーで、4つの既存投影それぞれが持つ同名の概念（本文・チェック状態・番号テキスト・実効コントロール種別）をそのまま素通しする。

## 4. UI: 編集アフォーダンスとナビゲーションの分離

`renderParentChildPreview`（Phase 5L-6、既存）は、レンダリングのたびに `evaluateChildInlineEditEligibility` を直接の子それぞれに対してフレッシュに呼び直し（`eligibleFirstRowById: Map<相対行番号, childNodeId>`）、eligible な直接の子の**先頭行にのみ**、鉛筆アイコンの `<span role="button" tabindex="0">`（`unified-outliner-partial-edit-parent-child-inline-edit-button`、`setIcon(..., "pencil")`）を追加する。

このアフォーダンスの click/keydown ハンドラは、`evt.stopPropagation()`→`evt.preventDefault()`→`this.handleStartChildInlineEdit(eligibleChildId)` の順で処理する。Phase 5L-7 が同じ行に付けている行全体のナビゲーションハンドラ（`handleChildPreviewRowActivate`）は一切トリガーされない——ユーザーが「この項目を開く」つもりでクリックしたのか「この項目をここで編集する」つもりでクリックしたのかは、常にクリックした要素（行全体か、鉛筆アイコンか）だけで一意に決まり、どちらか一方に倒して推測することはない。

現在インライン編集中の子の行には、鉛筆アイコンの代わりに `unified-outliner-partial-edit-parent-child-preview-row-editing` ハイライトクラスが付く。この2つ（鉛筆アイコン／ハイライト）は同じ if/else の相互排他な分岐であり、同じ行に同時に現れることはない。

## 5. セッションの開始・切り替え・終了 — 既存 `DiscardChangesModal` の再利用のみ

### 5.1 開始（`handleStartChildInlineEdit`）

すでに同じ子が開いていれば何もしない。そうでなければ、パネル全体が clean（`isDirty()` が false——後述 §7 の通り、親の own-text と現在開いている子の draft の両方を折り込んだ結果）であれば即座に `buildParentChildInlineEditSession` を呼んでセッションを開く。dirty であれば、`requestLoadNode` が使うのと全く同じ `DiscardChangesModal`（「Applyして切り替え」「変更を破棄して切り替え」「キャンセル」の3択）を開く。

- 「キャンセル」: 何も起きない。
- 「変更を破棄して切り替え」: `cancelEdit()`（親・子両方の draft を revert）→現在のセッションを閉じる→新しいセッションを開く。
- 「Applyして切り替え」: `applyEdit()`（＝後述 §6 の combined Apply）を実行し、成功した場合のみ新しいセッションを開く。失敗すれば `applyEdit()` 自身がすでに理由付きの Notice を出しており、新しいセッションは開かれない。

`buildParentChildInlineEditSession` 自体は、開始のたびに `evaluateChildInlineEditEligibility` を再実行する——鉛筆アイコンが表示された時点の古いスナップショットを信用することは一切ない。

### 5.2 終了（`handleStopChildInlineEdit`）

子の draft が clean（`isChildInlineDraftDirty()` が false）であれば、確認なしで即座にセッションを閉じる。dirty であれば、同じ `DiscardChangesModal` を開く——ただしこちらは子の draft のみを対象とし、親の own-text の dirty 状態は選択肢の分岐に影響しない。

- 「変更を破棄」: 子のセッションのみを破棄して閉じる。親の draft（もしあれば）には一切触れない。
- 「Apply」: 同じ combined Apply を実行し、成功した場合のみセッションを閉じる。

## 6. Apply — 親のみ・子のみ・同時のいずれも1回の原子的操作

`applyEdit()` は、`childInlineSession` が開いている間は新設した `applyParentChildCombinedEdit(doc, editor)` へ分岐する。この分岐は、既存の単一 range `standaloneParentListItemProjection` 単独の分岐（Phase 5L-6）よりも**前**でチェックされる——子セッションが開いている間は、常にこの combined 経路のみが使われ、単一 range 経路が誤って使われることはない。

1. **dirty 判定**: 親の own-text（textarea／task checkbox／ordered number のいずれか）と、子の draft（`isChildInlineDraftDirty()`）を、それぞれ独立に判定する。両方 clean なら防御的に早期リターンする（Apply ボタン自体がこの状態では到達しない設計だが、念のための二重チェック）。
2. **invert + validate（`invertAndValidateParentChildCombinedEdit`）**: 親側は Phase 5L-6 の own-text invert 相当のロジック、子側は `invertChildLeafProjection` をそのまま利用し、dirty な側だけをそれぞれの ORIGINAL スナップショットから再構成する。dirty でない側は、常にそのプロジェクションの元の raw テキストをそのまま使う——編集していない側を推測で書き換えることはない。再構成した各候補は、(a) 親単独での再パース検証、(b) 子単独での再パース検証、(c) 親候補と（未編集の）子の元のスナップショットを結合した最終形の再パース検証、の3段階で安全性を確認する。いずれかが失敗すれば、具体的な reason（`parent-invalid-number`／`child-invalid-number`／`parent-own-text-unsafe-structure`／`child-unsafe-structure`／`candidate-structure-invalid`／`child-count-changed`／`child-no-longer-leaf`／`sibling-changed`／`parent-child-subtree-detached`／`parent-child-subtree-changed` のいずれか）とともに拒否する。
3. **現在の実文書への適用（`applyParentChildInlineEditToDocument`）**: 現在の `doc`／`editor` に対して、親・子それぞれの dirty な range のみを対象とした conflict 再チェック（dirty でない range は、他の場所で外部変更されていても Apply を拒否する理由にはならない——「触れていない range が Apply を止めることは決してない」という Phase 5L-6 由来の原則をそのまま踏襲）を行ったうえで、親の新しい own-text と子の新しい own-text の両方を反映した**1つの `lines` 配列**を構築し、`applyLineEditOutcome` を**1回だけ**呼ぶ。親のrangeと子のrangeを別々に2回 `applyLineEditOutcome` するようなことはしない——これにより、片方だけが保存されて片方が失敗する、という部分適用が構造的に起こり得ない。
4. いずれかの段階で失敗すれば、対応する reason キーを翻訳した Notice を表示してリターンする。ノート・パネルの draft のいずれも一切変更しない。

## 7. isDirty()/cancelEdit() — 親・子両方の draft をひとつの状態として扱う

`isDirty()` は、既存の親側の dirty 判定に `isChildInlineDraftDirty()`（子の body／checkbox（task のみ）／number（ordered のみ）を、`childInlineSession` の読み込み時スナップショットと比較）を OR で追加しただけである。子のみが dirty でも、パネル全体が dirty として扱われる——Apply/Cancel ボタンの表示、`requestLoadNode`（既存）と `handleStartChildInlineEdit`（新規）双方の未保存編集ガードのいずれも、この1つの統合結果を参照する。

`cancelEdit()` は、親側の各コントロールの revert（既存、無変更）に加えて、開いている `childInlineSession` があればその子側のコントロール（body／checkbox／number）も同じスナップショットへ revert する。ただし**セッション自体は閉じない**——`childInlineSession` を `null` にすることはない。Cancel は「同じ子の編集を続けたまま、未保存の変更だけ取り消す」動作であり、「子の編集をやめる」動作（それは §5.2 の `handleStopChildInlineEdit` の役割）ではない。

## 8. `childInlineSession` のライフサイクル

`childInlineSession: ParentChildInlineEditSession | null` は、`standaloneParentListItemProjection`（Phase 5L-6、既存）と同じタイミングですべてリセットされる——`resetLoadedState`／`loadNodeInternal`／`loadParagraphInternal`／`loadCompositeInternal` のいずれでも、`standaloneParentListItemProjection` 自身のリセットと同じ箇所で `childInlineSession = null` を実行する。新しい対象を読み込んだ瞬間に、古い子セッションが残留することはない。

Apply 成功後（§6 の最後）は、単純にクリアするのではなく、保存済みの文書を fresh に再パースし、`standaloneParentListItemProjection` を（他の兄弟 Apply 経路と全く同じ手順で）再構築したうえで、同じ `session.childNodeId` に対して `buildParentChildInlineEditSession` を再度呼び、成功すれば新しいセッションをそのまま開いた状態に保つ。これにより、同じ子を続けて編集し、2回目以降の Apply も同じセッションから行える。再構築が失敗した場合（親子いずれかの構造が Apply の瞬間から即座に変化したなど、事実上到達不能なケース）は、他の兄弟フィールドの再構築失敗時と同じ「安全側に倒して閉じる」規約に従い、インライン編集パネルを閉じて読み取り専用プレビューへ静かに戻る。

## 9. fixture 配置方針

既存フェーズと同じ方針を維持している（プロジェクトメモリ `unified-outliner-verification-fixture-placement-policy.md` 参照）。本チケットの実機検証用 fixture は `/Users/kazumikaizuka/Obsidian/ipad-test/Test/parent-child-inline-structured-edit-verification.md` として配置し、リポジトリ内やその他 vault への複製は行わない。fixture には、4種類のリーフ子（unordered／task／ordered／複数行）をすべて持つ親、孫を持つ子と複雑ブロック continuation を持つ子（いずれも対象外）を混在させた親、own-text 自体が task/ordered の親、own-text の continuation と孫を含む複雑な親（Phase 5L-6/5L-7 由来のケースとの非干渉確認用）を含めている。

## 10. 変更・追加したファイル

- `src/edit/parentChildInlineEditSession.ts`（新規）: `ChildLeafProjection`／`buildChildLeafProjection`／`invertChildLeafProjection`（既存4投影への dispatch）、`evaluateChildInlineEditEligibility`／`isDirectChildOf`（eligibility 判定）、`resolveChildOwnTextRange`／`isChildRangeWithinParentChildSubtree`、`ParentChildInlineEditSession`／`buildParentChildInlineEditSession`（セッション構築）、`invertAndValidateParentChildCombinedEdit`（invert+3段階validate）、`applyParentChildInlineEditToDocument`（現在の実文書への原子的適用）。Obsidian 非依存の純粋関数群。
- `src/view/PartialEditView.ts`（既存・拡張）: `childInlineSession` フィールド、子インライン編集パネル用の DOM フィールド群（`childInlineEditorEl` 等）と `onOpen` での構築、`renderParentChildPreview` への鉛筆アイコン／ハイライト配線、新規 `renderChildInlineEditor`／`handleStartChildInlineEdit`／`handleStopChildInlineEdit`／`isChildInlineDraftDirty`／`applyParentChildCombinedEdit`、`applyEdit`・`cancelEdit`・`isDirty`・4箇所の load/reset メソッドへの統合。
- `src/i18n.ts`（既存・拡張）: `partialEdit.parentChildInlineEditStartLabel`／`Stop`／`PanelLabel`／`Failed`／`Applied`／`ChildStructureInvalid`／`CandidateInvalid`／`Conflict`／`ResolveFailed` の9キーを en/ja 両辞書に追加。
- `styles.css`（既存・拡張）: `.unified-outliner-partial-edit-child-inline-editor`（＋header/label/stop/row/textarea の各 modifier）、`.unified-outliner-partial-edit-parent-child-inline-edit-button`（＋hover/focus-visible）、`.unified-outliner-partial-edit-parent-child-preview-row-editing`。加えて、`child-inline-editor` も `toggleVisibility(false)` で隠される行として、既存の「`visibility: hidden` を `display: none` へ強制する」実機修正済みセレクタ一覧に追加した（Phase 5L-6/6D-2B/5L-2/5L-3 で確認済みの、隠れた行がパディング／高さを予約し続ける実機バグと同じパターンを未然に防ぐため）。
- `tests/parentChildInlineEdit.test.ts`（新規、45件）: 実 `parseDocument` を使った純粋関数の単体テスト。
- `tests/parentChildInlineEditUiWiring.test.ts`（新規、21件）: View 配線の静的ソース確認。
- `tests/compositeBlockPartialEditUiWiring.test.ts`（既存・更新）: 「textarea は1つだけ」というアサーションを、`childInlineTextareaEl` という新しい、無関係な textarea が正当に増えたことを反映して更新した。
- `tests/partialEditStalePaneSyncUiWiring.test.ts`（既存・更新）: `DiscardChangesModal` 呼び出し箇所数（5→7）／`syncState = "synced"` 出現数（9→10）の期待値を、本チケットが正当に追加した箇所数を反映して更新した。
- `docs/統合実装ロードマップ_2026-08-05.md`（既存・更新）: ヘッダー・フェーズ状況テーブル・新規 §3.21・§5 関連ドキュメント一覧。
- `CHANGELOG.md`（既存・更新）: `### Added` に新規箇条書きを追加。
- `docs/phase5l8_parent-child-inline-structured-edit.md`（新規、本ファイル）。
- `/Users/kazumikaizuka/Obsidian/ipad-test/Test/parent-child-inline-structured-edit-verification.md`（新規、実機検証用 fixture）。

変更していないファイル（意図的、確認済み）: `src/edit/parentListItemProjection.ts`・`src/edit/standaloneParentListItemProjection.ts`・`src/edit/listMarkerProjection.ts`・`src/edit/taskListProjection.ts`・`src/edit/orderedListProjection.ts`・`src/edit/multiLineListItemProjection.ts`・`src/edit/standaloneListMarkerProjection.ts`・`src/edit/standaloneTaskListProjection.ts`・`src/edit/standaloneOrderedListProjection.ts`・`src/edit/standaloneMultiLineListItemProjection.ts`（4つの eligibility ゲート・4つのリーフ投影はすべて完全に無変更のまま再利用のみ）・`src/edit/quotePrefixProjection.ts`・`src/edit/compositeBlockPartialEdit.ts`・`src/edit/partialEdit.ts`・`src/model/block.ts`。

## 11. 将来候補（今回のスコープ外）

- 孫を持つ子のインライン編集（孫以下すべてを含む複数階層の同時展開編集）。
- 複数の子を同時にインライン編集すること（今回は常に「ちょうど1件」まで）。
- 子項目の親 pane 内での add/delete/move/drag/indent/outdent。
- 子の marker種別変更・checkbox status対応範囲拡大・ordered delimiter変更。
- CompositeBlock child member 専用のインライン編集 UI。
- Phase 5L-6/5L-7 の own-text range/Apply/conflict/navigation 契約の変更。
- child-only な外部変化に伴う既存 stale 判定機構の改修（Phase 5L-6 由来の既知の UX 上の限定事項は本チケットでも維持）。
- sibling 自動採番。
- 3件以上の子を跨いだ一括Apply（今回は常に「親＋選択中の子1件」の最大2 range のみ）。
