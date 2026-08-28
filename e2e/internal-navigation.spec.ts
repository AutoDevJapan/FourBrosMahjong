import { expect, type Page, test } from "@playwright/test";
import {
  installWebSocketStub,
  type OnlineTestWindow,
  onlineSnapshotFixture,
} from "./helpers/onlineTest";
import { SCREENS, type Screen } from "./screens";

const navigationCases = [
  { source: "/rules", target: "設定", targetPath: "/settings" },
  { source: "/settings", target: "戦績", targetPath: "/history" },
  { source: "/history", target: "ルール説明", targetPath: "/rules" },
  { source: "/online", target: "戦績", targetPath: "/history" },
  { source: "/game/result", target: "設定", targetPath: "/settings" },
] as const;

function screenForPath(path: string): Screen {
  const screen = SCREENS.find((candidate) => candidate.path === path);
  if (!screen) throw new Error(`内部画面インベントリに未登録です: ${path}`);
  return screen;
}

/** SSRの殻だけでなく、画面固有のclient islandまで操作可能になったことを待つ。 */
async function waitForScreenReady(page: Page, screen: Screen): Promise<void> {
  await expect(
    page.getByRole("heading", { level: 1, name: screen.heading }),
  ).toBeVisible();
  if (screen.clientReady) {
    await expect(screen.clientReady(page)).toBeAttached();
  }
}

async function waitForScreenMenuReady(page: Page) {
  const navigation = page.getByRole("navigation", { name: "画面メニュー" });
  await expect(navigation).toHaveAttribute("data-navigation-hydrated", "true");
  return navigation;
}

async function openScreenMenu(page: Page) {
  const navigation = await waitForScreenMenuReady(page);
  const disclosure = navigation.locator("details");
  await expect(disclosure).toBeVisible();
  await expect(disclosure).not.toHaveAttribute("open", "");
  await disclosure.locator("summary").click();
  await expect(disclosure).toHaveAttribute("open", "");
  return navigation;
}

test.describe("内部画面の共通ナビゲーション (#614)", () => {
  for (const { source, target, targetPath } of navigationCases) {
    test(`${source} から ${target} へ2操作以内で移動できる`, async ({
      page,
    }) => {
      await page.goto(source);
      await waitForScreenReady(page, screenForPath(source));

      const navigation = await openScreenMenu(page);

      const targetLink = navigation.getByRole("link", {
        name: new RegExp(target),
      });
      await expect(targetLink).toBeVisible();
      await expect(targetLink).toHaveAttribute("href", targetPath);
      await targetLink.click();
      await expect(page).toHaveURL((url) => url.pathname === targetPath);
      await waitForScreenReady(page, screenForPath(targetPath));
    });
  }

  test("狭幅でも折りたたみとリンクのタップ領域を維持し横スクロールしない", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto("/rules");
    await waitForScreenReady(page, screenForPath("/rules"));

    const navigation = await openScreenMenu(page);
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
    await waitForScreenReady(page, screenForPath("/settings"));
    const navigation = await waitForScreenMenuReady(page);

    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("link", { name: "ロビーへ戻る" }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(navigation.locator("summary")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(navigation.locator("details")).toHaveAttribute("open", "");
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
