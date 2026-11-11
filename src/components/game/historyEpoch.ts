/** Shared invalidation marker for local and online pending results. */
export const HISTORY_EPOCH_KEY = "four-bros-mahjong.history-epoch.v1";

export function readHistoryEpoch(storage: Storage): number {
  const raw = storage.getItem(HISTORY_EPOCH_KEY);
  if (raw === null) return 0;
  if (raw.length > 16) throw new Error("Invalid history epoch");
  const value = Number(raw);
  if (!/^(0|[1-9][0-9]{0,15})$/.test(raw) || !Number.isSafeInteger(value))
    throw new Error("Invalid history epoch");
  return value;
}
