/** Local, non-secret identity. Never a seed, persistence key, or auth token. */
export interface LocalDisplaySource {
  readonly kind: "local";
  readonly sessionId: string;
  readonly revision: number;
}

let nextSession = 0;

/** Lifetime is this JS realm; transports must not survive a document reload. */
export function newLocalDisplaySource(): LocalDisplaySource {
  if (!Number.isSafeInteger(nextSession + 1)) {
    throw new RangeError("Local display session identifiers exhausted");
  }
  nextSession += 1;
  return Object.freeze({
    kind: "local",
    sessionId: `local-display-${nextSession}`,
    revision: 0,
  });
}

export function advanceDisplaySource(
  current: LocalDisplaySource,
): LocalDisplaySource {
  if (!Number.isSafeInteger(current.revision + 1)) {
    throw new RangeError("Local display revision exhausted");
  }
  return Object.freeze({ ...current, revision: current.revision + 1 });
}

export function sameDisplaySource(
  a: LocalDisplaySource,
  b: LocalDisplaySource | undefined,
): boolean {
  return (
    b?.kind === "local" &&
    a.sessionId === b.sessionId &&
    a.revision === b.revision
  );
}
