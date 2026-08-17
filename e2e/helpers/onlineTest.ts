import type { Page } from "@playwright/test";
import { walkToGameEnd } from "../../src/components/game/finishedGameFixture";
import { selectView } from "../../src/components/game/gameView";
import type { OnlineSnapshot } from "../../src/components/online/types";
import { createGame } from "../../src/domain/game/engine";

interface OnlineTestSocket {
  readonly sent: string[];
  fail(): void;
  open(): void;
  message(value: unknown): void;
}

export interface OnlineTestWindow extends Window {
  __fourBrosOnlineSockets: OnlineTestSocket[];
}

export function onlineSnapshotFixture(): OnlineSnapshot {
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

export function onlineFinishedSnapshotFixture(): OnlineSnapshot {
  const finished = walkToGameEnd(1).state;
  return {
    code: "ABC234",
    version: 1,
    you: "p0",
    phase: finished.phase,
    view: selectView(finished, "p0"),
    pending: finished.pending,
    roundSummary: finished.lastRound,
    players: finished.players.map((player) => ({
      id: player.id,
      name: player.name,
      connected: true,
      isHost: player.id === "p0",
    })),
    currentTurn: null,
  };
}

export async function installWebSocketStub(page: Page): Promise<void> {
  await page.evaluate(() => {
    type Listener = (event: Event) => void;

    class TestWebSocket {
      static readonly OPEN = 1;
      static readonly CLOSED = 3;

      readonly sent: string[] = [];
      readyState = 0;
      private readonly listeners = new Map<string, Set<Listener>>();

      constructor() {
        (window as unknown as OnlineTestWindow).__fourBrosOnlineSockets.push(
          this,
        );
      }

      addEventListener(type: string, listener: Listener): void {
        const listeners = this.listeners.get(type) ?? new Set<Listener>();
        listeners.add(listener);
        this.listeners.set(type, listeners);
      }

      send(value: string): void {
        this.sent.push(value);
      }

      close(): void {
        if (this.readyState === TestWebSocket.CLOSED) return;
        this.readyState = TestWebSocket.CLOSED;
        this.dispatch("close");
      }

      fail(): void {
        this.dispatch("error");
      }

      open(): void {
        this.readyState = TestWebSocket.OPEN;
        this.dispatch("open");
      }

      message(value: unknown): void {
        this.dispatch(
          "message",
          new MessageEvent("message", { data: JSON.stringify(value) }),
        );
      }

      private dispatch(type: string, event: Event = new Event(type)): void {
        for (const listener of this.listeners.get(type) ?? []) listener(event);
      }
    }

    const testWindow = window as unknown as OnlineTestWindow & {
      WebSocket: typeof WebSocket;
    };
    testWindow.__fourBrosOnlineSockets = [];
    testWindow.WebSocket = TestWebSocket as unknown as typeof WebSocket;
  });
}
