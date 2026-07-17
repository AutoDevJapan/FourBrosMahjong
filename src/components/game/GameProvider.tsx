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
  declareAnkan,
  declareKakan,
  declareKan,
  declarePon,
  declareRiichi,
  declareRon,
  declareTsumo,
  discard,
  type EngineState,
  type GamePhase,
  passRon,
  type Pending,
  proceedToNextRound,
  type RoundSummary,
  tsumogiri,
} from "@/domain/game/engine";
import { selectView, toTile } from "./gameView";
import type { GameViewState, TileData } from "./types";

/** UI から呼べる対局操作。判定は engine 側が行う。 */
export interface GameControls {
  /** 自家の打牌(表示手牌から選んだ牌)。 */
  readonly discard: (tile: TileData) => void;
  /** 自家のツモ切り(リーチ後にツモ和了しないとき)。 */
  readonly tsumogiri: () => void;
  /** 自家のリーチ宣言(宣言牌を切る)。 */
  readonly riichi: (tile: TileData) => void;
  /** 自家のツモ和了宣言。 */
  readonly tsumo: () => void;
  /** 自家のロン和了宣言。 */
  readonly ron: () => void;
  /** 自家のポン(直前の他家打牌に対して)。 */
  readonly pon: () => void;
  /** 自家の明槓(大明槓・直前の他家打牌に対して)。 */
  readonly kan: () => void;
  /** 自家の暗槓(自ツモ番・指定牌種)。 */
  readonly ankan: (tile: TileData) => void;
  /** 自家の加槓(自ツモ番・既存ポンに4枚目)。 */
  readonly kakan: (tile: TileData) => void;
  /** 自家のロン/鳴き見送り(スルー)。 */
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
  // 実対局の乱数状態は初期化子で1度だけ生成する。SSR とクライアント初回描画の不一致は、
  // 盤面を描く `GameBoard` 側のマウントゲート(クライアントでのみ盤面を描画)で回避する。
  const [engine, setEngine] = useState<EngineState>(
    () => initialGame ?? createGame(),
  );

  // 遷移は「イベントハンドラ内で現在の engine から1度だけ」算出し、その**値**を `setEngine` へ渡す。
  // engine の遷移は内部で `Wall` 等を可変更新するため、`setEngine((s) => transition(s))` の
  // 関数型更新にすると React Strict Mode(開発時)の updater 二重呼び出しで**同じ状態を2回
  // 破壊的に進めて**局が壊れる。controls は現在の engine を閉じ込めて毎レンダー再生成する
  // (イベントハンドラは二重呼び出しされないため、遷移は必ず1回だけ適用される)。
  const controls = useMemo<GameControls>(
    () => ({
      discard: (tile) => setEngine(discard(engine, toTile(tile))),
      tsumogiri: () => setEngine(tsumogiri(engine)),
      riichi: (tile) => setEngine(declareRiichi(engine, toTile(tile))),
      tsumo: () => setEngine(declareTsumo(engine)),
      ron: () => setEngine(declareRon(engine)),
      pon: () => setEngine(declarePon(engine)),
      kan: () => setEngine(declareKan(engine)),
      ankan: (tile) => setEngine(declareAnkan(engine, toTile(tile))),
      kakan: (tile) => setEngine(declareKakan(engine, toTile(tile))),
      passRon: () => setEngine(passRon(engine)),
      nextRound: () => setEngine(proceedToNextRound(engine)),
      newGame: () => setEngine(createGame()),
    }),
    [engine],
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
