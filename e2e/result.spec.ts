import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { walkToGameEnd } from "@/components/game/finishedGameFixture";
import type { PlayerNames } from "@/domain/game/engine";

const FINISHED_JOURNAL = walkToGameEnd(1).journal;
const LONG_DUPLICATE_NAMES = [
  "同名の長いプレイヤー名",
  "同名の長いプレイヤー名",
  "同名の長いプレイヤー名",
  "同名の長いプレイヤー名",
] as const satisfies PlayerNames;

async function openFinishedResult(
  page: Page,
  options: { names?: PlayerNames; theme?: "light" | "dark" } = {},
): Promise<void> {
  const journal = {
    ...FINISHED_JOURNAL,
    names: options.names ?? FINISHED_JOURNAL.names,
  };
  await page.addInitScript(
    ({ raw, theme }) => {
      sessionStorage.setItem("four-bros-mahjong.game.v3", raw);
      if (theme) localStorage.setItem("theme", theme);
    },
    { raw: JSON.stringify(journal), theme: options.theme },
  );
  await page.goto("/game/result");
  await expect(
    page.getByRole("heading", { level: 1, name: "半荘終了" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "最終順位" }),
  ).toBeVisible();
}

async function expectTouchTarget(locator: ReturnType<Page["locator"]>) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box?.width).toBeGreaterThanOrEqual(44);
  expect(box?.height).toBeGreaterThanOrEqual(44);
}

test.describe("Issue #712 Phase B5 対局結果デザイン", () => {
  test("320pxと長い重複名でも結果・精算label・3導線・保存状態を保つ", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 844 });
    await openFinishedResult(page, {
      names: LONG_DUPLICATE_NAMES,
      theme: "dark",
    });

    const ranking = page.getByRole("table", {
      name: "最終順位とソシー合計",
    });
    await expect(ranking.getByRole("row")).toHaveCount(5);
    await expect(ranking.locator('tr[data-rank="1"]')).toContainText("優勝");
    await expect(page.getByText(LONG_DUPLICATE_NAMES[0])).toHaveCount(8);
    await expect(
      page.getByRole("heading", {
        level: 2,
        name: "ソシー内訳（素点＋ウマ・オカ＋役満祝儀）",
      }),
    ).toBeVisible();
    await expect(page.getByText("素点（最終持ち点−返し40,000）")).toHaveCount(
      4,
    );
    await expect(
      page.locator("dt").filter({ hasText: "ウマ・オカ" }),
    ).toHaveCount(4);
    await expect(page.getByText("役満祝儀", { exact: true })).toHaveCount(4);
    await expect(page.getByText("（1位はオカ20,000を含む）")).toBeVisible();
    await expect(page.locator('[data-save-status="saved"]')).toBeVisible();

    const actions = page.getByRole("navigation", { name: "対局後の導線" });
    await expectTouchTarget(
      actions.getByRole("button", { name: "もう一半荘" }),
    );
    await expectTouchTarget(actions.getByRole("link", { name: "戦績を見る" }));
    await expectTouchTarget(
      actions.getByRole("link", { name: "ロビーへ戻る" }),
    );
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);

    await actions.getByRole("button", { name: "もう一半荘" }).focus();
    await expect(
      actions.getByRole("button", { name: "もう一半荘" }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      actions.getByRole("link", { name: "戦績を見る" }),
    ).toBeFocused();

    const results = await new AxeBuilder({ page }).include("main").analyze();
    expect(results.violations).toEqual([]);

    await page.reload();
    await expect(
      page.getByRole("heading", { level: 2, name: "最終順位" }),
    ).toBeVisible();
    await expect(page.getByText(LONG_DUPLICATE_NAMES[0])).toHaveCount(8);
  });

  test("forced-colorsとreduced-motionでも首位・focus・操作を装飾だけに依存しない", async ({
    page,
  }) => {
    await page.emulateMedia({
      forcedColors: "active",
      reducedMotion: "reduce",
    });
    await openFinishedResult(page);

    const winner = page.locator('tr[data-rank="1"]');
    await expect(winner).toContainText("1位");
    await expect(winner).toContainText("優勝");
    await expect(page.locator(".result-panel")).toHaveCSS("overflow", "hidden");
    expect(
      await page
        .locator(".result-panel")
        .evaluate((element) => getComputedStyle(element, "::before").display),
    ).toBe("none");
    await expect(page.getByRole("button", { name: "もう一半荘" })).toHaveCSS(
      "transition-duration",
      "0s",
    );
  });

  test("phone/tablet/desktopとlight/darkのvisual baselineを固定する", async ({
    page,
  }) => {
    const cases = [
      {
        name: "phone-320-dark-result.png",
        width: 320,
        height: 844,
        theme: "dark",
      },
      {
        name: "tablet-768-light-result.png",
        width: 768,
        height: 1024,
        theme: "light",
      },
      {
        name: "desktop-1280-dark-result.png",
        width: 1280,
        height: 900,
        theme: "dark",
      },
    ] as const;

    for (const visualCase of cases) {
      await page.setViewportSize(visualCase);
      await openFinishedResult(page, { theme: visualCase.theme });
      await page.evaluate(async () => document.fonts.ready);
      await expect(page.locator("html")).toHaveAttribute(
        "data-theme",
        visualCase.theme,
      );
      await expect(page.locator('[data-save-status="saved"]')).toBeVisible();
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
      ).toBe(true);
      await expect(page).toHaveScreenshot(visualCase.name, {
        fullPage: true,
        animations: "disabled",
        maxDiffPixelRatio: 0.005,
        stylePath: "e2e/visual-screenshot.css",
      });
    }
  });
});
