# Partial Edit Pane：Block ID フィールド — 実機受入確認ノート（Mac／iPad）

状態: **完了**（2026-09-25、開発者が全項目 Pass を確認した。ミラー参照の自動更新と警告の追加修正 #23〜#29 を含む）。実機確認の担当者は開発者（ユーザー）である。設計は `docs/partial-edit-block-id-field-design-memo.md` を参照すること。

## 1. デプロイ手順（ターミナルで実行する）

```bash
# Mac（Method vault）
cp /Users/kazumikaizuka/Obsidian/unified-outliner-public/{main.js,manifest.json,styles.css} ~/Obsidian/Method/.obsidian/plugins/unified-outliner/
# iPad（ipad-test vault。Obsidian Sync で同期される）
cp /Users/kazumikaizuka/Obsidian/unified-outliner-public/{main.js,manifest.json,styles.css} /Users/kazumikaizuka/Obsidian/ipad-test/.obsidian/plugins/unified-outliner/
```

コピー後、Community plugins で Unified Outliner をオフ→オンにして再読み込みする（`data.json` はコピーしない）。

## 2. 事前準備

- フィクスチャ: `ipad-test/Test/block-id-field-verification.md` と、他ファイル参照用の `ipad-test/Test/block-id-cross-ref.md`（`^code-id` を別ノートから埋め込む）
- 設定で ON にする: 本文段落も Outline Tree に表示する、アウトラインツリーにコードブロックを表示、アウトラインツリーに表を表示、アウトラインツリーにミラー（埋め込み）を表示。
- 各項目の後は Cmd/Ctrl+Z で元に戻す（または確認後にフィクスチャを元に戻す）。
- 注意: 各ブロックは、そのブロック自身の Tree 行から開くこと。見出し行（例:「## Table」）から開くとセクション全体の編集になり、セクションは Block ID フィールドの対象外なので、`^id` 行も本文の一部としてそのまま表示される（仕様どおり）。

## 3. 確認項目

| # | 操作 | 期待結果 | Mac | iPad | メモ |
| --- | --- | --- | --- | --- | --- |
| 1 | 「Inline id paragraph. ^para-inline」を段落を編集…で開く | 本文エリアは「Inline id paragraph.」だけで `^para-inline` を含まない。下に「Block ID: para-inline」の行が出る | Pass | Pass | |
| 2 | #1 で本文だけを変えて Apply | ノートの行末の ` ^para-inline` はそのまま残る | Pass | Pass | |
| 3 | #1 で Block ID を `para-inline-2` に変えて Apply | ノートの行末が ` ^para-inline-2` になる。本文は変わらない。同じノートの `![[#^para-inline]]` も `![[#^para-inline-2]]` に自動で書き換わり、「同一ファイル内の 1 件のミラー参照を自動更新しました。」の Notice が出る（下記 #23） | Pass | Pass | |
| 4 | #3 の直後に Cmd/Ctrl+Z を 1 回 | ブロックの ID と埋め込み行の両方が元に戻る（1 回で戻る） | Pass | Pass | |
| 5 | 「Standalone id paragraph.」を開く | 本文エリアに ID はなく、Block ID に `para-lone` が出る | Pass | Pass | |
| 6 | #5 で Block ID を空にして Apply | `^para-lone` の行と、その前の空行が消える。次の段落との間の空行は残る | Pass | Pass | |
| 7 | 「Paragraph without id.」を開く | Block ID の行が表示されない | Pass | Pass | |
| 8 | 「Callout with id」（Create mirror 済みの形：callout、空行、`^callout-id`）を Open in Partial Edit | 本文エディタに `^callout-id` が出ず、Block ID に `callout-id` が出る | Pass | Pass | |
| 9 | #8 で callout の本文を変えて Apply | callout の後の空行と `^callout-id` 行はそのまま残る。「Mirror: ^callout-id」は引き続き解決される | Pass | Pass | |
| 10 | #8 で Block ID を `callout-id-2` に変えて Apply | 独立行が `^callout-id-2` になり、前の空行は保たれる | Pass | Pass | |
| 11 | 「Callout without id」を開く | Block ID の行が表示されない | Pass | Pass | |
| 12 | 「quote with inline id ^quote-inline」の blockquote を開く | 本文に `^quote-inline` が出ず、Block ID に `quote-inline` が出る。本文を変えて Apply しても行末の ID は残る | Pass | Pass | |
| 13 | Tree の「js: console.log("x");」行（コードブロックの行。見出し「## Code」の行ではない）→ Open in Partial Edit | 本文に ID が出ず、Block ID に `code-id` が出る。Block ID を変えて Apply すると、閉じフェンスの後の独立行が更新される | Pass | Pass | |
| 14 | Tree の「テーブル: a / b」行（表の行。見出し「## Table」の行ではない）→ Open in Partial Edit で開き、Raw タブと Table タブを見る | どちらにも `^table-id` が出ない。Block ID に `table-id` が出る | Pass | Pass | |
| 15 | #14 で Block ID を空にして Apply | `^table-id` の行と、その前の空行が消える | Pass | Pass | |
| 16 | 任意の ID 付きブロックで、Block ID に `a b` と入れて Apply | 「英数字とハイフンだけ」の旨の Notice が出て、ノートは変わらない | Pass | Pass | |
| 17 | 任意の ID 付きブロックで、Block ID だけを変える | Apply／Cancel が有効になる（dirty）。Cancel で元の ID に戻る | Pass | Pass | |
| 18 | 未編集のペインを開いたまま、本文エディタで直接その ID を書き換える | ペインの Block ID が新しい ID に自動で更新される | Pass | Pass | |
| 19 | #18 と同じことを、ペインの本文を編集中（未保存）に行う | ペインが「古い（stale）」表示になり、Apply は拒否される | Pass | Pass | |
| 20 | 「Inline id paragraph.」を開いた状態で、ペイン最下部を見る | 「このブロックを参照しているミラー: 1 件」が引き続き出る | Pass | Pass | |
| 21 | 回帰: セクション・リスト項目・拡張ブロックを開く | Block ID の行は出ない。従来どおり編集できる | Pass | Pass | |
| 22 | 回帰: Outline Tree で「Inline id paragraph. ^para-inline」をリネームする | 従来どおり全文（ID を含む）でリネームできる | Pass | Pass | |

### 追加修正：ミラー参照の自動更新と警告

| # | 操作 | 期待結果 | Mac | iPad | メモ |
| --- | --- | --- | --- | --- | --- |
| 23 | 「Callout with id」を開き、Block ID を `callout-id-2` に変えて Apply | callout 後の独立行が `^callout-id-2` になり、`## Mirrors` の `![[#^callout-id]]` も `![[#^callout-id-2]]` に書き換わる。「同一ファイル内の 1 件のミラー参照を自動更新しました。」の Notice が出る。Tree の「Mirror: ^callout-id-2」は解決されたまま | Pass | Pass | |
| 24 | #23 の直後に Cmd/Ctrl+Z を 1 回 | ID の行と埋め込み行の両方が 1 回で元に戻る | Pass | Pass | |
| 25 | fenced code（`^code-id`。`block-id-cross-ref.md` から参照されている）の Block ID を `code-id-2` に変えて Apply | Apply は行われ、「他のファイルから参照されています…」の警告 Notice が出る。`block-id-cross-ref.md` は変更されない | Pass | Pass | |
| 26 | fenced code の Block ID を空にして Apply | ID が削除され、「他のファイルから参照されています。Block ID を削除したため…」の警告 Notice が出る | Pass | Pass | |
| 27 | 「Inline id paragraph.」の Block ID を空にして Apply | ID が削除され、同じノートの `![[#^para-inline]]` は書き換わらずに残る。「同じファイル内から参照されています。Block ID を削除したため、それらの参照が壊れています。」の警告 Notice が出る | Pass | Pass | |
| 28 | 参照のない ID（`^table-id`）を変更して Apply | 自動更新・警告の Notice はどちらも出ない | Pass | Pass | |
| 29 | Block ID を変えずに本文だけを変えて Apply | 自動更新・警告の Notice は出ず、埋め込み行も変わらない | Pass | Pass | |

## 4. 完了判定基準

- 上表の全項目が Mac・iPad の双方で Pass であること。
- ID を変更・削除していないのに ID が変化した、本文を変えていないのに本文が変化した、Undo 1 回で戻らない、のいずれかが 1 件でもあれば Fail とし、再現手順をメモ欄に残す。
