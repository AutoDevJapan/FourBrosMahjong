import { expect, test } from "@playwright/test";

/**
 * トップページの初期スモークテスト。
 *
 * 現状 `src/app/page.tsx` は create-next-app のデフォルトテンプレートのままで、
 * 実際のゲーム画面は未実装（#8/#9 で対応予定）。ここでは「足場が壊れていないこと」
 * を確認する最小限のベースラインとして、200 応答とページの主要な骨格
 * （タイトル・<main> 要素）が描画されることのみを検証する。
 *
 * #9（トップページ/メタデータの実態への置き換え）が完了したら、このテストを
 * 実際のタイトル・見出しの検証に更新すること。対局画面ルートへの遷移シナリオは
 * ルーティング確定後に #30 で追加する。
 */
test.describe("トップページ", () => {
  test("200 で表示され、タイトルと主要要素が見える", async ({ page }) => {
    const response = await page.goto("/");

    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(/.+/);
    await expect(page.getByRole("main")).toBeVisible();
  });

  test("ダークモード設定でも主要要素が見える", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    const response = await page.goto("/");

    expect(response?.status()).toBe(200);
    await expect(page.getByRole("main")).toBeVisible();
  });
});
