import { expect, test } from "@playwright/test";

/**
 * トップページ(ロビー)の E2E 検証。
 *
 * #9(PR #43)でトップページ/メタデータが四兄弟麻雀の実態へ置き換えられたため、
 * 本テストは実際のタイトル・見出し・プレースホルダを検証する
 * (create-next-app デフォルト時代のスモークテストから更新 / #45)。
 *
 * `/rules`(ルール説明)は #51 で実装済みのため実リンクとして遷移を検証する。
 * 残る `/game`・`/settings` は未実装で導線は「準備中」プレースホルダのまま。
 * 対局画面ルートへの遷移 E2E はルート実装後に #30 で追加する。
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
    // ルール説明(#51)は実装済みのため実リンク
    await expect(
      page.getByRole("link", { name: /ルールを見る/ }),
    ).toHaveAttribute("href", "/rules");
    // 未実装ルート(/game・/settings)の導線は「準備中」プレースホルダ(2 件)
    await expect(page.getByText("準備中")).toHaveCount(2);
  });

  test("ロビーから /rules へ遷移し、戻れる", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("link", { name: /ルールを見る/ }).click();
    await expect(page).toHaveURL(/\/rules$/);
    await expect(page).toHaveTitle("ルール説明 | 四兄弟麻雀");
    await expect(
      page.getByRole("heading", { level: 1, name: "ルール説明" }),
    ).toBeVisible();

    // 「ロビーへ戻る」導線でロビーに戻れる(spec 6.3)
    await page.getByRole("link", { name: "ロビーへ戻る" }).first().click();
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "四兄弟麻雀" }),
    ).toBeVisible();
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
