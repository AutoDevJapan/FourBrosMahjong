export const ONLINE_HANDSHAKE_TIMEOUT_MS = 10 * 1000;

export interface HandshakeTimeout {
  complete(): void;
  clear(): void;
}

/** Bound an accepted WebSocket that has not joined or resumed a room yet. */
export function startHandshakeTimeout(
  onTimeout: () => void,
  timeoutMs = ONLINE_HANDSHAKE_TIMEOUT_MS,
): HandshakeTimeout {
  let finished = false;
  const timer = setTimeout(() => {
    if (finished) return;
    finished = true;
    onTimeout();
  }, timeoutMs);

  const stop = () => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
  };

  return { complete: stop, clear: stop };
}
