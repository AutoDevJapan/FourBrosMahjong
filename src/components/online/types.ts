import type { GameViewState } from "@/components/game/types";
import type {
  GamePhase,
  Pending,
  PlayerId,
  RoundSummary,
} from "@/domain/game/engine";

interface OnlinePlayerSnapshot {
  readonly id: PlayerId;
  readonly name: string;
  readonly connected: boolean;
  readonly isHost: boolean;
}

export type OnlineHostTransitionReason = "disconnected" | "left";

export interface OnlineHostNotice {
  readonly reason: OnlineHostTransitionReason;
  readonly message: string;
  readonly nextAction: string;
}

export interface OnlineSnapshot {
  readonly code: string;
  readonly version: number;
  readonly you: PlayerId;
  /** 現在のhost席。host退出直後など、従来の固定p0から変わり得る。 */
  readonly hostId: PlayerId | null;
  readonly phase: GamePhase;
  readonly view: GameViewState;
  readonly pending: Pending;
  readonly roundSummary: RoundSummary | null;
  readonly players: readonly OnlinePlayerSnapshot[];
  readonly currentTurn: PlayerId | null;
  /** host切断/退出後の権限引継ぎ理由と、現在の次操作。 */
  readonly hostNotice: OnlineHostNotice | null;
}

export interface OnlineCredentials {
  readonly code: string;
  readonly token: string;
}

export type OnlineErrorCode =
  | "connection_limit"
  | "message_too_large"
  | "rate_limited";

export type OnlineRateLimitScope =
  | "connection"
  | "create"
  | "join"
  | "resume"
  | "action"
  | "message";

export interface OnlineServerError {
  readonly type: "error";
  readonly message: string;
  readonly code?: OnlineErrorCode;
  readonly scope?: OnlineRateLimitScope;
  readonly retryAfterMs?: number;
}
export type OnlineConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "failed";

export type OnlineServerMessage =
  | {
      readonly type: "session";
      readonly token: string;
      readonly snapshot: OnlineSnapshot;
    }
  | { readonly type: "snapshot"; readonly snapshot: OnlineSnapshot }
  | OnlineServerError
  | { readonly type: "pong" };
