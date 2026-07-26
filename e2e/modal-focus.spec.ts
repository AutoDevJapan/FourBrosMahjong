import { expect, type Page, test } from "@playwright/test";

async function openFullBoard(page: Page) {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/game");

  const opener = page.getByRole("button", { name: "全体盤面" });
  await expect(opener).toBeVisible();
  await opener.focus();
  await opener.click();
  await expect(page.getByRole("dialog", { name: "全体盤面" })).toBeVisible();
  return opener;
}

test.describe("モーダル終了時のフォーカス復帰(#369)", () => {
  test("Escape・閉じるボタン・背景クリックの全経路でトリガーへ戻る", async ({
    page,
  }) => {
    const opener = await openFullBoard(page);
    await page.keyboard.press("Escape");
    await expect(opener).toBeFocused();

    await opener.click();
    await page.getByRole("button", { name: "閉じる" }).click();
    await expect(opener).toBeFocused();

    await opener.click();
    // dialog の外側にある overlay 左上をクリックする。
    await page.mouse.click(2, 2);
    await expect(page.getByRole("dialog", { name: "全体盤面" })).toBeHidden();
    await expect(opener).toBeFocused();
  });
});
