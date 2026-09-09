# Unified Outliner ロードマップ

Unified Outliner は、単一のMarkdownノート内で意味のまとまりを安全に構造編集することへ集中する。Obsidian本体の機能を重複させるのではなく、ブロックの再配置・閲覧・再編集を強化する機能を優先する。

## 現在のリリース

Unified Outliner は、構造単位の移動・レベル変更コマンド（セクション全体の移動、段落・callout・blockquote・fenced code block・tableにも及ぶ最小安全ブロック移動を含む）、削除・挿入コマンド、左右選択可能なサイドバー配置に対応したOutline Tree Viewからの閲覧・編集、インラインリネーム、モバイルのタップ／長押し操作、パンくずナビゲーションとSubtree Navigator、ポップアウトウィンドウ対応を備えたsectionおよびlist subtree用のPartial Edit Pane、mixed structure境界規則、競合解決を伴うファイル単位のfold state永続化を提供する。

本文段落は、設定で有効にするとOutline Tree上に表示され、その場でリネーム・移動（隣接交換、先頭/末尾への移動、指定した兄弟の前後への移動）・挿入・削除・Partial Edit Paneでの編集が、トップレベルまたはセクション直下の段落について直接行えるようになった。単体のcallout・blockquoteも同様に、ツリーからのmoveとPartial Edit Paneでの編集に対応した。画像のリスト項目の直後にそのOCR転記または引用キャプションが続く場合は、これを1つの折りたたみ可能な「拡張ブロック」として認識・グループ化し、単位としてmove・deleteできる。fenced code block（Mermaidを含む）とtableは、引き続きツリー上で読み取り専用である。設定はカテゴリごとに区切られた「General」タブと「Extended blocks」タブに整理され、見出しprefixとリストmarkerの表示設定も備える。iPad上でのドラッグ操作を専用ハンドルと標準HTML5 Drag & Dropに分離した改善（UXP-01）、モバイルの長押しメニューが複数同時に開いてしまう不具合の修正（UXP-02）も実装済みである。

## 次の重点領域

- **fenced code blockとtableの編集対応**: 現在は読み取り専用で投影されているfenced code blockとtableについて、段落・callout・blockquoteで既に確立した種別ごとの安全な書き戻し方針に基づき、Outline Tree上での移動・追加・削除を解禁する。
- **拡張ブロックのグループ単位編集**: 拡張ブロックのリスト項目とcallout/blockquoteを、個別にではなく1つの単位としてまとめて編集できるようにする方向性を検討する。
- **境界判定できない構造の安全な保護**: 追加・削除の境界が確定できないブロックや未対応の入れ子構造では、編集を拒否して原文を保護する方針を維持する。
- **ホイスト相当の編集の継続検証**: 選択したsection・list subtree・段落・単体callout/blockquoteを、そこだけに集中できる編集文脈として開く機能の安全性・回帰試験を継続する。

## その後の方向性

- ノード単位のリンク・埋め込みプレビュー。
- ノード内のリンクと添付ファイルの一覧。
- sectionまたはlist subtree単位でのCanvas連携。
- ステータスやタグなどの局所メタデータ。
- ノート横断のブロック分類・検索（Phase 6: BlockIndexによるYAML継承・inline property統合）。
- 構造図とダイアログによる編集（Phase 7）。

## 設計原則

### Callout / Blockquote の行継続に関する安全境界

Unified Outliner は、callout および blockquote の編集可能範囲を、
Markdown 上で quote prefix `>` が明示された連続行だけに限定する。

Obsidian のレンダリング上、callout header または quote 行に空行なしで続く
prefixなしの通常テキストが、視覚的に callout / blockquote の内部に表示される場合がある。
しかし Unified Outliner は、その表示上の継続を callout / blockquote の構文的な一部として
推測・補完・再直列化しない。

したがって、prefixなし継続行は以下のように扱う。

- callout / blockquote の編集対象範囲には含めない
- Partial Edit Pane には読み込まない
- Apply 時に `> ` prefix を自動付与しない
- Tree 上の callout / blockquote member として投影しない
- CompositeBlock の member range に含めない
- 通常の paragraph または既存 parser が決定する別の block として扱う

対象 range が prefixなし継続行を含むため安全に一意決定できない場合は、
Partial Edit を拒否し、本文を変更しない。

## 意図的に対象外とするもの

Unified Outlinerは、汎用全文検索、タスク管理、Dataview型の集計、AIによる書き換えを置き換えることを目指さない。Markdownノートの信頼できる構造編集に集中する。
