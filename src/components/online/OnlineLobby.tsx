"use client";

import {
  type FormEvent,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import GameBoard from "@/components/game/GameBoard";
import { useGame } from "@/components/game/GameProvider";
import type { GameResultView } from "@/components/game/types";
import ScreenNavigation from "@/components/layout/ScreenNavigation";
import RankingTable from "@/components/result/RankingTable";
import { SOSHII_BREAKDOWN_HEADING } from "@/components/result/resultLabels";
import SoshiiBreakdown from "@/components/result/SoshiiBreakdown";
import {
  limitPlayerName,
  MAX_PLAYER_NAME_LENGTH,
  sanitizePlayerName,
} from "@/lib/playerName";
import {
  normalizeRoomCode,
  ROOM_CODE_CHARACTER_PATTERN,
  ROOM_CODE_FORMAT_MESSAGE,
  ROOM_CODE_LENGTH,
} from "@/lib/roomCode";
import OnlineGameProvider, { onlineSocketUrl } from "./OnlineGameProvider";
import {
  MAX_MAINTENANCE_RETRY_AFTER_MS,
  parseOnlineServerMessage,
} from "./onlineServerMessage";
import RoomShareControls from "./RoomShareControls";
import { readSharedRoomCode, roomShareUrl } from "./roomSharing";
import type {
  OnlineConnectionStatus,
  OnlineCredentials,
  OnlineMaintenanceNotice,
  OnlineMaintenancePhase,
  OnlineServerError,
  OnlineSnapshot,
} from "./types";

const ONLINE_SESSION_KEY = "four-bros-mahjong.online.session.v1";
const NAME_INPUT_ID = "online-lobby-name";
const ROOM_CODE_INPUT_ID = "online-lobby-room-code";
const NAME_REQUIREMENT_ID = "online-lobby-name-requirement";
const ROOM_CODE_REQUIREMENT_ID = "online-lobby-room-code-requirement";
const JOIN_REQUIREMENT_ID = "online-lobby-join-requirement";
const MAINTENANCE_NOTICE_ID = "online-maintenance-notice";
const MAINTENANCE_RECOVERY_NOTICE_MS = 5_000;
const MAX_AUTOMATIC_RECONNECT_ATTEMPTS = 5;
// サーバーからの異常値で、UIを長時間ロックしないための上限。
const MAX_SERVER_RETRY_AFTER_MS = MAX_MAINTENANCE_RETRY_AFTER_MS;
// The application ping also exercises the server's JSON response path.
const CLIENT_HEARTBEAT_INTERVAL_MS = 15 * 1000;
// Three missed application pongs transition the existing reconnect state.
const CLIENT_HEARTBEAT_TIMEOUT_MS = 45 * 1000;
const CONNECTION_ERROR_MESSAGE =
  "オンラインサーバーへ接続できません。設定とネットワークを確認してください。";
const RECONNECTING_ERROR_MESSAGE =
  "オンラインサーバーとの接続が切れました。再接続しています。";
const HEARTBEAT_TIMEOUT_MESSAGE =
  "オンラインサーバーの応答が確認できないため、再接続しています。";
const MAINTENANCE_OPERATION_MESSAGE =
  "メンテナンス中のため、この操作は利用できません。";
const MAINTENANCE_REJECTION_RELOAD_MESSAGE =
  "メンテナンス終了後も表示が残る場合は、ページを再読み込みして再試行してください。";

type ConnectionStatus = OnlineConnectionStatus;
type JoinRequest =
  | { readonly type: "create"; readonly name: string }
  | { readonly type: "join"; readonly code: string; readonly name: string }
  | { readonly type: "resume"; readonly code: string; readonly token: string };
type ConnectionFailure = Pick<OnlineServerError, "message" | "retryAfterMs">;

type ErrorFeedbackKind = "connection" | "maintenance" | "operation";

interface ErrorFeedback {
  readonly kind: ErrorFeedbackKind;
  readonly message: string;
}

type MaintenanceClientState =
  | {
      readonly source: "notice";
      readonly notice: OnlineMaintenanceNotice;
    }
  | {
      readonly source: "rejection";
      readonly retryAfterMs?: number;
    };

function readCredentials(): OnlineCredentials | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(ONLINE_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OnlineCredentials>;
    const code = normalizeRoomCode(parsed.code);
    if (
      code === null ||
      typeof parsed.token !== "string" ||
      parsed.token.length < 16
    ) {
      return null;
    }
    return { code, token: parsed.token };
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

function normalizeRetryAfterMs(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return Math.min(MAX_SERVER_RETRY_AFTER_MS, Math.ceil(value));
}

function nameRequirementMessage(name: string): string {
  return name.trim().length > 0
    ? `表示名は入力されています(${MAX_PLAYER_NAME_LENGTH}文字以内)。`
    : `参加には表示名が必要です。表示名を入力してください(${MAX_PLAYER_NAME_LENGTH}文字以内)。`;
}

function roomCodeRequirementMessage(roomCode: string): string {
  const normalized = roomCode.trim().toUpperCase();
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
  if (normalizeRoomCode(roomCode) === null) {
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

  if (normalizeRoomCode(roomCode) === null) {
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

const MAINTENANCE_PHASE_RANK: Readonly<Record<OnlineMaintenancePhase, number>> =
  {
    draining: 0,
    drained: 1,
    terminating: 2,
  };

function maintenanceMessage(phase: OnlineMaintenancePhase): string {
  switch (phase) {
    case "draining":
      return "メンテナンス準備中です。現在の半荘はそのまま続けられます。新しいルームの作成・参加と、新しい半荘の開始はできません。";
    case "drained":
      return "メンテナンスのため新しい受付を停止しています。表示中の対局・結果は確認できます。新しいルームの作成・参加と、新しい半荘の開始はできません。";
    case "terminating":
      return "メンテナンスのためサーバーを再起動しています。表示中の対局・結果は確認できます。新しいルームの作成・参加と、新しい半荘の開始はできません。";
  }
}

function MaintenanceBanner({
  maintenance,
}: {
  readonly maintenance: MaintenanceClientState;
}) {
  const notice = maintenance.source === "notice" ? maintenance.notice : null;
  const retryAfterMs =
    maintenance.source === "notice"
      ? maintenance.notice.retryAfterMs
      : maintenance.retryAfterMs;
  return (
    <div
      id={MAINTENANCE_NOTICE_ID}
      data-maintenance-phase={notice?.phase ?? "unknown"}
      data-maintenance-source={maintenance.source}
      className="rounded-lg border border-control-border bg-foreground/5 px-4 py-3 text-sm"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <p className="font-medium">
        {notice
          ? maintenanceMessage(notice.phase)
          : "メンテナンスのため新しい受付を停止しています。新しいルームの作成・参加と、新しい半荘の開始はできません。"}
      </p>
      {notice?.deadline ? (
        <p className="mt-1 text-foreground/70">
          サーバー停止予定: {notice.deadline}
        </p>
      ) : null}
      {retryAfterMs !== undefined && retryAfterMs > 0 ? (
        <p className="mt-1 text-foreground/70">
          {retryAfterMessage(retryAfterMs)}
        </p>
      ) : null}
      {maintenance.source === "rejection" ? (
        <p className="mt-1 text-foreground/70">
          {MAINTENANCE_REJECTION_RELOAD_MESSAGE}
        </p>
      ) : null}
    </div>
  );
}

function MaintenanceRecoveryNotice() {
  return (
    <div
      className="rounded-lg border border-control-border bg-foreground/5 px-4 py-3 text-sm font-medium"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      メンテナンス準備を解除しました。新しい受付を再開します。
    </div>
  );
}

interface ConnectionFeedbackProps {
  readonly status: ConnectionStatus;
  readonly error: string;
  readonly canRetry: boolean;
  readonly retryAfterMs: number;
  readonly feedbackRef: RefObject<HTMLDivElement | null>;
  readonly retryButtonRef: RefObject<HTMLButtonElement | null>;
  readonly onRetry: (restoreFocus: boolean) => void;
}

type TransitionFocusTarget =
  | "connection-feedback"
  | "connection-retry"
  | "game-heading"
  | "lobby-heading";

interface PendingTransitionFocus {
  readonly origin: Element | null;
  readonly target: TransitionFocusTarget;
}

function ConnectionFeedback({
  status,
  error,
  canRetry,
  retryAfterMs,
  feedbackRef,
  retryButtonRef,
  onRetry,
}: ConnectionFeedbackProps) {
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-foreground/20 px-3 py-2 text-sm"
      data-connection-status={status}
      ref={feedbackRef}
      tabIndex={-1}
    >
      <div className="min-w-0">
        <p aria-atomic="true" aria-live="polite">
          {connectionStatusMessage(status)}
        </p>
        {error ? (
          <p
            aria-atomic="true"
            aria-live={status === "failed" ? "assertive" : "polite"}
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

interface OnlineResultViewProps {
  readonly result: GameResultView;
  readonly onBack: () => void;
  readonly newGameDisabled: boolean;
  readonly newGameDisabledByMaintenance: boolean;
}

function OnlineResultView({
  result,
  onBack,
  newGameDisabled,
  newGameDisabledByMaintenance,
}: OnlineResultViewProps) {
  const { controls, isHost } = useGame();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const orderedPlayers = [...result.players].sort((a, b) => a.rank - b.rank);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  const newGameUnavailableMessage = !isHost
    ? "新しい半荘を開始できるのはホストだけです。"
    : newGameDisabledByMaintenance
      ? MAINTENANCE_OPERATION_MESSAGE
      : newGameDisabled
        ? "接続が復旧すると新しい半荘を開始できます。"
        : null;

  return (
    <section
      aria-labelledby="online-result-heading"
      className="flex flex-col gap-6 rounded-xl border border-control-border p-4 sm:p-6"
    >
      <h2
        id="online-result-heading"
        ref={headingRef}
        tabIndex={-1}
        className="text-xl font-bold"
      >
        対局結果
      </h2>
      <section aria-labelledby="online-result-ranking-heading">
        <h3
          id="online-result-ranking-heading"
          className="text-lg font-semibold"
        >
          最終順位
        </h3>
        <RankingTable players={result.players} />
      </section>
      <section aria-labelledby="online-result-soshii-heading">
        <h3 id="online-result-soshii-heading" className="text-lg font-semibold">
          {SOSHII_BREAKDOWN_HEADING}
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {orderedPlayers.map((player) => (
            <SoshiiBreakdown key={player.rank} player={player} />
          ))}
        </div>
      </section>
      <div className="flex flex-wrap items-start gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex min-h-11 items-center rounded-full border border-control-border px-4 py-2 text-sm hover:bg-foreground/5"
        >
          対局画面へ戻る
        </button>
        <div className="flex flex-col items-start gap-1">
          <button
            type="button"
            disabled={!isHost || newGameDisabled}
            onClick={controls.newGame}
            aria-describedby={
              newGameUnavailableMessage
                ? "online-result-new-game-requirement"
                : undefined
            }
            className="inline-flex min-h-11 items-center rounded-lg border border-control-border px-4 py-2 text-sm font-medium hover:bg-foreground/5 disabled:cursor-not-allowed disabled:opacity-40"
          >
            新しい半荘を開始
          </button>
          {newGameUnavailableMessage ? (
            <p
              id="online-result-new-game-requirement"
              className="max-w-sm text-xs text-foreground/70"
            >
              {newGameUnavailableMessage}
            </p>
          ) : null}
        </div>
      </div>
    </section>
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
  const [error, setError] = useState<ErrorFeedback | null>(null);
  const [retryAfterMs, setRetryAfterMs] = useState(0);
  const [maintenance, setMaintenance] = useState<MaintenanceClientState | null>(
    null,
  );
  const [maintenanceRecoveryVisible, setMaintenanceRecoveryVisible] =
    useState(false);
  const [onlineResultOpen, setOnlineResultOpen] = useState(false);
  const onlineResultButtonRef = useRef<HTMLButtonElement>(null);
  const onlineGameFallbackRef = useRef<HTMLElement>(null);
  const restoreOnlineResultFocusRef = useRef(false);
  const restoreOnlineGameFocusRef = useRef(false);
  const onlineResultOpenRef = useRef(false);
  const suppressOnlineResultRestoreRef = useRef(false);
  const socketRef = useRef<WebSocket | null>(null);
  const snapshotRef = useRef<OnlineSnapshot | null>(null);
  const statusRef = useRef<ConnectionStatus>("idle");
  const credentialsRef = useRef<OnlineCredentials | null>(null);
  const maintenanceRef = useRef<MaintenanceClientState | null>(null);
  const reconnectAttemptRef = useRef(0);
  const composingNameRef = useRef(false);
  const reconnectTimerRef = useRef<number | null>(null);
  const manualCloseRef = useRef(false);
  const restoreTimerRef = useRef<number | null>(null);
  const restoreCanceledRef = useRef(false);
  const [activeRequest, setActiveRequest] = useState<JoinRequest | null>(null);
  const pendingSessionSocketRef = useRef<WebSocket | null>(null);
  const feedbackRef = useRef<HTMLDivElement>(null);
  const retryButtonRef = useRef<HTMLButtonElement>(null);
  const gameHeadingRef = useRef<HTMLHeadingElement>(null);
  const lobbyHeadingRef = useRef<HTMLHeadingElement>(null);
  const pendingTransitionFocusRef = useRef<PendingTransitionFocus | null>(null);
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

  const setConnectionError = useCallback((message: string) => {
    setError({ kind: "connection", message });
  }, []);

  const setOperationError = useCallback((message: string) => {
    setError({ kind: "operation", message });
  }, []);

  const setMaintenanceError = useCallback(() => {
    setError({ kind: "maintenance", message: MAINTENANCE_OPERATION_MESSAGE });
  }, []);

  const setOnlineResultOpenState = useCallback((open: boolean) => {
    onlineResultOpenRef.current = open;
    setOnlineResultOpen(open);
  }, []);

  const applyOnlineSnapshot = useCallback(
    (nextSnapshot: OnlineSnapshot) => {
      snapshotRef.current = nextSnapshot;
      setSnapshot(nextSnapshot);
      setRoomCode(nextSnapshot.code);
      // An operation rejection is paired with this authoritative snapshot by
      // the server. It is no longer relevant once the client has synchronized;
      // connection/transport guidance intentionally survives this update.
      setError((current) => (current?.kind === "operation" ? null : current));
      if (
        nextSnapshot.phase !== "gameEnd" ||
        nextSnapshot.view.result === null
      ) {
        if (onlineResultOpenRef.current) {
          if (pendingTransitionFocusRef.current !== null) {
            suppressOnlineResultRestoreRef.current = true;
            restoreOnlineResultFocusRef.current = false;
            restoreOnlineGameFocusRef.current = false;
          } else {
            restoreOnlineGameFocusRef.current = true;
          }
        }
        setOnlineResultOpenState(false);
      }
    },
    [setOnlineResultOpenState],
  );

  useLayoutEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    if (!maintenanceRecoveryVisible) return;
    const timer = window.setTimeout(
      () => setMaintenanceRecoveryVisible(false),
      MAINTENANCE_RECOVERY_NOTICE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [maintenanceRecoveryVisible]);

  const requestTransitionFocus = useCallback(
    (target: TransitionFocusTarget) => {
      // Read the focused node before the state update can unmount its subtree.
      // The node is compared after commit so an already-focused, persistent
      // feedback element is not focused again on every connection update.
      pendingTransitionFocusRef.current = {
        origin: document.activeElement,
        target,
      };
    },
    [],
  );

  useLayoutEffect(() => {
    const pending = pendingTransitionFocusRef.current;
    if (!pending) return;
    pendingTransitionFocusRef.current = null;

    const target =
      pending.target === "connection-feedback"
        ? feedbackRef.current
        : pending.target === "connection-retry"
          ? (() => {
              const retryButton =
                retryButtonRef.current ??
                feedbackRef.current?.querySelector<HTMLButtonElement>(
                  'button[type="button"]',
                );
              return retryButton?.disabled
                ? feedbackRef.current
                : (retryButton ?? feedbackRef.current);
            })()
          : pending.target === "game-heading"
            ? gameHeadingRef.current
            : lobbyHeadingRef.current;
    if (!target || target === pending.origin) return;
    target.focus({ preventScroll: true });
  }, [snapshot, status]);

  useEffect(() => {
    if (
      onlineResultOpen ||
      (!restoreOnlineResultFocusRef.current &&
        !restoreOnlineGameFocusRef.current)
    ) {
      return;
    }

    if (suppressOnlineResultRestoreRef.current) {
      suppressOnlineResultRestoreRef.current = false;
      restoreOnlineResultFocusRef.current = false;
      restoreOnlineGameFocusRef.current = false;
      return;
    }

    const resultButton = onlineResultButtonRef.current;
    resultButton?.focus({ preventScroll: true });
    if (resultButton !== null && document.activeElement === resultButton) {
      restoreOnlineResultFocusRef.current = false;
      restoreOnlineGameFocusRef.current = false;
      return;
    }

    onlineGameFallbackRef.current?.focus({ preventScroll: true });
    restoreOnlineResultFocusRef.current = false;
    restoreOnlineGameFocusRef.current = false;
  }, [onlineResultOpen]);

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

  const applyMaintenanceNotice = useCallback(
    (notice: OnlineMaintenanceNotice) => {
      const current = maintenanceRef.current;
      if (
        current?.source === "notice" &&
        MAINTENANCE_PHASE_RANK[current.notice.phase] >
          MAINTENANCE_PHASE_RANK[notice.phase]
      ) {
        return;
      }
      const next = { source: "notice", notice } as const;
      maintenanceRef.current = next;
      setMaintenance(next);
      setMaintenanceRecoveryVisible(false);
      clearReconnectTimer();
      reconnectAttemptRef.current = 0;
      setMaintenanceError();
      applyRetryCooldown(notice.retryAfterMs);
    },
    [applyRetryCooldown, clearReconnectTimer, setMaintenanceError],
  );

  const applyMaintenanceError = useCallback(
    (retryAfter: number | undefined) => {
      const current = maintenanceRef.current;
      if (current?.source !== "notice") {
        const next = {
          source: "rejection",
          ...(retryAfter === undefined ? {} : { retryAfterMs: retryAfter }),
        } as const;
        maintenanceRef.current = next;
        setMaintenance(next);
      }
      setMaintenanceRecoveryVisible(false);
      clearReconnectTimer();
      reconnectAttemptRef.current = 0;
      setMaintenanceError();
      applyRetryCooldown(retryAfter);
    },
    [applyRetryCooldown, clearReconnectTimer, setMaintenanceError],
  );

  const applyMaintenanceAccepting = useCallback(() => {
    const current = maintenanceRef.current;
    if (
      !current ||
      (current.source === "notice" && current.notice.phase === "terminating")
    ) {
      return;
    }
    maintenanceRef.current = null;
    setMaintenance(null);
    setMaintenanceRecoveryVisible(true);
    clearRetryCooldown();
    setError((currentError) =>
      currentError?.kind === "maintenance" ? null : currentError,
    );
  }, [clearRetryCooldown]);

  const settleMaintenanceDisconnect = useCallback(() => {
    const current = maintenanceRef.current;
    if (!current) return false;
    clearReconnectTimer();
    reconnectAttemptRef.current = 0;
    if (
      current.source === "notice" &&
      (current.notice.phase === "drained" ||
        current.notice.phase === "terminating")
    ) {
      credentialsRef.current = null;
      setCredentials(null);
      saveCredentials(null);
    }
    setStatus("failed");
    setMaintenanceError();
    return true;
  }, [clearReconnectTimer, setMaintenanceError]);

  const scheduleReconnect = useCallback(
    (message = RECONNECTING_ERROR_MESSAGE, serverRetryAfterMs?: number) => {
      if (manualCloseRef.current || maintenanceRef.current) return;
      clearReconnectTimer();
      const retryAfter = normalizeRetryAfterMs(serverRetryAfterMs);
      const attempt = reconnectAttemptRef.current;
      if (attempt >= MAX_AUTOMATIC_RECONNECT_ATTEMPTS) {
        requestTransitionFocus("connection-retry");
        setStatus("failed");
        setConnectionError(message);
        applyRetryCooldown(retryAfter);
        return;
      }

      reconnectAttemptRef.current = attempt + 1;
      setStatus("reconnecting");
      setConnectionError(message);
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
    [
      applyRetryCooldown,
      clearReconnectTimer,
      requestTransitionFocus,
      setConnectionError,
    ],
  );

  const failHandshake = useCallback(
    (failedSocket: WebSocket, failure: ConnectionFailure) => {
      if (socketRef.current !== failedSocket) return;
      requestTransitionFocus("connection-retry");
      pendingSessionSocketRef.current = null;
      serverFailureRef.current = null;
      socketRef.current = null;
      setSocket(null);
      setStatus("failed");
      setConnectionError(failure.message);
      applyRetryCooldown(failure.retryAfterMs);
      failedSocket.close();
    },
    [applyRetryCooldown, requestTransitionFocus, setConnectionError],
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
      if (settleMaintenanceDisconnect()) return;
      if (credentialsRef.current) {
        scheduleReconnect(failure.message, failure.retryAfterMs);
      } else {
        requestTransitionFocus("connection-retry");
        setStatus("failed");
        setConnectionError(failure.message);
        applyRetryCooldown(failure.retryAfterMs);
      }
    },
    [
      applyRetryCooldown,
      requestTransitionFocus,
      scheduleReconnect,
      settleMaintenanceDisconnect,
      setConnectionError,
    ],
  );

  const connect = useCallback(
    (request: JoinRequest, reconnecting = request.type === "resume") => {
      const url = onlineSocketUrl();
      if (!url) {
        requestTransitionFocus("connection-retry");
        setConnectionError(
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
      setError(null);
      setStatus(reconnecting ? "reconnecting" : "connecting");
      let next: WebSocket;
      try {
        next = new WebSocket(url);
      } catch {
        requestTransitionFocus("connection-retry");
        setStatus("failed");
        setConnectionError(CONNECTION_ERROR_MESSAGE);
        return;
      }
      socketRef.current = next;
      pendingSessionSocketRef.current = next;
      setSocket(next);
      let heartbeatTimer: number | null = null;
      let lastPongAt = Date.now();
      const clearHeartbeat = () => {
        if (heartbeatTimer !== null) {
          window.clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
      };
      const sendHeartbeat = () => {
        if (socketRef.current !== next) {
          clearHeartbeat();
          return;
        }
        if (next.readyState !== WebSocket.OPEN) return;
        if (Date.now() - lastPongAt >= CLIENT_HEARTBEAT_TIMEOUT_MS) {
          clearHeartbeat();
          handleTransportFailure(next, { message: HEARTBEAT_TIMEOUT_MESSAGE });
          return;
        }
        try {
          next.send(JSON.stringify({ type: "ping" }));
        } catch {
          clearHeartbeat();
          handleTransportFailure(next);
        }
      };
      next.addEventListener("open", () => {
        if (socketRef.current !== next) return;
        lastPongAt = Date.now();
        clearHeartbeat();
        heartbeatTimer = window.setInterval(
          sendHeartbeat,
          CLIENT_HEARTBEAT_INTERVAL_MS,
        );
        try {
          next.send(JSON.stringify({ ...request, explicitKita: true }));
        } catch {
          clearHeartbeat();
          handleTransportFailure(next);
        }
      });
      next.addEventListener("message", (event) => {
        if (socketRef.current !== next) return;
        try {
          const raw = JSON.parse(String(event.data));
          const message = parseOnlineServerMessage(raw);
          if (!message) return;
          if (message.type === "pong") {
            lastPongAt = Date.now();
            return;
          }
          if (message.type === "maintenance") {
            if (message.phase === "accepting") {
              applyMaintenanceAccepting();
            } else {
              applyMaintenanceNotice(message);
            }
            return;
          }
          if (message.type === "session") {
            const wasInGame = snapshotRef.current !== null;
            if (wasInGame) {
              if (statusRef.current === "reconnecting") {
                requestTransitionFocus("connection-feedback");
              }
            } else {
              requestTransitionFocus(
                focusAfterRetryRef.current
                  ? "connection-feedback"
                  : "game-heading",
              );
            }
            focusAfterRetryRef.current = false;
            pendingSessionSocketRef.current = null;
            reconnectAttemptRef.current = 0;
            const nextCredentials = {
              code: message.snapshot.code,
              token: message.token,
            };
            credentialsRef.current = nextCredentials;
            setCredentials(nextCredentials);
            saveCredentials(nextCredentials);
            applyOnlineSnapshot(message.snapshot);
            // A successful handshake ends any reconnect/handshake guidance;
            // operation errors have already been handled by the snapshot.
            setError(null);
            setStatus("connected");
            return;
          }
          if (message.type === "snapshot") {
            applyOnlineSnapshot(message.snapshot);
            return;
          }
          if (message.type === "error") {
            if (message.code === "maintenance") {
              applyMaintenanceError(message.retryAfterMs);
              const failure: ConnectionFailure = {
                message: MAINTENANCE_OPERATION_MESSAGE,
                ...(message.retryAfterMs === undefined
                  ? {}
                  : { retryAfterMs: message.retryAfterMs }),
              };
              if (pendingSessionSocketRef.current === next) {
                failHandshake(next, failure);
              }
              return;
            }
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
              setConnectionError(message.message);
            } else {
              setOperationError(message.message);
            }
            return;
          }
        } catch {
          const failure: ConnectionFailure = {
            message: "オンラインサーバーからの応答を読み取れませんでした。",
          };
          if (pendingSessionSocketRef.current === next) {
            failHandshake(next, failure);
          } else {
            setConnectionError(failure.message);
          }
        }
      });
      next.addEventListener("close", () => {
        clearHeartbeat();
        if (socketRef.current !== next) return;
        const serverFailure =
          serverFailureRef.current?.socket === next
            ? serverFailureRef.current.failure
            : null;
        serverFailureRef.current = null;
        pendingSessionSocketRef.current = null;
        socketRef.current = null;
        setSocket(null);
        if (settleMaintenanceDisconnect()) return;
        if (manualCloseRef.current || !credentialsRef.current) {
          if (!manualCloseRef.current) {
            requestTransitionFocus("connection-retry");
          }
          setStatus(manualCloseRef.current ? "idle" : "failed");
          if (!manualCloseRef.current) {
            setConnectionError(
              serverFailure?.message ?? CONNECTION_ERROR_MESSAGE,
            );
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
        clearHeartbeat();
        handleTransportFailure(next);
      });
    },
    [
      clearReconnectTimer,
      clearRetryCooldown,
      applyMaintenanceAccepting,
      applyMaintenanceError,
      applyMaintenanceNotice,
      applyRetryCooldown,
      applyOnlineSnapshot,
      failHandshake,
      handleTransportFailure,
      requestTransitionFocus,
      scheduleReconnect,
      settleMaintenanceDisconnect,
      setConnectionError,
      setOperationError,
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
      const sharedCode = readSharedRoomCode();
      const stored = readCredentials();
      // A deliberate room link takes precedence over an unrelated session left
      // in this tab. Otherwise opening a friend's link silently resumes the
      // previous room and never exposes the linked code in the join form.
      if (sharedCode && (!stored || stored.code !== sharedCode)) {
        setRoomCode(sharedCode);
        return;
      }
      if (!stored) {
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
    if (maintenanceRef.current) {
      setOperationError(MAINTENANCE_OPERATION_MESSAGE);
      return;
    }
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
    pendingTransitionFocusRef.current = null;
    if (request.type !== "resume") {
      credentialsRef.current = null;
      setCredentials(null);
      saveCredentials(null);
    }
    setActiveRequest(request);
    connect(request);
  };

  const retry = (restoreFocus = false) => {
    if (retryAfterMs > 0 || maintenanceRef.current) return;
    manualCloseRef.current = false;
    reconnectAttemptRef.current = 0;
    clearRetryCooldown();
    serverFailureRef.current = null;
    const current = credentialsRef.current;
    const request = current
      ? ({ type: "resume", ...current } satisfies JoinRequest)
      : activeRequest;
    if (!request) {
      focusAfterRetryRef.current = false;
      return;
    }
    focusAfterRetryRef.current = restoreFocus;
    if (restoreFocus) requestTransitionFocus("connection-feedback");
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
    requestTransitionFocus("lobby-heading");
    const current = socketRef.current;
    if (current?.readyState === WebSocket.OPEN) {
      try {
        current.send(JSON.stringify({ type: "leave" }));
      } catch {
        // close処理を優先する。server側のcloseでも同じ権限引継ぎを行う。
      }
    }
    socketRef.current = null;
    current?.close();
    setSocket(null);
    snapshotRef.current = null;
    setSnapshot(null);
    restoreOnlineResultFocusRef.current = false;
    restoreOnlineGameFocusRef.current = false;
    suppressOnlineResultRestoreRef.current = true;
    setOnlineResultOpenState(false);
    setStatus("idle");
    setError(null);
  };

  const onSendError = useCallback(
    (message: string) => setConnectionError(message),
    [setConnectionError],
  );
  const openOnlineResult = useCallback(() => {
    suppressOnlineResultRestoreRef.current = false;
    restoreOnlineResultFocusRef.current = false;
    restoreOnlineGameFocusRef.current = false;
    setOnlineResultOpenState(true);
  }, [setOnlineResultOpenState]);
  const returnToOnlineGame = useCallback(() => {
    suppressOnlineResultRestoreRef.current = false;
    restoreOnlineResultFocusRef.current = true;
    restoreOnlineGameFocusRef.current = false;
    setOnlineResultOpenState(false);
  }, [setOnlineResultOpenState]);
  const canRetry =
    maintenance === null && Boolean(credentials || activeRequest);
  const currentTurnName = snapshot?.currentTurn
    ? snapshot.players.find((player) => player.id === snapshot.currentTurn)
        ?.name
    : null;

  if (snapshot) {
    const onlineResult = snapshot.view.result;
    return (
      <OnlineGameProvider
        socket={status === "connected" ? socket : null}
        snapshot={snapshot}
        newGameDisabled={maintenance !== null}
        onSendError={onSendError}
      >
        <section
          ref={onlineGameFallbackRef}
          tabIndex={-1}
          className="flex flex-col gap-4"
          aria-label="オンライン対局"
        >
          <h1
            id="online-game-heading"
            ref={gameHeadingRef}
            tabIndex={-1}
            className="text-2xl font-bold"
          >
            オンライン対戦
          </h1>
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
              <span
                dir="auto"
                className="player-name-bidi-isolate text-sm text-foreground/70"
              >
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
                  dir="auto"
                  className={`player-name-bidi-isolate ${player.connected ? "" : "text-foreground/60"}`}
                >
                  {player.name}
                  {player.isHost ? "（ホスト）" : ""}
                  {player.connected ? "" : "（切断）"}
                </span>
              ))}
            </div>
            <span
              dir="auto"
              className="player-name-bidi-isolate"
              aria-live="polite"
            >
              {currentTurnName ? `${currentTurnName}の手番` : "対局終了"}
            </span>
          </div>

          {snapshot.hostNotice ? (
            <div
              className="rounded-lg border border-control-border bg-foreground/5 px-4 py-3 text-sm"
              role="status"
              aria-live="polite"
            >
              <p>{snapshot.hostNotice.message}</p>
              <p className="mt-1 text-foreground/70">
                次の操作: {snapshot.hostNotice.nextAction}
              </p>
            </div>
          ) : null}
          {snapshot.departureNotice ? (
            <div
              className="rounded-lg border border-control-border bg-foreground/5 px-4 py-3 text-sm"
              role="status"
              aria-live="polite"
            >
              <p>{snapshot.departureNotice.message}</p>
              <p className="mt-1 text-foreground/70">
                次の操作: {snapshot.departureNotice.nextAction}
              </p>
            </div>
          ) : null}

          {maintenance ? (
            <MaintenanceBanner maintenance={maintenance} />
          ) : (
            <>
              {maintenanceRecoveryVisible ? (
                <MaintenanceRecoveryNotice />
              ) : null}
              <ConnectionFeedback
                status={status}
                error={error?.message ?? ""}
                canRetry={canRetry}
                retryAfterMs={retryAfterMs}
                feedbackRef={feedbackRef}
                retryButtonRef={retryButtonRef}
                onRetry={retry}
              />
            </>
          )}
          {onlineResultOpen && onlineResult !== null ? (
            <OnlineResultView
              result={onlineResult}
              onBack={returnToOnlineGame}
              newGameDisabled={status !== "connected" || maintenance !== null}
              newGameDisabledByMaintenance={maintenance !== null}
            />
          ) : (
            <GameBoard
              onResult={openOnlineResult}
              resultButtonRef={onlineResultButtonRef}
              interactionDisabled={status !== "connected"}
              interactionDisabledReason={
                status === "failed"
                  ? "failed"
                  : status === "connected"
                    ? undefined
                    : "reconnecting"
              }
            />
          )}
        </section>
      </OnlineGameProvider>
    );
  }

  const normalizedName = sanitizePlayerName(name);
  const canSubmit =
    maintenance === null &&
    normalizedName !== null &&
    status !== "connecting" &&
    status !== "reconnecting";
  const normalizedRoomCode = normalizeRoomCode(roomCode);
  const joinDisabled = !canSubmit || normalizedRoomCode === null;
  const nameRequirement = nameRequirementMessage(name);
  const roomCodeRequirement = roomCodeRequirementMessage(roomCode);
  const joinRequirement = joinRequirementMessage(name, roomCode, status);
  const createRoom = () => {
    if (!canSubmit) return;
    start({ type: "create", name: normalizedName ?? "" });
  };
  const joinRoom = () => {
    if (joinDisabled || normalizedRoomCode === null) return;
    start({
      type: "join",
      code: normalizedRoomCode,
      name: normalizedName ?? "",
    });
  };
  const submitLobby = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const activeElement = event.currentTarget.ownerDocument.activeElement;
    const intent =
      submitter?.getAttribute("data-intent") ??
      (activeElement?.id === ROOM_CODE_INPUT_ID ? "join" : "create");
    if (intent === "join") {
      joinRoom();
      return;
    }
    createRoom();
  };
  return (
    <>
      <ScreenNavigation currentPath="/online" />
      <section className="mx-auto flex w-full max-w-md flex-col gap-6 rounded-xl border border-control-border p-6">
        {maintenance ? (
          <MaintenanceBanner maintenance={maintenance} />
        ) : maintenanceRecoveryVisible ? (
          <MaintenanceRecoveryNotice />
        ) : null}
        <form
          aria-label="オンラインルーム接続"
          onSubmit={submitLobby}
          className="flex flex-col gap-6"
        >
          <header>
            <p className="text-xs tracking-widest text-foreground/60 uppercase">
              FourBrosMahjong
            </p>
            <h1
              ref={lobbyHeadingRef}
              tabIndex={-1}
              className="mt-2 text-2xl font-bold"
            >
              オンライン対戦
            </h1>
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
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                if (
                  event.nativeEvent.isComposing ||
                  event.nativeEvent.keyCode === 229
                )
                  return;
                event.preventDefault();
                createRoom();
              }}
              placeholder="例: たろう"
              required
              aria-invalid={name.trim().length === 0}
              aria-describedby={`${NAME_REQUIREMENT_ID}${maintenance ? ` ${MAINTENANCE_NOTICE_ID}` : ""}`}
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
              type="submit"
              data-intent="create"
              formNoValidate
              disabled={!canSubmit}
              aria-describedby={`${NAME_REQUIREMENT_ID}${maintenance ? ` ${MAINTENANCE_NOTICE_ID}` : ""}`}
              onClick={(event) => {
                event.preventDefault();
                createRoom();
              }}
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
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    if (
                      event.nativeEvent.isComposing ||
                      event.nativeEvent.keyCode === 229
                    )
                      return;
                    event.preventDefault();
                    joinRoom();
                  }}
                  maxLength={6}
                  inputMode="text"
                  autoCapitalize="characters"
                  placeholder="ABC234"
                  required
                  aria-invalid={normalizedRoomCode === null}
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
                type="submit"
                data-intent="join"
                disabled={joinDisabled}
                aria-describedby={`${NAME_REQUIREMENT_ID} ${ROOM_CODE_REQUIREMENT_ID} ${JOIN_REQUIREMENT_ID}${maintenance ? ` ${MAINTENANCE_NOTICE_ID}` : ""}`}
                onClick={(event) => {
                  event.preventDefault();
                  joinRoom();
                }}
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
        </form>

        {maintenance === null ? (
          <ConnectionFeedback
            status={status}
            error={error?.message ?? ""}
            canRetry={canRetry}
            retryAfterMs={retryAfterMs}
            feedbackRef={feedbackRef}
            retryButtonRef={retryButtonRef}
            onRetry={retry}
          />
        ) : null}
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
