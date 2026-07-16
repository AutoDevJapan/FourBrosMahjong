"use client";

/**
 * 対局状態プロバイダ(スペック6 6.5 / 6.6 / 6.9)。
 *
 * ブラウザメモリ内(React state)に**実対局エンジンの状態**(`src/domain/game/engine.ts`)を保持し、
 * `/game`(対局画面)と `/game/result`(結果画面)の間で同一インスタンスを共有する。`/game` 配下の
 * 共有レイアウト(`app/game/layout.tsx`)に配置することで、ページ遷移してもプロバイダは再生成されず
 * 半荘の状態(進行・精算・結果)が保たれる(スペック6 6.5 / 6.9)。
 *
 * 本プロバイダは engine 状態の「保持」と、UI へ渡す**表示ビュー**(`selectView`)・**操作**(controls)
 * の受け渡しを担う。席割り・親・ツモ配分・ウマ等の決定ロジック(Q9〜Q13)は engine が持ち、
 * UI は値を受け取って表示する構造を維持する(スペック6 6.8)。
 *
 * バックエンド/永続化・複数デバイス同期は未設計のため、単一デバイス上のクライアント状態を前提とする
 * (スペック6 6.9)。
 */
import { createContext, useContext, useMemo, useState } from "react";
import {
  createGame,
  declareRon,
  declareTsumo,
  discard,
  type EngineState,
  type GamePhase,
  passRon,
  type Pending,
  proceedToNextRound,
  type RoundSummary,
} from "@/domain/game/engine";
import { selectView, toTile } from "./gameView";
import type { GameViewState, TileData } from "./types";

/** UI から呼べる対局操作。判定は engine 側が行う。 */
export interface GameControls {
  /** 自家の打牌(表示手牌から選んだ牌)。 */
  readonly discard: (tile: TileData) => void;
  /** 自家のツモ和了宣言。 */
  readonly tsumo: () => void;
  /** 自家のロン和了宣言。 */
  readonly ron: () => void;
  /** 自家のロン見送り(スルー)。 */
  readonly passRon: () => void;
  /** 局終了後、次局を開始する。 */
  readonly nextRound: () => void;
  /** 新規半荘を開始する(「もう一半荘」)。 */
  readonly newGame: () => void;
}

export interface GameContextValue {
  /** 対局画面の表示ビューモデル。 */
  readonly view: GameViewState;
  /** 半荘のフェーズ(playing / roundEnd / gameEnd)。 */
  readonly phase: GamePhase;
  /** 期待する自家入力(打牌 / ロン)。無ければ null。 */
  readonly pending: Pending;
  /** 直前局の決着サマリ(未決着時は null)。 */
  readonly roundSummary: RoundSummary | null;
  /** 対局操作。 */
  readonly controls: GameControls;
}

const GameContext = createContext<GameContextValue | null>(null);

export interface GameProviderProps {
  children: React.ReactNode;
  /** 初期エンジン状態(テスト/決定的再現用)。既定は新規半荘。 */
  initialGame?: EngineState;
}

export function GameProvider({ children, initialGame }: GameProviderProps) {
  const [engine, setEngine] = useState<EngineState>(
    () => initialGame ?? createGame(),
  );

  const controls = useMemo<GameControls>(
    () => ({
      discard: (tile) => setEngine((s) => discard(s, toTile(tile))),
      tsumo: () => setEngine(declareTsumo),
      ron: () => setEngine(declareRon),
      passRon: () => setEngine(passRon),
      nextRound: () => setEngine(proceedToNextRound),
      newGame: () => setEngine(() => createGame()),
    }),
    [],
  );

  const value = useMemo<GameContextValue>(
    () => ({
      view: selectView(engine),
      phase: engine.phase,
      pending: engine.pending,
      roundSummary: engine.lastRound,
      controls,
    }),
    [engine, controls],
  );

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

/** 対局状態・操作にアクセスする。`GameProvider` の外で呼ぶとエラー。 */
export function useGame(): GameContextValue {
  const ctx = useContext(GameContext);
  if (ctx === null) {
    throw new Error("useGame must be used within a GameProvider");
  }
  return ctx;
}
