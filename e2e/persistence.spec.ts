import { expect, test } from "@playwright/test";

const visibleHand = (page: import("@playwright/test").Page) =>
  page.getByRole("listbox", { name: "自家の手牌" }).filter({ visible: true });

test.describe("対局状態のsession復元(#190)", () => {
  test("打牌後reloadで同じ局面を復元し、別seedは新規開始する", async ({
    page,
  }) => {
    await page.goto("/game?seed=0");
    const hand = visibleHand(page);
    const initial = await hand.getByRole("option").allTextContents();
    await hand
      .locator('[role="option"]:not([aria-disabled="true"])')
      .first()
      .click();
    await expect
      .poll(() => hand.getByRole("option").allTextContents())
      .not.toEqual(initial);
    const progressed = await hand.getByRole("option").allTextContents();

    await page.reload();
    await expect
      .poll(() => visibleHand(page).getByRole("option").allTextContents())
      .toEqual(progressed);

    await page.goto("/game?seed=1");
    await expect
      .poll(() => visibleHand(page).getByRole("option").allTextContents())
      .not.toEqual(progressed);
  });

  test("破損・旧version記録は例外なく新規対局へfallbackする", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      sessionStorage.setItem(
        "four-bros-mahjong.game.v1",
        JSON.stringify({ version: 0, seed: 0, actions: [{ type: "bad" }] }),
      );
    });
    await page.goto("/game?seed=0");
    await expect(visibleHand(page).getByRole("option")).toHaveCount(14);
  });

  test("半荘結果をresult reload後も保持する", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/game?seed=1");
    const board = page.locator("[data-phase]").first();
    for (let step = 0; step < 2000; step++) {
      const phase = await board.getAttribute("data-phase");
      const pending = await board.getAttribute("data-pending");
      if (phase === "gameEnd") break;
      if (phase === "roundEnd") {
        await page.getByRole("button", { name: "次の局へ" }).first().click();
      } else if (pending === "humanReact") {
        await page.getByRole("button", { name: "スルー" }).first().click();
      } else if (pending === "humanDiscard") {
        await visibleHand(page)
          .locator('[role="option"]:not([aria-disabled="true"])')
          .first()
          .click();
      }
    }
    await expect(page).toHaveURL(/\/game\/result$/);
    await expect(page.getByRole("heading", { name: "最終順位" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "最終順位" })).toBeVisible();
  });
});
