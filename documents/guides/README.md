# Guides(運用ガイド)

セットアップ・デプロイ・運用の**手順書**を置きます。「なぜそう決めたか」の意思決定は [`documents/adr/`](../adr/README.md) が担当し、guides は「どう実施するか」を担当します。

`config.godd` の `docs_dir: documents` に従い、ガイドは `documents/guides/` 配下に置きます。

## 一覧

| ファイル | 範囲 |
|---|---|
| [custom-domain-setup.md](./custom-domain-setup.md) | Vercel prd へのカスタムドメイン公開(DNS 設定・環境紐付け・検証)手順 |

## 関連

- [`docs/デプロイ環境運用.md`](../../docs/デプロイ環境運用.md) — Vercel 連携・dev/stg/prd 環境定義・昇格フロー
- [`documents/adr/`](../adr/README.md) — デプロイ構成などのアーキテクチャ決定
