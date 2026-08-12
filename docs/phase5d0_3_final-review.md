# Phase 5D-0.3 最終レビュー資料

作成日: 2026-08-12
状態: **§9 の論点1〜6 反映済み(2026-08-12)。論点7 は「現状維持」の判断を受け、追加変更なし。**
対象コミット: 未コミット(作業ツリー、`git log -1` = `e32927d`)

## 0. §9 論点への回答と反映状況(2026-08-12 追記)

| 論点 | 判断 | 反映 |
| --- | --- | --- |
| 1(冗長チェック) | 適用してよい | ✅ 反映済み — `isCompositeSafelyProjectable` から先頭 member の重複 `doc.nodes` 参照を削除。 |
| 2(ruleId 検証) | ruleId 解決もチェックに含める | ✅ 反映済み — `isCompositeSafelyProjectable` に `rules` 引数を追加し、`getCompositeBlockRuleById` で解決できない composite は投影しない。 |
| 3(doc comment) | 適用してよい | ✅ 反映済み — `BuildOutlineTreeOptions.composites` に安全フィルタの存在を明記。 |
| 4(誤参照) | 適用してよい | ✅ 反映済み — `compositeBlockPrefix` という存在しない関数名への参照を、実際の呼び出し元(`buildCompositeNode`/`renderNode`)に訂正。 |
| 5(到達不能フォールバック) | 適用してよい | ✅ 反映済み — `buildMemberNode` の raw-id フォールバックに、現状は到達不能である旨のコメントを追加。 |
| 6(CSS クラス名) | (質問対象外、レビュー内で「据え置き推奨」と判断) | 据え置き。 |
| 7(防御の範囲) | 現状維持 | 変更なし — `beginRenameForNode`/両メニュー関数以外への `readOnlyNodeIds` ガード追加は見送り。 |

反映後(ruleId 未解決ケースのテスト1件を追加した上で)、`npm test` は **39 files / 568 tests**
全通過、`npx tsc -noEmit -skipLibCheck`・`npm run build` はエラーなし、`npm run lint` はエラー0・
警告2件(`settings.ts` の Obsidian API 非推奨警告、本レビューとは無関係の既存警告)のみ。

このドキュメントは、Phase 5D-0.3(CompositeBlock の Outline Tree 投影、および同日追加された
A〜E 要件)の実装完了後、コミット前に行った自己レビューの記録である。

---

## 1. 変更した公開・内部 API と各責務

### 1.1 `src/tree/buildOutlineTree.ts`(中心的な変更)

| API | 種別 | 責務 |
| --- | --- | --- |
| `OutlineTreeCompositeNode` | 公開 interface | CompositeBlock を投影した Tree ノード。`id`/`ruleId`/`label`/`prefix`/`line`/`children` を保持。 |
| `OutlineTreeComplexMemberNode` | 公開 interface | callout/blockquote など、他に Tree 表現を持たない member の読み取り専用行。 |
| `isOutlineCompositeNode` / `isOutlineComplexMemberNode` | 公開 type guard | 既存の `isOutlineSectionNode`/`isOutlineListNode` と対になる判別関数。 |
| `BuildOutlineTreeOptions.composites` | 公開 option | 既に計算済みの `CompositeBlockInfo[]`/`complexBlocksById`/`rules` を受け取り、投影を行うかどうかを切り替える。 |
| `complexMemberDisplayLabel` | 公開関数 | callout/blockquote のラベル推定(タイトル→本文→種別別フォールバック)。 |
| `collectReadOnlyOutlineNodeIds` | 公開・純粋関数(新設) | 構築済み Tree を1回走査し、読み取り専用にすべき node id 集合を返す。`view/OutlineTreeView.ts` の描画層と Obsidian 非依存に同じ判定を共有する。 |
| `isCompositeSafelyProjectable` | 内部関数(新設) | ある CompositeBlockInfo を Tree に投影してよいかどうかの安全判定(§6 参照)。 |
| `buildMemberNode` / `buildCompositeNode` | 内部関数 | CompositeBlockMember / CompositeBlockInfo を OutlineTreeNode へ投影する純粋変換。 |
| `buildListNode` / `buildChildren` | 内部関数(改修) | 通常の list/section 構築に、composite 差し替えロジックを追加。 |

### 1.2 `src/tree/foldIdentity.ts`

`nodeLabel()` と `buildNodeIdentityMap()` の内部 walk を、`kind` に対する **exhaustive `switch`**
(section/list/composite/complex-member の4分岐)に統一。`OccurrencePools` interface と
`freshPools()` ヘルパーを新設し、kind ごとに独立した occurrence カウンタを持たせた。

### 1.3 `src/view/OutlineTreeView.ts`

| メンバ | 責務 |
| --- | --- |
| `readOnlyNodeIds: Set<string>`(新設フィールド) | `refresh()` のたびに `collectReadOnlyOutlineNodeIds` で再計算される、読み取り専用 node id の集合。 |
| `refresh()`(改修) | 有効な規則があれば `scanComplexBlocks`→`matchCompositeBlocks` を実行し、`composites` オプションとして `buildOutlineTree` に渡す。`readOnlyNodeIds` もここで再計算。 |
| `renderNode()`(改修) | composite/complex-member 用のラベル描画分岐を追加。`readOnlyNodeIds` を参照して `aria-readonly`/`data-readonly` を付与し、rename/drag&drop/contextmenu/長押しメニューの各リスナー登録をスキップする。 |
| `beginRenameForNode()`(改修) | kind チェックに加え、`readOnlyNodeIds` による二重ガードを追加。 |
| `showStructureCommandMenu()` / `showListCommandMenu()`(改修) | 各メソッド先頭に `readOnlyNodeIds` チェックを追加(防御的多層化、§7 参照)。 |

### 1.4 `src/model/compositeBlock.ts` / `src/parser/compositeBlocks.ts` / `src/i18n.ts` / `src/settingsDefaults.ts` / `src/settings.ts`

Phase 5D-0.3 前半(承認直後の実装)で確定済みで、今回の A〜E 要件では**ロジック変更なし**。
`i18n.ts` に `tree.complexMember.calloutFallback`/`tree.complexMember.blockquoteFallback` を
追加した点のみが今回分。

---

## 2. `CompositeBlock` / `ComplexBlock` / `OutlineTreeNode` のデータモデル関係

```
model/block.ts            model/complexBlock.ts         model/compositeBlock.ts
  BlockNode                 ComplexBlockInfo               CompositeBlockInfo
  (section/list)             (callout/blockquote/           (2つ以上の member を
                              fenced-code/table/              まとめた読み取り専用
                              paragraph/thematic-break)        グルーピング)
        \                          |                              |
         \                         |                    member[].id が参照 -----+
          \                        |                                            |
           \___ doc.nodes ________/                                             |
                    ^                                                           |
                    |  (ListBlockNode を直接参照)                                |
                    +---------------------------------------------------------- +

tree/buildOutlineTree.ts: OutlineTreeNode (判別共用体)
  section | list | composite | complex-member
    - "list" は BlockNode(ListBlockNode)の投影
    - "composite" は CompositeBlockInfo の投影(id は CompositeBlockInfo.id)
    - "complex-member" は ComplexBlockInfo の投影(id は ComplexBlockInfo.id)
      ※ ただし member.kind が list/single-line-list の場合は
        "complex-member" ではなく通常の "list" ノードを再利用する
        (buildMemberNode 参照)
```

要点:

- `BlockNode`(section/list)と `ComplexBlockInfo`(callout 等)は互いに独立な、それぞれ**1つの
  Markdown 構文**を指す確定モデル。どちらも `parseDocument`/`scanComplexBlocks` が単独で構築し、
  他方を参照しない。
- `CompositeBlockInfo` は上記2つの出力を**観測するだけ**の第三のモデルで、`ParsedDocument.nodes`
  にも `ComplexBlockScanResult.blocks` にも登録されない。`members[].id` は必ず既存の
  `BlockNode.id` か `ComplexBlockInfo.id` のいずれかを指し、CompositeBlockInfo 自身の id を
  指すことはない(ネストした CompositeBlock が存在しない設計と対応)。
- `OutlineTreeNode` はさらにその上の**表示専用**の第四の層。3つのモデルのうち「今この瞬間、
  Tree にどう見せるか」だけを表現し、逆方向の書き込みは一切ない。

---

## 3. `refresh → scan → match → buildOutlineTree → render` のデータフロー

```
OutlineTreeView.refresh()
  1. parseDocument(text)                         → ParsedDocument (doc)
  2. getEnabledCompositeBlockRules(settings)      → CompositeBlockRule[] (enabledRules)
  3. [enabledRules.length > 0 の場合のみ]
     a. scanComplexBlocks(doc)                    → ComplexBlockScanResult (complexScan)
     b. matchCompositeBlocks(doc, complexScan,
                              enabledRules)        → CompositeBlockInfo[] (infos)
     c. complexScan.blocks を id キーで Map 化      → complexBlocksById
  4. buildOutlineTree(doc, {
       includeLists,
       composites: { infos, complexBlocksById, rules: enabledRules },
       t
     })
       → 内部で isCompositeSafelyProjectable によるフィルタを通した上で
         firstMemberIdToComposite を構築し、buildChildren/buildListNode が
         通常の list 差し替えとして composite ノードを埋め込む
       → OutlineTreeNode[] (currentTree)
  5. collectReadOnlyOutlineNodeIds(currentTree)   → Set<string> (readOnlyNodeIds)
  6. buildNodeIdentityMap(currentTree)            → fold state 復元に使用
  7. renderTree() → renderNode() が currentTree を再帰描画
       - composite/complex-member 用ラベル分岐
       - readOnlyNodeIds を見て aria-readonly / イベント未登録を決定
```

ステップ3が「有効な規則がなければ丸ごとスキップ」される点、ステップ4の `buildOutlineTree` 自身は
一切の scan/match を行わない**純粋な投影関数**である点が設計上の要である(§7 のコスト・安全性の
議論も参照)。

---

## 4. read-only 判定が UI イベント登録時と各操作入口で二重化されている理由

1層目(`renderNode` でのリスナー未登録): 通常の操作経路(マウスのダブルクリック・右クリック・
ドラッグ、モバイルの長押し)は、すべて特定の DOM 要素に紐づいたイベントリスナー経由でしか
発火しない。read-only な行にはそもそもリスナーを **登録しない** ことで、この経路を物理的に
遮断している。これは「メニューを出さない」「見た目上ボタンがない」以上の保証であり、
`draggable` 属性も付与しないため drag のソースにもターゲットにもなり得ない。

2層目(`beginRenameForNode`/`showStructureCommandMenu`/`showListCommandMenu` 自身の入口
ガード): 1層目は「行の DOM がどう構築されたか」に依存する防御であり、**行の DOM 構築を経由しない
経路**には効かない。実際に見つかった具体例が `beginRenameForNode` の F2 キー
(`handleTreeKeyDown`)と「挿入直後の自動 rename」(`autoRenameAfterInsert`)で、どちらも
`this.selectedId`(DOM リスナーの制約を受けない、任意の kind へ自由に動く状態)を経由して直接
呼び出される。特に `autoRenameAfterInsert` は、ユーザーが新規 list item を挿入した直後、その
item が**同じ refresh 内で偶然 CompositeBlock の条件を満たしてしまう**(例: callout 直前への
一行 list item 挿入)場合に実際に到達し得る経路であり、1層目のガードだけでは防げない。

つまり二重化は冗長ではなく、**性質の異なる2種類の到達経路**(DOM リスナー経由 / 状態経由の直接
呼び出し)にそれぞれ対応した、必要な多層防御である。

---

## 5. fold identity を member 単独で保持する設計理由

CompositeBlock はユーザーの本文編集(空行挿入・callout 削除・種類変更など)によって**その場で
生成されたり消滅したりする、派生的な存在**である。一方、ユーザーが個々の list item に対して
持っている「ここは畳んでおきたい」という意図は、その item が現在たまたま CompositeBlock に
含まれているかどうかとは無関係に継続してほしい。

このため `tree/foldIdentity.ts` は、member である list item の identity を **CompositeBlock の
`path` 配下に一切ネストさせず**、常に「その list item が単独で Tree に表示された場合と全く同じ
identity」を計算する(`composite` ケースが `walk(node.children, sectionPath, pools)` を
**自分の `path` ではなく親から受け継いだ `sectionPath`** で呼び出している箇所がこの設計の実装)。
結果として:

- CompositeBlock が存在する間は、CompositeBlock 自身が `composite:<label>` という独立した
  identity を持ち、その fold 状態(畳む/開く)を CompositeBlock 自身のものとして保持できる。
- CompositeBlock が解消されると、`composite:<label>` という identity は単に生成されなくなり
  (他の識別子と同様、消えた identity の fold 状態は孤立するだけで実害はない)、member だった
  list item は元々の `list:<text>` という identity のまま何の影響も受けない。

## 6. 安全に通常 list 表示へフォールバックする条件

`isCompositeSafelyProjectable`(`tree/buildOutlineTree.ts`)が、ある `CompositeBlockInfo` を
`firstMemberIdToComposite` へ登録する **前** に以下を確認する:

1. 先頭 member の `kind` が `"list"` または `"single-line-list"` であること(CompositeBlock の
   Tree 上の位置は先頭 member の位置をそのまま継承するため、独自の Tree 上の位置を持たない
   callout/blockquote/section 種別は先頭 member になれない)。
2. 先頭 member の `id` が `doc.nodes` 上で実際に `ListBlockNode` として解決できること。
3. **全** member(先頭を含む)について、list/single-line-list 種別なら `doc.nodes`、それ以外
   なら `complexBlocksById` で実際に解決できること。

いずれか1つでも満たさない場合、その `CompositeBlockInfo` は `firstMemberIdToComposite` に
一切登録されない。結果として `buildChildren`/`buildListNode` はその composite の存在を認識せず、
先頭 member(list item)は**通常の list 行**として(`includeLists` 設定に従って)描画され、他の
member(callout/blockquote)は Phase 5D-0.3 以前と同じく Tree 上に何の表現も持たない。

実運用の `refresh()` 経路では `infos`/`complexBlocksById` が常に同一の `doc`/`complexScan` から
導出されるため、この判定が実際に false になることは(現状のマッチャー実装である限り)起こり得ない
— これは想定外の入力に対する防御的不変条件であり、通常操作でこの分岐に到達することはない。

---

## 7. 現時点で意図的に未対応の範囲

- CompositeBlock 親 node の move / drag & drop / indent-outdent / 追加 / 削除 / Partial Edit。
- member child node(list/callout/blockquote いずれも)からの rename / drag & drop / 構造編集。
- callout / blockquote 内容そのものの書き戻し編集(Tree からの操作に限らず、そもそも Tree 層に
  callout/blockquote の内容を編集する経路自体が存在しない)。
- 自由な CompositeBlock rule 編集 UI(既定2規則の有効/無効トグルのみ)。
- nested CompositeBlock(CompositeBlock 自体を member にする規則 — 型レベルでも
  `CompositeMemberKind` に `"composite"` が存在しないため構造的に不可能)。
- `CompositeMemberKind` の `"section"` は型としては定義済みだが、マッチャー
  (`parser/compositeBlocks.ts`)が `"section"` candidate を生成しないため、`"section"` を含む
  規則は現状どのドキュメントに対しても絶対にマッチしない(将来の拡張用に型だけ用意されている)。

---

## 8. 既知の制約と、それがデータ破壊につながらない理由

| 制約 | データ破壊につながらない理由 |
| --- | --- |
| composite の "list" 種別 member は、構造的に**ネストした子 list item を持てない**(子は常に独立 candidate として間に割り込むため matcher が一致しない)。 | Markdown 自体は元のまま — この制約は「Tree にどう投影されるか」だけの制約であり、本文の構造やネストされた子 item 自体は一切変更・削除されない。単に composite として束ねられないだけで、子を含む親 list item はそのまま通常表示される。 |
| ドラッグ中に読み取り専用行の内部を通過すると、`dragover`/`drop` イベントが祖先の非 read-only 行(例: 親セクション)へバブリングし、そこに drop indicator が表示される可能性がある。 | `handleDragOver`/`handleDrop` はイベント登録時にクロージャで固定された `node.id`(常に非 read-only な行自身の id)しか参照しない。バブリングしてもイベントの `currentTarget` は変わらないため、誤って composite/member を書き換え対象にすることは構造的にあり得ない。UI上の見た目の違和感に留まる。 |
| `isCompositeSafelyProjectable` は member 解決の安全性のみを検証し、`composite.ruleId` が `ctx.rules` 内に実在するかは検証しない。 | ruleId が解決できない場合でも `buildCompositeNode` は例外を投げず、`composite.ruleId` をそのままラベルとして・prefix を `""` として描画するフォールバックを持つ(§9 の論点2で改善要否を提起)。表示が多少不格好になるだけで、Markdown 書き込みや構造破壊には至らない。 |
| fold identity の occurrence disambiguation(`#N` サフィックス)は、同一 scope 内に同名ノードが挿入/削除/並び替えされると「別の同名ノードの fold 状態を誤って引き継ぐ」ことがある(Phase 4E から続く既知の限界、本フェーズで新規導入したものではない)。 | 最悪の場合でも、同じ scope 内に現存する妥当なノードの fold 状態が代わりに表示されるだけで、クラッシュやデータ損失は発生しない(`foldIdentity.ts` 冒頭の doc comment に明記済みの既知の限界)。 |

---

## 9. コードレビューで見つかった論点(要判断・未修正)

以下はいずれも**未修正**。修正の要否・優先度についてご判断をお願いします。承認をいただき次第、
個別に(まとめてではなく)適用します。

### 論点1(小): `isCompositeSafelyProjectable` に冗長な二重チェックがある

`tree/buildOutlineTree.ts` の `isCompositeSafelyProjectable` は、先頭 member を **ループの前に
1回**(kind 制約 + `doc.nodes` 解決)、そのあと **ループの1回目の反復でもう1度**(`doc.nodes`
解決のみ、同じ id に対して)チェックしている。結果は正しいが、無駄な二重処理になっている。

- 影響範囲: `tree/buildOutlineTree.ts` の当該関数のみ。挙動への影響はゼロ(結果は変わらない)。
- 修正案: ループ側で `member === first` のときだけ kind 制約を追加でチェックする形にまとめるか、
  先頭専用チェックの後にループを `info.members.slice(1)` に対して回す。
- 修正要否: 任意(性能上の実害はごく僅か — composite は通常2〜3 member程度)。可読性向上の
  観点でのみ有効。

### 論点2(中): `ruleId` が解決できない composite は、投影を諦めずに「壊れたラベル」で投影されてしまう

`isCompositeSafelyProjectable` は member の解決可能性のみを検証し、`composite.ruleId` が
呼び出し側の `ctx.rules` に実在するかどうかは検証しない。もし実在しない場合、
`buildCompositeNode` は例外を投げず `label: composite.ruleId`(生の rule id 文字列)・
`prefix: ""` で投影を続行する(§6 で言及した「安全にフォールバックする」の対象に、この
ケースは含めていない)。

実運用の `refresh()` 経路(`infos`/`rules` が常に同じ `enabledRules` から導出される)では
発生しないが、「member は解決できるが規則情報だけ古い/不整合な入力」を渡された場合にだけ
発生し得る、狭いギャップである。

- 影響範囲: `tree/buildOutlineTree.ts` の `isCompositeSafelyProjectable`(1関数)。
- 修正案: `isCompositeSafelyProjectable` の引数に `rules: CompositeBlockRule[]` を追加し、
  `getCompositeBlockRuleById(rules, info.ruleId)` が見つからない場合も false を返すようにする。
- 修正要否: **ご判断ください**。「member 位置の安全性」と「ラベル解決の安全性」を同じ関数で
  一括して扱うか、別懸念として区別したままにするか、方針の確認をお願いします。

### 論点3(小・文書のみ): `BuildOutlineTreeOptions.composites` の doc comment が新しい安全フィルタに未言及

`isCompositeSafelyProjectable` を追加した際、それを呼び出す `buildOutlineTree` 自体の
doc comment(`BuildOutlineTreeOptions.composites` のコメント)は更新していない。現状の文言は
「投影された CompositeBlock は必ず表示される」ように読める。

- 影響範囲: `tree/buildOutlineTree.ts` のコメントのみ。実装への影響なし。
- 修正案: 「`infos` に含まれる全 CompositeBlockInfo が必ず投影されるとは限らない
  (`isCompositeSafelyProjectable` 参照)」という一文を追記。
- 修正要否: 推奨(ドキュメントと実装の食い違い)。

### 論点4(小・文書のみ): `model/compositeBlock.ts` に存在しないシンボルへの参照がある

`CompositeBlockRule.prefix` の doc comment が「see tree/buildOutlineTree.ts's
compositeBlockPrefix callers」と書いているが、`compositeBlockPrefix` という関数は
`tree/buildOutlineTree.ts` に存在しない(実際の描画は `buildCompositeNode` と
`view/OutlineTreeView.ts#renderNode` の composite 分岐が担当)。

- 影響範囲: コメントのみ。
- 修正案: 参照先を `buildCompositeNode` / `OutlineTreeView.ts#renderNode` の composite 分岐に
  訂正。
- 修正要否: 推奨(誤った参照は将来の読者を混乱させる)。

### 論点5(極小): `buildMemberNode` の raw-id フォールバックが、安全フィルタ導入後は到達不能になった

`buildMemberNode` の `const label = info ? complexMemberDisplayLabel(...) : member.id;` は、
`isCompositeSafelyProjectable` 導入前は「member が見つからない場合」の実際のフォールバック
経路だったが、導入後は `buildCompositeNode`/`buildMemberNode` に渡ってくる composite が
既に「全 member 解決済み」であることを保証されているため、この分岐は**現状のモジュール内呼び出し
グラフの範囲では到達不能**になった。

- 影響範囲: `tree/buildOutlineTree.ts` の `buildMemberNode` 内、コメントのみ。
- 修正案: コードは変更せず(将来のリファクタリングでこのモジュールの呼び出し関係が変わった際の
  防御として残す価値がある)、「この分岐は `isCompositeSafelyProjectable` により通常到達しない」
  という一文をコメントに追加するのみ。
- 修正要否: 任意。

### 論点6(極小・命名): `unified-outliner-list-row` CSS クラスが composite/complex-member 行にも付与される

`view/OutlineTreeView.ts#renderNode` の `isSection ? "" : " unified-outliner-list-row"` は、
「section 以外はこのクラス」という判定のため、composite/complex-member 行にも
`unified-outliner-list-row` が付与される。スタイル上は意図通り(section 以外は共通の
コンパクトな行スタイル)だが、クラス名が実態(list 以外にも使われる)と乖離している。

- 影響範囲: `styles.css`/`view/OutlineTreeView.ts` のクラス名のみ。挙動への影響なし。
- 修正案: 据え置き(実害なし)、またはクラス名を `unified-outliner-compact-row` 等へ
  リネームする(影響範囲が styles.css 側のセレクタにも及ぶため中程度の変更になる)。
- 修正要否: 任意。今回は据え置きを推奨(リネームの実利が乏しく、CSS 側の変更範囲が
  無視できない)。

### 論点7(方針確認): 「防御の入口」をどこまで広げるか

`beginRenameForNode` の `readOnlyNodeIds` チェックは、実際に到達可能な経路(F2 +
`autoRenameAfterInsert`)を塞ぐために追加した。一方 `showStructureCommandMenu`/
`showListCommandMenu` へ追加した同様のチェックは、**現状到達可能な経路は見つかっていない**
将来防御(non-DOM 経由でこれらが直接呼ばれるようになった場合の保険)として追加した。

同じ理屈で言えば、`handleDragStart`/`handleDragOver`/`handleDrop`/`runRelocateCommand`
(および両メニュー内部で呼ばれる move/indent 系コマンド実行関数)にも同様の入口ガードを
追加する余地がある。現状ではこれらへの non-DOM 経由の到達経路は存在しないため緊急性は
低いと判断し、今回は追加していない。

- 影響範囲: 追加する場合、`handleDragStart`/`handleDragOver`/`handleDrop`/
  `runRelocateCommand` および関連ヘルパー(複数箇所)。
- 修正要否: **ご判断ください**。「実際に到達可能な経路が見つかった箇所にのみ追加する」
  という今回の方針を維持するか、「将来の変更に備えて構造編集系の入口すべてに一律で
  `readOnlyNodeIds` ガードを追加する」という、より保守的な方針に広げるか。

---

## 10. レビューで確認済み・問題なしと判断した点(参考)

- `insideComposite` という旧パラメータの残骸(コメント以外の実コード参照)は存在しない
  (grep で確認済み)。
- en/ja の i18n key parity は `Record<TranslationKey, string>` 型付けにより `tsc` が
  強制しており、キーの過不足があればビルドが失敗する(実際に `npx tsc -noEmit` は無エラー)。
- `CompositeMemberKind` の `"section"` は、型としては存在するが (a) マッチャーが `"section"`
  candidate を生成しない、(b) `isCompositeSafelyProjectable` も先頭 member の kind を
  list/single-line-list に制限する、という二重の理由で実行時には絶対に到達しない
  ("備え" の型と "現実" の実装が意図的に食い違っている設計— バグではない)。
- 既存のセクション/リストの fold・選択同期・キーボードナビゲーション・drag & drop・rename・
  右クリックメニューは、本フェーズの変更前後で全 567 件のテストが変化なく通過しており、
  回帰は確認されていない。
