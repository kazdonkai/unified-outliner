# fix: Properties が画面の高さを超えるノートで Tree ジャンプが効かない（1.0.2）

状態: **完了**（2026-09-30、開発者が実機で動作を確認した）。ブランチは `fix/tree-jump-offscreen-content`、リリースは 1.0.2 である。

## 1. 報告された症状

ipad-test vault の `Iriai/70000001_0018_裁判書 村境争論ノ控訴0.md` で、Outline Tree の行をクリックしても本文がスクロールしない。他のノートでは正常に機能する。

## 2. 原因

- このノートの frontmatter には 33 件のプロパティがあり、Properties 欄（`.metadata-container`）の高さは 1557px に達していた。エディタのスクロール領域の高さは 801px である。
- Obsidian は inline title と Properties 欄を、CM6 の `contentDOM` と同じスクロール領域の中の、`contentDOM` より上に描画する。そのため先頭までスクロールした状態では、本文（`contentDOM`）の上端がウィンドウの下端より下に来る（計測値は y = 1759px、ウィンドウの高さは 945px）。
- CM6 は `contentDOM` が画面に入っていないとき `EditorView.inView` を false とし、measure サイクルを止める。`EditorView.scrollIntoView` の効果は measure の中で適用されるので、この状態では Tree が送ったスクロール要求は適用されずに捨てられる。1.0.1 で追加したジャンプ後の位置補正（`stabilizeScrollToLine`）の再試行も、同じ理由で効かない。
- `setCursor` は効くので、カーソルだけが移動し、本文は動かないという症状になる。手で少しスクロールして本文が画面に入れば `inView` が true に戻り、ジャンプは正常に動く。このため「開いた直後に効かない」という不安定な見え方になっていた。

## 3. 修正

- 新規の純関数モジュール `src/view/offscreenContentScroll.ts` に `computeOffscreenContentScrollTop` を置いた。スクロール領域の上端、`contentDOM` の上端、現在の scrollTop、CM6 の高さマップによる行の位置（`lineBlockAt(pos).top`）から、目標行をスクロール領域の先頭に置く scrollTop を計算する。結果は 0 未満にならず、入力が有限でないときは現在の scrollTop を返す。
- `OutlineTreeView.scrollLineToTop` は、`cm.inView` が false の場合に限り、先に `scrollDOM.scrollTop` をこの値に直接設定する（`scrollOffscreenContentIntoView`）。scrollTop の直接設定は measure サイクルに依存しないので、本文が画面に入り、CM6 が measure を再開する。そのあとは従来どおり top 揃えの `scrollIntoView` を送り、位置補正で見積もりの誤差を詰める。
- `stabilizeScrollToLine` の再試行でも、同じ処理を先に行う。Properties 欄が遅れて伸びた場合に、本文が再び画面外に出ることに備えるためである。
- `inView` が true の通常のノートでは何もしないので、既存の挙動は変わらない。

## 4. テスト

`tests/offscreenContentScroll.test.ts`（5 件）を追加した。報告されたノートの寸法、現在の scrollTop の考慮、本文が画面の上に外れている場合、負値にならないこと、有限でない入力のフォールバックを確かめる。

## 5. 実機確認

- Mac（ipad-test vault）で、対象ノートを開き直した直後（scrollTop 0、`inView` false）から Tree ジャンプを行い、H1（58 行目）・調査ステータス（60 行目）・記録（94 行目）・List + Callout（328 行目）のいずれも、対象行がスクロール領域の先頭に来ることを確認した。修正前は、いずれも scrollTop が 0 のまま動かなかった。
- 開発者が実機で、正常に機能することを確認した（2026-09-30）。

## 6. 回避策（修正前のバージョン）

Properties 欄を折りたたむか、設定の「文書内のプロパティ」を「非表示」または「ソース」にすると、本文が画面に入るので、ジャンプは効く。
