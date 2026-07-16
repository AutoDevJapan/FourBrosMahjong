import { describe, expect, it } from "vitest";
import { createSeededRng } from "../random/rng";
import type { Tile } from "../tiles/tile";
import { buildTileSet, TOTAL_TILE_COUNT } from "../tiles/tileSet";
import { buildWall, DEAD_WALL_SIZE, Wall, WallEmptyError } from "./wall";

/** 山に属する牌の総数(ライブ壁 + 王牌)。不変条件の検証に使う。 */
function tilesInWall(wall: Wall): number {
  return wall.liveWall.length + wall.deadWall.length;
}

function key(tile: Tile): string {
  return `${tile.suit}-${tile.rank}-${tile.isRed ? "r" : "n"}`;
}

describe("Wall(スペック4 4.1)", () => {
  describe("構築", () => {
    it("108枚を ライブ壁(108 - 王牌)+ 王牌(既定14)に区分する", () => {
      const wall = new Wall(buildTileSet());
      expect(DEAD_WALL_SIZE).toBe(14);
      expect(wall.deadWall).toHaveLength(14);
      expect(wall.liveWall).toHaveLength(TOTAL_TILE_COUNT - 14);
      expect(tilesInWall(wall)).toBe(108);
    });

    it("deadWallSize を明示指定できる", () => {
      const wall = new Wall(buildTileSet(), 10);
      expect(wall.deadWall).toHaveLength(10);
      expect(wall.liveWall).toHaveLength(98);
      expect(tilesInWall(wall)).toBe(108);
    });

    it("108枚でなければ RangeError", () => {
      expect(() => new Wall(buildTileSet().slice(0, 107))).toThrow(RangeError);
      expect(
        () => new Wall([...buildTileSet(), ...buildTileSet().slice(0, 1)]),
      ).toThrow(RangeError);
    });

    it("deadWallSize が範囲外なら RangeError", () => {
      expect(() => new Wall(buildTileSet(), -1)).toThrow(RangeError);
      expect(() => new Wall(buildTileSet(), 109)).toThrow(RangeError);
    });

    it("ライブ壁は入力順の前方、王牌は末尾を採用する", () => {
      const tiles = buildTileSet();
      const wall = new Wall(tiles, 14);
      expect(wall.liveWall.map(key)).toEqual(tiles.slice(0, 94).map(key));
      expect(wall.deadWall.map(key)).toEqual(tiles.slice(94).map(key));
    });
  });

  describe("draw()(通常ツモ)", () => {
    it("ライブ壁の先頭から1枚返し、残数を1減らす", () => {
      const tiles = buildTileSet();
      const wall = new Wall(tiles);
      const before = wall.remainingLiveTiles;
      const drawn = wall.draw();
      expect(key(drawn)).toBe(key(tiles[0]));
      expect(wall.remainingLiveTiles).toBe(before - 1);
    });

    it("ツモ済み + 山内総数 は常に108(不変条件 / スペック4 4.4)", () => {
      const wall = buildWall(createSeededRng(1));
      const drawn: Tile[] = [];
      for (let i = 0; i < 30; i++) {
        drawn.push(wall.draw());
        expect(drawn.length + tilesInWall(wall)).toBe(108);
      }
    });

    it("ライブ壁が尽きると WallEmptyError(海底)", () => {
      const wall = new Wall(buildTileSet(), 14); // ライブ壁94枚
      for (let i = 0; i < 94; i++) {
        wall.draw();
      }
      expect(wall.remainingLiveTiles).toBe(0);
      expect(() => wall.draw()).toThrow(WallEmptyError);
    });
  });

  describe("drawReplacement()(嶺上補充: 北抜き/カン)", () => {
    it("嶺上牌を1枚返し、ライブ壁から補填して王牌枚数を保つ", () => {
      const wall = new Wall(buildTileSet(), 14);
      const liveBefore = wall.remainingLiveTiles;
      const rinshan = wall.drawReplacement();
      expect(rinshan).toBeDefined();
      expect(wall.deadWall).toHaveLength(14); // 王牌は補填されて一定
      expect(wall.remainingLiveTiles).toBe(liveBefore - 1); // ライブ壁が1枚減る
      expect(tilesInWall(wall) + 1).toBe(108); // 取り出した1枚を足せば108
    });

    it("標準の4回を超えて補充できる(北4枚+カンに対応)", () => {
      const wall = new Wall(buildTileSet(), 14);
      for (let i = 0; i < 6; i++) {
        expect(() => wall.drawReplacement()).not.toThrow();
      }
      expect(wall.deadWall).toHaveLength(14);
    });

    it("ライブ壁が空なら王牌が減っていき、尽きると WallEmptyError", () => {
      const wall = new Wall(buildTileSet(), 14);
      for (let i = 0; i < 94; i++) {
        wall.draw(); // ライブ壁を空にする
      }
      // 以降の嶺上補充はライブ壁補填が無く、王牌が減る。
      for (let i = 0; i < 14; i++) {
        expect(() => wall.drawReplacement()).not.toThrow();
      }
      expect(wall.deadWall).toHaveLength(0);
      expect(() => wall.drawReplacement()).toThrow(WallEmptyError);
    });
  });

  describe("buildWall(シャッフル込み構築)", () => {
    it("108枚を保持し、多重集合は牌構成と一致する", () => {
      const wall = buildWall(createSeededRng(123));
      expect(tilesInWall(wall)).toBe(108);
      const inWall = [...wall.liveWall, ...wall.deadWall].map(key).sort();
      expect(inWall).toEqual(buildTileSet().map(key).sort());
    });

    it("赤5は8枚が維持される(シャッフル後も)", () => {
      const wall = buildWall(createSeededRng(456));
      const reds = [...wall.liveWall, ...wall.deadWall].filter((t) => t.isRed);
      expect(reds).toHaveLength(8);
      expect(
        reds.every(
          (t) => t.rank === 5 && (t.suit === "pin" || t.suit === "sou"),
        ),
      ).toBe(true);
    });

    it("同じ seed からは同じ山の並びになる(再現性)", () => {
      const a = buildWall(createSeededRng(2024));
      const b = buildWall(createSeededRng(2024));
      expect(a.liveWall.map(key)).toEqual(b.liveWall.map(key));
      expect(a.deadWall.map(key)).toEqual(b.deadWall.map(key));
    });

    it("異なる seed では並びが変わる(未シャッフルの決定的順序でもない)", () => {
      const a = buildWall(createSeededRng(1));
      const b = buildWall(createSeededRng(2));
      expect(a.liveWall.map(key)).not.toEqual(b.liveWall.map(key));
      expect(a.liveWall.map(key)).not.toEqual(
        buildTileSet().slice(0, 94).map(key),
      );
    });
  });
});
