"use client";

import { useCallback, useMemo } from "react";
import {
  GameContext,
  type GameContextValue,
} from "@/components/game/GameProvider";
import type { GameAction } from "@/components/game/gamePersistence";
import type { TileData } from "@/components/game/types";
import type { PlayerId } from "@/domain/game/engine";
import { isRedDora } from "@/domain/tiles/tile";
import { normalizeOnlineWebSocketUrl } from "@/lib/onlineWebSocket";
import type { OnlineSnapshot } from "./types";

interface OnlineGameProviderProps {
  readonly children: React.ReactNode;
  readonly socket: WebSocket | null;
  readonly snapshot: OnlineSnapshot;
  readonly onSendError?: (message: string) => void;
}

function wireTile(tile: TileData) {
  return { suit: tile.suit, rank: tile.rank, isRed: isRedDora(tile) };
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
  onSendError,
}: OnlineGameProviderProps) {
  const sendAction = useCallback(
    (action: GameAction) => {
      if (socket?.readyState !== WebSocket.OPEN) {
        onSendError?.(
          "オンラインサーバーとの接続が切れています。再接続を待っています。",
        );
        return;
      }
      socket.send(
        JSON.stringify({
          type: "action",
          version: snapshot.version,
          action,
        }),
      );
    },
    [onSendError, snapshot.version, socket],
  );

  const sendPlayerAction = useCallback(
    (action: GameAction, playerId: PlayerId) => {
      // playerId は表示上の自席とサーバーが割り当てた席を一致させるために保持する。
      // 実際の認可はルームの再接続トークンを持つRailway側が行う。
      if (playerId !== snapshot.you) return;
      sendAction(action);
    },
    [sendAction, snapshot.you],
  );

  const controls = useMemo<GameContextValue["controls"]>(
    () => ({
      discard: (tile) =>
        sendPlayerAction(
          { type: "discard", tile: wireTile(tile) },
          snapshot.you,
        ),
      tsumogiri: () => sendPlayerAction({ type: "tsumogiri" }, snapshot.you),
      riichi: (tile) =>
        sendPlayerAction(
          { type: "riichi", tile: wireTile(tile) },
          snapshot.you,
        ),
      tsumo: () => sendPlayerAction({ type: "tsumo" }, snapshot.you),
      ron: () => sendPlayerAction({ type: "ron" }, snapshot.you),
      pon: () => sendPlayerAction({ type: "pon" }, snapshot.you),
      kan: () => sendPlayerAction({ type: "kan" }, snapshot.you),
      ankan: (tile) =>
        sendPlayerAction({ type: "ankan", tile: wireTile(tile) }, snapshot.you),
      kakan: (tile) =>
        sendPlayerAction({ type: "kakan", tile: wireTile(tile) }, snapshot.you),
      passRon: () => sendPlayerAction({ type: "passRon" }, snapshot.you),
      nextRound: () => sendPlayerAction({ type: "nextRound" }, snapshot.you),
      newGame: () => {
        if (socket?.readyState !== WebSocket.OPEN) {
          onSendError?.(
            "オンラインサーバーとの接続が切れています。再接続を待っています。",
          );
          return;
        }
        socket.send(JSON.stringify({ type: "newGame" }));
      },
    }),
    [onSendError, sendPlayerAction, snapshot.you, socket],
  );

  const value = useMemo<GameContextValue>(
    () => ({
      view: snapshot.view,
      phase: snapshot.phase,
      pending: snapshot.pending,
      roundSummary: snapshot.roundSummary,
      historySaveStatus: "idle",
      controls,
    }),
    [controls, snapshot],
  );

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}
