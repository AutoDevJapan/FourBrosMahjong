// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OnlineHistoryEntry } from "@/components/game/resultHistory";
import {
  clearPendingOnlineHistory,
  forgetPendingOnlineHistory,
  loadPendingOnlineHistory,
  PENDING_ONLINE_HISTORY_KEY,
  rememberPendingOnlineHistory,
} from "./pendingOnlineHistory";

function entry(n: number, finishedAt = n): OnlineHistoryEntry {
  return {
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
afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe("pending online results", () => {
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
