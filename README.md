# 四兄弟麻雀 (Four Brothers Mahjong)

粗品 Official Channel「ギャンブル四兄弟」の麻雀企画をベースにした、関西式三人打ち(サンマ)麻雀のデジタル実装プロジェクトです。オールレッド5・北抜きドラ「ガリ」・サイコロ連動のドラ枚数・4人による着席ローテーション・「ソシー」精算など、番組独自のルールを再現します。

> **プロジェクトの現状**: 開発中です。牌・山・配牌・ドラ・和了判定・局進行・点数精算を担うドメイン層と、ロビー(`/`)・ルール(`/rules`)・設定(`/settings`)・対局(`/game`)・結果(`/game/result`)・戦績(`/history`)の各画面を実装しています。対局画面は実対局エンジンで動作し、同一タブ内では操作履歴を `sessionStorage` に保存してリロード後に復元します。Service Worker によるオフライン対応(PWA)も組み込み済みです。Vitest でドメイン/コンポーネントを、Playwright で実際の対局操作や半荘終了までの導線を検証しています。バックエンドや複数端末間の状態同期は未実装です。

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
依存インストール後に Node.js を切り替えた場合も、Vitest の各コマンドは開始前に
`engines.node` を検査します。範囲外なら `nvm use` などで対応バージョンへ戻してください。

## コマンド一覧

```bash
pnpm dev            # 開発サーバ(Turbopack) — http://localhost:3000
pnpm build          # 本番ビルド
pnpm start          # 本番ビルドの起動
pnpm lint           # ESLint(eslint.config.mjs, next/core-web-vitals + next/typescript)
pnpm typecheck      # tsc --noEmit

pnpm test           # Vitest — node/jsdom 両プロジェクトを実行(src/**/*.{test,spec}.{ts,tsx})
pnpm test:unit      # Vitest — node プロジェクトのみ(*.{test,spec}.ts)
pnpm test:component # Vitest — jsdom プロジェクトのみ(*.{test,spec}.tsx / コンポーネントテスト)
pnpm test:watch     # Vitest ウォッチモード
pnpm test:coverage  # Vitest + v8 カバレッジ
pnpm test:e2e       # Playwright E2E — ./e2e 配下(初回のみ `pnpm exec playwright install` が必要。詳細は後述の「E2E テスト」参照)
pnpm test:e2e:pwa   # production build + Service Worker / オフライン専用E2E
pnpm test:e2e:ui    # Playwright UI モード(テストの選択実行・トレース確認向け)

pnpm format         # Biome: フォーマット適用
pnpm check          # Biome: format + assist チェック(CI の必須ゲート)
pnpm format:check   # Biome: フォーマットのみ(`check` に包含)
pnpm knip           # 未使用ファイル/エクスポート/依存の検出
pnpm depcruise      # dependency-cruiser による依存関係ルールチェック(src配下)
pnpm docs           # TypeDoc → docs/api(gitignore対象)
```

単体の Vitest ファイルのみ実行する場合: `pnpm exec vitest run src/foo.test.ts`(`-t "name"` で特定テストのみ実行)。

## ディレクトリ構成

```
src/app/          Next.js App Router の各画面(`/`・`/rules`・`/settings`・`/game`・`/game/result`・`/history`)と PWA 資産(`sw.js`・`manifest.ts`)
src/components/   対局盤面・結果・共通 UI コンポーネント
src/domain/       牌・山・和了判定・対局進行・点数精算などのゲームロジック
e2e/              Playwright E2E テスト
docs/             ゲームルール・ドキュメントの入口(人間向け)
documents/spec/   実装スペック(SpecDD SSOT) — GoDD の docs_dir
質問リスト.md      仕様質問の管理台帳(未回答/解決済みの最新状況は本ファイルを参照)
```

## コンポーネントテスト(Vitest + Testing Library)

Vitest は**ファイル拡張子でテスト環境を分割**する 2 プロジェクト構成です(`vitest.config.ts`)。

| 拡張子 | 環境 | 用途 | プロジェクト名 |
| --- | --- | --- | --- |
| `*.{test,spec}.ts` | `node` | 純粋なゲーム/ルール/ロジック(DOM 不要) | `unit` |
| `*.{test,spec}.tsx` | `jsdom` | React コンポーネント(DOM が必要) | `component` |

`pnpm test` で両プロジェクトを一括実行し、`pnpm test:unit` / `pnpm test:component` で片方だけを実行できます。個別ファイルで方針を上書きしたい場合は先頭に `// @vitest-environment jsdom`(または `node`)のドックブロックを付けます。

### 構成要素

- 依存: `@testing-library/react` / `@testing-library/user-event` / `@testing-library/jest-dom` / `jsdom`(JSX 変換用に `@vitejs/plugin-react` を component プロジェクトへ適用)。
- セットアップ: `vitest.setup.ts`(component プロジェクトの `setupFiles`)が `@testing-library/jest-dom` のマッチャ(`toBeInTheDocument` 等)を登録し、各テスト後に `cleanup()` を実行します。
- スモークテスト: `src/test/component-smoke.test.tsx`(jsdom レンダリング + Tailwind クラス + `user-event` 操作)と `src/test/environment-split.test.ts`(node 環境の確認)が基盤の疎通を担保します。

### コンポーネントテストの書き方(例)

```tsx
// src/components/foo.test.tsx — .tsx なので自動的に jsdom で実行される
import { render, screen } from "@testing-library/react";
import { Foo } from "./foo";

it("renders", () => {
  render(<Foo />);
  expect(screen.getByRole("button")).toBeInTheDocument(); // jest-dom マッチャ
});
```

個別コンポーネントのテストケース拡充は各コンポーネント実装時に行います(本節は基盤の説明)。

## E2E テスト(Playwright)

`playwright.config.ts` は `./e2e` 配下のスペックを対象に、`webServer` で E2E 専用の開発サーバを自動起動します。既定の URL は `http://127.0.0.1:3100` で、通常の開発サーバ(`http://localhost:3000`)とは分離されています。

起動ポートとブラウザの接続先は、単一の環境変数 `E2E_PORT` から設定されます。並列作業などで変更する場合は `E2E_PORT=3200 pnpm test:e2e` のように実行してください。既存サーバはローカル・CI とも再利用しません。指定ポートが使用中の場合は、別アプリに対してテストを続行せず、サーバ起動エラーとしてテスト開始前に停止します。

### ブラウザバイナリのインストール(初回のみ)

Playwright はブラウザ本体を別途ダウンロードする必要があります。`pnpm install` 後、初回のみ以下を実行してください。

```bash
pnpm exec playwright install chromium webkit               # ローカル開発環境(このリポジトリが使う 2 ブラウザ)
pnpm exec playwright install --with-deps chromium webkit   # Linux CI ランナー等、OS 依存パッケージも同時に導入する場合
```

`playwright.config.ts` は `chromium` と `webkit-modal-focus`(Desktop Safari)の **2 プロジェクト**を定義しているため、**webkit を入れないと `pnpm test:e2e` が失敗します**。引数を省略した `pnpm exec playwright install` でも全ブラウザが入りますが、firefox など不要なブラウザまで取得するため上記の明示指定を推奨します。

`--with-deps` は Linux 上で Playwright 実行に必要な OS パッケージ(apt 経由)も併せてインストールするオプションで、GitHub Actions の `ubuntu-latest` ランナーなど Linux 環境では基本的にこちらを使用してください。macOS/Windows のローカル環境では通常 `pnpm exec playwright install` のみで十分です。

### 実行

```bash
pnpm test:e2e       # ヘッドレスで全 E2E スペックを実行
pnpm test:e2e:pwa   # production serverでPWA専用スペックを実行(buildを含む)
pnpm test:e2e:ui    # Playwright UI モード(対話的にテストを選択・トレースを確認)
```

`test:e2e` はデフォルトでヘッドレス実行です。CI 上でもブラウザ UI は表示されず、ヘッドレスのまま実行されます。

`playwright.config.ts` の `projects` は 2 つです。

| プロジェクト | ブラウザ | 対象 spec | 目的 |
| --- | --- | --- | --- |
| `chromium` | Desktop Chrome | `e2e/` 配下すべて | 通常の E2E 一式 |
| `webkit-modal-focus` | Desktop Safari | `e2e/modal-focus.spec.ts` のみ | WebKit はポインター操作で `button` にフォーカスしないため、モーダルのフォーカス復帰回帰([#369](https://github.com/AutoDevJapan/FourBrosMahjong/issues/369))だけを Safari 相当で固定する。全 spec の重複実行は避けています |

プロジェクト構成は `src/test/playwright-projects.test.ts` が回帰テストとして固定しています(`testMatch` が 0 件一致になっても Playwright は無警告で exit 0 になるため)。

### CI での実行に関する注意

- `.github/workflows/ci.yml` の `E2E (Playwright)` ジョブが、検証対象の変更を含むPRやscope判定で検証が必要なpushに対して、ヘッドレスで `pnpm test:e2e` を実行します([#29](https://github.com/AutoDevJapan/FourBrosMahjong/issues/29) で組み込み済み)。検証済みmain pushなど、PR側で同じtreeを検証済みと確認できた場合は重複実行を省略します。
- Service Worker はdev serverでは無効なため、通常E2Eでは `e2e/pwa-offline.spec.ts` の全件をskipします。CIは品質ジョブの既存production buildを再利用して `pnpm test:e2e:pwa:prebuilt` を実行し、初回登録の追加オンライン再読込みなしでのオフライン起動・実打によるhydrate確認・登録・プリキャッシュ・対局復元を別途検証します。`prebuilt` はCI内部用で、ローカルではbuild込みの `pnpm test:e2e:pwa` を使ってください。
- CI の `ci` job では production E2E 用の Chromium と pnpm store をキャッシュします。通常の `E2E (Playwright)` job は Chromium/WebKit とOS依存を含むバージョン固定のPlaywrightイメージを使うため、毎回の `playwright install --with-deps` やE2E専用ブラウザcacheはありません。検証済みmain pushのE2Eは重複検証とsetupを省略し、共有cacheのseedは `ci` job だけが行います。
- **キャッシュの保存は `main` の `ci` job に限定しています**([#380](https://github.com/AutoDevJapan/FourBrosMahjong/issues/380))。GitHub Actions のキャッシュ予算はリポジトリあたり 10GB・超過分は LRU で退避されるうえ、キャッシュは ref スコープなので、PR ref (`refs/pull/N/merge`) でも保存すると同一内容が ref の数だけ複製されて予算が数日で一巡し、「保存するが復元前に消える」恒常ミス状態になります。既定ブランチの `ci` cacheは全ブランチ・全 PR から復元できるため、保存をmainに限定してもヒット率は落ちません。PR / dev / stg の `ci` jobは `actions/cache/restore` による復元専用です。E2E jobは固定Playwrightイメージを使いブラウザcacheを持ちません。この不変条件は `src/test/ci-workflow.test.ts` が回帰テストとして固定しています。
- `playwright.config.ts` は `retries: process.env.CI ? 2 : 0` としており、CI 環境(`CI=true`)でのみ失敗テストを自動リトライします。
- E2E テストは lint/typecheck 等と比べて不安定化(flaky)しやすいため、現時点ではブランチ保護の必須ステータスチェックには含めていません(結果は PR 上で可視化されます。必要になれば別途判断して追加します)。

## ドキュメント

ゲームロジックやスコアリングの実装に着手する前に、必ず以下を確認してください(詳細は各ドキュメントを参照し、ここでは概要のみ記載します)。

- [`docs/README.md`](./docs/README.md) — ドキュメントナビゲーションのハブ
- [`docs/四兄弟麻雀ルール.md`](./docs/四兄弟麻雀ルール.md) — ゲームルールの単一情報源(SSOT)。ゲーム/スコアリング/牌ロジックに触れる前に必読
- [`documents/spec/`](./documents/spec/README.md) — 確定した仕様を I/O・状態・境界値・完了条件に分解した実装スペック(卓構成・局進行・点数精算・ドメインモデル)。実装はこのスペックを基準に行う
- [`質問リスト.md`](./質問リスト.md) — 仕様質問を管理する唯一の台帳。解決済み質問の確定内容は実装スペックへ反映済みですが、**未解決の質問も存在し得ます**(本文更新時点では Q22・Q23 が未回答)。該当領域の実装前に「未回答 / 要確認」節で最新状況を確認してください。新たな曖昧点も本台帳へ記録し、回答前に推測で実装しません

## ブランチ保護(main)

`main` は Branch protection rule で保護されており、直 push は禁止です(すべての変更は PR 経由)。設定内容:

- **PR 必須**: `main` への変更は PR のマージ経由のみ可能(直 push は拒否されます)。
- **必須ステータスチェック**(最新コミットに対して必須、strict): `gitleaks`、`lint / typecheck / format / test / build`
- **管理者にも適用**(`enforce_admins: true`): admin 権限でも上記チェックをバイパスできません。
- **レビュー承認は必須にしていません**(`required_approving_review_count: 0`): 本リポジトリは自律エージェントパイプラインが自己マージする運用のため、人間レビュー必須化はパイプラインを恒久的にブロックしてしまいます。「PR 必須 + CI 必須」で品質と履歴の健全性は担保しつつ、レビュー要件のみ意図的に外しています。

詳細・経緯は [#4](https://github.com/AutoDevJapan/FourBrosMahjong/issues/4) を参照してください。

## 開発時の注意

- 詳細な開発ガイドライン(ツール構成・コーディング規約など)は [`CLAUDE.md`](./CLAUDE.md) を参照してください。
- フロントエンドは Vercel の Git Integration と連携済みで、PR Preview と `dev` / `stg` / `main`(`prd`)の昇格フローを運用しています。環境ごとの状態・URL・手順は [`docs/デプロイ環境運用.md`](./docs/デプロイ環境運用.md) を参照してください。バックエンドは未実装のため、Railway リソースはまだ作成していません。
