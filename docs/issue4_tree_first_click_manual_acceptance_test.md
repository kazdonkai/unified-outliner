# Issue #4 未フォーカス Outline Tree の最初のクリック吸収 — 手動受入チェックリスト（1.0.8）

## 0. 実装メモ（PR 用）

- 原因1: `treeRootEl` の `focus` ハンドラが `ensureSelection()` の直後に `renderTree()` を実行していた。エディタにフォーカスがある状態で Tree の行・chevron を押すと、mousedown の既定動作で focus が移った瞬間に Tree DOM が全再構築され、押下中の要素が mouseup 前に置き換わるため `click` が発火しなかった。
- 対策1: focus / blur では `syncSelectionHighlight()` により、描画済み DOM の選択表示だけを局所同期する（`src/view/treeSelectionDom.ts`）。同期対象は `renderNode()` が選択行に付けるもの全て、すなわち `is-selected` / `unified-outliner-selected` クラス、各行の `aria-selected`、root の `aria-activedescendant` である。クラス名と行 id は同モジュールの定数を `renderNode()` も使う単一の定義にした。選択行が DOM に存在しない場合だけ `renderTree()` にフォールバックする。rename 中ガードは従来どおり維持している。
- 原因2: 150ms debounce の `scheduleRefresh`（active-leaf-change / file-open / editor-change / document keyup・mouseup）が押下中に `refresh()` を実行すると、同じく押下中の行が置き換わる。
- 対策2: `src/view/treePointerRefreshGate.ts`。Tree 内で開始した主ボタン（タッチ・ペンを含む）の pointerdown から、pointerup / pointercancel / lostpointercapture（Tree と同じ document 全体で capture）、dragstart / dragend、window blur までを押下中とみなす。押下中の `refresh()` は冒頭で何もせず return し、「保留あり」だけを記録する。押下が終わると保留 refresh を `setTimeout(0)` で次タスクに一回だけ実行するため、同じジェスチャの click は元の行に届く。重複要求は一回に統合し、押下後に通常の refresh が走れば保留は破棄される。`onClose` で gate を最初に破棄し、閉じた view に対して refresh が走らないようにした。`scheduleRefresh` の debounce 自体は変更していない。
- モバイル: 選択状態は DOM 構造に影響しない（drag handle の生成条件 `!readOnly || isOperableComposite || isEligibleStandaloneComplexMember || isParagraph` は選択と無関係であり、tap→rename・mirror 再タップの判定は `this.hasFocus` / `this.selectedId` をハンドラ実行時に参照する）。したがってデスクトップと同じ局所同期で再構築と等価であり、モバイル専用の構造的再構築は不要と判断した。
- テスト: `tests/issue4TreeFirstClick.test.ts`（局所同期・gate の単体テストと OutlineTreeView の配線の静的検査）。

## 1. 準備

- [ ] `npm run build` 後の `main.js` / `manifest.json` / `styles.css` を検証用 Vault に配置し、`sha256sum` でリポジトリと一致を確認する（`docs/git-push-release-runbook.md` §1）。1.0.x の検証には Phase 6 用の ipad-test ではなく、別途決めた Vault を使う。
- [ ] プラグインを再読み込みする。見出し・リスト・段落・折りたためる行を含むノートを開き、Outline Tree を表示する。

## 2. デスクトップ

- [ ] 本文エディタにカーソルを置いて入力した直後（フォーカスはエディタ）、Tree の折りたたみ矢印を **1回だけ** クリック → 即座に折りたたまれる。もう1回で展開される。
- [ ] エディタにフォーカスがある状態で、Tree の別の行を **1回だけ** クリック → その行が選択表示になり、本文がその行へジャンプする。
- [ ] 同じ状態で、行を 1 秒程度押したままにしてから離す（長押し相当）→ クリックが失われず、選択・ジャンプが起きる。
- [ ] 入力直後（150ms 以内）に行を押しっぱなしにして離す → クリックが有効で、離した後に Tree が最新内容に更新される。
- [ ] Tree にフォーカスがある状態で上下キー移動 → 選択表示が移動する。エディタをクリックして Tree からフォーカスを外す → 選択ハイライトが消える。Tree に戻ると前回の選択位置から再開する。
- [ ] 行のダブルクリックで inline rename に入り、Enter で確定・Escape で取り消しができる。rename 中にエディタで入力しても入力欄が消えない。
- [ ] 見出し・リスト・段落・callout・CompositeBlock 行のドラッグ＆ドロップが従来どおり動く。ドラッグ開始時に勝手に中断されない。
- [ ] 右クリックのコンテキストメニューが開き、Move / Delete 等が動作する。
- [ ] Outline Tree を popout ウィンドウに移した場合も、1回目のクリックが有効である。

## 3. モバイル（iPad）

- [ ] エディタにフォーカスがある状態で行を 1 回タップ → 選択・ジャンプされる。chevron の 1 回タップで折りたたみ・展開される。
- [ ] 選択済みの行を再タップ → inline rename に入る（従来どおり）。
- [ ] 行の長押し → コンテキストメニューが開き、指を離した後に余分な rename が始まらない。
- [ ] 6点ハンドル（section/list・段落・単体 callout/blockquote/table/fenced code・CompositeBlock）からドラッグ＆ドロップできる。
- [ ] Tree をスクロール（パン）した後も、次のタップがすぐ効く。

## 4. 結果記録

実施日: 2026-10-17（ユーザー実施）。配置: `npm run build`（main、1.0.8）の3ファイルを ipad-test2 の `.obsidian/plugins/unified-outliner/` へコピーし、`shasum -a 256` でリポジトリと一致を確認、`obsidian vault=ipad-test2 plugin:reload id=unified-outliner` で再読み込み（`dev:errors`: No errors captured）。

bundle sha256: `main.js` 17b75db426012bceaad9e19622c9dddf9bb8d6a65cf02b25b9833cb3ae62dba4 / `manifest.json` bab768a58f5fef2e3fc8a90911addd27d123606b468ffa4f8aaabbee7e22c912 / `styles.css` b48310c77e96e2510dfc24a19541e66da13877ee91456180d74f5b488144abae

| 項目 | Vault | 結果 | 備考 |
| --- | --- | --- | --- |
| エディタにフォーカスがある状態から、chevron／通常行の 1 回目のクリックが即座に効く | ipad-test2 | 正常 | |
| 長押し相当で押してから離してもクリックが失われない | ipad-test2 | 正常 | |
| D&D と rename が従来どおり動作する | ipad-test2 | 正常 | |
