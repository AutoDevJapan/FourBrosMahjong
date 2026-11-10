import { describe, expect, it } from "vitest";
import type { TileData } from "../game/types";
import { resolveTileFace } from "./tileImage";

describe("resolveTileFace(カタログ内)", () => {
  // 正規全27面の独立 oracle。resolver / production catalog / buildTileSet
  // から期待値を生成すると、写像の入替が台帳と一緒に誤っても検出できない。
  it.each<[TileData, string]>([
    [{ suit: "man", rank: 1, isRed: false }, "Man1"],
    [{ suit: "man", rank: 9, isRed: false }, "Man9"],
    [{ suit: "pin", rank: 1, isRed: false }, "Pin1"],
    [{ suit: "pin", rank: 2, isRed: false }, "Pin2"],
    [{ suit: "pin", rank: 3, isRed: false }, "Pin3"],
    [{ suit: "pin", rank: 4, isRed: false }, "Pin4"],
    [{ suit: "pin", rank: 5, isRed: true }, "Pin5-Dora"],
    [{ suit: "pin", rank: 6, isRed: false }, "Pin6"],
    [{ suit: "pin", rank: 7, isRed: false }, "Pin7"],
    [{ suit: "pin", rank: 8, isRed: false }, "Pin8"],
    [{ suit: "pin", rank: 9, isRed: false }, "Pin9"],
    [{ suit: "sou", rank: 1, isRed: false }, "Sou1"],
    [{ suit: "sou", rank: 2, isRed: false }, "Sou2"],
    [{ suit: "sou", rank: 3, isRed: false }, "Sou3"],
    [{ suit: "sou", rank: 4, isRed: false }, "Sou4"],
    [{ suit: "sou", rank: 5, isRed: true }, "Sou5-Dora"],
    [{ suit: "sou", rank: 6, isRed: false }, "Sou6"],
    [{ suit: "sou", rank: 7, isRed: false }, "Sou7"],
    [{ suit: "sou", rank: 8, isRed: false }, "Sou8"],
    [{ suit: "sou", rank: 9, isRed: false }, "Sou9"],
    [{ suit: "honor", rank: 1, isRed: false }, "Ton"],
    [{ suit: "honor", rank: 2, isRed: false }, "Nan"],
    [{ suit: "honor", rank: 3, isRed: false }, "Shaa"],
    [{ suit: "honor", rank: 4, isRed: false }, "Pei"],
    [{ suit: "honor", rank: 5, isRed: false }, "Haku"],
    [{ suit: "honor", rank: 6, isRed: false }, "Hatsu"],
    [{ suit: "honor", rank: 7, isRed: false }, "Chun"],
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
