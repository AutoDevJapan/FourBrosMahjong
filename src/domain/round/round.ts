/**
 * 局の進行・親/席/抜け番の回転・東南戦の場/局進行(issue #81 Q9〜Q11 確定仕様)。
 *
 * 本モジュールは**構造的な進行状態のみ**を扱う純ロジック(React/DOM 非依存・副作用なし・決定的):
 * 局を表す {@link RoundState} を入力に、連荘/親流れの結果に応じた**次局 {@link RoundState}** を返す
 * 不変(immutable)な遷移関数群を提供する。点数・ツモ配分・ウマ(Q12/Q13)や、配牌・山・ドラは
 * 本 issue の範囲外(#66/#67 が本結果を受け取り統合する)。
 *
 * 確定仕様(要点):
 * - 北家抜けの回転: 常時 東(親)/南/西 着席、1人が抜け番。親流れ時に反時計回りで1席回転
 *   (旧東→抜け番、旧南→東=新親、旧西→南、旧北→西=復帰)。抜け番 = 直前局の親。
 * - 連荘(親テンパイ/親和了 / スペック2 2.5・Q6): 席・抜け番据え置き、本場+1、局番号据え置き。
 * - 東南戦: 各場4局(東1→…→東4→南1→…→南4)。オーラス = 南4。各場で4人が親を1巡。
 *
 * 席割りの導出は {@link ./seat} に分離。ここは進行(場/局/本場)と円環の親位置の対応を担う。
 */

import {
  deriveSeating,
  type PlayerRing,
  RING_SIZE,
  type Seating,
} from "./seat";

/** 場(ば)。東南戦なので東場・南場の2つ。 */
export type RoundWind = "east" | "south";

/** 1場あたりの局数(東1〜東4 / 南1〜南4)。 */
export const ROUNDS_PER_WIND = 4;

/** 局番号(場内の 1〜{@link ROUNDS_PER_WIND})。 */
export type RoundNumber = 1 | 2 | 3 | 4;

/**
 * 局の進行状態(不変値)。この4要素で席割り・進行が一意に決まる。
 *
 * - `order` … 4人の固定円環(半荘を通じて不変 / 起家 = `order[0]`)。
 * - `wind` … 現在の場(東/南)。
 * - `roundNumber` … 場内の局番号(1〜4)。親の円環位置は `roundNumber - 1`
 *   (東1/南1 は起家が親 = `order[0]`。各場の頭で親位置が 0 に戻る)。
 * - `honba` … 本場(積み棒)。連荘・流局で +1、親流れで 0 に戻る。0 以上の整数。
 *
 * 席割り(東/南/西/抜け番)は本状態から {@link seatingOf} で導出する(冗長保持しない)。
 */
export interface RoundState<TPlayer> {
  readonly order: PlayerRing<TPlayer>;
  readonly wind: RoundWind;
  readonly roundNumber: RoundNumber;
  readonly honba: number;
}

/** 連荘/親流れに関するオーラスでの不正遷移などで送出する。 */
export class RoundProgressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RoundProgressionError";
  }
}

/**
 * 初期席の入力(掴み取り/サイコロ演出の結果)。半荘の起家と初局の着席を与える。
 * この4人がそのまま固定円環 `[dealer, south, west, benchWarmer]` になる。
 */
export interface InitialSeating<TPlayer> {
  /** 起家(初局の東 = 親)。 */
  readonly dealer: TPlayer;
  /** 初局の南家。 */
  readonly south: TPlayer;
  /** 初局の西家。 */
  readonly west: TPlayer;
  /** 初局の抜け番(北)。 */
  readonly benchWarmer: TPlayer;
}

/**
 * 初局(東1・0本場)の {@link RoundState} を生成する。
 *
 * 入力の4人から固定円環 `order = [dealer, south, west, benchWarmer]` を組む。以後の局は
 * この円環上を親位置が回るだけで、円環自体は変わらない。
 *
 * @throws RoundProgressionError 4人に重複がある(円環を成さない)とき。
 */
export function createInitialRound<TPlayer>(
  seating: InitialSeating<TPlayer>,
): RoundState<TPlayer> {
  const order: PlayerRing<TPlayer> = [
    seating.dealer,
    seating.south,
    seating.west,
    seating.benchWarmer,
  ];
  if (new Set(order).size !== RING_SIZE) {
    throw new RoundProgressionError(
      "InitialSeating の4人(dealer/south/west/benchWarmer)は互いに異なる必要があります。",
    );
  }
  return { order, wind: "east", roundNumber: 1, honba: 0 };
}

/** 親の円環位置(0〜3)。各場の頭で 0 に戻るため `roundNumber - 1` に一致する。 */
function dealerIndexOf<TPlayer>(state: RoundState<TPlayer>): number {
  return state.roundNumber - 1;
}

/** 現局の席割り(東/南/西/抜け番)を導出する。 */
export function seatingOf<TPlayer>(
  state: RoundState<TPlayer>,
): Seating<TPlayer> {
  return deriveSeating(state.order, dealerIndexOf(state));
}

/** 現局の親(東家)。 */
export function dealerOf<TPlayer>(state: RoundState<TPlayer>): TPlayer {
  return seatingOf(state).east;
}

/** 現局の抜け番(直前局の親)。 */
export function benchWarmerOf<TPlayer>(state: RoundState<TPlayer>): TPlayer {
  return seatingOf(state).benchWarmer;
}

/** オーラス(南4)かどうか。半荘の最終局位置。 */
export function isOorasu<TPlayer>(state: RoundState<TPlayer>): boolean {
  return state.wind === "south" && state.roundNumber === ROUNDS_PER_WIND;
}

/** 局表示ラベル(例: `"東1"` / `"南4 2本場"`)。UI/デバッグ向けの純関数。 */
export function roundLabel<TPlayer>(state: RoundState<TPlayer>): string {
  const wind = state.wind === "east" ? "東" : "南";
  const honba = state.honba > 0 ? ` ${state.honba}本場` : "";
  return `${wind}${state.roundNumber}${honba}`;
}

/**
 * 局の決着結果(次局遷移の分岐)。
 * - `"dealerContinues"` … 連荘(親テンパイ/親和了)。席・局番号据え置き、本場 +1。
 * - `"dealerPasses"` … 親流れ。1席回転し、次局(場/局)へ進む。本場 0。
 *
 * どちらに該当するかの判定(親が和了/テンパイか等)は本モジュールの範囲外(#67 が決める)。
 */
export type RoundOutcome = "dealerContinues" | "dealerPasses";

/**
 * 決着結果に応じた**次局**の状態を返す(元の状態は変更しない不変遷移)。
 *
 * - 連荘(`dealerContinues`): `order`/`wind`/`roundNumber` 据え置き、`honba` を +1。
 *   オーラスでも可(南4の連荘)。
 * - 親流れ(`dealerPasses`): `honba` を 0 に戻し、親位置 +1 相当で次局へ。
 *   局番号 < 4 なら同場で +1、局番号 = 4 なら次場の1局へ(東4→南1)。
 *   **オーラス(南4)での親流れは半荘終了**を意味し、次局は存在しない → {@link RoundProgressionError}。
 *   呼び出し側は {@link isOorasu} と終了条件(Q6: 親3万トップやめ/トビ)で終局判定してから呼ぶこと。
 *
 * @throws RoundProgressionError オーラスで `dealerPasses` を渡したとき(次局なし)。
 */
export function advanceRound<TPlayer>(
  state: RoundState<TPlayer>,
  outcome: RoundOutcome,
): RoundState<TPlayer> {
  if (outcome === "dealerContinues") {
    return { ...state, honba: state.honba + 1 };
  }
  // 親流れ(dealerPasses)
  if (isOorasu(state)) {
    throw new RoundProgressionError(
      "オーラス(南4)での親流れは半荘終了です。次局は存在しません(isOorasu で終局判定してください)。",
    );
  }
  if (state.roundNumber < ROUNDS_PER_WIND) {
    return {
      order: state.order,
      wind: state.wind,
      roundNumber: (state.roundNumber + 1) as RoundNumber,
      honba: 0,
    };
  }
  // 場内最終局(東4)の親流れ → 次場の1局(南1)。南4 は上の isOorasu で除外済み。
  return { order: state.order, wind: "south", roundNumber: 1, honba: 0 };
}
