/**
 * 結合テスト③「ドラ結線」(issue #90 / spec game-flow 2.2・scoring 3.2)。
 *
 * サイコロ出目 → 表ドラ枚数 → 王牌からのドラ表示牌選定 → 実ドラ写像 →
 * 和了手へのドラ翻集計、の一連が結線として整合することを固める:
 *   - `createDoraSet` の count は `omoteDoraCount(roll)` に一致し、
 *     `indicators.length === uraIndicators.length === count`(spec 4.4)
 *   - `resolveDora` の各実ドラ牌は `nextTile(indicator)` に一致
 *   - `countDoraHan` が 表/裏(リーチ限定)/赤/ガリ を正しく合算
 *
 * scoring(#66)には非依存(点数変換は呼ばない)。決定的。
 */

import { describe, expect, it } from "vitest";
import type { DiceRoll } from "../dora/dice";
import { omoteDoraCount } from "../dora/dice";
import { createDoraSet, resolveDora } from "../dora/doraSet";
import { countDoraHan } from "../dora/han";
import { nextTile } from "../dora/indicator";
import { parseTiles } from "../hand/notation";
import { sameKind } from "../hand/tile-identity";
import { createSeededRng } from "../random/rng";
import { buildWall } from "../wall/wall";

const ROLLS: readonly { roll: DiceRoll; count: 1 | 2 | 3 }[] = [
  { roll: [3, 5], count: 1 }, // ゾロ目でない
  { roll: [2, 2], count: 2 }, // ゾロ目
  { roll: [6, 6], count: 3 }, // 6ゾロ目
];

describe("結合③: ドラ結線(dice → doraSet → indicator → han)", () => {
  it.each(ROLLS)(
    "王牌から選んだ表/裏ドラの枚数と実ドラ写像が結線として整合($roll)",
    ({ roll, count }) => {
      const wall = buildWall(createSeededRng(20260717));
      const doraSet = createDoraSet(wall.deadWall, roll);

      // count はサイコロ出目由来と一致し、表/裏は同数(spec 4.4)。
      expect(doraSet.count).toBe(omoteDoraCount(roll));
      expect(doraSet.count).toBe(count);
      expect(doraSet.indicators).toHaveLength(count);
      expect(doraSet.uraIndicators).toHaveLength(count);

      // 表示牌は王牌先頭 2×count 枚(前半=表・後半=裏)。
      const head = wall.deadWall.slice(0, count * 2);
      expect(doraSet.indicators).toEqual(head.slice(0, count));
      expect(doraSet.uraIndicators).toEqual(head.slice(count, count * 2));

      // 実ドラ = 表示牌の次牌(indicator モジュールと結線)。
      const resolved = resolveDora(doraSet);
      expect(resolved.omote).toHaveLength(count);
      expect(resolved.ura).toHaveLength(count);
      resolved.omote.forEach((tile, i) => {
        expect(sameKind(tile, nextTile(doraSet.indicators[i]))).toBe(true);
      });
      resolved.ura.forEach((tile, i) => {
        expect(sameKind(tile, nextTile(doraSet.uraIndicators[i]))).toBe(true);
      });
    },
  );

  it("countDoraHan が 表/裏/赤/ガリ を端から端まで合算する", () => {
    // 6ゾロ目 → count=3。王牌を決め打ちして実ドラを既知にする。
    //   表示 [1p,2p,3p] → 表ドラ [2p,3p,4p]
    //   表示 [4p,5p,6p] → 裏ドラ [5p,6p,7p]
    const deadWall = parseTiles("123456p");
    const doraSet = createDoraSet(deadWall, [6, 6]);
    expect(doraSet.count).toBe(3);

    // 和了手(構造上の妥当性は countDoraHan の対象外; 牌集合として集計)。
    //   2p×2 3p×1 4p×1 → 表ドラ一致 4枚
    //   5p×2            → 裏ドラ一致 2枚(リーチ時のみ)
    //   赤5筒×2 赤5索×2  → 赤 4枚
    const hand = parseTiles("22p 3p 4p 55p 55s 789s 111z");

    // 非リーチ + ガリ2枚: 裏は乗らない。
    const noRiichi = countDoraHan({
      hand,
      doraSet,
      riichi: false,
      kitaCount: 2,
    });
    expect(noRiichi).toEqual({ omote: 4, ura: 0, aka: 4, gari: 2, total: 10 });

    // リーチ + ガリ0枚: 裏が同数分乗る。
    const riichi = countDoraHan({ hand, doraSet, riichi: true, kitaCount: 0 });
    expect(riichi).toEqual({ omote: 4, ura: 2, aka: 4, gari: 0, total: 10 });
  });

  it("実配牌の王牌から作った DoraSet でも countDoraHan は例外なく合算できる", () => {
    const wall = buildWall(createSeededRng(2718));
    const doraSet = createDoraSet(wall.deadWall, [6, 6]); // count=3, 王牌14枚で充足
    const hand = wall.deadWall.slice(6); // 表示牌に使われていない残り王牌を手牌に見立てる

    const breakdown = countDoraHan({
      hand,
      doraSet,
      riichi: true,
      kitaCount: 1,
    });
    expect(breakdown.total).toBe(
      breakdown.omote + breakdown.ura + breakdown.aka + breakdown.gari,
    );
    expect(breakdown.gari).toBe(1);
    expect(breakdown.aka).toBe(hand.filter((t) => t.isRed).length);
  });
});
