import type { CharacterPlayerId } from "./characters";

export type PresentationEventKind =
  | "deal"
  | "draw"
  | "discard"
  | "riichi"
  | "pon"
  | "kan"
  | "kita"
  | "tsumo"
  | "ron"
  | "draw-round"
  | "round-end";

/** Public scalars only. Draw faces are exclusively owned by selectView. */
interface PresentationEvent {
  readonly seq: number;
  readonly actorId: CharacterPlayerId;
  readonly kind: PresentationEventKind;
  readonly roundKey: string;
}

export const MAX_PRESENTATION_EVENTS = 1024;
export interface PresentationBatch {
  readonly events: readonly PresentationEvent[];
  readonly overflow: boolean;
  readonly dropped: number;
}
export const EMPTY_PRESENTATION_BATCH: PresentationBatch = Object.freeze({
  events: Object.freeze([]),
  overflow: false,
  dropped: 0,
});

interface Recorder {
  entered: boolean;
  running: boolean;
  accepted: boolean;
  events: PresentationEvent[];
  dropped: number;
  limit: number;
}

// Synchronous dynamic scope, off by default. Never stored on EngineState or in
// the journal. No observer callback can throw into or reenter the mutable engine.
let active: Recorder | null = null;

/** Engine public-action entry: a fresh transaction, even for rejected actions. */
export function beginPresentationAction(): void {
  if (!active) return;
  if (active.entered)
    throw new Error("Presentation capture requires one public action");
  active.entered = true;
  active.running = true;
  active.events = [];
  active.dropped = 0;
}

export function acceptPresentationAction(accepted: boolean): void {
  if (!active) return;
  active.accepted = accepted;
  active.running = false;
}

/** Engine writes copied, non-secret scalar values; no external code runs here. */
export function recordPresentationEvent(
  kind: PresentationEventKind,
  actorId: CharacterPlayerId,
  roundKey: string,
): void {
  if (!active?.running) return;
  if (active.events.length >= active.limit) {
    active.dropped += 1;
    return;
  }
  active.events.push(
    Object.freeze({ seq: active.events.length + 1, actorId, kind, roundKey }),
  );
}

/** One synchronous public operation, including all CPU work until it returns.
 * The caller owns the returned state. Only its event batch crosses to display.
 * An exception propagates unchanged and always detaches the recorder. Nested
 * capture is rejected before it can run another mutable operation.
 */
export function capturePresentationEvents<State extends object>(
  state: object,
  run: () => State,
  limit = MAX_PRESENTATION_EVENTS,
): PresentationBatch & { readonly state: State } {
  if (active) throw new Error("Nested presentation capture is not supported");
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAX_PRESENTATION_EVENTS
  )
    throw new RangeError("Invalid presentation event limit");
  const recorder: Recorder = {
    entered: false,
    running: false,
    accepted: false,
    events: [],
    dropped: 0,
    limit,
  };
  active = recorder;
  try {
    const next = run();
    if (next === state || !recorder.accepted)
      return { state: next, ...EMPTY_PRESENTATION_BATCH };
    return {
      state: next,
      events: Object.freeze(recorder.events),
      overflow: recorder.dropped > 0,
      dropped: recorder.dropped,
    };
  } finally {
    active = null;
  }
}

/** Counts actual rounds, including repeats; independent of seats/names/seed. */
export function presentationRoundKey(roundsPlayed: number): string {
  return `round-${roundsPlayed}`;
}
