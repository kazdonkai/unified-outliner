# Partial Edit Pane：Block ID フィールド — 実機受入確認ノート（Mac／iPad）

状態: **実装完了・ユーザー実機確認待ち**。実機確認の担当者は開発者（ユーザー）である。設計は `docs/partial-edit-block-id-field-design-memo.md` を参照すること。

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

## 3. 確認項目

| # | 操作 | 期待結果 | Mac | iPad | メモ |
| --- | --- | --- | --- | --- | --- |
| 1 | 「Inline id paragraph. ^para-inline」を段落を編集…で開く | 本文エリアは「Inline id paragraph.」だけで `^para-inline` を含まない。下に「Block ID: para-inline」の行が出る | Not tested | Not tested | |
| 2 | #1 で本文だけを変えて Apply | ノートの行末の ` ^para-inline` はそのまま残る | Not tested | Not tested | |
| 3 | #1 で Block ID を `para-inline-2` に変えて Apply | ノートの行末が ` ^para-inline-2` になる。本文は変わらない。同じノートの `![[#^para-inline]]` も `![[#^para-inline-2]]` に自動で書き換わり、「同一ファイル内の 1 件のミラー参照を自動更新しました。」の Notice が出る（下記 #23） | Not tested | Not tested | |
| 4 | #3 の直後に Cmd/Ctrl+Z を 1 回 | ブロックの ID と埋め込み行の両方が元に戻る（1 回で戻る） | Not tested | Not tested | |
| 5 | 「Standalone id paragraph.」を開く | 本文エリアに ID はなく、Block ID に `para-lone` が出る | Not tested | Not tested | |
| 6 | #5 で Block ID を空にして Apply | `^para-lone` の行と、その前の空行が消える。次の段落との間の空行は残る | Not tested | Not tested | |
| 7 | 「Paragraph without id.」を開く | Block ID の行が表示されない | Not tested | Not tested | |
| 8 | 「Callout with id」（Create mirror 済みの形：callout、空行、`^callout-id`）を Open in Partial Edit | 本文エディタに `^callout-id` が出ず、Block ID に `callout-id` が出る | Not tested | Not tested | |
| 9 | #8 で callout の本文を変えて Apply | callout の後の空行と `^callout-id` 行はそのまま残る。「Mirror: ^callout-id」は引き続き解決される | Not tested | Not tested | |
| 10 | #8 で Block ID を `callout-id-2` に変えて Apply | 独立行が `^callout-id-2` になり、前の空行は保たれる | Not tested | Not tested | |
| 11 | 「Callout without id」を開く | Block ID の行が表示されない | Not tested | Not tested | |
| 12 | 「quote with inline id ^quote-inline」の blockquote を開く | 本文に `^quote-inline` が出ず、Block ID に `quote-inline` が出る。本文を変えて Apply しても行末の ID は残る | Not tested | Not tested | |
| 13 | fenced code（`^code-id` 付き）を開く | 本文に ID が出ず、Block ID に `code-id` が出る。Block ID を変えて Apply すると、閉じフェンスの後の独立行が更新される | Not tested | Not tested | |
| 14 | table（`^table-id` 付き）を開き、Raw タブと Table タブを見る | どちらにも `^table-id` が出ない。Block ID に `table-id` が出る | Not tested | Not tested | |
| 15 | #14 で Block ID を空にして Apply | `^table-id` の行と、その前の空行が消える | Not tested | Not tested | |
| 16 | 任意の ID 付きブロックで、Block ID に `a b` と入れて Apply | 「英数字とハイフンだけ」の旨の Notice が出て、ノートは変わらない | Not tested | Not tested | |
| 17 | 任意の ID 付きブロックで、Block ID だけを変える | Apply／Cancel が有効になる（dirty）。Cancel で元の ID に戻る | Not tested | Not tested | |
| 18 | 未編集のペインを開いたまま、本文エディタで直接その ID を書き換える | ペインの Block ID が新しい ID に自動で更新される | Not tested | Not tested | |
| 19 | #18 と同じことを、ペインの本文を編集中（未保存）に行う | ペインが「古い（stale）」表示になり、Apply は拒否される | Not tested | Not tested | |
| 20 | 「Inline id paragraph.」を開いた状態で、ペイン最下部を見る | 「このブロックを参照しているミラー: 1 件」が引き続き出る | Not tested | Not tested | |
| 21 | 回帰: セクション・リスト項目・拡張ブロックを開く | Block ID の行は出ない。従来どおり編集できる | Not tested | Not tested | |
| 22 | 回帰: Outline Tree で「Inline id paragraph. ^para-inline」をリネームする | 従来どおり全文（ID を含む）でリネームできる | Not tested | Not tested | |

### 追加修正：ミラー参照の自動更新と警告

| # | 操作 | 期待結果 | Mac | iPad | メモ |
| --- | --- | --- | --- | --- | --- |
| 23 | 「Callout with id」を開き、Block ID を `callout-id-2` に変えて Apply | callout 後の独立行が `^callout-id-2` になり、`## Mirrors` の `![[#^callout-id]]` も `![[#^callout-id-2]]` に書き換わる。「同一ファイル内の 1 件のミラー参照を自動更新しました。」の Notice が出る。Tree の「Mirror: ^callout-id-2」は解決されたまま | Not tested | Not tested | |
| 24 | #23 の直後に Cmd/Ctrl+Z を 1 回 | ID の行と埋め込み行の両方が 1 回で元に戻る | Not tested | Not tested | |
| 25 | fenced code（`^code-id`。`block-id-cross-ref.md` から参照されている）の Block ID を `code-id-2` に変えて Apply | Apply は行われ、「他のファイルから参照されています…」の警告 Notice が出る。`block-id-cross-ref.md` は変更されない | Not tested | Not tested | |
| 26 | fenced code の Block ID を空にして Apply | ID が削除され、「他のファイルから参照されています。Block ID を削除したため…」の警告 Notice が出る | Not tested | Not tested | |
| 27 | 「Inline id paragraph.」の Block ID を空にして Apply | ID が削除され、同じノートの `![[#^para-inline]]` は書き換わらずに残る。「同じファイル内から参照されています。Block ID を削除したため、それらの参照が壊れています。」の警告 Notice が出る | Not tested | Not tested | |
| 28 | 参照のない ID（`^table-id`）を変更して Apply | 自動更新・警告の Notice はどちらも出ない | Not tested | Not tested | |
| 29 | Block ID を変えずに本文だけを変えて Apply | 自動更新・警告の Notice は出ず、埋め込み行も変わらない | Not tested | Not tested | |

## 4. 完了判定基準

- 上表の全項目が Mac・iPad の双方で Pass であること。
- ID を変更・削除していないのに ID が変化した、本文を変えていないのに本文が変化した、Undo 1 回で戻らない、のいずれかが 1 件でもあれば Fail とし、再現手順をメモ欄に残す。
