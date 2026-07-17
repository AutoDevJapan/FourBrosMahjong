import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 配色トークンのコントラスト回帰テスト(#147 / spec5 5.2.4)。
 *
 * `globals.css` の実トークン値を読み取り、WCAG 2.1 の相対輝度式でコントラスト比を計算する。
 * 赤ドラ「赤」バッジ(文字 `--tile-face` × 地 `--tile-badge-red`)がライト/ダーク双方で
 * 通常テキスト基準 4.5:1(WCAG 1.4.3)を満たすことを固定し、トークン変更時の退行を防ぐ。
 * ダークの `--tile-badge-red` は `:root` の値を継承する(ダーク側で上書きしない)ため、
 * ライト・ダークとも地色は同一の深い赤で評価する。
 */

const CSS = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

/** セレクタブロック(`selector { ... }`、ネストなし)の中身を切り出す。 */
function block(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = CSS.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (match === null) throw new Error(`block not found: ${selector}`);
  return match[1];
}

/** ブロック内から CSS カスタムプロパティの 6 桁 HEX 値を取り出す。 */
function token(scope: string, name: string): string {
  const match = block(scope).match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (match === null) throw new Error(`token not found: ${name} in ${scope}`);
  return match[1];
}

/** sRGB 1 チャンネルを相対輝度用の線形値へ変換(WCAG 2.1 定義)。 */
function linearize(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** #rrggbb の相対輝度(WCAG 2.1)。 */
function luminance(hex: string): number {
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/** 2 色間のコントラスト比(1〜21)。 */
function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

describe("赤ドラ「赤」バッジのコントラスト(#147 / WCAG 1.4.3)", () => {
  const badgeBg = token(":root", "--tile-badge-red");
  const lightFace = token(":root", "--tile-face");
  const darkFace = token(':root[data-theme="dark"]', "--tile-face");

  it("ライトテーマで文字×地が 4.5:1 以上", () => {
    expect(contrast(lightFace, badgeBg)).toBeGreaterThanOrEqual(4.5);
  });

  it("ダークテーマで文字×地が 4.5:1 以上(バッジ地色は :root を継承)", () => {
    expect(contrast(darkFace, badgeBg)).toBeGreaterThanOrEqual(4.5);
  });

  it("枠 --tile-accent-red はダークでも牌面地に対し非テキスト 3:1 以上を維持", () => {
    // バッジ地色を枠から分離しても、枠(border=非テキスト)の識別コントラストは退行させない。
    const darkBorder = token(':root[data-theme="dark"]', "--tile-accent-red");
    expect(contrast(darkFace, darkBorder)).toBeGreaterThanOrEqual(3);
  });
});
