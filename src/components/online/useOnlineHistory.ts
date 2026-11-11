"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { localStorageOrNull } from "@/components/common/browserStorage";
import type { GameContextValue } from "@/components/game/GameProvider";
import { MAX_HISTORY_ENTRIES } from "@/components/game/matchHistory";
import {
  isOnlineHistoryEntry,
  notifyResultHistoryChanged,
  type OnlineHistoryEntry,
  persistOnlineHistoryAcrossTabs,
} from "@/components/game/resultHistory";
import { CHARACTER_PLAYER_IDS } from "@/domain/game/characters";
import { isOnlineMatchId, type OnlineSnapshot } from "@/domain/online/types";
import {
  forgetPendingOnlineHistory,
  loadPendingOnlineHistory,
  onlineHistorySessionStorage,
  rememberPendingOnlineHistory,
} from "./pendingOnlineHistory";

type SaveStatus = GameContextValue["historySaveStatus"];

/** Save only final public values, in the same p0→p3 order as local v1 results. */
function finishedEntry(snapshot: OnlineSnapshot): OnlineHistoryEntry | null {
  if (snapshot.phase !== "gameEnd" || !isOnlineMatchId(snapshot.matchId))
    return null;
  const results = snapshot.view.result?.players;
  if (results?.length !== CHARACTER_PLAYER_IDS.length) return null;
  const players = CHARACTER_PLAYER_IDS.map((id) => {
    const player = results.find((item) => item.playerId === id);
    if (!player) return null;
    const { name, rank, rawScore, uma, bonus, soshiiTotal } = player;
    return { name, rank, rawScore, uma, bonus, soshiiTotal };
  });
  const entry = {
    onlineMatchId: snapshot.matchId,
    finishedAt: Date.now(),
    players,
  };
  return isOnlineHistoryEntry(entry) ? entry : null;
}

export function useOnlineHistory(
  snapshot: OnlineSnapshot,
  onSaveError?: () => void,
): SaveStatus {
  const [pending] = useState(
    () =>
      new Map(
        loadPendingOnlineHistory(onlineHistorySessionStorage()).map((entry) => [
          entry.onlineMatchId,
          entry,
        ]),
      ),
  );
  const attempts = useRef(new Set<string>());
  const observed = useRef(new Map<string, OnlineHistoryEntry>());
  const active = useRef(false);
  const current = useRef<string | null>(null);
  const errorCallback = useRef(onSaveError);
  const [saved, setSaved] = useState<{ id: string; status: SaveStatus } | null>(
    null,
  );
  const [failedIds, setFailedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const identity =
    snapshot.phase === "gameEnd" &&
    snapshot.view.result !== null &&
    isOnlineMatchId(snapshot.matchId)
      ? snapshot.matchId
      : null;

  useLayoutEffect(() => {
    current.current = identity;
    errorCallback.current = onSaveError;
  }, [identity, onSaveError]);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  const persist = useCallback(
    (entry: OnlineHistoryEntry) => {
      const id = entry.onlineMatchId;
      if (attempts.current.has(id)) return;
      const retained = rememberPendingOnlineHistory(
        pending,
        entry,
        onlineHistorySessionStorage(),
      );
      observed.current.set(id, retained);
      while (observed.current.size > MAX_HISTORY_ENTRIES) {
        const oldest = observed.current.keys().next().value;
        if (oldest === undefined) break;
        observed.current.delete(oldest);
      }
      attempts.current.add(id);
      if (active.current && current.current === id)
        setSaved((previous) =>
          previous?.id === id && previous.status === "failed"
            ? previous
            : { id, status: "pending" },
        );
      const storage = localStorageOrNull();
      const attempt =
        storage === null
          ? Promise.resolve("failed" as const)
          : persistOnlineHistoryAcrossTabs(storage, retained);
      void attempt.then((result) => {
        attempts.current.delete(id);
        const status =
          result === "failed"
            ? "failed"
            : result === "appended" || result === "already-exists"
              ? "saved"
              : "idle";
        if (retained.historyEpoch === null && result !== "failed") {
          // A terminal result proves an unknown capture was verified as zero.
          observed.current.set(id, { ...retained, historyEpoch: 0 });
        }
        if (result !== "failed") {
          forgetPendingOnlineHistory(
            pending,
            id,
            onlineHistorySessionStorage(),
          );
          if (result === "appended") notifyResultHistoryChanged();
        }
        if (active.current) {
          setFailedIds((previous) => {
            const next = new Set(
              [...previous].filter((failedId) => pending.has(failedId)),
            );
            if (result === "failed" && pending.has(id)) next.add(id);
            else next.delete(id);
            return next.size === previous.size &&
              [...next].every((failedId) => previous.has(failedId))
              ? previous
              : next;
          });
        }
        if (active.current && current.current === id) {
          setSaved({ id, status });
          if (status === "failed") {
            try {
              errorCallback.current?.();
            } catch {
              /* Feedback cannot reject a persistence completion. */
            }
          }
        }
      });
    },
    [pending],
  );

  useEffect(() => {
    const entry = finishedEntry(snapshot);
    if (entry !== null) {
      persist(
        observed.current.get(entry.onlineMatchId) ??
          pending.get(entry.onlineMatchId) ??
          entry,
      );
    }
    for (const queued of pending.values()) persist(queued);
  }, [snapshot, pending, persist]);

  useEffect(() => {
    const retry = () => {
      for (const entry of pending.values()) persist(entry);
    };
    try {
      window.addEventListener("focus", retry);
      window.addEventListener("online", retry);
    } catch {
      /* Snapshot/reconnect updates still retry without optional events. */
    }
    return () => {
      try {
        window.removeEventListener("focus", retry);
        window.removeEventListener("online", retry);
      } catch {
        /* Optional host capability. */
      }
    };
  }, [pending, persist]);

  // A new match cannot hide an older retained failure or report it as saved.
  if ([...failedIds].some((id) => pending.has(id))) return "failed";
  return identity === null
    ? "idle"
    : saved?.id === identity
      ? saved.status
      : "pending";
}
