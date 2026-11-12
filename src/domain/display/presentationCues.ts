import {
  type CharacterPlayerId,
  isCharacterPlayerId,
} from "@/domain/game/characters";
import {
  MAX_PRESENTATION_EVENTS,
  type PresentationBatch,
  type PresentationEventKind,
  presentationRoundKey,
} from "@/domain/game/presentationEvents";
import { type LocalDisplaySource, sameDisplaySource } from "./displaySource";

export interface CommittedPresentation extends PresentationBatch {
  readonly source: LocalDisplaySource;
  readonly roundKey: string;
}

/** Matches the character controller contract without depending on a renderer. */
export interface PresentationCue {
  readonly id: string;
  readonly actorId: CharacterPlayerId;
  readonly kind: PresentationEventKind;
  readonly sessionId: string;
  readonly generation: number;
  readonly revision: number;
  readonly roundKey: string;
}

const KINDS = new Set<PresentationEventKind>([
  "deal",
  "draw",
  "discard",
  "riichi",
  "pon",
  "kan",
  "kita",
  "tsumo",
  "ron",
  "draw-round",
  "round-end",
]);

export function commitPresentation(
  source: LocalDisplaySource,
  roundsPlayed: number,
  batch: PresentationBatch,
): CommittedPresentation {
  return Object.freeze({
    source,
    roundKey: presentationRoundKey(roundsPlayed),
    events: batch.events,
    overflow: batch.overflow,
    dropped: batch.dropped,
  });
}

/** Copy an explicit allowlist. Even contaminated input cannot add secret data. */
export function projectPresentation(
  source: LocalDisplaySource,
  presentation: CommittedPresentation | undefined,
  mode: "restore" | "live",
) {
  if (presentation && !sameDisplaySource(source, presentation.source))
    throw new TypeError("Presentation belongs to another display revision");
  const roundKey = presentation?.roundKey ?? "round-0";
  if (!/^round-(0|[1-9]\d*)$/.test(roundKey) || roundKey.length > 32)
    throw new TypeError("Invalid presentation round key");
  const events = presentation?.events ?? [];
  const dropped = presentation?.dropped ?? 0;
  const overflow = presentation?.overflow ?? false;
  if (
    events.length > MAX_PRESENTATION_EVENTS ||
    !Number.isSafeInteger(dropped) ||
    dropped < 0 ||
    overflow !== dropped > 0
  )
    throw new TypeError("Invalid presentation event batch");
  const cues: PresentationCue[] = [];
  // A restore is a baseline, including a late subscriber at a live revision.
  if (mode === "live")
    for (const event of events) {
      if (
        event.seq !== cues.length + 1 ||
        !isCharacterPlayerId(event.actorId) ||
        !KINDS.has(event.kind) ||
        event.roundKey !== roundKey
      )
        throw new TypeError("Invalid presentation event sequence/owner");
      cues.push({
        id: `${source.generation}:${source.revision}:${event.seq}`,
        actorId: event.actorId,
        kind: event.kind,
        sessionId: source.sessionId,
        generation: source.generation,
        revision: source.revision,
        roundKey,
      });
    }
  return { roundKey, cues, cueStatus: { overflow, dropped } };
}
