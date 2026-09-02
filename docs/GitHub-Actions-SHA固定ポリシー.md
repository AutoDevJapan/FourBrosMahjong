# GitHub Actions SHA 固定ポリシー

Issue #663 の受け入れ条件に基づき、外部 Action と reusable workflow は immutable な完全 commit SHA で固定します。リポジトリ内の local reusable workflow (`./...`) は caller commit の内容を使用します。一方、local Action (`./...`) は checkout 済み workspace を実行するため、同じ job で先行する完全 SHA 固定の `actions/checkout` があり、`ref` 未指定または `${{ github.sha }}` の場合だけ許可します。Docker Action を追加する場合は tag ではなく `sha256` digest で固定します。

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

`allowed_actions=all` のため selected-actions API は HTTP 409 `All actions and workflows are allowed on this repository` を返します。これは allowlist を暗黙に拡大した結果ではなく、既存の allow-all 判断を変更していないことを示します。

## Effective scope と権限境界

- 読み取り確認できた設定の scope は repository `AutoDevJapan/FourBrosMahjong`、repository owner は organization `AutoDevJapan` です。
- `GET /orgs/AutoDevJapan/actions/permissions` と `GET /orgs/AutoDevJapan/actions/permissions/workflow` は、どちらも HTTP 403 `You must be an org admin or have the actions policies fine-grained permission.` でした。
- 現 credential は organization の active member であり owner/admin ではありません。そのため、organization policy の設定値、effective precedence、policy owner はこの監査では確定できません。organization policy owner または Actions policies 権限保持者による確認が必要です。
- repository の default workflow permissions は `write`、`can_approve_pull_request_reviews=true` です。これは SHA 固定設定とは別の既存設定であり、本対応では変更していません。

## Workflow audit

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
