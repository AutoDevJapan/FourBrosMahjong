import { localStorageOrNull } from "@/components/common/browserStorage";
import { MAX_HISTORY_ENTRIES } from "@/components/game/matchHistory";
import {
  isOnlineHistoryEntry,
  notifyResultHistoryChanged,
  type OnlineHistoryEntry,
  parseResultHistory,
  persistOnlineHistoryAcrossTabs,
  readHistoryEpoch,
} from "@/components/game/resultHistory";

export const PENDING_ONLINE_HISTORY_KEY =
  "four-bros-mahjong.history-online-pending.v2";

export function onlineHistorySessionStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function read(storage: Storage): readonly OnlineHistoryEntry[] {
  const raw = storage.getItem(PENDING_ONLINE_HISTORY_KEY);
  if (raw === null) return [];
  const parsed = parseResultHistory(raw);
  return parsed !== null &&
    parsed.legacySeeds.length === 0 &&
    parsed.entries.every(isOnlineHistoryEntry)
    ? parsed.entries.map((entry) =>
        entry.historyEpoch === undefined
          ? { ...entry, historyEpoch: 0 }
          : entry,
      )
    : [];
}

export function loadPendingOnlineHistory(
  storage: Storage | null,
): readonly OnlineHistoryEntry[] {
  try {
    return storage === null ? [] : read(storage);
  } catch {
    return [];
  }
}

function write(storage: Storage, entries: readonly OnlineHistoryEntry[]): void {
  if (entries.length === 0) storage.removeItem(PENDING_ONLINE_HISTORY_KEY);
  else
    storage.setItem(
      PENDING_ONLINE_HISTORY_KEY,
      JSON.stringify({ version: 2, entries, legacySeeds: [] }),
    );
}

/** Capture once before any async write; storage failure still leaves the Map. */
export function rememberPendingOnlineHistory(
  pending: Map<string, OnlineHistoryEntry>,
  entry: OnlineHistoryEntry,
  storage: Storage | null,
): OnlineHistoryEntry {
  let stored: readonly OnlineHistoryEntry[] | null = null;
  if (storage !== null) {
    try {
      stored = read(storage);
    } catch {
      /* Never overwrite an unreadable queue. */
    }
  }
  const previous =
    stored?.find((item) => item.onlineMatchId === entry.onlineMatchId) ??
    pending.get(entry.onlineMatchId) ??
    entry;
  let currentEpoch: number | null = null;
  try {
    const local = localStorageOrNull();
    if (local !== null) currentEpoch = readHistoryEpoch(local);
  } catch {
    /* Keep an earlier capture while local storage is unreadable. */
  }
  const retained =
    previous.historyEpoch === undefined
      ? { ...previous, historyEpoch: currentEpoch ?? 0 }
      : previous;
  pending.set(entry.onlineMatchId, retained);
  while (pending.size > MAX_HISTORY_ENTRIES) {
    const oldest = pending.keys().next().value;
    if (oldest === undefined) break;
    pending.delete(oldest);
  }
  if (
    storage !== null &&
    stored !== null &&
    (currentEpoch === null || retained.historyEpoch === currentEpoch)
  ) {
    try {
      const merged = new Map(stored.map((item) => [item.onlineMatchId, item]));
      for (const [id, item] of pending)
        if (!merged.has(id)) merged.set(id, item);
      write(storage, [...merged.values()].slice(-MAX_HISTORY_ENTRIES));
    } catch {
      /* Keep pending results in memory and retry on the next event. */
    }
  }
  return retained;
}

/** Remove only this identity from current storage, preserving a newer provider. */
export function forgetPendingOnlineHistory(
  pending: Map<string, OnlineHistoryEntry>,
  id: string,
  storage: Storage | null,
): void {
  pending.delete(id);
  if (storage === null) return;
  try {
    write(
      storage,
      read(storage).filter((entry) => entry.onlineMatchId !== id),
    );
  } catch {
    /* A retained duplicate is harmless: persisted results deduplicate it. */
  }
}

export function clearPendingOnlineHistory(
  storage = onlineHistorySessionStorage(),
  retainEpoch?: number,
): boolean {
  // A browser may have saved pending results before access was revoked.
  // Unreadable storage is not proof that its previous contents were removed.
  if (storage === null) return typeof window === "undefined";
  try {
    if (retainEpoch !== undefined) {
      const retained = read(storage).filter(
        (entry) => entry.historyEpoch === retainEpoch,
      );
      if (retained.length) {
        const raw = JSON.stringify({
          version: 2,
          entries: retained,
          legacySeeds: [],
        });
        storage.setItem(PENDING_ONLINE_HISTORY_KEY, raw);
        return storage.getItem(PENDING_ONLINE_HISTORY_KEY) === raw;
      }
    }
    storage.removeItem(PENDING_ONLINE_HISTORY_KEY);
    return storage.getItem(PENDING_ONLINE_HISTORY_KEY) === null;
  } catch {
    return false;
  }
}

/** Retry independently of a live room, including after its server TTL expired. */
export async function retryPendingOnlineHistory(): Promise<void> {
  const session = onlineHistorySessionStorage();
  const pending = new Map(
    loadPendingOnlineHistory(session).map((entry) => [
      entry.onlineMatchId,
      entry,
    ]),
  );
  if (pending.size === 0) return;
  const storage = localStorageOrNull();
  if (storage === null) return;
  for (const entry of pending.values()) {
    const result = await persistOnlineHistoryAcrossTabs(storage, entry);
    if (result === "failed") continue;
    forgetPendingOnlineHistory(pending, entry.onlineMatchId, session);
    if (result === "appended") notifyResultHistoryChanged();
  }
}
