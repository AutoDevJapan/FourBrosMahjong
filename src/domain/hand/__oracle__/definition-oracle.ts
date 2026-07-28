/**
 * 定義ベースの向聴オラクル(テスト専用 / issue #392)。
 *
 * ⚠️ **本番コードから import しない**検証用オラクル。
 *
 * `__oracle__/shanten-oracle.ts` と `src/domain/game/ai.ts` は、どちらも
 * 「スート別に (面子, 塔子, 対子) を数え上げて式で最小化する」**同型の列挙**を持つ
 * (差分は最終式とパレート枝刈りの有無だけ)。したがって両者の照合は
 * **列挙側の共通欠陥(ある塔子形の取りこぼし等)を検出できない**。
 *
 * 本モジュールはその死角を埋めるため、**塔子・面子候補の列挙を一切行わない**。
 * 向聴数の定義そのもの:
 *
 * > 向聴数 = min(和了形 W にわたって)「W を完成させるために追加で必要な牌数」− 1
 *
 * を、和了形 W の側を全列挙して直接計算する。手牌側の分解は行わず、
 * 「手牌と W の重なり」しか見ないため、探索構造が本体実装と独立になる。
 *
 * ## 適用範囲
 *
 * 副露数 `meldCount ≥ 1`(= 門前の 13 枚手には使わない)。門前は和了形 W の数が
 * 爆発する(4 面子 + 雀頭 ≈ 1,300 万通り)ため現実的でなく、また七対子・国士という
 * 別形の考慮も必要になる。副露手は面子が固定されるぶん W が激減し、
 * `meldCount = 1` でも 33 万通り程度で全列挙できる。
 *
 * 純関数・決定的。
 */

import { COUNT34_LEN, SANMA_INDICES_34 } from "./counts34";

/** 同一牌種の最大枚数。 */
const COPIES = 4;
/** 和了形の面子 + 雀頭の総数(4 面子 1 雀頭)。 */
const TOTAL_GROUPS = 4;

/**
 * 面子候補(刻子 + 順子)の 34-index 配列。
 * 刻子はサンマに実在する 27 種すべて。順子は萬子 2-8 が無いため筒子・索子のみ
 * (開始 rank 1..7 の 7 種 × 2 スート = 14 種)。
 */
function buildGroups(): readonly (readonly number[])[] {
  const groups: number[][] = [];
  for (const index of SANMA_INDICES_34) {
    groups.push([index, index, index]);
  }
  for (const base of [9, 18]) {
    // 筒子 (9..17) / 索子 (18..26)
    for (let offset = 0; offset < 7; offset++) {
      const start = base + offset;
      groups.push([start, start + 1, start + 2]);
    }
  }
  return groups;
}

const GROUPS = buildGroups();

/**
 * 定義ベースの向聴数(標準形のみ)。
 *
 * `concealed` は**門前部分**の 34-index カウント配列(副露牌を含めない)。
 * 枚数は `13 − 3 × meldCount` を想定する。
 *
 * @param concealed 門前部分のカウント配列。
 * @param meldCount 副露数(1..3)。
 * @returns 向聴数(0 = テンパイ、-1 = 和了)。
 */
export function shantenByDefinition34(
  concealed: readonly number[],
  meldCount: number,
): number {
  if (meldCount < 1 || meldCount > 3) {
    throw new RangeError(
      `shantenByDefinition34 は meldCount 1..3 のみ対応(受領: ${meldCount})。門前は和了形が爆発するため対象外。`,
    );
  }
  const groupsNeeded = TOTAL_GROUPS - meldCount;
  const handSize = 13 - 3 * meldCount;

  // 和了形 W を作りながら、手牌との重なりを増分で持つ。
  const work = new Array<number>(COUNT34_LEN).fill(0);
  let overlap = 0;
  let best = Number.POSITIVE_INFINITY;

  /** `index` の牌を1枚 W へ足す。枚数上限を超えるなら false。 */
  const push = (index: number): boolean => {
    if (work[index] >= COPIES) return false;
    work[index] += 1;
    // 重なりは min(W[k], hand[k]) の総和。W 側が hand 側を超えた分は数えない。
    if (work[index] <= (concealed[index] ?? 0)) overlap += 1;
    return true;
  };
  const pop = (index: number): void => {
    if (work[index] <= (concealed[index] ?? 0)) overlap -= 1;
    work[index] -= 1;
  };

  /** 面子を `start` 以降から `remaining` 個選ぶ(重複組合せ)。 */
  const chooseGroups = (start: number, remaining: number): void => {
    if (remaining === 0) {
      const distance = handSize - overlap;
      if (distance < best) best = distance;
      return;
    }
    for (let g = start; g < GROUPS.length; g++) {
      const group = GROUPS[g] as readonly number[];
      let pushed = 0;
      let ok = true;
      for (const index of group) {
        if (!push(index)) {
          ok = false;
          break;
        }
        pushed += 1;
      }
      if (ok) chooseGroups(g, remaining - 1);
      for (let i = pushed - 1; i >= 0; i--) pop(group[i] as number);
    }
  };

  for (const pair of SANMA_INDICES_34) {
    if (!push(pair)) continue;
    if (push(pair)) {
      chooseGroups(0, groupsNeeded);
      pop(pair);
    }
    pop(pair);
  }

  return best;
}
