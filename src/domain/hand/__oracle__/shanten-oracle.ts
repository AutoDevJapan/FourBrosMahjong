/**
 * 向聴数オラクル(テスト専用の独立参照実装 / issue #138)。
 *
 * ⚠️ **本番コードから import しない**検証用オラクル。`src/domain/game/ai.ts` の
 * `shanten()` の正しさをクロス検証するために、MIT ライブラリ
 * **MahjongRepository/mahjong**(`mahjong/shanten.py`)の**アルゴリズム構造**を
 * 読解して TS で独自再実装したもの(コードは流用していない)。
 *
 * ## 独立性の範囲(#392 で実態に合わせて訂正)
 *
 * 本オラクルと `ai.ts` で**独立しているのは最終式とパレート枝刈りの有無だけ**であり、
 * **探索(列挙)の構造は同型**である(いずれも「スート別に (面子, 塔子, 対子) プロファイルを
 * 数え上げ、スート積で合成する」)。当初この JSDoc は「探索・式の双方が独立する」と
 * 書いていたが、`__oracle__/shanten-oracle.ts` の `enumerateSuitProfiles` と
 * `game/ai.ts` の `suitFrontier` は再帰の分岐順まで同型であり、事実と異なっていた。
 * 七対子・国士の向聴式(下部)に至っては `ai.ts` と**完全同一**である。
 *
 * したがって本照合が**検出できるもの**は「片側だけのリグレッション」であり、
 * **検出できないもの**は「列挙側の共通欠陥(ある塔子形の取りこぼし等)」である。
 * 後者は列挙を一切行わない {@link "./definition-oracle".shantenByDefinition34}
 * (和了形の側を全列挙して「手牌との最大重なり」から距離を直接算出する)との照合が
 * 受け持つ(`cross-validation.test.ts`)。
 *
 * 参照実装との差異:
 * - 標準形は「スート別に取り得る (面子, 塔子, 対子) プロファイルを**枝刈りせず全列挙**し、
 *   スート積で合成して mahjong の `_update_result` と同じ形の式で最小化する」方式。
 *   ai.ts は「パレート枝刈り + 別式(`leafShanten`)」で解く。
 * - この式は mahjong の `8 − 2·面子 − 塔子 − 対子` に、ブロック超過補正
 *   `n_mentsu_kouho > 4` を加えたもの。全列挙するため mahjong の DFS 固有の
 *   「時打牌フロア」「4枚孤立牌 +1」補正は不要(それらは貪欲 DFS の undercount 回避策で、
 *   全列挙では最良解を直接得るため適用すると過大評価になる)。
 * - サンマ制約: 萬子 2-8 は実在しないため、萬子で順子・塔子は自然に生じない。
 *
 * 本オラクル自身の正しさは、参照ライブラリ(is_three_player=True)との
 * 大量ランダム照合で別途アンカーしている(PR 説明・オフライン検証ログ参照)。
 * 唯一の意図的な差: 同一牌の**4枚全てが手牌**にある「デッドウォール待ち」は、
 * 牌残量を見ない理想化(本作 ai.ts と共通)により参照と ±1 差になる既知クラス(#143)。
 *
 * 純関数・決定的。
 */

import { COUNT34_LEN, TERMINAL_AND_HONOR_INDICES_34 } from "./counts34";

/** 和了(向聴 -1)。 */
export const AGARI = -1;
/** テンパイ(向聴 0)。 */
export const TENPAI = 0;

/** 1スートの分解1通り = [面子数, 塔子数, 対子数]。 */
type Profile = readonly [number, number, number];

const suitProfileMemo = new Map<string, Profile[]>();

/**
 * 1スート(長さ9 の数牌 or 長さ7 の字牌)のカウント配列を
 * 面子/塔子/対子へ分解する**全プロファイル**(枝刈りなし・重複除去のみ)。
 * 数牌は順子・塔子(両面/辺張=i,i+1、嵌張=i,i+2)を許し、字牌は刻子/対子のみ。
 */
function enumerateSuitProfiles(
  arr: readonly number[],
  isNumber: boolean,
): Profile[] {
  const key = (isNumber ? "n:" : "h:") + arr.join(",");
  const cached = suitProfileMemo.get(key);
  if (cached !== undefined) return cached;

  const a = [...arr];
  const len = a.length;
  const seen = new Set<string>();
  const out: Profile[] = [];

  const record = (m: number, t: number, p: number): void => {
    const sig = `${m},${t},${p}`;
    if (seen.has(sig)) return;
    seen.add(sig);
    out.push([m, t, p]);
  };

  const walk = (from: number, m: number, t: number, p: number): void => {
    let i = from;
    while (i < len && a[i] === 0) i += 1;
    if (i >= len) {
      record(m, t, p);
      return;
    }

    // 刻子
    if (a[i] >= 3) {
      a[i] -= 3;
      walk(i, m + 1, t, p);
      a[i] += 3;
    }
    // 順子(数牌のみ)
    if (isNumber && i <= len - 3 && a[i + 1] > 0 && a[i + 2] > 0) {
      a[i] -= 1;
      a[i + 1] -= 1;
      a[i + 2] -= 1;
      walk(i, m + 1, t, p);
      a[i] += 1;
      a[i + 1] += 1;
      a[i + 2] += 1;
    }
    // 対子
    if (a[i] >= 2) {
      a[i] -= 2;
      walk(i, m, t, p + 1);
      a[i] += 2;
    }
    // 塔子(両面/辺張: i, i+1)
    if (isNumber && i <= len - 2 && a[i + 1] > 0) {
      a[i] -= 1;
      a[i + 1] -= 1;
      walk(i, m, t + 1, p);
      a[i] += 1;
      a[i + 1] += 1;
    }
    // 塔子(嵌張: i, i+2)
    if (isNumber && i <= len - 3 && a[i + 2] > 0) {
      a[i] -= 1;
      a[i + 2] -= 1;
      walk(i, m, t + 1, p);
      a[i] += 1;
      a[i + 2] += 1;
    }
    // 孤立牌(この1枚を使わない)
    a[i] -= 1;
    walk(i, m, t, p);
    a[i] += 1;
  };

  walk(0, 0, 0, 0);
  suitProfileMemo.set(key, out);
  return out;
}

/**
 * 標準形(4面子1雀頭)の向聴数。
 * mahjong の `_update_result` と同形の式: `ret = 8 − 2·面子 − 塔子 − 対子`、
 * 有効ブロック数 `n = 面子 + 塔子 + max(0, 対子−1)` が 4 を超えたら `ret += n − 4`。
 * 13/14 枚手前提(副露なし=面子初期値0)。
 */
function regularShanten(counts34: readonly number[]): number {
  const man = enumerateSuitProfiles(counts34.slice(0, 9), true);
  const pin = enumerateSuitProfiles(counts34.slice(9, 18), true);
  const sou = enumerateSuitProfiles(counts34.slice(18, 27), true);
  const honor = enumerateSuitProfiles(counts34.slice(27, 34), false);

  let best = 8;
  for (const dm of man) {
    for (const dp of pin) {
      for (const ds of sou) {
        for (const dh of honor) {
          const melds = dm[0] + dp[0] + ds[0] + dh[0];
          const tatsu = dm[1] + dp[1] + ds[1] + dh[1];
          const pairs = dm[2] + dp[2] + ds[2] + dh[2];

          let ret = 8 - 2 * melds - tatsu - pairs;
          const blocks = melds + tatsu + (pairs > 0 ? pairs - 1 : 0);
          if (blocks > 4) ret += blocks - 4;
          if (ret < best) best = ret;
        }
      }
    }
  }
  return best;
}

/**
 * 七対子の向聴数。`6 − 対子数 + max(0, 7 − 種類数)`(参照実装と同式)。
 * 4枚使いは 1 対子扱い(参照実装どおり `x >= 2` で数える)。
 */
function chiitoitsuShanten(counts34: readonly number[]): number {
  let pairs = 0;
  let kinds = 0;
  for (const n of counts34) {
    if (n >= 1) kinds += 1;
    if (n >= 2) pairs += 1;
  }
  if (pairs === 7) return AGARI;
  return 6 - pairs + (kinds < 7 ? 7 - kinds : 0);
}

/** 国士無双の向聴数。`13 − 么九種類数 − (么九対子ありなら1)`(参照実装と同式)。 */
function kokushiShanten(counts34: readonly number[]): number {
  let kinds = 0;
  let hasPair = 0;
  for (const i of TERMINAL_AND_HONOR_INDICES_34) {
    if (counts34[i] !== 0) kinds += 1;
    if (counts34[i] >= 2) hasPair = 1;
  }
  return 13 - kinds - hasPair;
}

/**
 * 手牌(34-index カウント)の向聴数。標準/七対子/国士の最小。
 * 和了= -1、テンパイ= 0。13/14 枚(3n+1 / 3n+2)を想定する。
 */
export function shantenOracle34(counts34: readonly number[]): number {
  if (counts34.length !== COUNT34_LEN) {
    throw new Error(`counts34 must be length ${COUNT34_LEN}`);
  }
  return Math.min(
    regularShanten(counts34),
    chiitoitsuShanten(counts34),
    kokushiShanten(counts34),
  );
}
