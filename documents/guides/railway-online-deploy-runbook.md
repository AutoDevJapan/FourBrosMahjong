# Railway オンラインサーバー production deploy runbook

## 目的と適用範囲

この runbook は、既存の Railway production service へレビュー済みのオンラインサーバーを一度だけ反映し、[issue #653](https://github.com/AutoDevJapan/FourBrosMahjong/issues/653) の Origin 境界とデプロイ証跡を確認するための手順である。新しい project / service / environment / replica の作成、課金設定の変更、サーバー protocol の変更は扱わない。

本番操作には Railway の対象 project / service / environment に対する権限と、メンテナンス実施の承認が必要である。権限や証拠が不足した状態では推測で進めず、以下の `HOLD` 条件に従う。

## 現行構成の制約

- ルーム、座席、対局状態は `RoomManager` のプロセスメモリだけに存在する。restart、redeploy、rollback のいずれでも進行中のルームは復元されない。
- `/healthz` はプロセスの起動を示すだけで、active room 数、接続数、drain 状態、source SHA を返さない。現行ログにも active room 数の集計はない。Railway の CPU / network graph や一般ログだけから「active room が 0」とは証明できない。
- リポジトリ上のサーバーにはdefault-offのmaintenance drainと利用者通知、bounded graceful shutdownを段階実装している。ただし、現在のRailway productionへ反映・有効化した証拠はない。Railway の overlap / draining time を設定するだけでもこれらを補えない。特に、プロセスメモリを共有しない旧・新 deployment の overlap は既存ルームへの `resume` を保証しない。
- rollback はサービスの稼働コードと変数を戻す障害復旧であり、消失したルームを戻す操作ではない。既知の古い deployment へ戻すと、missing-Origin を受け入れる既存の drift も戻り得る。

Docker imageの既定 `CMD` と `railway.json` の `startCommand` はともに `node --import tsx server/start.ts` とし、production相当imageのPID 1とsignal/shutdown契約をlocal containerで自動検証する。Railwayでは `startCommand` がimage commandを上書きするため、repository上の設定が一致していても、productionの実効commandとread-backが一致するまではlocal Docker証拠をRailway productionのsignal forwarding証拠へ読み替えてはならない。

active room観測、maintenance drain、アプリ内告知、graceful shutdownの設計・残るrollout条件は [issue #726](https://github.com/AutoDevJapan/FourBrosMahjong/issues/726) で扱う。この runbook は、repo-local実装とproductionで有効な設定・deploy証拠を分離し、明示的なメンテナンスとして一回のdeployを判断するためのものとする。

## `HOLD` 条件

次のいずれかに該当する場合は production を変更しない。

- authenticated operator が既存の対象 project / service / environment を一意に確認できない。
- reviewed source の full SHA、clean tree、同じ SHA の CI 成功を確認できない。
- 現在の deployment ID、source marker / image digest、`ALLOWED_ORIGINS`、直前の known-good rollback target を記録できない。
- rollback target が Railway の保持期間内にあり、実際に rollback 可能であることを確認できず、かつ代替として以前の正確な source/config を redeploy する手段もない。
- active room 数を観測できないという現行制約を関係者へ伝えていない、または全ルーム消失を伴うメンテナンスの承認がない。
- メンテナンス時刻と既存の外部告知手段が決まっていない。アプリ内告知が存在するかのように扱ってはならない。
- deploy 前の health / Origin baseline、deploy 後の検証担当、rollback 判断者のいずれかが未定である。
- Railwayの実効start commandがdirect Nodeであること、NodeがPID 1としてSIGTERMを一度受信すること、期限内にport/process treeが消滅することをproduction相当の検証とdeploy read-backで確認できない。repositoryのDockerfileと`railway.json`がdirect Nodeを宣言していても、productionの実効設定をsignal-safeと仮定してはならない。
- Railwayの実効replica数、`drainingSeconds`、app shutdown総予算との大小関係をread-backできない、またはreplicaが1以外、`drainingSeconds`が`ceil(ONLINE_SHUTDOWN_GRACE_MS / 1000) + 5`未満である。

## offline read-back preflight

authorized operator が Railway / Vercel / authenticated ops status から取得した値は、secretを除き、次の正規化済みJSONへ手動で転記してからoffline validatorへ渡す。validator自身はRailway API、Vercel API、公開URL、ops endpointへ接続せず、設定・flag・deploy・drainを変更しない。

```bash
pnpm verify:server:rollout-preflight < /path/outside/repository/sanitized-readback.json
```

入力は次のexact schemaとする。例のID/SHA/URLは架空であり、実行時は同じ時点でread-backした値へ置き換える。入力fileはrepositoryへcommitせず、権限制限した一時領域で扱う。`Authorization`、`ONLINE_OPS_TOKEN`、cookie、変数一覧、secretを含むraw API responseは入力しない。unknown field、欠落、`unknown`、曖昧な値はすべて `hold` になる。

```json
{
  "schemaVersion": 1,
  "phase": "pre-enable",
  "capturedAt": "2026-08-28T04:00:00.000Z",
  "railwayObservedAt": "2026-08-28T04:00:00.000Z",
  "target": {
    "projectId": "project-fixture",
    "serviceId": "service-fixture",
    "environmentId": "environment-fixture",
    "activeDeploymentId": "deployment-active-fixture",
    "activeDeploymentStatus": "success",
    "deploymentSet": {
      "activeDeploymentId": "deployment-active-fixture",
      "inProgressDeploymentIds": [],
      "stagedChanges": false
    }
  },
  "rollback": {
    "role": "prospective-after-approved-change",
    "deploymentId": "deployment-active-fixture",
    "sourceProvenance": {
      "kind": "railway-git-commit",
      "fullRevision": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    },
    "retentionEligible": true,
    "effectiveStartCommand": "node --import tsx server/start.ts",
    "effectiveHealthcheckPath": "/readyz",
    "effectiveDrainingSeconds": 30,
    "shutdownGraceMs": 25000,
    "onlineOpsRequired": true,
    "maintenanceNoticesEnabled": false
  },
  "runtime": {
    "replicaScope": "all-regions",
    "regions": [
      {
        "regionId": "region-fixture",
        "replicaIds": ["replica-fixture"]
      }
    ],
    "effectiveStartCommand": "node --import tsx server/start.ts",
    "effectiveHealthcheckPath": "/readyz",
    "effectiveDrainingSeconds": 30,
    "shutdownGraceMs": 25000
  },
  "source": {
    "reviewedServerRevision": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "activeDeploymentRevision": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "opsStatusSourceRevision": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  },
  "client": {
    "reviewedRevision": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "productionRevision": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "deploymentId": "client-deployment-fixture",
    "observedAt": "2026-08-28T04:00:00.000Z",
    "compatibilityEvidenceUrls": [
      "https://github.com/AutoDevJapan/FourBrosMahjong/pull/729",
      "https://github.com/AutoDevJapan/FourBrosMahjong/pull/730"
    ]
  },
  "operations": {
    "onlineOpsRequired": true,
    "maintenanceNoticesEnabled": false,
    "readyzStatus": 200,
    "drainState": "accepting",
    "blockingDrainRooms": 0,
    "reconnectGraceRooms": 0,
    "opsStatusDeploymentId": "deployment-active-fixture",
    "opsStatusReplicaId": "replica-fixture",
    "observedAt": "2026-08-28T04:00:00.000Z",
    "acceptingReadiness": {
      "observedAt": "2026-08-28T04:00:00.000Z",
      "deploymentId": "deployment-active-fixture",
      "sourceRevision": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "readyzStatus": 200
    }
  }
}
```

旧 `/healthz` / ops optional のproductionから最初のsafe baselineを作るmigrationは、このvalidatorで`pass`させない。repositoryのstart commandはdirect Nodeへ修正済みだが、notice default-offのinfra-only migrationとしてauthorized operatorが別途承認し、HOLD条件・#653境界を満たして実施する必要がある。migration後にdirect Node、`/readyz`、single replica、required ops、source/identityをfresh read-backできるまで、このrunbookのdrain/notice/deployへ進まない。

`pre-enable` はclient-firstのexact Production revisionを確認し、server noticeがまだdefault-off、ops required、`accepting`、`/readyz=200`である段階だけを表す。`rollback`は現在rollback可能だという自己申告ではなく、承認済みの次変更後にprospective rollbackとなる操作前current activeを表す。そのためactiveと同じdeployment ID / full source / effective start / health / draining / shutdown / ops / noticesをexactに持ち、retention対象であることをread-backする。

authorized enable後、POST前は `phase: "pre-drain"` とし、notice enabled、`accepting`、`/readyz=200`を必須にする。operator承認後にPOSTし、収束後は `phase: "drained"`、notice enabled、`drained`、`/readyz=503`、`blockingDrainRooms=0`、`reconnectGraceRooms=0`へfresh evidenceを更新して再検査する。`acceptingReadiness`は同一deployment/sourceのaccepting時に`/readyz=200`だった証拠であり、pre-enable/pre-drainではcurrent snapshot、drainedではPOST前snapshotとして使う。これによりconfig invalidによる503をdrain起因と誤認しない。replicaは現在regionだけでなく全regionを列挙し、validatorが`replicaIds`をunique集計する。唯一のreplica IDとauthenticated ops statusの`replicaId`を一致させる。ops statusの`deploymentId`もactive deployment IDと一致させるが、replica IDの存在だけからreplica数1を推測してはならない。deployment setはactive ID exact、in-progress 0、staged changesなしを同時read-backし、overlap/raceがあれば`hold`とする。これらのphase名はcurrent serviceのenable/drain状態だけを示し、upcoming candidateのfull SHA、clean tree、CI、deploy承認を検査・許可しない。それらは別のmanual HOLD gateである。

| phase | notices | current phase / readyz | blocker requirement | acceptingReadiness |
|---|---|---|---|---|
| `pre-enable` | `false` | `accepting` / 200 | 0を要求しない | currentと同時刻 |
| `pre-drain` | `true` | `accepting` / 200 | 0を要求しない | currentと同時刻 |
| `drained` | `true` | `drained` / 503 | blocking / reconnect graceとも0 | POST前の同一identity/source 200、currentより前 |

各fieldは次のauthorityから同じ時点にread-backする。Dockerfile、`railway.json`、期待値、以前のIssue本文、手入力booleanをeffective値として転記してはならない。

| evidence | authority source |
|---|---|
| project / service / environment、active deployment、active status、prospective rollback retention eligibility、deployment source、deployment set | Railway deployment metadataとread-only retention/全deployment情報 |
| effective start command / healthcheck / draining、全regionとreplica IDs | Railway deploymentのeffective settings / topology read-back |
| shutdown grace、ops required、notices enabled | 対象deploymentのeffective runtime variable read-back。tokenや変数一覧全体は保存しない |
| drain phase / blocker counts / deploymentId / replicaId / source revision / observedAt | 同一のauthenticated `GET /ops/status` response。`acceptingReadiness`は同一deployment/sourceのaccepting時 `/readyz=200` |
| client full revision / deployment ID / observedAt | Vercel Production exact deploymentとcanonical read-back |
| compatibility anchors | client-first parser/bannerのreviewed [PR #729](https://github.com/AutoDevJapan/FourBrosMahjong/pull/729) とaccepting復帰のreviewed [PR #730](https://github.com/AutoDevJapan/FourBrosMahjong/pull/730) |

stdoutは固定の `repoPreflight: "pass" | "hold"`、固定reason code、`authorizesDeployment: false`、`externalMutationPerformed: false`だけを返し、入力IDや値を反射しない。`pass`でも、入力元APIの真正性、read-back後の変更、maintenance承認、現在のactive room/blocker、production操作権限は証明しない。freshnessは入力timestampだけのbounded検査であり、authorized operatorによるread-only再確認と承認記録を代替しない。repository上の`railway.json`はdirect Node start commandと`/readyz`を宣言するが、それをproductionのeffective read-backへ読み替えてはならず、証拠がなければ正しく`hold`となる。

## 1. 変更前の証拠を保存する

### Source と CI

1. `origin/main` を fetch し、反映対象の full 40-character SHA を記録する。
2. 専用の detached worktree をその SHA から作る。`git rev-parse HEAD` が記録した SHA と一致し、`git status --porcelain` が空であることを確認する。
3. その SHA に対する CI、CodeQL、gitleaks が成功していることを記録する。
4. server の関連 local test、typecheck、lint、Biome を実行し、command、件数、終了時刻を記録する。

dirty tree、別 branch の未レビュー差分、短縮 SHA だけを source 証拠として deploy してはならない。

### Railway target と rollback

Railway Dashboard または現在利用中の Railway CLI の read-only command で、次を記録する。CLI の command や出力形式は version により変わるため、操作前に `railway --version` と公式 CLI reference を確認する。

- account / workspace
- 既存 project / service / environment の名前と ID
- active deployment の ID、status、作成時刻、source marker、image digest
- `ALLOWED_ORIGINS` が許可する production frontend Origin。変数一覧全体や無関係な secret はログ・Issueへ出力しない。
- manual recovery evidenceとして、直前の known-good deployment の ID、source/config、現時点の`canRollback`相当の可否
- 利用 plan の image retention 内で rollback できる期限

上記manual prior-rollback evidenceは、offline validatorの`rollback`とは別物である。validator側は操作前current activeが承認済み変更後のprospective rollbackとなることと、そのretention eligibilityを検査する。current activeに現在の`canRollback=true`を要求・推測しない。対象 ID はこの文書へ固定しない。operator がその時点の Dashboard と read-only query の双方で既存 production target を照合する。新しい resource を作成してはならない。

### Public baseline

以下の helper は `GET /healthz`、`GET /readyz`、3回の有効な HTTP Upgrade handshake だけを行う。101 を受け取った socket は直ちに破棄し、`create` / `join` / `resume` / `action` / `ping` を含む WebSocket application frame は送らない。

```bash
node scripts/probe-online-boundary.mjs \
  --base-url https://online-backend.example \
  --allowed-origin https://frontend.example \
  --disallowed-origin https://not-allowed.example
```

同じ値は環境変数でも渡せる。CLI option が環境変数より優先される。空値や未設定値は既定の production URL に置き換えず、実行前に失敗する。

```bash
ONLINE_PROBE_BASE_URL=https://online-backend.example \
ONLINE_PROBE_ALLOWED_ORIGIN=https://frontend.example \
ONLINE_PROBE_DISALLOWED_ORIGIN=https://not-allowed.example \
ONLINE_PROBE_TIMEOUT_MS=10000 \
node scripts/probe-online-boundary.mjs
```

helper は timestamp と各 status を JSON で標準出力へ返す。期待値は liveness `200`、readiness `200`、allowed Origin `101`、disallowed Origin `403`、missing Origin `403` である。すべて一致すれば exit code `0`、境界 drift や network error / timeout があれば `1`、引数不正なら `2` を返す。deploy 前の既知 drift がある場合も JSON を保存し、成功と読み替えない。

## 2. メンテナンスを開始する

1. 承認済みの外部告知手段で、開始時刻、オンライン対局が切断され復元できないこと、終了予定を告知する。
2. Railway の直近 metrics / logs を補助情報として確認する。ただし、これを active room `0` の証拠にはしない。
3. operator、検証担当、rollback 判断者が揃っていることを再確認する。
4. `HOLD` 条件を再評価し、承認記録へ時刻と判断者を残す。

### 認証済み drain と収束確認

この手順はclient-first配布、default-off解除、ops required/readiness、上記offline preflightをauthorized operatorが別途承認・確認した後だけ行う。tokenをcommand line、shell history、Issue、logへ出さない。次の例では一時header fileをmode 600で作成し、終了時に削除する。

```bash
set -euo pipefail
umask 077
OPS_BASE_URL=https://online-backend.example
OPS_CONNECT_TIMEOUT_SECONDS=5
OPS_REQUEST_TIMEOUT_SECONDS=10
node -e '
  const url = new URL(process.argv[1]);
  if (url.protocol !== "https:" || url.origin !== process.argv[1]) process.exit(1);
' "$OPS_BASE_URL"
# token入力前に、このexact originが保存済みproduction serviceと一致することを照合する。
OPS_HEADER_FILE="$(mktemp)"
chmod 600 "$OPS_HEADER_FILE"
trap 'rm -f "$OPS_HEADER_FILE"' EXIT
read -r -s -p 'Ops bearer token: ' ONLINE_OPS_TOKEN; printf '\n'
if ! printf '%s' "$ONLINE_OPS_TOKEN" | pnpm validate:server:ops-token; then
  unset ONLINE_OPS_TOKEN
  exit 1
fi
printf 'Authorization: Bearer %s\n' "$ONLINE_OPS_TOKEN" > "$OPS_HEADER_FILE"
unset ONLINE_OPS_TOKEN

OPS_STATUS_FILE="$(mktemp)"
chmod 600 "$OPS_STATUS_FILE"
trap 'rm -f "$OPS_HEADER_FILE" "$OPS_STATUS_FILE"' EXIT
OPS_STATUS_CODE="$(curl --silent --show-error \
  --connect-timeout "$OPS_CONNECT_TIMEOUT_SECONDS" \
  --max-time "$OPS_REQUEST_TIMEOUT_SECONDS" --header "@$OPS_HEADER_FILE" \
  --output "$OPS_STATUS_FILE" --write-out '%{http_code}' \
  "$OPS_BASE_URL/ops/status")"
test "$OPS_STATUS_CODE" = 200
```

ここで一旦止める。statusのdeployment/source/replica identityを保存済みRailway read-backと照合し、この同じresponseから`pre-drain` sanitized evidenceを再構成してoffline preflightが`pass`であることをoperatorが確認する。401/5xx、identity/source drift、`hold`ならPOSTを実行しない。`pass`も操作承認ではないため、maintenance承認者が別途開始を承認した後だけ、別のblockとして次を実行する。この確認・承認がevidence freshnessの5分以内に終わらなければshellを終了してheader fileを削除し、fresh GETからやり直す。

```bash
OPS_DRAIN_CODE="$(curl --silent --show-error \
  --connect-timeout "$OPS_CONNECT_TIMEOUT_SECONDS" \
  --max-time "$OPS_REQUEST_TIMEOUT_SECONDS" --header "@$OPS_HEADER_FILE" \
  --output /dev/null --write-out '%{http_code}' \
  --request POST "$OPS_BASE_URL/ops/drain")"
test "$OPS_DRAIN_CODE" = 200
```

同じ認証済み `GET /ops/status` を5秒間隔・最大30回（各requestはconnect 5秒 / total 10秒）だけread-only確認する。この上限が承認済みmaintenance deadlineを超える場合は、開始前に回数をさらに減らす。exactに `phase="drained"`、`aggregate.blockingDrainRooms=0`、`aggregate.reconnectGraceRooms=0` が同一responseで揃ったら`drained` evidenceへ更新し、offline preflightが再び`pass`になるまでdeployしない。各responseのdeployment/source/replica identityも保存済みread-backと一致させる。30回で収束しない、identityがdriftする、requestが失敗する場合はpollを停止する。無期限pollや自動SIGTERMへ進める実装は使わない。

成功pathではDELETEを実行しない。`drained`を維持したままupcoming candidateのmanual SHA/clean tree/CI/target/承認gateを再確認し、すべて成功した場合だけ§3の承認済みtarget deploymentへ進む。

#### abort path（失敗・取消時だけ）

次のDELETEはpoll不収束、identity drift、candidate manual gate失敗、承認取消、またはtarget deployment中止時だけ、かつSIGTERM/target deployment開始前だけに実行する。成功した`drained` pathで実行してはならない。

```bash
OPS_RELEASE_CODE="$(curl --silent --show-error \
  --connect-timeout "$OPS_CONNECT_TIMEOUT_SECONDS" \
  --max-time "$OPS_REQUEST_TIMEOUT_SECONDS" --header "@$OPS_HEADER_FILE" \
  --output /dev/null --write-out '%{http_code}' \
  --request DELETE "$OPS_BASE_URL/ops/drain")"
test "$OPS_RELEASE_CODE" = 200
```

解除responseと同じtimeout付き後続statusが`accepting`であることを確認し、外部告知を更新する。`terminating`は不可逆であり、SIGTERM/SIGINT後にDELETEで解除しようとしてはならない。token、Authorization header、room/player/session情報、raw variable一覧は証拠へ保存しない。`curl --location`を付けずredirectを追跡しない。3xxも上記exact 200 checkでfail-stopし、Bearerを別hostへ転送しない。一時header fileはこのbounded手順の終了/失敗時にtrapで即削除し、別作業へ持ち越さない。

## 3. 承認済みphaseごとに一度だけ deploy する

既存 production service だけを対象にする。初回infra-only safe baseline、notice enable変数のdeployment、drain収束後のtarget deploymentは別の承認・別のdeploymentとして扱い、同時化しない。ここでいう「一度だけ」は各承認済みphase内でcommandをretry・重複実行しないという意味である。変数変更、scale、project link の変更、新規 resource 作成を同じ操作へ混ぜない。

- GitHub source integration から deploy する場合は、対象がレビュー済み `main` SHA であることを確認し、deployment ID と `RAILWAY_GIT_COMMIT_SHA` を証拠に残す。
- CLI upload を使う場合は、上で確認した detached clean worktree から実行し、deployment message に full SHA を含める。CLI upload では Railway metadata の commit SHA が空になる場合があるため、deployment ID、image digest、full-SHA message、deploy 元の `HEAD` と clean tree を一組の証拠として残す。
- offline preflightのsource provenanceは、GitHub source integrationの`kind="railway-git-commit"`とmetadataのfull revisionだけを受理する。CLI uploadはmetadataだけで同じprovenanceを機械検証できないためvalidatorでは明示的に`hold`となる。CLI uploadを別途承認する場合も、deployment ID、image digest、full-SHA-only message、deploy元clean HEADをmanual evidenceとして扱い、validatorの`pass`へ読み替えない。
- deploy command を実行する直前に、CLI が示す project / service / environment が保存済み target と完全一致することを再確認する。
- command の再実行や細かな追加 deploy をしない。失敗時は原因を確認し、下記の rollback 判断へ進む。

`/healthz` の response、deployment message の短縮 SHA、ローカル branch 名だけから source SHA を推測してはならない。

## 4. deploy 後の gate

1. 新 deployment が `SUCCESS` になったことを確認し、deployment ID、source SHA 証拠、image digest、開始・完了時刻を保存する。
2. upcoming candidateのmanual reviewed full SHA / clean tree / CIと、new active deployment sourceをexact一致させる。不一致ならrollback判断へ進む。
3. Railwayのeffective start / healthcheck / draining、全region topology、stable deployment setをfresh read-backする。
4. authenticated `GET /ops/status`からnew deploymentId / replicaId / sourceRevision / observedAt / `accepting`を確認する。Railway effective runtime variable read-backからops required / notices enabledを別に確認し、`/readyz=200`と同じ時点で突合する。ops payloadに存在しないvariable値をGETから取得したと扱わない。POSTは再実行しない。
5. new activeをprospective rollbackとしてfresh `pre-drain` evidenceを再構成し、offline validatorが`pass`であることを確認する。失敗は成功扱いにせずrollback判断へ進む。
6. `ALLOWED_ORIGINS` が変更前の承認値と一致することを、無関係な secret を出力せず確認する。
7. boundary probe helper を同じ引数で一度実行する。
8. liveness `200`、readiness `200`、allowed `101`、disallowed `403`、missing `403` の全一致を確認する。
9. Railway の deploy/runtime logs に crash、継続的な5xx、予期しないrestartがないことを確認する。
10. abuse control の接続・message・action・room試行上限は local または隔離した staging で検証する。production へ負荷・game messageを送って完了証拠を作らない。
11. Issue コメントには full source SHA、deployment ID / image digest、allowlist確認方法、probe JSON、時刻、local/staging test結果だけを記録し、secretを含めない。

## 5. rollback

次のいずれかが発生したら、新しい deploy を成功扱いにせず rollback を判断する。

- liveness または readiness が `200` にならない、または deployment が `SUCCESS` にならない。
- deployment source の証拠が対象 full SHA と一致しない。
- allowed Origin が `101` でない。
- disallowed / missing Origin のいずれかが `403` でない。
- crash、継続的な5xx、再起動ループなど、既存サービスより重大な回帰がある。

Railway Dashboard から、事前に記録した rollback 可能な known-good deployment を選ぶ。Railway の rollback は以前の image と custom variables を復元するが、plan ごとの image retention を過ぎた deployment は選べない。その場合は事前に確認した正確な以前の source/config を redeploy する。曖昧な「latest」や別 resource を代替 target にしない。

rollback 後も新しい deployment IDを記録し、liveness/readiness と3つの Origin probeを再実行する。サービスが復旧しても、ルームは復元されない。rollback target が missing-Origin を受け入れる既知の旧版なら #653 は未完了のまま `HOLD` とし、security drift を解消済みとは報告しない。

## 公式 Railway 仕様

- [Deployment Actions — rollback / redeploy](https://docs.railway.com/deployments/deployment-actions)
- [Deployment Teardown — overlap / draining](https://docs.railway.com/deployments/deployment-teardown)
- [Variables Reference — deployment / Git SHA / teardown variables](https://docs.railway.com/variables/reference)
- [Railway CLI deployment reference](https://docs.railway.com/cli/deployment)

公式仕様が変わった場合は、production 操作の前にこの runbook を更新し、レビューする。
