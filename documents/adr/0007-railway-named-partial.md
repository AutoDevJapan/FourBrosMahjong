# ADR-0007: 共有Railway環境では対象サービスのnamed partialを使う

## Status

Accepted — 2026-11-09。既存Productionの移行候補の設計判断。外部apply・再配備の完了記録ではない。

## Context

[Issue #742](https://github.com/AutoDevJapan/FourBrosMahjong/issues/742)のRailway projectは複数repositoryで共有される。
全projectの資源をこのrepositoryへ取り込むと所有範囲が広がり、省略削除や他担当との競合を招く。
現在の[公式仕様](https://docs.railway.com/infrastructure-as-code#multi-repo-projects)はnamed partialによる各repositoryの部分所有をサポートしている。

## Decision

`partial = "four-bros-mahjong-online"`を固定し、同名serviceの既存resourceだけを宣言する。
対象ID、address、ownership、inventory、source bytes/tree、native pinned planをexact照合する。
省略した未所有・別partialの資源を保持し、同じpartialが対象外資源を所有する場合は削除候補になる前に拒否する。
変数は`variables:{managed:false}`とし、秘密の復号・値の取込を行わない。

SDK 3.16.0のdeclarationに欠けるproject変数方針はliteralのlocal definitionで保持する。
型チェックと実SDKの戻り値に加え、CLI 5.71.0 native planの`variablePolicy.managed:false`を別に確認する。
型assertだけでruntime互換性や実効parityを証明したことにしない。

ownership parityとdesired runtime更新は別phaseで検証する。
候補のpassは外部apply・稼働image・room/load・readinessの完了を意味しない。
既存の単一担当、Prd限定、費用条件とroom消失に関する本人判断を維持する。

## Consequences

旧full-project schemaVersion 1とimmutable `/healthz` fixtureを履歴・回帰検証として保持する。
現在の候補はschemaVersion 2を使い、source/CLI/etag/ownershipが変わればfresh evidenceを取得する。
副作用を持たない検証器と、load/drain条件を満たして操作する担当の責任を分ける。
詳細な実行・rollback手順は[移行ガイド](../guides/railway-iac-migration.md)に記録する。
