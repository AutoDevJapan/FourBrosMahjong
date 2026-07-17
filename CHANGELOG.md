# Changelog

このプロジェクトの主要な変更点はすべてこのファイルに記録します。

フォーマットは [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/) に準拠し、
バージョニングは [Semantic Versioning](https://semver.org/lang/ja/) (SemVer) に従います。

## リリース運用方針

- **バージョニング**: SemVer (`MAJOR.MINOR.PATCH`)。破壊的変更で MAJOR、後方互換の機能追加で MINOR、後方互換のバグ修正で PATCH を上げます。1.0.0 到達前 (`0.y.z`) は開発初期段階として、MINOR を機能追加・破壊的変更の両方に用います。
- **コミット規約**: [Conventional Commits](https://www.conventionalcommits.org/ja/v1.0.0/) を採用します (`feat:` / `fix:` / `docs:` / `chore:` / `refactor:` / `test:` / `ci:` など)。破壊的変更は `feat!:` またはフッターに `BREAKING CHANGE:` を記載します。
- **CHANGELOG 反映**: 変更は原則 PR マージ時に、このファイルの `## [Unreleased]` セクションへ Conventional Commits の種別に対応するカテゴリ (Added / Changed / Fixed など) で追記します。
- **リリース手順**:
  1. `## [Unreleased]` の内容を確定し、`## [x.y.z] - YYYY-MM-DD` の新セクションへ繰り上げる。
  2. `package.json` の `version` を同じ値に更新する。
  3. `main` に反映後、`vx.y.z` 形式のタグを push する (例: `git tag v0.1.0 && git push origin v0.1.0`)。
  4. タグ push を契機に `.github/workflows/release.yml` が GitHub Release を自動作成する。
- **デプロイ昇格との整合**: リリースの起点は `v*` タグの push です。Production デプロイ (Vercel) の本番昇格タイミングと矛盾しないよう、本番昇格はタグ付きリリースを基準とします。

## [Unreleased]

### Added

- デプロイ構成の ADR(`documents/adr/0001-deploy-architecture-and-preview-policy.md`)を追加。prd 構成(Vercel フロント + Railway バックエンドは将来配置先)と Vercel Preview 方針を明文化 (#69)。
- カスタムドメイン公開手順(`documents/guides/custom-domain-setup.md`)と `documents/adr/` `documents/guides/` の索引 README を追加 (#69)。

### Changed

- `docs/デプロイ環境運用.md` をインフラ実態に合わせて更新。バックエンド(Railway)の位置づけとカスタムドメイン公開の節を追加し、`config.godd` / `AGENTS.md` のスタック定義と整合 (#69)。

## [0.1.0] - 2026-07-10

初期整備。アプリ本体 (ゲームロジック) は未実装で、開発基盤とドキュメント SSOT を整備した段階です。

### Added

- `create-next-app` による Next.js 15 (App Router) + React 19 + TypeScript の初期スキャフォールド。
- ゲーム仕様の SSOT: `docs/四兄弟麻雀ルール.md` (実世界ルールの要約) と `documents/spec/` (SpecDD 実装仕様)。
- 開発ツール群の導入: Vitest (ユニットテスト)、Playwright (E2E)、Biome (フォーマッタ)、Knip (未使用検出)、dependency-cruiser (依存関係チェック)、TypeDoc (API ドキュメント)。
- CHANGELOG 運用とリリースワークフロー (`.github/workflows/release.yml`) の整備。

### Changed

- パッケージマネージャを pnpm に移行 (`packageManager` で固定、`pnpm-lock.yaml` を採用)。

[Unreleased]: https://github.com/AutoDevJapan/FourBrosMahjong/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/AutoDevJapan/FourBrosMahjong/releases/tag/v0.1.0
