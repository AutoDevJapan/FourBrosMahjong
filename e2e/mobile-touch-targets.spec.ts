import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";

const NARROW_WIDTHS = [320, 360] as const;
const MIN_TOUCH_SIZE = 44;

async function expectTouchTarget(
  target: Locator,
  label: string,
  checkWidth = false,
): Promise<void> {
  await expect(target, `${label} が表示されていません`).toBeVisible();
  const box = await target.boundingBox();
  expect(box, `${label} の寸法を取得できません`).not.toBeNull();
  expect(box?.height, `${label} の高さが44px未満`).toBeGreaterThanOrEqual(
    MIN_TOUCH_SIZE,
  );
  if (checkWidth) {
    expect(box?.width, `${label} の幅が44px未満`).toBeGreaterThanOrEqual(
      MIN_TOUCH_SIZE,
    );
  }
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

      await expectTouchTarget(
        page.getByRole("link", { name: "ロビーへ戻る" }),
        "ゲームのロビーへ戻る",
      );
      const openButton = page.getByRole("button", { name: "全体盤面" });
      await expectTouchTarget(openButton, "全体盤面", true);
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
        true,
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
