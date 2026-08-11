import { describe, expect, it } from "vitest";
import { computeScore } from "./points";
import {
  chomboPenalty,
  resolveWinPayment,
  type SeatedPlayerRef,
  type WinPaymentInput,
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

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
  ])("本場 %s は非負の安全整数でないため拒否する", (invalid) => {
    expect(() =>
      resolveWinPayment({
        winner: C1,
        winType: "tsumo",
        score: mangan,
        others: [D, C2],
        honba: invalid,
      }),
    ).toThrow(RangeError);
  });

  it("本場の乗算結果が安全整数範囲を超える場合も拒否する", () => {
    expect(() =>
      resolveWinPayment({
        winner: C1,
        winType: "tsumo",
        score: mangan,
        others: [D, C2],
        honba: Number.MAX_SAFE_INTEGER,
      }),
    ).toThrow(RangeError);
  });

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
  ])("供託 %s は非負の安全整数でないため拒否する", (invalid) => {
    expect(() =>
      resolveWinPayment({
        winner: C1,
        winType: "ron",
        score: mangan,
        discarderId: "dealer",
        others: [D, C2],
        riichiSticks: invalid,
      }),
    ).toThrow(RangeError);
  });

  it("供託の換算結果が安全整数範囲を超える場合も拒否する", () => {
    expect(() =>
      resolveWinPayment({
        winner: C1,
        winType: "ron",
        score: mangan,
        discarderId: "dealer",
        others: [D, C2],
        riichiSticks: Number.MAX_SAFE_INTEGER,
      }),
    ).toThrow(RangeError);
  });

  it("外部から渡された非有限の ScoreResult を支払い前に拒否する", () => {
    expect(() =>
      resolveWinPayment({
        winner: C1,
        winType: "ron",
        score: { ...mangan, ronTotal: Number.POSITIVE_INFINITY },
        discarderId: "dealer",
        others: [D, C2],
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

  /**
   * スペック3 3.1「端数」: パオ・ロンの折半のみ `ceil100(total/2)` で 100 点単位に
   * 切り上げ、**放銃者側が残差を負担**する。
   *
   * パオ対象は構成役満のみで、その総額は基本点 `8,000 × 役満倍数` の 4 倍(子)/6 倍(親)
   * = **必ず 200 の倍数**(32,000 / 48,000 / 64,000 / 96,000 …)。したがって折半に端数は
   * 生じず、この分岐は現行仕様では到達しない。そのため既存テスト(32,000 = 16,000/16,000)
   * では切り上げを切り捨てへ変えても検出できなかった(#389)。
   *
   * `resolveWinPayment` は点数の出所を問わない純関数なので、端数の出る総額を直接与えて
   * 「どちらが切り上げ側か」を固定する。総額は点数表への結合を避けるため合成した値だが、
   * いずれも現行の点数表で実際に生じる素点(親1翻 1,500 / 親2翻 2,900 / 子3翻 3,900)。
   */
  describe("パオ・ロンの折半端数 (#389)", () => {
    // [総額, 責任者の負担(切り上げ側), 放銃者の負担(残差)]
    const oddSplits = [
      [1500, 800, 700],
      [2900, 1500, 1400],
      [3900, 2000, 1900],
    ] as const;

    it.each(oddSplits)(
      "総額 %d: 責任者が切り上げ側 %d、放銃者が残差 %d を負担",
      (total, paoShare, discarderShare) => {
        expect(paoShare + discarderShare).toBe(total);
        const { deltas } = resolveWinPayment({
          winner: C1,
          winType: "ron",
          score: { ...yakuman, ronTotal: total },
          discarderId: "child2",
          others: [D, C2],
          paoResponsibleId: "dealer",
        });
        expect(deltas.dealer).toBe(-paoShare); // パオ責任者 = 切り上げ側
        expect(deltas.child2).toBe(-discarderShare); // 放銃者 = 残差
        expect(deltas.child1).toBe(total);
        expectZeroSum(deltas);
      },
    );

    it("責任者=放銃者なら端数が出ても全額1人が負担する", () => {
      const { deltas } = resolveWinPayment({
        winner: C1,
        winType: "ron",
        score: { ...yakuman, ronTotal: 1500 },
        discarderId: "dealer",
        others: [D, C2],
        paoResponsibleId: "dealer",
      });
      expect(deltas.dealer).toBe(-1500);
      expect(deltas.child2).toBe(0);
      expectZeroSum(deltas);
    });
  });

  /**
   * パオ・ツモで責任者が負担するのは**ツモ総額**(`score.tsumo.total`)であって
   * ロン総額ではない。役満では両者が一致するため、既存テスト(32,000)では
   * 取り違えを検出できなかった。両者が食い違う素点で固定する。
   */
  it("パオ・ツモ: 責任者が負担するのは ronTotal ではなく tsumo.total", () => {
    const score = computeScore({ han: 1, yakumanMultiplier: 0 }, true);
    expect(score.tsumo.total).not.toBe(score.ronTotal);
    const { deltas } = resolveWinPayment({
      winner: D,
      winType: "tsumo",
      score,
      others: [C1, C2],
      paoResponsibleId: "child1",
    });
    expect(deltas.child1).toBe(-score.tsumo.total);
    expect(deltas.child2).toBe(0);
    expect(deltas.dealer).toBe(score.tsumo.total);
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
