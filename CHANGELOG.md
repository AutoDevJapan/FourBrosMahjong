# Changelog

このプロジェクトの主要な変更点はすべてこのファイルに記録します。

フォーマットは [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/) に準拠し、
バージョニングは [Semantic Versioning](https://semver.org/lang/ja/) (SemVer) に従います。

## リリース運用方針

- **バージョニング**: SemVer (`MAJOR.MINOR.PATCH`)。破壊的変更で MAJOR、後方互換の機能追加で MINOR、後方互換のバグ修正で PATCH を上げます。1.0.0 到達前 (`0.y.z`) は開発初期段階として、MINOR を機能追加・破壊的変更の両方に用います。Release tag は `vMAJOR.MINOR.PATCH` または prerelease 識別子付きの `vMAJOR.MINOR.PATCH-IDENTIFIER` のみを許可し、先頭ゼロや build metadata (`+...`) は受け付けません。
- **コミット規約**: [Conventional Commits](https://www.conventionalcommits.org/ja/v1.0.0/) を採用します (`feat:` / `fix:` / `docs:` / `chore:` / `refactor:` / `test:` / `ci:` など)。破壊的変更は `feat!:` またはフッターに `BREAKING CHANGE:` を記載します。
- **CHANGELOG 反映**: 変更は原則 PR マージ時に、このファイルの `## [Unreleased]` セクションへ Conventional Commits の種別に対応するカテゴリ (Added / Changed / Fixed など) で追記します。
- **リリース手順**:
  1. `## [Unreleased]` の内容を確定し、`## [x.y.z] - YYYY-MM-DD` の新セクションへ繰り上げる。
  2. `package.json` の `version` を同じ値に更新する。
  3. `main` に反映し、その commit に対する `main` push の CI・gitleaks・CodeQL 成功を確認してから、同じ commit へ `vx.y.z` 形式のタグを push する (例: `git tag v0.1.0 && git push origin v0.1.0`)。いずれかの検証完了前に tag を push すると guard は公開を拒否する。その場合は全検証完了後に、同じ immutable tag の失敗した Release workflow だけを再実行し、tag の削除・付け替え・再 push は行わない。
  4. タグ push を契機に `.github/workflows/release.yml` が、tag/package/CHANGELOG の一致、tag commit の `main` ancestry、その SHA に対する信頼済み CI・gitleaks・CodeQL 成功を確認してから GitHub Release を自動作成する。API 不全や証拠不足を含め、確認できない場合は公開しない。
- **デプロイとの境界**: Production の昇格は Vercel Git Integration による **`main` マージ時の自動デプロイ**が SSOT です。GitHub Release は、その後に同じ検証済み commit へ付ける配布記録であり、Production デプロイを開始・ゲートするものではありません。詳細は [`docs/デプロイ環境運用.md`](./docs/デプロイ環境運用.md) を参照してください。

## [Unreleased]

### Added

- 自家のフリテン状態を、捨て牌・同巡内・リーチ後の理由と `禁` アイコンを併記して盤面に表示。鳴かれて当たり牌が河から消えた場合も打牌履歴を基に表示を維持 (#408)。
- デプロイ構成の ADR(`documents/adr/0001-deploy-architecture-and-preview-policy.md`)を追加。prd 構成(Vercel フロント + Railway バックエンドは将来配置先)と Vercel Preview 方針を明文化 (#69)。
- カスタムドメイン公開手順(`documents/guides/custom-domain-setup.md`)と `documents/adr/` `documents/guides/` の索引 README を追加 (#69)。

### Changed

- `v*` tag作成認可 ruleset A を、承認済み Release Operators Team IDと完全一致する creation-only契約として、既存の不変性ruleset Bから分離してfail-closed監査できるvalidatorを追加 (#508)。
- GitHub Release guard が新規 `v*` tag push のイベントだけを受け付け、既存 tag の再 push/付け替えイベントを公開処理へ進めないよう fail-closed にした。外部の immutable-tag ruleset (#508) を補完する防御層であり、ruleset の代替や設定変更は行わない。
- `v*` Release tag 保護の担当ロール、ruleset 設定、正常/拒否検証、break-glass、tag を改変しない新 version rollback の runbook を追加。不変性 ruleset `protect-existing-release-tags` (ID `20858931`) は適用済みだが、担当 Team と作成認可 ruleset は未決定・未適用であることも明記 (#508)。
- `v*` Release tag の repository ruleset を、GET のみで対象選択から詳細 validator まで再現監査する helper と fail-closed 回帰テストを追加。作成認可 ruleset や担当 Team の外部設定は変更していない (#508)。
- `docs/デプロイ環境運用.md` をインフラ実態に合わせて更新。バックエンド(Railway)の位置づけとカスタムドメイン公開の節を追加し、`config.godd` / `AGENTS.md` のスタック定義と整合 (#69)。

### Fixed

- 対局中の `sessionStorage` ジャーナル保存失敗を握りつぶさず、メモリ内の最新ジャーナルを保持して保存状態を対局画面へ通知し、Storage復旧後の次の操作で再保存するよう修正 (#872)。`localStorage` の戦績保存状態とは別に扱う。
- GitHub Releaseの`contents: write` jobからcheckoutとrepository管理shellを撤去し、read-only検証jobが生成した同一run・固定名のrelease notes artifactだけをSHA固定Actionで受け渡すよう修正 (#747)。
- 別タブのtheme変更がhydration前に発生しても、storage listenerを先に登録してから現在値へ再同期し、保存値・radio・`html[data-theme]`を収束させるよう修正 (#752)。
- GitHub Release guard を、tagged SHA の CI だけでなく gitleaks と GitHub default CodeQL の exact workflow/check suite・期待 category 成功も確認する fail-closed gate へ拡張。これは GitHub Release 公開だけの gate で、`main` merge を起点とする Vercel Production deploy は待機・再実行しない (#748)。
- Service Worker の install 時に、牌 SVG・PWA icon・manifest の HTTP 2xx だけでなく Content-Type も検証し、200 HTML fallback 等を必須オフライン素材として保存した不完全な worker の有効化を防止。
- GitHub Release の公開前に、厳密な SemVer、package/CHANGELOG、`main` ancestry、tagged SHA の信頼済み CI 成功を fail-closed で照合する guard を追加。Production は従来どおり `main` マージ時の Vercel 自動デプロイを SSOT とし、tag ruleset はリポジトリ外の権限変更になるため別途合意事項として文書化 (#507)。
- 対局者名の12文字上限を書記素クラスタ(grapheme cluster)単位へ統一し、絵文字・結合文字をUTF-16境界で分断せず設定・再読込・盤面表示できるよう修正 (#484)。修正前に保存された半端なサロゲート入りの名前は、対局ジャーナルの読み込み時に U+FFFD へ正規化して受け入れる(進行中の半荘を失わせない)。
- 赤ドラ翻の判定を牌種(5筒・5索)込みへ修正。`createTile` を経由しない構造的入力が仕様外の `isRed` を持っても、得点(`countDoraHan`)と表示が同じ述語 `isRedDora` で一致するようにした。赤5判定の重複を検出する回帰スキャンの範囲も表示層まで拡張 (#485)。

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
