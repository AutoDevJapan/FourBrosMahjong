"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import GameBoard from "@/components/game/GameBoard";
import OnlineGameProvider, { onlineSocketUrl } from "./OnlineGameProvider";
import type {
  OnlineCredentials,
  OnlineServerMessage,
  OnlineSnapshot,
} from "./types";

const ONLINE_SESSION_KEY = "four-bros-mahjong.online.session.v1";
const ROOM_CODE_LENGTH = 6;
const ROOM_CODE_PATTERN = /^[A-Z2-9]{6}$/;
const NAME_INPUT_ID = "online-lobby-name";
const ROOM_CODE_INPUT_ID = "online-lobby-room-code";
const NAME_REQUIREMENT_ID = "online-lobby-name-requirement";
const ROOM_CODE_REQUIREMENT_ID = "online-lobby-room-code-requirement";
const JOIN_REQUIREMENT_ID = "online-lobby-join-requirement";

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

function nameRequirementMessage(name: string): string {
  return name.trim().length > 0
    ? "表示名は入力されています(12文字以内)。"
    : "参加には表示名が必要です。表示名を入力してください(12文字以内)。";
}

function roomCodeRequirementMessage(roomCode: string): string {
  const normalized = roomCode.trim();
  if (normalized.length === 0) {
    return "参加には6文字のルームコードが必要です。ルームコードを入力してください。";
  }
  if (normalized.length < ROOM_CODE_LENGTH) {
    return `ルームコードは6文字必要です。あと${ROOM_CODE_LENGTH - normalized.length}文字入力してください。`;
  }
  if (!ROOM_CODE_PATTERN.test(normalized)) {
    return "ルームコードは英大文字と2〜9の数字を使った6文字で入力してください。";
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
  const restoredRef = useRef(false);
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
    if (restoredRef.current) return;
    restoredRef.current = true;
    const timer = window.setTimeout(() => {
      const stored = readCredentials();
      if (!stored) return;
      credentialsRef.current = stored;
      setCredentials(stored);
      setRoomCode(stored.code);
      connect({ type: "resume", ...stored });
    }, 0);
    return () => window.clearTimeout(timer);
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
    manualCloseRef.current = false;
    reconnectAttemptRef.current = 0;
    connect(request);
  };

  const leave = () => {
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
  const normalizedRoomCode = roomCode.trim();
  const joinDisabled =
    !canSubmit || !ROOM_CODE_PATTERN.test(normalizedRoomCode);
  const nameRequirement = nameRequirementMessage(name);
  const roomCodeRequirement = roomCodeRequirementMessage(roomCode);
  const joinRequirement = joinRequirementMessage(name, roomCode, status);
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
          onChange={(event) => setName(event.target.value.slice(0, 12))}
          maxLength={12}
          placeholder="例: たろう"
          required
          aria-invalid={name.trim().length === 0}
          aria-describedby={NAME_REQUIREMENT_ID}
          className="rounded-lg border border-control-border bg-transparent px-3 py-2 font-normal"
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
          onClick={() => start({ type: "create", name: name.trim() })}
          className="rounded-lg bg-foreground px-4 py-3 font-medium text-background disabled:cursor-not-allowed disabled:opacity-40"
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
              className="rounded-lg border border-control-border bg-transparent px-3 py-2 font-mono font-normal tracking-widest"
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
              start({ type: "join", code: roomCode.trim(), name: name.trim() })
            }
            className="rounded-lg border border-control-border px-4 py-2.5 font-medium disabled:cursor-not-allowed disabled:opacity-40"
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
