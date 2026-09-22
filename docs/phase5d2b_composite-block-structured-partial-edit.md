# Phase 5D-2B: CompositeBlock Structured Partial Edit Projection

対象リポジトリ: `unified-outliner-public`
関連: `docs/統合実装ロードマップ_2026-08-05.md` §3.12（本ドキュメントの実装確定事項の正）

## 1. 位置づけ — 5D-2A と 5D-2B の責務分離

| | Phase 5D-2A（既存・無変更） | Phase 5D-2B（本チケット） |
| --- | --- | --- |
| 何を保存基盤とするか | CompositeBlock 全体を1つの raw Markdown range として extract/apply する atomic backend（`edit/compositeBlockPartialEdit.ts`） | 5D-2A をそのまま再利用。新しい保存経路・新しい range 解決・新しい conflict 判定は一切追加しない |
| 何を編集面とするか | raw Markdown 一枚の textarea のみ | list member 専用の単一行入力欄 ＋ trailing callout/blockquote member 専用の既存 structured editor（title/type/fold marker/本文分離、prefix-free） |
| Apply/Cancel/conflict の単位 | CompositeBlock 全体で1組 | CompositeBlock 全体で1組（変更なし） |
| 対応できない構造への振る舞い | 常に raw textarea（他に選択肢がない） | 構造化表示・編集を試み、失敗時のみ 5D-2A の raw textarea へフォールバック |

5D-2A は本チケット開始前から `main` に実装済みであり、一切変更していない。5D-2B は 5D-2A の `newText` 引数の組み立て元を「1つの raw テキストの直接編集」から「2つの既存構造化エディタの合成」へ差し替えるだけであり、`applyCompositeBlockEdit` 自体の呼び出し契約・conflict 判定・range replacement ロジックには一切触れていない。

## 2. 再利用したコンポーネントと新規追加したコンポーネント

### 2.1 完全に無変更のまま再利用した既存コンポーネント

- `src/edit/compositeBlockPartialEdit.ts`（`extractCompositeBlockText`/`applyCompositeBlockEdit`）— 5D-2A の atomic 保存基盤そのもの。
- `src/edit/quotePrefixProjection.ts`（`buildQuotePrefixProjection`/`invertQuotePrefixProjection`/`reconstructQuoteHeader`/`projectedDisplayText`）— Phase 5D-0.5〜5D-1C で実装済みの、単独 callout/blockquote 用 prefix-free structured editor の投影・復元ロジック。
- `src/view/PartialEditView.ts` の既存 DOM 要素 `quoteHeaderEl`/`quoteTitleInputEl`/`quoteTypeInputEl`/`quoteMarkerSelectEl`/`textareaEl`、および `renderQuoteHeader()` — trailing callout/blockquote member の編集面としてそのまま流用した。新しい textarea・新しいヘッダー UI は一切作っていない（`createEl("textarea"` がファイル全体で1回しか呼ばれていないことをテストで固定している）。
- `src/model/compositeBlock.ts`・`src/parser/compositeBlocks.ts`・`src/edit/deleteCompositeBlock.ts`（`CompositeBlockSnapshot`/`buildCompositeBlockSnapshot`）— CompositeBlock の認識規則・grouping 条件・snapshot 構造。いずれも無変更。

### 2.2 新規追加したコンポーネント

- `src/edit/compositeBlockMemberProjection.ts`（新規ファイル）
  - `splitCompositeBlockMembers(lines, snapshot)`: CompositeBlockSnapshot が既に持つ各 member の解決済み range に対する純粋な line-slicing のみで、list member の生テキスト行と trailing member の生テキストを分離する。新しい境界検出・パースは一切行わない。
  - `composeCompositeBlockMemberText(listLineText, trailingRawText)`: 上記の厳密な逆関数。改行1つのみで再結合する。
  - 対応できる形は現行の全 `CompositeBlockRule`（`image-ocr`/`image-quote`）が生成する形（`single-line-list` の list member 1つ＋ callout/blockquote member 1つの、ちょうど2 member）のみ。それ以外は `ok: false` で拒否する。
- `src/view/PartialEditView.ts` の新規フィールド／メソッド
  - `compositeListOriginalText: string | null` — 構造化セッションの list member 側 "編集前" スナップショット。
  - `compositeListRowEl`/`compositeListInputEl` — 新規 DOM 要素（list member 専用の単一行入力欄とその行）。当初は `compositeListLabelEl`/`compositeTrailingLabelEl` という読み取り専用ラベル要素も追加したが、2026-09-14 の実機フォローアップで撤去した — 詳細は §12。
  - `renderCompositeListSlot()` — 新規 DOM 要素の表示/非表示・内容を一括制御する。
- `src/view/OutlineTreeView.ts` の変更（新規コード自体は最小）— `showComplexMemberMenu` から Partial Edit 系メニュー項目2つを撤去。
- `styles.css` の新規クラス2個（`.unified-outliner-partial-edit-composite-list-row`/`-composite-list-input`）、`src/i18n.ts` の新規キーは無し（当初追加した `partialEdit.compositeListLabel` は §12 のフォローアップで撤去）。

## 3. structured editor が有効になる条件（必要条件の AND）

CompositeBlock を開いた際、以下をすべて満たす場合にのみ構造化 UI（list member 入力欄 + 既存 callout/blockquote structured editor）を表示する。

1. `extractCompositeBlockText` が CompositeBlock を正常に解決できている（`extracted.ok && extracted.resolvedSnapshot`）。
2. `splitCompositeBlockMembers` が `ok: true` を返す — 具体的には member がちょうど2つ、先頭が `single-line-list`（1行の list item）、末尾が `callout` または `blockquote` であること。
3. 分離された trailing member の生テキストに対して `buildQuotePrefixProjection` が `ok: true` を返す — 具体的には、単独ブロックとして開いた場合と同じ基準で「nested な入れ子引用ではない」かつ「header-only ではない（本文がある）」こと。

## 4. raw fallback となる条件

上記いずれか1つでも満たさない場合は、Phase 5D-2A 導入時点からの挙動そのまま — CompositeBlock 全体 range の raw Markdown を1枚の textarea に表示し、Apply 時もその内容をそのまま `applyCompositeBlockEdit` へ渡す。具体的な代表例:

- CompositeBlockRule が将来 member 3つ以上、または list 以外の先頭 member を持つ形に拡張された場合。
- list member 自体が（将来的に）複数行にまたがる場合。
- trailing member が nested callout/blockquote（マーカーのない入れ子引用）である場合。
- trailing member が header のみで本文を持たない callout である場合。

CompositeBlock を開くこと自体を拒否することは一切ない（単独ブロックの "nested" 拒否とは異なる方針）。raw textarea という既存の安全な代替手段が常に存在するため、開けないという状況は発生しない。原文の推測修正・ベストエフォート保存は行わない。

## 5. atomic Apply / conflict 契約（5D-2A から不変）

1. CompositeBlock 全体の original snapshot を `applyCompositeBlockEdit` が既存方式で検証する（変更なし）。
2. conflict または anchor 解決失敗の場合、CompositeBlock 全体を保存しない（変更なし）。
3. 構造化セッションでは、Apply 直前に以下を行ってから `applyCompositeBlockEdit` を1回だけ呼び出す。
   a. trailing member の編集後テキストを `invertQuotePrefixProjection`（既存・無変更）で raw Markdown へ復元する。
   b. titleSlot がある場合は `reconstructQuoteHeader`（既存・無変更）で header 行を type/fold marker/title の現在値から再構築する。
   c. 復元した trailing member の raw テキスト単体を、独立した `parseDocument`/`scanComplexBlocks` で再検証し、元の `quoteProjection.kind` と同じ構造として `editability === "supported"` であることを確認する（不成立なら Apply を拒否し、入力内容は保持したまま Notice を出す）。
   d. list member の入力値と、検証済みの trailing member raw テキストを `composeCompositeBlockMemberText` で1つに合成する。
4. 合成後の1つの文字列を `applyCompositeBlockEdit` の `newText` に渡し、CompositeBlock 全体 range を1回だけ置換する（変更なし）。
5. 成功後、`outcome.resolvedSnapshot` から `compositeAnchor` を再アンカーし、構造化状態（`quoteProjection`/`compositeListOriginalText`）を合成済みの2ピースから再構築する（再パースではなく、既知のピースからの直接再構築）。
6. list member だけ、または trailing member だけを保存する経路は存在しない — 合成は常に Apply 実行の直前、1回だけ行われる。

## 6. CompositeBlock の境界・不変条件（無変更）

- `image-ocr`/`image-quote` の rule id、`compositeBlocks.imageOcr`/`.imageQuote` の設定キー、member 種別列・空行なし隣接・同一セクション・重複禁止・優先順位の各条件はいずれも変更していない。
- CompositeBlock の move・drag & drop・mobile drag handle・delete・Tree 投影・group indicator はいずれも無変更（既存実装のまま）。

## 7. 受入基準（Acceptance Criteria）

- [x] 対応可能な `list + callout`/`list + blockquote` で CompositeBlock を開くと、構造化 UI（list member 入力欄 + 既存 callout/blockquote structured editor）が表示される。
- [x] CompositeBlock 内で callout の type・fold marker・title・本文を、単独 callout と同じ UI・同じ validation で編集できる。
- [x] CompositeBlock 内で blockquote の本文を、単独 blockquote と同じ prefix-free UI で編集できる。
- [x] list member と trailing member を同一セッションで編集できる。
- [x] Apply・Cancel・dirty state・snapshot conflict は CompositeBlock 全体で1組に統合されている。
- [x] Apply は CompositeBlock 全体 range に対する1回の atomic replacement である。
- [x] `list + callout`/`list + blockquote` の空行なし隣接が Apply 後も維持される（`composeCompositeBlockMemberText` が改行1つのみで結合するため、構造的に保証される）。
- [x] `QuotePrefixProjection`・callout header 編集・5D-2A の atomic edit を複製せず再利用している。
- [x] type/fold marker を読み取り専用に後退させていない（単独ブロックと同じ editable UI をそのまま流用）。
- [x] 対応不能な構造では既存の raw CompositeBlock Partial Edit へ安全にフォールバックする。
- [x] 全テスト（110ファイル / 2097件、2026-09-14 の実機回帰修正3件を含む）・`tsc --noEmit`・`npm run lint`（既存無関係warning 3件のみ）・`npm run build` が成功する。
- [x] ロードマップと CHANGELOG を現行実装状態に同期済み。

## 8. 今回のチケットの対象外（今後の残存候補）

以下はいずれも本チケットでは実装しておらず、既存実装のまま変更していない。将来の別チケットの検討候補として明示する。

- CompositeBlock の move・drag & drop・indent/outdent（既存実装のまま、本チケットでは無変更）。
- CompositeBlock member の追加・削除・並べ替え。
- `list + callout` ↔ `list + blockquote` の相互変換。
- callout の type/fold marker を変更するための **新規** UI（本チケットは既存 UI の再利用のみを行い、新規 UI 自体は追加していない）。
- nested 構造（nested callout/blockquote、CompositeBlock 内部での更なる入れ子）への対応。

## 9. 実機確認用の最小 Markdown fixture

以下のいずれのノートでも、Outline Tree 上の CompositeBlock 行（list 行の直下に表示される拡張ブロック）を右クリック →「拡張ブロックを Partial Edit で開く」（`showCompositeCommandMenu` 由来）で開き、想定どおり構造化 UI が表示されることを確認する。

### fixture A: `list + callout`（構造化 UI が表示される想定）

```markdown
- ![[scan-001.png]]
> [!ocr]+ OCR結果
> ここに認識されたテキストが入る。
> 複数行でもよい。
```

期待結果: list member 用の単一行入力欄に `- ![[scan-001.png]]` が表示され、その下に既存の callout ヘッダー UI（type=`ocr`、fold marker=`+`、title=`OCR結果`）と `>` prefix なしの本文2行が表示される。list 行のテキストを編集し、callout の title・本文をそれぞれ編集したうえで Apply すると、1回の保存で両方の変更が反映され、`list + callout` の空行なし隣接構造が維持されていることを確認する。

### fixture B: `list + blockquote`（構造化 UI が表示される想定）

```markdown
- ![[scan-002.png]]
> 引用された原文テキストをここに書く。
```

期待結果: list member 入力欄に `- ![[scan-002.png]]` が表示され、その下に `>` prefix なしの引用本文が1行表示される（blockquote には title/type/fold marker の概念がないため、それらの UI は表示されない）。本文を複数行に増やして Apply すると、1回の保存で反映され、`>` prefix が正しく再付与されていることを確認する。

### fixture C: nested callout（raw fallback になる想定）

```markdown
- ![[scan-003.png]]
> [!note]
> > ネストされた引用（fold marker のない入れ子）
```

期待結果: 構造化 UI は表示されず、CompositeBlock 全体の raw Markdown が1枚の textarea に表示される（Phase 5D-2A 導入時点からの既存挙動のまま）。この textarea を直接編集して Apply しても、期待どおり保存できることを確認する。

## 10. 実機検証で発見・修正した回帰（2026-09-14）

`ipad-test` ボールトでの実機確認中、複合ブロックの構造化セッションを一度開いた後、一切編集せずに別ノードへ切り替えただけで「未保存の変更」ダイアログが誤って表示される回帰を発見した。

原因: `loadNodeInternal`/`loadParagraphInternal` は、`quoteProjection` を都度 `null` へ明示的にリセットしていた（既存のパターン、5D-0.5 由来）一方で、5D-2B で新設したフィールド `compositeListOriginalText` のリセットを欠いていた。`resetLoadedState()`（onClose/renderEmptyState 経由）・`loadCompositeInternal()`・`performAutoReload()` はいずれも正しくリセットしていたが、正常に解決する `loadNodeInternal`/`loadParagraphInternal` の成功パスはどちらも呼ばれない。結果として、直前に開いていた複合ブロックの list member 生テキストが `compositeListOriginalText` に残ったまま次のノード読み込みへ引き継がれ、`isDirty()` の `listDirty` 判定（`compositeListOriginalText !== null && compositeListInputEl.value !== compositeListOriginalText`）が、`renderCompositeListSlot()` によって空文字列にクリアされる `compositeListInputEl.value` との不一致により常に真を返していた。

修正: `loadNodeInternal`（`this.quoteProjection = quoteProjection;` の直後）と `loadParagraphInternal`（`this.quoteProjection = null;` の直後）の両方に `this.compositeListOriginalText = null;` を追加し、他の3箇所（`resetLoadedState`/`loadCompositeInternal`/`performAutoReload`）と同じリセット契約に揃えた。`tests/compositeBlockPartialEditUiWiring.test.ts` に回帰防止テストを3件追加（47件→50件）。

## 11. 実行した検証コマンドと結果

```
npx tsc --noEmit          # エラーなし
npx vitest run            # 110 ファイル / 2097 件、全通過
npm run lint               # 0 エラー（settings.ts の既存無関係 warning 3件のみ）
npm run build               # 成功（main.js 生成を確認）
```

`git status --short` により、意図した変更ファイル（`src/i18n.ts`・`src/view/OutlineTreeView.ts`・`src/view/PartialEditView.ts`・`styles.css`・`tests/compositeBlockPartialEditUiWiring.test.ts`・`CHANGELOG.md`・`docs/統合実装ロードマップ_2026-08-05.md` の変更、および `src/edit/compositeBlockMemberProjection.ts`・`tests/compositeBlockMemberProjection.test.ts`・本ドキュメントの新規追加）以外に diff がないことを確認済み。`parser/complexBlocks.ts`・`parser/compositeBlocks.ts`・`model/compositeBlock.ts`・`edit/compositeBlockPartialEdit.ts`・`edit/quotePrefixProjection.ts` はいずれも無変更。

## 12. 実機受入結果とUI簡略化フォローアップ（2026-09-14）

**実機受入結果**: `ipad-test` ボールトでのデスクトップ／モバイル両方の実機確認により、§10 の回帰（修正済み）を除いて Phase 5D-2B の実装に問題は見つからなかった。構造化 UI の表示条件・list member と trailing member の同時編集・Apply/Cancel/conflict の単一セッション性・raw fallback への切り替えは、いずれも実機で想定どおり機能することを確認済み。この結果を Phase 5D-2B の受入完了記録として本ドキュメントに残す。

**UI簡略化フォローアップ**: 実機確認の過程で、構造化 UI の list member 行に付く読み取り専用ラベル「List item」（`compositeListLabelEl`、`partialEdit.compositeListLabel`）と、trailing member（callout/blockquote）の editor 上部に付く読み取り専用ラベル「Callout」/「Quote」（`compositeTrailingLabelEl`）が、いずれも冗長であるとの指摘を受けた。パネル最上部のタイトル（例:「編集中(拡張ブロック): List + Callout」）が種別を既に明示しており、かつ各行自体の視覚的な prefix（list member 入力欄に verbatim で表示される `-` 等のリストマーカー、callout/blockquote editor 側の `■`/`»` 等の種別記号）だけで member の種類は一目で判別できるため、両ラベルとも表示上の情報を追加していなかった。

対応として、`compositeListLabelEl`/`compositeTrailingLabelEl` の両フィールドおよびそれらの生成コード・トグルコードを `src/view/PartialEditView.ts` から削除し、`styles.css` の対応する2クラス（`.unified-outliner-partial-edit-composite-member-label`/`-composite-trailing-label`）と、専らこのラベルのためだけに追加していた i18n キー `partialEdit.compositeListLabel`（en/ja 両方）を撤去した。`partialEdit.kindCallout`/`partialEdit.kindBlockquote` は他の既存箇所（`renderLoadedState` のパネルタイトル生成）でも使われているため無変更のまま維持した。list member 入力欄自体（`compositeListInputEl`）・trailing member の既存 structured editor（`quoteHeaderEl`/`quoteTitleInputEl`/`quoteTypeInputEl`/`quoteMarkerSelectEl`/`textareaEl`）・Apply/Cancel/dirty tracking/atomic 保存契約はいずれも無変更である。

`tests/compositeBlockPartialEditUiWiring.test.ts` の該当 describe ブロックを、ラベル不在を検証する内容へ書き換えた（正味のテスト件数は50件のまま）。`npx tsc --noEmit`（エラーなし）・`npx vitest run`（110ファイル / 2097件、全通過）・`npm run lint`（既存無関係warning 3件のみ）・`npm run build`（成功）をいずれも再確認済み。
