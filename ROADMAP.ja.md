# Unified Outliner ロードマップ

Unified Outliner は、単一のMarkdownノート内で意味のまとまりを安全に構造編集することへ集中する。Obsidian本体の機能を重複させるのではなく、ブロックの再配置・閲覧・再編集を強化する機能を優先する。

## 現在のリリース

バージョン0.4.0では、構造単位の移動・レベル変更コマンド（セクション全体の移動、段落・callout・blockquote・fenced code block・tableにも及ぶ最小安全ブロック移動を含む）、削除・挿入コマンド、Outline Tree Viewからの閲覧・編集、インラインリネーム、モバイルのタップ／長押し操作、パンくずナビゲーションとSubtree Navigator、ポップアウトウィンドウ対応を備えたsectionおよびlist subtree用のPartial Edit Pane、mixed structure境界規則、競合解決を伴うファイル単位のfold state永続化を提供する。

これに加え、blockquote・callout・fenced code block（Mermaidを含む）・tableを含む7種のブロック境界モデルを確立し、Outline Tree上でこれらのCompositeBlockを読み取り専用ノードとして投影する機能（Phase 5D-0.3）、設定タブの「General」「Composite blocks」への再編、見出しレベルを示す任意のバッジ表示設定、iPad上でのドラッグ操作を専用ハンドルと標準HTML5 Drag & Dropに分離した改善（UXP-01）、モバイルの長押しメニューが複数同時に開いてしまう不具合の修正（UXP-02）を実装した。

## 次の重点領域: Phase 5C-1 / Phase 5D

- **CompositeBlockの編集対応**: 現在は読み取り専用で投影されているblockquote・callout・fenced code block・tableについて、Outline Tree上での移動・追加・削除を、種別ごとの安全な書き戻し規則（空行・`>`プレフィックス・code fence・list markerの補完）に基づいて解禁する（Phase 5C-1）。
- **境界判定できない構造の安全な保護**: 追加・削除の境界が確定できないブロックや未対応の入れ子構造では、編集を拒否して原文を保護する方針を維持する。
- **ホイスト相当の編集の継続検証**: 選択したsectionまたはlist subtreeを、そこだけに集中できる編集文脈として開く機能の安全性・回帰試験を継続する。

## その後の方向性

- ノード単位のリンク・埋め込みプレビュー。
- ノード内のリンクと添付ファイルの一覧。
- sectionまたはlist subtree単位でのCanvas連携。
- ステータスやタグなどの局所メタデータ。
- ノート横断のブロック分類・検索（Phase 6: BlockIndexによるYAML継承・inline property統合）。
- 構造図とダイアログによる編集（Phase 7）。

## 意図的に対象外とするもの

Unified Outlinerは、汎用全文検索、タスク管理、Dataview型の集計、AIによる書き換えを置き換えることを目指さない。Markdownノートの信頼できる構造編集に集中する。
