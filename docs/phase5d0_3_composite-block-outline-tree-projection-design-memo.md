# Phase 5D-0.3 設計メモ — CompositeBlock の Outline Tree 投影

作成日: 2026-08-12
状態: **実装完了(2026-08-12)。承認済みの確定事項と実装結果は §7 を参照。**
対象: `src/tree/buildOutlineTree.ts`, `src/tree/foldIdentity.ts`, `src/tree/outlineNavigation.ts`,
`src/tree/resolveHighlightedSectionId.ts`, `src/view/OutlineTreeView.ts`, `src/model/compositeBlock.ts`,
`src/settingsDefaults.ts`, `src/settings.ts`, `src/i18n.ts`

## 0. 前提の確認

依頼どおり、本チケットでは調査と設計メモの提示のみを行い、ソースコードは一切変更していない。
Stage 0〜2 で実装した基本 block 拡張（`thematic-break`）と CompositeBlock の解析・規則評価・
既定プリセット（`src/model/compositeBlock.ts`, `src/parser/compositeBlocks.ts`,
`src/settingsDefaults.ts` の `compositeBlocks` 設定）はそのまま維持しており、本メモが提案する
変更はすべて「追加」であって、Stage 0〜2 の実装を書き換えるものではない。

## 1. 現行 Outline Tree の関連実装(調査結果)

### 1.1 Tree 構築(`tree/buildOutlineTree.ts`)

- `OutlineTreeNode` は `kind: "section" | "list"` の判別共用体。`buildOutlineTree(doc, {includeLists})` が
  `doc.topLevelIds` から再帰的に構築する。section/list が混在する `childIds` は行番号で再ソートしてから
  子ノード配列を作る(`buildChildren`)。
- `isOutlineSectionNode`/`isOutlineListNode` という type guard がエクスポートされ、
  `view/OutlineTreeView.ts` 側で **6箇所** 分岐に使われている(rendering、右クリックメニュー、
  モバイル長押しメニュー)。CompositeBlock を第三の `kind` として追加する場合、この6箇所すべてを
  見直す必要がある。

### 1.2 fold identity(`tree/foldIdentity.ts`)

- `nodeLabel()` と `buildNodeIdentityMap()` の内部 walk は **`if (node.kind === "section") {...} else {...}`**
  という二値分岐になっている(`else` 側が list 用パスとしてハードコードされている)。
  CompositeBlock を追加すると、この2箇所は **`switch`/3分岐へ書き換えが必須** であり、
  素朴に「else」へ滑り込ませると composite ノードが誤って list 用の識別ロジック
  (label = `node.text` 前提)を通ってしまい、`node.text` が存在せず実行時エラーになる。
  **これは本フェーズ最大の実装リスク箇所として明記する。**
- list ノードの identity は「直近の enclosing section のパス + 自身のラベル」というスコープ
  (section 全体の祖先パスではない)。CompositeBlock も同じスコープ設計を踏襲するのが自然(§3.4)。

### 1.3 カーソル同期(`tree/resolveHighlightedSectionId.ts`)

- `resolveHighlightedNodeId(doc, cursorLine, {includeLists})` は `BlockNode`(section/list)のみを
  対象にしており、`ComplexBlockInfo`/`CompositeBlockInfo` を一切参照しない。
- fold 中の子孫がハイライト対象になった場合、既存実装は「id は解決されるが、行が畳まれていて
  DOM 行が存在しないため見た目には何も起きない」という挙動(bubbling して親を光らせる、
  という特別処理はしていない)。CompositeBlock でもこの **既存の挙動をそのまま踏襲** すれば、
  新規ロジックを追加する必要がない(§3.5)。

### 1.4 キーボードナビゲーション(`tree/outlineNavigation.ts`)

- `flattenVisibleOutlineTree`/`buildNodeByIdMap`/`buildParentIdMap`/`nextVisibleId`/`prevVisibleId` は
  すべて `.id`/`.children` のみに依存する **kind 非依存の純粋関数**。CompositeBlock を追加しても
  **これらは無改修で動作する** — 唯一のリスクなしポイント。

### 1.5 描画・イベント(`view/OutlineTreeView.ts`)

- `refresh()` は debounce 150ms で `editor-change`/`active-leaf-change`/`file-open`/keyup/mouseup
  のたびに **フルパース** (`parseDocument` → `buildOutlineTree` → `buildNodeIdentityMap` →
  `deriveCollapsedIds`)を毎回やり直す設計。`scanComplexBlocks`/`matchCompositeBlocks` を
  ここに追加しても、既存と同じ「毎回フルスキャン」方針に自然に乗る(§3.6 でコスト面を検討)。
- `renderNode()` は section/list を **同じ行構造** (chevron・ラベル・クリック・fold)で描画し、
  `isOutlineSectionNode`/`isOutlineListNode` の分岐は「見出しレベル別スタイル vs list muted text」
  「右クリックメニューの出し分け」「モバイル長押しメニューの出し分け」の3箇所に限定される。
  drag & drop・inline rename・削除/挿入はこの2種にのみ張られており、CompositeBlock 側は
  Stage 0〜2 のとおり **今回もこれらの対象外**(§4 非目標)。

## 2. 用語とモデルの再確認

指示書の「複合化条件」は Stage 2 で実装済みの `matchCompositeBlocks` の必須条件と一致している。
ただし指示書は種別列の表記を `single-line-list, callout` としており、Stage 2 の実装は
`kindSequence: ["list", "callout"]` + `requireSingleLineList: true` という2フィールドの組み合わせで
同じ制約を表現していた。本メモでは指示書の表記に合わせ、**`CompositeMemberKind` に
`"single-line-list"` を独立した値として追加し、`requireSingleLineList` フラグを廃止する**
リファインメントを提案する(§3.1)。これは Stage 2 で承認済みの必須条件そのものは一切変更せず、
表現方法(スキーマ)だけを指示書の語彙に合わせる変更である。

## 3. 設計提案

### 3.1 `CompositeBlockRule` スキーマの拡張(`model/compositeBlock.ts`)

```ts
export type CompositeMemberKind = ComplexBlockKind | "list" | "single-line-list" | "section";

export interface CompositeBlockRule {
  id: string;              // 例: "image-ocr"
  kindSequence: CompositeMemberKind[]; // 例: ["single-line-list", "callout"]
  displayName: string;     // 例: "画像+OCR"（Tree 表示・設定 UI 両方で使う）
  prefix: string;          // 例: "◉"（Tree 上でラベルの前に付ける短い記号）
  label: string;           // 既存: 設定 UI の英語ラベル（i18n の en フォールバック用に維持）
}
```

- `requireSingleLineList?: boolean` は削除し、`"single-line-list"` という kind 自体で意味を持たせる。
  マッチャー側(`parser/compositeBlocks.ts`)は `candidate.kind` を決める際、list 候補を
  「1行完結なら `"single-line-list"`、そうでなければ `"list"`」の2種類に分けて候補配列へ積む
  ように変更する(現行は常に `"list"` 一種類)。
- 既定プリセットの id・displayName・prefix は指示書のとおりに更新する:
  `image-ocr`(`["single-line-list","callout"]`, `画像+OCR`, `◉`)、
  `image-blockquote`→ **`image-quote`**(`["single-line-list","blockquote"]`, `画像+引用`, `❖`)。
- **この機能は未リリース(コミット済みでない)**なので、`settingsDefaults.ts` の
  `CompositeBlockSettings`(現行 `listCallout`/`listBlockquote`)も
  `imageOcr`/`imageQuote` に合わせてリネームして問題ない(後方互換の懸念なし)。

### 3.2 `OutlineTreeNode` への第三の kind 追加(`tree/buildOutlineTree.ts`)

```ts
export interface OutlineTreeCompositeNode {
  kind: "composite";
  id: string;               // CompositeBlockInfo.id をそのまま使う
  ruleId: string;
  label: string;            // rule.displayName
  prefix: string;           // rule.prefix
  line: number;              // members[0] の開始行(ジャンプ先)
  children: OutlineTreeNode[]; // §3.3 参照
}
export type OutlineTreeNode = OutlineTreeSectionNode | OutlineTreeListNode | OutlineTreeCompositeNode;
```

- `isOutlineCompositeNode()` type guard を追加。既存の `isOutlineSectionNode`/`isOutlineListNode` は
  無変更(呼び出し側は「該当しなければ何もしない」という判定にしているため、第三の kind が
  増えても既存呼び出し箇所は壊れない — ただし新しい分岐を追加する場所は本メモ§3.7で列挙する)。

### 3.3 member 行の扱い(要判断・2案)

CompositeBlock を展開したときに member(list item / callout)自身の行を Tree 上に見せるかどうかは
未確定。2案を提示する。

**案A(推奨): CompositeBlock は「折りたたみ可能な親」とし、展開すると member 行が子として見える**

- `composite.children` = member 由来の行(list item は既存の `buildListNode` をそのまま再利用でき、
  callout/blockquote は今回新たに **読み取り専用のプレースホルダー行**(クリックでジャンプのみ、
  右クリックメニューも drag & drop も無し)として最小限描画する。
- 利点: 折りたたむと `◉ 画像+OCR` の1行に要約され、展開すると中身(list item・callout の要約)を
  確認できる。list item 自体は既存の rename/drag & drop がそのまま使える(member 化しても
  `ListBlockNode.id` は変えないため)。
- 欠点: callout 側の「読み取り専用の子行」という、今までなかった種類の行を新設する必要がある
  (Stage 1 の非目標だった「callout の Tree 追加・削除 UI」とは別物 — あくまで
  読み取り専用の表示行であり、構造編集 UI ではない)。

**案B: CompositeBlock は子を持たない単一行(常に閉じたまま、展開UIなし)**

- 実装はシンプルだが、折りたたんでいる間は元の list item 行が Tree から消えるため、
  list item 単体の rename/drag & drop が composite 化された瞬間に使えなくなる
  (grouped 中は個別操作ができないというUXになる)。

**本メモは案Aを推奨する** が、この判断はTree UXに直結するため承認を待つ。

### 3.4 fold identity(`tree/foldIdentity.ts`)

- `nodeLabel()`/`buildNodeIdentityMap()` の walk を3分岐に拡張する:
  `kind === "section"` → 既存、`kind === "list"` → 既存、`kind === "composite"` → **list と同じ
  スコープ(直近の enclosing section のパス + 自身のラベル)を共有する新しい occurrence プールに
  参加させる**(list と同じプールを共有するか、別プールにするかは実装時に決める — 別プール推奨:
  「同じ section 内に同名の list item と同名の composite が同時に存在する」という取り違えを避けるため)。
- 案A(§3.3)を採用する場合、member として組み込まれた list item 自身の identity は
  **従来どおり単独の list ノードとして計算する**(member であることは identity に影響させない)
  — こうすることで、後日ユーザーが本文編集で composite の条件を崩した場合(例: 間に空行を入れる)、
  次回解析時に composite は消え、member の list item は元の identity のまま fold 状態を保持できる
  (指示書の「本文編集によって条件が崩れた場合、次の解析時に CompositeBlock は自然に解消される」
  という前提を、fold 状態の面でも矛盾なく満たす)。

### 3.5 カーソル同期・ハイライト

- `resolveHighlightedNodeId` は変更しない。カーソルが member(list item / callout)の範囲内にあれば、
  引き続きその member 自身の id を返す。
- CompositeBlock が **折りたたまれている場合**、ハイライト対象の行が非表示になる(§1.3で確認した
  既存の section/list と同じ挙動)。「折りたたまれた composite 自体をハイライトする」特別処理は
  追加しない — 既存の一貫した挙動を壊さないための意図的な選択。

### 3.6 Tree 構築への組み込みと再計算コスト

- `buildOutlineTree` に `includeCompositeBlocks?: boolean` オプションを追加。true のときのみ
  `scanComplexBlocks(doc)` → `getEnabledCompositeBlockRules(settings.compositeBlocks)` →
  `matchCompositeBlocks(doc, complexScan, rules)` を実行し、マッチした member の id を
  通常の `buildChildren` の結果から composite ノードへ差し替える。
- **表示条件は `showListItemsInOutline` から独立させる**(推奨): CompositeBlock の視認性は
  「生の list item を見せるかどうか」とは別の関心事であるため、新設の
  `settings.showCompositeBlocksInOutline`(既定 **false** — 他の全 Tree 機能と同じ「新機能は
  opt-in」方針を踏襲)で制御する。オンにした場合、`includeLists` の設定に関わらず
  composite に組み込まれた list item は composite の子として表示され、composite に
  組み込まれなかった素の list item は `showListItemsInOutline` の設定に従う。
- コスト: `scanComplexBlocks`/`matchCompositeBlocks` は行数に対して線形の純粋関数であり、
  既存の `parseDocument`/`buildOutlineTree` と同じ「refresh() のたびにフル再計算」方針にそのまま
  乗せて問題ない(Stage 0〜2 のテストで大きめの fixture でも実用的な速度を確認済み)。
  設定オフ時はこの2関数を一切呼ばないため、既存ユーザーへの性能影響はゼロ。

### 3.7 `view/OutlineTreeView.ts` への影響箇所(実装時のチェックリスト)

調査で確認した、`isOutlineSectionNode`/`isOutlineListNode` で分岐している6箇所と、
CompositeBlock 追加時に取るべき挙動:

1. `renderNode()` のラベル描画分岐 → **新規分岐追加**(prefix + displayName)。
2. 右クリックメニュー(`showStructureCommandMenu`/`showListCommandMenu`) → **分岐を追加しない**
   (composite には非表示。§4 非目標)。
3. モバイル長押しメニュー → 同上、**非表示**。
4. `draggable` 属性 → composite には **付与しない**(§4 非目標)。
5. dblclick(inline rename) → composite には **付与しない**(§4 非目標)。
6. drag&drop の `dragstart`/`dragover`/`drop`/`dragend` ハンドラ → composite には **付与しない**。

member として組み込まれた list item 行(案A採用時)は、**通常の list 行と全く同じ**
イベント・分岐をそのまま使う(rename/drag&drop とも従来どおり機能させる)。

## 4. 今回(Phase 5D-0.3 設計段階)の非目標

- CompositeBlock の move・indent/outdent・drag & drop。
- CompositeBlock の Partial Edit Pane 統合。
- CompositeBlock を跨いだ複数選択・一括操作。
- 規則(kindSequence・prefix・displayName)をユーザーが自由編集できる UI —
  今回も「既定プリセットの有効/無効」トグルのみを維持する(Stage 2 の方針を継続)。
- callout member 行(案A採用時)の構造編集(移動・削除・追加) — あくまで読み取り専用の表示行。
- ネストした CompositeBlock(CompositeBlock 自体を member にする規則)。

## 5. 承認が必要な論点(未確定)

1. **§3.3 の案A/案B**: member 行を展開時に見せるか(案A・推奨)、常に単一行に畳んだままにするか(案B)。
2. **§3.1 のスキーマ変更**: `requireSingleLineList` フラグ廃止 → `"single-line-list"` kind 化、
   および rule id/設定キーのリネーム(`listCallout`→`imageOcr` 等)。未リリースのため後方互換の
   制約はないと判断しているが、確認したい。
3. **§3.6 の表示トグル**: `showListItemsInOutline` から独立した新設定
   `showCompositeBlocksInOutline`(既定 false)を追加する方針でよいか。
4. **prefix の表現方法**: ラベル文字列に直接連結する(`"◉ 画像+OCR"` 的なテキスト)か、
   CSS で分離した専用 `<span>` にするか(スタイル変更・アクセシビリティ上の理由で後者を推奨)。
5. **i18n**: `displayName`(「画像+OCR」「画像+引用」)は指示書が明示した日本語文言であり、
   プロジェクトの「生成 UI 文言は英語既定」方針(2026-08-11確定)の例外として扱ってよいはずだが、
   `language: "en"` 設定時のフォールバック英語文言(例: "Image + OCR" / "Image + Quote")を
   別途 `i18n.ts` に用意するかどうかを確認したい。

## 6. 関連ドキュメント

- `docs/phase5d0_basic-block-extension-and-composite-block-spec.md` — Phase 5D-0(Stage 0〜2)の確定仕様。
- `docs/phase5c_block-model-and-tree-display-spec.md` — Phase 5C scanner 基盤、Tree統合を Phase 5D 以降に持ち越した経緯。

## 7. 実装結果(2026-08-12 完了)

§5 の5論点は、ユーザーからの実装承認メッセージで以下のとおり確定し、その方針で実装した(詳細は
`統合実装ロードマップ_2026-08-05.md` §3.7)。

1. **member 行の表示**: 案A(展開時に表示)を採用。ただし承認時に「member 行も CompositeBlock 親も
   今回は一切の書き戻し操作を持たない」という、本メモの想定より厳格な条件が追加された。§3.3 の
   「member 行は通常の list 行と全く同じ」という前提(200行目)は **採用せず**、member 行も読み取り
   専用にした(§3.7 参照)。
2. **スキーマ変更**: 承認どおり実装。`requireSingleLineList` 廃止 → `CompositeMemberKind` に
   `"single-line-list"` を追加、`listCallout`/`listBlockquote` → `imageOcr`/`imageQuote`、
   `list-blockquote` → `image-quote` にリネーム。
3. **表示トグル**: 独立トグル `showCompositeBlocksInOutline` は **不採用**。各既定規則自身の
   `enabled` フラグが投影可否を兼ねる一本化方式を採用(承認事項§4)。
4. **prefix の表現**: 専用 `<span>` 方式(推奨案どおり)を採用。`CompositeBlockRule.prefix` は
   モデルレベルの文字列フィールドとして保持し、`view/OutlineTreeView.ts#renderNode` が
   `<span class="unified-outliner-composite-prefix">` として描画する。空 prefix の場合はこの
   `<span>` 自体を生成しない。
5. **i18n**: 組込み規則の表示名は `compositeBlock.imageOcr.displayName`/
   `compositeBlock.imageQuote.displayName` という i18n キー経由で解決し、英語(`Image + OCR`/
   `Image + Quote`)・日本語(`画像+OCR`/`画像+引用`)の両方を用意した。ハードコードされた生文字列は
   settings/model 層のどこにも残していない。

### 7.1 2026-08-12 追加要件(A〜E)の反映

実装承認メッセージの後、同日中に続きの要件(A: Tree model の詳細、B: foldIdentity.ts の三分岐化、
C: 表示・イベント、D: 再解析と解消、E: 非目標の徹底)が追加で届いた。本メモ §3 の技術方針を
そのまま実装した一次実装に対し、以下を追加で反映している:

- **§A 安全なフォールバック**: member が一つの親投影位置を安全に共有できない CompositeBlock は
  Tree に投影しない安全弁を `tree/buildOutlineTree.ts#isCompositeSafelyProjectable`(内部関数)
  として新設。
- **§A 読み取り専用の明示**: `aria-readonly`/`data-readonly` 属性を読み取り専用行に明示的に付与。
  判定ロジック自体も `tree/buildOutlineTree.ts#collectReadOnlyOutlineNodeIds`(公開・純粋関数)へ
  切り出し、Obsidian 依存なしに単体テスト可能にした。
- **§B 三分岐化**: 本メモ §1.2 が最大リスクとして指摘した二値分岐は、実装当初から `switch` による
  4分岐(section/list/composite/complex-member)で解消済み(`tree/foldIdentity.ts`)。
- **§C child のフォールバック文言**: callout/blockquote の実体ラベルが推定できない場合の
  フォールバックを、汎用の「(空)」から種別ごとの「Callout」/「コールアウト」・「Quote」/「引用」に
  変更(`complexMemberDisplayLabel`)。
- **§E 非目標の徹底**: `beginRenameForNode`/`showStructureCommandMenu`/`showListCommandMenu` の
  各入口に `readOnlyNodeIds` による二重ガードを追加。F2 キーボードショートカットや
  「挿入直後の自動 rename」など、行単位の DOM リスナーを経由しない入口からの到達も安全に拒否する。

詳細な実装ファイル一覧・データフロー・検証結果は最終報告(会話ログ)および
`統合実装ロードマップ_2026-08-05.md` §3.7 を参照。
- `docs/統合実装ロードマップ_2026-08-05.md` §3.6 / §4 — Phase 5D-0 の位置づけと Phase 5D 以降の未確定事項一覧。
