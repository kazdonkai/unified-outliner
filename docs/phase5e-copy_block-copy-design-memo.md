# Phase 5E-Copy: Outline Tree でのブロックコピー操作 — 設計メモ

## 1. 背景とスコープ

Phase 5E の残りは「Outline Tree でのコピー操作」と「ミラー機能（Phase 5M）」の 2 点であり、本フェーズは前者を実装する。1.0.0 への引き上げは両者の完成後に行うため、本フェーズではバージョン・タグ・リリースを変更しない。

コピーは **独立した複製（copy / duplicate）** である。ミラー（参照・投影）とは異なり、コピー後に原本を編集してもコピー先は変化しない。実装上は「原本の行を読み取り、同じ行列を別の位置に挿入する」操作であり、原本の行は一切書き換えない。

### 対象ブロック種別（コピー元）

| 種別 | 範囲 | 備考 |
| --- | --- | --- |
| section | 見出し＋配下の全内容（子セクション含む） | `SectionBlockNode.range` |
| list item | 項目＋全子孫 | `ListBlockNode.range`。タブ／スペース混在インデントは拒否 |
| callout / blockquote | standalone のみ | `editability === "supported"`、list 内にネストしていないもの |
| fenced-code | standalone のみ | fence 行を含めてそのまま複製する |
| Markdown table | standalone のみ | 同上 |
| paragraph | standalone のみ | list 項目配下の段落は対象外 |

CompositeBlock の親行・メンバー行（アンカーのリスト項目を含む）はコピー元にならない（本フェーズの対象外であり、コマンドパレットからカーソル位置で指定した場合も `copy-composite-member` で拒否する）。ただしペースト先としては使える（§4）。CompositeBlock を含む section や親 list 項目をコピーすることは可能であり、その場合 CompositeBlock はまるごと複製される。

## 2. UI

### Outline Tree のコンテキストメニュー（右クリック／iPad では長押し）

- **Copy block**（ブロックをコピー）: 行を「コピー待機状態」にする。
- **Duplicate below**（下に複製）: 行の直下（section・list は部分木の直後）に複製を即時挿入する。
- コピー待機中のみ、全種別の行に以下を追加する。
  - **Paste block**（ブロックを貼り付け）: 行の「後」に挿入する。
  - **Paste block above**（ブロックを上に貼り付け）: 行の「前」に挿入する。
  - **Paste block as child**（ブロックを子として貼り付け）: section→section、list→list の組み合わせのときのみ表示する。
  - **Cancel block copy**（ブロックのコピーを解除）

その時点で拒否される項目は「— unavailable」の注記と禁止アイコンで表示するが、クリックは可能であり、クリックすると拒否理由を Notice で表示する（Phase 5E-3a の構造化挿入メニューと同じパターンである）。これにより「コピー元の内部にはペーストできない」等の理由が必ず利用者に伝わる。

### コピー待機状態の表示と解除

- Tree の上部にバナー「コピー中: ラベル」と操作ヒント、解除ボタン（×）を表示する。iPad のように Escape キーがない環境でもバナーのボタンで解除できる。
- コピー元の行に破線の枠（`unified-outliner-copy-source`）を付ける。
- 解除の契機は、ペーストの成功、Escape キー、バナーの × ボタン、メニューの「Cancel block copy」、コマンド「Cancel block copy」のいずれかである。
- Escape はキャプチャフェーズの document keydown で処理する。メニュー・モーダル・コマンドパレット・サジェストが開いている間、IME 変換中（`isComposing`）、テキスト入力欄（Tree のインライン改名など）では反応しない。`preventDefault` は呼ばないため、エディタや vim モードなど他の Escape 処理には影響しない。
- コピー待機状態はコピー元のノートに紐づく。別のノートを開いている間はペースト項目を unavailable とし、バナーにもその旨を表示する（ノート間コピーは本フェーズの対象外である）。

### コマンドパレット

`copy-block`（Copy block）、`duplicate-block-below`（Duplicate below）、`paste-block`（Paste block）、`cancel-block-copy`（Cancel block copy）の 4 コマンドを登録した。対象は **カーソル位置の最小安全ブロック** であり、「Move block」と同じ `resolveMoveUnit` で解決する（見出し行→section、list 項目→部分木、callout 等の内部→そのブロック、本文段落→段落）。Paste block はそのブロックの「後」に挿入する。

### 状態管理

コピー待機状態は `UnifiedOutlinerPlugin.pendingBlockCopy`（`{ filePath, snapshot, label }`）という専用フィールドで管理する。Tree の `selectedId`・`highlightedId`・D&D セッション・改名セッションとは一切共有しないため、既存の選択状態管理とは競合しない。複数の Tree リーフとコマンドパレットで同じ状態を共有する。

## 3. 書き込み経路と Undo

純粋関数モジュール `src/edit/copyBlock.ts`（Obsidian 非依存）がすべての判定と行列生成を担う。

- `buildBlockCopySnapshot(doc, scan, ref)` — コピー元の適格性判定と、その時点の行列の取得（読み取り専用）。
- `duplicateBlockBelow(text, snapshot, rules)` — 自分自身の直後へのペースト。
- `pasteBlockCopy(text, { snapshot, target, position }, rules)` — 任意位置へのペースト。

結果は既存の `LineEditOutcome` であり、呼び出し側（`OutlineTreeView` とコマンド）は `plugin.applyBlockCopyOutcome` → 既存の `applyLineEditOutcome` を通して適用する。`applyLineEditOutcome` は旧行列と新行列の差分を 1 回の `editor.replaceRange` にまとめるため、コピーは常に **1 つの Undo 単位** になる。新たな直接ファイル書き込み経路（`vault.modify` 等）は追加していない。

## 4. 挿入位置の規則（既存 D&D の規則を再利用）

| コピー元 | ペースト先 | before | after | inside |
| --- | --- | --- | --- | --- |
| section | section | 見出し行の前 | 部分木の直後（レベル維持） | 部分木の直後、見出しレベルを「先のレベル+1」に一括変更 |
| list | list | 項目の前（先と同じインデント） | 部分木の直後（同上） | 最後の子として（子のインデント） |
| list | section | 見出し行の前 | セクション自身の内容の末尾（最初の子セクションの前） | after と同じ |
| flat | section | 見出し行の前 | セクション自身の内容の末尾 | after と同じ |
| flat | list（list 内ネストでないもの）／段落／callout 等／CompositeBlock 親行 | ブロックの前 | ブロックの後 | 不可 |

- section の規則は `move/relocateSection.ts`、list の規則は `move/relocateListSubtree.ts`（`childIndentColumnsOf`・`ownContentInsertionLine`・`reindent` を export して無変更で再利用）、flat の規則は `move/findStandaloneComplexBlockDropTarget.ts` と同じである。
- D&D との唯一の意図的な違いは「自分自身の前後」への挿入である。移動では無意味（`self-drop`）だが、コピーでは複製そのものであるため許可する。
- ペースト先の種別がコピー元と組み合わせ不能な場合（section を list 行へ、list を段落行へ等）は `copy-invalid-target` で拒否する。

### 空行補完

`edit/dropStandaloneComplexBlock.ts` の `ensureBlankSeparation` を export して **無変更で再利用** する（空行・見出し・リスト行以外の隣接行との間に空行を 1 行挿入する）。そのうえで、コピー固有の補完を 2 点だけ追加した（`ensureCopySeparation`）。

1. flat ブロック（callout／blockquote／fenced-code／table／段落）の隣がリスト行の場合も空行を入れる。これがないと、単一行リスト項目の直後に貼った callout が新しい CompositeBlock を勝手に形成したり、「1.」以外で始まる順序付きリストの直前に貼った段落が CommonMark 上で遅延継続行として結合されたりする。
2. section の複製の直後が見出しで、複製の最終行が空行でない場合に空行を 1 行入れる（体裁上の補完）。

既存の空行を削除したり二重化したりすることはない。list 項目同士の間（list→list）には空行を入れない（リストが loose にならないようにする。既存の list D&D と同じである）。

## 5. 安全基準

1. **原本は読み取り専用** — 成功時の出力は常に「元の行列の 1 箇所に、複製（と必要な空行）を差し込んだもの」であり、他の行は 1 バイトも変わらない。順序付きリストの番号振り直し（`normalizeOrderedMarkers`）もコピーでは適用しない。原本の番号を書き換えないためである（Markdown の表示上は連番で描画される）。
2. **コピー元の再解決** — スナップショットはコピー時点の行列を保持する。ペースト時には現在の本文から「同じ種別で行列が完全一致するブロック」を探し、元の範囲にあるものを優先、なければ一意な一致を採用する（上方の編集でずれただけなら追従する）。消失・変更は `copy-source-changed`、同一内容のブロックと区別できない場合は `copy-source-ambiguous` で拒否し、コピー待機状態も解除する。利用者が見ていない内容をペーストすることはない。
3. **ペースト先の再検証** — メニュー構築時のペースト先（種別・範囲・親）が現在の本文にそのまま存在しなければ `copy-target-changed` で拒否する。
4. **コピー元内部へのペースト拒否** — ペースト先がコピー元の範囲内にある場合（子セクション・子孫項目・内部の段落等）、自分自身への inside、挿入行がコピー元の内部に落ちる場合は `copy-inside-source` で拒否し、Notice を表示する。
5. **構造を壊す挿入位置の拒否** — 挿入行が frontmatter 内、fenced code 内、認識済みの任意のブロック（callout の `>` 連続、table、段落等）の内部に落ちる場合は `copy-unsafe-position`、CompositeBlock の内部（アンカー項目とメンバーの間）に落ちる場合は `copy-composite-internal-boundary` で拒否する。
6. **挿入後の構造保存検証** — 挿入結果を再パースし、(a) 既存のすべての section/list ノードが同じ種別・深さ・親で行シフトのみの位置に存在すること、(b) 既存のすべての複合ブロック（段落・callout・fenced-code・table 等）が同じ種別・範囲・editability で存在すること、(c) 既存のすべての CompositeBlock が同じメンバー構成で存在すること、(d) 挿入区間の中身がコピー元の構造の忠実な複製（ノード・ブロック・CompositeBlock の相対位置と種別が一致）であること、(e) 複製の根（見出しレベル・リスト範囲とインデント・flat ブロックの種別と範囲）が期待どおりに認識されること、を確認する。1 つでも崩れれば `copy-structure-changed` で全体を拒否し本文は変更しない。`edit/insertStructuredBlock.ts` の挿入後検証と同じ考え方である。これにより「低いレベルの見出しを貼ったせいで後続の見出しがその子に付け替わる」「遅延継続行で前後の段落と結合する」といった意図しない変化を、形を予測するのではなく実測で排除する。

## 6. 既存機能への影響

- **D&D** — 既存関数の export 追加のみであり、ロジックは無変更である。既存テストはすべて無変更で通過する。
- **fold-state** — コピー元の fold identity は変化しない。Duplicate below では複製が同名の後続（`#2`）として識別されるため、折りたたまれた原本は折りたたまれたまま、複製は展開状態で現れる（テストで固定した）。原本の「前」に同名のブロックを貼った場合は、既存の方針どおり同名兄弟の出現順で識別が入れ替わる（`tree/foldIdentity.ts` 冒頭に記載済みの許容された制約であり、データ損失は起きない）。
- **Partial Edit Pane** — 開いているセッションは既存の外部変更検知（conflict detection）でそのまま扱われる。コピーは通常の本文編集と同じ 1 回の `replaceRange` である。
- **ホイスト／breadcrumb／選択追従** — 成功後は既存の `queueOutlineTreeSelectionFollow` で Tree の選択を複製の先頭行へ追従させる。コピー待機状態は選択状態と独立している。
- 既存テスト 1 件（`tests/commandTable.test.ts` のコマンド ID 一覧）にのみ、追加した 4 つの ID を追記した。

## 7. テスト

- `tests/phase5eCopyBlock.test.ts`（59 件）— section／list 部分木／callout／blockquote／fenced-code／table／paragraph の Duplicate below、原本との独立性、Copy→Paste の各位置（before／after／inside、section 間・list→section・flat→list・段落・callout・CompositeBlock 親行・セクション横断）、コピー元内部へのペースト拒否、空行補完、CompositeBlock 内部への割り込み拒否、コピー元の変更・曖昧化・ずれへの追従、ペースト先の変更、見出しの付け替え拒否、見出しレベル 6 超過の拒否、CompositeBlock メンバー単独コピーの拒否、frontmatter 不変、順序付きリスト非再番号、fold identity の保存、`applyLineEditOutcome` を通した 1 回の `replaceRange` と 1 回の Undo による完全復元。すべての成功ケースで「挿入区間を除けば元の行列と 1 バイトも違わない」ことを確認している。
- `tests/phase5eCopyBlockUiWiring.test.ts`（13 件）— Tree の 6 種類のメニューへの配線、書き込みが `applyBlockCopyOutcome`→`applyLineEditOutcome` 経由のみであること、専用状態フィールドであること、バナーと行マーカー、Escape の扱い、コマンド名とメニュー名の一致、全拒否理由の日英メッセージ。

## 8. 対象外（後続）

- ノート間のコピー＆ペースト。
- CompositeBlock（親行・メンバー行）と list 内にネストした複合ブロックのコピー元化。
- 1 回のコピーからの複数回ペースト（仕様どおり、ペースト成功で待機状態を解除する）。
- ドラッグ時の修飾キー（Alt/Option）によるコピー D&D。
- ミラー機能（Phase 5M）。
