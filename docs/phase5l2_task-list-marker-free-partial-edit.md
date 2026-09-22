# Phase 5L-2: Task List Marker-Free Partial Edit

対象リポジトリ: `unified-outliner-public`
関連: `docs/統合実装ロードマップ_2026-08-05.md` §3.15（本ドキュメントの実装確定事項の正）、`docs/phase5l1_standalone-list-marker-free-partial-edit.md`（Phase 5L-1、本チケットが構造を踏襲する直接の前段）

## 1. 位置づけ — 5L-1 と 5L-2 の責務分離

| | Phase 5L-1（既存・無変更） | Phase 5L-2（本チケット） |
| --- | --- | --- |
| 対象とする list item | 単独 single-line unordered leaf item のうち、非 task list（`buildListMarkerProjection` が成功するもの） | 単独 single-line unordered leaf item のうち、task list checkbox を持つもの（`buildListMarkerProjection` が "task-list-marker" で拒否するもの） |
| marker/本文分離の実体 | `edit/listMarkerProjection.ts` | **新規** `edit/taskListProjection.ts`（marker/checkbox/本文の3層分離。checkbox を本文の文字列ではなく構造フィールドとして扱う） |
| 対象性の判定 | `edit/standaloneListMarkerProjection.ts#isStandaloneListItemEligibleForMarkerFreeProjection` | **新規** `edit/standaloneTaskListProjection.ts#isStandaloneTaskListItemEligibleForMarkerFreeProjection` — 構造条件は5L-1のものと同一（意図的な独立コピー） |
| UI | 共有 `textareaEl` のみ（marker 抜きの本文） | 共有 `textareaEl`（marker・checkbox 抜きの本文）＋ 新規 `taskCheckboxInputEl`（完了状態の checkbox control） |
| 保存経路 | 既存の list Partial Edit 保存経路（`edit/partialEdit.ts`） | **同じ**保存経路をそのまま再利用。新規の書き込み経路は追加していない |
| CompositeBlock との関係 | CompositeBlock 側は対象外（5D-2C が別途担当） | 同様に CompositeBlock 側 task list member は対象外のまま（将来の別チケット候補） |

5L-1 は、単独 list item のうち task list checkbox を持つものを明示的に対象外とし、`buildListMarkerProjection` 自身の "task-list-marker" 拒否により raw 表示へフォールバックさせていた（`docs/phase5l1_standalone-list-marker-free-partial-edit.md` §4）。5L-2 は、この対象外だった standalone task list item のうち、安全に扱える single-line leaf item に限定して、marker-free / checkbox-free Partial Edit を新規に追加するものである。

## 2. 再利用したコンポーネントと新規追加したコンポーネント

### 2.1 完全に無変更のまま再利用した既存コンポーネント

- `src/edit/listMarkerProjection.ts` — `buildListMarkerProjection` の "task-list-marker" 拒否が、`buildTaskListProjection` を試みるべきかどうかを判定する唯一のトリガーであり続けている（`view/PartialEditView.ts#buildStandaloneListProjections` 参照）。
- `src/edit/standaloneListMarkerProjection.ts` — 非 task 側の対象性判定として引き続きそのまま利用。
- `src/edit/partialEdit.ts`（`extractSubtreeText`/`applySubtreeEdit`）— 既存の list Partial Edit 保存経路そのもの。stale snapshot conflict 検出・`unsafeIndent` 拒否を含め、一切変更していない。
- `src/parser/parseDocument.ts` の `ListBlockNode` モデルとその走査契約 — 新しい構造判定ロジックを発明せず、既存パーサーが生成する情報のみから対象性を判定した。
- `src/view/PartialEditView.ts` の `currentDisplayText()`（Phase 5D-0.5 由来の既存集約点）— ここへ新しい分岐を1つ追加するだけで、`isDirty()`/`cancelEdit()`/`renderLoadedState()` 等の既存メソッドには呼び出し順序の追加のみで対応できた。

### 2.2 新規追加したコンポーネント

- **`src/edit/taskListProjection.ts`（新規ファイル）** — `buildTaskListProjection(rawLine)`/`invertTaskListProjection(projection, editedChecked, editedBody)`/`TaskListProjection`/`projectedTaskBodyText`/`projectedTaskChecked` を export する、純粋・Obsidian 非依存のテキスト変換モジュール。`edit/listMarkerProjection.ts` の task 版にあたる。
  - `TaskListProjection` は `rawLine`/`indent`/`marker`/`markerSpacing`/`checkboxStatusChar`/`checked`/`checkboxSpacing`/`body` の8フィールドを持ち、`indent + marker + markerSpacing + "[" + checkboxStatusChar + "]" + checkboxSpacing + body === rawLine` が常に成立する（可逆分離の核心不変条件）。
  - checkbox の判定境界（`]` の直後が空白/タブまたは行末である場合のみ checkbox として認識する）は、`edit/listMarkerProjection.ts` の既存 `TASK_LIST_BODY_RE` と意図的に同一形状の正規表現を独立コピーとして持たせている——2つのモジュールが「これは task list 行か」について食い違うことは構造上あり得ない（`tests/taskListProjection.test.ts` の専用クロスチェックで保証）。
  - checkbox status は ` `/`x`/`X` の3種のみサポートする。無編集往復では元の文字（大文字小文字含む）をそのまま保持し、状態を実際にトグルした場合のみ canonical な値（`x`/半角スペース）を書き込む。それ以外の1文字ステータス（`/`・`-` 等）は `buildTaskListProjection` が `"unsupported-status"` として拒否し、raw fallback とする。
  - `invertTaskListProjection` は本文への改行混入を `"multiline-body"` として拒否する。checkboxSpacing が元々空文字列だった場合に本文が非空になったときは、半角スペース1文字を合成する（`edit/listMarkerProjection.ts` の markerSpacing 空文字列時の合成規則と同一方針）。
- **`src/edit/standaloneTaskListProjection.ts`（新規ファイル）** — `isStandaloneTaskListItemEligibleForMarkerFreeProjection(node: ListBlockNode): boolean`。判定条件は `edit/standaloneListMarkerProjection.ts` の `isStandaloneListItemEligibleForMarkerFreeProjection` と構造的に同一（`!node.ordered && !node.unsafeIndent && node.childIds.length === 0 && node.range.startLine === node.range.endLine`）——意図的な独立コピーであり、共有 import にはしていない。checkbox の有無自体はこの関数では判定しない。
- **`src/view/PartialEditView.ts` の拡張**:
  - 新規フィールド `standaloneTaskListProjection: TaskListProjection | null`。既存 `standaloneListMarkerProjection` と構築上つねに排他。
  - 新規 DOM 要素 `taskCheckboxRowEl`/`taskCheckboxInputEl`（`textareaEl` の直前に配置される native checkbox control）。
  - 新規の共有メソッド `buildStandaloneListProjections(listEligible, taskEligible, rawLine)` — `loadNodeInternal`・`performAutoReload`・`applyEdit` の Apply 後 rebuild という3箇所すべてがこの1つのメソッドを経由する。`buildListMarkerProjection` をまず試み、その "task-list-marker" 拒否のときに限り `buildTaskListProjection` を試みる、という「どちらか一方だけが成功する」契約を1箇所に集約した。
  - 新規の描画メソッド `renderTaskCheckboxRow()` — `standaloneTaskListProjection` の有無に応じて `taskCheckboxRowEl` の表示・`taskCheckboxInputEl` のチェック状態・disabled を同期する。`renderCompositeListSlot()` と同じ「表示切替・値同期は専用メソッド1箇所に集約する」パターン。

## 3. task-list marker-free projection が有効になる条件（必要条件の AND）

単独 list item セッションにおいて、以下をすべて満たす場合にのみ、editor が marker・checkbox 抜きの本文表示＋ checkbox control になる。

1. `extractSubtreeText` の結果が `kind === "list"` であること。
2. 対象の `ListBlockNode` に対して `isStandaloneTaskListItemEligibleForMarkerFreeProjection` が `true` を返すこと。
3. `buildListMarkerProjection` が抽出された生テキスト行に対して `reason: "task-list-marker"` で拒否すること（＝ 本文が checkbox から始まっている）。
4. `buildTaskListProjection` が同じ生テキスト行に対して `ok: true` を返すこと——marker が `-`/`*`/`+` のいずれかであり、checkbox status が ` `/`x`/`X` のいずれかであること。

## 4. raw fallback となる条件

上記いずれか1つでも満たさない場合、editor は list 行の生テキストをそのまま表示・編集する（早期 return による拒否は一切行わない）。代表例:

- ordered marker（`1.`/`1)`）の task-like item。
- 複数行にまたがる item（continuation paragraph を持つ item）。
- 子リストを持つ親 item。
- checkbox status が ` `/`x`/`X` 以外（`- [/] ...` 等）。
- checkbox 直後に空白/行末以外の文字が続く（`- [x]text`）——この場合は非 task の `ListMarkerProjection` の対象になる（body が `[x]text` という文字列そのものとして扱われる）。
- CompositeBlock member である task list item（今回のスコープ外）。
- tab/space 混在の indentation を持つ item。

## 5. Apply 時の契約

1. 既存の対象/anchor/stale snapshot 検証が最初に走る。
2. `standaloneTaskListProjection` が非 `null` の場合のみ、checkbox control の現在値（`taskCheckboxInputEl.checked`）と textarea の現在値から `invertTaskListProjection` で raw list 行を再構成する。
3. 本文に改行が含まれる場合は `partialEdit.taskBodyNewlineUnsupported` の Notice を表示し、Apply 全体を拒否する（checkbox・本文双方の draft は保持される）。
4. 復元した raw 行は、既存の `applySubtreeEdit` へそのまま渡す。
5. Apply 成功後は `buildTaskListProjection(newRawText)` で `standaloneTaskListProjection` を再構築し、`renderTaskCheckboxRow()` で checkbox 表示を同期する。再構築に失敗した場合（理論上到達しないが、buildListMarkerProjection/buildTaskListProjection いずれの拒否によっても）、raw 表示へ安全に degrade する。

## 6. Cancel / reload 時の契約

- `cancelEdit()` は、checkbox control を読み込み時の `checked` 値へ、textarea を `currentDisplayText()`（marker・checkbox 抜きの本文）へそれぞれ戻す。
- `performAutoReload()` は、`standaloneListMarkerProjection`/`standaloneTaskListProjection` のいずれかが有効だった場合に、両方の eligibility をリロード後の `doc.nodes` から再判定した上で `buildStandaloneListProjections` を再実行する。外部編集により task 行が checkbox を失う（あるいはその逆）ケースでも、次回描画時に正しい方（またはどちらでもない raw fallback）へ自然に切り替わる。

## 7. 将来候補（今回のスコープ外）

- CompositeBlock 側 task list member への同種対応（Phase 5D-2 系の別チケット候補。`TaskListProjection` 自体は CompositeBlock 非依存の純粋モデルとして設計してあるため、将来そのまま再利用できる）。
- ordered task list（`1. [ ] ...`）への対応。
- 複数行 task list item・continuation paragraph を持つ task item への対応。
- 子 list を持つ parent task item（サブツリー全体）への対応。
- ` `/`x`/`X` 以外の1文字 checkbox ステータス（`[/]`・`[-]` 等）への UI 対応拡大。
