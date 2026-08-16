import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { walkToGameEnd } from "../src/components/game/finishedGameFixture";
import {
  installWebSocketStub,
  type OnlineTestWindow,
  onlineSnapshotFixture,
} from "./helpers/onlineTest";

const NARROW_WIDTHS = [320, 360] as const;
const MIN_TOUCH_SIZE = 44;

async function expectTouchTarget(
  target: Locator,
  label: string,
): Promise<void> {
  await expect(target, `${label} が表示されていません`).toBeVisible();
  const box = await target.boundingBox();
  expect(box, `${label} の寸法を取得できません`).not.toBeNull();
  expect(box?.width, `${label} の幅が44px未満`).toBeGreaterThanOrEqual(
    MIN_TOUCH_SIZE,
  );
  expect(box?.height, `${label} の高さが44px未満`).toBeGreaterThanOrEqual(
    MIN_TOUCH_SIZE,
  );
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

async function expectAxeClean(page: Page, include: string): Promise<void> {
  const results = await new AxeBuilder({ page }).include(include).analyze();
  expect(results.violations).toEqual([]);
}

test.describe("狭幅の主要操作タップ領域(#608)", () => {
  for (const width of NARROW_WIDTHS) {
    test(`${width}pxの対局操作・全体盤面モーダルが44px以上`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/game?seed=0");
      await expect(
        page.getByRole("heading", { level: 1, name: "対局画面" }),
      ).toBeVisible();
      await expect(
        page.getByRole("listbox", { name: "自家の手牌" }).first(),
      ).toBeVisible();

      const narrowDescription = page.getByTestId("narrow-board-description");
      await expect(narrowDescription).toBeVisible();
      await expect(narrowDescription).toHaveText(
        "狭い画面のため、自分の手牌を自動で優先表示しています。",
      );
      await expect(
        page.getByRole("button", { name: "自分手番フォーカス表示" }),
      ).toHaveCount(0);

      await expectTouchTarget(
        page.getByRole("link", { name: "ロビーへ戻る" }),
        "ゲームのロビーへ戻る",
      );
      const openButton = page.getByRole("button", { name: "全体盤面" });
      await expectTouchTarget(openButton, "全体盤面");
      const actionButtons = page
        .getByRole("group", { name: "操作パネル" })
        .getByRole("button");
      for (const [index, actionButton] of (
        await actionButtons.all()
      ).entries()) {
        await expectTouchTarget(actionButton, `操作パネル(${index + 1})`);
      }
      await expectNoHorizontalOverflow(page);
      await expectAxeClean(page, "main");

      await openButton.click();
      const dialog = page.getByRole("dialog", { name: "全体盤面" });
      await expect(dialog).toBeVisible();
      await expectTouchTarget(
        dialog.getByRole("button", { name: "閉じる" }),
        "全体盤面の閉じる",
      );
      await expectNoHorizontalOverflow(page);
      await expectAxeClean(page, '[role="dialog"]');
    });

    test(`${width}pxのオンライン入力・参加操作が44px以上`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/online");
      await expect(
        page.getByRole("heading", { level: 1, name: "オンライン対戦" }),
      ).toBeVisible();

      await expectTouchTarget(
        page.getByRole("link", { name: "ロビーへ戻る" }),
        "オンラインのロビーへ戻る",
      );
      await expectTouchTarget(page.getByLabel("表示名"), "表示名入力");
      await expectTouchTarget(
        page.getByLabel("ルームコード"),
        "ルームコード入力",
      );
      await expectTouchTarget(
        page.getByRole("button", { name: "新しいルームを作る" }),
        "新しいルームを作る",
      );
      const joinButton = page.getByRole("button", { name: "参加する" });
      await expectTouchTarget(joinButton, "参加する");

      await page.getByLabel("表示名").fill("たろう");
      await page.getByLabel("ルームコード").fill("ABC234");
      await expect(joinButton).toBeEnabled();
      await expectNoHorizontalOverflow(page);
      await expectAxeClean(page, "main");
    });
  }
});

test.describe("狭幅の接続後オンライン操作と結果導線(#628)", () => {
  for (const width of NARROW_WIDTHS) {
    test(`${width}pxの接続後オンライン操作が44px以上で退出できる`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
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
      const onlineGame = page.getByRole("region", { name: "オンライン対局" });
      await expect(onlineGame).toBeVisible();

      await expectTouchTarget(
        onlineGame.getByRole("button", {
          name: "ルームコード ABC234 をコピー",
        }),
        "ルームコード",
      );
      await expectTouchTarget(
        onlineGame.getByRole("button", { name: "コードをコピー" }),
        "コードをコピー",
      );
      await expectTouchTarget(
        onlineGame.getByRole("button", { name: "共有" }),
        "共有",
      );
      await expectTouchTarget(
        onlineGame.getByRole("button", { name: "退出" }),
        "退出",
      );
      await expectNoHorizontalOverflow(page);
      await expectAxeClean(page, "main");

      // Web Share API を明示的に無効化し、共有失敗時の手動フォールバックも固定する。
      await page.evaluate(() => {
        Object.defineProperty(navigator, "share", {
          configurable: true,
          value: undefined,
        });
      });
      await onlineGame.getByRole("button", { name: "共有" }).click();
      await expect(page.getByText("手動で共有する場合")).toBeVisible();
      await expectTouchTarget(
        onlineGame.getByRole("textbox", { name: "共有URL" }),
        "共有URL",
      );
      await expectTouchTarget(
        onlineGame.getByRole("button", { name: "URLを選択" }),
        "URLを選択",
      );
      await expectNoHorizontalOverflow(page);
      await expectAxeClean(page, "main");

      await onlineGame.getByRole("button", { name: "退出" }).click();
      await expect(
        page.getByRole("heading", { level: 1, name: "オンライン対戦" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "新しいルームを作る" }),
      ).toBeVisible();
    });

    test(`${width}pxの確定結果画面の対局後導線が44px以上で横溢れしない`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.addInitScript(
        (raw) => {
          sessionStorage.setItem("four-bros-mahjong.game.v1", raw);
        },
        JSON.stringify(walkToGameEnd(1).journal),
      );
      await page.goto("/game/result");
      await expect(
        page.getByRole("heading", { level: 2, name: "最終順位" }),
      ).toBeVisible();

      const main = page.getByRole("main");
      await expectTouchTarget(
        main.getByRole("link", { name: "ロビーへ戻る" }).first(),
        "結果画面ヘッダーのロビーへ戻る",
      );
      const afterGameNavigation = page.getByRole("navigation", {
        name: "対局後の導線",
      });
      await expectTouchTarget(
        afterGameNavigation.getByRole("button", { name: "もう一半荘" }),
        "もう一半荘",
      );
      await expectTouchTarget(
        afterGameNavigation.getByRole("link", { name: "戦績を見る" }),
        "戦績を見る",
      );
      await expectTouchTarget(
        afterGameNavigation.getByRole("link", { name: "ロビーへ戻る" }),
        "結果画面のロビーへ戻る",
      );
      await expectNoHorizontalOverflow(page);
      await expectAxeClean(page, "main");
    });
  }
});
