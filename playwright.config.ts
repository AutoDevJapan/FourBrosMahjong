import { defineConfig, devices } from "@playwright/test";

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
const useProdServer = process.env.E2E_PROD === "1";
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
  // ローカル実測(同一 spec 群 / `CI=1` / 139 passed・3 skipped、flake 0):
  //   workers=1 → 136.2s (CPU 130.7s) / workers=2 → 71.8s (CPU 138.2s) / workers=4 → 59.1s (CPU 169.9s)
  // 2 worker で **1.90 倍**速くなる一方 CPU 総量の増加は +6% に留まる。4 worker は CPU を
  // +30% 使うため 2 コア runner では競合でタイムアウト耐性を削る。したがって過剰購読は
  // せず「コア数ぴったり」を指定する。パーセント指定なので runner が増強されれば自動追従する。
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
