# Railway IaC: shared Productionの対象サービスだけを管理する

[Issue #742](https://github.com/AutoDevJapan/FourBrosMahjong/issues/742)の移行候補と検証手順。
`.railway/railway.ts`は既存の`four-bros-mahjong-online`だけを宣言し、stable partial名を`four-bros-mahjong-online`とする。
稼働環境は既存Productionだけで、共有projectの他サービス、DB、volume、domainをこのrepositoryの管理対象へ追加しない。
[ADR-0007](../adr/0007-railway-named-partial.md)も参照する。

## 対象と所有権

| 対象 | 固定値 |
| --- | --- |
| project | `72632f6a-ce4d-4acd-89c8-ec798132baa7` / `godd-genesis` |
| environment | `703cd34a-de40-42a8-ae72-674fb60e2e88` / `production` |
| service | `9f7f42d2-7383-4201-b4d8-efeb054b301c` / `four-bros-mahjong-online` |
| resource address | `service.four-bros-mahjong-online` |
| partial export | `four-bros-mahjong-online` |

公式の[named partial仕様](https://docs.railway.com/infrastructure-as-code#multi-repo-projects)では、各repositoryが自分の資源だけを所有する。
省略した未所有資源と別partialの資源は残るが、同じpartialが以前所有していた資源の省略は削除になり得る。
そのため全resource inventoryは読み取りだけに使い、targetを他partialが所有する場合、または同名partialが対象外の資源を所有する場合は拒否する。
whole-project ownership (`*`)への切替、partialの改名、他所有者からのclaimはこの候補に含めない。
旧文書の「full-projectのみ」「省略した全資源を削除」は現在のnamed partialへ適用しない。

## 生成物、SDK型、native engineの境界

authoringはCLI 5.71.0の次の生成結果を起点とする。

```sh
railway config migrate --service four-bros-mahjong-online --variables unmanaged --apply
```

生成元はrepositoryのdesired設定であり、active imageの実効設定を証明しない。
原生成source、生成時help/log、原生成SHA-256をrepository外へ保持し、draining 30秒、overlap 0、restart方針の追加と型互換化後のsourceは別SHAで照合する。
CLI 5.71.0の`migrate --help`では、この`--apply`はlocal filesystemだけを変更する。
外部Config File変更と再配備は別の`config migrate cutover`である。
切替後のConfig File設定は、対象serviceの明示的な空文字列をread-backする。`null`は未指定である。空文字列だけでも、uploadしたrootの`railway.json`が新deploymentのfile metadataへ残らないことまでは証明しない。
[CLI 5.71.0の実装](https://github.com/railwayapp/cli/blob/v5.71.0/src/commands/config/migrate.rs)では、statusの一覧作成が`null`を空文字列と同様に除外する一方、cutoverが書く値は空文字列である。`No services ... read Config as Code`という表示だけで移行済みと判断しない。
暗黙のroot設定が一覧に出ない場合も、正規の対象限定APIで同じConfig File設定を変更し、元の値とrollback用source/image/snapshotを保持する。切替後は新deploymentのconfig-file metadata、実効start/healthcheck/replica/draining、sourceとOrigin境界を再取得する。過去deploymentの`meta.configFile`と現在のservice設定も区別する。対象外のserviceは変更しない。
現在の実行用正本は`.railway/railway.ts`だけで、rootのJSON/TOMLは置かない。旧`/readyz`版は[`railway-readyz-before-iac.json`](../fixtures/railway-readyz-before-iac.json)へ同じbytesで保存した。これは履歴fixtureであり、再びrootへ戻すrollback手順ではない。
Config File設定と新deploymentのmetadataが一致しないときは、同じredeployを反復しない。CLI 5.71.0の通常redeployはlatest deploymentを選び、image再利用flagを明示しない。レビュー済みsourceを新snapshotとしてuploadし、Dockerfileの実buildとmetadataを同じdeployment IDで確認する。
[WebのCLI説明](https://docs.railway.com/cli/config#migrate-config-as-code)には旧動作が残るため、実行する版のhelpと区別する。
`--force`、`--delete-files`、cutover、applyをplan作成へ混ぜない。

SDKは`railway` **3.16.0**をexact devDependencyとして使う。
この版の`ProjectDefinition`型にはCLI生成のproject-level `variables`方針がないが、SDKの`project()`実装は渡された定義を保持する。
ローカルのliteral `definition`を`project()`へ渡すことでTypeScriptのexcess-propertyエラーを解消し、`variables:{managed:false}`を実際の戻り値に残す。
型assert、`@ts-ignore`、policyの削除、SDKパッチは使わない。

型チェックだけで互換性やparityを主張しない。
installed SDKのdeclaration 2ファイルのhash、実SDKのauthoring戻り値、CLI native planの`variablePolicy`をそれぞれ検証する。
review済みdeclarationのSHA-256は`dist/iac/index.d.ts + NUL + reexport先dist/index-*.d.ts`から計算し、`e154a2beae34557bdfb456b40dc5810bc07739d7ed46cfc498b1079da5a4f3ce`である。
CLIのruntime schemaとSDK declarationが同一だという主張ではない。

Windowsでnpm shimからSDKがCLIを発見できない場合は、インストール済みの正規`railway.exe`を実行し、そのbinを当該processのPATH先頭へ加える。
認証ファイルや環境変数の実値を表示しない。
`--runner`は指定せずnative engineを使う。

## 二段階の証拠

| phase | 必要なplan | 証明しないこと |
| --- | --- | --- |
| `ownership-parity` | build/deployの差分0、exit 0、対象だけの宣言 | active imageが新しいこと、room消失なし、既存load |
| `runtime-update` | 対象のbuild/deployだけの許可済み差分、変更ありexit 2／差分0ならexit 0 | 外部applyの実施、再配備成功、実効readiness |

現在のauthoringは`runtime-update`候補である。
`DOCKERFILE` / `Dockerfile` / build V3、direct Node start、`/readyz` / 60秒、draining 30秒、overlap 0、`ON_FAILURE` / 10、`us-west2`の1 replicaを指定する。
source repo/image、networking、variables、volume、scale増加を更新しない。
既存のCLI upload serviceへ推測の`github(...)`を追加しない。

所有権移行とruntime更新は別に扱う。
Config File settingを明示的な空文字列へ変更した後でも、変更前に起動したdeploymentのfileManifestには旧`railway.json`が残ることがある。現在の設定と過去のbuild metadataを混同しない。
`config migrate status`の表示やローカルsourceの一致を、active image・room・healthのread-backへ代用しない。
古いstart commandと`/healthz`が動くdeploymentに対して、desired `/readyz`との実効parity成功と報告しない。

## read-only captureと検証

1. 認証済みの正規CLIの`--version`、`config plan --help`、`config pull --help`、`config migrate --help`で版と引数を確認する。
   最低版はstable 5.42.1、今回の実証版は5.71.0である。
   対象のproject/environment/service membershipとConfig File settingを正規read-backし、上表へexact照合する。
2. `config pull --json --variables unmanaged --environment <production-id>`でgraphをrepository外へ保存する。
   他資源はinventory照合のためだけに読み、名前や設定を公開報告へ列挙しない。
   linked environmentを確認して`config partials list --json`を保存する（5.71.0のこのsubcommandには`--environment`がない）。
3. exact source bytesのSHA-256と`.railway`のGit tree IDを計算する。
   このvalidatorが検証するtreeは`railway.ts`1ファイルで、余分なentryがあればfail closedとなる。
   `singleFileIacTree()`はGitと同じblob/tree形式をメモリで計算し、index/objectを変更しない。
   authoring変更後は古いHEADのtreeを暗黙採用しない。
4. 同じsourceで次のplanを取得する。

```sh
railway config plan --file .railway/railway.ts --environment <production-id> \
  --json --detailed-exit-code --out <outside-repository>/railway-plan.json \
  --source-tree <reviewed-40-hex-tree>
```

`--out`のpinとstdout JSONを別々に保存し、raw bytesのSHA-256、実exit code、capture時刻を記録する。
variablesはunmanagedで、native outputの`variablePolicy`が`managed:false`であることを確認する。
`--decrypt-variables`、`--show-values`、`--include-variables`、`--omit-preserved-variables`は使用しない。
planの`applyResult`、`stagedPatch`、`deploymentId`、`stagedPatchId`はすべてnullであることを確認する。

5. 正規化したschemaVersion 2のevidenceをstdinへ渡す。

```sh
pnpm verify:railway:iac-migration < <outside-repository>/sanitized-evidence.json
```

PowerShellでは`Get-Content -Raw`のpipeまたはprocessのstdinを使う。
64KiB上限、strict JSON、重複object name拒否、固定reasonのみのstdoutを維持する。
全snapshotを5分以内とし、inventory・ownership → plan → captureの時系列、30秒のfuture skew限度を検証する。
古いevidenceを現在時刻だけ書き換えて使わない。

schemaVersion 2のrootは`schemaVersion, phase, capturedAt, cliEvidence, target, source, inventory, ownership, ownershipObservedAt, plan`をexactに持つ。
`source`はpath/SHA/tree、原生成source/SHA/command、unmanaged、local生成、secret review、危険flags不使用を保持する。
`inventory`は対象ID・address・全address集合・membership原証拠のhash・明示的な空文字列のconfigFileSettingを保持する。
`plan`はpin/stdout双方のtextとSHA、source SHA、時刻、exit code、native engine、外部保存・flags条件を保持する。
詳細なexact fieldは[`railway-iac-named-partial.ts`](../../scripts/railway-iac-named-partial.ts)を正本とする。

pinのkind/version/CLI/source tree/environment/etag/changeSetHash/partial/宣言集合と、stdoutのtarget graphを照合する。
変更は既存targetの`resource.update`、build/deployだけを許可し、before/after値をgraphとexact照合する。
追加・削除・variable変更・他service変更・unknown fields・raw variable値は拒否する。
静的source scanとmanual reviewを別に保持し、hashや自己申告だけで外部APIの真正性・権限・currentnessを保証したことにしない。

出力の`pass`は候補証拠の整合を意味する。
常に`authorizesMigration:false`、`authorizesApply:false`、`authorizesDeployment:false`、`externalMutationPerformed:false`を返し、外部処理は呼ばない。
これは人への新しい一般承認待ちではなく、validatorと実操作担当を分ける契約である。

### 再起動設定の既定値と保存表現

Railwayの[既定の再起動方針](https://docs.railway.com/deployments/restart-policy)は`ON_FAILURE`、最大10回である。
2026-11-10の対象Prdでは、この2項目が環境config JSONと保存patchから省略される一方、`serviceInstance`とdeploymentの`serviceManifest.deploy`は宣言どおり`ON_FAILURE`/`10`だった。
同じ値のtarget-only patchは正常完了しても空patchとなり、config ETagも変わらなかった。以前のnative IaC applyの保存patchでも同じ2項目は省略されていた。

この場合、native planには`restartPolicyType (null → ON_FAILURE)`と`restartPolicyMaxRetries (null → 10)`が残り得る。差分0とは報告せず、同じpatchの再送や不要な再配備で解消しようとしない。
その2項目だけであること、保存patchと非同期処理が正常終了したこと、実効値が両方のread-backで一致することを確認する。別の差分や実効値の不一致を、この表現差として除外しない。
`.railway/railway.ts`の明示した意図は保持し、次回配布でも実効値を再確認する。サーバー内部の正規化処理そのものを検証したという意味ではない。

## immutable履歴と実操作

schemaVersion 1は旧full-project parity証拠の回帰検証として保持する。
現在のnamed partialへ旧fixtureを当ててpassさせず、旧schemaの正常・異常・lexical secret scanも維持する。
[`railway-pre-cutover.json`](../fixtures/railway-pre-cutover.json)の`/healthz`とSHA-256 `2d772749d488b99e39f2428d80e9f8301214312835bc3d744250ec9d6742d84d`を変更しない。
旧root `/readyz`版は上記の別fixtureに保存し、schemaVersion 1の回帰テストにだけ使う。旧実効baselineの代わりにしない。
schemaVersion 2はroot `railway.json`と`railway.toml`の確定した不在を要求する。読取不能・directory・symlink・存在確認の不明を不在へ変換せず、空文字列のservice設定と併せて検証する。

外部cutover/config mutation/apply/deployは同じ対象の単一担当が行う。
適用するなら検証した同じpinを使い、source tree・etag・所有権が変わった場合はfresh planから再照合する。
稼働room/loadが不明なら、[online runbook](railway-online-deploy-runbook.md)の正規load/drain条件を満たす前に再配備へ進めない。
room消失を伴う本人だけの判断は具体的な対象・影響を集約担当へ返し、通常の技術選択を本人質問へ変えない。

runtime変更のrollbackは記録したknown-good設定へのforward applyとdeploymentの再確認であり、メモリ上のroomを復元しない。
Config as Codeは[公式のhard cutoff](https://docs.railway.com/config-as-code)（2026-12-01）以後のrollback手段にしない。
旧設定をrootから撤去したレビュー済みsourceを配布した後、新deploymentの`configFile`・`fileServiceManifest`・`propertyFileMapping`に旧参照が残らないことと、IaCの実効設定・Prd health・復旧用snapshotを確認するまで移行完了としない。

2026-11-09のtarget-only applyと実runtime更新の結果は[Production受入記録](../evidence/production-online-20261109.md)に記録した。
この履歴を、次回のfresh plan・直前load・source照合の代わりに使わない。
