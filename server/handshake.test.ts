import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ONLINE_HANDSHAKE_TIMEOUT_MS,
  startHandshakeTimeout,
} from "./handshake";

afterEach(() => {
  vi.useRealTimers();
});

describe("online WebSocket handshake timeout", () => {
  it("uses a bounded timeout that is longer than an immediate browser handshake", () => {
    expect(ONLINE_HANDSHAKE_TIMEOUT_MS).toBe(10_000);
  });

  it("fires for an idle socket", () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    startHandshakeTimeout(onTimeout, 1_000);

    vi.advanceTimersByTime(999);
    expect(onTimeout).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledOnce();
  });

  it("cancels the deadline when the room handshake completes", () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const timeout = startHandshakeTimeout(onTimeout, 1_000);

    timeout.complete();
    vi.advanceTimersByTime(1_000);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("cancels the deadline when the socket closes before handshaking", () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const timeout = startHandshakeTimeout(onTimeout, 1_000);

    timeout.clear();
    vi.advanceTimersByTime(1_000);

    expect(onTimeout).not.toHaveBeenCalled();
  });
});
