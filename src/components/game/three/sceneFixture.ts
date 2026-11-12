import type { DisplayEnvelope } from "@/domain/display/displaySnapshot";

/** Display DTO fixture only: no engine, wall, seed or domain calculations. */
export function frame(): DisplayEnvelope {
  const seated = {
    kind: "seated" as const,
    points: 35000,
    pointsDelta: 0,
    status: {
      isDealer: false,
      isCurrentTurn: false,
      hasDeclaredRiichi: false,
    },
    melds: [],
    discards: [],
    kitaCount: 0,
  };
  return {
    protocol: "four-bros-mahjong/local-display",
    version: 1,
    sessionId: "scene-test",
    generation: 1,
    revision: 0,
    mode: "restore",
    snapshot: {
      playerId: "p0",
      phase: "playing",
      slots: [
        {
          ...seated,
          position: "self",
          playerId: "p0",
          name: "self",
          seatWind: "east",
          hand: [
            { suit: "pin", rank: 5, red: true },
            { suit: "sou", rank: 5, red: false },
            { suit: "pin", rank: 5, red: true },
          ],
          discards: [
            { suit: "man", rank: 1, red: false, isRiichi: false },
            { suit: "honor", rank: 4, red: false, isRiichi: true },
          ],
          kitaCount: 2,
        },
        {
          ...seated,
          position: "left",
          playerId: "p1",
          name: "left",
          seatWind: "south",
          handCount: 7,
          melds: [
            {
              type: "pon",
              concealed: false,
              tiles: Array.from({ length: 3 }, () => ({
                suit: "sou" as const,
                rank: 9,
                red: false,
              })),
            },
            {
              type: "kan",
              concealed: true,
              tiles: Array.from({ length: 4 }, () => ({
                suit: "pin" as const,
                rank: 1,
                red: false,
              })),
            },
          ],
        },
        {
          ...seated,
          position: "across",
          playerId: "p2",
          name: "across",
          seatWind: "west",
          handCount: 13,
        },
        {
          kind: "bench",
          position: "right",
          playerId: "p3",
          name: "bench",
          points: 35000,
          pointsDelta: 0,
        },
      ],
      tableInfo: {
        roundWind: "east",
        handNumber: 1,
        honba: 0,
        riichiSticks: 0,
        remainingLiveTiles: 52,
        dice: [1, 2],
        doraCount: 1,
      },
      dora: {
        indicators: [{ suit: "pin", rank: 5, red: true }],
        uraIndicatorCount: 1,
        uraIndicators: [],
      },
      result: null,
      options: [
        {
          id: "red-first",
          action: "discard",
          tile: { suit: "pin", rank: 5, red: true },
        },
        {
          id: "red-riichi",
          action: "riichi",
          tile: { suit: "pin", rank: 5, red: true },
        },
        {
          id: "red-second",
          action: "discard",
          tile: { suit: "pin", rank: 5, red: true },
        },
      ],
    },
  };
}
