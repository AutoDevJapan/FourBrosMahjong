# Release tag 保護 runbook

GitHub Release の公開識別子である `v*` tag を、公開後に付け替え・削除されないよう保護するための運用手順。対象 repository は `AutoDevJapan/FourBrosMahjong`。

## 現状と適用前の blocker

2026-08-12 の読み取り監査では `GET /repos/AutoDevJapan/FourBrosMahjong/rulesets` は `[]` であり、repository ruleset は存在しない。`main` の branch protection（PR・必須 check・force push/deletion 禁止・admin 適用）は有効だが、tag ref は保護しない。したがって `.github/workflows/release.yml` の公開前 guard を通過した後も、書き込み権限者による既存 tag の更新・削除は repository 設定上拒否されない。

次の2点は repository 内の情報から決定できず、Organization owner / Repository administrator の明示承認が必要である。決定前に ruleset を有効化してはならない。

1. Release Operators として登録する GitHub Team（team slug / numeric team ID）。通常 writer 全員や repository role `Write` を bypass 対象にしてはならない。
2. break-glass の承認者2名以上と、緊急操作を行う Team（通常の Release Operators と分離する場合はその team slug / ID）。

承認結果は本節のプレースホルダーではなく、issue #508 のコメントまたは組織のアクセス管理台帳へ、承認者・日時・Team ID とともに記録する。個人アカウントを恒久 bypass actor にしない。

## ロールと責務

| ロール | 通常時の権限・責務 | `v*` tag ruleset bypass |
|---|---|---|
| 通常 writer | PR 作成、実装、レビュー。release PR の準備は可能 | **なし**。作成・更新・削除を拒否される |
| Release Operator | package/CHANGELOG、main SHA、trusted CI を確認し、承認済み tag を1回だけ作成 | **作成のみ運用上許可**。GitHub の bypass 自体は更新・削除にも効き得るため監査必須 |
| Release Approver | version・対象 SHA・変更履歴を確認し、tag 作成を承認。Operator と別人 | bypass なしを原則とする |
| Break-glass Operator | tag 保護事故への緊急対応。2名承認と事後レビューを伴う | 承認された緊急 Team のみ。通常は使用しない |
| Automation（Dependabot、通常 CI、Vercel） | PR・検証・deploy。release tag は作成しない | **なし**。現行 Release workflow は既存 tag から Release を作るだけなので例外不要 |

GitHub Team のメンバー変更権限も release 権限そのものである。Team membership の変更は Organization audit log に残し、Operator と Approver の分離を崩さない。

## Ruleset の推奨設定（管理者作業）

GitHub UI の **Settings → Rules → Rulesets → New ruleset → New tag ruleset** で次を設定する。外部設定変更は本 runbook を承認した管理者が行い、Codex / CI が自動適用しない。

- Name: `protect-release-tags`
- Enforcement status: 最初は `Evaluate` で pattern と bypass actor の一致だけを Rule insights で確認する（Evaluate は操作を拒否しない）。その後、告知した検証時間帯に `Active` へ切り替えて正常系・拒否系を確認する
- Target: Tags
- Include ref: `refs/tags/v*`
- Exclude ref: なし
- Bypass list: 承認済み Release Operators Team。必要なら別の break-glass Team。通常 writer の repository role、Organization admin role、Dependabot、GitHub Actions app は追加しない
- Bypass mode: 通常 release を行う Team は `Always allow`。`For pull requests only` は tag 作成に使用できない
- Rules:
  - Restrict creations
  - Restrict updates
  - Restrict deletions
  - Block force pushes / non-fast-forward updates（UI に表示される場合）

Ruleset の JSON export / API 応答と画面 capture を issue #508 に添付し、ruleset ID、enforcement、対象 pattern、rules、bypass actor ID を監査記録に残す。UI の表示名だけでは Team の取り違えを検出できないため numeric ID も記録する。

### 読み取り監査

以下は設定を変更しない。Organization / repository の read 権限を持つ端末で実行する。

```bash
gh api repos/AutoDevJapan/FourBrosMahjong/rulesets --paginate
gh api repos/AutoDevJapan/FourBrosMahjong/rulesets/<RULESET_ID>
```

管理画面の Rule insights でも `refs/tags/v0.0.0` が対象になることを確認する。返却された `target=tag`、`enforcement=active`、include pattern、creation/update/deletion（および non-fast-forward）、bypass actor を目視照合する。

## 正常リリース手順

1. Operator 以外が release PR を作り、`CHANGELOG.md` の dated section と `package.json` version を一致させる。
2. Approver が version、公開対象 SHA、main への取り込み、同じ SHA の trusted main CI 成功を確認し、issue / release ticket に承認を記録する。
3. Release Operator が最新の remote を取得し、対象を明示して annotated tag を作る。

   ```bash
   git fetch --quiet origin main --tags
   git rev-parse origin/main
   git tag -a vX.Y.Z <APPROVED_FULL_SHA> -m "Release vX.Y.Z"
   git push origin refs/tags/vX.Y.Z
   ```

4. `Release` workflow の `Validate release evidence` と `Create GitHub Release` が成功したこと、Release の tag SHA が承認 SHA と一致することを確認する。

   ```bash
   gh run list --workflow Release --limit 10
   git fetch --quiet origin tag vX.Y.Z
   git rev-parse 'vX.Y.Z^{commit}'
   gh release view vX.Y.Z --json tagName,isDraft,isPrerelease,url
   ```

5. Approver が operator、承認者、version、full SHA、workflow run URL、Release URL、ruleset ID を監査記録へ追記する。

## 適用時の拒否テスト

公開済み tag を試験対象にしない。`Evaluate` 中は Rule insights で対象 pattern と actor 判定だけを確認し、操作が拒否されるとは期待しない。その後 ruleset を `Active` にし、main 上の検証済み SHA と未使用の prerelease version（例: `vX.Y.Z-ruleset-test.1`）を用意して、package/CHANGELOG を一致させた実リリース rehearsal として行う。ダミー tag を `v*` に作るだけでは Release workflow を意図せず起動するため禁止する。

1. Release Operator が承認済み rehearsal tag を作成でき、Release workflow が成功することを確認する。
2. 通常 writer の別アカウントで、別の承認済み rehearsal tag の作成が GitHub に拒否されることを確認する。
3. 通常 writer が 1 の tag を別 SHA へ更新（force push）しようとして拒否されることを確認する。
4. 通常 writer が 1 の tag を削除しようとして拒否されることを確認する。
5. GitHub Ruleset の Rule insights / Organization audit log で actor、操作、拒否結果を保存する。
6. すべて成功したら `Active` を維持して読み取り監査を再実行する。想定外の拒否または許可があれば ruleset を直ちに `Evaluate` へ戻し、監査記録を残して構成を再レビューする。

拒否テストは権限の異なる実アカウントを必要とする。管理者 token で通常 writer を模擬してはならない（bypass により偽陽性になる）。

## Rollback と事故対応

公開済み `vX.Y.Z` は不変である。誤 release、アプリ不具合、CHANGELOG 誤記のいずれでも tag の付け替え・削除を rollback 手段にしない。

1. 影響と対象 version を記録し、必要なら GitHub Release 本文へ既知問題を追記する。tag SHA は変えない。
2. 修正または revert を PR で `main` に入れ、CI 成功を確認する。
3. SemVer を上げた新 version（通常は PATCH。prerelease なら次の prerelease）を通常手順で公開する。
4. Production の rollback が必要なら Vercel の承認済み rollback / redeploy 手順を使う。Git tag は Vercel Production の起点ではないため変更しない。

### Break-glass

GitHub 障害や ruleset 誤設定で正当な新規 tag 作成まで拒否され、通常復旧を待てない場合だけ使用する。

1. Incident を起票し、影響、緊急性、予定操作、対象 ref、full SHA を記録する。
2. 事前指定された Approver **2名**が明示承認する。操作担当者本人の自己承認は数えない。
3. Break-glass Team membership または ruleset bypass を最短時間だけ有効にする。既存 tag の更新・削除は許可しない。
4. 新規 tag 作成後、直ちに一時権限を撤回し、ruleset JSON と audit log を保存する。
5. 1営業日以内に事後レビューを行い、誰が・なぜ・何を・いつ変更したか、tag SHA、Release workflow 結果、権限の付与/撤回時刻を記録する。

承認者と break-glass Team が未決定の間はこの手順を実行できない。その状態は issue #508 の blocker であり、ruleset 導入済み・issue 完了として扱わない。
