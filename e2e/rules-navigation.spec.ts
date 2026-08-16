import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const RULE_SECTION_IDS = [
  "rule-basic-format",
  "rule-tiles-and-dora",
  "rule-progress",
  "rule-scoring-and-dora",
  "rule-settlement-and-soshii",
  "rule-special-elements",
] as const;

test.describe("ルール説明の目次とアンカー(#612)", () => {
  test("狭幅でも目次から目的のセクションへ移動でき、現在位置を示す", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/rules");

    const toc = page.getByRole("navigation", { name: "ルールの目次" });
    await expect(toc).toBeVisible();
    await expect(toc.getByRole("link")).toHaveCount(RULE_SECTION_IDS.length);

    const target = page.locator("#rule-progress");
    await expect(target).not.toHaveAttribute("open");
    await toc.getByRole("link", { name: "3. 進行ルール" }).click();

    await expect(page).toHaveURL(/\/rules#rule-progress$/);
    await expect(target).toBeInViewport();
    await expect(target.locator("summary")).toBeVisible();
    expect(await target.evaluate((element) => element.matches(":target"))).toBe(
      true,
    );

    // フラグメント移動は開閉状態を変更せず、summaryのEnter操作も維持する。
    await expect(target).not.toHaveAttribute("open");
    await target.locator("summary").press("Enter");
    await expect(target).toHaveAttribute("open", "");
    await target.locator("summary").press("Enter");
    await expect(target).not.toHaveAttribute("open");

    const results = await new AxeBuilder({ page }).include("main").analyze();
    expect(results.violations).toEqual([]);
  });

  test("各目次リンクに一意な安定アンカーがある", async ({ page }) => {
    await page.goto("/rules");

    const toc = page.getByRole("navigation", { name: "ルールの目次" });
    const links = await toc.getByRole("link").all();
    expect(links).toHaveLength(RULE_SECTION_IDS.length);

    for (const [index, link] of links.entries()) {
      await expect(link).toHaveAttribute("href", `#${RULE_SECTION_IDS[index]}`);
      await expect(page.locator(`#${RULE_SECTION_IDS[index]}`)).toHaveCount(1);
    }
  });
});
