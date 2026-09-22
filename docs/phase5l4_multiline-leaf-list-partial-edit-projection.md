# Phase 5L-4: Multi-Line Leaf List Item Partial Edit Projection

対象リポジトリ: `unified-outliner-public`
関連: `docs/統合実装ロードマップ_2026-08-05.md` §3.17（本ドキュメントの実装確定事項の正）、`docs/phase5l3_ordered-list-marker-free-partial-edit.md`（Phase 5L-3、本チケットが number/delimiter 契約を無変更のまま再利用する直接の前段）、`docs/phase5l2_task-list-marker-free-partial-edit.md`（Phase 5L-2）、`docs/phase5l1_standalone-list-marker-free-partial-edit.md`（Phase 5L-1）

## 1. 位置づけ — 5L-1/5L-2/5L-3 と 5L-4 の責務分離

| | Phase 5L-1/5L-2/5L-3（既存・無変更） | Phase 5L-4（本チケット） |
| --- | --- | --- |
| 対象とする list item | 単独 **single-line** leaf item（unordered/task/ordered の3 kind） | 単独 **MULTI-LINE**（continuation line を1行以上持つ）leaf item（同じ3 kind すべて） |
| marker/本文分離の実体（1行目） | `edit/listMarkerProjection.ts`/`edit/taskListProjection.ts`/`edit/orderedListProjection.ts` | 上記3モジュールへ**そのまま委譲**（新規モジュールが独自に再実装することは一切ない） |
| continuation 行の扱い | 概念自体が存在しない（single-line 前提） | **新規** `edit/multiLineListItemProjection.ts` が canonical indent の算出・剥離・復元を独自に担当する唯一の責務 |
| 対象性の判定 | `edit/standaloneListMarkerProjection.ts`/`edit/standaloneTaskListProjection.ts`/`edit/standaloneOrderedListProjection.ts` | **新規** `edit/standaloneMultiLineListItemProjection.ts`（構造的補集合 `range.startLine !== range.endLine` に加え、continuation 内 ComplexBlock を検出する第2ゲートを持つ） |
| UI | 共有 `textareaEl`（単一行）＋ 該当する checkbox/number control | 共有 `textareaEl`（**複数行**、変更不要）＋ **既存の同じ** checkbox/number control をそのまま流用。新規 DOM コントロールは一切なし |
| parser への依存 | いずれも parser 非依存の純粋モデル | **唯一の例外**——Apply 直前に再構成候補を `parseDocument`/`scanComplexBlocks` で再パースし、安全性を確認してから初めて書き込みを許可する |
| 保存経路 | `edit/partialEdit.ts`（無変更） | **同じ**保存経路をそのまま再利用。新規の書き込み経路は追加していない |
| 自動採番 | 5L-3 で一切実装しないと明示 | **同じ方針を継承**——multi-line ordered item についても一切実装しない |
| CompositeBlock との関係 | 対象外 | 同様に CompositeBlock 側 multi-line list member は対象外のまま（将来の別チケット候補） |

5L-1/5L-2/5L-3 は、いずれも「対象の `ListBlockNode` の `range` が単一行に収まる（`range.startLine === range.endLine`）」ことを対象性の必要条件の1つとして明示的に要求しており、1行以上の continuation line を持つ item は最初から対象外として raw fallback に委ねられていた。5L-4 は、この対象外だった standalone MULTI-LINE leaf list item のうち、安全に扱える形状に限定して、marker-free / checkbox-free / number-free Partial Edit を新規に追加するものである。

## 2. 再利用したコンポーネントと新規追加したコンポーネント

### 2.1 完全に無変更のまま再利用した既存コンポーネント

- `src/edit/listMarkerProjection.ts`/`src/edit/taskListProjection.ts`/`src/edit/orderedListProjection.ts` — multi-line item自身の**1行目**の marker/checkbox/number 分離を、既存の `build*Projection`/`invert*Projection` ペアへそのまま委譲する。3モジュールいずれの契約も拡張していない。
- `src/edit/standaloneListMarkerProjection.ts`・`src/edit/standaloneTaskListProjection.ts`・`src/edit/standaloneOrderedListProjection.ts` — `view/PartialEditView.ts#loadNodeInternal`/`performAutoReload` が、multi-line 投影を試みる**前に**、この3つによる single-line eligibility 判定と `buildStandaloneListProjections` をまず試す（優先順位は §3 参照）。
- `src/edit/partialEdit.ts`（`extractSubtreeText`/`applySubtreeEdit`）— 既存の list Partial Edit 保存経路そのもの。両関数はもともと行数に対して完全に汎用（`.join("\n")`/`.split("\n")` するだけ）であるため、複数行の書き込みに対応するための変更は一切不要だった。
- `src/parser/parseDocument.ts`（`parseDocument`・`ListBlockNode` モデル）・`src/parser/complexBlocks.ts`（`scanComplexBlocks`）— 新しい構造判定ロジックを発明せず、Apply 直前の候補再パース（§5）でこの2つの既存関数をそのまま呼び出す。
- `src/view/PartialEditView.ts` の `currentDisplayText()`（Phase 5D-0.5 由来の既存集約点）— ここへ4番目の分岐を1つ追加するだけで、`isDirty()`/`cancelEdit()`/`renderLoadedState()` 等の既存メソッドには呼び出し順序の追加のみで対応できた。
- 既存の DOM コントロール `textareaEl`（複数行入力に対応済みで変更不要。Enter キーをブロックするロジックはもともと存在しない）・`taskCheckboxRowEl`/`taskCheckboxInputEl`・`orderedNumberRowEl`/`orderedNumberInputEl`（5L-2/5L-3 が導入したもの、無変更のまま再利用）。

### 2.2 新規追加したコンポーネント

- **`src/edit/multiLineListItemProjection.ts`（新規ファイル）** — `buildMultiLineListItemProjection(rawText)`/`invertMultiLineListItemProjection(projection, editedChecked, editedNumberText, editedBody)`/`validateMultiLineListItemCandidate(candidateText, expectedKind)`/`MultiLineListItemProjection`/`MultiLineFirstLineSlot`/`projectedMultiLineBodyText`/`projectedMultiLineChecked`/`projectedMultiLineNumberText` を export する。既存3モジュールいずれの契約も拡張しない。
  - `MultiLineFirstLineSlot` は `{ kind: "unordered"; projection: ListMarkerProjection } | { kind: "task"; projection: TaskListProjection } | { kind: "ordered"; projection: OrderedListProjection }` という判別共用体で、項目自身の1行目を実際の既存投影インスタンスとしてそのまま保持する——手書きの重複シェイプではない。
  - `buildMultiLineListItemProjection` は、1行目を `buildListMarkerProjection` → （`"task-list-marker"` 拒否時のみ）`buildTaskListProjection` → （`"ordered-marker"` 拒否時のみ）`buildOrderedListProjection` という、`view/PartialEditView.ts#buildStandaloneListProjections` と全く同じ優先順位で試み、いずれにも該当しなければ `"first-line-not-projectable"` で拒否する。
  - continuation 行の **canonical indent 長**は、1行目の marker 本文開始列（`indent + marker(+delimiter) + markerSpacing`）から算出する。unordered/ordered kind では `firstRawLine.length - firstLineBodyText.length` で単純に求まるが、**task kind だけは例外**で、`firstLine.projection.indent.length + firstLine.projection.marker.length + firstLine.projection.markerSpacing.length` を直接計算する——checkbox（`[status]` とその後の空白）自体は意図的にこの計算から除外し、素の list marker 自身の本文開始列に揃える。これは、本チケットの worked example（3 kind すべてについて、continuation はチェックボックスを含まない素の marker の列に揃っている）が示す想定挙動と一致させるための明示的な設計判断であり、実装初期に checkbox 込みの列を誤って採用していたバグ（テスト失敗を契機に発見・修正）の直接の原因箇所でもある。
  - canonical indent 長より**浅い**非空 continuation 行は `"malformed-continuation-indent"` として **BUILD 時点**で拒否する（ハードエラーではなく raw fallback 理由の1つ）。canonical indent 長を**超える**余分な indentation は、剥離されず本文の一部としてそのまま保持される。空行はそのまま空行として扱い、indent の有無を問わない。
  - `validateMultiLineListItemCandidate(candidateText, expectedKind)` は、`invertMultiLineListItemProjection` が再構成した候補テキストを、実際のドキュメントとは無関係な使い捨て mini-document として `parseDocument`/`scanComplexBlocks` で再パースし、以下をすべて満たす場合にのみ `true` を返す:
    1. `candidateDoc.nodes.get("li-0")` が存在し、list node であり、`range.startLine === 0` であること。
    2. その node の `ordered` フラグが `expectedKind === "ordered"` と一致すること。
    3. `range.endLine === candidateLines.length - 1`（node の range が候補テキスト全体を過不足なく覆うこと）。
    4. `childIds.length === 0`（continuation 行の編集が新たな子リスト項目を生成していないこと——本関数が存在する最大の理由。詳細は §5.3）。
    5. `unsafeIndent` でないこと（防御的。canonical indent は常に純粋な半角スペースのみで構成されるため、実際には発生しえない）。
    6. `scanComplexBlocks(candidateDoc)` が返す callout/blockquote/fenced-code/table/thematic-break のいずれも、候補の continuation 行範囲（line 1 〜 最終行）と重ならないこと。
  - `invertMultiLineListItemProjection` は、編集後の本文（`editedBody`）を `"\n"` で分割し、先頭行を既存3モジュールの対応する `invert*Projection` へそのまま委譲する（`"invalid-number"` は ordered kind でのみ到達しうる真の検証エラーとしてそのまま伝播、それ以外の単一行 invert 関数由来の拒否は構造的に到達不能だが防御的に `"unsafe-structure"` へ畳み込む）。2行目以降の各行は、空文字列ならそのまま空行として、それ以外は無条件に `projection.continuationIndent`（読み込み時に固定された値。編集後の marker/number の新しい列幅に合わせて再計算されることはない）を前置して再構成する。最後に `validateMultiLineListItemCandidate` を通過して初めて `{ ok: true, rawText: candidateText }` を返し、失敗時は `{ ok: false, reason: "unsafe-structure" }` を返す。
- **`src/edit/standaloneMultiLineListItemProjection.ts`（新規ファイル）** — 2つの独立したゲート関数を export する。
  - `isStandaloneMultiLineLeafListItemEligibleForProjection(node: ListBlockNode): boolean` — `!node.unsafeIndent && node.childIds.length === 0 && node.range.startLine !== node.range.endLine` の3条件。既存3つの single-line 用ゲートとはちょうど `range.startLine !== range.endLine`（single-line 側は `===`）の関係にある構造的補集合。
  - `hasComplexBlockInMultiLineListItemContinuation(doc: ParsedDocument, node: ListBlockNode): boolean` — `scanComplexBlocks(doc)` が返す callout/blockquote/fenced-code/table/thematic-break のいずれかが、項目自身の continuation 行範囲（`node.range.startLine + 1` 〜 `node.range.endLine`）と重なるかどうかを判定する。single-line 側のゲートには continuation 行という概念自体が存在しないため対応物を持たない、本チケット固有の第2ゲートである。
- **`src/view/PartialEditView.ts` の拡張**:
  - 新規フィールド `standaloneMultiLineListProjection: MultiLineListItemProjection | null`。既存3つの standalone projection フィールドと構築上つねに四者排他。
  - 新規メソッド `buildStandaloneMultiLineListProjection(rawText)` — `buildMultiLineListItemProjection` の薄いラッパー。呼び出し側が eligibility を先に判定済みであることを前提とし、このメソッド自身は再判定しない（`buildStandaloneListProjections` の「eligibility は呼び出し側の責務」という既存方針をそのまま踏襲）。
  - `loadNodeInternal`/`performAutoReload` は、いずれも既存3つの single-line 投影が**すべて `null` になった場合に限り**、`standaloneMultiLineListEligible`（`isStandaloneMultiLineLeafListItemEligibleForProjection` AND `!hasComplexBlockInMultiLineListItemContinuation`）を条件に `buildStandaloneMultiLineListProjection` を試みる——本チケットの設計方針である優先順位「single-line task > single-line ordered > single-line unordered > multi-line」をそのまま反映している。
  - `renderTaskCheckboxRow()`/`renderOrderedNumberRow()` は、それぞれ `standaloneMultiLineListProjection?.listKind === "task"`/`"ordered"` のときも表示・値・disabled 状態を同期するよう条件を拡張した（例: `this.standaloneTaskListProjection !== null || multiLineTaskActive` という論理和で、既存 single-line 条件と新規 multi-line 条件を1箇所に統合）。新規 DOM 要素は一切追加していない。

## 3. multi-line marker-free projection が有効になる条件（必要条件の AND）

単独 list item セッションにおいて、以下をすべて満たす場合にのみ、editor が marker/checkbox/number 抜きの**複数行**本文表示＋既存 checkbox/number control になる。

1. `extractSubtreeText` の結果が `kind === "list"` であること。
2. 3つの既存 single-line 投影（`buildStandaloneListProjections` の結果 `list`/`task`/`ordered`）が**すべて `null`** であること（＝ 単一行として投影できる形状ではないこと）。
3. 対象の `ListBlockNode` に対して `isStandaloneMultiLineLeafListItemEligibleForProjection` が `true` を返すこと（子リストを持たず、`unsafeIndent` でなく、`range` が複数行にまたがる）。
4. `hasComplexBlockInMultiLineListItemContinuation` が `false` を返すこと（continuation 行のいずれにも callout/blockquote/fenced-code/table/thematic-break が重ならない）。
5. `buildMultiLineListItemProjection` が抽出された生テキストに対して `ok: true` を返すこと（1行目が3 kind のいずれかとして投影でき、かつ全 continuation 行の indentation が canonical indent 長以上である）。

## 4. raw fallback となる条件（BUILD 時点・Apply を一切拒否しない）

上記いずれか1つでも満たさない場合、editor は list 行の生テキスト（複数行全体）をそのまま表示・編集する（早期 return による拒否は一切行わない——他の全 Phase 5L-* と同じ契約）。代表例:

- 子リストを持つ親 item（`childIds.length > 0`）——`range` が複数行にまたがっていても、multi-line 投影ではなく従来通り raw fallback。
- continuation 行のいずれかに callout/blockquote/fenced-code-block/table/thematic-break が含まれる item（`hasComplexBlockInMultiLineListItemContinuation`）。
- 1行目が3 kind いずれの single-line 投影としても成立しない item（例: 未対応の checkbox status 文字）。
- 非空の continuation 行の indentation が canonical indent 長より浅い item（`"malformed-continuation-indent"`）。
- tab/space 混在の indentation を持つ item（`unsafeIndent`）。
- CompositeBlock member である multi-line list item（今回のスコープ外）。

## 5. Apply 時の契約

### 5.1 全体の流れ

1. 既存の対象/anchor/stale snapshot 検証が最初に走る（他の全 Phase 5L-* と共通、無変更）。
2. `standaloneMultiLineListProjection` が非 `null` の場合のみ、checkbox の現在値（`taskCheckboxInputEl.checked`）・number 入力欄の現在テキスト（`orderedNumberInputEl.value`）・textarea の現在の複数行本文（`textareaEl.value`）の3つ**すべて**を `invertMultiLineListItemProjection` へ渡す（`listKind` に関わらず常に3引数すべてを渡し、呼び出し先が無関係な引数を無視する——既存 single-line 側コントロールが常に存在しつつ条件付きで可視・有効になる設計をそのまま踏襲）。
3. 失敗時は理由に応じて2種類の Notice（`"invalid-number"` → `partialEdit.orderedNumberInvalid`、`"unsafe-structure"` → 新規 `partialEdit.multiLineListStructureInvalid`）を表示し、Apply 全体を拒否する。checkbox・number・本文いずれの draft も編集直後のまま保持され、`applySubtreeEdit` は一切呼び出されない。
4. 成功時に得られる `rawText`（複数行の完全な raw テキスト）を、既存の `applySubtreeEdit` へそのまま渡す——新規の Markdown 書き込み経路は一切追加していない。
5. Apply 成功後は `buildMultiLineListItemProjection(newRawText)` で `standaloneMultiLineListProjection` を再構築し、`renderTaskCheckboxRow()`/`renderOrderedNumberRow()` 両方を再同期する。全 continuation 行が削除され単一行に収束していた場合は `"single-line"` 拒否により `null` へ縮退し、この pane はそのセッション中は single-line 投影へ**自動的に昇格しない**（`loadNodeInternal` の3段階の single-line 試行は読み込み時にのみ走る）——他の全兄弟 rebuild と同じ「劣化のみ許容、種類の自動切り替えはしない」契約を踏襲している。

### 5.2 raw fallback と Apply 拒否の区別

本チケットでは、失敗のタイミングによって扱いが明確に異なる。

- **raw fallback（§4）**: 読み込み（BUILD）時点で構造的に投影できないと判明した場合。ユーザーは常に raw テキストとして編集を継続でき、Apply 自体は一切妨げられない。
- **Apply 拒否（本節）**: 読み込み時点では投影できていた項目に対し、ユーザーの編集内容自体が安全に書き戻せない場合。`invalid-number`（ordered kind の number 検証失敗）と `unsafe-structure`（§5.3 の候補再パース検証失敗）の2種類のみ。いずれも Apply 全体を拒否し、すべての draft を保持する。

### 5.3 候補再パースによる安全性検証（本モジュールのみが持つ、既存3モジュールにはない責務）

既存3つの single-line 投影モジュールはいずれも parser 非依存の純粋モデルである——1行の raw line を分解・再構成するだけなので、編集後の本文がどのような文字列であっても新しい Markdown 構造を生み出すことは構造的にありえない（本文に改行が入る場合のみ `"multiline-body"` として拒否される）。

これに対し、multi-line 投影の continuation 行編集は、canonical indent を前置して実ドキュメントへ再結合した結果、新しい Markdown 構造を**生み出しうる**——たとえばユーザーが continuation 行に `"- 子リストのように見える行"` と入力すると、canonical indent 付与後にそれが実際に子リスト項目として再解釈されてしまう可能性がある。これが `edit/multiLineListItemProjection.ts` が既存3モジュールと異なり唯一 `parser/parseDocument.ts`/`parser/complexBlocks.ts` に依存する理由であり、`validateMultiLineListItemCandidate`（§2.2 に詳細）が、Apply 直前に再構成候補を実ドキュメントとは無関係な使い捨て mini-document として再パースし、依然として安全な単一 leaf list item に解決することを確認してから初めて Apply を許可する。

## 6. Cancel / reload 時の契約

- `cancelEdit()` は、`standaloneMultiLineListProjection?.listKind === "task"`/`"ordered"` のときそれぞれ checkbox/number control を読み込み時の値（`projectedMultiLineChecked`/`projectedMultiLineNumberText`）へ戻す。textarea 自体は `currentDisplayText()`（4分岐すべてを経由する既存の集約点）を通じて既に元に戻る。
- `performAutoReload()` は、4つの standalone projection のいずれかが有効だった場合に、まず既存の三者択一を `doc.nodes` から再判定・再構築し、その結果が3つとも `null` かつ multi-line eligibility（`isStandaloneMultiLineLeafListItemEligibleForProjection` AND `!hasComplexBlockInMultiLineListItemContinuation`、いずれもリロード後の `doc` から再判定）が成立する場合に限り multi-line 投影を再構築する。

## 7. 自動採番・sibling renumbering について（Phase 5L-3 からの継承方針）

`edit/multiLineListItemProjection.ts` は、対象項目自身の raw テキストのみを扱い、兄弟 list item の存在自体を一切認識しない——Phase 5L-3 の `edit/orderedListProjection.ts` と全く同じ設計方針である。したがって:

- multi-line ordered item についても、兄弟間で番号が重複・不連続・逆順であっても、これは Apply 拒否の理由には**決してならない**。
- Apply は、ユーザーが number control に入力した値を（`isValidOrderedListNumberText` を満たす限り）そのまま、他の兄弟 item の番号と無関係に書き込む。
- 兄弟 item の番号を自動的に再計算・再採番する機能は、本チケットでも一切実装していない。

`tests/multiLineLeafListPartialEdit.test.ts` に、この契約を直接検証する専用の回帰テストを置いている。

## 8. 実機検証用 fixture の配置方針

本チケット以降、実機（デスクトップ/iPad 両方）での確認を要する Partial Edit 系フィクスチャは、リポジトリ内（`unified-outliner-public`）ではなく、`ipad-test` vault の `Test` ディレクトリ（`/Users/kazumikaizuka/Obsidian/ipad-test/Test/`）に直接配置する——ユーザーからの明示指示により、Phase 5L-3 検証時点で標準方針として記録済み（プロジェクトメモリ `unified-outliner-verification-fixture-placement-policy.md` 参照）。本チケットの fixture は `ipad-test/Test/multiline-list-marker-free-verification.md` として配置し、旧 `Method/unified-outliner/` vault ルートへの複製は行わない。リポジトリ内の単体/統合テスト用フィクスチャ（`tests/*.test.ts` 内のインライン文字列）はこの方針の対象外で、従来通りリポジトリ内に留まる。

## 9. 将来候補（今回のスコープ外）

- CompositeBlock 側 multi-line list member への同種対応（`edit/multiLineListItemProjection.ts` 自体は CompositeBlock 非依存の純粋寄りモデルとして設計してあるため、将来そのまま再利用しやすい）。
- 子リストを持つ親項目（サブツリー全体）への marker-free projection 対応拡大。
- callout/blockquote/fenced-code-block/table/thematic-break を continuation に含む item への対応。
- marker種別（`-`/`*`/`+` 間、あるいは unordered↔ordered）を変更する UI。
- checkbox status を unchecked/checked 以外に拡大する対応。
- ordered delimiter（`.`/`)`）を変更する UI。
- 兄弟 list item 間の自動採番・renumbering 機能。
- 行の分割・結合を Tree 構造操作（新しい list item の生成）として扱う機能——本チケットでは、continuation 行の増減はあくまで同一 item 内の本文編集として扱い、Tree 上の新規ノード生成を一切伴わない。
- 汎用 Markdown AST ベースの WYSIWYG 編集。
