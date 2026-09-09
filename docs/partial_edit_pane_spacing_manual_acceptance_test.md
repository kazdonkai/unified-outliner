# Partial Edit Pane 上部余白・入力ボックス配置 調整 実機受け入れテスト（2026-09-09）

## 1. 背景

実機（iPad/Method 両vault）での確認により、以下2点の問題が報告された。

1. 拡張ブロック（CompositeBlock）等の編集時、上部にパンくずリストやメッセージ
   （stale/unavailable等）がない場合、ヘッダー直下に広大な無駄な空白（グレーの
   余白）が生じ、入力ボックス（textarea）が画面の下方に固定されたように押し下げ
   られている。
2. リスト等の編集時、パンくずリストやナビゲーションボタンが表示されている場合
   でも、それらの下部と入力ボックスとの間の余白が開きすぎており間延びしている。

本ドキュメントは、この2点に対する修正内容と、開発指示者が実機で確認すべき観点
をまとめたものである。

## 2. 原因調査の結論

コード調査（PartialEditView.ts の DOM 構築・render* 系メソッド、styles.css の
`.unified-outliner-partial-edit-*` 一式）の結果、原因は以下の2点に整理できる。

### 2.1 主因: sibling-nav 行が常に表示されていた（renderSiblingNav の分岐漏れ）

`renderSiblingNav()` は、従来「ノードが1つもロードされていない場合
（`!this.nodeId`）にのみ行全体を非表示にする」実装になっていた。ノードがロード
されてさえいれば、前後どちらのきょうだいも存在しない場合でも、2つの
disabled（操作不能）なボタンだけの行が常に描画され続けていた。

CompositeBlock（拡張ブロック）を読み込む `loadCompositeInternal` は、
`this.siblingState = { previous: null, next: null }` を常にリセットしている
（Phase 5D-2A のコメントに「CompositeBlockにはパンくず・sibling nav・Subtree
Navigatorを出さない」という設計意図が既に明記されていた）。つまり、
CompositeBlock編集時は理論上100%の確率で「前後どちらのきょうだいも存在しない」
状態になるにもかかわらず、`renderSiblingNav()`側の実装がその意図を反映しておら
ず、常に空疎な1行分の高さ・余白をヘッダー直下に残し続けていたことが、報告1の
「拡張ブロック等の編集時に広大な無駄な空白が生じる」の主因である。

### 2.2 副因: 行間余白が各行に個別の margin-bottom として重複宣言されていた

`.unified-outliner-partial-edit-header` / `-sync-status` / `-breadcrumb` /
`-sibling-nav` / `-subtree-nav` / `-quote-header` の6つの行それぞれが、
個別に `margin-bottom: 8px` を宣言していた。表示中の行が複数連続すると、この
8pxが行の数だけ直列に積み上がる（例: header + sibling-nav の2行が表示された状
態では、textareaまでの間隔は8px+8px=16pxになる）。値自体は破綻していないが、
6箇所に同じ値が分散しているため保守性が低く、またリスト編集時（パンくず・
sibling-nav等が複数同時表示される場合）に間延びして見える一因になっていた
（報告2）。

なお、`toggleVisibility(false)` で非表示にした行自体（`display: none` 相当）
が余白を残す、という仮説も検証したが、これは該当しないことを確認済みである
（`display: none` の要素は margin/gap のどちらの方式でも一切スペースを消費し
ない。Obsidian公式の `HTMLElement.isShown()` のドキュメントコメントにも
「`display: none` で隠された祖先要素の有無」という記述があり、非表示メカニズム
自体は正しく機能している）。

## 3. 適用した修正

| 対象 | 変更前 | 変更後 |
| --- | --- | --- |
| `styles.css` `.unified-outliner-partial-edit-view` | `gap` プロパティなし | `gap: 6px;` を追加 |
| `styles.css` 6行分（header/sync-status/breadcrumb/sibling-nav/subtree-nav/quote-header） | それぞれに `margin-bottom: 8px;` | `margin-bottom` を削除（親の `gap` に一本化） |
| `src/view/PartialEditView.ts` `renderSiblingNav()` | `if (!this.nodeId) { hide; return; }` | `if (!this.nodeId \|\| (!this.siblingState.previous && !this.siblingState.next)) { hide; return; }` |

`gap: 6px` を採用した根拠: 表示行が1行（header + textareaのみ、今回の
sibling-nav修正後はCompositeBlock編集時がこれに該当）の場合は6px、2行
（header + sibling-nav + textarea、きょうだいを持つ通常のリスト/セクション編
集時に該当）の場合は6px×2=12pxとなり、いずれも発注元の指定した「8px〜12px程
度の間隔」の範囲内、または近傍に収まる。

## 4. 状態別レイアウト挙動（コードレベルでの確認結果）

| 状態 | 表示される行 | ヘッダー直下からtextareaまでの間隔（理論値） |
| --- | --- | --- |
| stale/unavailable メッセージ表示時 | header → sync-status → （breadcrumb/sibling-nav/subtree-nav/quote-headerは各条件次第） → textarea | 最低でも6px（sync-statusのみ追加された場合） |
| パンくず・sibling-nav 表示時（通常のリスト/セクションできょうだいがある場合） | header → breadcrumb → sibling-nav → textarea | 6px×2 = 12px |
| 何も表示されない時（CompositeBlock編集、またはきょうだい・子・祖先を持たないトップレベルノード編集） | header → textarea のみ | 6px |

いずれも `gap` はステートフルではなく、表示中の行の数に応じて自動的に伸縮する
（非表示の行は `gap` の計算対象に含まれない）ため、上記はコード上の構造から機
械的に導かれる値であり、実機での見え方と一致するはずだが、後述のとおり実機で
の最終確認が必要である。

## 5. 実機確認手順（グループF）

以下は `docs/outline_tree_list_indent_manual_acceptance_test.md` の「グループ
E」で確立した、スクリーンショットのピクセル計測に頼らず、Obsidianの開発者ツー
ル（コンソール）で `getBoundingClientRect()` を用いて実CSSピクセル値を直接確
認する手法を踏襲する。スクリーンショットの見た目だけでの判断は、Retina/HiDPI
等のデバイスピクセル比により実際の値の約2倍に見えることがあるため、必ず以下の
コンソールスクリプトで裏付けを取ること。

### 5.1 事前準備

1. 対象vault（ipad-test または Method）で `npm run deploy:dev` 済みのプラグイ
   ンが反映されていることを確認する。
2. Partial Edit Pane を開く。
3. `View → Developer → Toggle Developer Tools`（Cmd+Option+I）→ Console タブ
   を開く。

### 5.2 確認スクリプト

```js
(() => {
  const view = document.querySelector('.unified-outliner-partial-edit-view');
  const header = document.querySelector('.unified-outliner-partial-edit-header');
  const textarea = document.querySelector('.unified-outliner-partial-edit-textarea');
  const rows = [
    'sync-status', 'breadcrumb', 'sibling-nav', 'subtree-nav', 'quote-header',
  ].map((suffix) => document.querySelector(`.unified-outliner-partial-edit-${suffix}`));

  console.log('view gap:', getComputedStyle(view).gap);
  console.log('header bottom:', header.getBoundingClientRect().bottom);
  console.log('textarea top:', textarea.getBoundingClientRect().top);
  console.log('header→textarea gap(px):', textarea.getBoundingClientRect().top - header.getBoundingClientRect().bottom);

  rows.forEach((el, i) => {
    if (!el) return;
    const visible = el.offsetParent !== null;
    console.log(['sync-status','breadcrumb','sibling-nav','subtree-nav','quote-header'][i], 'visible:', visible, visible ? el.getBoundingClientRect() : '(hidden)');
  });
})();
```

### 5.3 確認観点（開発指示者が実機で見るべきポイント）

1. **CompositeBlock（拡張ブロック）編集時**: sibling-nav行（‹ Previous /
   Next ›ボタン）が完全に非表示になっているか（従来は2つのdisabledボタンが常
   に表示されていた）。上記スクリプトで `sibling-nav visible: false` になって
   いることを確認する。
2. **何も表示されない状態**: header直下からtextareaまでの間隔が、上記スクリプ
   トの `header→textarea gap(px)` でおおむね6px前後になっているか。「広大な無
   駄な空白」が解消され、textareaが画面上方から自然に始まっているか（textarea
   自体は `flex: 1 1 auto` のため引き続き画面下端まで伸びるのが正しい挙動であ
   り、これは今回変更していない）。
3. **パンくず・sibling-nav表示時（通常のリスト/セクション編集）**: 各行の間隔
   が視覚的に詰まって見えるか（旧: 8px間隔 → 新: 6px間隔）。間延びした印象が緩
   和されているか。
4. **stale/unavailable メッセージ表示時**: sync-status行の背景色
   （--text-warning/--text-error）・Reloadボタンの機能が従来通り動作するか。
   Reload確認モーダルの挙動（Phase 5A-1ロジック）に変化がないか。
5. **quote-header表示時（callout/blockquote編集）**: type/marker/titleの各入
   力欄が従来通り機能するか、行間の詰まりで窮屈になりすぎていないか。
6. **タップ/クリック操作**: Apply/Cancel/Close、パンくずクリック、sibling-nav
   ボタン、Subtree Navigatorチップ、quote関連入力欄、いずれも本ドキュメントの
   変更前と同じ位置感覚で操作可能か（間隔を詰めたことでタップ領域が誤操作を誘
   発していないか）。

## 6. 既知の限界

- `gap: 6px` は「header+textareaのみ」「header+sibling-nav+textarea」の2パ
  ターンを主眼に選定した値であり、パンくず・Subtree Navigator・quote-header
  等が同時に複数表示される最大構成（最大6行）での視覚的な詰まり具合は、実機で
  の見え方を最終確認する必要がある。
- 本調整はCSSの `gap` 値とTypeScript側のsibling-nav表示条件のみを対象としてお
  り、Phase 5A-1のstale/unavailable状態遷移ロジック、Reload確認モーダル、
  Apply無効化、paragraph/CompositeBlockの同期・再解決ロジックには一切手を加え
  ていない。

## 7. 追記（2026-09-09 第2弾）: 実機コンソール実測で確定した真の主因、および追加修正

### 7.1 発見の経緯

第1弾の修正（`gap: 6px` への一本化、`renderSiblingNav()` の追加非表示条件）を
適用・実機反映した後も、開発指示者より「編集中(段落)」の画面で依然として広大
な空白が残っているとの報告があった。本ドキュメント5章の手順に従い、実機
（ipad-test vault、段落編集画面）で実際にコンソールスクリプトを実行してもら
ったところ、以下の実測値が得られた。

- `header→textarea gap(px): 146`
- sync-status行: `offsetParent!=null(visible): true`、高さ38px
- breadcrumb行: 高さ0px
- sibling-nav行: `offsetParent!=null(visible): true`、高さ30px
- subtree-nav行: 高さ0px
- quote-header行: `offsetParent!=null(visible): true`、高さ42px

段落編集時はこれら5行すべてが非表示になっているはずであるにもかかわらず、
sync-status・sibling-nav・quote-headerの3行が実際の高さを持って存在してい
た。さらに `className` と `inlineStyle` を確認したところ、いずれも
`inlineStyle: "visibility: hidden;"` であることが判明した。

### 7.2 真の主因

Obsidian公式の `HTMLElement.prototype.toggleVisibility(false)` / `hide()`
は、`display: none` ではなく、対象要素に **インラインで
`style="visibility: hidden;"`** を設定するという実装であることが実機で確定
した。`visibility: hidden` は要素を視覚的に不可視にするだけで、レイアウト
（自身の高さ・padding・親の `gap` への参加）には一切影響しない。つまり、
「非表示」にしたつもりの行が、実際には中身の見えない透明な行としてスペース
を占有し続けていたのが真の主因である。

sync-status行にはReloadボタン、sibling-nav行にはPrevious/Nextボタンが、
`toggleVisibility` の呼び出し状況に関わらず常時DOM上に存在するテキスト付き
要素であるため、行自体が「見た目上非表示」でも実質的な高さ（38px/30px）を
持ち続ける。quote-header行（42px）も同様に、中身が空でも行自体の
`padding: 6px 8px` 分の高さは残る。

この3行の高さ合計（38+0+30+0+42=110px）に、header～textarea間に存在する6箇
所の `gap: 6px` 境界（非表示のはずの行も `display: none` になっていない以
上、依然としてflexアイテムとして `gap` の計算に参加してしまう）の合計36pxを
加えると、110+36=146pxとなり、実測値の146pxと完全に一致した。これにより、
「ヘッダー直下から入力ボックスまでの空白」の実体が確定した。

なお、前回（第1弾）の `renderSiblingNav()` の修正は無駄ではない。あの修正
は「`toggleVisibility(false)` を呼ぶかどうか」の分岐条件を正した修正であり、
`toggleVisibility(false)` 自体の視覚的効果（今回判明した `visibility:
hidden` によるレイアウト残留）とは別の問題であったため、単独では今回の
146pxの空白を解消できなかった。両修正は独立に必要である。

### 7.3 追加修正

`styles.css` に、Obsidianが `visibility: hidden;` でマークした行を強制的に
レイアウトから除外する以下のルールを追加した（`.unified-outliner-partial-
edit-view` ルールの直後に配置）。

```css
.unified-outliner-partial-edit-sync-status[style*="visibility: hidden"],
.unified-outliner-partial-edit-breadcrumb[style*="visibility: hidden"],
.unified-outliner-partial-edit-sibling-nav[style*="visibility: hidden"],
.unified-outliner-partial-edit-subtree-nav[style*="visibility: hidden"],
.unified-outliner-partial-edit-quote-header[style*="visibility: hidden"] {
  display: none !important;
}
```

`[style*="visibility: hidden"]` は、要素自身のinlineスタイル文字列に対する
部分一致セレクタである。CSSには「この要素自身のvisibilityが実際に
hiddenかどうか」を直接判定するセレクタが存在しないため、Obsidianが実際に書
き込むinlineスタイルの文字列（実機コンソールで確認済み: `"visibility:
hidden;"`）に対してマッチさせている。`!important` は、このファイル自身が
既に同じクラスに `display: flex` を宣言しているため、それを確実に上書きす
るための防御的な措置である（実際には `[style*="..."]` 付きセレクタの方が
単純クラスセレクタより詳細度が高いため、`!important` なしでも上回るが、将
来的な順序変化に対する保険として付与した）。

対象は今回実測で確認された5行（sync-status/breadcrumb/sibling-nav/
subtree-nav/quote-header）に限定した。quote-header行「内部」の個別入力欄
（quoteTypeInputEl等）も同じ `toggleVisibility` を使っているため、理論上は
同様の問題を抱えている可能性があるが、今回の報告・実測範囲外であるため、本
チケットでは手を加えていない。

### 7.4 実機での再確認事項

再デプロイ後、開発指示者には改めて5章のコンソールスクリプトを実行し、以下
を確認いただきたい。

- 段落編集時、sync-status/breadcrumb/sibling-nav/subtree-nav/quote-headerの
  いずれについても `sibling-nav visible: false`（各行が `offsetParent ===
  null` になる、または少なくとも `getBoundingClientRect().height` が0にな
  る）ことを確認する。
- `header→textarea gap(px)` が6px前後（第1弾の狙い通り）になっていること
  を確認する。
- プラグインの変更はファイルをコピーするだけでは実行中のObsidianに反映され
  ないため、確認の際は必ずプラグインの無効化→有効化、またはObsidianの完全
  な再起動を行った状態で計測すること。
