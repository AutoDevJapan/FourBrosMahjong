import { describe, expect, it } from "vitest";
import { createSeededRng } from "../random/rng";
import type { Tile } from "../tiles/tile";
import { buildTileSet, TOTAL_TILE_COUNT } from "../tiles/tileSet";
import {
  buildWall,
  DEAD_WALL_SIZE,
  DORA_INDICATOR_RESERVE,
  MAX_REPLACEMENTS_PER_HAND,
  Wall,
  WallEmptyError,
} from "./wall";

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

    it("deadWallSize がドラ表示牌の確保枚数未満なら RangeError(0 は許す / #386)", () => {
      // 1〜5 は表示牌領域を確保すると嶺上が1枚も供給できず、遅延した
      // WallEmptyError になる。構築時に落とす。
      for (let size = 1; size < DORA_INDICATOR_RESERVE; size++) {
        expect(() => new Wall(buildTileSet(), size)).toThrow(RangeError);
      }
      expect(() => new Wall(buildTileSet(), 0)).not.toThrow();
      expect(
        () => new Wall(buildTileSet(), DORA_INDICATOR_RESERVE),
      ).not.toThrow();
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

    it("ライブ壁が空なら嶺上供給領域が減り、尽きると WallEmptyError(表示牌は配らない)", () => {
      const wall = new Wall(buildTileSet(), 14);
      for (let i = 0; i < 94; i++) {
        wall.draw(); // ライブ壁を空にする
      }
      // 以降の嶺上補充はライブ壁補填が無く、嶺上供給領域(14 − 6 = 8枚)が減る。
      const available = DEAD_WALL_SIZE - DORA_INDICATOR_RESERVE;
      expect(available).toBe(MAX_REPLACEMENTS_PER_HAND);
      for (let i = 0; i < available; i++) {
        expect(() => wall.drawReplacement()).not.toThrow();
      }
      // 残る6枚はドラ表示牌用の確保領域。配らずに WallEmptyError にする(#386)。
      expect(wall.remainingReplacements).toBe(0);
      expect(wall.deadWall).toHaveLength(DORA_INDICATOR_RESERVE);
      expect(() => wall.drawReplacement()).toThrow(WallEmptyError);
    });

    it("末尾から供給する順序は確保領域の導入前後で変わらない", () => {
      const tiles = buildTileSet();
      const wall = new Wall(tiles, 14);
      // 王牌 = tiles[94..107]。嶺上は末尾から順に供給される。
      for (let i = 0; i < MAX_REPLACEMENTS_PER_HAND; i++) {
        expect(key(wall.drawReplacement())).toBe(key(tiles[107 - i]));
      }
    });
  });

  describe("ドラ表示牌の確保領域(#386)", () => {
    it("王牌の先頭 DORA_INDICATOR_RESERVE 枚は嶺上として供給されない", () => {
      const tiles = buildTileSet();
      const wall = new Wall(tiles, DEAD_WALL_SIZE);
      // `createDoraSet` が表/裏の表示牌を取る領域(= 王牌先頭 6枚)。
      const reserved = wall.deadWall.slice(0, DORA_INDICATOR_RESERVE);

      // ライブ壁が有る限り補充回数に上限は無い。上限の倍以上引いても漏れないこと。
      const drawn: Tile[] = [];
      for (let i = 0; i < MAX_REPLACEMENTS_PER_HAND * 3; i++) {
        drawn.push(wall.drawReplacement());
      }

      // 牌の**実体**(参照)で照合する。同種の別牌との取り違えを避けるため、
      // マッチャの比較方式に依存しない形で書く。
      expect(drawn.some((tile) => reserved.includes(tile))).toBe(false);
      // 確保領域は消費されず、位置も内容も変わらない。
      expect(wall.deadWall.slice(0, DORA_INDICATOR_RESERVE)).toEqual(reserved);
    });

    it("王牌が確保枚数ちょうどなら嶺上は供給できない(表示牌領域へ食い込ませない)", () => {
      const wall = new Wall(buildTileSet(), DORA_INDICATOR_RESERVE);
      expect(wall.remainingReplacements).toBe(0);
      expect(() => wall.drawReplacement()).toThrow(WallEmptyError);
    });

    it("既定より小さい王牌でも確保後の残り枚数だけ供給できる(deadWallSize=10)", () => {
      const deadWallSize = 10;
      const wall = new Wall(buildTileSet(), deadWallSize);
      const available = deadWallSize - DORA_INDICATOR_RESERVE;
      expect(wall.remainingReplacements).toBe(available);
      // ライブ壁を空にして補填を止める(補填がある間は供給領域が減らない)。
      const liveWallSize = TOTAL_TILE_COUNT - deadWallSize;
      for (let i = 0; i < liveWallSize; i++) wall.draw();
      for (let i = 0; i < available; i++) {
        expect(() => wall.drawReplacement()).not.toThrow();
      }
      expect(() => wall.drawReplacement()).toThrow(WallEmptyError);
    });

    it("補充後も deadWall の末尾が次に供給される嶺上牌である", () => {
      // `engine.riichi-ankan.test.ts` がこの対応に依存している(嶺上牌を覗いて
      // フィクスチャを組む)。領域分割で要素順が変わったため明示的に固定する。
      const wall = new Wall(buildTileSet(), DEAD_WALL_SIZE);
      for (let i = 0; i < 3; i++) wall.drawReplacement();
      const dead = wall.deadWall;
      expect(wall.drawReplacement()).toBe(dead[dead.length - 1]);
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
