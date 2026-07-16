/**
 * 対局画面の描画確認用**固定ダミーデータ**(スペック6 6.8)。
 *
 * これはドメイン計算の結果ではなく、UI が「値を受け取って表示する」構造を確認するための
 * 静的なサンプルに過ぎない。席割り当て・抜け番・親・点差などは実ロジック(Q9〜Q13)ではなく
 * 手で置いた固定値であり、ゲーム進行の意味を持たない。ドメイン層が実装されたら差し替える。
 */
import type { GameResultView, GameViewState, TileData } from "./types";

/** 短縮ヘルパ。数牌。 */
const t = (suit: TileData["suit"], rank: number, isRed = false): TileData => ({
  suit,
  rank,
  isRed,
});

/** 字牌。rank: 東1 南2 西3 北4 白5 發6 中7。 */
const honor = (rank: number): TileData => ({ suit: "honor", rank });

/** 自家のサンプル手牌(13枚 + ツモ1枚で14枚。赤5筒を1枚含む)。 */
const selfHand: readonly TileData[] = [
  t("man", 1),
  t("man", 9),
  t("pin", 2),
  t("pin", 3),
  t("pin", 4),
  t("pin", 5, true),
  t("pin", 6),
  t("sou", 3),
  t("sou", 4),
  t("sou", 5),
  t("sou", 7),
  t("sou", 8),
  honor(4),
  honor(4),
];

const selfDiscards: readonly TileData[] = [
  honor(1),
  t("man", 9),
  t("pin", 9),
  honor(7),
  t("sou", 1),
];

const leftDiscards: readonly TileData[] = [
  t("pin", 1),
  honor(5),
  t("sou", 9),
  t("man", 1),
];

const rightDiscards: readonly TileData[] = [
  honor(2),
  t("sou", 2),
  t("pin", 8),
  honor(6),
  t("pin", 7),
  t("sou", 6),
];

/**
 * 結果画面(`/game/result`)の描画確認用**固定ダミー結果**(スペック6 6.8, スペック3 3.3)。
 *
 * 順位・素点・ウマ・祝儀・合計はいずれもドメイン計算の結果ではなく手で置いた固定値であり、
 * 順位決定やウマ割当(Q13)の意味を持たない。UI が「確定済みの内訳を受け取って表示する」構造を
 * 確認するためのサンプルに過ぎず、ドメイン層(スペック3)実装後に差し替える。
 * `soshiiTotal` は rawScore + uma + bonus の確定値として明示的に与えている(UI では計算しない)。
 */
const sampleResultView: GameResultView = {
  players: [
    {
      name: "あなた",
      rank: 1,
      rawScore: 45000,
      uma: 10000,
      bonus: 1000,
      soshiiTotal: 56000,
    },
    {
      name: "対面",
      rank: 2,
      rawScore: 32000,
      uma: 5000,
      bonus: 0,
      soshiiTotal: 37000,
    },
    {
      name: "上家",
      rank: 3,
      rawScore: 28000,
      uma: -5000,
      bonus: 0,
      soshiiTotal: 23000,
    },
    {
      name: "下家",
      rank: 4,
      rawScore: 15000,
      uma: -10000,
      bonus: 0,
      soshiiTotal: 5000,
    },
  ],
};

/**
 * 固定サンプルの対局ビュー状態。
 * 4スロット中「対面(across)」を抜け番として配置してあるが、これは描画確認用の任意配置であり、
 * 抜け番の交代順序(Q9)や席割り(Q10)を表すものではない。
 * `result` には結果画面の描画確認用に固定ダミー結果を同梱している(通常は半荘終了まで `null`)。
 */
export const sampleGameState: GameViewState = {
  slots: {
    self: {
      kind: "seated",
      player: {
        name: "あなた",
        points: 35000,
        seatWind: "east",
        status: { isDealer: true, isCurrentTurn: true },
        hand: selfHand,
        discards: selfDiscards,
      },
    },
    left: {
      kind: "seated",
      player: {
        name: "上家",
        points: 28000,
        seatWind: "south",
        status: { hasDeclaredRiichi: true },
        handCount: 13,
        discards: leftDiscards,
      },
    },
    across: {
      kind: "bench",
      player: {
        name: "対面",
        points: 32000,
      },
    },
    right: {
      kind: "seated",
      player: {
        name: "下家",
        points: 25000,
        pointsDelta: -3900,
        seatWind: "west",
        handCount: 13,
        discards: rightDiscards,
      },
    },
  },
  tableInfo: {
    roundWind: "east",
    handNumber: 1,
    honba: 0,
    riichiSticks: 1,
  },
  dora: {
    indicators: [t("pin", 4), t("sou", 6)],
    uraIndicatorCount: 2,
  },
  result: sampleResultView,
};
