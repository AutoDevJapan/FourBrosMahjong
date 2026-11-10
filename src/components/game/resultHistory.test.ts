import { describe, expect, it, vi } from "vitest";
import { createLockRequest } from "@/test/webLocksStub";
import {
  type HistoryLockManager,
  MATCH_HISTORY_KEY,
  MAX_HISTORY_BYTES,
  MAX_HISTORY_ENTRIES,
  type MatchHistoryEntry,
  persistHistory,
  persistHistoryAcrossTabs,
} from "./matchHistory";
import {
  clearResultHistoryAcrossTabs,
  historyEntryId,
  loadResultHistory,
  type OnlineHistoryEntry,
  parseResultHistory,
  persistOnlineHistoryAcrossTabs,
  RESULT_HISTORY_KEY,
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

function local(seed: number, finishedAt = seed): MatchHistoryEntry {
  return {
    seed,
    finishedAt,
    players: [1, 2, 3, 4].map((rank) => ({
      name: "同じ名前",
      rank,
      rawScore: 0,
      uma: 0,
      bonus: 0,
      soshiiTotal: 0,
    })),
  };
}
function online(
  sequence: number,
  finishedAt = 100 + sequence,
): OnlineHistoryEntry {
  const result = local(sequence, finishedAt);
  return {
    finishedAt: result.finishedAt,
    players: result.players,
    onlineMatchId: `${"a".repeat(32)}:${sequence}`,
  };
}
function locks(): HistoryLockManager {
  return { request: createLockRequest() as HistoryLockManager["request"] };
}
function serialized(entries: unknown[], legacySeeds: unknown[] = []): string {
  return JSON.stringify({ version: 2, entries, legacySeeds });
}

describe("local and online result history", () => {
  it("keeps v1 bytes and results while saving online without a fake seed", async () => {
    const storage = new MemoryStorage();
    persistHistory(storage, local(1));
    const original = storage.getItem(MATCH_HISTORY_KEY);
    expect(
      await persistOnlineHistoryAcrossTabs(storage, online(1), locks()),
    ).toBe("appended");
    expect(storage.getItem(MATCH_HISTORY_KEY)).toBe(original);
    expect(loadResultHistory(storage)).toEqual([online(1), local(1)]);
    const saved = parseResultHistory(storage.getItem(RESULT_HISTORY_KEY)!);
    expect(saved?.legacySeeds).toEqual([1]);
    expect(saved?.entries[0]).not.toHaveProperty("seed");
    expect(historyEntryId(local(1))).not.toBe(historyEntryId(online(1)));
  });

  it("deduplicates reconnects without rewriting the original completion time", async () => {
    const storage = new MemoryStorage();
    const manager = locks();
    await persistOnlineHistoryAcrossTabs(storage, online(1), manager);
    const write = vi.spyOn(storage, "setItem");
    expect(
      await persistOnlineHistoryAcrossTabs(storage, online(1, 9999), manager),
    ).toBe("already-exists");
    expect(write).not.toHaveBeenCalled();
    expect(loadResultHistory(storage)).toEqual([online(1)]);
    expect(
      await persistOnlineHistoryAcrossTabs(storage, online(2), manager),
    ).toBe("appended");
    expect(loadResultHistory(storage)).toEqual([online(2), online(1)]);
  });

  it("caps the combined results at twenty and never reimports pruned v1 records", async () => {
    const storage = new MemoryStorage();
    for (let seed = 0; seed < MAX_HISTORY_ENTRIES; seed++)
      persistHistory(storage, local(seed));
    const original = storage.getItem(MATCH_HISTORY_KEY);
    const manager = locks();
    for (let n = 1; n <= 21; n++) {
      expect(
        await persistOnlineHistoryAcrossTabs(storage, online(n), manager),
      ).toBe("appended");
    }
    expect(loadResultHistory(storage)).toEqual(
      Array.from({ length: 20 }, (_, i) => online(21 - i)),
    );
    expect(
      parseResultHistory(storage.getItem(RESULT_HISTORY_KEY)!)?.entries,
    ).toHaveLength(20);
    expect(storage.getItem(MATCH_HISTORY_KEY)).toBe(original);
    // A still-open old client writes a new local match to the original v1 key.
    persistHistory(storage, local(99, 999));
    expect(loadResultHistory(storage)[0]).toEqual(local(99, 999));
    await persistOnlineHistoryAcrossTabs(storage, online(22, 1000), manager);
    const current = loadResultHistory(storage);
    expect(current).toHaveLength(20);
    expect(current.slice(0, 2)).toEqual([online(22, 1000), local(99, 999)]);
    expect(new Set(current.map(historyEntryId)).size).toBe(20);
  });

  it("serializes online, local and clear operations using the existing lock name", async () => {
    const storage = new MemoryStorage();
    const request = createLockRequest();
    const names: string[] = [];
    const manager: HistoryLockManager = {
      request: <T>(
        name: string,
        options: Parameters<HistoryLockManager["request"]>[1],
        callback: () => T | PromiseLike<T>,
      ) => {
        names.push(name);
        return request(name, options, callback) as Promise<T>;
      },
    };
    const results = await Promise.all([
      persistOnlineHistoryAcrossTabs(storage, online(1), manager),
      persistHistoryAcrossTabs(storage, local(1), manager),
      persistOnlineHistoryAcrossTabs(storage, online(2), manager),
    ]);
    expect(results).toEqual(["appended", "appended", "appended"]);
    expect(loadResultHistory(storage).map(historyEntryId)).toEqual([
      historyEntryId(online(2)),
      historyEntryId(online(1)),
      historyEntryId(local(1)),
    ]);
    expect(await clearResultHistoryAcrossTabs(storage, manager)).toBe(
      "cleared",
    );
    expect(new Set(names)).toEqual(
      new Set(["four-bros-mahjong.history.write.v1"]),
    );
    expect(storage.getItem(MATCH_HISTORY_KEY)).toBeNull();
    expect(storage.getItem(RESULT_HISTORY_KEY)).toBeNull();
  });

  it("does not write without locks or after an unreadable snapshot", async () => {
    const storage = new MemoryStorage();
    const write = vi.spyOn(storage, "setItem");
    expect(await persistOnlineHistoryAcrossTabs(storage, online(1), null)).toBe(
      "failed",
    );
    vi.spyOn(storage, "getItem").mockImplementation(() => {
      throw new Error("read denied");
    });
    expect(
      await persistOnlineHistoryAcrossTabs(storage, online(1), locks()),
    ).toBe("failed");
    expect(write).not.toHaveBeenCalled();
  });

  it("keeps previous bytes on storage failure and rejects silent no-op writes", async () => {
    const storage = new MemoryStorage();
    const manager = locks();
    persistHistory(storage, local(1));
    await persistOnlineHistoryAcrossTabs(storage, online(1), manager);
    const before = [
      storage.getItem(MATCH_HISTORY_KEY),
      storage.getItem(RESULT_HISTORY_KEY),
    ];
    const write = vi.spyOn(storage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(
      await persistOnlineHistoryAcrossTabs(storage, online(2), manager),
    ).toBe("failed");
    expect([
      storage.getItem(MATCH_HISTORY_KEY),
      storage.getItem(RESULT_HISTORY_KEY),
    ]).toEqual(before);
    write.mockImplementation(() => undefined);
    expect(
      await persistOnlineHistoryAcrossTabs(storage, online(2), manager),
    ).toBe("failed");
    expect([
      storage.getItem(MATCH_HISTORY_KEY),
      storage.getItem(RESULT_HISTORY_KEY),
    ]).toEqual(before);
  });

  it("keeps the newest result under quota pressure and never edits the v1 backup", async () => {
    const storage = new MemoryStorage();
    for (let n = 1; n <= 8; n++) persistHistory(storage, local(n));
    const original = storage.getItem(MATCH_HISTORY_KEY);
    const set = storage.setItem.bind(storage);
    vi.spyOn(storage, "setItem").mockImplementation((key, value) => {
      if (key === RESULT_HISTORY_KEY && JSON.parse(value).entries.length > 2)
        throw new Error("quota");
      set(key, value);
    });
    expect(
      await persistOnlineHistoryAcrossTabs(storage, online(1), locks()),
    ).toBe("appended");
    expect(loadResultHistory(storage)).toHaveLength(2);
    expect(loadResultHistory(storage)[0]).toEqual(online(1));
    expect(storage.getItem(MATCH_HISTORY_KEY)).toBe(original);
  });

  it("does not shrink or retry a successful write when only its readback fails", async () => {
    const storage = new MemoryStorage();
    persistHistory(storage, local(1));
    const get = storage.getItem.bind(storage);
    const set = storage.setItem.bind(storage);
    let written = false;
    const write = vi
      .spyOn(storage, "setItem")
      .mockImplementation((key, raw) => {
        set(key, raw);
        written = true;
      });
    vi.spyOn(storage, "getItem").mockImplementation((key) => {
      if (key === RESULT_HISTORY_KEY && written)
        throw new Error("read denied after write");
      return get(key);
    });
    expect(
      await persistOnlineHistoryAcrossTabs(storage, online(1), locks()),
    ).toBe("failed");
    expect(write).toHaveBeenCalledTimes(1);
    expect(parseResultHistory(get(RESULT_HISTORY_KEY)!)?.entries).toEqual([
      online(1),
      local(1),
    ]);
  });

  it("does not clear while the shared lock rejects and checks removal readback", async () => {
    const storage = new MemoryStorage();
    persistHistory(storage, local(1));
    await persistOnlineHistoryAcrossTabs(storage, online(1), locks());
    const before = [
      storage.getItem(MATCH_HISTORY_KEY),
      storage.getItem(RESULT_HISTORY_KEY),
    ];
    const unavailable: HistoryLockManager = {
      request: async () => {
        throw new Error("busy");
      },
    };
    expect(await clearResultHistoryAcrossTabs(storage, unavailable)).toBe(
      "lock-busy",
    );
    expect([
      storage.getItem(MATCH_HISTORY_KEY),
      storage.getItem(RESULT_HISTORY_KEY),
    ]).toEqual(before);
    vi.spyOn(storage, "removeItem").mockImplementation(() => undefined);
    expect(await clearResultHistoryAcrossTabs(storage, null)).toBe(
      "storage-failed",
    );
  });

  it.each([
    [online(0)],
    [{ ...online(1), seed: 1 }],
    [{ ...online(1), finishedAt: Infinity }],
    [{ ...online(1), players: [] }],
    [online(1), online(1)],
    [local(1), local(1)],
  ])(
    "rejects corrupt identities, values and duplicate entries %#",
    (...entries) => {
      expect(parseResultHistory(serialized(entries))).toBeNull();
    },
  );

  it("rejects excessive metadata, unknown keys and oversized values before parse", () => {
    expect(parseResultHistory(serialized([], [1, 1]))).toBeNull();
    expect(
      parseResultHistory(
        serialized(
          [],
          Array.from({ length: 21 }, (_, i) => i),
        ),
      ),
    ).toBeNull();
    expect(
      parseResultHistory(
        JSON.stringify({ version: 2, entries: [], legacySeeds: [], secret: 1 }),
      ),
    ).toBeNull();
    expect(
      parseResultHistory(" ".repeat(MAX_HISTORY_BYTES / 2 + 1)),
    ).toBeNull();
  });
});
