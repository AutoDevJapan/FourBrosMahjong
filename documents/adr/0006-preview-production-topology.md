# ADR-0006: PR Preview と main Production への環境構成整理案

## Status

Proposed

本 ADR は [issue #725](https://github.com/AutoDevJapan/FourBrosMahjong/issues/725) の
**Option B のレビュー用提案**であり、採用・外部変更の承認ではない。
owner の決定記録を得るまで、[ADR-0001](./0001-deploy-architecture-and-preview-policy.md)
の Accepted 状態、CI trigger、remote ref、Vercel/GitHub 設定、共有 `agents.prompt` は変更しない。
この Proposed 文書の merge だけで Option B を採用したとは扱わない。

## Date

2026-09-08

## Context: 確認できた事実

2026-09-08 の GitHub API / `git ls-remote` による読取結果は次のとおり。
この snapshot を将来の変更対象へそのまま使わず、実行直前に再取得する。

| 対象 | 読取結果 |
|---|---|
| `main` | `2074f2cae28745907396c957a21c63b944dd8b3a` |
| GitHub Production deployment | `6314661426`、上記 SHA と一致、status `success`、[deployment URL](https://four-bros-mahjong-qb3hzvz9c.vercel.app) |
| `dev` | 不在 |
| `stg` | `e240ceb585ca676147e0b44e79c88fa0c8871cf8`。`stg...main` は stg 側 13 / main 側 530 unique commits |
| GitHub environments | `Preview` / `Production` / `staging`。protection rules は空、deployment branch policy は null |
| `main` protection | strict required checks は `gitleaks` と `lint / typecheck / format / test / build`。enforce admins 有効、required approving review count は 0 |

既存の目標フローは `feature → main → dev → stg` である。`main` merge が Production
自動公開を起こすため、後続の dev/stg は本番前の判定にはならない。一方、運用表は stg を
「本番反映前の最終確認」と説明しており、公開順と役割に矛盾があった。

認証された Preview の QA 担当、環境整理の実行者、rollback 担当は未決定である。
公開 Production の技術検査は、Preview のアクセス権、画像利用権、Railway runtime の一致を
証明しない。これらを別の未完項目として扱う。

## Options considered: 評価と推奨

| 項目 | A: dev/stg を維持 | B: PR Preview → main Production（提案） |
|---|---|---|
| 実際の役割 | 現行順のままなら Production 後の snapshot 回帰確認 | PR ごとの変更を Preview で確認してから Production へ反映 |
| 必要な復旧・整理 | dev 作成、stg の独自履歴を通常 PR で扱い、各 deployment を照合 | docs/CI の切替、stg の独自履歴の保全、承認された旧環境の整理 |
| 定常作業 | main→dev、dev→stg の PR・build・smoke を追加 | 通常 PR の Preview と merge 後の Production を照合 |
| 残る制約 | 本番前の staging が必要なら `feature → dev → stg → main` を別途設計 | 固定 staging URL はなくなる。Preview QA の担当・認証が必須 |
| 判断上の注意 | stg の 13 unique commits を消さず、着地 tree が承認済み snapshot と一致する必要 | Preview と Production は異なる build。merge SHA と Production の検証を省略できない |

**技術的には B を推奨する。** 既存の main Production と PR Preview を活かせるため、
陳腐化した環境を公開後に追随させる作業を減らし、QA を main merge 前に置ける。
これは実態と必要作業からの評価であり、owner の選択を代行するものではない。
A を選択した場合、本 ADR は Accepted にせず、A の役割・履歴統合・検証担当を決定記録へ残す。

## Proposed decision: B を採用する場合の責務

| 対象 | 責務 | 合格証拠 |
|---|---|---|
| local | 実装と関連範囲の自動検証。外部サービスは既存の stub / offline test を利用 | 対象差分と実行結果 |
| PR Preview | reviewer が exact PR head の UI を確認する main merge 前の QA | full SHA、Vercel deployment ID/URL、認証済み 6 route matrix、担当者の確認 |
| main Production | reviewed merge commit の公開と公開後 smoke | merge full SHA、成功 CI、Production deployment ID/URL、canonical alias の SW version と 6 route 検証 |
| Railway Production | オンライン対戦の既存 backend。frontend の merge と切り離した運用 | #653 / #726 の authorized deployment/config read-back と rollout 証拠 |

Vercel の Production branch は `main`、PR comments と Preview 保護は維持する。
本案は frontend の環境構成に限定し、Railway の設定・再起動・deploy、環境変数、
main の required checks を変更しない。GitHub の review count 0 は機械的な QA gate が
設定済みであることを意味しないため、担当 reviewer の Preview 合格記録を merge 前に照合する。
review count / GitHub environment protection を変更する場合は、対象設定を追加で明示する。

## Implementation boundary: 承認後に行う具体的変更

1. **変更前記録**: 下記の decision record を埋める。認証済み operator が既存の Vercel
   project/team、Production branch、PR comments、Preview 保護、custom `staging` の ID・
   branch tracking、GitHub `staging` の ID・保護設定、remote stg の full SHA を再取得する。
   secrets の値は出力せず、復元に必要な設定はアクセス制限された証跡へ保存する。
   stg の unique commits は、全 commit を含む検証済み git bundle 等へ保全し、保存先と
   読み戻し結果を記録する。古い snapshot との不一致は削除前に解決する。
2. **reviewed docs/infra PR**: ADR-0001 の「3 環境との併用」部分だけを本 ADR で supersede
   し、配置先と Preview 有効の決定は継続する。`docs/デプロイ環境運用.md`、README、
   `docs/品質ツール運用方針.md`、owner が管理する共有 `agents.prompt` の昇格手順を整合させる。
   `.github/workflows/ci.yml` の対象を main に揃え、
   `.github/scripts/verification-scope.mjs` の dev/stg 昇格特例と
   `src/test/ci-workflow.test.ts` の対応 fixture/test を整理する。
   証拠不足で全検証を走らせる動作、main の required checks、main のみへの cache 保存、
   concurrency / duplicate-skip は維持する。全 PR の gitleaks を維持する。
3. **merge 前 QA**: CI と exact PR head の認証済み Preview を確認する。ログイン画面の
   HTTP 200 は UI 成功と扱わない。6 route × desktop/tablet/320–393px × light/dark/system、
   keyboard/focus/44px、横 overflow、console/page error、PWA/offline、route CSS、
   #708/#709/#711 と Result/History の必要な状態を issue matrix に沿って記録する。
   finding は修正または追跡 Issue へ結び、release 判断者が未完条件を確認する。
4. **merge 後確認**: この実装 PR による通常の Production 自動 deployment を 1 回だけ使う。
   exact merge SHA/deployment と公開 alias を照合する。Preview は別 build のため、
   Production smoke も確認する。証跡目的の rerun / `vercel --prod` は行わない。
5. **旧環境の整理**: 事前承認された対象 ID と直前 read-back が一致した場合だけ、既存の
   Vercel custom `staging`、GitHub `staging` environment、remote `stg` を担当者が整理する。
   branch を先に削除して復元可能性を失わない。履歴と設定の保存確認後に ref を最後に削除する。
   `dev` が新たに存在した場合はその ref を暗黙に削除せず、対象と保全を確認する。
6. **read-back と完了**: Production=`main`、PR Preview と保護が継続、承認対象の旧環境/ref
   が不存在であることを再取得する。削除や設定変更の一部失敗は partial と記録し、
   docs だけを実環境変更済みにしない。CI run/deployment の件数と使用時間を記録する。

上記は採用後の実装計画であり、この提案作成時点では実行していない。

## Rollback

frontend 障害の rollback と、環境構成の取り消しを分けて扱う。

- **frontend**: 指名された担当が、過去に Production domain へ割り当てた復元可能な
  deployment の SHA、ドメイン、当時の環境設定を照合し、Vercel Instant Rollback を行う。
  利用プランにより選べる deployment は異なるため、その場の eligible 一覧を使う。
  原因修正または revert の reviewed PR を作成し、正常 deployment を検証して promote する。
  Instant Rollback 後は Production domain の自動割当が停止するため、main push だけで
  復旧完了とせず、promote 後の割当再開と canonical alias を read-back する。
  [Vercel Instant Rollback](https://vercel.com/docs/instant-rollback)
- **環境構成**: docs/CI は通常の revert PR で戻す。削除済み stg ref と環境は、保存した
  full SHA と branch mapping を使って指名された担当が復元する。再作成時に provider ID が
  変わる可能性があるため新旧対応を記録する。既存 ref があれば force-push/reset で上書きせず、
  差分を確認する。branch tracking 復元で build が発生した場合も実行記録へ含める。
- Railway の room・runtime・設定、画像利用権は frontend rollback で復元・承認されない。

## Decision record: 未確認

| 決定項目 | 記録 |
|---|---|
| 採用 Option A / B、決定者、日時、理由 | 未決定 |
| 共有 `agents.prompt` の改定担当・合意 | 未決定 |
| 認証済み Preview QA 担当 / merge 合格確認者 | 未決定 |
| 旧環境整理の対象 ID・実行者・履歴/設定保存先 | 未決定 |
| 実装 PR に伴う通常 Production deployment | owner 決定記録待ち |
| frontend rollback / promote 担当 | 未決定 |
| 環境復元担当 | 未決定 |
| UI/character の rights evidence / release 判断者 | #725 の未完項目として継続 |

## References

- [#725 decision material](https://github.com/AutoDevJapan/FourBrosMahjong/issues/725#issuecomment-5444867470)
- [ADR-0001](./0001-deploy-architecture-and-preview-policy.md)
- [2026-09-08 acceptance evidence](../../docs/ops/2026-09-08-725-acceptance-evidence.md)
- [Vercel Git deployment](https://vercel.com/docs/git)
- [Vercel Authentication](https://vercel.com/docs/deployment-protection/methods-to-protect-deployments/vercel-authentication)

Vercel の一般仕様は上記公式文書を 2026-09-08 に確認した。一般仕様の確認を、本 project の
認証済み設定 read-back の代わりにはしない。
