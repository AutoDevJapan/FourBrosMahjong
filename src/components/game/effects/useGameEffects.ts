import { useEffect, useMemo, useRef, useState } from "react";
import type { GamePhase, RoundSummary } from "@/domain/game/engine";
import { clearTimeoutSafely, trySetTimeout } from "../../common/browserTimer";
import type { GameViewState } from "../types";
import {
  createGameEffectSnapshot,
  type GameEffect,
  gameEffectForTransition,
} from "./gameEffect";

const GAME_EFFECT_DURATION_MS = 1_200;

export interface ActiveGameEffect extends GameEffect {
  readonly eventId: number;
}

/**
 * Convert committed presentation-state changes into a short-lived visual cue.
 * The first committed snapshot is only a baseline, so restored games stay quiet.
 */
export function useGameEffects(
  view: GameViewState,
  phase: GamePhase,
  roundSummary: RoundSummary | null,
): ActiveGameEffect | null {
  const snapshot = useMemo(
    () => createGameEffectSnapshot(view, phase, roundSummary),
    [view, phase, roundSummary],
  );
  const previousSnapshotRef = useRef<typeof snapshot | null>(null);
  const processedStateKeyRef = useRef<string | null>(null);
  const nextEventIdRef = useRef(0);
  const [activeEffect, setActiveEffect] = useState<ActiveGameEffect | null>(
    null,
  );

  useEffect(() => {
    // Context providers may publish a new object for a semantically identical
    // view. Treat the state key as the commit boundary so StrictMode and
    // unrelated renders cannot manufacture a second cue.
    if (processedStateKeyRef.current === snapshot.stateKey) return;
    processedStateKeyRef.current = snapshot.stateKey;

    const previous = previousSnapshotRef.current;
    previousSnapshotRef.current = snapshot;
    if (previous === null) return;

    const next = gameEffectForTransition(previous, snapshot, roundSummary);
    if (next === null) {
      // An untracked same-round update should not cut a cue short. A scope
      // change, however, is a hard reset for the previous round/game.
      if (previous.scopeKey !== snapshot.scopeKey) setActiveEffect(null);
      return;
    }

    nextEventIdRef.current += 1;
    setActiveEffect({ ...next, eventId: nextEventIdRef.current });
  }, [roundSummary, snapshot]);

  useEffect(() => {
    if (activeEffect === null) return;
    const timer = trySetTimeout(
      () => setActiveEffect(null),
      GAME_EFFECT_DURATION_MS,
    );
    if (timer === null) {
      // Registration failed after this render committed. Clear the optional
      // cue in the next microtask so the failed capability never leaves it up.
      void Promise.resolve().then(() => setActiveEffect(null));
    }
    return () => clearTimeoutSafely(timer);
  }, [activeEffect]);

  // The effect state update runs after the new table has rendered. Scope the
  // return value as well so a previous-round overlay cannot flash over a fresh
  // round during that one render.
  return activeEffect?.scopeKey === snapshot.scopeKey ? activeEffect : null;
}
