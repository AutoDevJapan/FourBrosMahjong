import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { useGame } from "@/components/game/GameProvider";
import { selectView } from "@/components/game/gameView";
import { createGame } from "@/domain/game/engine";
import OnlineGameProvider, {
  onlinePermissions,
  onlineSocketUrl,
} from "./OnlineGameProvider";
import type { OnlineSnapshot } from "./types";

function ActionProbe() {
  const { controls } = useGame();
  return (
    <>
      <button
        type="button"
        onClick={() => controls.discard({ suit: "man", rank: 1, isRed: false })}
      >
        打牌
      </button>
      <button
        type="button"
        onClick={() => controls.discard({ suit: "pin", rank: 5 })}
      >
        旧snapshotの赤五を打牌
      </button>
      <button type="button" onClick={controls.kita}>
        北抜
      </button>
    </>
  );
}

function PermissionProbe() {
  const { controls, isHost, playerId } = useGame();
  return (
    <>
      <output data-testid="player-id">{playerId}</output>
      <output data-testid="is-host">{String(isHost)}</output>
      <button type="button" onClick={controls.nextRound}>
        次の局へ
      </button>
      <button type="button" onClick={controls.newGame}>
        新しい半荘を開始
      </button>
    </>
  );
}

function snapshotFixture(): OnlineSnapshot {
  const engine = createGame({ seed: 31, humanPlayerIds: ["p0", "p1"] });
  return {
    code: "ABC234",
    version: 3,
    you: "p0",
    explicitKita: true,
    hostId: "p0",
    phase: engine.phase,
    view: selectView(engine, "p0"),
    pending: engine.pending,
    roundSummary: engine.lastRound,
    players: [
      { id: "p0", name: "ホスト", connected: true, isHost: true },
      { id: "p1", name: "ゲスト", connected: true, isHost: false },
    ],
    currentTurn: "p0",
    hostNotice: null,
  };
}

describe("OnlineGameProvider", () => {
  it("動的hostIdに従って引継ぎ後のguestへhost権限を公開し、不完全なsnapshotはguest扱いにする", () => {
    expect(
      onlinePermissions({
        you: "p0",
        hostId: "p0",
        players: [{ id: "p0", name: "ホスト", connected: true, isHost: true }],
      }),
    ).toEqual({ playerId: "p0", isHost: true });
    expect(
      onlinePermissions({
        you: "p1",
        hostId: "p1",
        players: [{ id: "p1", name: "ゲスト", connected: true, isHost: true }],
      }),
    ).toEqual({ playerId: "p1", isHost: true });
    expect(
      onlinePermissions({
        you: "p1",
        hostId: "p0",
        players: [{ id: "p1", name: "ゲスト", connected: true, isHost: true }],
      }),
    ).toEqual({ playerId: "p1", isHost: false });
  });

  it("引継ぎ後のhost-only actionを送信し、guestのUI権限を閉じる", async () => {
    const send = vi.fn();
    const socket = { readyState: 1, send } as unknown as WebSocket;
    const snapshot = {
      ...snapshotFixture(),
      you: "p1" as const,
      hostId: "p1" as const,
      players: [
        { id: "p0" as const, name: "ホスト", connected: false, isHost: false },
        { id: "p1" as const, name: "ゲスト", connected: true, isHost: true },
      ],
    };
    render(
      <OnlineGameProvider socket={socket} snapshot={snapshot}>
        <PermissionProbe />
      </OnlineGameProvider>,
    );

    expect(screen.getByTestId("player-id")).toHaveTextContent("p1");
    expect(screen.getByTestId("is-host")).toHaveTextContent("true");
    await userEvent.click(screen.getByRole("button", { name: "次の局へ" }));
    await userEvent.click(
      screen.getByRole("button", { name: "新しい半荘を開始" }),
    );
    expect(send).toHaveBeenCalledTimes(2);
    expect(JSON.parse(send.mock.calls[0][0] as string)).toMatchObject({
      type: "action",
      action: { type: "nextRound" },
    });
    expect(JSON.parse(send.mock.calls[1][0] as string)).toEqual({
      type: "newGame",
    });
  });

  it("guestのhost-only actionを送信しない", async () => {
    const send = vi.fn();
    const socket = { readyState: 1, send } as unknown as WebSocket;
    const snapshot = { ...snapshotFixture(), you: "p1" as const };
    render(
      <OnlineGameProvider socket={socket} snapshot={snapshot}>
        <PermissionProbe />
      </OnlineGameProvider>,
    );

    expect(screen.getByTestId("player-id")).toHaveTextContent("p1");
    expect(screen.getByTestId("is-host")).toHaveTextContent("false");
    await userEvent.click(screen.getByRole("button", { name: "次の局へ" }));
    await userEvent.click(
      screen.getByRole("button", { name: "新しい半荘を開始" }),
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("maintenance中はhostのnewGameだけを送信せず、現在の半荘のactionとnextRoundを維持する", async () => {
    const send = vi.fn();
    const socket = { readyState: 1, send } as unknown as WebSocket;
    render(
      <OnlineGameProvider
        socket={socket}
        snapshot={snapshotFixture()}
        newGameDisabled
      >
        <ActionProbe />
        <PermissionProbe />
      </OnlineGameProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "打牌" }));
    await userEvent.click(screen.getByRole("button", { name: "次の局へ" }));
    await userEvent.click(
      screen.getByRole("button", { name: "新しい半荘を開始" }),
    );

    expect(send).toHaveBeenCalledTimes(2);
    expect(JSON.parse(send.mock.calls[0][0] as string)).toMatchObject({
      type: "action",
      action: { type: "discard" },
    });
    expect(JSON.parse(send.mock.calls[1][0] as string)).toMatchObject({
      type: "action",
      action: { type: "nextRound" },
    });
  });

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

  it("canonicalizes a red five omitted by a legacy snapshot before sending it", async () => {
    const send = vi.fn();
    const socket = { readyState: WebSocket.OPEN, send } as unknown as WebSocket;
    render(
      <OnlineGameProvider socket={socket} snapshot={snapshotFixture()}>
        <ActionProbe />
      </OnlineGameProvider>,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "旧snapshotの赤五を打牌" }),
    );

    expect(JSON.parse(send.mock.calls[0][0] as string)).toMatchObject({
      type: "action",
      action: {
        type: "discard",
        tile: { suit: "pin", rank: 5, isRed: true },
      },
    });
  });

  it("sends the explicit kita action for the local player", async () => {
    const send = vi.fn();
    const socket = { readyState: 1, send } as unknown as WebSocket;
    render(
      <OnlineGameProvider socket={socket} snapshot={snapshotFixture()}>
        <ActionProbe />
      </OnlineGameProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "北抜" }));

    expect(JSON.parse(send.mock.calls[0][0] as string)).toMatchObject({
      type: "action",
      version: 3,
      action: { type: "kita" },
    });
  });

  it("capability欠落の旧server snapshotではkita actionを送らない", async () => {
    const send = vi.fn();
    const socket = { readyState: 1, send } as unknown as WebSocket;
    const { explicitKita, ...legacySnapshot } = snapshotFixture();
    expect(explicitKita).toBe(true);
    render(
      <OnlineGameProvider socket={socket} snapshot={legacySnapshot}>
        <ActionProbe />
      </OnlineGameProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "北抜" }));

    expect(send).not.toHaveBeenCalled();
  });

  it("does not send a stale action while the socket is unavailable", async () => {
    const onSendError = vi.fn();
    const socket = { readyState: 0, send: vi.fn() } as unknown as WebSocket;
    render(
      <OnlineGameProvider
        socket={socket}
        snapshot={snapshotFixture()}
        onSendError={onSendError}
      >
        <ActionProbe />
      </OnlineGameProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "打牌" }));

    expect(socket.send).not.toHaveBeenCalled();
    expect(onSendError).toHaveBeenCalledWith(
      "オンラインサーバーとの接続が切れています。再接続を待っています。",
    );
  });

  it("does not let a failed socket send escape the action event", async () => {
    const onSendError = vi.fn();
    const send = vi.fn(() => {
      throw new Error("socket closed while sending");
    });
    const socket = { readyState: WebSocket.OPEN, send } as unknown as WebSocket;
    render(
      <OnlineGameProvider
        socket={socket}
        snapshot={snapshotFixture()}
        onSendError={onSendError}
      >
        <ActionProbe />
        <PermissionProbe />
      </OnlineGameProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "打牌" }));
    await userEvent.click(
      screen.getByRole("button", { name: "新しい半荘を開始" }),
    );

    expect(send).toHaveBeenCalledTimes(2);
    expect(onSendError).toHaveBeenCalledTimes(2);
    expect(onSendError).toHaveBeenNthCalledWith(
      1,
      "オンラインサーバーとの接続が切れています。再接続を待っています。",
    );
    expect(onSendError).toHaveBeenNthCalledWith(
      2,
      "オンラインサーバーとの接続が切れています。再接続を待っています。",
    );
  });
});
