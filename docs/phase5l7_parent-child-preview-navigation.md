# Phase 5L-7: Read-Only Child Subtree Preview Navigation

## 1. 位置づけ — Phase 5L-6 との責務分離

Phase 5L-6（既存・無変更）は、子リストを1つ以上持つ「親 list item」の own-text を marker-free/checkbox-free/number-free で構造化編集できるようにし、child subtree（子リスト自身）は own-text 編集欄の直下に、読み取り専用のプレビューとして表示するのみだった。プレビュー行にはクリックハンドラの類が一切なく、子項目を実際に編集したい場合の唯一の導線は、このパネルの外にある既存の Outline Tree／Subtree Navigator によるナビゲーションだった。

Phase 5L-7 は、この child subtree プレビュー自体を「表示専用」から「安全なナビゲーション入口」へ拡張する。子・孫以下の項目は引き続き親 session 内では一切編集不可のままであり、この点は Phase 5L-6 の契約から一切後退していない。プレビュー行を選択すると、その項目自身を新しい Partial Edit 対象として開けるようになるだけである。

Phase 5L-6 が確立した own-text range/child-subtree range の分離、own-text 専用の Apply/conflict 判定、既存 subtree 全体スコープの stale 検知——これらはすべて Phase 5L-7 でも一切変更していない。Phase 5L-7 が新設したのは、child preview の各行に「navigation target」という新しい付随データを持たせることと、そのデータをクリック時に安全に検証・消費する経路の2点のみである。

## 2. child preview の読み取り専用契約

Phase 5L-6 で確立した契約——child subtree の内容は生の Markdown をそのまま行単位で表示するのみで、`aria-readonly="true"`/`data-readonly="true"` を持つ——は Phase 5L-7 でも一切変更していない。Phase 5L-7 が各行に追加したのは、

- `tabIndex = 0`
- `role="button"`
- ツールチップ／アクセシブルラベル（`partialEdit.parentChildPreviewRowOpenLabel"`）
- click/keydown（Enter/Space）ハンドラ

の4点のみであり、いずれも「navigation target を持つ行」（後述）にのみ付与する。navigation target を持たない行（例えば blank line で `doc.lineToOwningNodeId` が親自身の own-text 側へ戻ってしまうケースはこの range 内には存在しないが、防御的に null になり得るケース全般）は、Phase 5L-6 のまま完全に静的である。

textarea・input・checkbox・number input・contenteditable・drag handle・delete/insert ボタン・context menu のいずれも、行自体にも click ハンドラにも一切追加していない。行の活性化は常に `handleChildPreviewRowActivate`（後述）を経由した「navigation request」のみであり、この操作は親項目の Apply でも、子項目の inline edit でもない。click ハンドラは最初に `evt.stopPropagation()` を呼び、このパネルの他の無関係な click handler へ伝播しない。

## 3. navigation target identity

### 3.1 プレビュー構築時点のスナップショット

既存 `buildParentListItemProjection`（Phase 5L-6、既存）に、新規ヘルパー `buildChildPreviewRowTargets(doc, node, childSubtreeRange)` を追加し、`ParentListItemProjection` に新規フィールド `childPreviewRowTargets: (ParentChildPreviewNavigationTarget | null)[]` を持たせた。`childSubtreeText.split("\n")` と同じ長さ・同じ順序を持ち、各要素は

```ts
interface ParentChildPreviewNavigationTarget {
  nodeId: string;
  firstLineRawText: string;
}
```

である。これは `doc.lineToOwningNodeId`（他の tree/move モジュールがすでに使う、パーサ自身の権威ある「この行の最も深い所有者」データ）を1行ずつ引くだけで計算する——新規のツリー走査・新規の行スキャンロジックは一切実装していない。`owningId === node.id`（親自身）になるケースは防御的に除外する（`resolveParentListItemOwnTextRange` の `"interleaved-content"` ゲートにより、この range 内で理論上到達不能なはずだが、念のため除外している）。

複数行にまたがる子項目の continuation 行（blank line を挟む場合を含む）は、`lineToOwningNodeId` がその項目自身の id をそのまま返すため、自動的にその項目の最初の行と同じ target を指す——本チケットの「continuation 行は本体行と同じ navigation target に属してよい」という要件を、追加のロジックなしで満たす。孫項目は独自の（より深い）id を持つため、直接の子と孫のどちらの行をクリックしても、正しい階層の項目が開く。

### 3.2 クリック時点の再解決

id はパースごとにローカルに振り直される連番（`li-N`）であり、`applyParentListItemOwnTextEdit`（Phase 5L-6）自身の doc comment がすでに明記している通り、1回の `parseDocument()` 呼び出し内でのみ意味を持つ。パネルを開いたまま時間が経過してからクリックされ得るプレビュー行の target には、Subtree Navigator チップ（同一 render サイクル内でのクリックがほぼ前提）よりも一段階慎重な検証が要る。

新設した `resolveParentChildPreviewNavigationTarget(doc, parentNodeId, target)` は、クリックのたびに現在の note を丸ごとフレッシュに再パースした `doc` を受け取り、以下をすべて満たした場合にのみ `{ ok: true, nodeId }` を返す。

1. **`parent-unresolvable`**: `parentNodeId` が現在の `doc` で依然として list node に解決し、かつ `resolveParentListItemOwnTextRange` が依然として own-text/child-subtree 分離に成功すること。
2. **`target-not-found`**: `target.nodeId` が現在の `doc` で依然として list node に解決すること。
3. **`target-not-descendant`**: その node の最初の行が、親の現在の child-subtree range に収まっていること——id が他の場所（親の外）へ再割当てされていた場合、ここで拒否する。
4. **`target-content-changed`**: その node の最初の行が `target.firstLineRawText` と byte-for-byte 一致すること——id・位置が偶然一致していても、実際の内容が変わっていれば拒否する。

いずれか一つでも失敗すれば `{ ok: false, reason }` を返す。呼び出し側（`handleChildPreviewRowActivate`）は失敗時に Notice を表示するのみで、`requestLoadNode` を一切呼ばない——親パネルの現在の対象・未保存の draft は完全に維持される。

## 4. clean / dirty target switching — 新しい確認 UI は作っていない

Phase 5B から存在する `PartialEditView#requestLoadNode(nodeId)` は、以下を唯一の公開エントリポイントとしてすでに持っていた。

- パネルに未保存の編集がなければ、即座に `loadNodeInternal(nodeId)` へ渡す。
- 未保存の編集があれば、既存の `DiscardChangesModal`（「Applyして移動」「変更を破棄して移動」「キャンセル」の3択）を開く。
  - 「キャンセル」: 何も起きない。パネルは現在の対象のまま。
  - 「変更を破棄して移動」: 未保存の編集を破棄し、`nodeId` を読み込む。
  - 「Applyして移動」: `applyEdit()` を実行し、成功した場合（`outcome.changed`）のみ `nodeId` を読み込む。失敗（conflict・validation エラー等）した場合はパネルは現在の対象に留まり、`applyEdit()` 自身がすでに理由付きの Notice を出している。

この契約は breadcrumb セグメントのクリック・Subtree Navigator チップのクリック・sibling-nav ボタンのクリックがすでに依拠しているものであり、Phase 5L-7 のプレビュー行クリックも `handleChildPreviewRowActivate` の最後で `this.requestLoadNode(resolved.nodeId)` を呼ぶだけで、確認 UI・Apply/Discard/Cancel の意味論を一切再実装していない。task 親項目のチェックボックスが dirty な場合・ordered 親項目の番号が dirty な場合・複数行本文が dirty な場合のいずれも、他の全 dirty ケースと全く同じ経路で同じ確認ダイアログに到達する。

## 5. Apply / discard / cancel の挙動（§4 の具体化）

- **Apply して移動**: `applyEdit()` が成功すれば、親項目の own-text がまず保存され（Phase 5L-6 の own-text 専用 Apply/conflict 判定がそのまま働く）、その直後に選択した子項目が新しい対象として開く。`applyEdit()` が conflict または validation エラーで失敗すれば、子項目へは移動せず、パネルは元の親項目のまま、未保存の draft も保持される。
- **変更を破棄して移動**: 親項目の未保存の draft を破棄し、選択した子項目が新しい対象として開く。
- **キャンセル**: パネルは元の親項目のまま残り、未保存の draft もそのまま保持される。
- **未保存の変更がない場合**: 確認ダイアログを経由せず、直ちに選択した子項目が新しい対象として開く。

## 6. stale child preview の再解決（§3.2 の要約）

Phase 5L-6 由来の、subtree 全体スコープの既存 stale 検知（`resolveCurrentTarget`/`classifySyncOutcome`）は Phase 5L-7 でも一切変更していない——child subtree だけが外部変更されると Apply ボタンが一時的に無効表示になり得る、という既知の UX 上の限定事項もそのまま維持している。Phase 5L-7 が新設したのは、あくまで「プレビュー行をクリックした、その瞬間」に限定した独立の再検証（`resolveParentChildPreviewNavigationTarget`）であり、child-only な外部変化を Apply の正当性判断へ新たに結び付けるものではない。

子項目が外部（Outline Tree でのドラッグ＆ドロップ、別ウィンドウでの編集等）で削除・移動された後にプレビュー行をクリックした場合、上記の再解決が安全に失敗し、Notice を表示して親パネルの状態を完全に維持する——誤って無関係な項目を開くことは構造的に起こらない（§3.2 の `target-not-descendant`/`target-content-changed` がこれを担保する）。

## 7. UI 配線 — `src/view/PartialEditView.ts`

- `renderParentChildPreview`（Phase 5L-6、既存）に、`projection.childPreviewRowTargets[i]` が非 null の行にのみ `tabIndex`/`role="button"`/tooltip/click/keydown を追加するループを拡張した。
- 新規 private メソッド `handleChildPreviewRowActivate(target: ParentChildPreviewNavigationTarget): void` を追加した。アクティブな note を現在の内容でフレッシュに再パースし、`resolveParentChildPreviewNavigationTarget(doc, this.nodeId, target)` を呼び、成功時のみ `this.requestLoadNode(resolved.nodeId)` を呼ぶ（`target.nodeId` を直接渡すことは一切ない）。失敗時は `partialEdit.parentChildPreviewNavigationFailed` の Notice を表示して return する。
- `loadNodeInternal`/`applyEdit`/`performAutoReload` はいずれも無変更——`standaloneParentListItemProjection` を再構築するたびに `childPreviewRowTargets` も自動的に最新化される（`buildParentListItemProjection` の一部として計算されるため）。

## 8. fixture 配置方針

既存フェーズと同じ方針を維持している（プロジェクトメモリ `unified-outliner-verification-fixture-placement-policy.md` 参照）。本チケットの実機検証用 fixture は `/Users/kazumikaizuka/Obsidian/ipad-test/Test/parent-child-preview-navigation-verification.md` として配置し、リポジトリ内やその他 vault への複製は行わない。配置前に、実際の `parseDocument`/`isStandaloneParentListItemEligibleForProjection`/`buildParentListItemProjection` へ通す使い捨て probe テストで、fixture 内の各親項目が eligible として分類され、`childPreviewRowTargets` が意図した子・孫の nodeId 列と一致することを確認済み（確認後に probe は無効化済み）。

## 9. 変更・追加したファイル

- `src/edit/parentListItemProjection.ts`（既存・拡張）: `ParentChildPreviewNavigationTarget` 型、`ParentListItemProjection#childPreviewRowTargets` フィールド、`buildChildPreviewRowTargets` ヘルパー、`ParentChildPreviewNavigationResolveReason`/`resolveParentChildPreviewNavigationTarget`。
- `src/view/PartialEditView.ts`（既存・拡張）: `renderParentChildPreview` の行ごとの navigation 配線、新規 `handleChildPreviewRowActivate`。
- `src/i18n.ts`（既存・拡張）: `partialEdit.parentChildPreviewRowOpenLabel`・`partialEdit.parentChildPreviewNavigationFailed` を en/ja 両辞書に追加。
- `styles.css`（既存・拡張）: `.unified-outliner-partial-edit-parent-child-preview-row-navigable` とその `:hover`/`:focus-visible` ルール。
- `tests/parentChildPreviewNavigation.test.ts`（新規、13件）: 実 `parseDocument` を使った純粋関数の単体テスト。
- `tests/parentChildPreviewNavigationUiWiring.test.ts`（新規、9件）: View 配線の静的ソース確認。
- `tests/parentListItemPartialEditUiWiring.test.ts`（既存・更新）: Phase 5L-6 が主張していた「child preview row にはクリックハンドラを一切付けない」というアサーション1件を、本チケットが意図的に変更した契約に合わせて書き換えた。
- `docs/統合実装ロードマップ_2026-08-05.md`（既存・更新）: ヘッダー・フェーズ状況テーブル・新規 §3.20・§5 関連ドキュメント一覧。
- `CHANGELOG.md`（既存・更新）: `### Added` に新規箇条書きを追加。
- `docs/phase5l7_parent-child-preview-navigation.md`（新規、本ファイル）。
- `/Users/kazumikaizuka/Obsidian/ipad-test/Test/parent-child-preview-navigation-verification.md`（新規、実機検証用 fixture）。

変更していないファイル（意図的、確認済み）: `src/edit/standaloneParentListItemProjection.ts`・`src/edit/multiLineListItemProjection.ts`・`src/edit/listMarkerProjection.ts`・`src/edit/taskListProjection.ts`・`src/edit/orderedListProjection.ts`・`src/edit/quotePrefixProjection.ts`・`src/edit/compositeBlockPartialEdit.ts`・`src/edit/partialEdit.ts`・`src/tree/ancestorPath.ts`・`src/tree/descendantPath.ts`・`src/tree/siblingNavigation.ts`（Subtree Navigator／breadcrumb／sibling-nav の既存 navigation 経路自体は無変更のまま）。

## 10. 将来候補（今回のスコープ外）

- child preview 行の inline editing。
- child preview 内の checkbox toggle・number 編集。
- 子項目の親 pane 内での add/delete/move/drag/indent/outdent。
- child subtree の複数選択・一括編集。
- child preview の独自 fold state 永続化。
- child subtree 全体の raw textarea 編集。
- CompositeBlock child member 専用の navigation UI。
- Phase 5L-6 の own-text range/Apply/conflict 契約の変更。
- child-only な外部変化に伴う Apply UI の stale 判定の全面改修（Phase 5L-6 由来の既知の UX 上の限定事項は本チケットでも維持）。
- sibling 自動採番。
- marker種別・checkbox status・delimiter の追加編集 UI。
- 今回新設した `requestTargetSwitch` 相当の確認処理（実体は既存 `requestLoadNode`/`DiscardChangesModal` の再利用のみ）を、breadcrumb navigation・popout/hoist navigation など他の入口へ横展開すること（本チケットは child preview navigation で使う分にのみ最小導入し、既存入口の全面改修は行っていない）。
