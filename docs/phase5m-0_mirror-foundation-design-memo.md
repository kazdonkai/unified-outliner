# Phase 5M-0: ミラーの基盤型定義と読み取り専用 Outline Tree 投影 — 設計メモ

## 1. 位置づけとスコープ

Phase 5M は、単一ノート内のミラー（参照・投影）機能である。Phase 5E-Copy のコピーが「独立した複製」であるのに対し、ミラーは参照先を投影するものであり、参照先を編集すればミラー側の表示も変わる。Phase 5M-0 は最初の段階として、以下だけを実装する。

1. ミラーの型定義（`src/mirror/mirrorTypes.ts`）
2. 同一ノート内 embed 記法のパーサー（`src/mirror/parseMirrorEmbed.ts`）
3. 循環参照の検出（`src/mirror/detectMirrorCycle.ts`）
4. Outline Tree への読み取り専用の投影（`src/mirror/scanMirrorEmbeds.ts`、既定オフの設定付き）

利用者が操作できる新機能（ミラーの編集・同期・コピーとの区別の UI）は追加しない。これらは Phase 5M-1 以降で扱う。

**ミラーの正本は本文中の Obsidian embed 記法そのもの**であり、独自のデータベースやキャッシュファイルは持たない。すべての型は、section・list ノードや複合ブロックと同様に、パースのたびに現在の本文から導出する。

## 2. 型（`mirrorTypes.ts`）

| 型 | 内容 |
| --- | --- |
| `MirrorKind` | `"heading"` と `"block-id"` の 2 種のみである |
| `MirrorSource` | 参照先を表す。`notePath` と `kind` を持ち、heading なら `headingText`（入れ子のパスの最後の要素）と `headingPath`（全要素）、block-id なら `blockId`（`^` を除く）を持つ。`lineRange` は解決後の参照先範囲で、未解決のときは `null` である |
| `MirrorNode` | Tree に投影するミラー行の抽象である。`id`・`kind`・`source`・`embedLine`（embed 行自身の行番号）を持つ |
| `MirrorResolutionResult` | 解決結果を表す判別共用体である。`resolved`（`lineRange` が確定）、`unresolved`（`reason: "not-found"`）、`cycle`（`cycle`: 循環に含まれる MirrorNode id の列）の 3 種がある |

他ノートのミラー（`![[Other#Heading]]`）とファイル全体の埋め込み（`![[Other]]`）は型の対象外とした。`notePath` は、後続フェーズで範囲を広げても型を作り直さずに済むように置いてある。5M-0 では常に embed 自身が書かれたノートを指す。

## 3. パーサー（`parseMirrorEmbed(line, notePath)`）

純関数であり、Obsidian API には依存しない。例外も投げない。受け付けるのは「1 行全体が 1 つの embed で、target が `#` で始まる」場合だけである（前後の空白は許す）。

| 入力 | 結果 |
| --- | --- |
| `![[#見出し]]` | heading（`headingPath: ["見出し"]`） |
| `![[#親#子]]` | heading（`headingPath: ["親","子"]`、`headingText: "子"`） |
| `![[#^block-id]]` | block-id（id は `[A-Za-z0-9-]+`） |
| `![[#見出し\|別名]]` | 別名は受け付けたうえで無視する |
| `![[Note#H]]`・`![[Note#^id]]`・`![[Note]]` | null（他ノート・ファイル全体） |
| `[[#H]]`、空の target、不正な id、空のパス要素、`#A#^id`、前後に文字列がある行、1 行に複数の embed、リスト項目内の embed | null |

## 4. 参照先の解決と循環検出

### 解決（`resolveMirrorSource`）

- **heading**：文書順で最初に一致した section の範囲（部分木全体）に解決する。比較の前に、Obsidian がリンク中で扱えない文字（`# | ^ : % [ ] \`）を空白に置き換え、空白を詰める。したがって見出し「Alpha: Notes」は `#Alpha Notes` で一致する。入れ子のパスは、手前の要素が祖先の見出しに順番どおり含まれていることを条件とする。
- **block-id**：frontmatter と fenced code の外で、行末に `^id` がある最初の行を探す。
  - `^id` だけの独立した行は、Obsidian の慣例に従って、直前の空でない行を含むブロックを指すものとして扱う（表・リスト・引用に付ける場合）。
  - その行を含むリスト項目があれば、最も深い項目とその子を範囲とする。
  - リスト項目がなければ、その行を含む最小の supported な複合ブロックを範囲とする。
  - いずれもなければ、その行自身を範囲とする。

### 循環検出（`detectMirrorCycle`）

ある embed E の参照先範囲に別の embed F の embed 行が含まれるとき、E→F の辺を張る（E を描画すると F も描画されるため）。この有向グラフで強連結成分を求め、要素が 2 つ以上の成分、または自己辺を持つ要素を循環とする。最も典型的なのは、自分を含む section を埋め込む `![[#自分の見出し]]` である。

指示では「単純な訪問済みセット」で足りるとされていた。訪問済みセットと DFS スタックによる 1 回の走査（Tarjan 法）で実装したのは、単純な後退辺の検出だけでは、処理済みのノードを経由してたどり着く成分のメンバーに印を付け損なう場合があるためである（該当ケースをテストで固定した）。計算量は線形である。

入力は `MirrorSource[]` ではなく `MirrorNode[]` とした。辺を張るには embed 行自身の位置（`embedLine`）が必要であり、参照先だけを表す `MirrorSource` にはその情報がないためである。

## 5. Outline Tree への投影

Phase 5E-0（fenced-code・table の読み取り専用投影）と Phase 5P-3（段落行）と同じパターンに従った。

- **既存パーサーの拡張方法**：`![[#...]]` の行は、既存の `scanComplexBlocks` がすでに 1 行の段落として認識している。そこで `parseDocument`・`scanComplexBlocks` は変更せず、その上に `scanMirrorEmbeds` を重ねた。対象とするのは、段落のうち supported・1 行・リスト項目に属さないもので、かつ `parseMirrorEmbed` が解析できたものである。設定がオフのときは解析処理も一切変わらない。
- **設定**：「Show mirror embeds in Outline Tree」（`showMirrorEmbedsInOutline`、既定 false）。`buildOutlineTree` の `mirrors` オプションは、存在すること自体が有効化の合図である（`paragraphs`・`standaloneComplexBlocks` と同じ）。オフのときの Tree は従来と完全に同一である（テストで確認した）。
- **ノード種別**：新しい独立種別 `OutlineTreeMirrorNode`（`kind: "mirror"`、`id: tree-mirror:N`）を追加した。paragraph や complex-member を流用しなかったのは、既存の種別判定の分岐（コンテキストメニュー、改名、D&D、Partial Edit、Phase 5E-Copy のコピー／ペースト項目）がどれも `"mirror"` に一致しないため、書き込み能力が偶然付与されることが構造上ありえないからである。さらに、`collectReadOnlyOutlineNodeIds` の許可リストに明示的に加えた。
- **表示**：ラベルは `⧉ Mirror: <見出し（入れ子は「›」区切り）または ^block-id>` である。未解決のものには「（参照先なし）」、循環しているものには「（循環参照）」を付け、テーマのエラー色で表示する。
- **重複の排除**：mirror 行として投影した embed 行は、段落行の投影から除外する（同じ行を 2 回表示しない）。段落の順序番号（view id）はすべての段落について計算するため、設定を切り替えても他の段落行の id は変わらない。
- **ジャンプ**：クリック（と Enter）は、参照先の先頭行（`targetLine`）へカーソルを移す。未解決・循環のときは embed 行自身へ移す。`line` は embed 行のままとし、Tree 上の並び順とカーソル追従のハイライトに使う（カーソルが embed 行にあるときは mirror 行が強調される）。
  - **［Phase 5M-2 追加修正で変更］** クリックと Enter は embed 行自身へ移すように改めた。参照先へは、コンテキストメニューの「参照先へ移動」、デスクトップのダブルクリック、モバイルでの選択済みの行の再タップで移動する。理由と詳細は `docs/phase5m-2_mirror-ops-design-memo.md` の §9 を参照すること。
- **fold-state**：mirror 行には fold identity を与えない（段落行と同じ扱いである）。設定を切り替えても、既存ノードの fold identity は変化しない（テストで確認した）。
- **Phase 5E-Copy との独立性**：ミラーの状態は設定と投影だけで構成され、`pendingBlockCopy` を読みも書きもしない。mirror 行にはメニューがないため、ペースト先にもならない。

## 6. テスト

`tests/phase5m0MirrorFoundation.test.ts`（60 件）の内訳は次のとおりである。

- パーサー 24 件（受理 7 件・拒否 17 件）
- 循環検出 9 件（自己参照、相互参照、3 段の循環、循環へ流れ込むだけの連鎖、非循環の入れ子、未解決、処理済みノード経由の成分）
- 解決 9 件（部分木、入れ子のパス、特殊文字の正規化、インライン id、リスト項目 id、独立 `^id` 行と表、未解決、コード内の id、ラベル）
- 走査 5 件
- Tree 投影 8 件（既定オフ、オフ時の同一性、配置、段落との重複排除、段落 id の安定性、読み取り専用と fold identity、カーソルによるハイライト、日本語ラベル）
- 配線の静的チェック 5 件

## 7. 後続（Phase 5M-1 以降）

- ミラー行からの参照先編集（Partial Edit への接続）と、同期の見せ方。
- コピー（独立した複製）との区別の UI。
- リスト項目内・段落中に書かれた embed、他ノートへのミラー。
- 同じ名前の見出しが複数あるときの扱い（現在は Obsidian と同じく最初の一致を採用している）。

## 8. 実機での目視確認（任意）

5M-0 は表示だけの変更である。確認する場合は、`ipad-test/Test/mirror-foundation-verification.md` を開き、設定「Show mirror embeds in Outline Tree」をオンにする。そのうえで、次の 3 点を確かめる。

- Mirror 行が表示されること（未解決・循環の行は赤字）。
- 行をクリックすると参照先へ移動すること（Phase 5M-2 の追加修正以降は、クリックで embed 行へ、ダブルクリック等で参照先へ移動する）。
- 設定をオフにすると、従来どおり段落として表示されること。
