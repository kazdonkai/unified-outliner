# Phase 5L-3: Ordered List Marker-Free Partial Edit

対象リポジトリ: `unified-outliner-public`
関連: `docs/統合実装ロードマップ_2026-08-05.md` §3.16（本ドキュメントの実装確定事項の正）、`docs/phase5l2_task-list-marker-free-partial-edit.md`（Phase 5L-2、本チケットが構造を踏襲する直接の前段）、`docs/phase5l1_standalone-list-marker-free-partial-edit.md`（Phase 5L-1）

## 1. 位置づけ — 5L-1/5L-2 と 5L-3 の責務分離

| | Phase 5L-1（既存・無変更） | Phase 5L-2（既存・無変更） | Phase 5L-3（本チケット） |
| --- | --- | --- | --- |
| 対象とする list item | 単独 single-line unordered leaf item のうち、非 task list | 単独 single-line unordered leaf item のうち、task list checkbox を持つもの | 単独 single-line **ORDERED** leaf item（`buildListMarkerProjection` が "ordered-marker" で拒否するもの） |
| marker/本文分離の実体 | `edit/listMarkerProjection.ts` | `edit/taskListProjection.ts` | **新規** `edit/orderedListProjection.ts`（indent/number/delimiter/markerSpacing/本文の5層分離。number を本文の文字列ではなく構造フィールドとして扱う） |
| 対象性の判定 | `edit/standaloneListMarkerProjection.ts` | `edit/standaloneTaskListProjection.ts` | **新規** `edit/standaloneOrderedListProjection.ts#isStandaloneOrderedListItemEligibleForMarkerFreeProjection` — 構造条件は非 ordered 側2モジュールとちょうど補集合（`node.ordered`） |
| UI | 共有 `textareaEl` のみ | 共有 `textareaEl` ＋ `taskCheckboxInputEl` | 共有 `textareaEl`（number 抜きの本文）＋ 新規 `orderedNumberInputEl`（`type="text"` の番号 control） |
| number/delimiter の扱い | — | — | number は独立編集可能な構造フィールド。**delimiter（`.`/`)`）は本フェーズでは一切編集不可** — `invertOrderedListProjection` に「編集後の delimiter」引数自体が存在しない |
| 保存経路 | 既存の list Partial Edit 保存経路（`edit/partialEdit.ts`） | 同じ保存経路 | **同じ**保存経路をそのまま再利用。新規の書き込み経路は追加していない |
| 自動採番 | — | — | **一切実装していない** — 兄弟 item 間の番号の重複・不連続・逆順は Apply 拒否の理由にならない |
| CompositeBlock との関係 | 対象外 | 対象外 | 同様に CompositeBlock 側 ordered list member は対象外のまま（将来の別チケット候補） |

5L-2 は、単独 list item のうち ordered marker を持つものを明示的に対象外とし、`buildListMarkerProjection` 自身の "ordered-marker" 拒否により raw 表示へフォールバックさせていた（この拒否理由自体は 5D-2C 由来で、5L-1/5L-2 を通じて無変更のまま維持されている）。5L-3 は、この対象外だった standalone ordered list item のうち、安全に扱える single-line leaf item に限定して、marker-free Partial Edit を新規に追加するものである。

## 2. 再利用したコンポーネントと新規追加したコンポーネント

### 2.1 完全に無変更のまま再利用した既存コンポーネント

- `src/edit/listMarkerProjection.ts` — `buildListMarkerProjection` の "ordered-marker" 拒否が、`buildOrderedListProjection` を試みるべきかどうかを判定する唯一のトリガーであり続けている（`view/PartialEditView.ts#buildStandaloneListProjections` 参照）。"task-list-marker" 拒否との分岐は互いに排他的で、同一呼び出しの結果として決して同時には発生しない。
- `src/edit/taskListProjection.ts` — 無変更のまま、非 ordered・task list 側の分離として引き続き利用。
- `src/edit/standaloneListMarkerProjection.ts`・`src/edit/standaloneTaskListProjection.ts` — 非 ordered 側の対象性判定として引き続きそのまま利用。
- `src/edit/partialEdit.ts`（`extractSubtreeText`/`applySubtreeEdit`）— 既存の list Partial Edit 保存経路そのもの。stale snapshot conflict 検出・`unsafeIndent` 拒否を含め、一切変更していない。
- `src/parser/parseDocument.ts` の `ListBlockNode` モデルとその走査契約（`ordered`/`unsafeIndent`/`childIds`/`range` フィールド）— 新しい構造判定ロジックを発明せず、既存パーサーが生成する情報のみから対象性を判定した。
- `src/view/PartialEditView.ts` の `currentDisplayText()`（Phase 5D-0.5 由来の既存集約点）— ここへ新しい分岐を1つ追加するだけで、`isDirty()`/`cancelEdit()`/`renderLoadedState()` 等の既存メソッドには呼び出し順序の追加のみで対応できた。

### 2.2 新規追加したコンポーネント

- **`src/edit/orderedListProjection.ts`（新規ファイル）** — `buildOrderedListProjection(rawLine)`/`invertOrderedListProjection(projection, editedNumberText, editedBody)`/`OrderedListProjection`/`projectedOrderedBodyText`/`projectedOrderedNumberText`/`isValidOrderedListNumberText` を export する、純粋・Obsidian 非依存のテキスト変換モジュール。`edit/listMarkerProjection.ts`/`edit/taskListProjection.ts` いずれの契約も拡張しない、完全に独立したモジュールである。
  - `OrderedListProjection` は `rawLine`/`indent`/`number`/`delimiter`/`markerSpacing`/`body` の6フィールドを持ち、`indent + number + delimiter + markerSpacing + body === rawLine` が常に成立する（可逆分離の核心不変条件）。
  - `number` は元の桁そのまま（先頭ゼロを含め）保持し、正規化・再フォーマットは一切行わない。
  - `delimiter`（`.` または `)`）は本フェーズでは一切編集不可のフィールドである。`invertOrderedListProjection` は常に `projection.delimiter` を verbatim 再利用し、「編集後の delimiter」という引数自体が存在しない——構造的に delimiter を変更できないようにしている。
  - `buildOrderedListProjection` は、marker が unordered（`-`/`*`/`+`）の場合は `"unordered-marker"`、本文が task list checkbox で始まる場合（`1. [ ] ...` 等 — ordered task list はこのチケットの対象外）は `"task-list-marker"` で拒否する。
  - `number` フィールドの検証は、`isValidOrderedListNumberText`（`Number()`/`parseInt()` を一切使わない `/^[0-9]+$/` かつ非オール0のみを許容する厳格な文字列検証）で行う。JavaScript の数値変換が持つ落とし穴（`Number("Infinity")`・`Number("  1  ")`・`Number("1e2")` 等がいずれも「有効な数値」として通ってしまう問題）を、数値パースを一切試みないことで構造的に回避している。空文字列・`"0"`/`"00"`・負数（`-` は数字ではないため正規表現自体が一致しない）・小数点・指数表記・リテラル文字列 `"NaN"`/`"Infinity"`・前後/内部の空白付き文字列は、いずれも同じ理由（正規表現の不一致）で拒否される。
  - `invertOrderedListProjection` は本文への改行混入を `"multiline-body"` として拒否する。markerSpacing が元々空文字列（bare `1.`）だった場合に本文が非空になったときは、半角スペース1文字を合成する（`edit/listMarkerProjection.ts`/`edit/taskListProjection.ts` の markerSpacing/checkboxSpacing 空文字列時の合成規則と同一方針）。
- **`src/edit/standaloneOrderedListProjection.ts`（新規ファイル）** — `isStandaloneOrderedListItemEligibleForMarkerFreeProjection(node: ListBlockNode): boolean`。判定条件は `node.ordered && !node.unsafeIndent && node.childIds.length === 0 && node.range.startLine === node.range.endLine`——非 ordered 側2モジュールの `!node.ordered` とちょうど構造的補集合の関係にある。3つとも意図的に独立コピーとして維持し、共有 import にはしていない。
- **`src/view/PartialEditView.ts` の拡張**:
  - 新規フィールド `standaloneOrderedListProjection: OrderedListProjection | null`。既存 `standaloneListMarkerProjection`/`standaloneTaskListProjection` と構築上つねに三者排他（3つのうち最大1つのみが非 `null`）。
  - 新規 DOM 要素 `orderedNumberRowEl`/`orderedNumberInputEl`（`textareaEl` の直前に配置される `<input type="text">` — ブラウザの `type="number"` 挙動のみに検証を委ねないという本チケットの明示要求どおり、strict な検証は Apply 時に `isValidOrderedListNumberText` で独立して行う）。
  - 既存の共有メソッド `buildStandaloneListProjections` を二者択一（list/task）から三者択一（list/task/ordered）へ拡張。`buildListMarkerProjection` をまず試み、その "task-list-marker" 拒否のときに限り `buildTaskListProjection` を、"ordered-marker" 拒否のときに限り `buildOrderedListProjection` を試みる——3つの call site（`loadNodeInternal`・`performAutoReload`・`applyEdit`）が引き続きこの1つのメソッドを経由する。
  - 新規の描画メソッド `renderOrderedNumberRow()` — `standaloneOrderedListProjection` の有無に応じて `orderedNumberRowEl` の表示・`orderedNumberInputEl` の値（`projectedOrderedNumberText` 経由で verbatim 表示）・disabled を同期する。`renderTaskCheckboxRow()` と同じ「表示切替・値同期は専用メソッド1箇所に集約する」パターン。

## 3. ordered list marker-free projection が有効になる条件（必要条件の AND）

単独 list item セッションにおいて、以下をすべて満たす場合にのみ、editor が number-marker 抜きの本文表示＋ number control になる。

1. `extractSubtreeText` の結果が `kind === "list"` であること。
2. 対象の `ListBlockNode` に対して `isStandaloneOrderedListItemEligibleForMarkerFreeProjection` が `true` を返すこと。
3. `buildListMarkerProjection` が抽出された生テキスト行に対して `reason: "ordered-marker"` で拒否すること（＝ marker が ordered である）。
4. `buildOrderedListProjection` が同じ生テキスト行に対して `ok: true` を返すこと——本文が task list checkbox で始まっていないこと。

## 4. raw fallback となる条件

上記いずれか1つでも満たさない場合、editor は list 行の生テキストをそのまま表示・編集する（早期 return による拒否は一切行わない）。代表例:

- ordered task list item（`1. [ ] ...`）——`buildListMarkerProjection` 自身が "ordered-marker" で拒否した後、`buildOrderedListProjection` 自身がさらに "task-list-marker" で拒否するため、3つの標準投影のいずれも成立せず raw フォールバックになる（5L-2 が非 ordered task list item を対象外としたのと対をなす、今回のチケットの明示的スコープ外事項）。
- 複数行にまたがる item（continuation paragraph を持つ item）。
- 子リストを持つ親 item。
- CompositeBlock member である ordered list item（今回のスコープ外）。
- tab/space 混在の indentation を持つ item。

## 5. Apply 時の契約

1. 既存の対象/anchor/stale snapshot 検証が最初に走る。
2. `standaloneOrderedListProjection` が非 `null` の場合のみ、number control の現在値（`orderedNumberInputEl.value`）と textarea の現在値から `invertOrderedListProjection` で raw list 行を再構成する。
3. 本文に改行が含まれる場合は `partialEdit.orderedBodyNewlineUnsupported` の Notice を、number が `isValidOrderedListNumberText` を満たさない場合は `partialEdit.orderedNumberInvalid` の Notice を表示し、いずれも Apply 全体を拒否する（number・本文双方の draft は保持される）。
4. 復元した raw 行は、既存の `applySubtreeEdit` へそのまま渡す。
5. Apply 成功後は `buildOrderedListProjection(newRawText)` で `standaloneOrderedListProjection` を再構築し、`renderOrderedNumberRow()` で number 表示を同期する。再構築に失敗した場合（理論上到達しないが）、raw 表示へ安全に degrade する。

## 6. Cancel / reload 時の契約

- `cancelEdit()` は、number control を読み込み時の `number` 値へ、textarea を `currentDisplayText()`（number-marker 抜きの本文）へそれぞれ戻す。
- `performAutoReload()` は、3つの standalone projection のいずれかが有効だった場合に、3つすべての eligibility をリロード後の `doc.nodes` から再判定した上で `buildStandaloneListProjections` を再実行する。

## 7. 自動採番・sibling renumbering について（本チケットの明示要求）

`edit/orderedListProjection.ts` は1行の raw line のみを扱い、兄弟 list item の存在自体を一切認識しない。したがって:

- 兄弟間で番号が重複・不連続・逆順であっても、これは Apply 拒否の理由には**決してならない**。
- Apply は、ユーザーが number control に入力した値を（`isValidOrderedListNumberText` を満たす限り）そのまま、他の兄弟 item の番号と無関係に書き込む。
- 兄弟 item の番号を自動的に再計算・再採番する機能は、本チケットでは一切実装していない。

`tests/orderedListMarkerPartialEdit.test.ts` に、この契約を直接検証する専用の回帰テストを置いている。

## 8. 将来候補（今回のスコープ外）

- CompositeBlock 側 ordered list member への同種対応（Phase 5D-2 系の別チケット候補。`OrderedListProjection` 自体は CompositeBlock 非依存の純粋モデルとして設計してあるため、将来そのまま再利用できる）。
- ordered task list（`1. [ ] ...`）への対応。
- 複数行 ordered list item・continuation paragraph を持つ item への対応。
- 子 list を持つ parent ordered item（サブツリー全体）への対応。
- delimiter（`.`/`)`）自体を変更する UI。
- 兄弟 list item 間の自動採番・renumbering 機能。
