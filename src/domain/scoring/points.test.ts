import { describe, expect, it } from "vitest";
import {
  computeScore,
  handValueFromHan,
  type ScoreCategory,
  type TsumoPayments,
} from "./points";

/** 非役満(翻指定)の入力ヘルパ。 */
function han(n: number) {
  return { han: n, yakumanMultiplier: 0 };
}

describe("computeScore — 標準テーブル(スペック3 3.1)", () => {
  const cases: Array<{
    han: number;
    category: ScoreCategory;
    childRon: number;
    dealerRon: number;
  }> = [
    { han: 5, category: "mangan", childRon: 8000, dealerRon: 12000 },
    { han: 6, category: "haneman", childRon: 12000, dealerRon: 18000 },
    { han: 7, category: "haneman", childRon: 12000, dealerRon: 18000 },
    { han: 8, category: "baiman", childRon: 16000, dealerRon: 24000 },
    { han: 10, category: "baiman", childRon: 16000, dealerRon: 24000 },
    { han: 11, category: "sanbaiman", childRon: 24000, dealerRon: 36000 },
    { han: 12, category: "sanbaiman", childRon: 24000, dealerRon: 36000 },
    { han: 13, category: "yakuman", childRon: 32000, dealerRon: 48000 },
  ];

  for (const c of cases) {
    it(`${c.han}翻 → ${c.category}(子${c.childRon}/親${c.dealerRon})`, () => {
      const child = computeScore(han(c.han), false);
      const dealer = computeScore(han(c.han), true);
      expect(child.category).toBe(c.category);
      expect(child.ronTotal).toBe(c.childRon);
      expect(dealer.ronTotal).toBe(c.dealerRon);
    });
  }

  it("13翻以上は数え役満(点数は役満・構成役満ではない)", () => {
    const r = computeScore(han(15), false);
    expect(r.category).toBe("yakuman");
    expect(r.isCountedYakuman).toBe(true);
    expect(r.isTrueYakuman).toBe(false);
    expect(r.ronTotal).toBe(32000);
  });
});

describe("computeScore — 4翻以下(符なし=一律30符)", () => {
  const table: Array<[number, number, number]> = [
    // [han, childRon, dealerRon]
    [1, 1000, 1500],
    [2, 2000, 2900],
    [3, 3900, 5800],
    [4, 7700, 11600],
  ];
  for (const [h, childRon, dealerRon] of table) {
    it(`${h}翻 → 子${childRon}/親${dealerRon}`, () => {
      expect(computeScore(han(h), false).ronTotal).toBe(childRon);
      expect(computeScore(han(h), true).ronTotal).toBe(dealerRon);
      expect(computeScore(han(h), false).category).toBe("normal");
    });
  }

  it("han が 1 未満・非整数なら RangeError", () => {
    expect(() => computeScore(han(0), false)).toThrow(RangeError);
    expect(() => computeScore(han(2.5), false)).toThrow(RangeError);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_VALUE])(
    "han=%s は安全整数でないため RangeError",
    (invalid) => {
      expect(() => computeScore(han(invalid), false)).toThrow(RangeError);
    },
  );

  it.each([undefined, null, 0, 1, "false", {}])(
    "親フラグが真偽値でなければ TypeError (%s)",
    (invalid) => {
      expect(() => computeScore(han(5), invalid as unknown as boolean)).toThrow(
        TypeError,
      );
    },
  );
});

describe("computeScore — ツモ配分(Q12 ツモ損なし・北家折半)", () => {
  const table: Array<{
    label: string;
    han: number;
    childFromDealer: number; // 子ツモ: 親払い
    childFromChild: number; // 子ツモ: 子払い
    dealerFromChild: number; // 親ツモ: 子各払い
  }> = [
    {
      label: "満貫",
      han: 5,
      childFromDealer: 5000,
      childFromChild: 3000,
      dealerFromChild: 6000,
    },
    {
      label: "跳満",
      han: 6,
      childFromDealer: 7500,
      childFromChild: 4500,
      dealerFromChild: 9000,
    },
    {
      label: "倍満",
      han: 8,
      childFromDealer: 10000,
      childFromChild: 6000,
      dealerFromChild: 12000,
    },
    {
      label: "三倍満",
      han: 11,
      childFromDealer: 15000,
      childFromChild: 9000,
      dealerFromChild: 18000,
    },
    {
      label: "役満",
      han: 13,
      childFromDealer: 20000,
      childFromChild: 12000,
      dealerFromChild: 24000,
    },
  ];

  for (const t of table) {
    it(`${t.label}: 子ツモ 親${t.childFromDealer}/子${t.childFromChild}・親ツモ 子${t.dealerFromChild}`, () => {
      const child = computeScore(han(t.han), false);
      const childTsumo: TsumoPayments = child.tsumo;
      expect(childTsumo.fromDealer).toBe(t.childFromDealer);
      expect(childTsumo.fromNonDealer).toBe(t.childFromChild);
      // 子ツモ総額(親1 + 子1)= ロンと同額(ツモ損なし)
      expect(child.tsumo.total).toBe(child.ronTotal);

      const dealer = computeScore(han(t.han), true);
      expect(dealer.tsumo.fromDealer).toBe(0);
      expect(dealer.tsumo.fromNonDealer).toBe(t.dealerFromChild);
      // 親ツモ総額(子2人)= ロンと同額
      expect(dealer.tsumo.total).toBe(dealer.ronTotal);
    });
  }
});

describe("computeScore — 構成役満(倍数対応)", () => {
  it("シングル役満は子32000/親48000", () => {
    const r = computeScore({ han: 0, yakumanMultiplier: 1 }, false);
    expect(r.isTrueYakuman).toBe(true);
    expect(r.isCountedYakuman).toBe(false);
    expect(r.ronTotal).toBe(32000);
    expect(r.basePoints).toBe(8000);
  });

  it("ダブル役満は基本点2倍(子64000)", () => {
    const r = computeScore({ han: 0, yakumanMultiplier: 2 }, false);
    expect(r.basePoints).toBe(16000);
    expect(r.ronTotal).toBe(64000);
  });

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
  ])("役満倍数 %s は非負の安全整数でないため RangeError", (invalid) => {
    expect(() =>
      computeScore({ han: 0, yakumanMultiplier: invalid }, false),
    ).toThrow(RangeError);
  });

  it("乗算後の点数が安全整数範囲を超える役満倍数を拒否する", () => {
    expect(() =>
      computeScore(
        { han: 0, yakumanMultiplier: Number.MAX_SAFE_INTEGER },
        false,
      ),
    ).toThrow(RangeError);
  });
});

describe("handValueFromHan — 役翻+ドラ翻の結線(#65 + #64)", () => {
  it("非役満は役翻とドラ翻を合算する", () => {
    expect(handValueFromHan(3, 4, 0)).toEqual({ han: 7, yakumanMultiplier: 0 });
  });

  it("合算13翻以上は数え役満へ(computeScore で判定)", () => {
    const v = handValueFromHan(6, 7, 0);
    expect(v.han).toBe(13);
    expect(computeScore(v, false).isCountedYakuman).toBe(true);
  });

  it("構成役満はドラを合算しない(役満倍数を優先)", () => {
    expect(handValueFromHan(0, 5, 1)).toEqual({ han: 0, yakumanMultiplier: 1 });
  });
});
