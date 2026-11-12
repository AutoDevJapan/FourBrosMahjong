# Guides(運用ガイド)

セットアップ・デプロイ・運用の**手順書**を置きます。「なぜそう決めたか」の意思決定は [`documents/adr/`](../adr/README.md) が担当し、guides は「どう実施するか」を担当します。

`config.godd` の `docs_dir: documents` に従い、ガイドは `documents/guides/` 配下に置きます。

## 一覧

| ファイル | 範囲 |
|---|---|
| [custom-domain-setup.md](./custom-domain-setup.md) | Vercel prd へのカスタムドメイン公開(DNS 設定・環境紐付け・検証)手順 |
| [railway-online-deploy-runbook.md](./railway-online-deploy-runbook.md) | Railway オンラインサーバーの production deploy、Origin boundary probe、証跡、rollback 手順 |
| [railway-production-readback.md](./railway-production-readback.md) | #980 の Railway Production identity/config/probe read-back を offline で fail-closed 検証する手順 |
| [railway-iac-migration.md](./railway-iac-migration.md) | named partialの対象限定移行候補、SDK/CLI差、native pinned plan、parityとruntime変更の分離 |
| [release-tag-protection-runbook.md](./release-tag-protection-runbook.md) | `v*` Release tag の担当ロール・GitHub Ruleset・拒否検証・break-glass・新 version rollback 手順 |
| [unity-display-feasibility.md](./unity-display-feasibility.md) | Unity版の表示専用契約、固定ローテーションfixture、実行前のGo/No-Go境界 |
| [unity-display-reference.md](./unity-display-reference.md) | #828のUnity導入前ブラウザ・リファレンスと確認手順 |
| [unity-display-text-spike.md](./unity-display-text-spike.md) | #818の表示契約スライス、検証マトリクス、未凍結のUnity境界 |
| [3d-characters.md](./3d-characters.md) | 四兄弟のモデル・リグ・clip・派生texture・再供給と比較手順 |

## 関連

- [`docs/デプロイ環境運用.md`](../../docs/デプロイ環境運用.md) — 既存PrdだけへのVercel/Railway配布、localhost・CI検証、配備と受入の記録
- [`documents/adr/`](../adr/README.md) — デプロイ構成などのアーキテクチャ決定
