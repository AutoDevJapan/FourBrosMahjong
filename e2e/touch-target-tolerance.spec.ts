import { expect, test } from "@playwright/test";
import { visibleHand } from "./helpers/gameDriver";
import {
  describeTouchTarget,
  expectTouchTarget,
  MIN_TOUCH_SIZE,
  measureTouchTarget,
  meetsMinTouchSize,
  TOUCH_SIZE_EPSILON,
} from "./helpers/touchTarget";

/**
 * 44px タッチ領域判定の許容幅そのものを固定するスペック(#1168)。
 *
 * `expectTouchTarget` を緩めすぎると「実際に44px未満の領域」を見逃すため、
 * ここで**通してよい誤差**と**必ず落とすべき不足**の両方を自動検査で固定する。
 */

/** #1168 の CI で観測された値。boundingBox だけが 44 をわずかに下回った。 */
const OBSERVED_SUBPIXEL_HEIGHT = 43.999969482421875;

test.describe("44pxタッチ領域判定の許容幅(#1168)", () => {
  test("しきい値は測定誤差を通し、実際の不足を通さない", () => {
    expect(TOUCH_SIZE_EPSILON).toBeLessThan(0.1);
    expect(meetsMinTouchSize(MIN_TOUCH_SIZE)).toBe(true);
    expect(meetsMinTouchSize(OBSERVED_SUBPIXEL_HEIGHT)).toBe(true);
    // 43.9px(不足0.1px)は誤差ではなく実際の不足として拒否する。
    expect(meetsMinTouchSize(43.9)).toBe(false);
    expect(meetsMinTouchSize(43)).toBe(false);
    expect(meetsMinTouchSize(undefined)).toBe(false);
  });

  test("端数座標のtransformで測られた44px要素は合格する", async ({ page }) => {
    // #1168 の最小再現例: レイアウト上は 44px ちょうどだが、親の端数 translate により
    // boundingBox() が 43.99996… を返しうる。
    await page.setContent(
      `<div style="transform:translateY(465.08px)">
         <div id="tile" style="display:inline-flex;min-width:44px;min-height:44px;transition:transform 200ms"></div>
       </div>`,
    );
    const target = page.locator("#tile");
    const metrics = await measureTouchTarget(target, "端数座標の44px要素");
    test.info().attach("subpixel-repro-metrics.json", {
      body: describeTouchTarget(metrics),
      contentType: "application/json",
    });

    // CSS 上の寸法は 1px も不足していない(要件は満たされている)。
    expect(metrics.computed.minHeight).toBe("44px");
    expect(metrics.computed.height).toBe("44px");
    // 一方 DOMRect / boundingBox は端数座標のぶんだけ 44 を下回りうる。
    // 誤差はどちらも許容幅(0.05px)の内側に収まる。
    expect(metrics.domRect.height).toBeGreaterThan(
      MIN_TOUCH_SIZE - TOUCH_SIZE_EPSILON,
    );
    expect(metrics.boundingBox?.height).toBeGreaterThan(
      MIN_TOUCH_SIZE - TOUCH_SIZE_EPSILON,
    );
    // 44px ちょうどで作った要素が測定誤差で落ちないことを、ヘルパ自身で確認する。
    await expectTouchTarget(target, "端数座標の44px要素");
  });

  test("43.9pxの領域は確実に不合格になる", async ({ page }) => {
    await page.setContent(
      `<div style="transform:translateY(465.08px)">
         <div id="tile" style="display:inline-flex;width:43.9px;height:43.9px"></div>
       </div>`,
    );
    const target = page.locator("#tile");
    const metrics = await measureTouchTarget(target, "43.9pxの領域");
    expect(metrics.domRect.height).toBeLessThan(MIN_TOUCH_SIZE);

    const failure = await expectTouchTarget(target, "43.9pxの領域").then(
      () => null,
      (error: unknown) => error as Error,
    );
    expect(
      failure,
      "43.9px の領域が 44px 判定を通過した(許容幅が広すぎる)",
    ).not.toBeNull();
    expect(failure?.message).toContain("43.9pxの領域 の幅が44px未満");
  });

  test("高さだけ43.9pxの領域も不合格になる", async ({ page }) => {
    await page.setContent(
      `<div id="tile" style="display:inline-flex;width:120px;height:43.9px"></div>`,
    );
    const failure = await expectTouchTarget(
      page.locator("#tile"),
      "高さ不足の領域",
    ).then(
      () => null,
      (error: unknown) => error as Error,
    );
    expect(failure).not.toBeNull();
    expect(failure?.message).toContain("高さ不足の領域 の高さが44px未満");
  });
});

test.describe("実画面の手牌タッチ領域の実測記録(#1168)", () => {
  test.use({ isMobile: true, hasTouch: true });

  for (const width of [320, 360] as const) {
    test(`${width}pxの自家手牌のcomputed/DOMRect/boundingBox/transitionを記録する`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/game?seed=0");
      await expect(page.locator('[data-pending="humanDiscard"]')).toHaveCount(
        1,
      );

      const tile = visibleHand(page).getByRole("option").first();
      const metrics = await expectTouchTarget(tile, `${width}pxの手牌先頭牌`);
      test.info().attach(`hand-tile-${width}px-metrics.json`, {
        body: describeTouchTarget(metrics),
        contentType: "application/json",
      });

      // 44px は CSS(min-height:2.75rem)で確保されている要件であり、
      // 測定誤差の許容はこの要件を弱めない。
      expect(metrics.computed.minHeight).toBe("44px");
      expect(metrics.computed.minWidth).toBe("44px");
      expect(metrics.domRect.height).toBeGreaterThanOrEqual(MIN_TOUCH_SIZE);
      expect(metrics.domRect.width).toBeGreaterThanOrEqual(MIN_TOUCH_SIZE);
    });
  }
});
