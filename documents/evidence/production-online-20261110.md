# オンライン戦績と保存復旧のProduction受入（2026-11-10）

既存Prdでオンラインの半荘結果を保存し、Storage失敗から復旧しても履歴を重複させないことを確認した。
配備先は[既存Vercel Production](https://four-bros-mahjong.vercel.app)と既存Railway Productionのままである。
それ以前の設定移行・maintenance通知・通常TTLの受入は[前段階の記録](./production-online-20261109.md)に保持する。

## 配布したsourceと実効設定

| 対象 | 受入時のsource | 配備の確認 |
| --- | --- | --- |
| frontend | [`808c47b08884ea09f3ff0e8ff05f496b66a0c91d`](https://github.com/AutoDevJapan/FourBrosMahjong/commit/808c47b08884ea09f3ff0e8ff05f496b66a0c91d) | Vercel Production `dpl_5VYQ7ryUsUqc1cKaWakq3Hdj9YS2`、READYとfull SHA一致 |
| backend | [`2ac75883df9d296e306a855a0b2e3d4c5e5c310c`](https://github.com/AutoDevJapan/FourBrosMahjong/commit/2ac75883df9d296e306a855a0b2e3d4c5e5c310c) | Railway deployment `4985b189-0058-43d3-910f-240ae892dbb9`、SUCCESSと認証済みopsのidentity一致 |

frontendの保存復旧表示は[PR #1239](https://github.com/AutoDevJapan/FourBrosMahjong/pull/1239)で修正した。
レビュー対象の最終sourceで必要なCIが成功し、mainへ統合したtreeも一致した。
この表示修正でbackendを再配布していない。

backendのsource更新は事前のloadと正規drainを確認して一度uploadした。
snapshot `a2b96b37-6fa0-4ab8-87f4-193f92f87ded`はConfig Fileが空文字列で、旧root設定の参照が無く、`fileServiceManifest`と`propertyFileMapping`も空だった。
実際のbuildはDOCKERFILE/V3/Dockerfile、Node 26.13.0のPID 1は`node --import tsx server/start.ts`、UID/GIDは1000だった。
実行中のserver 23 file・src 144 fileのraw bytesは当該Git sourceと一致した。
image digestは`sha256:08ac6adb26f1b1c172f63fd5957411e8f68b979c3b4f8489594c33bb19e66101`。

health/readinessは200/200、allowed OriginはUpgrade 101、disallowedとmissing Originは403だった。
ops認証必須とmaintenance notices有効を保持し、replicaは1、drainingは30秒、overlapは0秒だった。
対象外5 serviceを含むenvironment configの指紋は前後で一致し、新しい環境・service・replicaを作っていない。
再起動設定の保存表現と実効値の差は[既存の移行手順](../guides/railway-iac-migration.md#再起動設定の既定値と保存表現)に従って区別した。
復旧候補のpreflightは成功したが、実rollbackは行っていない。

## 通常Chromeでの保存・復旧

既存Prdの通常UIで作成した検証用ルームを、打牌・パス・次局の操作で東1局から南4局・半荘終了まで進めた。
完成済みのserver結果を注入するfixtureやendpointは使っていない。

1. 受入前の既存ローカル戦績1件を保持したまま、同じタブの`window.localStorage` getterだけに一時的な`SecurityError`を起こした。半荘結果は保存失敗として通知され、退避結果が1件残った。
2. 元のgetterへ戻してfocusすると退避結果が保存された。既存ローカル結果にオンライン結果が1件加わり、元の履歴は保持された。同じ終了済みルームへ再接続・リロードしても、同じ半荘が重複せず、最初の終了日時を保持した。
3. frontend `808c47b0`の反映後、通常リロードから同じルームの半荘終了へ復帰し、上段が「対局終了」になることを確認した。
4. 通常退出後、同じgetterの一時失敗を使って正規再参加した。既存Web Lockを短時間保持してgetterを復元し、focusで再試行を開始した。lock待機中も同じ警告DOM nodeが残り、保存確認前に消えなかった。
5. lock解放後に退避結果が0件となり、警告が消えた。結果画面にも警告は残らず、通常退出から戦績一覧へ進むと既存1件とオンライン1件の2件を確認できた。

最後の再試行は既存結果として処理され、v1・v2の保存文字列は再試行前後で完全一致した。
重複は0件で、元の終了日時と削除世代の未設定状態も変わらなかった。
実保存値への直接書込み、全件削除、他ルームへの操作は行っていない。
一時getter・probe・lockを元に戻し、検証用接続から通常退出して確認用タブも閉じた。
ルーム識別子・再接続token・個人の戦績内容はこの公開記録へ含めない。

## 接続終了と確認の限界

2026-11-10T08:08:49.931Zの正常な認証済み`GET /ops/status`は同じbackend source/deploymentで、phaseは`accepting`だった。
connected rooms、WebSocket connections、attached sessions、unique connected seats、pending upgrades、blocking drain roomsはすべて0だった。
終局済みの保持ルーム1件は手動削除・再起動せず、既存TTLへ任せた。この時点で保持ルーム0まで確認したという意味ではない。

公開`/sw.js`は200で、配布workerのversionは`808c47b08884`だった。
Chromeではactive controllerと`/sw.js`のscript URL、および修正後の実際の表示・復旧動作を確認したが、controller自体のversionやロード済みアプリ全体のSHAは独立に取得していない。
配備APIのfull SHA、公開workerのbytes、実画面の動作はそれぞれ別の確認として扱う。

本番表示は既存2Dのままで、新しい3D盤面・人物は有効化していない。
外観の元質問への本人回答の回収、人物ごとの反応・品質、本番3Dの操作・保存復元・性能を含む統合受入は残る。
Storage自体が使えない間の退避はメモリまたは同じタブのsessionStorageに依存し、タブ終了を越えた保存を保証しない。
