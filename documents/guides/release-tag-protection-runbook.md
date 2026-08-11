# Release tag 保護 runbook

GitHub Release の公開識別子である `v*` tag を、公開後に付け替え・削除されないよう保護するための運用手順。対象 repository は `AutoDevJapan/FourBrosMahjong`。

## 現状と適用前の blocker

2026-08-12 の読み取り監査では `GET /repos/AutoDevJapan/FourBrosMahjong/rulesets` は `[]` であり、repository ruleset は存在しない。`main` の branch protection（PR・必須 check・force push/deletion 禁止・admin 適用）は有効だが、tag ref は保護しない。したがって `.github/workflows/release.yml` の公開前 guard を通過した後も、書き込み権限者による既存 tag の更新・削除は repository 設定上拒否されない。

次の2点は repository 内の情報から決定できず、Organization owner / Repository administrator の明示承認が必要である。決定前に ruleset を有効化してはならない。

1. Release Operators として登録する GitHub Team（team slug / numeric team ID）。通常 writer 全員や repository role `Write` を bypass 対象にしてはならない。
2. break-glass の承認者2名以上と、緊急時にだけ一時追加する Team（Release Operators と分離した team slug / ID）。この Team を恒久 bypass に置かない。

承認結果は本節のプレースホルダーではなく、issue #508 のコメントまたは組織のアクセス管理台帳へ、承認者・日時・Team ID とともに記録する。個人アカウントを恒久 bypass actor にしない。

## ロールと責務

| ロール | 通常時の権限・責務 | `v*` tag ruleset bypass |
|---|---|---|
| 通常 writer | PR 作成、実装、レビュー。release PR の準備は可能 | **なし**。作成・更新・削除を拒否される |
| Release Operator | package/CHANGELOG、main SHA、trusted CI を確認し、承認済み tag を1回だけ作成 | **作成 ruleset のみ bypass**。不変性 ruleset は bypass せず、本人も更新・削除を拒否される |
| Release Approver | version・対象 SHA・変更履歴を確認し、tag 作成を承認。Operator と別人 | bypass なしを原則とする |
| Break-glass Operator | tag 保護事故への緊急対応。2名承認と事後レビューを伴う | 恒久 bypass なし。承認された緊急 Team を対象 ruleset に時間制限付きで追加する |
| Automation（Dependabot、通常 CI、Vercel） | PR・検証・deploy。release tag は作成しない | **なし**。現行 Release workflow は既存 tag から Release を作るだけなので例外不要 |

GitHub Team のメンバー変更権限も release 権限そのものである。Team membership の変更は Organization audit log に残し、Operator と Approver の分離を崩さない。

## Ruleset の推奨設定（管理者作業）

GitHub UI の **Settings → Rules → Rulesets → New ruleset → New tag ruleset** で、責務の異なる **2つ**の ruleset を作る。外部設定変更は本 runbook を承認した管理者が行い、Codex / CI が自動適用しない。

両方に共通:

- Enforcement status: 構成中は `Disabled`、承認・検証時間帯に `Active`。現在の GitHub Team plan/private repository で利用可否が異なる `Evaluate` を前提にしない
- Target: Tags
- Include ref: `refs/tags/v*`
- Exclude ref: なし

### A. 作成認可 `authorize-release-tag-creation`

- Bypass list: 承認済み Release Operators Team のみ（`Always allow`）
- Rule: Restrict creations **のみ**
- 通常 writer、Organization admin repository role、Dependabot、GitHub Actions app、break-glass Team は恒久 bypass に追加しない

この ruleset は「誰が新しい release tag を作れるか」だけを決める。Release Operator の bypass が既存 tag の更新・削除を許可しないよう、それらの rule を混在させない。

### B. 不変性 `protect-existing-release-tags`

- Bypass list: **空**（Release Operators Team も含めない）
- Rules:
  - Restrict updates
  - Restrict deletions
  - Block force pushes / non-fast-forward updates（UI に表示される場合）

この ruleset は公開済み tag の不変性を全員に課す。Release Operator も tag の付け替え・削除はできない。緊急時だけ、2名承認後に break-glass Team をこの ruleset の bypass へ一時追加し、操作直後に除去する。

2 ruleset の JSON export / API 応答と画面 capture を issue #508 に添付し、それぞれの ruleset ID、enforcement、対象 pattern、rules、bypass actor ID を監査記録に残す。特に B の bypass actor が空であることを確認する。UI の表示名だけでは Team の取り違えを検出できないため numeric ID も記録する。

### 読み取り監査

以下は設定を変更しない。Organization / repository の read 権限を持つ端末で実行する。

```bash
gh api repos/AutoDevJapan/FourBrosMahjong/rulesets --paginate
gh api repos/AutoDevJapan/FourBrosMahjong/rulesets/<CREATION_RULESET_ID>
gh api repos/AutoDevJapan/FourBrosMahjong/rulesets/<IMMUTABILITY_RULESET_ID>
```

返却された `target=tag`、`enforcement=active`、include pattern、A は creation のみ + Release Operators Team bypass、B は update/deletion（および non-fast-forward）+ bypass 空、を目視照合する。

### Disabled → Active rollout

1. 2 ruleset を `Disabled` で作り、API 応答と画面を別の管理者が上記契約と照合する。
2. 次の実 release（または永続的に残してよい prerelease）と検証時間帯、担当 Operator、通常 writer の検証者、承認者2名、誤許可時の復旧担当を決める。
3. 既存 `v*` tag の full SHA を記録する。
4. **A だけ**を `Active` にし、読み取り監査後に通常 writer の作成拒否と Operator の正常作成を検証する。この段階では B が `Disabled` なので、A の誤設定で negative-test tag が作成されても、承認済み復旧担当が直ちに削除して停止できる。
5. A の作成認可が正しいことを確認してから B を `Active` にし、読み取り監査後に Operator と通常 writer の更新・削除拒否を検証する。
6. 想定外の許可または拒否があれば新しい tag 操作を止め、該当 ruleset を `Disabled` に戻して監査記録を残す。B 有効後の tag は変更せず、B の一時 bypass が必要なら下記 break-glass の2名承認を先に得る。
7. すべて成功した場合だけ両方の `Active` を維持する。

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

既存の公開済み tag を試験対象にしない。main 上の検証済み SHA と次の実 version（または永続的に残してよい prerelease）を用意し、package/CHANGELOG を一致させた release として行う。通常 writer の作成拒否テストには、あらかじめ予約・記録した negative-test version を使う。A の検証中は B を `Disabled` に保ち、誤って作成できた場合に復旧担当が削除できるようにする。

1. A=`Active` / B=`Disabled` で、通常 writer の別アカウントが予約済み negative-test tag を作成しようとして拒否されることを確認する。もし成功したら復旧担当が即時削除し、A を `Disabled` に戻して以降を中止する。
2. Release Operator が承認済みの実 release tag を作成でき、Release workflow が成功することを確認する。
3. B を `Active` にし、**Release Operator 自身**が 2 の tag を別 SHA へ更新しようとして拒否されることを確認する。

   ```bash
   git push --force origin <OTHER_FULL_SHA>:refs/tags/vX.Y.Z
   ```

4. **Release Operator 自身**が 2 の tag を削除しようとして拒否されることを確認する。

   ```bash
   git push origin :refs/tags/vX.Y.Z
   ```

5. 通常 writer でも 2 の tag の更新・削除が拒否されることを確認する。
6. 拒否試行後に remote tag が承認 SHA のままであることを確認する。

   ```bash
   git fetch --quiet --force origin tag vX.Y.Z
   git rev-parse 'vX.Y.Z^{commit}'
   ```

7. GitHub Ruleset の Rule insights / Organization audit log で actor、操作、拒否結果を保存する。
8. すべて成功したら両方の `Active` を維持して読み取り監査を再実行する。想定外の拒否または許可があれば上記 rollout の停止条件に従う。

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
3. 対象操作に必要な ruleset だけへ Break-glass Team を `Always allow` として一時追加する。新規 tag 作成だけなら A の通常 Release Operators 経路を優先し、B を変更しない。既存 tag の更新・削除は、公開識別子の侵害対応など新 version では解決できない例外に限る。
4. 操作直後、同じ担当セッション内で一時 bypass を除去し、B の bypass list が再び空であることを API で確認する。ruleset JSON と audit log を保存する。
5. 1営業日以内に事後レビューを行い、誰が・なぜ・何を・いつ変更したか、tag SHA、Release workflow 結果、権限の付与/撤回時刻を記録する。

承認者と break-glass Team が未決定の間はこの手順を実行できない。その状態は issue #508 の blocker であり、ruleset 導入済み・issue 完了として扱わない。
