import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.describe("オンラインロビーの参加条件", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/online");
    await expect(
      page.getByRole("heading", { level: 1, name: "オンライン対戦" }),
    ).toBeVisible();
  });

  test("disabled理由が入力欄と参加ボタンからキーボード・支援技術へ伝わる", async ({
    page,
  }) => {
    const nameInput = page.getByRole("textbox", { name: "表示名" });
    const roomCodeInput = page.getByRole("textbox", { name: "ルームコード" });
    const joinButton = page.getByRole("button", { name: "参加する" });

    await expect(joinButton).toBeDisabled();
    await expect(nameInput).toHaveAttribute(
      "aria-describedby",
      "online-lobby-name-requirement",
    );
    await expect(roomCodeInput).toHaveAttribute(
      "aria-describedby",
      "online-lobby-room-code-requirement",
    );
    await expect(joinButton).toHaveAccessibleDescription(
      /表示名を入力してください。.*6文字のルームコードが必要です/,
    );
    await expect(page.getByRole("status")).toContainText(
      "表示名を入力してください。",
    );
    await expect(page.getByRole("status")).toContainText(
      "参加には6文字のルームコードが必要です。",
    );

    await nameInput.focus();
    await page.keyboard.press("Tab");
    await expect(roomCodeInput).toBeFocused();
  });

  test("表示名と正しい6文字コードの入力で参加ボタンが有効になる", async ({
    page,
  }) => {
    const nameInput = page.getByRole("textbox", { name: "表示名" });
    const roomCodeInput = page.getByRole("textbox", { name: "ルームコード" });
    const joinButton = page.getByRole("button", { name: "参加する" });

    await nameInput.fill("たろう");
    await roomCodeInput.fill("ABC!@#");
    await expect(joinButton).toBeDisabled();
    await expect(roomCodeInput).toHaveAccessibleDescription(
      /英大文字と2〜9の数字を使った6文字で入力してください/,
    );

    await roomCodeInput.fill("ABC23");
    await expect(joinButton).toBeDisabled();
    await expect(roomCodeInput).toHaveAccessibleDescription(
      /あと1文字入力してください/,
    );

    await roomCodeInput.fill("ABC234");
    await expect(joinButton).toBeEnabled();
    await expect(joinButton).toHaveAccessibleDescription(
      /参加条件を満たしています。参加できます。/,
    );

    await roomCodeInput.focus();
    await page.keyboard.press("Tab");
    await expect(joinButton).toBeFocused();
  });

  test("初期ロビーの入力条件にaxe違反がない", async ({ page }) => {
    const results = await new AxeBuilder({ page }).include("main").analyze();
    expect(results.violations).toEqual([]);
  });
});
