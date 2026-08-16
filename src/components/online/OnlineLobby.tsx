"use client";

import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import GameBoard from "@/components/game/GameBoard";
import ScreenNavigation from "@/components/layout/ScreenNavigation";
import {
  limitPlayerName,
  MAX_PLAYER_NAME_LENGTH,
  sanitizePlayerName,
} from "@/lib/playerName";
import OnlineGameProvider, { onlineSocketUrl } from "./OnlineGameProvider";
import RoomShareControls from "./RoomShareControls";
import { readSharedRoomCode, roomShareUrl } from "./roomSharing";
import type {
  OnlineConnectionStatus,
  OnlineCredentials,
  OnlineErrorCode,
  OnlineRateLimitScope,
  OnlineServerError,
  OnlineServerMessage,
  OnlineSnapshot,
} from "./types";

const ONLINE_SESSION_KEY = "four-bros-mahjong.online.session.v1";
const ROOM_CODE_LENGTH = 6;
const ROOM_CODE_PATTERN = /^[A-Z2-9]{6}$/;
const ROOM_CODE_CHARACTER_PATTERN = /^[A-Z2-9]*$/;
const ROOM_CODE_FORMAT_MESSAGE =
  "ルームコードは英大文字と2〜9の数字を使った6文字で入力してください。";
const NAME_INPUT_ID = "online-lobby-name";
const ROOM_CODE_INPUT_ID = "online-lobby-room-code";
const NAME_REQUIREMENT_ID = "online-lobby-name-requirement";
const ROOM_CODE_REQUIREMENT_ID = "online-lobby-room-code-requirement";
const JOIN_REQUIREMENT_ID = "online-lobby-join-requirement";
const MAX_AUTOMATIC_RECONNECT_ATTEMPTS = 5;
// サーバーからの異常値で、UIを長時間ロックしないための上限。
const MAX_SERVER_RETRY_AFTER_MS = 10 * 60 * 1000;
const CONNECTION_ERROR_MESSAGE =
  "オンラインサーバーへ接続できません。設定とネットワークを確認してください。";
const RECONNECTING_ERROR_MESSAGE =
  "オンラインサーバーとの接続が切れました。再接続しています。";

type ConnectionStatus = OnlineConnectionStatus;
type JoinRequest =
  | { readonly type: "create"; readonly name: string }
  | { readonly type: "join"; readonly code: string; readonly name: string }
  | { readonly type: "resume"; readonly code: string; readonly token: string };
type ConnectionFailure = Pick<OnlineServerError, "message" | "retryAfterMs">;

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

function isOnlineErrorCode(value: unknown): value is OnlineErrorCode {
  return (
    value === "connection_limit" ||
    value === "message_too_large" ||
    value === "rate_limited"
  );
}

function isOnlineRateLimitScope(value: unknown): value is OnlineRateLimitScope {
  return (
    value === "connection" ||
    value === "create" ||
    value === "join" ||
    value === "resume" ||
    value === "action" ||
    value === "message"
  );
}

function normalizeRetryAfterMs(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return Math.min(MAX_SERVER_RETRY_AFTER_MS, Math.ceil(value));
}

function messageOf(value: unknown): OnlineServerMessage | null {
  if (value === null || typeof value !== "object") return null;
  const message = value as Record<string, unknown>;
  if (typeof message.type !== "string") return null;
  if (message.type !== "error") {
    return message as unknown as OnlineServerMessage;
  }
  if (typeof message.message !== "string") return null;

  const code = isOnlineErrorCode(message.code) ? message.code : undefined;
  const scope = isOnlineRateLimitScope(message.scope)
    ? message.scope
    : undefined;
  const retryAfterMs = normalizeRetryAfterMs(message.retryAfterMs);
  return {
    type: "error",
    message: message.message,
    ...(code === undefined ? {} : { code }),
    ...(scope === undefined ? {} : { scope }),
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  };
}

function nameRequirementMessage(name: string): string {
  return name.trim().length > 0
    ? `表示名は入力されています(${MAX_PLAYER_NAME_LENGTH}文字以内)。`
    : `参加には表示名が必要です。表示名を入力してください(${MAX_PLAYER_NAME_LENGTH}文字以内)。`;
}

function roomCodeRequirementMessage(roomCode: string): string {
  const normalized = roomCode.trim();
  if (normalized.length === 0) {
    return "参加には6文字のルームコードが必要です。ルームコードを入力してください。";
  }
  const lengthMessage =
    normalized.length < ROOM_CODE_LENGTH
      ? `ルームコードは6文字必要です。あと${ROOM_CODE_LENGTH - normalized.length}文字入力してください。`
      : normalized.length > ROOM_CODE_LENGTH
        ? "ルームコードは6文字以内で入力してください。"
        : "";
  if (!ROOM_CODE_CHARACTER_PATTERN.test(normalized)) {
    return lengthMessage
      ? `${ROOM_CODE_FORMAT_MESSAGE} ${lengthMessage}`
      : ROOM_CODE_FORMAT_MESSAGE;
  }
  if (lengthMessage) return lengthMessage;
  if (!ROOM_CODE_PATTERN.test(normalized)) {
    return ROOM_CODE_FORMAT_MESSAGE;
  }
  return "ルームコードは6文字入力されています。";
}

function joinRequirementMessage(
  name: string,
  roomCode: string,
  status: ConnectionStatus,
): string {
  const requirements: string[] = [];
  if (name.trim().length === 0) {
    requirements.push("表示名を入力してください。");
  }

  const normalizedRoomCode = roomCode.trim();
  if (normalizedRoomCode.length < ROOM_CODE_LENGTH) {
    requirements.push(roomCodeRequirementMessage(roomCode));
  } else if (!ROOM_CODE_PATTERN.test(normalizedRoomCode)) {
    requirements.push(roomCodeRequirementMessage(roomCode));
  }

  if (status === "connecting" || status === "reconnecting") {
    requirements.push("オンラインサーバーへ接続しています…");
  }

  return requirements.length > 0
    ? requirements.join(" ")
    : "参加条件を満たしています。参加できます。";
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

function retryAfterMessage(retryAfterMs: number): string {
  return `再試行まで約${Math.max(1, Math.ceil(retryAfterMs / 1000))}秒お待ちください。`;
}

interface ConnectionFeedbackProps {
  readonly status: ConnectionStatus;
  readonly error: string;
  readonly canRetry: boolean;
  readonly retryAfterMs: number;
  readonly feedbackRef: RefObject<HTMLDivElement | null>;
  readonly onRetry: (restoreFocus: boolean) => void;
}

function ConnectionFeedback({
  status,
  error,
  canRetry,
  retryAfterMs,
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
        {retryAfterMs > 0 ? (
          <p className="mt-1 text-foreground/70" role="status">
            {retryAfterMessage(retryAfterMs)}
          </p>
        ) : null}
      </div>
      {status === "failed" ? (
        <button
          type="button"
          disabled={!canRetry || retryAfterMs > 0}
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
  const [retryAfterMs, setRetryAfterMs] = useState(0);
  const socketRef = useRef<WebSocket | null>(null);
  const credentialsRef = useRef<OnlineCredentials | null>(null);
  const reconnectAttemptRef = useRef(0);
  const composingNameRef = useRef(false);
  const reconnectTimerRef = useRef<number | null>(null);
  const manualCloseRef = useRef(false);
  const restoreTimerRef = useRef<number | null>(null);
  const restoreCanceledRef = useRef(false);
  const [activeRequest, setActiveRequest] = useState<JoinRequest | null>(null);
  const pendingSessionSocketRef = useRef<WebSocket | null>(null);
  const feedbackRef = useRef<HTMLDivElement>(null);
  const focusAfterRetryRef = useRef(false);
  const retryAfterUntilRef = useRef(0);
  const retryAfterTimerRef = useRef<number | null>(null);
  const serverFailureRef = useRef<{
    readonly socket: WebSocket;
    readonly failure: ConnectionFailure;
  } | null>(null);
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

  const clearRetryCooldown = useCallback(() => {
    if (retryAfterTimerRef.current !== null) {
      window.clearInterval(retryAfterTimerRef.current);
      retryAfterTimerRef.current = null;
    }
    retryAfterUntilRef.current = 0;
    setRetryAfterMs(0);
  }, []);

  const applyRetryCooldown = useCallback((value: unknown) => {
    const normalized = normalizeRetryAfterMs(value);
    if (normalized === undefined || normalized <= 0) return;

    const nextUntil = Date.now() + normalized;
    if (nextUntil <= retryAfterUntilRef.current) return;
    retryAfterUntilRef.current = nextUntil;
    setRetryAfterMs(normalized);
    if (retryAfterTimerRef.current !== null) {
      window.clearInterval(retryAfterTimerRef.current);
    }
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, retryAfterUntilRef.current - Date.now());
      setRetryAfterMs(remaining);
      if (remaining === 0) {
        retryAfterUntilRef.current = 0;
        window.clearInterval(timer);
        if (retryAfterTimerRef.current === timer) {
          retryAfterTimerRef.current = null;
        }
      }
    }, 250);
    retryAfterTimerRef.current = timer;
  }, []);

  const scheduleReconnect = useCallback(
    (message = RECONNECTING_ERROR_MESSAGE, serverRetryAfterMs?: number) => {
      if (manualCloseRef.current) return;
      clearReconnectTimer();
      const retryAfter = normalizeRetryAfterMs(serverRetryAfterMs);
      const attempt = reconnectAttemptRef.current;
      if (attempt >= MAX_AUTOMATIC_RECONNECT_ATTEMPTS) {
        setStatus("failed");
        setError(message);
        applyRetryCooldown(retryAfter);
        return;
      }

      reconnectAttemptRef.current = attempt + 1;
      setStatus("reconnecting");
      setError(message);
      applyRetryCooldown(retryAfter);
      const backoffDelay = Math.min(10_000, 500 * 2 ** Math.min(attempt, 4));
      const delay = Math.max(backoffDelay, retryAfter ?? 0);
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        const current = credentialsRef.current;
        if (current) {
          connectRef.current({ type: "resume", ...current }, true);
        }
      }, delay);
    },
    [applyRetryCooldown, clearReconnectTimer],
  );

  const failHandshake = useCallback(
    (failedSocket: WebSocket, failure: ConnectionFailure) => {
      if (socketRef.current !== failedSocket) return;
      pendingSessionSocketRef.current = null;
      serverFailureRef.current = null;
      socketRef.current = null;
      setSocket(null);
      setStatus("failed");
      setError(failure.message);
      applyRetryCooldown(failure.retryAfterMs);
      failedSocket.close();
    },
    [applyRetryCooldown],
  );

  const handleTransportFailure = useCallback(
    (
      failedSocket: WebSocket,
      fallback: ConnectionFailure = { message: CONNECTION_ERROR_MESSAGE },
    ) => {
      if (socketRef.current !== failedSocket) return;
      const serverFailure =
        serverFailureRef.current?.socket === failedSocket
          ? serverFailureRef.current.failure
          : null;
      serverFailureRef.current = null;
      const failure = serverFailure ?? fallback;
      pendingSessionSocketRef.current = null;
      socketRef.current = null;
      setSocket(null);
      failedSocket.close();
      if (manualCloseRef.current) {
        setStatus("idle");
        return;
      }
      if (credentialsRef.current) {
        scheduleReconnect(failure.message, failure.retryAfterMs);
      } else {
        setStatus("failed");
        setError(failure.message);
        applyRetryCooldown(failure.retryAfterMs);
      }
    },
    [applyRetryCooldown, scheduleReconnect],
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
      clearRetryCooldown();
      serverFailureRef.current = null;
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
            const failure: ConnectionFailure = {
              message: message.message,
              ...(message.code === "rate_limited" &&
              message.retryAfterMs !== undefined
                ? { retryAfterMs: message.retryAfterMs }
                : {}),
            };
            if (pendingSessionSocketRef.current === next) {
              failHandshake(next, failure);
              return;
            }
            if (
              message.code === "rate_limited" ||
              message.code === "message_too_large"
            ) {
              serverFailureRef.current = { socket: next, failure };
              applyRetryCooldown(failure.retryAfterMs);
            }
            setError(message.message);
            return;
          }
        } catch {
          const failure: ConnectionFailure = {
            message: "オンラインサーバーからの応答を読み取れませんでした。",
          };
          if (pendingSessionSocketRef.current === next) {
            failHandshake(next, failure);
          } else {
            setError(failure.message);
          }
        }
      });
      next.addEventListener("close", () => {
        if (socketRef.current !== next) return;
        const serverFailure =
          serverFailureRef.current?.socket === next
            ? serverFailureRef.current.failure
            : null;
        serverFailureRef.current = null;
        pendingSessionSocketRef.current = null;
        socketRef.current = null;
        setSocket(null);
        if (manualCloseRef.current || !credentialsRef.current) {
          setStatus(manualCloseRef.current ? "idle" : "failed");
          if (!manualCloseRef.current) {
            setError(serverFailure?.message ?? CONNECTION_ERROR_MESSAGE);
            applyRetryCooldown(serverFailure?.retryAfterMs);
          }
          return;
        }
        if (serverFailure) {
          scheduleReconnect(serverFailure.message, serverFailure.retryAfterMs);
        } else {
          scheduleReconnect();
        }
      });
      next.addEventListener("error", () => {
        handleTransportFailure(next);
      });
    },
    [
      clearReconnectTimer,
      clearRetryCooldown,
      applyRetryCooldown,
      failHandshake,
      handleTransportFailure,
      scheduleReconnect,
    ],
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
      if (socketRef.current || credentialsRef.current) return;
      manualCloseRef.current = false;
      credentialsRef.current = stored;
      setActiveRequest({ type: "resume", ...stored });
      setCredentials(stored);
      setRoomCode(stored.code);
      connect({ type: "resume", ...stored }, true);
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
      clearRetryCooldown();
      serverFailureRef.current = null;
      const current = socketRef.current;
      socketRef.current = null;
      pendingSessionSocketRef.current = null;
      current?.close();
    },
    [clearReconnectTimer, clearRetryCooldown],
  );

  const start = (request: JoinRequest) => {
    restoreCanceledRef.current = true;
    if (restoreTimerRef.current !== null) {
      window.clearTimeout(restoreTimerRef.current);
      restoreTimerRef.current = null;
    }
    manualCloseRef.current = false;
    reconnectAttemptRef.current = 0;
    focusAfterRetryRef.current = false;
    clearRetryCooldown();
    serverFailureRef.current = null;
    if (request.type !== "resume") {
      credentialsRef.current = null;
      setCredentials(null);
      saveCredentials(null);
    }
    setActiveRequest(request);
    connect(request);
  };

  const retry = (restoreFocus = false) => {
    if (retryAfterMs > 0) return;
    manualCloseRef.current = false;
    reconnectAttemptRef.current = 0;
    focusAfterRetryRef.current = restoreFocus;
    clearRetryCooldown();
    serverFailureRef.current = null;
    const current = credentialsRef.current;
    const request = current
      ? ({ type: "resume", ...current } satisfies JoinRequest)
      : activeRequest;
    if (!request) return;
    connect(request, true);
  };

  const leave = () => {
    restoreCanceledRef.current = true;
    if (restoreTimerRef.current !== null) {
      window.clearTimeout(restoreTimerRef.current);
      restoreTimerRef.current = null;
    }
    manualCloseRef.current = true;
    clearReconnectTimer();
    clearRetryCooldown();
    serverFailureRef.current = null;
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
                className="inline-flex min-h-11 items-center rounded-lg border border-control-border px-3 py-2 text-sm hover:bg-foreground/5"
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
            retryAfterMs={retryAfterMs}
            feedbackRef={feedbackRef}
            onRetry={retry}
          />
          <GameBoard resultHref="/online" />
        </section>
      </OnlineGameProvider>
    );
  }

  const normalizedName = sanitizePlayerName(name);
  const canSubmit =
    normalizedName !== null &&
    status !== "connecting" &&
    status !== "reconnecting";
  const normalizedRoomCode = roomCode.trim();
  const joinDisabled =
    !canSubmit || !ROOM_CODE_PATTERN.test(normalizedRoomCode);
  const nameRequirement = nameRequirementMessage(name);
  const roomCodeRequirement = roomCodeRequirementMessage(roomCode);
  const joinRequirement = joinRequirementMessage(name, roomCode, status);
  return (
    <>
      <ScreenNavigation currentPath="/online" />
      <section className="mx-auto flex w-full max-w-md flex-col gap-6 rounded-xl border border-control-border p-6">
        <header>
          <p className="text-xs tracking-widest text-foreground/60 uppercase">
            FourBrosMahjong
          </p>
          <h1 className="mt-2 text-2xl font-bold">オンライン対戦</h1>
          <p className="mt-2 text-sm/6 text-foreground/70">
            ルームコードを共有して、同じ半荘を別端末からプレイできます。空席はAIが担当します。
          </p>
          <p className="mt-2 text-sm/6 text-foreground/70">
            参加するには表示名と6文字のルームコードが必要です。
          </p>
        </header>

        <div className="flex flex-col gap-2 text-sm font-medium">
          <label htmlFor={NAME_INPUT_ID}>表示名</label>
          <input
            id={NAME_INPUT_ID}
            type="text"
            value={name}
            onCompositionStart={() => {
              composingNameRef.current = true;
            }}
            onCompositionEnd={(event) => {
              composingNameRef.current = false;
              setName(limitPlayerName(event.currentTarget.value));
            }}
            // `compositionend` を落とす IME(一部の Android)でも、フォーカスアウト時に上限を復帰させる。
            onBlur={(event) => {
              if (!composingNameRef.current) return;
              composingNameRef.current = false;
              setName(limitPlayerName(event.currentTarget.value));
            }}
            onChange={(event) =>
              setName(
                composingNameRef.current
                  ? event.target.value
                  : limitPlayerName(event.target.value),
              )
            }
            placeholder="例: たろう"
            required
            aria-invalid={name.trim().length === 0}
            aria-describedby={NAME_REQUIREMENT_ID}
            className="min-h-11 rounded-lg border border-control-border bg-transparent px-3 py-2 font-normal"
          />
          <span
            id={NAME_REQUIREMENT_ID}
            aria-live="polite"
            className="text-xs/5 font-normal text-foreground/70"
          >
            {nameRequirement}
          </span>
        </div>

        <div className="flex flex-col gap-3">
          <button
            type="button"
            disabled={!canSubmit}
            aria-describedby={NAME_REQUIREMENT_ID}
            onClick={() =>
              start({ type: "create", name: normalizedName ?? "" })
            }
            className="min-h-11 rounded-lg bg-foreground px-4 py-3 font-medium text-background disabled:cursor-not-allowed disabled:opacity-40"
          >
            新しいルームを作る
          </button>
          <div className="flex items-end gap-2">
            <div className="flex min-w-0 flex-1 flex-col gap-2 text-sm font-medium">
              <label htmlFor={ROOM_CODE_INPUT_ID}>ルームコード</label>
              <input
                id={ROOM_CODE_INPUT_ID}
                type="text"
                value={roomCode}
                onChange={(event) =>
                  setRoomCode(event.target.value.toUpperCase().slice(0, 6))
                }
                maxLength={6}
                inputMode="text"
                autoCapitalize="characters"
                placeholder="ABC234"
                required
                aria-invalid={
                  normalizedRoomCode.length !== ROOM_CODE_LENGTH ||
                  !ROOM_CODE_PATTERN.test(normalizedRoomCode)
                }
                aria-describedby={ROOM_CODE_REQUIREMENT_ID}
                className="min-h-11 rounded-lg border border-control-border bg-transparent px-3 py-2 font-mono font-normal tracking-widest"
              />
              <span
                id={ROOM_CODE_REQUIREMENT_ID}
                aria-live="polite"
                className="text-xs/5 font-normal text-foreground/70"
              >
                {roomCodeRequirement}
              </span>
            </div>
            <button
              type="button"
              disabled={joinDisabled}
              aria-describedby={`${NAME_REQUIREMENT_ID} ${ROOM_CODE_REQUIREMENT_ID} ${JOIN_REQUIREMENT_ID}`}
              onClick={() =>
                start({
                  type: "join",
                  code: roomCode.trim(),
                  name: normalizedName ?? "",
                })
              }
              className="min-h-11 rounded-lg border border-control-border px-4 py-2.5 font-medium disabled:cursor-not-allowed disabled:opacity-40"
            >
              参加する
            </button>
          </div>
        </div>

        <p
          id={JOIN_REQUIREMENT_ID}
          role="status"
          aria-atomic="true"
          className="text-sm/6 text-foreground/70"
        >
          {joinRequirement}
        </p>

        <ConnectionFeedback
          status={status}
          error={error}
          canRetry={canRetry}
          retryAfterMs={retryAfterMs}
          feedbackRef={feedbackRef}
          onRetry={retry}
        />
        {credentials && !snapshot ? (
          <button
            type="button"
            className="inline-flex min-h-11 items-center text-left text-sm underline"
            onClick={leave}
          >
            保存済みのルーム接続を解除
          </button>
        ) : null}
      </section>
    </>
  );
}
