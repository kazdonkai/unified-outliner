# Phase 5M-1: ミラーの作成 UI と参照先解決 — 設計メモ

## 1. スコープ

Phase 5M-1 では、Outline Tree（とコマンドパレット）から、同一ノート内のミラー（Obsidian の埋め込み `![[#見出し]]`・`![[#^block-id]]`）を作成できるようにした。構成は次のとおりである。

| 部分 | ファイル |
| --- | --- |
| 作成ロジック（純関数） | `src/mirror/createMirror.ts`（`createMirrorBelow`） |
| 参照先の解決（純関数） | `src/mirror/resolveMirrorSource.ts`（Phase 5M-0 の `scanMirrorEmbeds.ts` から移設・拡張。旧所在からも再エクスポートしている） |
| UI | `view/OutlineTreeView.ts`（メニュー項目）、`main.ts`（コマンド、書き込みの共通処理 `applyMirrorCreateOutcome`） |

ミラーの正本は、本文中の埋め込み記法そのものである。独自のデータベースや隠れた状態は持たない。

## 2. UI

- **Outline Tree のコンテキストメニュー**に項目を追加した。対象の行は次のとおりである。
  - section 行
  - CompositeBlock に属さない list 行
  - standalone の callout／blockquote／fenced-code／table 行
  - 段落行

  CompositeBlock の親行・メンバー行と mirror 行には表示しない。

  項目名は、section 行では **「Create mirror above」**、それ以外では **「Create mirror below」** とした（§3-1）。

  その時点で拒否される項目は「— unavailable」と表示するが、クリックは可能であり、理由を Notice で示す。Phase 5E-Copy と同じパターンである。
- **コマンドパレット**には「Create mirror: insert embed below cursor block」（`create-mirror-below`）を登録した。対象はカーソル位置の最小ブロックであり、Move block と同じ `resolveMoveUnit` で解決する。
- 成功時には「ミラーを挿入した」旨を Notice で表示し、ブロック ID を新たに付与した場合はその ID も示す。Tree の選択は新しい埋め込み行に追従する。設定「Show mirror embeds in Outline Tree」がオンであれば、その行は Phase 5M-0 の `⧉ Mirror: …` 行として直ちに表示される。

### 対象ブロックの解釈

指示には「block-id を持たないブロックには表示しない」とあり、同時に「block-id がまだなければ自動付与する」ともあった。そこで、「ブロック ID を付けられる種別（fenced-code・table・callout・blockquote・list item・paragraph）には、ID の有無にかかわらず表示し、ない場合は自動付与する」と解釈した。表示しないのは、ID を付けられない行（CompositeBlock、list 内にネストした複合ブロック、ミラー行自身など）である。

## 3. 挿入位置

### 3-1. 見出し：見出し行の **直上** に挿入する（指示からの意図的な変更）

同じノートの中では、見出しの埋め込みを **その見出しの下** に置くことができない。見出しから、同レベル以上の次の見出しまでのすべての行はそのセクションに属する。そのため、「下」のどこに置いても、埋め込みは自分が埋め込むセクションの内部に入り、自己参照（循環）になる。Obsidian 上でも、セクションが自分自身を埋め込む状態になる。

指示どおり「下」に置いて循環として拒否すると、見出し行のメニュー項目は常に使えなくなる。そこで、セクションの外にある最も近い位置、すなわち見出し行の直上に置くことにした。項目名も実際の動作に合わせて「Create mirror above」とした。コマンドパレットの名前は指示どおりのままだが、カーソルが見出し行にある場合は同様に直上へ挿入する。直上の行は、直前のセクション（または文書冒頭）の内容になる。作成後は、Phase 5T の段落 D&D で任意の場所へ移動できる。

### 3-2. ブロック

| 種別 | 埋め込みの位置 |
| --- | --- |
| paragraph | 段落の直後 |
| callout／blockquote／fenced-code／table | ブロック直後の `^id` 行の直後（既存の `^id` 行があればその直後） |
| list item | その項目が属する **root リスト全体の直後**（空行で区切られた root 兄弟も同じリストとして扱う） |

list item についてこの位置にしたのは、リストの内部に置くと、リストが 2 つに割れるか、項目の継続行として取り込まれて自己参照になるためである。

### 3-3. 空行補完

Phase 5E-Copy の `ensureCopySeparation` を export して再利用した。中身は、D&D 実行関数と同じ `ensureBlankSeparation` に、リスト行の隣にも空行を入れる規則を加えたものである。リスト直後に空行なしで置いた埋め込み行は、そのリスト項目の遅延継続行になってしまうため、この追加規則が必要になる。

## 4. ブロック ID の自動付与

- 対象ブロックに ID がないときだけ付与する。見出しには付与しない。
- 形式は `^uo-` に小文字英数字 8 文字を続けたものである（`generateMirrorBlockId`）。
- 付与の位置は Obsidian の慣例に従う。
  - paragraph：最終行の末尾に ` ^uo-xxxxxxxx` を付ける（末尾の空白は 1 つに整える）。
  - list item：項目自身のテキストの最終行の末尾に付ける。継続行がある場合はその最終行であり、子リストの行ではない。
  - callout／blockquote／fenced-code／table：ブロックの後に空行を 1 行置き、単独行 `^uo-xxxxxxxx` を置く。
- 既存の ID は再利用する。paragraph・list item の行末 `^id` と、構造ブロック直後の単独 `^id` 行が対象である。
- **衝突の確認**：本文を組み立てた後に再パースし、新しい ID が `findBlockIdLines` でちょうど 1 行にあること、さらに埋め込み行以外の本文に `^id` の文字列が 1 箇所しかないこと（コード内も含む）を確認する。満たさない場合は ID を生成し直す（既定では最大 10 回）。それでも見つからなければ `mirror-id-collision` で拒否する。
- ID の付与と埋め込み行の挿入は、1 つの `LineEditOutcome` にまとめて返す。`applyLineEditOutcome` は変更範囲全体を 1 回の `replaceRange` で置き換えるため、**Ctrl+Z 1 回で両方がまとめて戻る**（テストで確認した）。

## 5. 参照先の解決（`resolveMirrorSource.ts`）

- **heading**：テキストが一致する **最初の** 見出しを参照先とする。比較の前に、Obsidian がリンクに含められない文字を除く。入れ子のパスにも対応している（Phase 5M-0 と同じである）。一致した見出しの数を `matchCount` として返し、2 以上なら呼び出し側が「同じテキストの見出しが複数あるため、最初の見出しを表示する」と Notice で警告する。
- **block-id**：`^block-id` を持つ最初の行が示すブロックを参照先とする。行末の ID ならその行を含むブロック（list item なら子を含む項目）、単独行の ID なら直前のブロックである。`matchCount` が 2 以上なら「ID が重複している」と警告する。
- 見つからなければ `{ status: "unresolved", reason: "not-found" }` を返す。
- 注意：同名見出しが複数あるとき、2 つ目以降の見出しの「上」に作ったミラーは直前の同名セクション（＝最初の一致先）の中に入るため、そのまま循環として拒否される。これは「最初の一致を使う」規則から直接出る結果であり、仕様どおりの拒否である（確認ノート #12）。
- 循環は `applyMirrorCycles` で判定する。これは Phase 5M-0 の `detectMirrorCycle` を呼び、循環上のミラーを `cycle` として付け直す関数である。`scanMirrorEmbeds` もこれを使うように書き換えた。

## 6. 作成直後の検証

作成するたびに、挿入後の本文を再パースして次のように判定する。

1. **構造の保存**：既存のすべての section・list ノード（種別・開始行・深さ）、複合ブロック（種別・範囲・editability）、CompositeBlock（メンバー構成）が、行のずれを除いて変化していないこと。新しく現れた構造は、挿入した行（埋め込み・`^id` 行・空行）の中だけであること。崩れていれば `mirror-structure-changed` で拒否する。
2. **ミラーとしての認識**：挿入した埋め込み行が、Phase 5M-0 の `scanMirrorEmbeds` によってその位置のミラーとして認識されること。
3. **循環の拒否**：新しいミラーが循環になる場合、または既存ミラーの連鎖を閉じて **それまで循環していなかった** ミラーが循環になる場合は、`mirror-cycle` で全体を拒否し、本文を変更しない。もともと存在する循環を、新しい無関係なミラーの責任にはしない。
4. **not-found と重複**：挿入は取り消さず、Notice で警告する（指示どおりである）。

## 7. 既存機能との関係

- **Phase 5E-Copy**：`pendingBlockCopy` を読みも書きもしない（テストで確認した）。行からコピー元への対応付け（`blockCopySourceRefForNode`）は、対象の行が同じなので再利用した。
- **読み取り専用の投影（5E-0／5M-0）**：新しい読み取り専用の例外経路は追加していない。メニュー項目は既存の section・list・standalone 複合ブロック・段落のメニューに加えただけであり、mirror 行・CompositeBlock 行には依然としてメニューがない。
- **既存テスト**：書き換えたのは `commandTable.test.ts` のコマンド ID 一覧に `create-mirror-below` を追加した 1 箇所だけである。メニュー項目は Phase 5E-Copy のコピー項目の直前に置いた。コピー項目がメニューの末尾にあることを確認する既存の配線テストは、変更せずにそのまま通過している。

## 8. テスト

`tests/phase5m1MirrorCreate.test.ts`（53 件）の内訳は次のとおりである。

- 挿入：種別ごとの位置、見出しの直上配置、リンク用に整えた見出し、入れ子の list item、継続行のある list item、空行で区切られた root 兄弟、frontmatter、末尾空白の処理。
- ブロック ID：形式、既存 ID の再利用 3 種、衝突時の再生成、コード内の同じ文字列との衝突、再生成の上限到達による拒否、一意性。
- 解決：重複見出しと `matchCount`、ID による解決、not-found、循環の付け直し。
- 警告：重複見出し、重複 ID、警告なしの通常ケース。
- 循環の拒否：既存ミラーとのループ、既存の循環を新しいミラーの責任にしないこと、入れ子セクション、root リストの後ろに置く list item、文書冒頭、長いループの閉鎖。
- 拒否される対象：CompositeBlock メンバー、list 内の callout、ミラー行、ID だけの段落、古くなった対象、未対応の種別、日英の理由文。
- 構造と Undo：既存行の保存、Tree への即時表示、3 種の作成がそれぞれ 1 回の `replaceRange` になり 1 回の Undo で完全に戻ること。
- 配線の静的チェック。

## 9. 後続（Phase 5M-2 以降）

- ミラー行からの参照先編集（Partial Edit への接続）と同期表示。
- 作成位置を指定する UI（Phase 5E-Copy のペーストと同様の「別の位置に作成」）。
- 他ノートへのミラーと、ミラー／コピーの区別の見せ方。
