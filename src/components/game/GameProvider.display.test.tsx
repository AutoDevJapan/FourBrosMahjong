import { act, render, waitFor } from "@testing-library/react";
import { StrictMode, useLayoutEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  connectDisplayPort,
  type DisplayIntent,
  type DisplayPort,
  type IntentReceipt,
} from "@/domain/display/displayPort";
import {
  createDisplayEnvelope,
  type DisplayEnvelope,
} from "@/domain/display/displaySnapshot";
import { createGame } from "@/domain/game/engine";
import { restoreWebLocks, stubWebLocks } from "@/test/webLocksStub";
import { walkToGameEnd } from "./finishedGameFixture";
import { type GameContextValue, GameProvider, useGame } from "./GameProvider";
import { loadJournal, saveJournal } from "./gamePersistence";

let latest: GameContextValue;
const originalLocks = Object.getOwnPropertyDescriptor(navigator, "locks");

function Probe() {
  const value = useGame();
  useLayoutEffect(() => {
    latest = value;
  });
  return null;
}

function ownTile() {
  const own = latest.view.slots.self;
  if (own.kind !== "seated" || !own.player.hand?.[0])
    throw new Error("Expected self hand");
  return own.player.hand[0];
}

function fakeConnection() {
  const frames: DisplayEnvelope[] = [];
  let listener: ((value: unknown) => IntentReceipt) | null = null;
  const port: DisplayPort = {
    publish: (frame) => {
      frames.push(frame);
    },
    onIntent: (next) => {
      listener = next;
      return () => {
        listener = null;
      };
    },
    dispose: vi.fn(),
  };
  const binding = connectDisplayPort(port, () => latest);
  binding.refresh();
  let id = 0;
  const intent = (kind: DisplayIntent["kind"] = "select"): DisplayIntent => {
    const frame = frames.at(-1)!;
    return {
      protocol: frame.protocol,
      version: frame.version,
      sessionId: frame.sessionId,
      revision: frame.revision,
      kind,
      requestId: `request-${id++}`,
      optionId: frame.snapshot.options.find(
        (option) => option.action === "discard",
      )!.id,
    };
  };
  return {
    binding,
    frames,
    intent,
    receive: (value: unknown) => listener!(value),
  };
}

describe("GameProvider local display revisions (#1177)", () => {
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

  it("increments only once for accepted same-tick actions, with synchronous metadata", () => {
    render(
      <StrictMode>
        <GameProvider>
          <Probe />
        </GameProvider>
      </StrictMode>,
    );
    const old = latest;
    const initial = old.displaySource!;
    const tile = ownTile();
    act(() => {
      old.controls.discard(tile);
      expect(old.readDisplaySource?.()).toEqual({ ...initial, revision: 1 });
      old.controls.discard(tile);
      expect(old.readDisplaySource?.()?.revision).toBe(1);
    });
    expect(latest.displaySource?.revision).toBe(1);
    expect(loadJournal(window.sessionStorage)?.actions).toHaveLength(1);
    expect(initial.revision).toBe(0);
  });

  it("does not advance for engine no-op, rerender, or failed secure new-game setup", () => {
    const ui = render(
      <GameProvider>
        <Probe />
      </GameProvider>,
    );
    const initial = latest.displaySource;
    act(() => latest.controls.pon());
    expect(latest.displaySource).toBe(initial);
    ui.rerender(
      <GameProvider>
        <Probe />
      </GameProvider>,
    );
    expect(latest.displaySource).toBe(initial);
    vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(() => {
      throw new Error("blocked");
    });
    act(() => latest.controls.newGame());
    expect(latest.seedGenerationError).toBe(true);
    expect(latest.displaySource).toBe(initial);
  });

  it("restores the journal under a fresh session and invalidates the unmounted source", () => {
    const first = render(
      <GameProvider>
        <Probe />
      </GameProvider>,
    );
    const old = latest;
    act(() => old.controls.discard(ownTile()));
    const view = latest.view;
    first.unmount();
    expect(old.readDisplaySource?.()).toBeUndefined();
    render(
      <GameProvider>
        <Probe />
      </GameProvider>,
    );
    expect(latest.view).toEqual(view);
    expect(latest.displaySource?.sessionId).not.toBe(
      old.displaySource?.sessionId,
    );
    expect(latest.displaySource?.revision).toBe(0);
    expect(createDisplayEnvelope(latest, "restore")?.mode).toBe("restore");
    expect(loadJournal(window.sessionStorage)?.actions).toHaveLength(1);
  });

  it("new game separates the source, including with no persistable initial journal", () => {
    render(
      <GameProvider initialGame={createGame({ seed: 1 })}>
        <Probe />
      </GameProvider>,
    );
    const initial = latest.displaySource!;
    act(() => latest.controls.discard(ownTile()));
    expect(latest.displaySource?.revision).toBe(1);
    expect(latest.sessionSaveStatus).toBe("idle");
    act(() => latest.controls.newGame());
    expect(latest.displaySource?.sessionId).not.toBe(initial.sessionId);
    expect(latest.displaySource?.revision).toBe(0);
  });

  it("history-save completion does not create a display revision", async () => {
    const fixture = walkToGameEnd(2024);
    window.history.replaceState(null, "", "/game");
    saveJournal(window.sessionStorage, fixture.journal);
    render(
      <GameProvider>
        <Probe />
      </GameProvider>,
    );
    const initial = latest.displaySource;
    await waitFor(() => expect(latest.historySaveStatus).toBe("saved"));
    expect(latest.displaySource).toBe(initial);
    expect(latest.displaySource?.revision).toBe(0);
  });

  it("rejects the published renderer intent immediately after a competing 2D control", async () => {
    render(
      <GameProvider>
        <Probe />
      </GameProvider>,
    );
    const connection = fakeConnection();
    const old = connection.intent();
    act(() => {
      latest.controls.discard(ownTile());
      expect(connection.receive(old)).toMatchObject({ reason: "stale" });
    });
    expect(loadJournal(window.sessionStorage)?.actions).toHaveLength(1);
    expect(connection.binding.refresh()).toBe("published");
    expect(connection.frames.at(-1)?.mode).toBe("live");
    await connection.binding.dispose();
  });

  it("select/confirm commits through the real engine once and rejects a retained callback after unmount", async () => {
    const ui = render(
      <GameProvider>
        <Probe />
      </GameProvider>,
    );
    const connection = fakeConnection();
    const selected = connection.intent();
    expect(connection.receive(selected)).toEqual({
      status: "selected",
    });
    act(() => {
      expect(connection.receive(connection.intent("confirm"))).toEqual({
        status: "dispatched",
      });
      expect(connection.receive(connection.intent("confirm"))).toMatchObject({
        reason: "stale",
      });
    });
    expect(loadJournal(window.sessionStorage)?.actions).toHaveLength(1);
    connection.binding.refresh();
    const stale = { ...selected, revision: latest.displaySource!.revision };
    ui.unmount();
    expect(connection.receive(stale)).toMatchObject({ reason: "stale" });
    await connection.binding.dispose();
  });
});
