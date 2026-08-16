/**
 * 開門サイコロの出目 → 表ドラ枚数の決定(スペック2 2.2 / ルールSSOT 4)。
 *
 * 四兄弟麻雀では各局の開門位置を決める**2個のサイコロの出目**で表ドラ枚数が
 * 1〜3枚に変動する(打点インフレの核)。裏ドラはリーチ和了時のみ表と同数乗る
 * (→ {@link "./doraSet"})。
 *
 * 純ロジック・副作用なし。React/DOM 非依存。
 */

/** サイコロ1個の出目(1〜6)。{@link DiceRoll} の構成要素(内部型)。 */
type Die = 1 | 2 | 3 | 4 | 5 | 6;

/** サイコロ2個の出目(開門サイコロ)。 */
export type DiceRoll = readonly [Die, Die];

/**
 * 表ドラ枚数。裏ドラ枚数も常にこれと同数(スペック4 4.4 不変条件)。
 * 不変条件「1〜3のいずれか」はこの型と {@link omoteDoraCount} が担保する。
 */
export type DoraCount = 1 | 2 | 3;

/**
 * 表ドラ枚数の上限(= 裏ドラ枚数の上限)。6のゾロ目のときの値。
 * 王牌にドラ表示牌用として確保する枚数の導出元(→ `wall.ts` の `DORA_INDICATOR_RESERVE`)。
 */
export const MAX_OMOTE_DORA_COUNT: DoraCount = 3;

const MIN_PIP = 1;
const MAX_PIP = 6;

function assertDie(value: number, position: 0 | 1): asserts value is Die {
  if (!Number.isInteger(value) || value < MIN_PIP || value > MAX_PIP) {
    throw new RangeError(
      `Die[${position}] must be an integer in [${MIN_PIP}, ${MAX_PIP}], received ${value}.`,
    );
  }
}

/**
 * 開門サイコロ2個の出目から**表ドラ枚数**を決定する(スペック2 2.2)。
 *
 * | 出目 | 表ドラ枚数 |
 * |---|---|
 * | 通常(ゾロ目でない) | 1枚 |
 * | ゾロ目 | 2枚 |
 * | 6のゾロ目(6・6)のみ | 3枚 |
 *
 * 出目の**順序は結果に影響しない**(`(3,5)` と `(5,3)` は同じ)。
 *
 * @param roll サイコロ2個の出目。各要素は 1〜6 の整数。
 * @throws RangeError いずれかの出目が 1〜6 の整数でないとき。
 */
export function omoteDoraCount(roll: DiceRoll): DoraCount {
  const [a, b] = roll;
  assertDie(a, 0);
  assertDie(b, 1);

  if (a !== b) {
    return 1; // 通常(ゾロ目でない)
  }
  if (a === MAX_PIP) {
    return MAX_OMOTE_DORA_COUNT; // 6のゾロ目(6・6)のみ
  }
  return 2; // それ以外のゾロ目
}
