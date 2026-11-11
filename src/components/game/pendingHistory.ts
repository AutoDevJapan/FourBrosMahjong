/**
 * `localStorage` の保存完了前に次の半荘へ進んだ結果を一時退避する(issue #892)。
 *
 * 保存形式は通常の戦績と同じv1 envelopeを使い、`parseHistory` の検証・件数・容量制限を
 * 共有する。`sessionStorage` は同一タブのスコープなので、別タブの履歴と混ざらず、
 * `/game` 配下のプロバイダが再生成されても再試行できる。
 */
import { localStorageOrNull } from "@/components/common/browserStorage";
import { hasOnlyKeys } from "./gamePersistence";
import { readHistoryEpoch } from "./historyEpoch";
import {
  type HistoryLockManager,
  loadHistory,
  MATCH_HISTORY_KEY,
  MAX_HISTORY_BYTES,
  MAX_HISTORY_ENTRIES,
  type MatchHistoryEntry,
  notifyHistoryChanged,
  parseHistory,
  persistHistory,
  resolveLockManager,
  withHistoryLock,
} from "./matchHistory";

/** `sessionStorage` 内で、現在のジャーナルとは別に保持する未保存結果のキー。 */
export const PENDING_HISTORY_KEY = "four-bros-mahjong.history-pending.v1";
export const PENDING_HISTORY_EPOCHS_KEY =
  "four-bros-mahjong.history-pending-epochs.v1";
/** Capture provenance survives successful saves and explicit history deletion. */
export const CAPTURED_HISTORY_KEY = "four-bros-mahjong.history-captures.v1";

/** The v1 result bytes stay unchanged; capture metadata is stored separately. */
export interface PendingHistoryEntry extends MatchHistoryEntry {
  historyEpoch: number | null;
  stored: boolean;
}

interface EpochAssociation {
  result: MatchHistoryEntry;
  epoch: number | null;
}

const sameEntry = (a: MatchHistoryEntry, b: MatchHistoryEntry) =>
  a.seed === b.seed &&
  a.finishedAt === b.finishedAt &&
  JSON.stringify(a.players) === JSON.stringify(b.players);

function resultOnly(entry: MatchHistoryEntry): MatchHistoryEntry {
  const { seed, finishedAt, players } = entry;
  return { seed, finishedAt, players };
}

/** `sessionStorage` を安全に取得する。SSR・Storage無効環境ではnull。 */
export function pendingHistorySessionStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function readAssociations(
  storage: Storage,
  key = PENDING_HISTORY_EPOCHS_KEY,
): readonly EpochAssociation[] {
  const raw = storage.getItem(key);
  if (raw === null) return [];
  if (raw.length * 2 > MAX_HISTORY_BYTES + 4096)
    throw new Error("Invalid epochs");
  const value = JSON.parse(raw);
  if (
    !value ||
    !hasOnlyKeys(value, ["version", "entries"]) ||
    value.version !== 1 ||
    !Array.isArray(value.entries) ||
    value.entries.length > MAX_HISTORY_ENTRIES ||
    !value.entries.every(
      (entry: EpochAssociation) =>
        entry &&
        typeof entry === "object" &&
        hasOnlyKeys(entry as unknown as Record<string, unknown>, [
          "result",
          "epoch",
        ]) &&
        (entry.epoch === null ||
          (Number.isSafeInteger(entry.epoch) && entry.epoch >= 0)),
    ) ||
    parseHistory(
      JSON.stringify({
        version: 1,
        entries: value.entries.map((entry: EpochAssociation) => entry.result),
      }),
    ) === null
  )
    throw new Error("Invalid epochs");
  return value.entries;
}

function sameResult(a: MatchHistoryEntry, b: MatchHistoryEntry): boolean {
  return (
    a.seed === b.seed && JSON.stringify(a.players) === JSON.stringify(b.players)
  );
}

function retainCapture(
  storage: Storage | null,
  entry: PendingHistoryEntry,
): void {
  if (storage === null) return;
  try {
    const previous = readAssociations(storage, CAPTURED_HISTORY_KEY);
    const next = [
      ...previous.filter((item) => item.result.seed !== entry.seed),
      { result: resultOnly(entry), epoch: entry.historyEpoch },
    ].slice(-MAX_HISTORY_ENTRIES);
    storage.setItem(
      CAPTURED_HISTORY_KEY,
      JSON.stringify({ version: 1, entries: next }),
    );
  } catch {
    // A later restore without readable provenance cannot assume a post-clear epoch.
  }
}

/** Read failure is distinct from an empty queue inside a write transaction. */
function readPending(storage: Storage): readonly PendingHistoryEntry[] {
  const raw = storage.getItem(PENDING_HISTORY_KEY);
  if (raw === null) return [];
  const entries = parseHistory(raw);
  if (entries === null) throw new Error("Invalid pending history");
  let associations: readonly EpochAssociation[] = [];
  try {
    associations = readAssociations(storage);
  } catch {
    // A two-key partial write must not attach a current epoch to old bytes.
  }
  return entries.map((entry) => ({
    ...entry,
    historyEpoch:
      associations.find((item) => sameEntry(item.result, entry))?.epoch ?? null,
    stored: true,
  }));
}

/** `sessionStorage` に退避した未保存結果を、戦績と同じ厳密な検証で復元する。 */
export function loadPendingHistory(
  storage: Storage | null,
): readonly PendingHistoryEntry[] {
  if (storage === null) return [];
  try {
    return readPending(storage);
  } catch {
    return [];
  }
}

/** 退避結果を保存する。Storage不可でもメモリ内Mapは呼び出し側に残る。 */
function savePendingHistory(
  storage: Storage | null,
  entries: readonly PendingHistoryEntry[],
): boolean {
  if (storage === null) return false;
  try {
    if (entries.length === 0) {
      storage.removeItem(PENDING_HISTORY_KEY);
      storage.removeItem(PENDING_HISTORY_EPOCHS_KEY);
      return (
        storage.getItem(PENDING_HISTORY_KEY) === null &&
        storage.getItem(PENDING_HISTORY_EPOCHS_KEY) === null
      );
    }
    const epochs = JSON.stringify({
      version: 1,
      entries: entries.map((entry) => ({
        result: resultOnly(entry),
        epoch: entry.historyEpoch,
      })),
    });
    const raw = JSON.stringify({
      version: 1,
      entries: entries.map(resultOnly),
    });
    storage.setItem(PENDING_HISTORY_KEY, raw);
    storage.setItem(PENDING_HISTORY_EPOCHS_KEY, epochs);
    return (
      storage.getItem(PENDING_HISTORY_KEY) === raw &&
      storage.getItem(PENDING_HISTORY_EPOCHS_KEY) === epochs
    );
  } catch {
    return false;
  }
}

/** 未保存結果をMapとsessionStorageへ追加し、同一seedの再生成は避ける。 */
export function rememberPendingHistory(
  pending: Map<number, PendingHistoryEntry>,
  entry: MatchHistoryEntry,
  storage: Storage | null,
  local = localStorageOrNull(),
  source: "live" | "restored" = "live",
): PendingHistoryEntry {
  const existing = pending.get(entry.seed);
  if (existing !== undefined) return existing;
  // Capture before reading any saved result. Another tab may clear after that
  // read, so this exact epoch must reach the eventual locked comparison.
  let epoch: number | null = null;
  try {
    if (local !== null) epoch = readHistoryEpoch(local);
  } catch {
    // Unknown is not a new capture in the currently visible generation.
  }
  let current: readonly PendingHistoryEntry[] | null = null;
  try {
    if (storage !== null) current = readPending(storage);
  } catch {
    // Do not overwrite a queue whose current contents cannot be read.
  }
  let captured: EpochAssociation | undefined;
  let captureReadable = storage !== null;
  try {
    if (storage !== null) {
      captured = readAssociations(storage, CAPTURED_HISTORY_KEY).find((item) =>
        sameResult(item.result, entry),
      );
    }
  } catch {
    captureReadable = false;
  }
  let restoredResult = resultOnly(entry);
  let restoredEpoch = epoch;
  if (source === "restored") {
    restoredResult = captured?.result ?? restoredResult;
    restoredEpoch = captured?.epoch ?? null;
    try {
      const raw = local?.getItem(MATCH_HISTORY_KEY);
      const saved = raw == null ? [] : parseHistory(raw);
      const original = saved?.find((item) => sameResult(item, entry));
      if (original !== undefined) {
        // A failed capture-key update may leave an older same-seed origin.
        // The saved payload is authoritative, but its read must retain the
        // epoch captured above so an intervening clear still cancels it.
        restoredResult = original;
        restoredEpoch = captureReadable ? epoch : null;
      } else if (
        captured === undefined &&
        captureReadable &&
        saved !== null &&
        epoch === 0
      ) {
        // No successful clear occurred, so a legacy journal can establish E0.
        restoredEpoch = 0;
      }
    } catch {
      // Keep the original payload as unverified; never promote it to now.
    }
  }
  const retained = current?.find((item) => item.seed === entry.seed) ?? {
    ...restoredResult,
    historyEpoch: restoredEpoch,
    stored: false,
  };
  retainCapture(storage, retained);
  pending.set(entry.seed, retained);
  while (pending.size > MAX_HISTORY_ENTRIES) {
    const oldest = pending.keys().next().value;
    if (oldest === undefined) break;
    pending.delete(oldest);
  }
  if (current !== null) {
    const merged = new Map(current.map((item) => [item.seed, item]));
    for (const item of pending.values()) {
      // Persist only captures that never reached storage; an old provider Map
      // must not bring back an entry that another view explicitly removed.
      if (!item.stored && !merged.has(item.seed)) merged.set(item.seed, item);
    }
    const retainedEntries = [...merged.values()].slice(-MAX_HISTORY_ENTRIES);
    if (savePendingHistory(storage, retainedEntries)) {
      for (const item of pending.values()) {
        if (retainedEntries.some((saved) => sameEntry(saved, item)))
          item.stored = true;
      }
    }
  }
  return retained;
}

/** 保存が確認できた結果を退避MapとsessionStorageから取り除く。 */
export function forgetPendingHistory(
  pending: Map<number, PendingHistoryEntry>,
  entry: MatchHistoryEntry,
  storage: Storage | null,
): void {
  const previous = pending.get(entry.seed);
  if (previous && sameEntry(previous, entry)) pending.delete(entry.seed);
  if (storage === null) return;
  try {
    savePendingHistory(
      storage,
      readPending(storage).filter((item) => !sameEntry(item, entry)),
    );
  } catch {
    // A retained duplicate is harmless; successful writes deduplicate by seed.
  }
}

type PendingHistoryResult = "saved" | "failed" | "cancelled" | "not-retained";

/** Provider and history visits share this one lock/epoch/write boundary. */
export async function persistPendingHistoryEntry(
  pending: Map<number, PendingHistoryEntry>,
  entry: PendingHistoryEntry,
  session: Storage | null,
  storage = localStorageOrNull(),
  locks?: HistoryLockManager | null,
): Promise<PendingHistoryResult> {
  const manager = resolveLockManager(locks);
  if (storage === null || manager === null) return "failed";
  let changed = false;
  const result = await withHistoryLock<PendingHistoryResult>(
    manager,
    () => {
      try {
        const current = pending.get(entry.seed);
        if (!current || !sameEntry(current, entry)) return "cancelled";
        const epoch = readHistoryEpoch(storage);
        if (entry.historyEpoch === null) {
          if (epoch !== 0) return "failed";
          entry.historyEpoch = 0;
          retainCapture(session, entry);
        }
        if (entry.historyEpoch !== epoch) {
          forgetPendingHistory(pending, entry, session);
          return "cancelled";
        }
        if (entry.stored) {
          if (session === null) return "failed";
          const live = readPending(session);
          if (!live.some((item) => sameEntry(item, entry))) {
            forgetPendingHistory(pending, entry, session);
            return "cancelled";
          }
          // Keep an epoch-zero verification across reloads even if append
          // subsequently fails. A failed metadata write stays unknown on disk.
          if (
            live.some(
              (item) => sameEntry(item, entry) && item.historyEpoch === null,
            )
          ) {
            savePendingHistory(
              session,
              live.map((item) =>
                sameEntry(item, entry)
                  ? { ...item, historyEpoch: entry.historyEpoch }
                  : item,
              ),
            );
          }
        }
        const saved = persistHistory(storage, resultOnly(entry));
        if (saved === "failed") return "failed";
        if (saved === "not-retained") {
          forgetPendingHistory(pending, entry, session);
          return "not-retained";
        }
        if (!loadHistory(storage).some((item) => sameEntry(item, entry)))
          return "failed";
        changed = saved === "appended";
        forgetPendingHistory(pending, entry, session);
        return "saved";
      } catch {
        return "failed";
      }
    },
    () => "failed",
  );
  if (changed) notifyHistoryChanged();
  return result;
}

/** Recover a local result without re-entering or replacing the current game. */
export async function retryPendingLocalHistory(): Promise<void> {
  const session = pendingHistorySessionStorage();
  const pending = new Map(
    loadPendingHistory(session).map((entry) => [entry.seed, entry]),
  );
  for (const entry of pending.values())
    await persistPendingHistoryEntry(pending, entry, session);
}

/** 履歴の明示的な全件削除時に、まだ戦績へ追記されていない結果も捨てる。 */
export function clearPendingHistory(storage?: Storage | null): boolean {
  const resolved =
    storage === undefined ? pendingHistorySessionStorage() : storage;
  if (resolved === null) return typeof window === "undefined";
  try {
    resolved.removeItem(PENDING_HISTORY_KEY);
    resolved.removeItem(PENDING_HISTORY_EPOCHS_KEY);
    return (
      resolved.getItem(PENDING_HISTORY_KEY) === null &&
      resolved.getItem(PENDING_HISTORY_EPOCHS_KEY) === null
    );
  } catch {
    return false;
  }
}
