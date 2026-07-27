import { expect, type Locator, type Page, test } from "@playwright/test";

/** 全体盤面モーダルを開き、トリガーとダイアログの locator を返す。 */
async function openFullBoard(page: Page) {
  const opener = page.getByRole("button", { name: "全体盤面" });
  const dialog = page.getByRole("dialog", { name: "全体盤面" });
  await expect(opener).toBeVisible();
  // 事前にキーボード相当のフォーカスを与えたうえでポインター起動する。WebKit は
  // click でトリガーをフォーカスしないだけでなく既存のフォーカスも落とすため、
  // 「開く直前は合っていた activeElement」に依存できないことまで含めて固定する。
  await opener.focus();
  await opener.click();
  await expect(dialog).toBeVisible();
  return { opener, dialog };
}

async function reopen(opener: Locator, dialog: Locator) {
  await opener.click();
  await expect(dialog).toBeVisible();
}

test.describe("モーダル終了時のフォーカス復帰(#369)", () => {
  test("Escape・閉じるボタン・背景クリックの全経路でトリガーへ戻る", async ({
    page,
  }) => {
    // 段階②(卓幅 < 360px)でのみ「全体盤面」トリガーが現れる。
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto("/game?seed=0");

    const { opener, dialog } = await openFullBoard(page);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();

    await reopen(opener, dialog);
    await page.getByRole("button", { name: "閉じる" }).click();
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();

    await reopen(opener, dialog);
    // dialog の外側(overlay)をクリックして閉じる。座標を直接叩く page.mouse は
    // actionability を待たないため、overlay の locator 相対位置でクリックする。
    await page.locator('[role="presentation"]').click({
      position: { x: 2, y: 2 },
    });
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });
});
