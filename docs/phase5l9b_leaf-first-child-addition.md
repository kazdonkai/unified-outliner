# Phase 5L-9b: First Direct Child Addition for Leaf List Items — Mode B

## 1. 位置づけ — Phase 5L-9 との責務分離

Phase 5L-9（既存・無変更）は、直接の子リストの末尾への新しい子の追加と、既存の直接の子1件の削除を新設した。しかし、その完了スコープは「パネルを開いた時点ですでに1件以上の直接の子を持つ親」（本ドキュメントでは Mode A と呼ぶ）のみに意図的に限定されており、子を持たない leaf 項目への初回の子追加（Mode B）は、着手時期未定の独立したバックログ項目として明確に分離されていた——既存4つの単独リーフ投影の eligibility チェーンとの優先度競合、あるいは4つの独立した Apply 経路すべてへの重複配線のいずれかが必要になり、Phase 5L-9 という一つのチケットの中で片手間に実装すべきリスクではないと判断されたためである（本統合ロードマップ §3.22）。

Phase 5L-9b は、この Mode B に着手する。既存4つの単独リーフ投影（`standaloneListMarkerProjection`/`standaloneTaskListProjection`/`standaloneOrderedListProjection`/`standaloneMultiLineListProjection`、いずれも無変更のまま再利用）のいずれかで安全に投影できる leaf 項目——孫を持たず、CompositeBlock member でもない項目——が、共有テキストエリア直下の新設「子項目を追加」ボタンから、パネルを離れることなく初めての直接の子を得られるようにする。

## 2. 設計原則: 既存4つの単独リーフ投影を一切 parent-ify しない

Phase 5L-9 の §9 で示されていた2つの設計案——(a) `standaloneParentListItemProjection` 側の eligibility ゲート自体を「子を持たない安全な leaf」にも広げる、(b) 4つの独立した単独リーフ投影それぞれの Apply 経路すべてに combined-apply 認識を重複配線する——のいずれも、既存4投影自身の priority/Apply/Cancel/conflict/auto-reload 契約に手を入れる必要があった。

Phase 5L-9b はこれらのいずれとも異なる、第3の設計を採用した:

- 既存4投影自身のコード（`edit/listMarkerProjection.ts`/`edit/taskListProjection.ts`/`edit/orderedListProjection.ts`/`edit/multiLineListItemProjection.ts`、4つの `standalone*Projection.ts`）はいずれも1バイトも変更しない。
- `loadNodeInternal` の既存5階層優先度チェーン（`standaloneListMarkerProjection` → `standaloneTaskListProjection` → `standaloneOrderedListProjection` → `standaloneMultiLineListProjection` → `standaloneParentListItemProjection`（`childIds.length > 0` の場合のみ））も一切変更しない。
- Mode B は「子項目を追加」ボタンを明示的に押すまでは何も変わらない、薄い UI 層の追加として実装する。ボタンを押した瞬間に初めて `pendingLeafFirstChild`（§3）という新設の独立したセッションが生まれ、既存4投影のうちどれが実際にアクティブかとは無関係に、その投影の own-text draft を「そのまま」保持し続ける。

## 3. eligibility（`evaluateLeafFirstChildEligibility`）

対象は、Phase 5L-8/5L-9 と同じ leaf 条件を満たす必要がある:

- list item であること（`leaf-not-found` — 見つからない、または list node でない）。
- `childIds.length === 0` であること（`leaf-has-children` — 既に直接の子を持つ場合。この場合は Mode A の既存「＋」ボタンが代わりに表示される）。
- CompositeBlock member でないこと。
- `unsafeIndent`（タブとスペースが混在した indentation）でないこと（`leaf-unsafe-indent`）。
- own-text の continuation 部分に ComplexBlock（callout/blockquote/fenced-code/table）を含まないこと（`leaf-complex-block`）。
- own-text range・挿入位置が安全に解決できること。
- 既存4つの単独リーフ投影のいずれかで実際に投影可能であること。

単一行 unordered/task/ordered、複数行（プレーンな continuation）、blank line を挟んだ continuation のいずれも対象になる——Phase 5L-1〜5L-5 が確立した既存4投影の対象範囲をそのまま踏襲する。

## 4. セッションモデル: `pendingLeafFirstChild` は `childAddDeleteSession` と完全に独立

`childAddDeleteSession`（Phase 5L-9 由来）は、「`standaloneParentListItemProjection` が非nullの間のみ非null」という既存の不変条件を持つ、Mode A 専用のフィールドである。Mode B のために、この不変条件を緩めたり、Mode A/Mode B を1つのセッション型に混在させたりすることは一切せず、`pendingLeafFirstChild: PendingLeafFirstChild | null` という完全に別のフィールドを新設した。このフィールドは、既存の不変条件とちょうど鏡合わせの不変条件を持つ——「まだ実の親 projection が無い間のみ非null」——ため、`pendingLeafFirstChild` と `childAddDeleteSession?.newChildDraft` は構造上決して同時に非nullにならない。

```
interface PendingLeafFirstChild {
  leafNodeId: string;
  draft: NewChildDraft; // Phase 5L-9 由来、無変更のまま再利用
}
```

この設計判断により、`childAddDeleteSession` 関連の既存ロジック（Mode A 自身の add/delete/reorder/indent/outdent のいずれも）は一切変更不要だった——Mode B は既存のセッション型を拡張するのではなく、隣に新しいセッションを追加しただけである。

## 5. 正規の初回子: 新しいインデント計算・新しいプレースホルダー規約を一切追加しない

追加される子は、Phase 5L-9 と全く同じく、常に unordered・非task・空本文の裸のマーカー（`indent + "-"`、プレースホルダーなし）である。

`buildPendingLeafFirstChild` は、Phase 5L-9 の既存 `buildNewChildDraft(doc, parentNode)` を、対象の leaf 自身を `parentNode` として渡すだけで呼び出す。この関数が内部で使う `computeNewChildIndent` は、Mode A 自身が「既存の子が皆無の親」という防御的なケースのために既に持っていたフォールバック分岐——「既存の最後の子が無い場合、親自身の字下げから1 TAB_WIDTH（4列）分だけ深くする」——を持っており、Mode B の「子が0件の leaf」はこの分岐にそのまま自然に該当する。このため、Mode B のために新しいインデント計算ロジックを1行も追加する必要がなかった。

## 6. Apply設計: `applySubtreeEdit` への委譲——Mode A の2-range設計は不要

Mode A（`applyParentChildAddDeleteToDocument`）は、親own-text range と child-subtree range という、独立した2つの range を同時に（必要な範囲だけを対象とした conflict 判定を経て）書き換える設計を持つ。これは、Mode A の対象が既に1件以上の子を持ち、own-text range と child-subtree range が構造的に分離しているためである。

Mode B の対象は、Apply の瞬間まで子を1件も持たない leaf であり、その `node.range` は自分自身の own-text しかカバーしない。この性質を利用し、`applyLeafFirstChildAdditionToDocument` は Phase 5L-8 由来の汎用 `applySubtreeEdit(doc, nodeId, originalOwnText, newOwnTextRawText)`（`edit/partialEdit.ts`、無変更のまま再利用）にそのまま委譲する——own-text（編集後、または未編集ならそのまま）と新しい子の実際の raw text を「1つの複数行文字列」として結合し渡すだけで、`applySubtreeEdit` 自身の fresh 再解決・snapshot 比較・1回だけの原子的 splice がそのまま機能する。Mode A の2-range書き込み設計を複製する必要は一切なかった。

**実機確認で発見・即日修正した不具合——新しい子の本文入力がApply後に失われる**: 実装当初、`applyLeafFirstChildAdditionToDocument` は常に `childProjectionRawText(pending.draft.projection)`（正規の、常に空本文の下書き）を新しい子のraw textとして使っており、新規子入力パネル（`newChildTextareaEl`）にユーザーが実際に入力した本文を一切読み取っていなかった——ユーザーがiPad実機で「新しい子項目を追加する」という本文を入力してApplyしたところ、ノート上には空の `-` だけが追加され、入力した本文が失われるという不具合として発見された。原因は、Mode A の `applyParentChildAddDeleteCombinedEdit`/`invertAndValidateParentChildAddDeleteEdit` が持つ `newChildDirty`/`editedNewChildBody` の扱い（`isNewChildDraftDirty()` で dirty 判定し、dirty な場合のみ `invertChildLeafProjection` で実際の入力値から raw text を再構成する）と同じ配線を、Mode B 側の `applyLeafFirstChildEdit`/`applyLeafFirstChildAdditionToDocument` に追加し忘れていたことによる。修正として、`applyLeafFirstChildAdditionToDocument` に `childBodyDirty: boolean`/`editedChildBody: string` の2引数を追加し、`applyLeafFirstChildEdit` から `this.isNewChildDraftDirty()`/`this.newChildTextareaEl.value` をそのまま渡すよう配線した——`NewChildDraft` は常に "unordered" kind であるため、Mode A と全く同じ `invertChildLeafProjection(pending.draft.projection, false, "", editedChildBody)` 呼び出しで、既存の `invertListMarkerProjection` にそのまま委譲される。改行を含む本文は、既存の `invertListMarkerProjection` の "multiline-body" 拒否がそのまま検出し、Mode A自身の `"new-child-unsafe-structure"` と全く同じ理由・全く同じ専用Notice文言（`partialEdit.parentChildNewChildStructureInvalid`、新規i18nキーの追加なし）で拒否する。

Apply の直前には、対象が依然として leaf であること（`childIds.length === 0`）を、呼び出し時点の `doc` 引数から改めて再検証する——`pending`（`buildPendingLeafFirstChild` が構築した時点のスナップショット）をそのまま信用しない。own-text の現在の実文書スナップショットが、パネルが読み込んだ時点のスナップショット（`originalOwnText`）と食い違う場合は `own-text-conflict` で拒否する。候補（own-text + 新しい子の結合テキスト）は使い捨てミニドキュメントとして再パースし、次のすべてを1件ずつ突き合わせてから初めて実文書へ書き込む:

- 親が同じ kind の親として存在すること。
- 新しい子が、直接の子であり、非task・unordered な leaf であること。
- マーカー・チェックボックス・番号・区切り文字・インデント・空行の契約が保たれていること。
- 他の兄弟・見出し・CompositeBlock・ComplexBlock のいずれも一切変化していないこと。

これらのいずれかに反する場合は `candidate-structure-invalid` で拒否し、文書・保留状態はいずれも完全に無変更のまま維持される。失敗する経路はすべて `ApplyLeafFirstChildRejectReason`（`evaluateLeafFirstChildEligibility` 由来の拒否理由に加え、`own-text-conflict`/`candidate-structure-invalid` の計2種を追加）のいずれかに集約され、`leafFirstChildApplyReasonKey` が既存の2つの汎用 Notice キー（`partialEdit.parentChildInlineEditConflict`/`partialEdit.parentChildInlineEditResolveFailed`）へ収斂させる——Phase 5L-11 の `parentChildIndentOutdentApplyReasonKey` と同じ、理由ごとに新しいキーを作らない既存の convention に従った。

## 7. Apply成功時のフルリロード: なぜ `loadNodeInternal` を直接呼ぶのか

Phase 5L-8/5L-9/5L-10/5L-11 までの全ての combined-Apply メソッドは、それぞれ「そのフェーズの編集が変更し得る field だけ」を手動で再構築する、狭いリビルドを行っていた——親 projection・セッション・`originalText` の一部だけを対象からフレッシュに再解決する。

Mode B の遷移は、これらのどれとも性質が異なる。対象は、Phase 5L-6 以前の4リーフ投影優先度チェーンの中で最も深い leaf tier（4つの `standalone*Projection` のいずれか）から、最も高い parent tier（5番目、`standaloneParentListItemProjection`）へと、5階層すべてを一度に横断する。この横断を手動で再現するには、`loadNodeInternal` 自身が持つ5階層の優先度解決ロジックをそっくり複製する必要があり、冗長かつ誤りやすい。

そのため、`applyLeafFirstChildEdit` は成功時に `this.loadNodeInternal(this.nodeId)` を直接呼び出す——既存の解決ロジックをタダで正しく再利用し、パネルは自動的に「今や実の親になった」対象を Mode A の子プレビュー・追加ボタンつきで再読み込みする。これは本チケット自身の §6 設計方針（「次回reloadで既存 parent projectionが自然にclaimする」）が最初から意図していた挙動である。

## 7.5 実機確認で発見・即日修正した不具合(2件目)——外部Undoで唯一の子が消えた後、パネルが古いParent状態のまま取り残される

Bug #1修正の実機再検証で、ユーザーは本文が正しく保存されることを確認したのち、続けて次の操作を試した——Applyでリーフに初めての子を追加した直後、その子を本文側（プラグイン自身のCancelボタンではなく、Obsidianのエディタ本体でのCtrl+Z/Cmd+Z）でundoする。すると、本文・Partial Edit Paneの共有テキストエリア自体は正しく「子なしリーフ」の状態に戻るにもかかわらず、(1) パネル上部のSubtree Navigator（既存の、本チケットでは無変更の`renderSubtreeNavigator`）が、undoで既に消えた子をあたかもまだ存在するかのように表示し続ける、(2) 本来なら再表示されるはずのMode Bの「＋」ボタン（`leafFirstChildAddRowEl`）が表示されない、という2つの不具合が発見された。

原因は、この外部Undoが辿る経路が`loadNodeInternal`（§7で述べた、このパネル自身のApply成功後に呼ばれるフルリロード）ではなく、`performAutoReload`（`performStaleCheck`/`evaluateAgainstText`経由で、このパネルの外で起きた変更を検知した際にのみ呼ばれる、既存の別のリロード経路）であったことにある。`performAutoReload`には2つの独立したギャップがあった。

第一に、breadcrumb・sibling nav・Subtree Navigatorという3つの表示が依存する`ancestors`/`directChildren`/`siblingState`フィールドは、いずれも「ロード時に一度だけ計算し、編集中は再計算しない」という既存の設計方針を持つ（各フィールド自身のdocコメント参照）。この方針は、このパネル自身が行う編集については正しい——`applyEdit`の成功後は`loadNodeInternal`が呼ばれ、この3フィールドもそこで正しく再計算されるためである。しかし、`performAutoReload`（外部変更によるリロード）は`loadNodeInternal`を経由しないにもかかわらず、この3フィールドを一切再計算しておらず、`renderBreadcrumb`/`renderSiblingNav`/`renderSubtreeNavigator`のいずれも呼び出していなかった——外部からこのノードの子・兄弟・祖先が変化しても、この3つの表示だけが更新されないまま取り残される、既存の潜在的なギャップであった。

第二に、`performAutoReload`内の4つの単独リーフ投影（`standaloneListMarkerProjection`等）の再構築ブロックは、「このリロード開始時点で4つのうち少なくとも1つが既にアクティブであった場合のみ再構築する」という条件で守られていた——これは、生の（raw-fallback）ままのパネルを、背景での自動リロードによって突然どれかの構造化投影へ昇格させてしまわないための、意図的な設計契約である(ブロック自身のdocコメントが明言している)。しかし、この条件は「親から、子ゼロ件のリーフへ戻る」という遷移を正しく扱えなかった——Undo直前のパネルは実の親（`standaloneParentListItemProjection`が非null）であり、4つのリーフ投影はいずれも最初からnullだったため、この条件を満たさず再構築ブロックがスキップされる。一方、`standaloneParentListItemProjection`自身を再検証する別ブロック(Phase 5L-9/5L-10で追加済み)は、`childIds.length > 0`でなくなったことを正しく検知し`null`へ戻す——ここまでは正しい。しかし4つのリーフ投影が依然としてすべてnullのままであるため、`renderLeafFirstChildAddRow`自身のeligibility（「親投影が無く、かつ4つのリーフ投影のいずれかが有効」）が満たされず、「＋」ボタンは非表示のままとなっていた。

修正は`performAutoReload`内の2箇所である。1つ目は、4つのリーフ投影再構築ブロックのゲート条件に`|| this.standaloneParentListItemProjection`を追加し、「直前まで実の親であった」場合もこの再構築を発火させるようにした——4つのeligibility判定関数（`isStandaloneListItemEligibleForMarkerFreeProjection`等）はいずれも既に`node.childIds.length === 0`を自身の必須条件として持つため、この変更によって子を依然として持つノードがリーフ投影を誤って獲得することは構造的に起こり得ず、親投影との排他性は保たれたままである。2つ目は、`loadNodeInternal`が使う`findAncestorPath`/`findDirectChildren`/`getSiblingNavigationState`という同じ3つの関数を使って`ancestors`/`directChildren`/`siblingState`を`performAutoReload`内でも新たに再計算し、`renderBreadcrumb`/`renderSiblingNav`/`renderSubtreeNavigator`を（`renderLoadedState`と同じ順序で）新たに呼び出すようにした。

この不具合はMode B固有のものではない——breadcrumb/sibling nav/Subtree Navigatorの陳腐化は、本チケット以前から存在する`performAutoReload`自身の一般的なギャップであり、外部変更によって祖先・兄弟・子のいずれかが変化する状況であれば理論上どこでも起こり得るものだった。今回はMode Bの新機能を実機検証した過程でたまたま発見・修正されたに過ぎない。widened gateの側は、Phase 5L-9/5L-10自身の不具合修正（`standaloneParentListItemProjection`/`childAddDeleteSession`の外部リロード時再構築）が親側でのみ対応していた「親⇄リーフの往復」のうち、リーフ側の鏡像を完成させるものである。

回帰テストは`tests/leafFirstChildAdditionUiWiring.test.ts`に3件追加した（`performAutoReload`はvitest内で`PartialEditView`を構築できないため、既存の`bodyOf()`静的ソース検証の慣例に従う）。ゲート条件の文字列が5-way構成に変わったことに伴い、この条件を逐語的に検証していた既存4件のUI配線テストファイル（`multiLineListPartialEditUiWiring.test.ts`・`orderedListPartialEditUiWiring.test.ts`・`taskListPartialEditUiWiring.test.ts`・`standaloneListMarkerFreePartialEditUiWiring.test.ts`)も、Phase 5L-1〜5L-4がこの条件へ新しいarmを追加するたびに繰り返してきた「re-pin」の慣例に従って更新した。

## 8. UI配線（`src/view/PartialEditView.ts`）

### 8.1 「子項目を追加」ボタン（`leafFirstChildAddRowEl`/`leafFirstChildAddButtonEl`）

共有テキストエリアの直下・`parentChildPreviewEl`（Mode A 自身の子プレビュー、実の親 projection が有る間のみ表示される）の直前に配置する。`renderLeafFirstChildAddRow` は、実の親 projection が無く、かつ4つの単独リーフ投影のいずれかが有効な間のみ表示する——両方が同時に表示されることは構造的に無い。保留中のドラフトが既にある間はボタンを非表示にせず無効化し、ツールチップで理由を説明する（Mode A 自身の「＋」ボタンと同じ「無効化であり非表示ではない」方針）。

### 8.2 新規子の入力用インラインエディタの共有

新規子入力パネル（`newChildEditorEl`/`newChildTextareaEl`/`newChildStopButtonEl`）は、`contentEl` 直下のトップレベル兄弟として構築されており（`parentChildPreviewEl` の内部にネストされていない）、Mode A 自身の子プレビューが非表示の間でも独立して表示できる。この発見により、`renderNewChildEditor`/`isNewChildDraftDirty` は `this.childAddDeleteSession?.newChildDraft ?? this.pendingLeafFirstChild?.draft`（前者を優先し、後者をフォールバックとする）という1行の追加だけで、Mode A/Mode B の両方に同じ DOM をそのまま再利用できた——新しい DOM を一切構築していない。「追加を取り消す」ボタン（`newChildStopButtonEl`）のクリックハンドラは、`pendingLeafFirstChild` の有無で `handleStopLeafFirstChildDraft`／`handleStopNewChildDraft` のいずれかへディスパッチする。

### 8.3 `handleRequestAddLeafFirstChild`: fresh再検証

`handleRequestAddChild`（Mode A）と同じ discipline に従い、現在の実文書を `parseDocument(view.editor.getValue())` で再パースし、`buildPendingLeafFirstChild` で改めて eligibility を再検証したうえで初めて `pendingLeafFirstChild` を設定する——ボタンの行レベルの eligibility スナップショットを信用しない。`DiscardChangesModal` は経由しない——何も破棄しない純粋な追加操作であるため（Mode A の `handleRequestAddChild` と同じ理由）。

### 8.4 `handleStopLeafFirstChildDraft`: Cancel this pending first child

`handleStopNewChildDraft`（Mode A）と対になる、完全に別のメソッドとして新設した。クリーン（未編集）な下書きは確認なしで即座に破棄する。ダーティな下書きは `DiscardChangesModal`（Apply/Discard/Cancel の3択）を経由し、破棄を選ぶとリーフを「プレーンな未昇格のリーフ編集状態」へ完全に戻す（`leafFirstChildAddButtonEl` を再表示・再有効化）。

実装当初、この新設メソッドを `handleStopNewChildDraft` 自身の先頭に分岐を追加する形で実装したところ、既存の静的ソーステキスト検証テスト（`tests/parentChildAddDeleteUiWiring.test.ts`）の一部が、`handleStopNewChildDraft` 本体内の `indexOf("new DiscardChangesModal(")` という部分文字列一致に依存しており、新設分岐の挿入によってその一致位置がずれて壊れることが判明した。修正として、`handleStopNewChildDraft` 自身は元のバイト単位で完全に無変更のまま維持し、`handleStopLeafFirstChildDraft` という完全に別のメソッドを新設し、共有ボタンのクリックハンドラ側でディスパッチする設計に修正した（§8.2 参照）。

### 8.5 `cancelEdit`・`isDirty`

`cancelEdit()` は、既存の `childAddDeleteSession` 関連の失効ブロックとは別の、独立した新設ブロックとして `pendingLeafFirstChild` をnullへ戻す——構造上互いに排他であるため、1つのブロックに統合する必要が無い。`isDirty()` は `leafFirstChildDirty = this.pendingLeafFirstChild !== null` を、既存の OR 連鎖の末尾（`addDeleteDirty ||`の直後）に追加した。

### 8.6 `applyEdit()`のディスパッチ順序と`applyLeafFirstChildEdit`

`applyEdit()` は `this.pendingLeafFirstChild` の分岐を、if/else-if チェーンの中で**最初に**チェックする——4つの単独リーフ投影それぞれの既存 Apply 分岐（`quoteProjection` 以下）のいずれも、新しい子の挿入方法を一切知らないため。

`applyLeafFirstChildEdit` は、現在アクティブな4つの単独リーフ投影のうちどれか1つに対応する既存の `invert*Projection` 関数（`invertListMarkerProjection`/`invertTaskListProjection`/`invertOrderedListProjection`/`invertMultiLineListItemProjection`）を、`applyEdit` 自身の4つの標準リーフ分岐と全く同じディスパッチで呼び出し、own-text の編集後テキストを得る（防御的な最終 `else` 分岐は、`pendingLeafFirstChild` が4投影のいずれか1つがアクティブな間しか設定されないという既存の保証により、実際には到達しない）。得られた own-text と `pendingLeafFirstChild` を `applyLeafFirstChildAdditionToDocument`（§6）へ渡し、成功すれば `applyLineEditOutcome` で書き込み、`pendingLeafFirstChild` を null に戻したうえで `loadNodeInternal`（§7）でフルリロードする。

## 9. 競合・Cancel・対象切り替え

- **Cancel**: パネル全体の Cancel（`cancelEdit()`）は、保留中の Mode B ドラフトを完全に破棄する（§8.5）。own-text の draft・新規子の下書きのいずれも、ノートには一切書き込まれない。
- **対象切り替え**: `isDirty()` が `leafFirstChildDirty` を含むよう拡張されたことで、既存の `requestLoadNode`/`DiscardChangesModal`（Apply/Discard/Cancel の安全な切り替え契約、×/Escape/外側クリックは「その場に留まり何も破棄しない」という既存契約を含む）は、Mode B の保留も他の未保存編集と全く同じに扱う——新しい分岐やUIは新設していない。
- **競合・Apply拒否**: own-text の外部競合（`own-text-conflict`）・候補の構造異常（`candidate-structure-invalid`）のいずれについても、ノート・パネルの状態（own-text の draft・保留中の新規子下書き）は一切変更されない——部分的な書き込みは構造的に起こり得ない。

## 10. fixture配置方針

実機検証用fixtureは、既存のプロジェクトメモリ方針（`unified-outliner-verification-fixture-placement-policy.md`）通り、`/Users/kazumikaizuka/Obsidian/ipad-test/Test/leaf-first-child-addition-verification.md` にのみ配置し、リポジトリ内やその他vaultへの複製は行っていない。実際のパーサ（`parseDocument`）でこの fixture の構造を検証済みであり、子なしリーフA〜Jはいずれも `childIds.length === 0`、ordered 項目C/Hは `ordered: true` で正しく解析され、既存の子を持つ親Kは `childIds.length === 1` のまま維持されることを確認している。

## 11. 変更・追加したファイル

- `src/edit/parentChildInlineEditSession.ts`（既存・拡張）: 同じモジュールにPhase 5L-9bセクションを追加。`LeafFirstChildEligibilityReason`/`LeafFirstChildEligibilityResult`/`evaluateLeafFirstChildEligibility`、`PendingLeafFirstChild`/`BuildPendingLeafFirstChildReason`/`BuildPendingLeafFirstChildResult`/`buildPendingLeafFirstChild`、`ApplyLeafFirstChildRejectReason`/`ApplyLeafFirstChildOutcome`/`applyLeafFirstChildAdditionToDocument`。Phase 5L-8/5L-9/5L-10/5L-11の既存エクスポートは一切変更していない。
- `src/view/PartialEditView.ts`（既存・拡張）: Phase 5L-9bのimport追加、`pendingLeafFirstChild`フィールド、`leafFirstChildAddRowEl`/`leafFirstChildAddButtonEl`のDOM構築、新規`renderLeafFirstChildAddRow`、`renderNewChildEditor`/`isNewChildDraftDirty`への`pendingLeafFirstChild?.draft`フォールバック追加、新規`handleRequestAddLeafFirstChild`/`handleStopLeafFirstChildDraft`、`newChildStopButtonEl`クリックハンドラのディスパッチ化、`cancelEdit`/`isDirty`/`applyEdit`への統合、新規`applyLeafFirstChildEdit`、3箇所の load/reset メソッドおよび`resetLoadedState`への`pendingLeafFirstChild = null`統合。
- `src/i18n.ts`（既存・拡張）: `partialEdit.leafFirstChildAddButtonLabel`/`...AddButtonAlreadyPendingLabel`/`...AddFailed`/`...Added`の4キーをen/ja両辞書に追加。
- `styles.css`（既存・拡張）: `.unified-outliner-partial-edit-leaf-first-child-add-row`/`-button`（既存の`.unified-outliner-partial-edit-parent-child-add-button`と同じホバー/フォーカス/無効化規約）を新設。
- `tests/leafFirstChildAddition.test.ts`（新規、23件）: 実`parseDocument`を使った、eligibility・pending構築・実文書へのapply（own-text単独・own-text+子追加の同時Apply・task/orderedの保存・兄弟非干渉・conflict/candidate-structure-invalidの拒否・**新しい子の編集済み本文がApplyで正しく保存されることを確認する回帰テスト**・改行を含む本文の`new-child-unsafe-structure`拒否）の単体テスト。
- `tests/leafFirstChildAdditionUiWiring.test.ts`（新規、24件）: View配線の静的ソース確認。**実機確認で発見・即日修正した2件目の不具合**（§7.5）の回帰として、`performAutoReload`の外部Undo後の再同期(リーフ投影ゲートの5-way化／breadcrumb・sibling nav・Subtree Navigatorの再計算・再描画)を検証する3件を含む。
- `docs/統合実装ロードマップ_2026-08-05.md`（既存・更新）: フェーズ状況テーブル・新規§3.25・§5関連ドキュメント一覧・最終更新欄。
- `CHANGELOG.md`（既存・更新）: `### Added`に新規箇条書きを追加。
- `tests/multiLineListPartialEditUiWiring.test.ts`・`tests/orderedListPartialEditUiWiring.test.ts`・`tests/taskListPartialEditUiWiring.test.ts`・`tests/standaloneListMarkerFreePartialEditUiWiring.test.ts`（いずれも既存・軽微更新）: §7.5の不具合修正で`performAutoReload`のリーフ投影再構築ゲートが5-way化したことに伴い、この条件を逐語的に検証していたアサーションのみを re-pin（Phase 5L-1〜5L-4がこの条件へ新しいarmを追加するたびに繰り返してきた既存の慣例通り）。
- `docs/phase5l9b_leaf-first-child-addition.md`（新規、本ファイル）。
- `/Users/kazumikaizuka/Obsidian/ipad-test/Test/leaf-first-child-addition-verification.md`（新規、実機検証用fixture）。

変更していないファイル（意図的、確認済み）: `src/edit/parentListItemProjection.ts`・`src/edit/standaloneParentListItemProjection.ts`・`src/edit/listMarkerProjection.ts`・`src/edit/taskListProjection.ts`・`src/edit/orderedListProjection.ts`・`src/edit/multiLineListItemProjection.ts`・4つの単独リーフ投影一式・`src/edit/quotePrefixProjection.ts`・`src/edit/compositeBlockPartialEdit.ts`・`src/edit/partialEdit.ts`・`src/model/block.ts`・`src/move/indentBlock.ts`・`src/view/OutlineTreeView.ts`——Phase 5L-8/5L-9/5L-10/5L-11のエクスポートも含め、いずれも完全に無変更のまま再利用のみ。

## 12. 対象外（今回のチケットでは実装しない、残存事項として明示）

- 明示的な「子項目を追加」ボタン以外の経路での永続的な leaf→parent 化。
- 既存4つの単独リーフ投影の優先順位変更。
- Phase 5L-1〜5L-5の再実装。
- task/orderedな初期子の形状（今回も常にunordered・非task固定）。
- 任意の挿入位置（先頭・特定の子の前後）——今回も常に「初めての、唯一の子」のみ。
- 複数の初回子の同時追加。
- 同じApply内での並び替え/インデント/アウトデント/既存子削除との自由な組み合わせ——Mode Bは他のMode A系の保留とは同時に存在し得ない設計のまま。
- 孫以下・より深い階層への追加。
- CompositeBlock子メンバーへの追加。
- checkbox status対応範囲の拡大・ordered delimiterの変更・兄弟の自動採番。
- 完全なMarkdown-AST WYSIWYG編集。

## 13. 将来候補

- Mode A/Mode Bの垣根を越えた、より一般化された「addChild」UIへの統合（現時点では2つの独立したボタン・2つの独立したセッションフィールドのまま）。
- 初回の子として task/ordered/複数行を選択できるようにすること。
- 初回の子を複数同時に追加できるようにすること。
