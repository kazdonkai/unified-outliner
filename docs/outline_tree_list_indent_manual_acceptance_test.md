# Outline Tree — リスト項目のインデント幅調整（UI-only follow-up）実機受入テスト

本ドキュメントは、実装担当（Claude）が Outline Tree におけるリスト項目のインデント幅（字下げ量）調整（`styles.css`のみのCSS-only変更）の実装・自動テスト・型チェック・build完了後、開発指示者が実機（Obsidian）上で実施するための、具体的な操作手順である。

本作業はPhase 5A-1の追加実装ではなく、CompositeBlockの視覚的グルーピング表示・行間（line-height/min-height/padding）の調整内容を再変更するものでもない。本ドキュメントは、既存の`docs/composite_block_tree_visual_grouping_manual_acceptance_test.md`・`docs/outline_tree_list_row_density_manual_acceptance_test.md`と重複しないよう、インデント幅に関する確認だけに範囲を絞っている。

## 1. 目的と対象範囲

対象範囲は次のとおりである。

- `.unified-outliner-tree-root`に追加した`--nav-item-children-padding-start: 8px; --nav-item-children-margin-start: 6px;`(Obsidianコア自身が公開しているCSSカスタムプロパティの、本プラグインのOutline Treeパネル内だけへの再定義)による、見出し直下の第1階層開始位置・ネスト1段あたりのステップ幅の調整
- 上記の調整が、File Explorer・コア標準Outlineなど、本プラグイン以外のObsidianツリー系パネルに一切影響しないこと
- 上記の調整が、折りたたみ矢印・drag handle・インデントガイド線・CompositeBlockの視覚契約・行間(line-height/min-height/padding)に一切影響しないこと

対象外（今回変更していない、確認不要）:

- CompositeBlockの親行・member行・終端行自体の視覚表示（既存ドキュメントを参照）
- 通常list行の行間・高さ（`docs/outline_tree_list_row_density_manual_acceptance_test.md`を参照）
- インデントガイド線自体の色・太さ（今回変更していない。位置のみ、インデント幅の変更に伴い自然に追従する）

本ドキュメントもMac上でのモバイルエミュレーションによる確認は対象としない。desktopでの確認を必須とし、iPad等の実機・popoutウィンドウでの確認は可能な範囲での任意項目とする。実機確認そのものは開発指示者が行うものであり、Claudeが代行することはない。

## 2. 事前準備

- テスト対象のプラグインは、このリポジトリ（`unified-outliner-public`）の現在のワークツリー（本follow-upの変更を含む、コミット前の変更を含む）からビルドしたものであることを確認する。
- 実機テスト用のObsidian vaultとして、他の受入文書と同じ`obsidian/ipad-test` vault（`Users/kazumikaizuka/Obsidian/ipad-test`）の`Test`フォルダを使用する。今回ご提供いただいたスクリーンショットの「Case5 Section B」を含む既存のテストノートをそのまま使ってよい。
- プラグイン設定のうち、`settings.showListItemsInOutline`（list行のOutline Tree表示）が有効になっていることを確認する。
- 比較のため、File Explorer（左サイドバー）を同時に開いておき、そのインデントが変化していないことを見比べられるようにしておく。
- light/darkテーマの少なくとも2種類で確認できるようにしておく。
- 実施結果を記録する担当者・端末（機種・OSバージョン・Obsidianバージョン・使用テーマ）を明確にしておく。

## 3. 共通の確認方法

- 見出し（H2/H3など）直下の第1階層リスト項目の左端が、調整前より見出しの左端に近づいて見えることを確認する。
- ネストしたリスト項目（親→子→孫）の1階層あたりの横方向のステップ幅が、調整前より狭くなっていることを確認する。
- 折りたたみ矢印・list marker（「-」）・インデントガイド線（縦線）が、テキストと重ならず、階層関係が引き続き明確に分かることを確認する。
- File Explorer（左サイドバー）のインデントが、調整の前後で見た目が変わっていないことを確認する。

## 4. ケース別テスト

### グループA: インデント幅そのものの改善

| 項目 | 内容 |
| --- | --- |
| A-1 目的 | 見出し直下の第1階層リスト項目（例: ご提供いただいたスクリーンショットの`c5-target-different-section`）の左インデントが、調整前より詰まって見えることを確認する。 |
| A-1 操作 | 対象の見出しとその直下のリスト項目をOutline Treeで表示する。 |
| A-1 期待結果 | 第1階層の開始位置が、調整前より見出しの左端に近づいている。過度に詰まって見出しと区別がつかなくなってはいない。 |
| A-1 不合格の例 | 見た目が変わっていない／見出しと第1階層の開始位置がほぼ同じになり区別がつかない。 |

| 項目 | 内容 |
| --- | --- |
| A-2 目的 | ネストしたリスト項目（例: `c5-outer-b`配下の`c5-target-different-parentid`）の1階層あたりのステップ幅が、調整前より狭くなっていることを確認する。 |
| A-2 操作 | 親子関係のあるリスト項目を含むセクションを表示し、必要に応じて展開する。 |
| A-2 期待結果 | 階層が深くなっても、横幅の消費が調整前より緩やかである。3〜4階層になっても、パネル幅を大きく圧迫しない。 |
| A-2 不合格の例 | ステップ幅が変わっていない、または詰まりすぎて階層関係が分かりにくい。 |

### グループB: 影響が出てはならない要素の非回帰確認

| 項目 | 内容 |
| --- | --- |
| B-1 目的 | 折りたたみ矢印のクリック（タップ）判定・見た目が変わっていないことを確認する。 |
| B-1 操作 | 子を持つ複数のリスト項目・見出しで、折りたたみ矢印をクリック（タップ）して開閉する。 |
| B-1 期待結果 | 調整前と同様に、矢印のクリックだけで開閉できる。矢印の見た目・位置がテキストと重ならない。 |
| B-1 不合格の例 | 矢印がクリックしづらい、または他の要素と重なって見える。 |

| 項目 | 内容 |
| --- | --- |
| B-2 目的 | drag handle（六点ハンドル）の表示位置・操作性が変わっていないことを確認する。 |
| B-2 操作 | desktopで通常list行にhoverしてdrag handleを表示し、位置と操作性を確認する。iPad等が利用できる場合は常時表示のdrag handleも確認する。 |
| B-2 期待結果 | drag handleの位置・大きさ・操作性が、`docs/outline_tree_list_row_density_manual_acceptance_test.md`で確認した内容から変わっていない。 |
| B-2 不合格の例 | drag handleの位置がずれている、または操作しづらくなっている。 |

| 項目 | 内容 |
| --- | --- |
| B-3 目的 | インデントガイド線（縦線）が、新しいインデント幅に合わせて自然に位置追従しており、途切れたり二重に見えたりしないことを確認する。 |
| B-3 操作 | ネストしたリスト項目を表示し、ガイド線の見た目を確認する。 |
| B-3 期待結果 | ガイド線がテキストの開始位置と整合しており、不自然な位置に見えない。 |
| B-3 不合格の例 | ガイド線が本来の位置からずれている、途切れている、または二重に見える。 |

| 項目 | 内容 |
| --- | --- |
| B-4 目的 | CompositeBlockの親行・member行・終端行の視覚表示（左端アクセント・背景・終端線）が変わっていないことを確認する。 |
| B-4 操作 | CompositeBlockを含むセクションを表示する。 |
| B-4 期待結果 | `docs/composite_block_tree_visual_grouping_manual_acceptance_test.md`で確認した3段階の表示が変わらず見える。 |
| B-4 不合格の例 | CompositeBlockの表示が変化している。 |

| 項目 | 内容 |
| --- | --- |
| B-5 目的 | 行間（line-height/min-height/padding）が、直前の調整内容から変わっていないことを確認する。 |
| B-5 操作 | 通常list行を複数表示する。 |
| B-5 期待結果 | 行の縦方向の高さ・余白が、`docs/outline_tree_list_row_density_manual_acceptance_test.md`で確認した内容から変わっていない。 |
| B-5 不合格の例 | 行の高さが変化している。 |

| 項目 | 内容 |
| --- | --- |
| B-6 目的 | File Explorer（左サイドバー）など、本プラグイン以外のObsidianツリー系パネルのインデントが、一切影響を受けていないことを確認する。 |
| B-6 操作 | File Explorerを開き、ネストしたフォルダ・ファイルのインデントを確認する。 |
| B-6 期待結果 | File Explorerのインデントが、調整の前後で見た目が変わっていない。 |
| B-6 不合格の例 | File Explorerのインデントまで詰まって見える。 |

### グループC: テーマ確認

| 項目 | 内容 |
| --- | --- |
| C-1 目的 | light・darkいずれのテーマでも、インデント調整後の見た目に問題がないことを確認する。 |
| C-1 操作 | Obsidianの外観設定でlight/darkを切り替え、ネストしたリスト項目を確認する。 |
| C-1 期待結果 | いずれのテーマでも、階層関係・ガイド線が問題なく識別できる。 |
| C-1 不合格の例 | 一方のテーマで階層関係が分かりにくい。 |

## 5. 任意確認項目（環境依存、未実施・未確認可）

- iPad等のモバイル実機での、狭いパネル幅におけるインデント調整後の見え方
- popoutウィンドウでの同表示の見え方
- 4階層以上の深いネストを含む実際のノートでの見え方

## 6. 完了の記録

全ケースの結果（PASS/FAIL/未確認）と、使用した端末・テーマ・Obsidianバージョンを本ドキュメントの複製に追記して記録する。1件でもFAILが発生した場合は、production codeを修正せず、再現手順のみをClaudeへ報告することとする。


## 7. 追記（2026-09-08）: 段落行とリスト行のテキスト開始位置の差の緩和

上記グループA/Bの調整（`--nav-item-children-*`のインデント幅縮小）を適用した後も、同じ親セクション直下にある段落行（¶）とリスト行（-）を比較すると、リスト行のテキスト開始位置が段落行より右にずれて見えるという指摘があった。調査の結果、原因は「1階層あたりのインデント幅」ではなく、**同じ階層内での構造的な非対称**であると判明した。段落行は常に`readOnly`かつ`isComposite`が`false`のため drag handle（六点ハンドル、約28px幅）を持たないが、通常のリスト行は常にdrag handleを持つ。この差が、同階層でのテキスト開始位置のズレの直接原因である。

この節で追加検証する変更は次の二点（いずれも`styles.css`のみ、CSS-only）であり、上記グループA/Bのインデント幅調整（`--nav-item-children-*`）そのものとは別の変更である。

| 対象 | 変更前 | 変更後 |
| --- | --- | --- |
| `.tree-item-self[data-kind="paragraph"]` | `padding-left`指定なし | `padding-left: 12px;`を新規追加 |
| `.unified-outliner-drag-handle` | `padding: 0 4px;` | `padding: 0 2px;`（`width: 28px;`・`min-height: 28px;`は変更なし） |

目的はピクセル単位の完全一致ではなく、視覚的な違和感が解消される範囲でのバランス調整である。

### グループD: 段落行/リスト行のテキスト開始位置バランス

| 項目 | 内容 |
| --- | --- |
| D-1 目的 | 同じ親セクション直下にある段落行とリスト行を並べたとき、テキスト開始位置の差が調整前より縮まって見えることを確認する。 |
| D-1 操作 | 「Case5 Section B」など、段落行（¶）とリスト行（-）が同階層で連続するセクションをOutline Treeで表示する。 |
| D-1 期待結果 | リスト行のテキスト開始位置が段落行に近づいており、違和感（リスト行だけが過剰にインデントされて見える見た目）が緩和されている。完全な一致までは求めない。 |
| D-1 不合格の例 | 差が調整前とほぼ変わらない、または段落行とリスト行の開始位置が逆転して段落行の方が右に寄りすぎる。 |

| 項目 | 内容 |
| --- | --- |
| D-2 目的 | drag handle（六点ハンドル）のタップ・ドラッグ操作性が、`padding`縮小後も実用上損なわれていないことを確認する。 |
| D-2 操作 | desktopでhoverしてdrag handleを表示し、クリック→ドラッグでリスト行を移動する。iPad等が利用できる場合は常時表示のdrag handleでも同様に確認する。 |
| D-2 期待結果 | ハンドルの視覚的な大きさ（幅28px相当）はほぼ変わらず見え、ドラッグ操作が調整前と同様に行える。 |
| D-2 不合格の例 | ハンドルが小さくなりすぎてタップ・ドラッグしづらい。 |

| 項目 | 内容 |
| --- | --- |
| D-3 目的 | 折りたたみアイコン・CompositeBlockの視覚契約・通常list行の行間（line-height/min-height/padding）・グループA/Bで確認したインデント幅が、今回の変更で影響を受けていないことを確認する。 |
| D-3 操作 | CompositeBlockを含むセクション、折りたたみ可能な見出し・リスト項目、通常list行を含む画面を表示する。 |
| D-3 期待結果 | `docs/composite_block_tree_visual_grouping_manual_acceptance_test.md`・`docs/outline_tree_list_row_density_manual_acceptance_test.md`・本ドキュメントのグループA/Bで確認した内容から変化がない。 |
| D-3 不合格の例 | CompositeBlockの表示、list行の高さ、またはインデント幅のいずれかが変化している。 |

なお、本節はグループA/Bの内容を差し替えるものではなく、CSS-onlyの追加調整として別ドキュメント（`docs/outline_tree_list_row_density_manual_acceptance_test.md`等）を新設せず、本ドキュメントへの追記として記録する。1件でもFAILが発生した場合は、production codeを修正せず、再現手順のみをClaudeへ報告することとする。


## 8. 追記（2026-09-09）: ほぼ同一位置への再調整、および実機コンソールによる検証手順

上記グループD（`padding-left: 12px;` / drag handleの`padding: 0 2px;`）を実機に配置して確認したところ、視覚的な変化がスクリーンショット上でほとんど分からないという指摘を受けた。詳しい調査の結果、次の二点が判明した。

一点目は、drag handleの`padding`のみを縮める調整（`0 4px;`→`0 2px;`）が、実質的に無効な変更だったという設計ミスである。drag handleは`justify-content: center;`でアイコンを中央寄せしており、かつ`width: 28px;`という固定幅を持つため、内側の`padding`をいくら縮めても、行内でこの要素が占有する横幅自体（したがって後続のリストマーカー/テキストの開始位置）は一切変わらない。これは`padding`ではなく`width`自体を縮めなければ意味がなかった。

二点目は、段落行とリスト行は見た目の階層表示こそ異なって見えるが、実際には**同じ親の直下にある同一階層のノードである**という点である。開発指示者からの指摘のとおりであり、この前提に立てば、両者のテキスト開始位置は「近づける」程度ではなく「ほぼ一致させる」ことが正しい目標となる。

この節で追加検証する変更は次のとおりである（いずれも`styles.css`のみ、CSS-only）。

| 対象 | 前節（グループD）時点 | 今回の変更後 |
| --- | --- | --- |
| `.tree-item-self[data-kind="paragraph"]`の`padding-left` | `12px` | `45px` |
| `.unified-outliner-drag-handle`の`width` | `28px`（実質未変更） | `24px`（実際に4px縮小） |
| `.unified-outliner-drag-handle`の`padding` | `0 2px;`（無効だった変更） | `0 4px;`（元の値に復帰。`width`の縮小のみが実際の変更点） |
| `.unified-outliner-drag-handle`の`min-height` | `28px` | `28px`（変更なし） |

`45px`という具体的な数値は、実機のDevToolsコンソールで`getBoundingClientRect()`を用いて段落行ラベル（`.unified-outliner-paragraph-label`）とリスト行ラベル（`.unified-outliner-list-label`）の実際のCSS px単位の開始位置を直接測定し、その残差（33px）を`12px`に加算して算出したものである。**スクリーンショットのピクセル数をそのまま比較する方法は、実機側の表示スケール（Retina等）の影響で実際のCSS px数の約2倍に見えることが判明したため、本節以降は使用しない。**

### グループE: ほぼ同一位置への近似確認（実機コンソール使用）

| 項目 | 内容 |
| --- | --- |
| E-1 目的 | 同じ親の直下にある段落行とリスト行のテキスト開始位置が、目視でほぼ同じ位置に揃って見えることを確認する。 |
| E-1 操作 | 「Case5 Section B」等、段落行（¶）とリスト行（-）が同階層で連続するセクションをOutline Treeで表示する。 |
| E-1 期待結果 | 段落行のテキストとリスト行のテキストが、ほぼ同じ左端位置から始まって見える。 |
| E-1 不合格の例 | 依然として明らかな段差がある、または段落行がリスト行より右に出過ぎている。 |

| 項目 | 内容 |
| --- | --- |
| E-2 目的（客観測定・推奨） | 目視だけでなく、DevToolsコンソールで実際のCSS px差分を測定し、ほぼ0pxに近いことを確認する。 |
| E-2 操作 | Obsidianのメニュー「表示」→「開発者」→「開発者ツールを切り替え」（Cmd+Option+I）でDevToolsを開き、Consoleタブで次のスクリプトを実行する。<br><br>```js<br>(function () {<br>  function leftOf(el) {<br>    if (!el) return null;<br>    return Math.round(el.getBoundingClientRect().left);<br>  }<br>  const paraLabels = document.querySelectorAll(".unified-outliner-paragraph-label");<br>  paraLabels.forEach((pl, i) => {<br>    const paraRow = pl.closest(".tree-item");<br>    const parentChildren = paraRow ? paraRow.parentElement : null;<br>    if (!parentChildren) return;<br>    const siblingListRow = Array.from(parentChildren.children).find(<br>      (c) => c !== paraRow && c.querySelector && c.querySelector(".unified-outliner-list-label")<br>    );<br>    const siblingLabel = siblingListRow ? siblingListRow.querySelector(".unified-outliner-list-label") : null;<br>    const pLeft = leftOf(pl);<br>    const lLeft = leftOf(siblingLabel);<br>    console.log(`[${i}] 段落left=${pLeft}px` + (siblingLabel ? ` <-> リストleft=${lLeft}px 差分=${lLeft - pLeft}px` : " (兄弟リストなし)"));<br>  });<br>})();<br>``` |
| E-2 期待結果 | 「差分=◯◯px」の値が、以前の33pxから大きく縮み、ほぼ0px（目安として±10px程度以内）になっている。 |
| E-2 不合格の例 | 差分が33px前後からほとんど変わっていない（→CSSが反映されていない可能性、Reload app without savingを試す）。差分が大きくマイナスになっている（→段落行がリスト行より右に出過ぎ、`padding-left`を減らす調整が必要）。 |

| 項目 | 内容 |
| --- | --- |
| E-3 目的 | drag handleの`width`を28pxから24pxに縮めたことで、タップ・ドラッグ操作性が実用上損なわれていないことを確認する。 |
| E-3 操作 | desktopでhoverしてdrag handleを表示し、クリック→ドラッグでリスト行を移動する。iPad等が利用できる場合は常時表示のdrag handleでも同様に確認する。 |
| E-3 期待結果 | 24px幅でもドラッグ操作が問題なく行える。 |
| E-3 不合格の例 | ハンドルが小さくなりすぎてタップ・ドラッグしづらい。 |

| 項目 | 内容 |
| --- | --- |
| E-4 目的 | 折りたたみアイコン・CompositeBlockの視覚契約・通常list行の行間・グループA/Bのインデント幅が、今回の変更で影響を受けていないことを確認する。 |
| E-4 操作 | CompositeBlockを含むセクション、折りたたみ可能な見出し・リスト項目、通常list行を含む画面を表示する。 |
| E-4 期待結果 | 既存の各ドキュメントで確認した内容から変化がない。 |
| E-4 不合格の例 | CompositeBlockの表示、list行の高さ、またはインデント幅のいずれかが変化している。 |

段落行の`padding-left`が`45px`と、リスト項目の通常のインデント幅（グループA/Bで調整した`--nav-item-children-*`の1階層分、約14px）よりも大きい値になっている点は意図的である。これは段落行がインデントの「1階層分」ではなく、リスト行が持つdrag handle等の構造的な横幅を打ち消すためのオフセットだからである。1件でもFAILが発生した場合は、production codeを修正せず、再現手順のみをClaudeへ報告することとする。
