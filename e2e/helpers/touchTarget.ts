import { expect, type Locator } from "@playwright/test";

/**
 * タッチ操作領域の寸法検査(#607 / #799 / #1168)。
 *
 * `mobile-touch-targets.spec.ts` と `game.spec.ts` の**唯一の 44px 判定実装**。
 * 個別スペックで `boundingBox()` を直接 44 と比較しないこと(#1168 の再発防止)。
 */

/** このプロジェクトで要求する操作領域の1辺の下限(CSS px)。 */
export const MIN_TOUCH_SIZE = 44;

/**
 * 44px 判定に許す測定誤差(CSS px)。
 *
 * #1168 の CI 失敗は `min-height: 44px` の牌が `height = 43.999969482421875`
 * (不足 約3.05e-5px)と測られたもので、CSS 上の寸法は 1px たりとも不足していない。
 * ローカル Chromium での実測(`touch-target-tolerance.spec.ts` が記録)では、
 * 親に `translateY(465.08px)` を掛けた最小例で
 * `getComputedStyle().height = "44px"` / `getBoundingClientRect().height = 43.999969482421875`
 * / `boundingBox().height = 43.999969482421875` となった。つまり誤差は Playwright の
 * `boundingBox()` 固有ではなく、**端数座標を伴う border box の測定そのもの**に乗る。
 * したがって DOMRect 側も同じ許容で比較する必要がある。
 *
 * 0.05px という値は次の両立点として選んだ。
 * - 吸収したい測定誤差の上限: Chromium は座標・寸法を LayoutUnit(1/64px = 0.015625px)に
 *   量子化する。実測の 3.05e-5px はその 1/500 で、0.05px は量子化幅に対しても 3 倍以上の余裕がある。
 * - 拒否しなければならない実不足: 43.9px は量子化後 43.890625px(不足 0.109px)となり、
 *   0.05px の 2 倍以上あるため確実に不合格になる。
 *   `touch-target-tolerance.spec.ts` の負の検査がこの境界を固定する。
 *
 * この値を広げると 43.9px を通してしまうため、広げてはならない。
 */
export const TOUCH_SIZE_EPSILON = 0.05;

/** `MIN_TOUCH_SIZE` を満たすと見なす下限(測定誤差を差し引いた実効しきい値)。 */
const MIN_TOUCH_SIZE_THRESHOLD = MIN_TOUCH_SIZE - TOUCH_SIZE_EPSILON;

/** 測定値が 44px 要件を満たすか(誤差許容つき)。 */
export function meetsMinTouchSize(value: number | undefined | null): boolean {
  return typeof value === "number" && value >= MIN_TOUCH_SIZE_THRESHOLD;
}

/** 単一の矩形(CSS px)。 */
interface TouchTargetRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** 44px 判定の根拠として記録する実測値一式(#1168 受け入れ条件1)。 */
export interface TouchTargetMetrics {
  readonly label: string;
  /** `element.getBoundingClientRect()`(レイアウト由来の border box。判定の主信号)。 */
  readonly domRect: TouchTargetRect;
  /** `Locator.boundingBox()`(実際にタップされる合成後の領域。副信号)。 */
  readonly boundingBox: TouchTargetRect | null;
  /** `getComputedStyle` の使用値(content box 基準になりうるため診断専用)。 */
  readonly computed: {
    readonly width: string;
    readonly height: string;
    readonly minWidth: string;
    readonly minHeight: string;
    readonly padding: string;
    readonly boxSizing: string;
    readonly transform: string;
    readonly transitionProperty: string;
    readonly transitionDuration: string;
  };
  /** 測定時点で再生中のアニメーション数(0 なら移動 transition は静止済み)。 */
  readonly runningAnimations: number;
}

/** 実画面の computed size / DOMRect / boundingBox / transition 状態をまとめて採取する。 */
export async function measureTouchTarget(
  target: Locator,
  label: string,
): Promise<TouchTargetMetrics> {
  const boundingBox = await target.boundingBox();
  const measured = await target.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      domRect: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      },
      computed: {
        width: style.width,
        height: style.height,
        minWidth: style.minWidth,
        minHeight: style.minHeight,
        padding: style.padding,
        boxSizing: style.boxSizing,
        transform: style.transform,
        transitionProperty: style.transitionProperty,
        transitionDuration: style.transitionDuration,
      },
      runningAnimations: element
        .getAnimations()
        .filter((animation) => animation.playState === "running").length,
    };
  });

  return { label, boundingBox, ...measured };
}

/** 失敗メッセージに載せる実測値の要約(再現条件の特定に必要な情報だけ)。 */
export function describeTouchTarget(metrics: TouchTargetMetrics): string {
  return JSON.stringify(
    {
      domRect: metrics.domRect,
      boundingBox: metrics.boundingBox,
      computed: metrics.computed,
      runningAnimations: metrics.runningAnimations,
    },
    null,
    2,
  );
}

/**
 * 対象が可視で、かつ操作領域が 44px 以上であることを検査する。
 *
 * 主信号はレイアウト由来の `getBoundingClientRect()`、副信号は実際にタップされる
 * 合成後の `boundingBox()` で、いずれも `TOUCH_SIZE_EPSILON` だけ緩めて比較する。
 * 44px という要件自体は下げない(0.05px は 44px の 0.11% で、実際の不足は拒否する)。
 * 固定 sleep や retry では隠さない(#1168)。
 */
export async function expectTouchTarget(
  target: Locator,
  label: string,
): Promise<TouchTargetMetrics> {
  await expect(target, `${label} が表示されていません`).toBeVisible();
  const metrics = await measureTouchTarget(target, label);
  const detail = describeTouchTarget(metrics);

  expect(
    metrics.boundingBox,
    `${label} の寸法を取得できません\n${detail}`,
  ).not.toBeNull();

  // 主信号: レイアウト由来の border box。
  expect(
    metrics.domRect.width,
    `${label} の幅が44px未満(DOMRect)\n${detail}`,
  ).toBeGreaterThanOrEqual(MIN_TOUCH_SIZE_THRESHOLD);
  expect(
    metrics.domRect.height,
    `${label} の高さが44px未満(DOMRect)\n${detail}`,
  ).toBeGreaterThanOrEqual(MIN_TOUCH_SIZE_THRESHOLD);

  // 副信号: 実際にタップされる合成後の領域。
  expect(
    metrics.boundingBox?.width,
    `${label} の幅が44px未満(boundingBox)\n${detail}`,
  ).toBeGreaterThanOrEqual(MIN_TOUCH_SIZE_THRESHOLD);
  expect(
    metrics.boundingBox?.height,
    `${label} の高さが44px未満(boundingBox)\n${detail}`,
  ).toBeGreaterThanOrEqual(MIN_TOUCH_SIZE_THRESHOLD);

  return metrics;
}
