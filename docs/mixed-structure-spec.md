# Mixed Structure 境界ルール仕様（Phase 4D）

見出し・段落・箇条書き list が連続する「mixed structure」に対して、move（`relocateSection` / `relocateListSubtree`）と Partial Edit Pane（`extractSubtreeText` / `applySubtreeEdit`）が「どの範囲を1つの subtree として扱うか」を定義する。

## 0. 結論（先に要約）

**Phase 4D の調査の結果、既存の `parser/parseDocument.ts` の range 算出ロジックは、下記のパターン A〜D すべてについて、そのまま望ましい境界ルールを満たしていることが確認された。** そのため、パーサ・`relocateSection.ts`・`relocateListSubtree.ts`・`edit/partialEdit.ts` のいずれにもロジック変更は行っていない。本ドキュメントは「ルールを新しく実装した」記録ではなく、「既存の挙動を仕様として明文化し、テストで固定した」記録である（`tests/mixedStructure.test.ts` が本ドキュメントの各パターンをそのまま検証している）。

唯一、仕様として明文化する過程で見つかった、意図的に対応しない既知の制限が1件ある（§5参照）。

## 1. 基本ルール

- **section subtree**: 見出し行から、次に現れる「同じか、それより浅いレベルの見出し」の直前までを含む。間に挟まる段落・list はすべて含む。これは Phase 1 以来の `closeSectionsDownTo` の既存挙動そのものであり、「段落を含めるかどうか」という問いは実質的に発生しない——section は見出しと見出しの間のテキストを丸ごと1つの単位として扱うためである。
- **list subtree**: list item 自身の行 + 配下の子 list（Phase 4A の `relocateListSubtree` が移動単位として使っている range と同一）。前後の独立した段落は含めない。
  - 「独立した段落」とは、その list item のマーカー列と同じか、それより浅いインデントで始まる非 list・非見出し行を指す。
  - list item のマーカー列より **深い** インデントで、直後（空行を挟んでもよい）に続く段落は、その item 自身の「継続行」として扱われ、subtree に含まれる（Phase 4B の list 項目本文 tooltip がすでに前提としている挙動と同一——`edit/listBodyRange.ts` 参照）。これは「段落を list に含めてしまうバグ」ではなく、Markdown の継続行として意図的に扱われるべきものである。

## 2. パターン別の境界

### パターン A: 見出し → 段落 → 箇条書き list

```
0: # H
1: Some paragraph.
2: - item1
3: - item2
```

| 対象 | 含める範囲 |
| --- | --- |
| section "H" | 行 0〜3（見出し + 段落 + list 全体） |
| list "item1" | 行 2 のみ（見出し・段落は含めない） |

### パターン B: 見出し → 箇条書き list → 段落

```
0: # H
1: - item1
2: - item2
3: (blank)
4: Trailing paragraph.
```

| 対象 | 含める範囲 |
| --- | --- |
| section "H" | 行 0〜4（末尾の段落まで含む） |
| list "item2"（最後の item） | 行 2 のみ（末尾の段落は含めない——段落の行はマーカー列と同じ列（列0）で始まるため、`closeItemsWithIndentAtLeast` によって item2 の range はその手前で閉じる） |

### パターン C: 段落 → 箇条書き list（見出しなし）

```
0: Leading paragraph.
1: - item1
2: - item2
```

| 対象 | 含める範囲 |
| --- | --- |
| section | 存在しない（見出しがないため） |
| list "item1" | 行 1 のみ（先頭の段落は含めない——段落を処理する時点ではまだどの list item も開始していないため、そもそも所有されようがない） |

### パターン D: 見出し → 段落のみ（list なし）

```
0: # H
1: Just a paragraph.
2: More paragraph.
```

| 対象 | 含める範囲 |
| --- | --- |
| section "H" | 行 0〜2（段落をすべて含む） |
| list | 存在しない |

## 3. move（relocateSection / relocateListSubtree）での確認

- `relocateSection` は section の range をそのまま1ブロックとして切り出して再挿入するため、パターン A/B/D のような「見出し＋段落（＋list）」は常に一体として移動する。段落だけを置き去りにすることはない。
- `relocateListSubtree` は list item の range のみを切り出すため、パターン A/B/C のいずれでも、隣接する段落を巻き込まずに item（＋配下の子 list）だけを移動する。
- list を section へ `inside` で drop した場合も、挿入位置は section 自身の root list 末尾（`ownContentInsertionLine`、Phase 4A で定義）であり、section 内の段落テキスト自体は一切書き換えられない。

（`tests/mixedStructure.test.ts` の `describe("relocateSection ...")` / `describe("relocateListSubtree ...")` がこれらを直接検証している。）

## 4. Partial Edit Pane での確認

- section を Partial Edit Pane にロードすると、パターン A/B/D のとおり段落・list を含む全文が読み込まれる。
- list item を Partial Edit Pane にロードすると、パターン A/B/C のとおり隣接する段落は含まれない。
- Apply 時の range 置換も、ロード時と同じ range（`extractSubtreeText` の再抽出）に対して行われるため、段落の巻き込み・置き去りは発生しない。

（`tests/mixedStructure.test.ts` の `describe("Partial Edit Pane on mixed structure")` が検証している。）

## 5. 既知の制限（意図的に対応しない）

**list item の間に、インデントされていない段落が直接割り込むケース**は、今回の4パターンには含まれておらず、意図的に対応しない。

```
0: # H
1: - one
2: Interleaved paragraph.
3: - two
```

この場合、`one` の range は行1のみで閉じ（段落が来た時点で `closeItemsWithIndentAtLeast` により即座に閉じられる）、`two` は新しい独立した list グループとして開始する。結果として `one` と `two` は兄弟（`prevSiblingId` / `nextSiblingId`）として連結されない——`move-block-up` / `move-block-down` で `one` と `two` を入れ替えることはできず、no-op になる。

これは「壊れている」のではなく、**「段落を挟んで list が分断された」ことをパーサが正直に表現した結果**である。無理に2つの list グループを1つの list として再結合するロジックを追加すると、他の（段落を挟まない）通常の list の挙動に影響するリスクがあり、このフェーズのスコープ（「段落を挟む段落を挟む・混在構造を持つ複雑な list/section 構造への対応可否を検討する」——Phase 4D 自体の元々の TODO 項目）を超える。ユーザーへの影響は「その特定の組み合わせでは move が効かない」に留まり、誤った結果を返すよりは安全である（`tests/mixedStructure.test.ts` の `describe("known limitation ...")` で挙動を固定し、将来の変更が意図せずこれを変えてしまわないようにしている）。

## 6. 今回のフェーズで扱わないもの

- 段落専用ノードの追加（段落を独立した drag & drop / Partial Edit Pane 対象にはしない）。
- 引用（`>`）・code fence が list や見出しと複雑に入り混じるケースの完全対応。
- 上記§5の「段落による list 分断」を自動的に解決する機能。
- fold-state の永続化・同期（Phase 4E）。
- ノード単位の履歴・diff（Phase 5 以降）。

## 7. 安全側の方針（変更なし）

unsafeIndent（タブ／スペース混在インデント）を持つ list item は、mixed structure の内部にあっても従来どおり move（`relocateListSubtree`）・Partial Edit Pane（`extractSubtreeText` / `applySubtreeEdit`）のいずれからも拒否される。この判定は section や周囲の段落の有無に影響されない——同じ section 内に安全な list item と unsafeIndent な list item が混在していても、安全な方の操作は妨げられない（`tests/mixedStructure.test.ts` の `describe("unsafe mixed structure ...")` で確認している）。

## 8. 区切り線（thematic break, `---`）の Outline Tree 表示 — 方針A（非表示・現状維持）に決定（2026-08-12）

`---` は Markdown 上、文脈によって3通りの異なる意味を持つ（thematic break / Setext H2 の下線 / YAML frontmatter の区切り）。この曖昧さが `parser/parseDocument.ts`（section/list の唯一の権威パーサ）の line-ownership を壊していないかを、`tests/thematicBreakSafety.test.ts` の12ケースで直接検証した。

**(a) 検証結果の結論**: 空行の後・非空行の段落直後（Setext 形）・ファイル先頭（frontmatter 形）・list item 直後（インデントあり／なし）・見出し直後（深い見出しが続く場合／同レベルの見出しが続く場合）・frontmatter 直後・fenced code block 内・`- - -`（スペース入り）のいずれの位置でも、`---` が誤って見出し化される、list marker として誤認される、line ownership が失われる、二重所有になる、隣接ノードの range を破壊する、といった不具合は一件も見つからなかった。`parser/parseDocument.ts` は ATX 見出し（`#`〜`######`）のみを認識する設計であり、Setext 見出し（`===` / `---` 形式）を意図的にサポートしない——これは今回新たに見つかった不具合ではなく、パーサの設計時点からの既知のスコープ外機能である（`TODO.md` の「パーサ」節に元々記載されている未対応項目と同一）。

**(b) 表示方針**: 上記の安全性は確認できたが、Outline Tree に thematic break を独立ノードとして表示する対応（方針B）は**採用しない**。現状どおり非表示のまま据え置く（方針A）。理由は以下の4点：

1. **親子関係の決定が曖昧**: thematic break は見出しでも list item でもないため、Tree 上でどのノードの子として配置すべきかの基準が一意に定まらない（直前の section の子か、独立した兄弟ノードか、といった設計判断が新たに必要になる）。
2. **ナビゲーション上の価値が低い**: thematic break はドキュメントの構造的な区切りであり、見出しや list item のようにジャンプ先として意味のある単位ではない。Tree に載せてもユーザーの移動・編集操作の対象にはならない。
3. **read-only 専用ノード種別の新設コストが発生**: 現在の `tree/buildOutlineTree.ts` は section・list（および複合ブロックの構成員）のみを投影する設計であり、thematic break を表示するには新しい read-only ノード種別と、それに対する防御的コード（move 不可・rename 不可・fold 不可などの各所でのガード）が必要になる。表示価値に対してコストが見合わない。
4. **視覚的な曖昧さ**: Tree 上で thematic break を表示すると、同じ `---` に由来する（今回パーサが意図的に非対応とした）Setext 見出しとの区別がユーザーから見て付きにくく、かえって「見出しなのか区切りなのか」という誤解を招きかねない。

**再検討のトリガー**: 上記は現時点での判断であり、恒久的な禁止ではない。ユーザーから具体的な表示要望（concrete request）が出た場合は、この方針を再検討する。

（安全性検証そのものは `tests/thematicBreakSafety.test.ts` が固定している。本節は「表示するかどうか」という方針決定の記録であり、パーサ自体への変更は一切行っていない。）
