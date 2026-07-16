import { expect, test } from "@playwright/test";

/**
 * トップページ(ロビー)の E2E 検証。
 *
 * #9(PR #43)でトップページ/メタデータが四兄弟麻雀の実態へ置き換えられたため、
 * 本テストは実際のタイトル・見出し・プレースホルダを検証する
 * (create-next-app デフォルト時代のスモークテストから更新 / #45)。
 *
 * 遷移先ルート(`/game`・`/rules`・`/settings`)は未実装で、導線は「準備中」
 * プレースホルダのため、ここでは遷移シナリオは扱わない。対局画面ルートへの
 * 遷移 E2E はルート実装後に #30 で追加する。
 */
test.describe("トップページ(ロビー)", () => {
  test("200 で表示され、lang とタイトルが実態と一致する", async ({ page }) => {
    const response = await page.goto("/");

    expect(response?.status()).toBe(200);
    // layout.tsx: <html lang="ja">
    await expect(page.locator("html")).toHaveAttribute("lang", "ja");
    // layout.tsx: metadata.title.default
    await expect(page).toHaveTitle("四兄弟麻雀 - FourBrosMahjong");
  });

  test("見出し・メニュー導線・準備中プレースホルダが表示される", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(page.getByRole("main")).toBeVisible();
    // page.tsx: <h1>四兄弟麻雀</h1>
    await expect(
      page.getByRole("heading", { level: 1, name: "四兄弟麻雀" }),
    ).toBeVisible();
    // ロビーのメインメニュー(3 導線)
    await expect(
      page.getByRole("navigation", { name: "メインメニュー" }),
    ).toBeVisible();
    await expect(page.getByText("対局を開始")).toBeVisible();
    await expect(page.getByText("ルールを見る")).toBeVisible();
    await expect(page.getByText("設定", { exact: true })).toBeVisible();
    // 未実装ルートの導線は「準備中」プレースホルダ(3 件)
    await expect(page.getByText("準備中")).toHaveCount(3);
  });

  test("create-next-app デフォルトの文言/導線が残っていない", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(page.getByText(/Get started by editing/i)).toHaveCount(0);
    await expect(
      page.getByText("Save and see your changes instantly."),
    ).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Deploy now/i })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("link", { name: /Read our docs/i }),
    ).toHaveCount(0);
    await expect(page.getByAltText("Next.js logo")).toHaveCount(0);
    await expect(page.getByAltText("Vercel logomark")).toHaveCount(0);
  });

  test("ダークモード設定でも主要要素が見える", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    const response = await page.goto("/");

    expect(response?.status()).toBe(200);
    await expect(page.getByRole("main")).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 1, name: "四兄弟麻雀" }),
    ).toBeVisible();
  });
});
