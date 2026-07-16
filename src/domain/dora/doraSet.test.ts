import { describe, expect, it } from "vitest";
import { createSeededRng } from "../random/rng";
import type { Suit, Tile } from "../tiles/tile";
import { buildWall } from "../wall/wall";
import { createDoraSet, resolveDora } from "./doraSet";

function t(suit: Suit, rank: number, isRed = false): Tile {
  return { suit, rank, isRed };
}

// 王牌代用の決定的な牌列(先頭から表→裏の順で選定される)。
const DEAD_WALL: readonly Tile[] = [
  t("pin", 1), // omote[0]
  t("sou", 2), // omote[1]
  t("man", 9), // omote[2]
  t("pin", 4), // ura[0]
  t("honor", 3), // ura[1]
  t("honor", 7), // ura[2]
  t("sou", 8),
  t("pin", 6),
];

describe("createDoraSet", () => {
  it("(3,5) 通常 → count=1、表/裏ドラ表示各1枚", () => {
    const set = createDoraSet(DEAD_WALL, [3, 5]);
    expect(set.count).toBe(1);
    expect(set.indicators).toEqual([t("pin", 1)]);
    expect(set.uraIndicators).toEqual([t("sou", 2)]);
  });

  it("(4,4) ゾロ目 → count=2、表/裏ドラ表示各2枚(裏は表と同数)", () => {
    const set = createDoraSet(DEAD_WALL, [4, 4]);
    expect(set.count).toBe(2);
    expect(set.indicators).toEqual([t("pin", 1), t("sou", 2)]);
    expect(set.uraIndicators).toEqual([t("man", 9), t("pin", 4)]);
  });

  it("(6,6) → count=3、表/裏ドラ表示各3枚", () => {
    const set = createDoraSet(DEAD_WALL, [6, 6]);
    expect(set.count).toBe(3);
    expect(set.indicators.length).toBe(3);
    expect(set.uraIndicators.length).toBe(3);
    // 表と裏で異なる牌を選ぶ(先頭3枚=表、続く3枚=裏)。
    expect(set.uraIndicators).toEqual([
      t("pin", 4),
      t("honor", 3),
      t("honor", 7),
    ]);
  });

  it("不変条件: indicators と uraIndicators は常に同数(=count)", () => {
    for (const roll of [
      [3, 5],
      [4, 4],
      [6, 6],
    ] as const) {
      const set = createDoraSet(DEAD_WALL, roll);
      expect(set.indicators.length).toBe(set.count);
      expect(set.uraIndicators.length).toBe(set.count);
    }
  });

  it("王牌が不足すると RangeError(count=3 は6枚必要)", () => {
    expect(() => createDoraSet(DEAD_WALL.slice(0, 5), [6, 6])).toThrow(
      RangeError,
    );
  });

  it("実際の Wall.deadWall(14枚)から選定できる", () => {
    const wall = buildWall(createSeededRng(42));
    const set = createDoraSet(wall.deadWall, [6, 6]);
    expect(set.count).toBe(3);
    expect(set.indicators.length).toBe(3);
    expect(set.uraIndicators.length).toBe(3);
  });

  it("スナップショット: 構築後に Wall を消費してもドラ表示牌は不変", () => {
    const wall = buildWall(createSeededRng(7));
    const set = createDoraSet(wall.deadWall, [4, 4]);
    const before = [...set.indicators, ...set.uraIndicators];
    // 北抜き相当で嶺上補充(王牌末尾を消費し先頭側へ補填)。
    wall.drawReplacement();
    wall.drawReplacement();
    expect([...set.indicators, ...set.uraIndicators]).toEqual(before);
  });
});

describe("resolveDora", () => {
  it("表/裏ドラ表示牌を次牌へ写像する", () => {
    const set = createDoraSet(DEAD_WALL, [4, 4]);
    const resolved = resolveDora(set);
    // 表: 1筒→2筒, 2索→3索
    expect(resolved.omote).toEqual([t("pin", 2), t("sou", 3)]);
    // 裏: 9萬→1萬, 4筒→5筒(赤)
    expect(resolved.ura).toEqual([t("man", 1), t("pin", 5, true)]);
  });
});
