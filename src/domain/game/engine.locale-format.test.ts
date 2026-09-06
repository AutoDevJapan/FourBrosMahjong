import { afterEach, describe, expect, it, vi } from "vitest";
import { parseTile, parseTiles } from "@/domain/hand/notation";
import { createGame, declareTsumo, type EngineState } from "./engine";

/** `declareTsumo` が和了サマリを生成する、再現可能な単騎待ち局面。 */
function armTsumoWin(): EngineState {
  const base = createGame({ seed: 1138 });
  const hand = base.hand;
  if (hand === null) throw new Error("initial hand should exist");

  // 既に1枚捨てて天和判定を外し、東家の南単騎ツモを固定する。
  hand.hands.east = parseTiles("111m 222p 333s 55s 2z 2z");
  hand.discards.east = [parseTile("9m")];
  hand.discardHistory.east = [parseTile("9m")];
  hand.drawn = { tile: parseTile("2z"), source: "live" };
  hand.turn = "east";

  return {
    ...base,
    pending: {
      kind: "humanDiscard",
      canTsumo: true,
      canRiichi: false,
      riichiTiles: [],
      ankanTiles: [],
      kakanTiles: [],
      forbiddenDiscards: [],
      locked: false,
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("engine: 和了サマリのローカライズ失敗耐性(#1138)", () => {
  it("keeps the localized winner receipt in the normal capability path", () => {
    const after = declareTsumo(armTsumoWin());

    expect(after.phase).toBe("roundEnd");
    expect(after.lastRound?.label).toMatch(/^粗悪品のツモ \d{1,3}(,\d{3})*点$/);
  });

  it("falls back without changing the winning settlement when formatting throws", () => {
    const expected = declareTsumo(armTsumoWin());
    vi.spyOn(Number.prototype, "toLocaleString").mockImplementation(() => {
      throw new Error("localized number formatting is unavailable");
    });

    const actual = declareTsumo(armTsumoWin());

    expect(actual.phase).toBe("roundEnd");
    expect(actual.lastRound).toEqual(expected.lastRound);
    expect(actual.points).toEqual(expected.points);
  });
});
