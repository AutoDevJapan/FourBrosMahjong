# 次半荘での未保存警告と復旧のProduction受入（2026-11-11）

半荘結果の保存が失敗しても、次の半荘で警告を保持し、元の結果の保存後に消えることを既存Prdの通常Chromeで確認した。
[前日の受入](./production-online-20261110.md)に加え、[PR #1242](https://github.com/AutoDevJapan/FourBrosMahjong/pull/1242)の次半荘への遷移を対象とした。

## 対象sourceと配備

| 対象 | source | 確認した配備 |
| --- | --- | --- |
| frontend | [`2adbe250e64a3bcd8449687486c26b0002c56743`](https://github.com/AutoDevJapan/FourBrosMahjong/commit/2adbe250e64a3bcd8449687486c26b0002c56743) | Vercel `dpl_4JUVeXTzypMUziEmYNxQVsgnWeVH`、READY・production・main・repository ID・full SHA・[canonical URL](https://four-bros-mahjong.vercel.app)のalias一致 |
| backend | [`2ac75883df9d296e306a855a0b2e3d4c5e5c310c`](https://github.com/AutoDevJapan/FourBrosMahjong/commit/2ac75883df9d296e306a855a0b2e3d4c5e5c310c) | Railway `4985b189-0058-43d3-910f-240ae892dbb9`、SUCCESSと認証済みopsのsource/deployment一致 |

この受入で配備・環境・server設定を変更していない。
Windowsの本人Chrome、1920×911pxの通常画面で確認した。
service workerのcontroller script URLは既存`/sw.js`だが、controllerのversionおよびロード済みアプリ全体のSHAは独立に取得していない。
配備APIのfull SHAと実画面の動作は別の証拠として扱う。

## 実対局と保存復旧

1. 既存のv1ローカル結果とv2の2件を読み取り、元の保存文字列・指紋を保持した。自分の検証ルームを通常UIで1件作成し、打牌・スルー・次局など93回の操作で東1局から南4局・半荘終了まで進めた。
2. 終局前に同じタブの`window.localStorage` getterだけに一時的な`SecurityError`を起こした。終局後は警告が表示され、退避結果1件の元ID・最初の終了日時を確認した。この間のv1/v2保存文字列は受入前と一致した。
3. 通常の結果画面から「新しい半荘を開始」を操作した。次の半荘がplayingになっても、同じ警告DOM node・文言・可視状態と、元の退避ID・終了日時が残った。
4. 既存のhistory Web Lockを一時的に保持して元のgetterへ戻し、focus再試行を開始した。350msの観測中はlock保持1・待機1で、同じ警告nodeと退避1件が残った。`finally`でlockを解放した。
5. 解放後は退避が0件になり、警告が消えた。元IDの結果は1件だけ保存され、最初の終了日時を保持した。既存v1の文字列とv2の元2件、削除世代の未設定状態も変わらなかった。
6. 一時getter・probe・lockを復元して通常リロードから再接続し、保存後の指紋と重複0を確認した。第2半荘も95回の通常UI操作で完走し、別IDの結果が自動保存された。旧結果の失敗状態が新しい保存へ残ることはなかった。
7. 通常退出してロビーから戦績一覧へ進み、再リロード後も既存2件と今回の2件、計4件の順位・日時・ソシー表示を確認した。今回の2結果はそれぞれ1件で、最初の結果の終了日時も変わらなかった。

完成済みserver結果の注入、保存値への直接書込み、履歴の削除、他ルームの操作は行っていない。
consoleとpage errorは、オンライン画面の初回ロード後から実対局・戦績リロードまで同じ所有タブのCDPイベントを観測した。
`Runtime.exceptionThrown`・`Runtime.consoleAPICalled`・`Log.entryAdded`の取得イベントは0件で、取得打切りや欠落通知はなかった。観測開始前の初回ロード全体や他タブまで保証する結果ではない。

## 退出・後片付けと残る範囲

一時getter・probe・Web Lockは復元し、残るheld/pending lockは0件だった。
自分のタブは個別終了要求後の全inventoryで不在を確認し、所有記録と終了要求の退役まで確認した。
最初の終了応答は不確実だったため、後続の不在確認を根拠に「既に無い」として処理し、最初から閉鎖成功したようには記録していない。

2026-11-11T11:21:46.109Zの認証済み`GET /ops/status`は同じbackend source/deploymentで、phaseは`accepting`だった。
connected rooms、WebSocket connections、attached sessions、unique connected seats、pending upgrades、blocking drain rooms、reconnect grace roomsはすべて0件だった。
保持ルーム1件は既存の自然TTLへ任せ、手動削除・再起動・TTL更新は行っていない。この時点で保持ルーム0を確認した結果ではない。

本番表示は既存2Dのままで、3D盤面・人物の採用や本番有効化の受入ではない。
外観への本人回答照合、3D・人物の統合レビューと本番操作・保存復元・実機性能は引き続き残る。
Storageが利用できない間の退避はメモリまたは同じタブのsessionStorageに依存し、タブ終了を越えた保存を保証しない。
