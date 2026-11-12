import { describe, expect, it } from "vitest";
import {
  advanceEngine,
  firstLegalDiscard,
} from "./__testing__/engine-fixtures";
import { CHARACTER_PLAYER_IDS } from "./characters";
import {
  createGame,
  declareKita,
  declarePon,
  discard,
  EngineStateConsumedError,
  passRon,
  proceedToNextRound,
} from "./engine";
import { selectView } from "./gameView";
import {
  capturePresentationEvents,
  MAX_PRESENTATION_EVENTS,
} from "./presentationEvents";

describe("committed engine presentation events", () => {
  it("records the real synchronous CPU steps in order without retaining engine or tile data", () => {
    const state = createGame({ seed: 1 });
    const before = state.hand!.discards.east.length;
    const result = capturePresentationEvents(state, () =>
      discard(state, state.hand!.drawn!.tile),
    );
    expect(result.state).not.toBe(state);
    expect(result.events[0]).toEqual({
      seq: 1,
      actorId: "p0",
      kind: "discard",
      roundKey: "round-0",
    });
    expect(
      result.events.some((e) => e.actorId !== "p0" && e.kind === "draw"),
    ).toBe(true);
    expect(
      result.events.some((e) => e.actorId !== "p0" && e.kind === "discard"),
    ).toBe(true);
    expect(state.hand!.discards.east.length).toBeGreaterThan(before); // input was mutated
    expect(result.events.map((e) => e.seq)).toEqual(
      result.events.map((_, i) => i + 1),
    );
    for (const event of result.events) {
      expect(Object.keys(event).sort()).toEqual([
        "actorId",
        "kind",
        "roundKey",
        "seq",
      ]);
      expect(CHARACTER_PLAYER_IDS).toContain(event.actorId);
      expect(
        Object.values(event).every(
          (v) => typeof v === "string" || typeof v === "number",
        ),
      ).toBe(true);
      expect(Object.isFrozen(event)).toBe(true);
    }
    expect(Object.isFrozen(result.events)).toBe(true);
    expect(result.overflow).toBe(false);
  });

  it("records successful explicit North extraction before its replacement draw", () => {
    const state = createGame({ seed: 1 });
    const result = capturePresentationEvents(state, () => declareKita(state));
    expect(result.events.map((e) => [e.kind, e.actorId])).toEqual([
      ["kita", "p0"],
      ["draw", "p0"],
    ]);
    expect(result.state.hand!.kita.east).toBe(1);
  });

  it("resets on no-op and exceptions, rejects capture reentry and detaches on exit", () => {
    let state = createGame({ seed: 1 });
    expect(
      capturePresentationEvents(state, () => declarePon(state)).events,
    ).toEqual([]);
    expect(() =>
      capturePresentationEvents(state, () => {
        capturePresentationEvents(state, () => declarePon(state));
        return state;
      }),
    ).toThrow(/nested/i);
    const used = state;
    state = discard(state, state.hand!.drawn!.tile); // recording is off by default
    expect(() =>
      capturePresentationEvents(used, () => declarePon(used)),
    ).toThrow(EngineStateConsumedError);
    const next = capturePresentationEvents(
      state,
      () => advanceEngine(state, "passive", firstLegalDiscard).next,
    );
    expect(next.events.length).toBeGreaterThan(0);
    expect(next.events[0].seq).toBe(1);
  });

  it("reports bounded overflow without interrupting or altering engine decisions", () => {
    const state = createGame({ seed: 1 });
    const result = capturePresentationEvents(
      state,
      () => discard(state, state.hand!.drawn!.tile),
      1,
    );
    const baseline = createGame({ seed: 1 });
    const after = discard(baseline, baseline.hand!.drawn!.tile);
    expect(selectView(result.state)).toEqual(selectView(after));
    expect(result.events).toHaveLength(1);
    expect(result.overflow).toBe(true);
    expect(result.dropped).toBeGreaterThan(0);
    expect(MAX_PRESENTATION_EVENTS).toBe(1024);
  });

  it("rejects multiple public actions in one capture before the second mutates state", () => {
    const state = createGame({ seed: 1 });
    let next = state;
    expect(() =>
      capturePresentationEvents(state, () => {
        next = declareKita(state);
        return declareKita(next);
      }),
    ).toThrow(/one public action/);
    expect(next.hand!.kita.east).toBe(1);
    expect(
      capturePresentationEvents(next, () => declareKita(next)).events.map(
        (e) => e.kind,
      ),
    ).toEqual(["kita", "draw"]);
  });

  it("cleans up partial records after the actual engine throws", () => {
    const state = createGame({ seed: 1 });
    state.hand!.wall.draw = () => {
      throw new Error("draw failure");
    };
    expect(() =>
      capturePresentationEvents(state, () =>
        discard(state, state.hand!.drawn!.tile),
      ),
    ).toThrow("draw failure");
    const fresh = createGame({ seed: 1 });
    expect(
      capturePresentationEvents(fresh, () => declareKita(fresh)).events.map(
        (e) => e.kind,
      ),
    ).toEqual(["kita", "draw"]);
  });

  it.each([7, 27])(
    "captures every CPU call and committed riichi with real seed %s",
    (seed) => {
      let state = createGame({ seed });
      const seen = new Set<string>();
      for (let n = 0; state.phase !== "gameEnd" && n < 3000; n++) {
        const result = capturePresentationEvents(state, () => {
          if (state.phase === "roundEnd") return proceedToNextRound(state);
          if (state.pending?.kind === "humanReact") return passRon(state);
          if (state.pending?.kind === "humanDiscard") {
            const pool = state.hand!.hands[state.hand!.turn];
            return discard(state, pool[0]);
          }
          throw Error("missing input");
        });
        for (const event of result.events) {
          if (event.actorId !== "p0") seen.add(event.kind);
          if (event.kind === "kan") {
            const following = result.events[event.seq];
            expect(following?.kind).toMatch(/draw|draw-round/);
          }
        }
        expect(result.overflow).toBe(false);
        state = result.state;
      }
      expect(state.phase).toBe("gameEnd");
      for (const kind of seed === 7 ? ["pon", "kan"] : ["riichi", "kan"])
        expect(seen.has(kind), kind).toBe(true);
    },
  );

  it("captures a whole CPU round while the human is benched, with bounded continuous ordering", () => {
    const base = createGame({ seed: 27 });
    const state = {
      ...base,
      phase: "roundEnd" as const,
      nextRoundState: { ...base.round, roundNumber: 2 as const },
    };
    const result = capturePresentationEvents(state, () =>
      proceedToNextRound(state),
    );
    expect(result.state.phase).toMatch(/roundEnd|gameEnd/);
    expect(result.events.slice(0, 3).map((e) => [e.kind, e.actorId])).toEqual([
      ["deal", "p1"],
      ["deal", "p2"],
      ["deal", "p3"],
    ]);
    expect(result.events.some((e) => e.actorId === "p0")).toBe(false);
    expect(result.events.every((e) => e.roundKey === "round-1")).toBe(true);
    expect(result.events.map((e) => e.seq)).toEqual(
      result.events.map((_, i) => i + 1),
    );
    expect(result.events.length).toBeGreaterThan(10);
    expect(result.overflow).toBe(false);
    expect(result.events.length).toBeLessThanOrEqual(MAX_PRESENTATION_EVENTS);
  });

  it("keeps real hand and CPU bench progression identical with recording enabled", () => {
    let observed = createGame({ seed: 2024 });
    let plain = createGame({ seed: 2024 });
    const kinds = new Set<string>();
    const actors = new Set<string>();
    const rounds = new Set<string>();
    for (let n = 0; observed.phase !== "gameEnd" && n < 3000; n++) {
      const result = capturePresentationEvents(
        observed,
        () => advanceEngine(observed, "kanFirst", firstLegalDiscard).next,
      );
      observed = result.state;
      plain = advanceEngine(plain, "kanFirst", firstLegalDiscard).next;
      expect(selectView(observed)).toEqual(selectView(plain));
      expect(observed.pending).toEqual(plain.pending);
      expect(observed.hand!.wall.liveWall).toEqual(plain.hand!.wall.liveWall);
      expect(observed.hand!.wall.deadWall).toEqual(plain.hand!.wall.deadWall);
      expect(result.overflow).toBe(false);
      for (const e of result.events) {
        kinds.add(e.kind);
        actors.add(e.actorId);
        rounds.add(e.roundKey);
      }
    }
    expect(observed.phase).toBe("gameEnd");
    for (const kind of [
      "deal",
      "draw",
      "discard",
      "riichi",
      "kita",
      "draw-round",
      "round-end",
    ])
      expect(kinds.has(kind), kind).toBe(true);
    expect([...actors].sort()).toEqual([...CHARACTER_PLAYER_IDS]);
    expect(rounds.size).toBeGreaterThan(1);
  });
});
