/**
 * 頭ハネ(上家取り)による和了者決定(issue #65 / spec 2.4)。
 *
 * スペック2 2.4「ダブロンなし・頭ハネ(上家取り)」。複数人が同時にロンを主張した場合、
 * **放銃者から見て手番順で最も近い(=上家)** 主張者ただ1人が和了する。
 *
 * ⚠️ 席の割り当て(誰が東/南/西か・抜け番順)は **Q9〜Q11 で未確定**のため実装しない。
 * 本関数は**席インデックス(手番順)を引数で受ける抽象ルール**に留める。
 * 呼び出し側が、放銃者と各主張者の手番順インデックスを与える。
 *
 * 純関数・決定的。
 */

/** ロン主張1件。`seat` は手番順(時計回り)の席インデックス。 */
export interface RonClaim<T> {
  readonly seat: number;
  readonly claimant: T;
}

/**
 * 頭ハネで和了者を1人に決める。
 *
 * @param discarderSeat 放銃者(打牌者)の手番順インデックス。
 * @param claims 同時ロンの主張群(放銃者自身は含めない/含んでも除外される)。
 * @param seatCount 手番の総席数(サンマは3)。
 * @returns 上家取りで勝つ主張。主張が無ければ `null`。
 */
export function resolveHeadBump<T>(
  discarderSeat: number,
  claims: readonly RonClaim<T>[],
  seatCount: number,
): RonClaim<T> | null {
  let winner: RonClaim<T> | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const claim of claims) {
    const distance = (claim.seat - discarderSeat + seatCount) % seatCount;
    if (distance === 0) continue; // 放銃者自身は和了できない
    if (distance < bestDistance) {
      bestDistance = distance;
      winner = claim;
    }
  }
  return winner;
}
