# Fix: Outline Tree の paragraph 行に mobile 用のドラッグハンドルを追加する

日付: 2026-09-24
ブランチ: `fix/paragraph-mobile-drag-handle`（`main` から分岐）

## 1. 背景

ユーザーが実機 iPad で Outline Tree の standalone paragraph 行の D&D を試したところ、
段落行だけがまったく移動できないという報告があった。同様の症状は、少し前の同じ
セッション内で標準の callout/blockquote/table/fenced-code 行に対してすでに一度
発見・修正済みであり（コミット `e7bb8e5` "fix(mobile): enable D&D for standalone
callout/blockquote/table rows on mobile"）、今回はその修正が及んでいなかった
paragraph 行固有の別チケットとして対応する。

## 2. 原因（`src/view/OutlineTreeView.ts`, `renderNode`）

1. **`dragHandleEl`（六点グリップハンドル）が段落行に対してそもそも生成されない。**
   ハンドル生成条件（UXP-01, 約1580行台）は
   `if (!readOnly || isComposite || isEligibleStandaloneComplexMember) {`
   だったが、段落行（`isOutlineParagraphNode(node)`）は Phase 5T-2 の設計により
   常に `readOnlyNodeIds` に含まれ（`readOnly === true`）、`isComposite` でも
   `isEligibleStandaloneComplexMember`（callout/blockquote/table/fenced-code の
   standalone complex-member のみ）でもないため、この条件に一切マッチせず
   `dragHandleEl` は常に `null` のままだった。

2. **段落専用の D&D 配線ブランチが `!Platform.isMobile` でデスクトップ限定に
   なっていた。** 同ファイル内、`else if (isOutlineParagraphNode(node) &&
   !Platform.isMobile)` という分岐（Phase 5T-2 由来）に、当時の意図的な
   スコープ制限（「初期版はデスクトップ限定とし、モバイル・タッチ・長押し
   D&D は実装しない」）が明記されていた。同じ分岐のコメントには
   「dragHandleEl is created only for `!readOnly` rows ... and since this is
   desktop-only, the row itself (`selfEl`) is the drag source」ともあり、
   当時は段落行が常にデスクトップ限定である前提でハンドルを一切使わない
   設計だった。

いずれも、`e7bb8e5` が callout/blockquote/table に対して修正したのと構造的に
まったく同じ問題であり、同じ UXP-01 パターン（モバイルでは `dragHandleEl` のみ
`draggable`、デスクトップでは行全体 `selfEl` が `draggable`）を段落行にも
適用すればよい。

## 3. `e7bb8e5` との対応関係

| 項目 | `e7bb8e5`（callout/blockquote/table） | 本チケット（paragraph） |
| --- | --- | --- |
| ハンドル生成条件の widening | `isEligibleStandaloneComplexMember` を追加 | `isParagraph` を追加（別の独立した OR 項として） |
| D&D 配線ブランチの mobile 除外解除 | 標準ブリッジ分岐の `&& !Platform.isMobile` を削除 | 段落専用分岐 (`else if (isOutlineParagraphNode(node) && !Platform.isMobile)`) の `&& !Platform.isMobile` を削除 |
| draggable 属性の分岐 | `if (Platform.isMobile) dragHandleEl?.setAttribute(...) else selfEl.setAttribute(...)` | 同一パターンをそのまま適用 |
| dragover/drop/dragend | 変更不要（既に platform-agnostic） | 変更不要（既に platform-agnostic） |
| CSS | 変更不要 | 変更不要 |

## 4. 変更方針

`e7bb8e5` がすでに確立した UXP-01 パターンを、段落行に対してそのまま再利用する。
新規ロジック・新規パイプラインは書かず、既存の許可リスト（ハンドル生成条件の
OR 項）を拡張するのみ。

1. `dragHandleEl` の生成条件に `isParagraph`（既存のローカル変数、
   Phase 5T-1 由来）を独立した OR 項として追加。
   `isEligibleStandaloneComplexMember` 自体には含めない
   （その名前が約束する callout/blockquote/table/fenced-code のみの
   allow-list を汚さないため、`isComposite` が独立した項であるのと同じ
   理由）。

2. 段落専用の D&D 配線ブランチ (`else if (isOutlineParagraphNode(node))`,
   `&& !Platform.isMobile` を削除) の中で、
   `if (Platform.isMobile) { dragHandleEl?.setAttribute("draggable", "true"); }
   else { selfEl.setAttribute("draggable", "true"); }` という分岐を追加。
   `dragstart`/`dragover`/`dragleave`/`drop`/`dragend` の5つのリスナーは
   一切変更なし（既に platform-agnostic）。

3. 既存の pointerdown ベースのダブルクリック検出
   (`handleRowPointerDownForDoubleClick` 経由、`isEligibleRowBodyPointerDown`
   内部でハンドル起点のタッチを除外)は、`dragHandleEl` パラメータを汎用的に
   受け取る既存の仕組みであり、段落行の `dragHandleEl` が非 null になっても
   コード変更は不要 —— ハンドル起点のタッチが正しく除外されるようになる
   だけ（挙動として改善こそすれ、退行はない）。

4. mobile 用の長押しコンテキストメニュー配線（`!readOnly && Platform.isMobile`
   ブロック）は、段落行が常に `readOnly` であるため元々アタッチされない
   —— 今回のハンドル追加はこの点に影響しない。

## 5. 変更したファイル

- `src/view/OutlineTreeView.ts`
  - `dragHandleEl` 生成条件: `isParagraph` を追加。
  - 段落専用 D&D 配線ブランチ: `!Platform.isMobile` を削除し、
    mobile/desktop の draggable 分岐を追加。
  - 既存ドキュメントコメント（Phase 5T-2 の「デスクトップ限定」記述、
    「No dragHandleEl involvement at all」記述）は削除せず、
    日付付き addendum として今回の変更を追記。
  - 段落行の pointerdown ダブルクリック検出のコメント（「dragHandleEl is
    always null here」）にも addendum を追記。

- `tests/paragraphOutlineTreeUiWiring.test.ts`
  - `paragraphDragBranch()` ヘルパーの start landmark を更新し、
    render/context-menu チェーン内の同名の別ブランチと衝突しないよう
    disambiguate。
  - 「desktop only」だったテストを「mobile も許可」に更新。
  - 「dragHandleEl を一切参照しない」テストを「参照する（かつ
    CompositeBlock 固有ロジックは一切参照しない）」に更新。
  - 新規テスト2件: mobile/desktop draggable 分岐の確認、
    `dragHandleEl` 生成条件が `isParagraph` を含むことの確認。

- `tests/paragraphPartialEditLaunchUiWiring.test.ts`
  - `dragHandleEl` 生成条件の landmark 文字列・doc comment・アサーションを
    3項→4項（`isParagraph` 追加後）に更新。
  - `paragraphDragBranchBody()` ヘルパーの start landmark を同様に
    disambiguate。
  - 「dragHandleEl を一切参照しない」テストを更新。

- `tests/standaloneComplexBlockDropUiWiring.test.ts`
  - `dragHandleEl` 生成条件の literal string を4項に更新。

- `tests/OutlineTreeView.mobileCompositeDragHandle.test.ts`
  - 同上、条件 literal を更新し、「paragraph 行はハンドルを持たない」という
    古い前提を除去。

- `tests/OutlineTreeView.compositeDrag.test.ts`
  - 同上、条件 literal・テスト名を更新。

- `tests/compositeBlockGroupIndicatorUiWiring.test.ts`
  - 同上、条件 literal を更新。

- `CHANGELOG.md`
  - `## [Unreleased]` の `### Fixed` に新規エントリを追加。

- `docs/fix_paragraph-mobile-drag-handle-design-memo.md`（本ファイル）
  - 新規作成。

## 6. 追加したテストケース一覧

`tests/paragraphOutlineTreeUiWiring.test.ts`（Phase 5T-2 describe block 内）:

- 段落行 (`isOutlineParagraphNode(node)`) のみが D&D 配線ブランチのガードで
  あり、`!Platform.isMobile` を含まないこと（コードのみ、コメント除く）。
- 段落 D&D ブランチが `dragHandleEl` を実際のコードで参照すること
  （CompositeBlock 固有ロジックは参照しないこと）。
- 段落 D&D ブランチが mobile では `dragHandleEl`、desktop では `selfEl` に
  `draggable="true"` を設定する分岐を持つこと。
- `dragHandleEl` の生成条件が
  `if (!readOnly || isComposite || isEligibleStandaloneComplexMember ||
  isParagraph) {` であること。

`tests/paragraphPartialEditLaunchUiWiring.test.ts`:

- `dragHandleEl` 生成条件が `isComposite`/`isEligibleStandaloneComplexMember`/
  `isParagraph` の3項すべてを含み、それ以外（`isComplexMember`単体・
  `isSection`）は含まないこと。
- 段落 D&D ブランチが `dragHandleEl` を参照すること（CompositeBlock 固有
  ロジックは含まないこと）。

`tests/standaloneComplexBlockDropUiWiring.test.ts` /
`tests/OutlineTreeView.mobileCompositeDragHandle.test.ts` /
`tests/OutlineTreeView.compositeDrag.test.ts` /
`tests/compositeBlockGroupIndicatorUiWiring.test.ts`:

- 既存の `dragHandleEl` 生成条件アサーションを、`isParagraph` を含む新条件に
  更新（landmark 文字列の追随のみ、新規の振る舞い検証は上記
  paragraphOutlineTreeUiWiring.test.ts / paragraphPartialEditLaunchUiWiring.test.ts
  に集約）。

全件、`npx vitest run` で 158 ファイル / 3285 件が成功することを確認済み。

## 7. 既知の制約

- mobile での長押しコンテキストメニュー（`showParagraphMoveMenu` 相当の
  タッチ版）は段落行に対して元々実装されていない（`!readOnly &&
  Platform.isMobile` ブロックは段落行が常に readOnly であるため
  アタッチされない）。これは本チケットのスコープ外であり、今回の変更でも
  変わらない。
- fenced-code の standalone 行は本チケットと無関係（既に `e7bb8e5` +
  fenced-code D&D parity フォローアップで対応済み）。
- 本チケットは UI 配線（`dragHandleEl` 生成条件・draggable 属性分岐）のみの
  変更であり、`handleParagraphDragStart`/`handleParagraphDragOver`/
  `handleParagraphDrop` 自体、および安全性検証ロジック
  (`resolveParagraphDropDirection` 等) には一切手を入れていない。
- 実機（iPad）での動作確認は未実施。ユーザー自身による実機確認が必要。

