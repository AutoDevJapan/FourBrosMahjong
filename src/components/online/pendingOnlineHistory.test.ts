// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OnlineHistoryEntry } from "@/components/game/resultHistory";
import {
  clearResultHistoryAcrossTabs,
  loadResultHistory,
  RESULT_HISTORY_KEY,
  readHistoryEpoch,
} from "@/components/game/resultHistory";
import {
  createLockRequest,
  restoreWebLocks,
  stubWebLocks,
} from "@/test/webLocksStub";
import {
  clearPendingOnlineHistory,
  forgetPendingOnlineHistory,
  loadPendingOnlineHistory,
  PENDING_ONLINE_HISTORY_KEY,
  rememberPendingOnlineHistory,
  retryPendingOnlineHistory,
} from "./pendingOnlineHistory";

function entry(n: number, finishedAt = n): OnlineHistoryEntry {
  return {
    historyEpoch: 0,
    onlineMatchId: `${"c".repeat(32)}:${n}`,
    finishedAt,
    players: [1, 2, 3, 4].map((rank) => ({
      name: `席${rank}`,
      rank,
      rawScore: 0,
      uma: 0,
      bonus: 0,
      soshiiTotal: 0,
    })),
  };
}
const originalLocks = Object.getOwnPropertyDescriptor(navigator, "locks");
beforeEach(() => stubWebLocks());
afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
  localStorage.clear();
  restoreWebLocks(originalLocks);
});

describe("pending online results", () => {
  it("cancels a stale pending queue from another tab and accepts a new post-clear result", async () => {
    const values = new Map<string, string>();
    const other: Storage = {
      get length() {
        return values.size;
      },
      clear() {
        values.clear();
      },
      getItem(key) {
        return values.get(key) ?? null;
      },
      key(index) {
        return [...values.keys()][index] ?? null;
      },
      removeItem(key) {
        values.delete(key);
      },
      setItem(key, value) {
        values.set(key, value);
      },
    };
    other.setItem(
      PENDING_ONLINE_HISTORY_KEY,
      JSON.stringify(
        { version: 2, entries: [entry(2)], legacySeeds: [] },
        (key, value) => (key === "historyEpoch" ? undefined : value),
      ),
    );
    expect(await clearResultHistoryAcrossTabs(localStorage)).toBe("cleared");
    vi.spyOn(window, "sessionStorage", "get").mockReturnValue(other);
    await retryPendingOnlineHistory();
    expect(localStorage.getItem(RESULT_HISTORY_KEY)).toBeNull();
    expect(loadPendingOnlineHistory(other)).toEqual([]);
    const current = {
      ...entry(3),
      historyEpoch: readHistoryEpoch(localStorage),
    };
    rememberPendingOnlineHistory(new Map(), current, other);
    expect(
      clearPendingOnlineHistory(other, readHistoryEpoch(localStorage)),
    ).toBe(true);
    expect(loadPendingOnlineHistory(other)).toEqual([current]);
    await retryPendingOnlineHistory();
    expect(loadResultHistory(localStorage)).toEqual([current]);
    expect(loadPendingOnlineHistory(other)).toEqual([]);
  });
  it("never restores batch B after a successful clear between queued A and B", async () => {
    const previous = Object.getOwnPropertyDescriptor(navigator, "locks");
    const request = createLockRequest();
    let requestNumber = 0;
    const granted: number[] = [];
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: {
        request: (
          name: string,
          options: { signal: AbortSignal },
          callback: () => unknown,
        ) => {
          const number = requestNumber++;
          return request(name, options, () => {
            granted.push(number);
            return callback();
          });
        },
      },
    });
    try {
      const pending = new Map<string, OnlineHistoryEntry>();
      rememberPendingOnlineHistory(pending, entry(1), sessionStorage);
      rememberPendingOnlineHistory(pending, entry(2), sessionStorage);
      const retry = retryPendingOnlineHistory();
      const clear = clearResultHistoryAcrossTabs(localStorage);
      expect(await clear).toBe("cleared");
      expect(clearPendingOnlineHistory(sessionStorage)).toBe(true);
      await retry;
      expect(granted).toEqual([0, 1, 2]);
      expect(loadResultHistory(localStorage)).toEqual([]);
      expect(loadPendingOnlineHistory(sessionStorage)).toEqual([]);
    } finally {
      if (previous) Object.defineProperty(navigator, "locks", previous);
      else delete (navigator as { locks?: unknown }).locks;
    }
  });
  it("an old provider completion cannot erase a newer provider's pending result", () => {
    const old = new Map<string, OnlineHistoryEntry>();
    rememberPendingOnlineHistory(old, entry(1), sessionStorage);
    const next = new Map(
      loadPendingOnlineHistory(sessionStorage).map((item) => [
        item.onlineMatchId,
        item,
      ]),
    );
    rememberPendingOnlineHistory(next, entry(2), sessionStorage);
    forgetPendingOnlineHistory(old, entry(1).onlineMatchId, sessionStorage);
    expect(loadPendingOnlineHistory(sessionStorage)).toEqual([entry(2)]);
  });

  it("preserves the first durable timestamp and retries the memory backup after a write failure", () => {
    const pending = new Map<string, OnlineHistoryEntry>();
    const write = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    rememberPendingOnlineHistory(pending, entry(1, 100), sessionStorage);
    expect(pending.get(entry(1).onlineMatchId)?.finishedAt).toBe(100);
    write.mockRestore();
    expect(
      rememberPendingOnlineHistory(pending, entry(1, 999), sessionStorage)
        .finishedAt,
    ).toBe(100);
    expect(loadPendingOnlineHistory(sessionStorage)).toEqual([entry(1, 100)]);
    const another = new Map<string, OnlineHistoryEntry>();
    expect(
      rememberPendingOnlineHistory(another, entry(1, 777), sessionStorage)
        .finishedAt,
    ).toBe(100);
  });

  it("does not overwrite an unreadable queue and caps memory and storage at twenty", () => {
    const pending = new Map<string, OnlineHistoryEntry>();
    for (let n = 1; n <= 21; n++)
      rememberPendingOnlineHistory(pending, entry(n), sessionStorage);
    expect(pending.size).toBe(20);
    expect(loadPendingOnlineHistory(sessionStorage)).toEqual(
      Array.from({ length: 20 }, (_, i) => entry(i + 2)),
    );
    const write = vi.spyOn(Storage.prototype, "setItem");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("unreadable");
    });
    rememberPendingOnlineHistory(pending, entry(22), sessionStorage);
    expect(write).not.toHaveBeenCalled();
    expect(pending.size).toBe(20);
  });

  it("rejects malformed queue data and verifies explicit deletion", () => {
    sessionStorage.setItem(
      PENDING_ONLINE_HISTORY_KEY,
      JSON.stringify({
        version: 2,
        entries: [{ ...entry(1), seed: 1 }],
        legacySeeds: [],
      }),
    );
    expect(loadPendingOnlineHistory(sessionStorage)).toEqual([]);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(
      () => undefined,
    );
    expect(clearPendingOnlineHistory(sessionStorage)).toBe(false);
  });

  it("does not claim deletion when browser session storage becomes unreadable", () => {
    rememberPendingOnlineHistory(new Map(), entry(1), sessionStorage);
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      throw new Error("access revoked");
    });
    expect(clearPendingOnlineHistory()).toBe(false);
  });
});
