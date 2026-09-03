import { describe, expect, it } from "vitest";
import { walkToGameEnd } from "@/components/game/finishedGameFixture";
import { replayJournal } from "@/components/game/gamePersistence";
import { selectView } from "@/components/game/gameView";
import { MAX_OMOTE_DORA_COUNT } from "@/domain/dora/dice";
import { createGame, type EngineState } from "@/domain/game/engine";
import { COPIES_PER_TILE } from "@/domain/tiles/tileSet";
import {
  LEGACY_1C8CC9_PLAYING_SNAPSHOT,
  LEGACY_1C8CC9_TOP_LEVEL_KEYS,
} from "@/test/fixtures/legacyOnlineSnapshot";
import { RoomManager } from "../../../server/roomManager";
import {
  MAX_MAINTENANCE_RETRY_AFTER_MS,
  parseOnlineServerMessage,
} from "./onlineServerMessage";
import type { OnlineSnapshot } from "./types";

function snapshotFixture(): OnlineSnapshot {
  const engine = createGame({ seed: 31, humanPlayerIds: ["p0"] });
  return {
    code: "ABC234",
    version: 0,
    you: "p0",
    hostId: "p0",
    phase: engine.phase,
    view: selectView(engine, "p0"),
    pending: engine.pending,
    roundSummary: engine.lastRound,
    players: [{ id: "p0", name: "たろう", connected: true, isHost: true }],
    currentTurn: "p0",
    hostNotice: null,
  };
}

function snapshotForState(state: EngineState): OnlineSnapshot {
  return {
    code: "ABC234",
    version: 7,
    you: "p0",
    explicitKita: true,
    hostId: "p0",
    phase: state.phase,
    view: selectView(state, "p0"),
    pending: state.pending,
    roundSummary: state.lastRound,
    players: [
      {
        id: "p0",
        name: state.players[0]?.name ?? "p0",
        connected: true,
        isHost: true,
      },
    ],
    currentTurn: state.phase === "playing" ? "p0" : null,
    hostNotice: null,
    departureNotice: null,
  };
}

function firstRoundEnd(seed: number): EngineState {
  const { journal } = walkToGameEnd(seed);
  const nextRoundIndex = journal.actions.findIndex(
    (action) => action.type === "nextRound",
  );
  expect(nextRoundIndex).toBeGreaterThan(0);
  return replayJournal({
    ...journal,
    actions: journal.actions.slice(0, nextRoundIndex),
  });
}

function mutableSlotSnapshot(snapshot: OnlineSnapshot): {
  currentTurn: unknown;
  view: {
    slots: Record<
      string,
      { kind: string; player: Record<string, unknown> }
    >;
  };
} {
  return structuredClone(snapshot) as unknown as {
    currentTurn: unknown;
    view: {
      slots: Record<
        string,
        { kind: string; player: Record<string, unknown> }
      >;
    };
  };
}

describe("parseOnlineServerMessage", () => {
  it("parses current session, snapshot, error, and pong messages", () => {
    const snapshot = snapshotFixture();
    expect(
      parseOnlineServerMessage({
        type: "session",
        token: "t".repeat(24),
        snapshot,
      }),
    ).toEqual({ type: "session", token: "t".repeat(24), snapshot });
    expect(parseOnlineServerMessage({ type: "snapshot", snapshot })).toEqual({
      type: "snapshot",
      snapshot,
    });
    expect(
      parseOnlineServerMessage({
        type: "error",
        message: "しばらく待ってください。",
        code: "rate_limited",
        scope: "action",
        retryAfterMs: Number.MAX_VALUE,
      }),
    ).toEqual({
      type: "error",
      message: "しばらく待ってください。",
      code: "rate_limited",
      scope: "action",
      retryAfterMs: MAX_MAINTENANCE_RETRY_AFTER_MS,
    });
    expect(parseOnlineServerMessage({ type: "pong", extra: true })).toEqual({
      type: "pong",
    });
  });

  it.each(["draining", "drained", "terminating"] as const)(
    "parses a bounded %s maintenance notice",
    (phase) => {
      expect(
        parseOnlineServerMessage({
          type: "maintenance",
          phase,
          retryAfterMs: MAX_MAINTENANCE_RETRY_AFTER_MS,
          deadline: "2026-08-28T06:00:00.000Z",
          futureAdditiveField: true,
        }),
      ).toEqual({
        type: "maintenance",
        phase,
        retryAfterMs: MAX_MAINTENANCE_RETRY_AFTER_MS,
        deadline: "2026-08-28T06:00:00.000Z",
      });
    },
  );

  it("parses an additive accepting notice without maintenance timing fields", () => {
    expect(
      parseOnlineServerMessage({
        type: "maintenance",
        phase: "accepting",
        futureAdditiveField: true,
      }),
    ).toEqual({ type: "maintenance", phase: "accepting" });
  });

  it.each([
    { retryAfterMs: 0 },
    { retryAfterMs: null },
    { retryAfterMs: 1_000 },
    { deadline: null },
    { deadline: "2026-08-28T06:00:00.000Z" },
  ])("rejects accepting with a timing field: %o", (payload) => {
    expect(
      parseOnlineServerMessage({
        type: "maintenance",
        phase: "accepting",
        ...payload,
      }),
    ).toBeNull();
  });

  it.each([
    { phase: "draining", retryAfterMs: -1 },
    { phase: "draining", retryAfterMs: 1.5 },
    {
      phase: "draining",
      retryAfterMs: MAX_MAINTENANCE_RETRY_AFTER_MS + 1,
    },
    { phase: "draining", retryAfterMs: Number.NaN },
    { phase: "draining", deadline: "soon" },
    { phase: "draining", deadline: "2026-08-28" },
    { phase: "draining", deadline: "2026-02-30T06:00:00.000Z" },
    { phase: "draining", deadline: "2025-02-29T06:00:00+09:00" },
  ])("rejects a malformed known maintenance payload: %o", (payload) => {
    expect(
      parseOnlineServerMessage({ type: "maintenance", ...payload }),
    ).toBeNull();
  });

  it("uses strict retry validation for maintenance errors without changing legacy error normalization", () => {
    expect(
      parseOnlineServerMessage({
        type: "error",
        message: "server wording is not trusted for the maintenance banner",
        code: "maintenance",
        retryAfterMs: 5_000,
      }),
    ).toEqual({
      type: "error",
      message: "server wording is not trusted for the maintenance banner",
      code: "maintenance",
      retryAfterMs: 5_000,
    });
    expect(
      parseOnlineServerMessage({
        type: "error",
        message: "oversized",
        code: "maintenance",
        retryAfterMs: MAX_MAINTENANCE_RETRY_AFTER_MS + 1,
      }),
    ).toBeNull();
    expect(
      parseOnlineServerMessage({
        type: "error",
        message: "future error",
        code: "future_code",
        retryAfterMs: 500,
      }),
    ).toEqual({
      type: "error",
      message: "future error",
      retryAfterMs: 500,
    });
  });

  it("rejects malformed known session and snapshot envelopes", () => {
    const snapshot = snapshotFixture();
    expect(
      parseOnlineServerMessage({
        type: "session",
        token: "",
        snapshot,
      }),
    ).toBeNull();
    expect(
      parseOnlineServerMessage({
        type: "session",
        token: null,
        snapshot,
      }),
    ).toBeNull();
    expect(
      parseOnlineServerMessage({
        type: "snapshot",
        snapshot: null,
      }),
    ).toBeNull();
    expect(
      parseOnlineServerMessage({
        type: "snapshot",
        snapshot: { ...snapshot, code: null },
      }),
    ).toBeNull();
    expect(
      parseOnlineServerMessage({
        type: "snapshot",
        snapshot: { ...snapshot, players: null },
      }),
    ).toBeNull();
  });

  it("rejects display counts above the game bounds before rendering", () => {
    const snapshot = snapshotFixture();
    const self = snapshot.view.slots.self;
    const right = snapshot.view.slots.right;
    if (self.kind !== "seated" || right.kind !== "seated") {
      throw new Error(
        "count-bound fixture requires seated self and right slots",
      );
    }

    const oversizedKita = {
      ...snapshot,
      view: {
        ...snapshot.view,
        slots: {
          ...snapshot.view.slots,
          self: {
            ...self,
            player: { ...self.player, kitaCount: COPIES_PER_TILE + 1 },
          },
        },
      },
    };
    const oversizedHand = {
      ...snapshot,
      view: {
        ...snapshot.view,
        slots: {
          ...snapshot.view.slots,
          right: {
            ...right,
            player: { ...right.player, handCount: 15 },
          },
        },
      },
    };
    const oversizedDora = {
      ...snapshot,
      view: {
        ...snapshot.view,
        tableInfo: {
          ...snapshot.view.tableInfo,
          doraCount: MAX_OMOTE_DORA_COUNT + 1,
        },
        dora: {
          ...snapshot.view.dora,
          uraIndicatorCount: MAX_OMOTE_DORA_COUNT + 1,
        },
      },
    };

    for (const candidate of [oversizedKita, oversizedHand, oversizedDora]) {
      expect(
        parseOnlineServerMessage({ type: "snapshot", snapshot: candidate }),
      ).toBeNull();
    }
  });

  it("rejects invisible and bidi-controlled names before they reach the UI", () => {
    const snapshot = snapshotFixture();
    for (const name of ["\u200B", "\u2060", "\uFEFF", "A\u202EB"]) {
      expect(
        parseOnlineServerMessage({
          type: "snapshot",
          snapshot: {
            ...snapshot,
            players: [{ ...snapshot.players[0]!, name }],
          },
        }),
        name,
      ).toBeNull();
    }

    const gameEnd = snapshotForState(walkToGameEnd(2024).state);
    const result = gameEnd.view.result;
    if (!result) throw new Error("gameEnd result expected");
    const poisonedResult = {
      ...result,
      players: result.players.map((player, index) =>
        index === 0 ? { ...player, name: "A\u202EB" } : player,
      ),
    };
    expect(
      parseOnlineServerMessage({
        type: "snapshot",
        snapshot: {
          ...gameEnd,
          view: { ...gameEnd.view, result: poisonedResult },
        },
      }),
    ).toBeNull();
  });

  it("accepts the production legacy snapshot shape without newer host/player fields", () => {
    const legacySnapshot = structuredClone(snapshotFixture()) as unknown as {
      hostId?: unknown;
      hostNotice?: unknown;
      explicitKita?: unknown;
      view: {
        slots: Record<string, { player: { playerId?: unknown } }>;
      };
    };
    delete legacySnapshot.hostId;
    delete legacySnapshot.hostNotice;
    delete legacySnapshot.explicitKita;
    for (const slot of Object.values(legacySnapshot.view.slots)) {
      delete slot.player.playerId;
    }
    const normalizedSnapshot = {
      ...legacySnapshot,
      hostId: "p0",
      hostNotice: null,
      view: {
        ...legacySnapshot.view,
        slots: Object.fromEntries(
          ["self", "right", "across", "left"].map((position, index) => [
            position,
            {
              ...legacySnapshot.view.slots[position],
              player: {
                ...legacySnapshot.view.slots[position]?.player,
                playerId: `p${index}`,
              },
            },
          ]),
        ),
      },
    };

    expect(
      parseOnlineServerMessage({
        type: "session",
        token: "legacy-production-token",
        snapshot: legacySnapshot,
      }),
    ).toEqual({
      type: "session",
      token: "legacy-production-token",
      snapshot: normalizedSnapshot,
    });
    expect(
      parseOnlineServerMessage({
        type: "snapshot",
        snapshot: legacySnapshot,
      }),
    ).toEqual({
      type: "snapshot",
      snapshot: normalizedSnapshot,
    });
  });

  it("keeps the deployed 1c8cc9 playing wire inventory compatible", () => {
    expect(Object.keys(LEGACY_1C8CC9_PLAYING_SNAPSHOT).sort()).toEqual(
      LEGACY_1C8CC9_TOP_LEVEL_KEYS,
    );
    expect(
      Object.values(LEGACY_1C8CC9_PLAYING_SNAPSHOT.view.slots).every(
        (slot) => !Object.hasOwn(slot.player, "playerId"),
      ),
    ).toBe(true);
    expect(
      Object.hasOwn(LEGACY_1C8CC9_PLAYING_SNAPSHOT.pending, "canKita"),
    ).toBe(false);
    const parsed = parseOnlineServerMessage({
      type: "session",
      token: "legacy-production-token",
      snapshot: LEGACY_1C8CC9_PLAYING_SNAPSHOT,
    });
    expect(parsed).toMatchObject({
      type: "session",
      snapshot: {
        hostId: "p0",
        hostNotice: null,
        view: {
          slots: {
            self: { player: { playerId: "p0" } },
            right: { player: { playerId: "p1" } },
            across: { player: { playerId: "p2" } },
            left: { player: { playerId: "p3" } },
          },
        },
        pending: { kind: "humanDiscard" },
      },
    });
    if (parsed?.type !== "session") throw new Error("legacy session expected");
    expect(parsed.snapshot).not.toHaveProperty("explicitKita");
    expect(parsed.snapshot.pending).not.toHaveProperty("canKita");
  });

  it("enforces the three-seated/one-bench slot and current-turn boundary", () => {
    const snapshot = snapshotFixture();
    expect(
      parseOnlineServerMessage({ type: "snapshot", snapshot }),
    ).toEqual({ type: "snapshot", snapshot });
    expect(
      parseOnlineServerMessage({
        type: "snapshot",
        snapshot: LEGACY_1C8CC9_PLAYING_SNAPSHOT,
      }),
    ).not.toBeNull();

    const allSeated = mutableSlotSnapshot(snapshot);
    const benchSlot = allSeated.view.slots.left;
    benchSlot.kind = "seated";
    benchSlot.player = {
      ...benchSlot.player,
      seatWind: "west",
      handCount: 13,
      kitaCount: 0,
      discards: [],
    };
    expect(
      parseOnlineServerMessage({ type: "snapshot", snapshot: allSeated }),
    ).toBeNull();

    const allBench = mutableSlotSnapshot(snapshot);
    for (const slot of Object.values(allBench.view.slots)) {
      if (slot.kind !== "seated") continue;
      slot.kind = "bench";
      slot.player = {
        playerId: slot.player.playerId,
        name: slot.player.name,
        points: slot.player.points,
      };
    }
    expect(
      parseOnlineServerMessage({ type: "snapshot", snapshot: allBench }),
    ).toBeNull();

    const benchPlayerSlot = Object.values(snapshot.view.slots).find(
      (slot) => slot.kind === "bench",
    );
    if (!benchPlayerSlot) throw new Error("bench slot expected");
    expect(
      parseOnlineServerMessage({
        type: "snapshot",
        snapshot: { ...snapshot, currentTurn: benchPlayerSlot.player.playerId },
      }),
    ).toBeNull();

    const outsideSlot = mutableSlotSnapshot(snapshot);
    outsideSlot.currentTurn = "p3";
    outsideSlot.view.slots.left.player.playerId = "p0";
    expect(
      parseOnlineServerMessage({ type: "snapshot", snapshot: outsideSlot }),
    ).toBeNull();
    expect(
      parseOnlineServerMessage({
        type: "snapshot",
        snapshot: { ...snapshot, currentTurn: "p9" },
      }),
    ).toBeNull();
  });

  it("validates real playing, win/draw roundEnd, and gameEnd snapshots", () => {
    const states = [
      createGame({ seed: 31, humanPlayerIds: ["p0"] }),
      firstRoundEnd(0),
      firstRoundEnd(3),
      walkToGameEnd(2024).state,
    ];
    expect(states.map((state) => state.phase)).toEqual([
      "playing",
      "roundEnd",
      "roundEnd",
      "gameEnd",
    ]);
    expect(states[1]?.lastRound?.kind).toBe("win");
    expect(states[1]?.lastRound?.winDetails).toBeDefined();
    expect(states[2]?.lastRound?.kind).toBe("draw");

    for (const state of states) {
      const snapshot = snapshotForState(state);
      expect(parseOnlineServerMessage({ type: "snapshot", snapshot })).toEqual({
        type: "snapshot",
        snapshot,
      });
    }
  });

  it("accepts server-generated private/public projections for all four viewpoints", () => {
    const manager = new RoomManager();
    const sessions = [manager.create("p0")];
    for (const name of ["p1", "p2", "p3"]) {
      const session = manager.join(sessions[0]!.room.code, name);
      if (!session) throw new Error(`${name} should join`);
      sessions.push(session);
    }
    for (const session of sessions) {
      const snapshot = manager.snapshot(session.room, session.player);
      expect(parseOnlineServerMessage({ type: "snapshot", snapshot })).toEqual({
        type: "snapshot",
        snapshot,
      });
    }
  });

  it("validates discard Kita and react/chankan pending variants", () => {
    const snapshot = snapshotFixture();
    if (snapshot.pending?.kind !== "humanDiscard") {
      throw new Error("humanDiscard fixture expected");
    }
    for (const canKita of [true, false]) {
      const pending = { ...snapshot.pending, canKita };
      expect(
        parseOnlineServerMessage({
          type: "snapshot",
          snapshot: { ...snapshot, pending },
        }),
      ).toMatchObject({ type: "snapshot", snapshot: { pending } });
    }

    for (const chankan of [undefined, "kakan", "ankan"] as const) {
      const pending = {
        kind: "humanReact",
        playerId: "p0",
        tile: { suit: "honor", rank: 4 },
        from: "south",
        canRon: true,
        canPon: false,
        canKan: false,
        ...(chankan === undefined ? {} : { chankan }),
      } as const;
      expect(
        parseOnlineServerMessage({
          type: "snapshot",
          snapshot: { ...snapshot, pending },
        }),
      ).toMatchObject({ type: "snapshot", snapshot: { pending } });
    }
    expect(
      parseOnlineServerMessage({
        type: "snapshot",
        snapshot: {
          ...snapshot,
          pending: {
            kind: "humanReact",
            playerId: "p0",
            tile: { suit: "honor", rank: 4 },
            from: "south",
            canRon: true,
            canPon: false,
            canKan: false,
            chankan: "daiminkan",
          },
        },
      }),
    ).toBeNull();
  });

  it("validates host and departure notice payloads", () => {
    const snapshot = snapshotFixture();
    const hostNotice = {
      reason: "disconnected",
      message: "ホストを引き継ぎました。",
      nextAction: "現在の手番に従ってください。",
    } as const;
    const departureNotice = {
      playerId: "p1",
      playerName: "ゲスト",
      message: "ゲストが退出しました。",
      nextAction: "対局を続けてください。",
    } as const;
    expect(
      parseOnlineServerMessage({
        type: "snapshot",
        snapshot: { ...snapshot, hostNotice, departureNotice },
      }),
    ).toMatchObject({
      type: "snapshot",
      snapshot: { hostNotice, departureNotice },
    });
    for (const invalid of [
      { ...snapshot, hostNotice: { ...hostNotice, reason: "timeout" } },
      {
        ...snapshot,
        departureNotice: { ...departureNotice, playerId: "p9" },
      },
    ]) {
      expect(
        parseOnlineServerMessage({ type: "snapshot", snapshot: invalid }),
      ).toBeNull();
    }
  });

  it("rejects opponent private hands and another player's pending action", () => {
    const snapshot = snapshotFixture();
    const self = snapshot.view.slots.self;
    const right = snapshot.view.slots.right;
    if (self.kind !== "seated" || right.kind !== "seated") {
      throw new Error("privacy fixture requires seated self and right slots");
    }
    expect(
      parseOnlineServerMessage({
        type: "snapshot",
        snapshot: {
          ...snapshot,
          view: {
            ...snapshot.view,
            slots: {
              ...snapshot.view.slots,
              right: {
                ...right,
                player: { ...right.player, hand: self.player.hand },
              },
            },
          },
        },
      }),
    ).toBeNull();
    expect(snapshot.pending).not.toBeNull();
    expect(
      parseOnlineServerMessage({
        type: "snapshot",
        snapshot: {
          ...snapshot,
          pending: { ...snapshot.pending, playerId: "p1" },
        },
      }),
    ).toBeNull();
  });

  it("accepts only all-current or all-legacy result player identity fields", () => {
    const snapshot = snapshotForState(walkToGameEnd(2024).state);
    const currentPlayers = snapshot.view.result?.players;
    if (!currentPlayers) throw new Error("gameEnd result expected");
    const withoutIds = currentPlayers.map((player) => {
      const legacyPlayer = { ...player };
      delete legacyPlayer.playerId;
      return legacyPlayer;
    });
    const currentWithLegacyResult = {
      ...snapshot,
      view: {
        ...snapshot.view,
        result: { players: withoutIds },
      },
    };
    expect(
      parseOnlineServerMessage({
        type: "snapshot",
        snapshot: currentWithLegacyResult,
      }),
    ).toBeNull();
    const exactLegacy = structuredClone(currentWithLegacyResult) as unknown as {
      hostId?: unknown;
      hostNotice?: unknown;
      explicitKita?: unknown;
      departureNotice?: unknown;
      view: { slots: Record<string, { player: { playerId?: unknown } }> };
    };
    delete exactLegacy.hostId;
    delete exactLegacy.hostNotice;
    delete exactLegacy.explicitKita;
    delete exactLegacy.departureNotice;
    for (const slot of Object.values(exactLegacy.view.slots)) {
      delete slot.player.playerId;
    }
    expect(
      parseOnlineServerMessage({ type: "snapshot", snapshot: exactLegacy }),
    ).not.toBeNull();
    expect(
      parseOnlineServerMessage({
        type: "snapshot",
        snapshot: {
          ...snapshot,
          view: {
            ...snapshot.view,
            result: {
              players: currentPlayers.map((player, index) =>
                index === 0 ? { ...player, playerId: null } : player,
              ),
            },
          },
        },
      }),
    ).toBeNull();
    expect(
      parseOnlineServerMessage({
        type: "snapshot",
        snapshot: {
          ...snapshot,
          view: {
            ...snapshot.view,
            result: {
              players: currentPlayers.map((player, index) =>
                index === 0
                  ? { ...player, playerId: currentPlayers[1]?.playerId }
                  : player,
              ),
            },
          },
        },
      }),
    ).toBeNull();
    expect(
      parseOnlineServerMessage({
        type: "snapshot",
        snapshot: {
          ...snapshot,
          view: {
            ...snapshot.view,
            result: {
              players: currentPlayers.map((player, index) =>
                index === 0 ? { ...player, playerId: undefined } : player,
              ),
            },
          },
        },
      }),
    ).toBeNull();
  });

  it("rejects mixed or ambiguous legacy/current identity fields", () => {
    const current = snapshotFixture();
    expect(
      parseOnlineServerMessage({
        type: "snapshot",
        snapshot: {
          ...current,
          view: {
            ...current.view,
            slots: {
              ...current.view.slots,
              left: {
                ...current.view.slots.left,
                player: {
                  ...current.view.slots.left.player,
                  playerId: undefined,
                },
              },
            },
          },
        },
      }),
    ).toBeNull();

    const nullIdsLegacy = structuredClone(current) as unknown as Record<
      string,
      unknown
    >;
    delete nullIdsLegacy.hostId;
    delete nullIdsLegacy.hostNotice;
    const nullIdView = nullIdsLegacy.view as {
      slots: Record<string, { player: { playerId?: unknown } }>;
    };
    for (const slot of Object.values(nullIdView.slots)) {
      slot.player.playerId = null;
    }
    expect(
      parseOnlineServerMessage({
        type: "snapshot",
        snapshot: nullIdsLegacy,
      }),
    ).toBeNull();

    for (const explicitKita of [true, false]) {
      const capabilityHybrid = structuredClone(current) as unknown as Record<
        string,
        unknown
      >;
      delete capabilityHybrid.hostId;
      delete capabilityHybrid.hostNotice;
      capabilityHybrid.explicitKita = explicitKita;
      const capabilityView = capabilityHybrid.view as {
        slots: Record<string, { player: { playerId?: unknown } }>;
      };
      for (const slot of Object.values(capabilityView.slots)) {
        delete slot.player.playerId;
      }
      expect(
        parseOnlineServerMessage({
          type: "snapshot",
          snapshot: capabilityHybrid,
        }),
      ).toBeNull();
    }

    const ambiguousLegacy = structuredClone(current) as unknown as Record<
      string,
      unknown
    >;
    delete ambiguousLegacy.hostId;
    delete ambiguousLegacy.hostNotice;
    const view = ambiguousLegacy.view as {
      slots: Record<string, { player: { playerId?: unknown } }>;
    };
    for (const slot of Object.values(view.slots)) delete slot.player.playerId;
    ambiguousLegacy.players = [
      ...(ambiguousLegacy.players as Array<Record<string, unknown>>),
      { id: "p1", name: "じろう", connected: true, isHost: true },
    ];
    expect(
      parseOnlineServerMessage({
        type: "snapshot",
        snapshot: ambiguousLegacy,
      }),
    ).toBeNull();
  });

  it("ignores unknown additive message types without mutating protocol state", () => {
    expect(
      parseOnlineServerMessage({ type: "future-message", payload: "ignored" }),
    ).toBeNull();
    expect(parseOnlineServerMessage(null)).toBeNull();
    expect(parseOnlineServerMessage("maintenance")).toBeNull();
  });
});
