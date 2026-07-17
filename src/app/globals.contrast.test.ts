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

describe("StatusBadge の felt 上コントラスト(#154 / WCAG 1.4.3)", () => {
  // riichi/highlight バッジは明色地 --tile-face を敷き、その上に濃色トークンで文字を描く。
  // 文字×バッジ地(--tile-face)がライト/ダーク双方で通常テキスト 4.5:1 を満たすことを固定する。
  const lightFace = token(":root", "--tile-face");
  const darkFace = token(':root[data-theme="dark"]', "--tile-face");
  const lightFelt = token(":root", "--table-felt");
  const darkFelt = token(':root[data-theme="dark"]', "--table-felt");
  // 文字トークンはテーマ非依存(:root のみで定義、ダーク側で上書きしない)。
  const riichiInk = token(":root", "--tile-badge-red");
  const highlightInk = token(":root", "--turn-highlight-ink");

  it("riichi: 文字×バッジ地がライトで 4.5:1 以上", () => {
    expect(contrast(riichiInk, lightFace)).toBeGreaterThanOrEqual(4.5);
  });

  it("riichi: 文字×バッジ地がダークで 4.5:1 以上", () => {
    expect(contrast(riichiInk, darkFace)).toBeGreaterThanOrEqual(4.5);
  });

  it("highlight: 文字×バッジ地がライトで 4.5:1 以上", () => {
    expect(contrast(highlightInk, lightFace)).toBeGreaterThanOrEqual(4.5);
  });

  it("highlight: 文字×バッジ地がダークで 4.5:1 以上", () => {
    expect(contrast(highlightInk, darkFace)).toBeGreaterThanOrEqual(4.5);
  });

  it("バッジ地 --tile-face が felt に対し非テキスト 3:1 以上(地と識別可能)", () => {
    // バッジ自体が卓 felt 上で図地分離できることを保証する(非テキスト UI 境界=3:1)。
    expect(contrast(lightFace, lightFelt)).toBeGreaterThanOrEqual(3);
    expect(contrast(darkFace, darkFelt)).toBeGreaterThanOrEqual(3);
  });
});

describe("牌枠 --tile-border の非テキストコントラスト(#148 項目2 / WCAG 1.4.11)", () => {
  // 白地に直接載る手牌の枠は、ページ背景に対し非テキスト境界 3:1(スペック5 5.2.4)が必要。
  // フラット 1 色では白地(暗い枠が有利)と緑フェルト(明るい枠が有利)を同時に満たせないため、
  // 白地側を基準に固定する。フェルト上の輪郭は牌面 --tile-face/伏せ牌の内側環が担う(globals.css 参照)。
  it("ライトテーマで白系ページ背景に対し 3:1 以上", () => {
    const lightBorder = token(":root", "--tile-border");
    const lightBg = token(":root", "--background");
    expect(contrast(lightBorder, lightBg)).toBeGreaterThanOrEqual(3);
  });

  it("ダークテーマで暗いページ背景に対し 3:1 以上(退行防止)", () => {
    const darkBorder = token(':root[data-theme="dark"]', "--tile-border");
    const darkBg = token(':root[data-theme="dark"]', "--background");
    expect(contrast(darkBorder, darkBg)).toBeGreaterThanOrEqual(3);
  });
});
