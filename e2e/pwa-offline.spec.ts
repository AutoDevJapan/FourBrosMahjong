import { expect, test } from "@playwright/test";
import { walkToGameEnd } from "@/components/game/finishedGameFixture";
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

  test("初回登録後に追加のオンライン再読込みなしで/game・/online・/rules・/history・/game/resultをオフライン起動できる(#506/#701/#712)", async ({
    page,
    context,
  }) => {
    // ロビーの初回表示は SW 非制御。このページで /game の chunk を
    // runtime cache へ入れたことは無い状態で install 完了だけを待つ。
    await page.goto("/");
    await page.waitForFunction(
      async () => (await navigator.serviceWorker?.ready) != null,
    );
    expect(
      await page.evaluate(() => navigator.serviceWorker?.controller),
    ).toBeNull();

    // install cache 自体に build 固有依存が入ったことも確認する。
    // hydrate 成功だけでは初回ロビー表示の HTTP cache に共通 chunk が
    // 残った偽陽性を完全に排除できないため、Cache Storage を直接見る。
    const precachedBuildAssets = await page.evaluate(async () => {
      const cacheName = (await caches.keys()).find((key) =>
        key.startsWith("fbm-precache-"),
      );
      if (!cacheName) return [];
      return (await (await caches.open(cacheName)).keys()).map(
        (request) => new URL(request.url).pathname,
      );
    });
    expect(
      precachedBuildAssets.some(
        (path) => path.startsWith("/_next/static/") && path.endsWith(".js"),
      ),
    ).toBe(true);
    expect(
      precachedBuildAssets.some(
        (path) => path.startsWith("/_next/static/") && path.endsWith(".css"),
      ),
    ).toBe(true);

    // オンライン再読込みを挟まず初回ページを閉じ、機内モードで
    // 新しいトップレベルページを開く。ナビゲーション HTML だけでなく
    // build 固有 JS/CSS が install cache に無ければ hydration 待ちで失敗する。
    await page.close();
    await context.setOffline(true);
    const offlinePage = await context.newPage();
    await offlinePage.goto("/game");
    await expect(offlinePage.locator("[data-phase]").first()).toHaveAttribute(
      "data-phase",
      "playing",
    );
    await expect(visibleHand(offlinePage).getByRole("option")).toHaveCount(14);
    // Game固有CSSもexact page chunkへ分離されている。SSR/共通globalsだけでの
    // 見かけ上の起動を合格にせず、未訪問offlineでも盤面装飾までhydrateする。
    await expect(
      offlinePage
        .locator('[data-board-layout="cross"]')
        .filter({ visible: true }),
    ).toHaveCSS("isolation", "isolate");

    // 後から追加されたユーザー向けrouteもApp shellへ含める。未登録だと
    // offline navigationが `/` fallbackを返し、オンライン画面の接続不能案内や
    // ルーム入力UIへ到達できない。
    const offlineOnlinePage = await context.newPage();
    await offlineOnlinePage.goto("/online");
    await expect(
      offlineOnlinePage.getByRole("heading", { name: "オンライン対戦" }),
    ).toBeVisible();
    await expect(offlineOnlinePage.getByLabel("表示名")).toBeVisible();
    // WebSocket URL が未設定のproduction buildでも、maintenance対応を含む
    // `/online` client chunk自体がinstall cacheへ収録されていることを固定する。
    // UI state-machineの実動作はonline-lobby.spec.tsでWebSocket stubにより検証する。
    expect(
      await offlineOnlinePage.evaluate(async () => {
        const cacheName = (await caches.keys()).find((key) =>
          key.startsWith("fbm-precache-"),
        );
        if (!cacheName) return false;
        const cache = await caches.open(cacheName);
        const scripts = (await cache.keys()).filter((request) =>
          new URL(request.url).pathname.endsWith(".js"),
        );
        for (const request of scripts) {
          const response = await cache.match(request);
          if ((await response?.text())?.includes("メンテナンス準備中です")) {
            return true;
          }
        }
        return false;
      }),
    ).toBe(true);
    await offlineOnlinePage.close();

    // Rules固有CSSをroute chunkへ分離しても、install時に全routeのbuild assetを
    // 抽出する契約により、初回オンライン表示なしで閲覧・操作できる。
    const offlineRulesPage = await context.newPage();
    await offlineRulesPage.goto("/rules");
    await expect(
      offlineRulesPage.getByRole("heading", { name: "ルール説明" }),
    ).toBeVisible();
    await expect(
      offlineRulesPage.getByRole("navigation", { name: "ルールの目次" }),
    ).toBeVisible();
    await expect(offlineRulesPage.locator(".rules-layout")).toHaveCSS(
      "display",
      "grid",
    );
    await offlineRulesPage.close();

    // History固有CSSもroute chunkのままprecacheし、空状態のClient Componentまで
    // hydrateしてキーボード導線を利用できる。
    const offlineHistoryPage = await context.newPage();
    await offlineHistoryPage.goto("/history");
    await expect(
      offlineHistoryPage.getByRole("heading", { name: "戦績" }),
    ).toBeVisible();
    await expect(offlineHistoryPage.locator(".history-panel")).toHaveCSS(
      "overflow",
      "hidden",
    );
    const offlineHistoryAction = offlineHistoryPage.getByRole("link", {
      name: "対局を開始",
    });
    await offlineHistoryAction.focus();
    await expect(offlineHistoryAction).toBeFocused();
    await offlineHistoryPage.close();

    // Result固有CSSもroute chunkのままprecacheされ、終局journalを復元して操作できる。
    const offlineResultPage = await context.newPage();
    await offlineResultPage.addInitScript(
      (raw) => {
        if (sessionStorage.getItem("four-bros-mahjong.game.v3") === null) {
          sessionStorage.setItem("four-bros-mahjong.game.v3", raw);
        }
      },
      JSON.stringify(walkToGameEnd(1).journal),
    );
    await offlineResultPage.goto("/game/result");
    await expect(
      offlineResultPage.getByRole("heading", { name: "半荘終了" }),
    ).toBeVisible();
    await expect(offlineResultPage.locator(".result-ranking-table")).toHaveCSS(
      "table-layout",
      "fixed",
    );
    await offlineResultPage.getByRole("button", { name: "もう一半荘" }).click();
    await expect(offlineResultPage).toHaveURL(/\/game$/);
    await expect(
      offlineResultPage.locator('[data-phase="playing"]').first(),
    ).toBeVisible();
    await offlineResultPage.close();

    // SSR表示だけの偽陽性ではなく、hydrate済みのイベントハンドラと
    // sessionStorageジャーナルがオフラインでも実際に進行することを固定する。
    const playableTile = visibleHand(offlinePage)
      .locator('[role="option"]:not([aria-disabled="true"])')
      .first();
    await playableTile.click();
    await expect
      .poll(() =>
        offlinePage.evaluate(() => {
          const raw = sessionStorage.getItem("four-bros-mahjong.game.v3");
          return raw === null ? 0 : (JSON.parse(raw).actions?.length ?? 0);
        }),
      )
      .toBeGreaterThan(0);
    // 打牌直後はAI手番へ移り、自家手牌が一時的に read-only list になる場合がある。
    // 操作可能な option 数ではなく、盤面が対局中のまま更新されたことを確認する。
    await expect(offlinePage.locator("[data-phase]").first()).toHaveAttribute(
      "data-phase",
      "playing",
    );

    await context.setOffline(false);
  });

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

    // プリキャッシュ(App シェル 7 ルート + アイコン + 牌素材)の完了を確認する。
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
      "/online",
      "/game",
      "/game/result",
    ]) {
      expect(precached).toContain(route);
    }
    for (const portrait of [
      "/characters/p0-soakuhin-portrait.avif",
      "/characters/p1-ryuji-portrait.avif",
      "/characters/p2-masaki-portrait.avif",
      "/characters/p3-hechima-portrait.avif",
    ]) {
      expect(precached).toContain(portrait);
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
          const raw = sessionStorage.getItem("four-bros-mahjong.game.v3");
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
    await expect
      .poll(() =>
        page
          .locator(".lobby-character-image")
          .evaluateAll((images) =>
            images.map((image) =>
              image instanceof HTMLImageElement ? image.naturalWidth : 0,
            ),
          ),
      )
      .toEqual([220, 220, 220, 220]);
    await context.setOffline(false);
  });

  test("初回install後はオフラインでも/settingsをhydrateしテーマと名前を保存できる", async ({
    page,
    context,
  }) => {
    await page.goto("/settings");
    await page.waitForFunction(
      async () => (await navigator.serviceWorker?.ready) != null,
    );
    await page.reload();
    await page.waitForFunction(
      () => navigator.serviceWorker?.controller != null,
    );

    await context.setOffline(true);
    await page.reload();
    const dark = page.getByRole("radio", { name: "ダーク" });
    await expect(dark).toBeVisible();
    await dark.check();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    await page.getByLabel("竜二").fill("オフライン名");
    await page.getByRole("button", { name: "名前を保存" }).click();
    await expect(page.getByText(/保存しました/)).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("竜二")).toHaveValue("オフライン名");
    await context.setOffline(false);
  });

  test("RSC取得後もHTML cacheを汚染せず、オフラインで/gameを再読込できる(#355)", async ({
    page,
    context,
  }) => {
    await page.goto("/game");
    await page.waitForFunction(
      async () => (await navigator.serviceWorker?.ready) != null,
    );
    await page.reload();
    await page.waitForFunction(
      () => navigator.serviceWorker?.controller != null,
    );

    // Next の RSC query/header は内部プロトコルであり、手作りするとバージョン更新時に
    // 正規化 redirect の対象になり得る。実際の <Link> 遷移が生成する RSC request で
    // runtime cache を汚染しないことを確認する。
    const rscResponsePromise = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/" &&
        response.url().includes("_rsc=") &&
        response.headers()["content-type"]?.includes("text/x-component"),
    );
    await page.getByRole("link", { name: "ロビーへ戻る" }).click();
    const rscResponse = await rscResponsePromise;
    expect(rscResponse.ok()).toBe(true);
    await page.getByRole("link", { name: /対局を始める/ }).click();
    await expect(page.getByRole("heading", { name: "対局画面" })).toBeVisible();

    const cachedDocumentType = await page.evaluate(async () => {
      const keys = await caches.keys();
      const runtimeName = keys.find((key) => key.startsWith("fbm-runtime-"));
      if (!runtimeName) return null;
      const cached = await (await caches.open(runtimeName)).match("/game");
      return cached?.headers.get("content-type") ?? null;
    });
    expect(cachedDocumentType).toContain("text/html");

    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole("heading", { name: "対局画面" })).toBeVisible();
    await context.setOffline(false);
  });
});
