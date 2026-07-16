/**
 * 結合テスト①「牌保存」(issue #90 / spec setup-and-tiles・domain-model 4.4)。
 *
 * モジュール横断の不変条件を固める:
 *   buildTileSet(108枚) → buildWall(シャッフル) → dealStartingHands(3人×13)
 *   → draw / drawReplacement を通じて、
 *   - 牌総数は常に 108
 *   - 牌種別(suit+rank)ごとの枚数が保存される
 *   - オール赤5(赤5筒4 + 赤5索4 = 8枚)が保存され、他に赤牌は存在しない
 *
 * scoring(#66)には非依存。決定的(seed 固定)で再現可能。
 */

import { describe, expect, it } from "vitest";
import {
  dealStartingHands,
  SEATED_PLAYER_COUNT,
  STARTING_HAND_SIZE,
} from "../deal/deal";
import { createSeededRng } from "../random/rng";
import type { Tile } from "../tiles/tile";
import { buildTileSet, TOTAL_TILE_COUNT } from "../tiles/tileSet";
import { buildWall, DEAD_WALL_SIZE } from "../wall/wall";

/** 赤フラグまで含めた牌の同一性キー(牌保存の照合に用いる)。 */
function tileTag(tile: Tile): string {
  return `${tile.suit}-${tile.rank}-${tile.isRed ? "R" : "N"}`;
}

/** 牌集合を「種別(赤込み)→枚数」の多重集合に集計する。 */
function tally(tiles: Iterable<Tile>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const tile of tiles) {
    const key = tileTag(tile);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** 2つの多重集合が完全一致することを表明する(牌保存の中核)。 */
function expectSameMultiset(a: Map<string, number>, b: Map<string, number>) {
  expect(a.size).toBe(b.size);
  for (const [key, count] of a) {
    expect(b.get(key)).toBe(count);
  }
}

/** その局で使う全108枚の正準多重集合(未シャッフル)。 */
const CANONICAL = tally(buildTileSet());

const SEEDS = [1, 7, 42, 2718, 123456] as const;

describe("結合①: 牌保存(tiles → wall → deal → draw/drawReplacement)", () => {
  it("buildTileSet は 108枚・赤は 5筒×4 + 5索×4 のみ", () => {
    const set = buildTileSet();
    expect(set).toHaveLength(TOTAL_TILE_COUNT);

    const reds = set.filter((t) => t.isRed);
    expect(reds).toHaveLength(8);
    expect(
      reds.every((t) => t.rank === 5 && (t.suit === "pin" || t.suit === "sou")),
    ).toBe(true);
    expect(reds.filter((t) => t.suit === "pin")).toHaveLength(4);
    expect(reds.filter((t) => t.suit === "sou")).toHaveLength(4);

    // 種別枚数の代表点(サンマ牌構成 spec 1.2)。
    const byKind = tally(set);
    expect(byKind.get("man-1-N")).toBe(4);
    expect(byKind.get("man-9-N")).toBe(4);
    // 萬子 2〜8 は存在しない。
    for (let rank = 2; rank <= 8; rank++) {
      expect(byKind.get(`man-${rank}-N`)).toBeUndefined();
    }
    expect(byKind.get("pin-5-R")).toBe(4); // 赤5筒
    expect(byKind.get("sou-5-R")).toBe(4); // 赤5索
    expect(byKind.get("honor-4-N")).toBe(4); // 北
  });

  it.each(SEEDS)("シャッフル(seed=%i)は多重集合を保存する", (seed) => {
    const wall = buildWall(createSeededRng(seed));
    const inWall = [...wall.liveWall, ...wall.deadWall];
    expect(inWall).toHaveLength(TOTAL_TILE_COUNT);
    expectSameMultiset(tally(inWall), CANONICAL);
  });

  it.each(SEEDS)(
    "配牌(seed=%i)で 3人×13枚を配っても牌総数・種別が保存される",
    (seed) => {
      const wall = buildWall(createSeededRng(seed));
      const liveBefore = wall.remainingLiveTiles;

      const hands = dealStartingHands(wall);
      expect(hands).toHaveLength(SEATED_PLAYER_COUNT);
      for (const hand of hands) expect(hand).toHaveLength(STARTING_HAND_SIZE);

      // ライブ壁はちょうど 3×13=39 枚減る。王牌は不変(既定14枚)。
      const dealt = hands.flat();
      expect(dealt).toHaveLength(SEATED_PLAYER_COUNT * STARTING_HAND_SIZE);
      expect(wall.remainingLiveTiles).toBe(liveBefore - dealt.length);
      expect(wall.deadWall).toHaveLength(DEAD_WALL_SIZE);

      // 配牌後も 山(live+dead)+ 配った手牌 = 正準多重集合。
      const union = tally([...wall.liveWall, ...wall.deadWall, ...dealt]);
      expectSameMultiset(union, CANONICAL);
    },
  );

  it.each(SEEDS)(
    "ツモ/嶺上補充(seed=%i)を混在させても常に 108枚・種別保存",
    (seed) => {
      const wall = buildWall(createSeededRng(seed));
      const dealt = dealStartingHands(wall).flat();
      const out: Tile[] = [...dealt]; // 山の外に出た牌(配牌+ツモ+嶺上)

      /** 山内(live+dead)+ 山外(out) が常に正準多重集合であることを検証。 */
      const assertConserved = () => {
        const union = tally([...wall.liveWall, ...wall.deadWall, ...out]);
        expect(union.size).toBe(CANONICAL.size);
        expectSameMultiset(union, CANONICAL);

        // 赤5保存: 常に赤は 8枚、かつ 5筒/5索 のみ。
        const reds = [...wall.liveWall, ...wall.deadWall, ...out].filter(
          (t) => t.isRed,
        );
        expect(reds).toHaveLength(8);
        expect(
          reds.every(
            (t) => t.rank === 5 && (t.suit === "pin" || t.suit === "sou"),
          ),
        ).toBe(true);
      };

      assertConserved();

      // 通常ツモ 20 回・嶺上補充 4 回(北抜き/カン相当)を交互に消費。
      for (let i = 0; i < 20; i++) {
        out.push(wall.draw());
        if (i % 5 === 0) out.push(wall.drawReplacement());
        assertConserved();
      }
    },
  );
});
