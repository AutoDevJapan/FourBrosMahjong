"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import GameBoard from "@/components/game/GameBoard";
import OnlineGameProvider, { onlineSocketUrl } from "./OnlineGameProvider";
import RoomShareControls from "./RoomShareControls";
import { readSharedRoomCode, roomShareUrl } from "./roomSharing";
import type {
  OnlineCredentials,
  OnlineServerMessage,
  OnlineSnapshot,
} from "./types";

const ONLINE_SESSION_KEY = "four-bros-mahjong.online.session.v1";

type ConnectionStatus = "idle" | "connecting" | "connected" | "reconnecting";
type JoinRequest =
  | { readonly type: "create"; readonly name: string }
  | { readonly type: "join"; readonly code: string; readonly name: string }
  | { readonly type: "resume"; readonly code: string; readonly token: string };

function readCredentials(): OnlineCredentials | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(ONLINE_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OnlineCredentials>;
    if (
      typeof parsed.code !== "string" ||
      typeof parsed.token !== "string" ||
      parsed.code.length !== 6 ||
      parsed.token.length < 16
    ) {
      return null;
    }
    return { code: parsed.code, token: parsed.token };
  } catch {
    return null;
  }
}

function saveCredentials(credentials: OnlineCredentials | null): void {
  try {
    if (credentials === null) {
      window.sessionStorage.removeItem(ONLINE_SESSION_KEY);
    } else {
      window.sessionStorage.setItem(
        ONLINE_SESSION_KEY,
        JSON.stringify(credentials),
      );
    }
  } catch {
    // Storage不可でも現在の接続は継続する。
  }
}

function messageOf(value: unknown): OnlineServerMessage | null {
  if (value === null || typeof value !== "object") return null;
  const message = value as Partial<OnlineServerMessage>;
  return typeof message.type === "string"
    ? (message as OnlineServerMessage)
    : null;
}

export default function OnlineLobby() {
  const [name, setName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [snapshot, setSnapshot] = useState<OnlineSnapshot | null>(null);
  const [credentials, setCredentials] = useState<OnlineCredentials | null>(
    null,
  );
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [error, setError] = useState("");
  const socketRef = useRef<WebSocket | null>(null);
  const credentialsRef = useRef<OnlineCredentials | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const manualCloseRef = useRef(false);
  const restoreTimerRef = useRef<number | null>(null);
  const restoreCanceledRef = useRef(false);
  const connectRef = useRef<(request: JoinRequest) => void>(() => undefined);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const connect = useCallback(
    (request: JoinRequest) => {
      const url = onlineSocketUrl();
      if (!url) {
        setError(
          "オンラインサーバーURLが未設定です。NEXT_PUBLIC_ONLINE_WS_URLをVercelに設定してください。",
        );
        setStatus("idle");
        return;
      }
      clearReconnectTimer();
      const previous = socketRef.current;
      if (previous && previous.readyState !== WebSocket.CLOSED)
        previous.close();
      setError("");
      setStatus(request.type === "resume" ? "reconnecting" : "connecting");
      const next = new WebSocket(url);
      socketRef.current = next;
      setSocket(next);
      next.addEventListener("open", () => {
        reconnectAttemptRef.current = 0;
        setStatus("connected");
        next.send(JSON.stringify(request));
      });
      next.addEventListener("message", (event) => {
        try {
          const message = messageOf(JSON.parse(String(event.data)));
          if (!message) return;
          if (message.type === "session") {
            const nextCredentials = {
              code: message.snapshot.code,
              token: message.token,
            };
            credentialsRef.current = nextCredentials;
            setCredentials(nextCredentials);
            saveCredentials(nextCredentials);
            setRoomCode(message.snapshot.code);
            setSnapshot(message.snapshot);
            setStatus("connected");
            return;
          }
          if (message.type === "snapshot") {
            setSnapshot(message.snapshot);
            setRoomCode(message.snapshot.code);
            return;
          }
          if (message.type === "error") {
            setError(message.message);
            return;
          }
        } catch {
          setError("オンラインサーバーからの応答を読み取れませんでした。");
        }
      });
      next.addEventListener("close", () => {
        if (socketRef.current !== next) return;
        socketRef.current = null;
        setSocket(null);
        if (manualCloseRef.current || !credentialsRef.current) {
          setStatus("idle");
          return;
        }
        const attempt = reconnectAttemptRef.current++;
        const delay = Math.min(10_000, 500 * 2 ** Math.min(attempt, 4));
        setStatus("reconnecting");
        reconnectTimerRef.current = window.setTimeout(() => {
          const current = credentialsRef.current;
          if (current) connectRef.current({ type: "resume", ...current });
        }, delay);
      });
      next.addEventListener("error", () => {
        setError(
          "オンラインサーバーへ接続できません。設定とネットワークを確認してください。",
        );
      });
    },
    [clearReconnectTimer],
  );
  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  useEffect(() => {
    restoreCanceledRef.current = false;
    const timer = window.setTimeout(() => {
      restoreTimerRef.current = null;
      if (restoreCanceledRef.current) return;
      const stored = readCredentials();
      if (!stored) {
        const sharedCode = readSharedRoomCode();
        if (sharedCode) setRoomCode(sharedCode);
        return;
      }
      // StrictModeの初回effect cleanupで立つフラグを、実際の自動復元では解除する。
      manualCloseRef.current = false;
      credentialsRef.current = stored;
      setCredentials(stored);
      setRoomCode(stored.code);
      connect({ type: "resume", ...stored });
    }, 0);
    restoreTimerRef.current = timer;
    return () => {
      if (restoreTimerRef.current === timer) restoreTimerRef.current = null;
      window.clearTimeout(timer);
    };
  }, [connect]);

  useEffect(
    () => () => {
      manualCloseRef.current = true;
      clearReconnectTimer();
      socketRef.current?.close();
    },
    [clearReconnectTimer],
  );

  const start = (request: JoinRequest) => {
    restoreCanceledRef.current = true;
    if (restoreTimerRef.current !== null) {
      window.clearTimeout(restoreTimerRef.current);
      restoreTimerRef.current = null;
    }
    manualCloseRef.current = false;
    reconnectAttemptRef.current = 0;
    connect(request);
  };

  const leave = () => {
    restoreCanceledRef.current = true;
    if (restoreTimerRef.current !== null) {
      window.clearTimeout(restoreTimerRef.current);
      restoreTimerRef.current = null;
    }
    manualCloseRef.current = true;
    clearReconnectTimer();
    credentialsRef.current = null;
    setCredentials(null);
    saveCredentials(null);
    socketRef.current?.close();
    socketRef.current = null;
    setSocket(null);
    setSnapshot(null);
    setStatus("idle");
    setError("");
  };

  const onSendError = useCallback((message: string) => setError(message), []);
  const currentTurnName = snapshot?.currentTurn
    ? snapshot.players.find((player) => player.id === snapshot.currentTurn)
        ?.name
    : null;

  if (snapshot && socket) {
    return (
      <OnlineGameProvider
        socket={socket}
        snapshot={snapshot}
        onSendError={onSendError}
      >
        <section className="flex flex-col gap-4" aria-label="オンライン対局">
          <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-control-border p-4">
            <RoomShareControls
              key={snapshot.code}
              code={snapshot.code}
              shareUrl={roomShareUrl(snapshot.code)}
              statusMessage={
                status === "reconnecting"
                  ? "再接続中…"
                  : "コードを共有して同じ卓に参加"
              }
            />
            <div className="flex items-center gap-2">
              <span className="text-sm text-foreground/70">
                {
                  snapshot.players.find((player) => player.id === snapshot.you)
                    ?.name
                }
              </span>
              <button
                type="button"
                className="rounded-lg border border-control-border px-3 py-2 text-sm hover:bg-foreground/5"
                onClick={leave}
              >
                退出
              </button>
            </div>
          </header>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-foreground/5 px-4 py-3 text-sm">
            <div className="flex flex-wrap gap-x-4 gap-y-1" aria-label="参加者">
              {snapshot.players.map((player) => (
                <span
                  key={player.id}
                  className={player.connected ? "" : "text-foreground/45"}
                >
                  {player.name}
                  {player.isHost ? "（ホスト）" : ""}
                  {player.connected ? "" : "（切断）"}
                </span>
              ))}
            </div>
            <span aria-live="polite">
              {currentTurnName ? `${currentTurnName}の手番` : "対局終了"}
            </span>
          </div>

          {error ? (
            <p
              role="status"
              className="rounded-lg border border-foreground/20 px-3 py-2 text-sm"
            >
              {error}
            </p>
          ) : null}
          <GameBoard resultHref="/online" />
        </section>
      </OnlineGameProvider>
    );
  }

  const canSubmit =
    name.trim().length > 0 &&
    status !== "connecting" &&
    status !== "reconnecting";
  return (
    <section className="mx-auto flex w-full max-w-md flex-col gap-6 rounded-xl border border-control-border p-6">
      <header>
        <p className="text-xs tracking-widest text-foreground/60 uppercase">
          FourBrosMahjong
        </p>
        <h1 className="mt-2 text-2xl font-bold">オンライン対戦</h1>
        <p className="mt-2 text-sm/6 text-foreground/70">
          ルームコードを共有して、同じ半荘を別端末からプレイできます。空席はAIが担当します。
        </p>
      </header>

      <label className="flex flex-col gap-2 text-sm font-medium">
        表示名
        <input
          value={name}
          onChange={(event) => setName(event.target.value.slice(0, 12))}
          maxLength={12}
          placeholder="例: たろう"
          className="rounded-lg border border-control-border bg-transparent px-3 py-2 font-normal"
        />
      </label>

      <div className="flex flex-col gap-3">
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => start({ type: "create", name: name.trim() })}
          className="rounded-lg bg-foreground px-4 py-3 font-medium text-background disabled:cursor-not-allowed disabled:opacity-40"
        >
          新しいルームを作る
        </button>
        <div className="flex items-end gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-2 text-sm font-medium">
            ルームコード
            <input
              value={roomCode}
              onChange={(event) =>
                setRoomCode(event.target.value.toUpperCase().slice(0, 6))
              }
              maxLength={6}
              inputMode="text"
              autoCapitalize="characters"
              placeholder="ABC234"
              className="rounded-lg border border-control-border bg-transparent px-3 py-2 font-mono font-normal tracking-widest"
            />
          </label>
          <button
            type="button"
            disabled={!canSubmit || roomCode.trim().length !== 6}
            onClick={() =>
              start({ type: "join", code: roomCode.trim(), name: name.trim() })
            }
            className="rounded-lg border border-control-border px-4 py-2.5 font-medium disabled:cursor-not-allowed disabled:opacity-40"
          >
            参加する
          </button>
        </div>
      </div>

      <p className="text-xs/5 text-foreground/60">
        {status === "connecting" || status === "reconnecting"
          ? "オンラインサーバーへ接続しています…"
          : "接続情報はこのタブのセッション中だけ保存します。"}
      </p>
      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-foreground/20 px-3 py-2 text-sm"
        >
          {error}
        </p>
      ) : null}
      {credentials && !snapshot ? (
        <button
          type="button"
          className="text-left text-sm underline"
          onClick={leave}
        >
          保存済みのルーム接続を解除
        </button>
      ) : null}
    </section>
  );
}
