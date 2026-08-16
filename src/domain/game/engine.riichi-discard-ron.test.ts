import { describe, expect, it } from "vitest";
import { parseTile, parseTiles } from "@/domain/hand/notation";
import { createGame, declareRiichi, seatOfPlayer } from "./engine";

describe("engine: リーチ宣言牌ロン(#209)", () => {
  it("宣言を不成立にして新しいリーチ棒を供託・支払いに含めない", () => {
    const base = createGame({ seed: 209 });
    const hand = base.hand;
    if (hand === null) throw new Error("initial hand should exist");
    const declarer = seatOfPlayer(hand.seating, "p0");
    expect(declarer).toBe("east");
    if (declarer !== "east") return;

    // 南家は南の単騎待ち。南刻が自風役になるため、宣言牌の南で確実にロンできる。
    hand.hands.south = parseTiles("2z 2z 111m 222p 333s 55s");
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

    const beforePoints = { ...base.points };
    const beforeSticks = 2;
    const armed = {
      ...base,
      riichiSticks: beforeSticks,
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
    expect(after.lastRound?.kind).toBe("win");
    expect(after.lastRound?.winnerId).toBe(hand.seating.south);
    expect(after.lastRound?.riichiWin).toBe(false);
    expect(after.lastRound?.winDetails?.riichiSticks).toBe(beforeSticks);
    expect(after.lastRound?.winDetails?.stickPayout).toBe(beforeSticks * 1000);
    expect(after.riichiSticks).toBe(0);
    expect(after.hand?.riichi.east).toBe(false);
    expect(after.hand?.doubleRiichi.east).toBe(false);

    const winner = hand.seating.south;
    const ronGain =
      after.points[winner] - beforePoints[winner] - beforeSticks * 1000;
    expect(beforePoints.p0 - after.points.p0).toBe(ronGain);
  });
});
