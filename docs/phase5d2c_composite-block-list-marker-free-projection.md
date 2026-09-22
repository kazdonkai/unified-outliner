# Phase 5D-2C: CompositeBlock single-line-list member marker-free projection

対象リポジトリ: `unified-outliner-public`
関連: `docs/統合実装ロードマップ_2026-08-05.md` §3.13（本ドキュメントの実装確定事項の正）、`docs/phase5d2b_composite-block-structured-partial-edit.md`（本チケットが土台とする Phase 5D-2B 自体）

## 1. 位置づけ — 5D-2B と 5D-2C の責務分離

| | Phase 5D-2B（既存・無変更） | Phase 5D-2C（本チケット） |
| --- | --- | --- |
| 何を保存基盤とするか | 5D-2A の atomic backend（`edit/compositeBlockPartialEdit.ts`）をそのまま再利用 | 5D-2B をそのまま再利用。新しい保存経路・新しい range 解決・新しい conflict 判定は一切追加しない |
| list member の編集面 | list 行そのもの（marker を含む生テキスト）を1つの単一行入力欄にそのまま表示 | leading member が `single-line-list` として認識される場合に限り、marker（`-`/`*`/`+`）を隠し、本文のみを編集する投影を追加。Apply 時に marker・marker 後の空白・indentation を可逆的に復元する |
| trailing member の編集面 | 既存 `QuotePrefixProjection`（callout/blockquote の prefix-free structured editor） | 無変更のまま再利用 |
| CompositeBlock の grouping rule 存続方針（方針A） | 編集結果が rule に再マッチしなくても Apply は成功し、`compositeRuleNoLongerMatches` 通知を出す（既存・無変更） | **無変更のまま維持**。marker-free 投影はこの方針を強制する UI 上のロックには一切ならない — list 本文の編集によって意図的に grouping を解消する編集も、既存どおり正当な Apply として成功する |
| Apply/Cancel/conflict の単位 | CompositeBlock 全体で1組 | CompositeBlock 全体で1組（変更なし） |

5D-2B は本チケット開始前から `main` に実装済みであり、一切変更していない。5D-2C は、5D-2B が既に構造化表示していた list member 入力欄の「表示内容」だけを、条件を満たす場合に marker 込みの生テキストから marker 抜きの本文へ差し替えるものであり、`splitCompositeBlockMembers`/`composeCompositeBlockMemberText`/`applyCompositeBlockEdit` いずれの契約にも触れていない。

## 2. 再利用したコンポーネントと新規追加したコンポーネント

### 2.1 完全に無変更のまま再利用した既存コンポーネント

- `src/edit/compositeBlockPartialEdit.ts`（`extractCompositeBlockText`/`applyCompositeBlockEdit`）— 5D-2A/5D-2B の atomic 保存基盤そのもの。方針A（rule 不一致でも Apply は成功する）を含め、一切変更していない。
- `src/edit/compositeBlockMemberProjection.ts`（`splitCompositeBlockMembers`/`composeCompositeBlockMemberText`）— 5D-2B の member 分離・再結合ロジック。既存エクスポートは無変更（新規エクスポート追加については §2.2 参照）。
- `src/edit/quotePrefixProjection.ts` — trailing callout/blockquote member の prefix-free 投影。本チケットの設計モデルそのもの（"prefix + content === 元の行" という不変条件、空だった区切りに新規内容が入る際に半角スペース1つだけ合成する規約）を流用したが、モジュール自体には一切手を加えていない。
- `src/parser/parseDocument.ts` の `LIST_RE`（`/^([ \t]*)([-*+]|\d+[.)])(?:[ \t]+.*)?$/`）と、その ordered marker 判定（`/^\d/.test(marker)`）— list marker の認識モデルを新規に発明せず、既存パーサーが既に使っているものと完全に整合させるため、そのまま踏襲した（複製ではなく、同じ正規表現の構造をそのまま再利用）。
- `src/parser/compositeBlocks.ts` の member 種別分類（`single-line-list` と `list` の区別 — 継続行・入れ子子リストの有無のみで決まる、純粋に構造的な区別）— 無変更。marker の種類（ordered/unordered）や task-list チェックボックスの有無では一切区別していない既存仕様も、そのまま前提として利用した。

### 2.2 新規追加したコンポーネント

- **`src/edit/listMarkerProjection.ts`（新規ファイル）** — `QuotePrefixProjection` と対をなす、純粋・Obsidian 非依存のモデル。CompositeBlock を一切知らず、単独の生テキスト行1つだけを扱う（将来の Phase 5L-1「単独 list Partial Edit の marker-free 投影」から再利用されることを見越した設計）。
  - `buildListMarkerProjection(rawLine)`: `indent`（先頭の空白）・`marker`（`-`/`*`/`+` のいずれか1文字）・`markerSpacing`（marker 直後の空白）・`body`（本文）に分解する。`indent + marker + markerSpacing + body === rawLine` が常に成立する（`QuotePrefixProjection` の "prefix + content === 元の行" と同じ discipline）。ordered marker（`1.`/`1)`）・task-list marker（`[ ]`/`[x]`/`[/]` 等、Obsidian 独自の任意1文字ステータスを含む）・そもそも list 行として認識できない入力は、いずれも `ok: false` で明示的な理由付きで拒否する。
  - `projectedListBodyText(projection)`: `projection.body` を返すだけの薄いヘルパー（呼び出し側の可読性のため）。
  - `invertListMarkerProjection(projection, editedBody)`: 編集後の本文から元の生テキスト行を再構築する。`editedBody` に改行が含まれる場合のみ `ok: false`（理由 `"multiline-body"`）を返す — `single-line-list` の member は構造的に必ず1行であるため、本文編集が複数行になった時点で安全に1行へ戻せないと判断し拒否する。marker・marker 後の空白・indentation は常に元の値をそのまま再利用し、二重 marker が発生する余地はない。marker 後の空白が元々「空」だった場合のみ、本文が非空になった時点で半角スペース1つを新たに合成する（`reconstructQuoteHeader` の同種の規約と同じ考え方）。
- **`src/edit/compositeBlockMemberProjection.ts` への追加エクスポート** — `isListMemberEligibleForMarkerFreeProjection(kind: CompositeMemberKind): boolean`（`kind === "single-line-list"` の場合のみ `true`）。CompositeBlock の member 種別という「CompositeBlock を知っている」判断を、CompositeBlock を一切知らない `listMarkerProjection.ts` から意図的に分離するためのゲート関数であり、View 層のインライン三項演算子として埋め込まず、独立して単体テスト可能な形で `compositeBlockMemberProjection.ts` 側に置いた。
- **`src/view/PartialEditView.ts` の新規フィールド** — `listMarkerProjection: ListMarkerProjection | null`。`compositeListOriginalText` の「元テキスト」が生の list 行そのものか、marker 抜きの本文かを判別する情報を保持する。`isListMemberEligibleForMarkerFreeProjection` が `true` を返し、かつ `buildListMarkerProjection` が成功した場合にのみ非 `null` になり、それ以外は常に `null`（`compositeListOriginalText` は生の list 行のまま）。
- **`src/i18n.ts` の新規キー** — `partialEdit.listBodyNewlineUnsupported`（en/ja 両方）。marker-free な list 本文に改行を含められない、という**真の安全性エラー**専用の Notice であり、既存の `partialEdit.compositeRuleNoLongerMatches`（rule 不一致を知らせる、非拒否の通知）とは明確に別物として新設した。

## 3. structured projection が有効になる条件（必要条件の AND）

5D-2B の構造化 UI が有効な CompositeBlock セッション（§3 の条件を満たすセッション）において、さらに以下をすべて満たす場合にのみ、list member 入力欄が marker 抜きの本文表示になる。

1. `extracted.resolvedSnapshot.members[0].kind === "single-line-list"`（`isListMemberEligibleForMarkerFreeProjection` 経由で判定）。
2. list member の生テキスト行に対して `buildListMarkerProjection` が `ok: true` を返す — 具体的には、marker が `-`/`*`/`+` のいずれか（ordered marker `1.`/`1)` ではない）であり、marker 直後の本文が task-list チェックボックス（`[ ]`/`[x]`/任意1文字ステータス）から始まっていないこと。

## 4. raw fallback（member-local）となる条件

上記いずれか1つでも満たさない場合、list member 入力欄は 5D-2B 導入時点からの挙動そのまま — list 行の生テキスト（marker 込み）を1つの単一行入力欄にそのまま表示・編集する。**この fallback は list member 側だけの局所的なものであり、trailing callout/blockquote member の構造化 editor には一切影響しない** — 5D-2B の「セッション全体が raw textarea になる」フォールバックとは別の、より粒度の細かい fallback である。具体的な代表例:

- leading member が `single-line-list` ではなく `list`（複数行にまたがる、または入れ子の子リストを持つ list item）である場合 — この場合はそもそも `splitCompositeBlockMembers` 自体が既存の `"list-member-not-single-line"` 理由で拒否し、5D-2B の全体 raw fallback に落ちる（本チケットで新規に対応した範囲ではない）。
- marker が ordered（`1.`/`1)`）である場合。
- 本文が task-list チェックボックス（`- [ ] text`/`- [x] text`/`- [/] text` 等）から始まる場合。

これらのケースでも、5D-2B 自体の構造化 UI（trailing member の title/type/fold marker/本文編集）は完全に有効なまま動作する — list member の表示だけが marker 込みの生テキストへ後退する。

CompositeBlock を開くこと自体、または構造化セッションそのものを拒否することは一切ない。raw な list 入力欄という既存の安全な代替手段が常に存在するため、開けないという状況は発生しない。原文の推測修正・ベストエフォート保存は行わない。

## 5. Apply 時の契約 — 方針A は無変更、新設した唯一の拒否理由は「真の安全性エラー」のみ

本チケット着手時、当初の要求仕様には「編集後に同一 CompositeBlock rule へ再マッチする場合のみ保存し、再マッチしない場合は Apply を拒否する」という項目が含まれていたが、これは `edit/compositeBlockPartialEdit.ts` が既に持つ**方針A**（rule 不一致は Apply 拒否理由にならない、という意図的な既存設計）を見落とした誤った指示であることが利用者との確認により判明し、明示的に撤回された。以下は、その確認を経て確定した唯一の仕様である。

1. **Markdown 構造の妥当性**（Apply を拒否しうる、真の安全性チェック）:
   - marker-free 投影が有効な list member について、`invertListMarkerProjection` が編集後の本文から元の marker・marker 後の空白・indentation を安全に復元できること。改行を含む本文編集は `"multiline-body"` として拒否され、`partialEdit.listBodyNewlineUnsupported` の Notice を出して Apply 全体を中断する（list member・trailing member いずれの draft も保持されたまま）。
   - trailing callout/blockquote member は、5D-2B から無変更の既存フロー（`invertQuotePrefixProjection` → 必要なら `reconstructQuoteHeader` → 独立した `parseDocument`/`scanComplexBlocks` による再検証）に従う。ここでの失敗も同様に Apply 全体を拒否する。
   - 生成された合成後テキストが、対象 CompositeBlock の range 外を書き換えることは `composeCompositeBlockMemberText`（無変更）の性質上そもそも発生しない。
   - stale snapshot（他の変更との衝突）・CompositeBlock の anchor/range 解決失敗は、`applyCompositeBlockEdit` 自身の既存チェック（無変更）がそのまま担う。
2. **CompositeBlock grouping の存続**（Apply の拒否理由には**しない**、既存の非拒否フロー）:
   - 上記1をすべて通過した場合、marker-free 投影の有無にかかわらず `applyCompositeBlockEdit` を必ず1回呼び出し、Apply は成功する。
   - 呼び出し結果の `ruleStillMatches` が `true`（同一 rule に再マッチ）であれば、引き続き CompositeBlock として Tree に投影される。
   - `ruleStillMatches` が `false`（再マッチしない）であっても Apply は成功する。既存の `compositeRuleNoLongerMatches` 通知がそのまま表示され、次回の解析結果に従って各 block が個別に表示される。list と trailing callout/blockquote の raw Markdown を勝手に再結合・修復・強制再グループ化することは一切ない。draft は Apply 成功後の通常どおり更新され、rule 不一致だけを理由に draft を編集状態のまま保持することはない。
   - marker-free 投影によって list marker を画面上隠していることが、利用者が意図して grouping を解消する編集（例: list item を実質的に別内容へ書き換え、以後は独立した list と callout として扱いたい編集）を妨げることは一切ない。

Apply 直前の実際の処理順序（`view/PartialEditView.ts#applyEdit` の compositeAnchor 分岐）は次のとおりで、既存の trailing member 処理・`applyCompositeBlockEdit` 呼び出しの前後関係を一切変更していない。

```
trailing member: invertQuotePrefixProjection → (titleSlot があれば) reconstructQuoteHeader
                 → 独立した parseDocument/scanComplexBlocks による再検証
list member:     (listMarkerProjection が非null なら) invertListMarkerProjection
                 → 失敗時は Notice を出して return false（applyCompositeBlockEdit は一度も呼ばれない）
composeCompositeBlockMemberText(listLine, trailingText)
applyCompositeBlockEdit(...)  // 既存・無変更。ここで初めて方針A自体の判定が行われる
  → outcome.ruleStillMatches === false のときだけ compositeRuleNoLongerMatches 通知
  → それ以外は compositeUpdated 通知
Apply 成功後: buildQuotePrefixProjection と buildListMarkerProjection の両方を、
             合成済みの2ピースから re-projection（再パースではない）。
             outcome.ruleStillMatches / outcome.resolvedSnapshot は一切参照しない
             — rule 不一致後も次回編集のための marker-free 投影は正しく再構築される。
```

## 6. CompositeBlock の境界・不変条件（無変更）

- `image-ocr`/`image-quote` の rule id、member 種別列・空行なし隣接・同一セクション・重複禁止・優先順位の各条件はいずれも変更していない。
- CompositeBlock の move・drag & drop・mobile drag handle・delete・Tree 投影・group indicator はいずれも無変更（既存実装のまま）。
- 単独（CompositeBlock に属さない）list の Partial Edit UI は**一切変更していない** — 引き続き marker 込みの生テキストをそのまま編集する、既存のままの挙動である。marker-free 投影は今回、CompositeBlock の leading `single-line-list` member にのみ先行適用したものであり、単独 list への同種の UI 改善は、将来の **Phase 5L-1** として別途取り組む対象であり、本チケットの範囲外として明示的に据え置く。

## 7. 受入基準（Acceptance Criteria）

- [x] CompositeBlock の leading member が `single-line-list` かつ marker が `-`/`*`/`+` のいずれかであれば、list member 入力欄は marker を含まない本文のみを表示する。
- [x] 本文のみを編集して Apply すると、marker・marker 後の空白・indentation は元のまま復元され、byte-for-byte で正しい raw Markdown が書き戻される。
- [x] list 本文の編集と、trailing callout/blockquote の title/type/fold marker/本文の編集を同一 Apply で atomic に保存できる。
- [x] 編集後も同一 CompositeBlock rule に再マッチする場合、Apply は成功し CompositeBlock 表示が維持される。
- [x] 編集後に rule へ再マッチしなくなる場合も Apply は成功し（方針A、無変更）、既存の `compositeRuleNoLongerMatches` 通知が表示され、次回解析で CompositeBlock 投影が自然に解消される。
- [x] rule 不一致後も、list marker projection の復元結果・callout/blockquote の prefix-free 編集結果（type・fold marker・title・本文）は正しく Markdown に書き戻される。
- [x] stale snapshot・anchor 解決失敗・list marker 投影の反転失敗（本文への改行混入）・trailing member の構造検証失敗など、真の安全性エラーでは Apply が拒否され、全 draft（list 本文・trailing member）が保持される。
- [x] ordered marker・task-list marker の list item は list member 側のみ raw fallback（生テキスト表示）となり、trailing member の構造化 editor は影響を受けない。
- [x] 複数行にまたがる list item・入れ子子リストを持つ list item は、既存の `splitCompositeBlockMembers` の `"list-member-not-single-line"` 判定により、5D-2B からの全体 raw fallback へそのまま委ねられる（本チケットでの新規対応範囲外）。
- [x] member 間の空行なし隣接が Apply 後も維持される。
- [x] 単独 list Partial Edit の UI・保存結果は一切変化しない。
- [x] 単独 callout/blockquote Partial Edit、5D-2B の CompositeBlock Structured Partial Edit（trailing member editor 全体）、CompositeBlock の move/drag & drop/mobile handle/delete/grouping rule のいずれにも回帰がない。
- [x] 冗長な「リスト項目」「コールアウト」「引用」見出しは追加していない（既存のパネルタイトル・行 prefix で自明、2026-09-14 の UI 簡略化フォローアップの方針を維持）。
- [x] 全テスト・`tsc --noEmit`・`npm run lint`・`npm run build` が成功する（§9 参照）。

## 8. 今回のチケットの対象外（今後の残存候補）

- 単独（CompositeBlock に属さない）list Partial Edit の marker-free UI 化 — **Phase 5L-1** として別途検討する。
- task list（`- [ ]`/`- [x]` 等）の marker-free 投影対応。
- ordered list（`1.`/`1)`）の marker-free 投影対応。
- 複数行にまたがる list item・入れ子子リストを持つ list item への marker-free 投影対応（これらは既存どおり 5D-2B の全体 raw fallback のまま）。
- CompositeBlock の member 追加・削除・並べ替え、`list + callout` ↔ `list + blockquote` の相互変換、nested 構造対応 — いずれも 5D-2B から引き続き対象外のまま。
- 常時表示の「編集後に構造条件が変わると拡張ブロック表示が解除される」旨の補助説明 UI — 既存の `compositeRuleNoLongerMatches` 通知で説明として十分と判断し、今回は追加していない（冗長な常時表示を避けるという利用者自身の許容方針に基づく判断）。

## 9. 実行した検証コマンドと結果

```
npx tsc -noEmit -skipLibCheck   # エラーなし
npm test -- --run               # 112 ファイル / 2152 件、全通過
npm run lint                    # 0 エラー（settings.ts の既存無関係 warning 3件のみ）
npm run build                   # 成功（main.js 生成を確認）
```

新規追加したテストファイル: `tests/listMarkerProjection.test.ts`（`listMarkerProjection.ts` 単体、22件）、`tests/listMarkerCompositePartialEdit.test.ts`（実際の parse→scan→match→snapshot→extract→split→projection→apply パイプライン全体を、View をモックせず実関数のみで通す統合テスト、22件 — marker 変種ごとの投影成功、本文のみ編集の byte-for-byte 復元、list+title/list+type・fold marker・本文/list+blockquote本文の同時 Apply、rule 再マッチ確認、no-blank-line 不変条件、member-local raw fallback（複数行/入れ子/task-list/ordered marker）、方針A 無変更の確認（raw fallback list 行を list 以外の行へ編集しても Apply は成功する）、真の安全性エラー3種の拒否）。既存ファイルへの追加: `tests/compositeBlockMemberProjection.test.ts`（`isListMemberEligibleForMarkerFreeProjection` の3件を追加）、`tests/compositeBlockPartialEditUiWiring.test.ts`（`loadCompositeInternal`/`performAutoReload`/`applyEdit` の marker-free 投影ゲート・反転・rebuild ロジック、Cancel の list/trailing 両 draft 復元、単独 list Partial Edit が本チケットの変更の影響を一切受けないことの確認を追加）。

## 10. 実機検証用の最小 Markdown fixture

以下のいずれのノートでも、Outline Tree 上の CompositeBlock 行を右クリック →「拡張ブロックを Partial Edit で開く」で開き、想定どおり list member 入力欄が marker 抜きの本文のみを表示することを確認する。

### fixture A: `- ` marker + callout（marker-free 投影が有効になる想定）

```markdown
- ![[scan-001.png]]
> [!ocr]+ OCR結果
> ここに認識されたテキストが入る。
```

期待結果: list member 入力欄には `![[scan-001.png]]`（先頭の `- ` を含まない）が表示される。本文を編集して Apply すると、`- ` が正しく復元されたうえで保存される。

### fixture B: `+ ` marker + blockquote（marker-free 投影が有効になる想定）

```markdown
+ 史料項目
> 引用された原文テキストをここに書く。
```

期待結果: list member 入力欄には `史料項目`（先頭の `+ ` を含まない）が表示される。

### fixture C: task list（list member のみ raw fallback になる想定）

```markdown
- [ ] ![[scan-004.png]]
> [!note] メモ
> 本文。
```

期待結果: list member 入力欄には `- [ ] ![[scan-004.png]]`（marker・チェックボックスを含む生テキスト）がそのまま表示される。trailing member（callout）側の title/type/fold marker/本文編集は通常どおり構造化 UI で行える。

### fixture D: 意図的な grouping 解消編集（方針Aにより Apply は成功する想定）

fixture A を開いた状態で、list member 入力欄の本文を空行のみ、あるいは list marker の対象ではなくなるような内容へ編集して Apply する。期待結果: Apply は成功し（Notice に「この編集後の内容は CompositeBlock の規則に一致しません。各 block は個別に表示されます。」と表示される）、次回の Tree 再描画で list と callout が個別の block として表示される。
