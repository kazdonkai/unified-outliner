# D&D セクション越え移動の実装 — 設計メモ

日付: 2026-09-24
ブランチ: `feat/standalone-complex-dnd-cross-section`（`main` から分岐）

## 1. 着手前調査 — D&D と リストの cross-section 実装の差分

### 1.1 リストの cross-section 移動（Move up/down）の仕組み

`src/move/findMoveTarget.ts#findMoveTarget` は、ルート直下（トップレベルまたは
セクション直下）のリスト項目が、Move の方向に兄弟を持たない場合に限り、
`allowCrossSectionListMove` オプションが true であれば、見出し行を飛び越えて
`{ kind: "insert", insertBeforeLine }` を返す。挿入先は「見出し行の直前」
（上方向）または「次の見出し行の直後」（下方向）であり、見出し行そのものを
「入れ替え相手」として扱っているのではなく、「その直前/直後に挿入する」だけ
である点が、今回の D&D 実装方針の直接の参考になった。`parentId` の書き換えは
一切行わず、`insertBlockAt`（`src/move/moveBlock.ts`）で行範囲を切り取って
別位置に差し込んだ後、呼び出し元が編集結果を `editor.replaceRange` 等で書き
戻し、次回の `refresh()`（再パース）で新しい `parentId` が自然に解決される。

### 1.2 既存の standalone complex block D&D（callout/blockquote/table/
fenced-code）の制約

`src/move/findStandaloneComplexBlockDropTarget.ts#resolveStandaloneComplexBlockDropTarget`
は、ドロップ先とドロップ元の `parentId` が一致すること（条件3、"not-same-section"
として拒否）を必須としていた。これはリストの Move が同一セクション内の隣接
交換を基本とし、セクション越えは「兄弟がいない」という特殊ケースのみ許可する
のと異なり、D&D は「ユーザーが選んだ任意の before/after 位置」を検証する設計
であるにもかかわらず、その任意性をセクション内に限定してしまっていた。

### 1.3 差分まとめ

| 項目 | リスト Move（cross-section） | 既存 D&D（変更前） |
|---|---|---|
| セクション越え | 許可（兄弟なしの場合のみ、見出し行を飛び越える） | 不許可（parentId 一致必須） |
| 挿入方式 | `insertBeforeLine` を計算し `insertBlockAt` | 同左（`insertBlockAt` は既に汎用） |
| parentId の扱い | 書き戻し不要、再パースで自然解決 | 同左（変更不要と判明） |
| ターゲット | 見出し行そのものではなく、隣接ブロックの前後 | 同左（見出し行は元々対象外） |

### 1.4 `dropStandaloneComplexBlock.ts` の書き戻しロジックの調査結果

`edit/dropStandaloneComplexBlock.ts` の `insertBlockAt` 呼び出しは、行範囲の
切り取り・挿入のみを行う純粋関数で、`parentId` の同一性を一切前提にしていない
ことを確認した。つまり実行系（executor）は既に任意位置への insert に対応
済みで、変更が必要だったのは resolver（`findStandaloneComplexBlockDropTarget.ts`）
の条件3のみだった。ただし、v1 では `ensureBlankSeparation`
（空行補完、`edit/paragraphNonAdjacentMove.ts` に実装済み）が一切呼ばれて
おらず、これは同一セクション内ドロップでは許容されていた前提（隣接コンテキストを
resolver が一定範囲でしか動かさない）が、セクション越えでは成り立たなくなる
ため、実行系側に追加が必要だった。

### 1.5 `view/OutlineTreeView.ts` のドラッグターゲット解決の調査結果

`calloutDropTargetHint(node)`（dragover 時のターゲット解決）は、ホバー中の
Tree 行の種類（list / paragraph / complex-member）に応じて range/parentId を
そのまま返すだけで、**セクションによる絞り込みを一切行っていない** ことを
確認した。同一セクション制約は resolver 側にのみ存在していたため、
OutlineTreeView.ts 自体は変更不要と判明した。

### 1.6 composite-internal-boundary ガードの所在

`resolveStandaloneComplexBlockDropTarget` の条件4（現行の条件番号では変更後
唯一残る構造チェック）が、`allComposites`（ドキュメント全体の CompositeBlock
一覧、セクションで絞り込まれていない）を走査して判定している。この一覧は
呼び出し元（`view/OutlineTreeView.ts` / `edit/dropStandaloneComplexBlock.ts`）
が `matchCompositeBlocks(doc, ...)` でドキュメント全体から作っているため、
セクション越えのケースでも変更なしにそのまま機能することを確認した。

### 1.7 `ensureBlankSeparation` の所在

`edit/paragraphNonAdjacentMove.ts` に private 関数として実装されている
（`HEADING_RE`/`LIST_RE`/`needsSeparatingBlankLine`/`ensureBlankSeparation`）。
同じロジックが `edit/deleteParagraph.ts` にも「import せず複製する」という
既存の規約に従って複製されている。今回もこの規約に従い、
`edit/dropStandaloneComplexBlock.ts` に同一ロジックを複製した。

## 2. 変更方針

`findStandaloneComplexBlockDropTarget.ts` の条件3（`target.parentId !==
source.parentId` を "not-same-section" として拒否するチェック）を撤廃し、
そのまま composite-internal-boundary チェックに処理を進める形に変更した。
セクション越えの具体的な処理は、リストの cross-section 実装と同じ方式
（移動元の行範囲を切り取り、`insertBlockAt` で別セクション内の位置に再挿入、
`parentId` は書き戻し後の再パースで自然に解決させる）に従っている。

`dropStandaloneComplexBlock.ts` には、ドロップ元・ドロップ先を再解決した後の
`resolvedSource.parentId !== target.parentId` を条件に、`ensureBlankSeparation`
を適用するステップを追加した。この判定は再解決後の値を使うため、resolver の
判定と実行系の判定が食い違うことはない。同一セクション内のドロップは従来通り
空行補完なしのまま（既存テストの byte-exact な期待値を変えないため）。

## 3. 見出し行のドロップターゲット扱いについての決定

**決定: 見出し行そのものをドロップターゲットとして扱う追加実装は行わない。**

根拠: `calloutDropTargetHint` が返すターゲット候補は、既に「別セクション内の
top-level complex block または list item」を含んでいる（1.5 節の調査結果）。
そのブロックの前後（before/after）に挿入すれば、結果として見出し直下の
先頭／セクション末尾への挿入が過不足なく実現できる。リストの cross-section
実装（`findMoveTarget.ts`）自体も見出し行を「スワップ相手」にしているのでは
なく、見出し行の直前/直後という位置に `insertBeforeLine` を計算して差し込んで
いるだけであり、同じ考え方がそのまま流用できることを確認した。見出し行を
ターゲットとして受理する追加実装（例: セクションが空の場合の特別処理）は、
今回のテスト・実装のいずれにおいても必要が生じなかった。

## 4. 変更したファイル一覧

- `src/move/findStandaloneComplexBlockDropTarget.ts`
  `resolveStandaloneComplexBlockDropTarget` 内の条件3（"not-same-section" 拒否）
  を削除。ドキュメントコメント（トップの v1 スコープ説明、条件の番号付き説明）
  に日付付き追記を追加し、旧説明は削除せず「SUPERSEDED」として残した。
- `src/model/complexBlock.ts`
  `StandaloneComplexBlockDropRejectReason` の `"not-same-section"` の
  ドキュメントコメントに日付付き追記を追加（型自体は後方互換のため残置、
  現在は resolver から返されない旨を明記）。
- `src/edit/dropStandaloneComplexBlock.ts`
  `ensureBlankSeparation`（`edit/paragraphNonAdjacentMove.ts` と同一ロジックの
  複製）を追加し、`resolvedSource.parentId !== target.parentId` の場合のみ
  適用するよう `dropStandaloneComplexBlock` 関数末尾を変更。トップドキュメント
  コメントに日付付き追記を追加。
- `src/view/OutlineTreeView.ts`
  変更なし。`calloutDropTargetHint` が既にセクションで絞り込みを行っていない
  ことを確認済み（1.5 節）。

## 5. 追加したテストケース

`tests/findStandaloneComplexBlockDropTarget.test.ts`:
- 旧 "rejects (not-same-section)" テストを、cross-section が許可されることを
  検証するテストに置き換え（before/after 両方向）。
- cross-section ドロップが宛先セクションの CompositeBlock 内部に割り込む場合、
  引き続き composite-internal-boundary として拒否されることを検証するテストを
  追加。

`tests/dropStandaloneComplexBlock.test.ts`:
- 旧 "not-same-section" 実行系テストを削除。
- callout を別セクション内の段落の直前にドロップし、空行ポリシーが保たれ、
  再パース後の `parentId` がセクション B に自然解決されることを検証するテスト
  を追加。
- blockquote を別セクションの末尾にドロップするテストを追加。
- fenced-code を別セクションの先頭にドロップするテストを追加。
- cross-section ドロップ先が宛先セクションの CompositeBlock 内部に割り込む
  場合に composite-internal-boundary として拒否されることを検証するテストを
  追加。
- 同一セクション内ドロップでは `ensureBlankSeparation` が発火しない
  （既存の byte-exact 出力が変わらない）ことを検証する回帰テストを追加。

`tests/standaloneComplexBlockDropUiWiring.test.ts`:
- `dispatchAndApplyStandaloneComplexBlockDrop` が cross-section ドロップでも
  `applyLineEditOutcome` を1回しか呼ばないこと（1操作=1編集=1Undo の契約が
  保たれること）を検証するテストを追加。

Undo についての注記: 本リポジトリの vitest テストは実際の CodeMirror 6
エディタを構築できない（`obsidian` が型のみのパッケージのため）ため、
「Undo で元に戻る」ことそのものを直接検証するテストは既存のどの D&D/Move
テストにも存在しない。本チケットでは、cross-section ドロップも
`applyLineEditOutcome` への呼び出しが1回のまま（= 1つの `editor.replaceRange`
トランザクション）であることを保証するテストを追加することで、Undo が
既存の同一セクション内ドロップと全く同じ単位で機能することを担保した。
実機での Undo 動作確認はユーザー自身の実機確認に委ねる。

## 6. Move との整合性についての今後の課題

今回のスコープは D&D のセクション越え対応のみである。Move up/down の
セクション越え対応（callout/blockquote/fenced-code/table の隣接兄弟がいない
場合に見出しを飛び越える等）は別チケットで後日行う。
`move/findStandaloneComplexBlockMoveTarget.ts` は本チケットで一切変更して
いない。

## 7. 既知の制約

- 見出し行そのものを明示的なドロップターゲットとして扱う機能はない（3節参照）。
  ただしセクション内の任意の top-level ブロック/list item の前後を経由すれば
  実質的に同じ結果が得られる。
- composite-internal-boundary 以外の新しい安全ガードは追加していない
  （リストの cross-section 実装にも同等の追加ガードは存在しない）。
- Move up/down のセクション越え対応は本チケットのスコープ外（6節参照）。
