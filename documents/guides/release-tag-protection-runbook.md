# Release tag 保護 runbook

GitHub Release の公開識別子である `v*` tag を、公開後に付け替え・削除されないよう保護するための運用手順。対象 repository は `AutoDevJapan/FourBrosMahjong`。

## 現状と適用結果

2026-08-15 (JST) の適用監査と 2026-08-17 (JST) の follow-up 読み取り監査では、repository ruleset `protect-existing-release-tags` (ID `20858931`) が `active` で適用済みである。対象は `target=tag`、`refs/tags/v*`、除外なし、rules は `update`・`deletion`・`non_fast_forward`、`bypass_actors` は空である。したがって Release Operator を含む全 actor が、公開済み `v*` tag の付け替え・削除・force-update を拒否される。今回この ruleset の適用・再監査にあたり、tag の作成・更新・削除は行っていない。

監査の再現可能性のため、repository 内に read-only helper [`audit-release-tag-ruleset.mjs`](../../.github/scripts/audit-release-tag-ruleset.mjs) を置く。helper は `includes_parents=false` の ruleset 一覧から repository-owned の対象を **ちょうど 1 件**選び、詳細を取得して validator に渡す。各 API 呼び出しは `gh api --method GET` を argv に明示し、将来のオプション追加による method 上書きも拒否する。対象が無い・複数ある・詳細の一部が取得できない場合は fail closed する。`bypass_actors` は GitHub API の仕様上、ruleset への write access がない caller には返されないため、管理者または ruleset の write access を持つ operator の `gh` 認証で実行する。read-only token での欠落を「bypass なし」と解釈しない。

同日の tag / Release inventory には `v*` tag と GitHub Release が存在しない。そのため既存公開物の SHA を変更しておらず、正常 Release の実作成と実 tag 操作による拒否テストは、次の承認済み release rehearsal まで未実施である。

### 2026-09-05 current-main 再監査

2026-09-05 (JST)、#838 の merge 後の `main` (`c99a68cc0e8282a36f1f5d811489b16ab78d7179`) を基準に、以下を読み取り専用で再確認した。

- `node .github/scripts/audit-release-tag-ruleset.mjs` は、repository-owned ruleset `protect-existing-release-tags` (`20858931`) の `active`、`target=tag`、`refs/tags/v*`、`deletion` / `non_fast_forward` / `update`、`bypass_actors=[]`、`current_user_can_bypass=never` を検証した。
- Organization Team は 0 件、repository で push/admin 権限を持つ collaborator は `mashfromband` と `Dev-AK28` の2名だった。専用 Release Operators Team、break-glass Team、権限分離された検証用アカウントは未登録である。
- `v*` tag、GitHub Release、`Release` workflow run はいずれも 0 件だった。したがって、作成認可 A の実アカウント拒否、Release Operator の正常作成、公開後 tag の更新/削除拒否を実操作では検証していない。
- runbook契約テスト（`release-tag-ruleset.test.ts`、`release-guard.test.ts`、`gitleaks-release.test.ts`）は 3 files / 127 tests が成功した。

この再監査では ruleset、Team、collaborator 権限、tag、Release、workflow、repository file を変更していない。B の不変性は継続して検証済みだが、owner が Release Operators / break-glass governance と実検証用アカウントを承認するまで、A の作成認可と実アカウントによる拒否テストは未完了のまま HOLD とする。

`main` の branch protection（PR・必須 check・force push/deletion 禁止・admin 適用）も有効だが、branch protection は tag ref を保護しない。`.github/workflows/release.yml` の公開前 guard と本 ruleset は責務が異なり、guard は新規 tag push のイベント（既存 tag の再 push/付け替えは fail closed）・tag の内容・CI 証拠を、ruleset は公開後の ref 不変性を担保する。イベント guard は ruleset B の代替ではなく、設定誤りや一時 bypass 時の補完層である。

### 残っている外部承認 blocker

`gh api orgs/AutoDevJapan/teams --paginate` は空であり、現時点の repository collaborator で push 権限を持つのは admin 2名だけである。この状態で個人アカウントや `RepositoryRole=admin` を恒久 bypass にするのは最小権限・担当分離に反するため、作成認可 ruleset は有効化していない。次の2点は Organization owner / Repository administrator が決め、issue #508 または組織のアクセス管理台帳に承認者・日時・numeric ID とともに記録する。

1. Release Operators として登録する専用 GitHub Team（team slug / numeric team ID）。通常 writer、repository role `Write`、Organization admin、Dependabot、GitHub Actions app を bypass 対象にしない。
2. break-glass の承認者2名以上と、緊急時にだけ一時追加する Team（Release Operators と分離した team slug / ID）。この Team を恒久 bypass に置かない。

専用 Team と承認者が決まるまで、作成認可 rulesetを `active` にせず、通常 writer に `Write` 権限を付与しない。これは不変性 ruleset の適用を妨げるものではないが、Team ベースの作成拒否と、権限の異なる実アカウントによる拒否テストを完了できない blocker である。

## ロールと責務

| ロール | 通常時の権限・責務 | `v*` tag ruleset bypass |
|---|---|---|
| 通常 writer | PR 作成、実装、レビュー。release PR の準備は可能 | **なし**。現在の read 権限では GitHub 権限で tag 操作を拒否。`Write` 付与前に作成認可 ruleset を有効化する |
| Release Operator | package/CHANGELOG、main SHA、trusted CI を確認し、承認済み tag を1回だけ作成 | 専用 Team 確定後、**作成 ruleset のみ bypass**。不変性 ruleset は bypass せず、本人も更新・削除を拒否される |
| Release Approver | version・対象 SHA・変更履歴を確認し、tag 作成を承認。Operator と別人 | bypass なしを原則とする |
| Break-glass Operator | tag 保護事故への緊急対応。2名承認と事後レビューを伴う | 現在は Team 未設定。承認された緊急 Team を対象 ruleset に時間制限付きで追加し、直後に除去する |
| Automation（Dependabot、通常 CI、Vercel） | PR・検証・deploy。release tag は作成しない | **なし**。現行 Release workflow は既存 tag から Release を作るだけなので例外不要 |

GitHub Team のメンバー変更権限も release 権限そのものである。Team membership の変更は Organization audit log に残し、Operator と Approver の分離を崩さない。

## Ruleset の設定（管理者作業）

GitHub UI の **Settings → Rules → Rulesets → New ruleset → New tag ruleset**、または repository ruleset API で設定する。外部設定変更は承認した管理者が行い、Codex / CI が自動適用しない。現在は不変性 ruleset B だけを適用済みであり、作成認可 ruleset A は専用 Team が決まるまで作成しない。

両方を作成する場合の共通条件:

- Enforcement status: 構成中は `Disabled`、承認・検証時間帯に `Active`。現在の GitHub Team plan/private repository で利用可否が異なる `Evaluate` を前提にしない
- Target: Tags
- Include ref: `refs/tags/v*`
- Exclude ref: なし

### A. 作成認可 `authorize-release-tag-creation`

- Bypass list: 承認済み Release Operators Team のみ（`Always allow`）
- Rule: Restrict creations **のみ**
- 通常 writer、Organization admin repository role、Dependabot、GitHub Actions app、break-glass Team は恒久 bypass に追加しない

この ruleset は「誰が新しい release tag を作れるか」だけを決める。Release Operator の bypass が既存 tag の更新・削除を許可しないよう、それらの rule を混在させない。

### B. 不変性 `protect-existing-release-tags`（適用済み）

- Ruleset ID: `20858931`
- Enforcement: `Active`
- Bypass list: **空**（Release Operators Team も含めない）
- Rules:
  - Restrict updates
  - Restrict deletions
  - Block force pushes / non-fast-forward updates（UI に表示される場合）

この ruleset は公開済み tag の不変性を全員に課す。Release Operator も tag の付け替え・削除はできない。緊急時だけ、2名承認後に break-glass Team をこの ruleset の bypass へ一時追加し、操作直後に除去する。

API へ送った B の payload は次のとおりである。`update_allows_fetch_and_merge=false` は tag には適用されないが、API の `update` rule schema が要求するため明示している。レスポンスではこのパラメータが省略されることがある。

```json
{
  "name": "protect-existing-release-tags",
  "target": "tag",
  "enforcement": "active",
  "bypass_actors": [],
  "conditions": { "ref_name": { "include": ["refs/tags/v*"], "exclude": [] } },
  "rules": [
    { "type": "update", "parameters": { "update_allows_fetch_and_merge": false } },
    { "type": "deletion" },
    { "type": "non_fast_forward" }
  ]
}
```

Ruleset JSON export / API 応答と画面 capture を issue #508 に添付し、ruleset ID、enforcement、対象 pattern、rules、bypass actor ID を監査記録に残す。特に B の bypass actor が空であることを確認する。UI の表示名だけでは Team の取り違えを検出できないため numeric ID も記録する。

### 読み取り監査

以下は設定を変更しない。ruleset の `bypass_actors` を監査できる write access と、Organization Team 一覧を読む権限を持つ管理者端末で実行する。

```bash
GITHUB_REPOSITORY=AutoDevJapan/FourBrosMahjong \
  node .github/scripts/audit-release-tag-ruleset.mjs
gh api --method GET 'orgs/AutoDevJapan/teams?per_page=100' --paginate
```

helper の出力と API 応答に含まれる `target=tag`、`source_type=Repository`、`enforcement=active`、include pattern、B の update/deletion/non-fast-forward、`bypass_actors=[]`、`current_user_can_bypass=never` を目視照合する。validator はこの契約を機械検証し、条件不一致なら exit 1 で停止する。監査対象を保存する場合は helper 実行とは別に、上記 list/detail の GET 応答をファイルへ保存する。専用 Team が登録された後は、A の creation + Team bypass も同じように全項目を監査する。

### A の作成認可を追加する rollout

1. Release Operators Team、break-glass Team、Approver 2名、通常 writer の検証者、誤許可時の復旧担当を決め、Team の numeric ID と issue #508 への承認記録を残す。
2. 次の実 release（または永続的に残してよい prerelease）と検証時間帯を決め、既存 `v*` tag の full SHA を記録する。
3. 次の payload で A を `Disabled` で作り、API 応答と画面を別の管理者が照合する。`123456789` はプレースホルダーなので、承認済み Team の numeric ID に置き換える。

   ```json
   {
     "name": "authorize-release-tag-creation",
     "target": "tag",
     "enforcement": "disabled",
     "bypass_actors": [
       { "actor_id": 123456789, "actor_type": "Team", "bypass_mode": "always" }
     ],
     "conditions": { "ref_name": { "include": ["refs/tags/v*"], "exclude": [] } },
     "rules": [{ "type": "creation" }]
   }
   ```

   JSON を承認済みの管理者端末に保存した場合だけ、次で作成する。作成後は返却された ID を使って読み取り監査し、同じ payload を再 POST しない。

   ```bash
   gh api --method POST repos/AutoDevJapan/FourBrosMahjong/rulesets \
     --input ./authorize-release-tag-creation.json
   ```

4. A の creation のみ、Team ID、bypass mode、pattern を二者確認してから A だけを `Active` にする。通常 writer の作成拒否と Operator の正常作成を検証する。この段階でも B は `Active` のままにする。
5. A の検証が成功した場合だけ、通常手順の実 release tag と Release workflow の成功を確認する。
6. 想定外の許可または拒否があれば新しい tag 操作を止め、A を `Disabled` に戻して監査記録を残す。B 有効後の tag は変更せず、B の一時 bypass が必要なら下記 break-glass の2名承認を先に得る。

## 正常リリース手順

1. Operator 以外が release PR を作り、`CHANGELOG.md` の dated section と `package.json` version を一致させる。
2. Approver が version、公開対象 SHA、main への取り込み、同じ SHA の trusted main CI・gitleaks・CodeQL 成功を確認し、issue / release ticket に承認を記録する。pending・失敗・API 取得不能のまま tag を作らない。この確認は GitHub Release 公開用であり、既に `main` merge で開始された Vercel Production deploy の gate ではない。
3. Release Operator が最新の remote を取得し、対象を明示して annotated tag を作る。作成認可 ruleset A が未適用の現状では、承認済みの repository admin がこの操作を担当し、通常 writer に push 権限を付与しない。A を適用した後は、専用 Release Operators Team の member だけが担当する。

   ```bash
   git fetch --quiet origin main --tags
   git rev-parse origin/main
   git tag -a vX.Y.Z <APPROVED_FULL_SHA> -m "Release vX.Y.Z"
   git push origin refs/tags/vX.Y.Z
   ```

4. `Release` workflow の `Validate release evidence` と `Create GitHub Release` が成功したこと、Release の tag SHA が承認 SHA と一致することを確認する。

   tag 作成時点で同じ SHA の CI・gitleaks・CodeQL が pending だったため guard が失敗した場合は、全証拠の成功後に**同じ Release workflow run ID**を再実行する。公開識別子は immutable とし、tag の削除・付け替え・再 push や、同じ version の別 tag 作成は行わない。

   ```bash
   gh run list --workflow Release --limit 10
   # guard が証拠未完了で失敗した場合だけ、同じ run ID の failed job を再実行
   gh run rerun <FAILED_RELEASE_RUN_ID> --failed
   git fetch --quiet origin tag vX.Y.Z
   git rev-parse 'vX.Y.Z^{commit}'
   gh release view vX.Y.Z --json tagName,isDraft,isPrerelease,url
   ```

5. Approver が operator、承認者、version、full SHA、workflow run URL、Release URL、ruleset ID `20858931`（A 適用後は A の ID も）を監査記録へ追記する。

## 適用時の拒否テスト

既存の公開済み tag を試験対象にしない。Ruleset API には actor を差し替えた dry-run がないため、実操作を行う場合は main 上の検証済み SHA と、公開後も残してよい prerelease version を使う。通常 writer の作成拒否テストには、あらかじめ予約・記録した negative-test version を使う。今回の適用では workflow を高コスト再実行せず、tag の作成・更新・削除を実行していない。

1. A=`Active` / B=`Active` で、通常 writer の別アカウントが予約済み negative-test tag を作成しようとして拒否されることを確認する。もし成功したら新しい tag 操作を止め、A を `Disabled` に戻して以降を中止する。作成された tag は、承認済み復旧担当が ruleset の状態を確認してから、事前に承認した手順で処理する。
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
8. すべて成功したら A と B の `Active` を維持して読み取り監査を再実行する。想定外の拒否または許可があれば上記 rollout の停止条件に従う。

拒否テストは権限の異なる実アカウントを必要とする。管理者 token で通常 writer を模擬してはならない（bypass により偽陽性になる）。実アカウントと検証用 version が用意できない間は、設定応答の validator と repository permission の読み取り監査までを完了とし、拒否テストを完了扱いにしない。

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
4. B を一時 bypass する場合は、現在の ruleset 全体を保存してから `PUT /repos/AutoDevJapan/FourBrosMahjong/rulesets/20858931` で `bypass_actors` に break-glass Team だけを追加する。操作直後、同じ担当セッション内で元の payload（`bypass_actors: []`）へ戻し、validator と API で `current_user_can_bypass=never` / bypass 空を確認する。ruleset JSON と audit log を保存する。
5. 1営業日以内に事後レビューを行い、誰が・なぜ・何を・いつ変更したか、tag SHA、Release workflow 結果、権限の付与/撤回時刻を記録する。

承認者と break-glass Team が未決定の間はこの手順を実行できない。現在は不変性 ruleset B の導入済み状態だが、作成認可 A、実アカウントによる正常 release / 拒否検証、break-glass の運用承認は未完了であり、issue #508 の残 blocker として扱う。
