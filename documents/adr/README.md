# ADR(Architecture Decision Record)

アーキテクチャ・技術選定に関する意思決定を記録します。各 ADR は「決定に至った背景・検討した選択肢・決定・結果(トレードオフ)」を残し、将来の読み手が同じ結論に到達できるようにするための文書です。

`config.godd` の `docs_dir: documents` に従い、ADR は `documents/adr/` 配下に置きます。

## 一覧

| # | タイトル | ステータス | 日付 |
|---|---|---|---|
| [0001](./0001-deploy-architecture-and-preview-policy.md) | prd デプロイ構成(Vercel フロントエンド + Railway バックエンド)と Vercel Preview 方針 | Accepted | 2026-07-17 |
| [0002](./0002-ai-policy.md) | AI(他家)方策の管理場所と現行方策(打牌・鳴き・リーチ・カン) | Accepted | 2026-07-21 |
| [0003](./0003-engine-state-ownership.md) | engine 公開アクションの state 所有権契約(入力は使い捨て) | Accepted | 2026-08-03 |
| [0004](./0004-history-exclusion-policy.md) | 戦績の排他制御方針(追記は fail-closed、全件削除は「排他APIが無い環境だけ」fail-open) | Accepted | 2026-08-06 |

## 運用方針

- 番号は 4 桁の連番(`0001`、`0002`、…)。ファイル名は `NNNN-<kebab-case-title>.md`。
- 1 つの決定 = 1 ファイル。決定を覆す場合は新しい ADR を作成し、旧 ADR のステータスを `Superseded by ADR-NNNN` に更新する(旧 ADR は削除しない — 意思決定の履歴を残す)。
- ステータスは `Proposed` / `Accepted` / `Deprecated` / `Superseded by ADR-NNNN` のいずれか。
- 運用ガイド(手順書)は ADR ではなく [`documents/guides/`](../guides/README.md) に置く。ADR は「なぜそう決めたか」、guides は「どう実施するか」を担当する。
