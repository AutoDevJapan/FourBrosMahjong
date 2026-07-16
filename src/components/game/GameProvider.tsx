"use client";

/**
 * 対局状態プロバイダ(スペック6 6.5 / 6.6 / 6.9)。
 *
 * ブラウザメモリ内(React state)に対局のビュー状態を保持し、`/game`(対局画面)と
 * `/game/result`(結果画面。実装は別issue #54)の間で同一インスタンスを共有する。
 * `/game` 配下の共有レイアウト(`app/game/layout.tsx`)に配置することで、ページ遷移しても
 * プロバイダは再生成されず状態が保たれる。
 *
 * バックエンド/永続化・複数デバイス同期は未設計のため、単一デバイス上のクライアント状態を前提とする
 * (スペック6 6.9)。本プロバイダは状態の「保持と受け渡し」のみを担い、席割り・親・ツモ配分・ウマ等の
 * 決定ロジック(Q9〜Q13)は一切含まない。骨組み段階では固定サンプルで初期化する(スペック6 6.8)。
 */
import { createContext, useContext, useMemo, useState } from "react";
import { sampleGameState } from "./sampleGame";
import type { GameViewState } from "./types";

interface GameContextValue {
  readonly state: GameViewState;
  /** 状態差し替え口。ドメイン層/進行制御が算出済みの状態を流し込むための箱。 */
  readonly setState: (next: GameViewState) => void;
}

const GameContext = createContext<GameContextValue | null>(null);

export interface GameProviderProps {
  children: React.ReactNode;
  /** テスト/将来の実データ注入用の初期状態。既定は固定サンプル(スペック6 6.8)。 */
  initialState?: GameViewState;
}

export function GameProvider({
  children,
  initialState = sampleGameState,
}: GameProviderProps) {
  const [state, setState] = useState<GameViewState>(initialState);
  const value = useMemo<GameContextValue>(() => ({ state, setState }), [state]);
  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

/** 対局ビュー状態にアクセスする。`GameProvider` の外で呼ぶとエラー。 */
export function useGame(): GameContextValue {
  const ctx = useContext(GameContext);
  if (ctx === null) {
    throw new Error("useGame must be used within a GameProvider");
  }
  return ctx;
}
