import { describe, expect, it } from "vitest";
import { walkToGameEnd } from "@/components/game/finishedGameFixture";
import { replayJournal } from "@/components/game/gamePersistence";
import { selectView } from "@/components/game/gameView";
import { MAX_OMOTE_DORA_COUNT } from "@/domain/dora/dice";
import { createGame, type EngineState } from "@/domain/game/engine";
import {
  ONLINE_RESUME_TOKEN_MAX_LENGTH,
  ONLINE_RESUME_TOKEN_MIN_LENGTH,
} from "@/domain/online/types";
import { COPIES_PER_TILE, TOTAL_TILE_COUNT } from "@/domain/tiles/tileSet";
import {
  LEGACY_1C8CC9_PLAYING_SNAPSHOT,
  LEGACY_1C8CC9_TOP_LEVEL_KEYS,
} from "@/test/fixtures/legacyOnlineSnapshot";
import { RoomManager } from "../../../server/roomManager";
import {
  MAX_MAINTENANCE_RETRY_AFTER_MS,
  MAX_SNAPSHOT_HAN,
  MAX_SNAPSHOT_HAND_NUMBER,
  MAX_SNAPSHOT_HONBA,
  MAX_SNAPSHOT_POINT_DELTA,
  MAX_SNAPSHOT_POINTS,
  MAX_SNAPSHOT_RESULT_VALUE,
  MAX_SNAPSHOT_RIICHI_STICKS,
  MAX_SNAPSHOT_YAKUMAN,
  MAX_VISIBLE_HAND_TILES,
  MAX_WIN_PAYMENT_ENTRIES,
  MAX_WIN_YAKU_ENTRIES,
  parseOnlineServerMessage,
} from "./onlineServerMessage";
import type { OnlineSnapshot } from "./types";

function snapshotFixture(): OnlineSnapshot {
  const engine = createGame({
    seed: 31,
    names: ["たろう", "ゲスト2", "ゲスト3", "ゲスト4"],
    humanPlayerIds: ["p0"],
  });
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
    slots: Record<string, { kind: string; player: Record<string, unknown> }>;
  };
} {
  return structuredClone(snapshot) as unknown as {
    currentTurn: unknown;
    view: {
      slots: Record<string, { kind: string; player: Record<string, unknown> }>;
    };
  };
}

type MutableNumericSnapshot = {
  view: {
    slots: Record<string, { player: Record<string, unknown> }>;
    tableInfo: Record<string, unknown>;
    dora: Record<string, unknown>;
    result: { players: Array<Record<string, unknown>> } | null;
  };
  roundSummary: Record<string, unknown> | null;
};

type MutableVisibleTileSnapshot = {
  view: {
    slots: Record<string, { player: Record<string, unknown> }>;
    tableInfo: Record<string, unknown>;
    dora: Record<string, unknown>;
  };
};

function mutableNumericSnapshot(
  snapshot: OnlineSnapshot,
): MutableNumericSnapshot {
  return structuredClone(snapshot) as unknown as MutableNumericSnapshot;
}

function mutableVisibleTileSnapshot(
  snapshot: OnlineSnapshot,
): MutableVisibleTileSnapshot {
  return structuredClone(snapshot) as unknown as MutableVisibleTileSnapshot;
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

  it("rejects sanma-inexistent manzu ranks in online tile snapshots", () => {
    const snapshot = snapshotFixture();
    const self = snapshot.view.slots.self;
    if (self.kind !== "seated" || self.player.hand === undefined) {
      throw new Error("tile-catalog fixture requires a visible self hand");
    }

    const candidate = structuredClone(snapshot) as unknown as {
      view: {
        slots: {
          self: {
            kind: string;
            player: { hand?: Array<Record<string, unknown>> };
          };
        };
      };
    };
    const candidateSelf = candidate.view.slots.self;
    if (
      candidateSelf.kind !== "seated" ||
      candidateSelf.player.hand === undefined
    ) {
      throw new Error("tile-catalog copy requires a visible self hand");
    }
    candidateSelf.player.hand[0] = {
      suit: "man",
      rank: 2,
      isRed: false,
    };

    expect(
      parseOnlineServerMessage({ type: "snapshot", snapshot: candidate }),
    ).toBeNull();
  });

  it.each([
    ONLINE_RESUME_TOKEN_MIN_LENGTH - 1,
    ONLINE_RESUME_TOKEN_MAX_LENGTH + 1,
  ])("rejects session tokens outside the shared bounds: %s", (length) => {
    expect(
      parseOnlineServerMessage({
        type: "session",
        token: "t".repeat(length),
        snapshot: snapshotFixture(),
      }),
    ).toBeNull();
  });

  it.each([ONLINE_RESUME_TOKEN_MIN_LENGTH, ONLINE_RESUME_TOKEN_MAX_LENGTH])(
    "accepts session tokens at the shared bounds: %s",
    (length) => {
      const token = "t".repeat(length);
      expect(
        parseOnlineServerMessage({
          type: "session",
          token,
          snapshot: snapshotFixture(),
        }),
      ).toMatchObject({ type: "session", token });
    },
  );

  it.each([Number.MAX_SAFE_INTEGER + 1, 1e100])(
    "rejects snapshot versions outside JavaScript's safe integer range: %s",
    (version) => {
      expect(
        parseOnlineServerMessage({
          type: "snapshot",
          snapshot: { ...snapshotFixture(), version },
        }),
      ).toBeNull();
    },
  );

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

  it("bounds untrusted snapshot numeric displays to safe game ranges (#885)", () => {
    const playingSource = snapshotFixture();
    const playing = mutableNumericSnapshot(playingSource);
    playing.view.slots.self.player.points = MAX_SNAPSHOT_POINTS;
    playing.view.slots.right.player.points = -MAX_SNAPSHOT_POINTS;
    playing.view.slots.self.player.pointsDelta = MAX_SNAPSHOT_POINT_DELTA;
    playing.view.slots.right.player.pointsDelta = -MAX_SNAPSHOT_POINT_DELTA;
    playing.view.tableInfo.handNumber = MAX_SNAPSHOT_HAND_NUMBER;
    playing.view.tableInfo.honba = MAX_SNAPSHOT_HONBA;
    playing.view.tableInfo.riichiSticks = MAX_SNAPSHOT_RIICHI_STICKS;
    playing.view.tableInfo.remainingLiveTiles = TOTAL_TILE_COUNT;
    playing.view.tableInfo.doraCount = MAX_OMOTE_DORA_COUNT;
    const doraIndicator = playingSource.view.dora.indicators[0];
    if (!doraIndicator) throw new Error("dora indicator fixture expected");
    playing.view.dora.indicators = Array.from(
      { length: MAX_OMOTE_DORA_COUNT },
      () => ({ ...doraIndicator }),
    );
    playing.view.dora.uraIndicatorCount = MAX_OMOTE_DORA_COUNT;
    expect(
      parseOnlineServerMessage({
        type: "snapshot",
        snapshot: playing,
      }),
    ).not.toBeNull();

    const roundEnd = mutableNumericSnapshot(snapshotForState(firstRoundEnd(0)));
    const roundSummary = roundEnd.roundSummary;
    if (!roundSummary) throw new Error("round summary fixture expected");
    (roundSummary.deltas as Record<string, unknown>).p0 =
      MAX_SNAPSHOT_POINT_DELTA;
    roundSummary.residualSticks = {
      recipientId: "p0",
      recipientName: "たろう",
      sticks: MAX_SNAPSHOT_RIICHI_STICKS,
      points: MAX_SNAPSHOT_POINT_DELTA,
    };
    const winDetails = roundSummary.winDetails as Record<string, unknown>;
    if (!winDetails) throw new Error("win details fixture expected");
    const yaku = winDetails.yaku as Array<Record<string, unknown>>;
    if (yaku.length === 0) {
      yaku.push({ name: "立直", han: 0, yakuman: 0 });
    }
    const firstYaku = yaku[0];
    if (!firstYaku) throw new Error("yaku fixture expected");
    firstYaku.han = MAX_SNAPSHOT_HAN;
    firstYaku.yakuman = MAX_SNAPSHOT_YAKUMAN;
    winDetails.yakuHan = MAX_SNAPSHOT_HAN;
    winDetails.dora = {
      omote: MAX_SNAPSHOT_HAN,
      ura: MAX_SNAPSHOT_HAN,
      aka: MAX_SNAPSHOT_HAN,
      gari: MAX_SNAPSHOT_HAN,
      total: MAX_SNAPSHOT_HAN,
    };
    winDetails.totalHan = MAX_SNAPSHOT_HAN;
    winDetails.yakuman = MAX_SNAPSHOT_YAKUMAN;
    winDetails.honba = MAX_SNAPSHOT_HONBA;
    winDetails.riichiSticks = MAX_SNAPSHOT_RIICHI_STICKS;
    winDetails.payments = [
      { name: "支払者", amount: MAX_SNAPSHOT_POINT_DELTA },
    ];
    winDetails.stickPayout = MAX_SNAPSHOT_POINT_DELTA;
    expect(
      parseOnlineServerMessage({
        type: "snapshot",
        snapshot: roundEnd,
      }),
    ).not.toBeNull();

    const gameEnd = mutableNumericSnapshot(
      snapshotForState(walkToGameEnd(2024).state),
    );
    const result = gameEnd.view.result;
    if (!result?.players[0]) throw new Error("result fixture expected");
    result.players[0].rawScore = -MAX_SNAPSHOT_RESULT_VALUE;
    result.players[0].uma = MAX_SNAPSHOT_RESULT_VALUE;
    result.players[0].bonus = MAX_SNAPSHOT_RESULT_VALUE;
    result.players[0].soshiiTotal = MAX_SNAPSHOT_RESULT_VALUE;
    expect(
      parseOnlineServerMessage({
        type: "snapshot",
        snapshot: gameEnd,
      }),
    ).not.toBeNull();
  });

  it("rejects snapshots with inconsistent dora metadata counts", () => {
    const snapshot = snapshotFixture();
    const doraIndicator = snapshot.view.dora.indicators[0];
    if (!doraIndicator) throw new Error("dora indicator fixture expected");

    const mismatchedOmoteCount = mutableNumericSnapshot(snapshot);
    mismatchedOmoteCount.view.tableInfo.doraCount =
      snapshot.view.tableInfo.doraCount === 0 ? 1 : 0;

    const mismatchedUraCount = mutableNumericSnapshot(snapshot);
    mismatchedUraCount.view.dora.uraIndicatorCount =
      snapshot.view.tableInfo.doraCount === 0 ? 1 : 0;

    const mismatchedRevealedUra = mutableNumericSnapshot(snapshot);
    const uraCount = snapshot.view.dora.uraIndicatorCount ?? 0;
    mismatchedRevealedUra.view.dora.uraIndicators = Array.from(
      { length: uraCount === 0 ? 1 : 0 },
      () => ({ ...doraIndicator }),
    );

    for (const candidate of [
      mismatchedOmoteCount,
      mismatchedUraCount,
      mismatchedRevealedUra,
    ]) {
      expect(
        parseOnlineServerMessage({ type: "snapshot", snapshot: candidate }),
      ).toBeNull();
    }
  });

  it("rejects non-finite, fractional, unsafe, and out-of-range snapshot numbers (#885)", () => {
    const invalidValues = (maximum: number): number[] => [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      1.5,
      maximum + 1,
      -maximum - 1,
      Number.MAX_SAFE_INTEGER + 1,
    ];
    type NumericMutation = (
      snapshot: MutableNumericSnapshot,
      value: number,
    ) => void;
    const expectRejected = (
      label: string,
      source: OnlineSnapshot,
      maximum: number,
      mutate: NumericMutation,
    ) => {
      for (const value of invalidValues(maximum)) {
        const candidate = mutableNumericSnapshot(source);
        mutate(candidate, value);
        expect(
          parseOnlineServerMessage({
            type: "snapshot",
            snapshot: candidate,
          }),
          `${label}: ${String(value)}`,
        ).toBeNull();
      }
    };

    const playing = snapshotFixture();
    expectRejected(
      "player points",
      playing,
      MAX_SNAPSHOT_POINTS,
      (candidate, value) => {
        candidate.view.slots.self.player.points = value;
      },
    );
    expectRejected(
      "points delta",
      playing,
      MAX_SNAPSHOT_POINT_DELTA,
      (candidate, value) => {
        candidate.view.slots.self.player.pointsDelta = value;
      },
    );
    for (const [label, maximum, mutate] of [
      [
        "hand number",
        MAX_SNAPSHOT_HAND_NUMBER,
        (candidate: MutableNumericSnapshot, value: number) => {
          candidate.view.tableInfo.handNumber = value;
        },
      ],
      [
        "honba",
        MAX_SNAPSHOT_HONBA,
        (candidate: MutableNumericSnapshot, value: number) => {
          candidate.view.tableInfo.honba = value;
        },
      ],
      [
        "riichi sticks",
        MAX_SNAPSHOT_RIICHI_STICKS,
        (candidate: MutableNumericSnapshot, value: number) => {
          candidate.view.tableInfo.riichiSticks = value;
        },
      ],
      [
        "remaining live tiles",
        TOTAL_TILE_COUNT,
        (candidate: MutableNumericSnapshot, value: number) => {
          candidate.view.tableInfo.remainingLiveTiles = value;
        },
      ],
      [
        "dora count",
        MAX_OMOTE_DORA_COUNT,
        (candidate: MutableNumericSnapshot, value: number) => {
          candidate.view.tableInfo.doraCount = value;
        },
      ],
      [
        "ura dora count",
        MAX_OMOTE_DORA_COUNT,
        (candidate: MutableNumericSnapshot, value: number) => {
          candidate.view.dora.uraIndicatorCount = value;
        },
      ],
    ] as const) {
      expectRejected(label, playing, maximum, mutate);
    }

    const roundEnd = snapshotForState(firstRoundEnd(0));
    expectRejected(
      "round delta",
      roundEnd,
      MAX_SNAPSHOT_POINT_DELTA,
      (candidate, value) => {
        const summary = candidate.roundSummary;
        if (!summary) throw new Error("round summary fixture expected");
        (summary.deltas as Record<string, unknown>).p0 = value;
      },
    );
    expectRejected(
      "residual sticks",
      roundEnd,
      MAX_SNAPSHOT_RIICHI_STICKS,
      (candidate, value) => {
        const summary = candidate.roundSummary;
        if (!summary) throw new Error("round summary fixture expected");
        summary.residualSticks = {
          recipientId: "p0",
          recipientName: "たろう",
          sticks: value,
          points: 0,
        };
      },
    );
    expectRejected(
      "residual points",
      roundEnd,
      MAX_SNAPSHOT_POINT_DELTA,
      (candidate, value) => {
        const summary = candidate.roundSummary;
        if (!summary) throw new Error("round summary fixture expected");
        summary.residualSticks = {
          recipientId: "p0",
          recipientName: "たろう",
          sticks: 0,
          points: value,
        };
      },
    );

    const winMutations: readonly [string, number, NumericMutation][] = [
      [
        "yaku han",
        MAX_SNAPSHOT_HAN,
        (candidate, value) => {
          const summary = candidate.roundSummary;
          if (!summary) throw new Error("round summary fixture expected");
          const details = summary.winDetails as Record<string, unknown>;
          details.yaku = [{ name: "立直", han: value, yakuman: 0 }];
        },
      ],
      [
        "yaku yakuman",
        MAX_SNAPSHOT_YAKUMAN,
        (candidate, value) => {
          const summary = candidate.roundSummary;
          if (!summary) throw new Error("round summary fixture expected");
          const details = summary.winDetails as Record<string, unknown>;
          details.yaku = [{ name: "立直", han: 0, yakuman: value }];
        },
      ],
      [
        "yaku total",
        MAX_SNAPSHOT_HAN,
        (candidate, value) => {
          const summary = candidate.roundSummary;
          if (!summary) throw new Error("round summary fixture expected");
          (summary.winDetails as Record<string, unknown>).yakuHan = value;
        },
      ],
      [
        "dora breakdown",
        MAX_SNAPSHOT_HAN,
        (candidate, value) => {
          const summary = candidate.roundSummary;
          if (!summary) throw new Error("round summary fixture expected");
          (summary.winDetails as Record<string, unknown>).dora = {
            omote: value,
            ura: 0,
            aka: 0,
            gari: 0,
            total: 0,
          };
        },
      ],
      [
        "total han",
        MAX_SNAPSHOT_HAN,
        (candidate, value) => {
          const summary = candidate.roundSummary;
          if (!summary) throw new Error("round summary fixture expected");
          (summary.winDetails as Record<string, unknown>).totalHan = value;
        },
      ],
      [
        "win yakuman",
        MAX_SNAPSHOT_YAKUMAN,
        (candidate, value) => {
          const summary = candidate.roundSummary;
          if (!summary) throw new Error("round summary fixture expected");
          (summary.winDetails as Record<string, unknown>).yakuman = value;
        },
      ],
      [
        "win honba",
        MAX_SNAPSHOT_HONBA,
        (candidate, value) => {
          const summary = candidate.roundSummary;
          if (!summary) throw new Error("round summary fixture expected");
          (summary.winDetails as Record<string, unknown>).honba = value;
        },
      ],
      [
        "win riichi sticks",
        MAX_SNAPSHOT_RIICHI_STICKS,
        (candidate, value) => {
          const summary = candidate.roundSummary;
          if (!summary) throw new Error("round summary fixture expected");
          (summary.winDetails as Record<string, unknown>).riichiSticks = value;
        },
      ],
      [
        "payment amount",
        MAX_SNAPSHOT_POINT_DELTA,
        (candidate, value) => {
          const summary = candidate.roundSummary;
          if (!summary) throw new Error("round summary fixture expected");
          (summary.winDetails as Record<string, unknown>).payments = [
            { name: "支払者", amount: value },
          ];
        },
      ],
      [
        "stick payout",
        MAX_SNAPSHOT_POINT_DELTA,
        (candidate, value) => {
          const summary = candidate.roundSummary;
          if (!summary) throw new Error("round summary fixture expected");
          (summary.winDetails as Record<string, unknown>).stickPayout = value;
        },
      ],
    ];
    for (const [label, maximum, mutate] of winMutations) {
      expectRejected(label, roundEnd, maximum, mutate);
    }

    const gameEnd = snapshotForState(walkToGameEnd(2024).state);
    for (const field of ["rawScore", "uma", "bonus", "soshiiTotal"] as const) {
      expectRejected(
        `result ${field}`,
        gameEnd,
        MAX_SNAPSHOT_RESULT_VALUE,
        (candidate, value) => {
          const result = candidate.view.result;
          if (!result?.players[0]) throw new Error("result fixture expected");
          result.players[0][field] = value;
        },
      );
    }
  });

  it("requires canonical tile counts and identities for visible melds (#864)", () => {
    const snapshot = snapshotFixture();
    const tile = { suit: "pin" as const, rank: 1, isRed: false };
    const meldWith = (meld: unknown): OnlineSnapshot => {
      const candidate = structuredClone(snapshot) as unknown as {
        view: {
          slots: Record<string, { player: Record<string, unknown> }>;
        };
      };
      candidate.view.slots.self.player.melds = [meld];
      return candidate as unknown as OnlineSnapshot;
    };
    const repeated = (count: number) =>
      Array.from({ length: count }, () => ({ ...tile }));

    for (const meld of [
      { type: "pon", tiles: [], concealed: false },
      { type: "pon", tiles: repeated(2), concealed: false },
      { type: "pon", tiles: repeated(3), concealed: true },
      {
        type: "pon",
        tiles: [tile, { ...tile, rank: 6 }, { ...tile, rank: 5 }],
        concealed: false,
      },
      { type: "kan", tiles: repeated(3), concealed: false },
    ]) {
      expect(
        parseOnlineServerMessage({
          type: "snapshot",
          snapshot: meldWith(meld),
        }),
      ).toBeNull();
    }

    for (const meld of [
      { type: "pon", tiles: repeated(3), concealed: false },
      { type: "kan", tiles: repeated(4), concealed: false },
      { type: "kan", tiles: repeated(4), concealed: true },
    ]) {
      expect(
        parseOnlineServerMessage({
          type: "snapshot",
          snapshot: meldWith(meld),
        }),
      ).not.toBeNull();
    }
  });

  it("rejects visible tile kinds beyond four copies across snapshot fields", () => {
    const tile = { suit: "pin" as const, rank: 1, isRed: false };
    const north = { suit: "honor" as const, rank: 4, isRed: false };
    const repeated = (value: typeof tile, count: number) =>
      Array.from({ length: count }, () => ({ ...value }));
    const base = (): MutableVisibleTileSnapshot => {
      const candidate = mutableVisibleTileSnapshot(snapshotFixture());
      const self = candidate.view.slots.self.player;
      self.hand = [];
      self.melds = [];
      self.discards = [];
      self.kitaCount = 0;
      candidate.view.tableInfo.doraCount = 0;
      candidate.view.dora.indicators = [];
      candidate.view.dora.uraIndicatorCount = 0;
      candidate.view.dora.uraIndicators = [];
      return candidate;
    };

    const exactlyFour = base();
    exactlyFour.view.slots.self.player.hand = repeated(tile, 4);
    expect(
      parseOnlineServerMessage({
        type: "snapshot",
        snapshot: exactlyFour as unknown as OnlineSnapshot,
      }),
    ).not.toBeNull();

    const overHand = base();
    overHand.view.slots.self.player.hand = repeated(tile, 5);

    const acrossHandAndMeld = base();
    acrossHandAndMeld.view.slots.self.player.hand = repeated(tile, 2);
    acrossHandAndMeld.view.slots.self.player.melds = [
      { type: "pon", tiles: repeated(tile, 3), concealed: false },
    ];

    const acrossKitaAndDiscard = base();
    acrossKitaAndDiscard.view.slots.self.player.kitaCount = 4;
    acrossKitaAndDiscard.view.slots.self.player.discards = [north];

    const acrossDoraIndicators = base();
    acrossDoraIndicators.view.dora.indicators = repeated(tile, 3);
    acrossDoraIndicators.view.dora.uraIndicatorCount = 2;
    acrossDoraIndicators.view.dora.uraIndicators = repeated(tile, 2);

    for (const candidate of [
      overHand,
      acrossHandAndMeld,
      acrossKitaAndDiscard,
      acrossDoraIndicators,
    ]) {
      expect(
        parseOnlineServerMessage({
          type: "snapshot",
          snapshot: candidate as unknown as OnlineSnapshot,
        }),
      ).toBeNull();
    }
  });

  it("rejects tile views whose optional isRed flag contradicts the tile kind", () => {
    const malformedTiles = [
      { suit: "pin" as const, rank: 5, isRed: false },
      { suit: "sou" as const, rank: 5, isRed: false },
      { suit: "man" as const, rank: 1, isRed: true },
      { suit: "honor" as const, rank: 7, isRed: true },
    ];

    for (const tile of malformedTiles) {
      const candidate = mutableSlotSnapshot(snapshotFixture());
      candidate.view.slots.self.player.hand = [tile];
      expect(
        parseOnlineServerMessage({
          type: "snapshot",
          snapshot: candidate as unknown as OnlineSnapshot,
        }),
        JSON.stringify(tile),
      ).toBeNull();
    }
  });

  it("bounds pending tile options and the revealed winning hand before UI expansion (#863)", () => {
    const snapshot = snapshotFixture();
    const pending = snapshot.pending;
    if (pending?.kind !== "humanDiscard") {
      throw new Error("pending tile option fixture expected");
    }
    const tile = pending.riichiTiles[0] ?? {
      suit: "man" as const,
      rank: 1,
      isRed: false,
    };
    const pendingFields = [
      "riichiTiles",
      "ankanTiles",
      "kakanTiles",
      "forbiddenDiscards",
    ] as const;

    for (const field of pendingFields) {
      const atLimit = {
        ...snapshot,
        pending: {
          ...pending,
          [field]: Array.from({ length: MAX_VISIBLE_HAND_TILES }, () => tile),
        },
      };
      const overLimit = {
        ...snapshot,
        pending: {
          ...pending,
          [field]: Array.from(
            { length: MAX_VISIBLE_HAND_TILES + 1 },
            () => tile,
          ),
        },
      };

      expect(
        parseOnlineServerMessage({ type: "snapshot", snapshot: atLimit }),
        field,
      ).not.toBeNull();
      expect(
        parseOnlineServerMessage({ type: "snapshot", snapshot: overLimit }),
        field,
      ).toBeNull();
    }

    const gameEnd = snapshotForState(walkToGameEnd(2024).state);
    const roundSummary = gameEnd.roundSummary;
    const winDetails = roundSummary?.winDetails;
    if (!roundSummary || !winDetails) {
      throw new Error("win details fixture expected");
    }
    const handTile = winDetails.hand[0] ?? winDetails.winningTile;
    const atLimit = {
      ...gameEnd,
      roundSummary: {
        ...roundSummary,
        winDetails: {
          ...winDetails,
          hand: Array.from({ length: MAX_VISIBLE_HAND_TILES }, () => handTile),
        },
      },
    };
    const overLimit = {
      ...gameEnd,
      roundSummary: {
        ...roundSummary,
        winDetails: {
          ...winDetails,
          hand: Array.from(
            { length: MAX_VISIBLE_HAND_TILES + 1 },
            () => handTile,
          ),
        },
      },
    };

    expect(
      parseOnlineServerMessage({ type: "snapshot", snapshot: atLimit }),
    ).not.toBeNull();
    expect(
      parseOnlineServerMessage({ type: "snapshot", snapshot: overLimit }),
    ).toBeNull();
  });

  it("bounds win detail lists before WinDetails expands them (#858)", () => {
    const snapshot = snapshotForState(walkToGameEnd(2024).state);
    const roundSummary = snapshot.roundSummary;
    const winDetails = roundSummary?.winDetails;
    if (!roundSummary || !winDetails) {
      throw new Error("winDetails fixture expected");
    }
    const yaku = winDetails.yaku[0] ?? { name: "立直", han: 1, yakuman: 0 };
    const payment = winDetails.payments[0] ?? { name: "支払者", amount: 1000 };
    const withLists = (
      nextYaku: readonly (typeof yaku)[],
      nextPayments: readonly (typeof payment)[],
    ) => ({
      ...snapshot,
      roundSummary: {
        ...roundSummary,
        winDetails: { ...winDetails, yaku: nextYaku, payments: nextPayments },
      },
    });

    expect(
      parseOnlineServerMessage({
        type: "snapshot",
        snapshot: withLists(
          Array.from({ length: MAX_WIN_YAKU_ENTRIES }, () => yaku),
          Array.from({ length: MAX_WIN_PAYMENT_ENTRIES }, () => payment),
        ),
      }),
    ).not.toBeNull();
    expect(
      parseOnlineServerMessage({
        type: "snapshot",
        snapshot: withLists(
          Array.from({ length: MAX_WIN_YAKU_ENTRIES + 1 }, () => yaku),
          [],
        ),
      }),
    ).toBeNull();
    expect(
      parseOnlineServerMessage({
        type: "snapshot",
        snapshot: withLists(
          [],
          Array.from({ length: MAX_WIN_PAYMENT_ENTRIES + 1 }, () => payment),
        ),
      }),
    ).toBeNull();
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
    expect(parseOnlineServerMessage({ type: "snapshot", snapshot })).toEqual({
      type: "snapshot",
      snapshot,
    });
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
    allBench.currentTurn = null;
    expect(
      parseOnlineServerMessage({ type: "snapshot", snapshot: allBench }),
    ).toBeNull();
  });

  it("rejects duplicate slot player IDs while currentTurn remains seated p0", () => {
    const duplicateSlot = mutableSlotSnapshot(snapshotFixture());
    expect(duplicateSlot.currentTurn).toBe("p0");
    duplicateSlot.view.slots.left.player.playerId = "p0";

    expect(
      parseOnlineServerMessage({ type: "snapshot", snapshot: duplicateSlot }),
    ).toBeNull();
  });

  it("rejects bench p3 as currentTurn with the complete distinct slot ID ring", () => {
    const benchTurn = mutableSlotSnapshot(snapshotFixture());
    expect(
      ["self", "right", "across", "left"].map(
        (position) => benchTurn.view.slots[position]?.player.playerId,
      ),
    ).toEqual(["p0", "p1", "p2", "p3"]);
    expect(benchTurn.view.slots.left?.kind).toBe("bench");
    benchTurn.currentTurn = "p3";

    expect(
      parseOnlineServerMessage({ type: "snapshot", snapshot: benchTurn }),
    ).toBeNull();
  });

  it("rejects a currentTurn ID outside the slot player ID domain", () => {
    expect(
      parseOnlineServerMessage({
        type: "snapshot",
        snapshot: { ...snapshotFixture(), currentTurn: "p9" },
      }),
    ).toBeNull();
  });

  it("accepts a partial top-level players roster for p0 and non-p0 viewpoints", () => {
    const p0Snapshot = snapshotFixture();
    expect(p0Snapshot.players).toHaveLength(1);
    expect(
      parseOnlineServerMessage({ type: "snapshot", snapshot: p0Snapshot }),
    ).toEqual({ type: "snapshot", snapshot: p0Snapshot });

    const manager = new RoomManager();
    const host = manager.create("ホスト");
    const guest = manager.join(host.room.code, "ゲスト");
    if (!guest) throw new Error("guest should join");
    const nonP0Snapshot = manager.snapshot(guest.room, guest.player);
    expect(nonP0Snapshot.you).toBe("p1");
    expect(nonP0Snapshot.players).toHaveLength(2);
    expect(
      parseOnlineServerMessage({
        type: "snapshot",
        snapshot: nonP0Snapshot,
      }),
    ).toEqual({ type: "snapshot", snapshot: nonP0Snapshot });
  });

  it("rejects roster/slot name mismatches without treating historical result names as current identities", () => {
    const snapshot = snapshotFixture();
    expect(
      parseOnlineServerMessage({
        type: "snapshot",
        snapshot: {
          ...snapshot,
          players: [{ ...snapshot.players[0]!, name: "名簿だけの名前" }],
        },
      }),
    ).toBeNull();

    const slot = snapshot.view.slots.self;
    expect(slot.kind).toBe("seated");
    if (slot.kind !== "seated") throw new Error("self slot should be seated");
    expect(
      parseOnlineServerMessage({
        type: "snapshot",
        snapshot: {
          ...snapshot,
          view: {
            ...snapshot.view,
            slots: {
              ...snapshot.view.slots,
              self: {
                ...slot,
                player: { ...slot.player, name: "卓上だけの名前" },
              },
            },
          },
        },
      }),
    ).toBeNull();

    const finished = snapshotForState(walkToGameEnd(2024).state);
    const result = finished.view.result;
    if (!result) throw new Error("gameEnd result expected");
    const historicalName = {
      ...finished,
      view: {
        ...finished.view,
        result: {
          players: result.players.map((player, index) =>
            index === 0 ? { ...player, name: "過去の対局者" } : player,
          ),
        },
      },
    };
    expect(
      parseOnlineServerMessage({
        type: "snapshot",
        snapshot: historicalName,
      }),
    ).not.toBeNull();
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

  it.each([
    "normal",
    "mangan",
    "haneman",
    "baiman",
    "sanbaiman",
    "yakuman",
  ] as const)("accepts the online snapshot ScoreCategory %s", (category) => {
    const { state } = walkToGameEnd(2024);
    const roundSummary = state.lastRound;
    const winDetails = roundSummary?.winDetails;
    if (!roundSummary || !winDetails) {
      throw new Error("winDetails fixture expected");
    }
    const snapshot = snapshotForState(state);
    const valid = {
      ...snapshot,
      roundSummary: {
        ...roundSummary,
        winDetails: { ...winDetails, category },
      },
    };

    expect(
      parseOnlineServerMessage({ type: "snapshot", snapshot: valid }),
    ).not.toBeNull();
  });

  it.each(["__proto__", "constructor", "toString", "future-category"])(
    "rejects an unsafe online snapshot winDetails category: %s",
    (category) => {
      const { state } = walkToGameEnd(2024);
      const roundSummary = state.lastRound;
      const winDetails = roundSummary?.winDetails;
      if (!roundSummary || !winDetails) {
        throw new Error("winDetails fixture expected");
      }
      const snapshot = snapshotForState(state);
      const malformed = {
        ...snapshot,
        roundSummary: {
          ...roundSummary,
          winDetails: { ...winDetails, category },
        },
      };

      expect(
        parseOnlineServerMessage({ type: "snapshot", snapshot: malformed }),
      ).toBeNull();
    },
  );

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

  it("rejects duplicate result ranks in current and legacy snapshots", () => {
    const snapshot = snapshotForState(walkToGameEnd(2024).state);
    const currentPlayers = snapshot.view.result?.players;
    if (!currentPlayers) throw new Error("gameEnd result expected");
    const duplicateRank = currentPlayers[0]?.rank;
    if (duplicateRank === undefined) throw new Error("result rank expected");

    const duplicatedCurrent = {
      ...snapshot,
      view: {
        ...snapshot.view,
        result: {
          players: currentPlayers.map((player, index) =>
            index === 1 ? { ...player, rank: duplicateRank } : player,
          ),
        },
      },
    };
    expect(
      parseOnlineServerMessage({
        type: "snapshot",
        snapshot: duplicatedCurrent,
      }),
    ).toBeNull();

    const legacyPlayers = currentPlayers.map((player, index) => {
      const legacyPlayer = { ...player };
      delete legacyPlayer.playerId;
      if (index === 1) legacyPlayer.rank = duplicateRank;
      return legacyPlayer;
    });
    const duplicatedLegacy = structuredClone(snapshot) as unknown as {
      hostId?: unknown;
      hostNotice?: unknown;
      explicitKita?: unknown;
      departureNotice?: unknown;
      view: {
        result: { players: typeof legacyPlayers };
        slots: Record<string, { player: { playerId?: unknown } }>;
      };
    };
    delete duplicatedLegacy.hostId;
    delete duplicatedLegacy.hostNotice;
    delete duplicatedLegacy.explicitKita;
    delete duplicatedLegacy.departureNotice;
    duplicatedLegacy.view.result = { players: legacyPlayers };
    for (const slot of Object.values(duplicatedLegacy.view.slots)) {
      delete slot.player.playerId;
    }
    expect(
      parseOnlineServerMessage({
        type: "snapshot",
        snapshot: duplicatedLegacy,
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
