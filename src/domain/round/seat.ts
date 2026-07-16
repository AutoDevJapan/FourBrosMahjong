/**
 * 席割り(東/南/西/抜け番)の純導出(スペック4 4.2 `Seat` / issue #81 Q9〜Q11 確定仕様)。
 *
 * 本変種(四兄弟麻雀 = 関西サンマ)の四人回しモデル:
 * - 4人は**固定の円環**を成す(`PlayerRing`)。順序は起家から反時計回りの親巡回順。
 * - 毎局、円環のうち3人が **東(親)/南/西** に着席し、残り1人が **抜け番(北)** となる。
 * - 抜け番は着席せず、その局の打牌に参加しない(持ち点は据え置き / Q5)。
 *
 * ここでは (`order`, `dealerIndex`) から席割りを**決定的に**導出するだけで、
 * 局の進行・連荘・場遷移(それらは `round.ts`)には関与しない。純ロジック・副作用なし。
 */

/**
 * 親の巡回順を成す4人の固定円環。`order[0]` が起家(初局の東=親)。
 *
 * 円環は半荘を通じて不変。局が進むと「どの位置が親か」を表す `dealerIndex`(0〜3)だけが
 * 進み、席割りはこの円環からの相対位置で決まる(→ {@link deriveSeating})。
 */
export type PlayerRing<TPlayer> = readonly [TPlayer, TPlayer, TPlayer, TPlayer];

/** 着席する席(東/南/西)。抜け番(北)は席を持たない(スペック4 4.2)。 */
export type Seat = "east" | "south" | "west";

/** 着席順(東→南→西)。配牌手牌の席割り当て等で参照する。 */
export const SEATED_SEATS = [
  "east",
  "south",
  "west",
] as const satisfies readonly Seat[];

/** 円環の要素数 = プレイヤー総数(4人回し)。 */
export const RING_SIZE = 4;

/**
 * ある局の席割り。`east` が親(この変種では東家=親)。`benchWarmer` は抜け番。
 *
 * 不変条件: `east`/`south`/`west`/`benchWarmer` は互いに異なる4人(円環の全員)。
 */
export interface Seating<TPlayer> {
  /** 東家 = 親。 */
  readonly east: TPlayer;
  /** 南家。 */
  readonly south: TPlayer;
  /** 西家。 */
  readonly west: TPlayer;
  /** 抜け番(北にあたる1人)。直前局の親が回ってくる。着席しない。 */
  readonly benchWarmer: TPlayer;
}

/**
 * 円環 `order` と親位置 `dealerIndex` から席割りを導出する。
 *
 * 位置対応(親流れ = `dealerIndex` +1 で1席回転する / Q9・Q10 確定仕様):
 * - 東(親) = `order[dealerIndex]`
 * - 南 = `order[dealerIndex + 1]`
 * - 西 = `order[dealerIndex + 2]`
 * - 抜け番(北) = `order[dealerIndex + 3]`(= 直前局の親)
 *
 * いずれも円環長 {@link RING_SIZE} で剰余を取るため、`dealerIndex` は任意の整数でよい。
 *
 * @param order       4人の固定円環。
 * @param dealerIndex 親の円環位置(内部で `mod 4` される)。
 */
export function deriveSeating<TPlayer>(
  order: PlayerRing<TPlayer>,
  dealerIndex: number,
): Seating<TPlayer> {
  const base = ((dealerIndex % RING_SIZE) + RING_SIZE) % RING_SIZE;
  return {
    east: order[base],
    south: order[(base + 1) % RING_SIZE],
    west: order[(base + 2) % RING_SIZE],
    benchWarmer: order[(base + 3) % RING_SIZE],
  };
}

/**
 * 着席3人を席順(東→南→西)の配列で返す。抜け番は含まない。
 * 配牌(`dealStartingHands` の戻り値)を席へ割り当てる際などに使う。
 */
export function seatedPlayers<TPlayer>(
  seating: Seating<TPlayer>,
): readonly [TPlayer, TPlayer, TPlayer] {
  return [seating.east, seating.south, seating.west];
}
