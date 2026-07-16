import { describe, expect, it } from "vitest";
import { computeScore } from "./points";
import {
  type SeatedPlayerRef,
  type WinPaymentInput,
  chomboPenalty,
  resolveWinPayment,
} from "./win-payment";

const D: SeatedPlayerRef = { id: "dealer", isDealer: true };
const C1: SeatedPlayerRef = { id: "child1", isDealer: false };
const C2: SeatedPlayerRef = { id: "child2", isDealer: false };

/** deltas が総和ゼロであることを検証。 */
function expectZeroSum(deltas: Record<string, number>) {
  const sum = Object.values(deltas).reduce((a, b) => a + b, 0);
  expect(sum).toBe(0);
}

const mangan = computeScore({ han: 5, yakumanMultiplier: 0 }, false); // 子満貫
const dealerMangan = computeScore({ han: 5, yakumanMultiplier: 0 }, true); // 親満貫
const yakuman = computeScore({ han: 0, yakumanMultiplier: 1 }, false); // 子役満

describe("resolveWinPayment — ロン", () => {
  it("子ロン: 放銃者が全額、他家は0、総和ゼロ", () => {
    const input: WinPaymentInput = {
      winner: C1,
      winType: "ron",
      score: mangan,
      discarderId: "dealer",
      others: [D, C2],
    };
    const { deltas, stickPayout } = resolveWinPayment(input);
    expect(deltas.child1).toBe(8000);
    expect(deltas.dealer).toBe(-8000);
    expect(deltas.child2).toBe(0);
    expect(stickPayout).toBe(0);
    expectZeroSum(deltas);
  });

  it("親ロン: 12000 を放銃者が払う", () => {
    const { deltas } = resolveWinPayment({
      winner: D,
      winType: "ron",
      score: dealerMangan,
      discarderId: "child1",
      others: [C1, C2],
    });
    expect(deltas.dealer).toBe(12000);
    expect(deltas.child1).toBe(-12000);
    expectZeroSum(deltas);
  });

  it("ロンで discarderId 未指定なら RangeError", () => {
    expect(() =>
      resolveWinPayment({
        winner: C1,
        winType: "ron",
        score: mangan,
        others: [D, C2],
      }),
    ).toThrow(RangeError);
  });
});

describe("resolveWinPayment — ツモ(サンマ北家折半)", () => {
  it("子ツモ満貫: 親5000/子3000、総和ゼロ", () => {
    const { deltas } = resolveWinPayment({
      winner: C1,
      winType: "tsumo",
      score: mangan,
      others: [D, C2],
    });
    expect(deltas.child1).toBe(8000);
    expect(deltas.dealer).toBe(-5000);
    expect(deltas.child2).toBe(-3000);
    expectZeroSum(deltas);
  });

  it("親ツモ満貫: 子6000×2、総和ゼロ", () => {
    const { deltas } = resolveWinPayment({
      winner: D,
      winType: "tsumo",
      score: dealerMangan,
      others: [C1, C2],
    });
    expect(deltas.dealer).toBe(12000);
    expect(deltas.child1).toBe(-6000);
    expect(deltas.child2).toBe(-6000);
    expectZeroSum(deltas);
  });
});

describe("resolveWinPayment — 本場・供託", () => {
  it("ロン: 本場は放銃者が300×本場を追加負担", () => {
    const { deltas } = resolveWinPayment({
      winner: C1,
      winType: "ron",
      score: mangan,
      discarderId: "dealer",
      others: [D, C2],
      honba: 2,
    });
    expect(deltas.child1).toBe(8000 + 600);
    expect(deltas.dealer).toBe(-(8000 + 600));
    expectZeroSum(deltas);
  });

  it("ツモ: 本場は各支払者が100×本場を追加負担", () => {
    const { deltas } = resolveWinPayment({
      winner: C1,
      winType: "tsumo",
      score: mangan,
      others: [D, C2],
      honba: 1,
    });
    expect(deltas.dealer).toBe(-(5000 + 100));
    expect(deltas.child2).toBe(-(3000 + 100));
    expect(deltas.child1).toBe(8000 + 200);
    expectZeroSum(deltas);
  });

  it("供託リーチ棒は stickPayout として別枠回収(deltas は総和ゼロのまま)", () => {
    const { deltas, stickPayout } = resolveWinPayment({
      winner: C1,
      winType: "ron",
      score: mangan,
      discarderId: "dealer",
      others: [D, C2],
      riichiSticks: 3,
    });
    expect(stickPayout).toBe(3000);
    expectZeroSum(deltas);
  });

  it("本場は非負整数のみ", () => {
    expect(() =>
      resolveWinPayment({
        winner: C1,
        winType: "tsumo",
        score: mangan,
        others: [D, C2],
        honba: -1,
      }),
    ).toThrow(RangeError);
  });
});

describe("resolveWinPayment — パオ(責任払い)", () => {
  it("パオ・ロン(責任者≠放銃者): 折半 16000/16000", () => {
    const { deltas } = resolveWinPayment({
      winner: C1,
      winType: "ron",
      score: yakuman,
      discarderId: "child2",
      others: [D, C2],
      paoResponsibleId: "dealer",
    });
    expect(deltas.child1).toBe(32000);
    expect(deltas.dealer).toBe(-16000); // パオ責任者
    expect(deltas.child2).toBe(-16000); // 放銃者
    expectZeroSum(deltas);
  });

  it("パオ・ロン(責任者=放銃者): 全額1人負担", () => {
    const { deltas } = resolveWinPayment({
      winner: C1,
      winType: "ron",
      score: yakuman,
      discarderId: "dealer",
      others: [D, C2],
      paoResponsibleId: "dealer",
    });
    expect(deltas.dealer).toBe(-32000);
    expect(deltas.child2).toBe(0);
    expectZeroSum(deltas);
  });

  it("パオ・ツモ: 責任者が全額(他家0)", () => {
    const { deltas } = resolveWinPayment({
      winner: C1,
      winType: "tsumo",
      score: yakuman,
      others: [D, C2],
      paoResponsibleId: "dealer",
    });
    expect(deltas.child1).toBe(32000);
    expect(deltas.dealer).toBe(-32000);
    expect(deltas.child2).toBe(0);
    expectZeroSum(deltas);
  });
});

describe("chomboPenalty — 満貫罰符相当(スペック3 3.4)", () => {
  it("子は8000、親は12000", () => {
    expect(chomboPenalty(false).penalty).toBe(8000);
    expect(chomboPenalty(true).penalty).toBe(12000);
  });
});
