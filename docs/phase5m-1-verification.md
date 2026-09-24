# Phase 5M-1 実機受入確認ノート（Mac／iPad）

状態: **実装完了・ユーザー実機確認待ち**。実機確認の担当者は開発者（ユーザー）である。設計は `docs/phase5m-1_mirror-create-design-memo.md` を参照すること。

## 1. デプロイ手順（ターミナルで実行する）

リポジトリで `npm run build` 済みの `main.js`／`manifest.json`／`styles.css` を各 vault のプラグインフォルダへコピーする（`data.json` はコピーしない）。

```bash
# Mac（Method vault）
cp /Users/kazumikaizuka/Obsidian/unified-outliner-public/{main.js,manifest.json,styles.css} ~/Obsidian/Method/.obsidian/plugins/unified-outliner/
# iPad（ipad-test vault。Obsidian Sync で同期される）
cp /Users/kazumikaizuka/Obsidian/unified-outliner-public/{main.js,manifest.json,styles.css} /Users/kazumikaizuka/Obsidian/ipad-test/.obsidian/plugins/unified-outliner/
```

コピー後、Community plugins で Unified Outliner をオフ→オンにして再読み込みする。

## 2. 事前準備

- フィクスチャ: `ipad-test/Test/mirror-create-verification.md`
- 設定で次を ON にする: Outline Tree にリスト項目・段落・fenced code block・表・ミラー（Show mirror embeds in Outline Tree）を表示。
- 各項目の確認後は Cmd/Ctrl+Z で元に戻す（#11 の Undo 確認を兼ねる）。

## 3. 確認項目

結果欄には Pass／Fail／Not tested のいずれかを記入し、気づいた点をメモ欄に書く。

| # | 操作 | 期待結果 | Mac | iPad | メモ |
| --- | --- | --- | --- | --- | --- |
| 1 | 「## Target heading」行 → Create mirror above | 見出し行の直上に `![[#Target heading]]` が入り、Tree に「⧉ Mirror: Target heading」行が出る。行をクリックすると見出しへ移動する | Not tested | Not tested | |
| 2 | 「A plain paragraph without an id.」行 → Create mirror below | 段落末尾に ` ^uo-xxxxxxxx` が付き、空行を挟んで `![[#^uo-xxxxxxxx]]` が入る。Notice に付与した ID が出る | Not tested | Not tested | |
| 3 | 「…already has an id. ^existing-para」行 → Create mirror below | ID は追加されず `![[#^existing-para]]` だけが入る | Not tested | Not tested | |
| 4 | callout 行 → Create mirror below | callout の後に空行・`^uo-…` 行・空行・埋め込み行が入り、Mirror 行が出る。クリックで callout へ移動する | Not tested | Not tested | |
| 5 | blockquote 行 → Create mirror below | #4 と同じ形で入る | Not tested | Not tested | |
| 6 | fenced code 行 → Create mirror below | コードブロックの後に `^uo-…` 行と埋め込みが入り、コードブロック自体は変わらない | Not tested | Not tested | |
| 7 | table 行 → Create mirror below | 表の後に空行・`^uo-…` 行・埋め込みが入り、表は崩れない | Not tested | Not tested | |
| 8 | 「- First item」行 → Create mirror below | `- First item ^uo-…` となり、埋め込みは「- Second item」の後（リスト全体の後）に空行付きで入る。リストは割れない | Not tested | Not tested | |
| 9 | 「- Child item」行 → Create mirror below | ID は子項目の行に付き、埋め込みはリスト全体の後に入る | Not tested | Not tested | |
| 10 | 「- Second item ^existing-li」行 → Create mirror below | ID は追加されず `![[#^existing-li]]` が入る | Not tested | Not tested | |
| 11 | #2 の直後に Cmd/Ctrl+Z を 1 回 | 付与した ID と埋め込み行が同時に消え、完全に元に戻る | Not tested | Not tested | |
| 12 | 1 つ目の「### Same name」行 → Create mirror above | 挿入されるが、「同じテキストの見出しが複数あるため最初の見出しを表示する」警告の Notice が出る。2 つ目の「### Same name」で実行すると、埋め込みが 1 つ目のセクション内に入ってそれ自身を参照するため、循環として拒否される（unavailable 表示） | Not tested | Not tested | |
| 13 | 「## Cycle A」行 → Create mirror above | 循環参照になる旨の Notice が出て、本文は変わらない（メニュー項目自体が unavailable 表示になっていてもよい） | Not tested | Not tested | |
| 14 | 「## Composite」の CompositeBlock 行（◉）とメンバー行を右クリック | Create mirror の項目が出ない | Not tested | Not tested | |
| 15 | 既存の Mirror 行（「Mirror: Cycle B」）を右クリック | メニューが出ない（読み取り専用のまま） | Not tested | Not tested | |
| 16 | 設定「Show mirror embeds」を OFF にし、`![[#Cycle B]]` の段落行 → Create mirror below | unavailable 表示で、クリックすると「すでにミラーの埋め込みである」旨の Notice が出る | Not tested | Not tested | |
| 17 | コマンドパレット: カーソルを「A plain paragraph…」に置き「Create mirror: insert embed below cursor block」 | #2 と同じ結果になる | Not tested | Not tested | |
| 18 | コマンドパレット: カーソルを「## Target heading」の見出し行に置いて同コマンド | #1 と同じく見出しの直上に挿入される | Not tested | Not tested | |
| 19 | 設定「Show mirror embeds」OFF で #2 を実行 | 挿入は同じように行われ、Tree では段落行として表示される | Not tested | Not tested | |
| 20 | 任意の行で Copy block（コピー待機中）→ 別の行で Create mirror below | ミラーは作成され、コピー待機のバナーと破線枠はそのまま残る。その後の Paste block も正常に動く | Not tested | Not tested | |
| 21 | iPad: 段落行を長押し | メニューに「下にミラーを作成」（日本語 UI の場合）が出て、#2 と同じ結果になる | Not tested | Not tested | |
| 22 | 回帰: D&D・Copy／Paste・Partial Edit・折りたたみ | 従来どおり動作する | Not tested | Not tested | |

## 4. 完了判定基準

- 上表の全項目が Mac・iPad の双方で Pass であること。iPad でキーボードがない場合、Undo は Obsidian の Undo ボタンで確認してよい。#21 は iPad のみの項目である。
- 本文が意図せず変化した・Undo 1 回で戻らない・リストや表が崩れた・既存のブロック ID が書き換わった、のいずれかが 1 件でもあれば Fail とし、再現手順をメモ欄に残す。
- 開発者が全項目 Pass を報告した時点で、Phase 5M-1 を「完了」として記録する。
