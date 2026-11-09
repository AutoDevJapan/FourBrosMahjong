import { describe, expect, it } from "vitest";
import {
  createGame,
  declareKita,
  declarePon,
  type EngineState,
} from "@/domain/game/engine";
import { selectView } from "@/domain/game/gameView";
import { capturePresentationEvents } from "@/domain/game/presentationEvents";
import { createTile } from "@/domain/tiles/tile";
import { createDisplayEnvelope } from "./displaySnapshot";
import { advanceDisplaySource, newLocalDisplaySource } from "./displaySource";
import { commitPresentation } from "./presentationCues";

function input(state: EngineState) {
  return {
    playerId: "p0" as const,
    isHost: true,
    view: selectView(state),
    pending: state.pending,
    phase: state.phase,
    displaySource: newLocalDisplaySource(),
  };
}

describe("public presentation DTO", () => {
  it("binds scalar events to exactly one source and excludes nested private fields", () => {
    const state = createGame({ seed: 1 });
    const captured = capturePresentationEvents(state, () => declareKita(state));
    const source = advanceDisplaySource(newLocalDisplaySource());
    const presentation = commitPresentation(
      source,
      captured.state.roundsPlayed,
      captured,
    );
    const dirty = {
      ...presentation,
      engine: "PRIVATE",
      events: presentation.events.map((e) => ({
        ...e,
        tile: "PRIVATE",
        seed: "PRIVATE",
      })),
    };
    const base = {
      ...input(captured.state),
      displaySource: source,
      presentation: dirty,
    };
    const frame = createDisplayEnvelope(base, "live")!;
    expect(frame.cues.map((c) => c.kind)).toEqual(["kita", "draw"]);
    expect(JSON.stringify(frame)).not.toContain("PRIVATE");
    expect(createDisplayEnvelope(base, "restore")!.cues).toEqual([]);
    expect(() =>
      createDisplayEnvelope(
        { ...base, displaySource: advanceDisplaySource(source) },
        "live",
      ),
    ).toThrow(/presentation/i);
    expect(Object.isFrozen(frame.cues[0])).toBe(true);
  });

  it("explicitly signals an incomplete event batch while still publishing the adopted snapshot", () => {
    const state = createGame({ seed: 1 });
    const captured = capturePresentationEvents(
      state,
      () => declareKita(state),
      1,
    );
    const source = advanceDisplaySource(newLocalDisplaySource());
    const frame = createDisplayEnvelope(
      {
        ...input(captured.state),
        displaySource: source,
        presentation: commitPresentation(source, 0, captured),
      },
      "live",
    )!;
    expect(frame.cueStatus).toEqual({ overflow: true, dropped: 1 });
    expect(frame.cues).toHaveLength(1);
    expect(frame.snapshot.slots[0]).toMatchObject({ kitaCount: 1 });
  });

  it("preserves DOM hand ordering and marks only the self drawn occurrence, even with equal tile objects", () => {
    const state = createGame({ seed: 1 });
    const shared = createTile("pin", 5);
    state.hand!.hands.east = Array.from({ length: 13 }, () => shared);
    state.hand!.drawn = { tile: shared, source: "live" };
    const view = selectView(state);
    expect(view.slots.self).toMatchObject({ player: { drawnIndex: 13 } });
    const frame = createDisplayEnvelope(input(state), "live")!;
    const self = frame.snapshot.slots[0];
    expect(self).toMatchObject({ drawnIndex: 13 });
    for (const slot of frame.snapshot.slots.slice(1))
      expect(slot).not.toHaveProperty("drawnIndex");
    state.hand!.drawn = null;
    expect(
      createDisplayEnvelope(input(state), "live")!.snapshot.slots[0],
    ).toMatchObject({ drawnIndex: null });
    expect(
      capturePresentationEvents(state, () => declarePon(state)).events,
    ).toEqual([]);
  });
});
