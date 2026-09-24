# 段落 D&D セクション越え移動 — 設計メモ

作業ブランチ: `feat/paragraph-dnd-cross-section`（`main` から分岐）
関連する既存実装:
- リストのセクション越え移動: `src/move/findMoveTarget.ts`（`allowCrossSectionListMove` /
  `{ kind: "insert" }` 経路）
- complex block（callout/blockquote/fenced-code/table）D&D のセクション越え移動:
  `feat/standalone-complex-dnd-cross-section` ブランチ、コミット `6938898`
  （未マージ、参照のみ）

## 1. 着手前調査で判明した既存制約

### 1.1 `src/edit/paragraphNonAdjacentMove.ts` の既存制約

- ファイル冒頭のドキュメントコメントが明言する通り、非隣接移動の対象は
  「同一 parentId / 同一 depth の sibling 群」に限定されていた
  (`NON_ADJACENT_TARGET_KINDS = ["paragraph", "callout", "blockquote"]`)。
- `moveParagraphNonAdjacent` 本体で、再解決した source/target を突き合わせたあと
  `source.parentId !== target.parentId` を `"parent-mismatch"` として拒否し、
  さらに `complexBlockDepth` を用いた `"depth-mismatch"`（同じ parentId なら
  depth は必ず一致するため到達不能な defense-in-depth）を拒否していた。
- `listNonAdjacentMoveTargets`（ticket 文中の「collectSiblingTargets」に相当。
  実装上の関数名は `listNonAdjacentMoveTargets`）は
  `.filter((b) => b.parentId === sourceParentId)` と
  `.filter((b) => complexBlockDepth(doc, b.parentId) === sourceDepth)` で
  候補を同一セクション内に絞っている。この関数は次の2箇所から呼ばれる:
  1. `view/OutlineTreeView.ts` のコンテキストメニュー
     （「先頭へ移動」「末尾へ移動」「指定 sibling の前へ/後へ」— いずれも
     メニューコマンド）。
  2. `edit/deleteParagraph.ts` の安全削除のための兄弟グループ計算
     （移動とは無関係な用途）。
- `SiblingTargetAnchor`/`buildSiblingTargetAnchor` 自体は parentId/depth を
  「記録するだけ」で、それ自体が同一性を強制してはいない
  （強制しているのは `moveParagraphNonAdjacent` 本体の比較ロジックの方）。
- **CompositeBlock 内部境界ガードは、この関数には一切存在しなかった。**
  `edit/deleteParagraph.ts` は削除対象パラグラフ自身が CompositeBlock の
  メンバーである場合を `matchCompositeBlocks` で検出して拒否している
  （source 側のガード）が、`paragraphNonAdjacentMove.ts` には
  `matchCompositeBlocks` の呼び出し自体が存在せず、移動先
  (`insertBeforeLine`) が既存 CompositeBlock の集約範囲内部に割り込むケースを
  検出する仕組みが同一セクション内の移動でも元々なかった。

### 1.2 リストのセクション越え移動との対応関係

`src/move/findMoveTarget.ts` の cross-section 対応は、対象が別セクションでも
`{ kind: "insert"; insertBeforeLine }` を返し、`insertBlockAt` 相当の
cut-and-insert 経路で再挿入し、`parentId` は再パース後に自然に解決させる、
という設計。今回の段落セクション越え移動もこの設計をそのまま踏襲した。

### 1.3 complex block D&D セクション越え移動（コミット `6938898`）との対応関係

`git show 6938898` で確認した変更点:
- `src/move/findStandaloneComplexBlockDropTarget.ts`
  `resolveStandaloneComplexBlockDropTarget` から
  `target.parentId !== source.parentId` → `"not-same-section"` の拒否を削除。
  代わりの安全策は既存の composite-internal-boundary ガード
  （`insertBeforeLine` が `allComposites` のいずれかの範囲内部に落ちる場合を
  拒否）のみで、これは元々セクションを問わず文書全体を走査していたため
  変更不要だった。
- `src/edit/dropStandaloneComplexBlock.ts`
  `ensureBlankSeparation`（`paragraphNonAdjacentMove.ts` からの
  “duplicated, not imported” 方式の複製）を追加し、
  **セクション越えのドロップの場合のみ**適用（同一セクション内のドロップは
  従来どおりバイト単位で不変を維持）。
- `view/OutlineTreeView.ts` はこのチケットでは無変更だった
  （drop-target-hint の解決が元々セクション非依存だったため）。

段落側はこれと異なり、`view/OutlineTreeView.ts` の D&D プレビューゲート
（`resolveParagraphNonAdjacentDragTarget`）が
`node.parentId !== session.anchor.parentId` を明示的にハードコードしていた
ため、**段落側は `OutlineTreeView.ts` の変更が必須**だった（3節参照）。

### 1.4 `handleParagraphDragOver` のホバー中ターゲット受理について

`handleParagraphDragOver` 自体は `paragraphDropTargetHint` で
row の rangeStart/rangeEnd/parentId を取得するだけで、parentId
そのものによるフィルタは行っていない。実際のセクション制限は
`resolveParagraphNonAdjacentDragTarget` 内の
`isTopLevelOrSectionDirectParagraphParent` 2回呼び出しと
`node.parentId !== session.anchor.parentId` の比較にのみ存在した
（後者が今回削除した箇所）。`isTopLevelOrSectionDirectParagraphParent`
は「トップレベル、またはいずれかのセクション直下」を判定するだけで
特定のセクションIDには縛られないため、後者の等号チェックを消すだけで
別セクションのホバー先も正しくプレビュー対象に含まれるようになる。

### 1.5 composite-internal-boundary ガードの所在

段落側にはこのガードが元々どこにも存在しなかった（1.1参照）。今回、
`resolveStandaloneComplexBlockDropTarget` の同名ガードを手本に、
`moveParagraphNonAdjacent` 本体へ新規に追加した（3.3節）。これは
セクション越え・同一セクション内どちらの移動にも等しく適用される
一般的な安全策であり、「セクション越えの場合だけ」に限定していない
（同一セクション内でも元々存在すべきだった抜けを、今回まとめて塞いだ）。

## 2. 変更方針

1. `moveParagraphNonAdjacent` の `parent-mismatch`/`depth-mismatch` 拒否を撤廃。
   `NonAdjacentMoveReason` 型と `paragraphNonAdjacentMoveReasonText` の
   両方の値自体は i18n キーの後方互換のため残し、実際には返さないだけに
   とどめた（既存訳文テストとの整合性を壊さないため）。
2. `listNonAdjacentMoveTargets`（＝ticket文中の「collectSiblingTargets」）は
   **あえて widen しなかった**。理由は本メモ4節を参照。
3. cut-and-insert は既存の `insertBlockAt`（`move/moveBlock.ts`、変更なし）を
   そのまま再利用。`parentId` の書き換えは一切行わず、再パースによる自然な
   解決に委ねた。
4. `view/OutlineTreeView.ts` の D&D プレビューゲート
   (`resolveParagraphNonAdjacentDragTarget`) から同一 parentId 制約を撤廃。
5. `moveParagraphNonAdjacent` に新規の任意引数 `rules: CompositeBlockRule[] = []`
   を追加し、`matchCompositeBlocks` を用いた composite-internal-boundary
   ガードを新設。デフォルト値 `[]` により、既存の呼び出し側
   （テストを含む多数）は変更なしで従来どおりの挙動を維持する。
   `view/OutlineTreeView.ts#dispatchAndApplyParagraphNonAdjacentMove`
   （コンテキストメニュー経路・D&D 経路の共通ディスパッチ）は
   `getEnabledCompositeBlockRules(this.plugin.settings.compositeBlocks)`
   を渡すよう更新し、実運用では常にこのガードが有効になる。

## 3. 見出し行のドロップターゲット扱いについての決定

`feat/standalone-complex-dnd-cross-section` と同じ方針を踏襲し、
**見出し行自体をドロップターゲットとして扱う追加実装は不要と判断した。**

根拠: 別セクションの先頭（見出し直下）への挿入は、そのセクションの
「最初の非見出しブロック」の `"before"` として表現できる。
`insertBeforeLine` は `target.range.startLine`（"before"）または
`target.range.endLine + 1`（"after"）のいずれかであり、対象セクションの
最初/最後のブロックを選べば document の境界・セクションの境界のどちらも
特別扱いなしに正しく扱える（既存の `insertBlockAt` の設計がそもそも
この前提で作られている）。実際に「別セクションの先頭に挿入する」テスト
ケース（`tests/paragraphNonAdjacentMove.test.ts` の
"drops a paragraph at the START of a DIFFERENT section" ）で、見出し行を
ターゲットにせずとも正しく動作することを確認した。

## 4. 変更したファイル一覧と変更内容

### `src/edit/paragraphNonAdjacentMove.ts`（主な変更対象）

- トップドキュメントコメントに 2026-09-24 付き追記（addendum）を追加し、
  旧スコープの説明を消さずに残しつつ、新しい許容範囲を明記。
- `NonAdjacentMoveReason` に `"composite-internal-boundary"` を追加。
- `moveParagraphNonAdjacent` の関数シグネチャに
  `rules: CompositeBlockRule[] = []` を追加。
- `source.parentId !== target.parentId` / `sourceDepth !== targetDepth` の
  拒否ブロックを削除し、コメントで置き換え。
- `insertBeforeLine` 算出直後に `matchCompositeBlocks(doc, scan, rules)` を
  呼び、結果のいずれかの `range` に `insertBeforeLine` が
  strictly inside（`> startLine && <= endLine`）であれば
  `"composite-internal-boundary"` を返すガードを新設。
- `paragraphNonAdjacentMoveReasonText` に `"composite-internal-boundary"` の
  分岐を追加。
- `listNonAdjacentMoveTargets`・`buildSiblingTargetAnchor` 自体は無変更
  （4節末尾の理由により意図的に据え置き）。

### `src/i18n.ts`

- `reason.paragraphNonAdjacentCompositeInternalBoundary` を en/ja 両方に追加。

### `src/view/OutlineTreeView.ts`

- `resolveParagraphNonAdjacentDragTarget` から
  `if (node.parentId !== session.anchor.parentId) return null;` を削除し、
  ドキュメントコメントの gate 3 を「SUPERSEDED」として旧説明を残しつつ更新。
- `dispatchAndApplyParagraphNonAdjacentMove` で
  `getEnabledCompositeBlockRules(this.plugin.settings.compositeBlocks)` を
  取得し、`moveParagraphNonAdjacent` の第5引数として渡すよう変更
  （これによりコンテキストメニュー経路・D&D 経路の両方で
  composite-internal-boundary ガードが実際に有効になる）。

### `tests/paragraphNonAdjacentMove.test.ts`

- 旧 `"parent-mismatch: target lives under a different section than source"`
  テストを、セクション越え移動が **許可される** ことを確認する形に更新
  （SUPERSEDED である旨をタイトルに明記）。
- 新規 `describe("moveParagraphNonAdjacent: cross-section ...")` を追加
  （5節参照）。

### `tests/paragraphOutlineTreeUiWiring.test.ts`

- 旧 `"a target belonging to a DIFFERENT parentId ... rejects it as
  parent-mismatch"` テストを、セクション越え移動が許可されることを
  確認する形に更新。
- 新規テストとして、`resolveParagraphNonAdjacentDragTarget` のソース文字列に
  もう `node.parentId !== session.anchor.parentId` の等号ガードが
  含まれていないこと、および `isTopLevelOrSectionDirectParagraphParent`
  ガードは残っていることを検証する静的ソースチェックを追加。

## 5. 追加したテストケース一覧

`tests/paragraphNonAdjacentMove.test.ts` に
`describe("moveParagraphNonAdjacent: cross-section (feat/paragraph-dnd-cross-section)")`
として追加:

1. 別セクション内の段落の直前へのドロップ（再パース後 `parentId` が
   自然にドロップ先セクションへ切り替わること、移動元・移動先双方が
   `editability === "supported"` を保つことを確認）。
2. 別セクションの末尾へのドロップ。
3. 別セクションの先頭（見出し直下）へのドロップ。
4. セクション越えドロップ先が CompositeBlock（image-ocr ルール由来）の
   aggregate range 内部に割り込む場合、`"composite-internal-boundary"` で
   拒否されること。
5. 上記4と同一の入力で `rules` を省略（デフォルト `[]`）した場合は
   ガードが発火せず許可されることの確認（後方互換性の担保）。
6. セクション越えドロップも1回の `moveParagraphNonAdjacent` 呼び出しで
   完結すること（`applyLineEditOutcome` の単一 `replaceRange` に載せれば
   「1操作=1編集=1Undo」契約を満たすことの代替確認。実機の Undo 挙動
   そのものは vitest では検証不可能）。

`tests/paragraphOutlineTreeUiWiring.test.ts` に追加:

7. セクション越えの `moveParagraphNonAdjacent` 呼び出しが許可されることの
   確認（旧 parent-mismatch テストの更新）。
8. D&D プレビューゲート（`resolveParagraphNonAdjacentDragTarget`）の
   ソースコードから同一 parentId 等号ガードが除去され、
   `isTopLevelOrSectionDirectParagraphParent` ガードは残っていることの
   静的検証。

全件の実行結果: `npx vitest run` → 158 ファイル / 3290 テスト全件成功
（既存の同一セクション内の非隣接移動・隣接ドロップテストも回帰なし）。

## 6. Move（メニューコマンド）との整合性についての今後の課題

今回のスコープは **D&D のセクション越え対応のみ**。以下は意図的に対象外とした:

- コンテキストメニューの「先頭へ移動」「末尾へ移動」「指定 sibling の
  前へ/後へ」（`listNonAdjacentMoveTargets` が候補を提供する経路）は、
  引き続き同一セクション内の候補のみを一覧表示する。これは
  `listNonAdjacentMoveTargets` を widen しなかったことによる直接の帰結。
- 段落の Move up/down（隣接スワップ、`moveParagraphFromAnchor`/
  `findComplexSiblingTarget` 経路）のセクション越え対応。
- complex block の Move up/down（`findStandaloneComplexBlockMoveTarget.ts`）の
  セクション越え対応。

これらは別チケットで後日対応する。`moveParagraphNonAdjacent` エンジン自体は
今回すでにセクション越えを受理できるようになっているため、将来
メニューコマンド側で対応する際は `listNonAdjacentMoveTargets` の
フィルタ条件を widen するだけで足りる可能性が高い（ただし
`deleteParagraph.ts` がこの関数を無関係な削除安全性チェックにも
再利用している点に注意が必要 — widen する場合は呼び出し側を
分離するか、`deleteParagraph.ts` 側の意図を壊さないことを確認すること）。

## 7. 既知の制約

- **source 側の CompositeBlock メンバーシップは未チェック**:
  今回追加した composite-internal-boundary ガードは移動「先」
  (`insertBeforeLine`) が CompositeBlock 内部に割り込むケースのみを防ぐ。
  移動「元」の段落自体が CompositeBlock のメンバーである場合の扱いは
  `edit/deleteParagraph.ts` の `"composite-member"` ガードのような
  仕組みが `moveParagraphNonAdjacent` には存在せず、本チケットの
  スコープ外として現状維持とした。
- **`listNonAdjacentMoveTargets` は widen していない**ため、
  コンテキストメニュー経由では引き続きセクション越えの移動先を選べない
  （6節参照）。
- 段落の D&D で **見出し行そのもの**をドロップターゲットとして
  選ぶことはできない（3節の設計判断どおり、元々の同一セクション内
  移動でも同様の制約だったため新規の制約ではない）。
- `rules` 引数はデフォルト `[]` の任意引数とした（`deleteParagraph.ts`
  のように必須引数にはしていない）。実運用では
  `view/OutlineTreeView.ts` が常に有効なルールセットを渡すため機能上の
  問題はないが、テストコードやスクリプトから直接呼び出す際に
  `rules` を渡し忘れると composite-internal-boundary ガードが
  無効化される点に注意。
