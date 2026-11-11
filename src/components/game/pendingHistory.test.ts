import { describe, expect, it, vi } from "vitest";
import { createLockRequest } from "@/test/webLocksStub";
import { HISTORY_EPOCH_KEY } from "./historyEpoch";
import {
  type HistoryLockManager,
  loadHistory,
  MATCH_HISTORY_KEY,
  type MatchHistoryEntry,
  persistHistory,
} from "./matchHistory";
import {
  CAPTURED_HISTORY_KEY,
  forgetPendingHistory,
  loadPendingHistory,
  PENDING_HISTORY_EPOCHS_KEY,
  PENDING_HISTORY_KEY,
  type PendingHistoryEntry,
  persistPendingHistoryEntry,
  rememberPendingHistory,
} from "./pendingHistory";
import {
  clearResultHistoryAcrossTabs,
  readHistoryEpoch,
} from "./resultHistory";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

function result(seed: number, finishedAt = seed): MatchHistoryEntry {
  return {
    seed,
    finishedAt,
    players: [1, 2, 3, 4].map((rank) => ({
      name: `兄弟${rank}`,
      rank,
      rawScore: 0,
      uma: 0,
      bonus: 0,
      soshiiTotal: 0,
    })),
  };
}

const manager = (): HistoryLockManager => ({
  request: createLockRequest() as HistoryLockManager["request"],
});
const queue = () => new Map<number, PendingHistoryEntry>();
const legacy = (session: Storage, entry: MatchHistoryEntry) =>
  session.setItem(
    PENDING_HISTORY_KEY,
    JSON.stringify({ version: 1, entries: [entry] }),
  );

describe("local pending recovery transaction (#1244)", () => {
  it("uses the public capture provenance key for fault injection", () => {
    expect(CAPTURED_HISTORY_KEY).toBe("four-bros-mahjong.history-captures.v1");
  });

  it("a genuinely new final action captures the post-clear epoch instead of an older origin", async () => {
    const local = new MemoryStorage(),
      session = new MemoryStorage(),
      first = queue();
    const old = rememberPendingHistory(first, result(1, 100), session, local);
    expect(
      await persistPendingHistoryEntry(first, old, session, local, manager()),
    ).toBe("saved");
    expect(await clearResultHistoryAcrossTabs(local, manager(), session)).toBe(
      "cleared",
    );
    const pending = queue();
    const live = rememberPendingHistory(
      pending,
      result(1, 200),
      session,
      local,
      "live",
    );
    expect(live.historyEpoch).toBe(1);
    expect(live.finishedAt).toBe(200);
    expect(
      await persistPendingHistoryEntry(
        pending,
        live,
        session,
        local,
        manager(),
      ),
    ).toBe("saved");
    expect(loadHistory(local)).toEqual([result(1, 200)]);
  });

  it.each([false, true])(
    "restores the saved result after a capture-only write failure (synthetic same epoch: %s)",
    async (sameEpoch) => {
      const local = new MemoryStorage(),
        session = new MemoryStorage(),
        first = queue();
      const old = rememberPendingHistory(first, result(1, 100), session, local);
      expect(
        await persistPendingHistoryEntry(first, old, session, local, manager()),
      ).toBe("saved");
      expect(
        await clearResultHistoryAcrossTabs(local, manager(), session),
      ).toBe("cleared");
      // The primary case uses the real clear epoch. This additional synthetic
      // variant models stale provenance in the same epoch without claiming a
      // normal clear resets its monotonically increasing counter.
      if (sameEpoch) local.setItem(HISTORY_EPOCH_KEY, "0");
      const expectedEpoch = sameEpoch ? 0 : 1;
      const before = session.getItem(CAPTURED_HISTORY_KEY);
      const write = vi
        .spyOn(session, "setItem")
        .mockImplementation((key, value) => {
          if (key === CAPTURED_HISTORY_KEY)
            throw new Error("temporary capture write failure");
          MemoryStorage.prototype.setItem.call(session, key, value);
        });
      const pending = queue();
      const live = rememberPendingHistory(
        pending,
        result(1, 200),
        session,
        local,
        "live",
      );
      expect(live.historyEpoch).toBe(expectedEpoch);
      expect(
        await persistPendingHistoryEntry(
          pending,
          live,
          session,
          local,
          manager(),
        ),
      ).toBe("saved");
      expect(session.getItem(PENDING_HISTORY_KEY)).toBeNull();
      expect(session.getItem(CAPTURED_HISTORY_KEY)).toBe(before);
      write.mockRestore();
      const restoredQueue = queue();
      const restored = rememberPendingHistory(
        restoredQueue,
        result(1, 300),
        session,
        local,
        "restored",
      );
      expect(restored.finishedAt).toBe(200);
      expect(restored.historyEpoch).toBe(expectedEpoch);
      expect(
        await persistPendingHistoryEntry(
          restoredQueue,
          restored,
          session,
          local,
          manager(),
        ),
      ).toBe("saved");
      expect(loadHistory(local)).toEqual([result(1, 200)]);
      expect(session.getItem(PENDING_HISTORY_KEY)).toBeNull();
      // Saved-result priority must still respect a subsequent explicit clear.
      expect(
        await clearResultHistoryAcrossTabs(local, manager(), session),
      ).toBe("cleared");
      const clearedQueue = queue();
      const cleared = rememberPendingHistory(
        clearedQueue,
        result(1, 400),
        session,
        local,
        "restored",
      );
      expect(
        await persistPendingHistoryEntry(
          clearedQueue,
          cleared,
          session,
          local,
          manager(),
        ),
      ).toBe("cancelled");
      expect(loadHistory(local)).toEqual([]);
    },
  );

  it("captures epoch before reading saved bytes and rejects a concurrent clear", async () => {
    const local = new MemoryStorage(),
      session = new MemoryStorage();
    persistHistory(local, result(7, 100));
    session.setItem(
      CAPTURED_HISTORY_KEY,
      JSON.stringify({
        version: 1,
        entries: [{ result: result(7, 50), epoch: 0 }],
      }),
    );
    const read = local.getItem.bind(local);
    let crossed = false;
    vi.spyOn(local, "getItem").mockImplementation((key) => {
      const raw = read(key);
      if (key === MATCH_HISTORY_KEY && !crossed) {
        crossed = true;
        local.removeItem(MATCH_HISTORY_KEY);
        local.setItem(HISTORY_EPOCH_KEY, "1");
      }
      return raw;
    });
    const pending = queue();
    const entry = rememberPendingHistory(
      pending,
      result(7, 999),
      session,
      local,
      "restored",
    );
    expect(crossed).toBe(true);
    expect(entry.finishedAt).toBe(100);
    expect(entry.historyEpoch).toBe(0);
    expect(
      await persistPendingHistoryEntry(
        pending,
        entry,
        session,
        local,
        manager(),
      ),
    ).toBe("cancelled");
    expect(loadHistory(local)).toEqual([]);
    expect(session.getItem(PENDING_HISTORY_KEY)).toBeNull();
  });

  it.each(["read", "write"])(
    "capture provenance %s failure does not promote an old journal after clear",
    async (fault) => {
      const local = new MemoryStorage(),
        session = new MemoryStorage();
      local.setItem(HISTORY_EPOCH_KEY, "1");
      const method = fault === "read" ? "getItem" : "setItem";
      const originalRead = session.getItem.bind(session),
        originalWrite = session.setItem.bind(session);
      if (method === "getItem")
        vi.spyOn(session, "getItem").mockImplementation((key) => {
          if (key === CAPTURED_HISTORY_KEY)
            throw new Error("unreadable provenance");
          return originalRead(key);
        });
      else
        vi.spyOn(session, "setItem").mockImplementation((key, value) => {
          if (key === CAPTURED_HISTORY_KEY)
            throw new Error("unwritable provenance");
          originalWrite(key, value);
        });
      const pending = queue();
      const entry = rememberPendingHistory(
        pending,
        result(1),
        session,
        local,
        "restored",
      );
      expect(entry.historyEpoch).toBeNull();
      expect(
        await persistPendingHistoryEntry(
          pending,
          entry,
          session,
          local,
          manager(),
        ),
      ).toBe("failed");
      expect(loadPendingHistory(session).map((item) => item.seed)).toEqual([1]);
      expect(loadHistory(local)).toEqual([]);
      vi.restoreAllMocks();
    },
  );

  it("keeps the original v1 result and first capture through retry and deduplicates", async () => {
    const local = new MemoryStorage(),
      session = new MemoryStorage(),
      pending = queue();
    const entry = rememberPendingHistory(
      pending,
      result(7, 123),
      session,
      local,
    );
    expect(
      rememberPendingHistory(pending, result(7, 999), session, local),
    ).toBe(entry);
    expect(JSON.parse(session.getItem(PENDING_HISTORY_KEY) ?? "null")).toEqual({
      version: 1,
      entries: [result(7, 123)],
    });
    const other = new Map(
      loadPendingHistory(session).map((item) => [item.seed, item]),
    );
    const locks = manager();
    await Promise.all([
      persistPendingHistoryEntry(pending, entry, session, local, locks),
      persistPendingHistoryEntry(other, other.get(7)!, session, local, locks),
    ]);
    expect(loadHistory(local)).toEqual([result(7, 123)]);
    expect(session.getItem(PENDING_HISTORY_KEY)).toBeNull();
  });

  it.each([0, 1])(
    "legacy unknown is recoverable only with epoch zero (%s)",
    async (epoch) => {
      const local = new MemoryStorage(),
        session = new MemoryStorage();
      local.setItem(HISTORY_EPOCH_KEY, String(epoch));
      legacy(session, result(1, 100));
      const before = session.getItem(PENDING_HISTORY_KEY);
      const entry = loadPendingHistory(session)[0];
      expect(entry.historyEpoch).toBeNull();
      const pending = new Map([[entry.seed, entry]]);
      expect(
        await persistPendingHistoryEntry(
          pending,
          entry,
          session,
          local,
          manager(),
        ),
      ).toBe(epoch === 0 ? "saved" : "failed");
      expect(loadHistory(local)).toEqual(epoch === 0 ? [result(1, 100)] : []);
      if (epoch !== 0)
        expect(session.getItem(PENDING_HISTORY_KEY)).toBe(before);
    },
  );

  it("cancels a retry queued behind clear without a nested lock or resurrection", async () => {
    const local = new MemoryStorage(),
      session = new MemoryStorage(),
      pending = queue();
    const entry = rememberPendingHistory(pending, result(1), session, local);
    const locks = manager();
    let release!: () => void, entered!: () => void;
    const acquired = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const held = locks.request(
      "four-bros-mahjong.history.write.v1",
      { signal: new AbortController().signal },
      () => {
        entered();
        return new Promise<void>((resolve) => {
          release = resolve;
        });
      },
    );
    await acquired;
    const cleared = clearResultHistoryAcrossTabs(local, locks, session);
    const retried = persistPendingHistoryEntry(
      pending,
      entry,
      session,
      local,
      locks,
    );
    release();
    await held;
    expect(await cleared).toBe("cleared");
    expect(await retried).toBe("cancelled");
    expect(loadHistory(local)).toEqual([]);
    expect(pending.size).toBe(0);
    expect(session.getItem(PENDING_HISTORY_KEY)).toBeNull();
    expect(readHistoryEpoch(local)).toBe(1);
  });

  it("clear after retry removes the saved result and a new epoch result can save", async () => {
    const local = new MemoryStorage(),
      session = new MemoryStorage(),
      pending = queue(),
      locks = manager();
    const old = rememberPendingHistory(pending, result(1), session, local);
    const retry = persistPendingHistoryEntry(
      pending,
      old,
      session,
      local,
      locks,
    );
    const clear = clearResultHistoryAcrossTabs(local, locks, session);
    expect(await retry).toBe("saved");
    expect(await clear).toBe("cleared");
    const fresh = rememberPendingHistory(pending, result(2), session, local);
    expect(fresh.historyEpoch).toBe(1);
    expect(
      await persistPendingHistoryEntry(pending, fresh, session, local, locks),
    ).toBe("saved");
    expect(loadHistory(local)).toEqual([result(2)]);
  });

  it("forget rereads live queue and never overwrites a newer provider's capture", () => {
    const local = new MemoryStorage(),
      session = new MemoryStorage(),
      oldMap = queue();
    const old = rememberPendingHistory(oldMap, result(1), session, local);
    const fresh = rememberPendingHistory(queue(), result(2), session, local);
    forgetPendingHistory(oldMap, old, session);
    expect(loadPendingHistory(session).map((item) => item.seed)).toEqual([
      fresh.seed,
    ]);
  });

  it("cannot pair an old epoch association with changed result bytes", async () => {
    const local = new MemoryStorage(),
      session = new MemoryStorage(),
      pending = queue();
    local.setItem(HISTORY_EPOCH_KEY, "1");
    rememberPendingHistory(pending, result(1, 100), session, local);
    const original = result(1, 100);
    const changed = {
      ...original,
      players: original.players.map((player, index) =>
        index === 0 ? { ...player, name: "別の結果" } : player,
      ),
    };
    legacy(session, changed);
    const entry = loadPendingHistory(session)[0];
    expect(entry.historyEpoch).toBeNull();
    expect(
      await persistPendingHistoryEntry(
        new Map([[1, entry]]),
        entry,
        session,
        local,
        manager(),
      ),
    ).toBe("failed");
    expect(loadHistory(local)).toEqual([]);
  });

  it("queue read failure keeps memory and bytes instead of pretending they were cleared", async () => {
    const local = new MemoryStorage(),
      session = new MemoryStorage(),
      pending = queue();
    const entry = rememberPendingHistory(pending, result(1), session, local);
    const before = session.getItem(PENDING_HISTORY_KEY);
    const read = vi.spyOn(session, "getItem").mockImplementation(() => {
      throw new Error("unreadable");
    });
    expect(
      await persistPendingHistoryEntry(
        pending,
        entry,
        session,
        local,
        manager(),
      ),
    ).toBe("failed");
    expect(pending.has(entry.seed)).toBe(true);
    read.mockRestore();
    expect(session.getItem(PENDING_HISTORY_KEY)).toBe(before);
  });

  it("does not evict newer stored results for a delayed old retry", async () => {
    const local = new MemoryStorage(),
      session = new MemoryStorage(),
      pending = queue();
    for (let n = 2; n <= 21; n++) persistHistory(local, result(n, n));
    const before = local.getItem(MATCH_HISTORY_KEY);
    const entry = rememberPendingHistory(pending, result(1, 1), session, local);
    expect(
      await persistPendingHistoryEntry(
        pending,
        entry,
        session,
        local,
        manager(),
      ),
    ).toBe("not-retained");
    expect(local.getItem(MATCH_HISTORY_KEY)).toBe(before);
    expect(session.getItem(PENDING_HISTORY_KEY)).toBeNull();
  });

  it("partial metadata write leaves unknown capture and the original payload available", () => {
    const local = new MemoryStorage(),
      session = new MemoryStorage();
    local.setItem(HISTORY_EPOCH_KEY, "1");
    const write = vi
      .spyOn(session, "setItem")
      .mockImplementation((key, value) => {
        if (key === PENDING_HISTORY_EPOCHS_KEY)
          throw new Error("metadata failure");
        MemoryStorage.prototype.setItem.call(session, key, value);
      });
    const entry = rememberPendingHistory(queue(), result(1), session, local);
    write.mockRestore();
    expect(entry.historyEpoch).toBe(1);
    expect(loadPendingHistory(session).map((item) => item.seed)).toEqual([1]);
    expect(loadPendingHistory(session)[0].historyEpoch).toBeNull();
  });

  it("recovery of session storage also retains older memory-only captures", () => {
    const local = new MemoryStorage(),
      session = new MemoryStorage(),
      pending = queue();
    const write = vi.spyOn(session, "setItem").mockImplementation(() => {
      throw new Error("unavailable");
    });
    rememberPendingHistory(pending, result(1), session, local);
    write.mockRestore();
    rememberPendingHistory(pending, result(2), session, local);
    expect(loadPendingHistory(session).map((entry) => entry.seed)).toEqual([
      1, 2,
    ]);
  });

  it("a non-quota write failure does not discard an old recoverable result", async () => {
    const local = new MemoryStorage(),
      session = new MemoryStorage(),
      pending = queue();
    for (let n = 2; n <= 5; n++) persistHistory(local, result(n, n));
    const retained = rememberPendingHistory(
      pending,
      result(1, 3),
      session,
      local,
    );
    const bytes = local.getItem(MATCH_HISTORY_KEY);
    const write = vi.spyOn(local, "setItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(
      await persistPendingHistoryEntry(
        pending,
        retained,
        session,
        local,
        manager(),
      ),
    ).toBe("failed");
    write.mockRestore();
    expect(local.getItem(MATCH_HISTORY_KEY)).toBe(bytes);
    expect(loadPendingHistory(session).map((entry) => entry.seed)).toEqual([1]);
  });

  it("a failed saved-history read never replaces existing history with an empty view", async () => {
    const local = new MemoryStorage(),
      session = new MemoryStorage(),
      pending = queue();
    persistHistory(local, result(2));
    const bytes = local.getItem(MATCH_HISTORY_KEY);
    const retained = rememberPendingHistory(pending, result(1), session, local);
    const originalRead = local.getItem.bind(local);
    const read = vi.spyOn(local, "getItem").mockImplementation((key) => {
      if (key === MATCH_HISTORY_KEY) throw new Error("unreadable");
      return originalRead(key);
    });
    expect(
      await persistPendingHistoryEntry(
        pending,
        retained,
        session,
        local,
        manager(),
      ),
    ).toBe("failed");
    read.mockRestore();
    expect(local.getItem(MATCH_HISTORY_KEY)).toBe(bytes);
    expect(pending.has(1)).toBe(true);
  });

  it("a failed readback retains pending even when setItem silently drops the write", async () => {
    const local = new MemoryStorage(),
      session = new MemoryStorage(),
      pending = queue();
    const entry = rememberPendingHistory(pending, result(1), session, local);
    const write = vi
      .spyOn(local, "setItem")
      .mockImplementation(() => undefined);
    expect(
      await persistPendingHistoryEntry(
        pending,
        entry,
        session,
        local,
        manager(),
      ),
    ).toBe("failed");
    expect(pending.has(1)).toBe(true);
    expect(loadPendingHistory(session)[0].finishedAt).toBe(1);
    write.mockRestore();
  });

  it("does not forget a pending result when the same saved seed has different content", async () => {
    const local = new MemoryStorage(),
      session = new MemoryStorage(),
      pending = queue();
    persistHistory(local, result(1, 200));
    const before = local.getItem(MATCH_HISTORY_KEY);
    const entry = rememberPendingHistory(
      pending,
      result(1, 100),
      session,
      local,
    );
    expect(
      await persistPendingHistoryEntry(
        pending,
        entry,
        session,
        local,
        manager(),
      ),
    ).toBe("failed");
    expect(local.getItem(MATCH_HISTORY_KEY)).toBe(before);
    expect(
      loadPendingHistory(session).map(({ seed, finishedAt, players }) => ({
        seed,
        finishedAt,
        players,
      })),
    ).toEqual([result(1, 100)]);
    expect(pending.has(1)).toBe(true);
  });

  it("unknown verified at zero stays known for a later clear even after append fails", async () => {
    const local = new MemoryStorage(),
      session = new MemoryStorage();
    legacy(session, result(1));
    const entry = loadPendingHistory(session)[0];
    const write = vi.spyOn(local, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(
      await persistPendingHistoryEntry(
        new Map([[1, entry]]),
        entry,
        session,
        local,
        manager(),
      ),
    ).toBe("failed");
    write.mockRestore();
    expect(loadPendingHistory(session)[0].historyEpoch).toBe(0);
    // A different tab clears localStorage but cannot clear this tab's session queue.
    expect(await clearResultHistoryAcrossTabs(local, manager(), null)).toBe(
      "cleared",
    );
    const restored = loadPendingHistory(session)[0];
    expect(
      await persistPendingHistoryEntry(
        new Map([[1, restored]]),
        restored,
        session,
        local,
        manager(),
      ),
    ).toBe("cancelled");
    expect(loadHistory(local)).toEqual([]);
  });

  it("capacity failure never replaces newer saved bytes with an unretained old retry", async () => {
    const local = new MemoryStorage(),
      session = new MemoryStorage(),
      pending = queue();
    for (let n = 2; n <= 8; n++) persistHistory(local, result(n));
    const before = local.getItem(MATCH_HISTORY_KEY);
    const retained = rememberPendingHistory(
      pending,
      result(1, 1),
      session,
      local,
    );
    vi.spyOn(local, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    expect(
      await persistPendingHistoryEntry(
        pending,
        retained,
        session,
        local,
        manager(),
      ),
    ).toBe("not-retained");
    expect(local.getItem(MATCH_HISTORY_KEY)).toBe(before);
    expect(session.getItem(PENDING_HISTORY_KEY)).toBeNull();
  });
});
