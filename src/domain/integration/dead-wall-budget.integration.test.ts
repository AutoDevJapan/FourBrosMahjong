/**
 * 結合: 王牌の予算(ドラ表示牌の確保 × 嶺上供給の上限)(issue #386)。
 *
 * 王牌14枚は「ドラ表示牌の確保領域(表3+裏3=6)」と「嶺上供給領域(8)」に分かれる。
 * 8 は1局で発生し得る嶺上補充の上限(北4 + カン4)と**ちょうど一致**しており、
 * 余裕はゼロである。したがって
 * `DEAD_WALL_SIZE − DORA_INDICATOR_RESERVE >= MAX_REPLACEMENTS_PER_HAND`
 * は暗黙の前提ではなく、明示的に固定すべき不変条件になる。
 *
 * なお供給領域が実際に減るのは**海底(ライブ壁が空で補填が入らない)での補充**だけで、
 * ライブ壁が残る限り補充回数に上限は無い。上の 8 は設計上の安全側の見積りである。
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
  MAX_KAN_PER_HAND,
  MAX_REPLACEMENTS_PER_HAND,
} from "../wall/wall";

/** 表ドラ3枚 = 表示牌が最大(6枚)になる出目。境界はここでしか現れない。 */
const MAX_DORA_ROLL = [6, 6] as const;

const SEEDS = [1, 42, 386, 2024] as const;

describe("結合: 王牌の予算(ドラ表示牌の確保 × 嶺上供給の上限 / #386)", () => {
  it("嶺上補充の上限は 北抜き(北の枚数)+ カン(手牌の面子上限)で決まる", () => {
    // 北は牌構成上4枚しか無い(1枚につき1回の嶺上補充)。
    expect(MAX_REPLACEMENTS_PER_HAND).toBe(COPIES_PER_TILE + MAX_KAN_PER_HAND);
    // カン上限を駆動しているのは「1人の手牌に作れる面子は最大4つ」であって、
    // 四槓散了のしきい値ではない(1人四槓は散了しないため、しきい値を動かしても
    // この経路の4回は変わらない)。
    expect(MAX_KAN_PER_HAND).toBe(4);
  });

  it("四槓散了のしきい値を上げてもカン由来の補充が上限を超えない", () => {
    // 複数家にまたがる経路では、散了判定が嶺上補充より先に走るため
    // しきい値の1つ手前まで嶺上を引ける。ここが手牌の面子上限を超えると
    // 嶺上供給領域の見積りが破れる。
    expect(FOUR_KAN_ABORT_THRESHOLD - 1).toBeLessThanOrEqual(MAX_KAN_PER_HAND);
  });

  it("嶺上供給領域は 1局の嶺上補充上限を賄える", () => {
    // 守るべき不変条件は不等式。現状は等号成立(= 余裕ゼロ)。
    expect(DEAD_WALL_SIZE - DORA_INDICATOR_RESERVE).toBeGreaterThanOrEqual(
      MAX_REPLACEMENTS_PER_HAND,
    );
    // 現在値も個別に固定する。上の不等式は3つの定数を同時に動かすと成立したまま
    // 意味が変わるため、増減どちらの変更でもここが red になって設計判断を促す。
    expect(DEAD_WALL_SIZE).toBe(14);
    expect(DORA_INDICATOR_RESERVE).toBe(6); // 表ドラ上限3枚 + 裏ドラ同数
    expect(MAX_REPLACEMENTS_PER_HAND).toBe(8);
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

      // 牌の**実体**(参照)で照合する。同種の別牌との取り違えを避けるため、
      // マッチャの比較方式に依存しない形で書く。
      expect(drawn.some((tile) => indicators.includes(tile))).toBe(false);
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

      expect(drawn.some((tile) => indicators.includes(tile))).toBe(false);
      // 確保領域は最後まで王牌の先頭に残り続ける。
      expect(wall.deadWall.slice(0, DORA_INDICATOR_RESERVE)).toEqual(
        indicators,
      );
    },
  );
});
