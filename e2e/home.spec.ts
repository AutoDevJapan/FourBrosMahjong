import { expect, test } from "@playwright/test";

/**
 * トップページ(ロビー)の E2E 検証。
 *
 * #9(PR #43)でトップページ/メタデータが四兄弟麻雀の実態へ置き換えられたため、
 * 本テストは実際のタイトル・見出し・プレースホルダを検証する
 * (create-next-app デフォルト時代のスモークテストから更新 / #45)。
 *
 * `/rules`(#51)・`/game`(#53)・`/settings`(#52)はいずれも実装済みのため、
 * 3導線とも実リンクとして検証する(現時点で「準備中」プレースホルダは無し)。
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
    // 3導線(#53 /game・#51 /rules・#52 /settings)はすべて実装済みで実リンク。
    await expect(
      page.getByRole("link", { name: /対局を開始/ }),
    ).toHaveAttribute("href", "/game");
    await expect(
      page.getByRole("link", { name: /ルールを見る/ }),
    ).toHaveAttribute("href", "/rules");
    await expect(page.getByRole("link", { name: /設定/ })).toHaveAttribute(
      "href",
      "/settings",
    );
    // 現時点で「準備中」プレースホルダは存在しない。
    await expect(page.getByText("準備中")).toHaveCount(0);
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
    // layout.tsx の title テンプレートが適用されたページ固有タイトル(#94)。
    await expect(page).toHaveTitle("設定 | 四兄弟麻雀");
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

  test("別タブのテーマ変更がロビーにも即時反映される(issue #179)", async ({
    page,
    context,
  }) => {
    const settingsPage = await context.newPage();
    await page.goto("/");
    await settingsPage.goto("/settings");

    await settingsPage.getByRole("radio", { name: "ダーク" }).check();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    await settingsPage.getByRole("radio", { name: "ライト" }).check();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });

  test("保存失敗時もradio・状態文言・実テーマが一致する(issue #180)", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Storage.prototype.setItem = () => {
        throw new DOMException("QuotaExceededError");
      };
    });
    await page.goto("/settings");

    await page.getByRole("radio", { name: "ダーク" }).click();

    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.getByRole("radio", { name: "ダーク" })).toBeChecked();
    await expect(page.getByText(/現在の表示:/)).toHaveText(
      "現在の表示: ダーク(手動で固定中)",
    );
  });
});
