import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 河(捨て牌)グリッドのトラック定義の回帰テスト(#258 / #387 / spec5 5.3.2)。
 *
 * `.river-grid` は次の 2 つの不変条件を同時に持つ:
 *
 * - **列幅は牌1枚ぶんの固定幅**(`1fr` にすると全幅スロットで牌が散らばる / #258)
 * - **列数はスロット幅に入るぶんだけ、上限 6 列**(6 列固定にすると最小コンテンツ幅が
 *   牌6枚ぶんに固定され、段階①のクロス配置で左右スロット幅を超えてページが横スクロールする / #387)
 *
 * どちらもレイアウト計算を伴うため jsdom の component テストでは検証できない。実描画の
 * 回帰は `e2e/game.spec.ts` の「主要スマホ幅で河が溜まっても横スクロールしない」が持ち、
 * ここでは**トラック定義そのもの**(= 上記2条件をコードとして満たしているか)を固定する。
 */

const CSS = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

/** セレクタブロック(`selector { ... }`、ネストなし)の中身を切り出す。 */
function block(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = CSS.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (match === null) throw new Error(`block not found: ${selector}`);
  return match[1];
}

/** 宣言 1 件の値を取り出す(見つからなければ明示エラー)。 */
function declaration(selector: string, property: string): string {
  const match = block(selector).match(
    new RegExp(`(?:^|[;\\s])${property}:\\s*([^;]+);`),
  );
  if (match === null) {
    throw new Error(`declaration not found: ${property} in ${selector}`);
  }
  return match[1].trim().replace(/\s+/g, " ");
}

/** 空白差を無視して比較するための正規化。 */
function normalize(value: string): string {
  return value.replace(/\s+/g, "");
}

describe(".river-grid のトラック定義(#258 / #387)", () => {
  const columns = declaration(".river-grid", "grid-template-columns");
  const maxWidth = declaration(".river-grid", "max-width");

  it("列幅は牌1枚ぶんの固定トークン --tile-river-w を使う(#258: 1fr で散らばらせない)", () => {
    expect(normalize(columns)).toContain("var(--tile-river-w)");
    expect(columns).not.toMatch(/\bfr\b/);
    expect(columns).not.toContain("minmax");
  });

  it("列数は auto-fill で可変にする(#387: 固定列数にしない)", () => {
    expect(columns).toContain("auto-fill");
    // repeat(6, …) のような固定列数指定が復活していないこと。
    expect(columns).not.toMatch(/repeat\(\s*\d/);
  });

  it("列数の上限は 6 列ぶんの max-width で与える(#258 の密な段組みを維持)", () => {
    expect(normalize(maxWidth)).toBe(
      normalize("calc(6 * var(--tile-river-w) + 5 * var(--river-gap))"),
    );
  });

  it("牌寸法(.game-tile--river)と列幅は同じトークンから導く", () => {
    expect(declaration(".game-tile--river", "width")).toBe(
      "var(--tile-river-w)",
    );
    expect(normalize(declaration(":root", "--tile-river-w"))).toBe(
      normalize("calc(var(--u) * 1.65)"),
    );
  });
});
