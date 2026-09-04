import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { walkToGameEnd } from "@/components/game/finishedGameFixture";
import { selectView } from "@/components/game/gameView";
import type { PlayerId } from "@/domain/game/engine";
import { LEGACY_1C8CC9_PLAYING_SNAPSHOT } from "@/test/fixtures/legacyOnlineSnapshot";
import OnlineLobby from "./OnlineLobby";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

type TestListener = (event: Event) => void;

class LegacyTestWebSocket {
  static readonly OPEN = 1;
  readonly sent: string[] = [];
  readyState = 0;
  private readonly listeners = new Map<string, Set<TestListener>>();

  constructor() {
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
    const listeners = this.listeners.get(type) ?? new Set<TestListener>();
    listeners.add(callback);
    this.listeners.set(type, listeners);
  }

  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
  ): void {
    const listeners = this.listeners.get(type);
    if (!listeners) return;
    for (const callback of listeners) {
      if (callback === listener) listeners.delete(callback);
    }
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {}

  open(): void {
    this.readyState = LegacyTestWebSocket.OPEN;
    this.emit("open");
  }

  message(value: unknown): void {
    this.emit(
      "message",
      new MessageEvent("message", { data: JSON.stringify(value) }),
    );
  }

  private emit(type: string, event: Event = new Event(type)): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

const sockets: LegacyTestWebSocket[] = [];

function legacyGameEndSnapshot(you: PlayerId): Record<string, unknown> {
  const state = walkToGameEnd(1).state;
  const view = structuredClone(selectView(state, you)) as unknown as {
    slots: Record<string, { player: { playerId?: PlayerId; name: string } }>;
    result: { players: Array<{ playerId?: PlayerId }> } | null;
  };
  const playerNames: Record<PlayerId, string> = {
    p0: "ホスト",
    p1: "ゲスト",
    p2: "ゲスト3",
    p3: "ゲスト4",
  };
  for (const slot of Object.values(view.slots)) {
    const playerId = slot.player.playerId;
    if (playerId) slot.player.name = playerNames[playerId];
    delete slot.player.playerId;
  }
  for (const player of view.result?.players ?? []) delete player.playerId;
  return {
    code: "ABC234",
    version: 4,
    you,
    phase: state.phase,
    view,
    pending: null,
    roundSummary: state.lastRound,
    players: [
      { id: "p0", name: "ホスト", connected: true, isHost: true },
      { id: "p1", name: "ゲスト", connected: true, isHost: false },
    ],
    currentTurn: null,
  };
}

function connectLegacySession(
  you: PlayerId,
  snapshot: Record<string, unknown> = you === "p0"
    ? structuredClone(LEGACY_1C8CC9_PLAYING_SNAPSHOT)
    : legacyGameEndSnapshot(you),
): void {
  fireEvent.change(screen.getByLabelText("表示名"), {
    target: { value: "接続テスト" },
  });
  fireEvent.click(screen.getByRole("button", { name: "新しいルームを作る" }));
  const socket = sockets[0];
  if (!socket) throw new Error("legacy test socket expected");
  act(() => {
    socket.open();
    socket.message({
      type: "session",
      token: "legacy-production-token",
      snapshot,
    });
  });
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_ONLINE_WS_URL", "ws://localhost:8080/ws");
  vi.stubGlobal("WebSocket", LegacyTestWebSocket);
  window.sessionStorage.clear();
  sockets.length = 0;
});

afterEach(() => {
  window.sessionStorage.clear();
  sockets.length = 0;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("OnlineLobby legacy production snapshot compatibility", () => {
  it("renders the immutable 1c8cc9 playing fixture with all four character slots", () => {
    render(<OnlineLobby />);
    connectLegacySession("p0");

    const playerIds = [
      ...new Set(
        Array.from(
          document.querySelectorAll<HTMLElement>("[data-player-kind]"),
          (element) => element.dataset.characterId,
        ),
      ),
    ].sort();
    expect(playerIds).toEqual(["p0", "p1", "p2", "p3"]);
    expect(
      screen.getAllByRole("button", { name: "ツモ" }).length,
    ).toBeGreaterThan(0);
  });

  it("preserves the p0 host control after normalizing a legacy gameEnd", () => {
    render(<OnlineLobby />);
    connectLegacySession("p0", legacyGameEndSnapshot("p0"));

    expect(
      screen.getAllByRole("button", { name: "新しい半荘を開始" }).length,
    ).toBeGreaterThan(0);
  });

  it("normalizes a p1 viewpoint without granting the guest host control", () => {
    render(<OnlineLobby />);
    connectLegacySession("p1");

    expect(
      document.querySelector(
        '[data-player-role="self"][data-character-id="p1"]',
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryAllByRole("button", { name: "新しい半荘を開始" }),
    ).toHaveLength(0);
  });
});
