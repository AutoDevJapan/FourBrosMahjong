/**
 * 和了形判定・手牌分解オラクル(テスト専用の独立参照実装 / issue #138)。
 *
 * ⚠️ **本番コードから import しない**検証用オラクル。`src/domain/hand/decompose.ts`
 * (`isCompleteHand`/`decomposeStandard`)と `tenpai.ts`(`waitingTiles`)の正しさを
 * クロス検証するために、MIT ライブラリ **MahjongRepository/mahjong**
 * (`hand_calculating/divider.py`)の**アルゴリズム構造**を読解して TS で独自再実装
 * したもの(コードは流用していない)。
 *
 * 参照 divider は「スート別に (雀頭なし→ダメなら各雀頭位置で) ブロック分解し、
 * スート積のうち雀頭がちょうど1つの組を全採用」する。本オラクルは 34-index 上で
 * 「雀頭位置を先に固定 → 残りを面子のみへ全消費分解」する再帰で、
 * 全標準分解を正規化シグネチャの集合として返す。七対子・国士も判定する。
 *
 * ## 独立性の範囲(#392 で実態に合わせて訂正)
 *
 * 本オラクルの `decomposeMeldsOnly` と本体実装 `hand/decompose.ts` の `extractMentsuAll` は、
 * **再帰の分岐順(刻子 → 順子 → 対子 → 両面塔子 → 嵌張塔子 → 浮き牌)まで同型**であり、
 * `isSevenPairs` に至っては本体と**完全同一**である。したがってこの照合が検出できるのは
 * 「片側だけのリグレッション」であって、**列挙側の共通欠陥は素通りする**。
 * その死角は列挙非依存の `definition-oracle.ts` との照合が補う
 * (`cross-validation.test.ts`)。担当は経路ごとに分かれている:
 *
 * - 向聴(副露数 1..3): {@link "./definition-oracle".shantenByDefinition34}(#392)。
 *   `shantenByDefinition34` は門前を `RangeError` で拒否するので、**門前の死角は見ていない**。
 * - 分解・待ち(副露 1..4 組 / 門前 13・14 枚):
 *   {@link "./definition-oracle".standardFormsByDefinition34} /
 *   {@link "./definition-oracle".waitingIndicesByDefinition34} /
 *   {@link "./definition-oracle".menzenWaitingIndicesByDefinition34}(#390 / #429)。
 *
 * サンマ制約: 萬子 2-8 は実在しないため萬子の順子は自然に生じない。赤5・北ガリは
 * 構造に影響しないため種別(suit+rank)のみで扱う。純関数・決定的。
 */

import {
  COUNT34_LEN,
  index34ToKind,
  SANMA_INDICES_34,
  TERMINAL_AND_HONOR_INDICES_34,
} from "./counts34";

/** 数牌の順子開始として妥当な 34-index(同一スート内で idx, idx+1, idx+2 が並ぶ)。 */
function isSequenceStart(idx: number): boolean {
  return (
    (idx >= 0 && idx <= 6) || // man 1-7 始まり
    (idx >= 9 && idx <= 15) || // pin 1-7 始まり
    (idx >= 18 && idx <= 24) // sou 1-7 始まり
  );
}

/**
 * カウント配列を面子(刻子/順子)のみで**過不足なく**分解できる全通りを、
 * ブロック列(各ブロックは `{kind, idx}`)として返す。分解不能なら空配列。
 */
interface Block {
  readonly kind: "sequence" | "triplet" | "pair";
  readonly idx: number;
}

function decomposeMeldsOnly(counts: number[]): Block[][] {
  let head = 0;
  while (head < COUNT34_LEN && counts[head] === 0) head += 1;
  if (head >= COUNT34_LEN) return [[]]; // 全消費: 空分解1通り

  const results: Block[][] = [];

  // 刻子
  if (counts[head] >= 3) {
    counts[head] -= 3;
    for (const rest of decomposeMeldsOnly(counts)) {
      results.push([{ kind: "triplet", idx: head }, ...rest]);
    }
    counts[head] += 3;
  }

  // 順子
  if (isSequenceStart(head) && counts[head + 1] > 0 && counts[head + 2] > 0) {
    counts[head] -= 1;
    counts[head + 1] -= 1;
    counts[head + 2] -= 1;
    for (const rest of decomposeMeldsOnly(counts)) {
      results.push([{ kind: "sequence", idx: head }, ...rest]);
    }
    counts[head] += 1;
    counts[head + 1] += 1;
    counts[head + 2] += 1;
  }

  return results;
}

/** ブロック列を正規化シグネチャへ(`decompose.ts` の mentsuSignature と同形式)。 */
function canonicalSignature(blocks: readonly Block[]): string {
  return blocks
    .map((b) => {
      const { suit, rank } = index34ToKind(b.idx);
      return `${b.kind}:${suit}${rank}`;
    })
    .sort()
    .join("|");
}

/**
 * 14枚手牌(34-index)の標準形(4面子1雀頭)分解を、正規化シグネチャの集合で返す。
 * 各雀頭位置を固定して残りを面子のみへ全消費分解する。副露なし前提。
 */
export function standardDecompositions34(
  counts34: readonly number[],
): Set<string> {
  const out = new Set<string>();
  const total = counts34.reduce((s, n) => s + n, 0);
  if (total !== 14) return out;

  const work = [...counts34];
  for (let pair = 0; pair < COUNT34_LEN; pair += 1) {
    if (work[pair] < 2) continue;
    work[pair] -= 2;
    for (const melds of decomposeMeldsOnly(work)) {
      if (melds.length !== 4) continue;
      out.add(canonicalSignature([...melds, { kind: "pair", idx: pair }]));
    }
    work[pair] += 2;
  }
  return out;
}

/** 標準形(4面子1雀頭)が1通り以上成立するか。 */
function canFormStandard(counts34: readonly number[]): boolean {
  const total = counts34.reduce((s, n) => s + n, 0);
  if (total !== 14) return false;
  const work = [...counts34];
  for (let pair = 0; pair < COUNT34_LEN; pair += 1) {
    if (work[pair] < 2) continue;
    work[pair] -= 2;
    for (const melds of decomposeMeldsOnly(work)) {
      if (melds.length === 4) {
        work[pair] += 2;
        return true;
      }
    }
    work[pair] += 2;
  }
  return false;
}

/** 七対子形か(門前14枚・相異なる7対子。4枚使いは不成立)。 */
function isSevenPairs(counts34: readonly number[]): boolean {
  let pairs = 0;
  for (const n of counts34) {
    if (n === 0) continue;
    if (n !== 2) return false; // 0/2 以外(4枚含む)は不成立
    pairs += 1;
  }
  return pairs === 7;
}

/** 国士無双形か(門前14枚・13種の么九すべて+1種のみ雀頭)。 */
function isThirteenOrphans(counts34: readonly number[]): boolean {
  const total = counts34.reduce((s, n) => s + n, 0);
  if (total !== 14) return false;
  // 么九以外を含めば不成立。
  let orphanTotal = 0;
  let kinds = 0;
  let pairs = 0;
  for (const i of TERMINAL_AND_HONOR_INDICES_34) {
    const n = counts34[i];
    orphanTotal += n;
    if (n >= 1) kinds += 1;
    if (n === 2) pairs += 1;
    if (n > 2) return false;
  }
  if (orphanTotal !== 14) return false; // 么九以外が混じっている
  return kinds === 13 && pairs === 1;
}

/** 和了形(標準/七対子/国士のいずれか)が成立するか。副露なし14枚前提。 */
export function isCompleteOracle34(counts34: readonly number[]): boolean {
  if (counts34.length !== COUNT34_LEN) {
    throw new Error(`counts34 must be length ${COUNT34_LEN}`);
  }
  return (
    canFormStandard(counts34) ||
    isSevenPairs(counts34) ||
    isThirteenOrphans(counts34)
  );
}

/**
 * 13枚手牌(34-index)の待ち牌(和了牌候補)の 34-index 集合を返す。
 * サンマ実在牌種のうち、加えて14枚にすると和了形になる牌を列挙する。副露なし前提。
 */
export function waitingIndicesOracle34(
  counts34: readonly number[],
): Set<number> {
  const waits = new Set<number>();
  const work = [...counts34];
  for (const idx of SANMA_INDICES_34) {
    if (work[idx] >= 4) continue; // 4枚使用済みは待ちになり得ない
    work[idx] += 1;
    if (isCompleteOracle34(work)) waits.add(idx);
    work[idx] -= 1;
  }
  return waits;
}
