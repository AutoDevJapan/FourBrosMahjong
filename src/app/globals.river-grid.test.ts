import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 河(捨て牌)グリッドのトラック定義の回帰テスト(#258 / #387 / spec5 5.3.2)。
 *
 * ここで固定するのは**定義の置き場所と形**だけで、実際の見え方(6 列に収まる・卓幅に
 * 連動して縮む・横スクロールしない)は `e2e/game.spec.ts` が実描画で固定する。
 * レイアウト計算を伴う不変条件は jsdom では検証できないための分担。
 *
 * 固定する形:
 *
 * - 列幅は牌 1 枚ぶんの**固定幅**(`1fr` / `minmax` にすると全幅スロットで牌が散らばる / #258)
 * - 列数は `auto-fill` で**可変**(固定列数にすると最小コンテンツ幅が牌 6 枚ぶんに固定され、
 *   段階①のクロス配置で左右スロット幅を超えてページが横スクロールする / #387)
 * - 牌寸法と列幅は**同じ倍率トークン**から導き、掛け算は `--u` が有効な要素側で行う
 *   (`:root` で `calc(var(--u) * …)` まで確定させると `.board-cross` の `--u` 上書きが
 *   効かず、卓幅連動の流体縮小が死ぬ。カスタムプロパティの計算値は「宣言された要素で
 *   `var()` を置換したトークン列」であり、置換済みの値が子孫へ継承されるため)
 */

const CSS = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

/** セレクタブロック(`selector { ... }`、ネストなし)の中身を切り出す。 */
function block(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = CSS.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (match === null) throw new Error(`block not found: ${selector}`);
  return match[1];
}

/** 宣言 1 件の値を取り出す(末尾のセミコロンは任意)。 */
function declaration(selector: string, property: string): string {
  const match = block(selector).match(
    new RegExp(`(?:^|[;\\s])${property}:\\s*([^;}]+)`),
  );
  if (match === null) {
    throw new Error(`declaration not found: ${property} in ${selector}`);
  }
  return match[1].trim().replace(/\s+/g, " ");
}

describe(".river-grid のトラック定義(#258 / #387)", () => {
  const columns = declaration(".river-grid", "grid-template-columns");

  it("列幅は牌1枚ぶんの固定トークンを使う(#258: 1fr で散らばらせない)", () => {
    expect(columns).toContain("var(--tile-river-w)");
    expect(columns).not.toMatch(/\bfr\b/);
    expect(columns).not.toContain("minmax");
  });

  it("列数は auto-fill で可変にする(#387: 固定列数にしない)", () => {
    expect(columns).toContain("auto-fill");
    // repeat(6, …) のような固定列数指定が復活していないこと。
    expect(columns).not.toMatch(/repeat\(\s*\d/);
  });

  it("牌寸法と列幅は同じ倍率トークンから導く", () => {
    const ratio = "var(--tile-river-ratio)";
    expect(declaration(".game-tile--river", "width")).toContain(ratio);
    expect(declaration(".river-grid", "--tile-river-w")).toContain(ratio);
  });

  it("倍率トークンは var() を含まず、--u との掛け算を :root で確定させない", () => {
    // ここで calc(var(--u) * …) まで書くと :root の --u で確定し、.board-cross の
    // --u 上書き(コンテナ幅連動 clamp)が効かなくなって河牌が縮まなくなる。
    expect(declaration(":root", "--tile-river-ratio")).not.toContain("var(");
    // --tile-river-w は :root ではなく、--u が有効な .river-grid 側で組み立てる。
    expect(block(":root")).not.toContain("--tile-river-w");
  });
});
