import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { useGame } from "@/components/game/GameProvider";
import { selectView } from "@/components/game/gameView";
import { createGame } from "@/domain/game/engine";
import OnlineGameProvider, { onlineSocketUrl } from "./OnlineGameProvider";
import type { OnlineSnapshot } from "./types";

function ActionProbe() {
  const { controls } = useGame();
  return (
    <button
      type="button"
      onClick={() => controls.discard({ suit: "man", rank: 1, isRed: false })}
    >
      打牌
    </button>
  );
}

function snapshotFixture(): OnlineSnapshot {
  const engine = createGame({ seed: 31, humanPlayerIds: ["p0", "p1"] });
  return {
    code: "ABC234",
    version: 3,
    you: "p0",
    phase: engine.phase,
    view: selectView(engine, "p0"),
    pending: engine.pending,
    roundSummary: engine.lastRound,
    players: [
      { id: "p0", name: "ホスト", connected: true, isHost: true },
      { id: "p1", name: "ゲスト", connected: true, isHost: false },
    ],
    currentTurn: "p0",
  };
}

describe("OnlineGameProvider", () => {
  it("uses the shared safe normalizer for configured WebSocket URLs", () => {
    vi.stubEnv(
      "NEXT_PUBLIC_ONLINE_WS_URL",
      "HTTPS://FOUR-BROS-MAHJONG-ONLINE-PRODUCTION.UP.RAILWAY.APP/ws?token=demo",
    );

    expect(onlineSocketUrl()).toBe(
      "wss://four-bros-mahjong-online-production.up.railway.app/ws?token=demo",
    );

    vi.unstubAllEnvs();
  });

  it("sends the current version and the local player's action", async () => {
    const send = vi.fn();
    const socket = { readyState: 1, send } as unknown as WebSocket;
    render(
      <OnlineGameProvider socket={socket} snapshot={snapshotFixture()}>
        <ActionProbe />
      </OnlineGameProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "打牌" }));

    expect(send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(send.mock.calls[0][0] as string)).toMatchObject({
      type: "action",
      version: 3,
      action: { type: "discard" },
    });
  });
});
