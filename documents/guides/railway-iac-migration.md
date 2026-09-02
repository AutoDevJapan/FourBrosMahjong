# Railway IaC ownership cutover parity evidence

この文書は、deprecatedなroot `railway.json`からRailway Infrastructure as Codeへownershipを移した直後、かつruntime設定を変更する前のparity snapshotをfail closedでレビューする。対象は[Issue #742](https://github.com/AutoDevJapan/FourBrosMahjong/issues/742)である。このrepositoryのvalidatorはmigration、apply、deploy、Railway login/API/config/variable/scale操作を実行も承認もしない。

Railway公式ではConfig as Codeは2026-12-01にhard cutoffとなる。IaCはbetaでone file per projectかつomitされたresourceはdelete対象になるため、公開domainからservice名を推測した手書き`.railway/railway.ts`を追加してはならない。

- [Config as Code deprecation](https://docs.railway.com/config-as-code)
- [Infrastructure as Code / migration](https://docs.railway.com/infrastructure-as-code)
- [IaC TypeScript reference](https://docs.railway.com/infrastructure-as-code/reference)
- [`railway config` CLI reference](https://docs.railway.com/cli/config)
- [review済みSDK `DeployConfig` schema](https://github.com/railwayapp/railway-ts-sdk/blob/c1b6ea8dd3e815e57257b1f17637e59d31db73b5/src/iac/schema.ts)
- [CLI minimum versionの公式実装根拠](https://github.com/railwayapp/railway-ts-sdk/blob/c1b6ea8dd3e815e57257b1f17637e59d31db73b5/src/iac/cli-version.ts#L17-L20)

## 現在のHOLD

このrepositoryには意図的に`.railway/railway.ts`を置かず、legacy `railway.json`を保持する。exact production project/environment/service identity、全project resource inventory、effective settingsをauthorized read-backしていないためである。したがって現時点の次のcommandは`hold`となる。

実施ownerはRailway Production Operatorだが現在未割当であり、未割当の間はHOLDする。移行目標日はhard cutoffよりreview/rollback余裕を確保した2026-10-31とし、完了証拠が揃うまでIssue #742はOPENを維持する。

```sh
pnpm verify:railway:iac-migration < /path/outside/repository/sanitized-parity-evidence.json
```

placeholder IDやsecretを含むsnapshotをcommitしてvalidatorを通してはならない。stdoutは固定reasonだけを返し、`authorizesMigration:false`、`authorizesApply:false`、`authorizesDeployment:false`、`externalMutationPerformed:false`である。

## 採用する一本のcutover経路

このcontractはfull-project ownershipだけを扱う。partial migrationと`config migrate --apply`を混ぜない。

1. authorized operatorが保存済みproduction targetをDashboardまたは認可済みread-only取得結果と照合する。CLIの`config --help`、`config pull --help`、`config plan --help`を保存し、CLI 5.42.1以上と必要subcommand/optionsを確認する。
2. authorized `config pull`からfull-project `.railway/railway.ts`と全resource address inventoryを生成する。generated source、inventory、target membershipをreviewする。この時点ではConfig File settingを変更しない。raw variables取得につながる`--decrypt-variables`とpreserved variablesをomitするoptionは使用しない。
3. generated sourceのSHA-256、review済みSDK revision、CLI version、全resource address集合、target serviceのnormalized source/configを保存する。variablesは`preserve()`または生成されたreferenceのままで、raw値をsource、plan、terminal capture、Issueへ出さない。Config as Codeのdeploy overrideはDashboard値を更新しないため、generated target configをcutover前後のeffective read-backとfieldごとexact比較する。
4. 別途明示承認されたoperatorだけがlegacy Config File settingをmanual clearする。`migrate --apply`、`--delete-files`、非対話のdestructive flagはこの経路で使わない。root `railway.json`は必ず保持する。
5. 同じtargetについてfresh effective read-backと`railway config plan --json --detailed-exit-code --file .railway/railway.ts`を実行する。exact invocation、CLI version、redacted raw plan artifactのSHA-256、`--detailed-exit-code`使用を証拠化する。planはexit 0でadd/change/destroy/unrelated changeがすべて0でなければHOLDする。
6. cutover前後のeffective source/configがexact parity、全証拠が5分以内、targetとgenerated hashが一致するsnapshotだけをoffline validatorへ渡す。

validatorの`pass`はauthorized cutover後のparity証拠が内部整合したことだけを表す。Railway APIの真正性/currentness、operator権限、active load、maintenance approval、migration/apply/deploy許可は証明しない。target identityとmanual secret reviewは、authorized operatorが原証拠と照合する独立gateである。

## authority mapping

| normalized field | authority source |
| --- | --- |
| target IDs/names | 保存済みRailway production targetとauthorized read-only inventory |
| inventory/resource addresses | 同じtargetへのfresh full-project `config pull`、authorized target mapping artifactのSHA-256 |
| generated path/hash/SDK/CLI/source/config | checked-in generated file、local SHA-256、生成時CLI、review済みSDK source、生成されたtarget service block |
| ownership cutover | authorized manual Config File clearの監査証跡。validator自身は変更しない |
| retained legacy file | checked-in `railway.json`のSHA-256とcutover監査証跡のexact一致 |
| pre-cutover/effective source and config | 同じtargetのcutover直前・直後effective read-back。repository/branch/root/full deployment revisionを含む |
| parity plan | setting clear後のfresh redacted plan、exact target/file hash、detailed exit code |
| source secret safety | ASTによる保守的scanとhuman reviewの両方 |

normalized JSONは64KiB以下とし、raw variables、token、Authorization、cookie、full environment dumpをschema外にする。static source scanは`env`/`variables` objectのliteral値を拒否するが、secret不存在の完全な証明ではない。manual review完了を別fieldで要求し、どちらか一方だけではpassしない。

redacted raw plan artifactはrepository外へ保存し、review evidenceへSHA-256だけを記録する。validatorはnormalized hashの形式とfile hashとの結合を確認するが、artifactの真正性や内容を独立取得して証明しない。

## parityと後続runtime hardeningの分離

ownership cutoverでは次を変更しない。

| setting | parity value |
| --- | --- |
| builder/path | `DOCKERFILE` / `Dockerfile` |
| start | current effective value（checked-in legacyは`node --import tsx server/start.ts`） |
| health | #742のpre-cutover parity baselineは`/healthz`, 60秒（liveness）。#726のrepository target `/readyz`は別のruntime変更であり、Railway productionのeffective valueとはread-backまで同一視しない |
| restart | current effective value（checked-in legacyは`ON_FAILURE`, 10） |
| replica/overlap/draining/watch/source | cutover直前とcutover直後でexact同値 |

実効direct Node、`/readyz`、全region合計single replica、overlap 0、draining 30秒、ops/drain有効化は後続#726の別承認・別read-back・別deployment gateである。IaC parity cutoverと同時に変更しない。

IaCの`github(...)` sourceはrepository/branch/rootを表し、full deployment revisionをpinしない。generated sourceはその3項目だけをread-backへsubset一致させ、cutover前後のfull revisionはeffective read-back同士でexact一致させる。後続#726は実deploy revisionを別証拠として検証する。

## contingencyとlegacy file removal

初回cutover時点には独立known-good IaCが存在しない。2026-12-01より前にparityが崩れた場合だけ、保持したexact `railway.json`と保存済みpre-cutover effective configを根拠に、authorized operatorがlegacy Config File settingを再有効化するcontingencyを使える。このvalidatorはその操作を実行も承認もしない。hard cutoff後はこのcontingencyに依存できない。

parity成功後、review済みgenerated file/hashを後続#726 runtime hardeningに対する独立known-good IaC baselineとして保存する。後続変更のrollbackはそのbaselineへのauthorized forward applyであり、room stateは復元しない。

root `railway.json`の削除は、このPRやparity validatorのscope外である。後続runtime hardening、fresh production read-back、health、rollback evidenceが成功した後の別commitでのみ削除する。今回のvalidatorはlegacy fileがpresentであることを必須とする。
