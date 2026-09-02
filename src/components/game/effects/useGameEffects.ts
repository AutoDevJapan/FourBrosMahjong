import { useEffect, useMemo, useRef, useState } from "react";
import type { GamePhase, RoundSummary } from "@/domain/game/engine";
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
  const nextEventIdRef = useRef(0);
  const [activeEffect, setActiveEffect] = useState<ActiveGameEffect | null>(
    null,
  );

  useEffect(() => {
    const previous = previousSnapshotRef.current;
    previousSnapshotRef.current = snapshot;
    if (previous === null) return;

    const next = gameEffectForTransition(previous, snapshot, roundSummary);
    if (next === null) {
      // Starting a new round or a new game should not leave the previous cue
      // floating over the fresh table.
      setActiveEffect(null);
      return;
    }

    nextEventIdRef.current += 1;
    setActiveEffect({ ...next, eventId: nextEventIdRef.current });
  }, [roundSummary, snapshot]);

  useEffect(() => {
    if (activeEffect === null) return;
    const timer = window.setTimeout(
      () => setActiveEffect(null),
      GAME_EFFECT_DURATION_MS,
    );
    return () => window.clearTimeout(timer);
  }, [activeEffect]);

  return activeEffect;
}
