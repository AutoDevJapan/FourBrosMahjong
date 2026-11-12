import type { DisplayEnvelope } from "@/domain/display/displaySnapshot";
import {
  type CharacterPlayerId,
  isCharacterPlayerId,
} from "@/domain/game/characters";
import { CHARACTER_CLIPS, sampleCharacterPose } from "./clips";
import { createCharacterModel } from "./model";
import type { CharacterClipId, CharacterModel, CharacterPose } from "./types";

type CharacterCueKind =
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
export interface CharacterCue {
  readonly id: string;
  readonly actorId: CharacterPlayerId;
  readonly kind: CharacterCueKind;
  readonly sessionId: string;
  readonly generation: number;
  readonly revision: number;
  readonly roundKey: string;
}
const CUE_CLIPS: Readonly<Record<CharacterCueKind, CharacterClipId>> = {
  deal: "deal",
  draw: "draw",
  discard: "discard",
  riichi: "declare",
  pon: "call",
  kan: "call",
  kita: "kita",
  tsumo: "win-tsumo",
  ron: "win-ron",
  "draw-round": "draw-round",
  "round-end": "round-end",
};
export interface CharacterActorFrame {
  readonly playerId: CharacterPlayerId;
  readonly position: DisplayEnvelope["snapshot"]["slots"][number]["position"];
  readonly kind: "bench" | "seated";
  readonly model: CharacterModel;
  readonly pose: CharacterPose;
}
interface QueuedGesture {
  readonly clip: CharacterClipId;
  readonly at: number;
  readonly end: number;
  readonly rate: number;
}
const MAX_ACTOR_CUES = 1024;
const MAX_CHARACTER_CUE_LAG_SECONDS = 4;

/** Public presentation only. Host owns a single clock and all GL/RAF resources. */
export function createCharacterController() {
  let closed = false,
    current: DisplayEnvelope | null = null,
    round = "",
    clock = 0,
    baselineAt = 0;
  const models = new Map<CharacterPlayerId, CharacterModel>(),
    seen = new Set<string>();
  const queues = new Map<CharacterPlayerId, QueuedGesture[]>();
  const tick = (now: number) => {
    if (!Number.isFinite(now) || now < clock || now < 0)
      throw new TypeError("Character clock must be monotonic seconds");
    clock = now;
  };
  return {
    publish(
      envelope: DisplayEnvelope,
      cues: readonly CharacterCue[],
      roundKey: string,
      now: number,
    ): "published" | "stale" | "unchanged" | "closed" {
      if (closed) return "closed";
      tick(now);
      if (
        !envelope.sessionId ||
        envelope.sessionId.length > 96 ||
        !Number.isSafeInteger(envelope.generation) ||
        envelope.generation < 1 ||
        !Number.isSafeInteger(envelope.revision) ||
        envelope.revision < 0 ||
        (envelope.mode !== "restore" && envelope.mode !== "live")
      )
        throw new TypeError("Invalid character envelope source");
      if (!roundKey || roundKey.length > 192)
        throw new TypeError("Expected a bounded committed round key");
      const slots = envelope.snapshot.slots;
      if (
        slots.length !== 4 ||
        new Set(slots.map((s) => s.playerId)).size !== 4 ||
        slots.some((s) => !isCharacterPlayerId(s.playerId)) ||
        slots.filter((s) => s.kind === "bench").length !== 1
      )
        throw new TypeError("Expected four stable character IDs and one bench");
      if (
        current &&
        (envelope.generation < current.generation ||
          (envelope.generation === current.generation &&
            envelope.sessionId !== current.sessionId) ||
          (envelope.generation === current.generation &&
            envelope.sessionId === current.sessionId &&
            envelope.revision < current.revision))
      )
        return "stale";
      if (
        current &&
        envelope.sessionId === current.sessionId &&
        envelope.generation === current.generation &&
        envelope.revision === current.revision
      )
        return "unchanged";
      // A round change is NOT a restore: new live deal cues must be played.
      const history = !current || envelope.mode === "restore";
      const identityChanged =
        !current ||
        current.sessionId !== envelope.sessionId ||
        current.generation !== envelope.generation;
      if (history || identityChanged) seen.clear();
      if (history || identityChanged || round !== roundKey) baselineAt = now;
      // Each committed revision interrupts obsolete active/pending gestures.
      // The game never waits for animation or drains old CPU history first.
      queues.clear();
      current = envelope;
      round = roundKey;
      const clips = new Map<CharacterPlayerId, CharacterClipId[]>();
      for (const cue of cues) {
        if (
          !cue.id ||
          cue.id.length > 96 ||
          seen.has(cue.id) ||
          !isCharacterPlayerId(cue.actorId) ||
          cue.sessionId !== envelope.sessionId ||
          cue.generation !== envelope.generation ||
          cue.revision !== envelope.revision ||
          cue.roundKey !== round ||
          !Object.hasOwn(CUE_CLIPS, cue.kind) ||
          !slots.some((s) => s.playerId === cue.actorId && s.kind === "seated")
        )
          continue;
        if (seen.size >= 4096) seen.delete(seen.values().next().value!);
        seen.add(cue.id);
        if (history || envelope.cueStatus?.overflow) continue;
        const actor = clips.get(cue.actorId) ?? [];
        actor.push(CUE_CLIPS[cue.kind]);
        if (actor.length > MAX_ACTOR_CUES) actor.shift();
        clips.set(cue.actorId, actor);
      }
      for (const [id, actor] of clips) {
        const duration = actor.reduce(
            (sum, clip) => sum + CHARACTER_CLIPS[clip].duration,
            0,
          ),
          rate = Math.max(1, duration / MAX_CHARACTER_CUE_LAG_SECONDS);
        let at = now;
        queues.set(
          id,
          actor.map((clip) => {
            const end = at + CHARACTER_CLIPS[clip].duration / rate,
              gesture = { clip, at, end, rate };
            at = end;
            return gesture;
          }),
        );
      }
      return "published";
    },
    sample(now: number, reducedMotion = false): readonly CharacterActorFrame[] {
      if (closed || !current) return [];
      tick(now);
      return current.snapshot.slots.map((slot) => {
        let model = models.get(slot.playerId);
        if (!model) {
          model = createCharacterModel(slot.playerId);
          models.set(slot.playerId, model);
        }
        const queue = queues.get(slot.playerId);
        while (queue?.length && now >= queue[0].end) queue.shift();
        const action = queue?.[0],
          idle = slot.kind === "bench" ? "bench-idle" : "seated-idle";
        return {
          playerId: slot.playerId,
          position: slot.position,
          kind: slot.kind,
          model,
          pose: sampleCharacterPose(
            model,
            action?.clip ?? idle,
            action ? (now - action.at) * action.rate : now - baselineAt,
            reducedMotion,
          ),
        };
      });
    },
    dispose() {
      if (closed) return;
      closed = true;
      current = null;
      queues.clear();
      seen.clear();
      models.clear();
    },
  };
}
