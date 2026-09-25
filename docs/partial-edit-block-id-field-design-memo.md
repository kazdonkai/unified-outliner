# Partial Edit Pane：Block ID フィールド — 設計メモ

## 1. 目的と対象

部分編集ペインで段落・callout・blockquote・fenced-code・table を開くと、これまではブロック ID（`^src-callout`、`^uo-xxxxxxxx` など）が本文のテキストエリアに露出するか、ブロック範囲外の独立行として存在していた。いずれの場合も、ユーザーが ID を意識して管理する手段がなく、誤って壊すおそれがあった。

本チケットでは、ブロック ID を本文から切り離し、独立した「Block ID:」フィールドで表示・編集できるようにした。

| 種別 | 対象 |
| --- | --- |
| 段落・callout・blockquote・fenced-code・table | 対象（ID があるときだけフィールドを表示する） |
| セクション・リスト・拡張ブロック（CompositeBlock） | 対象外（フィールドを表示しない。挙動は従来どおり） |

## 2. ブロック ID の形と検出規則

検出は `edit/partialEdit.ts#detectBlockIdLayout` に集約した。ミラーの参照先解決（`mirror/resolveMirrorSource.ts`）とミラー作成（`mirror/createMirror.ts`）と同じ規則であり、ペインに表示される ID はミラーが使う ID と常に一致する。

| 形 | 例 | 判定 |
| --- | --- | --- |
| 行内サフィックス型 | `Paragraph source text. ^src-para` | ブロックの最終行が ` ^id` で終わる（fenced-code では判定しない） |
| 段落内の独立行 | `text` の次行に `^id`（空行なし） | 段落の最終行が `^id` だけの行で、段落に他の行がある |
| 独立行型 | callout の後に空行を挟んで `^src-callout` | ブロックの後の最初の空でない行が `^id` だけの行（空行は何行でもよい） |

### 指示からの変更点

1. **独立行型で空行を許した。** 指示の `extractBlockIdAfterRange` は `endLine + 1` 行目だけを見る。しかし Create mirror は「ブロック、空行、`^id`」の形で ID を書き込む（Obsidian の慣行）。`endLine + 1` だけを見ると、実機確認の主対象である「Create Mirror 済みの callout」の ID を検出できない。そこで、`extractBlockIdAfterRange` は指示どおりの仕様で実装・公開したうえで、実際の検出は空行を読み飛ばす `detectBlockIdLayout` で行う。
2. **段落の独立行は段落の内部にある。** パーサーは、空行なしで段落の直後にある `^id` 行を段落の継続行として段落の範囲に含める（`text\n^id` は 2 行の段落になる）。そのため、段落の `rangeEnd + 1` 行目が `^id` になることはない。段落内の最終行が `^id` だけの場合を独立行型として扱い、本文からはその行を除く。空行を挟んだ `^id` 行も、他の種別と同じく独立行型として扱う。
3. **fenced-code では行内サフィックスを判定しない。** コードの最終行の末尾にある ` ^x` はコードの一部であり、ブロック ID ではないためである。fenced-code の ID は、常に閉じフェンスの後の独立行として扱う。
4. **ID だけの 1 行段落**（`^lonely`）は「ID を持つブロック」として扱わない。本文が空になってしまうためである。これは従来どおり本文として表示する。

## 3. 抽出（extractSubtreeText・resolveParagraphAtCursor）

- `ExtractSubtreeOutcome` に `blockId`、`blockIdIsStandaloneLine` と、内部用の `blockIdLayout` を追加した。callout・blockquote・table では、行内サフィックスを `text` から除く。独立行はもともと `text` に含まれない。`endLine` はブロック自身の末尾行のままである。
- `ResolvedParagraphAtCursor` にも `blockId`、`blockIdIsStandaloneLine` を追加した。`text` は ID を除いた本文である。
- セクションとリストでは、常に `blockId: null`、`blockIdIsStandaloneLine: false` を返す。

## 4. Apply（applySubtreeEdit・applyParagraphEdit）

- **シグネチャ**：`applySubtreeEdit(doc, nodeId, originalText, newText, fencedCodeInfoString?, blockId?, blockIdIsStandaloneLine?, originalBlockId?)` とした。`applyParagraphEdit(doc, anchor, newText, blockId?, blockIdIsStandaloneLine?)` にも 2 つの引数を加えた。新しい引数はすべて省略でき、省略した場合は現在の ID をそのまま保つ。既存の呼び出し（リストの子のインライン編集など）は、変更なしで従来どおり動作する。
- **行の再構築**：共通関数 `rebuildBlockWithId` で行う。
  - ID を保つ場合、元の形を保つ。行内サフィックスは行内のまま、独立行は独立行のままで、独立行の前の空行もそのまま残す。
  - ID と本文がどちらも変わっていない行は、元のバイト列のまま書き戻す（空白の数などを正規化しない）。
  - ID を削除する場合、独立行とその前の空行をまとめて取り除く。直後に内容が続くときは、ブロックとの区切りとして空行を 1 行残す。
  - ID のないブロックに新しく付ける場合、形は `blockIdIsStandaloneLine` の値に従う。独立行にするときは、Create mirror と同じく空行を 1 行挟む。直後に内容が続くときは、その後にも空行を 1 行入れる。fenced-code は常に独立行にする。
  - すでに ID があるブロックでは、引数に関わらずノート上の現在の形を優先する。
- **ID の正規化と検証**：`normalizeBlockIdInput` で、前後の空白と先頭の `^` 1 個を取り除く。空文字は「ID を削除」とみなす。英数字とハイフン以外を含む値は `invalid-block-id` として拒否し、ノートは変更しない。
- **競合判定**：本文の比較は従来どおり ID を除いた本文どうしで行う。これに加えて、次の場合も競合とした。
  - ノード系：`originalBlockId` を渡したとき、ノート上の現在の ID と異なれば `conflict` とする。
  - 段落：本文と ID の両方で同一性を確認する。ID だけが外部で変わった場合は `content-changed` になる。

  ID を外部で変更した後に、古い ID のまま Apply して上書きしてしまうことを防ぐためである（指示では「conflict 判定は変更しない」とあったが、この安全上の理由で追加した）。本文も ID も変わっていない Apply は成功し、ノートは同一のままである。
- **段落のアンカー**：`ParagraphEditAnchor` に、省略可能な `blockId` と `blockIdIsStandaloneLine` を追加した。`blockId` を持つアンカー（部分編集ペインが `buildParagraphEditAnchor` で作るもの）は「本文モード」で動作する。`blockId` を持たないアンカー（Outline Tree の段落インラインリネームが作るもの）は、従来どおり全文で比較・置換する。これにより、ツリーのリネームの挙動は一切変わらない。

## 5. ペイン（PartialEditView）

| 項目 | 内容 |
| --- | --- |
| 状態 | `loadedBlockId`、`loadedBlockIdIsStandaloneLine`、`blockIdFieldEligible` の 3 つ。全種別で共通の名前にし、段落も同じフィールドを使う |
| DOM | ミラー参照行の直上に `unified-outliner-partial-edit-block-id-row`（「Block ID:」ラベルと、`unified-outliner-partial-edit-block-id-input`、placeholder は日本語 UI で「なし」）を置く。ペインの行の並びの都合で、本文エディタの下にある list 用の行（非表示）の後になる |
| 表示条件 | 対象種別で、かつ ID があるときだけ表示する（`renderBlockIdRow`） |
| 表示の更新 | 読み込み、Apply 後、再読み込み（自動・手動）、Cancel のたびに、ノート上の現在の ID を入れ直す |
| dirty | 入力値を正規化した ID が読み込み時の ID と異なれば dirty とする（`^x` と `x` は同じとみなす） |
| Apply | 入力が空なら null を渡す。表示していないとき（ID のないブロック、対象外の種別）は undefined を渡し、ID に触れない |
| 古さの検出 | 本文が同じでも、ノート上の ID が読み込み時と異なれば「変更あり」とみなす。未保存の変更がなければ自動で再読み込みし、あれば stale 表示にする |
| ミラー参照数 | 段落の本文だけでも一致するように、`mirrorOps.partialEditTargetStartLine` を直した（本文が ID を含まなくなったため） |

## 6. 注意（今後の課題）

- ID の変更・削除とミラー参照の扱いは、§8 の追加修正で対応した。
- 新しい ID がノート内の既存 ID と重複するかどうかは確認していない。ミラーは最初の一致を使う。
- ID のないブロックに ID を新しく付ける UI はない（フィールドを表示しないため）。関数としては対応しているので、必要なら「ID を追加」ボタンを後から足せる。

## 7. テスト

`tests/partialEditBlockIdField.test.ts`（67 件）を追加した。内訳は次のとおりである。

- `stripInlineBlockId`・`joinInlineBlockId`（往復を含む）・`extractBlockIdAfterRange`・`detectBlockIdLayout`・`normalizeBlockIdInput`
- `extractSubtreeText` の種別ごとの分離
- `applySubtreeEdit`：callout、fenced-code、table について、ID の更新・削除・新規追加・本文だけの変更・無効値・競合
- `applyParagraphEdit`：行内サフィックス型・独立行型・ID なしの 3 種について、本文だけ変更・ID だけ変更・両方変更・両方変更なし（ノートが同一のまま）
- 旧形式のアンカー（ツリーのリネーム）の互換性
- ミラー参照数の一致
- 日英の文言と配線の静的チェック

既存のテストは、`partialEditStalePaneSyncUiWiring.test.ts` の 1 件だけを更新した。`applyParagraphEdit` の呼び出し文字列に、新しい 2 つの引数が加わったためである。

## 8. 追加修正：ID 変更時のミラー参照の自動更新と他ファイル参照の警告

### 8-1. 動作

Block ID フィールドで ID を**変えて** Apply したときだけ（読み込み時の ID があり、正規化した新しい値がそれと異なる場合。削除も含む）、次の処理を行う。ID を変えない Apply の挙動は変わらない。

| ケース | 同じノート内の `![[#^旧ID]]` | 他ノートからの参照 |
| --- | --- | --- |
| ID を変更 | `![[#^新ID]]` に自動で書き換える（エイリアス `\|…` は保つ）。件数を Notice で知らせる | 警告 Notice（Apply は中断しない） |
| ID を削除 | 書き換えない（参照先がなくなるため）。残っていれば、壊れた旨の警告 Notice | 警告 Notice（削除用の文言） |

- 純関数は新設の `src/edit/blockIdRename.ts` にまとめた。
  - `renameBlockIdInText`：同じノート内の、行全体が埋め込みになっている `![[#^id]]` / `![[#^id|alias]]` だけを書き換える。frontmatter とコードブロックの中、行の途中の埋め込み、他ノートの埋め込み（`![[Note#^id]]`）は対象外である。ブロック自身の ID（行内サフィックス・独立行）は、applySubtreeEdit / applyParagraphEdit が書き換えるので、ここでは触らない。
  - `countSameFileBlockIdMirrors`：同じノート内で、その ID を参照するミラー埋め込みを数える。scanMirrorEmbeds を使い、参照先が解決できるかどうかは問わない。
  - `findCrossFileBlockIdReferences`：他ノートに、このノートの `#^id` を指すリンクや埋め込みがあるかを判定する。
- ペイン側では `prepareBlockIdRename` が上の関数を呼ぶ。Notice は、Apply の書き込みが成功した後に `notifyBlockIdRename` がまとめて出す。書き込みに失敗した場合は出さない。

### 8-2. 1 回の Undo にまとめる方法

applyEdit では、まずエディタの現在のテキスト（live text）の埋め込み行を書き換えたテキストを作り、それを parse した `doc` に対して applySubtreeEdit / applyParagraphEdit を実行する。書き換えは同じ行数のままで行うため、ブロックの位置や ID の対応は変わらない。書き込みでは、applyLineEditOutcome に**書き換える前の live の行**（`liveLines`）を元の行として渡す。applyLineEditOutcome は、元の行と新しい行の差分範囲を 1 回の `replaceRange` で置き換える。そのため、ブロックの ID の変更と埋め込み行の書き換えは、離れた位置にあっても 1 回の編集になり、Ctrl+Z 1 回で両方が戻る（テストで確認した）。vault.process は使っていない。ペインの Apply は、開いているエディタへの `replaceRange` で書き込む仕組みである。

### 8-3. 指示からの変更点

- **他ファイル参照の検出方法**：指示の `findCrossFileBlockIdReferences(text, notePath, blockId)` は、現在のノートのテキストを scanMirrorEmbeds で走査するものだった。しかし、他ノートからの参照は**他ノートの中に**書かれている。また parseMirrorEmbed は `![[Other#…]]` 形式に対して null を返す（同じノート内の埋め込みしか解析しない）。そのため、指示どおりに実装すると常に false を返し、警告が一度も出ない。そこで、同じ名前の純関数の引数を「他ノートのリンク一覧・このノートのパス・ID・リンクパスの解決関数」に変えた。ペインは、Obsidian のメタデータキャッシュ（`resolvedLinks` でこのノートにリンクしているノートを絞り込み、`getCache().links / embeds`、`getFirstLinkpathDest`）からリンク一覧を集めて渡す。埋め込み（`![[Note#^id]]`）と通常のリンク（`[[Note#^id]]`）の両方を検出する。どちらも ID の変更で壊れるためである。キャッシュは Obsidian が更新するので、他ノートを編集した直後は、最新の状態がまだ反映されていないことがある。
- **i18n の置き場所**：指示にあった `src/i18n/locales/ja.ts` / `en.ts` は、このリポジトリには存在しない。既存の `src/i18n.ts` に追加した。文言は指示どおりである（日本語はです・ます調のまま）。
- **Notice を出すタイミング**：書き込みが成功した後にした。拒否された Apply では警告を出さない。

### 8-4. 制限

- 行の途中の埋め込み、リスト項目の中の `- ![[#^id]]`、通常のリンク `[[#^id]]` は、同じノート内でも自動では書き換えない（ミラーとして扱う形に合わせた）。
- 書き換える埋め込み行が、編集中のブロックの内部にある場合（段落の継続行に `![[#^id]]` がある場合など）は、本文の比較が一致しなくなり、Apply は競合として拒否される。ノートは変更されない。
- 他ノートの参照は書き換えない（警告だけを出す）。

### 8-5. テスト

`tests/partialEditBlockIdRename.test.ts`（18 件）を追加した。

- `renameBlockIdInText`：1 件、複数件、エイリアス、無関係な行、newId が null、ブロック自身の ID を書き換えないこと、frontmatter とコードブロックを除外すること
- 同じノート内の参照数
- 他ファイル参照：同じファイルだけ、他ファイルから、参照なし、未解決のリンクパス
- applyEdit と同じ流れの統合テスト：callout、埋め込みがブロックより上にある段落、fenced-code について、replaceRange が 1 回であることと、Undo 1 回で元のテキストに戻ること
- 日英の文言と、配線の静的チェック
