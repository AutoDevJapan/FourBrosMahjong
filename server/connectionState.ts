import type { RoomPlayer, RoomSession } from "./roomManager";

export interface ConnectionState {
  readonly key: object;
  readonly room: object | null;
  readonly playerId: string | null;
  readonly readyState: number;
}

const SOCKET_CLOSING = 2;
const SOCKET_CLOSED = 3;

interface ReplacementClient {
  room: RoomSession["room"] | null;
  player: RoomPlayer | null;
}

/** Register a replacement seat before callbacks from the old socket can run. */
export function registerReplacementBeforeClose(
  client: ReplacementClient,
  session: RoomSession,
  touch: () => void,
  closePrevious: () => void,
): void {
  client.room = session.room;
  client.player = session.player;
  touch();
  closePrevious();
}

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
