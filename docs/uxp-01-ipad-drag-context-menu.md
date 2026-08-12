# UXP-01 — iPad Drag-and-Drop / Context Menu Coexistence

作成日: 2026-08-12
状態: 実機検証完了、採用。ブランチ `fix/uxp-01-ipad-drag-context-menu`（`main` 未マージ）。

## 1. 問題報告の要約

ユーザー報告: 「iPadでドラッグ＆ドロップができなくなりました。長押しでサブメニューが出るからだと思います。」

調査の結果、これは 2026-08-11 の「mobile long-press fix」が意図的に導入したトレードオフの結果だった。iPadOS/mobile Safari では `draggable="true"` を持つ要素への touch-and-hold が WebKit 自身のネイティブ drag-lift ジェスチャ（Split View への引き出し等）を誘発し、同じ行に登録していた pointerdown ベースの長押しタイマー（コンテキストメニュー用）と競合し、長押しメニューが開かず「幽霊ペイン」が出る不具合が実機で確認されていた。その場しのぎの対処として、モバイルでは行全体の `draggable` を丸ごと外し、タッチによるドラッグ＆ドロップ自体を封印していた。

## 2. UXP 個別改良ストリームの位置づけ・Phase 5本体と分離する理由

Phase 5（hoist / popout / breadcrumb / atomic block 対応）とは主目的が異なる、既存機能の操作不能・使いにくさ・プラットフォーム互換性の改善であるため、UXP-XX（UX Patch）として独立管理する。UXP-01 は Phase 5 本体のいずれのタスクにも触れていない。

## 3. 対象範囲と明示的な非対象

**対象**: Outline Tree View の行に専用ドラッグハンドルを追加し、モバイルの `draggable` 起点をハンドルのみに限定することで、長押しメニューとネイティブ drag-lift の競合を解消する。

**非対象**:
- 「…」メニューボタンの新設（ハンドル分離だけで問題が解決したため、見送った）。
- 長押しメニュー本体のコマンド構成の変更。
- 長押しメニューが複数回連続で開いたまま閉じずに残る不具合（実機検証中に発見。UXP-01 のハンドル変更とは無関係と判定 — §9 参照。**UXP-02 候補として `TODO.md` に別途記録済み**、本チケットでは対応しない）。
- Phase 5 本体のタスク一切。

## 4. 操作仕様

- **ドラッグハンドル**: 各ドラッグ可能ノードの左端（既存の折りたたみ三角の直後）に新設。アイコンは `grip-vertical`（lucide、Obsidian 標準セット）。タッチ領域はアイコンの見た目より広く確保（`width: 28px`, `padding: 0 4px`）。iPad/touch では常時表示（opacity 0.7）、デスクトップはホバー時のみ表示（opacity 0 → hover 0.6 → handle 自体の hover で 1.0）。
- **ノード本文の長押し**: 既存のコンテキストメニュー（`showStructureCommandMenu`/`showListCommandMenu`）を表示する。従来と挙動変更なし。
- **明示的メニュー入口**: 新設しない（§3 参照）。

## 5. イベント競合を避けるルール

- モバイル: `draggable="true"` は **ハンドル要素にのみ**付与する。行本体（`selfEl`）には付与しない。
- 長押しタイマーの `pointerdown` ハンドラは、タッチ起点がハンドル内部（`dragHandleEl.contains(evt.target)`）の場合、タイマーを一切起動しない。
- デスクトップ: `selfEl` の `draggable` 属性は変更なし（行全体が従来通りドラッグ可能）。
- `touch-action: none` はハンドル要素にのみ適用し、行本体・ツリー全体には適用しない。
- `dragstart`/`dragover`/`dragleave`/`drop`/`dragend` のイベントリスナー・ハンドラ本体（`handleDragStart` 等）は無変更。HTML5 DnD イベントはバブリングするため、ドラッグ起点がハンドルでも `selfEl` に登録済みのリスナーがそのまま機能する。

## 6. 変更したファイルと理由

| ファイル | 変更内容 | 理由 |
| --- | --- | --- |
| `src/view/OutlineTreeView.ts` | `dragHandleEl` の新設（readOnly行では作成しない）、`data-platform` 属性の付与、長押しタイマーへのハンドル起点ガード追加、`draggable` 付与先をプラットフォーム別に分岐 | ハンドルと本文長押しの物理的分離を実装するため。`handleDragStart`/`handleDragOver`/`handleDragLeave`/`handleDrop`/`handleDragEnd`・`canDropAny`・relocateSection/relocateListSubtree・Phase 5D-0.3 の read-only ゲーティングは一切変更していない。 |
| `styles.css` | `.unified-outliner-drag-handle` の新規スタイル(Obsidian 標準サイズ・配色を踏襲しつつ独自の常時/ホバー表示制御) | ハンドルの視覚的アフォーダンスを提供するため。既存の `--uo-*` パレット・レイアウト規約を踏襲。 |

一時的なスパイク用デバッグログ（`UXP01_SPIKE_DEBUG` 定数、dragstart/dragover/dragleave/drop/dragend の `console.debug`）は実機検証で採用が確定した後、恒久実装からすべて削除済み。

## 7. テスト結果

- `npx vitest run`: 597件成功（既存回帰なし。UXP-01 は `OutlineTreeView.ts` のみを変更しており、この View は Obsidian ランタイム依存のため元々 vitest カバレッジの対象外 — 新規ユニットテストの追加対象となる純粋ロジックは無かった）。
- `npx tsc -noEmit -skipLibCheck`: エラーなし。
- `npm run build`: 成功。
- `npm run lint`: 警告3件（`settings.ts` の `PluginSettingTab.display()` 非推奨警告、UXP-01 以前から存在する既知の警告。新規警告なし）。

## 8. iPad実機確認項目と結果

検証環境: 新設した `ipad-test` vault（Mac `/Users/kazumikaizuka/Obsidian/ipad-test` と iPad を Obsidian Sync で同期）。

| # | 確認項目 | 結果 |
| --- | --- | --- |
| 1 | ノード本文の450ms以上長押しで既存コンテキストメニューが開く | OK |
| 2 | 本文長押し時に幽霊ペイン/Split View引き出し/意図しないネイティブdrag-liftが再発しない | OK |
| 3 | ドラッグハンドルを押して移動するとdragstartが発火する | OK |
| 4 | ドラッグ中にdragoverとdropが発火する | OK |
| 5 | 指を離した位置で期待するノード移動が実行される | OK |
| 6 | ドラッグハンドル操作中に長押しメニューが開かない | OK |
| 7 | ハンドルをタップして離しただけで不要なメニュー・選択変更・移動が起きない | OK |
| 8 | ツリーを縦にスクロールできる | OK |
| 9 | スクロール中にドラッグ状態やドロップインジケータが残らない | OK |
| 10 | ドラッグを途中で中止した場合に状態が残らない | OK |
| 11 | section node と list subtree の両方で同じ結果になる | OK |
| 12 | desktopの既存 mouse drag と右クリックメニューが後退していない | OK（変化なし、確認済み） |

指操作で検証。すべて合格（判定規則Aの全条件を満たす）。

## 9. 既知の制約・未解決事項

- **長押しコンテキストメニューが複数回連続で開くと、前のメニューが閉じずに重なって表示され続ける不具合**を実機動画で発見した。`showStructureCommandMenu`/`showListCommandMenu`（`OutlineTreeView.ts`）が呼び出しのたびに `new Menu()` するだけで、前に開いたメニューを閉じる追跡（`activeMenu` 相当）を行っていないことがコード調査で判明した。UXP-01 のブランチと `main` の diff を比較し、長押しタイマー・Menu 呼び出し・`suppressNextTapClick` のいずれにも差分が無いことを確認済みであり、**UXP-01 のハンドル変更とは無関係な既存バグ**と判定した。`TODO.md` に UXP-02 候補として記録済み、本チケットの対象外。
- アイコン `grip-vertical` の視覚的な微調整（色・サイズ等）は今回は最小限に留めた。今後の見た目の作り込みは必要に応じて別途行う。
