/** Local and online results share one bounded view, without changing v1 bytes. */
import { localStorageOrNull } from "@/components/common/browserStorage";
import { isOnlineMatchId } from "@/domain/online/types";
import { hasOnlyKeys } from "./gamePersistence";
import {
  clearHistory,
  getHistoryViewSnapshot,
  type HistoryClearResult,
  type HistoryLockManager,
  type HistoryPersistenceResult,
  type HistoryViewSnapshot,
  isMatchHistoryResult,
  MATCH_HISTORY_KEY,
  MAX_HISTORY_BYTES,
  MAX_HISTORY_ENTRIES,
  type MatchHistoryEntry,
  notifyHistoryChanged,
  parseHistory,
  resolveLockManager,
  retryHistoryViewSnapshot,
  subscribeHistory,
  withHistoryLock,
} from "./matchHistory";

export const RESULT_HISTORY_KEY = "four-bros-mahjong.history.v2";

export interface OnlineHistoryEntry extends Omit<MatchHistoryEntry, "seed"> {
  readonly onlineMatchId: string;
}
export type ResultHistoryEntry = MatchHistoryEntry | OnlineHistoryEntry;

interface SavedResults {
  readonly version: 2;
  readonly entries: readonly ResultHistoryEntry[];
  /** The last v1 snapshot, so pruned legacy results cannot be imported again. */
  readonly legacySeeds: readonly number[];
}

export function historyEntryId(entry: ResultHistoryEntry): string {
  return "seed" in entry
    ? `local:${entry.seed}`
    : `online:${entry.onlineMatchId}`;
}

export function isOnlineHistoryEntry(
  value: unknown,
): value is OnlineHistoryEntry {
  if (!isMatchHistoryResult(value)) return false;
  const entry = value as unknown as Record<string, unknown>;
  return (
    hasOnlyKeys(entry, ["onlineMatchId", "finishedAt", "players"]) &&
    isOnlineMatchId(entry.onlineMatchId)
  );
}

function isResultEntry(value: unknown): value is ResultHistoryEntry {
  if (isOnlineHistoryEntry(value)) return true;
  // Preserve the exact v1 parser, including its identity and player invariants.
  return (
    parseHistory(JSON.stringify({ version: 1, entries: [value] })) !== null
  );
}

export function parseResultHistory(raw: string): SavedResults | null {
  if (raw.length * 2 > MAX_HISTORY_BYTES) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (
      !value ||
      typeof value !== "object" ||
      !hasOnlyKeys(value, ["version", "entries", "legacySeeds"]) ||
      value.version !== 2 ||
      !Array.isArray(value.entries) ||
      value.entries.length > MAX_HISTORY_ENTRIES ||
      !value.entries.every(isResultEntry) ||
      !Array.isArray(value.legacySeeds) ||
      value.legacySeeds.length > MAX_HISTORY_ENTRIES ||
      !value.legacySeeds.every(
        (seed) => Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff,
      ) ||
      new Set(value.legacySeeds).size !== value.legacySeeds.length
    )
      return null;
    const entries = value.entries as ResultHistoryEntry[];
    if (new Set(entries.map(historyEntryId)).size !== entries.length)
      return null;
    return value as unknown as SavedResults;
  } catch {
    return null;
  }
}

function mergedResults(
  legacy: readonly MatchHistoryEntry[],
  saved: SavedResults | null,
): readonly ResultHistoryEntry[] {
  if (saved === null) return legacy;
  const seen = new Set(saved.legacySeeds);
  const identities = new Set(saved.entries.map(historyEntryId));
  const imported = legacy.filter(
    (entry) => !seen.has(entry.seed) && !identities.has(historyEntryId(entry)),
  );
  return [...imported, ...saved.entries]
    .sort((a, b) => b.finishedAt - a.finishedAt)
    .slice(0, MAX_HISTORY_ENTRIES);
}

export function loadResultHistory(
  storage: Storage,
): readonly ResultHistoryEntry[] {
  const legacyRaw = storage.getItem(MATCH_HISTORY_KEY);
  const raw = storage.getItem(RESULT_HISTORY_KEY);
  return mergedResults(
    legacyRaw === null ? [] : (parseHistory(legacyRaw) ?? []),
    raw === null ? null : parseResultHistory(raw),
  );
}

/** Append is one atomic key write; old-client v1 bytes remain intact. */
export async function persistOnlineHistoryAcrossTabs(
  storage: Storage,
  entry: OnlineHistoryEntry,
  locks?: HistoryLockManager | null,
): Promise<HistoryPersistenceResult> {
  if (!isOnlineHistoryEntry(entry)) return "failed";
  const manager = resolveLockManager(locks);
  if (manager === null) return "failed";
  return withHistoryLock(
    manager,
    (): HistoryPersistenceResult => {
      try {
        const legacyRaw = storage.getItem(MATCH_HISTORY_KEY);
        const legacy =
          legacyRaw === null ? [] : (parseHistory(legacyRaw) ?? []);
        const raw = storage.getItem(RESULT_HISTORY_KEY);
        const saved = raw === null ? null : parseResultHistory(raw);
        const entries = mergedResults(legacy, saved);
        if (
          entries.some(
            (existing) => historyEntryId(existing) === historyEntryId(entry),
          )
        )
          return "already-exists";
        let next = [entry, ...entries].slice(0, MAX_HISTORY_ENTRIES);
        for (;;) {
          const serialized = JSON.stringify({
            version: 2,
            entries: next,
            legacySeeds: legacy.map((item) => item.seed),
          });
          try {
            if (serialized.length * 2 > MAX_HISTORY_BYTES)
              throw new Error("history capacity");
            storage.setItem(RESULT_HISTORY_KEY, serialized);
          } catch {
            if (next.length <= 1) return "failed";
            next = next.slice(0, Math.max(1, Math.floor(next.length / 2)));
            continue;
          }
          try {
            return storage.getItem(RESULT_HISTORY_KEY) === serialized
              ? "appended"
              : "failed";
          } catch {
            return "failed";
          }
        }
      } catch {
        return "failed";
      }
    },
    () => "failed",
  );
}

export async function clearResultHistoryAcrossTabs(
  storage: Storage,
  locks?: HistoryLockManager | null,
): Promise<HistoryClearResult> {
  const clear = (): HistoryClearResult => {
    try {
      if (!clearHistory(storage)) return "storage-failed";
      storage.removeItem(RESULT_HISTORY_KEY);
      return storage.getItem(MATCH_HISTORY_KEY) === null &&
        storage.getItem(RESULT_HISTORY_KEY) === null
        ? "cleared"
        : "storage-failed";
    } catch {
      return "storage-failed";
    }
  };
  const manager = resolveLockManager(locks);
  return manager === null
    ? clear()
    : withHistoryLock(manager, clear, () => "lock-busy");
}

export type ResultHistoryViewSnapshot =
  | {
      readonly status: "ready";
      readonly entries: readonly ResultHistoryEntry[];
    }
  | Exclude<HistoryViewSnapshot, { status: "ready" }>;

const READ_ERROR: ResultHistoryViewSnapshot = Object.freeze({
  status: "read-error",
});
const CORRUPT_CLEANED: ResultHistoryViewSnapshot = Object.freeze({
  status: "corrupt-cleaned",
});
const CORRUPT_RETAINED: ResultHistoryViewSnapshot = Object.freeze({
  status: "corrupt-retained",
});
let corrupt: "corrupt-cleaned" | "corrupt-retained" | null = null;
let cachedLegacy: HistoryViewSnapshot | undefined;
let cachedRaw: string | null | undefined;
let cachedView: ResultHistoryViewSnapshot = READ_ERROR;

function cleanupResultHistory(): void {
  const storage = localStorageOrNull();
  if (storage === null) return;
  try {
    const raw = storage.getItem(RESULT_HISTORY_KEY);
    if (raw === null || parseResultHistory(raw) !== null) return;
    try {
      storage.removeItem(RESULT_HISTORY_KEY);
      corrupt =
        storage.getItem(RESULT_HISTORY_KEY) === null
          ? "corrupt-cleaned"
          : "corrupt-retained";
    } catch {
      corrupt = "corrupt-retained";
    }
  } catch {
    /* The pure snapshot reports the read failure. */
  }
}

/** Pure external-store read; corruption cleanup stays in subscription effects. */
export function getResultHistoryViewSnapshot(): ResultHistoryViewSnapshot {
  const legacy = getHistoryViewSnapshot();
  if (legacy.status !== "ready") return legacy;
  const storage = localStorageOrNull();
  if (storage === null) return READ_ERROR;
  let raw: string | null;
  try {
    raw = storage.getItem(RESULT_HISTORY_KEY);
  } catch {
    return READ_ERROR;
  }
  if (raw === null && corrupt !== null)
    return corrupt === "corrupt-cleaned" ? CORRUPT_CLEANED : CORRUPT_RETAINED;
  if (cachedLegacy === legacy && cachedRaw === raw) return cachedView;
  cachedLegacy = legacy;
  cachedRaw = raw;
  const saved = raw === null ? null : parseResultHistory(raw);
  if (raw !== null && saved === null) return (cachedView = CORRUPT_RETAINED);
  corrupt = null;
  cachedView = Object.freeze({
    status: "ready",
    entries: mergedResults(legacy.entries, saved),
  });
  return cachedView;
}

export function subscribeResultHistory(callback: () => void): () => void {
  cleanupResultHistory();
  const notify = () => {
    try {
      callback();
    } catch {
      /* Isolate an optional subscriber failure. */
    }
  };
  const unsubscribe = subscribeHistory(() => {
    corrupt = null;
    cachedRaw = undefined;
    cleanupResultHistory();
    notify();
  });
  const listener = (event: StorageEvent) => {
    if (event.key !== RESULT_HISTORY_KEY) return;
    corrupt = null;
    cachedRaw = undefined;
    cleanupResultHistory();
    notify();
  };
  try {
    window.addEventListener("storage", listener);
  } catch {
    /* Same-tab updates still work. */
  }
  return () => {
    unsubscribe();
    try {
      window.removeEventListener("storage", listener);
    } catch {
      /* Optional host capability. */
    }
  };
}

export function notifyResultHistoryChanged(): void {
  corrupt = null;
  cachedRaw = undefined;
  notifyHistoryChanged();
}

export function retryResultHistoryViewSnapshot(): void {
  corrupt = null;
  cachedRaw = undefined;
  retryHistoryViewSnapshot();
  cleanupResultHistory();
}

export function getServerResultHistoryViewSnapshot(): ResultHistoryViewSnapshot | null {
  return null;
}
