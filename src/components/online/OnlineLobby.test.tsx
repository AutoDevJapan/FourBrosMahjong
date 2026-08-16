import { act, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import OnlineLobby from "./OnlineLobby";

class TestWebSocket {
  static readonly CLOSED = 3;

  readonly url: string;
  readonly sent: string[] = [];
  readyState = 0;
  private readonly listeners = new Map<string, Set<(event: Event) => void>>();

  constructor(url: string | URL) {
    this.url = String(url);
    sockets.push(this);
  }

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
  ): void {
    const callback =
      typeof listener === "function"
        ? listener
        : (event: Event) => listener.handleEvent(event);
    const callbacks = this.listeners.get(type) ?? new Set();
    callbacks.add(callback);
    this.listeners.set(type, callbacks);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    if (this.readyState === TestWebSocket.CLOSED) return;
    this.readyState = TestWebSocket.CLOSED;
    this.emit("close");
  }

  open(): void {
    this.readyState = 1;
    this.emit("open");
  }

  private emit(type: string, event: Event = new Event(type)): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

const sockets: TestWebSocket[] = [];

afterEach(() => {
  window.history.replaceState({}, "", "/online");
  window.sessionStorage.clear();
  sockets.length = 0;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("OnlineLobby (#605)", () => {
  it("prefills a valid room code from a shared URL", async () => {
    window.history.replaceState({}, "", "/online?room=abc234");

    render(
      <StrictMode>
        <OnlineLobby />
      </StrictMode>,
    );

    await waitFor(() =>
      expect(screen.getByLabelText("ルームコード")).toHaveValue("ABC234"),
    );
    expect(screen.getByRole("button", { name: "参加する" })).toBeDisabled();
  });

  it("ignores an invalid room code in a shared URL", async () => {
    window.history.replaceState({}, "", "/online?room=ABC123");

    render(
      <StrictMode>
        <OnlineLobby />
      </StrictMode>,
    );

    await waitFor(() =>
      expect(screen.getByLabelText("ルームコード")).toHaveValue(""),
    );
  });

  it("keeps reconnecting a restored session under StrictMode", async () => {
    vi.stubEnv("NEXT_PUBLIC_ONLINE_WS_URL", "ws://localhost:8080/ws");
    vi.stubGlobal("WebSocket", TestWebSocket);
    window.sessionStorage.setItem(
      "four-bros-mahjong.online.session.v1",
      JSON.stringify({ code: "ABC234", token: "t".repeat(16) }),
    );

    render(
      <StrictMode>
        <OnlineLobby />
      </StrictMode>,
    );

    await waitFor(() => expect(sockets).toHaveLength(1));
    act(() => sockets[0]?.open());
    expect(JSON.parse(sockets[0]?.sent[0] ?? "{}")).toEqual({
      type: "resume",
      code: "ABC234",
      token: "t".repeat(16),
    });

    act(() => sockets[0]?.close());
    await waitFor(() => expect(sockets).toHaveLength(2), { timeout: 1_500 });
  });
});
