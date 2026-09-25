# Phase 5M-2 実機受入確認ノート（Mac／iPad）

状態: **実装完了・ユーザー実機確認待ち**。実機確認の担当者は開発者（ユーザー）である。設計は `docs/phase5m-2_mirror-ops-design-memo.md` を参照すること。

## 1. デプロイ手順（ターミナルで実行する）

```bash
# Mac（Method vault）
cp /Users/kazumikaizuka/Obsidian/unified-outliner-public/{main.js,manifest.json,styles.css} ~/Obsidian/Method/.obsidian/plugins/unified-outliner/
# iPad（ipad-test vault。Obsidian Sync で同期される）
cp /Users/kazumikaizuka/Obsidian/unified-outliner-public/{main.js,manifest.json,styles.css} /Users/kazumikaizuka/Obsidian/ipad-test/.obsidian/plugins/unified-outliner/
```

コピー後、Community plugins で Unified Outliner をオフ→オンにして再読み込みする（`data.json` はコピーしない）。

## 2. 事前準備

- フィクスチャ: `ipad-test/Test/mirror-ops-verification.md`
- 設定で ON にする: Show mirror embeds in Outline Tree、Show paragraphs、Show list items。
- 各項目の後は Cmd/Ctrl+Z で元に戻す。

## 3. 確認項目

| # | 操作 | 期待結果 | Mac | iPad | メモ |
| --- | --- | --- | --- | --- | --- |
| 1 | 「## Mirrors」内の最初の「Mirror: Source A」行を右クリック（iPad は長押し） | メニューに「Move mirror up」「Move mirror down」「Delete mirror」だけが出る（リネーム・Partial Edit・Copy block などは出ない） | Not tested | Not tested | |
| 2 | 同じ行で Delete mirror | 確認ダイアログ（題「ミラーを削除」、参照先は変更しない旨の一文）が出る | Not tested | Not tested | |
| 3 | #2 で Delete を押す | 埋め込み行 1 行だけが消え、「## Source A」の見出しと本文は変わらない | Not tested | Not tested | |
| 4 | #3 の直後に Cmd/Ctrl+Z を 1 回 | 埋め込み行が元の位置に戻る | Not tested | Not tested | |
| 5 | #2 で Cancel を押す／ダイアログを閉じる | 何も変わらない | Not tested | Not tested | |
| 6 | 「Mirror: ^src-para」を Delete mirror | 埋め込み行だけが消え、参照先の段落の行末 `^src-para` は残る | Not tested | Not tested | |
| 7 | 「Mirror: ^src-callout」を Delete mirror | 埋め込み行だけが消え、callout 直後の単独行 `^src-callout` は残る | Not tested | Not tested | |
| 8 | 空行が多い位置の「Mirror: Source A」（Blank-run セクション）を Delete mirror | 前後の連続空行が 1 行にまとめられ（ノートの先頭・末尾なら 0 行）、それ以外は変わらない | Not tested | Not tested | |
| 9 | 「Mirror: ^src-para」行で Move mirror up | 直前の段落と入れ替わる（間の空行は保たれる）。Tree の選択がミラー行に追従する | Not tested | Not tested | |
| 10 | 同じ行で Move mirror down | 直後のブロックと入れ替わる | Not tested | Not tested | |
| 11 | 「## Blank-run」内の「Mirror: Source A」（セクション先頭のブロック）の Move mirror up | unavailable 表示になり、クリックすると理由の Notice が出る。本文は変わらない | Not tested | Not tested | |
| 12 | 「## Mirrors」内の最後の「Mirror: Source A」（セクション末尾のブロック）の Move mirror down | unavailable 表示（セクションを越えない） | Not tested | Not tested | |
| 13 | ミラー行をドラッグしようとする（Mac はマウス、iPad はハンドル） | ドラッグできない（ハンドルも出ない） | Not tested | Not tested | |
| 14 | ミラー行をダブルクリック／選択して F2 | リネームにならない | Not tested | Not tested | |
| 15 | 「## Source A」行 → Open in Partial Edit | ペイン最下部に「このブロックを参照しているミラー: 3 件」が出る | Not tested | Not tested | |
| 16 | #15 のリンクをクリックする（繰り返す） | 元ノートのカーソルとスクロールが 1 件目のミラー行へ、次のクリックで 2 件目へ…と移り、最後の次は 1 件目に戻る | Not tested | Not tested | |
| 17 | #15 のペインを開いたまま、本文で `![[#Source A]]` を 1 行追加する／1 行消す | 件数が自動で増減する。ペインの Apply ボタンの状態（dirty 表示）は変わらない | Not tested | Not tested | |
| 18 | ペインで本文を編集して未保存（dirty）のまま、リンクをクリックする | カーソルは移動するが、ペインの下書きは失われず、Apply もそのまま可能 | Not tested | Not tested | |
| 19 | ミラーが 1 件もないブロック（「## No mirrors」）を Partial Edit で開く | リンク行が表示されない | Not tested | Not tested | |
| 20 | 段落「Paragraph source text. ^src-para」を Partial Edit で開く | 「…参照しているミラー: 1 件」が出る | Not tested | Not tested | |
| 21 | Copy block でコピー待機中に、ミラー行の Delete／Move を行う | ミラーの操作は正常に行われ、コピー待機のバナーと破線枠はそのまま残る | Not tested | Not tested | |
| 22 | 設定「Show mirror embeds」を OFF にする | 埋め込み行は段落行に戻り、段落用のメニューが従来どおり出る（ミラー用メニューは出ない） | Not tested | Not tested | |
| 23 | 回帰: callout／blockquote／fenced code／table の Move・Delete、段落の Move、Copy／Paste、Create mirror | 従来どおり動作する | Not tested | Not tested | |

## 4. 完了判定基準

- 上表の全項目が Mac・iPad の双方で Pass であること。#13 は iPad ではハンドルが出ないことで確認する。#14 の F2 はキーボード操作ができる場合に限る。
- 以下のいずれかが 1 件でもあれば Fail とし、再現手順をメモ欄に残す。
  - 参照先の見出し・本文・ブロック ID が変化した。
  - Undo 1 回で戻らない。
  - ペインの下書きや dirty 表示が参照ミラー表示の更新によって変化した。
  - ミラー行がセクションを越えて移動した。
- 開発者が全項目 Pass を報告した時点で、Phase 5M-2 を「完了」として記録する。
