import { describe, expect, it, vi } from "vitest";
import {
  type HeartbeatPeer,
  runHeartbeat,
  SERVER_HEARTBEAT_INTERVAL_MS,
} from "./heartbeat";

function peer(overrides: Partial<HeartbeatPeer> = {}): HeartbeatPeer {
  return {
    isAlive: true,
    socket: {
      ping: vi.fn(),
      terminate: vi.fn(),
    },
    ...overrides,
  };
}

describe("online WebSocket heartbeat", () => {
  it("uses a bounded interval that allows an idle game to remain connected", () => {
    expect(SERVER_HEARTBEAT_INTERVAL_MS).toBe(30_000);
  });

  it("pings live peers and requires a pong before the next pass", () => {
    const live = peer();

    runHeartbeat([live]);

    expect(live.isAlive).toBe(false);
    expect(live.socket.ping).toHaveBeenCalledOnce();
    expect(live.socket.terminate).not.toHaveBeenCalled();

    live.isAlive = true;
    runHeartbeat([live]);

    expect(live.socket.ping).toHaveBeenCalledTimes(2);
    expect(live.socket.terminate).not.toHaveBeenCalled();
  });

  it("terminates a peer that missed the previous pong", () => {
    const stale = peer({ isAlive: false });

    runHeartbeat([stale]);

    expect(stale.socket.terminate).toHaveBeenCalledOnce();
    expect(stale.socket.ping).not.toHaveBeenCalled();
  });

  it("terminates when sending a protocol ping fails", () => {
    const broken = peer();
    vi.mocked(broken.socket.ping).mockImplementation(() => {
      throw new Error("closed");
    });

    runHeartbeat([broken]);

    expect(broken.socket.terminate).toHaveBeenCalledOnce();
  });

  it("uses the caller's authority-aware terminator", () => {
    const stale = peer({ isAlive: false });
    const terminate = vi.fn();

    runHeartbeat([stale], terminate);

    expect(terminate).toHaveBeenCalledOnce();
    expect(terminate).toHaveBeenCalledWith(stale);
    expect(stale.socket.terminate).not.toHaveBeenCalled();
  });
});
