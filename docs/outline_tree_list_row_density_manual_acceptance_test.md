# Outline Tree — 通常list行の密度改善（UI-only follow-up）実機受入テスト

本ドキュメントは、実装担当（Claude）が Outline Tree における通常list行の縦方向の余白調整（`styles.css`のみのCSS-only変更）の実装・自動テスト・型チェック・build完了後、開発指示者が実機（Obsidian）上で実施するための、具体的な操作手順である。

本作業はPhase 5A-1の追加実装ではなく、CompositeBlockの視覚的グルーピング表示（`docs/composite_block_tree_visual_grouping_manual_acceptance_test.md`）の内容を再変更するものでもない。本ドキュメントは、その文書と重複しないよう、通常list行の密度に関する確認だけに範囲を絞っている。CompositeBlock自体の親行・member行・終端行の視覚契約についての確認は、既存の当該ドキュメントを参照すること。

**2026-09-08 追記（実機動画確認後の追加調整）**: 初回のpadding調整だけでは、通常list行とCompositeBlock member行の間にまだ差が残っていた。原因を調査した結果、CompositeBlock member行（list-item member・callout/blockquote member）は既存仕様上drag handle（六点ハンドル）が生成されない行であるのに対し、通常list行は必ずdrag handleを持ち、そのdrag handle自身の`min-height: 28px`（UXP-01で実機確認済みのタップ領域）が行の高さの下限を作っていることが直接原因と判明した。drag handle自体は変更できないため、通常list行側に明示的に`min-height: 28px`（drag handleと同じ値）を追加し、Obsidianのテーマ既定値がそれ以上の余分な高さを与えていた場合はそれを打ち消すようにした。この下限より短くすることはできない（drag handleのタップ領域を縮めることになるため）。

## 1. 目的と対象範囲

対象範囲は次のとおりである。

- `styles.css`に追加した `.tree-item-self[data-kind="list"]:not([data-composite-group="true"]) { padding-top: 1px; padding-bottom: 1px; min-height: 28px; }` による、CompositeBlockに属さない通常list行の上下padding・min-heightの調整
- 上記の調整が、section / heading行、paragraph行、standalone callout・blockquote、CompositeBlock親行・member行・終端行に一切影響しないこと
- 上記の調整後も、fold arrow・list marker・drag handle・D&Dインジケータ・現在行・選択行・hover・focusの各表示・操作性が壊れていないこと
- drag handleとlist marker（"-"）の上下中央位置が、調整前と変わらず保たれていること

対象外（今回変更していない、確認不要）:

- CompositeBlockの親行・member行・終端行自体の視覚表示（既存ドキュメントを参照）
- CompositeBlockのparser・rule・range・snapshot・member判定
- Phase 5A-1のPartial Edit Pane関連
- 設定項目・Style Settings項目（今回新規追加なし）

本ドキュメントもMac上でのモバイルエミュレーションによる確認は対象としない。desktopでの確認を必須とし、iPad等の実機・popoutウィンドウでの確認は可能な範囲での任意項目とする。実機確認そのものは開発指示者が行うものであり、Claudeが代行することはない。

## 2. 事前準備

- テスト対象のプラグインは、このリポジトリ（`unified-outliner-public`）の現在のワークツリー（本follow-upの変更を含む、コミット前の変更を含む）からビルドしたものであることを確認する。
- 実機テスト用のObsidian vaultとして、`docs/composite_block_tree_visual_grouping_manual_acceptance_test.md`と同じ `obsidian/ipad-test` vault（`Users/kazumikaizuka/Obsidian/ipad-test`）の `Test` フォルダを使用する。
- プラグイン設定のうち、`settings.showListItemsInOutline`（list行のOutline Tree表示）が有効になっていることを確認する。無効な場合、本ドキュメントのケースをそもそも確認できない。
- CompositeBlock関連ルール（`image-ocr`・`image-quote`）は既定値どおり有効のままでよい（グループB・Cで使用する）。
- light/darkテーマの少なくとも2種類で確認できるようにしておく。
- 実施結果を記録する担当者・端末（機種・OSバージョン・Obsidianバージョン・使用テーマ）を明確にしておく。

## 3. テスト用ノート

以下のMarkdownを、`obsidian/ipad-test` vaultの`Test`フォルダ内に新規ノートとして作成する。ノート名は `outline-tree-list-row-density-fixture.md` とする。

```markdown
# list行密度検証セクション

## サブセクションA: 通常list行のみ（間延び比較用）

- c4-gap-one
- c4-gap-two
- c4-gap-three

## サブセクションB: CompositeBlockと通常list行の混在

- ![[dummy-image.png]]
> [!note] OCR結果
> これはCompositeBlock（画像+OCRコールアウト）検証用の固定テキストである。

- c4-target-before-far
- c4-target-before-near
- c4-target-plain-item
- c4-target-after-near
- c4-target-after-far

- ![[dummy-image2.png]]
> これはCompositeBlock（画像+引用）検証用の固定テキストである。

## サブセクションC: ネストした通常list行

- 親アイテム
  - 子アイテム1
  - 子アイテム2
    - 孫アイテム

## サブセクションD: 長いテキストのlist行（複数行折り返し確認用）

- これは意図的に長く書かれたlist項目のテキストである。Outline Treeパネルの幅を狭めた状態、あるいは長いタイトルのlist項目を確認する際に、複数行に折り返した場合でも文字が重ならず読めることを確認するための固定テキストである。

## サブセクションE: 比較用のsection・paragraph・callout・blockquote

見出し行と、次の通常段落・スタンドアロンcallout・スタンドアロンblockquoteは、今回のlist行密度調整の対象外であり、調整前と変わらない見た目であることの比較対象として使う。

これは検証用の段落である。

> [!note] スタンドアロンコールアウト
> これは独立したコールアウトの本文である。CompositeBlockの一部ではない。

> これはスタンドアロンの引用（blockquote）である。
```

`![[dummy-image.png]]` / `![[dummy-image2.png]]` は実在の画像ファイルでなくてもよい。既存のPhase 5A-1受入フィクスチャや`composite_block_tree_visual_grouping_manual_acceptance_test.md`のダミー画像がある場合はそれを流用してよい。

## 4. 共通の確認方法

- Outline Treeで、サブセクションA・Bの通常list行（`c4-gap-*`・`c4-target-*`）の上下の余白が、調整前より詰まって見え、連続して並んだときに「間延び」した印象が和らいでいることを確認する。
- 同時に、行の文字・list marker・fold arrow（該当する場合）・drag handleが窮屈に潰れて見えたり、タップ／クリックしにくくなっていないことを確認する。
- サブセクションEの見出し・段落・スタンドアロンcallout・blockquoteの余白が、調整前と変わっていないことを確認する（比較対象）。
- サブセクションBのCompositeBlock（親行・OCR/引用のmember行）の表示が、`docs/composite_block_tree_visual_grouping_manual_acceptance_test.md`に記載の3段階（親行・中間member行・終端member行）のまま変わっていないことを確認する。

## 5. ケース別テスト

### グループA: 通常list行の密度改善そのもの

| 項目 | 内容 |
| --- | --- |
| A-1 目的 | 連続する通常list行（`c4-gap-one`〜`c4-gap-three`）が、調整前より過度な余白なく、詰まりすぎてもいない、読みやすい密度で表示されることを確認する。 |
| A-1 操作 | サブセクションAを表示する。 |
| A-1 期待結果 | 3行が調整前より縦方向にコンパクトに並び、かつ文字・アイコンが窮屈に潰れていない。 |
| A-1 不合格の例 | 調整前と見た目が変わらない／行が詰まりすぎて文字やアイコンが窮屈・重なって見える。 |

| 項目 | 内容 |
| --- | --- |
| A-2 目的 | CompositeBlockの前後に挟まれた通常list行（`c4-target-*`）でも、同様に密度が改善されていることを確認する。 |
| A-2 操作 | サブセクションBを表示し、CompositeBlockの前後にある5行の通常list行を確認する。 |
| A-2 期待結果 | 5行いずれも密度が改善されており、かつ前後のCompositeBlockの親行・member行との境界（どこからどこまでが通常list行で、どこからがCompositeBlockか）が引き続き明確に分かる。 |
| A-2 不合格の例 | 通常list行とCompositeBlock行の境界が分かりにくくなる／一部の行だけ密度が変わらない。 |

### グループB: 影響が出てはならない行種別の非回帰確認

| 項目 | 内容 |
| --- | --- |
| B-1 目的 | 見出し（section）行の余白が変わっていないことを確認する。 |
| B-1 操作 | 「list行密度検証セクション」および各サブセクションの見出し行を表示する。 |
| B-1 期待結果 | 見出し行の上下の余白は、この変更の前後で見た目が変わらない。 |
| B-1 不合格の例 | 見出し行まで詰まって見える。 |

| 項目 | 内容 |
| --- | --- |
| B-2 目的 | 通常段落・スタンドアロンcallout・スタンドアロンblockquote行の余白が変わっていないことを確認する。 |
| B-2 操作 | サブセクションEの段落・callout・blockquoteを表示する。 |
| B-2 期待結果 | いずれも変更前と同じ見た目である。 |
| B-2 不合格の例 | これらの行まで詰まって見える。 |

| 項目 | 内容 |
| --- | --- |
| B-3 目的 | CompositeBlockの親行・member行・終端行の3段階の視覚表示（`docs/composite_block_tree_visual_grouping_manual_acceptance_test.md`の内容）が、今回の変更で壊れていないことを確認する。 |
| B-3 操作 | サブセクションBのCompositeBlock 2件を展開して表示する。 |
| B-3 期待結果 | 親行が最も強い表示、終端member行が下端に区切りのある表示、という既存の3段階が変わらず見える。CompositeBlockの行自体の余白（padding）も変わっていない。 |
| B-3 不合格の例 | CompositeBlockの行の余白や強弱表示が変わってしまっている。 |

### グループC: ネスト・折り返し・操作性の非回帰確認

| 項目 | 内容 |
| --- | --- |
| C-1 目的 | ネストした通常list行（親・子・孫）でも、fold arrow・indent・list marker・文字が重ならず読めることを確認する。 |
| C-1 操作 | サブセクションCを表示し、必要に応じて折りたたみ／展開する。 |
| C-1 期待結果 | 3階層とも、折りたたみ矢印・インデント・list marker・テキストが重ならず、階層関係が引き続き分かる。 |
| C-1 不合格の例 | 折りたたみ矢印やlist markerとテキストが重なって見える／階層が分かりにくくなる。 |

| 項目 | 内容 |
| --- | --- |
| C-2 目的 | 複数行に折り返す長いlist行が、密度調整後も問題なく読めることを確認する。 |
| C-2 操作 | サブセクションDの長いlist項目を表示する（必要であればサイドバー幅を狭めて折り返しを発生させる）。 |
| C-2 期待結果 | 折り返した複数行のテキストが重ならず、余白も窮屈すぎず読める。 |
| C-2 不合格の例 | 折り返した行同士が詰まりすぎて読みにくい、または重なって見える。 |

| 項目 | 内容 |
| --- | --- |
| C-3 目的 | 現在行・選択行・hover・focusの各状態が、密度調整後も引き続き見分けられることを確認する。 |
| C-3 操作 | 本文エディタでカーソルをサブセクションAのいずれかのlist行に移動し（現在行）、Outline Treeパネルにフォーカスして上下キーで選択行を移動し、マウスでhoverする。 |
| C-3 期待結果 | 現在行・選択行・hover行のいずれも、密度調整前と同様にはっきり見分けられる。 |
| C-3 不合格の例 | いずれかの状態が見分けにくくなる。 |

| 項目 | 内容 |
| --- | --- |
| C-4 目的 | 通常list行のクリック・右クリック・キーボード選択・drag handle・D&D操作に回帰がないことを確認する。 |
| C-4 操作 | サブセクションAまたはBの通常list行に対して、クリック・右クリックメニュー表示・キーボード選択・（desktopで）drag handleでのドラッグ開始を一通り試す。 |
| C-4 期待結果 | いずれも密度調整前と同様に問題なく操作できる。ドラッグ中はdrop-before/after/insideの挿入位置インジケータが引き続きはっきり見える。 |
| C-4 不合格の例 | いずれかの操作ができない、またはドラッグ中のインジケータが見えにくい。 |

| 項目 | 内容 |
| --- | --- |
| C-5 目的 | `min-height`を追加したことで、drag handle・list marker（"-"）が行の上下中央からズレていないことを確認する。 |
| C-5 操作 | サブセクションAまたはBの通常list行で、desktopではhoverしてdrag handleを表示させ、list markerとdrag handleの縦位置を目視で確認する。iPad等が利用できる場合は、常時表示されているdrag handleでも同様に確認する。 |
| C-5 期待結果 | drag handle・list markerとも、テキストの上下中央におおむね揃って見える。行の上寄り・下寄りに偏っていない。 |
| C-5 不合格の例 | drag handleやlist markerがテキストより上または下にズレて見える。 |

### グループD: 情報密度・テーマ確認

| 項目 | 内容 |
| --- | --- |
| D-1 目的 | サブセクションAのように通常list行が連続して多数並んだとき、密度は上がるが窮屈ではない、ちょうどよいバランスになっていることを確認する。 |
| D-1 操作 | desktopでサブセクションAを表示し、全体の見た目を確認する。 |
| D-1 期待結果 | 調整前より情報密度が上がっているが、行同士が詰まりすぎて圧迫感がある、とまでは感じない。 |
| D-1 不合格の例 | 詰まりすぎて読みにくい、または密度がほとんど変わっていないと感じる。 |

| 項目 | 内容 |
| --- | --- |
| D-2 目的 | light・darkいずれのテーマでも、密度調整後の見た目に問題がないことを確認する。 |
| D-2 操作 | Obsidianの外観設定でlight/darkを切り替え、それぞれでサブセクションA・Bを確認する。 |
| D-2 期待結果 | いずれのテーマでも読みやすさ・操作性に問題がない。 |
| D-2 不合格の例 | 一方のテーマで読みにくい、または操作しづらい。 |

## 6. 任意確認項目（環境依存、未実施・未確認可）

- iPad等のモバイル実機での密度調整後の見え方・タップ操作性
- popoutウィンドウでの同表示の見え方
- 非常に長いOutline Tree（数十〜数百行）を実際のノートでスクロールした際の、体感的な情報密度の変化

## 7. 完了の記録

全ケースの結果（PASS/FAIL/未確認）と、使用した端末・テーマ・Obsidianバージョンを本ドキュメントの複製に追記して記録する。1件でもFAILが発生した場合は、production codeを修正せず、再現手順のみをClaudeへ報告することとする。
