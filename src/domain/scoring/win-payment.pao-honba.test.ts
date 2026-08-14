import { describe, expect, it } from "vitest";
import { computeScore } from "./points";
import {
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

const yakuman = computeScore({ han: 0, yakumanMultiplier: 1 }, false); // 子役満(total 32000)

/**
 * パオ × 本場の複合(確定挙動)を固定する(issue #120)。
 *
 * `win-payment.test.ts` のパオ3ケースはすべて `honba` 未指定(=0)で、
 * spec 3.1「本場・パオ・供託の点数移動と加算順序」(`scoring-and-settlement.md:199-210`)
 * が確定挙動として明記する 2 分岐:
 *   - パオ・ロン: 素点は折半だが**本場は放銃者が全額**(責任者側に本場が乗らない)
 *   - パオ・ツモ: 責任者が `tsumo.total + 300×本場`(本来ツモ本場は各 100×本場 だが
 *     責任者一括の**簡略**)
 * が未検証だった。ここで固定する。
 */
describe("resolveWinPayment — パオ × 本場の複合(issue #120)", () => {
  it("パオ・ロン(責任者≠放銃者)+ 本場: 素点は折半・本場は放銃者のみ 300×本場(責任者側に本場が乗らない)", () => {
    const honba = 2;
    const input: WinPaymentInput = {
      winner: C1,
      winType: "ron",
      score: yakuman,
      discarderId: "child2", // 放銃者
      others: [D, C2],
      paoResponsibleId: "dealer", // 責任者(≠放銃者)
      honba,
    };
    const { deltas } = resolveWinPayment(input);
    const honbaBonus = 300 * honba; // 600
    // 素点32000は折半(ceil100(16000)=16000 / 16000)。
    // 本場は放銃者(child2)のみが負担 → 責任者(dealer)側には乗らない。
    expect(deltas.dealer).toBe(-16000); // パオ責任者: 本場が乗らない
    expect(deltas.child2).toBe(-(16000 + honbaBonus)); // 放銃者: 折半分 + 本場全額
    expect(deltas.child1).toBe(32000 + honbaBonus); // 和了者受取
    expectZeroSum(deltas);
  });

  it("パオ・ロン(責任者=放銃者)+ 本場: その1人が素点全額 + 本場300×本場", () => {
    const honba = 3;
    const { deltas } = resolveWinPayment({
      winner: C1,
      winType: "ron",
      score: yakuman,
      discarderId: "dealer",
      others: [D, C2],
      paoResponsibleId: "dealer",
      honba,
    });
    const honbaBonus = 300 * honba; // 900
    expect(deltas.dealer).toBe(-(32000 + honbaBonus));
    expect(deltas.child2).toBe(0);
    expect(deltas.child1).toBe(32000 + honbaBonus);
    expectZeroSum(deltas);
  });

  it("パオ・ツモ + 本場: 責任者が tsumo.total + 300×本場 を全額負担・他家0(簡略挙動)", () => {
    const honba = 2;
    const { deltas } = resolveWinPayment({
      winner: C1,
      winType: "tsumo",
      score: yakuman,
      others: [D, C2],
      paoResponsibleId: "dealer",
      honba,
    });
    // 本来ツモ本場は各支払者 100×本場 だが、責任者が 300×本場(ロン相当の一括)を負担する簡略。
    const expected = yakuman.tsumo.total + 300 * honba; // 32000 + 600 = 32600
    expect(deltas.dealer).toBe(-expected);
    expect(deltas.child1).toBe(expected);
    expect(deltas.child2).toBe(0); // 責任者以外は本場も負担しない
    expectZeroSum(deltas);
  });

  it("パオ・ツモ本場は各100×本場×人数ではなく責任者一括300×本場(簡略の固定)", () => {
    // 通常ツモなら本場は各支払者 100×本場 → 支払者2人で計 200×本場。
    // パオ・ツモは責任者一括 300×本場 となることを、本場分の増分で明示。
    const honba = 4;
    const base = resolveWinPayment({
      winner: C1,
      winType: "tsumo",
      score: yakuman,
      others: [D, C2],
      paoResponsibleId: "dealer",
      honba: 0,
    });
    const withHonba = resolveWinPayment({
      winner: C1,
      winType: "tsumo",
      score: yakuman,
      others: [D, C2],
      paoResponsibleId: "dealer",
      honba,
    });
    // 責任者の本場増分 = 300×本場(= 1200)。通常ツモの 200×本場(=800)ではない。
    const dealerHonbaDelta = base.deltas.dealer - withHonba.deltas.dealer;
    expect(dealerHonbaDelta).toBe(300 * honba);
    expectZeroSum(withHonba.deltas);
  });

  it("役満単位APIでも単独責任者の既存ツモ本場簡略を維持する", () => {
    const honba = 2;
    const { deltas } = resolveWinPayment({
      winner: C1,
      winType: "tsumo",
      score: yakuman,
      others: [D, C2],
      yakumanComponents: [{ multiplier: 1, paoResponsibleId: "dealer" }],
      honba,
    });
    const expected = yakuman.tsumo.total + 300 * honba;
    expect(deltas.dealer).toBe(-expected);
    expect(deltas.child2).toBe(0);
    expect(deltas.child1).toBe(expected);
    expectZeroSum(deltas);
  });
});
