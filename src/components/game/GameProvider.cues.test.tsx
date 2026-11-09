import { act, render, waitFor } from "@testing-library/react";
import { StrictMode, useLayoutEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DisplayPort } from "@/domain/display/displayPort";
import {
  createDisplayEnvelope,
  type DisplayEnvelope,
} from "@/domain/display/displaySnapshot";
import { createGame } from "@/domain/game/engine";
import { restoreWebLocks, stubWebLocks } from "@/test/webLocksStub";
import { walkToGameEnd } from "./finishedGameFixture";
import { type GameContextValue, GameProvider, useGame } from "./GameProvider";
import { replayJournal, saveJournal } from "./gamePersistence";
import { useLocalDisplayPort } from "./useLocalDisplayPort";

let latest: GameContextValue;
const originalLocks = Object.getOwnPropertyDescriptor(navigator, "locks");
function Probe() {
  const game = useGame();
  useLayoutEffect(() => {
    latest = game;
  });
  return null;
}
function Host({ factory }: { factory: () => DisplayPort }) {
  useLocalDisplayPort(factory, (failure) => {
    throw failure.error;
  });
  return <Probe />;
}
const tile = () => {
  const self = latest.view.slots.self;
  if (self.kind !== "seated") throw Error("self must be seated");
  return self.player.hand![0];
};

describe("GameProvider committed cues", () => {
  beforeEach(() => {
    stubWebLocks();
    window.sessionStorage.clear();
    window.localStorage.clear();
    window.history.replaceState(null, "", "/game?seed=1");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    restoreWebLocks(originalLocks);
    window.history.replaceState(null, "", "/");
  });
  it("attaches the full event list to exactly the adopted revision in StrictMode", () => {
    const ui = render(
      <StrictMode>
        <GameProvider>
          <Probe />
        </GameProvider>
      </StrictMode>,
    );
    expect(createDisplayEnvelope(latest, "restore")!.cues).toEqual([]);
    const old = latest;
    act(() => {
      old.controls.discard(tile());
      old.controls.discard(tile());
    });
    const frame = createDisplayEnvelope(latest, "live")!;
    expect(frame.revision).toBe(1);
    expect(frame.cues[0]).toMatchObject({ actorId: "p0", kind: "discard" });
    expect(frame.cues.some((c) => c.actorId !== "p0")).toBe(true);
    expect(new Set(frame.cues.map((c) => c.id)).size).toBe(frame.cues.length);
    for (const cue of frame.cues)
      expect(cue).toMatchObject({
        sessionId: frame.sessionId,
        generation: frame.generation,
        revision: frame.revision,
        roundKey: frame.roundKey,
      });
    act(() => old.controls.kita());
    expect(createDisplayEnvelope(latest, "live")).toEqual(frame);
    act(() => latest.controls.nextRound()); // no-op in a playing round
    expect(createDisplayEnvelope(latest, "live")).toEqual(frame);
    ui.unmount();
    act(() => old.controls.newGame());
    expect(old.readDisplaySource?.()).toBeUndefined();
  });
  it("suppresses journal replay and new-game initialization cues", () => {
    const ui = render(
      <GameProvider>
        <Probe />
      </GameProvider>,
    );
    act(() => latest.controls.discard(tile()));
    const source = latest.displaySource!;
    const view = latest.view;
    ui.unmount();
    render(
      <GameProvider>
        <Probe />
      </GameProvider>,
    );
    expect(latest.view).toEqual(view);
    expect(createDisplayEnvelope(latest, "live")!.cues).toEqual([]);
    expect(latest.displaySource!.generation).toBeGreaterThan(source.generation);
    act(() => latest.controls.newGame());
    expect(latest.displaySource!.revision).toBe(0);
    expect(createDisplayEnvelope(latest, "live")!.cues).toEqual([]);
  });
  it("works for injected engine state without a persistence journal", () => {
    render(
      <GameProvider initialGame={createGame({ seed: 1 })}>
        <Probe />
      </GameProvider>,
    );
    act(() => latest.controls.kita());
    expect(
      createDisplayEnvelope(latest, "live")!.cues.map((c) => c.kind),
    ).toEqual(["kita", "draw"]);
    expect(createDisplayEnvelope(latest, "restore")!.cues).toEqual([]);
  });

  it("sends one event list per revision through the real host, ignoring rerender and no-op", () => {
    const frames: DisplayEnvelope[] = [];
    const factory = () => ({
      publish: (frame: DisplayEnvelope) => {
        frames.push(frame);
      },
      onIntent: () => () => {},
      dispose: () => {},
    });
    const ui = render(
      <StrictMode>
        <GameProvider>
          <Host factory={factory} />
        </GameProvider>
      </StrictMode>,
    );
    expect(frames.length).toBe(2); // two fresh owned ports in StrictMode
    expect(
      frames.every((f) => f.mode === "restore" && f.cues!.length === 0),
    ).toBe(true);
    const count = frames.length;
    act(() => latest.controls.kita());
    expect(frames).toHaveLength(count + 1);
    expect(frames.at(-1)!.cues!.map((c) => c.kind)).toEqual(["kita", "draw"]);
    ui.rerender(
      <StrictMode>
        <GameProvider>
          <Host factory={factory} />
        </GameProvider>
      </StrictMode>,
    );
    act(() => latest.controls.nextRound());
    expect(frames).toHaveLength(count + 1);
    const retained = latest;
    ui.unmount();
    act(() => retained.controls.kita());
    expect(retained.readDisplaySource!()).toBeUndefined();
    expect(frames).toHaveLength(count + 1);
  });

  it("keeps terminal cues on the same revision when history persistence rerenders the provider", async () => {
    const fixture = walkToGameEnd(2024);
    const journal = {
      ...fixture.journal,
      actions: fixture.journal.actions.slice(0, -1),
    };
    const state = replayJournal(journal);
    saveJournal(window.sessionStorage, journal);
    window.history.replaceState(null, "", "/game");
    let release!: () => void;
    const lock = new Promise<void>((resolve) => {
      release = resolve;
    });
    stubWebLocks(async (_name, _options, callback) => {
      await lock;
      return callback();
    });
    const frames: DisplayEnvelope[] = [];
    const factory = () => ({
      publish: (frame: DisplayEnvelope) => {
        frames.push(frame);
      },
      onIntent: () => () => {},
      dispose: () => {},
    });
    render(
      <GameProvider>
        <Host factory={factory} />
      </GameProvider>,
    );
    const action = fixture.journal.actions.at(-1)!;
    act(() => {
      if (action.type === "discard") latest.controls.discard(action.tile);
      else if (action.type === "passRon") latest.controls.passRon();
      else
        throw Error(
          `unexpected fixture terminal action: ${action.type}, ${state.phase}`,
        );
    });
    expect(latest.phase).toBe("gameEnd");
    expect(latest.historySaveStatus).toBe("pending");
    const before = createDisplayEnvelope(latest, "live")!;
    const count = frames.length;
    expect(before.cues.some((c) => c.kind === "round-end")).toBe(true);
    release();
    await waitFor(() => expect(latest.historySaveStatus).toBe("saved"));
    expect(createDisplayEnvelope(latest, "live")).toEqual(before);
    expect(frames).toHaveLength(count);
  });

  it("publishes nothing for an engine exception and detaches recording before the next provider", () => {
    const broken = createGame({ seed: 1 });
    broken.hand!.wall.draw = () => {
      throw Error("draw failure");
    };
    const ui = render(
      <GameProvider initialGame={broken}>
        <Probe />
      </GameProvider>,
    );
    const original = latest.displaySource;
    expect(() =>
      act(() => latest.controls.discard({ suit: "honor", rank: 4 })),
    ).toThrow("draw failure");
    expect(latest.displaySource).toBe(original);
    expect(createDisplayEnvelope(latest, "live")!.cues).toEqual([]);
    ui.unmount();
    render(
      <GameProvider initialGame={createGame({ seed: 1 })}>
        <Probe />
      </GameProvider>,
    );
    act(() => latest.controls.kita());
    expect(
      createDisplayEnvelope(latest, "live")!.cues.map((c) => c.kind),
    ).toEqual(["kita", "draw"]);
  });
});
