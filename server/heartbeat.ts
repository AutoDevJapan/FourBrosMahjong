export interface HeartbeatPeer {
  isAlive: boolean;
  readonly socket: {
    ping(): void;
    terminate(): void;
  };
}

export type HeartbeatTerminator<TPeer extends HeartbeatPeer = HeartbeatPeer> = (
  peer: TPeer,
) => void;

/** The server checks every connected peer once per interval. */
export const SERVER_HEARTBEAT_INTERVAL_MS = 30 * 1000;

/**
 * Run one server-side heartbeat pass for WebSocket peers.
 *
 * A peer must answer the previous protocol ping before the next pass. The
 * small pure helper keeps the timeout policy testable without starting a
 * listening server in unit tests.
 */
export function runHeartbeat<TPeer extends HeartbeatPeer>(
  peers: Iterable<TPeer>,
  terminate: HeartbeatTerminator<TPeer> = (peer) => peer.socket.terminate(),
): void {
  for (const peer of peers) {
    if (!peer.isAlive) {
      terminate(peer);
      continue;
    }
    peer.isAlive = false;
    try {
      peer.socket.ping();
    } catch {
      terminate(peer);
    }
  }
}
