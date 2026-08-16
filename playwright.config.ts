import { defineConfig, devices } from "@playwright/test";
import { e2eServerMode } from "./e2e/serverMode";

const e2ePort = process.env.E2E_PORT ?? "3100";

if (!/^\d+$/.test(e2ePort) || Number(e2ePort) < 1 || Number(e2ePort) > 65535) {
  throw new Error(
    `E2E_PORT must be an integer between 1 and 65535: ${e2ePort}`,
  );
}

// Keep the browser target and the server command derived from one value so
// they cannot silently drift apart. A dedicated port also keeps E2E isolated
// from the regular development server on port 3000.
const e2eBaseURL = `http://127.0.0.1:${e2ePort}`;

// E2E_PROD=1 で production ビルド(pnpm build && pnpm start)に対して実行する。
// service worker は production でのみ登録されるため(dev はキャッシュ汚染防止で無効)、
// PWA オフライン系と、本番成果物との主要parityスペックはこのモードで動かす。
const useProdServer = e2eServerMode() === "production";
// CI の品質ジョブは Playwright より先に `pnpm build` を完了している。同じ job/workspace の
// `.next` を再利用し、production E2Eのためだけに二重 build しない。単独ローカル実行は既定どおり
// build から行うため、このフラグは明示した場合にだけ有効。
const usePrebuiltProdServer = process.env.E2E_PROD_PREBUILT === "1";

if (usePrebuiltProdServer && !useProdServer) {
  throw new Error("E2E_PROD_PREBUILT=1 requires E2E_PROD=1");
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Playwright 既定の `"50%"` は `floor(cpus × 0.5)` なので、2 コアの GitHub ホスト
  // runner では **1 worker = 完全な直列実行**になる(CI ログの `Running 143 tests using
  // 1 worker` が実測値)。E2E は待ち時間(ページ遷移・networkidle・axe 走査)が支配的で、
  // `fullyParallel: true` によりローカルでは既定の 50% = 複数 worker で日常的に並列実行
  // されている。つまり並列安全性は確立済みで、CI だけが直列で走っていた。
  //
  // ただし **効果は限定的**であることが CI 実測で判明している。ローカル(8 コア)の測定は
  // 2 コア runner を代表しない — ローカルの「2 worker」は 8 コアを使えるため競合しないが、
  // 実際の runner では 2 worker が同じ 2 コアを奪い合う。
  //   ローカル(8 コア): workers=1 → 136.2s / 2 → 71.8s (1.90x) / 4 → 59.1s (2.31x)
  //   CI(2 コア)     : workers=1 → 266s   / 2 → 243s (1.09x)  ← 実効はこちら
  // CI では -23 秒に留まる(1 worker + Next dev server で既に CPU がほぼ飽和しているため)。
  // 劣化も flaky も無いので維持するが、**この設定単体で課金分の切り上げは跨がない**。
  // 4 worker への過剰購読は CPU が飽和している以上さらなる短縮を見込みにくく、競合で
  // タイムアウト耐性を削るため採らない。パーセント指定なので runner 増強には自動追従する。
  // 詳細は docs/品質ツール運用方針.md §7.3。
  workers: process.env.CI ? "100%" : undefined,
  reporter: process.env.CI
    ? [["list"], ["github"], ["html", { open: "never" }]]
    : "html",
  use: {
    baseURL: e2eBaseURL,
    trace: "on-first-retry",
  },
  projects: [
    // chromium は全 spec を走らせる。modal-focus.spec.ts は #369 の条件(ポインター起動で
    // フォーカスが移らない)を chromium では再現しないが、returnFocusRef 経路が既定ブラウザで
    // 壊れていないことの安価なガードとして意図的に重複実行する。
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    {
      // #369: WebKit はポインターで button を起動してもフォーカスしない。
      // 全 E2E の重複実行は避け、モーダル復帰の専用回帰だけを Safari 相当で固定する。
      // testMatch が実在 spec を指すことは src/test/playwright-projects.test.ts が固定する
      // (spec をリネームすると Playwright は無警告で 0 件になり、回帰が静かに消えるため)。
      name: "webkit-modal-focus",
      testMatch: "**/modal-focus.spec.ts",
      use: { ...devices["Desktop Safari"] },
    },
  ],
  webServer: {
    command: useProdServer
      ? `${usePrebuiltProdServer ? "" : "pnpm build && "}pnpm start --hostname 127.0.0.1 --port ${e2ePort}`
      : `pnpm dev --hostname 127.0.0.1 --port ${e2ePort}`,
    url: e2eBaseURL,
    // Never trust an arbitrary process already listening on the E2E port.
    // A collision must fail before any spec is run against the wrong app.
    reuseExistingServer: false,
    // production モードはビルドを挟むため起動猶予を広げる。
    timeout: useProdServer ? 300_000 : 60_000,
  },
});
