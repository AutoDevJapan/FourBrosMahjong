import { describe, expect, it } from "vitest";
import { createDoraSet } from "@/domain/dora/doraSet";
import { countDoraHan } from "@/domain/dora/han";
import { createTile } from "@/domain/tiles/tile";
import type { TileData } from "../game/types";
import { resolveTileFace } from "./tileImage";
import { tileLabel } from "./tileLabel";

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

/**
 * 表示層と得点ドメインの赤扱いが**同じ入力に同じ答えを出す**ことを固定する(issue #485)。
 *
 * 赤5判定を層ごとに実装すると「画面では非赤なのに得点では赤1翻」が起き得る。
 * ここでは述語を直接比べるのではなく、表示側の出力(色付き `*-Dora` 素材と
 * `(赤ドラ)` ラベル)と得点側の出力(`countDoraHan().aka`)を突き合わせるので、
 * どちらかの層が判定を再実装した時点で失敗する。
 */
describe("赤扱いは表示層と得点ドメインで一致する(issue #485)", () => {
  // 表 pin1→pin2 / 裏 sou8→sou9。いずれも下の検証牌の牌種に該当させない。
  const doraSet = createDoraSet(
    [createTile("pin", 1), createTile("sou", 8)],
    [3, 5],
  );

  /** 表示層が赤扱いしたか(色付き素材 と `(赤ドラ)` ラベルは常に同時に立つ)。 */
  function displayTreatsAsRed(tile: TileData): boolean {
    const face = resolveTileFace(tile);
    const redFace = face.kind === "image" && face.name.endsWith("-Dora");
    const redLabel = tileLabel(tile).includes("(赤ドラ)");
    expect(redFace).toBe(redLabel);
    return redLabel;
  }

  it.each<[string, TileData, boolean]>([
    ["赤5筒", { suit: "pin", rank: 5, isRed: true }, true],
    ["赤5索", { suit: "sou", rank: 5, isRed: true }, true],
    ["赤フラグ無しの5筒", { suit: "pin", rank: 5 }, false],
    ["赤5萬(仕様外・素材なし)", { suit: "man", rank: 5, isRed: true }, false],
    ["赤フラグ付き1萬(仕様外)", { suit: "man", rank: 1, isRed: true }, false],
    [
      "赤フラグ付き3筒(仕様外・非5)",
      { suit: "pin", rank: 3, isRed: true },
      false,
    ],
    [
      "赤フラグ付き字牌(仕様外)",
      { suit: "honor", rank: 1, isRed: true },
      false,
    ],
  ])("%s: 表示の赤扱いと赤ドラ翻がどちらも %s になる", (_label, tile, red) => {
    expect(displayTreatsAsRed(tile)).toBe(red);
    expect(
      countDoraHan({
        hand: [{ ...tile, isRed: tile.isRed === true }],
        doraSet,
        riichi: false,
        kitaCount: 0,
      }).aka,
    ).toBe(red ? 1 : 0);
  });
});
