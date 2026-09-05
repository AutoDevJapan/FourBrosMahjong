import { describe, expect, it } from "vitest";
import type { Tile } from "../tiles/tile";
import type { MeldInput } from "./decompose";
import { parseTiles } from "./notation";
import { isTenpai, waitingTiles } from "./tenpai";
import { tileKey } from "./tile-identity";

function waitKeys(notation: string, melds: MeldInput[] = []): string[] {
  return waitingTiles(parseTiles(notation), melds)
    .map((t) => tileKey(t))
    .sort();
}

describe("waitingTiles", () => {
  it("単騎待ちを列挙する", () => {
    expect(waitKeys("123p 456p 789p 111s 9s")).toEqual([
      tileKey({ suit: "sou", rank: 9 }),
    ]);
  });

  it("両面3面(2345s)の多面待ちを列挙する", () => {
    expect(waitKeys("123p 456p 789p 2345s")).toEqual(
      [
        tileKey({ suit: "sou", rank: 2 }),
        tileKey({ suit: "sou", rank: 5 }),
      ].sort(),
    );
  });

  it("九蓮宝燈形は9面待ちになる", () => {
    expect(waitingTiles(parseTiles("1112345678999p"))).toHaveLength(9);
  });

  it("4枚使い切った牌は待ちに含めない", () => {
    // 111p は3枚+待ちで1枚のみ。9999s は不可能な待ち。
    const waits = waitKeys("123p 456p 789p 1111s 9s");
    expect(waits).not.toContain(tileKey({ suit: "sou", rank: 1 }));
  });

  it("副露込みでテンパイ判定する", () => {
    const melds: MeldInput[] = [
      { tiles: parseTiles("111s"), isKan: false, concealed: false },
    ];
    expect(isTenpai(parseTiles("123p 456p 789p 9s"), melds)).toBe(true);
  });

  it("ノーテンは空配列/false", () => {
    expect(waitKeys("123p 456p 789p 147s 9s")).toEqual([]);
    expect(isTenpai(parseTiles("123p 456p 789p 147s 9s"))).toBe(false);
  });

  it("不正な門前牌要素は例外にせず空の待ちを返す", () => {
    const malformedTiles = [null] as unknown as Tile[];

    expect(waitingTiles(malformedTiles)).toEqual([]);
    expect(isTenpai(malformedTiles)).toBe(false);
  });

  it("不正な副露牌コンテナ/要素は例外にせず空の待ちを返す", () => {
    const malformedMelds = [
      { tiles: null, isKan: false, concealed: false },
    ] as unknown as MeldInput[];
    const malformedMeldTile = [
      { tiles: [null], isKan: false, concealed: false },
    ] as unknown as MeldInput[];

    expect(waitingTiles([], malformedMelds)).toEqual([]);
    expect(isTenpai([], malformedMelds)).toBe(false);
    expect(waitingTiles([], malformedMeldTile)).toEqual([]);
    expect(isTenpai([], malformedMeldTile)).toBe(false);
  });

  it("疎配列の穴も不正な要素として例外にせず空の待ちを返す", () => {
    const sparseTiles = new Array(1) as unknown as Tile[];
    const sparseMelds = new Array(1) as unknown as MeldInput[];
    const sparseMeldTile = [
      { tiles: new Array(1), isKan: false, concealed: false },
    ] as unknown as MeldInput[];

    expect(waitingTiles(sparseTiles)).toEqual([]);
    expect(isTenpai(sparseTiles)).toBe(false);
    expect(waitingTiles([], sparseMelds)).toEqual([]);
    expect(isTenpai([], sparseMelds)).toBe(false);
    expect(waitingTiles([], sparseMeldTile)).toEqual([]);
    expect(isTenpai([], sparseMeldTile)).toBe(false);
  });
});
