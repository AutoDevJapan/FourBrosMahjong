import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
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

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_ONLINE_WS_URL", "ws://localhost:8080/ws");
  vi.stubGlobal("WebSocket", TestWebSocket);
  window.sessionStorage.clear();
  window.history.replaceState({}, "", "/online");
  sockets.length = 0;
});

afterEach(() => {
  window.history.replaceState({}, "", "/online");
  window.sessionStorage.clear();
  sockets.length = 0;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
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

describe("OnlineLobby connection recovery", () => {
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
    expect(
      document.querySelector('[data-connection-status="reconnecting"]'),
    ).toHaveFocus();
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
    expect(
      document.querySelector('[data-connection-status="connected"]'),
    ).toHaveFocus();
    expect(screen.getByTestId("game-board")).toBeInTheDocument();
  });

  it("clears saved credentials before starting a new room request", async () => {
    window.sessionStorage.setItem(
      "four-bros-mahjong.online.session.v1",
      JSON.stringify({ code: "OLD234", token: "o".repeat(24) }),
    );
    const user = userEvent.setup();
    render(<OnlineLobby />);

    await waitFor(() => expect(sockets).toHaveLength(1));
    act(() => {
      sockets[0]?.open();
      sockets[0]?.message({
        type: "error",
        message: "再接続情報が無効です。",
      });
    });
    await waitFor(() => {
      expect(
        document.querySelector('[data-connection-status="failed"]'),
      ).not.toBeNull();
    });

    await user.type(screen.getByLabelText("表示名"), "たろう");
    await user.click(
      screen.getByRole("button", { name: "新しいルームを作る" }),
    );
    expect(sockets).toHaveLength(2);

    act(() => sockets[1]?.fail());
    await waitFor(() => {
      expect(
        document.querySelector('[data-connection-status="failed"]'),
      ).not.toBeNull();
    });
    expect(sockets).toHaveLength(2);
    expect(
      window.sessionStorage.getItem("four-bros-mahjong.online.session.v1"),
    ).toBeNull();
  });
});
