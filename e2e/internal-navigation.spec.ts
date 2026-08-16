import { expect, test } from "@playwright/test";

const navigationCases = [
  { source: "/rules", target: "設定", href: "/settings" },
  { source: "/settings", target: "戦績", href: "/history" },
  { source: "/history", target: "ルール説明", href: "/rules" },
  { source: "/online", target: "戦績", href: "/history" },
  { source: "/game/result", target: "設定", href: "/settings" },
] as const;

test.describe("内部画面の共通ナビゲーション (#614)", () => {
  for (const { source, target, href } of navigationCases) {
    test(`${source} から ${target} へ2操作以内で移動できる`, async ({
      page,
    }) => {
      await page.goto(source);

      const navigation = page.getByRole("navigation", { name: "画面メニュー" });
      await expect(navigation).toBeVisible();
      await navigation.getByText("他の画面へ", { exact: true }).click();

      const targetLink = navigation.getByRole("link", {
        name: new RegExp(target),
      });
      await expect(targetLink).toBeVisible();
      await expect(targetLink).toHaveAttribute("href", href);
      await targetLink.click();
      await expect(page).toHaveURL(new RegExp(`${href}$`));
    });
  }

  test("狭幅でも折りたたみとリンクのタップ領域を維持し横スクロールしない", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto("/rules");

    const navigation = page.getByRole("navigation", { name: "画面メニュー" });
    await navigation.getByText("他の画面へ", { exact: true }).click();
    const links = navigation.getByRole("link");
    await expect(links).toHaveCount(4);

    for (let index = 0; index < 4; index += 1) {
      const box = await links.nth(index).boundingBox();
      expect(box, `画面メニュー ${index + 1} の矩形`).not.toBeNull();
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }

    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
  });

  test("キーボードではロビー、メニュー、リンクの順に到達できる", async ({
    page,
  }) => {
    await page.goto("/settings");

    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("link", { name: "ロビーへ戻る" }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    const navigation = page.getByRole("navigation", { name: "画面メニュー" });
    await expect(navigation.locator("summary")).toBeFocused();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    await expect(
      navigation.getByRole("link", { name: /対局を開始/ }),
    ).toBeFocused();
  });

  test("対局中は画面メニューを表示せず、離脱導線を増やさない", async ({
    page,
  }) => {
    await page.goto("/game?seed=0");

    await expect(
      page.getByRole("navigation", { name: "画面メニュー" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "ロビーへ戻る" }),
    ).toBeVisible();
  });
});
