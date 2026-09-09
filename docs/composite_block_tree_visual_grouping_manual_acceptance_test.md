# Outline Tree — CompositeBlock 視認性改善（UI-only follow-up）実機受入テスト

本ドキュメントは、実装担当（Claude）が Outline Tree における CompositeBlock の視認性改善（左端アクセントボーダー + 薄い背景色によるグループ表示）の実装・自動テスト・型チェック・build 完了後、開発指示者が実機（Obsidian）上で実施するための、具体的な操作手順である。実装内容そのものの解説文書ではなく、実際に手を動かして確認するための手順書として作成した。

本作業は Phase 5A-1 の追加実装ではない。また、ロードマップ上「Phase 5E」は Mermaid・表・その他ブロックのために予約された別チケットの名称であるため、本作業をそのように呼ばない。本ドキュメントもあえて「Phase 5X」の番号を名乗らず、内容そのもので識別できる名称にしている。

**2026-09-08 追記（CSS-only refinement）**: 初回実装は親行・member行・終端行すべてに同一のアクセント（同じ太さ・同じ濃さ）を適用していたが、実機確認で「一様な淡い帯」にしか見えないという指摘を受け、`styles.css` のみを変更し、親行（header）・中間member行・終端member行の3段階で強弱を付ける調整を行った（TypeScript側・DOM構造・`data-composite-group`/`data-composite-group-end`の意味は変更していない）。本ドキュメントの該当ケースも、この3段階の表示を確認できるよう最小限の記述更新を行っている。

## 1. 目的と対象範囲

本ドキュメントの目的は、`src/view/OutlineTreeView.ts`・`src/tree/buildOutlineTree.ts`・`styles.css` に実装済みの、CompositeBlock 親行・member 行に対する左端アクセントボーダー + 薄い背景色の視覚的グルーピング表示について、開発指示者が実機の Obsidian 上で合否を判定できる、具体的な操作手順を提供することである。

対象範囲は次のとおりである。

- CompositeBlock（list + callout、list + blockquote）の親行・member 行に付与される `data-composite-group="true"` / `data-composite-group-end="true"` と、それに対応する `.unified-outliner-composite-accent` 要素・CSS
- 通常の list / callout / blockquote（CompositeBlock を構成しないもの）にはこの表示が付かないこと
- 現在行（body editor のカーソル位置と連動する行）・選択行（キーボード選択行）・hover・focus・折りたたみと、この新しい表示との共存
- 既存の CompositeBlock の Move・D&D・Delete・Partial Edit への非回帰確認（今回のUI-only follow-upで挙動を変えていないことの最小限の再確認）

対象外（今回変更していない、確認不要）:

- CompositeBlock の parser・rule・range・snapshot・member 判定・表示ラベル・prefix 記号・icon・設定キー
- Phase 5A-1 の Partial Edit Pane 側の stale/unavailable/Reload/Pass 3
- Mermaid・表・その他ブロック（Phase 5E）

なお、本ドキュメントは Mac 上でのモバイルエミュレーションによる確認は対象としない。desktop（macOS 上の Obsidian）での確認を必須とし、iPad 等の実機・popout ウィンドウでの確認は可能な範囲での任意項目とする。実機確認そのものは開発指示者が行うものであり、Claude が代行することはない。

## 2. 事前準備

- テスト対象のプラグインは、このリポジトリ（`unified-outliner-public`）の現在のワークツリー（本follow-upの変更を含む、コミット前の変更を含む）からビルドしたものであることを確認する。反映方法は開発指示者が把握している既存の配布・同期手順に従う。
- 実機テスト用の Obsidian vault として、`obsidian/ipad-test` vault（`Users/kazumikaizuka/Obsidian/ipad-test`）の `Test` フォルダを使用する。本ドキュメントの複製もこのフォルダに置いてよい。
- プラグイン設定のうち、CompositeBlock 関連の2つのルール（`image-ocr`・`image-quote`）が有効（既定値どおり ON）になっていることを確認する。無効化されている場合、5節の CompositeBlock 関連ケースの判定に影響するため、既定値に戻すか、無効なままなら該当ケースの結果欄に「未確認（CompositeBlockルール無効）」と記録する。
- 可能であれば、light テーマと dark テーマの少なくとも2種類（Obsidian既定の light/dark で十分）で確認できるようにしておく。
- 実施結果を記録する担当者・端末（機種・OSバージョン・Obsidianバージョン・使用テーマ）を明確にしておく。

## 3. テスト用ノート

以下の Markdown を、`obsidian/ipad-test` vault の `Test` フォルダ内に新規ノートとして作成する。ノート名は `composite-block-visual-grouping-fixture.md` とする。

```markdown
# CompositeBlock視認性検証セクション

## サブセクションA: 通常のlist（CompositeBlockではない）

- 通常のリスト項目1
- 通常のリスト項目2
  - 通常の子リスト項目

## サブセクションB: スタンドアロンのcallout / blockquote（CompositeBlockではない）

> [!note] スタンドアロンコールアウト
> これは独立したコールアウトの本文である。CompositeBlockの一部ではない。

> これはスタンドアロンの引用（blockquote）の1行目である。
> これは2行目である。

## サブセクションC: CompositeBlock候補1（画像+OCRコールアウト、list+callout）

- ![[dummy-image.png]]
> [!note] OCR結果
> これはCompositeBlock（画像+OCRコールアウト）検証用の固定テキストである。

## サブセクションD: CompositeBlock候補2（画像+引用、list+blockquote）

- ![[dummy-image2.png]]
> これはCompositeBlock（画像+引用）検証用の固定テキストである。

## サブセクションE: 通常の段落（現在行比較用）

これは検証用の段落である。CompositeBlockでもcallout/blockquoteでもない、通常の段落として現在行の見分けやすさを比較するために使う。
```

`![[dummy-image.png]]` / `![[dummy-image2.png]]` は実在の画像ファイルでなくてもよい（CompositeBlock候補の判定は Markdown 構造のみに基づくため、リンク先画像の実在有無は無関係である）。既存の Phase 5A-1 受入フィクスチャに実在のダミー画像がある場合はそれを流用してよい。

## 4. 共通の確認方法

- Outline Tree（右サイドバー）で、CompositeBlockの親行・member 行の左端に、縦のアクセントバー（既定では紫〜藤色系、テーマの「Highlighted Node Color」設定に連動）と、行全体を覆う薄い色の背景が表示されることを確認する。
- 同じ左端アクセントバー・背景が、親行から member 行まで連続して見えることを確認する（間に途切れがなく、「ここからここまでが一つのCompositeBlockである」と目で追えること）。
- 通常の list / スタンドアロンの callout・blockquote・段落には、このアクセントバー・背景が一切表示されないことを確認する。
- （2026-09-08 追記）親行（見出し役）・中間member行・終端member行の3段階が、それぞれ異なる強さで見分けられることを確認する。目安は次のとおりである。
  - 親行: 3段階の中で最もアクセントバーが太く、背景も最も濃い。行の上端がわずかに丸みを帯びる。
  - 中間member行: 3段階の中で最も控えめ（細いアクセントバー・最も薄い背景）。通常行の現在行/選択行の背景より強く見えてはならない。
  - 終端member行: 中間member行よりわずかに強めだが、親行ほどではない。行の下端がわずかに丸みを帯び、下端に細い区切り線が入ることで「ここでグループが終わる」と分かる（濃さだけに頼らない終端表現になっている）。

## 5. ケース別テスト

### グループA: list + callout CompositeBlock（サブセクションC）

| 項目 | 内容 |
| --- | --- |
| A-1 目的 | list + callout CompositeBlock が、親行（画像リンク行）から member 行（OCRコールアウト行）まで、左端アクセント + 背景で一体のグループとして識別できることを確認する。 |
| A-1 操作 | サブセクションCのCompositeBlockが折りたたまれていなければそのまま、折りたたまれていれば展開して両方の行を表示する。 |
| A-1 期待結果 | 親行・member 行の両方に左端アクセントバー + 薄い背景が表示され、連続したグループとして見える。親行が3段階のうち最も強い表示（太いアクセントバー・最も濃い背景・上端がわずかに丸い）であり、末尾のmember行（終端）は下端がわずかに丸く、下端に細い区切り線が見える。親行・中間member行・終端member行が、一様な帯ではなく3段階に見分けられる。 |
| A-1 不合格の例 | 親行にしか表示されない／member行にしか表示されない／表示が途切れて見える／親行・中間member行・終端member行の区別がつかず一様な帯にしか見えない。 |

| 項目 | 内容 |
| --- | --- |
| A-2 目的 | CompositeBlockを折りたたんだとき、親行だけでもCompositeBlockであることが（prefix以外の手段でも）識別できることを確認する。 |
| A-2 操作 | サブセクションCのCompositeBlock親行左の折りたたみ矢印をクリックして折りたたむ。 |
| A-2 期待結果 | member行は非表示になるが、親行には引き続き左端アクセント + 背景が表示され続ける。折りたたみ操作自体（矢印の見た目・クリック挙動）はこれまでと変わらない。 |
| A-2 不合格の例 | 折りたたむとアクセント表示が消える／折りたたみ矢印の挙動が変わっている。 |

### グループB: list + blockquote CompositeBlock（サブセクションD）

| 項目 | 内容 |
| --- | --- |
| B-1 目的 | list + blockquote CompositeBlockでも、グループA-1と同じ視覚的グルーピングが機能することを確認する。 |
| B-1 操作 | サブセクションDのCompositeBlockを展開した状態で表示する。 |
| B-1 期待結果 | A-1と同様、親行・member行に連続したアクセント + 背景が表示され、member行（末尾）がより強調される。 |
| B-1 不合格の例 | A-1と同様の不合格パターン。 |

### グループC: 通常のlist / callout / blockquoteの非表示確認

| 項目 | 内容 |
| --- | --- |
| C-1 目的 | 通常のlist（CompositeBlockではない）に、アクセント表示が誤って付かないことを確認する。 |
| C-1 操作 | サブセクションAの通常リスト項目（親・子とも）を表示する。 |
| C-1 期待結果 | いずれの行にも左端アクセント・背景は表示されない。従来どおりの見た目のままである。 |
| C-1 不合格の例 | 通常のリスト項目にアクセントや背景が表示されてしまう。 |

| 項目 | 内容 |
| --- | --- |
| C-2 目的 | スタンドアロンのcallout・blockquote（CompositeBlockの一部ではないもの）に、アクセント表示が誤って付かないことを確認する。 |
| C-2 操作 | サブセクションBのスタンドアロンcallout行・blockquote行を表示する。 |
| C-2 期待結果 | いずれの行にも左端アクセント・背景は表示されない。 |
| C-2 不合格の例 | スタンドアロンのcallout/blockquoteにアクセントや背景が表示されてしまう。 |

### グループD: 現在行との比較

| 項目 | 内容 |
| --- | --- |
| D-1 目的 | CompositeBlockに属する行が現在行になった場合でも、「現在どの行にいるか」が見分けられることを確認する。 |
| D-1 操作 | 本文エディタでカーソルをサブセクションCまたはDのCompositeBlockのmember行（コールアウトまたは引用の本文）に移動する。 |
| D-1 期待結果 | Outline Tree上で、そのCompositeBlock member行が現在行として（Obsidian標準の現在行の見た目で）識別でき、かつCompositeBlockの左端アクセント（ボーダー）も残ったまま見える。現在行になった瞬間、CompositeBlockアクセントの薄い背景は退き（消え）、現在行の背景がCompositeBlockの背景より常に優先して見える。左端アクセントのボーダーだけは引き続き見え、CompositeBlockの一部であることも分かる。 |
| D-1 不合格の例 | 現在行なのかCompositeBlockの一部なのか区別がつかない／現在行の強調が消えてしまう／文字が読みにくくなる／CompositeBlockの背景が現在行の背景より濃く（優先して）見えてしまう。 |

| 項目 | 内容 |
| --- | --- |
| D-2 目的 | 通常の段落（CompositeBlockではない）が現在行になった場合との見た目の違いを比較する。 |
| D-2 操作 | 本文エディタでカーソルをサブセクションEの段落に移動する。 |
| D-2 期待結果 | 現在行としての見た目（Obsidian標準の現在行の強調）はD-1と同様に表示されるが、左端アクセント・薄い背景は表示されない（CompositeBlockではないため）。D-1との違いが明確に見分けられる。 |
| D-2 不合格の例 | 通常の段落にもCompositeBlockのアクセントが表示されてしまう。 |

### グループE: selection・hover・focus・keyboard操作

| 項目 | 内容 |
| --- | --- |
| E-1 目的 | Outline Tree内でキーボード操作（上下キー）によりCompositeBlockの行を選択したとき、既存の選択表示とアクセント表示が両立することを確認する。 |
| E-1 操作 | Outline Treeパネルにフォーカスを移し、上下キーでCompositeBlockの親行・member行を選択する。 |
| E-1 期待結果 | 選択中の行に既存のキーボード選択の背景色（Style Settingsの「Keyboard Selection Background Color」）が表示され、それがCompositeBlockアクセントの背景より優先して（濃く）見える。CompositeBlockの左端アクセント（ボーダー）は選択中も残ったまま見える。 |
| E-1 不合格の例 | 選択表示とアクセントのボーダーのどちらかが消える／選択状態と現在行の区別がつかなくなる／CompositeBlockの背景が選択中の背景より濃く（優先して）見えてしまう。 |

| 項目 | 内容 |
| --- | --- |
| E-2 目的 | CompositeBlock親行をマウスでhoverしたときの、ドラッグハンドル表示等の既存挙動が変わっていないことを確認する。 |
| E-2 操作 | desktopでCompositeBlock親行にマウスカーソルを乗せる。 |
| E-2 期待結果 | 既存どおりドラッグハンドルが表示される（Phase 5D-4Cの仕様どおり）。アクセント表示との重なりで見えなくなったり操作できなくなったりしない。 |
| E-2 不合格の例 | ドラッグハンドルが見えない、または掴めない。 |

### グループF: 既存CompositeBlock機能の非回帰確認（最低限の再確認）

| 項目 | 内容 |
| --- | --- |
| F-1 目的 | CompositeBlockのMoveが、今回のUI-only follow-up後も既存どおり機能することを確認する。 |
| F-1 操作 | `docs/phase5d4a_composite_block_atomic_move_acceptance.md` に記載の既存手順のうち、Tree右クリックメニュー経由で1件（例: Case1）を再現する。 |
| F-1 期待結果 | 既存の受入記録どおりの結果になる（新しい表示によって移動結果やNotice文言に変化がない）。 |
| F-1 不合格の例 | 既存記録と異なる結果になる、または移動自体が機能しない。 |

| 項目 | 内容 |
| --- | --- |
| F-2 目的 | CompositeBlockのドラッグ&ドロップが、今回のUI-only follow-up後も既存どおり機能することを確認する。特に、CompositeBlock親行をドラッグ中／ドロップ先として示すインジケータ（挿入線・グループ内インジケータ）が、新しいアクセント表示と重なっても見分けられることを確認する。 |
| F-2 操作 | CompositeBlock親行を別の位置へドラッグし、ドロップ直前のインジケータ表示を確認したうえで、実際にドロップする。 |
| F-2 期待結果 | ドラッグ中のドロップ位置インジケータ（線・背景強調）が、CompositeBlockの左端アクセントに埋もれず、はっきり見分けられる。ドロップ後の結果は既存どおり正しく反映される。 |
| F-2 不合格の例 | ドロップ位置インジケータが見えにくい、または誤った位置に見える／ドロップ結果が誤る。 |

| 項目 | 内容 |
| --- | --- |
| F-3 目的 | CompositeBlockのDeleteが、今回のUI-only follow-up後も既存どおり機能することを確認する。 |
| F-3 操作 | CompositeBlock親行の右クリックメニューから「Delete extended block」を実行し、確認ダイアログでキャンセルする（実際に削除まで行う必要はない。ダイアログの表示・キャンセル動作のみ確認する）。 |
| F-3 期待結果 | 既存どおりのメニュー項目・確認ダイアログが表示され、キャンセルで何も変化しない。 |
| F-3 不合格の例 | メニュー項目が消えている／ダイアログの挙動が変わっている。 |

| 項目 | 内容 |
| --- | --- |
| F-4 目的 | CompositeBlock member（callout/blockquote）に対する既存の read-only 挙動（rename・drag等が一切できないこと）が変わっていないことを確認する。 |
| F-4 操作 | CompositeBlock member行をダブルクリックする、またはドラッグを試みる。 |
| F-4 期待結果 | 既存どおり何も起きない（renameが開始されない、ドラッグできない）。 |
| F-4 不合格の例 | member行がrenameできてしまう、またはドラッグできてしまう。 |

### グループG: テーマ確認

| 項目 | 内容 |
| --- | --- |
| G-1 目的 | light テーマ・dark テーマの両方で、CompositeBlockのアクセント表示の文字・背景のコントラストが十分に読めることを確認する。 |
| G-1 操作 | Obsidianの外観設定でlightテーマとdarkテーマを切り替え、それぞれでサブセクションC・Dの表示を確認する。 |
| G-1 期待結果 | いずれのテーマでも、CompositeBlockの行のラベルテキストが問題なく読める。アクセントの薄い背景が濃すぎて文字が読みにくい、または薄すぎて何も見えない、ということがない。 |
| G-1 不合格の例 | 一方のテーマで文字が読みにくい、または背景が全く見えない。 |

## 6. 任意確認項目（環境依存、未実施・未確認可）

以下は desktop での確認を妨げないが、開発指示者が利用可能な環境がある場合にのみ、可能な範囲で確認してよい任意項目である。未実施の場合は「未確認」と記録すればよく、必須項目の合否には影響しない。

- iPad等のモバイル実機でのCompositeBlockアクセント表示の見え方
- popoutウィンドウでの同表示の見え方
- スクリーンリーダー等の支援技術での読み上げ（`aria-hidden="true"` を付与した装飾要素であるため、読み上げ内容自体に変化がないことの確認）

## 7. 完了の記録

全ケースの結果（PASS/FAIL/未確認）と、使用した端末・テーマ・Obsidianバージョンを本ドキュメントの複製に追記して記録する。1件でもFAILが発生した場合は、production codeを修正せず、再現手順のみをClaudeへ報告することとする。
