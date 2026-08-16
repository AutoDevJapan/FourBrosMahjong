"use client";

import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import GameBoard from "@/components/game/GameBoard";
import OnlineGameProvider, { onlineSocketUrl } from "./OnlineGameProvider";
import type {
  OnlineConnectionStatus,
  OnlineCredentials,
  OnlineServerMessage,
  OnlineSnapshot,
} from "./types";

const ONLINE_SESSION_KEY = "four-bros-mahjong.online.session.v1";
const MAX_AUTOMATIC_RECONNECT_ATTEMPTS = 5;
const CONNECTION_ERROR_MESSAGE =
  "オンラインサーバーへ接続できません。設定とネットワークを確認してください。";
const RECONNECTING_ERROR_MESSAGE =
  "オンラインサーバーとの接続が切れました。再接続しています。";

type ConnectionStatus = OnlineConnectionStatus;
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

function connectionStatusMessage(status: ConnectionStatus): string {
  switch (status) {
    case "connecting":
      return "オンラインサーバーへ接続しています…";
    case "connected":
      return "オンラインサーバーに接続しました。";
    case "reconnecting":
      return "オンラインサーバーへ再接続しています…";
    case "failed":
      return "オンラインサーバーへの接続に失敗しました。再試行してください。";
    default:
      return "接続情報はこのタブのセッション中だけ保存します。";
  }
}

interface ConnectionFeedbackProps {
  readonly status: ConnectionStatus;
  readonly error: string;
  readonly canRetry: boolean;
  readonly feedbackRef: RefObject<HTMLDivElement | null>;
  readonly onRetry: (restoreFocus: boolean) => void;
}

function ConnectionFeedback({
  status,
  error,
  canRetry,
  feedbackRef,
  onRetry,
}: ConnectionFeedbackProps) {
  const retryButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <div
      aria-atomic="true"
      aria-live="polite"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-foreground/20 px-3 py-2 text-sm"
      data-connection-status={status}
      ref={feedbackRef}
      tabIndex={-1}
    >
      <div className="min-w-0">
        <p>{connectionStatusMessage(status)}</p>
        {error ? (
          <p
            className="mt-1 text-foreground/70"
            role={status === "failed" ? "alert" : "status"}
          >
            {error}
          </p>
        ) : null}
      </div>
      {status === "failed" ? (
        <button
          type="button"
          disabled={!canRetry}
          onClick={() =>
            onRetry(document.activeElement === retryButtonRef.current)
          }
          ref={retryButtonRef}
          className="min-h-11 shrink-0 rounded-lg border border-control-border px-3 py-2 font-medium whitespace-nowrap hover:bg-foreground/5 disabled:cursor-not-allowed disabled:opacity-40"
        >
          再試行
        </button>
      ) : null}
    </div>
  );
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
  const [activeRequest, setActiveRequest] = useState<JoinRequest | null>(null);
  const pendingSessionSocketRef = useRef<WebSocket | null>(null);
  const feedbackRef = useRef<HTMLDivElement>(null);
  const focusAfterRetryRef = useRef(false);
  const connectRef = useRef<
    (request: JoinRequest, reconnecting?: boolean) => void
  >(() => undefined);

  useEffect(() => {
    if (!focusAfterRetryRef.current) return;
    feedbackRef.current?.focus({ preventScroll: true });
    if (status === "connected" || status === "failed") {
      focusAfterRetryRef.current = false;
    }
  }, [snapshot, status]);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const scheduleReconnect = useCallback(
    (message = RECONNECTING_ERROR_MESSAGE) => {
      if (manualCloseRef.current) return;
      clearReconnectTimer();
      const attempt = reconnectAttemptRef.current;
      if (attempt >= MAX_AUTOMATIC_RECONNECT_ATTEMPTS) {
        setStatus("failed");
        setError(CONNECTION_ERROR_MESSAGE);
        return;
      }

      reconnectAttemptRef.current = attempt + 1;
      setStatus("reconnecting");
      setError(message);
      const delay = Math.min(10_000, 500 * 2 ** Math.min(attempt, 4));
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        const current = credentialsRef.current;
        if (current) {
          connectRef.current({ type: "resume", ...current }, true);
        }
      }, delay);
    },
    [clearReconnectTimer],
  );

  const failHandshake = useCallback(
    (failedSocket: WebSocket, message: string) => {
      if (socketRef.current !== failedSocket) return;
      pendingSessionSocketRef.current = null;
      socketRef.current = null;
      setSocket(null);
      setStatus("failed");
      setError(message);
      failedSocket.close();
    },
    [],
  );

  const handleTransportFailure = useCallback(
    (failedSocket: WebSocket, message = CONNECTION_ERROR_MESSAGE) => {
      if (socketRef.current !== failedSocket) return;
      pendingSessionSocketRef.current = null;
      socketRef.current = null;
      setSocket(null);
      failedSocket.close();
      if (manualCloseRef.current) {
        setStatus("idle");
        return;
      }
      if (credentialsRef.current) {
        scheduleReconnect(message);
      } else {
        setStatus("failed");
        setError(message);
      }
    },
    [scheduleReconnect],
  );

  const connect = useCallback(
    (request: JoinRequest, reconnecting = request.type === "resume") => {
      const url = onlineSocketUrl();
      if (!url) {
        setError(
          "オンラインサーバーURLが未設定です。NEXT_PUBLIC_ONLINE_WS_URLをVercelに設定してください。",
        );
        setStatus("failed");
        return;
      }
      clearReconnectTimer();
      const previous = socketRef.current;
      socketRef.current = null;
      pendingSessionSocketRef.current = null;
      setSocket(null);
      if (previous && previous.readyState !== WebSocket.CLOSED)
        previous.close();
      setError("");
      setStatus(reconnecting ? "reconnecting" : "connecting");
      let next: WebSocket;
      try {
        next = new WebSocket(url);
      } catch {
        setStatus("failed");
        setError(CONNECTION_ERROR_MESSAGE);
        return;
      }
      socketRef.current = next;
      pendingSessionSocketRef.current = next;
      setSocket(next);
      next.addEventListener("open", () => {
        if (socketRef.current !== next) return;
        try {
          next.send(JSON.stringify(request));
        } catch {
          handleTransportFailure(next);
        }
      });
      next.addEventListener("message", (event) => {
        if (socketRef.current !== next) return;
        try {
          const message = messageOf(JSON.parse(String(event.data)));
          if (!message) return;
          if (message.type === "session") {
            pendingSessionSocketRef.current = null;
            reconnectAttemptRef.current = 0;
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
            if (pendingSessionSocketRef.current === next) {
              failHandshake(next, message.message);
              return;
            }
            setError(message.message);
            return;
          }
        } catch {
          const message =
            "オンラインサーバーからの応答を読み取れませんでした。";
          if (pendingSessionSocketRef.current === next) {
            failHandshake(next, message);
          } else {
            setError(message);
          }
        }
      });
      next.addEventListener("close", () => {
        if (socketRef.current !== next) return;
        pendingSessionSocketRef.current = null;
        socketRef.current = null;
        setSocket(null);
        if (manualCloseRef.current || !credentialsRef.current) {
          setStatus(manualCloseRef.current ? "idle" : "failed");
          if (!manualCloseRef.current) setError(CONNECTION_ERROR_MESSAGE);
          return;
        }
        scheduleReconnect();
      });
      next.addEventListener("error", () => {
        handleTransportFailure(next);
      });
    },
    [
      clearReconnectTimer,
      failHandshake,
      handleTransportFailure,
      scheduleReconnect,
    ],
  );
  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const stored = readCredentials();
      if (!stored || socketRef.current || credentialsRef.current) return;
      manualCloseRef.current = false;
      credentialsRef.current = stored;
      setActiveRequest({ type: "resume", ...stored });
      setCredentials(stored);
      setRoomCode(stored.code);
      connect({ type: "resume", ...stored }, true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [connect]);

  useEffect(
    () => () => {
      manualCloseRef.current = true;
      clearReconnectTimer();
      const current = socketRef.current;
      socketRef.current = null;
      pendingSessionSocketRef.current = null;
      current?.close();
    },
    [clearReconnectTimer],
  );

  const start = (request: JoinRequest) => {
    manualCloseRef.current = false;
    reconnectAttemptRef.current = 0;
    focusAfterRetryRef.current = false;
    if (request.type !== "resume") {
      credentialsRef.current = null;
      setCredentials(null);
      saveCredentials(null);
    }
    setActiveRequest(request);
    connect(request);
  };

  const retry = (restoreFocus = false) => {
    manualCloseRef.current = false;
    reconnectAttemptRef.current = 0;
    focusAfterRetryRef.current = restoreFocus;
    const current = credentialsRef.current;
    const request = current
      ? ({ type: "resume", ...current } satisfies JoinRequest)
      : activeRequest;
    if (!request) return;
    connect(request, true);
  };

  const leave = () => {
    manualCloseRef.current = true;
    clearReconnectTimer();
    focusAfterRetryRef.current = false;
    credentialsRef.current = null;
    setActiveRequest(null);
    pendingSessionSocketRef.current = null;
    setCredentials(null);
    saveCredentials(null);
    const current = socketRef.current;
    socketRef.current = null;
    current?.close();
    setSocket(null);
    setSnapshot(null);
    setStatus("idle");
    setError("");
  };

  const copyRoomCode = async () => {
    if (!snapshot) return;
    try {
      await navigator.clipboard.writeText(snapshot.code);
      setError("ルームコードをコピーしました。");
    } catch {
      setError(
        "コピーできませんでした。ルームコードを手動で共有してください。",
      );
    }
  };

  const onSendError = useCallback((message: string) => setError(message), []);
  const canRetry = Boolean(credentials || activeRequest);
  const currentTurnName = snapshot?.currentTurn
    ? snapshot.players.find((player) => player.id === snapshot.currentTurn)
        ?.name
    : null;

  if (snapshot) {
    return (
      <OnlineGameProvider
        socket={status === "connected" ? socket : null}
        snapshot={snapshot}
        onSendError={onSendError}
      >
        <section className="flex flex-col gap-4" aria-label="オンライン対局">
          <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-control-border p-4">
            <div>
              <p className="text-xs tracking-widest text-foreground/60 uppercase">
                ルームコード
              </p>
              <button
                type="button"
                className="mt-1 font-mono text-2xl font-bold tracking-[0.25em]"
                onClick={copyRoomCode}
                title="クリックしてコピー"
              >
                {snapshot.code}
              </button>
              <p className="mt-1 text-xs text-foreground/60">
                {status === "reconnecting"
                  ? "再接続中…"
                  : "コードを共有して同じ卓に参加"}
              </p>
            </div>
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

          <ConnectionFeedback
            status={status}
            error={error}
            canRetry={canRetry}
            feedbackRef={feedbackRef}
            onRetry={retry}
          />
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

      <ConnectionFeedback
        status={status}
        error={error}
        canRetry={canRetry}
        feedbackRef={feedbackRef}
        onRetry={retry}
      />
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
