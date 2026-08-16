import { expect, test } from "@playwright/test";
import {
  installWebSocketStub,
  type OnlineTestWindow,
  onlineSnapshotFixture,
} from "./helpers/onlineTest";

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

  test("接続後オンライン対局中も画面メニューを表示しない", async ({ page }) => {
    await page.goto("/online");
    await installWebSocketStub(page);
    await page.getByLabel("表示名").fill("たろう");
    await page.getByLabel("ルームコード").fill("ABC234");
    await page.getByRole("button", { name: "参加する" }).click();
    await expect(
      page.locator('[data-connection-status="connecting"]'),
    ).toBeVisible();

    await page.evaluate(() => {
      const socket = (window as unknown as OnlineTestWindow)
        .__fourBrosOnlineSockets[0];
      if (!socket) throw new Error("オンラインテスト用socketがありません");
      socket.open();
    });
    await page.evaluate((snapshot) => {
      const socket = (window as unknown as OnlineTestWindow)
        .__fourBrosOnlineSockets[0];
      if (!socket) throw new Error("オンラインテスト用socketがありません");
      socket.message({
        type: "session",
        token: "t".repeat(24),
        snapshot,
      });
    }, onlineSnapshotFixture());

    await expect(
      page.locator('[data-connection-status="connected"]'),
    ).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "画面メニュー" }),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: "退出" })).toBeVisible();
  });
});
