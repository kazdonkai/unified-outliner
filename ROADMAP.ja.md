# Unified Outliner ロードマップ

Unified Outliner は、単一のMarkdownノート内で意味のまとまりを安全に構造編集することへ集中する。Obsidian本体の機能を重複させるのではなく、ブロックの再配置・閲覧・再編集を強化する機能を優先する。

## 現在のリリース

バージョン0.2.0では、構造単位の移動・レベル変更コマンド（セクション全体の移動、段落・callout・blockquote・fenced code block・tableにも及ぶ最小安全ブロック移動を含む）、削除・挿入コマンド、Outline Tree Viewからの閲覧・編集、インラインリネーム、モバイルのタップ／長押し操作、パンくずナビゲーションとSubtree Navigator、ポップアウトウィンドウ対応を備えたsectionおよびlist subtree用のPartial Edit Pane、mixed structure境界規則、競合解決を伴うファイル単位のfold state永続化を提供する。

## 次の重点領域: Phase 5

- **ホイスト相当の編集**: 選択したsectionまたはlist subtreeを、そこだけに集中できる編集文脈として開く。
- **安全な編集範囲の拡張**: 競合保護を損なわずに、集中編集内での追加・削除・並べ替えを検討する。
- **特殊Markdownブロック**: calloutとMermaidコードブロックについて、構造操作で変更を許す前に、明示的な解析・編集境界を定義する。

## その後の方向性

- ノード単位のリンク・埋め込みプレビュー。
- ノード内のリンクと添付ファイルの一覧。
- sectionまたはlist subtree単位でのCanvas連携。
- ステータスやタグなどの局所メタデータ。
- ノート横断のブロック分類・検索。
- 構造図とダイアログによる編集。

## 意図的に対象外とするもの

Unified Outlinerは、汎用全文検索、タスク管理、Dataview型の集計、AIによる書き換えを置き換えることを目指さない。Markdownノートの信頼できる構造編集に集中する。
