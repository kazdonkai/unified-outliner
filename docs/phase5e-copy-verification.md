# Phase 5E-Copy 実機受入確認ノート（Mac／iPad）

状態: **実装完了・ユーザー実機確認待ち**。実機確認の担当者は開発者（ユーザー）である。設計は `docs/phase5e-copy_block-copy-design-memo.md` を参照すること。

## 1. デプロイ手順（ターミナルで実行する）

リポジトリで `npm run build` 済みの `main.js`／`manifest.json`／`styles.css` を各 vault のプラグインフォルダへコピーする。`data.json` はコピーしない。

```bash
# Mac（Method vault）
cp /Users/kazumikaizuka/Obsidian/unified-outliner-public/main.js \
   /Users/kazumikaizuka/Obsidian/unified-outliner-public/manifest.json \
   /Users/kazumikaizuka/Obsidian/unified-outliner-public/styles.css \
   ~/Obsidian/Method/.obsidian/plugins/unified-outliner/

# iPad（ipad-test vault。Obsidian Sync で iPad へ同期される）
cp /Users/kazumikaizuka/Obsidian/unified-outliner-public/main.js \
   /Users/kazumikaizuka/Obsidian/unified-outliner-public/manifest.json \
   /Users/kazumikaizuka/Obsidian/unified-outliner-public/styles.css \
   /Users/kazumikaizuka/Obsidian/ipad-test/.obsidian/plugins/unified-outliner/
```

コピー後、Community plugins で Unified Outliner をオフ→オンにして再読み込みする（iPad は同期完了後に同じ操作を行う）。

## 2. 事前準備

- フィクスチャ: `ipad-test/Test/block-copy-verification.md`（Mac の Method vault で確認する場合は同じ内容のノートを任意の場所に複製して使う）。
- 設定で次を ON にする: Outline Tree にリスト項目を表示／段落を表示／fenced code block を表示／table を表示。
- 各項目の確認後は Ctrl/Cmd+Z で元に戻し、次の項目へ進む（Undo の確認を兼ねる）。

## 3. 確認項目

結果欄には Pass／Fail／Not tested のいずれかを記入し、気づいた点をメモ欄に書く。

| # | 操作 | 期待結果 | Mac | iPad | メモ |
| --- | --- | --- | --- | --- | --- |
| 1 | 「## A. Section to duplicate」の行で Duplicate below | A セクション全体（A-1 を含む）が直後に複製され、本文にも Tree にも 2 つ並ぶ | Not tested | Not tested | |
| 2 | 1 の後、原本 A の本文を編集する | 複製側は変化しない | Not tested | Not tested | |
| 3 | 1 の後、Cmd/Ctrl+Z を 1 回 | 複製がまるごと消え、ノートが元どおりになる（1 回で戻る） | Not tested | Not tested | |
| 4 | 「- Parent item」で Duplicate below | 子・孫を含む部分木が「- Sibling item」の前に複製される。空行は入らない | Not tested | Not tested | |
| 5 | 「2. Second」で Duplicate below | 「2. Second」が 2 行並ぶ。「3. Third」を含む既存行の番号は変わらない | Not tested | Not tested | |
| 6 | callout／blockquote／fenced code／table／段落の各行で Duplicate below | それぞれ直後に複製され、前後に空行が入って別ブロックとして Tree に表示される | Not tested | Not tested | |
| 7 | callout の行で Copy block | Tree 上部に「コピー中: …」のバナーが出て、callout の行に破線枠が付く。Notice が出る | Not tested | Not tested | |
| 8 | 7 の後、「## E. Paste destination」の行で Paste block | callout が E セクションの末尾（Destination paragraph の後）に空行付きで挿入され、バナーと破線枠が消える | Not tested | Not tested | |
| 9 | 7 の後、「Plain paragraph two.」の行で Paste block above | 段落の前に挿入される | Not tested | Not tested | |
| 10 | 「## A…」で Copy block → 「### A-1 Child section」の行でメニューを開く | Paste 項目が「— unavailable」表示になり、クリックすると「ブロックをそれ自身の内部に貼り付けることはできない」旨の Notice が出る。本文は変わらない | Not tested | Not tested | |
| 11 | 「## A…」で Copy block → 「## E…」で Paste block as child | A が E の子（### A、#### A-1）として E の末尾に挿入される | Not tested | Not tested | |
| 12 | 「- Sibling item」で Copy block → 「- Parent item」で Paste block as child | 「- Sibling item」が Parent item の最後の子として 2 スペースインデントで挿入される | Not tested | Not tested | |
| 13 | 段落で Copy block → D の CompositeBlock のメンバー callout 行（▣ OCR）でメニューを開く | 「Paste block above」は unavailable（アンカー項目と callout の間への割り込み拒否。クリックで理由の Notice）。「Paste block」は CompositeBlock の直後に挿入でき、CompositeBlock（◉ 行）は壊れない。CompositeBlock の親行（◉ 行）でも Paste block／above が使える | Not tested | Not tested | |
| 14 | Copy block 中に Escape（Mac）／バナーの ×（iPad） | コピー待機状態が解除され、バナーと破線枠が消え、「解除した」Notice が出る | Not tested | Not tested | |
| 15 | Copy block 中に行の右クリックメニューを開き、Escape でメニューを閉じる（Mac） | メニューだけが閉じ、コピー待機状態は維持される | Not tested | Not tested | |
| 16 | Copy block 中に別のノートを開く | バナーに「別のノートからのコピー」と表示され、Paste 項目は unavailable（クリックで理由の Notice） | Not tested | Not tested | |
| 17 | Copy block 後、コピー元の本文を編集してから Paste block | 「コピー元が変更された」Notice が出て何も貼り付けられず、待機状態が解除される | Not tested | Not tested | |
| 18 | コマンドパレット: カーソルを callout 内に置いて「Copy block」→ E の見出し行で「Paste block」 | Tree メニューと同じ結果になる | Not tested | Not tested | |
| 19 | コマンドパレット: 見出し行で「Duplicate below」／「Cancel block copy」 | 複製される／待機中なら解除、そうでなければ「貼り付け待ちのブロックがない」Notice | Not tested | Not tested | |
| 20 | 回帰: 既存の D&D（セクション・リスト・callout・段落）、折りたたみ、Partial Edit Pane、改名 | 従来どおり動作する。折りたたんだセクションを Duplicate below しても原本は折りたたまれたまま | Not tested | Not tested | |

## 4. 完了判定基準

- 上表の全項目が Mac・iPad の双方で Pass であること（iPad で物理キーボードがない場合、#14 はバナーの × で確認し、#15 は Not applicable としてよい）。
- 本文が意図せず変化した・Undo 1 回で戻らない・Tree が崩れる、のいずれかが 1 件でもあれば Fail とし、再現手順をメモ欄に残す。
- 開発者が全項目 Pass を報告した時点で、Phase 5E-Copy を「完了」として記録する。
