import { expect, type Page, test } from "@playwright/test";

/**
 * 非テキストコントラスト(WCAG 1.4.11)の実描画監査(#388 / スペック5 5.2.4)。
 *
 * ## なぜ必要か
 *
 * #388 まで、この破綻を検出できる仕組みがリポジトリに**存在しなかった**:
 *
 * - `src/app/globals.contrast.test.ts` は生のトークン同士しか比べられず、
 *   `border-foreground/25` のような**不透明度修飾子を評価できない**
 *   (#388 で `composite()` を入れて修飾子付きも測れるようにしたが、それは
 *   「あらかじめ列挙した組み合わせ」しか見ない)
 * - `e2e/a11y.spec.ts` の axe は `color-contrast`(テキストのみ)であり、
 *   **1.4.11 の非テキストコントラストは axe に実装がない**
 *
 * 本スペックは実際に描画された色を DOM から採取し、**列挙に頼らず**全ページの
 * 対話コントロールの境界線を機械的に検査する。新しいコントロールを足しても
 * 自動的に検査対象へ入る。
 *
 * ## 判定
 *
 * 対象は「境界線が可視な対話コントロール」。境界線色はそれ自体が半透明でありうるため
 * 要素自身の背景へ合成し、さらに**要素の外側の背景**(祖先の背景を不透明になるまで合成)
 * との比を測って 3:1 以上を要求する。無効化されたコントロールは 1.4.11 の対象外
 * (inactive user interface components)なので除外する。
 */

/** 非テキストコントラストの要求値(WCAG 1.4.11 / spec 5.2.4)。 */
const MIN_RATIO = 3;

type Theme = "ライト" | "OSダーク" | "手動ダーク";

interface Screen {
  readonly path: string;
  readonly heading: string;
}

const SCREENS: readonly Screen[] = [
  { path: "/", heading: "四兄弟麻雀" },
  { path: "/rules", heading: "ルール説明" },
  { path: "/settings", heading: "設定" },
  { path: "/history", heading: "戦績" },
  { path: "/game?seed=0", heading: "対局画面" },
  { path: "/game/result", heading: "対局結果" },
];

/**
 * 監査テーマ。配色トークンはライト/ダークの 2 系統だが、ダークは「OS 追従」と「手動選択」で
 * 別々の CSS スコープに二重定義されている(`globals.css`)。片方だけ更新する事故を検出するため
 * 両方走らせる(`e2e/a11y.spec.ts` の全画面監査と同じ 3 テーマ)。
 */
const THEMES: readonly Theme[] = ["ライト", "OSダーク", "手動ダーク"];

interface Offender {
  readonly screen: string;
  readonly label: string;
  readonly border: string;
  readonly background: string;
  readonly ratio: number;
}

/** 指定テーマで画面を開く(`e2e/a11y.spec.ts` の `openScreen` と同じ経路)。 */
async function openScreen(
  page: Page,
  screen: Screen,
  theme: Theme,
): Promise<void> {
  if (theme === "OSダーク") {
    await page.emulateMedia({ colorScheme: "dark" });
  } else if (theme === "手動ダーク") {
    await page.addInitScript(() => {
      try {
        localStorage.setItem("theme", "dark");
      } catch {
        // localStorage 不可環境ではダーク適用を諦める(監査はライト相当で走る)。
      }
    });
  }
  await page.goto(screen.path);
  await expect(
    page.getByRole("heading", { level: 1, name: screen.heading }),
  ).toBeVisible();
}

/**
 * 実描画された対話コントロールの境界線コントラストを採取する。
 *
 * 返すのは 3:1 未満だったものだけ(合格分は失敗メッセージを膨らませるだけなので返さない)。
 */
async function collectOffenders(
  page: Page,
  minRatio: number,
): Promise<readonly Omit<Offender, "screen">[]> {
  return page.evaluate((min) => {
    /*
     * 色の解決は **canvas への実描画**で行う。`getComputedStyle` が返す色は
     * `color-mix()` 由来だと `color(srgb …)` や `oklab(…)` 等になり、`rgb()/rgba()` 前提の
     * 文字列パースでは読めない。読めない色を「対象外」として飛ばすと、**まさに検出したい
     * 不透明度修飾子つきの枠が静かに監査から抜け落ちる**(実際にそうなっていた)。
     * canvas に重ね塗りしてピクセルを読めば、CSS のどの色構文でも合成後の実色が得られる。
     */
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (ctx === null) throw new Error("canvas 2D コンテキストを取得できない");

    type RGB = [number, number, number];

    /** `base` の上に `layers` を下から順に重ね塗りし、合成後の sRGB を返す。 */
    const paint = (layers: readonly string[], base: RGB): RGB => {
      ctx.globalCompositeOperation = "copy";
      ctx.fillStyle = `rgb(${base[0]}, ${base[1]}, ${base[2]})`;
      ctx.fillRect(0, 0, 1, 1);
      ctx.globalCompositeOperation = "source-over";
      for (const layer of layers) {
        ctx.fillStyle = layer;
        ctx.fillRect(0, 0, 1, 1);
      }
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      return [r, g, b];
    };

    /** 色の不透明度(0〜1)。黒地と白地に置いた結果の差から求める。 */
    const alphaOf = (color: string): number => {
      const onBlack = paint([color], [0, 0, 0]);
      const onWhite = paint([color], [255, 255, 255]);
      return 1 - (onWhite[0] - onBlack[0]) / 255;
    };

    const linearize = (channel: number): number => {
      const c = channel / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const luminance = (rgb: RGB): number =>
      0.2126 * linearize(rgb[0]) +
      0.7152 * linearize(rgb[1]) +
      0.0722 * linearize(rgb[2]);
    const ratio = (a: RGB, b: RGB): number => {
      const la = luminance(a);
      const lb = luminance(b);
      const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
      return (hi + 0.05) / (lo + 0.05);
    };

    /** `start` から祖先を遡り、不透明な層に達するまでの背景色を下→上の順で集める。 */
    const backgroundLayers = (start: Element | null): string[] => {
      const layers: string[] = [];
      for (let el = start; el !== null; el = el.parentElement) {
        const color = getComputedStyle(el).backgroundColor;
        const alpha = alphaOf(color);
        if (alpha <= 0.004) continue;
        layers.unshift(color);
        if (alpha >= 0.996) break;
      }
      return layers;
    };

    const describe = (el: Element): string => {
      const name =
        el.getAttribute("aria-label") ??
        (el.textContent ?? "").trim().slice(0, 24);
      return `<${el.tagName.toLowerCase()}> ${name || "(名前なし)"}`;
    };

    const selector =
      'a[href], button, input, select, textarea, [role="button"], [role="link"], label';
    const offenders: {
      label: string;
      border: string;
      background: string;
      ratio: number;
    }[] = [];

    for (const el of document.querySelectorAll(selector)) {
      // ラベルは内部にフォーム部品を持つもの(クリック可能なカード)だけを見る。
      if (
        el.tagName === "LABEL" &&
        el.querySelector("input,select,textarea") === null
      ) {
        continue;
      }
      // 1.4.11 は無効化されたコントロールを対象外にする。
      if (
        el.matches(":disabled") ||
        el.getAttribute("aria-disabled") === "true"
      ) {
        continue;
      }
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      if (
        (el as HTMLElement).offsetParent === null &&
        style.position !== "fixed"
      ) {
        continue;
      }
      if (!(Number.parseFloat(style.borderTopWidth) > 0)) continue;
      if (style.borderTopStyle === "none") continue;
      if (alphaOf(style.borderTopColor) <= 0.004) continue;

      // 背景は border-box まで描かれるため、枠色は「祖先の背景 → 自分の背景 → 枠」の順に重なる。
      const outsideLayers = backgroundLayers(el.parentElement);
      const outside = paint(outsideLayers, [255, 255, 255]);
      const composited = paint(
        [...outsideLayers, style.backgroundColor, style.borderTopColor],
        [255, 255, 255],
      );

      const r = ratio(composited, outside);
      if (r < min) {
        const fmt = (c: RGB) => `rgb(${c.join(",")})`;
        offenders.push({
          label: describe(el),
          border: fmt(composited),
          background: fmt(outside),
          ratio: Math.round(r * 100) / 100,
        });
      }
    }
    return offenders;
  }, minRatio);
}

test.describe("非テキストコントラスト(WCAG 1.4.11 / #388)", () => {
  for (const theme of THEMES) {
    for (const screen of SCREENS) {
      test(`${theme} / ${screen.path}: 対話コントロールの境界線が ${MIN_RATIO}:1 以上`, async ({
        page,
      }) => {
        await openScreen(page, screen, theme);
        const offenders = await collectOffenders(page, MIN_RATIO);
        expect(
          offenders,
          `非テキストコントラスト ${MIN_RATIO}:1 未満の対話コントロール:\n` +
            offenders
              .map(
                (o) =>
                  `  ${o.label} — 枠 ${o.border} / 地 ${o.background} = ${o.ratio}:1`,
              )
              .join("\n"),
        ).toEqual([]);
      });
    }
  }
});
