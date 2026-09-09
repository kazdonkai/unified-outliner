# Unified Outliner — 通常 Git Push 運用手順

## 1. 目的と適用範囲

本文書は、`unified-outliner-public` リポジトリのローカル `main` ブランチ
に存在する、レビュー・自動検証・実機確認を経て承認済みとなったコミット
群を、公開リポジトリの `origin/main` へ通常の fast-forward push によっ
て反映するための標準手順を記録するものである。

本文書の対象は通常 push の手順のみであり、version bump、CHANGELOG 更
新、tag 作成、GitHub Release 作成、release asset のアップロードは対象
外である。これらは別工程として扱う（詳細は 8 節）。

`docs/git-push-release-runbook.md` は、本文書とは別の文書である。同ファ
イルは Phase 5T-1R を起点とする Tree 操作機能（`OutlineTreeView.ts` の
context menu からの move 等）の実機受入手順を記録したものであり、Git
push の手順は記載されていない。本文書は Git push 手順を扱い、
`docs/git-push-release-runbook.md` は Tree 操作の実機受入手順を扱うと
いう役割分担であり、両者は統合しない。


## 2. 役割分担

通常 push については、以下の役割分担とする。

### Claude computer-use の担当

- Mac 上の実ターミナルでの Git 状態確認（`git status`、`git branch`、
  `git remote` 等）
- Git 差分・staged diff・履歴の確認（`git diff`、`git log` 等）
- `npm test`
- `npx tsc -noEmit -skipLibCheck`
- `npm run lint`
- `npm run build`
- release readiness の静的監査（version・CHANGELOG・tag・Release 関連
  ファイルが意図せず差分に含まれていないかの確認等）
- Mac 上の実ターミナルでの `git push origin main` の実行
- push 後の remote と local HEAD の一致確認

### 開発指示者の担当

- push 可否の明示承認
- iPad、iPhone、Android、macOS 上の Obsidian 実機の物理操作
- タップ、長押し、ドラッグ、スクロール、画面回転、Undo、UI 見た目、操
  作感の確認
- 実機受入の要約報告
- version bump、CHANGELOG 更新、tag 作成、GitHub Release 作成の最終判
  断

### Perplexity GitHub コネクタの位置づけ

- GitHub Issue、Pull Request、レビュー、コメント、Release メタデータ
  等、GitHub API 経由の操作に利用できる
- ローカルリポジトリに存在するコミットをそのまま fast-forward push す
  る標準経路としては扱わない
- ローカルの Git 履歴を直接操作する手段の代替としては扱わない


## 3. push 前の必須確認

対象ディレクトリは常に次とする。

`/Users/kazumikaizuka/Obsidian/unified-outliner-public`

push を開始する前に、Mac 上の実ターミナルで以下を順に実行し、それぞれ
の確認内容を満たすことを確かめる。

| # | コマンド | 確認内容 |
|---|---|---|
| 1 | `pwd` | 対象ディレクトリが上記であること |
| 2 | `git status --short` | working tree・staged area がクリーンであ
  ること |
| 3 | `git branch --show-current` | 対象 branch が `main` であること |
| 4 | `git remote -v` | remote URL が想定通りであること |
| 5 | `git rev-parse HEAD` | 現在の HEAD の完全 hash |
| 6 | `git rev-parse --verify origin/main` | 現在の `origin/main` の完全
  hash |
| 7 | `git merge-base HEAD origin/main` | `origin/main` が HEAD の祖先
  であること（結果が手順6の値と一致すること） |
| 8 | `git rev-list --left-right --count origin/main...HEAD` |
  ahead/behind 数。remote 側に local が持たないコミットがないこと（左
  側の数が 0 であること） |
| 9 | `git log --reverse --oneline origin/main..HEAD` | push 対象コミッ
  トが開発指示者の承認範囲と一致すること |
| 10 | `git diff --check origin/main...HEAD` | 空白関連の異常がないこ
  と（出力が空であること） |

push は、以下の条件をすべて満たす場合に限り実行してよい。

- working tree がクリーンである
- staged area が空である
- 対象 branch が `main` である
- remote URL が正しい
- `origin/main` が HEAD の祖先である
- remote 側に local が持たないコミットがない
- push が fast-forward で可能である
- push 対象コミットが開発指示者の承認範囲と一致する
- 必要な自動検証（`npm test`、`tsc`、`lint`、`build` 等）が成功してい
  る
- 必要な実機確認を開発指示者が完了し、要約報告済みである
- version bump、CHANGELOG、tag、GitHub Release を今回実施するかしない
  かが明示済みである

いずれか一つでも満たさない場合、push へ進んではならない。


## 4. 通常 push

3節の確認条件をすべて満たし、かつ開発指示者から push の明示承認を得た
場合に限り、Mac 上の実ターミナルで次を1回だけ実行する。

```
git push origin main
```

以下を厳守する。

- push は開発指示者の明示承認後にのみ実行する
- 通常 push は `git push origin main` を1回だけ実行する
- force push は禁止する
- push が失敗しても自動で retry しない
- push 中または push 直後に、push 以外の Git 状態変更操作を行わない

以下は明示的に禁止する。

- `git push --force`
- `git push -f`
- `git push --force-with-lease`
- `git pull`
- `git fetch`
- `git merge`
- `git rebase`
- `git reset`
- `git restore`
- `git checkout`
- `git switch`
- `git clean`
- remote URL の変更
- branch の削除
- branch の rename
- 意図しない branch への push


## 5. push 後の必須確認

push 完了後、Mac 上の実ターミナルで以下を順に実行し、それぞれの確認内
容を満たすことを確かめる。

| # | コマンド | 確認内容 |
|---|---|---|
| 1 | `git status --short` | working tree・staged area がクリーンであ
  ること |
| 2 | `git rev-parse HEAD` | HEAD が push 前と不変であること |
| 3 | `git ls-remote --heads origin main` | remote 側 `refs/heads/main`
  の完全 hash が local HEAD と一致すること |
| 4 | `git log -1 --oneline` | 最新コミットが想定通りであること |
| 5 | `git branch -vv` | local `main` が `origin/main` を過不足なく追
  跡していること |
| 6 | `git log --oneline origin/main..HEAD` | 出力が空であること |
| 7 | `git log --oneline HEAD..origin/main` | 出力が空であること |
| 8 | `git diff --check origin/main...HEAD` | 差分整合性に異常がないこ
  と（出力が空であること） |

push が正常に完了したと判断できるのは、以下をすべて満たす場合である。

- remote `main` の完全 hash が local HEAD と一致する
- `origin/main..HEAD` が空である
- `HEAD..origin/main` が空である
- working tree と staged area がクリーンである
- push によって新規コミットが作成されていない
- 開発指示者からの明示指示がない限り、version bump、CHANGELOG 更新、
  tag 作成、GitHub Release 作成のいずれも行われていない


## 6. push 失敗時

push が失敗した場合、以下を厳守する。

- 自動で retry しない
- force push しない
- `git pull`、`git fetch`、`git merge`、`git rebase`、`git reset`、
  `git restore`、`git checkout`、`git clean` のいずれも実行しない
- ローカルのコミットを失わせるいかなる操作も行わない
- 実行した push コマンド、エラー全文、Git 状態を報告した上で停止する

失敗時に確認・報告する情報は以下の通りである。

- 実行した push コマンド
- エラー全文
- `git status --short`
- `git branch -vv`
- `git remote -v`
- `git rev-parse HEAD`
- `git rev-parse --verify origin/main`
- `git rev-list --left-right --count origin/main...HEAD`
- `git log --oneline origin/main..HEAD`
- 認証、ネットワーク、権限、Git lock、remote 側の更新、branch の分岐の
  うちどれが疑われるか
- ローカルのコミットが失われていないこと

これらを報告した後、次の対応は開発指示者の判断を待ち、Claude が独自の
判断で復旧操作を行ってはならない。


## 7. 実機確認と Mac mobile emulation

以下を明確に区別する。

### Claude が Mac mobile emulation（`app.emulateMobile(true)`）で確認
できること

- `Platform.isMobile` 分岐の切替
- DOM 要素の生成
- class、attribute、aria 属性
- `draggable` 属性
- mobile/desktop branch の切替
- event listener の wiring
- `app.emulateMobile(false)` による desktop 状態への復帰

### 開発指示者が実機上でのみ確認できること

- iPad、iPhone、Android 等での実際のタップ
- 長押し
- ドラッグ
- スクロール
- 画面回転
- Undo
- UI の見た目
- 操作感
- gesture の競合
- iPadOS、iOS、Android 等の端末固有の挙動

### 明記事項

- Mac mobile emulation は実機受入の代替ではない
- mobile emulation を行う場合、対象 vault は必ず `ipad-test` vault と
  する
- mobile emulation の終了時には、必ず `app.emulateMobile(false)` を実
  行し、desktop 状態に復帰したことを確認する
- Claude が実機確認を代行した、または実機確認の代替として mobile
  emulation を用いたと記録してはならない


## 8. version、Release との分離

通常 push と、version bump、CHANGELOG 更新、tag 作成、GitHub Release
作成、release asset のアップロードは、別工程として明確に分離する。

開発指示者からの明示指示がない限り、通常 push の実行時に以下を同時に
行ってはならない。

- `manifest.json` の version 更新
- `package.json` の version 更新
- `versions.json` の更新
- `CHANGELOG.md` の更新
- `README.md` または `README.ja.md`、`ROADMAP.md` 等の更新
- tag の作成
- GitHub Release の作成
- release asset のアップロード

これらは通常 push の完了後、別途の承認・別途の検証・別途のコミットと
して扱う。通常 push 自体には、承認済みコミットを `origin/main` へ反映
すること以外の目的を持たせない。

## 9. 本文書の適用範囲外

以下は本文書の対象外であり、本文書に手順を記載しない。

- production code、テスト、実機 fixture の変更手順
- Tree 操作機能を含む個別機能の実機受入テンプレート（
  `docs/git-push-release-runbook.md` 等、別文書の対象）
- release asset の作成・検証手順
- Perplexity sandbox への `.git` の tar 転送、`GIT_DIR` を指定した
  fetch/push、push 後の `merge --ff-only` による同期といった手順は、
  このリポジトリの履歴・現行運用のいずれにも存在しないため、本文書に
  は記載しない。
