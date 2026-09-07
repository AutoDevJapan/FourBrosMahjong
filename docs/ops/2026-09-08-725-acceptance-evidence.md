# #725: Production 追加検証と環境構成の判断資料

## 事実: 今回の対象と exact deployment

2026-09-08 JST、専用 worktree の base と GitHub `main` は
`2074f2cae28745907396c957a21c63b944dd8b3a` だった。GitHub Production deployment
`6314661426` は同じ full SHA で `success`、URL は
<https://four-bros-mahjong-qb3hzvz9c.vercel.app>。公開 canonical URL
<https://four-bros-mahjong.vercel.app> の `/sw.js` は `VERSION = "2074f2cae287"` を返した。
これは以下の取得時点の証拠であり、後続 merge の deployment の証拠には流用しない。

同じ full SHA の既存 [CI 34153907473](https://github.com/AutoDevJapan/FourBrosMahjong/actions/runs/34153907473)、
[gitleaks 34153907562](https://github.com/AutoDevJapan/FourBrosMahjong/actions/runs/34153907562)、
[CodeQL 34153907464](https://github.com/AutoDevJapan/FourBrosMahjong/actions/runs/34153907464)
は `success`。証跡取得のための Actions rerun や deployment 作成は行っていない。

## 事実: 公開 Production の responsive / theme matrix

in-app Browser は bootstrap 後に canonical URL を指定したが `No browser is available`、
続く利用可能一覧も `[]` だった。そこで system Chrome を Playwright の新規 context で起動し、
認証不要の canonical URL を逐次検査した。既存 profile や cookie は読み込んでいない。

開始 `2026-09-07T19:36:46.818Z`、終了 `2026-09-07T19:39:12.349Z`
（JST 2026-09-08 04:36:46–04:39:12）。

| 軸 | 値 |
|---|---|
| route | `/`、`/rules`、`/settings`、`/game?seed=0`、`/game/result`、`/history` |
| viewport | 1280×900、768×1024、393×900、320×900 |
| theme | light 明示（OS dark）、dark 明示（OS light）、system（OS light）、system（OS dark） |
| 件数 | 6 × 4 × 4 = **96/96 pass** |

全 case で HTTP 200、ページ固有 heading、`h1` 1個、`main` 1個、横 overflow 0、
console error 0、page error 0 を確認した。[`e2e/screens.ts`](../../e2e/screens.ts) の
`clientReady` を共用し、SSR の heading だけで成功とはせず、各画面の hydration 後の要素を待った。
選択した theme の `data-theme`（system では属性なし）を検証した。
この matrix は配置と選択状態の機械検証であり、全画面の画像差分比較ではない。
Service Worker は matrix で無効にし、過去 cache が対象 deployment を置き換えないようにした。
offline の検証結果とは区別する。

再実行する場合は同じ route inventory と正の `clientReady` を用い、公開 alias と exact
deployment を照合してから、上記幅・theme を新規 context で逐次走査する。ログイン画面、
heading だけの SSR、同じ browser context の過去 Service Worker を成功に数えない。

## 事実: keyboard / focus / system theme / offline の操作

system Chrome `152.0.7977.77`、320×852 の新規 context で、
`2026-09-07T19:46:35.441Z`（JST 2026-09-08 04:46:35）から再検証した。
[操作結果 JSON](./evidence/2026-09-08-725/interactions.json) の **5/5 項目が pass**。

| 操作 | 確認した結果 |
|---|---|
| canonical `/sw.js` | 対象の `2074f2cae287` と一致 |
| ロビーの keyboard | Tab で「対局を始める」へ到達し、Enter で `/game` の手牌表示へ遷移 |
| 320px の全体盤面 | Enter で開き、Escape で閉じ、トリガーに focus が復帰。幅・高さは44px基準の既存0.05px測定許容内 |
| 設定 theme | ArrowRight で system→light→dark→system、radio と `data-theme` が一致。OS を dark へ変更し追従表示を確認 |
| `/settings` offline | SW の ready/control 後に offline へ切替・reload。設定 heading、radio、`main` の computed display、横 overflow を確認 |

page error は 0。online 操作中の console error は 0 だが、offline 中は
`Failed to load resource: net::ERR_INTERNET_DISCONNECTED` が1件記録された。
offline 通信失敗を含む生の結果を保持し、全操作の console error が0件とは扱わない。
初回の theme 検査はテスト側の存在しない locator で失敗したため、実在する
`.settings-theme-status` に修正して再検証した。アプリの theme 表示の不具合ではなかった。

代表画像も読み直し、320px の配置、設定の dark 表示、offline のスタイル維持を目視確認した。
画像は全 case の比較画像ではなく、この操作時点の3画面である。

- [対局画面と focus indicator](./evidence/2026-09-08-725/game-320.png)
- [system が OS dark に追従した設定](./evidence/2026-09-08-725/settings-320-dark.png)
- [offline reload 後の設定](./evidence/2026-09-08-725/settings-offline.png)

今回の offline 操作は `/settings` に限る。未訪問の6 route 全体の precache、全 route 固有 CSS、
offline の実打牌と戦績復元、同じページでの OS light への再変更はこの操作結果に含めない。

## 評価: 判断可能な実装案

[ADR-0006](../../documents/adr/0006-preview-production-topology.md) に Option B の具体案を用意した。
Status は **Proposed**。変更前 inventory、stg 独自履歴の保全、docs/CI の対象、認証済み Preview
の合格記録、旧環境の整理順、frontend rollback と環境復元、各担当の決定欄を含む。

現行文書の `feature → main → dev → stg` は Production が先に公開される。
そのため stg の「本番反映前の最終確認」という説明と CI 冒頭コメントの昇格順だけを訂正した。
workflow の trigger/job/権限と、外部環境は変更していない。

## 未確認: #725 の完了に必要なもの

| 項目 | 状態と次の証拠 |
|---|---|
| topology decision | A/B の owner 承認は全 issue comments に未記録。ADR の decision record を埋めてから採用を反映する |
| 認証済み Preview | in-app session は利用不能。保護された実画面の QA 担当と認証済み6画面検証が必要 |
| dev/stg | dev 不在。stg は `e240ceb585ca676147e0b44e79c88fa0c8871cf8` のまま。A なら通常 PR での履歴統合・tree 一致・環境検証、B なら承認された整理と read-back が必要 |
| route 固有受け入れ条件 | この96ケースは #708 北抜/#709 合法順の全局面、#711 の全席対応、保存済み Result/History の全状態を網羅しない。既存 local 回帰と、選択環境の matrix を対応づける必要 |
| rights gate | UI 原本6点とキャラクター原本4点・派生物の権利証拠、または差替と release 判断は未確認 |
| Railway | #653 / #726 の実効 runtime/config read-back は、この frontend 検査では確認していない |
| 担当 | topology 決定、Preview 合格確認、外部変更、rollback/promote の担当が未決定 |

技術 smoke 成功だけで issue を close しない。今回の読取・新規 context 内の UI 検査では、
remote dev/stg、Vercel/GitHub/Railway 設定、共有 `agents.prompt` の変更を行っていない。
証跡取得に追加した Actions は 0 run / 0 runner-min、deployment は 0 件であり、新規課金資源も 0 件。
公開 URL への通常 read request の使用料は取得していないため、外部費用総額を 0 円とは主張しない。

## 関連

- [#725](https://github.com/AutoDevJapan/FourBrosMahjong/issues/725)
- [2026-09-07 までの検証 snapshot](./2026-09-06-725-environment-topology-evidence.md)
- [運用方針](../デプロイ環境運用.md)
- [UI credits](../../documents/assets/ui-refresh/CREDITS.md)
- [character credits](../../documents/assets/characters/CREDITS.md)
