export interface ReplacementClient {
  readonly socket: {
    close(code?: number, reason?: string): void;
    readonly readyState: number;
  };
  room: object | null;
  player: { readonly id: string } | null;
}

export interface ReplacementSession {
  readonly room: object;
  readonly player: { readonly id: string };
}

/** Register a resumed seat before asking any stale socket to close. */
export function registerReplacement(
  client: ReplacementClient,
  session: ReplacementSession,
  peers: Iterable<ReplacementClient>,
): void {
  // A close event may be delivered while the old socket is being replaced. The
  // replacement must already be visible to the close handler so it cannot mark
  // the resumed seat disconnected.
  client.room = session.room;
  client.player = session.player;

  for (const other of peers) {
    if (
      other !== client &&
      other.room === session.room &&
      other.player?.id === session.player.id
    ) {
      other.socket.close(4001, "reconnected");
    }
  }
}
