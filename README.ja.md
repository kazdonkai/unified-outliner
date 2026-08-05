# Unified Outliner

[English](README.md) | 日本語

> **開発段階**: 現在は Phase 4F 完了時点の内部開発版です。GitHub 公開版・Obsidian Community Plugins への配布版ではありません。
>
> **データ保護**: 構造編集を試す前に、対象ノートをバックアップしてください。機密情報や個人情報を含むノートを不具合報告に貼り付けないでください。

単一ノート内で、見出しセクション（heading section）とリストサブツリー（list subtree）を統一的な UX で上下移動できる Obsidian プラグインである。他ノートへの移動は扱わない。本文エディタ側のコマンドに加え、構造を俯瞰するための右サイドバー型パネル「Outline Tree View」（Phase 2A: 閲覧、Phase 2B: ツリー上からの block 系構造編集、Phase 2C: fold-aware な contextual 操作、Phase 3A: section subtree drag & drop、Phase 3C: list 項目の表示、Phase 4A: list subtree drag & drop、Phase 4B: list 項目本文の tooltip 拡張、キーボード操作対応: ↑/↓/←/→/Enter によるマウスなしでのツリー操作、Phase 4E: fold state のファイル単位永続化・同期）と、選択した section または list subtree を局所編集する「Partial Edit Pane」（Phase 3B: section 対応、Phase 4C: list subtree 対応）を備える。見出し・段落・list が混在する mixed structure に対する境界ルールは Phase 4D で仕様として明文化されている（`docs/mixed-structure-spec.md`）。

## Outline Tree View（Phase 2A / Phase 2B / Phase 2C / Phase 3A / Phase 3C / Phase 4A / Phase 4B）

右サイドバーに開くカスタムビューで、アクティブな Markdown ノートの見出し構造をツリー表示し、本文エディタと双方向に同期する。

- **開き方**: コマンドパレットから `Open outline tree view` を実行するか、リボンアイコン（list-tree）をクリックする。既に View が開いている場合は既存の leaf を再利用し、右サイドバーを表示する（`revealLeaf`）。存在しない場合のみ `workspace.getRightLeaf(false)` で新規 leaf を作成する。
- **表示内容**: 既定では `SectionBlockNode`（見出し）のみをツリー化する。設定「Show list items in Outline Tree View」（既定 off）を有効にすると、list 項目もツリーに含まれる（Phase 3C、詳細は下記「list 項目の表示」を参照）。
- **本文 → ツリー**: 本文でカーソルを動かすと、対応するツリーノードが1つだけハイライトされる。list 表示が off の場合、リスト行にカーソルがある場合はその項目が属するセクションをハイライトする。list 表示が on の場合は、リスト項目自体がツリーに存在するため、そのリスト項目自身がハイライトされる。
- **ツリー → 本文**: ツリーノードをクリックすると、本文エディタの対応する行（見出し行、または list 表示が on の場合は list 項目の行）へカーソルが移動し、スクロールが追従する。
- **折りたたみ**: ツリー内の各ノードは開閉できる。これはツリー表示上の状態にすぎず、本文エディタの CM6 fold state とは連動しない（下記「fold state の扱い」を参照）。
- **frontmatter / code fence**: 本文側コマンドと同じ安全側の方針を取る。ツリー構築は `SectionBlockNode` のみを対象とするため、frontmatter・コードブロック内の見出しらしき行はもともとパーサの段階で除外されており、ツリーには現れない。

### ツリー上からの構造編集（Phase 2B）

ツリーの各ノードを右クリックすると、次の4つの block 系コマンドをコンテキストメニューから実行できる。

| メニュー項目 | 動作 |
| --- | --- |
| Move subtree up | そのノードの section subtree を、同レベルの直前の兄弟セクションと入れ替える（`move-block-up` と同じ純粋関数を使用） |
| Move subtree down | 同上、直後の兄弟セクションと入れ替える（`move-block-down` と同じ） |
| Indent subtree | そのセクション配下の全見出し（子セクションを含む）のレベルを揃えて1つ下げる（`indent-block` と同じ） |
| Outdent subtree | 同上、レベルを1つ上げる（`outdent-block` と同じ） |

- **block 系専用**: 「Move/Indent/Outdent subtree」の4項目は常に section subtree 単位の block 系コマンドであり、ノードの折りたたみ状態に関わらず挙動は変わらない。
- **ロジックの再利用**: ツリー側は移動先/可否の判定・適用ロジックを一切複製していない。`tree/treeBlockCommand.ts`（Obsidian 非依存の純粋関数）が `move/moveBlock.ts` / `move/indentBlock.ts` をそのまま呼び出し、`commands/applyLineEditOutcome.ts`（本文エディタ側コマンドとも共有する Obsidian 依存の適用層）が実際のエディタへの反映を行う。
- **制約と no-op**: `indent-block` / `outdent-block` と全く同じ制約（indent は直前兄弟セクションが必要かつ subtree 内のどの見出しも6を超えないこと、outdent は対象自身が1を下回らないこと、move は同レベルの兄弟が必要なこと）に従う。メニュー項目は事前判定により実行不能な操作を「アイコンを ban（禁止マーク）に変更」「タイトル末尾に `— unavailable` を付加」「`setWarning()` による強調色」の3つを重ねて明示する（単なる disabled のグレーアウトだけだとテーマによっては判別しづらいため）。万一判定と実際の結果がずれても（例: 判定後にノートが変更された場合）クラッシュせず安全に no-op し、`Show no-op notices` 設定が有効な場合は理由を Notice で表示する。
- **操作後の同期**: block コマンドの適用後、ツリーはただちに再構築され、操作対象だったセクションが新しい位置でハイライトされる（本文エディタのカーソルもそのセクションの見出し行へ移動する）。

### fold-aware contextual 操作（Phase 2C）

同じ右クリックメニューに、折りたたみ状態に応じて対象単位を自動的に切り替える contextual コマンドも追加されている（メニュー上部、明示的な `Move/Indent/Outdent subtree` とは別枠）。

| メニュー項目 | ツリーでノードが**閉じている**場合 | ツリーでノードが**開いている**場合 |
| --- | --- | --- |
| Move up (contextual) | `move-block-up` 相当（section subtree ごと移動） | `move-node-only-up` 相当（見出し行のテキストのみ入れ替え） |
| Move down (contextual) | `move-block-down` 相当 | `move-node-only-down` 相当 |
| Indent (contextual) | `indent-block` 相当（配下セクションへカスケード） | `indent-node-only` 相当（そのノードの行のみ） |
| Outdent (contextual) | `outdent-block` 相当 | `outdent-node-only` 相当 |

- **ルール**: 「ツリーで閉じているノードは subtree（block 系）として、開いているノードは node-only として扱う」。この判定に使うのはあくまで **Outline Tree View 自身が管理しているローカルな折りたたみ状態** であり、本文エディタの CM6 fold state とは一切連動しない（本文側コマンドの意味も変えない）。
- **明示コマンドは廃止しない**: contextual コマンドは既存の `Move/Indent/Outdent subtree`（常に block 系、折りたたみ状態を無視する）を置き換えるものではなく、追加のレイヤーである。メニュー上、contextual コマンドのタイトルには実際に実行される側のモード（`subtree` / `node-only`）を常に表示するため、実行前にどちらが動くか予測できる。
- **dispatch 層の構成**: `tree/treeBlockCommand.ts`（block 系）、`tree/treeNodeOnlyCommand.ts`（node-only 系、`move/moveNodeOnly.ts` / `level/setNodeOnlyLevel.ts` を呼ぶだけの薄いラッパー）、`tree/treeContextualCommand.ts`（`isCollapsed` の真偽だけでどちらかへ振り分ける純粋関数）の3層に整理されている。振り分けロジック自体は fold 状態を読むだけで、move/indent の実装を一切持たない。
- **no-op の切り替え**: 経路によって block 系・node-only 系それぞれの制約が適用され、Notice の文言もそれに応じて自動的に切り替わる（`commands/applyLineEditOutcome.ts` の `NOOP_MESSAGES` を両系で共有しているため、UI 側で分岐を増やす必要はない）。
- **操作後の同期**: block 系・node-only 系のどちらが実行されても、ツリーは即時再構築される。node-only 系は行を一切移動しないため、カーソル/ハイライトは操作前と同じ行に留まり、その行が（テキスト入れ替え後の）新しいラベルで表示される。
- **今回のフェーズで扱わないもの**: drag & drop は Phase 2C では対象外とし、Phase 3A で実装した（次項を参照）。Partial Edit Pane、list subtree の統合表示、fold state のファイル単位永続化は実装済みである。本文エディタのCM6 fold stateとの同期は対象外のままである。今後の方向性は`ROADMAP.ja.md`を参照。

### drag & drop（Phase 3A）

ツリーのノードをドラッグして、section subtree 単位で構造変更できる。右クリックメニュー（Phase 2B/2C の明示コマンド・contextual コマンド）はそのまま残っており、drag & drop はそれを置き換えるものではなく、「素早い直接操作」として並存する追加の操作手段である。

- **対象は section subtree のみ**: ドラッグできるのは常にノードの section subtree 全体（見出し＋本文＋子セクション＋配下リスト）である。node-only（見出し行だけの移動）は drag & drop の対象外であり、引き続き本文側コマンドからのみ利用できる。
- **ドロップ位置の3種類**: ドラッグ中、ホバーしている行を縦方向に3分割して判定する。
  - 上 1/3 → **before**（対象ノードの直前へ移動、レベルは変更しない）
  - 中央 1/3 → **inside**（対象ノードの子として、末尾に追加。移動する subtree root のレベルを対象の子レベル（対象レベル + 1）に合わせ、配下セクションは相対差分を保ったままカスケード変更する）
  - 下 1/3 → **after**（対象ノードの直後——対象の subtree 全体の後——へ移動、レベルは変更しない）
- **視覚的なフィードバック**: before/after はノード上端・下端の線、inside は行全体の淡いハイライト＋左端のアクセントバーで区別する（`--uo-current-color` を流用しており、外観のカスタマイズ設定と連動する）。ドラッグ中の元ノードは半透明表示になる。
- **不正な drop の防止**: 自分自身、または自分の子孫セクションへの drop は、ドラッグ中の時点で drop 不可として扱う（indicator を表示せず、ブラウザ既定の「drop 不可」カーソルになる）。対象の祖先セクションへの drop（＝親から外へ「昇格」させる操作）は正当な操作として許可している。万一 drop 実行時に判定がすり抜けても、`move/relocateSection.ts` 側で安全に no-op し、`Show no-op notices` が有効なら理由を Notice で表示する。
- **ロジックの分離**: 判定・再配置ロジックは `move/relocateSection.ts`（Obsidian 非依存の純粋関数）に閉じており、View 層はドラッグ位置から `before`/`after`/`inside` を判定するだけである。`relocateSection` は既存の `insertBlockAt`（`move/moveBlock.ts`）と `collectSectionSubtree`（`move/indentBlock.ts`）、新設の `level/headingLevel.ts` の `setHeadingLevel`（任意レベルへの直接書き換え。`changeHeadingLevel` の ±1 ステップとは別に用意した）を組み合わせて実装している。
- **今回のフェーズで扱わないもの**: node-only drag、list subtree の drag（Phase 4A で実装済み、次々項を参照）、複数ノード同時選択、複数ノート間の drag & drop は今後の対象である。Partial Edit Pane は Phase 3B として実装済み（次項を参照）。fold state のファイル単位永続化は Phase 4E で実装済みであり、本文側の CM6 fold state との同期は対象外である。

### list subtree の drag & drop（Phase 4A）

list 項目（Phase 3C で表示対象になったもの）を、section と同じ drag & drop 操作で移動できる。section の drag & drop（Phase 3A）を置き換えるものではなく、ドラッグ状態の管理（ドラッグ中要素の追跡・ドロップ indicator の表示/消去・thirds 判定）を共有した上で、対象ノードが list か section かに応じて判定・再配置ロジックだけを切り替える追加機能である。

- **移動単位は list subtree 全体**: 対象 list item 自身だけでなく、その配下の子 list をすべて含めて一体として移動する（`ListBlockNode.range` が元々この subtree 全体を指しているため、`move-block-up/down` 同様、特別な収集処理は不要である）。
- **ドロップ先は list node と section node の両方**: list を list へ、list を section へドロップできる。**section を list へドロップすることは今回対象外**とし、既存の section drag & drop の挙動（section → section のみ）は一切変更していない。
- **drop mode の意味**:
  | drop mode | target が list の場合 | target が section の場合 |
  | --- | --- | --- |
  | before | target の直前へ、target と同じインデント列で兄弟として挿入 | target の見出し行の直前へ挿入（target を含まない、target の前に位置する内容——多くの場合 target の親——の root list item になる） |
  | after | target の直後へ、target と同じインデント列で兄弟として挿入 | **inside と同じ結果になる**（下記参照） |
  | inside | target の最後の子として挿入。target が既に子を持つ場合はその子と同じインデント列に、持たない場合は新規に1段インデントする | target 自身の root list item の末尾に追加する（target 自身に属させる、target の子セクションには属させない） |
- **section target での after = inside という設計判断**: 見出しは自分自身の `#` 番号によって「ここで親のレベルに戻る」という境界を文書内に独立して表現できるが、list item にはそれに相当する目印がない。そのため、「target の全 subtree（配下セクションを含む）の後に、target と同じ階層の兄弟として」挿入することを表現できるテキスト上の位置は存在しない——target の直後に置いた非見出しコンテンツは、常にその時点で開いている最も深い見出し（target 自身、または target の末尾の子孫セクション）に吸収されるためである。適切な挿入位置（target 自身の最初の子セクションの直前、子セクションが無ければ target の range 末尾）を用いれば、それは必ず target 自身に帰属する——つまり inside と同じ操作になる。この非対称性は Markdown の構造上の制約であり、実装上の妥協ではない（詳細は `move/relocateListSubtree.ts` のコメントを参照）。
- **インデントの再計算**: before/after/inside のいずれでも、移動後の indent 列を明示的に計算して書き換える（`move/indentBlock.ts` の `growIndent`/`shrinkIndent` を再利用）。見出しレベル（`#` の数）はどこに置いても単独で意味を持つため Phase 3A の before/after はレベルを変更しないが、list の生インデント列は周囲との相対関係でしか意味を持たないため、置き場所に応じて常に正しい値へ明示的に揃える——そうしないと、誤った親に紐付いたり、見た目が壊れたりする可能性があるためである。
- **安全対策**: 自分自身、または自分の子孫 list item への drop は拒否する（`move/relocateListSubtree.ts` の `canDropListOn`、Phase 3A の `canDropOn` と同じ設計）。自分の祖先 list item への drop（＝親から外へ「昇格」させる操作）は正当な操作として許可している。タブ・スペース混在の危険なインデント（`unsafeIndent`）を持つ item は、移動元・移動先のいずれであっても drop 不可とする。target が section の場合、list item を section の子として持ち込むという構造上の性質上、循環（自己/子孫）は発生しえないため、循環チェックは list target の場合のみ行う。
- **ロジックの分離**: 判定・再配置ロジックは `move/relocateListSubtree.ts`（Obsidian 非依存の純粋関数）に閉じている。既存の `insertBlockAt`（`move/moveBlock.ts`）・`expandToListRegion`・`normalizeOrderedMarkers`、および新たに export 化した `growIndent`/`shrinkIndent`（`move/indentBlock.ts`）を再利用し、`move/relocateSection.ts` 自体には一切手を加えていない。
- **View 側の共有**: `view/OutlineTreeView.ts` の drag & drop 状態管理（`dragSourceId` 等）・indicator 表示・thirds 判定はそのまま section と共有する。ドラッグされているノードの種別だけを見て `canDropOn`/`relocateSection`（section）か `canDropListOn`/`relocateListSubtree`（list）かを切り替える1箇所の分岐（`canDropAny` / `runRelocateCommand`）を追加しただけであり、section 側の drag & drop は挙動・コードとも変更していない。
- **今回のフェーズで扱わないもの**: node-only list の drag、段落を挟む複雑な list 構造への完全対応、複数ノート間の drag & drop、複数選択、list subtree の Partial Edit Pane への展開は対象外である。

### 外観のカスタマイズ（Style Settings 対応）

Outline Tree View の背景色・テキスト色・ハイライト色・ミュートテキスト色・フォントサイズは、Obsidian の現在のテーマが持つ変数（`--background-primary` / `--text-normal` / `--font-ui-small` 等）を参照せず、本プラグイン独自の CSS カスタムプロパティ（`--uo-bg-color` 等、`styles.css` 冒頭で定義）で管理している。そのため、Obsidian のテーマを切り替えても Outline Tree View の見た目は変わらない。

- **既定値**: light モード・dark モードそれぞれに独自の既定色を `styles.css` 内の `.theme-light` / `.theme-dark` ルールとして直接定義してある。[Style Settings](https://github.com/community-archive/obsidian-style-settings) プラグインが無くても、この既定値でそのまま動作する。
- **Style Settings プラグインでの変更**: Style Settings（community plugin）をインストールしている場合、`styles.css` 冒頭の `/* @settings ... */` ブロックが自動的に検出され、設定タブに「Unified Outliner」セクションが追加される。以下を light/dark モードごとに個別に変更できる。
  - Background Color（`--uo-bg-color`、`variable-themed-color`）
  - Text Color（`--uo-text-color`、同上）
  - Highlighted Node Color（`--uo-current-color`、同上、カーソル位置に対応するノードの文字色）
  - Muted Text Color（`--uo-muted-text-color`、同上、空状態メッセージ等）
  - List Item Text Color（`--uo-list-text-color`、同上、list 項目行の文字色。Phase 3C.2 で Muted Text Color から分離）
  - Font Size（`--uo-font-size`、`variable-number-slider`、light/dark 共通）
  - `variable-themed-color` は Style Settings 側が `body.theme-light.css-settings-manager` / `body.theme-dark.css-settings-manager` というセレクタで値を出力するため、上記の `.theme-light` / `.theme-dark` の既定値より詳細度が高く、自動的に優先される。追加の CSS は不要である。
- **プラグイン側の対応**: `main.ts` の `onload()` で `this.app.workspace.trigger("parse-style-settings")` を呼び、Style Settings 側に CSS の再スキャンを促している（Style Settings の公式ドキュメントが定めるプラグイン連携手順）。
- Obsidian のツリー構造（`.tree-item` 系クラス）自体は引き続き流用しているため、間隔や折りたたみ矢印などのレイアウトは Obsidian 標準のままである。カスタマイズ対象は色とフォントサイズのみである。

### list 項目の表示（Phase 3C）

設定「Show list items in Outline Tree View」（既定 off）を有効にすると、Outline Tree View に list 項目もノードとして表示される。このフェーズの目的は「見えるようにする」ことに絞られており、以下のとおり基本的な閲覧・選択操作のみをサポートする。

- **データモデル**: `tree/buildOutlineTree.ts` の `OutlineTreeNode` は `kind: "section" | "list"` の判別共用体になっている。既定（`includeLists` 省略、または false）では従来どおり section のみの木を返す——この既定挙動は Phase 2A〜3B と完全に同一であり、既存のツリー消費側（コマンドディスパッチ層等）は一切変更していない。`includeLists: true` を指定した場合のみ、section の子として root list 項目が、list 項目の子として入れ子の list 項目が、木に組み込まれる。
  - `ParsedDocument` 側で section の `childIds` は「子セクション → 直後に root list 項目」の順で追加されており（`parser/parseDocument.ts` のパス1・パス2の順序に由来）、単純に `childIds` の並びをそのまま使うと文書順が崩れる。そのため `buildOutlineTree` は子ノードを常に行番号で再ソートしてから木を構築する。
- **選択・ハイライト**: list 項目もクリックで本文の該当行へジャンプできる。カーソル同期には `tree/resolveHighlightedSectionId.ts` の新関数 `resolveHighlightedNodeId(doc, cursorLine, { includeLists })` を用いる——list 表示が off の場合は従来どおり所属セクションまで遡ってハイライトし（`resolveHighlightedSectionId` はこの関数の `includeLists: false` 版として実装されている）、on の場合は list 項目自身をハイライトする。
- **fold（折りたたみ）**: 子を持つ list 項目（ネストしたリスト）は、section ノードと同じ折りたたみ UI・状態管理（`collapsedIds`）をそのまま共有する。表示上の入れ子は Obsidian 標準の `.tree-item-children` による自動インデントを利用しており、list 専用のインデント計算は行っていない。
- **見た目**: list 項目は見出しノードより弱いスタイル（通常ウェイト、やや小さいフォントサイズ）で表示し、見出しの視覚的な優先度を保っている（`unified-outliner-list-text` クラス、`styles.css`）。文字色は専用の `--uo-list-text-color` を用いる（次項「list 行のテキストコントラスト改善（Phase 3C.2）」を参照）。
- **今回のフェーズで扱わないもの（今後の対象）**: list に対する右クリックの構造編集メニュー（block/contextual move・indent・outdent）、Partial Edit Pane への展開、複数選択、fold state の永続化は Phase 3C の対象外である。list 項目の行はクリックジャンプ・ハイライト・折りたたみのみをサポートし、右クリックしても Phase 2B/2C のメニューは表示されない（ハンドラ自体を list 行にはアタッチしていない）。drag & drop は Phase 3C の時点では対象外としていたが、Phase 4A で実装した（下記「list subtree の drag & drop（Phase 4A）」を参照）。

#### 長い list ラベルの省略表示（Phase 3C.1）

list 項目のテキストが長くサイドパネル幅を超える場合、ラベルは1行に収まるよう CSS で省略表示され（`overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`）、ホバーすると Obsidian 標準の `setTooltip()` API によるツールチップで全文が表示される。

- **サイドパネル幅への追従**: 固定文字数でのカットではなく CSS の `text-overflow` を用いているため、ユーザーがサイドパネルの幅をドラッグで変更しても、その時点の実際の幅に応じて自動的に省略位置が調整される。
- **ツールチップの実装**: HTML 標準の `title` 属性ではなく、Obsidian 公式 API の `setTooltip(el, text)`（Obsidian 1.4.4 以降）を用いている。Obsidian 本体（リボンアイコン等）と同じ見た目・表示タイミングになり、UI の統一感を保てる。この API を使うため、`manifest.json` の `minAppVersion` を `1.4.0` から `1.4.4` へ引き上げた。
- **スコープ（Phase 3C.1 時点は先頭行のみ）**: Phase 3C.1 の時点では、ツールチップに表示するのは list 項目の先頭行テキストのみだった。複数物理行にまたがる本文の扱いは Phase 4B で拡張済みである（次項参照）。ラベル自体の複数行折り返し表示（切り詰めない方式）は、一覧性を損なうため今も採用していない。

#### list 行のテキストコントラスト改善（Phase 3C.2）

list 項目の行は、見出しに対して視覚的な優先度を下げるため、当初は空状態メッセージ等と同じ `--uo-muted-text-color` を流用していた。しかし、長い list 項目が多いノートで実際に使ってみると、その色は薄すぎて読みにくいという指摘を受け、修正した。

- **専用の色変数に分離**: list 行の文字色を、`--uo-muted-text-color` ではなく新設の `--uo-list-text-color`（既定値: light `#454a52` / dark `#c2c4c9`）で管理するようにした。`--uo-muted-text-color` は引き続き空状態メッセージなど、本当に副次的な UI テキストにのみ使う。両者を分離したことで、Style Settings 経由でも独立して調整できる。
- **設計方針の変化**: 「見出しより弱いスタイルにする」という Phase 3C の方針自体は変えていない（フォントウェイト・フォントサイズは従来どおり）。ただし、弱くする手段は色のコントラストだけに頼らず、ウェイト・サイズとの組み合わせで十分に区別できると判断し、色自体はしっかり読める濃さに引き上げた——list 項目は「読み飛ばしてよい付随情報」ではなく、ユーザーが実際に読みたいコンテンツであるため。

#### list 項目本文の tooltip 拡張（Phase 4B）

ツールチップに表示するテキストを、先頭行だけでなく「その list 項目自身の本文全体」（継続行を含む、子リストは除く）へ拡張した。ラベル自体は引き続き1行の省略表示のままであり、一覧性を損なわない。

- **「本文」の定義**: 対象とするのは、item の先頭行と、その直後に続く継続行（子 list には属さない行）である。子 list（より深いインデントで list マーカーを持つ行）・code fence 内の行・frontmatter は本文から除外する。
  - 判定には `parser/parseDocument.ts` が既に計算している `lineToOwningNodeId`（各行の「最も深く所有しているノード」）をそのまま利用している——ネストした子 list item は自分の行範囲を自分の id で上書きするため（「深いものが勝つ」というパーサの既存の仕様）、「この行は自分自身の本文に属するか」は `lineToOwningNodeId[line] === itemId` の1行判定だけで済み、インデント列のしきい値を独自に再計算する必要はない。
- **改行・空行の扱い**: 継続行の境界には改行を入れる。連続する空行は削除し、空のツールチップ行として残さない（読みやすさ優先）。継続行の先頭インデント（ネスト目的のみの空白）はツールチップ表示上は取り除く。
- **ロジックの分離**: `src/edit/listBodyRange.ts`（Obsidian 非依存の純粋関数）に、本文範囲の抽出（`collectListItemBodyLines`）と表示用整形（`formatListItemBodyLines`）を分離して実装し、両者を合成した `extractListItemBodyText` を用意した。`view/OutlineTreeView.ts` はこの関数を呼び出して tooltip 用テキストを取得するだけであり、Markdown の再解釈は行わない。section ノードの tooltip 挙動は変更していない。
- **今回のフェーズで扱わないもの（今後の対象）**: list subtree 全体（子リストを含む）の tooltip、Outline ラベル自体の複数行折り返し表示、list の Partial Edit Pane は Phase 4C で実装済みであり、構造編集ロジック（`relocateListSubtree` / `relocateSection`）の変更は対象外である。

#### tooltip の左揃え・インデント修正（Phase 4B.1）

Phase 4B 実装直後の実機確認で、Obsidian 標準の tooltip が既定で中央揃えになっており、複数行にまたがる本文がラベルとの対応関係を失って読みにくいという指摘を受け、修正した。

- **左揃え**: `setTooltip()` の `classes` オプション（Obsidian 1.8.7 以降）で、この tooltip にだけ `unified-outliner-list-tooltip` クラスを付与し、`styles.css` の `.tooltip.unified-outliner-list-tooltip { text-align: left; }` でスコープを絞って上書きした。Obsidian 本体・他プラグインの tooltip には一切影響しない。この API を使うため `manifest.json` の `minAppVersion` を `1.4.4` から `1.8.7` へ引き上げた。
- **継続行のインデント**: 当初案の「半角スペース1字」は採用しなかった。理由は2点——(1) tooltip の `white-space` の扱い次第では、半角スペース（ASCII space）は CSS の空白文字圧縮規則により消えてしまう場合がある、(2) 仮に残っても半角スペース1つはラテン文字1文字分より狭く、インデントとして視認しづらい。この定数は `edit/listBodyRange.ts` の `CONTINUATION_INDENT` としてテキスト生成ロジック側に実装しており、CSS 側のインデント指定（`text-indent` 等）には依存しない——`text-indent: hanging` / `each-line`（テキストを変更せず CSS だけで「先頭行以外を字下げ」できる仕組み）も検討したが、Obsidian の Electron が使う Chromium では本稿執筆時点でまだ実験フラグの扱いであり（Safari 15+ / Firefox 121+ は対応済み）、採用すると多くの環境で「字下げなしの左揃えのみ」に静かに劣化してしまうため見送った。
  - **国際化対応（Phase 4B.2）**: 実装直後の確認で、日本語以外の言語のノート・海外ユーザーの場合にどうなるかという指摘を受けた。当初案の全角スペース（U+3000 IDEOGRAPHIC SPACE、CJK の全角文字幅に合わせて設計された文字）は、英語など非 CJK 言語のノートでは不自然に大きな余白として表示されてしまう問題があった。そこで EM SPACE（U+2003）へ変更した。EM SPACE も CSS の空白圧縮の対象外（圧縮されるのは U+0020 と U+00A0 のみで、それ以外の Unicode 空白文字——U+3000 も U+2003 も——は圧縮対象外というのは CSS Text 仕様上の定義である）という性質は保ちながら、CJK 固有ではなく欧文組版でも標準的に段落インデントに使われる文字であるため、ノートの言語によらず自然な字下げとして表示される。

## Partial Edit Pane（Phase 3B / Phase 3B.1 / Phase 4C）

Outline Tree View で選択した **1つの section subtree、または（Phase 4C 以降）1つの list subtree** だけを取り出し、独立したペインで局所編集できる。**元ノート全体を置き換えるエディタではない** ——常に元ノートが source of truth であり、このペインは対象ノードの range（section なら「見出し＋本文＋子見出し＋配下リスト」、list なら「item ＋配下の子 list」）を一時的に切り出して表示・編集し、明示的な Apply で元ノートの当該 range だけを置換するビューである。

- **開き方**:
  - section: Outline Tree View のノードを右クリックし、「Open partial edit pane」を選ぶ。または本文エディタでカーソルを section 内に置き、コマンドパレットから `Open partial edit pane for current section` を実行する。
  - list（Phase 4C）: Outline Tree View の list 項目を右クリックし、「Edit list subtree in pane」を選ぶ。
  - いずれの場合も、すでにペインが開いている場合は新規に増やさず既存の leaf を再利用し、選択中のノードに差し替える。
- **表示内容**: 対象 subtree の生 Markdown テキストをそのままテキストエリアに表示する。section なら見出しレベル・本文・子見出し・配下リストが、list なら item 自身の行＋配下の子 list が編集対象になる——見出し行・list マーカー行自体を書き換えることも許容している。ヘッダーには対象種別（`Editing (Section): ...` / `Editing (List): ...`）とノードのラベルを表示する。
- **Apply（保存）**: 「Apply」ボタンを押すと、元ノートの対象 range だけをテキストエリアの内容で置換する。自動保存・本文とのリアルタイム双方向同期は行わない——明示的な Apply でのみ反映される。反映後は本文エディタのカーソルが対象ノードの新しい開始行に移動し（スクロール追従あり）、これにより Outline Tree View 側の再構築・ハイライト・tooltip・drag & drop も通常の `editor-change` 経由で追従する（他の tree コマンドと同じ仕組みを流用しており、ペイン専用の特別な処理は持たない）。
- **Cancel（取消）**: テキストエリアの内容を最後にロード（または Apply）した時点の内容へ戻す。
- **Close（×、閉じる）**（Phase 3B.1）: ヘッダーの Apply / Cancel と並んで × ボタンを配置しており、クリック一発でペインを閉じる（`leaf.detach()`）。以前は Obsidian 標準のタブの × や右クリックメニューの「Close tab」からしか閉じられず2ステップかかっていたため追加した。Cancel と同様、閉じても保存は行われない（未保存の編集は破棄される）。
- **再起動をまたいでは保持しない**: 開いているノードの id はどのファイルにも保存されない。Obsidian 再起動時にレイアウト復元によって中身のない Partial Edit Pane だけが残ってしまうと、Outline Tree View も同時に開かれているとは限らず、操作の手がかりのない空白パネルが残るだけになってしまう。そのため、Obsidian のレイアウト復元中（`workspace.layoutReady === false`）に生成されたインスタンスは、`onOpen()` の冒頭で即座に自身を閉じる（`PartialEditView.onOpen`）。DOM を組み立てる前に判定するため、画面には一切描画されない。ユーザーが右クリックメニューやコマンドから明示的に開いた場合（`layoutReady` は起動後ずっと true）は通常どおり開く。
- **安全対策（保存の拒否）**: 次のいずれかに該当する場合、Apply は反映せず必ず Notice で理由を表示する（`Show no-op notices` 設定の有無に関わらず、明示操作の失敗は常に通知する）。
  - 対象ノードの id が元ノート側で解決できなくなっている場合（見出し・list 項目が削除された等）
  - **list 限定（Phase 4C）**: 対象 list item がタブ／スペース混在の危険なインデント（`unsafeIndent`）を持つ場合。`move/relocateListSubtree.ts` が同じ理由でこうした item の移動を拒否しているのと同じ安全方針であり、ペインを開く時点だけでなく Apply 時の再抽出でも同じチェックが自動的にかかる（下記「ロジックの分離」参照）。
  - **競合検出**: ペインを開いた時点で取得した「編集前テキスト」と、Apply 実行直前に元ノートから改めて抽出した対象ノードのテキストが一致しない場合（ペインを開いてから、他の操作で元ノートの当該箇所が変わっていたことを意味する）。差分表示やマージ UI は持たず、単純な完全一致比較で保存を拒否するのみである。
- **ロジックの分離・共通化（Phase 4C）**: `edit/partialEdit.ts` に、section 専用の `extractSectionText` / `applySectionEdit`（Phase 3B、挙動・シグネチャとも完全に不変）に加えて、section と list の両方を受け付ける汎用の `extractSubtreeText` / `applySubtreeEdit` を追加した。両者の違いは「range の取り方」（section は `SectionBlockNode.range`、list は `ListBlockNode.range`——Phase 4A の `relocateListSubtree` が移動単位として使っているのと同じ range で、item と配下の子 list を追加の収集処理なしにそのまま指す）と「unsafeIndent チェックの有無」（list のみ）だけであり、実際には `extractSectionText` を `extractSubtreeText` の薄いラッパーとして再実装することで、コードの重複を避けつつ既存の挙動・テストを一切崩していない。View 層（`view/PartialEditView.ts`）は `loadNode(nodeId)` / `applyEdit()` という1本の経路で両方のノード種別を扱い、種別で分岐するのはヘッダーのラベル表示だけである。エディタへの反映は他の tree コマンドと同じ `commands/applyLineEditOutcome.ts` を再利用する。アクティブな Markdown ビューの解決には、Outline Tree View と共通の `view/activeMarkdownViewTracker.ts`（Phase 3B で共通化）を用いる。
- **今回のフェーズ（Phase 4C）で扱わないもの**: list subtree の複数選択編集、段落を挟む mixed structure の特別扱い（Phase 4D）、fold state の永続化・同期（Phase 4E）と複数 Partial Edit Pane 間の fold state 競合解決（Phase 4F）は実装済みである。list subtree 全体を別ファイルへ export/import することは対象外である。複数ノートをまたぐ編集、本文エディタとのリアルタイム双方向同期、差分表示・マージ UI も引き続き対象外である。

## Mixed Structure の境界ルール（Phase 4D）

見出し・段落・箇条書き list が連続する「mixed structure」に対して、move（drag & drop / `relocateSection` / `relocateListSubtree`）と Partial Edit Pane が「どの範囲を1つの subtree として扱うか」を仕様として定義した。詳細な境界ルール・具体例・根拠は `docs/mixed-structure-spec.md` にまとめてある。

- **調査の結論**: 既存の `parser/parseDocument.ts` の range 算出ロジックは、見出し→段落→list（パターン A）・見出し→list→段落（パターン B）・段落→list（見出しなし、パターン C）・見出し→段落のみ（パターン D）のいずれについても、そのまま望ましい境界ルールを満たしていることが確認された。そのためパーサ・`move/relocateSection.ts`・`move/relocateListSubtree.ts`・`edit/partialEdit.ts` にロジック変更は行っていない——本フェーズの成果は「新しいルールの実装」ではなく「既存の挙動を仕様として明文化し、テストで固定したこと」である。
- **基本ルール**: section subtree は見出し行から次の同じか浅い見出しの直前までを常に丸ごと含む（間の段落・list を問わない——これは Phase 1 以来の既存挙動そのもの）。list subtree は item 自身＋配下の子 list のみで、前後の独立した段落は含めない。ただし item 自身のマーカー列より深いインデントで続く段落は「継続行」として扱われ、これは Phase 4B の list 項目本文 tooltip がすでに前提としている挙動と同一であり、バグではなく意図的な挙動である。
- **既知の制限（意図的に対応しない）**: list item の間にインデントされていない段落が直接割り込むケース（例: `- one` の直後に段落、その後に `- two`）は、`one` と `two` が兄弟として連結されず、その2つの間の `move-block-up/down` は no-op になる。誤った結果を返すより「動かない」ことを選んだ——`docs/mixed-structure-spec.md` §5 に詳細な理由を記載している。
- **安全側の方針は不変**: unsafeIndent（タブ／スペース混在インデント）を持つ list item は、mixed structure の内部にあっても従来どおり move・Partial Edit Pane のいずれからも拒否される。同じ section 内に安全な item と unsafeIndent な item が混在していても、安全な方の操作は妨げられない。
- **テスト**: `tests/mixedStructure.test.ts`（18件）が、上記4パターンの range・`relocateSection`/`relocateListSubtree`・Partial Edit Pane・unsafeIndent 拒否・既知の制限のすべてを検証する characterization test として機能している。

## Outline Tree View のキーボード操作

Outline Tree View パネル自体にフォーカスがある状態で、マウスを使わずにツリーを操作できる。本文エディタ側のカーソル追従ハイライト（`.unified-outliner-current`、上記「本文 → ツリー」）とは別の、パネル固有の「キーボード選択」状態（`.unified-outliner-selected`）として実装されている。

| キー | 動作 |
| --- | --- |
| ↑ / ↓ | 現在表示中（fold 状態を考慮済み）のノード間で選択を前後に移動する。折りたたまれたノードの子は候補に含まれない。末尾/先頭では止まる（循環しない）。設定「Follow keyboard selection into body editor」がオン（既定）なら、選択が別ノードへ移動するたびに本文側もクリック時と同様に追従する |
| → | 選択中ノードが折りたたまれていれば展開する（この場合は本文側は動かない）。すでに展開されていれば、最初の子ノードへ選択を移動する（この移動には上記の追従設定が適用される）。子を持たないノードでは何もしない |
| ← | 選択中ノードが展開されていれば折りたたむ（この場合は本文側は動かない）。すでに折りたたまれている場合、または子を持たないノードの場合は、親ノードへ選択を移動する（この移動には上記の追従設定が適用される）。ルート直下のノードでは何もしない |
| Enter | 選択中ノードへ本文ジャンプする（クリックした場合と同じ `jumpToLine` を呼ぶ）。追従設定のオン/オフに関わらず常に本文へフォーカスも移す |

### 本文追従設定（Follow keyboard selection into body editor）

設定タブの「Follow keyboard selection into body editor」で、矢印キーによる選択移動が本文エディタに反映されるかどうかを切り替えられる。

- **既定はオン**である。これは現在実装済みの挙動そのもので、矢印キーで選択が別ノードへ移動するたびに、クリック時と同じ `jumpToLine(..., { focusEditor: false })` で本文側のカーソル・スクロール位置を追従させる（ただしフォーカス自体はツリー側に残るため、連続して矢印キーでナビゲートできる）。通常の閲覧・編集では、選択中のノードと本文の表示位置が常に一致している方が分かりやすいため、これを既定にしている。
- **オフにすると Phase 4D 時点の旧挙動**に戻る。矢印キーはツリー内の選択のみを動かし、本文へは Enter を押したときだけジャンプする。ツリー構造を俯瞰しながら探索的に操作したい（本文のスクロール位置を矢印キーのたびに動かされたくない）ユーザー向けの互換モードという位置づけである。
- どちらのモードでも、選択が同じノードのまま fold/unfold だけを行った場合（→/← の展開・折りたたみ分岐）は本文側に一切影響しない。
- 判定ロジックは `tree/outlineNavigation.ts` の純粋関数 `shouldFollowKeyboardSelectionIntoBody(followEnabled, previousId, nextId)` に切り出されており、「設定がオンか」と「選択が実際に別ノードへ移動したか」の両方を満たすときだけ真になる。`tests/outlineNavigation.test.ts` でオン/オフ双方の状態遷移を検証している（実際に DOM フォーカスがツリー側に残ることそのものは Obsidian 依存のため自動テスト対象外で、実機確認で扱う）。

- **フォーカスの持ち方**: `treeRootEl`（ツリー全体を包む1つの要素）自身が `tabIndex = 0` でフォーカス対象になる。行ごとの roving tabindex は採用していない——ナビゲーションのたびにツリー全体を再描画する既存の `renderTree()` 実装と、行単位のフォーカス管理は相性が悪いため、選択中の行は `aria-activedescendant`（`treeRootEl` 側の属性）で示す方式にした。`role="tree"` / 各行 `role="treeitem"` + `aria-selected` / 子を持つ行の `aria-expanded` も付与しており、スクリーンリーダー等の支援技術からも選択位置・折りたたみ状態を読み取れる。
- **選択状態の可視化**: キーボード選択中の行だけ背景色（`--uo-selected-bg-color`、Style Settings で調整可能）を付ける。本文カーソル同期のハイライト（文字色・太さで示す）とは視覚的に独立しているため、Enter 直後など両方が同じ行を指している場合でも両方の表示が同時に成立する。パネルがフォーカスを失うと（本文エディタをクリックする、Enter でジャンプする、等）選択状態そのものは保持されるが背景色表示は消える——次にパネルへフォーカスが戻ったとき、同じ行から操作を再開できる。
- **選択位置の初期化**: パネルへフォーカスが入った時点で、選択中のノードがまだない、または直前の選択が非表示（親が折りたたまれた等）になっている場合は、本文カーソルが指しているノード（表示されていれば）、それもなければツリーの先頭ノードへ自動的に補完する（`ensureSelection`）。
- **既存機能への影響なし**: クリックによるジャンプ、本文カーソル移動によるツリー側ハイライト同期、ローカルな折りたたみ状態管理——いずれも変更していない。キーボード操作はこれらに独立した追加のレイヤーとして実装した（`src/tree/outlineNavigation.ts`、Obsidian 非依存の純粋関数群：`flattenVisibleOutlineTree` / `buildNodeByIdMap` / `buildParentIdMap` / `nextVisibleId` / `prevVisibleId` / `shouldFollowKeyboardSelectionIntoBody`）。
- **今回扱わないもの**: 複数選択、Space キーでの展開/折りたたみ、Home/End での先頭/末尾ジャンプ、パネル内での検索/フィルタは対象外である。

## Fold State の永続化・同期（Phase 4E）

Outline Tree View の折りたたみ状態を、一時的な表示状態ではなく、ファイルをまたいで混線せず、アプリ再起動後も復元され、move/indent/drag のような構造編集後も自然に維持される形で永続化した。詳細な設計・比較検討・既知の制限は `docs/fold-state-spec.md` にまとめてある。

- **保持先**: プラグイン設定と同じ `data.json`（`loadData`/`saveData`）に、新設の `foldState`（`Record<filePath, string[]>`）キーとして保持する。`main.ts` の `persistData()` が `{ ...settings, foldState }` を組み立てる唯一の書き込み経路であり、既存の `saveSettings()`（設定タブ）と新設の `FoldStateManager.flush()` はどちらもこの経路を経由するため、互いの保存内容を上書きしない。Phase 4E 以前の（`foldState` キーを持たない）`data.json` もそのまま読み込める。
- **node identity（`src/tree/foldIdentity.ts`）**: `sec-N`/`li-N` は再パースごとの一時連番であり永続化キーには使えないため、ラベル（見出しテキスト／list item テキスト）ベースの識別子を新設した。section は祖先セクションの見出しテキストパス全体（兄弟間の move には強いが、見出しレベルの indent/outdent で論理的な親が変わる場合は identity も変わる——比較的稀な操作であり許容している）。list node は当初「祖先パス全体」を想定していたが、list item の indent/outdent（直近の親 item を変える操作）は本プラグインで最も日常的な構造編集であり、祖先パス全体では通常の indent/outdent のほぼ毎回で identity が壊れてしまうことが実装検証で判明したため、**直近の「囲んでいる section」のパス**を基準にスコープを調整した——同じ section 内であれば、どの list item の子であるかに関わらず re-nest 後も identity が維持される。別の section へ relocate する操作は、この調整の裏返しとして identity が変わる（既知の制限、`docs/fold-state-spec.md` §2.2）。同一スコープ内でラベルが重複する場合は文書順の出現順インデックスで区別する。
- **同期経路の一本化**: chevron クリック（`toggleCollapse`）とキーボードの ←/→（`expandSelectionOrGoToFirstChild`/`collapseSelectionOrGoToParent`）は、すべて新設の `setNodeCollapsed(nodeId, collapsed)` を経由する——メモリ上の `collapsedIds`（`node.id` キー、既存の全消費コードは無変更）を更新すると同時に、対象ファイルの identity へ書き込む。`refresh()` は毎回、対象ファイルの永続化データから `collapsedIds` を導出し直す（`deriveCollapsedIds`）——これにより、ファイル切り替え時に別ファイルの状態が混線する Phase 4E 以前の潜在バグも副次的に解消している。
- **ファイルリネーム**: `vault.on("rename")`（`main.ts`）が `FoldStateManager.handleRename(oldPath, newPath)` を呼び、保存済みマップのキーを新しいパスへ移行する。
- **flush のタイミング**: 通常はデバウン（500ms）で保存するが、`OutlineTreeView.onClose()` と `UnifiedOutlinerPlugin.onunload()` の両方で、デバウンス待ちの未保存分を明示的に flush する（`onunload` は同期 API のため fire-and-forget のベストエフォート）。
- **今回扱わないもの**: 見出し／list テキストのリネームによる fold state の引き継ぎ、別 section への relocate・見出しレベル変更による親替え時の引き継ぎ（いずれも既定状態＝展開へフォールバック）、同一ファイルを複数 leaf で同時に開いている場合の fold state 競合は Phase 4F の仕様に従って解決する。ファイル削除時の孤立エントリの GC、折りたたまれた祖先の自動展開、本文エディタの CM6 fold state との同期（従来どおり非対象）は対象外である。
- **パフォーマンス退行の修正（実機報告）**: Phase 4E 実装直後の実機確認で、サイドパネルのキーボード操作・本文カーソル同期がもたつく／効かないという報告を受けた。開発者ツールの Console には例外は出ておらず（No errors）、代わりに `[Violation] Forced reflow` と `setTimeout handler took 200ms 超` が確認された——これは refresh() 1回あたりのコストが Phase 4E で増えたことによるパフォーマンス退行であり、機能的なクラッシュではない。`buildNodeIdentityMap`（`tree/foldIdentity.ts`）を、section 用・list 用に分かれていた2回の全木走査から、1回の再帰走査に統合した（enclosing section のパスと list 用の occurrence カウンタを引数として下方向に引き回すことで、挙動は完全に不変のまま——既存テストは無変更で全通過）。また `scrollSelectedIntoView`（`view/OutlineTreeView.ts`）が `renderTree()` の DOM 再構築直後に同期的に `querySelector`/`scrollIntoView` を呼んでおり、強制 reflow の一因になっていたため、`requestAnimationFrame` 1フレーム分だけ遅延させるようにした（見た目の挙動は変えない）。
- **テスト**: `tests/foldIdentity.test.ts`（9件）、`tests/foldStateStore.test.ts`（15件）、`tests/foldStateAcceptance.test.ts`（11件——ファイル切替時の非混線、再起動相当のシリアライズ往復、move/indent 後の維持、リネーム時のフォールバック、既知の制限を production コードパスで end-to-end 検証する permanent regression test）。
- **フォーカス奪取バグの修正（実機報告）**: 上記のパフォーマンス修正後も「outline tree をカーソルで移動しても本文に変化がなく、操作しているうちに本文エディタへカーソルが移って移動してしまう」という報告が続いた。computer-use による実機再現で判明した根本原因は次のとおりである——行のクリックが呼ぶ `jumpToLine()`（`view/OutlineTreeView.ts`）が無条件に `editor.focus()` を呼んでおり、この view のキーボード操作ハンドラは `treeRootEl` にしか登録されていない（`onOpen()`）ため、クリック直後に DOM フォーカスが本文エディタへ奪われ、直後に押した ↑/↓ はパネルの `handleTreeKeyDown` に届かず本文エディタ自身のカーソル移動として処理されていた。修正として `jumpToLine` に `focusEditor` オプションを追加し、既定値 `true`（Enter/`activateSelection` はこれまでどおり本文へフォーカスを移す——仕様上の「Enter で本文へジャンプ」を維持）、行クリックのみ `focusEditor: false` を渡すようにした——本文カーソルの移動・スクロールは従来どおり行うが、フォーカスは `treeRootEl` 側に留める（クリック後も戻す）。これによりクリックで選択したあともパネルにフォーカスが残り、続けて ↑/↓ を押してもツリー側の選択移動として機能する。computer-use でクリック→↑/↓連打→選択が正しくツリー内で進み本文カーソルは動かないこと、Enter では従来どおり本文へフォーカスが移ることを実機で確認した。
- **本文ジャンプ時のスクロール位置を画面最上部に固定**: 上記のフォーカス奪取バグ修正の手動確認後、「フォーカスが移ったときに本文エディタの該当箇所が画面一番上部に来るようになってほしい」という要望を受けた。Obsidian 公開 API の `Editor.scrollIntoView(range, center?)` は `center` の真偽で「中央寄せ」か「最小限スクロール（既存のスクロール位置次第で結果がまちまち）」しか選べず、常に先頭行に来るとは限らない。そこで `view/OutlineTreeView.ts` に `scrollLineToTop(editor, line)` を新設し、Obsidian の `Editor` ラッパーが内部で保持する CM6 `EditorView`（`.cm` プロパティ——`obsidian.d.ts` には型定義されていない非公式だがエコシステム全体で長年安定して使われている慣行）を取得したうえで、CM6 自身の `EditorView.scrollIntoView(pos, { y: "start" })`（CM6 のネイティブ「先頭に揃える」プリミティブ）を直接 dispatch するようにした。`@codemirror/view` は Obsidian 本体が提供し esbuild の `external` にも指定済みのモジュールなので、この import は Obsidian 本体と同一のインスタンスを参照する、プラグインエコシステムで一般的な連携方法である。`.cm` が万一存在しない場合は従来の `scrollIntoView(..., true)`（中央寄せ）にフォールバックする。`jumpToLine()`（行クリック・Enter の双方が経由する）から呼び出すことで、両方の経路で同じ挙動になる。tsc・vitest（既存311件、無変更で全通過——この関数は Obsidian ランタイム依存のためテスト対象外）・build を確認し Vault へ反映後、computer-use でユーザーの実機 Obsidian 上で、大きくスクロールした状態からツリーの行をクリックすると対象行が画面最上部に来ること（先頭付近・末尾付近の双方で確認）を確認した。


## Fold State の競合解決（Phase 4F）

Phase 4F は完了している。複数の Outline Tree View または Partial Edit Pane が同じノートの fold state を更新する場合、競合を安全に解決し、ファイル単位で保持する状態を破壊しない。競合検出・解決規則・同期境界・既知の制限は `docs/fold-state-conflict-resolution-spec.md` を参照すること。

- Phase 4E のファイル単位永続化と node identity を基盤として用い、複数の更新経路で状態が競合しても fold state の保存形式を一貫して維持する。
- これは本文エディタの CM6 fold state を同期する機能ではない。Outline Tree View が管理するローカルな fold state の競合解決だけを扱う。

## コマンド

| コマンド ID | 名称 | 動作 |
| --- | --- | --- |
| `move-block-up` | Move block up (section / list subtree) | 現在のブロック（見出しなら section subtree 全体、リストならそのサブツリー）を、同レベルの兄弟の前へ移動する |
| `move-block-down` | Move block down (section / list subtree) | 同上、兄弟の後へ移動する |
| `move-node-only-up` | Move heading label up (current line only) | 現在の見出し行のテキストを、文書順で直前の見出し行と入れ替える。本文・子見出し・リストの位置は一切変わらない |
| `move-node-only-down` | Move heading label down (current line only) | 同上、文書順で直後の見出し行と入れ替える |
| `indent-block` | Indent block (list subtree / heading subtree) | 現在のブロックをインデントする（リスト: 直前の兄弟の子にする／見出し: 直前兄弟がある場合、そのセクション配下の全見出し（子セクションを含む）のレベルを揃えて1つ下げる） |
| `outdent-block` | Outdent block (list subtree / heading subtree) | 現在のブロックをアウトデントする（リスト: 親の最後の子のみ／見出し: そのセクション配下の全見出し（子セクションを含む）のレベルを揃えて1つ上げる） |
| `indent-node-only` | Indent heading level (current line only) | 現在の見出し行の `#` レベルのみを1つ下げる。子セクション・本文・後続ブロックは一切変更しない |
| `outdent-node-only` | Outdent heading level (current line only) | 現在の見出し行の `#` レベルのみを1つ上げる。子セクション・本文・後続ブロックは一切変更しない |
| `open-outline-tree-view` | Open outline tree view | 右サイドバーの Outline Tree View を開く（既存 leaf があれば再利用） |
| `open-partial-edit-pane` | Open partial edit pane for current section | カーソル位置の section を Partial Edit Pane（Phase 3B）に読み込んで開く。カーソルがリスト項目にある場合は no-op（`not-a-heading`） |

ホットキーは既定では割り当てていない。設定 → ホットキーから割り当てることを推奨する（例: `move-block-up/down` に `Alt+↑` / `Alt+↓`、`indent/outdent-node-only` に `Tab` / `Shift+Tab` 相当のキーなど）。

### node-only 系と block 系の使い分け

本文エディタ側のコマンドは、レベル変更（indent/outdent）・上下移動（move）のいずれも、意味が異なる2系統に明示的に分離されている。

- **node-only 系**（`indent-node-only` / `outdent-node-only` / `move-node-only-up` / `move-node-only-down`）— 現在の見出し行**だけ**を対象にする軽量操作。子セクション・本文・後続ブロックは一切見ない・動かさない。
  - レベル変更は見出し行の`#`の数だけを変える（唯一の制約はレベル範囲`#`〜`######`）。「`# Markdown A`を単独で`## Markdown A`にしたい」という用途に対応する。
  - 上下移動は、文書順で直前/直後にある見出し行の**テキストを入れ替える**（見出しレベルも含めて丸ごと入れ替わる）。同じレベルの兄弟か・親子関係にあるかは問わない。本文・子見出し・リストは元の位置に物理的に残ったまま動かないため、**見出しラベルだけを軽く並べ替えたいときの上級者向け操作**である。セクション全体（本文や配下構造ごと）を動かしたい場合は `move-block-up/down` を使うべきであり、node-only move を使うと一時的に見出しと本文の意味的対応が崩れうる（例: 別の階層にあった見出しラベルが飛んでくることで、その位置の本文の内容と噛み合わなくなる）ことに注意する。
- **block 系**（`indent-block` / `outdent-block` / `move-block-up` / `move-block-down`）— 現在の見出しを root とする section subtree 全体（本文・子見出し・配下リストを含む）を対象にする構造操作。headingがsubtree全体を代表するラベルであるという原則に従い、セクション単位の再構成を常に一体として行う。
  - レベル変更は対象セクション配下の全ての子孫セクションのレベルも同じ差分だけ変わり、相対的な階層関係は常に保たれる。制約は、indent は直前兄弟セクションが必要かつ subtree 内のどの見出しも6を超えないこと、outdent は対象セクション自身が1を下回らないことの2点のみである。
  - 上下移動は、subtree 全体を同レベルの兄弟セクションの前後へ移動する（内部の相対構造・本文・リストの並びは保持される）。兄弟セクションが存在しない場合は no-op である。リスト項目の場合も同様にサブツリー単位で移動する（既存 MVP の挙動を維持）。

いずれのコマンドも、fold（折りたたみ）状態によって挙動を変えない。fold state に応じて既定の操作対象を変える「contextual」な挙動（`move-contextual-up/down` 等）は、本文エディタ側には導入せず、将来の別ペイン型アウトラインビュー（Phase 2C）でのみ採用する方針である。

コマンド ID は既存の `move-block-up` / `move-block-down` / `indent-block` / `outdent-block` から変更していないため、割り当て済みのホットキーに影響はない。`move-node-only-up` / `move-node-only-down` / `indent-node-only` / `outdent-node-only` は新規追加の ID であり、既存の互換性を壊す変更ではない。

## 移動対象の解決規則（block 系: `move-block-up/down`）

カーソル行の種別に応じて、移動対象ブロックを次のように解決する。

| カーソル行 | 移動対象 |
| --- | --- |
| リスト行 | そのリスト項目のサブツリー（子項目・継続行を含む） |
| 見出し行 | そのセクション全体（下位セクションを含む） |
| 本文行 | 所属するセクション全体 |
| コードブロック内 | no-op |
| frontmatter 内 | no-op |

## 移動規則（block 系: `move-block-up/down`）

- 同種の隣接兄弟ブロックが存在する場合は、範囲の切り出し + 再挿入によって兄弟と入れ替える（行単位 swap ではない）。ブロック間の空行は位置を保持する。
- ルートのリスト項目が移動方向に兄弟を持たず、見出しに隣接している場合は、見出しを飛び越えて隣のセクションへ移動する（section 境界の横断）。設定で無効化できる。
- セクションは親セクションの境界を越えない。兄弟セクションがなければ no-op である。
- 複数カーソル時は no-op である。
- タブとスペースが混在した危険なインデントを検出した場合は、警告を表示して no-op とする。
- ordered list は移動後、影響を受けた連続リスト領域内でマーカーを `1.` に正規化する（MVP 方針。レンダラーが自動連番するため表示は保たれる）。

## 移動規則（node-only 系: `move-node-only-up/down`）

- 対象はカーソル位置から解決される見出し（section）のみである。リスト行にカーソルがある場合は no-op である（`not-a-heading`）。
- 「前後の見出し行」は、レベルや親子関係を問わず、文書順で直前・直後にある見出し行を指す。同じレベルの兄弟である必要はない。
- 入れ替えるのは見出し行の**テキスト全体**（`#` の数を含む）のみであり、本文・子見出し・配下リストは元の行位置から一切動かない。
- 文書内で最初の見出しに対する `move-node-only-up`、最後の見出しに対する `move-node-only-down` はいずれも no-op である。
- 複数カーソル時、frontmatter 内、コードブロック内は no-op である（block 系と共通の解決規則に従う）。

## 設定

| 設定 | 既定値 | 説明 |
| --- | --- | --- |
| Allow list moves across sections | on | リストの section 境界横断を許可する |
| Normalize ordered list markers to "1." | on | 移動後に ordered マーカーを `1.` へ正規化する |
| Show no-op notices | on | no-op の理由を Notice で表示する |
| Show list items in Outline Tree View | off | Outline Tree View に list 項目もノードとして表示する（Phase 3C）。切り替えると開いている Outline Tree View 全てが即座に再描画される |
| Follow keyboard selection into body editor | on | Outline Tree View を矢印キーで操作したとき、選択が別ノードへ移動するたびにクリック時と同様に本文エディタも追従させる。オフにすると Phase 4D 時点の旧挙動（矢印キーはツリー内の選択のみ、Enter のときだけ本文へジャンプ）に戻る（詳細は「Outline Tree View のキーボード操作」参照） |

## アーキテクチャ

Obsidian API に依存する層は `main.ts`（コマンド接続）・`view/OutlineTreeView.ts`（サイドバー UI）・`view/PartialEditView.ts`（Phase 3B のサイドバー UI）・`view/activeMarkdownViewTracker.ts`（両 View が共有するアクティブノート解決）・`commands/applyLineEditOutcome.ts`（複数呼び出し元が共有するエディタ適用層）・`persistence/foldStateManager.ts`（Phase 4E: fold state の debounce 保存・flush・rename 追従）の6つのみである。それ以外（`model/` / `parser/` / `resolver/` / `move/` / `level/` / `tree/` / `edit/` / `persistence/foldStateStore.ts`）はすべて純粋関数であり、ユニットテストできる。

```
src/
  main.ts                      # コマンド接続（Obsidian 依存層）
  settings.ts                  # 設定タブ
  commands/applyLineEditOutcome.ts  # outcome → エディタ反映の共有ロジック（Obsidian 依存層）
  model/block.ts               # BlockNode / ParsedDocument 型定義
  parser/parseDocument.ts      # 軽量な行走査パーサ（差し替え可能）
  resolver/resolveCurrentBlock.ts  # カーソル行 → 移動対象ブロック
  move/findMoveTarget.ts       # block 系 move の移動先決定（swap / insert / none）
  move/moveBlock.ts            # block 系 move の適用（範囲切り出し + 再挿入）
  move/findNodeOnlyMoveTarget.ts  # node-only 系 move の可否判定（文書順で前後の見出し行を探す）
  move/moveNodeOnly.ts         # node-only 系 move の適用（見出し2行のテキスト入れ替えのみ）
  move/findIndentTarget.ts     # block 系 indent/outdent 可否の判定（safe structural editing）
  move/indentBlock.ts          # block 系 indent/outdent の適用（safe structural editing）。collectSectionSubtree / growIndent / shrinkIndent を export
  move/relocateSection.ts      # Phase 3A: section subtree を任意の位置（before/after/inside）へ再配置する純粋関数。canDropOn も export
  move/relocateListSubtree.ts  # Phase 4A: list item subtree を任意の位置（list/section target、before/after/inside）へ再配置する純粋関数。canDropListOn も export
  move/renumber.ts             # ordered マーカー正規化
  level/direction.ts           # IndentDirection 型（node-only / block 系共通）
  level/headingLevel.ts        # 見出し1行の # 増減プリミティブ（±1: changeHeadingLevel／任意レベル直接指定: setHeadingLevel）
  level/findNodeOnlyLevelTarget.ts  # node-only 系 見出しレベル変更の可否判定
  level/setNodeOnlyLevel.ts    # node-only 系 見出しレベル変更の適用
  tree/buildOutlineTree.ts     # ParsedDocument → アウトラインツリー（section / list の判別共用体、Phase 2A のデータモデル。Phase 3C で includeLists オプションを追加）
  tree/resolveHighlightedSectionId.ts  # カーソル行 → ハイライト対象ノード id（resolveHighlightedNodeId が本体、Phase 3C で list 対応。resolveHighlightedSectionId はその section-only 版として存続）
  tree/treeOperation.ts        # TreeStructureOperation 型（block/node-only/contextual dispatch 共通）
  tree/treeBlockCommand.ts     # Phase 2B: ツリーノード id → block 系 move/indent の実行（純粋関数）
  tree/treeNodeOnlyCommand.ts  # Phase 2C: ツリーノード id → node-only 系 move/indent の実行（純粋関数）
  tree/treeContextualCommand.ts  # Phase 2C: fold state（ツリーの折りたたみ）で block/node-only を振り分ける純粋関数
  tree/outlineNavigation.ts    # キーボード操作: fold-aware な可視ノード列挙（flattenVisibleOutlineTree）、id → ノード/親 id の map 構築、Up/Down の次/前 id 解決（nextVisibleId/prevVisibleId）、本文追従の可否判定（shouldFollowKeyboardSelectionIntoBody）
  tree/foldIdentity.ts         # Phase 4E: node.id → 内容ベースの永続 identity（buildNodeIdentityMap、ラベルの祖先パス方式。section は祖先セクション全体、list は直近の囲む section 単位でスコープ）
  edit/partialEdit.ts          # Phase 3B: section subtree の抽出（extractSectionText）と置換（applySectionEdit、競合検出つき）。Phase 4C で section/list 両対応の extractSubtreeText / applySubtreeEdit を追加（extractSectionText はその薄いラッパーとして再実装、挙動は不変）
  edit/listBodyRange.ts        # Phase 4B: list item自身の本文範囲の抽出（collectListItemBodyLines）と tooltip 用整形（formatListItemBodyLines） / 合成 extractListItemBodyText
  persistence/foldStateStore.ts  # Phase 4E: FoldStateData（Record<filePath, string[]>）に対する純粋関数（normalizeFoldStateData / getCollapsedIdentities / withNodeCollapsed / withFileRenamed）
  persistence/foldStateManager.ts  # Phase 4E: FoldStateManager（Obsidian 依存層）。plugin 全体で共有する1インスタンス、debounce 保存・flush・vault rename 追従
  view/OutlineTreeView.ts      # サイドバー ItemView（Phase 2A 表示 + Phase 2B/2C 右クリックメニュー + Phase 3A/4A drag & drop + Phase 4B tooltip 拡張 + Phase 4C list 用 Partial Edit Pane メニュー + ↑/↓/←/→/Enter キーボード操作 + Phase 4E fold state 永続化、Obsidian 依存層）
  view/PartialEditView.ts      # Phase 3B: Partial Edit Pane の ItemView（Obsidian 依存層）。Phase 4C で section/list 両対応（loadNode / applyEdit）へ一般化
  view/activeMarkdownViewTracker.ts  # OutlineTreeView / PartialEditView 共通のアクティブ Markdown View 解決（Phase 3B で共通化）
tests/                         # vitest によるユニットテスト（311 件）
styles.css                     # Outline Tree View / Partial Edit Pane の独自スタイル + Style Settings 用 @settings ブロック
```

`level/` は `move/` から独立したディレクトリであり、本文側と同じ純粋関数（`findNodeOnlyLevelTarget` / `setNodeOnlyLevel` / `changeHeadingLevel`）をOutline Tree View側からもそのまま再利用できるように切り出してある。同様に `move/findNodeOnlyMoveTarget.ts` / `move/moveNodeOnly.ts` も Obsidian API に依存しない純粋関数である。この再利用は Phase 2C で実際に行われている — `tree/treeNodeOnlyCommand.ts` はこれらの関数を呼ぶだけの薄いラッパーであり、`tree/treeContextualCommand.ts` の fold-aware 振り分け（ノードが開いている場合の既定）から使われる。

パーサは意図的に CommonMark 完全準拠ではない軽量実装であり、`ParsedDocument` の形を保ったまま AST ベースの実装へ差し替えられる。

## 開発

```bash
npm install
npm test          # vitest によるユニットテスト
npm run build     # 型チェック + esbuild で main.js を生成
npm run dev       # watch ビルド
```

開発中のVaultへの配置には、ビルド後の3ファイルをコピーする`deploy:dev`を使える。`OBSIDIAN_VAULT`には自分のVaultへのパスを指定する。

```bash
OBSIDIAN_VAULT="$HOME/path/to/your/vault" \
  npm run deploy:dev
```

このコマンドは `manifest.json` / `main.js` / `styles.css` だけを `<vault>/.obsidian/plugins/unified-outliner/` に配置する。ソースリポジトリ自体は Vault の外に置き、Vault 内には生成済みのプラグイン成果物だけを置く。手動インストールでも同じ3ファイルを配置する。

## 技術資料

1. **設計上の着想**: WZ Editor / WZ Writing Editor は歴史的な着想源にとどまる。Unified OutlinerはWZ Softwareとの提携・承認・互換性を示すものではなく、WZの資料を同梱・配布しない。
2. **[Mixed Structure 境界ルール仕様](docs/mixed-structure-spec.md)**: 見出し・段落・listが連続するmixed structureで、section/list subtreeが含む範囲と既知の制限を定義する。
3. **[Fold State Persistence & Synchronization仕様](docs/fold-state-spec.md)**: ファイル単位のfold state永続化、node identity、同期経路、既知の制限を定義する。
4. **[Fold State競合解決仕様](docs/fold-state-conflict-resolution-spec.md)**: 複数ViewまたはPartial Edit Paneによるfold state更新の競合解決、同期境界、既知の制限を定義する。

本プラグインでは、(a) headingはsection subtree全体を代表するラベルであり見出し行だけを動かさないこと、(b) 操作対象は行ではなくblockであること、(c) 相対移動ロジック（`findMoveTarget`）と将来のdestination解決ロジックを分離すること、(d) 命名に`line`ではなく`block` / `section` / `subtree`を優先することを、独自の構造編集原則として採用している。

## 今後の実装

今後の機能方針は[ROADMAP.ja.md](ROADMAP.ja.md)を参照。
