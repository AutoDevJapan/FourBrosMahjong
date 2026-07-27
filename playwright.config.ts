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
// PWA オフライン系スペック(e2e/pwa-offline.spec.ts)はこのモードでのみ動く。
const useProdServer = process.env.E2E_PROD === "1";
// CI の品質ジョブは Playwright より先に `pnpm build` を完了している。同じ job/workspace の
// `.next` を再利用し、PWA 2件のためだけに二重 build しない。単独ローカル実行は既定どおり
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
