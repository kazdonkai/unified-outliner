# Phase 5E-3a 設計メモ：ツリーペインでの fenced-code / table 新規挿入

作成日: 2026-09-23 ／ ブランチ: `phase5e3a-structured-block-insert`（main 未マージ）
状態: **実装完了・ユーザー実機確認待ち**

## 1. 目的と範囲

Outline Tree のセクション見出しノード・リスト item ノードのコンテキストメニュー（右クリック／長押し）から、fenced code block と Markdown table を新規挿入し、挿入直後にそのブロックの Partial Edit を自動で開けるようにする。

対象外（チケットの非目標どおり）: table のセル編集 UI・Table Mode、Mermaid GUI 編集、Dataview クエリビルダー、D&D による挿入位置指定、複数ブロック同時挿入、挿入後の自動 rename。range parser・競合検知・`tree/insertionFramework.ts`（5E-0.5/5E-1 の fenced/table 起点の挿入リゾルバ、未接続のまま）・`edit/insertBlock.ts`・`edit/insertParagraph.ts` には変更を加えていない。

## 2. 追加・変更ファイル

| ファイル | 種別 | 内容 |
|---|---|---|
| `src/edit/codeBlockPresets.ts` | 新規（純粋） | CodeBlockPreset 登録表（13 種）、`buildFencedCodeBlockLines`、`validateCustomInfoString`、`buildTableTemplateLines`（1〜8 列 × 1 行） |
| `src/edit/insertStructuredBlock.ts` | 新規（純粋） | 共通挿入 API `insertBlockAtPosition`、`computeRequiredBlankLines`、挿入位置解決 `resolveStructuredInsertionPoint`、解決＋挿入＋構造保存検証 `insertStructuredBlockBelowNode`、挿入後 id 再解決 `findInsertedStructuredBlockId` |
| `src/view/CodeBlockPresetModal.ts` | 新規 | 言語セレクタ（プリセット＋Custom… 自由入力） |
| `src/view/TableTemplateModal.ts` | 新規 | 列数入力（1〜8）／最小テンプレート（2 列 × 1 行）挿入の選択ダイアログ |
| `src/view/OutlineTreeView.ts` | 変更 | セクション・リストのメニューに 2 項目追加、`runInsertStructuredBlockCommand` |
| `src/view/PartialEditView.ts` | 変更 | Phase 5E-3 の言語選択肢表を CodeBlockPreset 登録表からの派生に置換（順序・値・alias・ラベルキーは完全に同一） |
| `src/i18n.ts` / `styles.css` | 変更 | en/ja 文言、モーダルの最小スタイル |
| `tests/phase5e3aStructuredBlockInsert.test.ts` / `tests/phase5e3aStructuredBlockInsertUiWiring.test.ts` | 新規 | 純粋関数テスト 56 件、配線・単一 Undo・i18n テスト 9 件 |

## 3. 挿入位置の規則

- **セクション見出し**: 見出し行の直後（セクション内の最初の位置）に挿入する。見出しでない Markdown ブロックはセクションの「兄弟」として表現できない（セクション範囲の直後に置くと、最後の下位セクションに吸収される）ため、見出し直後のみを唯一の曖昧さのない位置として採用した。メニュー文言の「下に（below）」は見出し行の下を意味する。
- **リスト item**: item のサブツリー全体の直後に、リストの次のブロックとして挿入する。許可するのは「ルートレベルの item」かつ「そのリストの最後の item」（直後の最初の非空行がリスト行でもインデント行でもない）の場合のみである。途中の item の後に置くとリストが二分され、ネストした item の後に置くとリスト内部に入るため、いずれも `structured-insert-inside-list` で拒否する。
- 位置が不適格な項目はメニューに「— unavailable」付きで表示するが、クリックは可能とし、クリック時は Notice で理由を示すだけで何も書き込まない（チケット §1「no-op とし、Notice で理由を示す」）。

## 4. 空行の規則

`computeRequiredBlankLines` は、挿入点の直前・直後の既存行が非空行である側にだけ空行 1 行を付加する。既存の空行は十分とみなし、追加も削除もしない（既存本文の空行は正規化しない）。文書端では空行を付けない。`insertBlockAtPosition` は入力配列を変更せず、既存行の削除・結合を一切行わない。

## 5. 安全性：挿入後の構造保存検証

挿入位置の事前判定に加え、挿入結果を再パースして以下をすべて満たさなければ拒否し、原文を 1 バイトも変えない（`structured-insert-structure-changed` / `structured-insert-not-recognized`）。

1. 新ブロックが、期待した kind・`editability: "supported"` で、挿入した行範囲ちょうどに認識される。
2. 既存の全 section/list ノードが、同じ種別・深さで、行シフト後の開始行に存在する（ノード数も一致）。
3. 既存の全 complex block（fenced-code・table・callout・blockquote・paragraph 等）が、同じ kind・editability で、行シフト後の範囲に存在する。挿入区間内に完全に収まるブロック（table に対してスキャナが従来から出す重なり paragraph 候補など）は新ブロックの一部として比較から除外し、区間の縁をまたぐブロックは除外しない。
4. 既存の全 CompositeBlock が、同じ rule・同じ構成メンバー（シフト後範囲）で再マッチする。

これにより「既存 fence の開始・終了の対応関係が壊れる」「CompositeBlock の構成が変わる」場合は予測ではなく実測で拒否される（初期版ではユーザー確認なしで単純拒否。例: `single-line-list` + `callout` の複合ブロックの間への挿入）。なお現行 UI では複合ブロックのメンバー行は読み取り専用でメニュー自体が出ないため、この検証は主に防御層として働く（純粋関数テストで直接確認している）。

## 6. 書き戻しと Undo

書き込みは既存の `dispatchAndApply` → `applyLineEditOutcome` 経路のみを通る（新しい直接書き込み経路なし）。差分は 1 回の `Editor#replaceRange` にまとめられるため、挿入は Obsidian の Undo 1 回で取り消せる。`dispatchAndApply` はモーダルのコールバック時点で現在のエディタ内容を再パースするため、メニュー表示後にノートが変わっていても最新内容に対して判定・検証が行われる。

挿入成功後、complex block の id は連番（`fenced-N` / `table-N`）であるため、挿入範囲から id を再解決して `activatePartialEditView(id)` を呼ぶ。Partial Edit を開く操作はノートを編集しないので、挿入＋起動は Undo 1 単位のままである。fenced-code は Phase 5E-3 のフェンス非表示 UI（本文のみ・言語セレクタ）で、table は Phase 5E-2A の Raw Markdown 編集で開く。Tree 設定 `showFencedCodeInOutline` / `showTablesInOutline` が off でも Partial Edit は開ける（id を本文から直接再解決するため）。

## 7. CodeBlockPreset

チケット記載の最低限（Plain・Mermaid・Dataview・DataviewJS・JavaScript・TypeScript・Python・YAML・JSON・SQL・Custom…）に、Phase 5E-3 のセレクタに既にあった Shell(bash)・CSS・HTML を加えた 13 種＋Custom… とした。リポジトリに既存の `CodeBlockPreset` 定義は存在しなかったため、Phase 5E-3 の `FENCED_CODE_LANGUAGE_OPTIONS` を唯一の登録表 `CODE_BLOCK_PRESETS` へ移し、PartialEditView 側はそこから派生させた（挿入時と編集時の選択肢が乖離しない）。Mermaid のテンプレートは `flowchart TD\n`（本文 2 行 `flowchart TD` と空行）、他は空の本文 1 行である。Custom… の info string はトリム後、バッククォート・改行を含まず 64 文字以内であることを検証する（バッククォートを含むと開始行がフェンスとして成立しなくなるため）。フェンスは常に 3 バッククォートを用いる。

## 8. table テンプレート

`| Column 1 | Column 2 |` / `| --- | --- |` / `|  |  |` の 3 行（列数 n に応じて拡張）。1〜8 列のすべてでスキャナが supported な table として認識し、Phase 5E-2A の Apply 検証を通過することをテストで確認している。

## 9. 検証結果（自動）

- `npx tsc --noEmit` エラーなし
- `npx vitest run` 153 ファイル / 3153 件全通過（5E-3 時点の 151 ファイル / 3088 件から新規 2 ファイル・65 件追加、既存テストは無変更で全通過）
- `npm run lint` 0 エラー（警告 3 件は `src/settings.ts` の既存警告で本変更と無関係）
- `npm run build` 成功、`git diff --check` 問題なし

## 10. 実機確認（ユーザー実施）

### デプロイ手順（ターミナルで実行）

```bash
cd /Users/kazumikaizuka/Obsidian/unified-outliner-public && git switch phase5e3a-structured-block-insert && npm run build
cp main.js manifest.json styles.css ~/Obsidian/Method/.obsidian/plugins/unified-outliner/
cp main.js manifest.json styles.css /Users/kazumikaizuka/Obsidian/ipad-test/.obsidian/plugins/unified-outliner/
```

コピー後、Obsidian の Community plugins で Unified Outliner を off → on にして再読み込みする。検証ノートは `ipad-test/Test/Phase 5E-3a 検証：コードブロック・表の新規挿入.md`。

### 確認項目

| # | 操作 | 期待結果 | 結果 (Pass/Fail/Not tested) | メモ |
|---|---|---|---|---|
| 1 | 見出し「## A」右クリック → Insert code block below → Mermaid | 見出し直後に ```` ```mermaid / flowchart TD / (空行) / ``` ```` が前後空行付きで入り、Partial Edit が開く（本文 `flowchart TD`、言語 Mermaid） | Pass | ユーザー実機確認済み（2026-09-23） |
| 2 | 同上で Plain / Python / Custom…（`rust`） | それぞれ info string が正しく、Partial Edit が開く | Pass | ユーザー実機確認済み（2026-09-23） |
| 3 | Custom… に `` a`b `` を入力 | エラー表示、挿入されない | Pass | ユーザー実機確認済み（2026-09-23） |
| 4 | 見出し右クリック → Insert table below → 列数 3 → Insert | 3 列 × 1 行の表が入り、Raw Markdown の Partial Edit が開く | Pass | ユーザー実機確認済み（2026-09-23） |
| 5 | 同上で「最小テンプレートを挿入（2列 × 1行）」 | 2 列 × 1 行の表が入る | Pass | ユーザー実機確認済み（2026-09-23） |
| 6 | 1・4 の直後に Cmd+Z 1 回 | 挿入が一発で消え、原文に完全に戻る | Pass | ユーザー実機確認済み（2026-09-23） |
| 7 | リスト「B 最後の項目」右クリック → Insert table below | リストの後に表が入り、リストは変化しない | Pass | ユーザー実機確認済み（2026-09-23） |
| 8 | リストの途中の項目・子項目で同メニュー | 「— unavailable」表示、クリックで理由の Notice、本文不変 | Pass | ユーザー実機確認済み（2026-09-23） |
| 9 | 見出し直後に既存コードブロックがある「## C」で Insert code block below → Plain | 新ブロックが既存コードブロックの前に入り、既存ブロックの開始・終了フェンスの対応が保たれる | Pass | ユーザー実機確認済み（2026-09-23） |
| 10 | 挿入後の本文を Reading view で表示 | コードブロック・表として正しく描画、前後の見出し・リスト・既存コードブロックが崩れない | Pass | ユーザー実機確認済み（2026-09-23） |
| 11 | iPad（ipad-test）で長押しメニューから 1・4 | デスクトップと同じ結果 | Not tested | 必須項目ではない（デスクトップでの完了判定基準は満たしている） |

### 完了判定基準

項目 1・4・6・7・8・10 が Pass であること（11 は iPad 実機が使える場合）。**2026-09-23、ユーザー実機確認によりすべて Pass となり、この基準を満たした。**

## 11. 実機確認フィードバックによる修正（2026-09-23）

1. **空のブロックに案内文が表示される問題**：何も読み込んでいないときの案内文（「アウトラインツリービューでノードを右クリックし…」）が textarea の placeholder として残り、本文が空のコードブロックを開いたときに表示されていた。ノードを読み込んだ時点で placeholder を空にするよう修正した。あわせて、fenced-code／table のペインタイトルが「セクション」と表示されていた誤りを「コードブロック」「表」に修正した。
2. **挿入→Apply 後の本文 Undo で挿入テンプレートが残る問題**：挿入と Apply が別々の編集として記録され、Undo 1 回では Apply だけが戻っていた。Tree が挿入前後の本文をペインに渡し、その挿入ブロックに対する最初の Apply では、挿入を `editor.undo()` で取り消してから、最終内容を挿入前の本文に対して 1 回の `replaceRange` で書き込むよう変更した（段落挿入の確定処理と同じ方式）。この経路をとるのは、ノートが挿入直後の本文と完全に一致し、かつ undo 後の本文が挿入前の本文と完全に一致する場合だけである。一致しない場合は redo で元に戻し、従来どおり通常の Apply を行う（安全側に倒す）。2 回目以降の Apply や、他のノードを読み込んだ後の Apply は従来どおりである。

追加確認項目：

| # | 操作 | 期待結果 | 結果 | メモ |
|---|---|---|---|---|
| 12 | 本文が空のコードブロックを挿入 | ペインの textarea が空白で、案内文が出ない。タイトルが「コードブロック」 | Pass | ユーザー実機確認済み（2026-09-23） |
| 13 | 挿入 → 言語や本文を変えて Apply → 本文側で Cmd+Z 1 回 | 挿入前の状態に完全に戻る（コードブロックが残らない） | Pass | ユーザー実機確認済み（2026-09-23） |
| 14 | 表でも 13 と同じ操作 | 同上 | Pass | ユーザー実機確認済み（2026-09-23） |

## 12. 実機確認フィードバックによる修正 その2（2026-09-23）

### 事象

Tree ペインでコードブロックを挿入して Apply した後、本文側で Undo すると（項目 13 の操作）、本文自体は挿入前の状態に正しく戻る一方、Partial Edit ペインだけが開いたまま残り、しかもその枠内には挿入したブロックではなく、**同じノートの別セクションに既にあった無関係な既存コードブロック**（`console.log("existing");`）の内容が表示されてしまっていた。

### 原因

fenced-code・table などの complex block の id（`fenced-N` / `table-N`）は、再パースのたびにスキャン順で振り直される「位置ベース」の連番であり、段落用の `ParagraphMoveAnchor` のような内容・構造照合による再同定の仕組みを持たない（本ドキュメント §5 の検証はあくまで「挿入直後」の構造保存を確認するものであり、その後の一般的な id 安定性を保証するものではない）。

今回のケースでは、挿入したブロックの id が既存ブロックより若い番号だったため、本文 Undo で挿入ブロックが消えた瞬間、既存ブロックの id が 1 つ繰り上がり、ペインが保持していた「最後に見ていた id」と偶然一致してしまった。ペインの自動追随ロジック（`resolveCurrentTarget` → `classifySyncOutcome` → `clean-pane-auto-reload`）はこれを「同じブロックが更新された」と誤認し、無関係な既存ブロックの内容を黙って読み込み直していた。

これは新機能固有の不具合ではなく、position ベースの complex-block id が一般に持つ既知の制約（プロジェクトのロードマップで「resolver hardening backlog」として記録済み・section/list の `BlockNode` の id にも同様の性質がある）が、今回の「挿入 → Apply → 本文 Undo」という操作列によって初めて具体的に再現された、という位置づけである。プロジェクトの既定方針（5T-13R 等）に従い、id モデル全体の再設計は本チケットの範囲外とし、今回具体的に再現した経路だけを対象にスコープを絞って修正した。

### 修正内容

`PartialEditView` に `structuredInsertGuard: { nodeId, preInsertText } | null` を追加した。Tree からの挿入直後の最初の Apply が走った時点で、挿入前のノート全文スナップショット（`pendingStructuredInsert.preInsertText`）を、Apply が §11 の Undo/Redo マージを実際に行えたかどうかに関わらず無条件でこのガードに保存する。

`resolveCurrentTarget`（自動追随の stale check と、明示的な Reload の両方が経由する唯一の合流点）は、通常の id ベース解決を行う前に、まずこのガードをチェックする：現在の本文全文がガードに保存した「挿入前」の全文とバイト単位で一致する場合、その id の下に挿入ブロックが存在し得ないことが確定するため、id ルックアップの結果を一切信用せず、無条件で解決失敗（`ok: false`）を返す。これは既存の「ノードが削除された」場合と同じ `unavailable` 状態に遷移する——枠の内容は最後に見ていたもの（今回で言えば挿入したブロックの内容）を読み取り専用のまま表示し続け、Apply は無効化され、明示的な Reload だけが次の一手になる。`unavailable` 状態は自動では解除されない既存の設計（`transitionToUnavailable` のドキュメントコメント参照）にそのまま乗っているため、黙って別ブロックの内容にすり替わることはなくなる。

このガードは `resetLoadedState`（別ノードへの切り替え時）でクリアされる。また、同じ id 文字列を後から改めて読み込んだ場合（位置ベース id は再利用されうる）に、前回の読み込みが残したガードが誤って新しい読み込みに漏れないよう、`loadNodeInternal` の先頭で無条件にクリアするようにした。

full-text 完全一致というガードの性質上、これは「挿入前のスナップショットに戻った」ことを検出できるだけであり、その後さらに本文が編集されて別の状態に移った場合の一般的な id 安定性問題（前述の resolver hardening backlog）までは解決しない。これは意図的なスコープ限定であり、本チケットの既存の設計方針（§5 の検証も同様に「挿入直後」限定）と整合する。

### 自動検証

- `npx tsc --noEmit -skipLibCheck`：エラーなし
- `npx vitest run`：153 ファイル / 3156 件全通過（新規 wiring テスト 1 件追加、既存の 1 件を新しいコード文言に合わせて更新）
- `npm run lint`：0 エラー（既存の `src/settings.ts` 警告 3 件のみ、本修正と無関係）
- `npm run build`：成功
- `git diff --check`：問題なし

### 追加確認項目

| # | 操作 | 期待結果 | 結果 (Pass/Fail/Not tested) | メモ |
|---|---|---|---|---|
| 15 | 見出し「## C」（既存の `js` コードブロックを含む）とは別の見出しにコードブロックを Insert → Apply → 本文側で Cmd+Z 1 回 | Partial Edit ペインが「unavailable」（編集不可・グレーアウト等の既存の stale 表示）になり、`console.log("existing");` など無関係な既存ブロックの内容が表示されないこと | Pass | ユーザー実機確認済み（2026-09-23） |
| 16 | 項目 15 の状態で Reload ボタンを押す | 挿入したブロックが本文にもう存在しないため、Reload 後も引き続き「見つからない」旨の状態になり、無関係な既存ブロックの内容に切り替わらないこと | Pass | ユーザー実機確認済み（2026-09-23） |
| 17 | 項目 15 の状態で本文側にもう一度 Cmd+Shift+Z（Redo）して挿入を復元 | Redo 直後は「unavailable」表示のまま自動では戻らない（既存の「削除されたノード」と同じ仕様——stale check は unavailable になった時点で以後自動では再チェックしない設計）。枠内には項目15時点の内容が表示され続ける。ここで「再読み込み」ボタンを押すと、挿入ブロックの内容に正しく追随し、通常の編集可能状態（バナー消滅）に戻ること | Pass | ユーザー実機確認済み（2026-09-23）：再読み込みでバナーが消えて通常どおり編集可能に戻ることを確認 |

## 13. フェーズ完了（2026-09-23）

§10（項目1〜10、11は任意）・§11（項目12〜14）・§12（項目15〜17）の実機確認項目がすべて Pass となり、バグ報告1・2を含めて Phase 5E-3a は完了とする。
