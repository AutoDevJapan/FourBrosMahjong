import type { GameViewState } from "@/components/game/types";
import type {
  GamePhase,
  Pending,
  PlayerId,
  RoundSummary,
} from "@/domain/game/engine";

export interface OnlinePlayerSnapshot {
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

export type OnlineServerMessage =
  | {
      readonly type: "session";
      readonly token: string;
      readonly snapshot: OnlineSnapshot;
    }
  | { readonly type: "snapshot"; readonly snapshot: OnlineSnapshot }
  | { readonly type: "error"; readonly message: string }
  | { readonly type: "pong" };
