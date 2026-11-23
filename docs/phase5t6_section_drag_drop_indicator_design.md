# Phase 5T-6D: section / heading D&D の before/after drop indicator 再現・設計監査

本ドキュメントは Phase 5T-6D（docs-only。実装・仕様変更・GUI自動操作は禁止）の成果物である。Claude 自身は本フェーズにおいて GUI 操作・スクリーンショット・実機検証を一切行っていない。`src/`・`tests/`・`styles.css`・manifest・build 成果物のいずれにも変更を加えていない。

## 0. 背景・チケットの要求

Phase 5T-5A の実機確認（8項目、異常なし）中に、利用者が見出し（section）を Outline Tree 上でマウス drag & drop した際、移動先を示す区切り線（before/after の edge line）が表示されないことに気づいた。一方、移動先の行自体には lavender（薄紫）の「inside」ハイライトが表示された。利用者の実際の意図は「reorder（前/後に配置）」であり、「nest（子として配置）」ではなかった。

この報告を受けて実施した予備調査（動画フレーム抽出＋コード読解）では、コード・CSS自体は一見一貫しているように見えたが、動画の数フレームだけでは「カーソルが実際に edge zone（上下端の判定ゾーン）に入っていたか」を確定できなかった。そのため、本フェーズとして以下の4分類のいずれに該当するかを、コード・CSS・利用者の実際の設定値の監査によって判定することが求められた。

- (A) 仕様通り: カーソルが中央のinsideゾーンにあった。edgeゾーンに入れば正しく線が出る。
- (B) 表示・ロジック不具合: edgeゾーンでもbefore/afterが描画されない、またはinside indicatorがそれを不当に覆っている。
- (C) UX・設計上の不備: ロジック自体は正しいが、行の寸法・ゾーン比率・CSSにより、edgeゾーンの実用的な当てやすさが乏しい。
- (D) list/paragraph含む一般的な indicator管理の不具合。

## 1. 動画で確認できた事実と、その限界（明確な分離）

Phase 5T-6D着手前の予備調査で確認済みの事実（本フェーズで動画を再取得・再解析してはいない。前セッションで取得したフレームは本セッションのファイルシステム上に残っていないため、以下は前セッションで報告済みの内容の再掲であり、新規解析ではない）：

- 動画では、見出し「1. 案 A/B/C の簡潔な比較」を見出し「2. 推奨する起動方法」の方向へドラッグする操作が記録されていた。
- ドラッグ中、対象行に薄紫の背景ハイライト（inside相当の見た目）が表示されているフレームが確認できた。
- 抽出できたフレーム数は限られており、ドラッグ中のカーソルのY座標が対象行の上端何%・下端何%の位置にあったかを、フレームごとに正確に特定することはできなかった。

**限界**: 上記はあくまで「取得できた数フレームの範囲内での観察」であり、ドラッグ操作全体を通じてカーソルが一度も edge zone（後述、上下各1/3）に入らなかったことの証明ではない。また、その逆（edge zoneに入った瞬間があったのに線が出なかったことの証明）でもない。動画のみからは (A) と (B)/(C) を判別できない。

一方、本フェーズで新たに、動画に依存しない静的な根拠（§8で詳述）を確認できた。これは動画のフレーム精度に依存しないため、上記の限界を補う独立した証拠となる。

## 2. section D&D の現状データフロー（イベント→判定→表示→実行）

対象コード: `src/view/OutlineTreeView.ts`（`handleDragStart`/`handleDragOver`/`handleDragLeave`/`handleDrop`/`handleDragEnd`/`canDropAny`/`computeDropMode`/`setDropIndicator`/`clearDropIndicator`/`runRelocateCommand`、いずれも行4097〜4472付近）、`src/move/relocateSection.ts`（`canDropOn`/`relocateSection`）、`src/move/relocateListSubtree.ts`（`canDropListOn`/`relocateListSubtree`、section側と対称の実装）。

1. **dragstart**（`handleDragStart`）: `dragSourceId` に対象ノードIDを保持。`itemEl` に `.unified-outliner-dragging` を付与（opacity 0.5）。`dataTransfer` には実データを一切載せず（Tree外へのdrop時の内部ID漏洩防止、5T-2R由来の既定方針を section/list でも踏襲）。
2. **dragover**（`handleDragOver`、対象行ごとに連続発火）:
   - `canDropAny(doc, dragSourceId, targetId)` で構造的な可否のみを判定（自身・子孫への drop 拒否、type不一致拒否）。**mode（before/after/inside）は一切考慮しない** — 3-a参照。
   - 不可なら `preventDefault()` を呼ばない（ブラウザが「drop不可」カーソルを自動表示）。かつ、その行が現在の `dropIndicatorEl` なら indicator をクリア。
   - 可なら `preventDefault()`、`computeDropMode(evt, selfEl)` で行内のY座標比率から mode を算出し、`setDropIndicator(selfEl, mode)` を呼ぶ。
3. **dragleave**（`handleDragLeave`）: その行が現在の indicator 対象なら crear。
4. **drop**（`handleDrop`）: indicator を crear、drag状態を終了。`canDropAny` を再度確認後、`computeDropMode` をもう一度計算して `runRelocateCommand(sourceId, targetId, mode)` を呼ぶ。
5. **dragend**（`handleDragEnd`）: drag状態と indicator を終了・crear（ブラウザ側でdragがキャンセルされた場合、Escapeキー等でも発火）。
6. **runRelocateCommand**: `dispatchAndApply` 経由で、source が list なら `relocateListSubtree`、それ以外（section）なら `relocateSection` を、既存の move/indent/outdent と全く同じ dispatch 経路（フレッシュな再parse・`newStartLine` への selection-follow 含む）で実行する。

### 2-a. mode算出とcanDropAnyの分離という設計上の事実

`canDropAny` は **「このsourceをこのtargetにdropしてよいか」という構造的許可のみ** を判定し、before/after/insideのどのmodeが選ばれるかには一切関与しない（`relocateSection.ts`の`canDropOn`のdocコメント自身が明示: 「WITHOUT the mode-specific "inside would exceed level 6" check」）。つまり、**indicatorが表示されるかどうかは、mode（カーソル位置）に依存しない** — targetが構造的に有効な限り、上/中/下のどこにカーソルがあっても必ず何らかのindicator（before/inside/afterのいずれか）が表示されるはずである、という设计上の期待がコードから直接読み取れる。この期待に反する挙動（indicatorが全く出ない、または特定modeだけ出ない）があれば、それは(A)ではなく(B)/(D)を示す強い手がかりになる。

## 3. before/after/inside の CSS と視覚的意味

対象: `styles.css` 217〜244行目。

```css
/* before / after: 行の上端/下端の薄い線 */
.unified-outliner-drop-before {
  box-shadow: inset 0 2px 0 0 var(--uo-current-color);
}
.unified-outliner-drop-after {
  box-shadow: inset 0 -2px 0 0 var(--uo-current-color);
}
/* inside: 背景の色付け + 左端のアクセントバー */
.unified-outliner-drop-inside {
  background-color: rgba(91, 87, 209, 0.25);
  box-shadow: inset 3px 0 0 0 var(--uo-current-color);
}
@supports (background-color: color-mix(in srgb, red 25%, transparent)) {
  .unified-outliner-drop-inside {
    background-color: color-mix(in srgb, var(--uo-current-color) 25%, transparent);
  }
}
```

before/afterは**box-shadowのみ**（背景色を変えない）、insideは**box-shadow + background-colorの両方**を使う、という非対称な設計である。この非対称性が、§8の根本原因の核心に直結する。

`setDropIndicator`/`clearDropIndicator`（`OutlineTreeView.ts` 4412〜4432行）は、3つのクラス（`unified-outliner-drop-before/after/inside`）を毎回全て`removeClass`してから該当クラスのみを`addClass`するため、複数クラスが同時に残留する実装上の不具合は無い（cross-checkは§6参照）。

## 4. 実際の着地点 → 表示されるindicatorの対応表

| カーソルのY位置（対象行の高さに対する比率） | `computeDropMode`の返り値 | 表示されるCSSクラス | 実際のdrop結果（`relocateSection`） |
|---|---|---|---|
| 0 〜 1/3（上端） | `before` | `.unified-outliner-drop-before`（box-shadowのみ） | targetの直前に挿入（`insertBeforeLine = target.range.startLine`） |
| 1/3 〜 2/3（中央） | `inside` | `.unified-outliner-drop-inside`（box-shadow + background-color） | targetの最初の子（target自身の見出し・本文の直後、既存の子セクションの前）として挿入し（既存の子セクションが無い場合は従来どおりtarget範囲の末尾）、、見出しレベルを`target.headingLevel + 1`に付け替え |
| 2/3 〜 1（下端） | `after` | `.unified-outliner-drop-after`（box-shadowのみ） | targetの直後に挿入（`insertBeforeLine = target.range.endLine + 1`） |

表示位置とdrop実行位置の対応は**一致している**（`computeDropMode`が返したmodeがそのまま`runRelocateCommand`に渡され、`relocateSection`側もその同じmodeで同じ境界を使う）。paragraph D&D（5T-2S-Bで修正済み）のような「判定ゾーンと着地edgeのズレ」は、section/listには存在しない — 後者は隣接swap専用の特殊構造だが、section/list D&Dは任意位置への再配置であり、ホバー行自体が着地位置の基準行そのものであるため、ズレが原理的に発生しない（§6で詳述）。

## 5. edge zone / inside zoneの数値・定義

`computeDropMode`（`OutlineTreeView.ts` 4435〜4442行）:

```ts
private computeDropMode(evt: DragEvent, el: HTMLElement): DropMode {
  const rect = el.getBoundingClientRect();
  const ratio = rect.height > 0 ? (evt.clientY - rect.top) / rect.height : 0.5;
  if (ratio < 1 / 3) return "before";
  if (ratio > 2 / 3) return "after";
  return "inside";
}
```

閾値は固定の1/3・2/3（設定可能なオプションは無い）。`el`は`selfEl`（`.tree-item-self`）そのもので、`.tree-item-children`（折り畳み時に隠れる子要素群）は含まない — 折り畳み状態に関わらず判定対象の高さは行1行分のみである。

`.tree-item-self`のCSS上の padding は `8px 12px`（`styles.css` 169行目）。見出しの内容テキストの line-height 等は Obsidian既定テーマに依存するため、実際の行高さ（px）は環境依存だが、一般的なフォントサイズ・padding量から、通常1行の高さはおよそ28〜36px程度と推定される（**この推定値はコードの定数ではなく、環境依存の実測が必要な近似値であることに注意**）。この場合、上下各edgeゾーンの実寸はおよそ9〜12px程度になる計算であり、マウスでの精密な位置決めとしては狭い部類に入る。ただし本フェーズはこの数値の精密な実測を行っていない（§11の手動確認手順で利用者に実測を委ねる）。

## 6. section / list / paragraph の共通点・差異

| 項目 | section | list | paragraph |
|---|---|---|---|
| ドラッグハンドラ | `handleDragStart/Over/Leave/Drop/End`（共通） | 同左（完全に同じメソッド、`canDropAny`内でnode種別により分岐） | `handleParagraphDragStart/Over/Drop`（別系統、`handleDragLeave/End`のみ共有） |
| mode判定 | `computeDropMode`（3分割: before/inside/after） | 同左 | `computeParagraphDropZone`（2分割: before/after のみ、insideは存在しない） |
| indicator表示位置 | ホバー行自身の生のゾーン判定をそのまま描画 | 同左 | **5T-2S-Bにより、生のゾーンではなく実際の着地edge（`resolution.direction`）を描画するよう修正済み**（隣接swap特有の非対称性への対応） |
| 常時オンの装飾CSS（kind別） | `[data-section-highlight]`属性により、box-shadow（stripe）または background-color（subtle）のいずれかが**常時**適用され得る | `[data-list-highlight]`属性により、background-colorのみ（hover/subtle）が適用され得る。box-shadowを使うモードは存在しない | 該当する常時オン装飾CSSは無い（`data-kind`属性で対象化されるルールが存在しない） |
| indicatorとの property競合の可能性 | **box-shadow同士が競合し得る**（§8） | 競合しない（background-colorのみ） | 競合しない |
| canDropAnyのmode依存性 | 無し（構造的許可のみ、mode不問） | 同左 | 有り（`resolveParagraphDropDirection`は zone自体を許可判定に使う。ただしこれは元々の隣接swap限定という仕様設計であり、本フェーズが変更を検討する対象ではない） |
| 折り畳み対象への drop | 行自体は折り畳み状態に関わらず常に表示されており、drop対象として機能する（子孫のみが隠れる） | 同左 | 対象外（paragraphは折り畳みを持たない） |

**5T-5Aの`selectedId`/`highlightedId`契約との関係**: `runRelocateCommand`は既存の`dispatchAndApply`をそのまま使っており、`followSelection`のデフォルト（`true`）も変更していない。本フェーズはコード監査のみであり、この経路のいずれにも変更を加えていないため、5T-5Aの契約（再解決不能/非表示時はnullクリア、別ノードへの近似フォールバックなし）は本フェーズの調査対象コードから見て無傷である。

## 7. 4分類（A/B/C/D）の判定

**結論: 本フェーズの監査で確認した利用者の実際の設定値（後述§8）のもとでは、これは (B) 表示・ロジック不具合に該当する。** ただし、この不具合は section 固有であり、(D)（list/paragraph含む一般的な不具合）ではない。同時に、edge zoneの実寸自体が狭い可能性（§5）は(C)的な要素として併存し得るため、(B)の修正後も(C)の観点での見直しを推奨事項として残す（§9）。

(A)（カーソルがinsideゾーンに留まっていただけ）である可能性を完全には排除できないが、§8の静的な証拠は、**edge zoneに正確に入っていたとしても before/after の線は表示されなかったはずである**ことを示しており、動画のカーソル位置が不明であるという§1の限界とは独立に、(B)の存在を裏付けている。

## 8. 根本原因候補（エビデンス強度順）

### 候補1（最有力・直接確認済み）: `sectionMode: "stripe"` と drop-before/after/insideのCSS box-shadowプロパティ競合

利用者のプラグイン設定ファイル（`data.json`、Method vault: `.obsidian/plugins/unified-outliner/data.json`）を確認したところ、次の値であることを直接確認した:

```json
"treeKindHighlight": {
  "sectionMode": "stripe",
  "listMode": "hover",
  ...
}
```

既定値は`sectionMode: "subtle"`（`src/settingsDefaults.ts`の`DEFAULT_TREE_KIND_HIGHLIGHT`）だが、利用者の実際の設定は`"stripe"`である。`styles.css` 822〜828行目:

```css
.unified-outliner-tree-root[data-section-highlight="subtle"] .tree-item-self[data-kind="section"] {
  background-color: var(--uo-section-highlight-color);
  border-radius: 4px;
}
.unified-outliner-tree-root[data-section-highlight="stripe"] .tree-item-self[data-kind="section"] {
  box-shadow: inset 2px 0 0 0 var(--uo-current-color);
}
```

`sectionMode: "stripe"`は、**全section行に常時**、`box-shadow: inset 2px 0 0 0 var(--uo-current-color)`（左端の縦アクセントバー）を適用する。このセレクタは4つの単純セレクタ（`.unified-outliner-tree-root` + `[data-section-highlight="stripe"]` + `.tree-item-self` + `[data-kind="section"]`）から成り、CSS詳細度は概算 (0,0,4,0)。一方、`.unified-outliner-drop-before`/`.unified-outliner-drop-after`/`.unified-outliner-drop-inside`はいずれも単一クラスセレクタで詳細度 (0,0,1,0)。

**box-shadowは単一プロパティであり、複数の宣言が競合した場合はCSS詳細度が高い方が、クラスが後から追加された順序に関わらず常に勝つ。** したがって、`sectionMode: "stripe"`が有効な間、section行では:

- `drop-before`のbox-shadow（上端の線）→ **常にstripeのbox-shadowに上書きされ、非表示**
- `drop-after`のbox-shadow（下端の線）→ **常にstripeのbox-shadowに上書きされ、非表示**
- `drop-inside`のbox-shadow（左端の太いバー）→ 同様に上書きされるが、**`background-color`は全く別のプロパティのため上書きされず、そのまま表示される**

これは利用者が実際に観察した内容（「対象行に薄紫のinside背景ハイライトは出たが、before/afterの線は出なかった」）と**完全に一致する**。かつ、この結論はカーソルのY座標（edge zoneに入ったか否か）に一切依存しない静的な事実であり、動画フレームの精度不足という§1の限界を回避できる。

listMode（`"hover" | "subtle" | "off"`）にはbox-shadowを使うモードが存在しないため、この競合は**section固有**であり、list D&Dでは発生しない（(D)ではなく(B)である理由）。paragraph行には`data-kind="section"`に一致する要素が無いため、paragraph D&Dにも影響しない。

### 候補2（補助的、確認済みだが未確定）: edge zoneの実寸が狭い可能性（§5）

`sectionMode`が`"subtle"`や`"off"`であっても、edgeゾーンの実寸（1行の1/3、おおよそ9〜12px程度と推定）自体が実用上当てにくいというUX上の懸念は残る。これは候補1とは独立した(C)的要素であり、候補1を修正した場合でも別途検討の余地がある。

### 候補3（可能性は低いが排除できない）: 動画観測時点でカーソルが実際にinsideゾーンに留まっていた（(A)）

候補1が確認された以上、利用者の環境では候補1により決定的にbefore/afterが非表示になるため、この報告に関して(A)を主要因とみなす必要はない。ただし、これは「利用者が意図通りedgeゾーンを狙っていたか」という操作上の事実とは独立の話である。

## 9. 推奨する次善策（3案以上の比較、本フェーズでは決定・実装しない）

| 案 | 内容 | 長所 | 短所 |
|---|---|---|---|
| 案A: box-shadowを合成可能な形に変更 | `drop-before`/`drop-after`/`drop-inside`のbox-shadow定義を、既存のkind別常時オン装飾（stripe等）のbox-shadowと**同じ宣言内で並記**するか、CSS変数を使った合成（複数box-shadow値をカンマ区切りで指定）に変更する | 既存のkind別装飾を保持したまま両方を同時に表示できる。将来同種の常時オン装飾が増えても拡張しやすい | box-shadowの複数値合成は宣言箇所が集中管理しにくく、CSS側の設計変更（新規変数追加等）が必要 |
| 案B: ドラッグ中は一時的にkind別常時オン装飾を無効化 | drag対象・drop候補行に対して、`unified-outliner-dragging`と同様の「drag中フラグ」クラスをTreeルートに付与し、そのクラスがある間だけ`[data-section-highlight="stripe"]`のbox-shadowルールを無効化するCSSセレクタを追加する | 既存のindicator CSS自体は無改変。競合の根を断つ | drag中は常時オン装飾が一瞬消える（視覚的な一貫性がわずかに変わる）。CSS側にdrag状態を反映する新しい属性/クラスが必要 |
| 案C: before/after indicatorをbox-shadow以外のプロパティに変更 | 例えば`::before`/`::after`疑似要素による絶対配置の線、またはborder-top/border-bottomなど、stripeのbox-shadowと競合しない別プロパティに変更する | stripeとの競合を完全に回避。将来同種の常時オン装飾が増えても影響を受けにくい | 疑似要素やborderは既存のborder-radius・padding計算と干渉する可能性があり、CSSの再検証が必要。視覚的な太さ・色の見え方が変わる可能性がある |
| 案D（候補2への対応、案A〜Cと併用可能）: edgeゾーンの比率調整 | `computeDropMode`の1/3・2/3という固定比率を、行高さに対する固定px（例: 上下各10px程度）に変更するか、比率自体を緩和する（例: 1/4・3/4ではなく、上下各30%程度をedgeに割り当てる） | 実用上のヒットしやすさが改善する | 「inside」ゾーンが狭くなり、子として配置する操作がしにくくなるトレードオフがある。数値の妥当性は実機での試行が必要 |

現時点での暫定推奨は、**案C（プロパティ変更による競合の根本回避）を最優先候補、案Aを次善候補**とする。案Bは視覚的な一時的変化が利用者に「なぜ装飾が消えたか」という新たな疑問を生みかねないため、他の案が実現困難な場合の代替として位置づける。案Dは(B)の修正とは独立した(C)対応であり、どの案とも併用可能。ただし、いずれも本フェーズでは決定・実装しない — 次フェーズ着手前に利用者判断が必要（§12）。

## 10. 将来の自動テスト計画（案）

- **CSS静的検証テスト（新規、`tests/`配下、Node上でCSSファイルをパースして検証する形。実装は次フェーズ）**: `styles.css`を読み込み、`data-section-highlight="stripe"`（および将来追加されうる同種のkind別常時オン装飾）のセレクタと、`.unified-outliner-drop-before/after/inside`のセレクタが、同一プロパティ（box-shadow）で競合詳細度を持たないことを検証する回帰テスト。CSS詳細度の実装依存のパース（外部ライブラリ利用、または簡易な自作パーサ）が必要になる可能性がある。
- **静的ソーステキスト検証（既存の"UiWiring"パターンを踏襲）**: `computeDropMode`の閾値（1/3・2/3）、`setDropIndicator`/`clearDropIndicator`のクラス管理ロジックが変更されていないことを検証する既存テストへの追記。
- **手動確認手順の恒久化**: §11の手順をMethod Vaultのチェックリストとして保存し、`sectionMode`の3値（subtle/stripe/off）それぞれについて、修正後にbefore/after/insideが正しく視認できることを実機で確認する項目を追加する。

## 11. 利用者向け手動再現・確認手順（案）

以下はあくまで「この特定の再現条件下での観察」を得るための手順であり、結果は「不具合が存在しないことの証明」ではなく「これらの条件下でこう見えた」という観察として記録すること。

1. 対象ノートで、隣接する2つの見出し（同じ階層、フォールディングしていない・ネストしていない単純な状態）を用意する。
2. 一方の見出し行をマウスでドラッグし、もう一方の見出し行の **上端付近（行の高さのおよそ上20%以内）** にカーソルを置いた状態で少し停止する。何が表示されるか（線の有無・色・位置）を記録する。
3. 同じ行の **中央付近** にカーソルを置いた状態で停止する。何が表示されるかを記録する。
4. 同じ行の **下端付近（行の高さのおよそ下20%以内）** にカーソルを置いた状態で停止する。何が表示されるかを記録する。
5. 2〜4のそれぞれで実際にドロップし、本文Markdown上でどこに挿入されたか（直前/直後/子として）を確認し、表示されたindicatorと実際の結果が一致していたかを記録する。
6. 上記2〜5を、**リスト項目同士**の drag & drop でも1回繰り返す（section/listの差異の有無を確認するため）。
7. 上記2〜5を、**段落（paragraph）同士**の drag & drop でも1回繰り返す（既存の5T-2S-Bの挙動が回帰していないかの確認のため）。
8. 手順1〜7は、フォールディング済み・ネストした見出しは対象外とする（本チケットのスコープ外）。
9. 可能であれば、設定画面の「Section highlight」を一時的に「subtle」または「off」に変更し、同じ手順2〜5を再実行して、表示結果に差が出るかを記録する（§8候補1の裏付け・反証のため）。

## 12. 次フェーズ着手前に利用者が判断すべき事項

1. §9の対応案（A/B/C/D）のうち、どれを次フェーズで実装するか。またD（edgeゾーン比率調整）を今回のB修正と同時に行うか、別フェーズに分けるか。
2. 「Section highlight」設定が`"stripe"`である利用者にのみ影響する不具合だが、修正はどの`sectionMode`値でも安全であることを保証する必要がある。この保証をテストでどこまで厳密に求めるか（§10のCSS静的検証テストを新規に書くか、手動確認のみで済ませるか）。
3. `computeDropMode`の1/3・2/3という閾値、または候補2の対応（edgeゾーン拡大）を行う場合、insideゾーンが狭くなることによる「子として配置」操作のしやすさとのトレードオフをどの程度許容するか。
4. 本フェーズはCSS変更を一切行っていない（docs-onlyの制約）。次フェーズを実装フェーズとして正式に発注するか、まず設計フェーズ（案の詳細設計のみ）を挟むか。

## 13. 5T-5A契約との非干渉の確認

本フェーズは`src/`・`tests/`・`styles.css`のいずれも変更していない。§2・§6で確認した通り、`runRelocateCommand`は既存の`dispatchAndApply`（`followSelection`既定値`true`）をそのまま使用しており、5T-5Aで確立した`selectedId`/`highlightedId`の再解決・null クリア契約に触れるコード変更は本フェーズに一切含まれない。`parseDocument.ts`も本フェーズの調査・変更対象に含めていない。


## 14. Phase 5T-6A: 実装確定事項（追記）

Phase 5T-6D の設計監査（§8候補1: `sectionMode: "stripe"` とbox-shadowの競合）を受けて、対応案C（box-shadow以外のプロパティへの変更）を採用し、`styles.css` のみを変更する最小実装を行った。

### 14-1. 実装内容

- `.unified-outliner-drop-before`/`.unified-outliner-drop-after`/`.unified-outliner-drop-inside` の3クラスから `box-shadow` を完全に排除し、`position: relative`（3クラス共通、行自身に付与）と、専用の `::before`/`::after` 疑似要素（`position: absolute` + `background-color` + `pointer-events: none`）による表示に置き換えた。
- 実装過程で、`sectionMode: "subtle"` の常時 `background-color` と、`.unified-outliner-drop-inside` 自身の行レベル `background-color`（inside のタイント）が、box-shadowと全く同じ構造でCSS詳細度競合を起こしうることを追加で発見した。同一フェーズ・同一コミットで、insideのタイントも `::before` 疑似要素へ分離し、この background-color 版の競合もあわせて解消した（design doc §8で予告した対応スコープを、発見した同種の問題の分だけ小さく拡張したもの。CSSプロパティを疑似要素側へ完全に分離するという同一の設計原則の範囲内であり、判定ロジック・移動ロジック・DOM構造・イベント経路には一切触れていない）。
- `computeDropMode` の閾値（1/3・2/3）、`handleDragOver`/`handleDrop`/`runRelocateCommand`/`relocateSection`/`relocateListSubtree` の意味論は無変更。`parseDocument.ts` も無変更。

### 14-2. テスト

新規 `tests/dropIndicatorCssConflict.test.ts`（13件）を追加した。styles.css を軽量な自作パーサ（コメント除去 → 波括弧の対応関係で top-level ルールへ分解、`@supports`/`@media` は再帰的に展開）でルール単位に分解し、以下を検証する：drop-indicator の行レベルルールが `box-shadow`/`background-color` のいずれも宣言していないこと、stripe/subtleの常時装飾ルール自体は無傷で存続していること、`::before`/`::after` 側が `--uo-current-color` と `pointer-events: none` を用いること、kind-highlight系ルールとdrop-indicator行レベルルールとの間でCSSプロパティの重複が一切無いこと（一般化した非衝突不変条件）、`sectionMode` の型が3値のままであること、`computeDropMode` の閾値・`relocateSection` の意味論が無変更であること。

### 14-3. 品質ゲート

`npx vitest run`: 72ファイル/1253件全通過（新規13件を含む）。`npm run lint`: 0エラー（既存の無関係な警告3件のみ、`src/settings.ts`、本フェーズ変更対象外）。`npm run build`（`tsc -noEmit -skipLibCheck` + esbuild production）: 成功。


## 15. Phase 5T-6A: 実機受入結果（追記）

利用者により、Method Vault の `phase5t6a-section-drop-indicator-manual-check.md`
（本実装完了時に配信済み）に基づく手動での実機確認が実施され、異常は見られなかった
旨の報告を受けた。

`sectionMode: "stripe"`（利用者の実際の設定値、Phase 5T-6D の根本原因監査で
確認済み）を含む実機環境で before/inside/after の各indicatorが正しく表示・
機能することを確認できたことになる。`runRelocateCommand`/`handleDragOver`/
`computeDropMode`/`setDropIndicator` の判定・移動ロジック自体は本フェーズを
通じて一切変更していないため、本結果はCSSのみの変更（styles.cssのbox-shadow
/background-colorから疑似要素への分離）で実機上の表示不具合が解消されたことの
確認である。

本結果は「今回確認した範囲内で異常が観察されなかった」という報告であり、
不具合が存在しないことの証明ではない点に留意する（design doc §11 の手順の
とおり、あくまで指定条件下での観察記録として扱う）。
