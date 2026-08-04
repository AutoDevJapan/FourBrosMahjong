import { describe, expect, it } from "vitest";
import { parseTile, parseTiles } from "@/domain/hand/notation";
import {
  createGame,
  declareRiichi,
  declareTsumo,
  seatOfPlayer,
} from "./engine";

/**
 * 和了形開示スナップショット(#259): `RoundSummary.winDetails` に和了者名・和了形
 * (門前手牌+和了牌)が固定されることを、ツモ/ロン双方で検証する。
 */
describe("engine: 和了形開示スナップショット(#259)", () => {
  it("ツモ和了: winnerName / winnerSeat / hand / winningTile が固定される", () => {
    const base = createGame({ seed: 259 });
    const hand = base.hand;
    if (hand === null) throw new Error("initial hand should exist");
    expect(seatOfPlayer(hand.seating, "p0")).toBe("east");

    // 南(2z)単騎待ちのツモ。捨て牌を置いて天和(第一ツモ)判定を外す。
    const concealed = parseTiles("111m 222p 333s 55s 2z 2z");
    const winningTile = parseTile("2z");
    hand.hands.east = concealed;
    hand.discards.east = [parseTile("9m")];
    hand.discardHistory.east = [parseTile("9m")];
    hand.drawn = { tile: winningTile, source: "live" };
    hand.turn = "east";

    const armed = {
      ...base,
      pending: {
        kind: "humanDiscard" as const,
        canTsumo: true,
        canRiichi: false,
        riichiTiles: [],
        ankanTiles: [],
        kakanTiles: [],
        forbiddenDiscards: [],
        locked: false,
      },
    };

    const after = declareTsumo(armed);
    expect(after.phase).toBe("roundEnd");
    const detail = after.lastRound?.winDetails;
    expect(detail).toBeDefined();
    if (detail === undefined) return;

    const humanName = after.players.find((p) => p.id === "p0")?.name;
    expect(detail.winnerName).toBe(humanName);
    expect(detail.winnerSeat).toBe("east");
    expect(detail.winningTile).toEqual(winningTile);
    expect(detail.hand).toEqual(parseTiles("111m 222p 333s 55s 2z 2z"));
    // 次局遷移で hand.hands が破棄されても開示が残るよう、スナップショットはコピーで固定する。
    expect(detail.hand).not.toBe(concealed);
  });

  it("ロン和了: 他家(南家)の和了でも和了形と和了牌が固定される", () => {
    const base = createGame({ seed: 209 });
    const hand = base.hand;
    if (hand === null) throw new Error("initial hand should exist");
    expect(seatOfPlayer(hand.seating, "p0")).toBe("east");

    // 南家は南(2z)単騎待ち(南刻=自風役)。東(自家)の打牌 2z でロンさせる。
    const southConcealed = parseTiles("2z 2z 111m 222p 333s 55s");
    hand.hands.south = southConcealed;
    hand.discards.south = [];
    hand.melds.south = [];
    hand.riichi.south = false;
    hand.riichiMiss.south = false;
    hand.tempMiss.south = false;
    hand.hands.west = parseTiles("123m 456m 789m 123p 4s");
    hand.discards.west = [];

    const declarationTile = parseTile("2z");
    hand.hands.east = parseTiles("123m 456m 789m 234p 5s");
    hand.drawn = { tile: declarationTile, source: "live" };
    hand.turn = "east";

    const armed = {
      ...base,
      pending: {
        kind: "humanDiscard" as const,
        canTsumo: false,
        canRiichi: true,
        riichiTiles: [declarationTile],
        ankanTiles: [],
        kakanTiles: [],
        forbiddenDiscards: [],
        locked: false,
      },
    };

    const after = declareRiichi(armed, declarationTile);
    expect(after.phase).toBe("roundEnd");
    expect(after.lastRound?.winnerId).toBe(hand.seating.south);
    const detail = after.lastRound?.winDetails;
    expect(detail).toBeDefined();
    if (detail === undefined) return;

    const winnerName = after.players.find(
      (p) => p.id === hand.seating.south,
    )?.name;
    expect(detail.winnerName).toBe(winnerName);
    expect(detail.winnerSeat).toBe("south");
    expect(detail.winType).toBe("ron");
    expect(detail.winningTile).toEqual(declarationTile);
    expect(detail.hand).toEqual(parseTiles("2z 2z 111m 222p 333s 55s"));
    expect(detail.hand).not.toBe(southConcealed);
  });
});
