/**
 * 結合テスト④「席/場進行」(issue #90 / spec game-flow 2.5-2.8, Q9〜Q11 確定仕様)。
 *
 * Round 遷移(#81)を1半荘ぶん(東1→…→南4)回し、席回転・抜け番・連荘据え置き・
 * オーラス判定が仕様どおり継続することを固める。さらに deal(#63)→ seat(#81)の
 * 席割り当て結線(順序中立な3手牌 → 東/南/西)も検証する。
 *
 * scoring/精算(#66)には非依存(点数・ウマは呼ばない)。決定的。
 */

import { describe, expect, it } from "vitest";
import { dealStartingHands, STARTING_HAND_SIZE } from "../deal/deal";
import { createSeededRng } from "../random/rng";
import {
  advanceRound,
  benchWarmerOf,
  createInitialRound,
  dealerOf,
  isOorasu,
  roundLabel,
  ROUNDS_PER_WIND,
  RoundProgressionError,
  type RoundState,
  seatingOf,
} from "../round/round";
import { seatedPlayers } from "../round/seat";
import { buildWall } from "../wall/wall";

type P = "起家" | "南" | "西" | "抜";
const initial = {
  dealer: "起家",
  south: "南",
  west: "西",
  benchWarmer: "抜",
} as const;

/** 席割りの4人が円環全員(相異なる4人)であることを表明。 */
function expectFullRing(state: RoundState<P>) {
  const s = seatingOf(state);
  const players = new Set<P>([s.east, s.south, s.west, s.benchWarmer]);
  expect(players.size).toBe(4);
  expect(s.east).toBe(dealerOf(state)); // 東家 = 親
  expect(s.benchWarmer).toBe(benchWarmerOf(state));
}

describe("結合④: 席/場進行(round 遷移・deal→seat 結線)", () => {
  it("1半荘(全局親流れ)で 東1→…→南4 が仕様どおり進行する", () => {
    let state: RoundState<P> = createInitialRound<P>(initial);
    const labels: string[] = [];
    const dealers: P[] = [];

    for (let i = 0; i < ROUNDS_PER_WIND * 2; i++) {
      labels.push(roundLabel(state));
      dealers.push(dealerOf(state));
      expectFullRing(state);
      expect(state.honba).toBe(0); // 全局親流れ → 本場は積まれない

      // オーラス(南4)は最終局。それ以外だけ次局へ。
      if (isOorasu(state)) {
        expect(i).toBe(7);
        break;
      }
      // 抜け番 = 直前局の親(Q9/Q10)。
      const prevDealer = dealerOf(state);
      const next = advanceRound(state, "dealerPasses");
      expect(benchWarmerOf(next)).toBe(prevDealer);
      state = next;
    }

    expect(labels).toEqual([
      "東1",
      "東2",
      "東3",
      "東4",
      "南1",
      "南2",
      "南3",
      "南4",
    ]);
    // 各場で 起家→南→西→抜 が親を1巡(場頭で親位置リセット)。
    expect(dealers).toEqual([
      "起家",
      "南",
      "西",
      "抜",
      "起家",
      "南",
      "西",
      "抜",
    ]);
    expect(isOorasu(state)).toBe(true);
  });

  it("連荘(dealerContinues)は席・局番号据え置きで本場のみ +1", () => {
    const east1 = createInitialRound<P>(initial);
    const cont1 = advanceRound(east1, "dealerContinues");
    expect(cont1.wind).toBe("east");
    expect(cont1.roundNumber).toBe(1);
    expect(cont1.honba).toBe(1);
    expect(seatingOf(cont1)).toEqual(seatingOf(east1)); // 席据え置き
    expect(east1.honba).toBe(0); // 元の状態は不変(immutable 遷移)

    const cont2 = advanceRound(cont1, "dealerContinues");
    expect(cont2.honba).toBe(2);

    // 連荘後の親流れで本場は 0 に戻り局番号が進む。
    const pass = advanceRound(cont2, "dealerPasses");
    expect(pass.honba).toBe(0);
    expect(pass.roundNumber).toBe(2);
  });

  it("オーラス(南4)の親流れは半荘終了で例外", () => {
    // 東1 から南4 まで親流れで進める。
    let state = createInitialRound<P>(initial);
    while (!isOorasu(state)) {
      state = advanceRound(state, "dealerPasses");
    }
    expect(roundLabel(state)).toBe("南4");
    expect(() => advanceRound(state, "dealerPasses")).toThrow(
      RoundProgressionError,
    );

    // ただし南4 の連荘は許容(南4 のまま本場 +1)。
    const renchan = advanceRound(state, "dealerContinues");
    expect(isOorasu(renchan)).toBe(true);
    expect(renchan.honba).toBe(1);
  });

  it("deal→seat 結線: 順序中立な3手牌を 東/南/西 に割り当て、抜け番は不参加", () => {
    const wall = buildWall(createSeededRng(2024));
    const hands = dealStartingHands(wall);

    const state = createInitialRound<P>(initial);
    const seating = seatingOf(state);
    const seats = seatedPlayers(seating); // [east, south, west]

    // 3手牌 ↔ 着席3人 が過不足なく対応。
    expect(seats).toHaveLength(hands.length);
    const assignment = new Map<P, number>();
    seats.forEach((player, i) => {
      expect(hands[i]).toHaveLength(STARTING_HAND_SIZE);
      assignment.set(player, hands[i].length);
    });
    // 抜け番は着席しない = 手牌を持たない。
    expect(assignment.has(seating.benchWarmer)).toBe(false);
    expect(assignment.get(seating.east)).toBe(STARTING_HAND_SIZE);
  });
});
