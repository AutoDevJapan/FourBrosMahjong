// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { MATCH_HISTORY_KEY, persistHistory } from "./matchHistory";
import {
  getResultHistoryViewSnapshot,
  getServerResultHistoryViewSnapshot,
  notifyResultHistoryChanged,
  type OnlineHistoryEntry,
  RESULT_HISTORY_KEY,
  retryResultHistoryViewSnapshot,
  subscribeResultHistory,
} from "./resultHistory";

const entry: OnlineHistoryEntry = {
  onlineMatchId: `${"b".repeat(32)}:1`,
  finishedAt: 200,
  players: [1, 2, 3, 4].map((rank) => ({
    name: `対局者${rank}`,
    rank,
    rawScore: 0,
    uma: 0,
    bonus: 0,
    soshiiTotal: 0,
  })),
};
const subscriptions: (() => void)[] = [];
function subscribe(callback: () => void) {
  const stop = subscribeResultHistory(callback);
  subscriptions.push(stop);
  return stop;
}
function write() {
  localStorage.setItem(
    RESULT_HISTORY_KEY,
    JSON.stringify({ version: 2, entries: [entry], legacySeeds: [] }),
  );
}
afterEach(() => {
  while (subscriptions.length) subscriptions.pop()?.();
  vi.restoreAllMocks();
  localStorage.clear();
  retryResultHistoryViewSnapshot();
});

describe("combined history external store", () => {
  it("keeps snapshots stable and never writes during a read", () => {
    write();
    const set = vi.spyOn(Storage.prototype, "setItem");
    const remove = vi.spyOn(Storage.prototype, "removeItem");
    const first = getResultHistoryViewSnapshot();
    expect(first).toEqual({ status: "ready", entries: [entry] });
    expect(getResultHistoryViewSnapshot()).toBe(first);
    expect(getServerResultHistoryViewSnapshot()).toBeNull();
    expect(set).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("cleans corrupt v2 in the subscription effect and preserves valid v1 bytes", () => {
    persistHistory(localStorage, {
      seed: 1,
      finishedAt: 100,
      players: entry.players,
    });
    const original = localStorage.getItem(MATCH_HISTORY_KEY);
    localStorage.setItem(
      RESULT_HISTORY_KEY,
      '{"version":2,"entries":[{}],"legacySeeds":[]}',
    );
    expect(getResultHistoryViewSnapshot().status).toBe("corrupt-retained");
    expect(localStorage.getItem(RESULT_HISTORY_KEY)).not.toBeNull();
    subscribe(vi.fn());
    expect(getResultHistoryViewSnapshot().status).toBe("corrupt-cleaned");
    expect(localStorage.getItem(RESULT_HISTORY_KEY)).toBeNull();
    expect(localStorage.getItem(MATCH_HISTORY_KEY)).toBe(original);
    retryResultHistoryViewSnapshot();
    expect(getResultHistoryViewSnapshot()).toEqual({
      status: "ready",
      entries: [{ seed: 1, finishedAt: 100, players: entry.players }],
    });
  });

  it("notifies once for v2 events and origin-wide clear, then detaches", () => {
    const callback = vi.fn();
    const stop = subscribe(callback);
    window.dispatchEvent(new StorageEvent("storage", { key: "unrelated" }));
    expect(callback).not.toHaveBeenCalled();
    write();
    window.dispatchEvent(
      new StorageEvent("storage", { key: RESULT_HISTORY_KEY }),
    );
    expect(callback).toHaveBeenCalledTimes(1);
    expect(getResultHistoryViewSnapshot()).toEqual({
      status: "ready",
      entries: [entry],
    });
    localStorage.clear();
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    expect(callback).toHaveBeenCalledTimes(2);
    expect(getResultHistoryViewSnapshot()).toEqual({
      status: "ready",
      entries: [],
    });
    stop();
    notifyResultHistoryChanged();
    window.dispatchEvent(
      new StorageEvent("storage", { key: RESULT_HISTORY_KEY }),
    );
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it("isolates a failing subscriber and reports storage read failure", () => {
    subscribe(() => {
      throw new Error("consumer");
    });
    const callback = vi.fn();
    subscribe(callback);
    expect(() =>
      window.dispatchEvent(
        new StorageEvent("storage", { key: RESULT_HISTORY_KEY }),
      ),
    ).not.toThrow();
    expect(callback).toHaveBeenCalledTimes(1);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("read");
    });
    expect(getResultHistoryViewSnapshot().status).toBe("read-error");
  });
});
