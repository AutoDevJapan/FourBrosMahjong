/**
 * 向聴・和了・手牌分解のクロス検証(issue #138)。
 *
 * 大量のランダムなサンマ手牌を決定的シードで生成し、本作の本番実装
 * - `src/domain/game/ai.ts` の `shanten()`
 * - `src/domain/hand/tenpai.ts` の `waitingTiles()`
 * - `src/domain/hand/decompose.ts` の `isCompleteHand()` / `decomposeStandard()`
 * を、独立参照オラクル(`__oracle__/`。MIT ライブラリ MahjongRepository/mahjong の
 * アルゴリズム構造を独自再実装。参照ライブラリとの照合済み)と突き合わせる。
 *
 * オラクルの正しさは、参照ライブラリ(is_three_player=True)との大量ランダム照合で
 * 別途アンカー済み(4枚使いを除く 12,478 手で shanten/regular/和了/待ち 全一致)。
 * 4枚全てが手牌にある「デッドウォール待ち」の向聴は、本作 ai.ts とオラクルが共通で
 * 採用する牌残量無視の理想化により参照と ±1 差が出る既知クラス(#143 で追跡)。
 * ai.ts とオラクルは同じ理想化を共有するため、本テストでは全手で一致する。
 */

import { describe, expect, it } from "vitest";
import { shanten } from "../game/ai";
import type { Tile } from "../tiles/tile";
import {
  isCompleteOracle34,
  standardDecompositions34,
  waitingIndicesOracle34,
} from "./__oracle__/agari-oracle";
import { tilesToCount34, tileTo34Index } from "./__oracle__/counts34";
import {
  makeRng,
  randomHand,
  randomStructuredHand,
} from "./__oracle__/generator";
import { shantenOracle34 } from "./__oracle__/shanten-oracle";
import { decomposeStandard, isCompleteHand } from "./decompose";
import { waitingTiles } from "./tenpai";

/**
 * クロス検証の手牌数。反復回数はここで調整する(実行時間と網羅性のトレードオフ)。
 * ランダム(向聴が深い手を厚く)と構造化(テンパイ〜低向聴を厚く)を各モードで回す。
 */
const RANDOM_HANDS = 20_000;
const STRUCTURED_HANDS = 20_000;

/** 本作 `StandardForm` を decompose.ts の mentsuSignature と同形式へ正規化。 */
function formSignature(
  melds: readonly { kind: string; suit: string; startRank: number }[],
  pair: { kind: string; suit: string; startRank: number },
): string {
  return [...melds, pair]
    .map((g) => `${g.kind}:${g.suit}${g.startRank}`)
    .sort()
    .join("|");
}

describe("クロス検証: 向聴数(ai.shanten ⇔ オラクル)", () => {
  it("ランダム手牌で ai.shanten とオラクルの向聴が一致する", () => {
    const rng = makeRng(0x5eed_1234);
    let mismatches = 0;
    const samples: string[] = [];
    for (let i = 0; i < RANDOM_HANDS; i += 1) {
      const size = rng() < 0.5 ? 13 : 14;
      const tiles = randomHand(rng, size);
      const a = shanten(tiles);
      const o = shantenOracle34(tilesToCount34(tiles));
      if (a !== o) {
        mismatches += 1;
        if (samples.length < 8)
          samples.push(`${describeHand(tiles)} ai=${a} oracle=${o}`);
      }
    }
    if (samples.length) console.log(samples.join("\n"));
    console.log(
      `[cross] random shanten hands=${RANDOM_HANDS} mismatches=${mismatches}`,
    );
    expect(mismatches).toBe(0);
  });

  it("構造化手牌(和了近傍)で ai.shanten とオラクルの向聴が一致する", () => {
    const rng = makeRng(0x5eed_abcd);
    let mismatches = 0;
    const samples: string[] = [];
    for (let i = 0; i < STRUCTURED_HANDS; i += 1) {
      const tiles = randomStructuredHand(rng);
      const a = shanten(tiles);
      const o = shantenOracle34(tilesToCount34(tiles));
      if (a !== o) {
        mismatches += 1;
        if (samples.length < 8)
          samples.push(`${describeHand(tiles)} ai=${a} oracle=${o}`);
      }
    }
    if (samples.length) console.log(samples.join("\n"));
    console.log(
      `[cross] structured shanten hands=${STRUCTURED_HANDS} mismatches=${mismatches}`,
    );
    expect(mismatches).toBe(0);
  });
});

describe("クロス検証: 和了・分解・待ち(decompose/tenpai ⇔ オラクル)", () => {
  it("14枚: isCompleteHand と和了オラクルが一致し、標準分解の集合も一致する", () => {
    const rng = makeRng(0x1010_2020);
    let completeMismatch = 0;
    let decompMismatch = 0;
    let completeCount = 0;
    const samples: string[] = [];
    for (let i = 0; i < STRUCTURED_HANDS; i += 1) {
      const tiles = randomStructuredHand(rng);
      if (tiles.length !== 14) continue;
      const counts = tilesToCount34(tiles);

      const aComplete = isCompleteHand(tiles, []);
      const oComplete = isCompleteOracle34(counts);
      if (aComplete !== oComplete) {
        completeMismatch += 1;
        if (samples.length < 8)
          samples.push(
            `complete ${describeHand(tiles)} ai=${aComplete} oracle=${oComplete}`,
          );
      }
      if (oComplete) completeCount += 1;

      // 標準形の分解集合(順子/刻子/雀頭の正規化シグネチャ)を突き合わせる。
      const aForms = new Set(
        decomposeStandard(tiles, []).map((f) => formSignature(f.melds, f.pair)),
      );
      const oForms = standardDecompositions34(counts);
      if (!setEqual(aForms, oForms)) {
        decompMismatch += 1;
        if (samples.length < 8)
          samples.push(
            `decomp ${describeHand(tiles)} ai=${[...aForms].sort().join(" / ")} oracle=${[...oForms].sort().join(" / ")}`,
          );
      }
    }
    if (samples.length) console.log(samples.join("\n"));
    console.log(
      `[cross] 14-tile hands compared, complete=${completeCount} completeMismatch=${completeMismatch} decompMismatch=${decompMismatch}`,
    );
    expect(completeMismatch).toBe(0);
    expect(decompMismatch).toBe(0);
  });

  it("13枚: waitingTiles と待ちオラクルの集合が一致する", () => {
    const rng = makeRng(0x3030_4040);
    let waitMismatch = 0;
    let tenpaiCount = 0;
    const samples: string[] = [];
    // ランダム+構造化を混ぜてテンパイ〜非テンパイを厚く。
    for (let i = 0; i < STRUCTURED_HANDS; i += 1) {
      const tiles = rng() < 0.5 ? randomHand(rng, 13) : structured13(rng);
      if (tiles.length !== 13) continue;
      const counts = tilesToCount34(tiles);

      const aWaits = new Set(
        waitingTiles(tiles, []).map((t) => tileTo34Index(t)),
      );
      const oWaits = waitingIndicesOracle34(counts);
      if (!setEqualNum(aWaits, oWaits)) {
        waitMismatch += 1;
        if (samples.length < 8)
          samples.push(
            `waits ${describeHand(tiles)} ai=${[...aWaits].sort((x, y) => x - y)} oracle=${[...oWaits].sort((x, y) => x - y)}`,
          );
      }
      if (oWaits.size > 0) tenpaiCount += 1;
    }
    if (samples.length) console.log(samples.join("\n"));
    console.log(
      `[cross] 13-tile hands compared, tenpai=${tenpaiCount} waitMismatch=${waitMismatch}`,
    );
    expect(waitMismatch).toBe(0);
  });
});

/** 構造化13枚(完成形から1枚除去 → テンパイを厚く)。 */
function structured13(rng: () => number): Tile[] {
  const tiles = randomStructuredHand(rng);
  if (tiles.length !== 14) return tiles.slice(0, 13);
  const drop = Math.floor(rng() * 14);
  return [...tiles.slice(0, drop), ...tiles.slice(drop + 1)];
}

function setEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

function setEqualNum(a: Set<number>, b: Set<number>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

const SUIT_LETTER: Record<string, string> = {
  man: "m",
  pin: "p",
  sou: "s",
  honor: "z",
};

/** 手牌をデバッグ用の簡易記法へ(例: "123p 55z")。 */
function describeHand(tiles: readonly Tile[]): string {
  const order = ["man", "pin", "sou", "honor"];
  const sorted = [...tiles].sort(
    (a, b) => order.indexOf(a.suit) - order.indexOf(b.suit) || a.rank - b.rank,
  );
  return sorted.map((t) => `${t.rank}${SUIT_LETTER[t.suit]}`).join("");
}
