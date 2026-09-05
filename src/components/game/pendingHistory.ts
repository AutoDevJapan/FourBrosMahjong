/**
 * `localStorage` の保存完了前に次の半荘へ進んだ結果を一時退避する(issue #892)。
 *
 * 保存形式は通常の戦績と同じv1 envelopeを使い、`parseHistory` の検証・件数・容量制限を
 * 共有する。`sessionStorage` は同一タブのスコープなので、別タブの履歴と混ざらず、
 * `/game` 配下のプロバイダが再生成されても再試行できる。
 */
import {
  MAX_HISTORY_ENTRIES,
  type MatchHistoryEntry,
  parseHistory,
} from "./matchHistory";

/** `sessionStorage` 内で、現在のジャーナルとは別に保持する未保存結果のキー。 */
export const PENDING_HISTORY_KEY = "four-bros-mahjong.history-pending.v1";

/** `sessionStorage` を安全に取得する。SSR・Storage無効環境ではnull。 */
function sessionStorageOrNull(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** `sessionStorage` に退避した未保存結果を、戦績と同じ厳密な検証で復元する。 */
export function loadPendingHistory(
  storage: Storage | null,
): readonly MatchHistoryEntry[] {
  if (storage === null) return [];
  try {
    const raw = storage.getItem(PENDING_HISTORY_KEY);
    if (raw === null) return [];
    return parseHistory(raw) ?? [];
  } catch {
    return [];
  }
}

/** 退避結果を保存する。Storage不可でもメモリ内Mapは呼び出し側に残る。 */
function savePendingHistory(
  storage: Storage | null,
  entries: readonly MatchHistoryEntry[],
): void {
  if (storage === null) return;
  try {
    if (entries.length === 0) {
      storage.removeItem(PENDING_HISTORY_KEY);
      return;
    }
    storage.setItem(
      PENDING_HISTORY_KEY,
      JSON.stringify({ version: 1, entries }),
    );
  } catch {
    // 保存不可でも、同一プロバイダ内のMapは結果を保持する。
  }
}

/** 退避件数を履歴上限へ揃え、追加された結果を必ず残す。 */
function orderedPendingHistory(
  pending: ReadonlyMap<number, MatchHistoryEntry>,
): readonly MatchHistoryEntry[] {
  return [...pending.values()].slice(-MAX_HISTORY_ENTRIES);
}

/** 未保存結果をMapとsessionStorageへ追加し、同一seedの再生成は避ける。 */
export function rememberPendingHistory(
  pending: Map<number, MatchHistoryEntry>,
  entry: MatchHistoryEntry,
  storage: Storage | null,
): MatchHistoryEntry {
  const existing = pending.get(entry.seed);
  if (existing !== undefined) return existing;
  pending.set(entry.seed, entry);
  const retained = orderedPendingHistory(pending);
  if (retained.length !== pending.size) {
    pending.clear();
    for (const retainedEntry of retained) {
      pending.set(retainedEntry.seed, retainedEntry);
    }
  }
  savePendingHistory(storage, retained);
  return entry;
}

/** 保存が確認できた結果を退避MapとsessionStorageから取り除く。 */
export function forgetPendingHistory(
  pending: Map<number, MatchHistoryEntry>,
  seed: number,
  storage: Storage | null,
): void {
  if (!pending.delete(seed)) return;
  savePendingHistory(storage, orderedPendingHistory(pending));
}

/** 履歴の明示的な全件削除時に、まだ戦績へ追記されていない結果も捨てる。 */
export function clearPendingHistory(storage?: Storage | null): boolean {
  const resolved = storage === undefined ? sessionStorageOrNull() : storage;
  // この実装が永続化できなかった環境には、sessionStorage上の退避値も存在しない。
  if (resolved === null) return true;
  try {
    resolved.removeItem(PENDING_HISTORY_KEY);
    return resolved.getItem(PENDING_HISTORY_KEY) === null;
  } catch {
    return false;
  }
}
