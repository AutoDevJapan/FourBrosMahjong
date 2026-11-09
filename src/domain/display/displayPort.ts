import {
  createDisplayEnvelope,
  DISPLAY_PROTOCOL,
  DISPLAY_PROTOCOL_VERSION,
  type DisplayControls,
  type DisplayEnvelope,
  type DisplayInput,
} from "./displaySnapshot";
import { type LocalDisplaySource, sameDisplaySource } from "./displaySource";

export interface DisplayIntent {
  readonly protocol: typeof DISPLAY_PROTOCOL;
  readonly version: typeof DISPLAY_PROTOCOL_VERSION;
  readonly kind: "select" | "confirm" | "action";
  readonly requestId: string;
  readonly sessionId: string;
  readonly revision: number;
  readonly optionId: string;
}

export type IntentReceipt =
  | { readonly status: "selected" | "dispatched" }
  | {
      readonly status: "rejected";
      readonly reason:
        | "closed"
        | "unsupported"
        | "malformed"
        | "stale"
        | "duplicate"
        | "limit"
        | "pending-commit"
        | "publishing"
        | "not-committed"
        | "unknown-option"
        | "selection-required"
        | "wrong-kind";
    };

/** No browser/runtime dependency. Concrete transports own encoding/lifecycle. */
export interface DisplayPort {
  publish(envelope: DisplayEnvelope): void;
  onIntent(listener: (value: unknown) => IntentReceipt): () => void;
  dispose(): void | Promise<void>;
}

export interface DisplayContext extends DisplayInput {
  readonly controls: DisplayControls;
  readonly readDisplaySource?: () => LocalDisplaySource | undefined;
}

const INTENT_KEYS = new Set([
  "protocol",
  "version",
  "kind",
  "requestId",
  "sessionId",
  "revision",
  "optionId",
]);
const MAX_REQUESTS_PER_REVISION = 128;

function boundedId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 96;
}

function isIntent(value: unknown): value is DisplayIntent {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const object = value as Record<string, unknown>;
  const keys = Object.keys(object);
  return (
    keys.length === INTENT_KEYS.size &&
    keys.every((key) => INTENT_KEYS.has(key)) &&
    object.protocol === DISPLAY_PROTOCOL &&
    object.version === DISPLAY_PROTOCOL_VERSION &&
    (object.kind === "select" ||
      object.kind === "confirm" ||
      object.kind === "action") &&
    boundedId(object.requestId) &&
    boundedId(object.sessionId) &&
    boundedId(object.optionId) &&
    typeof object.revision === "number" &&
    Number.isSafeInteger(object.revision) &&
    object.revision >= 0
  );
}

/**
 * Bind to a live provider getter, never an engine or raw action dispatcher.
 * A receipt reports dispatch only; the next committed snapshot proves adoption.
 */
export function connectDisplayPort(
  port: DisplayPort,
  read: () => DisplayContext,
) {
  let closed = false;
  let current: DisplayEnvelope | null = null;
  let currentSource: LocalDisplaySource | null = null;
  let selected: string | null = null;
  let dispatched = false;
  let publishing = false;
  const seen = new Set<string>();
  let highestGeneration = 0;

  const reject = (
    reason: Extract<IntentReceipt, { status: "rejected" }>["reason"],
  ): IntentReceipt => ({ status: "rejected", reason });

  const receive = (value: unknown): IntentReceipt => {
    if (closed) return reject("closed");
    if (publishing) return reject("publishing");
    if (!isIntent(value)) return reject("malformed");
    const input = read();
    if (
      !current ||
      !currentSource ||
      !input.displaySource ||
      !input.readDisplaySource
    ) {
      return reject("unsupported");
    }
    const expected = currentSource;
    if (
      value.sessionId !== expected.sessionId ||
      value.revision !== expected.revision ||
      !sameDisplaySource(expected, input.displaySource) ||
      !sameDisplaySource(expected, input.readDisplaySource())
    ) {
      return reject("stale");
    }
    if (seen.has(value.requestId)) return reject("duplicate");
    if (dispatched) return reject("pending-commit");
    const option = current.snapshot.options.find(
      (candidate) => candidate.id === value.optionId,
    );
    if (!option) return reject("unknown-option");
    if ("tile" in option) {
      if (value.kind === "select") {
        // Recent selections need bounded replay protection, not a lifetime
        // quota that can strand a user before confirmation. Committed actions
        // remain protected by the synchronous source and dispatched guards.
        if (seen.size >= MAX_REQUESTS_PER_REVISION)
          seen.delete(seen.values().next().value!);
        seen.add(value.requestId);
        selected = option.id;
        return { status: "selected" };
      }
      if (value.kind !== "confirm") return reject("wrong-kind");
      if (selected !== option.id) return reject("selection-required");
    } else {
      if (value.kind !== "action") return reject("wrong-kind");
    }
    if (seen.size >= MAX_REQUESTS_PER_REVISION)
      seen.delete(seen.values().next().value!);
    seen.add(value.requestId);
    dispatched = true;
    try {
      if ("tile" in option) {
        // Forward only the selected kind. The existing controls normalize it
        // with the domain factory; a display red flag never creates game tiles.
        input.controls[option.action]({
          suit: option.tile.suit,
          rank: option.tile.rank,
        });
      } else {
        input.controls[option.action]();
      }
    } catch (error) {
      selected = null;
      const after = input.readDisplaySource();
      dispatched = after !== undefined && !sameDisplaySource(expected, after);
      // No blanket retry or swallowed error. If a commit happened before the
      // exception, the source check still rejects every stale request.
      throw error;
    }
    selected = null;
    // Local controls commit synchronously, but can reject an obsolete render
    // or a no-op without throwing. Never strand the renderer waiting for a
    // revision that will not arrive; a new request may retry after refreshing.
    const after = input.readDisplaySource();
    if (!after || sameDisplaySource(expected, after)) {
      dispatched = false;
      return reject("not-committed");
    }
    return { status: "dispatched" };
  };

  const unsubscribe = port.onIntent(receive);

  return {
    /** Call after a provider commit; same/older revisions do not replay cues. */
    refresh(): "published" | "unchanged" | "stale" | "unsupported" | "closed" {
      if (closed) return "closed";
      const input = read();
      const source = input.displaySource;
      if (!source || !input.readDisplaySource) {
        current = null;
        currentSource = null;
        selected = null;
        seen.clear();
        return "unsupported";
      }
      if (!sameDisplaySource(source, input.readDisplaySource())) return "stale";
      if (
        source.generation < highestGeneration ||
        (source.generation === highestGeneration &&
          current &&
          current.sessionId !== source.sessionId)
      )
        return "stale";
      if (current?.sessionId === source.sessionId) {
        if (source.revision === current.revision) return "unchanged";
        if (source.revision < current.revision) return "stale";
      }
      const envelope = createDisplayEnvelope(
        input,
        current?.sessionId === source.sessionId ? "live" : "restore",
      );
      if (!envelope) return "unsupported";
      // Publish first. A failed transport must not claim to have sent a frame.
      // A synchronous listener during publication cannot act on a partially
      // sent frame. It can retry once publish has returned successfully.
      publishing = true;
      try {
        port.publish(envelope);
      } finally {
        publishing = false;
      }
      current = envelope;
      currentSource = source;
      highestGeneration = source.generation;
      selected = null;
      dispatched = false;
      seen.clear();
      return "published";
    },
    async dispose(): Promise<void> {
      if (closed) return;
      closed = true;
      current = null;
      currentSource = null;
      selected = null;
      seen.clear();
      highestGeneration = 0;
      try {
        unsubscribe();
      } finally {
        await port.dispose();
      }
    },
  };
}
