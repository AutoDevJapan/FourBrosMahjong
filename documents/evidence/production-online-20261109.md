# オンラインProduction受入（2026-11-09）

既存Railway Productionへ、[PR #1225](https://github.com/AutoDevJapan/FourBrosMahjong/pull/1225)を統合した
[`82725fc4d9f3cf33340fa63a55c87f1810030648`](https://github.com/AutoDevJapan/FourBrosMahjong/commit/82725fc4d9f3cf33340fa63a55c87f1810030648)
を反映した。対象は既存service `9f7f42d2-7383-4201-b4d8-efeb054b301c`、Production environment
`703cd34a-de40-42a8-ae72-674fb60e2e88`、deployment `359dae66-eeaa-4b19-91df-df54610ec2ac`。
新しい環境・サービス・レプリカは作成していない。

## 実効設定と起動

2026-11-09 13:22 JSTの認証済みread-backで、上記deploymentがSUCCESSであり、実行中source markerが
上記の40桁SHAと一致することを確認した。image digestは
`sha256:9221d6bd398d8c995d3d99096c8eb169d5e4a8064664cea61e2e265f3bed59d6`。

- Node 26.8.1の実効commandは`node --import tsx server/start.ts`。この時点の記録ではPIDを独立取得していない。
- healthcheckは`/readyz`、timeout 60秒、replica 1、overlap 0秒、draining 30秒。
- ops認証を必須化し、source/deployment/replica identityを認証済み`GET /ops/status`と突合した。
- `ONLINE_MAINTENANCE_NOTICES_ENABLED=false`を保持した。通知の有効化・本番drain試験・実rollbackは実施していない。

named partial `four-bros-mahjong-online`の既存serviceに対するbuild/deploy設定だけを、fresh pinとETagを検証してapplyした。
共有projectの対象外6資源は前後の構成指紋が一致し、変数をIaCの管理対象へ追加していない。
設定applyが開始した旧sourceのdeploymentは起動に失敗した。その後、上記のreview済みsourceをuploadし、SUCCESSを確認した。
apply受付とruntimeの稼働成功は別の結果として記録する。

## 公開境界と実対局

対象URLは`https://four-bros-mahjong-online-production.up.railway.app`。
13:22 JSTのhandshake-only probeで次を確認した。

| 対象 | 結果 |
| --- | --- |
| `GET /healthz` | 200、`{"ok":true}` |
| `GET /readyz` | 200、`{"ok":true}` |
| `Origin: https://four-bros-mahjong.vercel.app` | WebSocket Upgrade 101 |
| 許可外Origin | 403 |
| Originなし | 403 |

続いて2クライアントで新規ルーム作成・参加・77操作・3回の局遷移・切断再接続を行い、13:23:53 JSTに終局した。
両クライアントの結果が一致し、4人に重複のない4順位が付くことを確認した。
ルーム識別子・再接続tokenは公開記録へ含めない。

両クライアントを通常leave/closeした後、接続数は0となった。
終局済み検証ルーム1件は強制削除せず通常TTLに任せ、14:30 JSTの認証済みops GETでretained rooms、接続、pending upgradesがすべて0、phaseがaccepting、source/deploymentが同一であることを確認した。

## 復旧と残る受入

旧deploymentとsnapshotの識別・source・設定は移行前に保持したが、移行後の旧deploymentはREMOVEDである。
過去の`canRollback:true`を、現在もその旧deploymentへrollbackできる証拠として使わない。
復旧時は保持したreview済みsource・image・named partial設定を現在の対象へ再適用し、health/readiness/Originとsourceを再確認する。
これはメモリ上のルームを復元する操作ではない。次の更新でも直前のops/loadと受付条件を確認する。

この受入はオンラインbackendの記録である。新しい3D盤面・人物の外観承認、Vercel Productionでの3D表示、実GPUでの性能、maintenance通知の段階有効化まで完了したことを意味しない。
