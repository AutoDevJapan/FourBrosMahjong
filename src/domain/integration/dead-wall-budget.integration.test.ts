/**
 * 結合: 王牌の予算(ドラ表示牌の確保 × 嶺上供給の上限)(issue #386)。
 *
 * 王牌14枚は「ドラ表示牌の確保領域(表3+裏3=6)」と「嶺上供給領域(8)」に分かれる。
 * 8 は1局で発生し得る嶺上補充の上限(北4 + カン4)と**ちょうど一致**しており、
 * 余裕はゼロである。したがってこの等式は暗黙の前提ではなく、明示的に固定すべき
 * 不変条件になる。
 *
 * 修正前は表示牌の選定(王牌**先頭**から)と嶺上供給(王牌**末尾**から `pop` し
 * 先頭へ補填)が同じ配列を共有しており、補充のたびに表示牌が末尾へ押し出されて、
 * 9回目の補充で**場に晒された表示牌そのもの**がプレイヤーの手に配られていた。
 */

import { describe, expect, it } from "vitest";
import { createDoraSet } from "../dora/doraSet";
import { FOUR_KAN_ABORT_THRESHOLD } from "../game/engine";
import { createSeededRng } from "../random/rng";
import type { Tile } from "../tiles/tile";
import { COPIES_PER_TILE } from "../tiles/tileSet";
import {
  buildWall,
  DEAD_WALL_SIZE,
  DORA_INDICATOR_RESERVE,
  MAX_REPLACEMENTS_PER_HAND,
} from "../wall/wall";

/** 表ドラ3枚 = 表示牌が最大(6枚)になる出目。境界はここでしか現れない。 */
const MAX_DORA_ROLL = [6, 6] as const;

const SEEDS = [1, 42, 386, 2024] as const;

describe("結合: 王牌の予算(ドラ表示牌の確保 × 嶺上供給の上限 / #386)", () => {
  it("嶺上補充の上限は 北抜き4 + カン4 で、確保後の王牌残量とちょうど一致する", () => {
    // 北は牌構成上4枚しか無い(1枚につき1回の嶺上補充)。
    // カンは5組目が四槓散了で途中流局になり嶺上を引かないため4回が上限。
    expect(MAX_REPLACEMENTS_PER_HAND).toBe(
      COPIES_PER_TILE + FOUR_KAN_ABORT_THRESHOLD,
    );
    expect(DEAD_WALL_SIZE - DORA_INDICATOR_RESERVE).toBe(
      MAX_REPLACEMENTS_PER_HAND,
    );
    // 確保領域は表ドラ上限3枚 + 裏ドラ同数。
    expect(DORA_INDICATOR_RESERVE).toBe(6);
  });

  it.each(SEEDS)(
    "seed=%i: 上限いっぱいの嶺上補充でも表ドラ/裏ドラ表示牌は手に配られない",
    (seed) => {
      const wall = buildWall(createSeededRng(seed));
      const doraSet = createDoraSet(wall.deadWall, MAX_DORA_ROLL);
      expect(doraSet.count).toBe(3);
      const indicators = [...doraSet.indicators, ...doraSet.uraIndicators];
      expect(indicators).toHaveLength(DORA_INDICATOR_RESERVE);

      const drawn: Tile[] = [];
      for (let i = 0; i < MAX_REPLACEMENTS_PER_HAND; i++) {
        drawn.push(wall.drawReplacement());
      }

      // 牌の**実体**(参照)で照合する。同種の別牌との取り違えを避けるため。
      for (const tile of drawn) {
        expect(indicators).not.toContain(tile);
      }
    },
  );

  it.each(SEEDS)(
    "seed=%i: 上限を超えて補充しても表示牌は配られない(構造的に不可能)",
    (seed) => {
      // 修正前は 9回目(= 王牌14 − (2×3 − 1))で表示牌が配られていた。
      // ライブ壁がある限り補充枚数はライブ壁から補填されるため、上限を超えて
      // 引いても確保領域には到達しない。
      const wall = buildWall(createSeededRng(seed));
      const doraSet = createDoraSet(wall.deadWall, MAX_DORA_ROLL);
      const indicators = [...doraSet.indicators, ...doraSet.uraIndicators];

      const drawn: Tile[] = [];
      for (let i = 0; i < MAX_REPLACEMENTS_PER_HAND * 2; i++) {
        drawn.push(wall.drawReplacement());
      }

      for (const tile of drawn) {
        expect(indicators).not.toContain(tile);
      }
      // 確保領域は最後まで王牌の先頭に残り続ける。
      expect(wall.deadWall.slice(0, DORA_INDICATOR_RESERVE)).toEqual(
        indicators,
      );
    },
  );
});
