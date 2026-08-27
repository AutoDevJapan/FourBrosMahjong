/**
 * Source-derived minimal schema sentinel for deployed source 1c8cc9.
 *
 * Keep this literal independent from current selectView/types builders: the
 * absence of host, character-ID, explicit-Kita, and canKita fields is the
 * compatibility contract under test.
 */
export const LEGACY_1C8CC9_PLAYING_SNAPSHOT = {
  code: "ABC234",
  version: 4,
  you: "p0",
  phase: "playing",
  view: {
    slots: {
      self: {
        kind: "seated",
        player: {
          name: "ホスト",
          points: 35_000,
          seatWind: "east",
          status: {
            isDealer: true,
            isCurrentTurn: true,
            hasDeclaredRiichi: false,
          },
          hand: [{ suit: "man", rank: 1 }],
          kitaCount: 0,
          discards: [],
        },
      },
      right: {
        kind: "seated",
        player: {
          name: "ゲスト",
          points: 35_000,
          seatWind: "south",
          status: {
            isDealer: false,
            isCurrentTurn: false,
            hasDeclaredRiichi: false,
          },
          handCount: 13,
          kitaCount: 0,
          discards: [],
        },
      },
      across: {
        kind: "seated",
        player: {
          name: "ゲスト3",
          points: 35_000,
          seatWind: "west",
          status: {
            isDealer: false,
            isCurrentTurn: false,
            hasDeclaredRiichi: false,
          },
          handCount: 13,
          kitaCount: 0,
          discards: [],
        },
      },
      left: {
        kind: "bench",
        player: {
          name: "ゲスト4",
          points: 35_000,
        },
      },
    },
    tableInfo: {
      roundWind: "east",
      handNumber: 1,
      honba: 0,
      riichiSticks: 0,
      remainingLiveTiles: 53,
      dice: [1, 2],
      doraCount: 1,
    },
    dora: {
      indicators: [{ suit: "pin", rank: 1 }],
      uraIndicatorCount: 1,
    },
    result: null,
  },
  pending: {
    kind: "humanDiscard",
    canTsumo: false,
    canRiichi: false,
    riichiTiles: [],
    ankanTiles: [],
    kakanTiles: [],
    forbiddenDiscards: [],
    locked: false,
  },
  roundSummary: null,
  players: [
    { id: "p0", name: "ホスト", connected: true, isHost: true },
    { id: "p1", name: "ゲスト", connected: true, isHost: false },
  ],
  currentTurn: "p0",
} as const;

export const LEGACY_1C8CC9_TOP_LEVEL_KEYS = [
  "code",
  "currentTurn",
  "pending",
  "phase",
  "players",
  "roundSummary",
  "version",
  "view",
  "you",
] as const;
