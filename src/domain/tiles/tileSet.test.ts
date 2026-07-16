import { describe, expect, it } from "vitest";
import type { Tile } from "./tile";
import { buildTileSet, TOTAL_TILE_COUNT } from "./tileSet";

/** テスト用: 牌の同一性キー(赤フラグ込み)。 */
function key(tile: Tile): string {
  return `${tile.suit}-${tile.rank}-${tile.isRed ? "r" : "n"}`;
}

/** テスト用: 種別×数ごとの枚数を数える(赤は無視)。 */
function countBySuitRank(tiles: readonly Tile[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const tile of tiles) {
    const k = `${tile.suit}-${tile.rank}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

describe("buildTileSet(スペック1 1.2)", () => {
  const tiles = buildTileSet();

  it("合計108枚(TOTAL_TILE_COUNT)", () => {
    expect(TOTAL_TILE_COUNT).toBe(108);
    expect(tiles).toHaveLength(TOTAL_TILE_COUNT);
  });

  it("萬子は一・九のみ(2〜8を抜く)、各4枚 = 8枚", () => {
    const man = tiles.filter((t) => t.suit === "man");
    expect(man).toHaveLength(8);
    expect(new Set(man.map((t) => t.rank))).toEqual(new Set([1, 9]));
    const counts = countBySuitRank(man);
    expect(counts.get("man-1")).toBe(4);
    expect(counts.get("man-9")).toBe(4);
  });

  it("筒子は1〜9 各4枚 = 36枚", () => {
    const pin = tiles.filter((t) => t.suit === "pin");
    expect(pin).toHaveLength(36);
    const counts = countBySuitRank(pin);
    for (let rank = 1; rank <= 9; rank++) {
      expect(counts.get(`pin-${rank}`)).toBe(4);
    }
  });

  it("索子は1〜9 各4枚 = 36枚", () => {
    const sou = tiles.filter((t) => t.suit === "sou");
    expect(sou).toHaveLength(36);
    const counts = countBySuitRank(sou);
    for (let rank = 1; rank <= 9; rank++) {
      expect(counts.get(`sou-${rank}`)).toBe(4);
    }
  });

  it("字牌は東南西北白發中(rank 1〜7)各4枚 = 28枚", () => {
    const honor = tiles.filter((t) => t.suit === "honor");
    expect(honor).toHaveLength(28);
    const counts = countBySuitRank(honor);
    for (let rank = 1; rank <= 7; rank++) {
      expect(counts.get(`honor-${rank}`)).toBe(4);
    }
  });

  describe("オール赤5(スペック1 1.2 / スペック4 4.4 不変条件)", () => {
    it("5筒4枚がすべて赤", () => {
      const fivePin = tiles.filter((t) => t.suit === "pin" && t.rank === 5);
      expect(fivePin).toHaveLength(4);
      expect(fivePin.every((t) => t.isRed)).toBe(true);
    });

    it("5索4枚がすべて赤", () => {
      const fiveSou = tiles.filter((t) => t.suit === "sou" && t.rank === 5);
      expect(fiveSou).toHaveLength(4);
      expect(fiveSou.every((t) => t.isRed)).toBe(true);
    });

    it("赤牌は5筒・5索の計8枚に限る(他に赤は無い)", () => {
      const reds = tiles.filter((t) => t.isRed);
      expect(reds).toHaveLength(8);
      expect(
        reds.every(
          (t) => t.rank === 5 && (t.suit === "pin" || t.suit === "sou"),
        ),
      ).toBe(true);
    });

    it("黒5筒・黒5索は存在しない", () => {
      const blackFives = tiles.filter(
        (t) =>
          t.rank === 5 && (t.suit === "pin" || t.suit === "sou") && !t.isRed,
      );
      expect(blackFives).toHaveLength(0);
    });

    it("萬子に5は存在しない(2〜8を抜くため)", () => {
      expect(tiles.some((t) => t.suit === "man" && t.rank === 5)).toBe(false);
    });
  });

  it("同一の呼び出しで決定的に同じ牌集合を返す", () => {
    const a = buildTileSet().map(key);
    const b = buildTileSet().map(key);
    expect(a).toEqual(b);
  });

  it("種別ごとの合計が 8 + 36 + 36 + 28 = 108 になる", () => {
    const bySuit = { man: 0, pin: 0, sou: 0, honor: 0 } as Record<
      Tile["suit"],
      number
    >;
    for (const t of tiles) {
      bySuit[t.suit] += 1;
    }
    expect(bySuit).toEqual({ man: 8, pin: 36, sou: 36, honor: 28 });
    expect(bySuit.man + bySuit.pin + bySuit.sou + bySuit.honor).toBe(108);
  });
});
