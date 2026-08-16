import { describe, expect, it } from "vitest";
import {
  type ReplacementClient,
  registerReplacement,
} from "./connectionReplacement";
import { type ConnectionState, hasOpenPeer } from "./connectionState";

class ImmediateCloseSocket {
  readonly closeCalls: Array<{
    readonly code?: number;
    readonly reason?: string;
  }> = [];
  readyState = 1;
  onClose: (() => void) | undefined;

  close(code?: number, reason?: string): void {
    this.closeCalls.push({ code, reason });
    this.readyState = 3;
    this.onClose?.();
  }
}

interface TestPlayer {
  readonly id: string;
  connected: boolean;
}

interface TestClient extends ReplacementClient {
  readonly socket: ImmediateCloseSocket;
  player: TestPlayer | null;
}

function state(client: TestClient): ConnectionState {
  return {
    key: client,
    room: client.room,
    playerId: client.player?.id ?? null,
    readyState: client.socket.readyState,
  };
}

describe("registerReplacement", () => {
  it("resume-over-existing-socketをstale close競合から保護する", () => {
    const room = {};
    const player: TestPlayer = { id: "p0", connected: true };
    const oldSocket = new ImmediateCloseSocket();
    const replacementSocket = new ImmediateCloseSocket();
    const oldClient: TestClient = { socket: oldSocket, room, player };
    const replacementClient: TestClient = {
      socket: replacementSocket,
      room: null,
      player: null,
    };
    const clients = new Set<TestClient>([oldClient, replacementClient]);

    oldSocket.onClose = () => {
      clients.delete(oldClient);
      if (
        oldClient.room !== null &&
        oldClient.player !== null &&
        !hasOpenPeer(
          state(oldClient),
          [...clients].map((client) => state(client)),
        )
      ) {
        oldClient.player.connected = false;
      }
    };

    registerReplacement(replacementClient, { room, player }, clients);

    expect(replacementClient.room).toBe(room);
    expect(replacementClient.player).toBe(player);
    expect(oldSocket.closeCalls).toEqual([
      { code: 4001, reason: "reconnected" },
    ]);
    expect(player.connected).toBe(true);
  });
});
