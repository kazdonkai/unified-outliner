# Phase 5E-0.5 設計メモ：新規コード/表ブロック挿入の共通フレームワーク

Phase 5E-0（`docs/phase5e0_fenced-code-table-tree-projection-design-memo.md`）で実装した、fenced code block / Markdown tableの読み取り専用Outline Tree投影を前提とし、その投影されたTree行を起点とした「新規ブロック挿入」の共通フレームワークを設計する。本フェーズは設計仕様・型定義・スタブ実装・テストのみを対象とし、挿入操作の実装本体・UI接続（右クリックメニュー、コマンドパレット）はPhase 5E-1以降に委ねる。

対応する型定義は `src/tree/insertionFramework.ts`、テストは `tests/phase5e05InsertionFramework.test.ts` に置く。

## §1. 挿入位置の定義

Outline Tree上のfenced-codeまたはtableノード（`OutlineTreeComplexMemberNode`、`id`は対応する`ComplexBlockInfo.id`と同一）を対象に「前に挿入」（`InsertionPosition: "before"`）「後に挿入」（`"after"`）を実行する場合、Markdown本文上の挿入先行番号は以下の規則で定める。

- **fenced-codeの「前に挿入」**：対象ブロックの`ComplexBlockInfo.range.startLine`（開始フェンス行、バッククォートまたはチルダ3つ以上の行）の直前の行を挿入先とする。
- **fenced-codeの「後に挿入」**：対象ブロックの`ComplexBlockInfo.range.endLine`（終了フェンス行。`scanFencedCodeBlocks`が`fenceChar`一致で判定する行）の直後の行を挿入先とする。
- **tableの「前に挿入」**：ヘッダー行（`range.startLine`、`splitTableRow`で解析される最初の行）の直前の行を挿入先とする。
- **tableの「後に挿入」**：最終データ行（`range.endLine`）の直後の行を挿入先とする。区切り行（ヘッダー直後の`---`行）はヘッダーの一部として扱い、単独の挿入先候補にはしない。

### 親がsectionの場合とlist itemの場合の違い

- **親がsection（`ComplexBlockInfo.parentId`が`sec-N`形式、またはnull＝見出しなしノート先頭）の場合**：挿入するテキストの先頭インデントは常に0列とする。既存の段落/callout/blockquoteのstandalone投影が同じsection直下に混在する場合と同じ扱いであり、インデント計算は不要である。
- **親がlist item（`parentId`が`li-N`形式）の場合**：挿入するテキストは、親list itemの`ListBlockNode.indentColumns`（マーカーの表示上の開始列）を基準に、既存のcontinuation行と同じ本文開始列（マーカー幅＋マーカー後の空白を加えた列）に揃える。この基準列の具体的な算出（マーカー文字列長＋区切り空白の扱い）は、既存の`edit/`配下のlist continuation行インデント算出ロジックを再利用するものとし、本フレームワーク独自の算出ロジックを新設しない（Phase 5E-1での実装時に参照する）。

### 挿入先が確定できない場合

以下のいずれかに該当する場合、`resolveInsertion`は`{ ok: false, reason }`を返し、挿入を拒否する。

- 対象ノードの`ComplexBlockInfo.editability`が`"supported"`以外（未閉鎖fence・malformed table・ambiguousな境界など）である場合。`reason`には`ComplexBlockInfo.reason`（診断メッセージ）をそのまま転用する。
- 対象ノードの直前・直後の行が別の未閉鎖fenced-code blockの内部にある等、挿入先行自体の帰属が確定できない場合。
- `targetNodeId`に対応する`ComplexBlockInfo`が現在のドキュメントに存在しない場合（Tree行が古い/該当ノードが削除済みなど）。

いずれの場合も、rootへの誤挿入や近い行への当て推量は行わない——既存の`ComplexBlockInfo.reason`保持の方針（Phase 5C以来の一貫した規約）に倣う。

## §2. 挿入種別の定義

挿入可能なブロック種別（`InsertableBlockKind`）を以下の5種とする。

| 種別 | 説明 | 実装フェーズ |
|---|---|---|
| `"fenced-code"` | 空のfenced code block（デフォルト言語は空文字列、\`\`\`\n\`\`\`という最小構成） | 本フレームワークの範囲内（型定義のみ、実体はPhase 5E-1） |
| `"fenced-code-mermaid"` | 情報文字列が`mermaid`のfenced code block | 同上 |
| `"table"` | 最小構成のMarkdown table（ヘッダー1行＋区切り1行＋データ1行） | 同上 |
| `"heading"` | 見出し | **既存の section 挿入処理に委ねる**（本フレームワークからは型として参照するのみで実装しない） |
| `"list-item"` | リスト項目 | **既存の list 挿入処理に委ねる**（同上） |

`"fenced-code"`と`"fenced-code-mermaid"`は、`model/complexBlock.ts`の`ComplexBlockKind`においてはいずれも単一の`"fenced-code"`である（Phase 5C以来、Mermaidを独立したkindとして扱わない方針——同ファイルの`infoString`に関する既存のdoc commentを参照）。本フレームワークで両者を別の`InsertableBlockKind`値として分けているのは、あくまで挿入時のデフォルト生成テキスト（情報文字列の有無）が異なるためであり、スキャナー側のkind分類を変更する意図は一切ない。

`"heading"`と`"list-item"`を`InsertableBlockKind`に含めているのは、将来のUI層が「このfenced-code/table行の前後に見出し／リスト項目を挿入する」という操作を同じ`InsertionRequest`の形で表現できるようにするためである。ただし、これらの解決は既存の見出し挿入・リスト挿入の処理系にそのまま委譲する方針とし、本フレームワークが独自に再実装することはない。

## §3. 挿入操作の安全規則

挿入後に隣接するブロックの境界を壊さないことを保証するため、以下の規則を実装（Phase 5E-1以降）が満たすこと。

- **fenced-codeブロックの境界保護**：新規fenced code blockの終了フェンスと、直後の既存ブロック開始行との間に、空行を最低1行確保する。「前に挿入」の場合も同様に、直前の既存ブロック終了行と新規ブロックの開始フェンスとの間に空行を最低1行確保する。
- **tableの境界保護**：新規tableと直前・直後の既存ブロックとの間に、空行を最低1行確保する（Markdown tableの構文上、直前が空行でない場合は先行する段落の一部と誤認識されるリスクがあるため）。
- **list itemの子として挿入する場合のインデント**：§1で定めた本文開始列に、挿入するfenced-code/tableの全行（フェンス行・本文行・table各行）のインデントを揃える。indentColumnsが不正確な結果（タブとスペースの混在等、`ListBlockNode.unsafeIndent`が真の場合）を含む親には挿入を拒否する。
- **拒否条件**：以下のいずれかに該当する場合、挿入操作全体を拒否し、原文を変更しない。
  - 挿入先の直前または直後に、未閉鎖のfenced code blockが存在し、境界が確定できない場合。
  - 挿入先の直前または直後に、不正な区切り行を持つmalformed tableが存在し、境界が確定できない場合。
  - 親のlist itemが`unsafeIndent: true`である場合。

これらの規則はいずれも「壊せる境界が1つでもあれば、挿入全体を拒否する」という、Phase 5C以来一貫している安全側優先の方針に従う——部分的な挿入や、疑わしい行を跨いだ挿入は行わない。

## §4. UIとの接続方針（本フェーズでは実装しない）

- 右クリックメニューへの追加、コマンドパレットへの追加は、Phase 5E-1以降で行う。本フェーズではUIからの呼び出し経路を一切実装しない。
- 本フレームワークは、UI側から`InsertableBlockKind`と挿入位置（`"before"`/`"after"`）と対象ノードID（`targetNodeId`）を受け取り、挿入先行番号（`insertAtLine`）と挿入テキスト（`insertText`）を返す、副作用のない純粋関数（`resolveInsertion`）として設計する。
- 副作用（Vaultへの書き込み、Editorの更新）は、`resolveInsertion`の呼び出し元の責任とする。本フレームワークはVault APIにもEditor APIにも一切依存しない。
- `resolveInsertion`の第3引数`outlineTree`は、本フェーズでは`unknown`型とする。実装フェーズ（Phase 5E-1以降）で必要となる具体的な型（`tree/buildOutlineTree.ts`の`OutlineTreeNode`の一部、またはnode-by-idルックアップを含む形）は、今回のスタブ設計では未確定のまま残し、実装時に確定させる。

## 今回スコープ外（Phase 5E-1以降へ残置）

- `resolveInsertion`の実装本体（現時点ではスタブとしてthrowするのみ）。
- 右クリックメニュー・コマンドパレットからの呼び出し経路。
- Vaultへの実際の書き込み処理、Editorへの反映。
- `"heading"`/`"list-item"`挿入の実処理（既存の見出し/リスト挿入処理への委譲方法の具体化を含む）。
- Table Mode、cell編集、Partial Editからの挿入起動。

## 変更していないもの

Phase 5E-0で追加した以下のファイル・設定は、本フェーズで一切変更していない。

- `src/tree/buildOutlineTree.ts`のfenced-code/table投影ロジック
- `src/view/OutlineTreeView.ts`のkindガード（Phase 5E-0で追加した1箇所）
- `src/tree/resolveCurrentPositionNodeId.ts`のfenced-code/table分岐
- `src/settings.ts`・`src/settingsDefaults.ts`・`src/i18n.ts`の既存エントリ（`showFencedCodeInOutline`/`showTablesInOutline`を含む）

既存テスト（3012件）も1件も変更・削除していない。
