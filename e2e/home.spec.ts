import { expect, test } from "@playwright/test";

/**
 * トップページ(ロビー)の E2E 検証。
 *
 * #9(PR #43)でトップページ/メタデータが四兄弟麻雀の実態へ置き換えられたため、
 * 本テストは実際のタイトル・見出し・プレースホルダを検証する
 * (create-next-app デフォルト時代のスモークテストから更新 / #45)。
 *
 * `/settings`(設定)は #52 で実装済みのためリンク遷移を検証する。残る
 * `/game`・`/rules` は未実装で導線は「準備中」プレースホルダのため遷移は扱わない。
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
    // 実装済みの設定は /settings への実リンク、未実装の 2 ルートは「準備中」。
    await expect(
      page.getByRole("link", { name: /設定/ }),
    ).toHaveAttribute("href", "/settings");
    await expect(page.getByText("準備中")).toHaveCount(2);
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

/**
 * 設定ページ(`/settings`)の E2E 検証(#52)。ロビー ⇄ 設定の遷移、
 * ダークモード手動切替の DOM 反映(`<html data-theme>`)とリロード後の保持、
 * OS 設定尊重(未選択時は data-theme を付与しない)を確認する。
 */
test.describe("設定ページ(ダークモード手動切替)", () => {
  test("ロビーから遷移し、テーマ切替がリロード後も保持され、戻れる", async ({
    page,
  }) => {
    await page.goto("/");

    // ロビー → 設定
    await page.getByRole("link", { name: /設定/ }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "設定" }),
    ).toBeVisible();

    // 初期(未選択)は data-theme を付与せず OS 設定へ委譲する。
    expect(await page.locator("html").getAttribute("data-theme")).toBeNull();
    await expect(
      page.getByRole("radio", { name: "システム設定に従う" }),
    ).toBeChecked();

    // ダークを手動選択 → <html data-theme="dark">
    await page.getByRole("radio", { name: "ダーク" }).check();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    // リロードしても保持される(localStorage + layout の初期化スクリプト)。
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.getByRole("radio", { name: "ダーク" })).toBeChecked();

    // 設定 → ロビーへ戻る
    await page.getByRole("link", { name: "ロビーへ戻る" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "四兄弟麻雀" }),
    ).toBeVisible();
  });

  test("OS がダークでも手動でライト固定でき、その選択が優先される", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/settings");

    await page.getByRole("radio", { name: "ライト" }).check();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.getByRole("radio", { name: "ライト" })).toBeChecked();
  });
});
