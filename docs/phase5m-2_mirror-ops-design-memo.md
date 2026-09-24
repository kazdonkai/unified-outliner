# Phase 5M-2: ミラー行に対する操作 — 設計メモ

## 1. スコープ

Phase 5M-1 で作成できるようになったミラー行（同一ノート内の埋め込み行 `![[#…]]`）を、Outline Tree から操作できるようにした。

| 機能 | 入口 | 実装 |
| --- | --- | --- |
| Delete mirror | ミラー行の右クリック（iPad は長押し） | `mirror/mirrorOps.ts#deleteMirror` → 既存の `deleteStandaloneComplexBlock` |
| Move mirror up／down | 同上 | `mirror/mirrorOps.ts#moveMirror` → 既存の `moveStandaloneComplexBlock` |
| 参照ミラー数の表示と巡回ジャンプ | Partial Edit Pane 最下部のリンク行 | `mirror/mirrorOps.ts#mirrorReferencesForTarget`・`nextMirrorJumpIndex`、`view/PartialEditView.ts` |

ミラー行が Tree に出るのは、設定「Show mirror embeds in Outline Tree」がオンのときだけである。オフのとき、埋め込み行は従来どおり段落行として表示され、段落用のメニューがそのまま使える（この挙動は変えていない）。

## 2. 既存パイプラインの再利用

指示どおり、ミラー固有の移動ロジック・削除ロジックは書いていない。代わりに、standalone の callout／blockquote 用の Move と Delete を、**ミラーの埋め込み行という 1 つの形に限って** 受け入れるように広げた。

- 判定には `mirror/isMirrorEmbedBlock.ts` の述語を 1 つ用いる。対象は「supported・1 行・リスト項目に属さない段落で、同一ノート内への埋め込みとして解析できるもの」であり、Phase 5M-0 の `scanMirrorEmbeds` がミラーとして認識する形とまったく同じである。
- **Move**
  - `parser/compositeBlocks.ts#evaluateStandaloneComplexBlockMovability` の種別判定に、この述語による受け入れを加えた。隣接ブロックの判定、同一セクション限定、CompositeBlock メンバーを巻き込まないことは、既存コードがそのまま担う。
  - `edit/moveStandaloneComplexBlock.ts` のスナップショット種別に `"paragraph"` を加え、`buildMirrorEmbedMoveSnapshot` を新設した。既存の `buildStandaloneComplexBlockSnapshot` は段落を受け付けないままなので、既存の Move メニューと D&D の挙動は変わらない。
  - Tree のクリック時の処理は、既存の `dispatchAndApplyStandaloneComplexBlockMove` をそのまま呼ぶ。
- **Delete**
  - `edit/deleteStandaloneComplexBlock.ts` のスナップショット種別に `"paragraph"` を加え、`buildMirrorEmbedDeleteSnapshot` を新設した。削除の実行時には、段落スナップショットについて「今もミラーの埋め込み行であること」を再検証する。通常の段落のスナップショットを作って渡しても `not-supported` で拒否される（テストで確認した）。
  - 前後の空行は、既存の `normalizeBlankRunAtBoundary`（3 行以上の空行を 2 行にする）をそのまま使う。
  - 確認ダイアログは、fenced-code・table・callout・blockquote と同じ `ConfirmFencedCodeDeleteModal` を再利用した。種別が段落のときは「ミラーを削除」という題と「参照先とそのブロック ID は変更しない」旨の一文を表示する。

## 3. 「削除は参照先を一切変更しない」の保証

1. スナップショットの範囲は埋め込み行 1 行だけであり、既存の削除処理はその範囲しか取り除かない。
2. それに加えて、`deleteMirror` は結果を独立に検証する（`onlyEmbedLineRemoved`）。条件は「元の本文から埋め込み行を取り除き、空行がいくつか減っただけであること。埋め込み行以外の空でない行は、1 バイトも変わらず同じ順で残っていること」である。満たさなければ、全体を拒否して本文を変更しない。したがって、見出し・本文・自動付与した `^uo-…`（行末でも単独行でも）が削除で失われることは、下層の処理が将来変わっても起こらない。
3. Create mirror で入れた空行は、削除後もそのまま残る（2 行以下の空行の並びは正規化しない。callout の削除と同じ規則である）。

## 4. 移動の範囲

- 同一セクション内の隣接ブロック（段落・callout・blockquote・fenced-code・table・ミラー・リスト項目）との入れ替えだけを行う。
- セクションの先頭・末尾では、上・下への移動は unavailable と表示される（クリックすると既存の理由文を Notice で出す）。
- D&D によるミラー行の移動は、今回は対応しない。ミラー行は読み取り専用行のままであり、ドラッグの配線は付けていない。

## 5. Partial Edit Pane の参照ミラー表示

- ペインの最下部に、次のリンク行を表示する（ミラーが 0 件のときは表示しない）。
  - 日本語 UI：「このブロックを参照しているミラー: N 件」
  - 英語 UI：「Mirrors referencing this block: N」
- 数えるのは、参照先が解決済みで、その先頭行がペインで編集中のブロックの先頭行と一致するミラーである。参照先が見つからないミラーと循環しているミラーは数えない。編集中のブロックの先頭行は、見出し・リスト項目・callout などではペインの nodeId から、段落では親と本文テキストから求める。本文テキストが一意に見つからない場合は推測せず、行を表示しない。CompositeBlock はミラーの参照先にならないため、行を出さない。
- リンクをクリックすると、元ノートのエディタのカーソルを最初のミラー行へ移し、スクロールする。以後はクリックのたびに次のミラーへ移り、最後の次は最初に戻る。
- 次の場合に、この行を更新する。
  - ペインにブロックを読み込んだとき。
  - 元ノートの `editor-change` と `vault modify` のたびに（200ms のデバウンスをかける）。
- **表示専用である。** 更新処理とジャンプ処理が触れるのは、この行の要素と、行番号の一覧・巡回位置だけである。下書きのテキストエリア、dirty 判定、originalText、同期状態、Apply／Cancel には一切触れない（静的チェックで確認している）。既存の stale-check とも独立しており、その判定結果にも影響しない。

## 6. 引き続き行えない操作

以下の制限は Phase 5M-0／5M-1 から変わっていない。

- ミラー行のリネーム（読み取り専用のまま）
- ミラー行の D&D（ドラッグの配線はない）
- ミラー行そのものを Partial Edit で開くこと（メニューに項目がない）と、参照先への編集転送
- Copy block・Duplicate below・Paste block（ミラー行のメニューには含めていない）

## 7. 既存テストへの影響

- `tests/phase5m0MirrorFoundation.test.ts` の静的チェックを 1 件だけ書き換えた。元の内容は「ミラー行にはコンテキストメニューを付けない」だったが、Phase 5M-2 の仕様変更（Move／Delete メニューの追加）に合わせ、「ドラッグ・リネーム・Partial Edit の配線がないこと」を確かめる内容に改めた。メニューに含まれる項目は、新しいテストで別途固定している。
- それ以外の既存テストは変更せずに通過した。

## 8. テスト

`tests/phase5m2MirrorOps.test.ts`（47 件）の内訳は次のとおりである。

- Delete 12 件：埋め込み行だけの削除、参照先の見出しと本文の保存、行末 ID と単独 ID 行の保存、Create との往復、空行の正規化の有無、他のミラーの保存、古いスナップショットの拒否、通常の段落と偽装したスナップショットの拒否、不変条件の検証関数、既存の削除処理の回帰、1 回の Undo。
- Move 11 件：段落・callout・ミラー・リスト項目との入れ替え、セクション境界での上・下の不可、メニュー表示時の判定と実行結果の一致、通常の段落が依然として対象外であること、既存 Move の回帰、CompositeBlock メンバーを巻き込まないこと。
- 判定述語 5 件。
- 参照ミラー表示 12 件：セクション、ブロック ID、循環と未解決の除外、0 件、nodeId 経由、段落経由、一意に特定できない場合、CompositeBlock、リスト項目、本文変更への追従、巡回ジャンプ、表示文の日英。
- 配線の静的チェック 7 件。
