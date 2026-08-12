# Phase 5D-0 — 基本 block model 拡張 + CompositeBlock 規則基盤 仕様書

作成日: 2026-08-12
対象: `src/model/complexBlock.ts`, `src/parser/complexBlocks.ts`, `src/model/compositeBlock.ts`（新規）, `src/parser/compositeBlocks.ts`（新規）, `src/settingsDefaults.ts`, `src/settings.ts`
関連: `docs/phase5c_block-model-and-tree-display-spec.md`, `docs/統合実装ロードマップ_2026-08-05.md` §3.6, `docs/mixed-structure-spec.md`

## 0. 経緯とスコープ確定の記録

発注時のチャット指示は「Phase 5D の callout / blockquote block editing に先立ち、Phase 5C の継続として」次の3層を実装するよう求めていた。

1. 基本 block の範囲・親子関係・安全性を確定する解析モデル
2. ユーザー定義の「複合 block」規則と高度な設定 UI
3. 基本 block / 複合 block を Outline Tree に一貫して投影する表示層

着手前の調査で、以下が判明した。

- **Phase 5C（scanner / 診断基盤）は既に完了済み**（`docs/phase5c_block-model-and-tree-display-spec.md`、`docs/統合実装ロードマップ_2026-08-05.md` §2）。callout/blockquote/fenced-code/table/paragraph の認識・境界判定・editability 分類が `src/model/complexBlock.ts` / `src/parser/complexBlocks.ts` として実装済みであり、`Move block up/down` からも既に呼び出されている（2026-08-11 チケット）。
- 指示書が必読文書として挙げていた `phase5-implementation-plan.md` は、Phase 5C 完了時点で「Phase 5C-1〜5C-3 の当初計画」という過去の設計資料としてのみ参照される位置づけに変わっており、現在の実装状況は `docs/phase5c_block-model-and-tree-display-spec.md` が正である。
- 指示書のテキストは **Stage 2「複合化の必須条件」の列挙の途中で途切れており**、Stage 3（層3: Tree 投影表示層）の詳細指示は一切受け取れていない。

以上を踏まえ、ユーザー承認のもと、本チケットを **Phase 5D-0** と命名し、指示書の層1・層2（解析モデル拡張と CompositeBlock 規則基盤）のみを実装対象とする。層3（Tree 表示統合）は指示内容が不明であるため着手せず、`docs/統合実装ロードマップ_2026-08-05.md` §4 の未確定事項に残す。

## 1. 用語の整理（重要）

既存の Phase 5C は「複合ブロック」という日本語を `ComplexBlockKind`（callout 等、単一の非原子的 Markdown 構文1つを指す概念）に既に割り当てている。指示書が言う「複合 block」はこれとは異なり、「複数の基本/既存複合ブロックを、空行を挟まず束ねて1つの操作・表示単位として扱う」というユーザー定義の新概念である。用語衝突を避けるため、本仕様書および実装では以下の呼称を使う。

| 概念 | 型/呼称 | 既存/新規 |
| --- | --- | --- |
| section / list | `BlockNode`（`model/block.ts`） | 既存（Phase 1〜） |
| callout / blockquote / fenced-code / table / paragraph / thematic-break | `ComplexBlockInfo`（`model/complexBlock.ts`） | 既存 + 今回 thematic-break 追加 |
| 複数ブロックを束ねた1操作単位（指示書の「複合 block」） | `CompositeBlock` / `CompositeBlockInfo`（`model/compositeBlock.ts`、新規） | 今回新規 |

`docs/phase5c_block-model-and-tree-display-spec.md` §6 が将来用に予約していた「`BlockNode` と `ComplexBlockInfo` を横断する統合モデル（`AnyBlock` 相当）」とも異なる、第三の概念である。`CompositeBlockInfo` は `ParsedDocument.nodes` にも `ComplexBlockScanResult.blocks` にも登録されず、既存2モデルの出力を読み取るだけの、さらに上位の read-only 集約レイヤーとして実装する。

## 2. 基本 block model 拡張（指示書 Stage 1 相当）

### 2.1 現状の再確認

指示書 Stage 1 が要求する「基本 block の range model」は、Phase 5C の `ComplexBlockInfo` としてほぼ実装済みである。

- `section` / `list` の range・親子関係・安全性は `model/block.ts` の `BlockNode`（既存、Phase 1〜）。
- `callout` / `blockquote` / `fenced-code` / `table` / `paragraph` の range・親子関係(`parentId`)・editability は `model/complexBlock.ts` の `ComplexBlockInfo`（Phase 5C）。
- list item の子としての取り込み判定（指示書 Stage 1 要件3・4）は、`parser/complexBlocks.ts` の `resolveParentId` が `ParsedDocument.lineToOwningNodeId`（`parser/parseDocument.ts` の既存インデント判定の結果）をそのまま参照することで、**追加実装なしに既に満たされている**。callout/blockquote が list item の継続行として十分深くインデントされていれば `parentId` はその list item の id になり、インデントが不足していれば list 外の兄弟として `parentId` は section id（またはトップレベルなら `null`）になる——これは Phase 5C の時点で `resolveParentId` のテストが検証済みの既存挙動である。
- callout を blockquote より先に判定する規則（指示書の要求）も、`scanQuoteRuns` が両者を単一パスで排他的に分類する既存実装として満たされている。

したがって Stage 1 で純粋に不足しているのは **`thematic-break`** の1種のみである。

### 2.2 `thematic-break` の追加

- `ComplexBlockKind` に `"thematic-break"` を追加する。
- 候補判定: 行頭0〜3スペース + 同一文字（`-` / `*` / `_`）が3回以上、間に空白を挟んでもよい、という CommonMark 標準の thematic break 定義に従う。
- **Setext heading underline との識別**: `parser/parseDocument.ts` は Setext heading を一切パースしない（ATX only）。この既存挙動を変更するのは本チケットのスコープ外（`parseDocument.ts` の境界ロジックには一切触れない、という Phase 5C 以来の一貫方針を継続する）。そのため、`-` のみの並びが thematic-break 候補に一致し、かつ直前行（空行を挟まない）が非空行・非見出し・非list・非thematic-break候補である場合は、Setext heading の underline である可能性を優先し、**thematic-break として報告しない**（scanner が黙って skip するのみで、その行は従来どおり paragraph scanner 等の対象になり得る——安全側に倒す）。`=` の並びはそもそも CommonMark の thematic-break 文字集合に含まれないため、この曖昧性の対象外。
- 優先順位: `callout > blockquote > (fenced-code, table, thematic-break) > paragraph`。thematic-break は fenced-code/table と同じ tier に追加する（互いに衝突しないため順序は問題にならない、既存の fenced-code/table 関係と同じ理由）。
- editability: 境界が確定していれば `"supported"`（1行で完結する最も単純な複合ブロックであり、fenced-code/table/callout/blockquote と同様「境界確定・移動候補になり得る」という既存方針に合わせる）。`resolveParentId` の境界不確実判定は他の kind と同一のロジックを再利用する。

### 2.3 非目標（Stage 1 と同じ）

callout/blockquote/thematic-break の Tree 追加・削除 UI、drag & drop 書き戻し、Partial Edit 対応は引き続き対象外。

## 3. CompositeBlock 規則基盤（指示書 Stage 2 相当）

### 3.1 概要

確定済みの基本 block（`BlockNode`）・複合ブロック（`ComplexBlockInfo`）の列を、ユーザー定義の規則に基づいて1つの `CompositeBlockInfo` へ束ねる、read-only な追加集約レイヤー。Markdown 構文・既存 range・既存の親子関係は一切変更しない。

### 3.2 代表ユースケース

```markdown
- ![[scan-001.png]]
> [!ocr]
> 乍恐以書付奉願上候
```

「一行 list（継続行・子 list を持たない list item）」の直後に、空行を挟まず callout が続くパターンを `CompositeBlock` として認識する。同様に「一行 list, blockquote」も既定規則として提供する。

「一行 list」は「`ListBlockNode.range` が marker 行1行のみ（`range.startLine === range.endLine`）」と定義する。embed（`![[...]]`）を含むことは必須条件にしない。

### 3.3 型設計

```ts
// src/model/compositeBlock.ts
export type CompositeMemberKind = ComplexBlockKind | "list" | "section";

export interface CompositeBlockRule {
  id: string;
  /** 上から順に一致させる member kind の列。長さ2以上。 */
  kindSequence: CompositeMemberKind[];
  /** kindSequence[0] が list のとき、一行 list（継続行・子を持たない）に限定するか。 */
  requireSingleLineList?: boolean;
  enabled: boolean;
  label: string;
}

export interface CompositeBlockMember {
  kind: CompositeMemberKind;
  id: string; // BlockNode.id または ComplexBlockInfo.id
  range: LineRange;
}

export interface CompositeBlockInfo {
  id: string;
  ruleId: string;
  range: LineRange; // members の最小開始行〜最大終了行
  members: CompositeBlockMember[];
  sectionId: string | null; // 全 member が属する section（一致しない場合は候補外）
}
```

### 3.4 必須条件（指示書の記載どおり）

- 基本 parser（`parseDocument`）・複合ブロック scanner（`scanComplexBlocks`）が既に member block を確定していること。member の range・kind をそのまま参照し、再解析しない。
- 指定された block kind の列が、文書順で連続一致すること。
- member 間に空行がないこと(直前 member の `endLine` の直後行から次 member の `startLine` までに空行を挟まない)。
- 全 member が同じ section に属すること(`resolveParentId`/list の `parentId` を遡って解決した section id が一致)。
- member ranges が互いに重複しないこと。
- 1つの基本/複合ブロックが複数の CompositeBlock に同時所属しないこと(貪欲・文書順の一致で先勝ち)。
- 規則が競合する場合(同じ開始位置から複数規則が一致し得る場合)は、優先順位(`rules` 配列の並び順)が最も高い規則だけを採用すること。

### 3.5 既定規則

> **2026-08-12 追記(Phase 5D-0.3 での改訂)**: 下表の id・kindSequence・`requireSingleLineList`
> はいずれも Phase 5D-0(本節)時点のものである。Phase 5D-0.3 で以下のとおり改訂されたため、
> 現行の定義は `docs/phase5d0_3_composite-block-outline-tree-projection-design-memo.md` §7 と
> `src/model/compositeBlock.ts` を参照すること: `list-callout` → `image-ocr`、
> `list-blockquote` → `image-quote`。`requireSingleLineList: true` という bool フラグは廃止され、
> `kindSequence` の第一要素が `"list"` ではなく独立した `"single-line-list"` kind になった
> (`["single-line-list", "callout"]` / `["single-line-list", "blockquote"]`)。設定キーも
> `listCallout`/`listBlockquote` → `imageOcr`/`imageQuote` にリネームされている。

| id (Phase 5D-0 時点、現在は非推奨) | kindSequence (同上) | ラベル |
| --- | --- | --- |
| `list-callout` | `["list", "callout"]` | List item + Callout |
| `list-blockquote` | `["list", "blockquote"]` | List item + Blockquote |

両方とも `requireSingleLineList: true`、既定で `enabled: true`。

### 3.6 設定 UI

`UnifiedOutlinerSettingTab.display()` に "Composite blocks" 見出しを追加し、既定2規則それぞれの有効/無効トグルを設置する(`treeKindHighlight` セクションと同じ、フラットな `Setting` + `addToggle` の並び)。

### 3.7 非目標(層3が未達のため)

- Outline Tree への CompositeBlock ノード表示・アイコン・displayLabel。
- CompositeBlock の move / drag & drop / Partial Edit Pane 統合。
- 規則をユーザーが自由に追加・編集できるビルダー UI(今回は既定2規則の有効/無効切替のみ)。
- 3種類以上の kind を持つ規則、`requireSingleLineList` 以外の付帯条件。

> **2026-08-12 追記**: 上記のうち「Outline Tree への CompositeBlock ノード表示」は
> Phase 5D-0.3 で実装済み(読み取り専用の投影表示のみ)。move / drag & drop / Partial Edit Pane
> 統合、自由編集 UI は Phase 5D-0.3 でも引き続き非目標のまま。詳細は
> `docs/phase5d0_3_composite-block-outline-tree-projection-design-memo.md` §7 を参照。

これらは指示書の層3(Tree 投影表示層)の詳細が不明なため、別途設計・承認を経て実装する。

## 4. 受入基準

- `tests/complexBlocks.test.ts`: thematic-break の基本認識、Setext heading underline との非混同、fenced-code 内部の `---`/`***` を誤認識しないこと。
- `tests/compositeBlocks.test.ts`(新規): 代表ユースケースの一致、空行を挟む場合の非一致、section をまたぐ場合の非一致、規則競合時の優先順位、無効化された規則が一致しないこと。
- 既存の全テスト(509件、2026-08-12時点)が無変更で通過すること。
- `tsc -noEmit` と esbuild ビルドが通ること。
