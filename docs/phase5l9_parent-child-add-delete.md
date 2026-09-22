# Phase 5L-9: Direct Child Add/Delete in Parent Partial Edit Pane

## 1. 位置づけ — Phase 5L-6/5L-7/5L-8 との責務分離

Phase 5L-6（既存・無変更）は親 list item の own-text を構造化編集できるようにし、Phase 5L-7（既存・無変更）は子プレビューを読み取り専用ナビゲーション入口へ拡張し、Phase 5L-8（既存・無変更）は直接の子のうちちょうど1件をパネル内でインライン構造編集できるようにした。しかしどのフェーズでも、子リスト自体の構成（何個の子が存在するか）を変えることはできなかった——追加も削除も、常に別のパネル（子項目自身を単独で開き直す、あるいはOutline Tree側の操作）を経由する必要があった。

Phase 5L-9 は、この「子リストの構成そのもの」を、親のPartial Edit Paneから離れることなく変更できるようにする。具体的には、(a) 親の直接の子リストの**末尾**に、新しい直接の子リーフ項目を1件追加する、(b) 既存の直接の子リーフ項目のうちちょうど1件を削除対象としてマークする、の2操作を新設し、どちらも親のown-text編集・Phase 5L-8の既存子インライン編集と**同じApply**で同時に保存できるようにする。

Phase 5L-6/5L-7/5L-8 が確立した own-text range/child-subtree range の分離、navigation target identity、既存4リーフ投影の再利用、`invertAndValidate*`→再パース検証→現在の実文書への原子的適用という3段階の設計は、Phase 5L-9でも一切変更していない。Phase 5L-9が新設したのは、「新規の子1件の追加候補」と「削除対象1件のマーク」という、既存の2スロット（親own-text／選択中の子1件）に加わる、独立した2つの新スロットのみである。

## 2. スコープ: Mode A（既存の子を1件以上持つ親）のみ — Mode B（子を持たない項目への初回追加）は「Phase 5L-9b」として分離したバックログ項目

このチケットで実装したのは、**パネルを開いた時点ですでに `childIds.length > 0` である親**への追加・削除（以下 Mode A）のみであり、これを Phase 5L-9 の完了スコープとして確定する。子を持たない leaf 項目（Phase 5L-6以前の単独編集画面が開くケース）に「＋」ボタンで初めての子を追加する操作（以下 Mode B）は、「Phase 5L-9b」として明確に分離されたバックログ項目に位置づけ、現時点で着手時期は未定である。現在の実装はこの未対応状態を安全側にフォールバックする形にしてある——子を持たない親を Partial Edit Pane で開いても、子リスト構成を変更する「＋」ボタン自体が存在しない（`parentChildAddButtonEl` を含む child preview セクション全体が、`standaloneParentListItemProjection` が非nullの場合にのみ描画されるため、Mode Bの状態では最初から描画されない）。

理由は、Mode Bを支えるには次のいずれかが必要になるためである。

- `resolveParentListItemOwnTextRange`／`standaloneParentListItemProjection` 自体のeligibilityゲートを「子を持たない安全なleaf」にも広げる——しかし既存4つの単独リーフ投影（`standaloneListMarkerProjection.ts`等）は、`loadNodeInternal`の優先度チェーンにおいて、子を持たないleafを常に**先に**claimする設計になっている。このゲートを広げても、実際には既存の優先度チェーンにより4投影のいずれかが先にヒットしてしまい、事実上到達不能な分岐になる。
- あるいは、4つの単独リーフのApply呼び出し箇所（それぞれ独立したApply経路）すべてに、この新設の combined-apply 認識を重複して配線する——Phase 5L-6/5L-7/5L-8で既に実機検証済みの4経路それぞれに手を入れることになり、このチケット単体のリスクとしては見合わない。

「子を持たない親」というシナリオ自体は、Mode A の中でも到達する——親が唯一の子を持っている状態でその1件を削除保留にしてApplyすると、Apply後は`childIds.length === 0`になる。この場合、`applyParentChildAddDeleteCombinedEdit`の post-Apply rebuild は`stillEligible`判定で`childIds.length > 0`を確認しており、falseになった時点で`standaloneParentListItemProjection`を`null`に戻す——子プレビュー自体が消え、Phase 5L-6以前の単独編集画面表示に静かに戻る（§7参照）。「一度も子を持ったことのないleafへの初回追加」だけが、このチケットの対象外として残っている。

## 3. 追加（Add）— 挿入位置・インデント・正規シリアライズ

### 3.1 挿入位置: 常に「直接の子リストの末尾」固定

新しい子は、常に親の直接の子の**末尾**（既存の最後の直接の子の直後）に挿入される。任意位置への挿入・特定の子の前後への挿入は対象外。`buildNewChildDraft(doc, parentNode)`は`parentNode.childIds`の最後のidから`lastChildNode`を求め、`computeNewChildIndent`へ渡す。

### 3.2 インデント: 最後の直接の子と同じインデントを踏襲

`computeNewChildIndent(doc, parentNode, lastChildNode)`は、既存の直接の子が1件以上あれば、その**最後の子**の行の`leadingWhitespace`をそのままコピーする（tabs/spacesのスタイルも含めてバイト単位で一致）。最初の子や他の兄弟からは推測しない——挿入位置の直前にある最後の子の実際のインデントのみを信用する。既存の子が（防御的にしか到達しないが）ゼロ件の場合のみ、親自身の行のインデント + TAB_WIDTH分（親のタブ/スペーススタイルを踏襲）をフォールバックとして使う。

### 3.3 正規シリアライズ: `indent + "-"` の裸のマーカー、空本文を優先

新しい子の初期テキストは`buildCanonicalNewChildRawText(indent)`が返す`indent + "-"`——マーカーの直後に空白すら付けない、完全に空の裸のマーカーである。理由はチケット自身が求める「安全にプレースホルダーなしで済むなら空を優先する」判断であり、実際にこの形は`parser/parseDocument.ts`のLIST_RE上、マーカー以降がすべて省略可能なため単体で正しくパース可能で、かつ`edit/listMarkerProjection.ts`の`invertListMarkerProjection`は「markerSpacingが空、かつeditedBodyも空のまま」の場合にスペースを合成しない実装になっている（この関数自体は無変更のまま再利用）ため、未編集のままApplyしてもバイト単位でラウンドトリップする。プレースホルダー文字列は本チケットのどこにも一切使っていない。

新しい子は常に`kind: "unordered"`固定——task/ordered/複数行のいずれにもならない。既存の兄弟や親自身がtask/orderedであっても影響しない。これは`NewChildDraft`型自身の構造的な制約であり（`buildChildLeafProjection`は常に`buildListMarkerProjection`側のunordered投影を返す一本道）、UI側でkindを選択する余地は設けていない。

### 3.4 二重追加の防止

`ParentChildAddDeleteSession#newChildDraft`は最大1件——`handleRequestAddChild`は既に`newChildDraft`がある間は早期リターンする防御的no-opであり、実際には「＋」ボタン自体を`renderParentChildPreview`が`disabled`にして、ツールチップで理由を示す。

## 4. 削除（Delete）— 対象範囲・確認・保留表示

### 4.1 削除可能な対象: Phase 5L-8の編集可能性と完全に同一の5条件

`evaluateChildDeleteEligibility`は`evaluateChildInlineEditEligibility`の**別名（エイリアス関数）**であり、新しい判定ロジックは一切実装していない——直接の子であること・leafであること（孫を持たない）・4つの既存投影のいずれかで安全に構築できること、という Phase 5L-8 の編集可能性と全く同じ5条件を満たした行にのみ、ゴミ箱アイコンの削除アフォーダンスが表示される。孫を持つ子・続き行に複雑ブロック（コールアウト等）を含む子は、鉛筆アイコンと同様にゴミ箱アイコンも表示されない。

### 4.2 確認: 本文の有無に関わらず常にModal確認

削除は、対象の本文が空かどうかに関わらず、必ず専用の`ChildDeleteConfirmModal`（「削除する」/「キャンセル」の2択）を経由する。既存の`DiscardChangesModal`（3択・未保存変更ガード）とは意図的に別クラスとして新設した——このModalは未保存変更の有無を問わず常に発火する確認であり、「Applyして」という選択肢が存在しないため、`DiscardChangesModal`の語彙（apply/discard/cancel）を流用すると誤解を招くと判断したためである。Escape・外側クリックなど確認ボタン以外でのdismissは、`DiscardChangesModal`と同じ「常に非確定（cancel相当）」の契約に揃えている。

### 4.3 保留表示: 対象行の完全な非対話化

`handleRequestDeleteChild`の確認コールバックが呼ばれると、`commitPendingDeletion`が対象を**もう一度**フレッシュに`evaluateChildDeleteEligibility`で再検証したうえで`pendingDeletion = { childNodeId, childIndex }`をマークする。`renderParentChildPreview`は、対象行の`eligibleChildId`が現在の`pendingDeletion.childNodeId`と一致する行を`isPendingDeletionRow`として扱い、この判定はナビゲーション・鉛筆アイコン・ゴミ箱アイコンいずれの配線よりも前に行われる——結果として、保留中の行にはこれら3つの対話要素が一切付かず、専用のCSSクラスと「適用時に削除される」ツールチップのみが付く、完全に読み取り専用の行になる。

もし削除対象がPhase 5L-8の既存子インライン編集で開かれていた場合、`commitPendingDeletion`は削除マークの直前に`this.childInlineSession = null`でそのインラインエディタを閉じる——削除される予定の子の未保存編集を残留させたままにはしない。

## 5. セッションモデル: 「独立した3スロット」

`ParentChildAddDeleteSession`は、Phase 5L-8の`ParentChildInlineEditSession`（既存・無変更）とは別の、独立した新しい型である。

| スロット | 型・フィールド | 同時に開けるか |
|---|---|---|
| 親own-text | 既存（Phase 5L-6） | 常時1つ |
| 既存の子1件のインライン編集 | `childInlineSession: ParentChildInlineEditSession \| null`（Phase 5L-8・無変更） | 最大1件 |
| 新規の子の追加下書き | `childAddDeleteSession.newChildDraft: NewChildDraft \| null` | 最大1件 |
| 削除保留マーク | `childAddDeleteSession.pendingDeletion: PendingChildDeletion \| null` | 最大1件 |

4つは互いに独立に組み合わせ可能である（構造的に唯一禁止されるのは、削除保留と既存子インライン編集が**同じ子**を同時に対象にすることのみ——§4.3の通り、削除確定がインライン編集を先に閉じるため、Apply時点でこの組み合わせは決して起こらない）。DOM側も、既存子用の`childInlineEditorEl`と新規子用の`newChildEditorEl`を完全に別パネルとして`onOpen`で構築しており、両方が同時に表示された状態が正しく成立する。

## 6. Apply — 4スロットすべてを1回の原子的操作で保存

`applyEdit()`は、`hasAddDeleteActivity()`（`newChildDraft`または`pendingDeletion`のいずれかが**存在する**ことのみを見る——追加下書きの本文が未編集（キャノニカルな空のまま）でもtrueになる。これは「未編集のままApplyしても構わない」という§3.3の契約上、追加下書きの**存在**そのものがApplyすべき変更だからである。この判定はPhase 5L-8由来の`childInlineSession`単独分岐より**前**にチェックされ、`applyParentChildAddDeleteCombinedEdit(doc, editor)`へ分岐する。

1. **dirty判定**: 親own-text・既存子インライン編集・追加下書きの3つを独立に判定し、削除保留の有無と合わせて、4つのうち最低1つが「実際に書くべきもの」であることを確認する。
2. **invert + validate（`invertAndValidateParentChildAddDeleteEdit`）**: 各スロットをそれぞれのORIGINALスナップショットから再構成したうえで、親の`childSubtreeText`スナップショット上で（1）既存子の編集内容の差し替え、（2）削除対象の除去、（3）新規子の末尾への追記、を後ろから前へオフセット安全に一括適用し、結果全体を**1つの使い捨てミニドキュメント**として再パースして検証する。子の個数が期待通りか（削除で-1、追加で+1）、削除されなかった各兄弟のテキストがバイト単位で不変か、編集された既存子・新規子がいずれも依然としてleafであるか、をすべてチェックする。
3. **現在の実文書への適用（`applyParentChildAddDeleteToDocument`）**: 親range・既存子range（あれば）・削除対象range（あれば）・新規子の挿入点（あれば）のそれぞれを現在の実文書に対してフレッシュに再解決し、dirtyな範囲のみをconflict再チェックしたうえで（削除は常に「書く」範囲として扱われるため常にconflictチェックされる）、すべての差分を**1つの`lines`配列**として構築し、`applyLineEditOutcome`を**1回だけ**呼ぶ。

新規子の挿入は、`childSubtreeRange.endLine + 1`を`startLine`、`childSubtreeRange.endLine`を`endLine`とする**幅ゼロのspan**として、他のspan（親・既存子・削除対象）と一緒に`startLine`降順ソートしてから後ろから前へ適用する——既存子・削除対象のrangeは`childSubtreeRange`の内側にしか存在し得ない（range-overlapチェックで保証済み）ため、挿入spanのstartLineは常に他のどのspanのstartLineより大きく、ソート順によらず衝突しない。

いずれかの段階（invert/validate、live-apply）で失敗すれば、対応するreasonキーを翻訳したNoticeを表示してリターンし、ノート・4スロットのいずれの状態も一切変更しない。

## 7. isDirty()/cancelEdit()/Apply後の再構築

`isDirty()`は、既存の`childInlineDirty`（Phase 5L-8）に続けて`addDeleteDirty = hasAddDeleteActivity()`をORで追加しただけである——追加下書きが未編集でも、削除保留があるだけでも、パネル全体がdirty扱いになる。

`cancelEdit()`は、既存子インライン編集の値をリバートする処理（既存・無変更）とは別に、`newChildDraft`と`pendingDeletion`の両方を**存在ごと**`null`に戻す——既存子の場合と違い、こちらは値のリバートではなく、パネル・保留マーク自体の取り消しである（§4.3のパネルが閉じ、保留行が通常表示に戻る）。

Apply成功後は、保存済みの文書を再パースし、`standaloneParentListItemProjection`を再構築したうえで（§2の通り子が0件になっていれば`null`に戻る）、`childAddDeleteSession`を`buildParentChildAddDeleteSession`で**ゼロから作り直す**——追加下書き・削除保留はこの再構築によって自動的にクリアされる（成功したApplyこそが、それらを「確定」させる操作そのものであるため）。既存子インライン編集セッションが開いていた場合は、削除された子自身を対象にしていたのでなければ、同じ子に対して`buildParentChildInlineEditSession`を再度呼び、成功すれば開いたまま維持する。

## 8. 変更・追加したファイル

- `src/edit/parentChildInlineEditSession.ts`（既存・拡張、893→1707行）: 同じモジュールにPhase 5L-9セクションを追加。`computeNewChildIndent`／`buildCanonicalNewChildRawText`／`NewChildDraft`／`buildNewChildDraft`（追加下書きの構築）、`evaluateChildDeleteEligibility`（`evaluateChildInlineEditEligibility`のエイリアス）、`ChildSubtreeSlot`／`PendingChildDeletion`／`ParentChildAddDeleteSession`／`buildParentChildAddDeleteSession`（セッション構築）、`invertAndValidateParentChildAddDeleteEdit`（invert+再パース検証）、`applyParentChildAddDeleteToDocument`（現在の実文書への可変長原子的適用）。Phase 5L-8の既存エクスポートは一切変更していない。
- `src/view/PartialEditView.ts`（既存・拡張、5313→6046行）: `childAddDeleteSession`フィールド、追加ボタン・新規子パネル用のDOMフィールド群と`onOpen`での構築、`renderParentChildPreview`への追加ボタン状態管理・削除ボタン配線・`isPendingDeletionRow`判定の追加、新規`renderNewChildEditor`／`isNewChildDraftDirty`／`hasAddDeleteActivity`／`handleRequestAddChild`／`handleStopNewChildDraft`／`handleRequestDeleteChild`／`commitPendingDeletion`／`applyParentChildAddDeleteCombinedEdit`、`applyEdit`・`cancelEdit`・`isDirty`・3箇所の load/reset メソッドへの統合、末尾に`ChildDeleteConfirmModal`クラスを新設。
- `src/i18n.ts`（既存・拡張）: `partialEdit.parentChildAddButtonLabel`等13キーをen/ja両辞書に追加。
- `styles.css`（既存・拡張）: `.unified-outliner-partial-edit-parent-child-preview-label`をflex行に変更、`.unified-outliner-partial-edit-parent-child-add-button`／`-delete-button`／`-preview-row-pending-deletion`を新設。新規子パネル（`.unified-outliner-partial-edit-new-child-editor`）は既存の子インラインエディタの基底クラスをそのまま継承するため、追加のoverrideルールは不要だった。
- `tests/parentChildAddDelete.test.ts`（新規、28件）: 実`parseDocument`を使った純粋関数の単体テスト。
- `tests/parentChildAddDeleteUiWiring.test.ts`（新規、27件）: View配線の静的ソース確認。
- `tests/compositeBlockPartialEditUiWiring.test.ts`（既存・更新）: textarea数のアサーションを2→3に更新（新規子パネル用textareaの正当な増加を反映）。
- `tests/parentChildInlineEditUiWiring.test.ts`（既存・更新）: 鉛筆アイコン配線の条件文字列に`&& !isPendingDeletionRow`が付いたことへの追従、`isDirty()`のOR連鎖末尾が`addDeleteDirty`になったことへの追従。
- `tests/parentChildPreviewNavigationUiWiring.test.ts`（既存・更新）: ナビゲーション配線の条件文字列に`&& !isPendingDeletionRow`が付いたことへの追従（3箇所）。
- `tests/partialEditStalePaneSyncUiWiring.test.ts`（既存・更新）: `DiscardChangesModal`呼び出し箇所数（7→8）／`syncState = "synced"`出現数（10→11）の期待値を、本チケットが正当に追加した箇所数を反映して更新。
- `docs/統合実装ロードマップ_2026-08-05.md`（既存・更新）: フェーズ状況テーブル・新規§3.22・§5関連ドキュメント一覧。
- `CHANGELOG.md`（既存・更新）: `### Added`に新規箇条書きを追加。
- `docs/phase5l9_parent-child-add-delete.md`（新規、本ファイル）。
- `/Users/kazumikaizuka/Obsidian/ipad-test/Test/parent-child-add-delete-verification.md`（新規、実機検証用fixture——プロジェクトメモリ`unified-outliner-verification-fixture-placement-policy.md`の既存方針通り、リポジトリ内やその他vaultへの複製は行っていない）。

変更していないファイル（意図的、確認済み）: `src/edit/parentListItemProjection.ts`・`src/edit/standaloneParentListItemProjection.ts`・`src/edit/listMarkerProjection.ts`・`src/edit/taskListProjection.ts`・`src/edit/orderedListProjection.ts`・`src/edit/multiLineListItemProjection.ts`・4つの単独リーフ投影一式・`src/edit/quotePrefixProjection.ts`・`src/edit/compositeBlockPartialEdit.ts`・`src/edit/partialEdit.ts`・`src/model/block.ts`——Phase 5L-8の`ParentChildInlineEditSession`関連のエクスポートも含め、いずれも完全に無変更のまま再利用のみ。

## 9. 将来候補（今回のスコープ外）

- **Mode B（Phase 5L-9b、着手時期未定）**: 子を持たないleaf項目への初回の子追加（§2で詳述した理由により今回は意図的に先送りし、独立したバックログ項目として分離した）。将来実装する場合は、(a) 既存4つの単独リーフ投影それぞれのApply経路にcombined-apply認識を個別に配線するか、(b) `standaloneParentListItemProjection`側のeligibilityゲート自体をより広く再設計するか、いずれかの判断が必要になる。いずれもPhase 5L-6/5L-7/5L-8で実機検証済みの既存経路そのものへの変更を伴うため、Phase 5L-9のような複合チケットの一部としてではなく、単独の小規模フェーズとして慎重に設計・実装・実機検証を計画すべきである。
- 任意位置への挿入（先頭・特定の子の前後）——今回は常に末尾固定。
- 複数の子の同時追加・同時削除——今回は追加下書き1件・削除保留1件が上限。
- 孫以下・CompositeBlock子メンバーへの追加/削除。
- move/drag/indent/outdent系の操作全般。
- 削除された子のtask/ordered種別に応じた採番の自動調整。
- 追加する子のkind（task/ordered/複数行）をユーザーが選択できるようにすること——今回は常にunordered固定。
