# Fold State Persistence & Synchronization 仕様（Phase 4E）

Outline Tree View の折りたたみ状態（fold state）を、一時的な表示状態ではなく、再描画・再読込・クリックジャンプ・カーソル同期・キーボード操作・move/indent/drag・アプリ再起動の間で破綻しない形で保持・復元・同期するための仕様である。実装前に採用方針を比較検討した設計案（別途チャット上で報告・承認済み）を土台とし、実装中に発見・洗練した内容（特に §3 の list identity のスコープ変更）を含めて最終版として記録する。

## 0. 前提（Phase 4E 着手のきっかけ）

Phase 4E 着手前の `collapsedIds` は `OutlineTreeView` インスタンスが持つ1つの `Set<string>` であり、ファイルスコープを持たず、キーである section/list の `id`（`sec-N`/`li-N`）は `parseDocument()` の呼び出しごとに0から振り直される連番だった。そのため、

- ファイルを切り替えても `collapsedIds` はクリアされず、別ファイルの同じ id（例: どちらのファイルの1つ目の見出しも `sec-0`）が偶然一致すると、無関係なファイルの見出しが意図せず折りたたまれて見える潜在バグがあった。
- アプリ再起動や View の閉じ直しで fold state は消え、そもそも永続化されていなかった。

Phase 4E は「fold state の正しさの担保」そのものを主目的とする。

## 1. 保持先: plugin data.json（`loadData`/`saveData`）

`UnifiedOutlinerSettings`（`settings.ts`）と同じ1つの data.json に、`foldState` という新しいトップレベルキーとして保持する。

- 形状: `FoldStateData = Record<filePath, string[]>`（ファイルパスをキーとし、値はそのファイルで現在折りたたまれているノードの identity 文字列の配列）。
- 何も折りたたまれていないファイルはキー自体を持たない（空配列ではなくキー不在。data.json を小さく保つ）。
- `main.ts` の `loadSettings()` は data.json 全体を読み、`foldState` キーを分離してから残りを `UnifiedOutlinerSettings` へマージする（`foldState` が `UnifiedOutlinerSettings` 型に紛れ込まないようにするため）。`persistData()` が `{ ...settings, foldState }` を組み立てて `saveData()` する唯一の書き込み経路であり、`saveSettings()`（既存の設定タブ）と `FoldStateManager.flush()`（Phase 4E）はどちらもこの経路を経由するため、互いの保存内容を上書きし合わない。
- 既存の（Phase 4E 以前の）data.json はフラットな設定オブジェクトのみで `foldState` キーを持たないため、後方互換である（`foldState` は単に `undefined` として扱われ、`normalizeFoldStateData` が空の store にフォールバックする）。

比較検討したが不採用とした案は次のとおり。

| 案 | 不採用の理由 |
| --- | --- |
| Leaf/View state（`setViewState`） | 「ファイルの状態」ではなく「ペインの状態」になり、同じファイルを新しい leaf で開くたびに fold state が失われるため |
| ノート本文への埋め込み（frontmatter 等） | UI 状態のためにユーザーのファイル内容を書き換えることになり、「元ノートが content の source of truth」という既存方針（Partial Edit Pane の設計原則）と衝突するため |

## 2. Node Identity: ラベルの祖先パス方式（`src/tree/foldIdentity.ts`）

`sec-N`/`li-N` は再パースごとの一時連番であり永続化キーには使えない。move/indent/drag という本プラグインの主機能そのものが位置を変える以上、行番号や構造的インデックスパスのような位置依存の識別子は主要操作のたびに壊れてしまう。そのため、内容（ラベル）ベースの識別子を採用した。

### 2.1 section の identity

祖先セクションの見出しテキストを根から辿ったパス（`section:見出しA/section:見出しB`）とする。兄弟間で同じ見出しテキストが重複する場合は、出現順インデックスを `#N` として付加して区別する。

- **move（兄弟間の入れ替え）には強い**: `move-block-up/down` や drag & drop の before/after は祖先を変えないため、identity は不変。
- **見出しレベルの indent/outdent には弱い**（既知の制限）: `#`/`##` のようなレベル変更は、その見出しの論理的な親セクションを変え得る操作そのものであるため、祖先パスが変わり identity も変わる。これは意図的に許容する——見出しの indent/outdent は `move/findIndentTarget.ts` による比較的厳しい安全条件（直前兄弟セクションが必要、subtree 内のどの見出しも6を超えない等）を伴う、相対的に頻度の低い操作であるため。

### 2.2 list node の identity ― 実装中に洗練したスコープ

設計段階では section と同様に「祖先パス全体」を素朴に想定していたが、実装・テストの過程で、list item の indent/outdent（Tab/Shift-Tab 相当で直近の親 list item を変える操作）は本プラグインが想定する中で最も日常的な構造編集操作であり、祖先パス全体をそのまま identity に使うと、**同じ section 内での通常の indent/outdent のほぼ毎回**で identity が変わってしまうことが判明した（`tests/foldStateAcceptance.test.ts` の初期実装で実際に失敗を確認した）。これは「move/indent/drag に強い」という採用方針の趣旨に反する。

そこで、list node の identity は次のようにスコープを調整した。

- 祖先の **直近の list item チェーン全体ではなく、直近の「囲んでいる section」** のパス（見出しがない場合は空文字列のスコープ）を基準にする。
- 同じ「囲んでいる section」に属する list node は、ネスト深さやどの list item の子であるかに関わらず、**1つの重複判定プールとして** 文書順に出現順インデックスで区別する。

この結果、

- **同じ section 内での list item の re-nest（indent/outdent、別の兄弟 item の子への付け替え）には強い**: 囲んでいる section が変わらない限り identity は不変（`tests/foldIdentity.test.ts`／`tests/foldStateAcceptance.test.ts` で確認済み）。
- **別の section への relocate（drag & drop の inside で別セクションへ移動する等）には弱い**（既知の制限、意図的に許容）: 囲む section 自体が変わるケースは、通常の re-nest よりも構造的に大きな変更であり、fold state を引き継げなくても驚きは小さいと判断した。

この節の内容は、承認済みの設計方針（「ラベルの祖先パス方式、move/indent/drag に強い」）を否定するものではなく、実装検証を通じて「祖先パス」の適用範囲を section と list とで書き分けることで、当初の意図（indent/outdent を含む日常操作への耐性）をより正確に満たす形へ調整したものである。

### 2.3 重複ラベルの扱い（section・list 共通）

同一スコープ内で `kind:label` が完全一致するノードが複数ある場合、文書順の出現順インデックスを `#N` として付加する。これにより、同名ノードが手前に挿入・削除・並べ替えされると、意図しない方（同じグループ内の別の同名ノード）に fold state が付いてしまう可能性はあるが、クラッシュやデータ破損にはならない（最悪でも「同じグループ内の別の有効なノード」に状態が付くだけ）。

## 3. 同期対象

| 操作 | 挙動 |
| --- | --- |
| `refresh()`（cursor 移動・`editor-change`・`active-leaf-change`・`file-open` 起点） | `currentFilePath`・`nodeIdentityById` を再計算し、`collapsedIds`（`node.id` キー、既存の全消費コードと互換）を永続化データから毎回導出し直す（`deriveCollapsedIds`） |
| `toggleCollapse`（chevron クリック）／矢印キー（`expandSelectionOrGoToFirstChild`/`collapseSelectionOrGoToParent`） | すべて `setNodeCollapsed(nodeId, collapsed)` という単一の書き込み経路に統一。メモリ上の `collapsedIds` を更新すると同時に、`FoldStateManager.setNodeCollapsed()` へ書き込む（即時にメモリへ反映、ディスクへはデバウンス保存） |
| ファイル切り替え | `refresh()` が `currentFilePath` を切り替えた対象ファイルのパスに更新し、そのファイル専用の永続化データから `collapsedIds` を導出するため、別ファイルの状態と混線しない |
| move/indent/drag | 追加の移行処理は不要——identity がラベルベースであるため、§2 の範囲内（section の兄弟間 move、list の同一 section 内 re-nest）では自然に同じ identity を指し続ける |
| Partial Edit Pane の Apply | 見出し／list テキスト自体が書き換わった場合は identity が変わり、以後は新規ノード扱い（既定状態へフォールバック） |
| `vault.on("rename")` | `FoldStateManager.handleRename(oldPath, newPath)` が保存済みマップのキーを移行する |
| View / plugin unload | `OutlineTreeView.onClose()` と `UnifiedOutlinerPlugin.onunload()` の両方で `FoldStateManager.flush()` を呼び、デバウンス待ちの未保存分を書き出す（`onunload` は同期 API のため fire-and-forget のベストエフォート） |
| 同一ファイルを複数 leaf で同時に開いている場合 | Phase 4F で一部対応（`docs/fold-state-conflict-resolution-spec.md` §2）。複数の Outline Tree View leaf は互いに同期するようになった。複数の markdown leaf（分割ビュー等）は、意図的な「アクティブ leaf 優先」の last-write-wins のまま |
| 本文エディタの CM6 fold state | 非連動（Phase 2A 以来の一貫した方針、変更なし） |

## 4. 実装した最小スコープ

- ファイルパスをキーとした fold state の data.json 永続化。
- ラベルの祖先パス方式による identity（section: 祖先セクションパス全体、list: 直近の囲む section のパス — §2.2 参照）。
- `refresh()`/`toggleCollapse`/矢印キー操作の単一の同期経路（`setNodeCollapsed`/`deriveCollapsedIds`）。
- ファイル切り替え時のロード（`refresh()` が毎回導出）。
- `vault.on("rename")` によるキー移行。
- `OutlineTreeView.onClose()` と `plugin.onunload()` の両方での flush。

## 5. 既知の制限（意図的に対応しない）

- **見出し／list テキストの変更**: identity が変わり、以後は新規ノード扱い（既定状態＝展開へフォールバック）。誤った状態を引き継ぐより安全側に倒した。
- **list item を別の section へ relocate する操作**（drag & drop の inside で別セクションへ、または将来のクロスセクション move）: §2.2 のスコープ調整の裏返しとして、囲む section 自体が変わるケースは identity が変わり、既定状態へフォールバックする。
- **見出しレベルの indent/outdent で論理的な親セクションが変わる場合**: 同上の理由で identity が変わる。
- **同一ファイルを複数 leaf で同時に開いている場合のリアルタイム相互同期**: Phase 4F で一部解消（上表参照、および `docs/fold-state-conflict-resolution-spec.md` §2）。複数 markdown leaf 間の相互同期は、意図的に「アクティブ leaf 優先」のまま据え置いている。
- **ファイル削除時の孤立エントリの GC**: 当面は残置する（次点候補）。
- **折りたたまれた祖先の自動展開**（クリック／Enter／カーソル同期でジャンプ先が不可視になるケースへの対応）: 今回は対象外。
- **本文エディタの CM6 fold state との同期**: 従来どおり非対象。

## 6. テスト

- `tests/foldIdentity.test.ts` — identity 算出の再パース間安定性、move（兄弟間の入れ替え）への耐性、rename・別 section への relocate での identity 変化、同一スコープ内の重複ラベル disambiguation。
- `tests/foldStateStore.test.ts` — `normalizeFoldStateData`/`getCollapsedIdentities`/`withNodeCollapsed`/`withFileRenamed` の純粋関数としての挙動。
- `tests/foldStateAcceptance.test.ts` — 本仕様の受入条件（§7 参照）を実際の production コードパス（`buildOutlineTree` → `buildNodeIdentityMap` → `foldStateStore`）で end-to-end 検証する permanent regression test。

## 7. 受入条件と確認方法

以下の4点を確認条件として設定し、`tests/foldStateAcceptance.test.ts` で自動検証している。

1. **ファイル切替後に別ファイルの fold state が混線しないこと** — 同一内容（同じ identity になり得る）の2ファイルで検証し、相互に影響しないことを確認。
2. **再起動後に fold state が復元されること** — `JSON.stringify`/`JSON.parse` による実際のシリアライズ往復（data.json への書き込み・読み込みに相当）と、再パース後の identity 再解決を通しで確認。
3. **move / indent / drag 後もラベル不変ノードでは fold state が自然に維持されること** — section の兄弟間 move、list item の同一 section 内 re-nest（indent/outdent 相当）で確認。
4. **ラベル変更時は誤継承せず既定状態になること** — 見出しリネームで、リネーム後のノードが折りたたまれておらず、かつ無関係な兄弟に誤って状態が付かないことを確認。

本仕様書のとおり、§2.2 で明らかになった「別 section への relocate」「見出しレベル変更による親替え」も既知の制限としてテストで明示的に固定している（`tests/foldStateAcceptance.test.ts` の「known limitation」ブロック）。

なお、実際の Obsidian アプリを起動しての目視確認（GUI 操作によるファイル切替・アプリ再起動）は、開発に用いているサンドボックス環境からは実行できないため未実施である。本節のテストは、Obsidian のランタイム部分（`debounce`／`loadData`／`saveData` そのもの）を除く、実際に使用する製品コードパス（`buildOutlineTree`・`buildNodeIdentityMap`・`foldStateStore` の各関数）をそのまま経由する end-to-end 検証であり、ロジックの正しさは担保するが、実機での UI 上の見え方（例えばアプリを実際に再起動したときの体感）はユーザー側での確認を推奨する。
