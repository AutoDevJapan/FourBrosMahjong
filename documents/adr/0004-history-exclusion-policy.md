# ADR-0004: 戦績の排他制御方針(追記は fail-closed、全件削除は「排他APIが無い環境だけ」fail-open)

## Status

Accepted

## Date

2026-08-06

## Context

戦績(`localStorage` / スペック6 6.9)の追記([#363](https://github.com/AutoDevJapan/FourBrosMahjong/issues/363))と全件削除([#482](https://github.com/AutoDevJapan/FourBrosMahjong/issues/482))は、同一名の Web Lock (`navigator.locks`) の排他区間で read-modify-write を行う。どちらも当初は **fail-closed**、すなわち「排他できないなら書き換えない」で実装した。

ところが `navigator.locks` は `[SecureContext]` 属性を持ち、**https / localhost でのみ定義される**。平文 http(LAN の IP 直打ち。`pnpm start` はそのまま到達できる)では `undefined` になり、[#489](https://github.com/AutoDevJapan/FourBrosMahjong/issues/489) の 2 点が問題になった。

1. **既に保存済みの戦績を二度と削除できない。** 削除は利用者が明示的に要求する破壊的操作であり、排他できないことを理由に拒み続けると「自分のデータを消せない」状態が固定される。
2. 失敗メッセージ「ブラウザの設定を確認してください」が**原因を誤って案内する**。実際にはブラウザ設定ではなく接続方式(http か https か)の問題で、設定画面をいくら見ても解決しない。

なお本アプリは PWA(Service Worker 登録もセキュアコンテキスト必須 / #292)なので、平文 http は元から機能が縮退したモードである。

## 検討した選択肢

| # | 方針 | 利点 | 欠点 |
|---|---|---|---|
| 1 | 全面 fail-closed(現状維持) | #482 の lost update が原理的に起きない | 平文 http では保存済み戦績を永久に削除できない |
| 2 | 全面 fail-open(排他できなければ lock 無しで削除) | どの環境でも削除できる | 別タブの writer が削除前の古い snapshot を書き戻す #482 の競合が再発し得る |
| 3 | **排他 API が存在しない環境だけ fail-open。取得に失敗した場合は fail-closed**(採用) | 競合相手が原理的に存在しない場合に限って削除を許す | 「排他不能」の判定条件が 2 系統に分かれ、契約が 1 行では説明できない |

## Decision

1. **追記(`persistHistoryAcrossTabs`)は常に fail-closed。** 変更しない。排他できない環境では保存しない(失うのは新規データのみ)。
2. **全件削除(`clearHistoryAcrossTabs`)は、`navigator.locks` 自体が存在しない場合に限り lock 無しで実行する(fail-open)。**
3. **lock API はあるが取得できなかった場合(上限時間超過 / 要求失敗 / ADR 対象外の例外)は fail-closed を維持する。** 別タブが実際に保持している可能性があるため。
4. 削除の返り値を boolean から理由付き(`"cleared"` / `"lock-busy"` / `"storage-failed"`)へ広げ、UI は原因別のメッセージを出す。

## 根拠 — なぜ「排他APIが無いときだけ fail-open」が安全側なのか

`navigator.locks` の有無は secure context の判定で決まる。判定は **文書単位**で、(a) その文書のオリジンが potentially trustworthy であること(スキーム/ホスト/ポート)と、(b) **すべての祖先文書も secure context であること**の両方を要求する。`localStorage` の分離単位は (a) と同じオリジンなので、**トップレベル文書だけを考えるなら「同じ戦績データを共有するタブは必ず同じ判定になる」**(`http://192.168.0.5:3000` と `https://192.168.0.5:3000` は別オリジン = 別ストレージ)。

(b) の祖先条件があるため、理屈の上では「平文 http のページに埋め込まれた https の iframe」だけが lock を失い、同一オリジンのトップレベルタブと `localStorage` を共有し得る。**本アプリではこの状態が発生しない** — 全 HTML ルートが `Content-Security-Policy: frame-ancestors 'none'` と `X-Frame-Options: DENY` を返し(`src/app/_lib/securityHeaders.ts`、`securityHeaders.test.ts` と `e2e/security-headers.spec.ts` で固定)、いかなる iframe にも描画されないためである。したがって本アプリの文書は常にトップレベルであり、判定はオリジン単位に一致する。

ここに決定 1(追記の fail-closed)を重ねると:

- `navigator.locks` が無い ⇒ **そのオリジンのどのタブも追記に成功しない** ⇒ 削除と競合して古い snapshot を書き戻す writer が**存在し得ない** ⇒ #482 の lost update は起こらない。
- `navigator.locks` はあるが取得できない ⇒ **別タブが保持している = 競合する writer が現に存在する**可能性が高い ⇒ fail-closed を保つ。

つまり fail-open するのは「競合相手が原理的に存在しないと示せる場合」だけであり、#482 で塞いだ競合を再び開くものではない。また削除は「消える方向」の操作なので、lock 無しで実行しても**利用者が明示的に要求した以上のデータは失われない**(追記の fail-open が「知らないうちに他タブの結果を消す」のとは非対称である)。

> **この安全性は追記の fail-closed に依存する。** 追記を fail-open へ変えるなら、削除の fail-open も同時に見直さなければならない。この結合は `matchHistory.ts` の doc コメントと、`matchHistory.test.ts` の「排他できない環境では追記は必ず失敗する」テストで固定している。

## Consequences

- 平文 http でも保存済み戦績を削除できる。新規の保存は引き続きできない(データを失う方向の fail-open は採らない)。
- 削除失敗の案内が原因別になる。「他のタブで更新中」(`lock-busy`)と「ストレージを操作できない」(`storage-failed`)は利用者が取るべき行動が違う。
- トレードオフ: 「排他不能」を 1 つの判定に畳めず、`resolveLockManager` の結果(API の有無)と lock 取得の成否を別々に扱う必要がある。この非対称性は本 ADR と `matchHistory.ts` の doc コメントで明示する。
- 残るリスク: 同一オリジンなのに一部の文書だけ `navigator.locks` を欠く状態。既知の経路は2つで、どちらも本アプリでは成立しない ─ (1) 平文 http ページへ埋め込まれた iframe(`frame-ancestors 'none'` / `X-Frame-Options: DENY` で排除。**この2ヘッダーを緩める変更は本 ADR の前提を壊す**)、(2) 拡張機能やポリシーによる API の個別無効化(オリジン単位で効くため分岐しない)。仮に生じても被害は #482 以前と同等(削除済み履歴の復活)に留まり、lock が使える文書側の追記は従来どおり排他される。
- スペック6 6.9 に方針とトレードオフを記載し、jsdom / E2E の決定的テストで固定する(#489 の完了条件)。
