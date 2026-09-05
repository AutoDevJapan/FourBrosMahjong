import { describe, expect, it } from "vitest";
import { createSeededRng } from "../random/rng";
import type { Tile } from "../tiles/tile";
import { buildTileSet } from "../tiles/tileSet";
import { buildWall, Wall, WallEmptyError } from "../wall/wall";
import {
  dealStartingHands,
  SEATED_PLAYER_COUNT,
  STARTING_HAND_SIZE,
} from "./deal";

function key(tile: Tile): string {
  return `${tile.suit}-${tile.rank}-${tile.isRed ? "r" : "n"}`;
}

describe("dealStartingHands(配牌 / スペック2 2.1)", () => {
  it("着席3人へ13枚ずつ配る", () => {
    expect(SEATED_PLAYER_COUNT).toBe(3);
    expect(STARTING_HAND_SIZE).toBe(13);
    const wall = buildWall(createSeededRng(1));
    const hands = dealStartingHands(wall);
    expect(hands).toHaveLength(3);
    for (const hand of hands) {
      expect(hand).toHaveLength(13);
    }
  });

  it("配牌後、ライブ壁は 39枚(3×13)だけ減る", () => {
    const wall = buildWall(createSeededRng(2));
    const liveBefore = wall.remainingLiveTiles;
    dealStartingHands(wall);
    expect(wall.remainingLiveTiles).toBe(liveBefore - 39);
  });

  it("配牌後も 手牌 + 山内総数 = 108(不変条件 / スペック4 4.4)", () => {
    const wall = buildWall(createSeededRng(3));
    const hands = dealStartingHands(wall);
    const dealt = hands.reduce((sum, hand) => sum + hand.length, 0);
    const inWall = wall.liveWall.length + wall.deadWall.length;
    expect(dealt).toBe(39);
    expect(dealt + inWall).toBe(108);
  });

  it("配った牌は重複しない(全て別の物理牌)", () => {
    const wall = buildWall(createSeededRng(4));
    const hands = dealStartingHands(wall);
    const all = hands.flat();
    // 山内に残る牌と手牌を合わせれば、牌構成の多重集合と一致する。
    const combined = [...all, ...wall.liveWall, ...wall.deadWall]
      .map(key)
      .sort();
    const wall2 = buildWall(createSeededRng(4));
    const expected = [...wall2.liveWall, ...wall2.deadWall].map(key).sort();
    expect(combined).toEqual(expected);
  });

  it("同じ seed の山からは同じ配牌になる(再現性)", () => {
    const a = dealStartingHands(buildWall(createSeededRng(777)));
    const b = dealStartingHands(buildWall(createSeededRng(777)));
    expect(a.map((h) => h.map(key))).toEqual(b.map((h) => h.map(key)));
  });

  it("ラウンドロビン配牌: k 番目の牌が player=k%3 に渡る", () => {
    // 山の並びを固定して手順を検証(1枚ずつ順に配る)。
    const wall = buildWall(createSeededRng(9));
    const live = [...wall.liveWall];
    const hands = dealStartingHands(wall);
    for (let round = 0; round < STARTING_HAND_SIZE; round++) {
      for (let p = 0; p < SEATED_PLAYER_COUNT; p++) {
        const expected = live[round * SEATED_PLAYER_COUNT + p];
        expect(key(hands[p][round])).toBe(key(expected));
      }
    }
  });

  it("ライブ壁が足りなければ WallEmptyError を送出する", () => {
    // ライブ壁を38枚だけにする(王牌70枚)と 39枚配れず途中で尽きる。
    const wall = new Wall(buildTileSet(), 70);
    expect(wall.remainingLiveTiles).toBe(38);
    expect(() => dealStartingHands(wall)).toThrow(WallEmptyError);
  });

  it("配牌に失敗したときは壁を消費しない", () => {
    const wall = new Wall(buildTileSet(), 70);
    const liveBefore = [...wall.liveWall];
    const deadBefore = [...wall.deadWall];

    expect(() => dealStartingHands(wall)).toThrow(WallEmptyError);

    expect(wall.liveWall).toEqual(liveBefore);
    expect(wall.deadWall).toEqual(deadBefore);
  });
});
