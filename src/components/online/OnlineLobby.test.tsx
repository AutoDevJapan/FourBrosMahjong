import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { selectView } from "@/components/game/gameView";
import { createGame } from "@/domain/game/engine";
import OnlineLobby from "./OnlineLobby";
import type { OnlineServerMessage, OnlineSnapshot } from "./types";

vi.mock("@/components/game/GameBoard", () => ({
  default: () => <div data-testid="game-board">対局盤</div>,
}));

type TestListener = (event: Event) => void;

class TestWebSocket {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;

  readonly url: string;
  readonly sent: string[] = [];
  readyState = 0;
  private readonly listeners = new Map<string, Set<TestListener>>();

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
    const callbacks = this.listeners.get(type) ?? new Set<TestListener>();
    callbacks.add(callback);
    this.listeners.set(type, callbacks);
  }

  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
  ): void {
    const callbacks = this.listeners.get(type);
    if (!callbacks) return;
    for (const callback of callbacks) {
      if (callback === listener) callbacks.delete(callback);
    }
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
    this.readyState = TestWebSocket.OPEN;
    this.emit("open");
  }

  fail(): void {
    this.emit("error");
  }

  message(message: OnlineServerMessage): void {
    this.emit(
      "message",
      new MessageEvent("message", { data: JSON.stringify(message) }),
    );
  }

  private emit(type: string, event: Event = new Event(type)): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

const sockets: TestWebSocket[] = [];

function snapshotFixture(): OnlineSnapshot {
  const engine = createGame({ seed: 31, humanPlayerIds: ["p0"] });
  return {
    code: "ABC234",
    version: 0,
    you: "p0",
    phase: engine.phase,
    view: selectView(engine, "p0"),
    pending: engine.pending,
    roundSummary: engine.lastRound,
    players: [{ id: "p0", name: "たろう", connected: true, isHost: true }],
    currentTurn: "p0",
  };
}

describe("OnlineLobby connection recovery", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_ONLINE_WS_URL", "ws://localhost:8080/ws");
    vi.stubGlobal("WebSocket", TestWebSocket);
    window.sessionStorage.clear();
    sockets.length = 0;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("shows a retry action after a failed connection and keeps the form values", async () => {
    const user = userEvent.setup();
    render(<OnlineLobby />);

    await user.type(screen.getByLabelText("表示名"), "たろう");
    await user.type(screen.getByLabelText("ルームコード"), "abc234");
    await user.click(screen.getByRole("button", { name: "参加する" }));

    expect(
      document.querySelector('[data-connection-status="connecting"]'),
    ).not.toBeNull();
    expect(screen.getByRole("button", { name: "参加する" })).toBeDisabled();

    act(() => sockets[0]?.fail());

    expect(
      document.querySelector('[data-connection-status="failed"]'),
    ).not.toBeNull();
    expect(
      screen.getByText(
        "オンラインサーバーへの接続に失敗しました。再試行してください。",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("オンラインサーバーへ接続しています…"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "再試行" })).toBeEnabled();
    expect(screen.getByLabelText("表示名")).toHaveValue("たろう");
    expect(screen.getByLabelText("ルームコード")).toHaveValue("ABC234");

    await user.click(screen.getByRole("button", { name: "再試行" }));

    expect(
      document.querySelector('[data-connection-status="reconnecting"]'),
    ).not.toBeNull();
    expect(sockets).toHaveLength(2);

    act(() => sockets[1]?.open());
    expect(JSON.parse(sockets[1]?.sent[0] ?? "{}")).toEqual({
      type: "join",
      code: "ABC234",
      name: "たろう",
    });

    act(() =>
      sockets[1]?.message({
        type: "session",
        token: "t".repeat(24),
        snapshot: snapshotFixture(),
      }),
    );

    await waitFor(() => {
      expect(
        document.querySelector('[data-connection-status="connected"]'),
      ).not.toBeNull();
    });
    expect(
      screen.getByText("オンラインサーバーに接続しました。"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("game-board")).toBeInTheDocument();
  });
});
