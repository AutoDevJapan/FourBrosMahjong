# ドキュメント一覧

`soshina-majong`(四兄弟麻雀のゲーム化)のドキュメントナビゲーションです。

## ゲーム仕様(SSOT)

- [四兄弟麻雀 ルールまとめ](./四兄弟麻雀ルール.md) — 実装の基準となるゲームルールの単一情報源(SSOT)。
  粗品 Official Channel「ギャンブル四兄弟」麻雀企画の**非公式まとめ**をもとにした関西式三人打ちベースのルール。

## 実装スペック(SpecDD)

- [`documents/spec/`](../documents/spec/README.md) — 確定した仕様を実装可能な粒度に分解したスペック群(卓構成・局進行・点数精算・ドメインモデル)。ルール文書を基準に実装する際の直接の参照先。

## 仕様質問(確定管理)

- [質問リスト](../質問リスト.md)(プロジェクトルート) — ルール文書・スペックだけでは実装を確定できない仕様質問を管理する**唯一の場所**。
  解決済み質問の確定内容は `documents/spec/` と実装へ反映済み。**未解決の質問も存在し得る**ため、最新の解決状況・件数は必ず質問リスト本体の「未回答 / 要確認」節で確認する(この README には転記しない)。新たに確定回答から一意に定まらない論点が生じた場合も質問リストへ追記する。

## Unity表示の実現性

- [Unity版実現性ゲート証跡（2026-09-06）](./Unity版実現性ゲート証跡.md) — repo-local / OSS参照の確認結果、Unity実行前の未達ゲート、条件付きNo-Go判定。

## AI(他家)方策

- [ADR-0002: AI 方策](../documents/adr/0002-ai-policy.md) — 打牌・鳴き・リーチ・カンの方策と判断根拠、定量検証の結果。
  AI 方策は**ゲームルールに由来しない設計判断**のため `documents/spec/` ではなく ADR で管理する(その決定自体も ADR-0002 に記録)。

## 開発ツール運用方針

- [品質ツール運用方針](./品質ツール運用方針.md) — Biome / Knip / dependency-cruiser / TypeDoc の目的・
  役割分担・除外設定の妥当性・実行タイミング(ローカル/pre-commit/CI)。
- [GitHub Actions SHA 固定ポリシー](./GitHub-Actions-SHA固定ポリシー.md) — repository policy の監査証跡、権限境界、外部 Action / reusable workflow の固定ルール。

## デプロイ・環境運用

- [デプロイ環境運用](./デプロイ環境運用.md) — Vercel 連携・PR ごとの Preview 環境・dev/stg/prd の昇格フロー・環境変数管理方針・バックエンド(Railway)とカスタムドメインの位置づけ。
- [ADR(アーキテクチャ決定記録)](../documents/adr/README.md) — [ADR-0001](../documents/adr/0001-deploy-architecture-and-preview-policy.md): prd 構成(Vercel フロント + Railway バックエンド)と Vercel Preview 方針。
- [運用ガイド](../documents/guides/README.md) — [カスタムドメイン公開手順](../documents/guides/custom-domain-setup.md) ほか。

## ディレクトリの役割

| 場所 | 用途 |
|---|---|
| `docs/` | 人間向けのゲームルール・企画ドキュメント(この README が入口) |
| `documents/` | GoDD の仕様SSOT置き場(`documents/spec/`・`documents/adr/`・`documents/guides/`。`config.godd` の `docs_dir`) |
| `docs/api/` | TypeDoc 生成の API リファレンス(`pnpm docs`、gitignore 済み) |

> 注: `documents/spec/`(スペック)・`documents/adr/`(アーキテクチャ決定)・`documents/guides/`(運用手順)を整備済みです。
