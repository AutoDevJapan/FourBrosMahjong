import { expect, test } from "@playwright/test";

/**
 * 対局者名の設定(issue #291)のブラウザ動線検証。
 *
 * `/settings` で保存 → `/game` の盤面 → リロード復元まで、同じ名前が一貫して出ることを確認する。
 */

const NAMES = ["わたし", "龍さん", "下ちゃん", "翔生くん"] as const;
const DEFAULT_NAMES = ["あなた", "一郎", "二郎", "三郎"] as const;

/** `/settings` で4人の名前を入力して保存する。 */
async function saveNames(
  page: import("@playwright/test").Page,
  names: readonly string[],
): Promise<void> {
  await page.goto("/settings");
  const labels = ["あなた(自家)", "対局者2", "対局者3", "対局者4"];
  for (const [index, label] of labels.entries()) {
    const input = page.getByLabel(label);
    await input.fill(names[index]);
  }
  await page.getByRole("button", { name: "名前を保存" }).click();
  await expect(page.getByText(/保存しました/)).toBeVisible();
}

test.describe("対局者名の設定 (#291)", () => {
  test("設定した名前が盤面に反映され、リロード後も保持される", async ({
    page,
  }) => {
    await saveNames(page, NAMES);

    await page.goto("/game?seed=0");
    for (const name of NAMES) {
      await expect(
        page.getByText(name, { exact: false }).first(),
        `盤面に「${name}」が表示される`,
      ).toBeVisible();
    }

    await page.reload();
    for (const name of NAMES) {
      await expect(
        page.getByText(name, { exact: false }).first(),
      ).toBeVisible();
    }
  });

  test("名前未設定(初回)は既定名で対局を開始する(後方互換)", async ({
    page,
  }) => {
    await page.goto("/game?seed=0");

    for (const name of DEFAULT_NAMES) {
      await expect(
        page.getByText(name, { exact: false }).first(),
      ).toBeVisible();
    }
  });

  test("空欄のまま保存すると既定名へ戻る", async ({ page }) => {
    await saveNames(page, NAMES);

    await page.goto("/settings");
    await page.getByLabel("対局者2").fill("");
    await page.getByRole("button", { name: "名前を保存" }).click();

    await expect(page.getByLabel("対局者2")).toHaveValue(DEFAULT_NAMES[1]);
  });

  test("「既定名に戻す」で全員が既定名へ戻る", async ({ page }) => {
    await saveNames(page, NAMES);

    await page.goto("/settings");
    await page.getByRole("button", { name: "既定名に戻す" }).click();

    for (const [index, label] of [
      "あなた(自家)",
      "対局者2",
      "対局者3",
      "対局者4",
    ].entries()) {
      await expect(page.getByLabel(label)).toHaveValue(DEFAULT_NAMES[index]);
    }
  });
});
