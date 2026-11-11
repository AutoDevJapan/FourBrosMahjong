# オンラインProduction受入（2026-11-09）

この文書は各段階の受入履歴を保持する。後続のbackend更新とChromeでのオンライン戦績保存・復旧の受入は[2026-11-10の記録](./production-online-20261110.md)を参照する。

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

## 追加受入：通知と新source snapshot（同日22:29 JST）

同じProduction serviceへmain [`a976d46ca044efe20241b5d939a98d064b1c1969`](https://github.com/AutoDevJapan/FourBrosMahjong/commit/a976d46ca044efe20241b5d939a98d064b1c1969)を一度uploadし、deployment `92385e7b-0873-4fab-a3e4-1624d13e2dde`のSUCCESSを確認した。
imageは`sha256:4de27349cdd90479cd3d786f4d7c9a6cf487baa8c8a0f4e017357bb369ef868b`、snapshotは`529220fd-2f6c-4c4c-95e9-35d375389451`。

- Dockerfileのオンライン専用multi-stage buildを実logで確認し、実効builderはDOCKERFILE/V3/Dockerfileだった。legacy APIのBuilder enumとは別の契約として照合した。
- 認証済みruntimeのsourceと、Git blobから計算したserver 23 file・src 141 fileのraw bytesが一致した。Node 26.13.0、PID 1のdirect Node command、PID 1のUID/GID 1000を確認した。SSH観測processのUIDとは分けた。
- health/readinessは200/200、WebSocketはallowed Origin 101・disallowed 403・missing 403だった。ops requiredとmaintenance noticesはtrue、phase accepting、保持room・接続・pending upgradeは0だった。
- 操作前後で対象serviceを除くenvironment configのhashが一致した。新しい環境・service・replicaを作らず、検証roomも作っていない。
- 新activeを次変更のprospective rollbackとして構成したpreflightはpassだった。source receipt/APIの真正性はoperatorが照合し、validatorの形式検査と分けた。

通常redeployで起動した先行deploymentはRAILPACKによるNext buildへ進んで失敗したため、旧runtimeの受付を復旧した。その失敗を新uploadの成功へ含めない。
新uploadのservice Config File設定は空文字列だったが、新deploymentにも`/railway.json`のfile metadataが残った。この時点では完全なIaC移行を主張しない。
rootの旧設定を履歴fixtureへ移した後のレビュー済みsourceを配布し、新snapshotで旧file参照が無いこと、実効設定と既存Prdの正常性を確認する工程を残す。
この追加受入はhandshake-onlyであり、先の実対局・再接続の記録を新sourceで再実行したという意味ではない。3D・人物の本番有効化も別の未達である。

## 2026-11-10：root Config as Code退役後の受入

既存Prdへmain [`50d731c20241f2cb2ab787e928cb658e28bfcc83`](https://github.com/AutoDevJapan/FourBrosMahjong/commit/50d731c20241f2cb2ab787e928cb658e28bfcc83)を一度uploadし、00:45 JSTにdeployment `f49fda8c-5ae4-4c34-b83c-f66c2c0b54d6`のSUCCESSと受付復帰を確認した。
新snapshotは`a3808479-ec02-4fb9-8209-5dac54a155e3`。Config File設定は空文字列で、snapshotに`configFile`の旧参照は無く、`fileServiceManifest`と`propertyFileMapping`も空だった。

- 実効builderはDOCKERFILE/V3/Dockerfile、PID 1はNode 26.13.0の`node --import tsx server/start.ts`、PID 1のUID/GIDは1000だった。SSH観測processのUIDとは区別した。
- image digestは前回と同じ`sha256:4de27349cdd90479cd3d786f4d7c9a6cf487baa8c8a0f4e017357bb369ef868b`。実行中のserver 23 file・src 141 fileのraw bytesも前回のGit由来指紋と一致した。source markerとCLI messageは今回の40桁SHAだった。
- 切替前の保持roomと接続が0であることを確認後、検証用の1接続に正規drainのmaintenance通知を実送信した。受信payloadは`{"type":"maintenance","phase":"drained","retryAfterMs":60000}`。application frameを送信せず、roomも作らず、その接続を閉じてから全aggregate 0を再確認し、sourceをuploadした。
- 新runtimeはphase accepting、health/readiness 200/200、保持room・接続・pending upgradeは0。allowed Originは101、disallowedとmissing Originは403だった。ops認証必須とmaintenance notices有効も保持した。
- 旧deploymentはREMOVEDとなり、activeは新deploymentの1件だけになった。旧processのmanual drainを新runtimeへ持ち越していない。新snapshotは`canRollback:true`だが、実rollbackは行っていない。
- 対象外5 serviceを含むenvironment configの指紋は前後で一致した。新しい環境・service・replicaは作らず、upload専用の一時filterも削除した。

再起動方針の実効値は`ON_FAILURE`/`10`だったが、環境config JSONでは省略され、native planにはその2項目の差分が残った。保存patchと非同期完了を照合した結果は[既定値の保存表現](../guides/railway-iac-migration.md#再起動設定の既定値と保存表現)にまとめた。差分0や未実施の設定変更を成功したとは扱わない。
この受入は既存オンラインbackendの設定・source・通知・公開境界の確認であり、3D・人物の本番有効化や外観承認を意味しない。実行imageとruntime sourceが同一である範囲の既存受入を保持し、実対局を再実行したとは記録しない。
