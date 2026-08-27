import { expect, type Locator, type Page, test } from "@playwright/test";

const SETTINGS_VISUAL_CASES = [
  { label: "phone-320-dark", width: 320, height: 800, theme: "dark" },
  { label: "phone-375-light", width: 375, height: 812, theme: "light" },
  { label: "tablet-768-dark", width: 768, height: 1024, theme: "dark" },
  { label: "desktop-light", width: 1280, height: 900, theme: "light" },
  { label: "desktop-1440-dark", width: 1440, height: 900, theme: "dark" },
] as const;

const CHARACTER_IDS = ["p0", "p1", "p2", "p3"] as const;
const DEFAULT_NAMES = ["粗悪品", "竜二", "マサキ", "糸瓜"] as const;

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
}

async function expectMinimumTarget(target: Locator): Promise<void> {
  const box = await target.boundingBox();
  expect(box).not.toBeNull();
  expect(box?.width).toBeGreaterThanOrEqual(44);
  expect(box?.height).toBeGreaterThanOrEqual(44);
}

async function waitForSettingsVisuals(page: Page): Promise<void> {
  await expect(page.getByRole("radio").first()).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      Array.from(
        document.querySelectorAll<HTMLImageElement>(".settings-name-card img"),
      ).map((image) =>
        image.complete && image.naturalWidth > 0
          ? Promise.resolve()
          : new Promise<void>((resolve, reject) => {
              image.addEventListener("load", () => resolve(), { once: true });
              image.addEventListener(
                "error",
                () => reject(new Error(`Failed to load ${image.src}`)),
                { once: true },
              );
            }),
      ),
    );
  });
}

test.describe("Issue #712 Phase B2 設定デザイン", () => {
  test("p0-p3のSSOT順・名前・portraitを固定席表現なしで表示する", async ({
    page,
  }) => {
    await page.goto("/settings");

    const cards = page.locator(".settings-name-card");
    await expect(cards).toHaveCount(4);
    for (const [index, id] of CHARACTER_IDS.entries()) {
      const card = cards.nth(index);
      await expect(card).toHaveAttribute("data-character-id", id);
      const accessibleLabel =
        index === 0
          ? `${DEFAULT_NAMES[index]}（あなた）`
          : DEFAULT_NAMES[index];
      await expect(card.getByLabel(accessibleLabel)).toHaveValue(
        DEFAULT_NAMES[index],
      );
      await expect(card.locator("img")).toHaveAttribute("alt", "");
      await expect(card.locator("img")).toHaveAttribute(
        "src",
        /\/characters\/.*-portrait\.avif$/,
      );
    }

    for (const forbidden of [
      "③",
      "設定画面",
      "東家",
      "南家",
      "西家",
      "北家",
      "サウンド",
      "音量",
      "その他",
      "へちま",
    ]) {
      await expect(page.getByText(forbidden, { exact: false })).toHaveCount(0);
    }
    await expect(cards.nth(0)).toContainText("粗悪品（あなた）");
    await expect(cards.nth(3)).not.toContainText("あなた");
    await expect(
      page.getByRole("link", { name: "ロビーへ戻る" }),
    ).toHaveAttribute("href", "/");
    await expect(
      page.getByRole("link", { name: /戦績を見る/ }),
    ).toHaveAttribute("href", "/history");
  });

  test("theme keyとradio DOM順を保ちsystem選択でkeyを削除する", async ({
    page,
  }) => {
    await page.addInitScript(() => localStorage.setItem("theme", "dark"));
    await page.goto("/settings");

    const radios = page
      .getByRole("group", {
        name: "テーマ(表示モード)",
      })
      .getByRole("radio");
    await expect(radios).toHaveCount(3);
    expect(
      await radios.evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("value")),
      ),
    ).toEqual(["system", "light", "dark"]);
    await expect(radios.nth(2)).toBeChecked();
    await radios.nth(0).check();
    await expect(page.locator("html")).not.toHaveAttribute("data-theme");
    expect(await page.evaluate(() => localStorage.getItem("theme"))).toBeNull();
  });

  test("system選択中はOS theme変更へ追従しkeyを作らない", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/settings");
    const status = page
      .getByRole("group", { name: "テーマ(表示モード)" })
      .locator('[aria-live="polite"]');
    await expect(status).toContainText("ライト(システム設定に追従中)");

    await page.emulateMedia({ colorScheme: "dark" });
    await expect(status).toContainText("ダーク(システム設定に追従中)");
    await expect(page.locator("html")).not.toHaveAttribute("data-theme");
    expect(await page.evaluate(() => localStorage.getItem("theme"))).toBeNull();
  });

  test("themeと名前を別タブへ同期する", async ({ context, page }) => {
    const other = await context.newPage();
    await Promise.all([page.goto("/settings"), other.goto("/settings")]);

    await page.getByRole("radio", { name: "ダーク" }).check();
    await expect(other.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(other.getByRole("radio", { name: "ダーク" })).toBeChecked();

    await page.getByLabel("竜二").fill("同期名");
    await page.getByRole("button", { name: "名前を保存" }).click();
    await expect(other.getByLabel("竜二")).toHaveValue("同期名");
    await other.close();
  });

  test("storage保存失敗時もthemeと名前の下書きを失わず案内する", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Storage.prototype.setItem = () => {
        throw new DOMException("Storage disabled", "SecurityError");
      };
    });
    await page.goto("/settings");

    await page.getByRole("radio", { name: "ダーク" }).check();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.getByRole("radio", { name: "ダーク" })).toBeChecked();

    await page.getByLabel("竜二").fill("保存失敗でも残る");
    await page.getByRole("button", { name: "名前を保存" }).click();
    await expect(page.getByLabel("竜二")).toHaveValue("保存失敗でも残る");
    await expect(page.getByText(/保存できませんでした/)).toBeVisible();
  });

  test("320px・長い保存名でも横溢れせず44px操作領域を保つ", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.addInitScript(() => {
      localStorage.setItem(
        "four-bros-mahjong.playerNames.v1",
        JSON.stringify([
          "１２３４５６７８９０１２",
          "👨‍👩‍👧‍👦👨‍👩‍👧‍👦👨‍👩‍👧‍👦",
          "長い名前の表示確認",
          "糸瓜カスタム名",
        ]),
      );
    });
    await page.goto("/settings");
    await expect(page.getByLabel("粗悪品（あなた）")).toHaveValue(
      "１２３４５６７８９０１２",
    );

    for (const target of await page
      .locator(
        ".settings-theme-option, .settings-name-input, .settings-save-button, .settings-reset-button, .settings-history-link, .settings-back-link",
      )
      .all()) {
      await expectMinimumTarget(target);
    }
    await expectNoHorizontalOverflow(page);
  });

  test("keyboardのTabと矢印だけでradioを順に変更できる", async ({ page }) => {
    await page.goto("/settings");

    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("link", { name: "ロビーへ戻る" }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("navigation", { name: "画面メニュー" }).locator("summary"),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("radio", { name: "システム設定に従う" }),
    ).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("radio", { name: "ライト" })).toBeChecked();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("radio", { name: "ダーク" })).toBeChecked();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });

  test("forced-colorsとreduced-motionでも装飾依存せず操作できる", async ({
    page,
  }) => {
    await page.emulateMedia({
      forcedColors: "active",
      reducedMotion: "reduce",
    });
    await page.goto("/settings");

    await expect(page.locator(".design-page-shell")).toHaveCSS(
      "background-image",
      "none",
    );
    const selected = page.locator(
      '.settings-theme-option[data-selected="true"]',
    );
    await expect(selected).toHaveCSS("outline-style", "solid");
    await expect(selected).toHaveCSS("transition-duration", "0s");
    await page.getByRole("radio", { name: "ダーク" }).focus();
    await expect(page.getByRole("radio", { name: "ダーク" })).not.toHaveCSS(
      "outline-style",
      "none",
    );
  });

  for (const visualCase of SETTINGS_VISUAL_CASES) {
    test(`${visualCase.label}のtheme固定visualとresponsive配置を保つ`, async ({
      page,
    }) => {
      await page.setViewportSize(visualCase);
      await page.addInitScript(
        (theme) => localStorage.setItem("theme", theme),
        visualCase.theme,
      );
      await page.goto("/settings");
      await expect(page.locator("html")).toHaveAttribute(
        "data-theme",
        visualCase.theme,
      );
      await waitForSettingsVisuals(page);
      await expectNoHorizontalOverflow(page);

      await page.addStyleTag({
        content: "nextjs-portal { display: none !important; }",
      });
      await expect(page.locator("nextjs-portal")).toBeHidden();
      await expect(page).toHaveScreenshot(`${visualCase.label}-settings.png`, {
        fullPage: true,
        animations: "disabled",
        maxDiffPixelRatio: 0.005,
        stylePath: "e2e/visual-screenshot.css",
      });
    });
  }
});
