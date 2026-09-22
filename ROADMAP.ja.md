# Unified Outliner ロードマップ

Unified Outliner は、単一のMarkdownノート内で意味のまとまりを安全に構造編集することへ集中する。Obsidian本体の機能を重複させるのではなく、ブロックの再配置・閲覧・再編集を強化する機能を優先する。

## 現在のリリース

Unified Outliner は、構造単位の移動・レベル変更コマンド（セクション全体の移動、段落・callout・blockquote・fenced code block・tableにも及ぶ最小安全ブロック移動を含む）、削除・挿入コマンド、左右選択可能なサイドバー配置に対応したOutline Tree Viewからの閲覧・編集、インラインリネーム、モバイルのタップ／長押し操作、パンくずナビゲーションとSubtree Navigator、ポップアウトウィンドウ対応を備えたsectionおよびlist subtree用のPartial Edit Pane、mixed structure境界規則、競合解決を伴うファイル単位のfold state永続化を提供する。

本文段落は、設定で有効にするとOutline Tree上に表示され、その場でリネーム・移動（隣接交換、先頭/末尾への移動、指定した兄弟の前後への移動）・挿入・削除・Partial Edit Paneでの編集が、トップレベルまたはセクション直下の段落について直接行える。単体のcallout・blockquoteも同様に、ツリーからのmoveとPartial Edit Paneでの編集に対応する。画像のリスト項目の直後にそのOCR転記または引用キャプションが続く場合は、これを1つの折りたたみ可能な「拡張ブロック」（**List + Callout** / **List + Quote**）として認識・グループ化し、単位としてmove・deleteできる。拡張ブロックのlist memberと後続のcallout/blockquote memberは、ブロックの構造がきれいに分割できる限り、まとめて1回のApplyで編集・保存できるようになった。fenced code block（Mermaidを含む）とtableは、Move block向けに内部的には安全なatomic単位として認識されているが、独自のOutline Treeノードとしてはまだ利用できない。

Partial Edit Paneは、対象となるleafのリスト項目（unordered・task-list・orderedのいずれか、1行完結または自身の継続部分に空行を含む複数行）について、Markdownのlist marker・task-listチェックボックス・順序付きリストの番号/区切り文字を隠し、項目本体のテキストだけを編集対象とし、Apply時に元の構文を正確に復元するようになった。単一のリスト項目として安全に還元できないブロックは、生のMarkdownにフォールバックする。自身の子を持つ親のリスト項目を開くと、直接の子が読み取り専用のライブプレビューとして表示され、子または孫への移動、直接の子のインライン編集・追加・削除・並べ替え、直接の子または孫のインデント/アウトデント（一度に1段階まで）に対応する — インデント/アウトデントを除き、これらはすべて親自身のテキスト編集とともに1回のApplyでまとめて保存できる（インデント/アウトデントは他の子操作とは同時に組み合わせられない）。ペインは、未保存の変更がない状態で他の場所（別のペイン、Outline Tree、または本文エディタでのUndo/Redo）でノートが変更された場合、leaf項目用エディタと親項目用エディタとの間の切り替えを含めて自動的に再同期する。設定はカテゴリごとに区切られた「General」タブと「Extended blocks」タブに整理され、見出しprefixとリストmarkerの表示設定も備える。iPad上でのドラッグ操作を専用ハンドルと標準HTML5 Drag & Dropに分離した改善（UXP-01）、モバイルの長押しメニューが複数同時に開いてしまう不具合の修正（UXP-02）も実装済みである。

## 次の重点領域

- **fenced code blockとtableの編集対応**: 段落・callout・blockquoteで既に確立した種別ごとの安全な書き戻し方針に基づき、fenced code blockとtableについても独自のOutline TreeノードとPartial Edit Pane編集に対応させる。
- **任意の深さ・親への自由な移動**: 現在の1段階までのインデント/アウトデントを超えて、リスト項目や子を任意の祖先・任意の深さへ移動できるようにする方向性を検討する。
- **部分木単位での子操作の完全対応**: Partial Edit Paneの子の追加・削除・並べ替え・インデント/アウトデント対応を1段階を超えて拡張し、子の部分木全体をまとめて操作できるようにする。
- **Partial Edit Pane内でのドラッグ＆ドロップ**: 既存のボタン操作に加えて、ペインのプレビュー内で子を直接ドラッグ＆ドロップして並べ替えられるようにする方向性を検討する。
- **境界判定できない構造の安全な保護**: 追加・削除の境界が確定できないブロックや未対応の入れ子構造では、編集を拒否して原文を保護する方針を維持する。
- **ホイスト相当の編集の継続検証**: 選択したsection・list subtree・段落・単体callout/blockquote・親子構造を、そこだけに集中できる編集文脈として開く機能の安全性・回帰試験を継続する。

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
