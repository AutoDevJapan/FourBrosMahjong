/**
 * 手牌の面子分解・和了形判定(issue #65 / spec 1.4・2.4・4.1)。
 *
 * 門前手牌(副露を除いた手牌)を「順子・刻子・対子」へ**全通り**分解する。
 * 多面待ちでも現実的な速度になるよう、スート別カウント配列上の再帰で列挙する
 * (探索空間は牌種34未満・深さ ≤ 5 面子のため定数的)。
 *
 * 七対子・国士無双の特殊形も判定する(スペック記載範囲: サンマ牌構成に対応)。
 * 純関数・決定的・React/DOM 非依存。
 */

import type { Suit, Tile } from "../tiles/tile";
import { isNumberSuit, isYaochu, sameKind, tileKey } from "./tile-identity";

/** 面子/対子の種別(分解結果の内部表現)。 */
type MentsuKind = "sequence" | "triplet" | "pair" | "quad";

/**
 * 分解された1グループ。
 * - `sequence` … 順子。`suit` の `startRank`,+1,+2。
 * - `triplet` / `quad` … 刻子 / 槓子。`suit`+`startRank`。
 * - `pair` … 雀頭。`suit`+`startRank`。
 * `concealed` は三暗刻/四暗刻・門前判定用(副露由来なら副露の状態を引き継ぐ)。
 */
export interface Mentsu {
  readonly kind: MentsuKind;
  readonly suit: Suit;
  readonly startRank: number;
  readonly concealed: boolean;
}

/** 標準形(4面子1雀頭)の分解1通り。副露を含んだ全体を表す。 */
export interface StandardForm {
  readonly kind: "standard";
  /** 面子(順子/刻子/槓子)4組。副露を含む。 */
  readonly melds: readonly Mentsu[];
  /** 雀頭1組。 */
  readonly pair: Mentsu;
}

/** 七対子形。 */
export interface SevenPairsForm {
  readonly kind: "sevenPairs";
  readonly pairs: readonly Mentsu[];
}

/** 国士無双形。 */
export interface ThirteenOrphansForm {
  readonly kind: "thirteenOrphans";
  /** 頭(対子になっている么九牌)の種別キー。 */
  readonly pairKey: string;
}

export type WinForm = StandardForm | SevenPairsForm | ThirteenOrphansForm;

// ---------------------------------------------------------------------------
// カウント表現
// ---------------------------------------------------------------------------

/** スート別カウント(man/pin/sou は rank-1 を index、honor は rank-1 を index)。 */
interface Counts {
  man: number[];
  pin: number[];
  sou: number[];
  honor: number[];
}

const ORDER: readonly Suit[] = ["man", "pin", "sou", "honor"];

function emptyCounts(): Counts {
  return {
    man: new Array<number>(9).fill(0),
    pin: new Array<number>(9).fill(0),
    sou: new Array<number>(9).fill(0),
    honor: new Array<number>(7).fill(0),
  };
}

function cloneCounts(counts: Counts): Counts {
  return {
    man: [...counts.man],
    pin: [...counts.pin],
    sou: [...counts.sou],
    honor: [...counts.honor],
  };
}

function toCounts(tiles: readonly Tile[]): Counts {
  const counts = emptyCounts();
  for (const tile of tiles) {
    counts[tile.suit][tile.rank - 1] += 1;
  }
  return counts;
}

/** 最初に残っている(count>0)牌の位置を昇順で返す。無ければ null。 */
function firstNonZero(counts: Counts): { suit: Suit; index: number } | null {
  for (const suit of ORDER) {
    const arr = counts[suit];
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] > 0) return { suit, index: i };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// 面子の全列挙(雀頭を除いた残りを順子/刻子へ)
// ---------------------------------------------------------------------------

/**
 * `counts` を面子(順子/刻子)のみで**過不足なく**分解する全通りを返す。
 * 分解不能なら空配列。完全に消費できた場合のみ結果に含める。
 */
function extractMentsuAll(counts: Counts): Mentsu[][] {
  const pos = firstNonZero(counts);
  if (pos === null) return [[]]; // 全消費: 空の分解1通り

  const { suit, index } = pos;
  const arr = counts[suit];
  const results: Mentsu[][] = [];

  // 刻子
  if (arr[index] >= 3) {
    const next = cloneCounts(counts);
    next[suit][index] -= 3;
    for (const rest of extractMentsuAll(next)) {
      results.push([
        { kind: "triplet", suit, startRank: index + 1, concealed: true },
        ...rest,
      ]);
    }
  }

  // 順子(数牌のみ・index+2 まで存在)
  if (
    isNumberSuit(suit) &&
    index <= 6 &&
    arr[index + 1] > 0 &&
    arr[index + 2] > 0
  ) {
    const next = cloneCounts(counts);
    next[suit][index] -= 1;
    next[suit][index + 1] -= 1;
    next[suit][index + 2] -= 1;
    for (const rest of extractMentsuAll(next)) {
      results.push([
        { kind: "sequence", suit, startRank: index + 1, concealed: true },
        ...rest,
      ]);
    }
  }

  return results;
}

/**
 * `concealedTiles`(和了牌を含む門前手牌)を、`neededMelds` 面子 + 雀頭1 に
 * 分解する全通りを返す。副露分は含まない(呼び出し側で合成する)。
 */
function decomposeConcealedStandard(
  concealedTiles: readonly Tile[],
  neededMelds: number,
): { melds: Mentsu[]; pair: Mentsu }[] {
  const total = concealedTiles.length;
  if (total !== neededMelds * 3 + 2) return [];

  const counts = toCounts(concealedTiles);
  const forms: { melds: Mentsu[]; pair: Mentsu }[] = [];
  const seen = new Set<string>();

  for (const suit of ORDER) {
    const arr = counts[suit];
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] < 2) continue;
      const withoutPair = cloneCounts(counts);
      withoutPair[suit][i] -= 2;
      const pair: Mentsu = {
        kind: "pair",
        suit,
        startRank: i + 1,
        concealed: true,
      };
      for (const melds of extractMentsuAll(withoutPair)) {
        if (melds.length !== neededMelds) continue;
        const signature = mentsuSignature([...melds, pair]);
        if (seen.has(signature)) continue;
        seen.add(signature);
        forms.push({ melds, pair });
      }
    }
  }

  return forms;
}

function mentsuSignature(groups: readonly Mentsu[]): string {
  return groups
    .map((g) => `${g.kind}:${g.suit}${g.startRank}`)
    .sort()
    .join("|");
}

// ---------------------------------------------------------------------------
// 副露 → 面子変換
// ---------------------------------------------------------------------------

/** 副露(ポン/カン)を分解結果の面子表現に写す。 */
function meldToMentsu(
  tiles: readonly Tile[],
  isKan: boolean,
  concealed: boolean,
): Mentsu {
  const first = tiles[0];
  return {
    kind: isKan ? "quad" : "triplet",
    suit: first.suit,
    startRank: first.rank,
    concealed,
  };
}

// ---------------------------------------------------------------------------
// 公開: 標準形分解
// ---------------------------------------------------------------------------

/** 副露の最小情報(decompose が必要とするぶんだけ)。 */
export interface MeldInput {
  readonly tiles: readonly Tile[];
  readonly isKan: boolean;
  readonly concealed: boolean;
}

/**
 * 副露入力が1組のポン/カンとして成立する形状かを検証する。
 *
 * `MeldInput` は公開された構造型なので、JSON や型アサーション経由で
 * 「2枚のポン」などの不正な値が到達し得る。これをそのまま面子へ写すと、
 * 実牌より少ない手牌でも標準形として分解され、和了を誤って受理する。
 * 副露面子は分解の前提として扱うため、ここで枚数と牌種の一致を確認する。
 */
function isValidMeldInput(meld: MeldInput): boolean {
  if (
    meld === null ||
    typeof meld !== "object" ||
    !Array.isArray(meld.tiles) ||
    typeof meld.isKan !== "boolean" ||
    typeof meld.concealed !== "boolean"
  ) {
    return false;
  }
  // ポンは常に明刻であり、暗刻として扱えるのは暗槓だけ。
  if (!meld.isKan && meld.concealed) return false;

  const expectedSize = meld.isKan ? 4 : 3;
  if (meld.tiles.length !== expectedSize) return false;

  const isTileShape = (tile: Tile): boolean =>
    tile !== null &&
    typeof tile === "object" &&
    typeof tile.suit === "string" &&
    Number.isInteger(tile.rank);
  if (!meld.tiles.every(isTileShape)) return false;

  const first = meld.tiles[0];
  return (
    first !== undefined && meld.tiles.every((tile) => sameKind(tile, first))
  );
}

function hasValidMeldInputs(melds: readonly MeldInput[]): boolean {
  return Array.isArray(melds) && melds.every(isValidMeldInput);
}

/**
 * 標準形(4面子1雀頭)の分解を全通り返す。副露を面子に含めた完成形。
 * 分解不能(和了形でない)なら空配列。
 */
export function decomposeStandard(
  concealedTiles: readonly Tile[],
  melds: readonly MeldInput[],
): StandardForm[] {
  if (!hasValidMeldInputs(melds)) return [];
  const neededMelds = 4 - melds.length;
  if (neededMelds < 0) return [];
  const meldMentsu = melds.map((m) =>
    meldToMentsu(m.tiles, m.isKan, m.concealed),
  );
  return decomposeConcealedStandard(concealedTiles, neededMelds).map(
    (form) => ({
      kind: "standard" as const,
      melds: [...meldMentsu, ...form.melds],
      pair: form.pair,
    }),
  );
}

// ---------------------------------------------------------------------------
// 公開: 七対子・国士無双
// ---------------------------------------------------------------------------

/**
 * 七対子形か。門前14枚で、**相異なる**7対子(4枚使いは不可)。
 * 副露がある場合は不成立。
 */
export function decomposeSevenPairs(
  concealedTiles: readonly Tile[],
  melds: readonly MeldInput[],
): SevenPairsForm | null {
  if (
    !hasValidMeldInputs(melds) ||
    melds.length > 0 ||
    concealedTiles.length !== 14
  )
    return null;
  const counts = toCounts(concealedTiles);
  const pairs: Mentsu[] = [];
  for (const suit of ORDER) {
    const arr = counts[suit];
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] === 0) continue;
      if (arr[i] !== 2) return null; // 0/2 以外(4枚含む)は七対子不成立
      pairs.push({ kind: "pair", suit, startRank: i + 1, concealed: true });
    }
  }
  return pairs.length === 7 ? { kind: "sevenPairs", pairs } : null;
}

/**
 * 国士無双形か。門前14枚で、13種の么九牌すべてを含み1種のみ雀頭。
 * サンマの么九牌は 1萬9萬 1筒9筒 1索9索 東南西北白發中 の計13種(スペック1 1.2)。
 */
export function decomposeThirteenOrphans(
  concealedTiles: readonly Tile[],
  melds: readonly MeldInput[],
): ThirteenOrphansForm | null {
  if (
    !hasValidMeldInputs(melds) ||
    melds.length > 0 ||
    concealedTiles.length !== 14
  )
    return null;
  if (!concealedTiles.every((t) => isYaochu(t))) return null;

  const byKind = new Map<string, Tile>();
  const countByKind = new Map<string, number>();
  for (const tile of concealedTiles) {
    const key = tileKey(tile);
    byKind.set(key, tile);
    countByKind.set(key, (countByKind.get(key) ?? 0) + 1);
  }
  if (byKind.size !== 13) return null;

  let pairKey: string | null = null;
  for (const [key, count] of countByKind) {
    if (count === 2) {
      if (pairKey !== null) return null;
      pairKey = key;
    } else if (count !== 1) {
      return null;
    }
  }
  return pairKey === null ? null : { kind: "thirteenOrphans", pairKey };
}

/**
 * 和了形(標準/七対子/国士)を全て返す。空なら和了形ではない。
 * 役の有無は別途 {@link "./yaku"} で判定する(和了形 ≠ 和了成立)。
 */
export function decomposeAll(
  concealedTiles: readonly Tile[],
  melds: readonly MeldInput[],
): WinForm[] {
  if (!hasValidMeldInputs(melds)) return [];
  const forms: WinForm[] = [...decomposeStandard(concealedTiles, melds)];
  const seven = decomposeSevenPairs(concealedTiles, melds);
  if (seven) forms.push(seven);
  const kokushi = decomposeThirteenOrphans(concealedTiles, melds);
  if (kokushi) forms.push(kokushi);
  return forms;
}

/** 和了形が1つでも成立するか(役の有無は問わない)。 */
export function isCompleteHand(
  concealedTiles: readonly Tile[],
  melds: readonly MeldInput[],
): boolean {
  return decomposeAll(concealedTiles, melds).length > 0;
}

/** 分解結果の面子が和了牌の種別を含むか(順子/刻子/対子/槓子いずれか)。 */
export function mentsuContainsKind(
  mentsu: Mentsu,
  tile: Pick<Tile, "suit" | "rank">,
): boolean {
  if (mentsu.suit !== tile.suit) return false;
  if (mentsu.kind === "sequence") {
    return tile.rank >= mentsu.startRank && tile.rank <= mentsu.startRank + 2;
  }
  return sameKind({ suit: mentsu.suit, rank: mentsu.startRank }, tile);
}
