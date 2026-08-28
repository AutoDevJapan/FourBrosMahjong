# Railway オンラインサーバー production deploy runbook

## 目的と適用範囲

この runbook は、既存の Railway production service へレビュー済みのオンラインサーバーを一度だけ反映し、[issue #653](https://github.com/AutoDevJapan/FourBrosMahjong/issues/653) の Origin 境界とデプロイ証跡を確認するための手順である。新しい project / service / environment / replica の作成、課金設定の変更、サーバー protocol の変更は扱わない。

本番操作には Railway の対象 project / service / environment に対する権限と、メンテナンス実施の承認が必要である。権限や証拠が不足した状態では推測で進めず、以下の `HOLD` 条件に従う。

## 現行構成の制約

- ルーム、座席、対局状態は `RoomManager` のプロセスメモリだけに存在する。restart、redeploy、rollback のいずれでも進行中のルームは復元されない。
- `/healthz` はプロセスの起動を示すだけで、active room 数、接続数、drain 状態、source SHA を返さない。現行ログにも active room 数の集計はない。Railway の CPU / network graph や一般ログだけから「active room が 0」とは証明できない。
- リポジトリ上のサーバーにはdefault-offのmaintenance drainと利用者通知、bounded graceful shutdownを段階実装している。ただし、現在のRailway productionへ反映・有効化した証拠はない。Railway の overlap / draining time を設定するだけでもこれらを補えない。特に、プロセスメモリを共有しない旧・新 deployment の overlap は既存ルームへの `resume` を保証しない。
- rollback はサービスの稼働コードと変数を戻す障害復旧であり、消失したルームを戻す操作ではない。既知の古い deployment へ戻すと、missing-Origin を受け入れる既存の drift も戻り得る。

Docker imageの既定 `CMD` は `node --import tsx server/start.ts` とし、production相当imageのPID 1とsignal/shutdown契約をlocal containerで自動検証する。一方、現行 `railway.json` の `startCommand` は `pnpm server:start` であり、Railwayではimage commandを上書きする。authorized operatorによる後続のdirect Node command変更とread-backが完了するまで、local Docker証拠をRailway productionのsignal forwarding証拠へ読み替えてはならない。

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
- Railwayの実効start commandがdirect Nodeであること、NodeがPID 1としてSIGTERMを一度受信すること、期限内にport/process treeが消滅することをproduction相当の検証とdeploy read-backで確認できない。現行`pnpm server:start`をsignal-safeと仮定してはならない。
- Railwayの実効replica数、`drainingSeconds`、app shutdown総予算との大小関係をread-backできない、またはreplicaが1以外、`drainingSeconds`が`ceil(ONLINE_SHUTDOWN_GRACE_MS / 1000) + 5`未満である。

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
- 直前の known-good deployment の ID、source/config、`canRollback` 相当の可否
- 利用 plan の image retention 内で rollback できる期限

対象 ID はこの文書へ固定しない。operator がその時点の Dashboard と read-only query の双方で既存 production target を照合する。新しい resource を作成してはならない。

### Public baseline

以下の helper は `GET /healthz` と3回の有効な HTTP Upgrade handshake だけを行う。101 を受け取った socket は直ちに破棄し、`create` / `join` / `resume` / `action` / `ping` を含む WebSocket application frame は送らない。

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

helper は timestamp と各 status を JSON で標準出力へ返す。期待値は health `200`、allowed Origin `101`、disallowed Origin `403`、missing Origin `403` である。すべて一致すれば exit code `0`、境界 drift や network error / timeout があれば `1`、引数不正なら `2` を返す。deploy 前の既知 drift がある場合も JSON を保存し、成功と読み替えない。

## 2. メンテナンスを開始する

1. 承認済みの外部告知手段で、開始時刻、オンライン対局が切断され復元できないこと、終了予定を告知する。
2. Railway の直近 metrics / logs を補助情報として確認する。ただし、これを active room `0` の証拠にはしない。
3. operator、検証担当、rollback 判断者が揃っていることを再確認する。
4. `HOLD` 条件を再評価し、承認記録へ時刻と判断者を残す。

## 3. 一度だけ deploy する

既存 production service だけを対象にする。変数変更、scale、project link の変更、新規 resource 作成を同じ操作へ混ぜない。

- GitHub source integration から deploy する場合は、対象がレビュー済み `main` SHA であることを確認し、deployment ID と `RAILWAY_GIT_COMMIT_SHA` を証拠に残す。
- CLI upload を使う場合は、上で確認した detached clean worktree から実行し、deployment message に full SHA を含める。CLI upload では Railway metadata の commit SHA が空になる場合があるため、deployment ID、image digest、full-SHA message、deploy 元の `HEAD` と clean tree を一組の証拠として残す。
- deploy command を実行する直前に、CLI が示す project / service / environment が保存済み target と完全一致することを再確認する。
- command の再実行や細かな追加 deploy をしない。失敗時は原因を確認し、下記の rollback 判断へ進む。

`/healthz` の response、deployment message の短縮 SHA、ローカル branch 名だけから source SHA を推測してはならない。

## 4. deploy 後の gate

1. 新 deployment が `SUCCESS` になったことを確認し、deployment ID、source SHA 証拠、image digest、開始・完了時刻を保存する。
2. `ALLOWED_ORIGINS` が変更前の承認値と一致することを、無関係な secret を出力せず確認する。
3. boundary probe helper を同じ引数で一度実行する。
4. health `200`、allowed `101`、disallowed `403`、missing `403` の全一致を確認する。
5. Railway の deploy/runtime logs に crash、継続的な5xx、予期しないrestartがないことを確認する。
6. abuse control の接続・message・action・room試行上限は local または隔離した staging で検証する。production へ負荷・game messageを送って完了証拠を作らない。
7. Issue コメントには full source SHA、deployment ID / image digest、allowlist確認方法、probe JSON、時刻、local/staging test結果だけを記録し、secretを含めない。

## 5. rollback

次のいずれかが発生したら、新しい deploy を成功扱いにせず rollback を判断する。

- health が `200` にならない、または deployment が `SUCCESS` にならない。
- deployment source の証拠が対象 full SHA と一致しない。
- allowed Origin が `101` でない。
- disallowed / missing Origin のいずれかが `403` でない。
- crash、継続的な5xx、再起動ループなど、既存サービスより重大な回帰がある。

Railway Dashboard から、事前に記録した rollback 可能な known-good deployment を選ぶ。Railway の rollback は以前の image と custom variables を復元するが、plan ごとの image retention を過ぎた deployment は選べない。その場合は事前に確認した正確な以前の source/config を redeploy する。曖昧な「latest」や別 resource を代替 target にしない。

rollback 後も新しい deployment IDを記録し、health と3つの Origin probeを再実行する。サービスが復旧しても、ルームは復元されない。rollback target が missing-Origin を受け入れる既知の旧版なら #653 は未完了のまま `HOLD` とし、security drift を解消済みとは報告しない。

## 公式 Railway 仕様

- [Deployment Actions — rollback / redeploy](https://docs.railway.com/deployments/deployment-actions)
- [Deployment Teardown — overlap / draining](https://docs.railway.com/deployments/deployment-teardown)
- [Variables Reference — deployment / Git SHA / teardown variables](https://docs.railway.com/variables/reference)
- [Railway CLI deployment reference](https://docs.railway.com/cli/deployment)

公式仕様が変わった場合は、production 操作の前にこの runbook を更新し、レビューする。
