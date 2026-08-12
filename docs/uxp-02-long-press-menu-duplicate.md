# UXP-02 — Long-press Context Menu Duplicate Display

作成日: 2026-08-12
状態: 実装完了、test/tsc/lint/build/diff-check 済み。実機検証（iPad/デスクトップ）待ち。ブランチ `fix/uxp-02-long-press-menu-duplicate`（`main` 未マージ）。

## 1. 再現手順

1. iPad（または他のタッチデバイス）で Outline Tree View を開く。
2. ある行を 450ms 以上長押しし、コンテキストメニュー（`showStructureCommandMenu`/`showListCommandMenu`）を表示させる。
3. メニューを閉じずに、別の行を再度 450ms 以上長押しする。
4. 前のメニューが閉じずに残ったまま、新しいメニューが重なって表示される。3回目以降も同様に繰り返すと、メニューが多重に積み重なっていく。

UXP-01 の実機検証中（ブランチ `fix/uxp-01-ipad-drag-context-menu` の検証セッション、docs/uxp-01-ipad-drag-context-menu.md §9）に動画で発見された。

## 2. 発生条件

- **モバイル（iPad/タッチ）でのみ再現する。** デスクトップのマウス右クリックでは再現しない。理由は §3 のとおり、デスクトップの右クリックメニューは OS 標準のネイティブメニューであり、そもそも「複数同時に開く」という状態自体が OS レベルで起こり得ないため。
- section ノード（`showStructureCommandMenu`）・list ノード（`showListCommandMenu`）のどちらでも同様に再現する。両メソッドの実装は独立しているが、根本原因（§3）は共通している。

## 3. 根本原因

`showStructureCommandMenu`/`showListCommandMenu`（`src/view/OutlineTreeView.ts`）は、呼び出されるたびに `new Menu()` して `menu.showAtMouseEvent(evt)` するだけで、「このビューが直前に開いたメニュー」を追跡・記憶する仕組みが一切なかった。Obsidian の `Menu` クラス自体（`node_modules/obsidian/obsidian.d.ts`）も `hide()`/`onHide()`/`close()` という public API は持つが、「アプリ全体で今どのメニューが開いているか」をフレームワーク側が自動管理するわけではない。

デスクトップでこの不具合が表面化しなかったのは、`setUseNativeMenu`（デフォルト true、"Only works on the desktop app" と明記）によりデスクトップの右クリックメニューは OS のネイティブコンテキストメニューとして描画されるため、OS 自身が「新しいネイティブメニューを開くと前のものは自動的に閉じる」という挙動を保証しているからである。モバイルでは `Menu` が DOM 上に自前で描画されるため、この自動排他がなく、`new Menu()` を呼ぶたびに独立した DOM 要素が積み上がっていた。

UXP-01 のブランチと `main` の diff を `git diff main fix/uxp-01-ipad-drag-context-menu -- src/view/OutlineTreeView.ts | grep -n "Menu\|showStructureCommandMenu\|showListCommandMenu\|suppressNextTapClick"` で確認したところ、一致するハンクは0件だった。長押しタイマー・Menu 呼び出し・`suppressNextTapClick` のいずれも UXP-01 のハンドル分離変更では一切触れていないため、**この不具合は UXP-01 以前から存在していた既存バグであり、UXP-01 のハンドル変更とは無関係**と判定できる（`main` 上でも同一条件で再現するはずであり、UXP-01 のスパイク・実装のいずれの段階でも新規に持ち込まれたものではない）。

## 4. 修正設計 — activeMenu による単一メニュー管理

`OutlineTreeView` に `private activeMenu: Menu | null = null;` フィールドを追加し、このビューが開くメニューの「今開いているものは高々ひとつ」という不変条件を、このビュー自身の責任で維持するようにした。

実際に `menu.showAtMouseEvent(evt)` を呼ぶ箇所を、新設した `private showTrackedMenu(menu: Menu, evt: MouseEvent): void` ヘルパーひとつに一本化した（`showStructureCommandMenu`・`showListCommandMenu` はどちらも自前でメニュー項目を組み立てた後、最後にこのヘルパーを呼ぶだけになる）。

```ts
private showTrackedMenu(menu: Menu, evt: MouseEvent): void {
  this.activeMenu?.hide();
  this.activeMenu = menu;
  menu.onHide(() => {
    if (this.activeMenu === menu) this.activeMenu = null;
  });
  menu.showAtMouseEvent(evt);
}
```

流れ:

1. 新しいメニューを表示する前に、`activeMenu` に前のメニューが残っていれば `hide()` して閉じる。
2. `activeMenu` を新しいメニューに差し替える。
3. 新しいメニューに `onHide` コールバックを登録し、それが閉じられた（ユーザーが項目を選んだ／メニュー外をタップした／後述の手順1で `hide()` された）タイミングで `activeMenu` を `null` に戻す。
4. 最後に `showAtMouseEvent(evt)` で実際に表示する。

このヘルパーは `showStructureCommandMenu`・`showListCommandMenu` の2箇所からのみ呼ばれ、いずれも「このビュー自身が `new Menu()` して構築した、このビュー専用のメニュー」だけを対象にしている。`Menu.prototype` の変更、DOM 全体からの他メニュー探索、グローバルなメニューレジストリの導入は一切行っていない。Obsidian 本体・他プラグイン・他の View インスタンスが開くメニューには触れない。

## 5. onHide の identity check の理由

`onHide` コールバック内で `if (this.activeMenu === menu) this.activeMenu = null;` という同一性チェックを行っているのは、次の競合を防ぐためである。

誤ったパターン（同一性チェックなし）:

```ts
menu.onHide(() => {
  this.activeMenu = null; // 誤り
});
```

このパターンでは、次のような順序で問題が起きる。メニューA が開かれ `activeMenu = A` になる。ユーザーが別の行を長押しし、`showTrackedMenu` が呼ばれて `A.hide()` → `activeMenu = B` → `B` を表示、という流れになる。ここで `A.hide()` が引き金となって A 自身の `onHide` コールバックが（非同期的、あるいは同期的にせよ）発火し、無条件に `this.activeMenu = null` としてしまうと、直前に設定したばかりの `activeMenu = B` を巻き戻してしまい、「B は実際には開いたままなのに `activeMenu` は null」という不整合が生まれる。その状態でさらに別の行を長押しすると、`this.activeMenu?.hide()` は何もせず（null なので）、B が閉じられないまま新しいメニューが開き、まさに元の多重表示バグが形を変えて再発する。

`if (this.activeMenu === menu)` という同一性チェックにより、「このコールバックは自分（A）が現在も `activeMenu` として記録されている場合に限り、自分を null にしてよい」という条件になる。A が hide された時点で `activeMenu` はすでに B に差し替わっているため、A の `onHide` コールバックは条件が成立せず何もしない。B が閉じられた際は `activeMenu === B` が成立するので、正しく `activeMenu` が null に戻る。

## 6. View クローズ時のクリーンアップ

`onClose()`（`OutlineTreeView.ts`）の冒頭に以下を追加した。

```ts
this.activeMenu?.hide();
this.activeMenu = null;
```

Outline Tree View のタブを閉じる、あるいは別のリーフに切り替えるなどして View 自体が破棄される際、メニューが開いたままだと DOM 要素が孤立して残る可能性があるため、View 側のライフサイクルに合わせて明示的に片付ける。`hide()` 自体が `showTrackedMenu` で登録した `onHide` コールバックを発火させ、そちらでも `activeMenu` を null にしようとするが、その完了を待たずにここで直接 `null` を代入しているため、コールバックの発火有無に依存しない、確実なクリーンアップになっている。既存の `onClose()` の他の処理（`contentEl.empty()`、`foldStateManager.flush()`）の順序・内容は変更していない。

## 7. 明示的な非対象（変更していないもの）

- UXP-01 のドラッグハンドル関連コード（`dragHandleEl` の生成・ガード・`draggable` 属性の分岐）は一切変更していない。
- 長押しタイマーの 450ms 閾値（`LONG_PRESS_DURATION_MS`）は変更していない。
- 移動距離判定（`exceedsLongPressMoveThreshold`）は変更していない。
- `suppressNextTapClick` の仕組みは変更していない。
- `dragstart`/`dragover`/`dragleave`/`drop`/`dragend` のハンドラは変更していない。
- read-only ゲーティング（`readOnlyNodeIds` によるメニュー抑止判定）は変更していない。
- メニュー項目の内容・並び順・アイコン・有効/無効判定ロジック（`addContextualItem`/`addExplicitBlockItem`/`addMenuItem` 等）は一切変更していない。`showStructureCommandMenu`/`showListCommandMenu` 内でメニュー項目を組み立てる責務は完全にそのまま。
- Phase 5 本体（hoist/popout/breadcrumb/atomic block）には触れていない。
- `Menu.prototype` の変更、グローバルなメニュー管理機構、ドキュメント化されていない Obsidian 内部 API への依存は一切導入していない。

## 8. テスト結果

- `npx vitest run`: 597件成功（既存回帰なし）。この修正が触れているのは `OutlineTreeView.ts` のみで、この View は Obsidian ランタイム依存のため vitest カバレッジの対象外（UXP-01 と同じ制約）。`activeMenu`/`showTrackedMenu` は Obsidian の `Menu` クラスの実インスタンスと DOM 描画に依存するロジックであり、純粋関数として切り出せる部分がないため、新規ユニットテストは追加していない。手動検証（§9）で代替する。
- `npx tsc -noEmit -skipLibCheck`: エラーなし。
- `npm run build`: 成功。
- `npm run lint`: 警告3件（`settings.ts` の `PluginSettingTab.display()` 非推奨警告。UXP-02 以前から存在する既知の警告で、新規警告なし）。
- `git diff --check`: 差分なし（空白由来の問題なし）。

## 9. 実機・環境別の検証結果

### iPad 実機（12項目）

未実施。`ipad-test` vault（Obsidian Sync で Mac と iPad を同期）への配置後、ユーザーによる実機検証を依頼する。

### デスクトップ（6項目）

未実施。ユーザーによる検証を依頼する。

### モバイルエミュレーション（任意）

未実施。

## 10. 既知の制約・未解決事項

- 本ドキュメント作成時点では実機（iPad/デスクトップ）検証が未実施であり、§9 の結果はすべて「未実施」。実機検証完了後、この節と完了報告を更新する。
- UXP-01 との因果関係なしの判定根拠は §3 のとおり diff ベースで確認済みだが、これは静的な差分比較による確認であり、実機での回帰確認（UXP-01 の12項目チェックリストが UXP-02 適用後も崩れていないか）は別途、今回の実機検証の一部として依頼する。
