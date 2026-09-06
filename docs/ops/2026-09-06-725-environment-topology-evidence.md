# #725 環境トポロジー判断保留と 6 画面証跡

この文書は、[issue #725](https://github.com/AutoDevJapan/FourBrosMahjong/issues/725) のための、
`origin/main` current-head に対する読み取り専用の証跡である。Option A / B の選択や、
実環境の変更を決定する ADR ではない。owner の承認と認証済み環境の証拠が揃うまで、状態は
**HOLD** とする。

## 監査対象と結論

- この文書は、[PR #1133](https://github.com/AutoDevJapan/FourBrosMahjong/pull/1133)
  merge 後、`2026-09-07T03:52:14+09:00` に読み取り専用 inventory を再確認した
  current-head snapshot である。以前の #1135 merge 後の snapshot は、main の更新により
  obsolete になった。
- GitHub の `main` は保護されている。current-head に対する `CI`、`gitleaks`、`CodeQL` は
  すべて成功している。証跡目的の Actions rerun は行っていない。
- `dev` ref は存在せず、`stg` は `e240ceb585ca676147e0b44e79c88fa0c8871cf8` のままで
  current `main` と異なる。したがって、`main → dev → stg` の昇格と、その exact SHA の
  environment evidence は実行できない。
- owner による Option A / B、決定者、承認日時、rollback 責任者は未記録である。
  `dev` 作成、`stg` 更新、Vercel/GitHub/Railway の設定変更、昇格、再デプロイは行わない。

## current-head の読み取り専用 inventory

| 対象 | 確認結果 |
|---|---|
| GitHub `main` | `df56930b360c0995e44319470707b08e4505106c`（#1133 merge 後） |
| GitHub `dev` | ref が存在しない（GitHub branches API / `git ls-remote`） |
| GitHub `stg` | `e240ceb585ca676147e0b44e79c88fa0c8871cf8`。current `main` と異なる |
| GitHub deployment environments | `Preview` / `Production` / `staging`。API の protection/deployment branch policy は未設定として返った |
| `main` の required checks | `gitleaks`、`lint / typecheck / format / test / build`。PR review の required count は `0` |
| current-head CI | [CI run 34052792031](https://github.com/AutoDevJapan/FourBrosMahjong/actions/runs/34052792031)、[gitleaks run 34052792022](https://github.com/AutoDevJapan/FourBrosMahjong/actions/runs/34052792022)、[CodeQL run 34052791856](https://github.com/AutoDevJapan/FourBrosMahjong/actions/runs/34052791856) はすべて `success` |
| GitHub Production deployment record | deployment `6296644111`、SHA/ref は current-head と一致、status `success`。Vercel bot の target URL は [`four-bros-mahjong-8mmsfwjpb.vercel.app`](https://four-bros-mahjong-8mmsfwjpb.vercel.app) |

GitHub deployment record と公開 alias の到達性は、Vercel の Preview SSO や Railway の
project/service/environment identity を証明しない。deployment ID、target URL、SHA の対応は
GitHub API の読み取り結果として記録している。

## 6 画面の public Production HTTP fallback

in-app Browser はこの実行コンテキストでは利用できず（`agent.browsers.list() = []` / `No browser is available`）、local Chromium
も利用可能な実行ファイルがなかった。SSO を迂回する認証や cookie の取得は行わず、curl による
認証不要の canonical Production alias `https://four-bros-mahjong.vercel.app` への HTTP read-only
確認だけを実施した。取得時刻は `2026-09-07T03:52:14+09:00` である。

各ページについて HTTP status `200` を確認した。Browser がないため、ページ固有の `<h1>`、
単一 `<main>`、横 overflow、console error、page error は current-head の合格証跡として扱わない。

| viewport | 対象 route | 結果 |
|---|---|---|
| HTTP fallback | `/`、`/rules`、`/settings`、`/game?seed=0`、`/game/result`、`/history` | 6/6 status 200 |
| **合計** | **6 route** | **6/6 status 200** |

6 route はすべて HTTP `200` だった。canonical alias の `/sw.js` は
`VERSION = "df56930b360c"` を返し、公開 alias の asset version は current-head の短縮 SHA と
一致した。

これは公開 Production の限定的な技術 smoke であり、次を合格扱いにはしない。

- SSO 保護された Preview、存在しない `dev`、stale な `stg` の画面検査
- desktop / phone viewport、DOM、keyboard、theme、console/page error の Browser 検査
- authenticated operator による Vercel/Railway/GitHub の project・service・environment read-back
- keyboard、theme、PWA/offline、対局操作、UI/キャラクター asset の権利承認
- Railway Production の実効 deployment、healthcheck、`ALLOWED_ORIGINS` の一致

## 未解決の gate と後続手順

| gate | 現状 | 次に必要な証跡 |
|---|---|---|
| topology decision | Option A / B 未選択 | owner の option、決定者、日時、根拠、rollback 責任者を [#725](https://github.com/AutoDevJapan/FourBrosMahjong/issues/725) に記録 |
| Option A の environment | `dev` 不在、`stg` は current-head 外 | 承認後に限り exact SHA/deployment の read-back、認証済み Preview/dev/stg の 6 route matrix、tree 一致を記録 |
| Option B の environment | 新 topology 未定義 | 責務、承認経路、rollback、対象設定を別の reviewed docs/infra PR で定義してから変更 |
| Railway backend | [#980](https://github.com/AutoDevJapan/FourBrosMahjong/issues/980) が [#653](https://github.com/AutoDevJapan/FourBrosMahjong/issues/653) の authorized Railway read-back を要求中 | 既存 resource の project/service/environment、deployment ID/status、full SHA、healthcheck、実効 `ALLOWED_ORIGINS`、sanitized Origin probe を operator が添付 |
| rights gate | UI refresh / character asset の利用・改変・再配布許可は未確認 | 書面許可、または削除・差替の reviewed issue/PR と release 判断者の明示 |

承認前に `dev` / `stg` を作成・更新したり、Preview SSO を解除したり、Railway の deploy・
restart・variable・scale を変更したり、Production を再デプロイしたりしない。#980 の証跡を
この文書へ代用して #653 や #725 の完了を主張しない。

## 参照した証跡

- [#725: current main の環境 topology と 6 画面検証](https://github.com/AutoDevJapan/FourBrosMahjong/issues/725)
- [#970: unknown route request body の drain](https://github.com/AutoDevJapan/FourBrosMahjong/pull/970)
- [#979: Railway production gate evidence の更新](https://github.com/AutoDevJapan/FourBrosMahjong/pull/979)
- [#980: authorized Railway production read-back](https://github.com/AutoDevJapan/FourBrosMahjong/issues/980)
- [`e2e/screens.ts`](../../e2e/screens.ts) — route/heading の共有画面 inventory
- [`e2e/metadata.spec.ts`](../../e2e/metadata.spec.ts) — route/title/canonical の local Playwright 契約
- [`docs/デプロイ環境運用.md`](../デプロイ環境運用.md) — 既存の topology 方針と HOLD 条件
