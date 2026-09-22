# Phase 5L-1: Standalone Single-Line Unordered List Marker-Free Partial Edit

対象リポジトリ: `unified-outliner-public`
関連: `docs/統合実装ロードマップ_2026-08-05.md` §3.14（本ドキュメントの実装確定事項の正）、`docs/phase5d2c_composite-block-list-marker-free-projection.md`（本チケットが再利用する `edit/listMarkerProjection.ts` の導入元、Phase 5D-2C 自体）

## 1. 位置づけ — 5D-2C と 5L-1 の責務分離

| | Phase 5D-2C（既存・無変更） | Phase 5L-1（本チケット） |
| --- | --- | --- |
| 対象とする list item | CompositeBlock の leading list member（`single-line-list` として分類済み） | CompositeBlock に属さない、単独（standalone）の list item |
| marker/本文分離の実体 | `edit/listMarkerProjection.ts`（`buildListMarkerProjection`/`invertListMarkerProjection`） | **同じ `edit/listMarkerProjection.ts` をそのまま再利用**。新しい分離・復元ロジックは一切追加しない |
| 対象性の判定 | `edit/compositeBlockMemberProjection.ts#isListMemberEligibleForMarkerFreeProjection(kind: CompositeMemberKind)` — 既に分類済みの member 種別文字列を見る | `edit/standaloneListMarkerProjection.ts#isStandaloneListItemEligibleForMarkerFreeProjection(node: ListBlockNode)` — 生の `ListBlockNode` 自身の構造フィールドを見る（新規） |
| 保存経路 | 5D-2A/5D-2B の atomic CompositeBlock 保存基盤（`edit/compositeBlockPartialEdit.ts`） | 既存の list Partial Edit 保存経路（`edit/partialEdit.ts` の `extractSubtreeText`/`applySubtreeEdit`）。無変更のまま接続するのみ |
| Apply/Cancel/conflict の単位 | CompositeBlock 全体で1組 | 単独 list item 1件で1組（既存の standalone Partial Edit と同じ単位、変更なし） |

5D-2C は、CompositeBlock の list member にのみ marker-free 投影を導入し、単独 list Partial Edit は当時の対象外として明記していた（`docs/phase5d2c_composite-block-list-marker-free-projection.md` §8）。5L-1 は、この対象外だった単独 list 側の表示・編集面に、5D-2C が導入した `edit/listMarkerProjection.ts` をそのまま接続するものであり、`buildListMarkerProjection`/`invertListMarkerProjection`/`ListMarkerProjection`/`projectedListBodyText` いずれの契約にも一切触れていない。

## 2. 再利用したコンポーネントと新規追加したコンポーネント

### 2.1 完全に無変更のまま再利用した既存コンポーネント

- `src/edit/listMarkerProjection.ts`（`buildListMarkerProjection`/`invertListMarkerProjection`/`ListMarkerProjection`/`projectedListBodyText`）— marker/本文の分離・復元モデルそのもの。この module 自身の doc comment が、導入当初から「将来の単独 list Partial Edit からの再利用」を見越していた通り、一切の変更なく再利用できた。
- `src/edit/partialEdit.ts`（`extractSubtreeText`/`applySubtreeEdit`）— 既存の list Partial Edit 保存経路そのもの。stale snapshot conflict 検出（`current.text !== originalText` → `reason: "conflict"`）・`unsafeIndent` 拒否（`reason: "unsafe-indent"`）を含め、一切変更していない。
- `src/parser/parseDocument.ts` の `ListBlockNode` モデルとその走査契約（`childIds`/`range`/`ordered`/`unsafeIndent` の意味論）— 新しい構造判定ロジックを発明せず、既存パーサーが生成する情報のみから対象性を判定した。
- `src/view/PartialEditView.ts` の `currentDisplayText()`（Phase 5D-0.5 由来の既存集約点）— `isDirty()`/`cancelEdit()`/`renderLoadedState()` 等、複数箇所が既にここを読んでいたため、ここへ新しい分岐を1つ追加するだけで、他のメソッド側には一切変更が不要だった。

### 2.2 新規追加したコンポーネント

- **`src/edit/standaloneListMarkerProjection.ts`（新規ファイル）** — `isStandaloneListItemEligibleForMarkerFreeProjection(node: ListBlockNode): boolean` のみを export する、純粋・Obsidian 非依存の小さなゲート関数。判定条件は次の3つすべての AND:
  1. `!node.ordered` — ordered marker（`1.`/`1)`）は対象外。`buildListMarkerProjection` 自身も ordered marker を `ok: false` で拒否するため二重の安全策になるが、そもそも成功し得ない構築を試みないための構造的な事前チェックとして明示的に持たせた。
  2. `node.childIds.length === 0 && node.range.startLine === node.range.endLine` — 子リストを持たず、かつ continuation paragraph も持たない leaf item であること。`parser/parseDocument.ts` 自身の走査契約（`range` が item 自身の開始行を超えて伸びるのは、子リスト item を持つ場合（`childIds` に反映される）と continuation paragraph を持つ場合（反映されない）の2通りのみ）により、この単一の条件で両方の除外対象を同時に捉えている。
  3. `!node.unsafeIndent` — tab/space 混在の indentation は対象外。`edit/partialEdit.ts#extractSubtreeText` 側で既にこのような node は上流拒否されており、実際にはこの関数まで到達しないが、この関数自身の契約を呼び出し側の実装詳細に依存させず独立して正しく保つための防御的な条件として持たせた。
  - task list（`- [ ] ...`）の判定はこの関数では**行わない**。Obsidian の checkbox は `parser/parseDocument.ts` の `ListBlockNode` が別概念としてモデル化しない、本文の生テキストの一部であるため、構造的には対象性ありと判定させたまま、1層後段の `buildListMarkerProjection` 自身が持つ既存の "task-list-marker" 拒否に委ねている。ineligible（この関数が `false` を返す）と build-failure（この関数は `true` を返すが `buildListMarkerProjection` が失敗する）はどちらも呼び出し側からは「raw 表示にフォールバックする」という同一の結果になるため、呼び出し側がこの2つを区別する必要はない。
- **5D-2C 専用ゲートとの非統合（重要な設計判断）** — `edit/compositeBlockMemberProjection.ts` の `isListMemberEligibleForMarkerFreeProjection(kind: CompositeMemberKind)` とは意図的に統合していない。両者は入力の形状が根本的に異なる。前者は `parser/compositeBlocks.ts` 側の別スキャンが生成する、既に分類済みの `CompositeMemberKind` 文字列を受け取るのに対し、`isStandaloneListItemEligibleForMarkerFreeProjection` は生の `ListBlockNode` 自身の `childIds`/`range`/`ordered`/`unsafeIndent` フィールドを直接読む。1つのシグネチャへ無理に統合すると、CompositeBlock 固有の概念（`CompositeMemberKind`）をこのファイルへ、または単独 list 固有の概念（`ListBlockNode` の構造フィールド）を `compositeBlockMemberProjection.ts` へ、いずれかの方向へ漏らすことになる。データを実際に読むドメインごとに、それぞれ独立したゲート関数として配置することが、より小さく明確な変更になると判断した。
- **`src/view/PartialEditView.ts` の新規フィールド** — `standaloneListMarkerProjection: ListMarkerProjection | null`。CompositeBlock 専用の既存 `listMarkerProjection` フィールドとは意図的に**別フィールド**にした。理由は、両者が描画する DOM 要素が異なるため——`listMarkerProjection` は CompositeBlock 構造化セッション専用の `compositeListInputEl` へ描画するのに対し、単独 list node の投影は、段落・callout/blockquote の standalone editor と共有する `textareaEl` へ描画する。既存の `quoteProjection` フィールドが standalone/composite 双方のセッションで正しく共有できているのは、いずれのケースでも同じ `textareaEl` へ描画するためであり、今回の `listMarkerProjection`（→ `compositeListInputEl`）と新規の単独 list 投影（→ `textareaEl`）は描画先が異なるため、フィールドを共有すると DOM 要素との対応関係がかえって不明瞭になると判断した。

## 3. marker-free projection が有効になる条件（必要条件の AND）

単独（`nodeId` を持つ、`paragraphAnchor`/`compositeAnchor` ではない）list item セッションにおいて、以下をすべて満たす場合にのみ、editor（`textareaEl`）が marker 抜きの本文表示になる。

1. `extractSubtreeText` の結果が `kind === "list"` であること。
2. 対象の `ListBlockNode` に対して `isStandaloneListItemEligibleForMarkerFreeProjection` が `true` を返すこと（§2.2 の3条件）。
3. 抽出された生テキスト行に対して `buildListMarkerProjection` が `ok: true` を返すこと — 具体的には、marker が `-`/`*`/`+` のいずれか（ordered marker ではない）であり、marker 直後の本文が task-list チェックボックス（`[ ]`/`[x]`/任意1文字ステータス）から始まっていないこと。

## 4. raw fallback となる条件

上記いずれか1つでも満たさない場合、editor は従来通り list 行の生テキスト（marker 込み）をそのまま表示・編集する。早期 return による Apply 拒否やパネル自体の拒否は一切行わない——既存の raw Partial Edit という安全な代替手段が常に存在するため、対象の item を開けなくなる状況は発生しない。具体的な代表例:

- ordered marker（`1.`/`1)`）の item。
- task list（`- [ ] text`/`- [x] text` 等）の item——構造的には対象性ありと判定されるが、`buildListMarkerProjection` 自身の拒否により結果として raw 表示になる。
- 複数行にまたがる item（continuation paragraph を持つ item）。
- 子リストを持つ親 item（サブツリー全体を単独で開いた場合も、親自身の行は marker-free 化しない——子を含むサブツリー全体の raw 編集という既存の standalone list Partial Edit の挙動をそのまま維持する）。
- tab/space 混在の indentation を持つ item（`unsafeIndent`。実際には `extractSubtreeText` 側で既に上流拒否される）。

見出し直下・親 list item の子（leaf item）のいずれのケースでも、indentation と親子構造そのものは一切変更されない——marker-free projection は「editor に何を表示するか」と「Apply 時にどう復元するか」だけに関わる変更であり、パーサーが認識する list 構造そのものには触れていない。

## 5. Apply 時の契約

1. 既存の対象/anchor/stale snapshot 検証（`extractSubtreeText` を通じた既存チェック）が最初に走る——marker-free projection の有無はこの検証の実行順序・内容に一切影響しない。
2. `standaloneListMarkerProjection` が非 `null` の場合のみ、編集後の textarea の値を `invertListMarkerProjection` で raw list 行へ復元する。
3. 復元に失敗した場合（本文への改行混入、理由 `"multiline-body"`）、5D-2C の CompositeBlock 分岐と**全く同じ**既存 Notice（`partialEdit.listBodyNewlineUnsupported`）を表示して Apply 全体を拒否し、draft（textarea の内容）を保持する。新規の i18n キーは追加していない。
4. 復元後の raw 行（または `standaloneListMarkerProjection` が `null` の場合は textarea の値そのまま）を、既存の list Partial Edit 保存経路（`applySubtreeEdit`）へそのまま渡す——新規の Markdown 書き込み経路は一切追加していない。
5. Apply が実際に拒否されるのは、対象/anchor 解決失敗・stale snapshot conflict・`unsafeIndent`・marker-free 投影の反転失敗（改行混入）など、既存の list Partial Edit が既に持つ安全性チェックによる場合のみである。
6. Apply 成功後は、`quoteProjection` の再構築と同様に、保存済みの raw 行から `standaloneListMarkerProjection` を再構築する。対象性が失われていれば（通常は発生しないが、将来的な拡張に備えた契約として）`standaloneListMarkerProjection` は `null` になり、次回オープン時に自然に raw 表示へフォールバックする。
7. marker・marker 後の空白・indentation・親子関係・既存の兄弟順序は、`invertListMarkerProjection` が常に元の値をそのまま再利用するため、Apply によって一切変化しない。
8. marker の種類を変更するための入力要素（select/input）は新設していない——復元される行は常に読み込み時に捕捉した元の marker を使う。

## 6. Cancel・reset の契約（無変更のパターンをそのまま踏襲）

`cancelEdit()` は既存の `currentDisplayText()` 経由の revert ロジックがそのまま正しく機能する——marker-free 本文か raw 行かを `cancelEdit()` 自身が意識する必要はない。`resetLoadedState()`/`loadParagraphInternal()`/`loadCompositeInternal()` はいずれも `standaloneListMarkerProjection` を `null` へリセットするコードを追加し、段落セッションや CompositeBlock セッションが直前の単独 list セッションの投影を引き継ぐことがないようにした。`performAutoReload()` は、`this.nodeId` と既存の `standaloneListMarkerProjection` が両方とも設定されている場合のみ、リロード後の `doc.nodes` から対象性を再判定してから `buildListMarkerProjection` を再実行する——リロード前の形状（外部編集で対象性が変化している可能性がある）をそのまま信頼しない。

## 7. 受入基準（Acceptance Criteria）

- [x] トップレベルの `-` 単一行 item を開くと、editor は marker を含まない本文のみを表示する。
- [x] `*` marker の item も同様に marker が隠れ、Apply 後も `*` のまま復元される。
- [x] `+` marker の item も同様に marker が隠れ、Apply 後も `+` のまま復元される。
- [x] indentation を持つ leaf item（親 list item の子）は、marker と indentation の両方が Apply 後も正しく復元される。
- [x] 親 list 内の leaf item を marker-free 編集しても、親子構造・兄弟順序は一切壊れない。
- [x] 本文のみの編集は、byte-for-byte で正しい raw list 行へ復元される。
- [x] 本文を空へ編集した場合の挙動は、既存の list 構文・保存ポリシーにそのまま従う。
- [x] 本文に改行を含む編集は Apply 時に拒否され（既存 Notice）、draft は保持される。
- [x] marker に似た文字列（例: `- `）を本文へ直接入力しても、二重 marker が発生しない。
- [x] Markdown リンク・埋め込み・太字・インラインコード・`>` を含む本文は、いずれも壊れずに往復する。
- [x] Apply 成功後、同じ item を再度開くと、更新後の本文が marker-free のまま正しく表示される。
- [x] Cancel は marker-free な本文 draft を正しく元に戻す。
- [x] 外部編集による stale snapshot conflict は、既存の list Partial Edit と全く同じ形で Apply を拒否し、draft を保持する。
- [x] ordered list は raw 表示へフォールバックする。
- [x] task list は raw 表示へフォールバックする。
- [x] 複数行にまたがる list item は raw 表示へフォールバックする。
- [x] 子リストを持つ親 item は raw 表示へフォールバックする。
- [x] continuation paragraph を持つ item は raw 表示へフォールバックする。
- [x] コードブロック等の複雑な内容を含む continuation を持つ item は raw 表示へフォールバックする。
- [x] 対象範囲外の行は Apply によって一切変更されない。
- [x] 既存の単独 list サブツリー Partial Edit（保存/Apply/Cancel/conflict/move/indent-outdent/drag & drop）に回帰がない。
- [x] 既存の CompositeBlock marker-free projection（5D-2C）に回帰がない。
- [x] 既存の quote-prefix-projection・CompositeBlock structured Partial Edit・move・drag & drop・indent-outdent に回帰がない。
- [x] list item の marker 種別を変更するための新規 UI は追加していない。
- [x] 全テスト・`tsc -noEmit -skipLibCheck`・`npm run lint`・`npm run build` が成功する（§9 参照）。

## 8. 今回のチケットの対象外（Phase 5L-2/5L-3 候補）

- ordered list（`1.`/`1)`）への marker-free projection 対応拡大。
- task list（`- [ ]`/`- [x]` 等）への marker-free projection 対応拡大。
- 複数行にまたがる list item・continuation paragraph を持つ item への対応。
- 子リストを持つ親 item（サブツリー全体）への marker-free projection 対応——単独の leaf item への対応が今回のスコープであり、親 item・サブツリー全体の投影は含まない。
- CompositeBlock 側 list member への同種の対応拡大（task list・ordered list 等）——今回は単独 list のみが対象であり、5D-2C の CompositeBlock 側ロジックには一切手を加えていない。

## 9. 実行した検証コマンドと結果

```
npx tsc -noEmit -skipLibCheck   # エラーなし
npm test -- --run               # 115 ファイル / 2195 件、全通過
npm run lint                    # 0 エラー（settings.ts の既存無関係 warning 3件のみ）
npm run build                   # 成功（main.js 生成を確認）
```

新規追加したテストファイル:

- `tests/standaloneListMarkerProjection.test.ts`（14件）— `isStandaloneListItemEligibleForMarkerFreeProjection` 単体。実際の `parser/parseDocument.ts` によるフィクスチャのみを用い、手書きの `ListBlockNode` リテラルは使用していない。
- `tests/standaloneListMarkerPartialEdit.test.ts`（20件）— `parseDocument` → `extractSubtreeText` → eligibility 判定 → `buildListMarkerProjection` → `invertListMarkerProjection` → `applySubtreeEdit` という実際のパイプライン全体を通す統合テスト。marker 変種ごとの投影と Apply 後の復元、indentation を伴う leaf item の marker・indentation 双方の復元（親・兄弟行が不変であることを `outcome.lines` の完全一致で確認）、空本文への保存、marker 風文字列の本文直接入力での二重 marker 化なしの確認、Markdown リンク/埋め込み/太字/インラインコード/`>` を含む本文の往復確認、Apply 後の再オープンでの投影反映、改行混入時の拒否（`applySubtreeEdit` 到達前に拒否・`doc.lines` 無変更）、真に再パースし直した「外部編集後」の `doc` を用いた stale snapshot conflict 拒否、ordered list・task list・複数行 continuation（既存挙動が byte-for-byte 無変更であることの確認を含む）・子リストを持つ親 item・fenced code を含む continuation の raw fallback 確認を含む。
- `tests/standaloneListMarkerFreePartialEditUiWiring.test.ts`（11件）— `view/PartialEditView.ts` のソーステキスト検査による wiring 確認。フィールド宣言・import・`loadNodeInternal` のゲート配置（`this.nodeId = nodeId;` より前、早期 return なし）・`currentDisplayText()` の分岐順序（`quoteProjection` の次、raw `originalText` の前）・`applyEdit` の invert/Notice/fallthrough・marker 変更 UI 非新設・Apply 後の再構築・`resetLoadedState`/`loadParagraphInternal`/`loadCompositeInternal` での reset・`performAutoReload` の対象性再判定を検証。当初 `tests/compositeBlockPartialEditUiWiring.test.ts` に追加していたが、`tests/quotePrefixPartialEditViewWiring.test.ts` 等が確立している「機能領域ごとに独立したファイルで、各ファイルが自前の `viewTs`/`bodyOf` を持つ」という既存の慣例に合わせ、専用ファイルへ抽出した。

既存ファイルへの変更:

- `tests/compositeBlockPartialEditUiWiring.test.ts` — Phase 5L-1 関連の2つの describe ブロックを上記の専用ファイルへ抽出し、`standaloneListMarkerProjection` フィールドの追加によって影響を受けた既存アサーション4件（厳密な隣接文字列一致 → インデックスベースの順序確認への書き換え、および `.not.toContain("listMarkerProjection")` という素朴な部分文字列チェック → CompositeBlock 固有概念（`this.listMarkerProjection`・`compositeListInputEl`・`compositeListOriginalText`）へのドット修飾済みの厳密チェックへの書き換え）を修正した。
- `tests/quotePrefixPartialEditViewWiring.test.ts` — `currentDisplayText()` の厳密な単一式文字列一致テストを、新しい多分岐構造とその相対順序（`quoteProjection` → `standaloneListMarkerProjection` → raw `originalText`）を確認する内容へ書き換えた。

既存の全テスト（単独 list Partial Edit・CompositeBlock・quote/callout 編集・move・drag & drop・indent/outdent を含む）はいずれも無変更のまま全通過を維持しており、回帰は確認されていない。`edit/listMarkerProjection.ts`・`edit/compositeBlockMemberProjection.ts`・`edit/quotePrefixProjection.ts`・`edit/compositeBlockPartialEdit.ts` はいずれも無変更（diff なし）。

## 10. 実機検証用の最小 Markdown fixture

以下のいずれのノートでも、Outline Tree 上の対象 list item を（Tree のダブルクリック等、既存の起動手段で）Partial Edit Pane で開き、想定どおり editor が marker 抜きの本文のみを表示することを確認する。

### fixture A: トップレベル `-` marker（marker-free projection が有効になる想定）

```markdown
- 史料の確認事項
```

期待結果: editor には `史料の確認事項`（先頭の `- ` を含まない）が表示される。本文を編集して Apply すると、`- ` が正しく復元されたうえで保存される。

### fixture B: `*`/`+` marker（marker-free projection が有効になる想定）

```markdown
* 第一の論点
+ 第二の論点
```

期待結果: いずれの item も、editor にはそれぞれの marker を含まない本文のみが表示される。Apply 後もそれぞれ元の `*`/`+` marker のまま復元される。

### fixture C: indentation を伴う leaf item（marker-free projection が有効になる想定）

```markdown
- 親項目
  - 子項目（leaf）
```

期待結果: 子項目（leaf item）を開くと editor には `子項目（leaf）`（marker・indentation を含まない）が表示される。本文を編集して Apply すると、2スペースの indentation と `- ` marker がいずれも正しく復元され、親項目の行は一切変更されない。親項目自身を開いた場合は、子リストを持つため raw fallback（`- 親項目`、marker 込み）のまま表示される。

### fixture D: task list / ordered list（raw fallback になる想定）

```markdown
- [ ] 確認する
1. 手順その1
```

期待結果: いずれの item も editor には marker（およびチェックボックス）を含む生テキストがそのまま表示される。

### fixture E: continuation paragraph / 子リストを持つ親項目（raw fallback になる想定）

```markdown
- 項目本文
  続きの段落がここに入る。
- 親項目2
  - 子項目2
```

期待結果: いずれの item も、対象 item 自身の行を超える内容（continuation paragraph、子リスト）を含むため、editor には生テキストのサブツリー全体がそのまま表示される（既存の standalone list サブツリー Partial Edit の挙動のまま）。
