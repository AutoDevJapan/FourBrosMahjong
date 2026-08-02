/**
 * 手牌ジェネレータの契約検証(issue #444)。
 *
 * `generator.ts` はオラクルそのものではなく、クロス検証へ手牌を供給する側。
 * 供給が契約(規定枚数)を破ると、照合は**静かに件数を減らすだけ**でテストは緑のまま
 * 通ってしまう。ここではその契約を直接固定する。
 *
 * 対象は `randomStructuredHand` の置換処理。「手牌から1枚除いてから別の場所へ1枚足す」
 * 二段構えで、足す先の探索は {@link PLACEMENT_TRIES} 回で打ち切られる。打ち切り時に
 * 除去を戻し忘れると **13枚の手**が返る。
 *
 * 通常のシードでこの経路に入る確率は約 (3/27)^20 ≈ 8e-20 で、反復回数をいくら増やしても
 * 踏めない。乱数任せにするとテストは永久に空回りするため、**台本化した RNG** で
 * 打ち切り経路を決定的に踏ませる。
 */

import { describe, expect, it } from "vitest";
import type { Tile } from "../../tiles/tile";
import { tileNotation } from "../notation";
import { SANMA_INDICES_34, tilesToCount34, tileTo34Index } from "./counts34";
import {
  makeRng,
  PLACEMENT_TRIES,
  randomStructuredHand,
  SEQUENCE_STARTS,
} from "./generator";

/** 34-index(牌種の別名。台本の意図を読めるようにする)。 */
const INDEX_1P = tileTo34Index({ suit: "pin", rank: 1 });
const INDEX_2P = tileTo34Index({ suit: "pin", rank: 2 });
const INDEX_EAST = tileTo34Index({ suit: "honor", rank: 1 });

/** `SANMA_INDICES_34[position]` を引かせる乱数値(`randInt(rng, n) = ⌊v*n⌋`)。 */
function pickSanma(position: number): number {
  return (position + 0.5) / SANMA_INDICES_34.length;
}

/**
 * `SEQUENCE_STARTS[position]` を引かせる乱数値。
 *
 * 除数を配列から取るので**要素数**の増減は自動追随する。一方 `position` 番目の
 * **中身**が変わると台本は別の順子を組ませてしまい、`tailDraws()` の等式では検出
 * できない(打ち切り経路自体は通るため)。各テストが生成手そのものを
 * {@link HAND_ROLLED_BACK} / {@link HAND_SWAPPED} で固定しており、そちらが落ちる。
 */
function pickSequenceStart(position: number): number {
  return (position + 0.5) / SEQUENCE_STARTS.length;
}

/** 面子の種別を決めるコイン(`rng() < 0.5` で順子)。 */
const COIN_SEQUENCE = 0.1;
const COIN_TRIPLET = 0.6;

/** 置換回数 = `⌊0.9 * (maxSwaps + 1)⌋`。`maxSwaps = 1` で呼ぶので 1 回。 */
const SWAPS_ONE = 0.9;

/**
 * 除去牌 = `present`(手牌に在る牌種の昇順リスト)の**末尾** = 東。1p 以外を減らすため。
 * `⌊REMOVE_LAST_PRESENT × n⌋ = n − 1` は n ≤ 14 で成り立つので、完成形の牌種数が
 * 多少変わっても「末尾」を指し続ける。実際に東が減ったことは {@link HAND_SWAPPED} が固定する。
 */
const REMOVE_LAST_PRESENT = 13.5 / 14;

/**
 * `buildCompleteCounts` に `1111p 22p 33p 123s 東東東`(1p が4枚)を組ませ、
 * 続く置換で 1p 以外(東)を除去させる台本。以降の抽選値は各テストが `tail` で与える。
 */
const SCRIPT_FOUR_COPY_1P: readonly number[] = [
  pickSanma(SANMA_INDICES_34.indexOf(INDEX_1P)), // 雀頭 = 1p → 1p が2枚
  COIN_SEQUENCE,
  pickSequenceStart(0), // 面子1: 順子 123p → 1p が3枚
  COIN_SEQUENCE,
  pickSequenceStart(0), // 面子2: 順子 123p → 1p が4枚(以後 1p は足せない)
  COIN_SEQUENCE,
  pickSequenceStart(7), // 面子3: 順子 123s
  COIN_TRIPLET,
  pickSanma(SANMA_INDICES_34.indexOf(INDEX_EAST)), // 面子4: 刻子 東東東
  SWAPS_ONE,
  REMOVE_LAST_PRESENT,
];

/**
 * 台本が組ませる完成形。置換に**失敗**した場合は除去した東が戻るので、返り値はこれと一致する。
 * (`randomStructuredHand` は `count34ToTiles` 経由なので牌順は 34-index 昇順で決定的。)
 */
const HAND_ROLLED_BACK = "1p1p1p1p2p2p3p3p1s2s3s1z1z1z";

/** 置換に**成功**した場合。東が1枚減り、2p が1枚増える。 */
const HAND_SWAPPED = "1p1p1p1p2p2p2p3p3p1s2s3s1z1z";

/** 生成手を決定的な文字列へ(台本の意図した手そのものを固定するため)。 */
function handNotation(tiles: readonly Tile[]): string {
  return tiles.map(tileNotation).join("");
}

/**
 * 台本の値を順に返し、尽きたら `tail` を返し続ける RNG。
 *
 * `tailDraws()` は「台本を使い切ったあとに何回引かれたか」= 置換の追加先探索が
 * 何回回ったかを返す。`tail` が定数なので探索の結果は「1回目で成功(= 1)」か
 * 「打ち切りまで失敗(= `PLACEMENT_TRIES`)」の二択になり、**手牌の中身とは独立に**
 * どちらの経路を通ったかを観測できる。
 */
function scriptedRng(
  script: readonly number[],
  tail: number,
): { rng: () => number; tailDraws: () => number } {
  let cursor = 0;
  let tailDraws = 0;
  return {
    rng: () => {
      if (cursor < script.length) {
        const value = script[cursor];
        cursor += 1;
        return value;
      }
      tailDraws += 1;
      return tail;
    },
    tailDraws: () => tailDraws,
  };
}

describe("ジェネレータの枚数契約(randomStructuredHand / #444)", () => {
  it("試行回数の上限が探索を成立させる値である", () => {
    // 下の2テストは `tailDraws()` が 1(成功)と `PLACEMENT_TRIES`(打ち切り)に
    // 分かれることを前提にしている。上限が 1 だと両者が 1 に潰れて区別できなくなり、
    // 「探索ループが死んでいる」状態を残り3テストが緑で通してしまう。
    // (0 なら成功経路が `tailDraws() === 1` で別途落ちるが、1 はここでしか捕まらない。)
    expect(PLACEMENT_TRIES).toBeGreaterThan(1);
  });

  it("置換先が見つからなくても14枚を返す(除去した1枚を戻す)", () => {
    // 追加先の抽選は毎回 1p(既に4枚)を引くので、置換は必ず失敗する。
    const { rng, tailDraws } = scriptedRng(
      SCRIPT_FOUR_COPY_1P,
      pickSanma(SANMA_INDICES_34.indexOf(INDEX_1P)),
    );
    const tiles = randomStructuredHand(rng, 1);

    // 打ち切り経路を通ったこと。`PLACEMENT_TRIES` 自体が 0/1 に縮むとこの等式は
    // 自己成就するので、上の「上限の健全性」テストと対で機能する。
    expect(
      tailDraws(),
      "台本が置換失敗経路を作れていない(buildCompleteCounts の乱数消費順が変わった可能性)",
    ).toBe(PLACEMENT_TRIES);
    // 本題: 打ち切っても枚数は減らず、除去した東が戻って元の完成形に一致する。
    // (期待値の 1p が4枚であること自体が「置換が失敗する」前提の裏取りになっている。)
    expect(tiles).toHaveLength(14);
    expect(handNotation(tiles), "除去した東が戻っていない").toBe(
      HAND_ROLLED_BACK,
    );
  });

  it("置換先が見つかれば戻さない(正常系は巻き戻されない)", () => {
    // 上と**同じ完成形・同じ除去牌**で、追加先の抽選だけ 2p(2枚しかない)に変える。
    // 置換は1回目で成功するので、戻し処理は走ってはならない。
    const { rng, tailDraws } = scriptedRng(
      SCRIPT_FOUR_COPY_1P,
      pickSanma(SANMA_INDICES_34.indexOf(INDEX_2P)),
    );
    const tiles = randomStructuredHand(rng, 1);

    expect(tailDraws(), "追加先が1回目で決まっていない").toBe(1);
    expect(tiles).toHaveLength(14);
    // 失敗系との**観測可能な差**はここ。戻し処理が正常系まで巻き込むと東が3枚に戻り
    // 2p は2枚のまま(= `HAND_ROLLED_BACK` に一致してしまう)。枚数だけでは区別できない。
    expect(handNotation(tiles), "置換が効いていない(巻き戻された)").toBe(
      HAND_SWAPPED,
    );
  });

  it("通常のシード 2,000 手が常に14枚・1牌種4枚以内である", () => {
    const rng = makeRng(0x4440_0001);
    const sizes = new Set<number>();
    let overFour = 0;
    for (let i = 0; i < 2_000; i += 1) {
      const tiles = randomStructuredHand(rng);
      sizes.add(tiles.length);
      if (Math.max(...tilesToCount34(tiles)) > 4) overFour += 1;
    }
    expect([...sizes]).toEqual([14]);
    expect(overFour).toBe(0);
  });
});
