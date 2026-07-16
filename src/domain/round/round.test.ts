import { describe, expect, it } from "vitest";
import {
  advanceRound,
  benchWarmerOf,
  createInitialRound,
  dealerOf,
  type InitialSeating,
  isOorasu,
  type RoundNumber,
  type RoundState,
  RoundProgressionError,
  roundLabel,
  ROUNDS_PER_WIND,
  type RoundWind,
  seatingOf,
} from "./round";

const INITIAL: InitialSeating<string> = {
  dealer: "A",
  south: "B",
  west: "C",
  benchWarmer: "D",
};

function initial(): RoundState<string> {
  return createInitialRound(INITIAL);
}

describe("createInitialRound", () => {
  it("東1・0本場・起家が親の初局を生成する", () => {
    const s = initial();
    expect(s.wind).toBe("east");
    expect(s.roundNumber).toBe(1);
    expect(s.honba).toBe(0);
    expect(dealerOf(s)).toBe("A");
    expect(seatingOf(s)).toEqual({
      east: "A",
      south: "B",
      west: "C",
      benchWarmer: "D",
    });
  });

  it("4人に重複があれば RoundProgressionError", () => {
    expect(() =>
      createInitialRound({
        dealer: "A",
        south: "A",
        west: "C",
        benchWarmer: "D",
      }),
    ).toThrow(RoundProgressionError);
  });
});

describe("advanceRound - 連荘(dealerContinues)", () => {
  it("席・場・局番号据え置きで本場のみ +1", () => {
    const s = initial();
    const next = advanceRound(s, "dealerContinues");
    expect(next.honba).toBe(1);
    expect(next.wind).toBe("east");
    expect(next.roundNumber).toBe(1);
    expect(seatingOf(next)).toEqual(seatingOf(s));
    expect(dealerOf(next)).toBe("A");
    // 元状態は不変
    expect(s.honba).toBe(0);
  });

  it("連荘を重ねると本場が積み上がる", () => {
    let s = initial();
    s = advanceRound(s, "dealerContinues");
    s = advanceRound(s, "dealerContinues");
    expect(s.honba).toBe(2);
    expect(s.roundNumber).toBe(1);
  });
});

describe("advanceRound - 親流れ(dealerPasses)", () => {
  it("局番号 +1・本場0・1席回転(親が次の人へ、旧親は抜け番へ)", () => {
    const s = initial();
    const next = advanceRound(s, "dealerPasses");
    expect(next.roundNumber).toBe(2);
    expect(next.wind).toBe("east");
    expect(next.honba).toBe(0);
    expect(dealerOf(next)).toBe("B"); // 旧南 → 新親
    expect(benchWarmerOf(next)).toBe("A"); // 旧親 → 抜け番
  });

  it("連荘で溜まった本場は親流れで 0 に戻る", () => {
    let s = initial();
    s = advanceRound(s, "dealerContinues"); // 本場1
    s = advanceRound(s, "dealerPasses");
    expect(s.honba).toBe(0);
    expect(s.roundNumber).toBe(2);
  });

  it("東4 の親流れで南1へ場が進む(局番号は1に戻る)", () => {
    let s = initial();
    s = advanceRound(s, "dealerPasses"); // 東2
    s = advanceRound(s, "dealerPasses"); // 東3
    s = advanceRound(s, "dealerPasses"); // 東4
    expect(s.wind).toBe("east");
    expect(s.roundNumber).toBe(4);
    const south1 = advanceRound(s, "dealerPasses");
    expect(south1.wind).toBe("south");
    expect(south1.roundNumber).toBe(1);
    expect(dealerOf(south1)).toBe("A"); // 各場の頭は起家が親
  });
});

describe("isOorasu / オーラス境界", () => {
  it("南4 がオーラス、それ以外は false", () => {
    expect(isOorasu(initial())).toBe(false);
    const oorasu = {
      ...initial(),
      wind: "south",
      roundNumber: 4,
    } as RoundState<string>;
    expect(isOorasu(oorasu)).toBe(true);
    const south1 = {
      ...initial(),
      wind: "south",
      roundNumber: 1,
    } as RoundState<string>;
    expect(isOorasu(south1)).toBe(false);
  });

  it("オーラスの親流れは半荘終了 → RoundProgressionError", () => {
    const oorasu = {
      ...initial(),
      wind: "south",
      roundNumber: 4,
    } as RoundState<string>;
    expect(() => advanceRound(oorasu, "dealerPasses")).toThrow(
      RoundProgressionError,
    );
  });

  it("オーラスでも連荘は許容(本場 +1、南4のまま)", () => {
    const oorasu = {
      ...initial(),
      wind: "south",
      roundNumber: 4,
      honba: 1,
    } as RoundState<string>;
    const next = advanceRound(oorasu, "dealerContinues");
    expect(isOorasu(next)).toBe(true);
    expect(next.honba).toBe(2);
  });
});

describe("東南戦の1周走査(全員親を1巡/場ごと)", () => {
  it("各場は ROUNDS_PER_WIND 局で4人が順に親、次場の頭で起家に戻る", () => {
    expect(ROUNDS_PER_WIND).toBe(4);
    let s = initial();
    const eastDealers: string[] = [dealerOf(s)];
    for (let i = 0; i < ROUNDS_PER_WIND - 1; i++) {
      s = advanceRound(s, "dealerPasses");
      eastDealers.push(dealerOf(s));
    }
    expect(eastDealers).toEqual(["A", "B", "C", "D"]);
    expect(new Set(eastDealers).size).toBe(ROUNDS_PER_WIND);

    // 東4 → 南1(次場の頭)
    s = advanceRound(s, "dealerPasses");
    const wind: RoundWind = s.wind;
    expect(wind).toBe("south");
    const southDealers: string[] = [dealerOf(s)];
    for (let i = 0; i < ROUNDS_PER_WIND - 1; i++) {
      s = advanceRound(s, "dealerPasses");
      southDealers.push(dealerOf(s));
    }
    expect(southDealers).toEqual(["A", "B", "C", "D"]);
    const lastRound: RoundNumber = s.roundNumber;
    expect(lastRound).toBe(ROUNDS_PER_WIND);
    expect(isOorasu(s)).toBe(true); // 南4
  });
});

describe("roundLabel", () => {
  it("場・局・本場を表示する", () => {
    expect(roundLabel(initial())).toBe("東1");
    expect(roundLabel(advanceRound(initial(), "dealerContinues"))).toBe(
      "東1 1本場",
    );
    const oorasu = {
      ...initial(),
      wind: "south",
      roundNumber: 4,
      honba: 2,
    } as RoundState<string>;
    expect(roundLabel(oorasu)).toBe("南4 2本場");
  });
});
