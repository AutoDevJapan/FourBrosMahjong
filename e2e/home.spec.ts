import { expect, type Locator, type Page, test } from "@playwright/test";

const LOBBY_VIEWPORTS = [
  { label: "phone-320", width: 320, height: 800, columns: 2 },
  { label: "phone-375", width: 375, height: 812, columns: 2 },
  { label: "tablet-768", width: 768, height: 1024, columns: 4 },
  { label: "desktop", width: 1280, height: 900, columns: 4 },
  { label: "desktop-1440", width: 1440, height: 900, columns: 4 },
] as const;

const CHARACTER_IDS = ["p0", "p1", "p2", "p3"] as const;

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
}

async function expectInsideViewport(target: Locator): Promise<void> {
  const box = await target.boundingBox();
  const viewportWidth = await target.evaluate(() => window.innerWidth);
  expect(box).not.toBeNull();
  expect(box?.x).toBeGreaterThanOrEqual(-0.5);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(
    viewportWidth + 0.5,
  );
}

async function expectMinimumTarget(target: Locator): Promise<void> {
  const box = await target.boundingBox();
  expect(box).not.toBeNull();
  expect(box?.width).toBeGreaterThanOrEqual(44);
  expect(box?.height).toBeGreaterThanOrEqual(44);
}

async function waitForLobbyVisuals(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      Array.from(
        document.querySelectorAll<HTMLImageElement>(".lobby-character-image"),
      ).map((image) =>
        image.complete && image.naturalWidth > 0
          ? Promise.resolve()
          : new Promise<void>((resolve, reject) => {
              image.addEventListener("load", () => resolve(), { once: true });
              image.addEventListener(
                "error",
                () => reject(new Error(`Failed to load ${image.src}`)),
                {
                  once: true,
                },
              );
            }),
      ),
    );
  });
}

/**
 * トップページ(ロビー)の E2E 検証。
 *
 * #9(PR #43)でトップページ/メタデータが四兄弟麻雀の実態へ置き換えられたため、
 * 本テストは実際のタイトル・見出し・プレースホルダを検証する
 * (create-next-app デフォルト時代のスモークテストから更新 / #45)。
 *
 * `/rules`(#51)・`/game`(#53)・`/settings`(#52)はいずれも実装済みのため、
 * 3導線とも実リンクとして検証する(現時点で「準備中」プレースホルダは無し)。
 * 対局画面ルートへの遷移 E2E はルート実装後に #30 で追加する。
 */
test.describe("トップページ(ロビー)", () => {
  test("200 で表示され、lang とタイトルが実態と一致する", async ({ page }) => {
    const response = await page.goto("/");

    expect(response?.status()).toBe(200);
    // layout.tsx: <html lang="ja">
    await expect(page.locator("html")).toHaveAttribute("lang", "ja");
    // layout.tsx: metadata.title.default
    await expect(page).toHaveTitle("四兄弟麻雀 - FourBrosMahjong");
  });

  test("四兄弟・全メニュー導線・fanmade表記を仕様どおり表示する", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(page.getByRole("main")).toBeVisible();
    // page.tsx: <h1>四兄弟麻雀</h1>
    await expect(
      page.getByRole("heading", { level: 1, name: "四兄弟麻雀" }),
    ).toBeVisible();
    const menu = page.getByRole("navigation", { name: "メインメニュー" });
    await expect(menu).toBeVisible();
    await expect(
      menu.getByRole("link", { name: /対局を始める/ }),
    ).toHaveAttribute("href", "/game");
    await expect(
      menu.getByRole("link", { name: /オンライン対戦/ }),
    ).toHaveAttribute("href", "/online");
    await expect(
      menu.getByRole("link", { name: /ルール説明/ }),
    ).toHaveAttribute("href", "/rules");
    await expect(menu.getByRole("link", { name: /戦績/ })).toHaveAttribute(
      "href",
      "/history",
    );
    await expect(menu.getByRole("link", { name: /設定/ })).toHaveAttribute(
      "href",
      "/settings",
    );

    const lineup = page.getByRole("region", { name: "四兄弟" });
    await expect(lineup.getByRole("article")).toHaveCount(4);
    for (const [index, [id, name]] of [
      ["p0", "粗悪品"],
      ["p1", "竜二"],
      ["p2", "マサキ"],
      ["p3", "糸瓜"],
    ].entries()) {
      const card = lineup.getByRole("article").nth(index);
      await expect(card).toHaveAttribute("data-character-id", id);
      await expect(card.getByRole("heading", { name })).toBeVisible();
      const image = card.locator("img");
      await expect(image).toHaveAttribute("alt", "");
      await expect(image).toHaveAttribute(
        "src",
        /\/characters\/.*-portrait\.avif$/,
      );
    }
    await expect(page.getByText(/非公式ファンメイド作品/)).toBeVisible();

    for (const forbidden of [
      "①",
      "ロビー（トップページ）",
      "お知らせ",
      "音量ON",
      "ver1.0.0",
      "東家",
      "南家",
      "西家",
      "北家",
      "あなた",
    ]) {
      await expect(page.getByText(forbidden, { exact: false })).toHaveCount(0);
    }
  });

  test("4 portraitを1回ずつ読み、LCP候補だけを高優先にする", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForLobbyVisuals(page);

    const images = page.locator(".lobby-character-image");
    await expect(images).toHaveCount(4);
    await expect(images.nth(0)).toHaveAttribute("fetchpriority", "high");
    await expect(images.nth(0)).toHaveAttribute("loading", "eager");
    for (let index = 1; index < 4; index += 1) {
      await expect(images.nth(index)).toHaveAttribute("fetchpriority", "auto");
      await expect(images.nth(index)).toHaveAttribute("loading", "lazy");
    }

    const portraitLoads = await page.evaluate(() =>
      performance
        .getEntriesByType("resource")
        .filter(
          (entry) =>
            entry instanceof PerformanceResourceTiming &&
            new URL(entry.name).pathname.startsWith("/characters/") &&
            new URL(entry.name).pathname.endsWith("-portrait.avif"),
        )
        .map((entry) => ({ name: entry.name, duration: entry.duration })),
    );
    expect(new Set(portraitLoads.map(({ name }) => name)).size).toBe(4);
    expect(portraitLoads).toHaveLength(4);
    for (const load of portraitLoads) {
      expect(Number.isFinite(load.duration)).toBe(true);
      expect(load.duration).toBeGreaterThanOrEqual(0);
    }
  });

  for (const viewport of LOBBY_VIEWPORTS) {
    test(`${viewport.label}で横溢れせず人物gridと44px操作領域を保つ`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.goto("/");
      await expect(
        page.getByRole("heading", { level: 1, name: "四兄弟麻雀" }),
      ).toBeVisible();

      const lineup = page.getByRole("region", { name: "四兄弟" });
      const columns = await lineup.evaluate((element) =>
        getComputedStyle(element)
          .gridTemplateColumns.split(" ")
          .filter(Boolean),
      );
      expect(columns).toHaveLength(viewport.columns);
      for (const id of CHARACTER_IDS) {
        const card = lineup.locator(`[data-character-id="${id}"]`);
        const image = card.locator("img");
        await expect(image).toBeVisible();
        await expect
          .poll(() =>
            image.evaluate((node) =>
              node instanceof HTMLImageElement ? node.naturalWidth : 0,
            ),
          )
          .toBeGreaterThan(0);
        await expectInsideViewport(card);
      }

      const menuLinks = page
        .getByRole("navigation", { name: "メインメニュー" })
        .getByRole("link");
      await expect(menuLinks).toHaveCount(5);
      for (const link of await menuLinks.all()) {
        await expectMinimumTarget(link);
        await expectInsideViewport(link);
      }
      await expectNoHorizontalOverflow(page);

      await waitForLobbyVisuals(page);
      // Next dev自身の診断portalはプロダクトUIではないためvisual baselineから除外する。
      await page.addStyleTag({
        content: "nextjs-portal { display: none !important; }",
      });
      await expect(page.locator("nextjs-portal")).toBeHidden();
      await expect(page).toHaveScreenshot(`${viewport.label}-lobby.png`, {
        fullPage: true,
        animations: "disabled",
        maxDiffPixelRatio: 0.005,
        stylePath: "e2e/visual-screenshot.css",
      });
    });
  }

  test("keyboardでprimaryへ到達しEnterで対局画面へ進める", async ({ page }) => {
    await page.goto("/");
    const primary = page.getByRole("link", { name: /対局を始める/ });

    await page.keyboard.press("Tab");
    await expect(primary).toBeFocused();
    // Next devの初回並列compileでdocument focusが一瞬揺れても、Tabで到達した
    // 同じanchorへkeyboard eventを送ってネイティブEnter activationを検証する。
    await primary.press("Enter");
    await expect(page).toHaveURL(/\/game$/, { timeout: 10_000 });
  });

  test("keyboardのTab順がprimaryから4補助導線へ続く", async ({ page }) => {
    await page.goto("/");

    for (const href of [
      "/game",
      "/online",
      "/rules",
      "/history",
      "/settings",
    ]) {
      await page.keyboard.press("Tab");
      await expect(page.locator(`a[href="${href}"]`)).toBeFocused();
    }
  });

  test("reduced motionと長い補助文言でも状態・layoutを維持する", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto("/");

    const primary = page.getByRole("link", { name: /対局を始める/ });
    await expect(primary).toHaveCSS("transition-duration", "0s");
    await primary.hover();
    await expect(primary).toHaveCSS("transform", "none");
    await page
      .locator(".lobby-secondary-description")
      .first()
      .evaluate((node) => {
        node.textContent =
          "非常に長い説明文でも折り返して画面の横幅を超えないことを確認するための表示テキスト".repeat(
            4,
          );
      });
    await expectNoHorizontalOverflow(page);
    await expectInsideViewport(page.locator(".lobby-secondary-action").first());
  });

  test("manual light/darkとsystemのeffective UI tokensが保存意味どおり切り替わる", async ({
    page,
  }) => {
    const cases = [
      { stored: "light", os: "dark", canvas: "#f5f0e6", attr: "light" },
      { stored: "dark", os: "light", canvas: "#080a09", attr: "dark" },
      { stored: null, os: "light", canvas: "#f5f0e6", attr: null },
      { stored: null, os: "dark", canvas: "#080a09", attr: null },
    ] as const;

    await page.goto("/");
    for (const themeCase of cases) {
      await page.evaluate((stored) => {
        if (stored === null) localStorage.removeItem("theme");
        else localStorage.setItem("theme", stored);
      }, themeCase.stored);
      await page.emulateMedia({ colorScheme: themeCase.os });
      await page.reload();
      if (themeCase.attr === null) {
        await expect(page.locator("html")).not.toHaveAttribute("data-theme");
      } else {
        await expect(page.locator("html")).toHaveAttribute(
          "data-theme",
          themeCase.attr,
        );
      }
      expect(
        await page
          .locator(".design-page-shell")
          .evaluate((node) =>
            getComputedStyle(node).getPropertyValue("--ui-canvas").trim(),
          ),
      ).toBe(themeCase.canvas);
    }
  });

  test("forced colorsでは和柄を無効化しfocus outlineを保つ", async ({
    page,
  }) => {
    await page.emulateMedia({ forcedColors: "active" });
    await page.goto("/");

    await expect(page.locator(".design-page-shell")).toHaveCSS(
      "background-image",
      "none",
    );
    expect(
      await page
        .locator(".lobby-hero")
        .evaluate((node) => getComputedStyle(node, "::before").display),
    ).toBe("none");
    await page.keyboard.press("Tab");
    const primary = page.getByRole("link", { name: /対局を始める/ });
    await expect(primary).toBeFocused();
    expect(
      await primary.evaluate((node) =>
        Number.parseFloat(getComputedStyle(node).outlineWidth),
      ),
    ).toBeGreaterThanOrEqual(2);
    await expect(primary).not.toHaveCSS("outline-style", "none");
  });

  test("ロビーから /rules へ遷移し、戻れる", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("link", { name: /ルール説明/ }).click();
    await expect(page).toHaveURL(/\/rules$/);
    await expect(page).toHaveTitle("ルール説明 | 四兄弟麻雀");
    await expect(
      page.getByRole("heading", { level: 1, name: "ルール説明" }),
    ).toBeVisible();
    // ラベルは「配給原点・返し: 」のようにコロン+空白を伴って描画されるため部分一致で確認する。
    await expect(page.getByText("配給原点・返し").first()).toBeVisible();
    await expect(
      page.getByText(/1人35,000点持ち\(4人合計140,000点\)、40,000点返し/),
    ).toBeVisible();
    await expect(page.getByText(/1位にはオカ20,000を加算/)).toBeVisible();

    // 「ロビーへ戻る」導線でロビーに戻れる(spec 6.3)
    await page.getByRole("link", { name: "ロビーへ戻る" }).first().click();
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "四兄弟麻雀" }),
    ).toBeVisible();
  });

  test("create-next-app デフォルトの文言/導線が残っていない", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(page.getByText(/Get started by editing/i)).toHaveCount(0);
    await expect(
      page.getByText("Save and see your changes instantly."),
    ).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Deploy now/i })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("link", { name: /Read our docs/i }),
    ).toHaveCount(0);
    await expect(page.getByAltText("Next.js logo")).toHaveCount(0);
    await expect(page.getByAltText("Vercel logomark")).toHaveCount(0);
  });

  test("ダークモード設定でも主要要素が見える", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    const response = await page.goto("/");

    expect(response?.status()).toBe(200);
    await expect(page.getByRole("main")).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 1, name: "四兄弟麻雀" }),
    ).toBeVisible();
  });
});

/**
 * 設定ページ(`/settings`)の E2E 検証(#52)。ロビー ⇄ 設定の遷移、
 * ダークモード手動切替の DOM 反映(`<html data-theme>`)とリロード後の保持、
 * OS 設定尊重(未選択時は data-theme を付与しない)を確認する。
 */
test.describe("設定ページ(ダークモード手動切替)", () => {
  test("ロビーから遷移し、テーマ切替がリロード後も保持され、戻れる", async ({
    page,
  }) => {
    await page.goto("/");

    // ロビー → 設定
    await page.getByRole("link", { name: /設定/ }).click();
    await expect(page).toHaveURL(/\/settings$/);
    // layout.tsx の title テンプレートが適用されたページ固有タイトル(#94)。
    await expect(page).toHaveTitle("設定 | 四兄弟麻雀");
    await expect(
      page.getByRole("heading", { level: 1, name: "設定" }),
    ).toBeVisible();

    // 初期(未選択)は data-theme を付与せず OS 設定へ委譲する。
    expect(await page.locator("html").getAttribute("data-theme")).toBeNull();
    await expect(
      page.getByRole("radio", { name: "システム設定に従う" }),
    ).toBeChecked();

    // ダークを手動選択 → <html data-theme="dark">
    await page.getByRole("radio", { name: "ダーク" }).check();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    // リロードしても保持される(localStorage + layout の初期化スクリプト)。
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.getByRole("radio", { name: "ダーク" })).toBeChecked();

    // 設定 → ロビーへ戻る
    await page.getByRole("link", { name: "ロビーへ戻る" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "四兄弟麻雀" }),
    ).toBeVisible();
  });

  test("OS がダークでも手動でライト固定でき、その選択が優先される", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/settings");

    await page.getByRole("radio", { name: "ライト" }).check();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.getByRole("radio", { name: "ライト" })).toBeChecked();
  });

  test("別タブのテーマ変更がロビーにも即時反映される(issue #179)", async ({
    page,
    context,
  }) => {
    const settingsPage = await context.newPage();
    await page.goto("/");
    await settingsPage.goto("/settings");

    await settingsPage.getByRole("radio", { name: "ダーク" }).check();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    await settingsPage.getByRole("radio", { name: "ライト" }).check();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });

  test("保存失敗時もradio・状態文言・実テーマが一致する(issue #180)", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Storage.prototype.setItem = () => {
        throw new DOMException("QuotaExceededError");
      };
    });
    await page.goto("/settings");

    await page.getByRole("radio", { name: "ダーク" }).click();

    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.getByRole("radio", { name: "ダーク" })).toBeChecked();
    await expect(page.getByText(/現在の表示:/)).toHaveText(
      "現在の表示: ダーク(手動で固定中)",
    );
  });
});
