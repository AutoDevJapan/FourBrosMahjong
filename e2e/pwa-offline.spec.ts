import { expect, test } from "@playwright/test";
import { visibleHand } from "./helpers/gameDriver";

/**
 * PWA オフライン動作の回帰防止(issue #292)。
 *
 * service worker は production ビルドでのみ登録される(dev はキャッシュ汚染防止のため無効)。
 * そのためこのスペックは `E2E_PROD=1`(playwright.config.ts が `pnpm build && pnpm start` で
 * サーバーを起動するモード)でのみ実行し、通常の dev サーバー実行では skip する。
 *
 * 実行例: `E2E_PROD=1 E2E_PORT=3103 pnpm test:e2e e2e/pwa-offline.spec.ts`
 */
test.describe("PWAオフライン動作(#292)", () => {
  test.skip(
    process.env.E2E_PROD !== "1",
    "service worker は production ビルドのみ有効(E2E_PROD=1 で実行)",
  );

  test("SW登録・プリキャッシュ後、オフラインで/gameを再読込しても対局を継続できる", async ({
    page,
    context,
  }) => {
    await page.goto("/game?seed=0");

    // #349: 初回登録ページは未制御のまま。更新 SW が旧タブを途中から
    // 奪わない標準ライフサイクルを守り、activate 完了後の再読込で制御下へ入る。
    await page.waitForFunction(
      async () => (await navigator.serviceWorker?.ready) != null,
    );
    expect(
      await page.evaluate(() => navigator.serviceWorker?.controller),
    ).toBeNull();
    await page.reload();
    await page.waitForFunction(
      () => navigator.serviceWorker?.controller != null,
    );

    // プリキャッシュ(App シェル 5 ルート + アイコン + 牌素材)の完了を確認する。
    const cacheKeys = await page.evaluate(() => caches.keys());
    expect(cacheKeys.some((key) => key.startsWith("fbm-precache-"))).toBe(true);
    const precached = await page.evaluate(async () => {
      const keys = await caches.keys();
      const name = keys.find((key) => key.startsWith("fbm-precache-"));
      if (!name) return [];
      const cache = await caches.open(name);
      return (await cache.keys()).map(
        (request) => new URL(request.url).pathname,
      );
    });
    for (const route of [
      "/",
      "/rules",
      "/settings",
      "/history",
      "/game",
      "/game/result",
    ]) {
      expect(precached).toContain(route);
    }
    expect(precached).toContain("/tiles/Back.svg");

    // 上の再読込でサブリソースも SW 経由(runtime cache)になる。
    const hand = visibleHand(page);

    // 1 打して局面を進める(sessionStorage ジャーナルに記録される)。
    await hand
      .locator('[role="option"]:not([aria-disabled="true"])')
      .first()
      .click();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const raw = sessionStorage.getItem("four-bros-mahjong.game.v1");
          return raw === null ? 0 : (JSON.parse(raw).actions?.length ?? 0);
        }),
      )
      .toBeGreaterThan(0);
    const progressed = await hand
      .getByRole("option")
      .evaluateAll((options) =>
        options.map((option) => option.getAttribute("aria-label")),
      );

    // 機内モードで再読込: ERR_INTERNET_DISCONNECTED にならず、同じ局面を復元できる。
    await context.setOffline(true);
    await page.reload();
    await expect
      .poll(() =>
        visibleHand(page)
          .getByRole("option")
          .evaluateAll((options) =>
            options.map((option) => option.getAttribute("aria-label")),
          ),
      )
      .toEqual(progressed);

    await context.setOffline(false);
  });

  test("オフラインでも / を再読込でき、SWスクリプトはキャッシュ抑止ヘッダー付きで配信される", async ({
    page,
    context,
    request,
  }) => {
    const swResponse = await request.get("/sw.js");
    expect(swResponse.ok()).toBe(true);
    expect(swResponse.headers()["content-type"]).toContain("javascript");
    // 新デプロイの SW 更新チェックを HTTP キャッシュに妨げさせない。
    expect(swResponse.headers()["cache-control"]).toContain("no-cache");

    await page.goto("/");
    await page.waitForFunction(
      async () => (await navigator.serviceWorker?.ready) != null,
    );
    await page.reload();
    await page.waitForFunction(
      () => navigator.serviceWorker?.controller != null,
    );

    await context.setOffline(true);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: /四兄弟麻雀/ }),
    ).toBeVisible();
    await context.setOffline(false);
  });
});
