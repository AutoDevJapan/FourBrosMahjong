import { describe, expect, it } from "vitest";
import { allDeclarations, block, CSS, declaration } from "./globals.cssParse";

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
 *
 * 「無いこと」の検査はブロック限定にしない。`block()` は最初のマッチしか返さず、
 * ブロック内コメントの `}` でも探索範囲が縮むため、否定条件が空振りで真になりうる。
 */

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

  it("倍率トークンはどこで宣言しても var() を含まない", () => {
    // calc(var(--u) * …) まで書くと宣言元(:root)の --u で確定し、.board-cross の
    // --u 上書き(コンテナ幅連動 clamp)が効かなくなって河牌が縮まなくなる。
    const values = allDeclarations("--tile-river-ratio");
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) expect(value).not.toContain("var(");
  });

  it("--tile-river-w の宣言は .river-grid ただ1か所", () => {
    // :root やダーク用スコープに長さとして持たせると上と同じ理由で流体縮小が死ぬ。
    expect(CSS.match(/--tile-river-w\s*:/g) ?? []).toHaveLength(1);
    expect(block(".river-grid")).toContain("--tile-river-w:");
  });

  it("リーチ宣言牌の横置き幅を予約し、同段の後続牌を詰める", () => {
    const riichi = block('.river-grid[data-has-riichi="true"]');
    expect(riichi).toContain("--river-tile-extra");
    expect(riichi).toContain("padding-inline-end");
    expect(CSS).toContain(
      '.river-grid > li[data-riichi="true"] > .game-tile--river',
    );
    expect(CSS).toContain('.river-grid > li[data-after-riichi="true"]');
  });
});
