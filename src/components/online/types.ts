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

export interface OnlineSnapshot {
  readonly code: string;
  readonly version: number;
  readonly you: PlayerId;
  readonly phase: GamePhase;
  readonly view: GameViewState;
  readonly pending: Pending;
  readonly roundSummary: RoundSummary | null;
  readonly players: readonly OnlinePlayerSnapshot[];
  readonly currentTurn: PlayerId | null;
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
  | {
      readonly type: "error";
      readonly message: string;
      readonly code?: OnlineErrorCode;
      readonly scope?: OnlineRateLimitScope;
      readonly retryAfterMs?: number;
    }
  | { readonly type: "pong" };
