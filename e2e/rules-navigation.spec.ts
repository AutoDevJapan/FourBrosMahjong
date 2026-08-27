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
    await page.setViewportSize({ width: 320, height: 844 });
    await page.goto("/rules");

    const toc = page.getByRole("navigation", { name: "ルールの目次" });
    await expect(toc).toBeVisible();
    await expect(toc.getByRole("link")).toHaveCount(RULE_SECTION_IDS.length);
    for (const [index, link] of (await toc.getByRole("link").all()).entries()) {
      const box = await link.boundingBox();
      expect(
        box,
        `目次リンク(${index + 1})の寸法を取得できません`,
      ).not.toBeNull();
      expect(
        box?.width,
        `目次リンク(${index + 1})の幅が44px未満`,
      ).toBeGreaterThanOrEqual(44);
      expect(
        box?.height,
        `目次リンク(${index + 1})の高さが44px未満`,
      ).toBeGreaterThanOrEqual(44);
    }
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);

    const target = page.locator("#rule-progress");
    await expect(target).not.toHaveAttribute("open");
    const progressLink = toc.getByRole("link", { name: "3. 進行ルール" });
    await progressLink.focus();
    await expect(progressLink).toBeFocused();
    await progressLink.press("Enter");

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

    // 目次を経由しない共有URLでも、同じ安定アンカーへ直接到達できる。
    await page.goto("/rules#rule-progress");
    const directTarget = page.locator("#rule-progress");
    await expect(page).toHaveURL(/\/rules#rule-progress$/);
    await expect(directTarget).toBeInViewport();
    await expect(directTarget).not.toHaveAttribute("open");
  });

  test("閉じたカテゴリ内の項目IDへ直接移動すると内容を開いて表示する", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    await page.goto("/rules#rule-progress-chankan");

    const section = page.locator("#rule-progress");
    const target = page.locator("#rule-progress-chankan");
    await expect(page).toHaveURL(/\/rules#rule-progress-chankan$/);
    await expect(section).toHaveAttribute("open", "");
    await expect(target).toBeVisible();
    await expect(target).toBeInViewport();
    await expect(target).toContainText("槍槓");
    expect(consoleErrors).toEqual([]);
  });

  test("6セクション・29項目を保持し、desktopでは目次をsticky表示する(#712)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/rules");

    const toc = page.getByRole("navigation", { name: "ルールの目次" });
    const tocDisclosure = toc.locator("details");
    await expect(toc.getByRole("link")).toHaveCount(6);
    await expect(page.locator("details[id^='rule-']")).toHaveCount(6);
    await expect(page.locator("li[id^='rule-']")).toHaveCount(29);
    await expect(tocDisclosure).toHaveCSS("position", "sticky");
    await expect(tocDisclosure.locator("summary")).toBeHidden();
    await expect(
      page.getByRole("region", { name: "四兄弟麻雀のルール" }),
    ).toBeVisible();

    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
  });

  test("mobileでは同じ目次とカテゴリをnative details/summaryで操作できる(#712)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 844 });
    await page.goto("/rules");

    const toc = page.getByRole("navigation", { name: "ルールの目次" });
    const tocDisclosure = toc.locator("details");
    const tocSummary = tocDisclosure.locator("summary");
    await expect(tocSummary).toBeVisible();
    await expect(tocDisclosure).toHaveAttribute("open", "");
    await tocSummary.focus();
    await tocSummary.press("Enter");
    await expect(tocDisclosure).not.toHaveAttribute("open");
    await tocSummary.press("Enter");
    await expect(tocDisclosure).toHaveAttribute("open", "");

    const progress = page.locator("#rule-progress");
    const progressSummary = progress.locator("summary");
    await expect(progress).not.toHaveAttribute("open");
    await progressSummary.press("Enter");
    await expect(progress).toHaveAttribute("open", "");
    await expect(
      page.getByText(/チー不可\(三人打ちのためポン・カンのみ\)/),
    ).toBeVisible();
    await expect(
      page.getByText(/リーチ後に北抜できるのは、その手番でツモった北だけ/),
    ).toBeVisible();

    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
  });

  test("light/darkとphone/tablet/desktopのvisual baselineを固定する(#712)", async ({
    page,
  }) => {
    const cases = [
      {
        name: "desktop-dark-rules.png",
        width: 1280,
        height: 900,
        theme: "dark",
      },
      {
        name: "phone-320-light-rules.png",
        width: 320,
        height: 844,
        theme: "light",
      },
      {
        name: "tablet-768-dark-rules.png",
        width: 768,
        height: 1024,
        theme: "dark",
      },
    ] as const;

    for (const visualCase of cases) {
      await page.setViewportSize(visualCase);
      await page.goto("/rules");
      await page.evaluate(
        (theme) => localStorage.setItem("theme", theme),
        visualCase.theme,
      );
      await page.reload();
      await page.evaluate(async () => document.fonts.ready);
      await expect(page.locator("html")).toHaveAttribute(
        "data-theme",
        visualCase.theme,
      );
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
      ).toBe(true);
      if (visualCase.width >= 768) {
        await expect(page.locator(".rules-toc-disclosure")).toHaveCSS(
          "position",
          "sticky",
        );
        await expect(page.locator(".rules-toc-summary")).toBeHidden();
      }
      await expect(page).toHaveScreenshot(visualCase.name, {
        fullPage: true,
        animations: "disabled",
        maxDiffPixelRatio: 0.005,
        stylePath: "e2e/visual-screenshot.css",
      });
    }
  });
});
