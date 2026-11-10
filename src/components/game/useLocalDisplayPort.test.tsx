import { act, render, waitFor } from "@testing-library/react";
import { StrictMode, useLayoutEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DisplayIntent,
  DisplayPort,
  IntentReceipt,
} from "@/domain/display/displayPort";
import type { DisplayEnvelope } from "@/domain/display/displaySnapshot";
import { createDisplayEnvelope } from "@/domain/display/displaySnapshot";
import { restoreWebLocks, stubWebLocks } from "@/test/webLocksStub";
import { walkToGameEnd } from "./finishedGameFixture";
import {
  GameContext,
  type GameContextValue,
  GameProvider,
  useGame,
} from "./GameProvider";
import { loadJournal, saveJournal } from "./gamePersistence";
import {
  type DisplayHostFailure,
  useLocalDisplayPort,
} from "./useLocalDisplayPort";

let latest: GameContextValue;
const originalLocks = Object.getOwnPropertyDescriptor(navigator, "locks");

function transportFactory() {
  const ports: Array<{
    port: DisplayPort;
    frames: DisplayEnvelope[];
    listeners: Array<(value: unknown) => IntentReceipt>;
    unsubscribe: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  }> = [];
  const factory = vi.fn(() => {
    const frames: DisplayEnvelope[] = [];
    const listeners: Array<(value: unknown) => IntentReceipt> = [];
    const unsubscribe = vi.fn();
    const dispose = vi.fn();
    const port: DisplayPort = {
      publish: vi.fn((frame) => {
        frames.push(frame);
      }),
      onIntent: vi.fn((listener) => {
        listeners.push(listener);
        return unsubscribe;
      }),
      dispose,
    };
    ports.push({ port, frames, listeners, unsubscribe, dispose });
    return port;
  });
  return { factory, ports };
}

function Probe({
  factory,
  onError,
  onLayoutCleanup,
  onLayoutSetup,
}: {
  factory: (() => DisplayPort) | null;
  onError: (failure: DisplayHostFailure) => void;
  onLayoutCleanup?: () => void;
  onLayoutSetup?: () => void;
}) {
  const context = useGame();
  useLayoutEffect(() => {
    latest = context;
  });
  useLocalDisplayPort(factory, onError);
  useLayoutEffect(() => {
    onLayoutSetup?.();
  }, [factory, onLayoutSetup]);
  useLayoutEffect(() => onLayoutCleanup, [onLayoutCleanup]);
  return null;
}

function intent(
  frame: DisplayEnvelope,
  requestId = "request",
  kind: DisplayIntent["kind"] = "select",
): DisplayIntent {
  return {
    protocol: frame.protocol,
    version: frame.version,
    sessionId: frame.sessionId,
    revision: frame.revision,
    optionId: frame.snapshot.options.find(
      (option) => option.action === "discard",
    )!.id,
    requestId,
    kind,
  };
}

function ownTile() {
  const self = latest.view.slots.self;
  if (self.kind !== "seated" || !self.player.hand?.[0])
    throw new Error("Expected self hand");
  return self.player.hand[0];
}

describe("React local display host (#1177)", () => {
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

  it("does not allocate or subscribe a renderer for an unsupported provider", () => {
    function UnsupportedHost() {
      const context = useGame();
      return (
        <GameContext.Provider
          value={{
            ...context,
            displaySource: undefined,
            readDisplaySource: undefined,
          }}
        >
          <Probe factory={factory} onError={onError} />
        </GameContext.Provider>
      );
    }
    const { factory } = transportFactory();
    const onError = vi.fn();
    render(
      <GameProvider>
        <UnsupportedHost />
      </GameProvider>,
    );
    expect(factory).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("publishes restore on both StrictMode setups using fresh ports, with no same-revision replay", () => {
    const { factory, ports } = transportFactory();
    const onError = vi.fn();
    const tree = () => (
      <StrictMode>
        <GameProvider>
          <Probe factory={factory} onError={onError} />
        </GameProvider>
      </StrictMode>
    );
    const ui = render(tree());
    expect(factory).toHaveBeenCalledTimes(2);
    expect(ports[0].port).not.toBe(ports[1].port);
    for (const port of ports) {
      expect(port.frames).toHaveLength(1);
      expect(port.frames[0].mode).toBe("restore");
      expect(port.frames[0].revision).toBe(0);
    }
    expect(ports[0].unsubscribe).toHaveBeenCalledTimes(1);
    expect(ports[0].dispose).toHaveBeenCalledTimes(1);
    expect(ports[0].listeners[0](intent(ports[0].frames[0]))).toMatchObject({
      reason: "closed",
    });
    ui.rerender(tree());
    expect(factory).toHaveBeenCalledTimes(2);
    expect(ports[1].frames).toHaveLength(1);
    act(() => latest.controls.discard(ownTile()));
    expect(ports[1].frames).toHaveLength(2);
    expect(ports[1].frames[1]).toMatchObject({ mode: "live", revision: 1 });
    expect(onError).not.toHaveBeenCalled();
  });

  it("rejects a retained intent in the same tick as a competing 2D commit", () => {
    const { factory, ports } = transportFactory();
    render(
      <GameProvider>
        <Probe factory={factory} onError={vi.fn()} />
      </GameProvider>,
    );
    const old = intent(ports[0].frames[0]);
    act(() => {
      latest.controls.discard(ownTile());
      expect(ports[0].listeners[0](old)).toMatchObject({ reason: "stale" });
    });
    expect(loadJournal(window.sessionStorage)?.actions).toHaveLength(1);
    expect(ports[0].frames.at(-1)).toMatchObject({ mode: "live", revision: 1 });
  });

  it("select/confirm uses real controls once, then publishes the committed frame", () => {
    const { factory, ports } = transportFactory();
    render(
      <GameProvider>
        <Probe factory={factory} onError={vi.fn()} />
      </GameProvider>,
    );
    const port = ports[0];
    const frame = port.frames[0];
    expect(port.listeners[0](intent(frame, "select"))).toEqual({
      status: "selected",
    });
    act(() => {
      expect(port.listeners[0](intent(frame, "confirm", "confirm"))).toEqual({
        status: "dispatched",
      });
      expect(
        port.listeners[0](intent(frame, "again", "confirm")),
      ).toMatchObject({ reason: "stale" });
    });
    expect(loadJournal(window.sessionStorage)?.actions).toHaveLength(1);
    expect(port.frames).toHaveLength(2);
    expect(port.frames[1]).toMatchObject({ revision: 1, mode: "live" });
    act(() => latest.controls.newGame());
    expect(port.frames[2]).toMatchObject({ revision: 0, mode: "restore" });
    expect(port.frames[2].sessionId).not.toBe(frame.sessionId);
  });

  it("closes synchronously when only the renderer child unmounts, before passive cleanup", () => {
    const { factory, ports } = transportFactory();
    const onError = vi.fn();
    const atLayoutCleanup = vi.fn(() => {
      expect(latest.readDisplaySource?.()).toBeDefined();
      expect(ports[0].listeners[0](intent(ports[0].frames[0]))).toMatchObject({
        reason: "closed",
      });
    });
    const tree = (show: boolean) => (
      <GameProvider>
        {show ? (
          <Probe
            factory={factory}
            onError={onError}
            onLayoutCleanup={atLayoutCleanup}
          />
        ) : null}
      </GameProvider>
    );
    const ui = render(tree(true));
    ui.rerender(tree(false));
    expect(atLayoutCleanup).toHaveBeenCalledTimes(1);
    expect(ports[0].unsubscribe).toHaveBeenCalledTimes(1);
    expect(ports[0].dispose).toHaveBeenCalledTimes(1);
    expect(loadJournal(window.sessionStorage)?.actions).toHaveLength(0);
    expect(onError).not.toHaveBeenCalled();
  });

  it("closes during the layout phase when disabled or replaced, then creates a fresh restore binding", () => {
    const original = transportFactory();
    const replacement = transportFactory();
    const onError = vi.fn();
    const atLayout = vi.fn();
    const tree = (factory: (() => DisplayPort) | null) => (
      <GameProvider>
        <Probe factory={factory} onError={onError} onLayoutSetup={atLayout} />
      </GameProvider>
    );
    const ui = render(tree(original.factory));
    const old = intent(original.ports[0].frames[0]);
    atLayout.mockImplementation(() => {
      expect(original.ports[0].listeners[0](old)).toMatchObject({
        reason: "closed",
      });
    });
    ui.rerender(tree(null));
    expect(original.ports[0].dispose).toHaveBeenCalledTimes(1);
    expect(latest.readDisplaySource?.()).toBeDefined();
    ui.rerender(tree(replacement.factory));
    expect(replacement.factory).toHaveBeenCalledTimes(1);
    expect(replacement.ports[0].frames[0]).toMatchObject({
      mode: "restore",
      revision: 0,
    });
    expect(original.factory).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it("invalidates Provider and retained callbacks synchronously on full unmount", () => {
    const { factory, ports } = transportFactory();
    const ui = render(
      <StrictMode>
        <GameProvider>
          <Probe factory={factory} onError={vi.fn()} />
        </GameProvider>
      </StrictMode>,
    );
    const port = ports[1];
    const old = intent(port.frames[0]);
    const read = latest.readDisplaySource!;
    ui.unmount();
    expect(read()).toBeUndefined();
    expect(port.listeners[0](old)).toMatchObject({ reason: "closed" });
    expect(port.dispose).toHaveBeenCalledTimes(1);
    expect(loadJournal(window.sessionStorage)?.actions).toHaveLength(0);
  });

  it("does not reconnect or replay snapshots for history-only context updates", async () => {
    const { factory, ports } = transportFactory();
    window.history.replaceState(null, "", "/game");
    saveJournal(window.sessionStorage, walkToGameEnd(2024).journal);
    render(
      <GameProvider>
        <Probe factory={factory} onError={vi.fn()} />
      </GameProvider>,
    );
    await waitFor(() => expect(latest.historySaveStatus).toBe("saved"));
    expect(factory).toHaveBeenCalledTimes(1);
    expect(ports[0].frames).toHaveLength(1);
    expect(ports[0].frames[0]).toMatchObject({ revision: 0, mode: "restore" });
  });

  it.each(["create", "connect", "publish"] as const)(
    "reports %s failure, disposes acquired resources and preserves 2D controls",
    (stage) => {
      const { factory, ports } = transportFactory();
      const failure = new Error(stage);
      const onError = vi.fn();
      const failingFactory = () => {
        if (stage === "create") throw failure;
        const port = factory();
        if (stage === "connect") {
          const subscribe = port.onIntent;
          port.onIntent = (listener) => {
            subscribe(listener);
            throw failure;
          };
        } else {
          port.publish = () => {
            throw failure;
          };
        }
        return port;
      };
      render(
        <GameProvider>
          <Probe factory={failingFactory} onError={onError} />
        </GameProvider>,
      );
      expect(onError).toHaveBeenCalledWith({ stage, error: failure });
      if (stage !== "create") {
        expect(ports[0].dispose).toHaveBeenCalledTimes(1);
        const frame = createDisplayEnvelope(latest, "restore")!;
        expect(ports[0].listeners[0](intent(frame))).toMatchObject({
          status: "rejected",
        });
        expect(loadJournal(window.sessionStorage)?.actions).toHaveLength(0);
      }
      act(() => latest.controls.discard(ownTile()));
      expect(loadJournal(window.sessionStorage)?.actions).toHaveLength(1);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(factory).toHaveBeenCalledTimes(stage === "create" ? 0 : 1);
    },
  );

  it("uses the latest reporter without reconnecting, and closes a failed later publication", () => {
    const { factory, ports } = transportFactory();
    const firstReporter = vi.fn();
    const latestReporter = vi.fn();
    const tree = (onError: (failure: DisplayHostFailure) => void) => (
      <GameProvider>
        <Probe factory={factory} onError={onError} />
      </GameProvider>
    );
    const ui = render(tree(firstReporter));
    ui.rerender(tree(latestReporter));
    expect(factory).toHaveBeenCalledTimes(1);
    expect(ports[0].frames).toHaveLength(1);
    const old = intent(ports[0].frames[0]);
    const failure = new Error("later publish failed");
    ports[0].port.publish = () => {
      throw failure;
    };
    act(() => latest.controls.discard(ownTile()));
    expect(latestReporter).toHaveBeenCalledWith({
      stage: "publish",
      error: failure,
    });
    expect(firstReporter).not.toHaveBeenCalled();
    expect(ports[0].listeners[0](old)).toMatchObject({ reason: "closed" });
    expect(ports[0].dispose).toHaveBeenCalledTimes(1);
    act(() => latest.controls.newGame());
    expect(latestReporter).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("reports unsubscribe and asynchronous disposal failures separately without reopening callbacks", async () => {
    const { factory, ports } = transportFactory();
    const onError = vi.fn();
    const unsubscribeError = new Error("unsubscribe failed");
    const disposeError = new Error("dispose failed");
    const configuredFactory = () => {
      const port = factory();
      ports[0].unsubscribe.mockImplementation(() => {
        throw unsubscribeError;
      });
      ports[0].dispose.mockRejectedValue(disposeError);
      return port;
    };
    const ui = render(
      <GameProvider>
        <Probe factory={configuredFactory} onError={onError} />
      </GameProvider>,
    );
    const old = intent(ports[0].frames[0]);
    ui.unmount();
    expect(ports[0].listeners[0](old)).toMatchObject({ reason: "closed" });
    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith({
        stage: "dispose",
        error: disposeError,
      }),
    );
    expect(onError).toHaveBeenCalledWith({
      stage: "unsubscribe",
      error: unsubscribeError,
    });
    expect(onError).toHaveBeenCalledTimes(2);
    expect(ports[0].dispose).toHaveBeenCalledTimes(1);
  });

  it("keeps reporter failures observable without tearing down the existing 2D provider", () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = new Error("factory failed");
    const reportingError = new Error("reporter failed");
    const factory = () => {
      throw failure;
    };
    const onError = () => {
      throw reportingError;
    };
    render(
      <GameProvider>
        <Probe factory={factory} onError={onError} />
      </GameProvider>,
    );
    expect(errorLog).toHaveBeenCalledWith(
      "Local display error reporting failed",
      { stage: "create", error: failure },
      reportingError,
    );
    act(() => latest.controls.discard(ownTile()));
    expect(loadJournal(window.sessionStorage)?.actions).toHaveLength(1);
  });
});
