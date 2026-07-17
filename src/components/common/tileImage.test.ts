import { describe, expect, it } from "vitest";
import type { TileData } from "../game/types";
import { isRedDora, resolveTileFace, TILE_BACK_SRC } from "./tileImage";

describe("resolveTileFace(カタログ内)", () => {
  it.each<[TileData, string]>([
    [{ suit: "man", rank: 1 }, "Man1"],
    [{ suit: "man", rank: 9 }, "Man9"],
    [{ suit: "pin", rank: 1 }, "Pin1"],
    [{ suit: "pin", rank: 9 }, "Pin9"],
    [{ suit: "sou", rank: 1 }, "Sou1"],
    [{ suit: "sou", rank: 9 }, "Sou9"],
    [{ suit: "honor", rank: 1 }, "Ton"],
    [{ suit: "honor", rank: 7 }, "Chun"],
  ])("%o を %s.svg の image に写像する", (tile, name) => {
    const face = resolveTileFace(tile);
    expect(face).toEqual({
      kind: "image",
      name,
      src: `/tiles/${name}.svg`,
    });
  });

  it("赤5筒・赤5索は色付き -Dora 素材へ写像する", () => {
    expect(resolveTileFace({ suit: "pin", rank: 5, isRed: true })).toEqual({
      kind: "image",
      name: "Pin5-Dora",
      src: "/tiles/Pin5-Dora.svg",
    });
    expect(resolveTileFace({ suit: "sou", rank: 5, isRed: true })).toEqual({
      kind: "image",
      name: "Sou5-Dora",
      src: "/tiles/Sou5-Dora.svg",
    });
  });

  it("非赤の5筒・5索は通常素材のまま(色手がかりに依存しない)", () => {
    expect(resolveTileFace({ suit: "pin", rank: 5 }).kind).toBe("image");
    expect(resolveTileFace({ suit: "sou", rank: 5 })).toEqual({
      kind: "image",
      name: "Sou5",
      src: "/tiles/Sou5.svg",
    });
  });
});

describe("resolveTileFace(カタログ外 → fallback)", () => {
  it.each<[string, TileData]>([
    // サンマ非同梱の中張萬子(Man2〜Man8 は 404)
    ["二萬", { suit: "man", rank: 2 }],
    ["五萬", { suit: "man", rank: 5 }],
    ["八萬", { suit: "man", rank: 8 }],
    // 赤5萬は素材(Man5-Dora)非同梱
    ["赤五萬", { suit: "man", rank: 5, isRed: true }],
    // 字牌の値域外(rank 0 → 空文字・404 / rank 8 → 旧実装は Back 誤描画)
    ["字牌 rank 0", { suit: "honor", rank: 0 }],
    ["字牌 rank 8", { suit: "honor", rank: 8 }],
    // 数牌の値域外
    ["筒 rank 0", { suit: "pin", rank: 0 }],
    ["索 rank 10", { suit: "sou", rank: 10 }],
  ])("%s(%o)は fallback を返し素材参照を発行しない", (_label, tile) => {
    expect(resolveTileFace(tile)).toEqual({ kind: "fallback" });
  });
});

describe("isRedDora(赤扱いは 5筒・5索のみ)", () => {
  it("5筒・5索 かつ isRed のときだけ true", () => {
    expect(isRedDora({ suit: "pin", rank: 5, isRed: true })).toBe(true);
    expect(isRedDora({ suit: "sou", rank: 5, isRed: true })).toBe(true);
  });

  it.each<[string, TileData]>([
    ["赤フラグ無しの5筒", { suit: "pin", rank: 5 }],
    ["赤5萬(素材なし)", { suit: "man", rank: 5, isRed: true }],
    ["赤フラグ付き3筒(非5)", { suit: "pin", rank: 3, isRed: true }],
    ["赤フラグ付き字牌", { suit: "honor", rank: 1, isRed: true }],
  ])("%s は false", (_label, tile) => {
    expect(isRedDora(tile)).toBe(false);
  });
});

describe("TILE_BACK_SRC", () => {
  it("伏せ牌の裏面素材への公開パス", () => {
    expect(TILE_BACK_SRC).toBe("/tiles/Back.svg");
  });
});
