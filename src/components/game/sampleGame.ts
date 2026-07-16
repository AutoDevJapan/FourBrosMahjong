/**
 * 対局画面の描画確認用**固定ダミーデータ**(スペック6 6.8)。
 *
 * これはドメイン計算の結果ではなく、UI が「値を受け取って表示する」構造を確認するための
 * 静的なサンプルに過ぎない。席割り当て・抜け番・親・点差などは実ロジック(Q9〜Q13)ではなく
 * 手で置いた固定値であり、ゲーム進行の意味を持たない。ドメイン層が実装されたら差し替える。
 */
import type { GameViewState, TileData } from "./types";

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
 * 固定サンプルの対局ビュー状態。
 * 4スロット中「対面(across)」を抜け番として配置してあるが、これは描画確認用の任意配置であり、
 * 抜け番の交代順序(Q9)や席割り(Q10)を表すものではない。
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
};
