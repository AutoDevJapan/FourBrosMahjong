import { describe, expect, it } from "vitest";
import { createGame, type Pending } from "@/domain/game/engine";
import { selectView } from "@/domain/game/gameView";
import type { GameViewState } from "@/domain/game/viewTypes";
import { seatingOf } from "@/domain/round/round";
import {
  createDisplayEnvelope,
  type DisplayInput,
  projectDisplaySnapshot,
} from "./displaySnapshot";
import { newLocalDisplaySource } from "./displaySource";

function input(): DisplayInput {
  const engine = createGame({ seed: 1 });
  return {
    playerId: "p0",
    isHost: true,
    view: selectView(engine),
    phase: engine.phase,
    pending: engine.pending,
    displaySource: newLocalDisplaySource(),
  };
}

function contaminate(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(contaminate);
  if (value !== null && typeof value === "object") {
    return {
      ...Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, contaminate(item)]),
      ),
      engine: "PRIVATE-CANARY",
      seed: "PRIVATE-CANARY",
      reconnectSecret: "PRIVATE-CANARY",
    };
  }
  return value;
}

describe("local display projection (#1177)", () => {
  it("deeply allowlists nested fields and detaches/freezes the envelope", () => {
    const clean = input();
    const dirty = contaminate(clean) as DisplayInput;
    const envelope = createDisplayEnvelope(dirty, "restore")!;
    expect(envelope.snapshot).toEqual(projectDisplaySnapshot(clean));
    expect(JSON.stringify(envelope)).not.toContain("PRIVATE-CANARY");
    expect(envelope.snapshot.tableInfo).not.toBe(dirty.view.tableInfo);
    expect(Object.isFrozen(envelope.snapshot.slots[0])).toBe(true);
    expect(Object.isFrozen(envelope.snapshot.options)).toBe(true);
    expect(Object.isFrozen(clean.view.slots.self)).toBe(false);
  });

  it("never leaks injected opponent hands/furiten or bench gameplay fields", () => {
    const source = input();
    const dirty = JSON.parse(JSON.stringify(source)) as DisplayInput;
    for (const position of ["left", "across", "right"] as const) {
      const content = dirty.view.slots[position];
      Object.assign(content.player, {
        hand: [{ suit: "pin", rank: 9, hiddenCanary: "PRIVATE-HAND" }],
        status: { furitenReason: "riichi" },
      });
      if (content.kind === "bench") {
        Object.assign(content.player, {
          seatWind: "east",
          discards: ["PRIVATE-RIVER"],
        });
      }
    }
    const projected = projectDisplaySnapshot(dirty);
    for (const player of projected.slots.filter(
      ({ position }) => position !== "self",
    )) {
      expect(player).not.toHaveProperty("hand");
      expect(player).not.toHaveProperty("status.furitenReason");
      if (player.kind === "bench") {
        expect(player).not.toHaveProperty("seatWind");
        expect(player).not.toHaveProperty("discards");
      }
    }
    expect(JSON.stringify(projected)).not.toContain("PRIVATE-");
  });

  it.each([1, 2, 3, 4] as const)(
    "preserves supplied owner/seat rotation for round %s",
    (roundNumber) => {
      const state = createGame({ seed: 711 });
      const round = { ...state.round, roundNumber };
      if (!state.hand) throw new Error("Expected a hand");
      const source = {
        ...input(),
        view: selectView({
          ...state,
          round,
          hand: { ...state.hand, seating: seatingOf(round) },
        }),
      };
      const projected = projectDisplaySnapshot(source);
      for (const player of projected.slots) {
        const original = source.view.slots[player.position];
        expect(player.playerId).toBe(original.player.playerId);
        expect(player.points).toBe(original.player.points);
        expect(player.kind).toBe(original.kind);
        if (player.kind === "seated" && original.kind === "seated") {
          expect(player.seatWind).toBe(original.player.seatWind);
        }
      }
      if (source.view.slots.self.kind === "bench")
        expect(projected.options).toEqual([]);
    },
  );

  it("rejects viewer mismatch, duplicate players, and duplicate winds", () => {
    const source = input();
    expect(() => projectDisplaySnapshot({ ...source, playerId: "p2" })).toThrow(
      /ownership/,
    );
    const duplicate = JSON.parse(JSON.stringify(source)) as DisplayInput;
    Object.assign(duplicate.view.slots.left.player, { playerId: "p0" });
    expect(() => projectDisplaySnapshot(duplicate)).toThrow(/ownership/);
    const winds = JSON.parse(JSON.stringify(source)) as DisplayInput;
    for (const content of Object.values(winds.view.slots)) {
      if (content.kind === "seated")
        Object.assign(content.player, { seatWind: "east" });
    }
    expect(() => projectDisplaySnapshot(winds)).toThrow(/ownership/);
    const missing = structuredClone(source);
    Object.assign(missing.view.slots, { right: undefined });
    expect(() => projectDisplaySnapshot(missing)).toThrow(/ownership/);
    const noCount = structuredClone(source);
    for (const [position, content] of Object.entries(noCount.view.slots)) {
      if (position !== "self" && content.kind === "seated") {
        Object.assign(content.player, { handCount: undefined });
      }
    }
    expect(() => projectDisplaySnapshot(noCount)).toThrow(/hand count/);
  });

  it("retains current river order/riichi, public melds, red meaning and kita", () => {
    const source = input();
    const self = source.view.slots.self;
    if (self.kind !== "seated") throw new Error("Expected self seat");
    const discards = [
      { suit: "honor" as const, rank: 1 },
      { suit: "pin" as const, rank: 5, isRed: true, isRiichi: true },
    ];
    const melds = [
      {
        type: "kan" as const,
        concealed: true,
        tiles: Array(4).fill(discards[0]),
      },
    ];
    const view: GameViewState = {
      ...source.view,
      slots: {
        ...source.view.slots,
        self: {
          ...self,
          player: { ...self.player, discards, melds, kitaCount: 2 },
        },
      },
    };
    const projected = projectDisplaySnapshot({ ...source, view }).slots[0];
    expect(projected.kind).toBe("seated");
    if (projected.kind !== "seated") throw new Error("Expected projected self");
    expect(projected.discards).toEqual([
      { suit: "honor", rank: 1, red: false, isRiichi: false },
      { suit: "pin", rank: 5, red: true, isRiichi: true },
    ]);
    expect(projected.melds[0].tiles).toHaveLength(4);
    expect(projected.melds[0].tiles).toEqual([
      null,
      { suit: "honor", rank: 1, red: false },
      { suit: "honor", rank: 1, red: false },
      null,
    ]);
    expect(projected.kitaCount).toBe(2);
    // Called tiles are already absent in view; the adapter does not reconstruct history.
    const compressed = {
      ...view,
      slots: {
        ...view.slots,
        self: { ...self, player: { ...self.player, discards: [discards[1]] } },
      },
    };
    expect(
      projectDisplaySnapshot({ ...source, view: compressed }).slots[0],
    ).toMatchObject({ discards: [{ isRiichi: true }] });
  });

  it("does not serialize the face-down end tiles of an opponent's concealed kan", () => {
    const source = input();
    const position = (["left", "across", "right"] as const).find(
      (p) => source.view.slots[p].kind === "seated",
    )!;
    const slot = source.view.slots[position];
    if (slot.kind !== "seated") throw new Error("Expected opponent");
    const canary = { suit: "honor" as const, rank: 98765 };
    const face = { suit: "pin" as const, rank: 1 };
    const view = {
      ...source.view,
      slots: {
        ...source.view.slots,
        [position]: {
          ...slot,
          player: {
            ...slot.player,
            melds: [
              {
                type: "kan" as const,
                concealed: true,
                tiles: [canary, face, face, canary],
              },
            ],
          },
        },
      },
    };
    const projected = projectDisplaySnapshot({ ...source, view });
    expect(JSON.stringify(projected)).not.toContain("98765");
    const opponent = projected.slots.find((p) => p.position === position)!;
    if (opponent.kind !== "seated")
      throw new Error("Expected projected opponent");
    expect(opponent.melds[0].tiles).toEqual([
      null,
      { suit: "pin", rank: 1, red: false },
      { suit: "pin", rank: 1, red: false },
      null,
    ]);
  });

  it("withholds playing ura/result and only copies a committed result", () => {
    const source = input();
    const view = {
      ...source.view,
      dora: {
        ...source.view.dora,
        uraIndicators: [{ suit: "honor" as const, rank: 7 }],
      },
      result: {
        players: [
          {
            playerId: "p0" as const,
            name: "Self",
            rank: 1,
            rawScore: 50000,
            uma: 30,
            bonus: 0,
            soshiiTotal: 50030,
          },
        ],
      },
    };
    expect(projectDisplaySnapshot({ ...source, view })).toMatchObject({
      dora: { uraIndicators: [] },
      result: null,
    });
    expect(
      projectDisplaySnapshot({ ...source, view, phase: "roundEnd" }).result,
    ).toBeNull();
    const ended = projectDisplaySnapshot({ ...source, view, phase: "gameEnd" });
    expect(ended.result).toEqual(view.result);
    expect(ended.result).not.toBe(view.result);
    expect(ended.dora.uraIndicators).toHaveLength(1);
  });

  it("uses existing capability/forbidden/locked results without inventing legal moves", () => {
    const source = input();
    const self = source.view.slots.self;
    if (self.kind !== "seated" || !self.player.hand)
      throw new Error("Expected own hand");
    const first = self.player.hand[0];
    const second = self.player.hand.find(
      (value) => value.suit !== first.suit || value.rank !== first.rank,
    )!;
    const pending: Pending = {
      kind: "humanDiscard",
      playerId: "p0",
      canTsumo: true,
      canKita: true,
      canRiichi: true,
      riichiTiles: [{ ...first, isRed: false }],
      ankanTiles: [{ ...second, isRed: false }],
      kakanTiles: [],
      forbiddenDiscards: [{ ...second, isRed: false }],
      locked: false,
    };
    const options = projectDisplaySnapshot({ ...source, pending }).options;
    expect(options.map(({ action }) => action)).toEqual(
      expect.arrayContaining(["tsumo", "kita", "riichi", "ankan"]),
    );
    expect(
      options
        .filter((option) => option.action === "riichi")
        .every(
          (option) =>
            "tile" in option &&
            option.tile.suit === first.suit &&
            option.tile.rank === first.rank,
        ),
    ).toBe(true);
    expect(
      options
        .filter((option) => option.action === "discard")
        .some(
          (option) =>
            "tile" in option &&
            option.tile.suit === second.suit &&
            option.tile.rank === second.rank,
        ),
    ).toBe(false);
    const locked = projectDisplaySnapshot({
      ...source,
      pending: { ...pending, locked: true },
    }).options;
    expect(locked.map(({ action }) => action)).toEqual([
      "tsumo",
      "kita",
      "tsumogiri",
      "ankan",
    ]);
    expect(
      projectDisplaySnapshot({
        ...source,
        pending: { ...pending, playerId: "p3" },
      }).options,
    ).toEqual([]);
  });

  it("projects reaction and host-only progression options", () => {
    const source = input();
    const pending: Pending = {
      kind: "humanReact",
      from: "west",
      tile: { suit: "honor", rank: 1, isRed: false },
      canRon: true,
      canPon: false,
      canKan: true,
    };
    expect(
      projectDisplaySnapshot({ ...source, pending }).options.map(
        ({ action }) => action,
      ),
    ).toEqual(["ron", "kan", "passRon"]);
    expect(
      projectDisplaySnapshot({ ...source, phase: "roundEnd" }).options.map(
        ({ action }) => action,
      ),
    ).toEqual(["nextRound"]);
    expect(
      projectDisplaySnapshot({ ...source, phase: "gameEnd" }).options.map(
        ({ action }) => action,
      ),
    ).toEqual(["newGame"]);
    expect(
      projectDisplaySnapshot({ ...source, phase: "gameEnd", isHost: false })
        .options,
    ).toEqual([]);
  });

  it("unsupported source yields no DTO, while invalid local metadata fails closed", () => {
    const source = input();
    expect(
      createDisplayEnvelope({ ...source, displaySource: undefined }, "restore"),
    ).toBeNull();
    for (const revision of [-1, 0.1, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() =>
        createDisplayEnvelope(
          {
            ...source,
            displaySource: {
              kind: "local",
              sessionId: "local-test",
              generation: 1,
              revision,
            },
          },
          "live",
        ),
      ).toThrow(/source/);
    }
  });
});
