# Phase 5E — Fenced Code Block と Markdown Table 統合ロードマップ

作成日: 2026-09-12
対象: `src/model/complexBlock.ts`, `src/parser/complexBlocks.ts`, `src/tree/buildOutlineTree.ts`, `src/view/OutlineTreeView.ts`, `src/settings.ts`, `src/settingsDefaults.ts`, `src/i18n.ts`（新規追加を含む Partial Edit / Tree 投影 / 挿入基盤全体）
関連: `docs/phase5c_block-model-and-tree-display-spec.md`, `docs/phase5d0_basic-block-extension-and-composite-block-spec.md`, `docs/phase5d0_3_composite-block-outline-tree-projection-design-memo.md`

本書は、Phase 5E（fenced code block と Markdown table の Tree 投影・新規挿入・Partial Edit 対応）に関する4回の検討を統合し、実装に着手可能な単一のロードマップとしてまとめたものである。既存の Phase 5C／5D の解析基盤（`ComplexBlockInfo` によるブロック境界・親子関係・editability 判定）を前提とし、それを Outline Tree・新規挿入・Partial Edit の各層へ安全に接続する方針を定める。

---

## 0. 全体方針

Unified Outliner の中心原則は「Markdown を唯一の正とし、可変長の意味単位を安全に扱うこと」である。Phase 5E ではこの原則を保ったまま、fenced code block（Mermaid・Dataview・DataviewJS・各言語コード等）と Markdown table を、他の block と同等の第一級オブジェクトとして扱えるようにする。

Mermaid・Dataview 等は独立した種別（`ComplexBlockKind` に新値を追加する意味での「BlockKind」）にしない。これらは Markdown 構文上すべて `ComplexBlockKind` の `"fenced-code"` であり、差分は開始 fence の `language` / info string に過ぎない。この一本化により、範囲パーサ・Tree node 型（既存 `complex-member`）・Partial Edit・競合検知を言語ごとに重複させずに済む。

全体は次の5段階に分割する。実装順序は原則としてこの並びに従う（投影 → 挿入 → 編集・操作）。

```text
Phase 5E-0:    Complex Block の Outline Tree 投影基盤（読み取り専用）
Phase 5E-0.5:  Block Insertion Framework（新規ブロック挿入: メニュー・コマンド・設定）
Phase 5E-1:    Fenced Code Block の操作統合（Partial Edit → move/delete/drag/indent-outdent）
Phase 5E-2:    Markdown Table の操作統合（2A: Raw Partial Edit → 2B: 軽量 Table Mode）
```

各段階の受入基準を満たしてから次段階に進む。特に「投影が編集より先」「新規挿入は既存編集操作と独立した基盤として設計する」の2点を優先順位の軸とする。

---

## 1. 現状整理

| 層 | fenced-code | table | 状態 |
|---|---:|---:|---|
| 範囲認識（scanner） | 対応 | 対応 | 実装済み |
| `ComplexBlockInfo` による種別・range・親判定 | 対応 | 対応 | 実装済み |
| list item の子としての親子判定 | 対応 | 対応 | 実装済み |
| editability / 安全性の分類 | 対応 | 対応 | 実装済み |
| Outline Tree の単独ノード表示 | 未実装 | 未実装 | 要実装（5E-0） |
| Tree からの選択・カーソル同期 | 未実装 | 未実装 | 要実装（5E-0） |
| 新規ブロック挿入（メニュー・コマンド） | 未実装 | 未実装 | 要実装（5E-0.5） |
| move / drag & drop / delete | 未実装 | 未実装 | 要実装（5E-1 / 5E-2） |
| Partial Edit Pane | 未実装 | 未実装 | 要実装（5E-1 / 5E-2） |

既存の CompositeBlock（`list + callout` / `list + blockquote` を集約する読み取り専用の第三層）は、任意の `fenced-code` / `table` を Tree に出す一般機構ではない。Phase 5E ではこれとは別レイヤーとして、`fenced-code` / `table` をまず単体ブロックとして安全に投影することを優先し、CompositeBlock との統合は本フェーズの対象外とする。

---

## 2. Phase 5E-0: Complex Block の Outline Tree 投影基盤

### 2.1 目的

`fenced-code` と `table` を、既存の `section` / `list` を中心とした Outline Tree の中に、読み取り専用の単独ノードとして安全に投影する。編集・書き戻しは本段階の対象外。

### 2.2 Tree モデルの一般化（既存の `complex-member` 基盤を拡張する）

**重要（既存コード確認済み、2026-09-12 追記）**: fenced-code / table 用に新しい Tree node kind を作る必要はない。`src/tree/buildOutlineTree.ts` には、callout / blockquote の standalone 行を投影するための `OutlineTreeComplexMemberNode`（`kind: "complex-member"`）が既に存在し、`complexKind: ComplexBlockKind` フィールドも既にある。

```ts
// 既存（src/tree/buildOutlineTree.ts、抜粋・要約）
export interface OutlineTreeComplexMemberNode {
  kind: "complex-member";
  id: string;
  complexKind: ComplexBlockKind; // "callout" | "blockquote" | "fenced-code" | "table" | "paragraph" | "thematic-break"
  label: string;
  prefix?: string;
  isStandalone: boolean;
  line: number;
  children: OutlineTreeNode[]; // 常に []
}
```

この型は現在、CompositeBlock の member 行（`buildMemberNode`）と、standalone な callout/blockquote 行（`buildStandaloneComplexNode`）の両方で共用されている。standalone 側の投影経路は次の関数群で構成される。

- `isStandaloneComplexBlockEligible(info)`（`buildOutlineTree.ts` 898行付近）: 現在は `(info.kind === "callout" || info.kind === "blockquote") && info.editability === "supported"` に**ハードコードされており**、関数の doc comment 自身が「Every other ComplexBlockKind (fenced-code/table/paragraph/thematic-break) is out of scope for this ticket and excluded unconditionally」と明記している。
- `groupStandaloneComplexBlocks` → `resolveStandaloneGroupKey`（同ファイル）: `ComplexBlockInfo.parentId` を再解析せずそのまま使い、list item の子か section の子かを決める既存ロジック。
- `buildStandaloneComplexNode`（同ファイル 1041行付近）: 上記のグルーピング結果から `kind: "complex-member"` ノードを生成する。

**したがって Phase 5E-0 の実装は、新種別の追加ではなく「`isStandaloneComplexBlockEligible` の対象 kind を `"fenced-code"` / `"table"` にも広げる」ことが基本方針になる。** 新しい `"complex"` kind や独自の `rangeStart`/`rangeEnd`/`depth` フィールドは作らず、既存の `complex-member` の形（`complexKind` / `label` / `prefix?` / `isStandalone` / `line` / `children: []`）にそのまま合わせること。これは、`docs/phase5t5_cursor_to_tree_highlight_design.md` §7-1 で利用者自身が「fenced code・table 用の専用 Tree row を新設する（スコープ拡張を伴う）方向で別チケットを起こすか」を判断事項として提示し、§8 でいったん「今回の対象外（現状 Tree row を持たないため）」と確定させていた項目そのものであり、Phase 5E-0 はその保留を解消する回である。

**重大な副作用リスク（要調査・要対策）**: `isStandalone: true` は、`OutlineTreeView.ts` のメニュー構築チェーンで `isComplexMember && node.isStandalone` の分岐に入り、既存の `showStandaloneComplexBlockMenu(...)` が「Open in Partial Edit」メニュー項目を出す唯一のシグナルにもなっている（現在は callout/blockquote の Partial Edit が実装済みのため機能している）。つまり `isStandaloneComplexBlockEligible` を fenced-code/table にも広げるだけだと、**Partial Edit がまだ存在しない Phase 5E-0 の段階で「Open in Partial Edit」メニューが fenced-code/table にも自動的に出てしまう**可能性が高く、これは 5E-0 が要求する「編集・書き戻しは完全に非目標」「Tree 上から…Partial Edit は実行できない」という受入基準に反する。実装前に `showStandaloneComplexBlockMenu` の実装を調査し、少なくとも次のいずれかを取ること。

1. メニュー側に「その kind の Partial Edit が実装済みか」を判定する明示的な allow-list を追加し、fenced-code/table は Phase 5E-1/5E-2 が実装されるまでこの allow-list に加えない。
2. `isStandalone` とは別に、5E-0 専用の「Tree に出すが Partial Edit 入口はまだ出さない」ことを表すフラグを新設し、メニュー側の分岐をそのフラグで追加ガードする。

どちらを採るかは実装調査の結果に委ね、Claude 側の判断・提案を求めること（本ロードマップで先取りして確定しない）。

なお、paragraph（Phase 5P-3）は同じ `complex-member` を意図的に流用せず、独立した `"paragraph"` kind を新設している。理由は「Tree からの Partial Edit 起動を一切許可しない」という paragraph 固有の制約（5P-2 のカーソル起動限定契約）を守るためであり（`docs/phase5p3d_paragraph-tree-display-design.md` §5-2）、fenced-code/table には当てはまらない。fenced-code/table は Phase 5E-1/5E-2 で Tree からの Partial Edit を最終的に許可する計画であるため、paragraph と同じ「別 kind に切り出す」対策ではなく、上記の「一時的なメニューガード」で時期を制御する方が既存設計により忠実である。

| Tree 上の `kind` | 意味 |
|---|---|
| `section` | 見出し階層を持つ構造コンテナ |
| `list` | list marker とインデント階層を持つ構造単位 |
| `complex-member`（既存） | callout / blockquote / fenced-code / table 等の単一 Markdown ブロック（`complexKind` で判別） |
| `paragraph`（既存、別枠） | 段落。5P-3 の理由により `complex-member` とは意図的に別 kind |
| `composite`（既存） | 複数の block を集約した上位の表示・操作単位 |

種別を安易に node kind へ増やさず、既存の `complex-member` を再利用すること。「Tree 上の役割」と「Markdown 上の block kind（`ComplexBlockKind`）」は既存コードの通り分離されている。

### 2.3 Tree への挿入規則

`ComplexBlockInfo.parentId` をそのまま利用し、再解析して親を推測しない。

| Markdown 上の位置 | Tree の親 | Tree 上の表示 |
|---|---|---|
| section 直下の fenced-code / table | 現在の section | section の子 |
| list item の継続内容として適切にインデントされた fenced-code / table | 当該 list item | list の子 |
| list の直後だがインデントなしの fenced-code / table | list の子ではない | section の兄弟 |
| 親の位置を安全に解決できない block | — | Tree に編集対象として出さない（読み取り専用または非投影） |

### 2.4 表示規則

- `mermaid`: `Mermaid: <最初の非空行>`
- `dataview`: `Dataview: <最初の非空行>`
- `dataviewjs`: `DataviewJS: <最初の非空行>`
- その他 language: `<language>: <最初の非空行>`
- language 未指定・内容が空: `Code block` などの固定ラベル
- table: 先頭1〜2列程度の列名を要約に利用（例: `Table: 年代 | 史料 | 所在`）。全セル・全行は展開しない。
- ラベルは表示専用であり、Markdown 原文を変更しない。長さを制限し、改行は空白に正規化する。

### 2.5 読み取り専用ナビゲーション（本段階で有効化する操作）

- Tree の展開・折りたたみ
- クリックで本文開始行へジャンプ
- Tree の選択状態表示、本文カーソル位置からの Tree ハイライト同期
- ホイスト候補として対象範囲を選択するための内部 API
- block 種別・language・行範囲・読み取り専用理由の診断情報

`readOnly: true` を明示し、rename・削除・move・indent/outdent・drag & drop・Partial Edit の入口はすべて無効化する（CompositeBlock の読み取り専用ノードと同じ二重防御方式: `aria-readonly` / `data-readonly` を付与し、rename/menu/drag 操作の入口を防ぐ）。

### 2.6 受入基準

**Fenced code**
- `mermaid` / `dataview` / `dataviewjs` / `js` / `typescript` / 無指定 fence が `◫` 付きの Tree ノードとして表示される。
- Mermaid は独立した `kind` ではなく `complexKind: "fenced-code"` と `language: "mermaid"` の組合せとして表示される。
- 開始 fence の行へクリックジャンプできる。
- list item 内で適正にインデントされた block は、その list item の子として表示される。list 外の block は list の子に誤投影されない。
- 未閉鎖 fence は操作可能ノードにしない。
- Tree 上から rename / delete / move / drag / indent-outdent / Partial Edit は実行できない。

**Table**
- ヘッダー行と delimiter row を持つ基本表が `▦` 付きの Tree ノードとして表示される。
- list item 内の適切にインデントされた表が list の子として表示される。
- delimiter row が欠ける・不正・境界が曖昧な表は編集可能な Tree ノードにしない。
- 表のクリックでヘッダー行へジャンプできる。
- Tree 上から表のセル編集・移動・削除・Partial Edit はまだ実行できない。

---

## 3. Phase 5E-0.5: Block Insertion Framework（新規ブロック挿入基盤）

### 3.1 目的

既存ブロックの投影・部分編集が整っても、新規挿入が section/list の旧来モデルのままでは、Mermaid・Dataview・表・引用・callout を本文で手作業作成してから構造操作するしかなく、拡張ブロックの第一級化が骨抜きになる。本段階では Tree 上から新規ブロックを安全に挿入できる共通基盤を導入する。

### 3.2 対象・非対象

- 対象: section, list, blockquote, callout, fenced-code, table
- fenced-code は Mermaid / Dataview / DataviewJS / JavaScript / TypeScript / Python / YAML / JSON / SQL / 無指定コードブロックを language/info string の差分（preset）として扱い、`InsertionBlockKind` 上も `ComplexBlockKind` 上も独立値にしない（常に `"fenced-code"` 1種値）。
- table は初期段階では表全体を一つの block として挿入する。セル単位編集・行列追加削除・自動整形はここでは対象外。
- paragraph・CompositeBlock は今回の新規挿入対象から除外する（CompositeBlock は既存 block の隣接関係から再解析される読み取り専用の集約レイヤーであり、直接作成・挿入しない）。

### 3.3 共通レジストリ

**命名上の注意（既存コード確認済み）**: `src/model/complexBlock.ts` の doc comment は、`ComplexBlockKind` を `BlockKind` という名前にしなかった理由として「a name that broad would invite confusion with a possible FUTURE unified block model that also covers "section" and "list"」と明記している。つまり `BlockKind` という名前は、まさに本節が定義しようとしている「section/list を含む広い block 種別の統一」のために将来使われる可能性を見込んで、既存コードが意図的に予約・回避している名称である。したがって本節のフィールド名は `blockKind` ではなく `insertionBlockKind`（型名も `InsertionBlockKind`）とし、既存の `ComplexBlockKind` とも将来の `BlockKind` とも字面上混同しないようにする。

`BlockInsertionDefinition` として次の概念を持つレジストリを設計する。

```ts
interface BlockInsertionDefinition {
  insertionBlockKind: "section" | "list" | "blockquote" | "callout" | "fenced-code" | "table";
  menuGroup: "structure" | "quote" | "code" | "table";
  i18nLabelKey: string;
  i18nDescriptionKey: string;
  defaultEnabledInContextMenu: boolean;
  allowedPlacements: Array<"before" | "after" | "child">;
  canInsertAt(context: InsertionContext): boolean;
  buildInitialMarkdown(context: InsertionContext, options?: unknown): string;
  defaultFocusTarget: "title" | "body" | "language";
  // optional: default options schema, icon / prefix metadata, experimental flag
}
```

`InsertionBlockKind`・既存の `ComplexBlockKind`・Tree 上の node kind（`section`/`list`/`complex-member`/`composite`）は三者とも別物であり、混同しない。挿入する Markdown block の種別は `InsertionBlockKind` で決め、投影後に Tree 上でどう表示されるかは 2.2 の既存 `complex-member` 機構が決める。

### 3.4 挿入位置の定義

- **before**: 選択 block の開始行の直前。同一親・同一深さの兄弟位置に挿入する。
- **after**: 選択 block の終了行の直後。同一親・同一深さの兄弟位置に挿入する。
- **child**: 選択した list item の継続コンテンツ末尾へ、list item の `contentColumn` に合わせてインデントして挿入する。初期版の `append-child` 対象は list item のみとし、section を child 挿入先として扱わない。
- **section 本文末尾**: section node が選択され、after 相当で解釈できない場合にのみ、section の直接内容の末尾（次の同レベル以上の見出しの直前）に挿入する。
- どの位置に挿入されるかを実行前に一意に決定できない場合、暗黙推定で書き込まず操作を拒否して通知する。

### 3.5 コンテクストメニュー構成

既存の section/list 操作の末尾に区切り線を置き、「Insert block」をサブメニュー化する。

```text
Move up / Move down / Indent / Outdent / Rename / Delete
────────────
Insert block ›
  Structure ›  Heading / Bullet list item / Numbered list item
  Quote ›      Blockquote / Callout
  Code ›       Code block / Mermaid diagram / Dataview query / DataviewJS query /
               JavaScript / TypeScript / Python / YAML / JSON / SQL
  Table ›      Markdown table
```

表示する候補は、選択 Tree node の種別・親子関係・安全性により絞る。

| 選択された Tree node | 表示する位置 | 非表示にすべき位置 |
|---|---|---|
| section | before / after / section end | child |
| list item | before / after / child | 不正な parent を作る child |
| fenced-code / table（単独 complex node） | before / after | child |
| callout / blockquote | before / after | child |
| CompositeBlock / read-only member 行 / 範囲不確実 node | 初期版では表示しない | すべて |

fenced-code/table が親 list item の子として字下げされていれば、child 挿入時は単に行頭へ空白を足すのではなく、親 `list` の `contentColumn` に対して整列させる。

### 3.6 設定（右クリックメニューの表示制御）

設定は「block kind 単位」ではなく **preset 単位** で持つ。例:

```text
Block insertion menu
[x] Enable Insert block context menu

Structure: Heading / Bullet list item / Numbered list item
Quotes: Blockquote / Callout
Code blocks: Generic code block / Mermaid diagram / Dataview query / DataviewJS query /
             JavaScript / TypeScript / Python / YAML / JSON / SQL
Tables: Markdown table
```

- `contextMenuInsertionEnabled: boolean`（既定 true）
- `contextMenuInsertionItems: Record<presetId, boolean>`
- `contextMenuInsertionShowExperimental: boolean`（将来用、初期実装では表示不要）
- この設定は**右クリックメニューへの表示のみ**を制御する。Command Palette のコマンド登録は消さない。
- 無効項目はメニューから完全に消す（disabled 表示ではない）。
- グループ内に有効項目が一つもない場合、そのグループごと非表示にする。
- 古い settings JSON にキーがない場合は `defaultEnabledInContextMenu` を適用して既定値補完する。
- UI 文言は `src/i18n.ts` の既存方式で英語・日本語を追加する。

### 3.7 Command Palette

命名は既存コマンド体系に合わせ、まず「after selected block」系の個別コマンドを優先する。

```text
Insert heading after selected block
Insert bullet list item after selected block
Insert numbered list item after selected block
Insert blockquote after selected block
Insert callout after selected block
Insert code block after selected block
Insert Mermaid diagram after selected block
Insert Dataview query after selected block
Insert DataviewJS query after selected block
Insert JavaScript code block after selected block
Insert TypeScript code block after selected block
Insert Python code block after selected block
Insert YAML code block after selected block
Insert JSON code block after selected block
Insert SQL code block after selected block
Insert Markdown table after selected block
```

before/child は右クリックメニュー中心でよいが、将来の Command Palette 拡張が可能な共通 API は残す。

対象解決の優先順位: Tree 選択 → アクティブ editor のカーソル位置（既存の block 解決ロジックで section/list/fenced-code/table/callout/blockquote を解決）。一意に解決できない場合は書き込まず通知する。Command Palette 経由では右クリックメニューの表示設定を参照しない。

### 3.8 見出し挿入の安全性

見出し挿入で作るべき heading level を一意に決められない場合、暗黙の既定レベルを使わない。初期版では、section node 上では「選択 section と同じ見出しレベル」のみを作成し、list/complex node 上では heading 挿入を出さない。

### 3.9 各 block の初期テンプレート（要点）

- **Bullet / Numbered list item**: 隣接 list の marker style を安全に継承できる場合のみ継承。継承不可なら `- New item` / `1. New item`。番号振り直しは自動で行わない。
- **Blockquote**: `> New quote`。list child では親 list item の contentColumn に合わせて全行インデント。
- **Callout**: 既定テンプレートは `> [!note] New callout` + 本文用 `> ` 行。type picker は初期版では不要。
- **Fenced code**: 言語 preset ごとに開始・終了 fence を生成。fence 本文中の backtick 衝突を検査し、必要なら4個以上の fence を使う一般化を持たせる。Mermaid は最小テンプレート（空の `flowchart TD` 等）。Dataview/DataviewJS はユーザー固有の path・tag・query を埋め込まない無害な最小骨格。
- **Markdown table**: `| Column 1 | Column 2 |` + delimiter row + 空データ行。親 list item の子に挿入する場合は全行に基準インデントを付ける。

### 3.10 安全性・拒否条件

- CompositeBlock、read-only node、Partial Edit 適用中・競合中、対象ファイル不存在、アクティブ editor 取得不可の場合は書き込みを行わない。
- 未閉鎖 fenced-code 内部、table の不正 delimiter、範囲不確実な ComplexBlock からは挿入を開始しない。
- 既存 Markdown の範囲を置換せず、挿入位置へ新規テキストを加えるだけにする。
- 挿入後は既存の一元的な書き戻し経路・parser 再解析にすべて委ね、Tree モデルを手作業で部分更新して Markdown と不整合な状態を作らない。
- 成功時は原則通知不要。拒否時のみ理由を短く通知する。

---

## 4. Phase 5E-1: Fenced Code Block の操作統合

### 4.1 コードブロックの編集方針（callout の type 選択に類似）

コードブロックの編集は「種別選択 + 平文編集」に徹し、それ以上のサポートはしない。Mermaid 図形編集や Dataview クエリビルダー等の高度な入力補助は、ユーザーが必要であればプルリクエストで実装してもらう。

編集ペインの構成イメージ:

```text
Code block
────────────────────────────
Type / language: [ Mermaid ▾ ]  [Custom language / info string]
────────────────────────────
[plain-text editor]
────────────────────────────
[Cancel]                         [Apply]
```

| 表示名 | 書き戻す info string | 補助テンプレート |
|---|---|---|
| Plain code block | 空 | 空 |
| Mermaid | `mermaid` | `flowchart TD` |
| Dataview | `dataview` | 空、または最小 query 骨格 |
| DataviewJS | `dataviewjs` | 空、または無害な最小骨格 |
| JavaScript / TypeScript / Python / YAML / JSON / SQL | 対応する info string | 空 |
| Custom… | 任意 | 空 |

この selector は新規作成時だけでなく既存 block の編集時にも表示する。language を変更した場合、変更するのは開始 fence の info string だけであり、本文の意味変換は行わない。

### 4.2 責務境界

**保証する範囲**
- 開始 fence・info string・本文・終了 fence を含む block 全体の安全な編集・書き戻し。
- 言語 selector による info string 変更、Custom info string の自由入力。
- 新規作成時の最小テンプレート挿入。
- Apply 前の開始・終了 fence 整合性検査。
- 既存 Partial Edit と同じ Apply / Cancel / conflict 拒否。
- 初期値にない language でも編集・移動・ホイストが可能。

**スコープ外**
- Mermaid のノード・エッジのフォーム編集、構文の完全検証。
- Dataview / DataviewJS のクエリ支援・実行・プレビュー。
- JavaScript の実行・安全性解析。
- TypeScript / Python の補完・構文木編集。
- コードフォーマッタ・linter・language server 連携。
- code block 内部の再帰的アウトライン解析。

### 4.3 拡張性（PR 受け入れの境界）

将来的な言語別入力補助は次の `CodeBlockPreset` 登録として受け入れる。

```ts
interface CodeBlockPreset {
  id: string;
  labelKey: string;
  language: string | null;
  defaultBody: string;
  order: number;
  isBuiltIn: boolean;
}
```

PR で追加してよいのは、原則として次のみ:

- `CodeBlockPreset` の登録
- 新規作成時テンプレート
- selector 上の名称・説明・アイコン
- 必要なら軽量な入力補助コンポーネント（UI 層限定）

第三者の拡張は **UI 層に限定**し、Partial Edit の保存経路・`fenced-code` の range parser・競合検知・Tree identity・fold identity には触れさせない。この境界を貢献規約として明示する。

### 4.4 実装順序（5E-1 内部）

1. Tree 投影（5E-0）完了を前提に Partial Edit Pane を開けるようにする。
2. Apply は block 全体置換。
3. move up/down・削除。
4. drag & drop・indent/outdent。

---

## 5. Phase 5E-2: Markdown Table の操作統合

### 5.1 表の難しさ

Markdown table は本質的にパイプ区切りのテキストであり、alignment 指定、セル内の `\|` エスケープ、inline code 内の `|`、Wikilink・タグ・強調・HTML、空セル、列数不一致、list/callout/blockquote 内のインデント、セル内改行不可能性など、境界検出とセル解析の両方に難しさがある。「セル編集 UI がある」ことと「Markdown を破壊せず編集できる」ことを同一視してはならない。

したがって、table は最初から一体のセル編集 UI を実装せず、次の二段階に分ける。

### 5.2 Phase 5E-2A: Raw Table Partial Edit

表全体を plain text として編集できる、既存の Partial Edit と同型の仕組みを先に導入する。

```text
Markdown table
────────────────────────────
[Raw Markdown] [Table mode: unavailable]
────────────────────────────
| 年代 | 史料 | 証拠能力 |
| --- | --- | --- |
| 慶長期 | 検地帳 | 高 |
────────────────────────────
Status: Valid Markdown table
[Cancel]                         [Apply]
```

機能範囲:
- 表全体を切り出して編集する。
- Apply 時に最低限、header row と delimiter row を検証する。
- delimiter row がない場合、勝手に補完して保存しない。
- 表が不正なら Apply を拒否し、何が不正かを通知する。
- 前後の空行、list 内でのインデント、親 block との関係を維持する。
- 既存 Partial Edit と同じ競合検知を行う。
- Markdown 原文をそのまま編集できる escape hatch を常に残す。

### 5.3 Phase 5E-2B: 軽量 Table Mode（オプトイン）

Raw 編集が安定し、実機で「セル編集が本当に必要」と確認できた場合にのみ導入する。スプレッドシート化はせず、Markdown を安全に生成するための入力補助に限定する。

```text
Markdown table
────────────────────────────────
[Raw Markdown] [Table Mode]
────────────────────────────────
        年代       史料        証拠能力
row 1   慶長期     検地帳      高
────────────────────────────────
[+ Row] [− Row] [↑ Row] [↓ Row]
[+ Column] [− Column]
────────────────────────────────
[Cancel]                         [Apply]
```

| 操作 | 初期セル編集モードで許可 |
|---|---:|
| セルの平文編集 / header 編集 | 許可 |
| 行追加・削除・上下移動 | 許可 |
| 列追加 | 許可 |
| 列削除 | 許可（確認付き） |
| delimiter alignment 編集 | 最低限許可（左・中央・右の3状態） |
| raw Markdown 切替 | 常に許可 |
| 列の左右移動 | 後回し |
| セル内 Markdown の WYSIWYG | 非対応（平文として保持） |
| 改行セル | 非対応 |
| CSV import/export、数式・集計、フィルタ・ソート | 非対応 / 後回し |

保存原則:
- Markdown 原文が永続的な唯一の正。`EditableMarkdownTable`（headers / alignments / rows）は Partial Edit session 内だけの一時状態。
- Apply 時には current document snapshot との競合を確認し、競合があれば構造化データを勝手にマージしない。
- Raw mode と Table mode の切替時、変換不能な内容は raw を優先する。
- Table mode が理解できない構文を含む場合は raw mode のみを提供する。
- 書き戻し後は parser による再認識を必須にする。

Table Mode を有効にする条件:

| 状態 | Table Mode | Raw Markdown |
|---|---:|---:|
| 基本的な header + delimiter + 同列数の行 | 有効 | 有効 |
| alignment あり / 空セルあり | 有効 | 有効 |
| escaped pipe・inline code 中の `\|` | 対応できれば有効 | 常に有効 |
| 列数不一致 | 無効 | 有効 |
| delimiter row 不正 | 無効 | 有効（Apply は拒否または明確な警告） |
| HTML を含む複雑なセル／改行・複数段落セル | 初期版では無効 | 有効 |
| blockquote/callout 内・深い nested list 内の表 | 初期版では raw のみ推奨 | 有効 |

### 5.4 表の最終的な線引き

**必須**: Tree 表示・選択・ホイスト・移動・部分編集、Raw Markdown の完全編集、header/delimiter/行範囲の検証、前後空行・親 list インデントの維持、Apply/Cancel/conflict 検知、基本表限定のセル編集モード、行追加・削除・上下移動、列追加・削除、Raw mode への常時切替。

**任意・後続**: 列の左右移動、alignment selector、TSV/CSV 貼り付けによるセル分割、表の自動整形、行・列の複数選択、cell-level shortcut、詳細なエラー位置表示。

**非目標**: 表計算ソフト的機能、計算式・集計・フィルタ・ソート、データベース化、CSV/Excel 同期、Dataview table を編集可能なデータ源として扱うこと、セル内の複雑な Markdown の WYSIWYG、複数行セルの自然な編集。

### 5.5 実装順序（5E-2 内部）

1. Table Raw Partial Edit（plain text、header/delimiter 検証、範囲・インデント・空行保持、Apply/Cancel/conflict）。
2. 基本表の parser / serializer を UI 非依存の純粋関数として実装し、`headers / alignments / rows` ⇔ Markdown の往復安定性をテストする。
3. Table Mode のオプトイン導入（セル編集、行追加削除、行移動、列追加削除）。
4. 実機検証（史料比較表・年表・人物関係表等）を経てから、TSV貼り付け・列移動・alignment UI 等の拡張要否を判断する。

---

## 6. 共通原則（全フェーズを通じて維持する制約）

- Markdown 原文を唯一の正とする。内部構文の意味を再生成せず、確定した原文範囲を安全に移動・置換する。
- Mermaid のレンダリング結果、Dataview の実行結果、コードの AST、表の内部 JSON モデルのいずれも「正」として保存しない。
- 不確実な境界・未閉鎖構文・想定外の複合構造では、編集・挿入・移動のいずれも実行せず安全側に拒否する。
- 書き戻しは既存の一元化された更新経路だけを通す。新しい独自書き戻し経路を新設しない。
- 複数 leaf・popout・Partial Edit session・編集中の対象範囲と競合する場合は、既存の競合検知方針に従い、静かに上書きしない。
- CodeMirror・Obsidian 本体・Dataview プラグインのレンダリング責務を奪わない。Unified Outliner はブロック範囲の同定、Tree 投影、安全な移動・ホイスト・Partial Edit・競合検知・書き戻しの一元化のみを担当する。
- CompositeBlock は既存 block の隣接関係から再解析される読み取り・集約レイヤーであり、Phase 5E の新規挿入・投影・編集の直接対象にはしない。

---

## 7. 段階別ロードマップ一覧（再掲）

```text
Phase 5E-0:
  ComplexBlock の Outline Tree 投影基盤
  - fenced-code/table の単独読み取り専用ノード表示
  - 親子関係、並び順、ラベル、アイコン、fold identity、選択同期
  - 編集・書き戻しは完全に非目標

Phase 5E-0.5:
  Block Insertion Framework
  - レジストリ、コンテクストメニュー、設定、コマンド、テンプレート、書き戻し
  - Mermaid/Dataview/DataviewJS/JS等は fenced-code の preset として扱う

Phase 5E-1:
  Fenced Code Block の操作統合
  - 種別 selector + 平文エディタによる Partial Edit
  - move / delete / drag & drop / indent-outdent
  - Mermaid専用GUIやコード構文編集、Dataview/DataviewJS支援は対象外（PRで拡張可）

Phase 5E-2:
  Markdown Table の操作統合
  - 2A: Raw Markdown Partial Edit
  - 2B: オプトインの軽量 Table Mode（セル編集・行列操作、非スプレッドシート）
  - move / delete / drag & drop / indent-outdent
```

この順序により、Tree 表示の不具合と書き戻しの不具合を切り分けて検証でき、新しい Mermaid・Dataview・表等を Tree から安全に作成したうえで、部分編集・移動へ段階的に進められる。

---

## 8. 既存実装・既存docsとの整合性レビュー（2026-09-12 追記）

本文作成後、実ソース（`src/`）と既存docsを直接確認し、上記各節はすでに修正済み。以下は検証で確認した事実と、既存情報だけでは未確定の事項の要約。

### 8.1 本ロードマップの前提を補強する既存決定

`docs/phase5t5_cursor_to_tree_highlight_design.md` §7・§8: 利用者自身が「fenced-code/table は今回の対象外（現状 Tree row を持たないため）」と確定させ、専用 Tree row の新設を別チケットの判断事項として保留していた。Phase 5E はこの保留を解消する位置付けであり、矛盾ではなく想定されていた後継チケットに当たる。

### 8.2 Phase 5E-1/5E-2 の move/delete が拡張すべき既存パイプライン

`src/edit/moveStandaloneComplexBlock.ts` の `buildStandaloneComplexBlockSnapshot(info)` は、`info.kind !== "callout" && info.kind !== "blockquote"` の場合に `null` を返す形で callout/blockquote のみにハードコードされており、コードコメント自体がこれを「Phase 5C-3's own eligible kind set」と呼んでいる。Phase 5E-1/5E-2 の move up/down・削除・drag & drop は、新しい移動ロジックを作るのではなく、この関数とその呼び出し側（関連する move target 探索や movability 判定ロジックを含む）の対象 kind を fenced-code/table にも広げる方針で進めること。これは2.2の `isStandaloneComplexBlockEligible` 拡張と対になる作業であり、両方が同じ「callout/blockquote 限定のハードコード」という形で現在存在することに注意。

### 8.3 未確定の設定方針（Tree 表示の ON/OFF トリガー）

`src/settingsDefaults.ts` には `showParagraphsInOutline`（デフォルト `false`）が存在し、paragraph の Tree 投影はオプトインである。一方 callout/blockquote の standalone 投影（`isStandaloneComplexBlockEligible`）に対応する設定トリガーは現在存在せず、常時有効である。fenced-code/table の Tree 投影（5E-0）を callout/blockquote の前例に合わせ常時有効にするか、paragraph の前例に合わせ新設の設定トリガー（例: `showFencedCodeAndTableInOutline`）でオプトインにするかは、本ロードマップでは未決定。実装者は両方の前例を認識したうえで、どちらを採用するかを利用者に確認すること。

### 8.4 スコープ外の隣接kind：`thematic-break`

`ComplexBlockKind`（`src/model/complexBlock.ts`）は現在6値で構成されている：`"callout" | "blockquote" | "fenced-code" | "table" | "paragraph" | "thematic-break"`。`thematic-break`（区切り線 `---`/`***`等）は元の4ターンの会話や本ロードマップのどの段階でも言及されていない。`isStandaloneComplexBlockEligible` の現在の除外対象には fenced-code/table と並んで `thematic-break` も含まれているが、Phase 5E はこれを対象化しない。実装者の混乱を防ぐため、意図的にスコープ外として明記する。

### 8.5 本レビューで修正した主な矛盾点（要約）

- §2.2: 新 Tree node kind `"complex"` の発明→既存 `"complex-member"`（`OutlineTreeComplexMemberNode`）の拡張に変更。
- §2.2: `isStandaloneComplexBlockEligible` 拡張に伴う「Open in Partial Edit」メニューの早期露出リスクを新規に明記。
- §3.3: `BlockInsertionDefinition.blockKind` を `insertionBlockKind` にリネーム（既存 `ComplexBlockKind` との名前衝突回避）。
- §4/§5 の move/delete/drag 記載に、具体的な既存ファイル・関数名（`moveStandaloneComplexBlock.ts` 等）を追記（本§8.2）。
- 新規：設定トリガーの有無（§8.3）と `thematic-break` のスコープ外明記（§8.4）を追加。

これ以外の記載（Phase区分、受入基準、PR受入方針など）は、現在確認できた既存docs（`phase5c`、`phase5d0_3_final-review`、`phase5p3d`、`phase5t5`、`統合実装ロードマップ_2026-08-05`）との直接の矛盾は確認されていない。
