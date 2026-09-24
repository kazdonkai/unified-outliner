# Phase 5E-3d: Table Move / Delete / Drag-and-Drop Parity

## 1. 背景とスコープ

Phase 5E-2A/5E-2B（table の raw Partial Edit）が 0.7.7 でリリース済みで、
table blocks は既に Outline Tree に projection され（`isStandaloneComplexBlockEligible`
in `src/tree/buildOutlineTree.ts` が `includeTables` フラグ経由で
`"table"` を kind 許可集合に含む）、"Open in Partial Edit" が機能してい
た。本フェーズは、fenced-code block が Phase 5E-1 で既に獲得している
Move（上下入れ替え）・Delete（一括削除）を table にも与え、加えて Drag
and Drop を table に新規追加する。

このコードベース自身の確立された拡張パターン（callout/blockquote →
fenced-code の Phase 5E-1 拡張ですでに実証済み）は「新しい move/delete
ロジックを書かない — 既存の callout/blockquote/fenced-code のハード
コードされた kind 許可集合を widen する」である。本フェーズもこの方針
を厳格に踏襲した。


## 2. 設計原則（ticket 記載どおり、変更禁止）

- table 用の新しい range 決定・パーサーロジックは書かない。既存の
  `ComplexBlockInfo`（`kind: "table"`）の `range`/`editability` を
  callout/blockquote/fenced-code と全く同じ形でそのまま再利用する。
- move/delete/drag の共有パイプラインを複製しない — 既存の kind 許可
  集合を widen するだけ。
- Partial Edit session の conflict 検知には table 固有の特例を追加しな
  い — 既存の再解決メカニズム（callout/blockquote/fenced-code の
  move/delete で既に一様に使われているもの）が table を含むことを widen
  だけで自動的にカバーすることを確認した。
- 確信を持って range を確定できない table（不正な形式）は、既存の
  `ComplexBlockInfo.editability`/range 検証チェックにより安全に操作を
  拒否し、元の Markdown を変更しない。
- 移動・削除された table 周辺の空行ポリシーは section/list/callout/
  fenced-code と同一 — 共有関数の再利用から自然に導かれる。


## 3. 実装（ファイルごと）

### 3.1 Move: `src/edit/moveStandaloneComplexBlock.ts`

- `StandaloneComplexBlockMoveKind` を
  `Extract<ComplexBlockKind, "callout" | "blockquote" | "fenced-code">`
  から `"table"` を含む形に widen。
- `buildStandaloneComplexBlockSnapshot`・`findRangeInvalidReason` の
  kind ガードを widen。
- モジュール冒頭のdocコメントの「table in particular stays read-only,
  unchanged from Phase 5E-0」「paragraph/table/thematic-break remain out
  of scope」という記述を、table が対象になったことを反映して修正。

### 3.2 Move の judge/resolver: `src/parser/compositeBlocks.ts`

- `isStandaloneComplexBlockShapeEligible`（kind/editability/nested-in-list
  の3条件ゲート）の kind ガードを widen。
- `evaluateStandaloneComplexBlockMovability` の kind ガードを widen。
- `findAdjacentStandaloneComplexBlock`・
  `isStandaloneComplexBlockMoveCandidate` はこの2関数を経由するため
  **コード変更不要**（widen した `isStandaloneComplexBlockShapeEligible`
  を再利用しているため、table が adjacency candidate としても自動的に
  有効になる）。
- セクション先頭のコメント（Phase 5C-3 の候補集合説明）を、fenced-code
  ・table が既に対象であることを反映して更新。

### 3.3 Move の resolver: `src/move/findStandaloneComplexBlockMoveTarget.ts`

このファイル自身に kind ガードは存在しなかった（`evaluateStandaloneComplexBlockMovability`
に完全に委譲する設計）。**コード変更不要** — doc コメントのみ、fenced-code
/table 双方の widen 履歴を反映するよう更新した。

### 3.4 Delete: `src/edit/deleteStandaloneComplexBlock.ts`

- `StandaloneComplexBlockDeleteKind` を `"fenced-code"` のみから
  `"fenced-code" | "table"` に widen。
- `buildStandaloneComplexBlockDeleteSnapshot`・内部の
  `findRangeInvalidReason` の kind ガードを widen。
- `snapshotMatches`・削除本体・空行正規化ロジックは既に kind 非依存
  （`info.kind !== snapshot.kind` の構造比較のみ）のため変更不要。
- callout/blockquote は引き続き対象外（本フェーズのスコープ外、変更な
  し）。

### 3.5 Delete のメニュー配線: `src/view/OutlineTreeView.ts`

- `showStandaloneComplexBlockMenu` 内の Delete item ゲートを
  `target.kind === "fenced-code"` から
  `target.kind === "fenced-code" || target.kind === "table"` に widen。
- `ConfirmFencedCodeDeleteModal` に新規 `kind` コンストラクタ引数
  （`StandaloneComplexBlockDeleteKind`）を追加し、title のみ kind ごと
  に切り替え（body/undo-note は既に kind 非依存の文言だったため共通の
  まま）。

### 3.6 Delete confirmation copy: `src/i18n.ts`

新規 i18n キー `modal.deleteTableTitle`（EN/JA）を、既存の
`modal.deleteFencedCodeTitle` と全く同じ命名規約・置き場所で追加した。
body/undo-note は既存の `modal.deleteFencedCodeBody`/
`modal.deleteFencedCodeUndoNote` をそのまま再利用（table 専用のキーは
追加していない — 文言が既に kind 非依存だったため）。

### 3.7 Drag and Drop: `src/move/findStandaloneComplexBlockDropTarget.ts`

`resolveStandaloneComplexBlockDropTarget` の source kind ガードを
`source.kind !== "callout" && source.kind !== "blockquote"` から
table を含む形に widen した。

**重要な発見（ticket の前提との相違）**: `dropStandaloneComplexBlock.ts`
自体には独自の kind 許可集合はなく、`moveStandaloneComplexBlock.ts` の
`findRangeInvalidReason`/`snapshotMatches` を再利用する設計だった。しか
し実際にソースを読んだところ、fenced-code は Phase 5E-1 で Drag and
Drop を **一度も獲得していなかった**（Phase 5E-1 自身のスコープは
Partial Edit・Move・Delete のみで D&D は含まれていない — `docs/phase5e1_fenced-code-partial-edit-move-delete-design-memo.md`
にも D&D の記載はない）。`resolveStandaloneComplexBlockDropTarget` の
source kind ガードは widen 前は `"callout" | "blockquote"` のみで、
`tests/findStandaloneComplexBlockDropTarget.test.ts` にも「fenced-code
は not-supported で拒否される」という既存テストが実在した。

このため本フェーズは、ticket の想定（「fenced-code の D&D と同じ経路
を widen する」）どおりに **table のみ** をこのゲートと後述の
`view/OutlineTreeView.ts` の drag-wiring guard に追加し、fenced-code
は意図的に widen しなかった（既存テストは無変更のまま green）。
fenced-code 自身への D&D 追加は本フェーズのスコープ外の別課題として
扱う。

> **2026-09-24 追記（follow-up ticket "fenced-code D&D parity"）**:
> ユーザーから明示的に fenced-code への D&D 追加を依頼され、上記で
> 「本フェーズのスコープ外の別課題」としていたものに、本フェーズと同じ
> ブランチ（`phase5e3d-table-move-delete-dnd`）上の3コミット目として
> 着手した。当時 table のみに限定した判断そのものは（コードベースの
> 実態と ticket の前提が食い違っていたための保守的選択として）引き続
> き正しかったが、それを受けてこの別課題を実施する判断が今回下された
> — 上記の説明は当時の判断根拠の記録としてそのまま残す。
>
> 変更内容: `resolveStandaloneComplexBlockDropTarget` の source kind
> ガードに `source.kind !== "fenced-code"` を追加し、callout/
> blockquote/table と同列に fenced-code を受理するようにした。
> `dropStandaloneComplexBlock.ts` は元々 kind 非依存のままなので無変
> 更。`view/OutlineTreeView.ts` 側の変更は §3.8 の追記を参照。
> `tests/findStandaloneComplexBlockDropTarget.test.ts` の「fenced-code
> は not-supported で拒否される」という既存テストは「fenced-code は
> 受理される」に反転した。

### 3.8 Drag and Drop の DOM 配線: `src/view/OutlineTreeView.ts`

`renderNode` 内の standalone-bridge drag-wiring guard（
`isComplexMember && node.isStandalone && (node.complexKind === "callout" || node.complexKind === "blockquote") && !Platform.isMobile`）
に `node.complexKind === "table"` を追加した。これにより table の
standalone row が `handleCalloutDragStart`/`handleParagraphDragOver`/
`handleParagraphDrop`（callout/blockquote が既に使っている、kind 非依
存の共有ハンドラ群）にそのまま乗る。新しいハンドラは一切書いていない。

table は composite member になることが決してない（既存の
`CompositeBlockRule` はどれも table を member にしない）ため、
composite-member 側の drag-wiring guard（`!node.isStandalone` 分岐）
は widen していない。

`resolveInsertion`/挿入枠組み(insertionFramework)には触れていない
（本フェーズのスコープ外）。

> **2026-09-24 追記（モバイル follow-up fix）**: 上記の
> `&& !Platform.isMobile` 除外は、実機（iPad）検証で「モバイルでは
> D&D ができない。6点マークが必要ではないか？」と報告され、除外され
> ていた。原因は二重で、(1) `dragHandleEl`（6点グリップハンドル）の
> 生成条件 `if (!readOnly || isComposite)` が standalone
> callout/blockquote/table row（常に `readOnly` かつ `isComposite`
> ではない）を一切満たさずハンドル自体が存在しなかったこと、(2) この
> セクションで説明した standalone-bridge guard 自身の
> `&& !Platform.isMobile` がモバイルでの配線そのものを丸ごと除外して
> いたこと。両方を修正: `dragHandleEl` の生成条件に
> `isEligibleStandaloneComplexMember`（callout/blockquote/table のみ、
> fenced-code は対象外のまま）を追加してハンドルを生成し、この
> standalone-bridge guard から `&& !Platform.isMobile` を除去した上
> で、`draggable` 属性の設定を section/list の既存 UXP-01 パターン
> （モバイルでは `dragHandleEl`、デスクトップでは `selfEl` に付与）
> と同じ形に揃えた。dragover/drop/dragend の各リスナー自体は元々
> platform 非依存だったため変更不要。fenced-code は本フィックスでも
> 引き続き対象外（ハンドルも D&D も付与しない）。詳細は
> `src/view/OutlineTreeView.ts` の `dragHandleEl` 生成条件と
> standalone-bridge drag-wiring branch 自身の更新済みドキュメント
> コメント、および `tests/standaloneComplexBlockDropUiWiring.test.ts`
> を参照。
>
> **2026-09-24 再追記（follow-up ticket "fenced-code D&D parity"）**:
> 上記で「fenced-code は本フィックスでも引き続き対象外」としていた
> 除外は、同じ 2026-09-24 のうちに行われたこの follow-up ticket で
> 解除された。`isEligibleStandaloneComplexMember` と、それとは独立
> した standalone-bridge drag-wiring guard(このセクション冒頭で説明
> した `else if` 条件)の両方の kind 許可集合に `"fenced-code"` を
> 追加し、callout/blockquote/table と同じ経路(`dragHandleEl` の生成、
> `handleCalloutDragStart`/`handleParagraphDragOver`/
> `handleParagraphDrop` への配線、デスクトップ/モバイルの
> handle-vs-row split)にそのまま乗せた。新しいハンドラ・新しい
> resolver は一切書いていない。詳細は §3.7 末尾の追記、および
> `src/view/OutlineTreeView.ts` の両ガード自身の更新済みドキュメント
> コメントを参照。


## 4. テスト

- `tests/phase5e3dTableMoveDeleteDnd.test.ts`（新規、19件）: Phase
  5E-1 の `phase5e1FencedCodePartialEditMoveDelete.test.ts` の
  Move/Delete カテゴリ構成をほぼそのまま table 用に踏襲し、加えて
  Drag and Drop（新規カテゴリC）と UI 配線ガード（新規カテゴリD）を
  カバーする。
  - Move: 上/下入れ替え、空行ギャップ保持、リスト継続下ネストによる
    拒否（`nested-in-list`）、boundary-changed（conflict 検知相当）
    拒否。
  - Delete: 原子的削除、3行以上の空行run正規化、boundary-changed
    拒否、nested-in-list による not-supported 拒否。
  - D&D: `resolveStandaloneComplexBlockDropTarget` の許可/拒否ケー
    ス、fenced-code が引き続き not-supported のままであることの回帰
    確認、`dropStandaloneComplexBlock` のend-to-end drop（list item
    の前・callout の後）が手動カット&ペーストと一致することの検証、
    source-boundary-changed 拒否。
  - UI配線: メニューのアタッチガードと D&D のドラッグ配線ガードそれ
    ぞれを `view/OutlineTreeView.ts` の実ソースから再現し、table が
    両方に、fenced-code はメニューのみに（D&D 配線には）含まれること
    を確認。
- 以下の既存テストは、本フェーズの意図的な仕様変更（table が
  Move/Delete/D&D 対象に含まれるようになったこと）を反映して更新した
  （すべて「以前の仕様を pin していた回帰ガード」を「新しい意図的な仕
  様を確認するテスト」に置き換え）:
  - `tests/moveStandaloneComplexBlock.test.ts`:
    「non-callout/blockquote/fenced-code kind は null を返す」の
    defense-in-depth fixture を table から thematic-break に差し替
    え、新規に「table を受理する」テストを追加。
  - `tests/phase5e0FencedCodeTableUiWiring.test.ts`: 「table は Move
    から除外され続ける」テストを「table も Move を獲得した」テストに
    反転。
  - `tests/phase5e2aTableRawPartialEdit.test.ts`: 「table には
    Move/Delete が表示されない」テストを「table にも表示される」テス
    トに反転。
  - `tests/standaloneComplexBlockDropUiWiring.test.ts`: standalone
    bridge branch を検出する静的ソース文字列マッチを、table 追加後の
    整形済みソースに合わせて更新。
  - `tests/standaloneComplexBlockMovability.test.ts`: 「隣接ブロック
    が table のとき no-adjacent-compatible-unit」の fixture を
    thematic-break に差し替え、新規に「隣接ブロックが table のとき
    eligible: true」テストを追加。


## 5. 実装が既存パイプライン共有原則に従ったことの確認

- 新しい range 決定・パーサーロジックは一切書いていない — table の
  `ComplexBlockInfo.range`/`editability` は Phase 5E-2A/2B が確立した
  scanner の出力をそのまま再利用した。
- move/delete/drag の並行パイプラインは作っていない — 既存の kind 許可
  集合（`StandaloneComplexBlockMoveKind`、
  `StandaloneComplexBlockDeleteKind`、
  `isStandaloneComplexBlockShapeEligible`、
  `evaluateStandaloneComplexBlockMovability`、
  `resolveStandaloneComplexBlockDropTarget`、renderNode の drag-wiring
  guard）を widen しただけである。
- 唯一の意図的なスコープ判断（§3.7 参照）: fenced-code は D&D にまだ
  widen しなかった。これは ticket の「fenced-code の D&D と同じ経路を
  widen する」という前提が、実際のコードベースの状態（fenced-code は
  D&D を一度も獲得していなかった）と食い違っていたための判断であり、
  新しいロジックの追加ではなく、widen の対象を ticket の文字どおり
  「table のみ」に限定したという保守的な選択である。


## 6. 自動検証

- `npx tsc --noEmit -skipLibCheck`: エラーなし
- `npx vitest run`: 157ファイル / 3263件全通過（既存 3242件 + 新規21件
  = 3263件、回帰なし。既存5件の意図的仕様変更に伴うテスト更新を含む）
- `npm run lint`: 0エラー（既存の `src/settings.ts` 警告3件のみ、本変
  更と無関係）
- `npm run build`: 成功


## 7. 非目標（本フェーズのスコープ外）

- fenced-code block への Drag and Drop 追加（§3.7 参照、別課題）。
- callout/blockquote への Delete 追加（引き続きスコープ外、変更なし）。
- table のセル単位 D&D（列/行の並べ替え）— これは Table Mode
  （Phase 5E-3c）の `moveRow` 等の別機構であり、本フェーズの
  「ブロック全体の」Move/Delete/D&D とは無関係。
- 新しい insertionFramework の kind 追加、`resolveInsertion` の変更。
- conflict 検知メカニズム自体の変更（table 固有の特例は追加していな
  い — 既存の再解決メカニズムが自動的にカバーすることを確認した）。


## 8. 実機確認

**確認状況**: 本セッションでは実機（Obsidian デスクトップ/モバイルアプ
リ）での動作確認は一切行っていない。上記の自動検証（vitest/tsc/lint/
build）のみを実施した。実機確認はユーザー自身の責任で別途行われる
（`phase5e3c-table-mode` ブランチ以前の各フェーズと同じワークフロー）。
このブランチは `main` にマージされておらず、バージョン番号も変更してい
ない。

## 9. 追記（follow-up ticket "standalone callout/blockquote Delete"、2026-09-24、同一ブランチ）

ユーザー自身が本ブランチ（`phase5e3d-table-move-delete-dnd`）を実機
（iPad）で受け入れテストしている最中に、standalone な callout/
blockquote 行のコンテキストメニューに Delete 項目が一切無いことに気づ
き、報告された。§3.4/§7 で「callout/blockquote は引き続き対象外（本
フェーズのスコープ外、変更なし）」としていたのはまさにこの状態であ
り、ギャップかどうかの確認と、もしギャップなら実装することが依頼され
た。

**調査結果**: `edit/deleteStandaloneComplexBlock.ts` 自身の元々の doc
コメントを読んだ限り、callout/blockquote が除外されていたのは技術的
な制約ではなく、単に「そのフェーズ（Phase 5E-1）の brief に含まれてい
なかった」という理由だった。実際、このモジュールの削除・再検証ロジッ
ク自体（`snapshotMatches`、削除本体、`normalizeBlankRunAtBoundary`）
は元から kind 非依存で、`ComplexBlockInfo.range` を不透明な行範囲とし
て削除するだけであり、callout の fold marker や blockquote 自身のネス
ト引用処理を一切再解釈しない。§3.2 で確認した
`isStandaloneComplexBlockShapeEligible`（このモジュールが再利用する適
格性ゲート）も、Move 機能で callout/blockquote を含めて既に汎用化済み
であることを再確認した。つまり、これは真の技術的制約ではなく単なる
「未依頼だっただけ」のギャップであり、本フェーズ・Phase 5E-1 と全く同
じ確立されたパターン（既存の kind 許可集合を widen するだけ、新しい
range/parser ロジックは書かない）で安全に実装できると判断した。

**変更内容**（§3.4〜§3.6 と同じファイル群、いずれも allow-list の widen
のみ）:

- `src/edit/deleteStandaloneComplexBlock.ts`: `StandaloneComplexBlockDeleteKind`
  を `"fenced-code" | "table"` から `"fenced-code" | "table" | "callout" | "blockquote"`
  に widen。`buildStandaloneComplexBlockDeleteSnapshot`・
  `findRangeInvalidReason` の kind ガードも同様に widen。`snapshotMatches`・
  削除本体・空行正規化ロジックは無変更（元から kind 非依存のため）。
- `src/view/OutlineTreeView.ts`: `showStandaloneComplexBlockMenu` 内の
  Delete item ゲートを `target.kind === "fenced-code" || target.kind === "table"`
  から `callout`/`blockquote` も含む形に widen。Move up/down は元々
  callout/blockquote を含めて kind 非依存だったため、この Delete ゲー
  トが本メソッド内で唯一残っていたギャップだった。
- `src/view/ConfirmFencedCodeDeleteModal.ts`: `kind` パラメータ
  （`StandaloneComplexBlockDeleteKind`）の分岐に `"callout"`/`"blockquote"`
  を追加し、それぞれ専用の title key を選択するようにした。body/
  undo-note は既に kind 非依存のため無変更。クラス名は変更していない
  （§3.5 で table 追加時に既に確立された「動いているものを不要に改名
  しない」という本ブランチの抑制的方針を踏襲）。
- `src/i18n.ts`: 新規 i18n キー `modal.deleteCalloutTitle`/
  `modal.deleteBlockquoteTitle`（EN/JA）を、既存の
  `modal.deleteFencedCodeTitle`/`modal.deleteTableTitle` と全く同じ命
  名規約・置き場所で追加した。JA の用語は
  `tests/standaloneComplexBlockUiWiring.test.ts` が既に固定している
  `partialEdit.kindCallout`（「コールアウト」）/
  `partialEdit.kindBlockquote`（「引用」）の訳語に合わせた。

**テスト**: `tests/phase5e3dTableMoveDeleteDnd.test.ts` の最終テスト
（Delete ゲートが `callout`/`blockquote` を `false` と pin していた回
帰ガード）を、新しい意図的な仕様（`true`）を確認するテストに反転し
た。新規ファイル `tests/phase5e3dStandaloneCalloutBlockquoteDelete.test.ts`
（11件）を追加し、
`tests/phase5e1FencedCodePartialEditMoveDelete.test.ts`/
`tests/phase5e3dTableMoveDeleteDnd.test.ts` の Delete カテゴリ構成を
ほぼそのまま踏襲して、標準的な原子的削除・空行run正規化・
boundary-changed 拒否・composite-member 拒否・not-supported（リスト
継続下ネスト）拒否を callout/blockquote それぞれについて検証、加えて
新規 i18n キーと Delete メニューゲートの UI 配線再現テストを追加し
た。Move/Drag-and-Drop 側のテストは一切変更していない（本 follow-up
は Delete のみのスコープであり、それらは元から callout/blockquote を
サポート済みのため）。

**自動検証**: `npx tsc --noEmit -skipLibCheck` エラーなし、
`npx vitest run` 158ファイル / 3279件全通過（既存3268件 + 新規11件、
既存テストの反転1件を含むが回帰なし）、`npm run lint` 0エラー（既存の
`src/settings.ts` 警告3件のみ、本変更と無関係）、`npm run build` 成
功。実機確認は本 follow-up でも一切行っていない。

**非目標**: Move・Drag and Drop は元から callout/blockquote をサポー
ト済みのため対象外。新しい range/parser ロジックは一切追加していない。
