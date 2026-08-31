import { describe, expect, it } from "vitest";
import type { Suit, Tile } from "../tiles/tile";
import { HONOR } from "../tiles/tile";
import { nextTile } from "./indicator";

function ind(suit: Suit, rank: number, isRed = false): Tile {
  return { suit, rank, isRed };
}

describe("nextTile (次牌ルール)", () => {
  it("数牌は次の数がドラ(筒子 3→4)", () => {
    expect(nextTile(ind("pin", 3))).toEqual({
      suit: "pin",
      rank: 4,
      isRed: false,
    });
  });

  it("境界: 筒子 9→1 に巡回", () => {
    expect(nextTile(ind("pin", 9))).toEqual({
      suit: "pin",
      rank: 1,
      isRed: false,
    });
  });

  it("境界: 索子 9→1 に巡回", () => {
    expect(nextTile(ind("sou", 9))).toEqual({
      suit: "sou",
      rank: 1,
      isRed: false,
    });
  });

  it("実ドラが5筒/5索なら isRed=true(オール赤5規約)", () => {
    expect(nextTile(ind("pin", 4))).toEqual({
      suit: "pin",
      rank: 5,
      isRed: true,
    });
    expect(nextTile(ind("sou", 4))).toEqual({
      suit: "sou",
      rank: 5,
      isRed: true,
    });
  });

  it("萬子は 1↔9 で巡回(本変種は1・9のみ / 標準サンマ慣行)", () => {
    expect(nextTile(ind("man", 1))).toEqual({
      suit: "man",
      rank: 9,
      isRed: false,
    });
    expect(nextTile(ind("man", 9))).toEqual({
      suit: "man",
      rank: 1,
      isRed: false,
    });
  });

  it("萬子 2〜8 は本変種に存在せず RangeError", () => {
    expect(() => nextTile(ind("man", 5))).toThrow(RangeError);
  });

  it("風牌は 東→南→西→北→東 でループ", () => {
    expect(nextTile(ind("honor", HONOR.EAST)).rank).toBe(HONOR.SOUTH);
    expect(nextTile(ind("honor", HONOR.SOUTH)).rank).toBe(HONOR.WEST);
    expect(nextTile(ind("honor", HONOR.WEST)).rank).toBe(HONOR.NORTH);
    // 境界: 北→東 に巡回
    expect(nextTile(ind("honor", HONOR.NORTH)).rank).toBe(HONOR.EAST);
  });

  it("三元牌は 白→發→中→白 でループ", () => {
    expect(nextTile(ind("honor", HONOR.WHITE)).rank).toBe(HONOR.GREEN);
    expect(nextTile(ind("honor", HONOR.GREEN)).rank).toBe(HONOR.RED);
    // 境界: 中→白 に巡回(風牌ループへ漏れない)
    expect(nextTile(ind("honor", HONOR.RED)).rank).toBe(HONOR.WHITE);
  });

  it("字牌の実ドラは isRed=false / suit=honor を保つ", () => {
    const dora = nextTile(ind("honor", HONOR.NORTH));
    expect(dora.suit).toBe("honor");
    expect(dora.isRed).toBe(false);
  });

  it("不正な字牌 rank は RangeError", () => {
    expect(() => nextTile(ind("honor", 8))).toThrow(RangeError);
    expect(() => nextTile(ind("honor", 0))).toThrow(RangeError);
    expect(() => nextTile(ind("honor", 1.5))).toThrow(RangeError);
  });

  it("不正な数牌 rank は RangeError", () => {
    expect(() => nextTile(ind("pin", 0))).toThrow(RangeError);
    expect(() => nextTile(ind("sou", 10))).toThrow(RangeError);
  });

  it("未知の suit は RangeError", () => {
    expect(() =>
      nextTile({ suit: "evil", rank: 5, isRed: false } as unknown as Tile),
    ).toThrow(RangeError);
  });
});
