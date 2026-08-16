export interface HeartbeatPeer {
  isAlive: boolean;
  readonly socket: {
    ping(): void;
    terminate(): void;
  };
}

/** The server checks every connected peer once per interval. */
export const SERVER_HEARTBEAT_INTERVAL_MS = 30 * 1000;

/**
 * Run one server-side heartbeat pass for WebSocket peers.
 *
 * A peer must answer the previous protocol ping before the next pass. The
 * small pure helper keeps the timeout policy testable without starting a
 * listening server in unit tests.
 */
export function runHeartbeat(peers: Iterable<HeartbeatPeer>): void {
  for (const peer of peers) {
    if (!peer.isAlive) {
      peer.socket.terminate();
      continue;
    }
    peer.isAlive = false;
    try {
      peer.socket.ping();
    } catch {
      peer.socket.terminate();
    }
  }
}
