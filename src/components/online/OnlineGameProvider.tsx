"use client";

import { useCallback, useMemo } from "react";
import {
  GameContext,
  type GameContextValue,
} from "@/components/game/GameProvider";
import type { GameAction } from "@/components/game/gamePersistence";
import type { TileData } from "@/components/game/types";
import type { PlayerId } from "@/domain/game/engine";
import { createTile, isRedDora } from "@/domain/tiles/tile";
import { normalizeOnlineWebSocketUrl } from "@/lib/onlineWebSocket";
import type { OnlineSnapshot } from "./types";

export interface OnlinePermissions {
  readonly playerId: PlayerId;
  readonly isHost: boolean;
}

/**
 * snapshotからUI権限を導出する。hostは固定p0ではなく、serverが返すhostIdと自席の
 * isHostが一致したときだけ表示する。不完全なsnapshotはguestとしてfail closedにする。
 */
export function onlinePermissions(
  snapshot: Pick<OnlineSnapshot, "you" | "hostId" | "players">,
): OnlinePermissions {
  const self = snapshot.players.find((player) => player.id === snapshot.you);
  return {
    playerId: snapshot.you,
    isHost:
      self?.id === snapshot.hostId &&
      self.isHost === true &&
      snapshot.hostId !== null,
  };
}

interface OnlineGameProviderProps {
  readonly children: React.ReactNode;
  readonly socket: WebSocket | null;
  readonly snapshot: OnlineSnapshot;
  readonly newGameDisabled?: boolean;
  readonly onSendError?: (message: string) => void;
}

const SOCKET_SEND_ERROR_MESSAGE =
  "オンラインサーバーとの接続が切れています。再接続を待っています。";

function wireTile(tile: TileData) {
  const canonicalTile = createTile(tile.suit, tile.rank);
  return {
    suit: canonicalTile.suit,
    rank: canonicalTile.rank,
    isRed: isRedDora(canonicalTile),
  };
}

function sendSocketMessage(
  socket: WebSocket | null,
  message: string,
  onSendError?: (message: string) => void,
): void {
  if (socket?.readyState !== WebSocket.OPEN) {
    onSendError?.(SOCKET_SEND_ERROR_MESSAGE);
    return;
  }

  try {
    socket.send(message);
  } catch {
    onSendError?.(SOCKET_SEND_ERROR_MESSAGE);
  }
}

export function onlineSocketUrl(): string {
  return (
    normalizeOnlineWebSocketUrl(
      process.env.NEXT_PUBLIC_ONLINE_WS_URL,
      process.env.NODE_ENV !== "production",
    ) ?? ""
  );
}

export default function OnlineGameProvider({
  children,
  socket,
  snapshot,
  newGameDisabled = false,
  onSendError,
}: OnlineGameProviderProps) {
  const { playerId, isHost } = useMemo(
    () => onlinePermissions(snapshot),
    [snapshot],
  );

  const sendAction = useCallback(
    (action: GameAction) => {
      sendSocketMessage(
        socket,
        JSON.stringify({
          type: "action",
          version: snapshot.version,
          action,
        }),
        onSendError,
      );
    },
    [onSendError, snapshot.version, socket],
  );

  const sendPlayerAction = useCallback(
    (action: GameAction, requestedPlayerId: PlayerId) => {
      // playerId は表示上の自席とサーバーが割り当てた席を一致させるために保持する。
      // 実際の認可はルームの再接続トークンを持つRailway側が行う。
      if (requestedPlayerId !== playerId) return;
      sendAction(action);
    },
    [playerId, sendAction],
  );

  const controls = useMemo<GameContextValue["controls"]>(
    () => ({
      discard: (tile) =>
        sendPlayerAction({ type: "discard", tile: wireTile(tile) }, playerId),
      tsumogiri: () => sendPlayerAction({ type: "tsumogiri" }, playerId),
      riichi: (tile) =>
        sendPlayerAction({ type: "riichi", tile: wireTile(tile) }, playerId),
      tsumo: () => sendPlayerAction({ type: "tsumo" }, playerId),
      ron: () => sendPlayerAction({ type: "ron" }, playerId),
      pon: () => sendPlayerAction({ type: "pon" }, playerId),
      kan: () => sendPlayerAction({ type: "kan" }, playerId),
      kita: () => {
        // capability欠落の旧serverでは北は従来どおり自動処理される。
        if (snapshot.explicitKita !== true) return;
        sendPlayerAction({ type: "kita" }, playerId);
      },
      ankan: (tile) =>
        sendPlayerAction({ type: "ankan", tile: wireTile(tile) }, playerId),
      kakan: (tile) =>
        sendPlayerAction({ type: "kakan", tile: wireTile(tile) }, playerId),
      passRon: () => sendPlayerAction({ type: "passRon" }, playerId),
      nextRound: () => {
        if (!isHost) return;
        sendPlayerAction({ type: "nextRound" }, playerId);
      },
      newGame: () => {
        if (!isHost || newGameDisabled) return;
        sendSocketMessage(
          socket,
          JSON.stringify({ type: "newGame" }),
          onSendError,
        );
      },
    }),
    [
      isHost,
      newGameDisabled,
      onSendError,
      playerId,
      sendPlayerAction,
      snapshot.explicitKita,
      socket,
    ],
  );

  const value = useMemo<GameContextValue>(
    () => ({
      playerId,
      isHost,
      view: snapshot.view,
      phase: snapshot.phase,
      pending: snapshot.pending,
      roundSummary: snapshot.roundSummary,
      sessionSaveStatus: "idle",
      historySaveStatus: "idle",
      seedGenerationError: false,
      controls,
    }),
    [controls, isHost, playerId, snapshot],
  );

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}
