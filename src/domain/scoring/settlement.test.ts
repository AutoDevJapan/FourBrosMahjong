import { describe, expect, it } from "vitest";
import { computeScore } from "./points";
import {
  OKA,
  type PlayerId,
  type PlayerPoints,
  RETURN_POINTS,
  SoshiiLedger,
  STARTING_POINTS,
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

  it("欠員・重複・未知IDは加算前に拒否し、残高を変えない", () => {
    const invalidInputs: PlayerPoints[][] = [
      [{ playerId: "A", points: 140000 }],
      [
        { playerId: "A", points: 35000 },
        { playerId: "A", points: 35000 },
        { playerId: "C", points: 35000 },
        { playerId: "D", points: 35000 },
      ],
      [
        { playerId: "A", points: 35000 },
        { playerId: "B", points: 35000 },
        { playerId: "C", points: 35000 },
        { playerId: "X", points: 35000 },
      ],
    ];
    for (const input of invalidInputs) {
      const l = new SoshiiLedger(IDS);
      expect(() => l.applyRawScore(input)).toThrow(RangeError);
      expect(l.balances()).toEqual({ A: 0, B: 0, C: 0, D: 0 });
    }
  });

  it("同じ台帳への二重適用を拒否する", () => {
    const l = new SoshiiLedger(IDS);
    const finals = IDS.map((playerId) => ({ playerId, points: 35000 }));
    l.applyRawScore(finals);
    const once = l.balances();
    expect(() => l.applyRawScore(finals)).toThrow(RangeError);
    expect(l.balances()).toEqual(once);
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

  it("4件でも重複IDなら加算前に拒否し、二重適用も拒否する", () => {
    const l = new SoshiiLedger(IDS);
    expect(() =>
      l.applyUma([
        { playerId: "A", points: 35000 },
        { playerId: "A", points: 35000 },
        { playerId: "A", points: 35000 },
        { playerId: "A", points: 35000 },
      ]),
    ).toThrow(RangeError);
    expect(l.balances()).toEqual({ A: 0, B: 0, C: 0, D: 0 });

    const finals = IDS.map((playerId) => ({ playerId, points: 35000 }));
    l.applyUma(finals);
    const once = l.balances();
    expect(() => l.applyUma(finals)).toThrow(RangeError);
    expect(l.balances()).toEqual(once);
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

  it("素点と順位で異なる最終持ち点スナップショットを拒否する", () => {
    const l = new SoshiiLedger(IDS);
    const finals: PlayerPoints[] = IDS.map((playerId) => ({
      playerId,
      points: 35000,
    }));
    l.applyRawScore(finals);
    const beforeUma = l.balances();
    expect(() =>
      l.applyUma(
        finals.map((p) =>
          p.playerId === "A" ? { ...p, points: p.points + 1000 } : p,
        ),
      ),
    ).toThrow(RangeError);
    expect(l.balances()).toEqual(beforeUma);
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

/**
 * `ranking()`(ソシー残高降順)と `applyUma`(最終持ち点降順)の**基準一致**を固定する。
 *
 * 2つの基準が併存するのは**仕様どおり**で、統合してはならない:
 * - 最終順位・勝敗は「ソシー個人累計」で決定する(`documents/spec/setup-and-tiles.md` §1.1、
 *   `documents/spec/README.md`)。結果画面に出る `rank` はこちら(engine `endGame` は
 *   `ledger.ranking()` から `rank` を作る)。
 * - ②順位ウマは「4兄弟全員をその時点の**持ち点**で順位付け」して割り当てる
 *   (`documents/spec/scoring-and-settlement.md` §3.3 ②/ Q13)。
 *
 * 両者が一致するのは偶然ではなく、**定数間のマージンが正**であることの帰結である。
 * ソシー残高は `(持ち点 − 返し) + ウマ/オカ + 祝儀` なので、持ち点順で隣り合う2人の
 * 残高差は最小でも「ウマ/オカの最小隣接差 − 祝儀の最大相対スイング」になる。
 * 現行定数では 5,000 − 4,000 = 1,000 > 0 のため順位は必ず一致する。
 *
 * このマージンは `UMA` / {@link YAKUMAN_BONUS} を調整した瞬間に無言で破綻し、
 * 「表示順位は2位なのにウマは1位分」という不整合を生む。以下のテストは定数から
 * マージンを算出して符号を検証するため、定数を触れば必ず落ちる。
 *
 * 前提: 一致が言えるのは **`applyRawScore` と `applyUma` を両方適用した後**(半荘終了時)
 * の残高についてであり、祝儀だけ反映された局中の `ranking()` はこの限りではない。
 * また `applyBonus` に渡す `loserIds` が「和了者以外の3兄弟・重複なし」であること
 * (engine `settleWin` が保証)も前提に含む。
 */
describe("ranking と applyUma の基準一致(暗黙不変条件の固定)", () => {
  // 他の applyBonus 系 describe と同じく、実際の点数計算から役満区分を得る。
  const trueYakuman = computeScore({ han: 0, yakumanMultiplier: 1 }, false);

  /** 順位 r のプレイヤーが受け取るウマ+オカ。 */
  const rankBonus = (rank: number): number =>
    UMA[rank] + (rank === 0 ? OKA : 0);

  /**
   * 役満祝儀 1 件による2人間の最大相対スイング。
   * 和了者 `+B × (人数−1)` と支払者 `−B` の差 = `B × 人数`。係数は人数由来であり
   * 固定値ではないため、人数(`IDS.length`)から導出する。
   */
  const MAX_BONUS_SWING = YAKUMAN_BONUS * IDS.length;

  it("ウマ/オカの隣接差が単調減少で、最小隣接差が祝儀スイングを上回る", () => {
    const gaps = [0, 1, 2].map((r) => rankBonus(r) - rankBonus(r + 1));
    // 上位ほど多く貰う(そもそも順位付けの体を成す)。
    expect(gaps.every((g) => g > 0)).toBe(true);
    // オカが1位へ偏る構造上、隣接差は上位ほど大きい(単調減少)。
    expect(gaps[0]).toBeGreaterThan(gaps[1]);
    expect(gaps[1]).toBeGreaterThan(gaps[2]);
    const minGap = Math.min(...gaps);
    const margin = minGap - MAX_BONUS_SWING;
    expect(margin).toBeGreaterThan(0);
  });

  /** 決定的な線形合同法。テスト内で完結させ、外部 RNG に依存しない。 */
  function lcg(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 0x100000000;
    };
  }

  /**
   * 合計 140,000(35,000 × 4)を 100 点単位で4人へ分配する。
   *
   * 生成器の自己検査は SUT の検証ではないため `expect` ではなく `throw` にする
   * (テスト失敗時に「settlement が壊れた」と誤読させない)。
   */
  function randomFinalPoints(
    rand: () => number,
    ids: readonly PlayerId[],
  ): PlayerPoints[] {
    const TOTAL_UNITS = (STARTING_POINTS * IDS.length) / 100;
    const cuts = [0, 1, 2]
      .map(() => Math.floor(rand() * (TOTAL_UNITS + 1)))
      .sort((a, b) => a - b);
    const units = [
      cuts[0],
      cuts[1] - cuts[0],
      cuts[2] - cuts[1],
      TOTAL_UNITS - cuts[2],
    ];
    const points = units.map((u) => u * 100);
    const total = points.reduce((a, b) => a + b, 0);
    if (
      points.length !== IDS.length ||
      total !== STARTING_POINTS * IDS.length
    ) {
      throw new Error(
        `generator bug: ${points.length} players summing to ${total}`,
      );
    }
    return ids.map((playerId, i) => ({ playerId, points: points[i] }));
  }

  /** 祝儀の適用パターン: 無し / 各プレイヤーが役満を和了(他3人が支払い)。 */
  const bonusCases: readonly (PlayerId | null)[] = [null, ...IDS];

  /**
   * 期待する順位基準「持ち点降順・同点は `finalPoints` の配列順」を、実装とは独立に
   * テスト側で組み立てる。`applyUma` の実装をなぞる形になるが、これは**基準そのもの**
   * (スペック3 3.3 ②)を固定するためのオラクルで、実装が基準を変えたら落ちる。
   */
  function expectedUmaOrder(finalPoints: readonly PlayerPoints[]): PlayerId[] {
    return finalPoints
      .map((p, index) => ({ p, index }))
      .sort((a, b) => b.p.points - a.p.points || a.index - b.index)
      .map((x) => x.p.playerId);
  }

  function checkAgreement(finalPoints: readonly PlayerPoints[]): void {
    for (const winner of bonusCases) {
      // 失敗時にどの持ち点・どの祝儀パターンで落ちたか特定できるようにする。
      const label = `points=${finalPoints
        .map((p) => `${p.playerId}:${p.points}`)
        .join(",")} bonusWinner=${winner ?? "なし"}`;
      const l = new SoshiiLedger(IDS);
      if (winner !== null) {
        l.applyBonus({
          winnerId: winner,
          loserIds: IDS.filter((id) => id !== winner),
          score: trueYakuman,
        });
      }
      const breakdown = l.applyUma(finalPoints);
      l.applyRawScore(finalPoints);
      const byUma = [...breakdown]
        .sort((a, b) => a.rank - b.rank)
        .map((b) => b.playerId);
      expect(byUma, label).toEqual(expectedUmaOrder(finalPoints));
      // 本丸: 表示順位(ソシー残高降順)がウマの順位付けと完全一致する。
      expect(l.ranking(), label).toEqual(byUma);
    }
  }

  it("境界ケース(全員同点・100点差・最大偏り)で順位が一致する", () => {
    const edgeCases: PlayerPoints[][] = [
      // 全員同点 — ウマは配列順で決まる。祝儀があっても表示順位はそれに従う。
      IDS.map((playerId) => ({ playerId, points: STARTING_POINTS })),
      // 最小刻み(100点)差が3組連続する最悪ケース。
      [
        { playerId: "A", points: 35100 },
        { playerId: "B", points: 35000 },
        { playerId: "C", points: 34900 },
        { playerId: "D", points: 35000 },
      ],
      // 1人が総取りに近い最大偏り。
      [
        { playerId: "A", points: 140000 },
        { playerId: "B", points: 0 },
        { playerId: "C", points: 0 },
        { playerId: "D", points: 0 },
      ],
      // 2人同点が2組。
      [
        { playerId: "A", points: 40000 },
        { playerId: "B", points: 30000 },
        { playerId: "C", points: 40000 },
        { playerId: "D", points: 30000 },
      ],
    ];
    for (const finalPoints of edgeCases) {
      checkAgreement(finalPoints);
    }
  });

  it("ランダムな最終持ち点 2,000 通り × 祝儀5パターンで順位が一致する", () => {
    const rand = lcg(20260721);
    for (let i = 0; i < 2000; i++) {
      // 配列順(席順)を入れ替えても、同点タイブレークの基準差が表面化しないことも併せて見る。
      const ids = i % 2 === 0 ? IDS : [...IDS].reverse();
      checkAgreement(randomFinalPoints(rand, ids));
    }
  });
});
