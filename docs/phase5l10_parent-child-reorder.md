# Phase 5L-10: Direct Child Leaf Reorder in Parent Partial Edit Pane

## 1. 位置づけ — Phase 5L-6/5L-7/5L-8/5L-9 との責務分離

Phase 5L-6（既存・無変更）は親 list item の own-text を構造化編集できるようにし、Phase 5L-7（既存・無変更）は子プレビューを読み取り専用ナビゲーション入口へ拡張し、Phase 5L-8（既存・無変更）は直接の子のうちちょうど1件をパネル内でインライン構造編集できるようにし、Phase 5L-9（既存・無変更）は直接の子リストの末尾への追加と、既存の直接の子1件の削除を新設した。しかしどのフェーズでも、既存の直接の子どうしの「並び順」自体を変えることはできなかった——並び替えたい場合は常に Outline Tree 側の drag & drop に頼る必要があった。

Phase 5L-10 は、この「直接の子リーフどうしの兄弟順序」を、親の Partial Edit Pane から離れることなく変更できるようにする。具体的には、「↑/↓」ボタンによる隣接swapのみ（ドラッグ＆ドロップは伴わない）で、親own-text編集・Phase 5L-8の既存子インライン編集・Phase 5L-9の追加/削除と**同じApply**で同時に保存できるようにする。

Phase 5L-6〜5L-9が確立した own-text range/child-subtree range の分離、既存4リーフ投影の再利用、`invertAndValidate*`→再パース検証→現在の実文書への原子的適用という3段階の設計は、Phase 5L-10でも一切変更していない。Phase 5L-10が新設したのは、`ParentChildAddDeleteSession`への2フィールド（`pendingReorderOrder`/`reorderAvailable`）の追加と、それに付随する純粋関数・Apply分岐・UIの配線のみである。

## 2. スコープ: 並び替え対象のeligibility

### 2.1 対象条件: Phase 5L-8/5L-9の編集・削除可能性と完全に同一

`evaluateChildReorderEligibility`は`evaluateChildInlineEditEligibility`の**別名（エイリアス関数）**であり、新しい判定ロジックは一切実装していない——直接の子であること・leafであること（孫を持たない）・4つの既存投影のいずれかで安全に構築できること、という Phase 5L-8/5L-9 と全く同じ条件を満たした行にのみ、上下矢印ボタンが表示される。CompositeBlock member は本モジュール全体を通じてそもそも「子」として解決されない（`edit/parentListItemProjection.ts`側で構造的に保証済み）ため、個別の除外チェックは不要である。`unsafeIndent`な子・再解決に失敗する子も同じエイリアス経由で自動的に除外される。

対象外（孫を持つ子・CompositeBlock member・unsafeIndentな子など）の行は、並び替えボタンが表示されないだけでなく、他の対象の子が並び替えでその行を飛び越えることも構造的に一切できない（§3.2参照）——プレビュー上は読み取り専用・ナビゲーションのみ可能な行のまま、Phase 5L-8/5L-9と変わらない見た目・挙動を保つ。

### 2.2 並び替えボタン自体の表示ゲート: 「詰まっている」parentのみ（`isChildSubtreeTightlyPacked`）

新設`isChildSubtreeTightlyPacked(childSlots, childSubtreeLineCount)`は、直接の子どうしの間（および先頭の直前・末尾の直後）に1行も空行（blank gap line）を挟まない場合にのみ`true`を返す——parent単位で計算する、個々の子のeligibilityとは独立したゲートである。`false`の場合、その親の子プレビューでは並び替えボタンが一つも表示されない（既存の読み取り専用プレビュー・追加・削除ボタンは影響を受けない）。

このゲートが必要な理由は、並び替えdirty時の child subtree 全体の再構成（§6）が「各子の captured rawText を`"\n"`で単純に連結するだけ」で済むのは、失われる／取り違えられるgap行が一つも無いことをこのゲートが既に保証しているからである——どの兄弟が境界のblank lineを「所有」しているかを推測する必要がある一般的なケース（子が並び替えで動いた場合、その所有権をどう維持するかが曖昧になる）を、本チケットでは意図的に「並び替え自体を提供しない」という形で回避した。孫を持つ非対象の子が間に挟まっていても、その子自身のrawTextには孫のsubtreeも含めてそのままcaptureされているため、このゲート自体はgapの有無のみを見ており、leaf性とは無関係——孫持ちの子を含む「詰まった」parentでも並び替えは利用できる（§4のfixtureの親項目Bが対応するケース）。

## 3. 並び替え操作 — 「↑/↓」の隣接swapのみ

### 3.1 操作モデル: ドラッグ＆ドロップは今回のスコープ外

各対象の子の行には、Phase 5L-8の鉛筆アイコン・Phase 5L-9のゴミ箱アイコンに加えて、上下2つの矢印ボタン（↑↓）が表示される。デスクトップ・iPadいずれも同じボタンで、タップ／クリックで即座にswapが実行される（確認ダイアログは無い——後述の通りDiscardChangesModalも経由しない）。先頭の対象の子には「↑」が、末尾の対象の子には「↓」が押せない状態（`aria-disabled="true"`・`tabindex="-1"`・CSSで視覚的に減光）で表示される。

### 3.2 純粋関数`moveChildInPendingReorder`: 対象外の兄弟を決して飛び越えない

```
moveChildInPendingReorder(
  currentOrder: string[],
  eligibleChildNodeIds: ReadonlySet<string>,
  excludedChildNodeId: string | null,
  childNodeId: string,
  direction: "up" | "down"
): { ok: true; newOrder: string[] } | { ok: false; reason: ChildReorderMoveRejectReason }
```

- 移動対象自身（`childNodeId`）が`eligibleChildNodeIds`に含まれない、または現在の削除保留対象（`excludedChildNodeId`）と一致する場合は`"not-eligible"`で拒否する。
- `currentOrder`内での移動対象の位置が見つからない場合は`"not-in-order"`で拒否する（防御的のみ——このモジュールが呼ぶすべてのidは常に`childSlots`由来）。
- 移動方向に隣接するidが存在しない場合（先頭の「↑」・末尾の「↓」）は`"at-boundary"`で拒否する。
- 移動方向に隣接するidが存在しても、それが`eligibleChildNodeIds`に含まれない、または現在の削除保留対象と一致する場合は`"neighbor-not-eligible"`で拒否する——孫を持つ子・削除保留中の子は、それ自身が移動することも、他の子のswap先になることも構造的に一切あり得ない。

UI（`renderParentChildPreview`の`makeReorderButton`）は、各ボタンの有効/無効状態をこの関数自身の返り値（`.ok`のみを見て実際のswapは行わない、いわば「dry-run」呼び出し）で毎回フレッシュに計算する——独立した2つ目の「押せるかどうか」ロジックを持たない。実際のクリックハンドラ（`handleReorderChild`、§7.3）も、同じ関数を実際にcurrentOrderへ適用する形で再度呼び出す。

### 3.3 複数回操作の合成

UIは連続した複数回のクリックを許可するが、内部的には常に1つの最終的な`pendingReorderOrder`（`ParentChildAddDeleteSession`が保持する、`childSlots`のidの並び替え保留順序）として保持する——「操作の履歴」ではなく「現在の並び順」だけを保持するモデルであり、上→下のような正味no-opな操作列は最終的に元の順序へ戻る。

## 4. セッションモデルの拡張

`ParentChildAddDeleteSession`（Phase 5L-9・既存）へ、以下の2フィールドを追加した。

| フィールド | 型 | 説明 |
|---|---|---|
| `pendingReorderOrder` | `string[]` | `childSlots.map(s => s.nodeId)`の並び替え保留順序。`buildParentChildAddDeleteSession`がidentity順（`childSlots`自身の元の順序）で初期化し、`moveChildInPendingReorder`の返り値を通じてのみ更新される。 |
| `reorderAvailable` | `boolean` | §2.2の「詰まっている」ゲートの計算結果。セッション構築時に1回だけ`isChildSubtreeTightlyPacked`で計算し、以後は再計算しない（`childSlots`自体がセッション再構築のたびに作り直されるため、常に最新の状態を反映する）。 |

「並び替えが実際にdirtyか」は新設`isPendingReorderDirty(session)`が`pendingReorderOrder`と`childSlots`由来のidentity順との単純な配列比較（長さ・各要素）で判定する——up→downのような正味no-opな操作列は「dirtyでない」として扱われる、既存の`isNewChildDraftDirty`と同じ設計原則である。この1関数が、`cancelEdit()`のガード条件・`hasAddDeleteActivity()`（延いては`isDirty()`）・combined-Apply の要否判定・target-switchガードのすべてで共有され、二重に判定ロジックが分岐することはない。

## 5. combined候補検証（`invertAndValidateParentChildAddDeleteEdit`）

`InvertParentChildAddDeleteEditInput`へ新設した`reorderDirty: boolean`フラグが、Stage 4（child subtreeの候補テキスト構築）とStage 6（候補の再パース後の per-child 検証）の両方で、完全に別の分岐を選択する。

- **`reorderDirty`が`false`の場合**: Phase 5L-9までの位置ベースReplacement splice処理（既存子置換の差し替え・削除対象の除去を、`childSlots`の元の位置情報に基づき後ろから前へ適用する）が、1バイトも変更されず引き続き実行される——並び替えという概念を一切知らないコードパスであり、Phase 5L-1〜5L-9のあらゆるApplyシナリオへの回帰リスクはゼロである。
- **`reorderDirty`が`true`の場合**: `addDeleteSession.reorderAvailable`が`false`なら即座に`"reorder-not-available"`で拒否する（防御的——UIは`reorderAvailable`が`false`の間`pendingReorderOrder`をidentity順から一切動かさないため、通常はここに到達しない）。それ以外は、`pendingReorderOrder`を辿ってchild subtree全体を組み直す——削除保留対象はスキップし、インライン編集中の既存子は編集後の候補テキストに差し替え、それ以外は`childSlots`のcapturedなrawTextをそのまま使う。参照先のidが`childSlots`に見つからない場合は`"reorder-target-missing"`で拒否する（防御的——`pendingReorderOrder`は構造的に常に`childSlots`のidの順列である）。

Stage 6の期待値リスト（`expectedSlots`）も同様に、`reorderDirty`の場合は`pendingReorderOrder`の順で構築される——「並び順だけが変わっている」ことの検証は、この期待値リストの各位置の期待テキストが、対象がまだ`childSlots`内に存在する限り常に元のcapturedなrawTextのままであることによって、既存のbyte-for-byte比較（`sibling-changed`判定）がそのまま担保する。新しいAPIやバリデーションを新設してはいない。

新規子の追加（`newChildRawText`）は、並び替えの有無にかかわらず常にchild subtree全体の**末尾**に追記される——Phase 5L-9と同じ「常に末尾固定」の契約を、並び替えとの組み合わせでも変えていない。

## 6. atomic書き込み（`applyParentChildAddDeleteToDocument`）

新設の第9引数`reorder: ReorderLiveApplyInput | null = null`（`{ orderedChildNodeIds: string[]; originalChildSubtreeText: string }`）が非`null`の場合のみ、専用の分岐へ入る。

1. **全idのfresh再解決**: `reorder.orderedChildNodeIds`の各idを現在の実文書に対して1件ずつ再解決し、直接の子であること・`unsafeIndent`でないこと・親のchild-subtree range内に収まっていることを確認する。**leaf性（`childIds.length === 0`）はここでは要求しない**——`moveChildInPendingReorder`の構造的ガードにより、対象外（孫を持つ等）の子は並び替えで一切位置が変わらないため、その子は自身の全文（孫のsubtreeを含む）をそのまま素通りさせればよい。いずれかのidが解決できなければ`"reorder-target-resolve-failed"`で拒否する。
2. **whole-subtree conflict判定**: 並び替えは全ての直接の子の位置を一度に書き換えるため、「このApplyが触れないrange」という前提が成立しない。そのため、既存子・削除対象それぞれの個別range conflict チェックの代わりに、現在のchild subtree全体のテキストを`reorder.originalChildSubtreeText`と1回だけbyte-for-byte比較する（`"reorder-conflict"`）。既存子・削除対象それぞれの構造検証（leaf性・直接の子であること・unsafeIndentでないこと）自体は、差し替え・除外の目的で従来通り独立して実行される。
3. **1つの再構成spanとして書き込み**: 既存子range・削除対象rangeを個別のspanとして扱わず、`childSubtreeRange`全体を1つの再構成spanで置き換える——親own-textのspan・新規子挿入のspan（あれば）と合わせて、常に1回の`lines`配列構築で完結する。

### 6.1 実装当初のバグとその修正

上記1のfresh再解決ループは、実装当初は誤って全idに対して`node.childIds.length === 0`（leaf条件）を要求していた。これは「詰まっているが孫を持つ非対象の子を1件でも含む」parent（§2.2の`isChildSubtreeTightlyPacked`の設計上サポートされているはずのケース）で、並び替えを一切Applyできない実装ミスであった。新設テスト`tests/parentChildReorder.test.ts`の作成中にこの不整合（孫を持つ子を含む fixture で`reorder-target-resolve-failed`が常に返る）を検出し、同日中に該当チェックを削除して修正した——invert/validate側（§5）の候補再構成には元々この過剰な要求は無く、ライブ書き込み側だけが不整合だった。

## 7. UI配線（`src/view/PartialEditView.ts`）

### 7.1 プレビューへの反映（`renderParentChildPreview`）

`reorderAvailable`が`true`の間、`projection.childSubtreeText`をそのまま表示する代わりに、`pendingReorderOrder`を辿って`childSlots`のrawTextを連結し直した行配列を表示する——保留中の並び替え結果がApply前にプレビュー上で確認できる（`pendingReorderOrder`がidentity順のままなら、これは元の表示とバイト単位で同一になる）。`reorderAvailable`が`false`の場合は、Phase 5L-1〜5L-9までと全く同じ`projection.childSubtreeText.split("\n")`をそのまま使う。

Phase 5L-7由来の`childPreviewRowTargets`（行クリックナビゲーション）は元の文書の行位置に紐づいているため、並び替えが実際にdirtyな間（`isPendingReorderDirty(...)`が`true`の間）はナビゲーションを安全に一時停止する（`navigationSafe`フラグ）——推測でリマップを試みるのではなく、Apply または Cancel でプレビューが作り直されると同時に復帰する。

### 7.2 上下ボタンの描画

対象の子（eligible かつ非削除保留）の行にのみ、`reorderAvailable`が`true`の間だけ描画される、ナビゲーション・鉛筆アイコン・ゴミ箱アイコンから完全に独立した4つ目のコントロール。クリック／Enter/Spaceのハンドラは`evt.stopPropagation()`/`evt.preventDefault()`を最初に呼んでから`handleReorderChild`へ委譲する。

### 7.3 `handleReorderChild`: fresh再検証

矢印ボタンのクリック1回につき、`reorderAvailable`・現在の文書からの`parentNode`解決・`evaluateChildReorderEligibility`による全対象idのfresh再計算を行ったうえで、`moveChildInPendingReorder`へ委譲する——プレビュー描画時点のeligibilityスナップショットを信用しない。失敗時は`Notice`のみで静かに何もしない（ボタン自体がすでに無効化されているはずのため、通常は到達しない防御的経路）。成功時は`pendingReorderOrder`を更新し、`renderParentChildPreview()`と`updateDirtyState()`を呼ぶ。

**DiscardChangesModalは経由しない**（`handleRequestAddChild`と同じ理由）——矢印ボタンのクリックは純粋にこのセッション自身の保留状態へ加算されるだけで、何かを破棄する操作ではないため、確認ダイアログを挟まず即座に反映する。

### 7.4 Apply（`applyParentChildAddDeleteCombinedEdit`）

`reorderDirty = isPendingReorderDirty(addDeleteSession)`を計算し、既存の no-op ガード（`!parentDirty && !existingChildDirty && !hasDeletion && !hasNewChild`）へ`&& !reorderDirty`を追加した。`reorderDirty`は`invertAndValidateParentChildAddDeleteEdit`への入力へそのまま渡され、`reorderDirty`の場合のみ`ReorderLiveApplyInput`（`{ orderedChildNodeIds: addDeleteSession.pendingReorderOrder, originalChildSubtreeText: projection.childSubtreeText }`）を構築して`applyParentChildAddDeleteToDocument`の最後の引数として渡す。

### 7.5 実機発見バグとその修正（CSSの行またぎフロートbleed）

実機（iPad）での確認中、子プレビューの各行にある鉛筆／ゴミ箱／上下ボタンの位置が行を追うごとに徐々に左へずれ、最終行では要素群が完全に切り離されてプレビュー全体の下に別の行として浮いてしまう現象が報告された。

原因は `.unified-outliner-partial-edit-parent-child-preview-row`（子プレビューの各行）にあった。この行1つにつき、鉛筆（Phase 5L-8）・ゴミ箱（Phase 5L-9）・上下ボタン（本チケット）の最大3つのアフォーダンスがいずれも `float: right` で配置されるが、行自身のdiv要素にはこれらの浮動要素を内包させるための指定（Block Formatting Contextの確立）が無かった。上下ボタン群（ボタン2個、高さ約20px）はテキスト1行の行高より高いため、その超過分がそのまま次の兄弟行のボックスへはみ出す。行を内包しないdivでは、浮動要素の高さは自身の高さ計算に含まれないため、複数行にわたってこのはみ出しが蓄積し、報告された階段状のずれ・最終行の分離という見た目になっていた。

修正は `.unified-outliner-partial-edit-parent-child-preview-row` へ `overflow: hidden;` を追加し、各行に自前のBlock Formatting Contextを持たせることのみ——行は自身の浮動要素を常に完全に内包し（必要なら自動的に少し縦に伸びる）、隣の行へ一切はみ出さなくなる。TypeScript側のDOM構造・イベント配線は無変更のため、既存のUI配線テスト（`tests/parentChildReorderUiWiring.test.ts` 等）に対する影響は無く、CSSファイルのみの変更で修正した。`npx tsc --noEmit`／`npx vitest run`（139ファイル・2,852テスト全通過）／`npx eslint .`（既知の許容ベースライン23件を維持）／`npm run build` のいずれも修正後に再実行し、クリーンであることを確認済み。

### 7.6 実機発見バグその2とその修正（auto-reload時にchildAddDeleteSessionが再構築されない）

実機での確認中、(1) 並び替えをApplyする、(2) ノート本文側でエディタのUndoによりApply前の状態へ戻す、という操作を行うと、本文は正しく元に戻るにもかかわらず、Partial Edit Paneの子プレビューは並び替え後のままで反映されない現象が報告された。

このプラグインには、パネルの外側でノートが変化した場合に備える既存の一般機構（Phase 5A-1の`syncState`/`performStaleCheck`/`evaluateAgainstText`/`classifySyncOutcome`）がある。パネルが「dirtyでない（＝クリーン）」場合に限り、外部の変化は`performAutoReload`によって静かに——確認ダイアログ無しで——パネルの内部状態へ反映される（dirtyな場合は代わりに`stale`状態としてバナーを出し、Applyを無効化する）。エディタのUndoは`editor-change`イベントを発火させるため、Apply直後のクリーンな状態のこのパネルでは、この`performAutoReload`経路が正しく起動していた。

原因は`performAutoReload`自身にあった。このメソッドは`standaloneParentListItemProjection`（親own-textの投影）を再構築済みのdocから作り直すが、Phase 5L-9で新設した`childAddDeleteSession`（`pendingReorderOrder`・`pendingDeletion`・`newChildDraft`・`childSlots`を保持するセッション）は作り直していなかった。一方、このファイル内の他のすべての`standaloneParentListItemProjection`再構築箇所（初回ロード、Phase 5L-8/5L-9それぞれのApply成功時の3箇所）は、いずれも「`standaloneParentListItemProjection`を再構築したら、必ず`childAddDeleteSession`も同時に作り直す」という一貫した契約に従っていた——`performAutoReload`だけがこの契約から漏れていた。結果として、auto-reload後に呼ばれる`renderParentChildPreview()`は、新しいdocではなく、reloadより前の（並び替え後の）`childSlots`/`pendingReorderOrder`を使ってプレビューを描画し続けていた。

修正は`performAutoReload`の`if (this.nodeId && this.standaloneParentListItemProjection)`ブロック内、`standaloneParentListItemProjection`の再構築に続けて、他の3箇所と全く同じ形で`childAddDeleteSession`を`buildParentChildAddDeleteSession`により再構築し、`childInlineSession`を`null`にリセットする1文を追加しただけである（`childInlineSession`を再構築ではなく`null`にリセットするのは、初回ロード時の同フィールドの扱いと同じ理由——auto-reloadは外部からの制御不能な変化であり、そこで開かれていたインラインエディタの対象がそもそもまだ存在するかどうかも保証できないため）。

この欠落は、実装当初は`performAutoReload`に対する`childAddDeleteSession`再構築のテストが1件も存在しなかったことによって見過ごされていた——`performAutoReload`は他の4つの投影（quote/list-marker系/parent own-text/CompositeBlock）についてはそれぞれ専用のテストで再構築が確認されていたが、Phase 5L-9で新設された`childAddDeleteSession`だけが対象外のままになっていた。今回、`tests/parentChildAddDeleteUiWiring.test.ts`に専用テストを1件追加し、この契約を今後も保証するようにした。

`npx tsc --noEmit`／`npx vitest run`（139ファイル・2,853テスト全通過、新設テスト1件を含む）／`npx eslint .`（既知の許容ベースライン23件を維持）／`npm run build`のいずれも修正後に再実行し、クリーンであることを確認済み。

### 7.7 実機発見バグその3とその修正（フロートの独立ラップ — flexboxへの全面移行）

§7.5で修正した「行をまたぐフロートのbleed」対策（`overflow: hidden`）を適用した後も、実機での確認により別の症状が報告された。子項目のテキストが長い場合（または部分編集ペインの幅が狭い場合）、鉛筆・ゴミ箱アイコンは1行目に収まるものの、上下の並び替えボタンだけが独立して2行目に折り返されてしまう——4つのコントロールが常に一体として左右に並ぶべき、という前提と相容れない見た目になっていた。

原因は§7.5の修正では解決していなかった、別種の問題だった。鉛筆（Phase 5L-8）・ゴミ箱（Phase 5L-9）・上下ボタン（本チケット）はそれぞれ独立した`float: right`要素であり、テキストと3つのフロート全てが1行の幅に収まらなくなると、CSSのフロート配置アルゴリズムは収まりきらない要素を独立して次の行へ折り返す。DOM順（鉛筆→ゴミ箱→上下ボタン）の末尾にある上下ボタンのグループが、テキストの長さや幅の条件によって単独で折り返されることになる。§7.5の`overflow: hidden`は「行をまたぐbleed」は防ぐが、「同じ行の中で複数のフロートが互いに独立して折り返される」という、全く別の問題までは解決していなかった。

修正は、フロートを全面的にflexboxに置き換えることで行った。`renderParentChildPreview`の行作成を変更し、行自体に`text:`オプションで直接テキストを設定する代わりに、新設の専用スパン（`preview-row-text`）に分離した。鍵となるのは、鍵・ゴミ箱・上下ボタンの3つをそれぞれ別々に元`rowEl`に付けるのではなく、**共通の1つのactionsグループ（`rowActionsEl`、新設`preview-row-actions`クラス）にまとめて付ける**ことである。CSS側では、`preview-row`自体を`display: flex; align-items: center;`の2子要素構成にし、`preview-row-text`は`flex: 1 1 auto; min-width: 0; overflow: hidden;`で必要に応じて縮み（長すぎる場合はクリップされる）、`preview-row-actions`は`flex-shrink: 0;`で決して縮まず、常に全体が一行に収まるようにした。`flex-direction: row-reverse`により、DOM順（鍵→ゴミ箱→下→上）とタブ順は変えず、以前の`float: right`が作っていた見た目の順序（左から右へ上下ボタン・ゴミ箱・鍵）をそのまま保った。これに伴い、削除保留中行の取り消し線（`text-decoration: line-through`）も、フレックスコンテナへの自動伝播に依存しないよう、新設`preview-row-text`自体にも明示的に適用するよう修正した。

TypeScript側の変更は、`rowEl.createSpan(...)`を`rowActionsEl.createSpan(...)`に変えるだけで、各ボタン自体のロジック（eligibility判定・イベント配線）は一切既存のままである。既存のテストはいずれもこの作成先のリテラル文字列を検査していなかったため（アイコン自体の設定・event listenerの配線のみを検査していた）、既存の139ファイル・2,853テストは全件無修正で通過した。再発防止のため、`tests/parentChildReorderUiWiring.test.ts`に新規 describe ブロックを追加し、(1) 行のテキストが専用スパンに分離されていること、(2) 鍵・ゴミ箱・上下ボタンの3つがすべて`rowActionsEl`に付けられており、二度と`rowEl`に直接付けられていないことを確認するテストを2件追加した。

この修正により、フロートを一切使わない構造になったため、行をまたぐbleed（§7.5）と同一行内での独立ラップ（本節）の両方が構造的に不可能になった。§7.5の`overflow: hidden`フィックス自体はもう必要ないため削除している（フロートが存在しない以上、bleedも起こりえない）。

`npx tsc --noEmit`／`npx vitest run`（139ファイル・2,855テスト全通過、新設テスト2件を含む）／`npx eslint .`（既知の許容ベースライン23件を維持）／`npm run build`のいずれも修正後に再実行し、クリーンであることを確認済み。

### 7.8 実機フィードバック（タップターゲットのサイズをStyle Settingsのフォントサイズに連動）

11インチiPadでの実機検証により、鍵・ゴミ箱・上下ボタンが固定の12pxアイコン＋1px～4pxのパディングしかなく、指でのタップが困難との報告を受けた。固定値で大きくするだけでなく、このプラグインがすでにStyle Settingsコミュニティプラグインに公開している「Font Size」設定（CSS変数 `--uo-font-size`、デフォルト14px、スライダーで10～22px）に連動させてほしいという要望を受けた。

`.unified-outliner-partial-edit-parent-child-preview-body`（子プレビュー全体を包むコンテナ）はすでに`font-size: var(--uo-font-size, 14px);`を持ち、鍵・ゴミ箱・上下ボタンのいずれもこの値を途中で上書きするルールなしに継承（inherit）している。この継承を利用し、各ボタン自体には新たな`font-size`を一切宣言せず、パディングとアイコンの幅・高さだけを`em`単位（ボタン自体のフォントサイズ基準）に変更した——パディングは3つとも`0.5em`に統一（以前は鍵・ゴミ箱が1px、上下ボタンが4pxと不一致だった）、アイコン自体は全て`1.1em`とした。結果、デフォルトの14px設定でも以前より少し大きくなり（タップターゲット約29.4px）、ユーザーがStyle SettingsでFont Sizeを上げれば（最大22px）タップターゲットも約46pxまで比例拡大する——行のテキスト自体がすでに同じ方式でスケールしていたのと完全に同一の仕組みである。上下ボタン間の`gap`（2px→`0.2em`）とactionsグループ全体の`gap`（4px→`0.3em`）も同様に`em`化し、ボタンが大きくなっても詰まって見えないようにした。

CSSのみの変更でTypeScript側は無修正のため、139ファイル・2,855テストは全件無修正で通過した。`npx tsc --noEmit`／`npx eslint .`（既知の許容ベースライン23件を維持）／`npm run build`も修正後に再実行し、クリーンであることを確認済み。

## 8. 競合・Cancel・対象切り替え

- **Cancel**: `cancelEdit()`は、新規子下書き・削除保留と同様に、`pendingReorderOrder`を`childSlots`由来のidentity順へ戻す——並び替え前の元の表示に完全に復元される。
- **対象切り替え**: `hasAddDeleteActivity()`が`isPendingReorderDirty(session)`をORの一項として含むよう拡張されたことで、既存の`requestLoadNode`/`DiscardChangesModal`（Apply/Discard/Cancelの安全な切り替え契約）は、並び替えの保留も他の未保存編集と全く同じに扱う——新しい分岐やUIは新設していない。
- **Apply拒否**: §5/§6で述べた通り、`"reorder-not-available"`/`"reorder-target-missing"`（invert/validate段階）、`"reorder-target-resolve-failed"`/`"reorder-conflict"`（live-apply段階）のいずれについても、ノート・パネルの状態（親own-text draft・既存子draft・新規子下書き・削除保留・並び替え保留のすべて）は一切変更されない——部分的な書き込みは構造的に起こり得ない。

## 9. fixture配置方針

実機検証用fixtureは、既存のプロジェクトメモリ方針（`unified-outliner-verification-fixture-placement-policy.md`）通り、`/Users/kazumikaizuka/Obsidian/ipad-test/Test/parent-child-reorder-verification.md`にのみ配置し、リポジトリ内やその他vaultへの複製は行っていない。

## 10. 変更・追加したファイル

- `src/edit/parentChildInlineEditSession.ts`（既存・拡張）: 同じモジュールにPhase 5L-10セクションを追加。`evaluateChildReorderEligibility`（`evaluateChildInlineEditEligibility`のエイリアス）、`isChildSubtreeTightlyPacked`、`ChildReorderDirection`／`ChildReorderMoveRejectReason`／`ChildReorderMoveResult`／`moveChildInPendingReorder`、`ParentChildAddDeleteSession`への`pendingReorderOrder`/`reorderAvailable`フィールド追加、`isPendingReorderDirty`、`InvertParentChildAddDeleteEditInput`への`reorderDirty`フィールド追加とStage 4/6の並び替え分岐、`ReorderLiveApplyInput`、`applyParentChildAddDeleteToDocument`への`reorder`引数追加とfresh再解決/whole-subtree conflict分岐。Phase 5L-8/5L-9の既存エクスポートは一切変更していない（§5/§6で述べた「dirtyでない場合は既存コードパスを一切通らない」設計のため）。
- `src/view/PartialEditView.ts`（既存・拡張）: Phase 5L-10のimport追加、`renderParentChildPreview`への並び替えプレビュー分岐・`navigationSafe`ガード・上下ボタン描画の追加、新規`handleReorderChild`、`hasAddDeleteActivity`／`cancelEdit`／`applyParentChildAddDeleteCombinedEdit`への配線。実機発見バグその2の修正として、`performAutoReload`内の`childAddDeleteSession`再構築・`childInlineSession`リセットを追加（§7.6）。実機発見バグその3の修正として、子プレビュー行のDOM構造をテキスト専用スパン（`preview-row-text`）＋共通actionsグループ（`preview-row-actions`）に再構成（§7.7）。
- `src/i18n.ts`（既存・拡張）: `partialEdit.parentChildReorderUpLabel`／`...DownLabel`／`...Failed`の3キーをen/ja両辞書に追加。
- `styles.css`（既存・拡張）: `.unified-outliner-partial-edit-parent-child-reorder-buttons`（コンテナ）／`-reorder-button`／`-reorder-button-disabled`を新設。実機発見バグその1の修正として一時的に `.unified-outliner-partial-edit-parent-child-preview-row` へ `overflow: hidden;` を追加（§7.5）した後、実機発見バグその3の修正でフロートを全面的にflexboxへ置き換え（新設 `-preview-row-text` / `-preview-row-actions`、`overflow: hidden` は不要になったため削除）、`float: right`／個別`margin-left`を削除ボタン・編集ボタン・並び替えボタングループの3箇所から除去（§7.7）。
- `tests/parentChildReorder.test.ts`（新規、36件）: 実`parseDocument`を使った、eligibility・tightly-packedゲート・pure swap関数・isPendingReorderDirty・combined invert+validate・実文書へのapply（並び替え単独・各組み合わせ・ordered番号の非自動採番・conflict・resolve-failed）の単体テスト。
- `tests/parentChildReorderUiWiring.test.ts`（新規、当初15件→実機発見バグその3の再発防止テスト2件を追加し17件）: View配線の静的ソース確認、および行のテキスト/actions分離構造の確認（§7.7）。
- `tests/parentChildAddDelete.test.ts`（既存・更新）: 共有`baseInput()`ヘルパーに`reorderDirty: false`を追加。
- `tests/parentChildAddDeleteUiWiring.test.ts`（既存・更新）: `hasAddDeleteActivity`/`cancelEdit`/`applyParentChildAddDeleteCombinedEdit`の3件のガード文字列アサーションを更新。実機発見バグその2の再発防止として、`performAutoReload`の`childAddDeleteSession`再構築を確認する専用テストを1件追加（§7.6）。
- `tests/parentChildInlineEditUiWiring.test.ts`（既存・更新）: `renderParentChildPreview`のeligibility変数名（`eligibleFirstRowById`→`eligibleIds`/`fallbackFirstRowById`）のアサーションを更新。
- `docs/統合実装ロードマップ_2026-08-05.md`（既存・更新）: フェーズ状況テーブル・新規§3.23・§5関連ドキュメント一覧・最終更新欄。
- `CHANGELOG.md`（既存・更新）: `### Added`に新規箇条書きを追加。
- `docs/phase5l10_parent-child-reorder.md`（新規、本ファイル）。
- `/Users/kazumikaizuka/Obsidian/ipad-test/Test/parent-child-reorder-verification.md`（新規、実機検証用fixture）。

変更していないファイル（意図的、確認済み）: `src/edit/parentListItemProjection.ts`・`src/edit/standaloneParentListItemProjection.ts`・`src/edit/listMarkerProjection.ts`・`src/edit/taskListProjection.ts`・`src/edit/orderedListProjection.ts`・`src/edit/multiLineListItemProjection.ts`・4つの単独リーフ投影一式・`src/edit/quotePrefixProjection.ts`・`src/edit/compositeBlockPartialEdit.ts`・`src/edit/partialEdit.ts`・`src/model/block.ts`——Phase 5L-8/5L-9のエクスポートも含め、いずれも完全に無変更のまま再利用のみ。

## 11. 将来候補（今回のスコープ外）

- **孫以下・より深い階層の並び替え**: 今回は直接の子どうしの並び替えのみ。
- **子を持つ親項目（grandchild-owning item）自身の並び替え**: 対象は常にeligibleな直接の子リーフのみ。
- **ドラッグ＆ドロップによる並び替え**: 今回は「↑/↓」ボタンのみ。
- **「詰まっていない」child subtreeへの並び替え対応**: §2.2のゲートを緩和し、境界のblank lineの所有権をどう扱うかを設計したうえで対応する余地がある。
- **indent/outdent・親子関係の変更**: 今回は完全に対象外。
- **CompositeBlock memberの並び替え**: 今回は完全に対象外（そもそも「子」として解決されない）。
- **複数の子の同時インライン編集**: 今回も引き続き最大1件。
- **兄弟の自動採番・ordered delimiterの変更**: 今回も引き続き一切実装しない。
- **checkbox status対応範囲の拡大・完全なMarkdown-AST WYSIWYG編集**: 今回のスコープ外。
