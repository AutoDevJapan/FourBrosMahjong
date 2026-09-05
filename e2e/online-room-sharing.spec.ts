import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.describe("オンラインルーム共有リンク (#605)", () => {
  test("共有URLからルームコードを引き継ぎ、キーボード操作できる", async ({
    page,
  }) => {
    await page.goto("/online?room=abc234");

    await expect(
      page.getByRole("heading", { level: 1, name: "オンライン対戦" }),
    ).toBeVisible();
    const roomCodeInput = page.getByLabel("ルームコード");
    await expect(roomCodeInput).toHaveValue("ABC234");

    await roomCodeInput.focus();
    await expect(roomCodeInput).toBeFocused();
    await page.getByLabel("表示名").fill("テスト参加者");
    const joinButton = page.getByRole("button", { name: "参加する" });
    await expect(joinButton).toBeEnabled();
    await joinButton.focus();
    await expect(joinButton).toBeFocused();

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  });

  test("生成されないI/O/0/1を共有URLから有効なコードとして引き継がない", async ({
    page,
  }) => {
    await page.goto("/online?room=abci01");

    const roomCodeInput = page.getByLabel("ルームコード");
    await expect(roomCodeInput).toHaveValue("");
    await expect(page.getByRole("button", { name: "参加する" })).toBeDisabled();
  });

  test("貼り付けたコードの前後空白を6文字制限前に正規化する", async ({
    page,
  }) => {
    await page.goto("/online");

    await page.getByLabel("表示名").fill("テスト参加者");
    const roomCodeInput = page.getByLabel("ルームコード");
    await roomCodeInput.focus();
    await page.keyboard.insertText(" ABC234 ");

    await expect(roomCodeInput).toHaveValue("ABC234");
    await expect(page.getByRole("button", { name: "参加する" })).toBeEnabled();
  });
});
