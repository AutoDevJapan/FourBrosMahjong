import { describe, expect, it } from "vitest";
import { computeScore } from "./points";
import {
  OKA,
  type PlayerPoints,
  RETURN_POINTS,
  STARTING_POINTS,
  SoshiiLedger,
  UMA,
  YAKUMAN_BONUS,
} from "./settlement";

const IDS = ["A", "B", "C", "D"] as const;

function sum(record: Record<string, number>): number {
  return Object.values(record).reduce((a, b) => a + b, 0);
}

describe("精算定数(スペック3 3.3 / Q13)", () => {
  it("オカ = (返し − 配給原点) × 4 = 20000", () => {
    expect(OKA).toBe((RETURN_POINTS - STARTING_POINTS) * 4);
    expect(STARTING_POINTS).toBe(35000);
    expect(OKA).toBe(20000);
  });
  it("ウマは総和ゼロ", () => {
    expect(UMA.reduce((a, b) => a + b, 0)).toBe(0);
  });
});

describe("SoshiiLedger — 生成", () => {
  it("重複IDは RangeError", () => {
    expect(() => new SoshiiLedger(["A", "A", "B", "C"])).toThrow(RangeError);
  });
  it("初期残高は全員0", () => {
    const l = new SoshiiLedger(IDS);
    expect(l.balances()).toEqual({ A: 0, B: 0, C: 0, D: 0 });
  });
});

describe("applyRawScore — 素点(返し40000基準)", () => {
  it("各自 points − 返し40000 を加算(総和 = −オカ)", () => {
    const l = new SoshiiLedger(IDS);
    const finals: PlayerPoints[] = [
      { playerId: "A", points: 50000 },
      { playerId: "B", points: 40000 },
      { playerId: "C", points: 30000 },
      { playerId: "D", points: 20000 },
    ];
    l.applyRawScore(finals);
    expect(l.balanceOf("A")).toBe(50000 - RETURN_POINTS);
    expect(l.balanceOf("D")).toBe(20000 - RETURN_POINTS);
    // 140000 − 160000 = −20000 = −OKA
    expect(sum(l.balances())).toBe(-OKA);
  });
});

describe("applyUma — 4人ウマ+オカ(Q13)", () => {
  it("順位ウマ+10/+5/-5/-10 とオカ+20000 を付与(総和 = +オカ)", () => {
    const l = new SoshiiLedger(IDS);
    const finals: PlayerPoints[] = [
      { playerId: "A", points: 50000 },
      { playerId: "B", points: 40000 },
      { playerId: "C", points: 30000 },
      { playerId: "D", points: 20000 },
    ];
    const breakdown = l.applyUma(finals);
    expect(breakdown.map((b) => b.playerId)).toEqual(["A", "B", "C", "D"]);
    expect(l.balanceOf("A")).toBe(UMA[0] + OKA);
    expect(l.balanceOf("B")).toBe(UMA[1]);
    expect(l.balanceOf("C")).toBe(UMA[2]);
    expect(l.balanceOf("D")).toBe(UMA[3]);
    // ウマ総和0 + オカ20000
    expect(sum(l.balances())).toBe(OKA);
  });

  it("同点は配列順(起家/席順)でタイブレーク", () => {
    const l = new SoshiiLedger(IDS);
    const finals: PlayerPoints[] = [
      { playerId: "A", points: 30000 },
      { playerId: "B", points: 30000 },
      { playerId: "C", points: 40000 },
      { playerId: "D", points: 40000 },
    ];
    const ranks = l.applyUma(finals);
    // 40000 が C,D、その中で配列順 C が上。次いで 30000 の A,B(A が上)。
    expect(ranks.map((r) => r.playerId)).toEqual(["C", "D", "A", "B"]);
  });

  it("プレイヤー数が4でなければ RangeError", () => {
    const l = new SoshiiLedger(IDS);
    expect(() =>
      l.applyUma([
        { playerId: "A", points: 1 },
        { playerId: "B", points: 2 },
        { playerId: "C", points: 3 },
      ]),
    ).toThrow(RangeError);
  });
});

describe("素点+ウマ+オカ の総和ゼロ(ゼロサム不変条件)", () => {
  it("applyRawScore + applyUma の合計は総和ゼロ", () => {
    const l = new SoshiiLedger(IDS);
    const finals: PlayerPoints[] = [
      { playerId: "A", points: 61000 },
      { playerId: "B", points: 38000 },
      { playerId: "C", points: 25000 },
      { playerId: "D", points: 16000 },
    ];
    l.applyRawScore(finals);
    l.applyUma(finals);
    expect(sum(l.balances())).toBe(0);
    // 1位A: (61000-40000) + 10000 + 20000
    expect(l.balanceOf("A")).toBe(21000 + UMA[0] + OKA);
  });
});

describe("applyBonus — 役満祝儀(先着1名・数え役満対象外)", () => {
  const trueYakuman = computeScore({ han: 0, yakumanMultiplier: 1 }, false);
  const countedYakuman = computeScore({ han: 13, yakumanMultiplier: 0 }, false);
  const mangan = computeScore({ han: 5, yakumanMultiplier: 0 }, false);

  it("構成役満: 各loserが1000支払い、和了者が受取(総和ゼロ)", () => {
    const l = new SoshiiLedger(IDS);
    const awarded = l.applyBonus({
      winnerId: "A",
      loserIds: ["B", "C"],
      score: trueYakuman,
    });
    expect(awarded).toBe(true);
    expect(l.balanceOf("A")).toBe(2 * YAKUMAN_BONUS);
    expect(l.balanceOf("B")).toBe(-YAKUMAN_BONUS);
    expect(l.balanceOf("C")).toBe(-YAKUMAN_BONUS);
    expect(sum(l.balances())).toBe(0);
  });

  it("先着1名: 2件目の役満祝儀は付かない", () => {
    const l = new SoshiiLedger(IDS);
    expect(
      l.applyBonus({ winnerId: "A", loserIds: ["B", "C"], score: trueYakuman }),
    ).toBe(true);
    expect(
      l.applyBonus({ winnerId: "B", loserIds: ["A", "C"], score: trueYakuman }),
    ).toBe(false);
    expect(l.balanceOf("A")).toBe(2000);
  });

  it("数え役満は祝儀対象外(先着枠も消費しない)", () => {
    const l = new SoshiiLedger(IDS);
    expect(
      l.applyBonus({
        winnerId: "A",
        loserIds: ["B", "C"],
        score: countedYakuman,
      }),
    ).toBe(false);
    expect(l.bonusAwarded).toBe(false);
    // その後の構成役満は付く
    expect(
      l.applyBonus({ winnerId: "A", loserIds: ["B", "C"], score: trueYakuman }),
    ).toBe(true);
  });

  it("非役満は祝儀対象外", () => {
    const l = new SoshiiLedger(IDS);
    expect(
      l.applyBonus({ winnerId: "A", loserIds: ["B", "C"], score: mangan }),
    ).toBe(false);
  });
});

describe("applyBonus — Q14: 抜け番含む他3兄弟から各1,000(#129)", () => {
  const trueYakuman = computeScore({ han: 0, yakumanMultiplier: 1 }, false);

  // IDS = [A, B, C, D]。A=和了者、B・C=同卓の敗者、D=その局の抜け番。
  // 支払者は「和了者以外の3兄弟」= B・C・D(抜け番 D を含む)。
  it("和了者 +3,000 / 抜け番含む他3兄弟 各 −1,000(zero-sum)", () => {
    const l = new SoshiiLedger(IDS);
    const awarded = l.applyBonus({
      winnerId: "A",
      loserIds: ["B", "C", "D"],
      score: trueYakuman,
    });
    expect(awarded).toBe(true);
    expect(l.balanceOf("A")).toBe(3 * YAKUMAN_BONUS);
    expect(l.balanceOf("B")).toBe(-YAKUMAN_BONUS);
    expect(l.balanceOf("C")).toBe(-YAKUMAN_BONUS);
    // 抜け番 D も 1,000 を支払う。
    expect(l.balanceOf("D")).toBe(-YAKUMAN_BONUS);
    expect(sum(l.balances())).toBe(0);
  });

  it("先着1名: 2件目の役満(別の和了者)は抜け番含めても付かない", () => {
    const l = new SoshiiLedger(IDS);
    expect(
      l.applyBonus({
        winnerId: "A",
        loserIds: ["B", "C", "D"],
        score: trueYakuman,
      }),
    ).toBe(true);
    expect(
      l.applyBonus({
        winnerId: "B",
        loserIds: ["A", "C", "D"],
        score: trueYakuman,
      }),
    ).toBe(false);
    expect(l.balanceOf("A")).toBe(3 * YAKUMAN_BONUS);
    expect(sum(l.balances())).toBe(0);
  });

  it("パオ祝儀別枠: 支払者は責任者へ寄らず、抜け番含む3兄弟のまま", () => {
    // パオ(点数の責任払い)は win-payment 側の別枠。祝儀は誰が責任者でも
    // 「抜け番含む他3兄弟から各1,000」を維持する(applyBonus は支払者を寄せない)。
    const l = new SoshiiLedger(IDS);
    l.applyBonus({
      winnerId: "A",
      loserIds: ["B", "C", "D"],
      score: trueYakuman,
    });
    // 責任者(例: B)が全額負担する等の偏りは無く、3兄弟が均等に −1,000。
    expect(l.balanceOf("B")).toBe(-YAKUMAN_BONUS);
    expect(l.balanceOf("C")).toBe(-YAKUMAN_BONUS);
    expect(l.balanceOf("D")).toBe(-YAKUMAN_BONUS);
    expect(l.balanceOf("A")).toBe(3 * YAKUMAN_BONUS);
  });
});

describe("ranking — ソシー残高降順(同点は登録順)", () => {
  it("残高で順位付けする", () => {
    const l = new SoshiiLedger(IDS);
    l.applyUma([
      { playerId: "A", points: 20000 },
      { playerId: "B", points: 50000 },
      { playerId: "C", points: 40000 },
      { playerId: "D", points: 30000 },
    ]);
    expect(l.ranking()).toEqual(["B", "C", "D", "A"]);
  });
});
