import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { walkToGameEnd } from "@/components/game/finishedGameFixture";
import { useGame } from "@/components/game/GameProvider";
import { selectView } from "@/components/game/gameView";
import {
  clearResultHistoryAcrossTabs,
  RESULT_HISTORY_KEY,
} from "@/components/game/resultHistory";
import { createGame } from "@/domain/game/engine";
import { createLockRequest } from "@/test/webLocksStub";
import OnlineGameProvider from "./OnlineGameProvider";
import {
  clearPendingOnlineHistory,
  loadPendingOnlineHistory,
  PENDING_ONLINE_HISTORY_KEY,
  retryPendingOnlineHistory,
} from "./pendingOnlineHistory";
import type { OnlineSnapshot } from "./types";

const finished = walkToGameEnd(2024).state;
const originalLocks = Object.getOwnPropertyDescriptor(navigator, "locks");

function snapshot(sequence = 1): OnlineSnapshot {
  return {
    code: "ABC234",
    matchId: `${"a".repeat(32)}:${sequence}`,
    version: 10,
    you: "p0",
    hostId: "p0",
    phase: "gameEnd",
    view: selectView(finished, "p0"),
    pending: null,
    roundSummary: finished.lastRound,
    players: [
      {
        id: "p0",
        name: finished.players[0].name,
        connected: true,
        isHost: true,
      },
    ],
    currentTurn: null,
    hostNotice: null,
  };
}
function Status() {
  return (
    <output data-testid="save-status">{useGame().historySaveStatus}</output>
  );
}
function Provider({ value }: { value: OnlineSnapshot }) {
  return (
    <OnlineGameProvider socket={null} snapshot={value}>
      <Status />
    </OnlineGameProvider>
  );
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: { request: createLockRequest() },
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  if (originalLocks) Object.defineProperty(navigator, "locks", originalLocks);
  else delete (navigator as { locks?: unknown }).locks;
});

describe("online completed match persistence", () => {
  it("keeps a verified-then-cancelled unknown capture cancelled on later snapshots", async () => {
    const request = createLockRequest();
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: { request },
    });
    const access = vi
      .spyOn(window, "localStorage", "get")
      .mockImplementation(() => {
        throw new Error("unavailable");
      });
    const { rerender } = render(<Provider value={snapshot()} />);
    await waitFor(() =>
      expect(screen.getByTestId("save-status")).toHaveTextContent("failed"),
    );
    expect(loadPendingOnlineHistory(sessionStorage)[0].historyEpoch).toBeNull();
    access.mockRestore();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const blocker = request(
      "four-bros-mahjong.history.write.v1",
      { signal: new AbortController().signal },
      () => held,
    );
    const clear = clearResultHistoryAcrossTabs(localStorage);
    await act(async () => {
      fireEvent(window, new Event("focus"));
    });
    await waitFor(() =>
      expect(screen.getByTestId("save-status")).toHaveTextContent("failed"),
    );
    await act(async () => {
      release();
      await blocker;
      expect(await clear).toBe("cleared");
      clearPendingOnlineHistory(sessionStorage);
    });
    await waitFor(() =>
      expect(screen.getByTestId("save-status")).toHaveTextContent("idle"),
    );
    rerender(<Provider value={{ ...snapshot(), version: 20 }} />);
    await waitFor(() =>
      expect(screen.getByTestId("save-status")).toHaveTextContent("idle"),
    );
    expect(loadPendingOnlineHistory(sessionStorage)).toEqual([]);
    expect(localStorage.getItem(RESULT_HISTORY_KEY)).toBeNull();
  });
  it("keeps a foreground unverified result failed and recoverable after a previous clear", async () => {
    expect(await clearResultHistoryAcrossTabs(localStorage)).toBe("cleared");
    const access = vi
      .spyOn(window, "localStorage", "get")
      .mockImplementation(() => {
        throw new Error("temporarily unavailable");
      });
    render(<Provider value={snapshot(2)} />);
    await waitFor(() =>
      expect(screen.getByTestId("save-status")).toHaveTextContent("failed"),
    );
    const first = loadPendingOnlineHistory(sessionStorage);
    expect(first).toHaveLength(1);
    expect(first[0].historyEpoch).toBeNull();
    access.mockRestore();
    await act(async () => {
      fireEvent(window, new Event("focus"));
    });
    expect(screen.getByTestId("save-status")).toHaveTextContent("failed");
    expect(loadPendingOnlineHistory(sessionStorage)).toEqual(first);
    expect(localStorage.getItem(RESULT_HISTORY_KEY)).toBeNull();
  });

  it("remembers a verified zero after unknown recovery so a later clear cannot revive it", async () => {
    const access = vi
      .spyOn(window, "localStorage", "get")
      .mockImplementation(() => {
        throw new Error("temporarily unavailable");
      });
    const { rerender } = render(<Provider value={snapshot()} />);
    await waitFor(() =>
      expect(screen.getByTestId("save-status")).toHaveTextContent("failed"),
    );
    access.mockRestore();
    await act(async () => {
      fireEvent(window, new Event("focus"));
    });
    await waitFor(() =>
      expect(screen.getByTestId("save-status")).toHaveTextContent("saved"),
    );
    expect(
      JSON.parse(localStorage.getItem(RESULT_HISTORY_KEY)!).entries[0]
        .historyEpoch,
    ).toBe(0);
    expect(await clearResultHistoryAcrossTabs(localStorage)).toBe("cleared");
    rerender(<Provider value={{ ...snapshot(), version: 12 }} />);
    await waitFor(() =>
      expect(screen.getByTestId("save-status")).toHaveTextContent("idle"),
    );
    expect(localStorage.getItem(RESULT_HISTORY_KEY)).toBeNull();
    expect(loadPendingOnlineHistory(sessionStorage)).toEqual([]);
  });
  it("does not resave a cleared result on another snapshot, but saves the next half-game", async () => {
    const { rerender } = render(<Provider value={snapshot()} />);
    await waitFor(() =>
      expect(screen.getByTestId("save-status")).toHaveTextContent("saved"),
    );
    expect(await clearResultHistoryAcrossTabs(localStorage)).toBe("cleared");
    clearPendingOnlineHistory(sessionStorage);
    rerender(<Provider value={{ ...snapshot(), version: 11 }} />);
    await waitFor(() =>
      expect(screen.getByTestId("save-status")).toHaveTextContent("idle"),
    );
    expect(localStorage.getItem(RESULT_HISTORY_KEY)).toBeNull();
    expect(loadPendingOnlineHistory(sessionStorage)).toEqual([]);
    rerender(<Provider value={snapshot(2)} />);
    await waitFor(() =>
      expect(screen.getByTestId("save-status")).toHaveTextContent("saved"),
    );
    const entries = JSON.parse(
      localStorage.getItem(RESULT_HISTORY_KEY)!,
    ).entries;
    expect(entries).toHaveLength(1);
    expect(entries[0].onlineMatchId).toBe(snapshot(2).matchId);
    expect(entries[0].historyEpoch).toBe(1);
  });

  it("cancels a provider save queued behind clear instead of completing it as saved", async () => {
    const request = createLockRequest();
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: { request },
    });
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const blocker = request(
      "four-bros-mahjong.history.write.v1",
      { signal: new AbortController().signal },
      () => held,
    );
    const clear = clearResultHistoryAcrossTabs(localStorage);
    render(<Provider value={snapshot()} />);
    await waitFor(() =>
      expect(loadPendingOnlineHistory(sessionStorage)).toHaveLength(1),
    );
    await act(async () => {
      release();
      await blocker;
      expect(await clear).toBe("cleared");
      clearPendingOnlineHistory(sessionStorage);
    });
    await waitFor(() =>
      expect(screen.getByTestId("save-status")).toHaveTextContent("idle"),
    );
    expect(localStorage.getItem(RESULT_HISTORY_KEY)).toBeNull();
    expect(loadPendingOnlineHistory(sessionStorage)).toEqual([]);
  });
  it("saves a real finished result in fixed p0-p3 order and reports success", async () => {
    render(<Provider value={snapshot()} />);
    await waitFor(() =>
      expect(localStorage.getItem(RESULT_HISTORY_KEY)).not.toBeNull(),
    );
    const data = JSON.parse(localStorage.getItem(RESULT_HISTORY_KEY)!);
    expect(data.entries).toHaveLength(1);
    expect(data.entries[0].onlineMatchId).toBe(`${"a".repeat(32)}:1`);
    expect(
      data.entries[0].players.map((player: { name: string }) => player.name),
    ).toEqual(finished.players.map((player) => player.name));
    expect(screen.getByTestId("save-status")).toHaveTextContent("saved");
  });

  it("does not duplicate reconnect snapshots and keeps same-room half-games distinct", async () => {
    const first = snapshot();
    const { rerender } = render(<Provider value={first} />);
    await waitFor(() =>
      expect(screen.getByTestId("save-status")).toHaveTextContent("saved"),
    );
    const original = JSON.parse(localStorage.getItem(RESULT_HISTORY_KEY)!);
    rerender(<Provider value={{ ...snapshot(), version: 11 }} />);
    await waitFor(() =>
      expect(screen.getByTestId("save-status")).toHaveTextContent("saved"),
    );
    expect(
      JSON.parse(localStorage.getItem(RESULT_HISTORY_KEY)!).entries,
    ).toEqual(original.entries);
    rerender(<Provider value={snapshot(2)} />);
    await waitFor(() =>
      expect(
        JSON.parse(localStorage.getItem(RESULT_HISTORY_KEY)!).entries,
      ).toHaveLength(2),
    );
    const entries = JSON.parse(
      localStorage.getItem(RESULT_HISTORY_KEY)!,
    ).entries;
    expect(
      entries.map((entry: { onlineMatchId: string }) => entry.onlineMatchId),
    ).toEqual([snapshot(2).matchId, first.matchId]);
    expect(entries[1].finishedAt).toBe(original.entries[0].finishedAt);
  });

  it("keeps failed results for a focus retry and reports failure through the existing feedback callback", async () => {
    const set = Storage.prototype.setItem;
    const write = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(function (this: Storage, key, value) {
        if (key === RESULT_HISTORY_KEY) throw new Error("quota");
        set.call(this, key, value);
      });
    const error = vi.fn();
    render(
      <OnlineGameProvider
        socket={null}
        snapshot={snapshot()}
        onHistorySaveError={error}
      >
        <Status />
      </OnlineGameProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("save-status")).toHaveTextContent("failed"),
    );
    const pending = loadPendingOnlineHistory(sessionStorage);
    expect(pending).toHaveLength(1);
    expect(error).toHaveBeenCalledTimes(1);
    write.mockRestore();
    fireEvent(window, new Event("focus"));
    await waitFor(() =>
      expect(screen.getByTestId("save-status")).toHaveTextContent("saved"),
    );
    expect(
      JSON.parse(localStorage.getItem(RESULT_HISTORY_KEY)!).entries[0]
        .finishedAt,
    ).toBe(pending[0].finishedAt);
    expect(sessionStorage.getItem(PENDING_ONLINE_HISTORY_KEY)).toBeNull();
  });

  it("recovers a queued result after unmount without a live room or server connection", async () => {
    const set = Storage.prototype.setItem;
    const write = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(function (this: Storage, key, value) {
        if (key === RESULT_HISTORY_KEY) throw new Error("blocked");
        set.call(this, key, value);
      });
    const { unmount } = render(<Provider value={snapshot()} />);
    await waitFor(() =>
      expect(screen.getByTestId("save-status")).toHaveTextContent("failed"),
    );
    unmount();
    const queued = loadPendingOnlineHistory(sessionStorage);
    write.mockRestore();
    await retryPendingOnlineHistory();
    expect(
      JSON.parse(localStorage.getItem(RESULT_HISTORY_KEY)!).entries,
    ).toEqual(queued);
    expect(loadPendingOnlineHistory(sessionStorage)).toEqual([]);
  });

  it("never lets an older save completion mark the next playing match as saved", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const request = createLockRequest();
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: {
        request: (
          name: string,
          options: { signal: AbortSignal },
          callback: () => unknown,
        ) =>
          request(name, options, async () => {
            await blocked;
            return callback();
          }),
      },
    });
    const { rerender } = render(<Provider value={snapshot()} />);
    await waitFor(() =>
      expect(loadPendingOnlineHistory(sessionStorage)).toHaveLength(1),
    );
    const playing = createGame({ seed: 0 });
    rerender(
      <Provider
        value={{
          ...snapshot(2),
          phase: "playing",
          view: selectView(playing, "p0"),
          pending: playing.pending,
        }}
      />,
    );
    expect(screen.getByTestId("save-status")).toHaveTextContent("idle");
    await act(async () => {
      release();
    });
    await waitFor(() =>
      expect(localStorage.getItem(RESULT_HISTORY_KEY)).not.toBeNull(),
    );
    expect(screen.getByTestId("save-status")).toHaveTextContent("idle");
    expect(loadPendingOnlineHistory(sessionStorage)).toEqual([]);
  });

  it("keeps a previous match failure visible while the next match is playing", async () => {
    const access = vi
      .spyOn(window, "localStorage", "get")
      .mockImplementation(() => {
        throw new DOMException("unavailable", "SecurityError");
      });
    const { rerender } = render(<Provider value={snapshot()} />);
    await waitFor(() =>
      expect(screen.getByTestId("save-status")).toHaveTextContent("failed"),
    );
    const retained = loadPendingOnlineHistory(sessionStorage);
    expect(retained).toHaveLength(1);
    const playing = createGame({ seed: 0 });
    await act(async () => {
      rerender(
        <Provider
          value={{
            ...snapshot(2),
            phase: "playing",
            view: selectView(playing, "p0"),
            pending: playing.pending,
          }}
        />,
      );
    });
    expect(screen.getByTestId("save-status")).toHaveTextContent("failed");
    access.mockRestore();
    fireEvent.focus(window);
    await waitFor(() =>
      expect(loadPendingOnlineHistory(sessionStorage)).toEqual([]),
    );
    expect(screen.getByTestId("save-status")).toHaveTextContent("idle");
    expect(
      JSON.parse(localStorage.getItem(RESULT_HISTORY_KEY)!).entries[0],
    ).toMatchObject({
      onlineMatchId: snapshot().matchId,
      finishedAt: retained[0].finishedAt,
    });
  });

  it("reports an older write failure that completes after the next match starts", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const request = createLockRequest();
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: { request },
    });
    const blocker = request(
      "four-bros-mahjong.history.write.v1",
      { signal: new AbortController().signal },
      () => held,
    );
    const set = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key,
      value,
    ) {
      if (key === RESULT_HISTORY_KEY) throw new Error("quota");
      set.call(this, key, value);
    });
    try {
      const { rerender } = render(<Provider value={snapshot()} />);
      await waitFor(() =>
        expect(loadPendingOnlineHistory(sessionStorage)).toHaveLength(1),
      );
      const playing = createGame({ seed: 0 });
      rerender(
        <Provider
          value={{
            ...snapshot(2),
            phase: "playing",
            view: selectView(playing, "p0"),
            pending: playing.pending,
          }}
        />,
      );
      expect(screen.getByTestId("save-status")).toHaveTextContent("idle");
      await act(async () => {
        release();
        await blocker;
      });
      await waitFor(() =>
        expect(screen.getByTestId("save-status")).toHaveTextContent("failed"),
      );
      expect(localStorage.getItem(RESULT_HISTORY_KEY)).toBeNull();
      expect(loadPendingOnlineHistory(sessionStorage)).toHaveLength(1);
    } finally {
      release();
      await blocker;
    }
  });

  it("keeps an older pending failure when a later match saves successfully", async () => {
    const set = Storage.prototype.setItem;
    const write = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(function (this: Storage, key, value) {
        if (
          key === RESULT_HISTORY_KEY &&
          JSON.parse(value).entries.some(
            (entry: { onlineMatchId?: string }) =>
              entry.onlineMatchId === snapshot().matchId,
          )
        )
          throw new Error("first result unavailable");
        set.call(this, key, value);
      });
    const { rerender } = render(<Provider value={snapshot()} />);
    await waitFor(() =>
      expect(screen.getByTestId("save-status")).toHaveTextContent("failed"),
    );
    rerender(<Provider value={snapshot(2)} />);
    await waitFor(() =>
      expect(
        JSON.parse(localStorage.getItem(RESULT_HISTORY_KEY)!).entries,
      ).toHaveLength(1),
    );
    expect(
      JSON.parse(localStorage.getItem(RESULT_HISTORY_KEY)!).entries[0]
        .onlineMatchId,
    ).toBe(snapshot(2).matchId);
    expect(
      loadPendingOnlineHistory(sessionStorage).map((e) => e.onlineMatchId),
    ).toEqual([snapshot().matchId]);
    expect(screen.getByTestId("save-status")).toHaveTextContent("failed");
    write.mockRestore();
    fireEvent.focus(window);
    await waitFor(() =>
      expect(loadPendingOnlineHistory(sessionStorage)).toEqual([]),
    );
    expect(screen.getByTestId("save-status")).toHaveTextContent("saved");
    expect(
      JSON.parse(localStorage.getItem(RESULT_HISTORY_KEY)!).entries,
    ).toHaveLength(2);
  });

  it("clears an older failure after explicit deletion cancels its pending result", async () => {
    const set = Storage.prototype.setItem;
    const write = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(function (this: Storage, key, value) {
        if (key === RESULT_HISTORY_KEY) throw new Error("quota");
        set.call(this, key, value);
      });
    const { rerender } = render(<Provider value={snapshot()} />);
    await waitFor(() =>
      expect(screen.getByTestId("save-status")).toHaveTextContent("failed"),
    );
    expect(loadPendingOnlineHistory(sessionStorage)[0].historyEpoch).toBe(0);
    const playing = createGame({ seed: 0 });
    rerender(
      <Provider
        value={{
          ...snapshot(2),
          phase: "playing",
          view: selectView(playing, "p0"),
          pending: playing.pending,
        }}
      />,
    );
    expect(screen.getByTestId("save-status")).toHaveTextContent("failed");
    write.mockRestore();
    await act(async () => {
      expect(await clearResultHistoryAcrossTabs(localStorage)).toBe("cleared");
      expect(clearPendingOnlineHistory(sessionStorage)).toBe(true);
      fireEvent.focus(window);
    });
    await waitFor(() =>
      expect(screen.getByTestId("save-status")).toHaveTextContent("idle"),
    );
    expect(localStorage.getItem(RESULT_HISTORY_KEY)).toBeNull();
    expect(loadPendingOnlineHistory(sessionStorage)).toEqual([]);
  });

  it("keeps an old server usable without fabricating a match identity", () => {
    render(<Provider value={{ ...snapshot(), matchId: undefined }} />);
    expect(screen.getByTestId("save-status")).toHaveTextContent("idle");
    expect(localStorage.getItem(RESULT_HISTORY_KEY)).toBeNull();
    expect(sessionStorage.getItem(PENDING_ONLINE_HISTORY_KEY)).toBeNull();
  });
});
