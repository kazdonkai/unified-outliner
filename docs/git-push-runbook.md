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


## 8. version、Release との分離と実施手順

### 8.1 通常 push との分離

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

開発指示者から version bump・tag・GitHub Release の実施を明示的に指示
された場合に限り、8.2 節以降の手順に従う。

### 8.2 役割分担と実行環境

- 開発指示者は、Release 実施の判断、新しい version 番号（以下
  `X.Y.Z`）の決定、および 8.3 節の各承認点での明示承認を担う。
- Claude は、4ファイルの version bump、README / ROADMAP の整合性確認、
  コミット、`git push origin main`、tag の作成と push、
  `gh release create`、`gh release upload` までを一貫して実行する。
- これらのコマンドは、必ず Mac 上の実ターミナル（`gh` が
  `kazdonkai` として認証済みのシェル）で実行する。隔離された Linux VM
  やクラウドサンドボックスからは、GitHub Release の書き込みや
  `uploads.github.com` へのアップロードが遮断されることが確認されてい
  るため、それらの環境から実行してはならない。
- Perplexity は通常フローでは push・tag・Release を行わない。Mac 上の
  実ターミナルで `gh` の認証が失効しているなど、Claude が実行できない
  緊急時に限り、開発指示者の判断で代替経路として用いることがある。

### 8.3 全体の順序と承認点

以下の順序を厳守する。前の手順が完了し、確認条件を満たすまで次の手順
へ進んではならない。

| # | 手順 | 節 | 承認点 |
|---|---|---|---|
| 1 | version bump（4ファイル更新）とコミット | 8.4 | version 番号の明示 |
| 2 | README / ROADMAP の整合性確認と、必要な場合の更新コミット | 8.5 | — |
| 3 | `git push origin main`（通常 push） | 8.6 | push の明示承認 |
| 4 | tag の作成と push | 8.7 | tag・Release の明示承認 |
| 5 | GitHub Release の作成 | 8.8 | （手順4の承認に含む） |
| 6 | release asset の添付 | 8.9 | （手順4の承認に含む） |
| 7 | 事後確認 | 8.10 | — |

tag の作成と GitHub Release の作成は、手順2（README / ROADMAP の整合
性確認）が完了し、その結果が push 済みになった後にのみ行う。この順序
関係は変更しない。

### 8.4 version bump（4ファイル更新）

開発指示者が明示した `X.Y.Z`（Semantic Versioning に従う）について、
以下の4ファイルだけを更新する。

| ファイル | 更新内容 |
|---|---|
| `manifest.json` | `"version"` を `X.Y.Z` にする |
| `package.json` | `"version"` を `X.Y.Z` にする |
| `versions.json` | 末尾に `"X.Y.Z": "<minAppVersion>"` を追加する。値は `manifest.json` の `minAppVersion` と一致させる |
| `CHANGELOG.md` | `## [Unreleased]` の直下に `## [X.Y.Z] - YYYY-MM-DD` 見出しを追加し、今回 Release に含める変更内容をその下へ移す。`## [Unreleased]` 見出し自体は残す |

以下を厳守する。

- 上記4ファイル以外は変更しない（`package-lock.json` は現行慣行では
  更新しない）。
- 更新後、`git diff --stat` で変更ファイルが上記4ファイルのみである
  ことを確認する。
- `manifest.json`・`package.json`・`versions.json` の version 表記が
  互いに一致していることを確認する。
- `npm test`、`npx tsc -noEmit -skipLibCheck`、`npm run lint`、
  `npm run build` がすべて成功することを確認する。
- コミットメッセージは `release: bump version to X.Y.Z` とする。

### 8.5 README / ROADMAP 整合性確認

tag・Release の作成前に、以下の4ファイルが今回の Release 内容と整合
しているかを確認する。

- `README.md`
- `README.ja.md`
- `ROADMAP.md`
- `ROADMAP.ja.md`

確認項目は以下の通りである。

- 「現在の Release」等の記述が `X.Y.Z` を指していること
- 今回の CHANGELOG に記載した新機能・変更点が、利用者向けの説明と矛
  盾していないこと
- 英語版と日本語版の記述内容が一致していること
- 未実装の機能を実装済みとして記述していないこと

更新が必要な場合は、version bump とは別のコミットとし、コミットメッ
セージは `docs: sync README/ROADMAP with vX.Y.Z` とする。更新が不要
な場合は、その判断と確認した項目を開発指示者への報告に明記する。

### 8.6 通常 push

8.4 節と 8.5 節のコミットがそろった状態で、3節〜5節の手順をそのまま
適用して `git push origin main` を1回だけ実行する。push の承認範囲に
は、version bump のコミットと README / ROADMAP のコミットが含まれて
いなければならない。push が失敗した場合は6節に従い、tag・Release の
工程へ進まない。

### 8.7 tag の作成と push

以下の前提をすべて満たすことを確認してから実行する。

- 8.6 節の push が完了し、5節の事後確認を満たしている
- `git ls-remote --heads origin main` の hash が local HEAD と一致する
- `git tag -l X.Y.Z` の出力が空である
- `git ls-remote --tags origin X.Y.Z` の出力が空である

tag 名には `v` を付けず、`X.Y.Z` とする（既存 tag は `v0.4.1` を除き
すべて `v` なしであり、この慣行に合わせる）。Mac 上の実ターミナルで次を実行する。

```
git tag -a X.Y.Z -m "X.Y.Z"
git push origin X.Y.Z
```

実行後、以下を確認する。

- `git rev-parse X.Y.Z^{commit}` が local HEAD と一致する
- `git ls-remote --tags origin X.Y.Z` に tag が現れている

以下は明示的に禁止する。

- `git tag -f`（既存 tag の上書き）
- `git tag -d` および `git push origin --delete <tag>`（tag の削除）
- `git push --tags`（対象外の tag の一括 push）

### 8.8 GitHub Release の作成

tag の push を確認した後、Mac 上の実ターミナルで以下を行う。

1. `CHANGELOG.md` の `## [X.Y.Z]` 節（見出しから次の `## [` の直前ま
   で）を、リポジトリ外の一時ファイルに書き出す。これを Release notes
   とする。
2. 次を実行する。

```
gh release create X.Y.Z --title "X.Y.Z" --notes-file <一時ファイル> --verify-tag
```

`--verify-tag` により、remote に tag が存在しない場合は Release を作成
せずに失敗させる。Release は draft・pre-release にしない（開発指示者
から別途指示がある場合を除く）。

### 8.9 release asset の添付

1. tag のコミットで `npm run build` を実行し、`main.js` を最新化する
   （`main.js` は `.gitignore` の対象であり、リポジトリには含まれない
   ため、添付前に必ず build する）。
2. `git status --short` が空であり、HEAD が tag のコミットと一致する
   ことを確認する。
3. 添付する3ファイルの `sha256sum`（macOS では `shasum -a 256`）を記
   録する。
4. 次を実行する。

```
gh release upload X.Y.Z main.js manifest.json styles.css
```

5. `gh release view X.Y.Z --json assets` で、`main.js`・
   `manifest.json`・`styles.css` の3ファイルが添付されていることを確
   認する。

`gh release upload` が失敗した場合は、以下に従う。

- 自動で retry しない。`--clobber` による上書きもしない。
- Release・tag を削除して作り直さない。
- エラー全文と、3ファイルのパスおよび sha256 を開発指示者に報告する。
- 開発指示者に、GitHub の Release 編集画面から3ファイルを手動で添付
  するよう依頼する（手動添付へのフォールバック）。
- 手動添付の完了報告を受けた後、`gh release view X.Y.Z --json assets`
  で添付状態を確認する。

### 8.10 事後確認

| # | コマンド | 確認内容 |
|---|---|---|
| 1 | `git status --short` | working tree・staged area がクリーンであること |
| 2 | `git ls-remote --heads origin main` | remote `main` が local HEAD と一致すること |
| 3 | `git ls-remote --tags origin X.Y.Z` | remote に tag `X.Y.Z` が存在すること |
| 4 | `git rev-parse X.Y.Z^{commit}` | tag が local HEAD を指していること |
| 5 | `gh release view X.Y.Z --json tagName,name,isDraft,isPrerelease` | Release が `X.Y.Z` として公開済みであること |
| 6 | `gh release view X.Y.Z --json assets` | 3ファイルが添付されていること |

### 8.11 失敗時

version bump・tag・Release のいずれかの工程で失敗した場合は、6節の原
則を準用する。すなわち、自動で retry せず、force push・tag の上書き
や削除・Release の削除を行わず、実行したコマンドとエラー全文、Git 状
態、Release の状態を報告したうえで停止し、次の対応は開発指示者の判断
を待つ。

### 8.12 チェックリスト

- [ ] 開発指示者が version 番号 `X.Y.Z` を明示した
- [ ] 4ファイル（`manifest.json`・`package.json`・`versions.json`・
      `CHANGELOG.md`）のみを更新し、version 表記が一致している
- [ ] `npm test`・`tsc`・`lint`・`build` がすべて成功した
- [ ] `release: bump version to X.Y.Z` をコミットした
- [ ] README / ROADMAP（英日4ファイル）の整合性を確認し、必要な更新を
      コミットした、または更新不要と判断した根拠を報告した
- [ ] 開発指示者の承認を得て、Claude が Mac 上の実ターミナルで
      `git push origin main` を実行し、5節の事後確認を満たした
- [ ] 開発指示者の承認を得て、Claude が annotated tag `X.Y.Z` を作成・
      push した
- [ ] Claude が `gh release create` で Release を作成した（Release
      notes は CHANGELOG の該当節）
- [ ] Claude が build 済みの3ファイルを `gh release upload` で添付した、
      または失敗時に開発指示者へ手動添付を依頼し、添付を確認した
- [ ] 8.10 節の事後確認をすべて満たした

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
