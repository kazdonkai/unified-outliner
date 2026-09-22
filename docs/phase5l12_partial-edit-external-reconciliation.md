# Phase 5L-12: Partial Edit Session Consolidation and External Document Reconciliation

## 1. 位置づけ — 新機能ではなく、既存6箇所の重複実装の一本化

Phase 5L-8〜5L-11・5L-9b（いずれも既存・本チケットでは無変更）は、Partial Edit Pane に対して、子の直接編集・追加・削除・並び替え・インデント/アウトデント・初回子追加（Mode B）という多くの能力を、フェーズを重ねながら段階的に与えてきた。その過程で、`PartialEditView.ts` の次の6箇所に、五階層の単独リーフ/親投影の優先順位判定・セッション構築・ナビゲーション状態（`ancestors`/`directChildren`/`siblingState`）の再計算という、本質的に同じロジックが、それぞれ独立して重複実装される状態になっていた。

1. `loadNodeInternal`（パネルを新しい対象で開く、または既存対象を明示的に再読み込みする経路）
2. `performAutoReload`（このパネルの外で起きた変更——他ビューでの編集・Outline Treeでの操作・Obsidianエディタ本体でのUndo/Redo——を検知した際にのみ呼ばれる、独立したリロード経路）
3. `applyEdit`自身の親own-text専用分岐（既存子1件も持たないリーフのApply、child数を変えない）
4. `applyParentChildCombinedEdit`（既存子のインライン編集、child数を変えない）
5. `applyParentChildAddDeleteCombinedEdit`（子の追加・削除、child数を変え得る）
6. `applyParentChildIndentOutdentEdit`（子のインデント/アウトデント、直接の子の集合を変え得る）

Phase 5L-9b 自身の実機確認で見つかったBug #2（本ドキュメント§6で詳述——`performAutoReload`が外部Undo後にSubtree NavigatorとMode Bの「＋」ボタンをstaleなまま残す）は、この重複実装と、6箇所のうち一部だけが「以前既にアクティブだった投影のみ再検証する」という狭いゲートを持っていたことが根本原因であった。同じ欠陥クラスは、外部変更経由だけでなく、このパネル自身のApply操作経由でも独立に到達可能であることが、本チケットの作業そのものを通じて新たに判明した（§7）。

Phase 5L-12 は、新しい編集機能を一切追加せず、この6箇所の重複を安全に一本化し、パネルの投影・セッション・ナビゲーション状態が、常に「現在の文書モデル」だけを単一の真実源として、無条件かつ一貫した手順で再構築可能であることを、明示的な共有契約として固定する。既存の各機能自身のPriority/Apply/Cancel/conflict/auto-reload契約、UI上の見え方は一切変更しない。

## 2. 五階層投影解決ロジックの純粋関数への抽出（`src/edit/standaloneProjectionResolver.ts`、新規）

`resolveStandaloneListProjections(doc: ParsedDocument, node: BlockNode | undefined, rawText: string): StandaloneProjectionSet` という、Obsidian非依存の純粋関数を新設した。以下の優先順位チェーンを、Phase 5L-1/5L-2/5L-3/5L-4/5L-6 自身が確立した通りに完全に保ったまま、6箇所で独立実装されていたロジックを一本化したものである。

```
list-marker-free > task-list-marker-free > ordered-list-marker-free > multi-line-leaf > parent-list-item
```

- `buildListMarkerProjection` の `"task-list-marker"`/`"ordered-marker"` という拒否理由による二者択一ディスパッチ（task/ordered項目はunordered投影を拒否し、それぞれ専用の投影へ回る）は、これまでと完全に同一のまま維持した。
- 4つのリーフtier（list-marker-free/task-list-marker-free/ordered-list-marker-free/multi-line-leaf）はいずれも `node.childIds.length === 0` を必須条件とし、parent-list-item tierは `node.childIds.length > 0` を必須条件とする——この構造により、ある1つのノードが同時に2つ以上のtierへ該当することは、構造上起こり得ない（§8で改めて詳述）。
- `node === undefined`（対象ノードが見つからない）・対象が list node でない（見出しセクション等）の場合は、5フィールドすべてが `null` の `StandaloneProjectionSet` を返す——既存の「不適格な項目は常に生のまま表示され、拒否されることはない」という契約をそのまま踏襲している。

この関数がObsidian非依存の純粋関数であることにより、`tests/standaloneProjectionResolver.test.ts`（新規13件、§9）で、実際の `parseDocument` を使った振る舞いテストが初めて可能になった——従来、この優先順位ロジックは `PartialEditView.ts` 自身の private メソッドとして埋め込まれており、View全体をインスタンス化しない限りテストできなかった。

`PartialEditView.ts` 自身が持っていた3つの薄いprivateラッパーメソッド（`buildStandaloneListProjections`・`buildStandaloneMultiLineListProjection`・`buildStandaloneParentListItemProjection`）は、全6箇所の呼び出しが `resolveStandaloneListProjections` への直接呼び出しへ移行し終えた時点で、呼び出し元が1つも残らなくなったため削除した。対応する `isStandaloneListItemEligibleForMarkerFreeProjection`・`isStandaloneTaskListItemEligibleForMarkerFreeProjection`・`isStandaloneOrderedListItemEligibleForMarkerFreeProjection`・`hasComplexBlockInMultiLineListItemContinuation`/`isStandaloneMultiLineLeafListItemEligibleForProjection`・`buildParentListItemProjection`・`isStandaloneParentListItemEligibleForProjection` という計7件のeligibility/builder関数の直接importも、`PartialEditView.ts` からは削除し、`standaloneProjectionResolver.ts` 側でのみimportする形に一本化した（`applyParentListItemOwnTextEdit`・`invertParentListItemProjection`・`projectedParentBodyText`・`projectedParentChecked`・`projectedParentNumberText`・`ParentListItemProjection`・`ParentChildPreviewNavigationTarget`・`resolveParentChildPreviewNavigationTarget` は、Apply/プレビュー描画で引き続き使われているため `PartialEditView.ts` 側のimportに残した）。

## 3. 共有リビルドメソッド `reconcileStandaloneNodeState`（`PartialEditView.ts`、新規private method）

```
private reconcileStandaloneNodeState(
  doc: ParsedDocument,
  nodeId: string,
  node: BlockNode | undefined,
  rawText: string
): void
```

`resolveStandaloneListProjections` の結果を5つの投影フィールド（`standaloneListMarkerProjection`・`standaloneTaskListProjection`・`standaloneOrderedListProjection`・`standaloneMultiLineListProjection`・`standaloneParentListItemProjection`）へ反映したうえで、次のすべてを、一切の条件分岐なしに毎回フルに再構築する。

- `childAddDeleteSession`: 親投影が非nullの場合のみ `buildParentChildAddDeleteSession` で再構築し、そうでなければ `null`。
- `childInlineSession`: 常に `null` へリセットする。
- `pendingLeafFirstChild`: 常に `null` へリセットする。
- `ancestors`/`directChildren`/`siblingState`: 新設の `resolveNavigationState` ヘルパー経由で、`loadNodeInternal` がこれまで使ってきたのと全く同じ `findAncestorPath`/`findDirectChildren`/`getSiblingNavigationState` を呼び出して再計算する。

### この「常に無条件でフルに再構築する」設計が安全である根拠

一見、保留中の下書き（未Applyの編集）を持つセッションを、この無条件リビルドが誤って消してしまうリスクがあるように見える。しかし、既存の `classifySyncOutcome`/`isDirty()`/`hasAddDeleteActivity()` の実装を調査した結果、次のことが構造的に証明できた。

- `childInlineSession`・`pendingLeafFirstChild`・`childAddDeleteSession` 自身の `newChildDraft`/`pendingDeletion`/`pendingReorderOrder`/`pendingIndentOutdent` のいずれかが非null（＝何らかの保留中の下書きがある）の間は、`isDirty()` が真を返す。
- `performAutoReload` は、`performStaleCheck`/`evaluateAgainstText` を経由し、パネルが `isDirty()` でない（＝クリーンな）間しか呼ばれない、という既存の設計契約を持つ。
- 4箇所のApply成功後リビルド（§7）自身は、まさにその保留中の下書きをノートへ書き込み、コミットする瞬間に呼ばれる——つまり、リビルドの時点では、コミットされた下書きはすでにノート自身の内容そのものとなっており、「保留中のまま」ではなくなっている。

この3点により、`reconcileStandaloneNodeState` が呼ばれるいずれの時点でも、「今まさに保留中の下書きを、無条件リセットによって静かに消してしまう」ことは構造的に起こり得ないと証明できる。これにより、旧来6箇所の一部が持っていた「以前アクティブだった投影だけ再検証する」という狭いゲートを、個別に条件（arm）を積み増す対症療法ではなく、ゲートそのものを撤廃する形で解消した。

## 4. `loadNodeInternal` の移行

従来、約90行にわたって独立実装されていた、五階層のeligibility計算・builder呼び出し・5つの投影フィールドへの代入のインラインブロックを、次の1行の呼び出しへ置き換えた。

```
this.reconcileStandaloneNodeState(doc, nodeId, node, extracted.text);
```

呼び出し位置は `this.nodeId = nodeId;` の直後、`renderLoadedState()` 呼び出しまでの間であり、この区間に早期returnは一切存在しない——「不適格な項目は常に生のまま表示され、拒否されることはない」という既存契約は、`resolveStandaloneListProjections` 自身が持つ「該当なしなら5フィールドすべてnull」という振る舞いによって、そのまま保たれている。

## 5. `performAutoReload` の移行——本チケット最大のバグ修正

### 5.1 旧来の実装が持っていた欠陥

`performAutoReload` は、従来、独立した2つのブロックに分かれていた。

- **leaf側ゲート**: 「五階層のうちいずれか1つでも既にリロード開始時点でアクティブだった場合のみ、4つの単独リーフ投影を再検証する」。
- **parent側ゲート**: 「`standaloneParentListItemProjection` がリロード開始時点で既にアクティブだった場合のみ、それを再検証する」——Phase 5L-9b自身のBug #2修正で `|| this.standaloneParentListItemProjection` のarmが後者に足されていたが、これは対症療法であり、「リロード開始時点で親から、子を全く持たないリーフへ変化していた」ケース（＝leaf側4フィールドが元々すべてnull）を正しく拾えないという、同型の欠陥がなお残っていた。

加えて、breadcrumb・sibling nav・Subtree Navigatorが依存する `ancestors`/`directChildren`/`siblingState` の3フィールドは、`performAutoReload` 内では一切再計算されていなかった——この3フィールドは「ロード時に一度だけ計算し、編集中は再計算しない」という既存の設計方針を持つが、この方針は `loadNodeInternal` 経由の編集についてのみ正しく、`performAutoReload`（このパネルの外で起きた変更によるリロード）については、外部から祖先・兄弟・子のいずれかが変化しても、この3つの表示だけが更新されないまま取り残される、既存の潜在的なギャップであった。

### 5.2 修正

本チケットは、上記の2ブロックを次の1つの無条件ブロックへ統合した。

```
if (this.nodeId) {
  const reloadedNode = doc.nodes.get(this.nodeId);
  this.reconcileStandaloneNodeState(this.nodeId, ..., reloadedNode, newText);
}
```

「リロード開始時点で以前何がアクティブだったか」を一切参照しない設計に変えたことで、上記の欠陥は根本的に解消された。`performAutoReload` が呼ばれる時点では保留中の下書きが存在し得ないことは§3で証明済みであるため、常にフル再構築しても安全である。Phase 5L-9b自身のBug #2修正として後から追加されていた、`ancestors`/`directChildren`/`siblingState` の重複再計算ブロック（`compositeAnchor` 処理の後に位置していた）も、`reconcileStandaloneNodeState` 側に一本化されたため削除した。

この不具合クラス自体はMode B固有のものではなく、breadcrumb/sibling nav/Subtree Navigatorの陳腐化は、外部変更によって祖先・兄弟・子のいずれかが変化する状況であれば理論上どこでも起こり得る、`performAutoReload` 自身が元々持っていた一般的なギャップだった。Phase 5L-9bの実機検証の過程でたまたま発見・対症的に修正されていたものを、本チケットが構造的に解消した形である。

## 6. Apply成功後リビルド4箇所の移行と、うち2箇所で新たに発見された実機到達可能な不具合

Apply成功後リビルド4箇所（`applyEdit`自身の親own-text専用分岐・`applyParentChildCombinedEdit`・`applyParentChildAddDeleteCombinedEdit`・`applyParentChildIndentOutdentEdit`）はいずれも、`reconcileStandaloneNodeState` への移行と、`renderBreadcrumb`/`renderSiblingNav`/`renderSubtreeNavigator`（および子追加・削除に関わる2箇所では `renderLeafFirstChildAddRow` も）の呼び出し追加を行った。

### 6.1 子数を変え得ない2箇所（`applyEdit`自身の親own-text専用分岐・`applyParentChildCombinedEdit`）

own-textのみの編集・既存子1件のインライン編集は、いずれも対象の直接の子の集合自体を変え得ない編集であるため、実際の挙動は移行前後で完全に同一である。6箇所全てが同じ共有契約を経由することで、将来この2箇所が子の数を変え得る編集へ拡張された場合にも、同じ欠陥クラスへ二度と陥らないことを保証する、という一貫性のための移行である。

### 6.2 子数を変え得る2箇所で新たに発見された不具合

`applyParentChildAddDeleteCombinedEdit`（子の追加・削除）と `applyParentChildIndentOutdentEdit`（インデント/アウトデント）は、いずれも対象自身の直接の子の集合を変え得る編集であり、この統合作業自体を通じて、実機到達可能な不具合がそれぞれ新たに発見された。

**`applyParentChildAddDeleteCombinedEdit`——親の唯一の残り子を削除するケースは、真正のparent→leaf遷移**: 親が持つ直接の子のうち、残り1件を削除してApplyすると、`freshParentNode.childIds.length` が0になる、正真正銘のparent→leaf遷移が起こる。にもかかわらず、旧来の狭い `stillEligible` リビルドは、この遷移が起きたかどうかに関わらず親投影の残存だけを再検証するものであり、四つのリーフtierを一切再検討せず、`ancestors`/`directChildren`/`siblingState` も再構築していなかった——Phase 5L-9b自身のBug #2（§5.1）が外部Undo経由で踏んだのと全く同じ欠陥クラスが、実はこのパネル自身のApply操作経由でも独立に到達可能であったことが判明した。

**`applyParentChildIndentOutdentEdit`——インデント/アウトデントは対象自身のparent→leaf遷移を起こし得ないが、直接の子集合は必ず変化する**: 調査の結果、インデント・アウトデントのいずれも、パネル自身のルート対象（インデント/アウトデント操作の親側にあたる項目）の `childIds.length` を0にすることは、構造上あり得ないと確認できた。

- インデント（`evaluateChildIndentEligibility`）は、対象の子を「直前の兄弟の、新しい最後の子」として移動させる操作であり、この関数自身が「直前に兄弟が存在すること」を必須条件としている。したがって、あるノードの直接の子のうち1件をインデントして別の兄弟の子にしたとしても、その兄弟自身が既に直接の子として存在するため、対象の直接の子は少なくとも1件（インデントされた兄弟自身）が残る——対象自身の `childIds.length` が0になることはない。
- アウトデント（`evaluateChildOutdentEligibility`）は、対象の孫（1階層深い項目）を、対象自身の新しい直接の子へ昇格させる操作であり、対象自身の直接の子の集合は増える一方で、決して減らない。

つまり、`applyParentChildIndentOutdentEdit` は、このパネル自身のルート対象がparent→leaf遷移することはない——ただし、直接の子の集合自体は、インデント/アウトデントのたびに必ず変化するにもかかわらず、旧来のリビルドは `ancestors`/`directChildren`/`siblingState` を一切再計算しておらず、Subtree Navigator（対象の直接の子一覧を表示するコンポーネント）が、インデント/アウトデント前の内容を表示し続けるという、parent→leaf遷移とは別種の、しかし独立して実在するstaleness不具合があった。

両サイトとも、`reconcileStandaloneNodeState` への移行と、対応するrender呼び出しの新規追加により、いずれも解消した。

## 7. セッション種別の排他性

独立した新設の型やアサーションヘルパーは導入していないが、`reconcileStandaloneNodeState` 自身の実装が、次の2つの不変条件を、条件分岐によってではなく、代入そのものの無条件性によって保証する設計になっている。

- **五投影のうち非nullは高々1つ**: `resolveStandaloneListProjections` が、list-marker-free/task-list-marker-free/ordered-list-marker-free/multi-line-leaf/parent-list-item のいずれも互いに排他的な条件（4つのリーフtierはいずれも `childIds.length === 0` 必須、parent tierは `childIds.length > 0` 必須）でのみ非nullを返すことに起因する。`tests/standaloneProjectionResolver.test.ts` の「mutual exclusivity」describeブロックで、実 `parseDocument` を使い明示的に検証済みである。
- **`childInlineSession`/`pendingLeafFirstChild` は常に無条件でリセットされる**: 親投影がアクティブな間、Mode B（初回子追加）の保留中状態は構造的に存在し得ず、その逆も同様である——`reconcileStandaloneNodeState` がこの2フィールドを毎回無条件で `null` に戻すため。

## 8. テスト

### 8.1 `tests/standaloneProjectionResolver.test.ts`（新規、13件）

Obsidian非依存の純粋関数であることを活かし、実際の `parseDocument` を使った振る舞いテストとして新設した。

- 五階層それぞれの単独resolve（list-marker-free/task-list-marker-free/ordered-list-marker-free/multi-line-leaf/parent-list-item を、それぞれ単独で実際に発生させる文書を用意し、該当フィールドのみが非nullになることを確認）。
- `node === undefined`（存在しないnode idを渡すケース）、および非listノード（見出しセクション `"# 見出し"`、node id `"sec-0"`）を渡した場合に、五フィールドすべてがnullになることの確認。
- 五フィールドの相互排他性（あらゆるフィクスチャについて、非nullなフィールドが高々1つであることを検証する専用describeブロック）。
- 本チケット自身が§6.2で発見した「親の唯一の子を削除/追加した直後の文書」を、実際に `parseDocument` で再現した、parent⇄leaf往復回帰4種（unordered/task/ordered/multi-line）。逆方向（leaf→parent、Mode B初回子追加後の文書）の回帰も1件含む。

### 8.2 既存9ファイルの re-pin（計21件+import系5件=26件）

`tests/standaloneListMarkerFreePartialEditUiWiring.test.ts`・`tests/taskListPartialEditUiWiring.test.ts`・`tests/orderedListPartialEditUiWiring.test.ts`・`tests/multiLineListPartialEditUiWiring.test.ts`・`tests/parentListItemPartialEditUiWiring.test.ts`・`tests/parentChildAddDeleteUiWiring.test.ts`・`tests/parentChildIndentOutdentUiWiring.test.ts`・`tests/parentChildInlineEditUiWiring.test.ts`・`tests/leafFirstChildAdditionUiWiring.test.ts` の9ファイルについて、削除されたインライン実装/ラッパーメソッドを直接ソーステキストで検証していた計21件のテストを、新しい共有メソッド呼び出し形へ re-pin した。各テストが元々検証していた「意図」——早期returnが無いこと、無条件で再構築されること、五投影の優先順位——はいずれも変更していない。加えて、§2で述べた7件のeligibility/builder関数の直接import削除に伴い、これらの関数のimport文をソーステキストで検証していた5件のテストも、「Viewは直接importしなくなり、`standaloneProjectionResolver.ts` 側のみがimportする」という新しい事実を検証する形に書き換えた。

## 9. 検証

- `npx tsc --noEmit`: エラーなし。
- `npx vitest run`: 144ファイル / 2966件、全通過——新設13件を含む。
- `npx eslint "src/**/*.ts"`: 0エラー・3警告——いずれも本チケットと無関係な、既存の `src/settings.ts` 側 `obsidianmd/settings-tab/prefer-setting-definitions`/`@typescript-eslint/no-deprecated` 警告のみ。
- `npm run build`: 成功。

## 10. fixture配置方針

実機検証用fixtureは、既存のプロジェクトメモリ方針通り、`/Users/kazumikaizuka/Obsidian/ipad-test/Test/partial-edit-external-reconciliation-verification.md` にのみ配置し、リポジトリ内やその他vaultへの複製は行っていない。

Phase 5L-1〜5L-11・5L-9bで実装された各機能そのものの実機検証データは、それぞれ専用の既存fixtureに既にあるため、本fixtureはそれらを繰り返さず、Phase 5L-12で統合された「リーフ⇄親の投影切り替え」と「外部変更（Undo/Redo・他ビューからの編集）への追随」が、あらゆる経路で一貫して正しく行われることのみを対象とする。収録データは、unordered/task/ordered/multi-lineの4種の子なしリーフ（Mode Bでの初回子追加対象）、既存の子を1件持つ親×2種（unordered/task、削除で子なしリーフへ戻る対象）、既存の子を複数持つ親（1件削除しても親のままであることの対比確認用）、対象削除・きょうだい非干渉確認用のデータである。確認したいポイントとして、①Mode Bでのリーフ→親昇格とApply後の外部Undo/Redoによる親⇄リーフ往復（4種のリーフそれぞれ、連続Undo/Redoを含む）、②Mode Aでの唯一の子削除による親→リーフ復帰（対比としての複数子親の非該当確認を含む）、③子のインデント/アウトデントに伴うナビゲーション更新、④対象削除時の安全な非表示確認、⑤下書きが未保存の状態での外部変更に対するドラフト保護、⑥対象切り替え時の未保存確認ダイアログ、の6項目をデスクトップ・iPad双方で確認できる操作シーケンスとして収録した。実際のパーサ（`parseDocument`）でこのfixtureの構造を検証済みである。

## 11. 変更・追加したファイル

- `src/edit/standaloneProjectionResolver.ts`（新規）: `resolveStandaloneListProjections` を含む、五階層投影解決ロジックの純粋関数。
- `src/view/PartialEditView.ts`（既存・拡張）: 新設 `reconcileStandaloneNodeState`/`resolveNavigationState`、`loadNodeInternal`/`performAutoReload`/Apply成功後リビルド4箇所の移行、3つの薄いprivateラッパーメソッドの削除、7件のeligibility/builder関数の直接import削除。
- `tests/standaloneProjectionResolver.test.ts`（新規、13件）。
- `tests/standaloneListMarkerFreePartialEditUiWiring.test.ts`・`tests/taskListPartialEditUiWiring.test.ts`・`tests/orderedListPartialEditUiWiring.test.ts`・`tests/multiLineListPartialEditUiWiring.test.ts`・`tests/parentListItemPartialEditUiWiring.test.ts`・`tests/parentChildAddDeleteUiWiring.test.ts`・`tests/parentChildIndentOutdentUiWiring.test.ts`・`tests/parentChildInlineEditUiWiring.test.ts`・`tests/leafFirstChildAdditionUiWiring.test.ts`（いずれも既存・re-pin）。
- `docs/統合実装ロードマップ_2026-08-05.md`（既存・更新）: 新規§3.26・§5関連ドキュメント一覧への追記。
- `CHANGELOG.md`（既存・更新）: `### Fixed` に新規箇条書きを2件追加。
- `docs/phase5l12_partial-edit-external-reconciliation.md`（新規、本ファイル）。
- `/Users/kazumikaizuka/Obsidian/ipad-test/Test/partial-edit-external-reconciliation-verification.md`（新規、実機検証用fixture）。

変更していないファイル（意図的、確認済み）: 4つの単独リーフ投影一式（`src/edit/listMarkerProjection.ts`・`src/edit/taskListProjection.ts`・`src/edit/orderedListProjection.ts`・`src/edit/multiLineListItemProjection.ts`）・`src/edit/parentListItemProjection.ts`・`src/edit/standaloneParentListItemProjection.ts`・`src/edit/parentChildInlineEditSession.ts`・`src/edit/quotePrefixProjection.ts`・`src/edit/compositeBlockPartialEdit.ts`・`src/edit/partialEdit.ts`・`src/model/block.ts`・`src/move/indentBlock.ts`・`src/view/OutlineTreeView.ts`・`src/i18n.ts`・`styles.css`——Phase 5L-1〜5L-11・5L-9bのeligibility/Apply/UI/i18n実装は、いずれも完全に無変更のまま再利用のみである。

## 12. 対象外（今回のチケットでは実装しない、残存事項として明示）

- 新しいリスト編集操作の追加。
- 自身のサブツリーを持つ子の移動、孫以下を含む深い階層の移動、ドラッグ＆ドロップの再設計。
- task/ordered初期子種別選択UI、自動採番。
- CompositeBlockメンバー編集の拡大。
- Markdownパーサ意味論の変更。
- Phase 5L-1〜5L-11・5L-9b自身の既存受入基準の緩和。
- CM6 Decorationへの切り替え、大規模な公開UI再設計。
- セッション種別を独立した型やアサーションヘルパーへ完全に置き換える設計変更——既存フィールドを保ったまま安全に段階的移行するという本チケット自身の方針により、今回は見送った。

## 13. 将来候補

- セッション種別（`childAddDeleteSession`/`childInlineSession`/`pendingLeafFirstChild`/5つの投影フィールド）を、条件分岐ではなく型システム自体で排他性を保証する、判別可能なUnion型（discriminated union）へ統合する設計。
- `reconcileStandaloneNodeState` 自身の呼び出し箇所を、明示的な6箇所の手動呼び出しではなく、状態変更を検知する単一のディスパッチ層へさらに一本化する設計。
