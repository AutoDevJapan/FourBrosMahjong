import type { ConnectionAggregateCounts } from "./roomManager";

export interface ObservableServerConnection {
  readonly room: object | null;
  readonly player: object | null;
  /** Deliberately ignored: physical counts retain a superseded transport. */
  readonly superseded?: boolean;
}

/** Physical transport counts intentionally include superseded/CLOSING peers. */
export function connectionAggregateCounts(
  connections: Iterable<ObservableServerConnection>,
  pendingUpgrades: number,
): ConnectionAggregateCounts {
  const established = [...connections];
  return Object.freeze({
    webSocketConnections: established.length,
    attachedSessionConnections: established.filter(
      (connection) => connection.room !== null && connection.player !== null,
    ).length,
    pendingUpgrades,
  });
}
