# Phase 5C — 複合 Markdown ブロック: block model と Tree 表示の分離仕様

作成日: 2026-08-08
対象: `src/model/complexBlock.ts`, `src/parser/complexBlocks.ts`, `tests/complexBlocks.test.ts`
状態: scanner / 診断基盤（本ドキュメントが指す範囲）は callout・blockquote・fenced-code（Mermaid 含む）・table・paragraph の5 kind について完了。Tree 表示・編集統合（Phase 5D 以降）は未着手。

## 0. 目的

Phase 5C は当初「callout と fenced code / Mermaid の原子的ブロック化」として計画されたが（`phase5-implementation-plan.md` の Phase 5C-1〜5C-3 参照）、実装を進める過程で「複合ブロックを安全に認識・分類する基盤」と「それを Tree・Partial Edit へ実際に統合する作業」は性質もリスクも異なることが明確になった。本ドキュメントは、この2つを明示的に別工程として分離し、現時点でどこまでが完了しているかを固定する。

## 1. 工程の分離

Phase 5C は以下の2つの独立したサブフェーズとして進める。

| サブフェーズ | 内容 | 状態 |
| --- | --- | --- |
| 5C（scanner / 診断基盤） | `ComplexBlockKind` の型定義、境界検出、editability 判定、diagnostics、`mergeBlockRangesSafely` による衝突解消。Obsidian 非依存の純粋関数のみ。 | **完了**（本ドキュメント時点） |
| 5D 以降（Tree 表示・編集統合） | Tree でのアイコン・displayLabel 表示、move / indent / outdent / drag & drop、hoist、Partial Edit Pane への接続、実際の書き戻し。 | **未着手** |

5C（scanner / 診断基盤）は「認識・境界・可否判定」を完成させることをゴールとし、複合ブロックの構造操作（実際の編集・移動）は一切含まない。この境界は `src/parser/complexBlocks.ts` のトップレベル doc comment、および `src/model/complexBlock.ts` の doc comment に明文化されている。

## 2. 5C（scanner / 診断基盤）の完了範囲

以下の時点をもって、5C の scanner / 診断基盤は完了とする。

- `ComplexBlockKind` が `"callout" | "blockquote" | "fenced-code" | "table" | "paragraph"` の5種を含む。
- callout と blockquote が同一の quote-run 走査（`scanQuoteRuns`）から分類され、範囲が構造的に重複しない。
- fenced-code の境界は `ParsedDocument.codeBlockLines`（`parser/parseDocument.ts` が既に計算している既存の正）をそのまま用い、独自の全量 fence parser を導入しない。
- table は header + delimiter 行の組み合わせでのみ認識し、列数不一致は `malformed-table` diagnostic を伴う `ambiguous` とする。
- paragraph は診断専用の catch-all として、他のどの kind とも重複してよい（`mergeBlockRangesSafely` が優先順位に基づき解消する）。
- `mergeBlockRangesSafely` の優先順位は `callout > blockquote > (fenced-code, table) > paragraph` を満たす。
- 境界不確実（owner 不一致、既存 section/list 境界の横断、未終端 fence、他 scanner との衝突）は必ず `ambiguous` とし、`supported` にはしない。
- nested callout・quote 内の未対応複合構造は `unsupported` + `unsupported-callout-nesting` diagnostic とし、`ambiguous`（境界自体が不確実）とは意味を区別する。

この時点を「5C scanner 基盤の完了」とし、以降 blockquote 以外の新しい kind（例: 定義リスト、footnote 等）を追加する場合は、本ドキュメントを更新したうえで新しい小チケットとして扱う。

## 2.1 Phase 5C-1A/1B（section/list block-level delete/insert 共通基盤）との関係

Phase 5C（scanner / 診断基盤）の完了直後、Phase 5D の callout/blockquote 個別対応に直行する前に、既存の `section`/`list`（`BlockNode`）に対する Outline Tree からの delete/insert 共通基盤を Phase 5C-1A/1B として先に実装した（`src/edit/deleteBlock.ts`、`src/edit/insertBlock.ts`）。

この基盤は selection 解決・書き戻し・削除後の no-auto-merge・選択復帰・explicit heading level 選択・`contentColumn` 基準のインデント計算という、複合ブロック（callout/blockquote/fenced-code/table）の Tree 編集を将来実装する際にも共通して必要になる部分を、`ComplexBlockInfo` を一切対象にせず section/list だけで先に確立したものである。Phase 5D 以降で複合ブロックの Tree 表示・delete/insert を実装する場合、この基盤（特に `commands/applyLineEditOutcome.ts` の `newCursorCh` 拡張と `dispatchAndApply` の再利用パターン）をそのまま再利用できる設計になっている。ただし複合ブロック自身の delete/insert 純粋関数（境界検証・拒否条件を含む）は本ドキュメント・Phase 5C-1A/1B のいずれにも含まれておらず、Phase 5D 以降で別途設計・承認を経て実装する。

paragraph は Phase 5C-1A/1B の Tree 挿入対象からも除外されている（§4 の既存方針を踏襲）。

## 2.2 Outline Tree inline rename（section/list ラベルの直接編集）との関係

Phase 5C-1A/1B の delete/insert に続き、Outline Tree から直接ノードの見出し/項目テキストを編集できる inline rename を追加実装した（`src/edit/renameBlock.ts`、`src/view/OutlineTreeView.ts` の「Inline rename」節）。これは Phase 5C-1A/1B と同じく、複合ブロック（callout/blockquote/fenced-code/table）には一切触れず、既存の `section`/`list`（`BlockNode`）のみを対象にした、Phase 5 が目指す「Tree 上での直接編集」体験の一部である。

- **起動方法の位置づけ**: 主導操作は Tree 行そのものへの **ダブルクリック** であり、コマンドパレットに新しい rename コマンドは追加していない。F2 キーと右クリックメニューの「Rename」は、あくまでダブルクリックの補助手段（Explorer/VS Code 等の一般的な tree/list ウィジェットの rename 慣習に合わせたもの）であり、ダブルクリックを置き換えるものではない。ノードを Tree から新規挿入した直後は、可能であれば自動的に同じ rename UI が起動し、挿入直後にそのまま名前を確定できる。
- **単一クリックへの影響なし**: 単一クリックによる選択・本文エディタへの同期・ジャンプという既存の挙動は一切変更していない。ダブルクリックのリスナーは行の折りたたみアイコン（`collapse-icon`）とは兄弟要素の `tree-item-inner` にのみ張られており、構造上ダブルクリックが fold トグルやドラッグ開始と衝突しない。
- **rename の対象範囲**: section の見出しテキスト、および list item の項目テキストという、1行内の単一ラベルのみが対象である。見出しレベルの変更、リストマーカー種別の変更・付け替え・インデント変更は対象外であり、`edit/renameBlock.ts` の `renameSection`/`renameListItem` は行内の「`#` ランと直後の空白」または「インデント・マーカー・マーカー後の空白」を一切変更せず、その後ろのテキスト部分のみを置換する。
- **callout/blockquote 等のラベル編集は対象外**: fenced-code/table/paragraph も含め、複合ブロックのラベル編集は本チケットの対象外であり、Phase 5D 以降で改めて設計・承認を経て実装する（§3 の既存方針をそのまま踏襲）。
- **空ノードの扱い**: Tree 表示上の `(無題の見出し)` / `(空の list 項目)` というフォールバック文字列は、rename UI が開く際の初期値には一切使われない（常に実際の Markdown テキストを初期値とする）。空文字列へのリネームは許容され、その場合も見出しの `#` ラン、あるいはリスト項目のインデント・マーカー・区切り空白は保持されたまま、テキスト部分だけが空になる。
- **不確実な境界での commit 拒否原則**: rename の commit は、Phase 5C-1A/1B の delete/insert と同じく、確定操作の直前に必ず最新のドキュメントからノードを再解決し、ノードが消失している・種類が変わっている・見出しレベルが変わっている・リストのマーカー/インデント/`contentColumn` が変わっている・複数カーソルである・アクティブなエディタがない、のいずれかに該当する場合は commit を拒否し、原文は一切変更せず、rename 用の `<input>` を開いたままにして Notice 等で理由を通知する（`commands/applyLineEditOutcome.ts` の `NOOP_MESSAGES` に `type-changed`/`heading-level-changed`/`list-syntax-changed`/`contains-newline`/`no-active-editor` を追加）。この「境界が不確実なら commit せず原文を変更しない」という原則は、Phase 5C-1A/1B の delete/insert や既存の move/indent と完全に同じである。

将来 callout/blockquote 等のラベル編集を実装する場合、rename トリガー層（ダブルクリック/F2/コンテキストメニュー）・UI 層（`<input>` 生成・Enter/Escape/blur・focus 管理）・commit service（再解決・単一の Editor API 呼び出し・成否判定）・Tree 再描画/選択復帰の4層はそのまま再利用できる設計になっている。再利用してはならないのはテキストアダプタ層（`renameSection`/`renameListItem` に相当する、種別ごとの抽出・置換範囲計算・構造再検証ロジック）のみであり、これは種別ごとに専用モジュールとして分離したまま、共有 UI 層には決して混在させないこと。

**実機受入で判明し修正した3件の trigger 層バグ（重要）**: 自動テスト（tsc/vitest/build）はすべて通過していたが、Method Vault での実機ダブルクリック操作では rename の `<input>` が開いた直後に消える／どこにも見えない状態になる不具合が3件見つかり、いずれも「既存の Tree 再描画経路が `renameState` を見ずに `<input>` を巻き込んで作り直してしまう」という同じ性質の問題だった。

1. `onOpen()` の `treeRootEl` に張った `"blur"` リスナー: `beginRename` が `<input>` を作って `.focus()` した瞬間、`<input>` は `treeRootEl` の子孫であるにもかかわらず `"blur"`（`"focusout"` と違い非バブリング）が `treeRootEl` 自身に発火し、ガード無しで `renderTree()` を呼んで直後に `<input>` を消していた。`refresh()` 側にはすでに `renameState` ガードがあったが、この `"blur"`/`"focus"` リスナー自身には無かった。
2. `jumpToLine()`（単一クリックの選択・本文同期処理）が無条件に `renderTree()` を呼んでいた: 現実の1回のダブルクリックは「click → click → dblclick」という3イベントの並びであり、1回目・2回目のクリックそれぞれが `jumpToLine()` を経由して Tree 全体を再描画する。これ自体は rename 開始前なので無害だが、防御的に同じ `renameState` ガードを追加した。
3. **本質的な原因**: `renderNode()` 内の `dblclick` リスナーが `beginRename(node.id, kind, innerEl, selfEl)` を、そのリスナーがクロージャで捕まえていた `innerEl`/`selfEl`（＝リスナー登録当時の DOM 要素）をそのまま渡して呼んでいた。実機のダブルクリックでは、1回目・2回目のクリックそれぞれが `jumpToLine()` 経由で Tree を再描画するため、`dblclick` が実際に発火する頃には、リスナーが閉じ込めていた `innerEl`/`selfEl` は既に古い（=もう `document` に接続されていない）描画結果を指していることがあった。その結果、`beginRename` は「もう画面上のどこにも存在しない要素」の中に `<input>` を作ってしまい、上記1・2のガードを足しても rename が全く見えないままだった。修正は、`dblclick` リスナーを `beginRename(...)` 直接呼び出しから `beginRenameForNode(node.id)` 呼び出しに変更しただけ——F2・コンテキストメニュー・挿入直後の自動 rename が既に使っている「nodeId から DOM 要素を都度re-resolveする」経路にダブルクリックも合流させた。これにより、クロージャに古い DOM 参照を持たせず、呼び出された瞬間の最新の行要素に対して常に rename が開始されるようになった。

この3件はいずれも自動テストでは検出できない（DOM 実装のタイミングに依存する）性質のバグであり、Method Vault 実機でのダブルクリック検証を通じてのみ発見できた。修正後、Method Vault 上でダブルクリック・F2・右クリック「Rename」のいずれも `<input>` が正しく表示・編集・確定できることを確認済み。

## 2.3 Outline Tree モバイル操作体系（タップ／長押し／メニュー）との関係

inline rename（§2.2）で確立した rename トリガー層に、モバイル環境向けの入口を追加した（`src/view/OutlineTreeView.ts` の `renderNode()` 内、「Mobile gesture」ブロック、および純粋な移動距離判定を切り出した `src/tree/longPressGesture.ts`）。§2.2 で「将来 callout/blockquote 等のラベル編集を実装する場合、rename トリガー層…は再利用できる設計になっている」と述べた通り、本タスクは既存の rename トリガー層（`beginRenameForNode`）と既存のコンテクストメニュー構築関数（`showStructureCommandMenu`/`showListCommandMenu`）に新しい起動経路を足しただけであり、UI 層・commit service・テキストアダプタ層のいずれにも変更を加えていない。

- 単タップ（未選択ノード）＝選択のみ、長押し（既定 450ms）＝デスクトップの右クリックメニューと同一のメニュー、選択済みノードへの再タップおよびメニュー内「Rename」＝`beginRenameForNode` という同一関数、という三層構造。詳細な確定事項・受入基準との対応は `docs/統合実装ロードマップ_2026-08-05.md` §3.3 を正とする。
- 本ドキュメントの対象である scanner / 診断基盤（callout/blockquote/fenced-code/table/paragraph）には一切影響しない。対象は既存の `section`/`list`（`BlockNode`）のみ。

## 2.4 inline rename の安全復帰措置（Phase 5C-1A/1B 補完）との関係

§2.2 の inline rename の UI 層・commit service に対し、Escape キャンセル時の IME 誤爆防止ガードを1箇所追加した（`OutlineTreeView.ts` の rename `<textarea>` の `keydown` ハンドラ、`evt.isComposing` チェック）。rename の起動方法（§2.2 のダブルクリック主導）・全選択で始まる既定挙動・commit service（`renameSection`/`renameListItem` → `applyLineEditOutcome`）はいずれも変更していない。

- IME 変換中の Escape（変換候補のキャンセル）を rename キャンセルと誤認しないよう、`evt.isComposing` が真の間は Escape ハンドラを早期 return させる。変換確定後の Escape のみが `cancelRename()` を呼ぶ。
- `cancelRename()` は元々ドキュメント本文を書き換える API を呼ばない設計であり、Escape キャンセルが Undo 履歴にも本文にも影響しないという要件は、ガード追加以前から既存実装が満たしていた。
- rename commit の Undo/Redo 単位の独立性については、実機調査（DevTools コンソール経由で `editor.replaceRange()`/`editor.undo()`/`editor.redo()` を直接操作)により、この Obsidian バージョンでは個々の `editor.replaceRange()` 呼び出しが常に独立した Undo ステップになることを確認済みで、`applyLineEditOutcome` が commit ごとに1回だけ呼ぶ既存設計のままで要件を満たすと判断した。追加のコード変更（`isolateHistory` 等）は行っていない。
- 詳細な確定事項・実機受入結果は `docs/統合実装ロードマップ_2026-08-05.md` §3.4 を正とする。本ドキュメントの対象である scanner / 診断基盤（callout/blockquote/fenced-code/table/paragraph）には一切影響しない。

## 2.5 Move block の対象を最小安全ブロックへ（2026-08-11 チケット）との関係

本チケットは、Phase 5C の scanner（callout/blockquote/fenced-code/table/paragraph の境界認識）を、初めて実際の編集コマンド（`Move block up/down`）から呼び出す形で「操作」した最初のチケットである。scanner 自体（`parser/complexBlocks.ts`）・診断基盤の設計には一切変更を加えていない。新設したのは `src/move/resolveMoveTarget.ts` という、カーソル行から「最小安全ブロック」を解決し、その兄弟ブロックを探して交換する薄い層のみである。

- **paragraph の扱いに関する重要な補足**: `parser/complexBlocks.ts` の `scanParagraphBlocks` は元々「paragraph は診断専用であり、Phase 5C は paragraph 用の構造編集対象を一切追加しない（`docs/mixed-structure-spec.md` §6 参照）」という方針を明記していた（editability: `"read-only"`）。本チケットはこの方針を覆すものではない。paragraph は今回も Tree のノードにはならず、drag & drop の対象にも Partial Edit Pane の対象にもならない——`"read-only"` という値の元々の意味（「境界は分かるが、他の構造編集機能の対象にはしない」）はそのまま維持されている。本チケットが追加したのは、Move block という単一のコマンドに限って、boundary が確定している paragraph を「その場で前後のブロックと交換できる」という、Tree 化や独立アドレス化を伴わない狭い操作性だけである。この判断の詳細と根拠は `src/move/resolveMoveTarget.ts` の `isSafeToMoveComplexBlock` の doc comment、および `docs/統合実装ロードマップ_2026-08-05.md` §3.5 を参照。
- **fenced-code の境界判定に関する補足**: `resolver/resolveCurrentBlock.ts` は元々、fenced code block 内部の行をカーソル解決から一律除外していた（`section`/`list` の誤認識を防ぐための既存ガード）。本チケットはこのガード自体は変更せず、`resolveMoveTarget.ts` 側でその手前に「codeBlockLines なら先に scanner へ回す」という迂回路を追加しただけである。詳細は同ファイルの `resolveMoveUnit` の doc comment を参照。
- **兄弟探索は scanner の対象外の概念**: paragraph・複合ブロックの「兄弟」を探す `findComplexSiblingTarget` は、scanner が返す `ComplexBlockInfo.parentId`（同じ section、あるいは同じ list item に属するという既存の関係）をそのまま使うのみで、scanner 自体には新しい概念を追加していない。

## 3. Phase 5D 以降に持ち越す事項（本ドキュメントでは実装しない）

以下は Phase 5C の scanner / 診断基盤には一切含まれず、Phase 5D 以降で個別に設計・承認を経て実装する。

- **Tree 表示**: Outline Tree に callout / blockquote / fenced-code / table のノードを表示すること。
- **アイコン**: 各 kind に対応するアイコンの割り当て。
- **displayLabel**: `tree/buildOutlineTree.ts` の `nodeDisplayLabel` に相当する、複合ブロック用の表示ラベル生成。
- **move / drag & drop**: 複合ブロックの並べ替え、section/list との相互移動。
- **hoist**: 複合ブロックを Partial Edit Pane の投影対象にすること。
- **Partial Edit 接続**: `requestLoadNode` / `loadNodeInternal` 経由での投影、Apply/Discard/Cancel の対象にすること。`describeComplexBlockRejection`（`src/parser/complexBlocks.ts`）は、将来この接続を行う際に `edit/partialEdit.ts` の `resolve-failed` より詳細な拒否理由を提供するための下準備として存在するが、それ自体はどこからも呼び出されておらず、Phase 5D 以降の接続作業を先取りするものではない。

上記のいずれも、着手前に本ドキュメントと同様の設計メモ・承認プロセスを経ること。

## 4. paragraph の扱い（確定方針）

paragraph は `docs/mixed-structure-spec.md` §6（Phase 4D で既に確定した「段落専用ノードを追加しない」という方針）を Phase 5C でも踏襲する。

- `editability` は常に `"read-only"` または `"ambiguous"` であり、`"supported"` になることはない（`scanParagraphBlocks` のテストで横断的に検証済み）。
- Tree からの表示・選択・追加対象には含めない。Phase 5D 以降でこの方針を変更する場合は、`docs/mixed-structure-spec.md` §6 を明示的に改訂したうえで、別途設計判断を経ること。
- 現状の用途は BlockIndex や診断ビューのための range 情報提供に限る。

## 5. fenced-code の境界方針（暫定）

fenced-code の開始・終了は `ParsedDocument.codeBlockLines`（`parser/parseDocument.ts` が section/list 解析のために既に計算している配列）をそのまま正とする。`scanFencedCodeBlocks` はこの配列の連続 true 区間の先頭・末尾行のみを再照合し、情報文字列の抽出と「本当に閉じているか」の判定に用いる。

この方針は暫定である。`parseDocument.ts` 自身の fence 終端判定は「開始文字種のみ照合（run-length を見ない）」という簡略仕様であり、Phase 5C はこれに合わせて重複判定を避けている。より厳密な run-length 一致判定への拡張は、`parseDocument.ts` 側の既存境界ロジックを変更するかどうかも含め、Phase 5D 以降で別途判断する。

## 6. 型の責務境界（scanner 専用型 vs. 将来の統合 block モデル）

`src/model/complexBlock.ts` の型（`ComplexBlockKind`、`BlockEditability`、`ComplexBlockInfo`、`BlockDiagnostic`、`ComplexBlockScanResult`）は、すべて `parser/complexBlocks.ts` の scanner 専用のモデルである。

- `ComplexBlockKind` は意図的に `BlockKind` から改名し、`"section"` / `"list"` を含まない。これらは `model/block.ts` の `BlockNode` の排他的な領域であり続ける。
- `ComplexBlockInfo` は `ParsedDocument.nodes` に一切登録されず、`childIds` / `topLevelIds` にも参加しない。
- 将来、section/list を含む「文書全体の統合 block モデル」が必要になった場合、それは `BlockNode` と `ComplexBlockInfo` のいずれかを改名・拡張するのではなく、両者を横断する新しい型（例: `AnyBlock = BlockNode | ComplexBlockInfo` 相当）として別途設計すること。既存の2つの型を混同・合体させない。

## 7. 関連ドキュメント

- `docs/mixed-structure-spec.md` — section/list の既存境界規則（Phase 4D）。paragraph の非対象方針の根拠。
- `docs/統合実装ロードマップ_2026-08-05.md` — Phase 5 全体（5A〜5D）における本フェーズの位置づけ。
- `phase5-implementation-plan.md`（設計資料フォルダ）— Phase 5C-1/5C-2/5C-3 の当初計画。本ドキュメントの §1 が、その 5C-1 に相当する部分の完了を確定させたものである。
