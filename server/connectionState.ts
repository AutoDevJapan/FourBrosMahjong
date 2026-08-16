export interface ConnectionState {
  readonly key: object;
  readonly room: object | null;
  readonly playerId: string | null;
  readonly readyState: number;
}

const SOCKET_CLOSING = 2;
const SOCKET_CLOSED = 3;

/** 同じ席の新しい接続が残っている間は、古いソケットのcloseを切断扱いにしない。 */
export function hasOpenPeer(
  client: ConnectionState,
  peers: Iterable<ConnectionState>,
): boolean {
  if (client.room === null || client.playerId === null) return false;
  return [...peers].some(
    (peer) =>
      peer.key !== client.key &&
      peer.room === client.room &&
      peer.playerId === client.playerId &&
      peer.readyState !== SOCKET_CLOSING &&
      peer.readyState !== SOCKET_CLOSED,
  );
}
