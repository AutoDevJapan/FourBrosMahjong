# GitHub Actions SHA 固定ポリシー

Issue #663 の受け入れ条件に基づき、外部 Action と reusable workflow は immutable な完全 commit SHA で固定します。リポジトリ内の local reusable workflow (`./...`) は caller commit の内容を使用します。一方、local Action (`./...`) は checkout 済み workspace を実行するため、同じ job で先行する完全 SHA 固定の `actions/checkout` があり、`ref` 未指定または `${{ github.sha }}` の場合だけ許可します。Docker Action を追加する場合は tag ではなく `sha256` digest で固定します。

## Latest read-only re-audit

2026-09-06 13:38 JST に、`origin/main` の `HEAD=c3299460f8903e0aa7aee44317fffe86c468bd21`（#1036 merge後）を対象として、repository/org の設定と実行可能な workflow 参照を再監査しました。設定、allowlist、workflow、tag、release、dispatch、rerun は変更していません。

repository の再読結果:

```json
{
  "actions_permissions": {
    "enabled": true,
    "allowed_actions": "all",
    "sha_pinning_required": true
  },
  "workflow_permissions": {
    "default_workflow_permissions": "read",
    "can_approve_pull_request_reviews": false
  }
}
```

- `GET /repos/AutoDevJapan/FourBrosMahjong/actions/permissions/selected-actions` は HTTP 409 (`All actions and workflows are allowed on this repository`)。既存の `allowed_actions=all` を維持しており、selected-actions allowlistへの暗黙の変更はありません。
- `GET /orgs/AutoDevJapan/actions/permissions` と `/workflow` は HTTP 403 (`admin:org` または Actions policies fine-grained permission が必要)。現在のcredentialではorganization policyのeffective scope、precedence、ownerを確定できません。
- 5つのrepository workflowの実行可能な外部 `uses:` は20件で、20/20件が完全40桁commit SHA固定、未固定0件、local workflow/action参照0件です。Playwrightのworkflow container imageもSHA-256 digest固定です。
- 現行mainの同一SHAに対する [CI run 34010925403](https://github.com/AutoDevJapan/FourBrosMahjong/actions/runs/34010925403)、[gitleaks run 34010925305](https://github.com/AutoDevJapan/FourBrosMahjong/actions/runs/34010925305)、[CodeQL run 34010925446](https://github.com/AutoDevJapan/FourBrosMahjong/actions/runs/34010925446) はすべてsuccessです。Production deployment [6289011805](https://github.com/AutoDevJapan/FourBrosMahjong/deployments/6289011805) も同一SHAでsuccessです。gitleaks version-checkの直近successは [run 33465805332](https://github.com/AutoDevJapan/FourBrosMahjong/actions/runs/33465805332) です。
- `v*` tag、GitHub Release、`release.yml`、`gitleaks-version-bump.yml` の実行は0件です。承認なしにsynthetic tag/releaseやworkflow dispatchを作成していません。

repository-levelのSHA固定は有効で、workflow参照と通常のCI/CodeQL/gitleaksは検証済みです。#663の残りは、organization policy ownerによるeffective scope/allowlistの確認と、承認済み実Releaseでのrelease workflow証跡です。これらは現在のcredentialと通常PRの範囲では完了扱いにせず、IssueをOPEN/HOLDとして引き継ぎます。

## Repository policy

2026-08-27 21:09 JST に、`Dev-AK28` (repository `admin=true`、organization membership `active/member`) で `GET /repos/AutoDevJapan/FourBrosMahjong/actions/permissions` を読み取り監査しました。desired state は既に有効だったため、設定の PUT は行っていません。allowlist の選択も変更せず、既存の `allowed_actions: "all"` を維持しています。

変更前の正確な JSON:

```json
{
  "allowed_actions": "all",
  "enabled": true,
  "sha_pinning_required": true
}
```

変更操作: なし (既に `sha_pinning_required=true`)

変更後の再読 JSON:

```json
{
  "allowed_actions": "all",
  "enabled": true,
  "sha_pinning_required": true
}
```

## Current read-only re-audit

2026-09-06 JST に、`origin/main` と一致する `HEAD=97e2852666f4905656b7f8f6853488cf3bcfdfc8` で、repository policy と実行可能な workflow 参照を再監査しました。現在の repository 設定は次のとおりです。

```json
{
  "actions_permissions": {
    "enabled": true,
    "allowed_actions": "all",
    "sha_pinning_required": true
  },
  "workflow_permissions": {
    "default_workflow_permissions": "read",
    "can_approve_pull_request_reviews": false
  }
}
```

- `GET /repos/AutoDevJapan/FourBrosMahjong/actions/permissions` と `/workflow` で、repository の SHA 固定と既定 workflow 権限を再確認しました。設定変更は行っていません。
- `GET /repos/AutoDevJapan/FourBrosMahjong/actions/permissions/selected-actions` は HTTP 409 `All actions and workflows are allowed on this repository` です。GitHub 側の allowlist mode は意図的に `all` のままです。
- `GET /orgs/AutoDevJapan/actions/permissions` と `/workflow` は HTTP 403 `You must be an org admin or have the actions policies fine-grained permission.` です。現在の credential では organization policy の effective scope・precedence・ownerを確定できません。
- 5つの repository workflow の実行可能な外部 `uses:` は20件で、20/20件が完全40桁 commit SHA 固定、未固定0件、local workflow/action参照0件です。Docker の workflow container image も SHA-256 digest 固定です。

### Explicit source decision

現在の GitHub 設定値 `allowed_actions=all` を selected-actions allowlist へ変更することは、この対応では行いません。allow-all の判断を暗黙に拡大したり、organization の設定を推測したりせず、repository内で実際に使用する source を次の inventory として明示します。

| Action source | 実行参照数 |
| --- | ---: |
| `actions/checkout` | 7 |
| `pnpm/action-setup` | 2 |
| `actions/setup-node` | 2 |
| `actions/cache/restore` | 3 |
| `actions/cache/save` | 2 |
| `actions/upload-artifact` | 2 |
| `actions/download-artifact` | 1 |
| `softprops/action-gh-release` | 1 |
| **合計** | **20** |

新しい外部 source を追加する場合は、この inventory と `src/test/actions-sha-pinning.test.ts` の監査結果を同じ変更で更新し、完全 SHA 固定と通常の required checks を確認します。selected-actions への縮小は、organization policy owner が effective scope と互換性を確認したうえで別途承認する設定変更です。

policy 有効後の `origin/main` 同一 SHA に対する [CI run 33975755005](https://github.com/AutoDevJapan/FourBrosMahjong/actions/runs/33975755005)、[gitleaks run 33975755051](https://github.com/AutoDevJapan/FourBrosMahjong/actions/runs/33975755051)、[CodeQL run 33975754742](https://github.com/AutoDevJapan/FourBrosMahjong/actions/runs/33975754742) はすべて success です。gitleaks version updater の最新成功 run は [run 33465805332](https://github.com/AutoDevJapan/FourBrosMahjong/actions/runs/33465805332) です。

`v*` tag、GitHub Release、Release workflow run は現在0件です。承認済みの実 Release を作成して `release.yml` を検証することは、外部の Release 運用承認なしには行いません。organization policy の effective scope・owner確認と実 Release の証跡が残るまで、#663 は OPEN のまま引き継ぎます。

## Previous read-only re-audit snapshot

2026-09-05 JST に、専用worktreeの `HEAD=3d57255ec5e3835e571fff8f47dc9aec1c483089` と `origin/main` の一致を確認して再監査しました。repository policy の GET は次のとおりです。

```json
{
  "allowed_actions": "all",
  "enabled": true,
  "sha_pinning_required": true
}
```

- `GET /repos/AutoDevJapan/FourBrosMahjong/actions/permissions/selected-actions` は HTTP 409 `All actions and workflows are allowed on this repository`。allow-all を維持しており、allowlist の変更や暗黙の拡大はありません。
- `GET /orgs/AutoDevJapan/actions/permissions` と `GET /orgs/AutoDevJapan/actions/permissions/workflow` はともに HTTP 403。現在のcredentialには organization admin または Actions policies 権限がなく、organization policy の実効値・precedence・ownerは未確定です。
- `GET /repos/AutoDevJapan/FourBrosMahjong/actions/permissions/workflow` は `default_workflow_permissions=write`、`can_approve_pull_request_reviews=true`。既存設定の再確認のみで、変更していません。
- 5つのrepository workflowにある外部 `uses:` 20件は全て完全40桁SHA固定で、local workflow/action参照は0件です。repository policy、workflow参照、local recursive auditの契約テストは **173 tests pass** でした。
- 現行mainの同一SHAに対するCI [run 33890039446](https://github.com/AutoDevJapan/FourBrosMahjong/actions/runs/33890039446)、gitleaks [run 33890039579](https://github.com/AutoDevJapan/FourBrosMahjong/actions/runs/33890039579)、CodeQL [run 33890039180](https://github.com/AutoDevJapan/FourBrosMahjong/actions/runs/33890039180) はすべて成功しています。gitleaks version updaterの直近成功runは [run 33465805332](https://github.com/AutoDevJapan/FourBrosMahjong/actions/runs/33465805332) です。
- `v*` tag、GitHub Release、Release workflow runは0件です。承認済みの実Releaseを作成してpolicy下の `release.yml` を実行することは、外部のRelease運用承認なしには行いません。

この再監査では policy、allowlist、organization設定、tag、Release、workflow dispatch、repository file、外部環境を変更していません。repository側のSHA固定は完了済みですが、#663のorganization policyのscope/owner確定と実Releaseによる検証は、権限保持者・承認済みRelease運用待ちとしてOPENのまま引き継ぎます。

`allowed_actions=all` のため selected-actions API は HTTP 409 `All actions and workflows are allowed on this repository` を返します。これは allowlist を暗黙に拡大した結果ではなく、既存の allow-all 判断を変更していないことを示します。

## Previous effective scope と権限境界

- 読み取り確認できた設定の scope は repository `AutoDevJapan/FourBrosMahjong`、repository owner は organization `AutoDevJapan` です。
- `GET /orgs/AutoDevJapan/actions/permissions` と `GET /orgs/AutoDevJapan/actions/permissions/workflow` は、どちらも HTTP 403 `You must be an org admin or have the actions policies fine-grained permission.` でした。
- 現 credential は organization の active member であり owner/admin ではありません。そのため、organization policy の設定値、effective precedence、policy owner はこの監査では確定できません。organization policy owner または Actions policies 権限保持者による確認が必要です。
- repository の default workflow permissions は `write`、`can_approve_pull_request_reviews=true` です。これは SHA 固定設定とは別の既存設定であり、本対応では変更していません。

## Earlier current read-only re-audit

2026-09-05 JST に、専用worktreeの `HEAD=56de4a2df48f025e4d209d511e573c4f1f55567b` と `origin/main` の一致を確認して再監査しました。現在の repository policy と workflow permission の GET は次のとおりです。

```json
{
  "actions_permissions": {
    "allowed_actions": "all",
    "enabled": true,
    "sha_pinning_required": true
  },
  "workflow_permissions": {
    "default_workflow_permissions": "read",
    "can_approve_pull_request_reviews": false
  }
}
```

- repositoryの `sha_pinning_required=true` は維持されています。`GET /repos/AutoDevJapan/FourBrosMahjong/actions/permissions/selected-actions` は、`allowed_actions=all` のため HTTP 409 `All actions and workflows are allowed on this repository` を返します。
- `GET /orgs/AutoDevJapan/actions/permissions` と `GET /orgs/AutoDevJapan/actions/permissions/workflow` はともに HTTP 403 でした。現在のcredentialには organization admin または Actions policies 権限がなく、organization policy の実効値・precedence・ownerは確定できません。
- `GET /repos/AutoDevJapan/FourBrosMahjong/actions/permissions/workflow` は `default_workflow_permissions=read`、`can_approve_pull_request_reviews=false` です。前節の `write/true` は過去の監査スナップショットであり、現在値ではありません。
- 5つのrepository workflowにある実行可能な外部 `uses:` 20件は全て完全40桁SHA固定で、local workflow/action参照は0件です。静的参照監査の未固定件数は0件です。
- `origin/main` の同一SHAに対する CI [run 33967345126](https://github.com/AutoDevJapan/FourBrosMahjong/actions/runs/33967345126)、gitleaks [run 33967345190](https://github.com/AutoDevJapan/FourBrosMahjong/actions/runs/33967345190)、CodeQL [run 33967344995](https://github.com/AutoDevJapan/FourBrosMahjong/actions/runs/33967344995) はすべて成功しています。
- `v*` tag と GitHub Release はともに0件です。承認済みの実Releaseを作成して `release.yml` を検証することは、外部のRelease運用承認なしには行いません。

この再監査では policy、allowlist、organization設定、tag、Release、workflow dispatch、repository file、外部環境を変更していません。repository側のSHA固定は完了済みですが、#663のorganization policyのscope/owner確定と実Releaseによる検証は、権限保持者・承認済みRelease運用待ちとしてOPENのままです。

## Historical workflow audit

2026-08-27 の `origin/main` (`df55a38465b6e7e80451d7e214b2a6b26b47c772`) では、4 workflow の外部 `uses:` 18 件がすべて 40 桁 commit SHA に固定されています。local Action / reusable workflow の参照は 0 件です。

Issue #747 では Release 公開jobからcheckoutとrepository管理shellを撤去するため、`actions/download-artifact` v8.0.1 (`3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c`) を1件追加しました。上記18件は2026-08-27時点の監査値として維持し、現在のstatic contractは外部参照20件を期待します。Issue #804では、任意refでdispatch可能なread-only検査（`gitleaks-version-check.yml`）と、同一リポジトリの`main`からの成功した`workflow_run`に限って書き込む`gitleaks-version-bump.yml`を分離しました。

対象 workflow:

- `ci.yml`
- `gitleaks-version-bump.yml`
- `gitleaks.yml`
- `gitleaks-version-check.yml`
- `release.yml`

参照元は `actions/checkout`、`pnpm/action-setup`、`actions/setup-node`、`actions/cache/restore`、`actions/cache/save`、`actions/upload-artifact`、`actions/download-artifact`、`softprops/action-gh-release` です。`src/test/actions-sha-pinning.test.ts` は全 `.yml` / `.yaml` workflow の `jobs.*.uses` と `jobs.*.steps[*].uses` を検査します。local reusable workflow と local composite Action の manifest も再帰走査し、存在しない参照・循環・composite 内の未固定外部参照を fail closed にします。`env.uses`、`with.uses`、コメント、block string など、workflow schema 上で実行参照ではない値は対象外です。

## Runtime evidence

policy 有効後に、既存の Actions 実行で次を確認しています。監査のための workflow dispatch、tag、release は追加していません。

- CI: main push [run 33070424801](https://github.com/AutoDevJapan/FourBrosMahjong/actions/runs/33070424801) success。ただし変更 path の scope 判定による gate run で、lint / test / build / E2E 等の主要検証は skip されています。完全な補助証拠は [PR #716 の required checks](https://github.com/AutoDevJapan/FourBrosMahjong/pull/716/checks) で確認します。
- CodeQL: main dynamic [run 33070424352](https://github.com/AutoDevJapan/FourBrosMahjong/actions/runs/33070424352) success
- gitleaks: main push [run 33070424819](https://github.com/AutoDevJapan/FourBrosMahjong/actions/runs/33070424819) success
- gitleaks version updater: [run 32103672464](https://github.com/AutoDevJapan/FourBrosMahjong/actions/runs/32103672464) success
- Release: `v*` tag push 専用で、監査時点に tag / release / Release workflow run はありません。検証だけを目的とする tag や release は作成せず、最初の承認済み実リリースで確認します。

## 運用

Action 更新時は人間可読な version コメントを併記しつつ、`uses:` 自体は完全 SHA を使用します。Dependabot 等が作成した更新 PR も、ローカルの `pnpm exec vitest run --project unit src/test/actions-sha-pinning.test.ts` と通常の required checks が成功してから取り込みます。
