# 四兄弟麻雀 (Four Brothers Mahjong)

粗品 Official Channel「ギャンブル四兄弟」の麻雀企画をベースにした、関西式三人打ち(サンマ)麻雀のデジタル実装プロジェクトです。オールレッド5・北抜きドラ「ガリ」・サイコロ連動のドラ枚数・4人による着席ローテーション・「ソシー」精算など、番組独自のルールを再現します。

> **プロジェクトの現状**: `create-next-app` の足場のみが揃った段階で、ゲームロジックの実装はこれから着手します。`src/app/` は現時点でデフォルトテンプレートのままです。

## 技術スタック

- [Next.js 16](https://nextjs.org)(App Router)+ [React 19](https://react.dev) + TypeScript(`strict`)
- [Tailwind CSS v4](https://tailwindcss.com) — `@import "tailwindcss"` と `src/app/globals.css` の `@theme` ブロックで設定(`tailwind.config.*` は無し)
- ビルド/開発は [Turbopack](https://nextjs.org/docs/app/api-reference/turbopack)

## セットアップ

パッケージマネージャは **pnpm 固定**です。npm / yarn は使用しません(`package-lock.json` は存在せず、`pnpm-lock.yaml` のみをコミットします)。

```bash
corepack enable    # package.json の packageManager からpnpmバージョンを自動取得(任意)
pnpm install
pnpm dev            # http://localhost:3000 で開発サーバ起動(Turbopack)
```

Node.js のバージョンは [`.nvmrc`](./.nvmrc) に固定し、`package.json` の `engines` でも強制しています。

## コマンド一覧

```bash
pnpm dev            # 開発サーバ(Turbopack) — http://localhost:3000
pnpm build          # 本番ビルド
pnpm start          # 本番ビルドの起動
pnpm lint           # ESLint(eslint.config.mjs, next/core-web-vitals + next/typescript)
pnpm typecheck      # tsc --noEmit

pnpm test           # Vitest(ユニット) — src/**/*.{test,spec}.{ts,tsx}
pnpm test:watch     # Vitest ウォッチモード
pnpm test:coverage  # Vitest + v8 カバレッジ
pnpm test:e2e       # Playwright E2E — ./e2e 配下(初回のみ `pnpm exec playwright install` が必要。詳細は後述の「E2E テスト」参照)
pnpm test:e2e:ui    # Playwright UI モード(テストの選択実行・トレース確認向け)

pnpm format         # Biome: フォーマット適用
pnpm format:check   # Biome: フォーマットチェックのみ
pnpm check          # Biome: check(format + assist)
pnpm knip           # 未使用ファイル/エクスポート/依存の検出
pnpm depcruise      # dependency-cruiser による依存関係ルールチェック(src配下)
pnpm docs           # TypeDoc → docs/api(gitignore対象)
```

単体の Vitest ファイルのみ実行する場合: `pnpm exec vitest run src/foo.test.ts`(`-t "name"` で特定テストのみ実行)。

## ディレクトリ構成

```
src/app/          Next.js App Router のルーティング(現状は create-next-app のデフォルトテンプレート)
docs/             ゲームルール・ドキュメントの入口(人間向け)
documents/spec/   実装スペック(SpecDD SSOT) — GoDD の docs_dir
質問リスト.md      未確定の仕様に関する質問リスト(実装前にユーザー回答が必要な項目)
```

## E2E テスト(Playwright)

`playwright.config.ts` は `./e2e` 配下のスペックを対象に、`webServer` で `pnpm dev` を自動起動する設定になっています(既存のサーバがあればローカルでは再利用、CI では毎回新規起動)。

### ブラウザバイナリのインストール(初回のみ)

Playwright はブラウザ本体を別途ダウンロードする必要があります。`pnpm install` 後、初回のみ以下を実行してください。

```bash
pnpm exec playwright install          # ローカル開発環境(このリポジトリでは chromium のみ使用)
pnpm exec playwright install --with-deps   # Linux CI ランナー等、OS 依存パッケージも同時に導入する場合
```

`--with-deps` は Linux 上で Playwright 実行に必要な OS パッケージ(apt 経由)も併せてインストールするオプションで、GitHub Actions の `ubuntu-latest` ランナーなど Linux 環境では基本的にこちらを使用してください。macOS/Windows のローカル環境では通常 `pnpm exec playwright install` のみで十分です。

### 実行

```bash
pnpm test:e2e       # ヘッドレスで全 E2E スペックを実行
pnpm test:e2e:ui    # Playwright UI モード(対話的にテストを選択・トレースを確認)
```

`test:e2e` はデフォルトでヘッドレス実行です(`playwright.config.ts` の `projects` は `chromium` のみを定義)。CI 上でもブラウザ UI は表示されず、ヘッドレスのまま実行されます。

### CI での実行に関する注意

- CI ランナー(GitHub Actions 等)では毎回ブラウザバイナリのキャッシュが存在しない前提のため、テスト実行前に `pnpm exec playwright install --with-deps` が必要です。
- `playwright.config.ts` は `retries: process.env.CI ? 2 : 0` としており、CI 環境(`CI=true`)でのみ失敗テストを自動リトライします。
- 本 README/このリポジトリの E2E 整備は「ローカルで実行できる初期シナリオと手順」までを対象としており、E2E を GitHub Actions の必須チェックとして組み込む作業(ワークフロー化)は別issueで扱います([#29](https://github.com/AutoDevJapan/FourBrosMahjong/issues/29))。

## ドキュメント

ゲームロジックやスコアリングの実装に着手する前に、必ず以下を確認してください(詳細は各ドキュメントを参照し、ここでは概要のみ記載します)。

- [`docs/README.md`](./docs/README.md) — ドキュメントナビゲーションのハブ
- [`docs/四兄弟麻雀ルール.md`](./docs/四兄弟麻雀ルール.md) — ゲームルールの単一情報源(SSOT)。ゲーム/スコアリング/牌ロジックに触れる前に必読
- [`documents/spec/`](./documents/spec/README.md) — 確定した仕様を I/O・状態・境界値・完了条件に分解した実装スペック(卓構成・局進行・点数精算・ドメインモデル)。実装はこのスペックを基準に行う
- [`質問リスト.md`](./質問リスト.md) — 未確定の仕様に関する質問リスト。**Q9〜Q13 が未回答**であり、該当領域(着席順・親決定・東南戦進行・ツモ配分・ウマ割当)は回答が出るまで実装しません

## 開発時の注意

- 詳細な開発ガイドライン(ツール構成・コーディング規約など)は [`CLAUDE.md`](./CLAUDE.md) を参照してください。
- プレビュー/デプロイパイプラインは未整備です(関連: [#3 Vercel 連携・Preview環境・dev/stg/prd 昇格フロー](https://github.com/AutoDevJapan/FourBrosMahjong/issues/3))。
