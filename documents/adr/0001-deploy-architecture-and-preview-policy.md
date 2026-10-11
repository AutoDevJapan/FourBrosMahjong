# ADR-0001: prd デプロイ構成(Vercel フロントエンド + Railway バックエンド)と Vercel Preview 方針

## Status

Partially superseded by [ADR-0006](./0006-prd-only-deployment.md) (2026-10-11). Preview/dev/stgの方針は廃止。Vercelフロントと既存Railwayバックエンドの配置先は維持する。

## Date

2026-07-17

## Current status

この ADR は 2026-07-17 時点の配置先決定を記録する。以後、オンライン対戦の実装として
`server/index.ts`・`railway.json`・[ADR-0005](./0005-online-multiplayer-transport.md) が追加されたため、
「バックエンドがまだ存在しない」「Railway の疎通がない」という記述は当時の確認結果として読む。
現在の Railway への反映状態、`ALLOWED_ORIGINS`、デプロイ commit の証跡は本 ADR の決定事項ではなく、
運用 issue [#653](https://github.com/AutoDevJapan/FourBrosMahjong/issues/653) で追跡する。

## Context

[issue #69](https://github.com/AutoDevJapan/FourBrosMahjong/issues/69) で、デプロイ運用ドキュメントとインフラ実態・意図の間に複数の乖離が指摘された。

- `config.godd`(`infra: [docker, terraform, vercel, github-actions, railway]`)と `AGENTS.md` のスタックスナップショットには **Railway** が含まれるが、`docs/デプロイ環境運用.md` は **Vercel のみ**を記述しており、Railway(バックエンド/prd 疎通)の位置づけが未定義。
- 本番公開先の構成(カスタムドメイン・DNS)が未文書化。
- PR ごとの Vercel Preview を用いる前提で運用しているが、その方針が意思決定として明文化されていない。

2026-07-17 時点のアプリは **Next.js(App Router)フロントエンドのみ**で、サーバーサイドの永続状態を持つバックエンド(API/DB)はまだ存在しなかった。ゲームロジックはクライアント内で完結していた。一方でプロジェクト方針として「フロントは Vercel、バックエンドは Railway、決済は Stripe」を掲げており、将来バックエンドが必要になった時点の配置先を先に確定させる必要があった。

判断を先送りにすると、バックエンド着手時に配置先・環境変数境界・CORS/接続方針をゼロから設計し直すことになり、`config.godd` のスタック定義とドキュメントの乖離も温存される。

### 確認したインフラ実態(読み取り専用、2026-07-17 時点)

Vercel CLI(`vercel project ls` / `project inspect` / `domains ls` / `alias ls`)および GitHub Deployments API で確認した。

- Vercel プロジェクト `four-bros-mahjong`(team: `masashi-matsumotos-projects-c5830f3d`、Framework Preset: Next.js、Node.js 24.x)が稼働。Production URL は `four-bros-mahjong.vercel.app`。
- GitHub Deployments の environment 内訳は `Production` / `Preview` / `staging` の 3 種。Preview デプロイが多数生成されており、PR ごとの Preview は**実運用中**。
- `four-bros-mahjong` に紐づく**カスタムドメインは未割当**(`*.vercel.app` のみ)。team は他プロジェクト用に独自ドメインを保有するが、本プロジェクト向けの割当はまだない。
- **Railway 側のリソースは本リポジトリからは確認できない**(リポジトリに Railway 設定ファイルは無く、Railway CLI は未認証)。現時点で Railway 上に本プロジェクトのサービスは疎通していないと判断する。

## Decision（2026-07-17当時の決定）

以下を決定する。

1. **フロントエンド(現行アプリ全体)の prd は Vercel を継続利用する。** `main` ブランチへのマージで Production へ自動デプロイする既存構成を正式な prd とする。
2. **バックエンドの prd 配置先は Railway とする。** 決定時点ではバックエンドが存在しなかったため、Railway 上のリソースを作成せず、「将来配置先 = Railway」を確定事項として記録するに留めた(新たな課金要因を増やさない判断)。その後のオンライン対戦実装と Railway への反映確認は [ADR-0005](./0005-online-multiplayer-transport.md) および [#653](https://github.com/AutoDevJapan/FourBrosMahjong/issues/653) を参照する。
3. **Vercel Preview(PR ごとの Preview デプロイ + PR コメント)を正式に有効とする。** レビュー時に実際にデプロイされた URL で動作確認できる利点を採用し、`dev` / `stg` / `main` の 3 環境モデルと併用する。
4. **カスタムドメインの公開手順を `documents/guides/` に整備する**(具体的なドメイン名の確定と DNS 設定は本 ADR のスコープ外。手順の準備のみ)。

この決定により、`config.godd` / `AGENTS.md` の `infra` に含まれる `vercel` と `railway` の役割分担が明確になる(vercel = フロントエンド prd + Preview、railway = 将来のバックエンド prd)。

## Options Considered

### Option A: フロント=Vercel / バックエンド=Railway(将来)、Preview 有効(採用)

- **Approach**: 決定当時の Vercel フロント構成を prd として固定し、バックエンドの配置先を Railway にする。Preview は継続有効。
- **Pros**: 既存の稼働実態・`config.godd` のスタック定義の双方と一致する。今すぐの追加コストなし。バックエンド配置先を先に確定でき、着手時の手戻りがない。
- **Cons**: Railway の具体手順は将来 issue に依存し、本 ADR だけでは prd バックエンドの疎通は完結しない。
- **Risk**: 低。将来の Railway 具体化時に接続方針(CORS・環境変数境界)の追加設計が必要。

### Option B: フロント・バックエンドとも Vercel に集約(Railway を採用しない)

- **Approach**: バックエンドも Vercel の Serverless/Edge Functions で実装し、Railway を `config.godd` から外す。
- **Pros**: 単一プラットフォームで運用が単純。
- **Cons**: プロジェクト方針(バックエンド=Railway、決済=Stripe)と矛盾する。永続接続・常駐プロセス・長時間ジョブなど Serverless が不得手な要件が出た場合に再移行コストが生じる。`config.godd` / `AGENTS.md` の変更も必要。
- **Risk**: 中。方針転換の合意が別途必要で、本 issue の範囲(実態との整合)を超える。

### Option C: 今すぐ Railway に prd バックエンドを立てる

- **Approach**: バックエンドが未実装の段階で Railway プロジェクトを作成し疎通を確保する。
- **Pros**: prd 疎通手順を今すぐ実地検証できる。
- **Cons**: 動かすバックエンドコードが無いため、空のサービスに対する課金・運用が発生する。「新たな課金要因を増やさない」方針に反する。
- **Risk**: 中。無駄なリソース・コストと、実装確定前の構成が陳腐化するリスク。

## Rationale（2026-07-17当時の理由）

Option A を採用する。理由は次の通り。

- 現行の稼働実態(Vercel フロント + Preview 有効)および `config.godd` / `AGENTS.md` のスタック定義(`vercel` + `railway`)の**双方に一致**する唯一の選択肢であり、ドキュメントとインフラの乖離を最小の変更で解消できる。
- Option C は「新たな課金要因を増やさない」方針に反し、動かすコードが無い段階での Railway 疎通は無駄が大きい。よって「配置先の決定」と「実際の疎通」を分離し、前者のみ本 ADR で確定する。
- Option B は方針(バックエンド=Railway)そのものの変更であり、本 issue のスコープ(実態との整合)を超える。方針を変えるなら別途 ADR で扱うべき。

## Consequences

- **Positive**: デプロイ構成の意思決定が `documents/` 配下に残り、`config.godd` の `infra` 定義と整合する。バックエンド着手時に配置先の再検討が不要。
- **Negative**: 決定時点では prd バックエンド(Railway)の**実疎通は将来 issue に残った**。現在の実装・デプロイ状態は本 ADR の決定からは導出せず、[ADR-0005](./0005-online-multiplayer-transport.md) と [#653](https://github.com/AutoDevJapan/FourBrosMahjong/issues/653) で確認する。
- **Neutral**: カスタムドメインは手順のみ整備し、実際のドメイン確定・DNS 設定・SSL 発行は運用担当の手作業として残る([`documents/guides/custom-domain-setup.md`](../guides/custom-domain-setup.md) 参照)。

## Rollback Plan

- **Effort to reverse**: Low(ドキュメント上の決定であり、稼働中リソースの破壊的変更を伴わない)。
- **Steps**: バックエンド配置先を Railway 以外に変更する場合、本 ADR のステータスを `Superseded by ADR-NNNN` に更新し、新 ADR で新配置先を決定する。あわせて `config.godd` / `AGENTS.md` の `infra` から `railway` を除外する。
- **Point of no return**: Railway 上に本番データを持つバックエンドを実疎通させた後は、移行にデータ移送が伴うため反転コストが上がる。それまでは低コストで反転可能。

## Related

- [issue #69](https://github.com/AutoDevJapan/FourBrosMahjong/issues/69) — 本 ADR の起票元
- [`docs/デプロイ環境運用.md`](../../docs/デプロイ環境運用.md) — Vercel 連携・環境定義・昇格フローの運用文書
- [`documents/guides/custom-domain-setup.md`](../guides/custom-domain-setup.md) — カスタムドメイン公開手順
- `config.godd`(`infra`)/ `AGENTS.md`(スタックスナップショット)
