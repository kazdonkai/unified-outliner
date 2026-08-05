# fold-state 競合解決・永続化整理 仕様（Phase 4F）

Phase 3D（CM6 ⇄ Outline Tree 双方向 fold 同期）・Phase 4E（fold-state の永続化）で整備した基盤の上に、「複数箇所からの fold-state 書き込みをどう調停するか」を明文化・実装する。3つの論点（authoritative 判定／複数 leaf ほぼ同時書き込み／Partial Edit Pane conflict 検知との統合範囲）に限定したスコープであり、`docs/fold-state-spec.md`（Phase 4E）の内容を置き換えるものではなく、その §3/§5 で明示的に Phase 4F へ先送りされていた項目に対する回答として追記する位置づけである。

## 1. authoritative 判定 ― CM6 起点 vs Tree 起点

### 1.1 唯一の書き込み経路

`persistence/foldStateManager.ts` の `FoldStateManager.setNodeCollapsed(filePath, identity, collapsed)` が、fold-state の永続化ストアを変更する**唯一**の関数である（Phase 4E から不変）。この関数を呼び出す経路は2つしかない。

| 起点 | 呼び出し元 | 発火条件 |
| --- | --- | --- |
| Tree 起点 | `view/OutlineTreeView.ts` の `setNodeCollapsed`（private メソッド） | chevron クリック、キーボード ←/→ |
| CM6 起点 | `view/OutlineTreeView.ts` の `handleCm6FoldEffect`（モジュール関数） | 本文エディタのガター fold/unfold、フォールドコマンド等、`@codemirror/language` の `foldEffect`/`unfoldEffect` を伴うあらゆる CM6 トランザクション |

### 1.2 優先ポリシー: 「直近の同期呼び出しが勝つ」

`FoldStateManager.setNodeCollapsed` は識別子（`filePath` + `identity`）ごとに単純に真偽値を上書きするだけの関数であり、キューイングやタイムスタンプ比較を持たない。これで十分である理由は次のとおりである。

- Tree 起点・CM6 起点のいずれも、DOM/CM6 のイベントハンドラという**同期的**なコールバックからしか呼ばれない。JavaScript のシングルスレッド実行モデル上、この2つの呼び出しが本当に同時に（割り込み合って）実行されることはあり得ない——一方の呼び出しが完全に終わってから、初めてもう一方が実行され得る。
- したがって「競合」は実質的に「直近に完了した呼び出しが、その識別子の値を決定する」という単純な上書きセマンティクスに帰着する。これは `persistence/foldStateStore.ts` の `withNodeCollapsed`（不変の純粋関数、同じ呼び出しを2回すれば2回目の引数が最終状態になる）が既に満たしている性質であり、新たなロジックを追加する必要はない。
- ループ防止（Phase 3D 由来の `outlineTreeFoldOrigin` Annotation）により、Tree 起点の1回のユーザー操作が CM6 起点の書き込みとして自分自身を再度呼び出すことはない——「同一操作が自分自身と競合する」ケースは構造的に排除されている。

### 1.3 Phase 4F で追加したもの

上記のとおり、ポリシー自体は Phase 3D/4E の実装が既に満たしていた。Phase 4F の作業は、これを**意図された設計として明文化し、退行テストで固定する**ことである。

- `view/OutlineTreeView.ts` の `setNodeCollapsed`・`handleCm6FoldEffect` 双方に、本仕様書を参照するコメントを追加した。
- `tests/foldStateConflict.test.ts` に、CM6 起点の書き込み → Tree 起点の書き込みの順、およびその逆順で、同一識別子に対して「直近の呼び出しが最終状態を決める」ことを固定するテストを追加した。

## 2. 複数 leaf からのほぼ同時書き込み

「複数 leaf」には、性質の異なる2つのケースがある。

### 2.1 複数の Outline Tree View leaf（同一ファイルを表示）

`OutlineTreeView` はすべて `plugin.activeMarkdownView`（1つの共有 `ActiveMarkdownViewTracker`）を参照するため、複数の Outline Tree View leaf が同時に開いていても、それらは常に**同じ**アクティブファイルのツリーを表示する（`activateOutlineTreeView` は既存 leaf を再利用するが、Obsidian 標準の「新規ウィンドウで開く」等でユーザーが手動で複製することは妨げない）。

Phase 4F 以前は、CM6 起点の書き込み（`handleCm6FoldEffect`）だけが `plugin.refreshOutlineTreeViews()` を呼んで**すべての** Tree leaf を再描画していたのに対し、Tree 起点の書き込み（chevron クリック等）は自分自身の `collapsedIds` しか更新しておらず、もう一方の Tree leaf は自身の次の再描画トリガー（`active-leaf-change`/`editor-change`/`keyup`/`mouseup` 等）が来るまで古い状態を表示し続けるという非対称な抜けがあった。

Phase 4F はこれを閉じた。`main.ts` に `refreshOtherOutlineTreeViews(except)` を追加し、`OutlineTreeView.setNodeCollapsed` から呼び出す。`except`（書き込みを行った当人の leaf）自身は既存どおり呼び出し元（`toggleCollapse` 等）の `this.renderTree()` で再描画されるため、二重描画を避けるためにここでは除外している。

これにより、「Tree 起点・CM6 起点いずれの書き込みも、開いているすべての Outline Tree View leaf に即座に反映される」という対称な挙動になった。

### 2.2 複数の markdown leaf（同一ファイルを分割表示、または将来のポップアウト）

こちらは Obsidian の標準機能そのもの（このプラグインが作り出した状態ではない）に起因する制約である。同一ファイルを2つの markdown leaf（分割ビュー、Phase 5 で検討予定のポップアウトウィンドウなど）で開くと、Obsidian は leaf ごとに**独立した** CM6 `EditorView` インスタンスを持ち、fold state は他のプラグインを含めそもそも leaf 間で共有されない（本プラグイン以前からの Obsidian の挙動）。

採用したポリシーは **「アクティブ leaf 優先」** である。`handleCm6FoldEffect` の既存の "Active-leaf-only" ガード（`activeView.leaf !== owning.leaf` なら return）が、これを実質的に実装していた——Phase 4F はこれを**意図された設計として明文化**した（コード上のコメント追加のみで、ロジック自体の変更はしていない）。

- **採用理由**: 背景（非アクティブ）の leaf で行われた fold/unfold は、そもそも永続化ストアへ書き込まれない。N 個の背景 leaf それぞれが独立した fold 表示を持ちうる状況で、そのうちどれを「正しい」ものとして永続化するかを決める原則的な基準は存在しない。CM6 の更新イベントがたまたま先に発火した leaf を採用する方式は、ユーザーの意図（実際に見ている・操作している pane）ではなく発火タイミングに依存した、予測不能な永続化状態を生む。アクティブ leaf に限定することで、「ユーザーが実際に注視している pane での操作だけが記録される」という一貫した基準になる。
- **許容される制約**: 背景 leaf での fold/unfold はツリーへ反映されない。ただし、これは「誤った状態を記録する」のではなく「一部の操作を捕捉しない」だけであり、そのユーザーがその leaf をアクティブにして改めて fold/unfold すれば、以後は正しく記録される。
- **Partial Edit Pane との関係**: Partial Edit Pane（`view/PartialEditView.ts`）は CM6 インスタンスを持たず、fold の概念自体が存在しないため、fold-state の書き込み元にはそもそもならない（§3 参照）。

### 2.3 Phase 4F で追加したもの

- §2.1 のギャップを埋める実装（`refreshOtherOutlineTreeViews`）。
- §2.2 の既存ガードを「意図された調停ポリシー」として明文化するコメント。
- 複数 markdown leaf の CM6 fold イベントそのもの（`resolveOwningLeaf`/`getActiveViewOfType` を含む）は Obsidian ランタイム API に依存するため、既存の `view/OutlineTreeView.ts` 全体と同様、vitest の対象外である（`docs/fold-state-spec.md` §7 が既に明記している既存の境界と同じ）。このため自動テストで検証できるのは §1.3 の「直近の呼び出しが勝つ」という純粋な上書きセマンティクスまでであり、「アクティブ leaf のみが書き込む」というガード自体の実機確認は、Phase 3D 同様ユーザー側での確認を推奨する。

## 3. Partial Edit Pane conflict 検知との統合範囲 ― 意図的に分離する

結論: **統合しない。** 理由は次のとおりである。

- fold-state は `data.json` の `foldState` キー（`persistence/foldStateStore.ts` の `FoldStateData`）に、ノードの **identity**（ラベルベースの文字列、`tree/foldIdentity.ts`）をキーとして保持される。
- Partial Edit Pane の conflict 検知（`edit/partialEdit.ts` の `applySubtreeEdit`/`applySectionEdit`）は、ノートの **本文テキスト**（`doc.lines` から切り出した生 Markdown 文字列）だけを比較する単純な等値比較である。
- fold/unfold 操作（Tree 起点・CM6 起点いずれも）は `doc.lines` を一切変更しない。逆に Partial Edit Pane の Apply（`applySubtreeEdit`）は `foldState` キーを一切参照・変更しない。

したがって、この2つの「競合」はデータ的に完全に独立したレイヤーにあり、偶然無関係なのではなく構造的に無関係である。fold の trigger が Partial Edit Pane の conflict 判定を誤って発火させることはなく、Apply が fold-state を暗黙に破壊することもない。

### 3.1 唯一の間接的接点（Phase 4E から既存、Phase 4F では変更なし）

Apply が対象ノード自身の見出し／list 先頭行のテキストを書き換えた場合、そのノードの identity はラベルベースであるため変化する。結果として、旧 identity に紐づいていた fold-state は孤立し（データとしては残るが以後参照されない）、そのノードは新しい identity のもとでは既定状態（展開）として表示される。これは `docs/fold-state-spec.md` §5 に既に記載されている既知の制限であり、Phase 4F で新たに生じた挙動ではない。

### 3.2 Phase 4F で追加したもの

- `edit/partialEdit.ts` の doc comment に、上記の分離方針とその理由を明記した。
- `tests/foldStateConflict.test.ts` に、fold-state の変更が Partial Edit Pane の conflict 判定に一切影響しないことを実際に確認する退行テストを追加した（fold-state ストアを操作しても `applySubtreeEdit` の結果が変わらないことを確認）。

## 4. 実装した差分の一覧

| ファイル | 変更内容 |
| --- | --- |
| `src/main.ts` | `refreshOtherOutlineTreeViews(except)` を新設（§2.1） |
| `src/view/OutlineTreeView.ts` | `setNodeCollapsed` から `refreshOtherOutlineTreeViews` を呼ぶよう変更（§2.1）。`setNodeCollapsed`／`handleCm6FoldEffect` に本仕様書参照コメントを追加（§1, §2.2） |
| `src/persistence/foldStateManager.ts` | クラス doc comment を更新し、Phase 4F で埋めた範囲と埋めていない範囲を明記 |
| `src/edit/partialEdit.ts` | モジュール doc comment に §3 の分離方針を追記 |
| `tests/foldStateConflict.test.ts` | 新規。§1.3・§3.2 の退行テスト |

`FoldStateData` の永続化フォーマット（`Record<filePath, string[]>`）、`foldStateStore.ts` の既存 API シグネチャ（`normalizeFoldStateData`/`getCollapsedIdentities`/`withNodeCollapsed`/`withFileRenamed`）はいずれも無変更である。新しい Notice・設定項目は追加していない。

## 5. スコープ外（Phase 4F では対応しない）

- Partial Edit Pane の conflict 検知そのものを単純な等値比較からマージ/diff UI へ発展させること（将来候補だが、本ラウンドでは §3 の分離方針の明文化のみを扱った）。
- 複数ペインの同時編集 UI、複数 section/list の一括選択・一括操作（multi-selection）。
- 背景 markdown leaf での fold/unfold をどうにかして捕捉すること（§2.2 のとおり意図的に非対応）。
- move/indent/drag/Partial Edit Pane の Apply によって CM6 側の fold range が暗黙に失われるケースの再マッピング・再適用（Phase 3D stage 1 から一貫して対象外、`docs/fold-state-spec.md` にも既出）。
