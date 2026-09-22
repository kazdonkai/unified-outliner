# Phase 5E-0 — Fenced Code Block / Markdown Table 読み取り専用 Outline Tree 投影基盤 設計メモ

作成日: 2026-09-22
対象: `src/tree/buildOutlineTree.ts`, `src/tree/resolveCurrentPositionNodeId.ts`, `src/view/OutlineTreeView.ts`, `src/settings.ts`, `src/settingsDefaults.ts`, `src/i18n.ts`
前提: `docs/phase5e_fenced-code-and-table-roadmap.md`（2026-09-12時点の詳細ロードマップ）、`ROADMAP.ja.md`（0.7.0時点）、既存実装（0.7.0, commit `de663be`）
方針: 0.7.0 で実装済みの内容（CompositeBlock構造化編集、リストのmarker-free編集、親子編集、外部再同期など）は、詳細ロードマップが前提とする「未実装」の記述であっても、本メモでは現在の実装を正とする。paragraph・callout/blockquoteの「Tree起動Partial Edit不可」という歴史的記述は、その後 Phase 5T-4A/5T-7A/5T-8A で変更済みであり、本フェーズの対象外機能には影響しない。

## 0. 今回の到達点（要約）

fenced-code と table を、既存の `complex-member`（`OutlineTreeComplexMemberNode`）投影基盤にそのまま乗せ、callout/blockquote が既に持つ「読み取り専用スタンドアロン行」の投影・親子解決・fold・選択同期・read-only二重防御の仕組みを **無変更のまま再利用** する。新しい Tree node kind、新しい read-only 判定の仕組み、新しい選択解決の仕組みはいずれも追加しない。

表示のON/OFFは、利用者確認の結果、**コードブロックと表を別々の設定トグル**（既定OFF、paragraphと同じオプトイン方式）とする。

## 1. 表示設定（利用者確認済み）

- `showFencedCodeInOutline: boolean`（既定 `false`）
- `showTablesInOutline: boolean`（既定 `false`）
- 既存 `showParagraphsInOutline` と同じ「オプションの有無がゲート」パターンを踏襲し、`BuildOutlineTreeOptions.standaloneComplexBlocks` に `includeFencedCode?: boolean` / `includeTables?: boolean` を追加する（`blocks` 自体は callout/blockquote 用と共有し、常に unfiltered な `complexScan.blocks` を渡す — フィルタは `isStandaloneComplexBlockEligible` 側で行う、既存方針を踏襲）。
- 理由: callout/blockquote は本プラグインの中核ドメインであり密度が低いため常時表示だが、fenced-code/table は技術ノートや史料比較表など、ノートによっては大量に出現しうる（paragraphが常時表示を避けた理由と同種）。利用者は最初オプトインを選択。

## 2. 投影対象を決める条件（eligibility と editability の分離）

- **投影対象 = `info.kind` が `"fenced-code"` または `"table"`、かつ `info.editability === "supported"`、かつ対応する設定トグルがON。**
- `parser/complexBlocks.ts` の `scanFencedCodeBlocks`/`scanTableBlocks` は既に以下の場合のみ `"supported"` を返す:
  - fenced-code: 開始・終了フェンスが確定している（未閉鎖でない）、かつ `resolveParentId` が単一の親（またはroot=null）に確定する。
  - table: header/delimiter行の列数が一致し、`resolveParentId` が確定する。
  - `mergeBlockRangesSafely` により、より高優先度のブロック（callout/blockquote）と範囲が重複した場合は `"ambiguous"` へ降格し `parentId` は `null` になる。
- `editability === "supported"` を eligibility の唯一の判定基準にすることで、以下が自動的に区別される（parser側で既に区別済みのものを再利用するだけで、Tree投影層で境界を再判定しない）:
  - 見出し前のroot配置（`parentId === null` かつ `supported`）と、真に親解決不能なケース（`ambiguous`）が自動的に分離される。
  - 未閉鎖fence・不正delimiter・境界曖昧は全て `ambiguous` となり非投影。
- 「supported」は編集可能性を意味しない（`model/complexBlock.ts` の既存方針どおり）。Tree投影の可否とPartial Edit等の操作可否は別ゲートとして扱う（§4）。

## 3. 親子関係と順序

既存の `groupStandaloneComplexBlocks`/`resolveStandaloneGroupKey`/`buildListNode`/`buildChildren` をそのまま再利用する。新規ロジックは追加しない。

- `ComplexBlockInfo.parentId` が実在する `ListBlockNode` を指す場合 → そのlist itemの子として投影（`buildListNode`内でマージ）。
- それ以外（`parentId` がsectionを指す、またはlist経由で祖先sectionへ解決、またはnull）→ 解決されたsection（またはtop-level）の兄弟として投影。これは詳細ロードマップ§2.3の「listの兄弟」という表現を「listの**子**」ではなく「listの直後だが非インデント＝section側」の意味へ正しく読み替えたもので、実装（`resolveStandaloneGroupKey`）は当初から正しくこの意味で動作している。
- 兄弟順序: `groupStandaloneComplexBlocks` が各グループ内を `range.startLine` でソートてみ。
- 二重表示防止: `consumedComplexBlockIds`（CompositeBlockの既存member）は除外済み。fenced-code/tableは現行のCompositeBlock生成規則の対象外（list+callout/list+quoteのみ）なので、この経路で二重投影されることはない。
- list表示OFF時の扱い: `buildChildren` は `includeLists` がfalseかつ当該list itemがCompositeBlockの先頭memberでない場合、そのlist item自体を子として辿らない。結果として、そのlist itemの子として解決されたfenced-code/tableも表示されない（callout/blockquoteの既存契約と同一）。section側へのフォールバック表示は行わない — 表示上の親省略と文書上の親関係を混同しない、という既存方針をそのまま踏襲。

## 4. read-only の二重防御

### 4.1 UI入口レベル（既存機構の無変更再利用）

`collectReadOnlyOutlineNodeIds`（`tree/buildOutlineTree.ts`）は `node.kind === "complex-member"` を無条件に read-only 集合へ含める。fenced-code/table も同じ `kind: "complex-member"` を使うため、**コード変更なしに** 以下が自動的に閉じる:

- `beginRenameForNode`: `node.kind !== "section" && "list"` で早期return（新規ガード不要）。
- rename/drag-and-drop/構造コンテキストメニューの各アタッチ率所（`renderNode`内、`!readOnly` ガード）: 全て非アタッチになる
- `aria-readonly`/`data-readonly` 属性: `readOnly` 変数から自動付与
- double-click: rename用リスナーは `!readOnly` 時のみアタッチされるため、fenced-code/table行では未アタッチのまま（誣って�aragraph同様の別rename経路に落ちることもない — 課当分岌は `isParagraph` のみ)。

### 4.2 「Open in Partial Edit」メニュー露出の遮断（新規ガードが必要な唯一の箇所）

既存の `isComplexMember && node.isStandalone` 分岐（`OutlineTreeView.ts` `renderNode`）は `showStandaloneComplexBlockMenu` を呼び出し、そのメニューは〪*班変条件に** ヌ「Open in Partial Edit」「Open in new window�`pを追加する。fenced-code/tableをこの分岐にそのまま到達させると、未実装の�artial Editメニューが露出してしまう。

**対策（詳細ロードマップ§2.2が提示した2案のうち①を採用）**: 新しいフラグを追加せず、composite-member側の既存パターン（`isComplexMember && !node.isStandalone && (node.complexKind === "callout" || node.complexKind === "blockquote")`）と全く同じ形の kind allow-list を、standalone側の分岐条件にも追加する。

```ts
} else if (
  isComplexMember &&
  node.isStandalone &&
  (node.complexKind === "callout" || node.complexKind === "blockquote")
) {
  // 既存 showStandaloneComplexBlockMenu 呼び出し（無変更）
}
```

fenced-code/table はこの分岐に到達しなくなり、右クリックメニュー自体が一切アタッテされない（読み取り専用ナビゲーションのみの行になる）。`showStandaloneComplexBlockMenu`自体・`buildStandaloneComplexBlockSnapshot`（`fenced-code`/`table`では既に`null`を返す）・`evaluateStandaloneComplexBlockMovability`（既存のkindホワイトリストで`"not-supported"`）はいずれも無変更のまま — これらは呼び出しなくなるだけで、内部の防御自体も無変更で維持される（defense-in-depth）。

モバイル長押しメニューは、standalone complex-member行に対する専用ブロックが現状のコードに存在しない（compositeのみ`isComposite && Platform.isMobile`ブロックを持つ）たも、追加のガードは不要。

### 4.3 D&D drop先としての除外

`renderNode`のD&Dワイヤリングは `if (!readOnly) { selfEl.draggable = true; ... }` の内側でのみ行われる。fenced-code/table行は`readOnly`なのでdraggable属性が付与されず、drag source にもdrop targetにもならない（callout/blockquoteと同一の既存契約をそのまま継承）。

### 4.4 本文側の既存操作は無変更

`move/moveBlock.ts` 系のカーソル位置ベース「Move block」（fenced-code/tableを既存の最小安全ブロックとして扱う機構）、および親section/list全体のTree操作・move・fold・CompositeBlock編集・paragraph編集は、本チケットでは一切変更しない。読み取り専用制約は「今回追加した新しいTree行」には適用する。

## 5. 選択・ハイライトの対象解決方法

`tree/resolveCurrentPositionNodeId.ts` の `candidateTreeId` に `"fenced-code"`/`"table"` の分岐を追加し、`info.id` を返すようにする（callout/blockquoteと全く同じ扱い）。この関数は「候補IDが `nodeById` に実在するか」を最終判定に使うため、投影されていない（設定OFF・editability非supported等）ブロックは自動的に除外され、誤ハイライトしない。範囲外の前後行は既存の `cursorLine < startLine || cursorLine > endLine` チェックでカバー済み。

クリック/タップでの本文ジャンプは `buildStandaloneComplexNode` の既存 `line: info.range.startLine` をそのまま使うため、fenced-codeは開始fence行、tableはheader行へ自動的にジャンプする（追加実装不要）。

外部編集・Undo/Redo・ノート切替時の再解決は、Tree全体を毎回 `refresh()` で再構築する既存設計（stale nodeを残さない）にそのまま乗る。選択のnearest-visible-ancestorフォールバック・selection-follow/repairも`resolveCurrentPositionNodeId`を共有する既存の仕組みでカバーされる。

## 6. 曖昧ケース・重複の扱い

- 非表示の親list（list表示OFF）: §3参照 — 表示されない。
- CompositeBlockとの重複: `consumedComplexBlockIds` により構造的に発生しない。
- 曖昧なrange: `editability !== "supported"` として非投影（推測でrootへ付け替えない）。
- frontmatter・fenced-code内部の見出し/リスト/表風テキスト: `parser/complexBlocks.ts` が `doc.frontmatterLines`/`doc.codeBlockLines` を正として既に除外済み（既存parser層、無変更）。

## 7. ラベル仕様

`tree/buildOutlineTree.ts` の `standaloneComplexBlockLabel`/`buildStandaloneComplexNode` に分岐を追加する（新規パーサは作らない）。

**fenced-code**: 開始fence行の次行から最初の非空行を探索し、`info.infoString`（既存フィールド、既にscanner側で確定済み）に応じて整形:
  - `mermaid` → `Mermaid: <line>`
  - `dataview` → `Dataview: <line>`
  - `dataviewjs` → `DataviewJS: <line>`
  - その他非空language → `<language>: <line>`
  - language未指定 → `<line>`（プレフィックスなし）、本文もない場合は固定ラベル `Code block`
  - 空本文かつlanguage指定あり → language名を固定ラベルとして使用
  - 改行・連続空白は単一空白へ正規化（`normalizeParagraphLabelText`と同じ考え方を小さく再実装、または共有ヘルパー化）、`truncateStandaloneLabel`（既存、80文字）で切り詰め。

**table**: header行（`info.range.startLine`）をパイプで分割し、空でない列名を先頭から最大3つ、` | ` で連結して `Table: <summary>` とする。分割・整形に失敗する、または刖名がすべて空の場合は固定ラベル `Table` にフォールバックする。既存 `parser/complexBlocks.ts` の `splitTableRow` 等の内部関数は import せず（非公開関数のため）、ラベル専用の軽量な分割処理を `buildOutlineTree.ts` 内に閉じて実装する — 完全なtable parserは新設しない。

**共通**: `STANDALONE_FENCED_CODE_PREFIX = "◫ "`、`STANDALONE_TABLE_PREFIX = "▦ "` を追加。開始/終了fenceそのものを本文要約に使わない。language判定にinfo stringを使うのみで原文は変更しない。MarkdownRenderer等でのレンダリング・実行は一切行わない。i18nキー（固定ラベル `Code block`/`Table`、診断用文言）は `src/i18n.ts` の既存方式でen/ja両方に追加する。

## 8. 拒否・非投影条件（テストカテゴリC対応）

- 未閉鎖fence → `editability: "ambiguous"` により非投影。
- delimiter行の欠如・列数不一致 → 同上。
- 境界曖昧（section/list境界をまたぐ）→ 同上。
- frontmatter/fenced-code内部の見出し・リスト・表風テキスト → scanner側で最初から候補にならない。
- CompositeBlockとの重複 → `consumedComplexBlockIds`で除外。
- thematic-break → 本チケットのスコープ外として一切触れない（既存の非対象のまま）。

## 9. テスト方針

既存の `tests/standaloneComplexBlockUiWiring.test.ts` 等のテスト構成（純粋関数の直接テスト＋静的ソース検査によるUI配線検査）を踏襲し、新規テストファイルを追加する。詳細は実装時にタスク側で列挙する。

## 10. 実機確認

`/Users/kazumikaizuka/Obsidian/ipad-test/Test/phase5e0-complex-block-tree-projection-verification.md` に手動確認用fixtureとチェックリストを用意する。自動テスト成功のみでは受入完了とせず、利用者の実機確認待ちとする。
