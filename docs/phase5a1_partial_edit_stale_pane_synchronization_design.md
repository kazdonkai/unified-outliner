# Phase 5A-1: Partial Edit Pane 本文同期・stale 状態・Reload 安全性 設計メモ

## 改訂履歴

本文書は第2版である。第1版のレビューで指摘された以下2点の設計上の問
題を修正した。

1. stale 検知・自動 reload の条件を、`activeMarkdownView`（現在アクテ
   ィブな MarkdownView）が Pane の `sourcePath` と一致することに依存
   させていた。この依存は、popout Pane・別ノート閲覧中・複数 Pane の
   状況で検知漏れを起こすため撤回し、`sourcePath` のファイルそのもの
   の変更を追跡する設計へ置き換えた（3節）。
2. dirty かつ stale な Pane から Reload する際の確認 UI として、既存
   の `DiscardChangesModal`（Apply/Discard/Cancel）をそのまま流用し、
   Apply 選択時に通常の `applyEdit()` を試みる案としていた。stale な
   Apply は既存の fail-closed 照合により機械的に拒否される前提である
   ため、この文脈で「Apply できる」という誤った期待をユーザーに与える
   設計は撤回し、Reload 文脈では Apply を提示しない設計へ置き換えた
   （4節）。

以下、0〜2節・5〜6節前半は第1版から実質的な変更はない。3節・4節・6節
後半・7節・8節は今回の修正を反映して更新した。

## 0. 位置づけと適用範囲

本文書は、開発指示者が実機確認中に発見した現象——CompositeBlock の
Partial Edit Pane で編集を Apply した後、本文側で Undo を実行すると、
本文は Apply 前の内容へ戻るが、開いたままの Partial Edit Pane には
Apply 後の内容が残り続ける——を出発点とする、独立チケット Phase 5A-1
（日本語正式名称: Partial Edit Pane の stale 状態検知・安全な再読み込
み／英語短縮名称: Partial Edit stale-state synchronization）の設計・
調査メモである。

**（改名注記）** 本チケットは、当初「Phase 5E」の作業名で調査・設計
を進めていたが、ロードマップ上「Phase 5E」は Mermaid・表・その他ブロ
ックの Partial Edit 対応のために予約された別チケットの名称であること
が判明したため、本文書のレビュー完了後・実装開始前の段階で「Phase
5A-1」へ改名した。本チケットは Phase 5A（hoist・popout・breadcrumb等）
を巻き戻すものではなく、その延長線上でPartial Edit Paneの本文同期・
stale検知・安全なReloadを補完する位置づけの子チケットである。この改
名は文書パス（`docs/phase5e_partial_edit_stale_pane_synchronization_
design.md` から `docs/phase5a1_partial_edit_stale_pane_synchronization_
design.md` へ）とチケット名称のみの変更であり、以下に記載する機能要
件・安全性契約・案C・R2・イベント設計・テスト計画のいずれも変更しな
い。

この現象自体は、既にpush済みの読み取り専用調査（判定1）により、デー
タ整合性上のブロッカーではなくUX・状態可視化上の課題であることが確認
済みである。本文書はその前提を引き継ぎ、恒久的な設計方針を検討する。

本文書は設計・調査メモであり、この段階で production code・test・
settings・i18n・CSS のいずれも変更しない。実装は本文書のレビュー後、
別途の実装チケットとして開始する。

Phase 5D で既にpush済みとなった CompositeBlock Atomic Partial Edit を
含む一連の機能を巻き戻すものではない。本チケットが扱うのは、Partial
Edit Pane 全体——CompositeBlock 単体に限定せず——の本文同期・stale 状
態・Reload・Apply 安全性である。対象とする Partial Edit 経路は、少な
くとも次の7種別である。

- section（セクション見出し配下）
- list subtree（リスト項目のサブツリー）
- paragraph（本文段落、Phase 5P-2 由来）
- standalone callout（独立したコールアウト）
- standalone blockquote（独立した引用ブロック）
- CompositeBlock（list + callout/blockquote 等の複合ブロック全体、
  Phase 5D-2A 由来）
- CompositeBlock member として扱われる callout/blockquote の Partial
  Edit 経路（Phase 5D-0.5〜5D-1C 由来の quote prefix projection を伴う
  経路）


## 1. 問題定義

### stale Pane とは何か

`src/view/PartialEditView.ts` を実際に読み込んだ結果、このクラスが
生涯で登録する Obsidian イベントリスナーは唯一つ、`onOpen`（655-657行）
の以下だけであることを確認した。

```ts
this.registerEvent(
  this.app.workspace.on("layout-change", () => this.updateCloseButtonVisibility())
);
```

これは Pane が sidebar/tab/popout のどこにいるかに応じて閉じるボタン
の表示を切り替えるためだけのものであり、`editor-change`・
`vault.on("modify")`・`active-leaf-change`・`file-open` のいずれも購読
していない。つまり Pane は、自分がいったん本文から読み込んだ内容
（`originalText`／`textareaEl.value`／`quoteProjection` 等、182-243行
で宣言されているフィールド群）を、外部で本文がどう変化しても一切追跡
しない。

「stale Pane」とは、この状態——Pane が保持する編集対象のスナップショッ
トが、現在の本文の実際の内容と食い違っているにもかかわらず、Pane の
UI上はその食い違いが一切示されない状態——を指す。

### 本文側の更新と Pane 側の編集バッファがどう乖離するか

Pane が本文から何かを読み込むのは、`loadNodeInternal`／
`loadParagraphInternal`／`loadCompositeInternal`（いずれも
`requestLoadNode`／`requestLoadParagraphAtCursor`／`requestLoadComposite`
経由でのみ外部から呼び出せる、694-760行）が呼ばれた瞬間だけである。
それ以降、本文側では以下のいずれもが Pane に一切通知されないまま起こ
り得る。

- 本文編集領域での直接編集
- Undo / Redo
- 別の Partial Edit Pane（複数 Pane が開いている場合）からの Apply
- Outline Tree View 経由の Move / Delete / D&D
- ファイルの外部変更（他プロセスによる書き換え等）

これらのいずれが起きても、Pane 側の `originalText`／
`textareaEl.value` は Pane が最後に読み込んだ（または最後に自分で
Apply した）時点のスナップショットのまま変化しない。

### Apply 後に本文側で Undo した場合の時系列

開発指示者が実機で確認した具体的な時系列は以下の通りである。

1. Pane が CompositeBlock を読み込む（`originalText` = 本文の現在値）。
2. ユーザーが Pane 内で編集し、Apply する。`applyEdit()` の
   CompositeBlock 分岐（1650-1651行）は、Apply 成功直後に
   `this.originalText = this.textareaEl.value` として Pane 側のスナッ
   プショットを「Apply 後の内容」へ再アンカーする。本文側も同じ内容に
   書き換わっているため、この時点では Pane と本文は一致している。
3. ユーザーが本文編集領域で Undo を実行する。CodeMirror の Undo 履歴に
   よって本文は Apply 前の内容へ戻る。この操作は Pane に一切通知され
   ない（購読しているイベントが `layout-change` のみであるため）。
4. Pane はこの時点でも `originalText`／`textareaEl.value` を
   「Apply 後の内容」のまま保持し続ける。本文は「Apply 前の内容」に戻
   っているため、両者は食い違ったままになる。これが実機で報告された
   「Pane に Apply 後の内容が残る」現象である。

### なぜ Pane を即時自動更新しない現行設計になっているか

現行実装は「本文変更を検知して Pane を即時自動更新する」仕組みを意図
的に持たない設計というより、そもそもそのための購読が一度も実装されて
こなかった、というのが実コードから確認できる事実である。もっとも、仮
に本文変更のたびに無条件で `textareaEl.value` を上書きする仕組みを素
朴に追加した場合、Pane 内にユーザーの未保存編集（dirty な状態）がある
ときにそれを無断で破棄してしまう危険がある。この危険を避けることが、
3節以降で検討する検知・Reload 設計における中心的な制約となる。

### stale 表示がデータ破壊ではない理由

判定1調査で確認済みの通り、4つの Partial Edit 対象種別すべてにおいて、
Apply 時に現在の本文を再パースし、Pane が保持するスナップショットとの
完全一致を要求する fail-closed な照合が働く。

- CompositeBlock（`src/edit/compositeBlockPartialEdit.ts`
  `applyCompositeBlockEdit`）: `current.text !== originalText` なら
  `{changed: false, reason: "conflict"}`。加えて `findRangeInvalidReason`
  ／`snapshotMatches` による構造照合。
- section／list／standalone callout・blockquote
  （`src/edit/partialEdit.ts` `applySubtreeEdit`／`applySectionEdit`）:
  同じ `current.text !== originalText → "conflict"` パターン。
- paragraph（`src/edit/paragraphPartialEdit.ts` `applyParagraphEdit`）:
  scan-local id・同親同深度での完全一致を要求する二段階の識別解決。
  不一致は `"content-changed"` または `"anchor-unresolved"`。

いずれの経路も、不一致時は現在の `doc.lines` を無変更のまま返す
（`changed: false`）。これは前回の判定1調査で、既存の263件のテスト
（12ファイル）——本文が食い違った状態での Apply を試み、本文が
byte-identical のまま保たれることを直接アサートするテストを含む——に
よっても裏付け済みである。したがって、stale な Pane から Apply を試み
ても、本文が意図せず書き換わることはない。

### stale 表示が UX 上重要な理由、および conflict 拒否だけでは不十分な理由

Apply 時の fail-closed 照合は「本文を壊さない」ことは保証するが、
「ユーザーが今何を見ているか」を正しく伝えない。stale な Pane を見て
いるユーザーは、そこに表示されている内容が現在の本文と一致していると
誤認したまま編集を続けてしまい得る。その編集は最終的に conflict とし
て拒否されるが、ユーザーからは「なぜ拒否されたのか」が Notice の文言
だけでは伝わりにくく、編集内容を失った、あるいは Pane が壊れたと感じ
させる体験になり得る。stale であることを Pane の見た目自体が能動的に
示し、かつ安全な Reload 導線を提供することが、この UX 上のギャップを
埋める。


## 2. 状態モデル

本節はこの段階での実装を意図しない。新しい型・field・API は一切実装
しない。既存状態の整理と、将来の実装検討のための追加候補状態の列挙に
とどめる。

### 命名上の注意

`src/view/outlineTreeLeafPlacement.ts`（50行目）には、UXP-03c
「Partial Edit Pane Stale Tab-Group Reuse Fix」という、既に解決済みの
別の問題が存在する。これは Partial Edit Pane が Outline Tree View と
同じタブグループを再利用できず分割されてしまう、という leaf 配置上の
問題であり、本設計メモが扱う「本文内容の陳腐化」とは無関係である。実
装時には、この既存の "stale"（tab-group 再利用の意味）との混同を避け
るため、状態名には内容の陳腐化であることが明確な語（例:
`contentStale` 相当の命名）を用いることが望ましい。本文書ではこの区別
を明示するため、以下「stale」は常に「本文内容の陳腐化」を指す。

### 既存の状態（実コード確認済み）

`PartialEditView` クラスが実際に保持しているフィールドは以下の通りで
ある（行番号は本文書執筆時点のもの）。

| フィールド | 行 | 内容 |
|---|---|---|
| `nodeId` | 182 | section/list の id。paragraphAnchor/compositeAnchor と排他 |
| `nodeKind` | 183 | 読み込み中の種別 |
| `paragraphAnchor` | 190 | paragraph 読み込み時の識別アンカー |
| `compositeAnchor` | 202 | CompositeBlock 読み込み時のスナップショット |
| `originalText` | 205 | Pane の「編集前」スナップショット。Apply成功のたびに再アンカーされる |
| `quoteProjection` | 220 | callout/blockquote のプレフィックス投影状態 |
| `sourcePath` | 231 | 読み込み元ノートのパス（Apply時の追加安全弁。本改訂では検知の主キーとしても用いる、3節参照） |
| `ancestors`／`directChildren`／`siblingState` | 236-239 | breadcrumb/Subtree Navigator/Sibling nav 用、読み込み時に一度だけ計算 |
| `textareaEl.value`（DOM） | 380 | 現在の編集バッファ |

`isDirty()`（1867行）は上記のうち `textareaEl.value` と
`currentDisplayText()`（`originalText` を基準に投影を考慮したもの）お
よび quote header の各入力値を比較する、Pane 内部完結の判定であり、実
際の本文とは一切比較しない。

### 追加候補となる状態

将来の実装検討のために、少なくとも以下の状態区分を整理しておく。ただ
し名称・実装方式は未確定であり、本節はあくまで整理である。

| 候補状態 | 意味（案） |
|---|---|
| `loaded` / 未loaded（既存の empty state 相当） | 何らかの node/paragraph/composite が読み込まれているか |
| `clean` | `isDirty() === false` の既存概念 |
| `dirty` | `isDirty() === true` の既存概念 |
| `stale`（新規候補） | `sourcePath` のファイル内容が、Pane 読み込み時点から変化したことが検知されたが、Pane 側のバッファはまだ更新されていない状態。3節の通り、検知は本文が現在アクティブかどうかに依存しない |
| `conflict`（Apply時の既存結果、常駐状態ではない） | Apply 時の fail-closed 拒否理由の一種として既に存在（`"conflict"`／`"content-changed"`／`"anchor-unresolved"`／`"range-invalid"`／`"snapshot-mismatch"` 等） |
| `reloadPending`（新規候補） | ユーザーが明示的に Reload を選択し、再解決処理の実行中 |
| `unavailable`（新規候補） | `sourcePath` のファイル自体が削除された、またはReload時に対象が構造変化等で再解決できなかった状態 |

`stale` と `dirty` は独立した軸として扱う（両立し得る）。「clean かつ
stale」（未編集のまま本文だけが変わった）と「dirty かつ stale」（編集
中に本文も変わった）は、4節で見るように取るべき挙動が異なる。

### 状態遷移（文章による整理）

以下、少なくとも指示された11個の遷移について、現行実装の事実と、将来
の設計候補としての挙動案を分けて記す。「案」と明記した箇所は未確定で
ある。検知の具体的なイベント経路は3節を参照。

1. **Open → clean**: 現行通り。`requestLoadNode` 等が `isDirty()` を
   経ずに `loadNodeInternal` 等を呼び、`originalText`／`textareaEl.value`
   が一致した状態で開く。
2. **clean Pane 中の本文変更**: 現行は無反応（検知しない）。案: 検知す
   れば `clean → stale` へ遷移し、textarea 自体は据え置く（4節）。
3. **dirty Pane 中の本文変更**: 現行は無反応。案: 検知すれば
   `dirty → dirty+stale` へ遷移し、textarea を無断で書き換えない
   （4節）。
4. **stale・clean Pane から Reload**: 案: 最新本文から対象範囲を再解決
   し、`originalText`／`textareaEl.value`／anchor 系フィールドを最新化
   して `clean` へ戻る。未保存編集がないため確認モーダルは不要。
5. **stale・dirty Pane から Reload**: 案（4節で全面改訂）:
   Reload 専用の Discard/Cancel 確認 UI を経由し、Discard なら最新本文
   で上書き、Cancel なら何もしない。Apply はこの確認 UI に含めない。
6. **stale Pane から Apply**: 現行の fail-closed 照合がそのまま働き、
   不一致であれば `changed: false` で拒否され本文は無変更（1節で確認
   済み）。案: 拒否に加えて、あらかじめ「stale」であることを UI 上に
   示しておくことで、拒否の理由をユーザーが Apply 前から理解できるよ
   うにする。
7. **conflict 拒否後**: 現行は Notice を表示して Pane はそのまま
   （`applyEdit()` は false を返し、`textareaEl.value` 等は変更されな
   い）。案は変更なし、または conflict 直後に自動的に `stale` 表示へ
   遷移させることを検討し得る。
8. **target 再解決不能後**（Reload 時に対象が消失・構造変化）: 案:
   `unavailable` 状態とし、別範囲を推測表示せず理由を示す（4節）。
9. **Close → Reopen**: 現行通り、`onClose`（663行）は DOM を空にする
   だけで状態は破棄される。次に開いたときは新規の `Open → clean` とな
   る。
10. **別 node への移動**（breadcrumb・Subtree Navigator・Sibling nav・
    Tree からの再選択）: 現行はすべて `requestLoadNode` 等の共通入口を
    経由し、`isDirty()` に基づく確認モーダルを共有する（695-800行で確
    認済み）。stale 状態が絡む場合の挙動は、遷移5と同じ確認経路に合流
    させることが自然な案となる。
11. **breadcrumb による投影変更**: 現行の breadcrumb クリックは
    `requestLoadNode` を呼ぶため、遷移10と同じ経路に合流する。
12. **refresh・onClose・popout・複数 Pane**: `popout`（別ウィンドウ）
    は `DiscardChangesModal` が `Modal.open()` の「現在アクティブなウ
    ィンドウに表示される」性質に既に対応済み（1928-1932行のコメントで
    確認）。複数 Pane が同一本文を編集している場合の扱いは3節で詳述す
    る。


## 3. 本文変更の検知設計（第2版で全面改訂）

### 第1版の問題点

第1版は、clean Pane の自動 reload・stale 検知の必須条件として「現在
アクティブな `MarkdownView` のファイルパスが Pane 自身の `sourcePath`
と一致すること」を要求していた。この条件を実コードに照らして検証した
結果、以下の理由により撤回する。

`src/view/activeMarkdownViewTracker.ts` を実際に読み込んだところ、
`ActiveMarkdownViewTracker`（`PartialEditView`／`OutlineTreeView` が共
有する、plugin レベルの単一インスタンス）は「直近でフォーカスされた
markdown view を、そのleafが閉じられるまで返し続ける」というキャッシ
ュを持つことを確認した。これは「Pane 自身のファイルが今アクティブか」
ではなく「プラグイン全体として直近フォーカスされたノートはどれか」を
表すものであり、この2つは異なる問いである。

具体的に検知漏れが起きる状況は以下の通りである。

- Pane が popout window にあり、ユーザーがメインウィンドウで別のノー
  トを編集している場合、`activeMarkdownView.get()` はその別ノートの
  view を返す。Pane 自身の `sourcePath` と一致しないため、第1版の条件
  では一切のチェックがスキップされる。
- 複数の Partial Edit Pane が異なるファイルを開いている場合、非アクテ
  ィブな方の Pane は同様に検知対象外になる。
- ユーザーが Pane の対象ファイルから離れて別ノートを見ている間に、そ
  の対象ファイルへ（例えば別の Pane からの Apply で）書き込みが起きて
  も、離れている間は検知されず、後で対象ファイルに戻ったときに Pane
  が古い内容を表示したままになる——これはまさに今回修正すべき欠陥その
  ものである。

したがって、stale 検知は「今何がアクティブか」ではなく「`sourcePath`
が指すファイルそのものが変化したか」を主キーとする設計に置き換える。

### 5つの関心事の分離

ご指摘の通り、以下5つを明確に別の関心事として分離する。単一の
`activeMarkdownView` 一致条件にまとめない。

| 関心事 | 何をするか | 対象ファイルがアクティブでなくても成立するか |
|---|---|---|
| ① 変更を検知すること | `sourcePath` のファイルに変更があったことを知る | 成立する（vault レベルのイベントで検知、後述） |
| ② stale を表示すること | ①を受けて Pane の UI に stale 状態を反映する | 成立する（UI更新のみで本文アクセス不要） |
| ③ 最新本文を再解決すること | `sourcePath` の現在の内容を実際に取得し、対象範囲を再抽出する | 成立する（後述の vault 読み取り経由） |
| ④ textarea を自動更新すること | ③の結果で `textareaEl.value` 等を書き換える | **clean な Pane に限る**（dirty では絶対に行わない、4節） |
| ⑤ Reload を許可すること | ユーザー操作によって③④相当を明示的に実行する | 成立する（対象ファイルが今アクティブでなくても、明示操作なら許容する、後述） |

### 新しい検知の主キー: `sourcePath` のファイル変更

Obsidian の `vault.on("modify", (file: TFile) => void)` イベントは、
ファイルの変更を vault レベルで通知する。`src/main.ts` は既に
`vault.on("rename", (file, oldPath) => {...})`（487-490行）を使って
fold state をリネーム先へ引き継ぐ処理を実装しており、これは vault イ
ベント購読の直接の前例である。`vault.on("modify")` はこのコードベース
では未使用（`grep -rn "vault.on(" src/` で確認、rename の1件のみ）だ
が、Obsidian 標準 API であり、ファイルがどの view でアクティブかに関
係なく、そのファイルへの書き込みそのものを通知する。これにより、①③
の「対象がアクティブでなくても成立する」という要件を満たせる。

```ts
this.registerEvent(
  this.app.vault.on("modify", (file) => {
    if (file.path === this.sourcePath) this.scheduleStaleCheck();
  })
);
```

`editor-change` も併用する。Obsidian の
`workspace.on("editor-change", (editor, info) => void)` のコールバッ
ク引数 `info`（`MarkdownView` 相当）は編集された view 自身の `file` を
持つため、第1版のように別途 `activeMarkdownView` を介さず、イベント自
身のペイロードから直接 `info.file?.path === this.sourcePath` を判定で
きる。これは `OutlineTreeView.ts` の既存の `scheduleRefresh` が
引数を無視して常に `this.activeMarkdownView.get()` に頼っている現行パ
ターンとは異なる、本メモが新たに導入する判定方法である——既存の前例が
ない分、実装時に型（`MarkdownView | MarkdownFileInfo`）と実際の発火挙
動を確認する必要がある。`editor-change` は `sourcePath` が現在アクテ
ィブに編集されている場合の低遅延経路として使う（vault の modify 通知
は内部的にディスクへのflushタイミングに依存し、typingの都度は発火し
ない可能性があるため）。

`active-leaf-change`／`file-open` は、ユーザーが `sourcePath` のノート
へ戻ってきた瞬間の「再確認のきっかけ」として使う。この2つも、イベン
ト自身が渡す view/file から `sourcePath` との一致を直接判定し、
`activeMarkdownView` トラッカー経由の間接判定はしない。

以上4イベントすべてを、Pane インスタンスごとに `onOpen()` 内で
`registerEvent` し、一つの共通デバウンス関数（150ms、
`OutlineTreeView.ts` の `scheduleRefresh` と同じ値・同じ
`debounce(cb, 150, true)` 形）にまとめて発火させる設計とする。

### ③ 最新本文の再解決: アクティブな editor に依存しない読み取り

`extractSubtreeText`／paragraph 解決／CompositeBlock 再マッチングのい
ずれも、実際には `parseDocument(text: string)` が返す `ParsedDocument`
に対して動作する純粋な処理であり、その `text` が `editor.getValue()`
由来である必要はない。したがって、`sourcePath` が現在アクティブな
editor でなくても、`app.vault.getAbstractFileByPath(this.sourcePath)`
で `TFile` を取得し、`vault.cachedRead(file)`（または `vault.read`）
でその内容を読み取り、同じ `parseDocument` ベースの再解決処理にかけれ
ば、①③は対象ファイルがどこにも開かれていなくても成立する。

ただし重要な留保がある。**このコードベースには `vault.read`／
`vault.cachedRead` の使用実績が一件もない**（`grep -rn "vault\.read(\|vault\.cachedRead("` で確認、0件）。これは既存 API の転用ではなく新
規に導入するインフラである。加えて、このプロジェクトの既存 263件超の
テストが依拠する Obsidian API モック層が `vault.read`／`cachedRead`／
`vault.on("modify"/"delete")` を現時点でサポートしているかは、本メモ
の時点では確認できていない。**実装開始前に、テストモック層がこれらの
API をサポートしているか、サポートしていない場合はモックの拡張が必要
かを確認することを実装開始ゲート（8節）の必須項目とする。**

### ④ textarea の自動更新: 「対象ファイルが今開かれていない場合は推測
しない」の具体化

②③（検知・stale 表示・vault 経由の再解決）は対象ファイルがアクティブ
でなくても成立させる一方、④（textarea への自動反映）は以下の通り区別
する。

- **`sourcePath` が現在アクティブな editor である場合**: 既存の
  `loadNodeInternal` 等と全く同じ `editor.getValue()` を信頼できる最
  新ソースとして扱い、clean な Pane であれば自動的に textarea を更新
  してよい（既存の読み込みパスをそのまま再利用するため、新たな信頼性
  の問題を持ち込まない）。
- **`sourcePath` が現在アクティブな editor ではない場合**（別ウィンド
  ウ・別タブで非表示、あるいはどこにも開かれていない）: `vault.cachedRead`
  経由の検知によって stale／unavailable の表示までは行うが、
  textarea の自動更新は行わない。理由は、対象ファイルを裏で編集中の
  editor が存在する場合、その editor 内の未flush（ディスク未反映）の
  変更を `vault.cachedRead` が拾えない可能性があり、これを信頼して
  自動反映すると「本文編集中の最新内容より古い内容で自動上書きする」
  という別種の陳腐化を生みかねないためである。この場合は、ユーザーが
  明示的に Reload を選ぶまで textarea を変更しない——これが「推測して
  reload してはならない」の具体化である。
- 明示的な Reload（⑤）は、対象ファイルがアクティブでなくても
  `vault.cachedRead` を一度限りの権威あるソースとして使ってよいとす
  る。これはユーザー自身の能動的な操作であり、既存の Apply 時
  fail-closed 照合が最終防衛線として引き続き機能するため、上記の自動
  反映より弱いリスク基準で許容できると判断する。

### 検知候補の比較（第2版）

| 候補 | Undo/Redo検知 | 直接編集検知 | 別Pane Apply検知 | Tree Move/Delete/D&D検知 | 対象ファイルが非アクティブでも検知可能か | popout window | 複数Pane | debounce要否 | 実績 |
|---|---|---|---|---|---|---|---|---|---|
| `vault.on("modify")`＋`file.path`直接比較（新規採用） | ○（保存時に検知） | ○ | ○ | ○ | ○（本節の核心） | ○ | ○（各Paneが自分のsourcePathとだけ比較） | 要（他イベントと合流させ150ms） | このコードベースでは`rename`のみ前例あり、`modify`は新規 |
| `editor-change`＋payload直接比較（`info.file`、新規採用） | ○ | ○ | ○ | ○ | ×（アクティブなeditorのみ） | ○ | ○ | 要（150ms、Tree View実証値と同一） | Tree Viewは購読のみで payload未使用。payload参照は本メモが新規に導入 |
| `active-leaf-change`／`file-open`＋payload直接比較 | × | × | × | × | 該当なし（再確認のトリガーとしてのみ使用） | ○ | ○ | 不要（再確認のきっかけのみ） | Tree Viewで購読実績あり、ただし用途は再描画全般 |
| `activeMarkdownView`一致条件（第1版、不採用） | ○（一致時のみ） | ○（一致時のみ） | ○（一致時のみ） | ○（一致時のみ） | ×（不一致時は無反応、これが第1版の欠陥） | ×（不一致になりやすい） | ×（同上） | 要 | 第1版で提案、本改訂で不採用 |
| polling（`vault.cachedRead`定期比較） | ○ | ○ | ○ | ○ | ○ | ○ | ○ | 該当（interval自体） | mobileの電池消費への配慮が必要、優先度を下げる（第1版から変更なし） |

### 複数 Pane・popout・active file 切替の扱い

各 `PartialEditView` インスタンスが自分専用の `sourcePath`・自分専用
の `registerEvent` 購読を持つ設計であるため、Pane 間の明示的な調停は
不要である。`vault.on("modify")` はファイル単位で発火するため、Pane A
が `sourcePath = "A.md"` を、Pane B が `sourcePath = "B.md"` を持つ場
合、A.md への変更は Pane A のリスナーの `file.path === this.sourcePath`
判定だけを通過し、Pane B には無関係のまま何も起こらない。同一ファイル
を複数 Pane が開いている場合（両方とも `sourcePath = "A.md"`）は、両
方が同じ `vault.on("modify")` 通知を受け取り、それぞれ自分の
`originalText` と比較するため、一方の Apply が他方を正しく stale 化
できる。popout window は `vault`／`workspace` イベントがウィンドウを
またいで発火する Obsidian の既存の仕組みにそのまま乗るため、追加の対
応は不要と考えられるが、実装時にマルチウィンドウでの発火を確認するこ
とを実装開始ゲートに含める。

### `sourcePath` の削除・rename・移動の扱い

`vault.on("rename", (file, oldPath) => ...)` は `main.ts`
（487-490行）に既存の前例がある。Pane 側でも同じイベントを購読し、
`oldPath === this.sourcePath` であれば `this.sourcePath = file.path`
として**リネームに追従する**設計を推奨する。理由は、リネーム/移動はフ
ァイルの内容そのものには一切触れないため、Pane が読み込んでいる内容
の正当性は変わらず、`main.ts` の既存の fold state 引き継ぎと同じ考え
方（識別子ではなく実体を追う）が自然に当てはまるためである。

`vault.on("delete", (file) => ...)` はこのコードベースに前例がない新
規購読である。`file.path === this.sourcePath` であれば、即座に
`unavailable` 状態へ遷移させる。削除は内容の変化ではなく対象の消失で
あるため、stale ではなく unavailable として扱う（2節の状態区分との整
合）。

`app.vault.getAbstractFileByPath(this.sourcePath)` が `null` を返す場
合（rename/delete イベントを何らかの理由で取りこぼした場合の防御的な
フォールバック）も、同様に `unavailable` として扱い、別の対象を推測し
て表示することはしない。


## 4. Reload 設計

本節も設計候補の整理であり、この段階での実装を意図しない。

### Reload 操作・stale 表示の配置（案、第1版から変更なし）

既存ヘッダー（`headerEl`／`actionsEl`、419-425行）に Apply/Cancel と並
ぶ形で Reload ボタンを置く案と、`breadcrumbEl` に近い専用の通知バー
（stale であることを示すバナー行）に Reload を埋め込む案の双方が考え
られる。既存の Apply/Cancel ボタンは `updateDirtyState()`
（1855-1858行）で `toggleVisibility(dirty)` により dirty な時だけ表示
される設計であり、Reload ボタンも同様に「stale な時だけ表示」という一
貫した方針にすることが自然である。

### clean Pane で外部変更を検知した場合（3節の分離を踏まえて確定）

3節で分離した通り、`sourcePath` が現在アクティブな editor である場合
に限り、textarea を自動更新してよい。アクティブでない場合は、stale で
あることを示す通知のみ表示し、textarea は変更しない。いずれの場合も、
無条件の即時反映は行わない——たとえアクティブな editor 由来であって
も、ユーザーがまさに読んでいる最中のテキストが本人の操作なしに書き換
わるという別の混乱を招き得るため、`isDirty() === false` であることに
加えて、この自動更新自体を行うかどうかは実装時に改めて検討する余地を
残す（3節の既定方針「常時双方向同期は採用しない」と整合させる）。

### dirty Pane で外部変更を検知した場合

`textareaEl.value`・`quoteTitleInputEl.value`・
`quoteMarkerSelectEl.value`・`quoteTypeInputEl.value` のいずれも無断で
変更しないことを設計上の絶対条件とする。これは既存の `isDirty()`／
`DiscardChangesModal` の契約（未保存編集は必ずユーザーの明示的な
Apply/Discard/Cancel を経てから失われる、という既存の702-717行のコメ
ントで明示された契約）と整合させるためであり、本チケットがこれを緩め
ることはない。

### dirty かつ stale な Pane で Reload を選んだ場合（第2版で全面改訂）

第1版は、既存の `DiscardChangesModal`（Apply/Discard/Cancel）をそのま
ま再利用し、Apply 選択時には通常の `applyEdit()` を試みる案としてい
た。この案は撤回する。stale な状態では、Pane の `originalText` と本文
が既に不一致であることが分かっており、Apply は既存の fail-closed 照
合により機械的に conflict 拒否される前提である。この文脈で Apply を選
択肢として残すことは、「今の編集が適用できるかもしれない」という誤っ
た期待をユーザーに与える。

以下3案を比較する。

| 観点 | 案R1: Reload専用の新規Discard/Cancelモーダル | 案R2（推奨）: 既存DiscardChangesModalを拡張しReload文脈ではApplyを非表示 | 案R3: 既存モーダルそのまま、Apply選択時はapplyEdit()を実行せず拒否Noticeを出す |
|---|---|---|---|
| 既存モーダルの再利用性 | なし（新規クラス） | 高い（同一クラスをパラメータ化） | 完全（クラス自体は無変更） |
| UI変更の規模 | 中（タイトル/本文/ボタン配置を再実装、~40-50行相当） | 小（コンストラクタ引数1つ、Apply生成の条件分岐、~5-10行相当） | 極小（呼び出し側の`onChoice`分岐のみ、~5行相当） |
| 未保存編集を誤って失う危険 | なし（Applyが存在しないため） | なし（Applyが非表示または無効のため） | なし（Apply選択時もapplyEdit()を呼ばないため） |
| stale時にApply可能と誤認する危険 | 最小（選択肢に存在しない） | 低い（非表示にすれば同等に最小、無効化に留めればやや残る） | 高い（クリック可能なApplyボタンが存在し続ける——今回の懸念そのものへの対処が弱い） |
| i18n追加量 | 中（新規タイトル/本文文言が必要、ボタンラベルは`common.discard`/`common.cancel`を再利用可） | 極小（既存文言を再利用でき、新規文言は任意） | 小〜中（新規Notice文言1件がen/ja必要） |
| テスト可能性 | 中（新規クラスのテストを新設） | 高い（既存モーダルのテストパターンを拡張） | 高い（既存モーダルは無変更、呼び出し側のみテスト） |
| accessibility | 良好（存在しない選択肢は誤操作を誘発しない） | 良好（非表示にする場合。無効化に留める場合はやや劣る） | 劣る（ラベル通りに機能しないボタンが操作可能なまま存在し、支援技術利用者に誤解を与えやすい） |
| clean/dirty Paneでの一貫性 | やや低い（似て非なる2つのモーダルが並立） | 高い（単一クラスが両文脈をパラメータで表現） | 中（クラスは単一だが、同じ"Apply"ボタンが文脈により意味を変える） |
| Apply/Discard/Cancelの既存意味との整合性 | 該当なし（Apply自体が存在しない） | 高い（表示される場合のApplyは常に本来の意味を保つ） | 低い（"Apply"ラベルが文脈依存で「本当に適用する」/「拒否Noticeを出すだけ」に分岐する） |
| 既存DiscardChangesModalの他利用箇所（3箇所）への影響 | なし（完全に独立） | 中（共有クラスを変更するため、既存3箇所が影響を受けない設計・回帰テストが必須） | なし（クラス自体は無変更、呼び出し側のみ変更） |
| 既存の未保存編集保護への回帰リスク | 最小 | 低〜中（デフォルト引数で既存挙動を保持し、既存3呼び出し箇所の回帰テストを追加すれば十分に抑制可能） | 低 |

**推奨: 案R2。** 理由は以下の通りである。

第一に、`updateDirtyState()`（1855-1858行）が既に「dirty な時だけ
`toggleVisibility` で表示する」という同じ思想を Apply/Cancel ボタン自
体に適用しており、モーダル内の Apply ボタンにも同じ `toggleVisibility`
の考え方を適用することは、このコードベース独自の既存パターンとの一貫
性が最も高い。第二に、Apply ボタンは「非表示」にすることを推奨する
（「無効化」に留めない）。無効化されたボタンが見えている状態は、それ
でもなお「ここに Apply という選択肢がある」という認識をユーザーに与
えかねず、今回の懸念（誤った期待を与えない）への対処として非表示の方
が徹底している。第三に、案R1は既存クラスに触れない分だけ回帰リスクは
最小だが、似たような「未保存編集の確認」を行う2つの類似モーダルが並
立することになり、コードベース全体の一貫性という観点で案R2に劣る。案
R3はコード変更量こそ最小だが、クリック可能な Apply ボタンが Reload 文
脈にも残り続ける点で、今回ユーザーが指摘した核心的な懸念（誤った期待
を与える UI アフォーダンス自体）への対処が最も弱く、accessibility の
観点でも「ラベル通りに機能しないボタン」という望ましくないパターンに
該当する。

**実装方針（案）**: `DiscardChangesModal` のコンストラクタに
`showApply: boolean = true` のような引数を追加し、デフォルト値は既存
の3呼び出し箇所（`requestLoadNode`／`requestLoadParagraphAtCursor`／
`requestLoadComposite`）の挙動を完全に保つ。Reload 専用の新しい呼び出
し箇所だけが `showApply: false` を渡し、`onOpen()` 内で `applyEl` の生
成そのものをスキップする（または生成した上で `toggleVisibility(false)`
する）。Reload 文脈での `onChoice` コールバックは `"discard"`／
`"cancel"` の2分岐のみを実装すればよく、`"apply"` はボタンが存在しな
い以上到達し得ない。この変更は共有クラスに触れるため、既存3呼び出し
箇所が今回の変更で一切挙動を変えないことを確認する回帰テストの追加を
実装開始ゲートの必須項目とする（6節）。

タイトル・本文文言は、既存の `partialEdit.unsavedChangesTitle`／
`partialEdit.unsavedChangesBody`（423-424行）をそのまま再利用する案を
基本としつつ、Reload 文脈であることをより明確に説明する専用文言に置
き換えるかは、実装時の任意の改善事項として残す（必須ではない）。

### dirty＋stale Pane で Cancel を選んだ場合

textarea・stale 表示・anchor（`nodeId`／`paragraphAnchor`／
`compositeAnchor`）・`originalText` のいずれも変更しない。dirty＋stale
の状態をそのまま維持する。

### dirty＋stale Pane で Apply を選ぶ経路そのものをどう扱うか

Reload 確認 UI から Apply を除いても、Pane 本体のヘッダーにある通常の
Apply ボタン自体は引き続き存在し得る（3節・4節前半で検討した「stale
状態で Apply ボタンを disabled にするか」の論点）。この2つは独立した
論点である——Reload 確認 UI に Apply を含めないことと、Pane 本体の
Apply ボタンを stale 時に disabled にするかどうかは、それぞれ別々に決
定してよい。本メモでは、Pane 本体の Apply ボタンについては第1版と同
様、disabled にする案と、押下を許可した上で既存の fail-closed 照合に
委ねる案の両方を候補として残す。

### 対象が再解決できない場合の表示

Reload 時に対象ノード・paragraph・CompositeBlock が削除・構造変化等で
再解決できない場合、別の範囲を推測して表示することは行わない。既存の
`loadNodeInternal`（796行以降）が resolve 失敗時に Notice を出して
何もしない、という既存の fail-closed な設計方針をここでも踏襲し、
Pane を `unavailable` 状態にして理由を示す案とする。

### Reload 後のフィールド更新

`originalText`／`paragraphAnchor`／`compositeAnchor`／`quoteProjection`
／`isDirty()` の基準はすべて、既存の `loadNodeInternal` 等が最初の読み
込み時に行っている処理と同じ経路を再利用して最新化する案が、実装の重
複を避ける観点で望ましい。3節の通り、Reload 時のソースは対象がアクテ
ィブな editor であれば `editor.getValue()`、そうでなければ
`vault.cachedRead` 経由の一度限りの読み取りとする。

### selection・scroll・focus の扱い

案: Reload 後は先頭にカーソルを戻すのではなく、既存の Apply 成功時と
同様の自然な位置維持を検討するが、textarea 内のカーソル位置そのものの
復元まで保証するかは未確定であり、実装時に改めて検討する。

### Apply 成功直後の内部更新と外部変更検知との競合回避（第1版から変更なし）

`applyEdit()` の3分岐すべて（paragraph: 1573行、composite: 1653行、
node/section: 1789行）は、Apply 成功直後に自分自身で `originalText`
（および対応する anchor/snapshot）を「Apply 後の内容」へ再アンカーす
る。`editor.replaceRange`（`applyLineEditOutcome` 内、
`src/commands/applyLineEditOutcome.ts` 155-193行）は同期的にCodeMirror
のトランザクションを確定させ、`editor-change` もこれに同期して発火す
る。150msデバウンスにより、実際の比較処理はその場では実行されず、
`originalText` 等の再アンカーは同じ呼び出しスタック内で既に完了して
いるため、デバウンス発火時点では自己の変更は既に反映済みであり、外部
変更として誤検知されない。この結論は、比較処理が常に最新の
`this.originalText` 等をクロージャで固定せず都度読む実装であることが
前提であり、実装時にこの前提を崩さないことを必須確認事項とする。

### stale 状態での Apply ボタンの扱い、keyboard/popout/mobile、accessibility

第1版から変更なし。stale 状態での Apply ボタン disabled 化の是非、
keyboard shortcut の要否、popout/mobile への影響、accessibility 配慮
は、いずれも未確定の候補として残る。


### 案A／案B／案C／案D の比較と推奨（第2版: 検知手段の記述を更新）

3節・4節の検討を踏まえ、4つの設計候補を比較する。第1版からの変更点
は、検知メカニズムの記述を「`activeMarkdownView`一致」から「`sourcePath`
のファイル変更をvaultレベルで検知」へ更新したことのみであり、比較の
結論（推奨=案C）自体は変わらない。

| 案 | 概要 | dirty編集の安全性 | staleさの可視化 | 実装複雑度 | 既存パターンとの整合性 |
|---|---|---|---|---|---|
| 案A: 常時自動再読み込み | `sourcePath`の変更を検知するたびdirty/cleanを問わずtextareaを自動更新する | 低（dirtyな未保存編集を無断で失う恐れがある） | 高（常に最新を表示するため見た目上staleにならない） | 中 | 低（既存のisDirty/DiscardChangesModal契約と衝突する） |
| 案B: 常にstale表示・Apply fail-closed・明示Reloadのみ | `sourcePath`の変更を検知したら常にstale表示にとどめ、textareaは変更せず、Reloadを押した時だけ最新化する | 高（textareaは常に無断更新されない） | 高（変更があれば必ずstale表示になる） | 低〜中 | 高 |
| 案C（推奨）: dirtyでなければ自動再読み込み、dirtyならstale表示・Apply fail-closed・明示Reload | cleanなPaneは、対象がアクティブなeditorである場合に限り安全に追従し（3節）、dirtyなPaneまたは対象が非アクティブな場合はstale表示にとどめる | 高（dirty編集は一切自動上書きされない） | 中〜高 | 中（clean/dirtyに加え、対象がアクティブかどうかの分岐も必要、3節） | 高（Tree Viewの「変更があれば追従する」という既存の使用感と一貫する） |
| 案D: Undo/Redoのみ特別扱いし即時同期、他の本文変更はstale表示 | Undo/Redoだけを個別に検知し即時反映、それ以外はstale表示にとどめる | 高 | 中 | 高（CodeMirrorのUndo履歴を個別にフックする前例が見当たらない） | 低 |

**推奨は引き続き案C。** 第2版の3節で確定した通り、検知そのものは
`vault.on("modify")`等により対象がアクティブでなくても成立するが、
textareaの自動更新（④）は対象がアクティブなeditorである場合に限る、
という一段細かい条件が加わった。この条件下でも、cleanなPaneがTree
Viewと同様の使用感で追従できる範囲は十分に広く、dirtyな未保存編集を
一切自動上書きしないという最重要の安全性を維持できるため、案Cの優位
性は変わらない。

案Aは引き続き不採用（dirtyな未保存編集を無断で失う危険）。案Bは引き
続き、cleanなPaneまで一律stale表示にする必要性が低いと判断し優先度を
下げる。案Dは引き続き、Undo/Redo個別フックの実装コストと前例のなさか
ら優先度を下げる。

この推奨はこの段階での確定ではなく、実装チケット開始時に開発指示者の
最終承認を要する。


## 5. 対象種別ごとの共通化

「全種別を一つの巨大な抽象化へ統合する」ことは前提にしない。既存の、
種別ごとに異なる安全な識別・再解決ロジックはそのまま保持し、stale 検
知・Reload 入口・dirty 確認という、種別に依存しない部分だけを最小限に
共有する方向を優先する。

### 種別ごとの現行方式の比較

| 種別 | anchor/snapshot/originalText | current document再解決方式 | conflict/resolve failureの理由型 | 再読み込みに使える既存load関数 | Apply成功後の再アンカー |
|---|---|---|---|---|---|
| section/list subtree | `nodeId`（scan-local id）＋`originalText` | `extractSubtreeText`によるid解決＋`current.text !== originalText`の完全一致照合（`src/edit/partialEdit.ts`） | `"conflict"`／`"resolve-failed"`／`"unsafe-indent"`等 | `loadNodeInternal` | `originalText = newRawText`（1789行） |
| standalone callout/blockquote | `nodeId`＋`originalText`＋`quoteProjection` | `extractSubtreeText`の`scanComplexBlocks`フォールバック経由（`doc.nodes.get(nodeId)`失敗時） | 同上＋quote固有の`"nested"`／`"no-body"` | `loadNodeInternal` | 同上、加えて`quoteProjection`の再構築 |
| paragraph | `paragraphAnchor`（id＋parentId＋depth＋originalText等の複合） | `applyParagraphEdit`の二段階解決（id一致優先、不一致時は同親同深度での内容完全一致による構造fallback） | `"content-changed"`／`"anchor-unresolved"` | `loadParagraphInternal` | Apply後の新位置から`resolveParagraphAtCursor`で完全再解決（1578-1583行、旧anchorのspreadではなく毎回フレッシュに再解決する設計であることを確認済み） |
| CompositeBlock全体 | `compositeAnchor`（`CompositeBlockSnapshot`＝ruleId/sectionId/range/members） | `applyCompositeBlockEdit`による`current.text !== originalText`照合＋`findRangeInvalidReason`／`snapshotMatches`の構造照合 | `"conflict"`／`"range-invalid"`／`"snapshot-mismatch"` | `loadCompositeInternal` | `outcome.resolvedSnapshot`があればそれを新`compositeAnchor`に、なければnull化（1650-1656行） |
| CompositeBlock member（callout/blockquote projection経路） | CompositeBlock全体のcompositeAnchorに含まれる。member単体のPartial Edit経路は現状Pane側では独立concept化されていない | 同上（CompositeBlock全体としての再解決に含まれる） | 同上 | `loadCompositeInternal` | 同上 |

### 共通化できる可能性がある部分

- 3節で確定した本文変更検知（`vault.on("modify"/"rename"/"delete")`・
  `editor-change`等の購読）自体は、種別を問わず Pane 全体で1つで足り
  る。
- 4節のstale/Reload/dirty確認のUI（バナー・ボタン・`DiscardChangesModal`
  の拡張再利用）も種別を問わず共通化できる。
- 「読み込み済みの何かがある」という判定は既存の
  `nodeId !== null || paragraphAnchor !== null || compositeAnchor !== null`
  （1888行の`isDirty()`内の条件）が既に種別横断で共通化されている。

### 種別固有に残すべき部分

- 実際の「再解決できるか」の判定ロジック自体（`applySubtreeEdit`／
  `applyParagraphEdit`／`applyCompositeBlockEdit`のそれぞれの照合方式）
  は、種別ごとの識別基盤（id単独／id＋構造／内容ベースのsnapshot）が
  根本的に異なるため、統合すべきではない。paragraphのid優先・構造/内
  容フォールバックという設計、CompositeBlockのruleId/range/members照
  合という設計は、それぞれ既存のPhase 5P・Phase 5D-2Aでの安全性設計の
  産物であり、これを一つの汎用関数に統合しようとすると、種別ごとに異
  なる「安全に再解決できたとみなしてよい条件」が曖昧になる危険がある。
- `ruleStillMatches`（CompositeBlock固有、`ApplyCompositeBlockEditOutcome`
  のフィールド）や、paragraphのid優先／構造・内容fallbackは、それぞれ
  の種別のApply結果の意味づけに直結しており、共通化の対象にしない。
- `quoteProjection`のプレフィックス投影・復元ロジックは、callout/
  blockquote（standalone・CompositeBlock member双方）に固有であり、
  section/list/paragraphには存在しない概念のため共通化しない。

### stale検知との関係

3節で確定した検知購読は、種別を問わずPane全体に1つ登録すれば足りる。
検知後に「読み込み済みの対象が今も存在し、内容が一致するか」を実際に
確認する処理は、種別ごとの既存の再解決関数（`extractSubtreeText`／
`applyParagraphEdit`相当の読み取り専用版／CompositeBlock再マッチング）
をそのまま、`vault.cachedRead`経由で取得したテキストに対しても呼び出
せる形にすることで、Apply時の安全性ロジックを重複実装せずに再利用で
きる可能性がある。この点は実装時にさらに詳細化が必要である。


## 6. テスト計画（第2版で更新）

実装前に必要となるテストを、純関数・View state・UI wiring・回帰・実機
受入に分けて設計する。実機確認は開発指示者が行う前提であり、Claude が
代行することはない。

### 純関数レベル

- `vault.on("modify")`等から得た`file.path`と`sourcePath`の比較処理
  が、変更あり/なしを正しく判定すること。
- 種別ごとの既存read-only再解決処理（新設する場合）が、
  `vault.cachedRead`経由のテキストに対しても、対象の存在/消失/内容一
  致/内容不一致を正しく報告すること。

### View state（PartialEditView 単体）

- CompositeBlockでApply後に本文側が変わると`stale`と判定される。
- section/list、paragraph、standalone callout/blockquoteでも同様に
  `stale`と判定される。
- **（新規）対象ファイルが現在アクティブなeditorではない状態（別ノー
  トを閲覧中、またはpopout Paneで別windowがアクティブ）でも、
  `vault.on("modify")`経由でstale判定が行われること。**
- **（新規）複数Paneが同じファイルを開いている場合、一方のApplyが他
  方を正しくstale化すること。**
- **（新規）複数Paneが異なるファイルを開いている場合、一方への変更が
  他方に影響しないこと。**
- cleanなPaneで、対象がアクティブなeditorである場合に外部変更を検知
  すると自動的にtextareaが更新されること。
- cleanなPaneで、対象が非アクティブなeditorの場合は外部変更を検知し
  てもtextareaが自動更新されず、stale表示のみが行われること。
- dirtyなPaneで外部変更を検知した後もtextareaの値が無断で変わらない
  こと。
- staleなPaneからApplyしても本文が変わらないこと（既存のfail-closed
  契約の非回帰確認を兼ねる）。
- staleなPaneでReloadを実行した場合に最新本文が読み込まれること。
- **（更新）dirty＋staleなPaneでReloadを選んだ際、Reload専用の
  Discard/Cancel確認UIが表示され、Applyの選択肢が存在しないこと。**
- **（新規）Reload確認UIでDiscardを選ぶと最新本文で上書きされ、
  Cancelを選ぶとtextarea・anchor・originalText・stale表示のいずれも
  変わらないこと。**
- Reload時に対象が削除・構造変更・再解決不能なら、別範囲を推測表示せ
  ず`unavailable`相当の状態になること。
- **（新規）`sourcePath`のファイルが削除された場合に`unavailable`へ
  遷移すること。**
- **（新規）`sourcePath`のファイルがリネームされた場合に、Paneの
  `sourcePath`が新しいパスへ追従し、内容の読み込みが継続すること。**
- Apply成功直後に、自分自身の変更を誤って`stale`扱いしないこと（4節
  で確認した競合回避の直接テスト）。
- **（更新）既存の`DiscardChangesModal`の3つの既存呼び出し箇所
  （`requestLoadNode`／`requestLoadParagraphAtCursor`／
  `requestLoadComposite`）が、`showApply`引数追加後もApplyボタンを含
  め挙動が一切変わらないことの回帰テスト。**

### UI wiring

- Undo/Redo・本文直接編集・別PaneのApply・TreeのMove/Delete/D&Dのそれ
  ぞれを更新源としたシナリオでの挙動確認。
- 複数Pane、popout window、active file切替、node切替、breadcrumb切替、
  Close/Reopenの各シナリオでの非回帰確認。
- selection・scroll・focus・isDirty・Applyボタンの表示/非表示・Notice
  文言の回帰確認。
- 新規i18nキーのen/ja parity確認（既存の`tests/`配下に存在するi18n
  parityテストのパターンを踏襲する想定）。
- **（新規）Reload確認UIのApplyボタン非表示に関するaccessibility観点
  （aria属性、フォーカス順序）の確認。**

### 回帰（既存契約の非回帰）

- 既存のconflict検知・snapshot再解決・range安全性のいずれも緩めてい
  ないことを、既存テストファイル（`tests/compositeBlockPartialEdit.test.ts`
  ／`tests/partialEdit.test.ts`／`tests/paragraphPartialEdit.test.ts`
  等）が変更後も全てpassし続けることで確認する。
- `DiscardChangesModal`共有クラスの変更が、既存3呼び出し箇所の挙動に
  一切影響しないこと（上述）。

### 実機受入（開発指示者が実施、最小限の確認観点のみ）

詳細なテンプレート・チェックシートは作成しない。少なくとも以下の観点
だけを、開発指示者による実機確認の対象として記録する。

- Apply後に本文側でUndoした場合、Paneがstale表示になること。
- dirtyな編集中に他の変更があっても、編集中の内容が消えないこと。
- Reload操作で最新内容が正しく読み込まれること。
- **（新規）対象ファイルを閲覧していない間に別Paneや他の操作で内容が
  変わり、後で対象ファイルに戻ったとき、Paneがstale表示になっている
  こと（第1版の欠陥そのものの解消確認）。**
- **（新規）dirty＋staleなPaneでReloadを選んだとき、Applyの選択肢が
  表示されないこと。**
- 対象が消失した場合に、Paneが誤った内容を表示しないこと。

## 7. 変更予定ファイルと非対象（第2版で更新）

実コードを読んだ上での最小変更候補を示す。推測で確定せず、いずれも実
装開始時に改めて確認する前提の候補である。

### 変更予定ファイル候補

| ファイル | 想定される変更内容（候補） |
|---|---|
| `src/view/PartialEditView.ts` | 3節の検知購読（`vault.on("modify"/"rename"/"delete")`・`editor-change`・`active-leaf-change`・`file-open`）の追加、4節のstale/Reload/unavailable状態・UI要素の追加、`isDirty()`周辺への`stale`概念の統合、`DiscardChangesModal`拡張呼び出し箇所の追加 |
| `src/i18n.ts` | stale表示・Reloadボタン・unavailable表示用の新規`partialEdit.*`キー（en/ja両方） |
| `styles.css` | stale表示用のバナー/ラベル、Reloadボタンのスタイル（既存の`unified-outliner-partial-edit-*`クラス群、42件確認済み、と同じ命名規則を踏襲する見込み） |

### 新規テスト候補

- `tests/` 配下に、既存の`partialEdit*`系テストファイル群と並ぶ形での、
  stale検知・Reload専用の新規テストファイルを追加する見込みだが、ファ
  イル名・分割方針は実装時に確定する。6節の新規テスト項目（複数Pane・
  popout・非アクティブファイル・rename/delete・Reload確認UI）を含む。

### 新規i18n候補

- stale状態を示すラベル文言
- Reloadボタンのラベル文言
- unavailable（対象削除・再解決不能）を示す文言
- （任意）Reload確認UI専用のタイトル/本文文言、既存の
  `partialEdit.unsavedChangesTitle`/`Body`の再利用でも可
（いずれもen/ja両方、既存の`partialEdit.*`命名規則に従う想定）

### 新規CSS候補

- staleバナー/ラベルの見た目
- unavailable表示の見た目
- Reloadボタンの見た目
（既存の`unified-outliner-partial-edit-*`クラス命名規則を踏襲する想定）

### 明確な非対象

以下は本チケット（Phase 5A-1）の対象外であり、設計・実装のいずれにも含
めない。

- 本文とPaneの無条件リアルタイム双方向同期（案Aとして明示的に不採用）
- dirtyなPaneのtextarea自動上書き
- Pane側未保存編集の無断破棄
- conflict検知・snapshot再解決・range安全性の削除または緩和
- Partial Editの本文書き換えexecutor（`applySubtreeEdit`／
  `applyParagraphEdit`／`applyCompositeBlockEdit`等）の作り直し
- CompositeBlockルール自体の変更
- Tree D&D、Move、Delete、Renameの仕様変更
- mobile native D&Dの仕様変更
- settings、version、CHANGELOG、tag、GitHub Release
- `docs/git-push-runbook.md`のstage、commit、編集
- 既存`docs/git-push-release-runbook.md`の変更
- **（新規）dirty＋stale Reload確認UIにApplyの選択肢を残すこと（今回
  撤回した設計）**
- **（新規）stale検知・自動reloadの条件を`activeMarkdownView`一致に
  依存させること（今回撤回した設計）**

## 8. 実装開始ゲート（第2版で更新）

実装開始前に、少なくとも以下を確認済みとする。

- Undo後のstale PaneからApplyして本文が変更されないことを、既存テス
  トと実機観察の両方で確認済みである（既存テストでの確認は判定1調査
  で完了済み。実機観察は開発指示者が別途実施する）。
- 採用する本文変更検知イベントが確定している（3節: `vault.on("modify"
  /"rename"/"delete")`・`editor-change`・`active-leaf-change`・
  `file-open`の組み合わせ）。
- **（新規）テストモック層（Obsidian APIモック）が`vault.read`／
  `vault.cachedRead`／`vault.on("modify"/"delete")`をサポートしている
  か、サポートしていない場合はモック拡張が必要かを確認済みである。**
- clean/dirty/stale/unavailableの状態遷移が確定している（2節の候補か
  らの最終決定）。
- **（新規）stale検知が`activeMarkdownView`一致に依存しない設計になっ
  ていることが確認済みである（3節）。**
- dirtyなPaneを無断で上書きしない設計になっていることが確認済みであ
  る。
- **（更新）dirty＋stale Pane の Reload 確認 UI に Apply の選択肢が
  含まれない設計になっていることが確認済みである（4節、案R2）。**
- **（新規）`DiscardChangesModal`の拡張が、既存3呼び出し箇所の挙動を
  一切変えないことを回帰テストで確認済みである。**
- Reload時に既存`DiscardChangesModal`（拡張後）を再利用できることが確
  認済みである。
- section/list、paragraph、standalone callout/blockquote、
  CompositeBlockの各再解決経路を壊さないことが確認済みである。
- stale状態でApplyの安全性を緩めていないことが確認済みである。
- テスト追加先と実機確認の最小観点（6節）が確定している。
- 変更予定ファイル（7節）が最小化されている。
- `docs/git-push-runbook.md`とは別のcommitにすることが理解されている。


## 9. Hardening 実装で確定した安全性契約（付記、2026-09-07）

読み取り専用レビュー（本ドキュメント第2版までの実装に対する安全性・
アクセシビリティ・テスト品質レビュー）で指摘された4件の hardening 項
目を実装した結果、確定した安全性契約を以下に記す。実装自体は
`src/view/PartialEditView.ts`・`src/edit/paragraphPartialEdit.ts`・
新規 `src/view/partialEditSyncClassification.ts` に対して行った。

### 9.1 自己Applyタイミング競合の構造的抑止（hardening §1）

`PartialEditView`に`private isApplyingOwnEdit = false;`を追加した。
`applyEdit()`の paragraph／composite／node の3分岐それぞれについて、
本文への書き込み呼び出し（`applyLineEditOutcome`）の直前で
`isApplyingOwnEdit = true`を設定し、この Pane 自身の再アンカリング
（`originalText`・各アンカーフィールドの再代入）が完了した直後に
`try/finally`で必ず`false`へ戻す。抑止期間中に到着したイベントは
`performStaleCheck`（`shouldRunStaleCheck`経由）と`evaluateAgainstText`
の両方の入口で確実に無視され、キューイングもされない（破棄方式を採
用）。抑止解除の直後には`scheduleStaleCheck()`を1回だけ明示的に呼び
出し、抑止中に破棄されたイベントの有無に関わらず改めて1回の再検証が
必ず走ることを保証する。Apply成功時は再アンカリング完了直後に
`this.syncState = "synced";`を無条件で設定する（`requestLoadNode`等
の「Apply and switch」経路はstale状態のままApplyへ到達し得るため）。
Apply失敗時（`outcome.changed === false`の早期return）は
`isApplyingOwnEdit`に一切触れない — 本文への書き込みより前に return
するため、抑止自体が不要である。低レベルの fail-closed 照合
（`applySubtreeEdit`／`applyParagraphEdit`／`applyCompositeBlockEdit`
自身の competing-edit 判定）はこの hardening で一切変更していない。

### 9.2 段落読み取り専用リゾルバの分離（hardening §2）

`resolveCurrentTarget`のparagraph分岐が使っていた
「`applyParagraphEdit(doc, anchor, anchor.originalText)`を捨て値
プローブとして呼ぶ」パターンを廃止し、`edit/paragraphPartialEdit.ts`
に新規`resolveParagraphAnchorText(doc, anchor)`を追加してこれを置き
換えた。`applyParagraphEdit`とは`supportedParagraphCandidates(doc)`・
`extractParagraphText(doc, b)`という共有ヘルパーを介して走査ロジック
を共通化しているが、Pass 1（id一致による高速path）の判定条件は
`applyParagraphEdit`と完全に同一（id・parentId・depthに加えて内容も
一致することを要求）とし、意図的に緩めていない — 段落の`complexBlockId`
はスキャン呼び出しごとの通し番号に過ぎず永続的な識別子ではないた
め、内容一致を伴わない構造一致だけで「同一の論理段落」と判定するの
は、並び替え後に別の段落を誤って同一視する具体的な危険があることを
実装中に自テストで確認した（本ドキュメント巻末のコミット差分参照）。
両関数が唯一異なるのはPass 2で内容が一致する候補が0件だった場合の
扱いのみである — `applyParagraphEdit`はここで常に`"content-changed"`
という理由文字列のみを返し特定の候補を名指ししないが（Applyは安全
に拒否すればよいため）、読み取り専用の`resolveParagraphAnchorText`
は「同一parent/depth配下の候補数が`anchor.siblingCount`と一致し、
かつ候補が1件のみ」という条件下でのみ、その1件を安全に一意特定でき
るものとして現在のテキストを返す。それ以外（候補数不一致、または
候補が複数で一致するものがない）は`ambiguous: true`とし、決して推
測しない。`applyParagraphEdit`自身の公開シグネチャ・成功/失敗理由・
挙動はこの hardening で一切変更していない（非退行は
`tests/paragraphPartialEditResolveReadOnly.test.ts`の専用テストで確
認済み）。

> 本節末尾の「候補数不一致、または候補が複数で一致するものがない場
> 合はambiguous: trueとし決して推測しない」という記述は、hardening
> §2実装時点（本ドキュメント第2版まで）の`resolveParagraphAnchorText`
> の挙動である。候補が複数で一致するものがない場合（`exactMatches.length
> === 0`）の扱いは、9.5節のPass 3実装によりその後拡張されている。
> 「候補数不一致（`sameSlot.length !== anchor.siblingCount`）」の場合
> に決して推測しないという性質そのものは、Pass 3導入後も変わらず維
> 持されている。詳細は9.5節を参照。

### 9.3 `vault.cachedRead`失敗時のfail-closed処理（hardening §3）

`performStaleCheck`（受動的な検知経路）の`vault.cachedRead`呼び出し
に`.catch(() => {})`を追加した。ユーザーが明示的に要求した操作では
ないため、拒否時は一切の状態変更（textarea／quote入力／
originalText／アンカー／syncState）を行わず、Noticeも出さずに静かに
失敗する — 次に発火するいずれかのイベントが改めて再検証する。
`executeReload`（明示的なReload操作）の`vault.cachedRead`呼び出しは
`try/catch`で包み、拒否時は既存の解決失敗分岐と同一の扱い
（`transitionToUnavailable()` + `partialEdit.reloadFailedNotice`の
Notice表示、生のエラー内容やパスは一切露出しない）とした — ユーザー
が明示的に要求した操作である以上、より確定的な失敗として扱ってよい
という判断による。いずれの経路もdirtyなバッファ・既存アンカーは変
更しない。

### 9.4 純粋関数への分離とテスト（hardening §4）

`evaluateAgainstText`が内包していた分類ロジック（stale／unavailable／
already-synced／clean-pane-auto-reloadのいずれに遷移するか）と、
`performStaleCheck`が内包していたゲート判定（closed／自己Apply抑止
中／すでにunavailable、のいずれかであれば何もしない）を、Obsidian非
依存の新規モジュール`src/view/partialEditSyncClassification.ts`の
`classifySyncOutcome`／`shouldRunStaleCheck`としてそれぞれ抽出した。
`PartialEditView`側はこれらを呼び出して結果に応じた副作用
（`transitionToStale`等の呼び出し・`performAutoReload`の呼び出し）
を行うだけの薄いディスパッチに変更している。Obsidianの完全モックを
新規構築することはせず、既存方針（Obsidian非依存な部分だけを純粋関
数として切り出す）を踏襲した。実行可能な実アサーションテストを
`tests/partialEditSyncClassification.test.ts`（14件、決定表の主要な
組み合わせを網羅）と`tests/paragraphPartialEditResolveReadOnly.test.ts`
（10件、`resolveParagraphAnchorText`の解決・非解決・非退行を検証）
に追加した。既存の静的ソーステキスト検査
（`tests/partialEditStalePaneSyncUiWiring.test.ts`）は削除・弱体化
せず、配線（PartialEditViewが正しい箇所でこれらの純粋関数を呼び出し
ていること）の確認に役割を絞って更新した。


### 9.5 paragraph anchor 再解決契約の構造的拡張 — Pass 3 による stale/Reload 復帰 hardening（hardening §5、2026-09-08 追記）

実機受入で、同一section（または同一parent）配下に複数paragraphが存
在するノートにおいて、対象paragraphをPartial Edit Paneで開いた後に
「Paneで追加編集をApply→本文側でUndoしてApply内容を打ち消す→Pane
がstale化→Reload」という操作を行うと、対象paragraph自体は削除され
ていないにもかかわらずReloadが失敗し、Paneがunavailableになる問題
が報告された。原因は、hardening §2時点の`resolveParagraphAnchorText`
のPass 2フォールバックが「同一parent/depth配下の候補数が
`anchor.siblingCount`と一致し、かつ候補が1件のみ」という単一候補限
定の条件でしか安全に一意特定できていなかったためであり、同一section
内に2件以上のparagraphが存在する通常のノート構造では、対象paragraph
自身の内容が変化した時点でこのフォールバックが機能しなかった。この
問題は「fixtureからparagraphを減らして隠す」「Reload失敗を仕様とし
て文書へ固定する」のいずれの対応も採用せず、paragraph anchorの再解
決契約そのものを拡張することで解決した。

**`ParagraphEditAnchor`への追加フィールド**

`buildParagraphEditAnchor`が既存の`siblingCount`計算と同一の
`sameSlot`候補配列（`kind === "paragraph" && editability === "supported"
&& parentId一致 && depth一致`、ドキュメント順）から、追加の走査なし
に以下3フィールドを新規算出する。

| フィールド | 型 | 内容 |
| --- | --- | --- |
| `siblingIndex` | `number`（型上はoptional） | anchor構築時点における、`sameSlot`内での対象paragraph自身の0始まり位置。`findIndex`で求まらない防御的なケースでのみ`-1`。 |
| `prevSiblingText` | `string \| null`（型上はoptional） | `sameSlot[siblingIndex - 1]`の抽出テキスト。先頭（`siblingIndex === 0`）またはindex不正なら`null`。 |
| `nextSiblingText` | `string \| null`（型上はoptional） | `sameSlot[siblingIndex + 1]`の抽出テキスト。末尾またはindex不正なら`null`。 |

3フィールドを型上optionalとしたのは、`edit/paragraphTreeMove.ts`の
`ParagraphMoveAnchor`（Tree の rename／pending-paragraph-insert commit
経路、`view/OutlineTreeView.ts`、いずれも今回の変更対象外かつ変更禁
止）が、`ParagraphEditAnchor`の従来5フィールドとの構造的互換性のみ
に依存して`applyParagraphEdit`へ直接渡されている既存の呼び出し方が
複数あり、これらを必須フィールドにすると型検査（`tsc -noEmit`）が
壊れるためである。`applyParagraphEdit`自身は`siblingIndex`／
`prevSiblingText`／`nextSiblingText`のいずれも一切参照しないため
（後述）、実行時挙動への影響はない。`buildParagraphEditAnchor`経由
で構築される本来の`ParagraphEditAnchor`（`resolveParagraphAnchorText`
の唯一の実際の呼び出し元である`PartialEditView`の`paragraphAnchor`
フィールドを含む）では、3フィールドは常に実値で埋まる。

**`resolveParagraphAnchorText`のPass 1〜Pass 3**

| Pass | 到達条件 | 判定内容 | 結果 |
| --- | --- | --- | --- |
| Pass 1 | 常に最初に試行 | id一致 かつ parentId／depth／内容が全て一致 | 一致すれば即resolve（hardening §2から不変） |
| Pass 2 | Pass 1不一致 | 同一parent/depth候補中の`anchor.originalText`完全一致件数 | 1件ならresolve、2件以上ならambiguous（hardening §2から不変） |
| Pass 3 | Pass 1・Pass 2がいずれも失敗（完全一致0件） | `resolveViaSiblingContext`の4条件（後述） | 全条件成立でresolve、いずれか不成立でambiguous（本節で新規追加） |

Pass 1・Pass 2の判定条件自体は本hardeningで一切変更していない。Pass 3
は「Pass 1・Pass 2のいずれも対象を一意特定できなかった場合」にのみ
到達する、`resolveParagraphAnchorText`専用の追加フォールバックであ
る。`applyParagraphEdit`側のPass 2フォールバック（完全一致0件の場
合に`sameSlotCandidates.length === anchor.siblingCount`の可否だけで
`"content-changed"`／`"anchor-unresolved"`のいずれかの理由文字列を
返し、候補を一切名指ししない）は、本hardeningで一行も変更していな
い。Pass 3はPass 3という名前の通り読み取り専用resolverの内部にのみ
存在し、Apply系の書き込み判定には一切接続されていない。

**Pass 3（`resolveViaSiblingContext`）の4条件**

以下すべてを満たした場合のみ、`anchor.siblingIndex`位置の候補を対
象paragraphとして安全に特定し、その現在テキストを返す。いずれか1つ
でも不成立ならば`{ ok: false, text: null, ambiguous: true }`を返し、
決して推測しない。

1. 現在の`sameSlot.length`が`anchor.siblingCount`と一致すること（同
   一parent/depth配下のparagraph母数が anchor構築時から変化していな
   いこと）。
2. `anchor.siblingIndex`が現在の`sameSlot`に対する有効なindexである
   こと（`undefined`および`-1`は無効として扱う）。
3. 現在の`sameSlot`内に、内容が完全一致（byte-for-byte）する候補が
   一切存在しないこと（重複テキストガード。本hardeningでの独自追加
   — 詳細は次項）。
4. `siblingIndex`の直前候補の現在テキストが`anchor.prevSiblingText`
   と一致し、直後候補の現在テキストが`anchor.nextSiblingText`と一致
   すること（いずれも`null`境界を含め厳密比較）。

**条件3（重複テキストガード）を追加した経緯 — 反例による安全性検証**

実装着手前の指示で「前後兄弟本文が偶然完全一致する場合にPass 3が一
意性を保証できるか、実コードとテストで再確認せよ」という安全性ゲー
トが課されていたため、実装前に一時的な使い捨てvitestテストファイル
（実装完了後に削除、`git status --short`で残存なしを確認済み）を用
い、実際の`parseDocument`／`scanComplexBlocks`／`buildParagraphEditAnchor`
に対して反例を2件構築・実行検証した。

反例1（実在する反例、条件3で解消）: 変更前が段落A・B・C（3件、対象
は index 1 の B、prev="A"、next="C"）で、変更後にBが削除され、代わ
りにCの複製がindex 2に追加された場合（A・C・C）、母数は3のまま維持
され、`siblingIndex`（1）も有効、prev="A"・next="C"という条件4も両
方成立してしまう——にもかかわらず、index 1の実際の内容はBの後継で
はなく、Cの無関係な複製である。この反例が条件3を追加する直接の根拠
であり、`tests/paragraphPartialEditResolveReadOnly.test.ts`の
「count-preserving delete+insert compensation」テストとして反例その
ものを恒久テスト化した。

反例2（構築したが安全性違反ではないと判断）: 変更前がA・B・Cで、変
更後にBのみが全く無関係な新規テキストDに置き換わり、A・Cはそのまま
（A・D・C）という場合も、文字面上は条件1〜4（条件3の重複ガード込
み）を満たしresolveする。しかしこれは、Markdownがparagraphに永続的
な識別子を一切持たない以上、「対象paragraph自身の内容が直接Dへ編集
された」という説明と客観的に区別不能であり、かつ`applyParagraphEdit`
自身のPass 1／Pass 2は常にPass 3の表示内容と自己整合するため（次項
参照）、後続のApplyが無関係な第三のparagraphを誤って上書きするリス
クは存在しない。「真の編集履歴」を復元することはMarkdownの表現力を
超えた本質的に決定不能な問題であり、Pass 3の正しさの基準として要求
すべきものではないと判断し、これは安全性違反の反例には該当しないと
結論した。

**Pass 3が使われない、または安全側に倒れるケース**

paragraph挿入（前方／後方）・隣接paragraph削除（前方／後方）・件数
維持の削除＋挿入による補償・split・merge・reorder・parent/section変
更・非paragraph種別・類似度に基づく推測は、いずれもPass 3のいずれか
の条件を破ることで安全側（`ambiguous: true`）に倒れるか、そもそも
Pass 3の対象候補配列（`sameSlot`）自体に現れない（parentId/depth変
更は`sameSlot`のフィルタ条件そのものにより上流で除外される）。reorder
は、対象自身のテキストが変化していない限りPass 2の完全一致探索です
でに正しく解決されるため、Pass 3が介在する必要がない。重複内容の
paragraphは条件3により常にambiguousとなる。`applyParagraphEdit`自身
の書き込み対象再解決（Apply自身のPass 1／Pass 2）はPass 3を一切呼び
出さない。

**Apply（`applyParagraphEdit`）の契約は無変更**

`applyParagraphEdit`の公開シグネチャ・拒否理由
（`"anchor-unresolved"`／`"content-changed"`／`"blank-line-not-allowed"`）・
fail-closedな判定ロジックは、本hardeningで一切変更していない。dirty
またはstaleなPaneが、Pass 3が読み取り専用で復元した`originalText`を
使ってApplyできてしまうことはない——Apply自体を抑止する
「stale/unavailable中はApplyボタンを無効化する」というUI側の契約
（hardening §1、9.1節）にもPass 3による変更はない。
`tests/paragraphPartialEditResolveReadOnly.test.ts`に、
`resolveParagraphAnchorText`がPass 3経由でresolveする同一の
doc/anchorに対して`applyParagraphEdit`を呼んだ場合に依然として
`"content-changed"`で拒否されることを直接確認する統合テストを追加
した。

**テスト**

`tests/paragraphPartialEditResolveReadOnly.test.ts`にPass 3専用の
describeブロックを3つ追加した（正常回復7件、fail-closed12件、Apply
との独立性確認1件、既存テスト分を含め同ファイル合計30件）。
`tests/paragraphPartialEdit.test.ts`（`applyParagraphEdit`自体の既
存29件）は変更していない。`tests/partialEditSyncClassification.test.ts`
・`tests/partialEditStalePaneSyncUiWiring.test.ts`は、
`classifySyncOutcome`／`shouldRunStaleCheck`の契約および
`view/PartialEditView.ts`の配線のいずれも本hardeningで変更していな
いため、変更していない。既存テストの削除・skip・弱体化は一切行って
いない。全100テストファイル・1927テストが green、`tsc -noEmit
-skipLibCheck`・`npm run build`・変更対象`src`ファイルへの
`eslint`のいずれも成功した。

**実機受入への影響**

Pass 3の追加により、同一section（またはlist item等の同一parent/depth）
配下に2件以上のparagraphが存在するノートで、対象paragraph自身の内
容変更（直接編集、または本文側Undo/Redoによる巻き戻し）が唯一の変
化である場合には、Reloadによる復帰が可能になった。挿入・削除・
split・merge・reorder・parentId/depth変更・重複内容paragraphが絡む
ケースは、引き続き安全側でunavailable（Reload失敗）またはstaleのま
まとなる——これは仕様上の既知の制約であり、fixtureを縮小したり、こ
の制約を隠したりする形での対応は行っていない。詳細な受入手順の更新
は`docs/phase5a1_partial_edit_stale_pane_manual_acceptance_test.md`
側に反映する。
