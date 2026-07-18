/**
 * 他家(AI)の打牌方針(issue #98 / #67 フォローアップ)。
 *
 * #67 の他家 AI は **ツモ切り**(引いた牌をそのまま切る)だったため、ほぼ毎局が流局し、
 * オール赤5・ガリ・サイコロドラの打点が体験に反映されにくかった。本モジュールは
 * **手牌効率(向聴数・受け入れ)ベースの打牌選択**へ高度化し、有効牌を残す・打点(赤5/ドラ)を
 * 温存する・危険牌を避ける、を優先度付きで判断する純ロジックへ置き換える。
 *
 * スコープ(過剰設計の回避):
 * - 打牌選択に加え、ナシナシで役無しを確定させないための最小限のポン/大明槓判断を扱う。
 *   リーチ判断は含めない。
 * - 向聴/受け入れは自家の見えている情報(自分の14枚)のみで算出する。相手の手牌は覗かない。
 * - サンマの実在牌種(萬子1・9のみ / 字牌 東南西北白發中)に閉じて受け入れを数える
 *   ({@link SANMA_TILE_KINDS})。
 *
 * SSOT 整合: オール赤5・北ガリ・ソシー等のルールは打牌選択の「価値付け」に反映する
 * (赤5・ドラを他条件が同等なら温存)。向聴・受け入れの計算自体は標準麻雀の手牌効率理論に
 * 独自準拠する(外部ライブラリ非依存)。
 *
 * 純関数・決定的・React/DOM 非依存。
 */

import type { Meld } from "@/domain/hand/meld";
import {
  isYaochu,
  SANMA_TILE_KINDS,
  tileKey,
} from "@/domain/hand/tile-identity";
import { HONOR, type Suit, type Tile } from "@/domain/tiles/tile";

const RED_FIVE_SUITS: ReadonlySet<Suit> = new Set(["pin", "sou"]);

/** AI が他家の打牌を鳴くか判断するために必要な公開文脈。 */
export interface CallMeldContext {
  readonly tile: Tile;
  readonly melds: readonly Meld[];
  readonly seatWind: number;
  readonly roundWind: number;
}

/** 三元牌、場風、自風（北はガリ専用）か。 */
function isValueHonor(
  tile: Tile,
  seatWind: number,
  roundWind: number,
): boolean {
  if (tile.suit !== "honor" || tile.rank === HONOR.NORTH) return false;
  return (
    tile.rank >= HONOR.WHITE ||
    tile.rank === seatWind ||
    tile.rank === roundWind
  );
}

/**
 * ナシナシ規則下の AI のポン/大明槓判断。
 * 今回の鳴きで役牌を確定するか、既に役牌副露があって役が確定済みの場合だけ鳴く。
 * ドラは役ではなく、鳴いた後は門前へ戻れないため判断材料にしない。
 */
export function shouldCallMeld(ctx: CallMeldContext): boolean {
  if (isValueHonor(ctx.tile, ctx.seatWind, ctx.roundWind)) return true;
  return ctx.melds.some((meld) => {
    const representative = meld.tiles[0];
    return (
      representative !== undefined &&
      isValueHonor(representative, ctx.seatWind, ctx.roundWind)
    );
  });
}

/** 種別(suit+rank)から `Tile` を生成(赤5筒/5索は不変条件どおり赤)。 */
function makeTile(suit: Suit, rank: number): Tile {
  return { suit, rank, isRed: rank === 5 && RED_FIVE_SUITS.has(suit) };
}

// ---------------------------------------------------------------------------
// カウント表現(スート別カウント配列)
// ---------------------------------------------------------------------------

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

function toCounts(tiles: readonly Tile[]): Counts {
  const counts = emptyCounts();
  for (const tile of tiles) counts[tile.suit][tile.rank - 1] += 1;
  return counts;
}

function countsSignature(counts: Counts): string {
  return `${counts.man.join("")}|${counts.pin.join("")}|${counts.sou.join(
    "",
  )}|${counts.honor.join("")}`;
}

// ---------------------------------------------------------------------------
// 向聴数(シャンテン数): 標準形 / 七対子 / 国士 の最小
// ---------------------------------------------------------------------------

/** 向聴計算のメモ(同一手牌の再計算を避ける)。上限超過でクリア。 */
const shantenMemo = new Map<string, number>();
const SHANTEN_MEMO_CAP = 200_000;

/**
 * 分解結果 (面子 melds / 塔子 taatsu / 対子 pairs) から標準形の向聴数を求める。
 * 和了= -1、テンパイ= 0。麻雀の手牌効率の標準式 `8 − 2×面子 − 有効塔子 − 雀頭` に準拠。
 */
function leafShanten(melds: number, taatsu: number, pairs: number): number {
  let best = Number.POSITIVE_INFINITY;
  const headOptions = pairs >= 1 ? [true, false] : [false];
  for (const hasHead of headOptions) {
    const poolForMelds = taatsu + pairs - (hasHead ? 1 : 0);
    const useful = Math.min(poolForMelds, 4 - melds);
    const s = 8 - 2 * melds - useful - (hasHead ? 1 : 0);
    if (s < best) best = s;
  }
  return best;
}

/** 1スートの分解1通り = [面子数, 塔子数, 対子数]。 */
type SuitDecomp = readonly [number, number, number];

/** スート別分解のメモ(牌種は限られるので、ウォームアップ後はほぼヒットする)。 */
const suitMemo = new Map<string, SuitDecomp[]>();

/**
 * 1スートのカウント配列を面子/塔子/対子へ分解する全通り(パレート最適のみ)。
 * 数牌は順子・塔子(両面/辺張/嵌張)を許すが、字牌は刻子/対子のみ。
 * スートは面子を跨がないため、標準形の向聴はスート独立に分解して合成できる(高速化)。
 */
function suitFrontier(arr: readonly number[], isNumber: boolean): SuitDecomp[] {
  const key = (isNumber ? "n" : "h") + arr.join("");
  const cached = suitMemo.get(key);
  if (cached !== undefined) return cached;

  const raw: SuitDecomp[] = [];
  const seen = new Set<string>();
  const a = [...arr];
  const len = a.length;

  const record = (m: number, t: number, p: number): void => {
    const sig = `${m},${t},${p}`;
    if (!seen.has(sig)) {
      seen.add(sig);
      raw.push([m, t, p]);
    }
  };

  const rec = (from: number, m: number, t: number, p: number): void => {
    let i = from;
    while (i < len && a[i] === 0) i++;
    if (i >= len) {
      record(m, t, p);
      return;
    }
    // 刻子
    if (a[i] >= 3) {
      a[i] -= 3;
      rec(i, m + 1, t, p);
      a[i] += 3;
    }
    // 順子
    if (isNumber && i <= len - 3 && a[i + 1] > 0 && a[i + 2] > 0) {
      a[i] -= 1;
      a[i + 1] -= 1;
      a[i + 2] -= 1;
      rec(i, m + 1, t, p);
      a[i] += 1;
      a[i + 1] += 1;
      a[i + 2] += 1;
    }
    // 対子
    if (a[i] >= 2) {
      a[i] -= 2;
      rec(i, m, t, p + 1);
      a[i] += 2;
    }
    // 塔子(両面/辺張: i,i+1)
    if (isNumber && i <= len - 2 && a[i + 1] > 0) {
      a[i] -= 1;
      a[i + 1] -= 1;
      rec(i, m, t + 1, p);
      a[i] += 1;
      a[i + 1] += 1;
    }
    // 塔子(嵌張: i,i+2)
    if (isNumber && i <= len - 3 && a[i + 2] > 0) {
      a[i] -= 1;
      a[i + 2] -= 1;
      rec(i, m, t + 1, p);
      a[i] += 1;
      a[i + 2] += 1;
    }
    // 浮き牌(この牌を使わない)
    a[i] -= 1;
    rec(i, m, t, p);
    a[i] += 1;
  };

  rec(0, 0, 0, 0);

  const pruned = paretoPrune(raw);
  suitMemo.set(key, pruned);
  return pruned;
}

/**
 * パレート枝刈り: 面子・塔子・対子いずれも多いほど {@link leafShanten} は小さく(良く)なるため、
 * 全項目で他に劣る分解は捨てる。スートごとにフロンティアを小さく保つことで、
 * 標準形の合成(スート積)を軽くする。
 */
function paretoPrune(list: readonly SuitDecomp[]): SuitDecomp[] {
  return list.filter(
    (x) =>
      !list.some(
        (y) =>
          y !== x &&
          y[0] >= x[0] &&
          y[1] >= x[1] &&
          y[2] >= x[2] &&
          (y[0] > x[0] || y[1] > x[1] || y[2] > x[2]),
      ),
  );
}

/**
 * 標準形(4面子1雀頭)の向聴数。スートは面子を跨がないためスート独立に分解でき
 * (それぞれメモ済み・パレート枝刈り済みで小さい)、その積を合成して面子/塔子/対子の
 * 合計に対し {@link leafShanten} を最小化する。
 */
function standardShanten(counts: Counts): number {
  const man = suitFrontier(counts.man, true);
  const pin = suitFrontier(counts.pin, true);
  const sou = suitFrontier(counts.sou, true);
  const honor = suitFrontier(counts.honor, false);

  let best = 8;
  for (const dm of man) {
    for (const dp of pin) {
      for (const ds of sou) {
        for (const dh of honor) {
          const m = dm[0] + dp[0] + ds[0] + dh[0];
          const t = dm[1] + dp[1] + ds[1] + dh[1];
          const p = dm[2] + dp[2] + ds[2] + dh[2];
          const s = leafShanten(m, t, p);
          if (s < best) best = s;
        }
      }
    }
  }
  return best;
}

/** 七対子の向聴数(門前前提)。`6 − 対子数 + max(0, 7 − 種類数)`。 */
function chiitoitsuShanten(counts: Counts): number {
  let pairs = 0;
  let kinds = 0;
  for (const suit of ORDER) {
    for (const n of counts[suit]) {
      if (n >= 1) kinds += 1;
      if (n >= 2) pairs += 1;
    }
  }
  return 6 - pairs + Math.max(0, 7 - kinds);
}

/** 国士無双の向聴数(門前前提)。`13 − 么九種類数 − (么九対子ありなら1)`。 */
function kokushiShanten(tiles: readonly Tile[]): number {
  const kinds = new Set<string>();
  let hasPair = false;
  const seen = new Map<string, number>();
  for (const tile of tiles) {
    if (!isYaochu(tile)) continue;
    const key = tileKey(tile);
    kinds.add(key);
    const c = (seen.get(key) ?? 0) + 1;
    seen.set(key, c);
    if (c >= 2) hasPair = true;
  }
  return 13 - kinds.size - (hasPair ? 1 : 0);
}

/**
 * 手牌の向聴数(標準/七対子/国士の最小)。和了= -1、テンパイ= 0。
 * 13枚でも14枚でも計算できる(受け入れ判定では14枚を評価する)。
 *
 * **牌残量を見ない理想化(意図的な設計 / #143)**:
 * 本関数は標準向聴式に基づき、待ち牌の**山残量を考慮しない**。ある牌の**4枚全てが
 * 手牌にある**「デッドウォール待ち」(例: `444p 8888p 789s 東東東` の 8p 単騎)は、
 * 5枚目が引けず本来和了不能だが、ここではテンパイ(0)と数える。牌残量まで見る参照実装
 * (MahjongRepository/mahjong, `is_three_player=True`)とはこの1クラスのみ ±1 差になる
 * (オフライン照合で 16,000 手中 7 手、すべて4枚使い)。
 *
 * これは AI 打牌選択の用途では妥当な単純化であり、修正しない:
 * - **実害なし**: 打牌選択が使う {@link ukeire} は残量(`4 − 手牌内枚数`)で数えるため、
 *   当該牌の受け入れは 0 枚と正しく評価される。{@link chooseDiscard} は受け入れ枚数で
 *   同向聴の候補を比較するので、デッドテンパイが実在テンパイに勝つことはない。
 * - **hot-path 保護**: 本関数は AI の全打牌評価で多数回呼ばれる。残量補正には待ち牌の
 *   同定が要るが、向聴は面子/塔子/対子の集計(スート積の葉)で解いており牌の同定情報を
 *   失うため、補正は非自明な書き換え/毎テンパイ判定の追加計算を招く。4枚使いは実戦の
 *   サンマでほぼ生じず、割に合わない。
 * - **検証整合**: クロス検証オラクル(`__oracle__/shanten-oracle.ts`)も同じ理想化を
 *   共有し、参照ライブラリとはオフラインで別途アンカー済み。ここだけ補正すると両者が乖離する。
 */
export function shanten(tiles: readonly Tile[]): number {
  const counts = toCounts(tiles);
  const key = countsSignature(counts);
  const cached = shantenMemo.get(key);
  if (cached !== undefined) return cached;

  const s = Math.min(
    standardShanten(counts),
    chiitoitsuShanten(counts),
    kokushiShanten(tiles),
  );

  if (shantenMemo.size >= SHANTEN_MEMO_CAP) shantenMemo.clear();
  shantenMemo.set(key, s);
  return s;
}

// ---------------------------------------------------------------------------
// 受け入れ(有効牌)
// ---------------------------------------------------------------------------

/** ある種別の残り枚数(4枚 − 手牌内枚数)。他家の河は見ない。 */
function remainingCopies(tiles: readonly Tile[], key: string): number {
  let inHand = 0;
  for (const tile of tiles) if (tileKey(tile) === key) inHand += 1;
  return 4 - inHand;
}

/**
 * 受け入れ候補になり得る牌種のキー集合。
 * ある牌を引いて向聴が下がるのは、それが手牌のいずれかと面子/塔子/対子を作れるとき、
 * すなわち同種か(数牌なら)同スート±2以内のときに限る。孤立牌は浮くだけで向聴を進めない。
 * 遠い孤立牌を除外することで受け入れ計算の探索母数を約1/3へ削減する(結果は厳密同値)。
 */
function ukeireCandidateKeys(tiles13: readonly Tile[]): Set<string> {
  const keys = new Set<string>();
  for (const tile of tiles13) {
    if (tile.suit === "honor") {
      keys.add(tileKey(tile));
      continue;
    }
    for (let r = tile.rank - 2; r <= tile.rank + 2; r++) {
      if (r >= 1 && r <= 9) keys.add(`${tile.suit}-${r}`);
    }
  }
  return keys;
}

/** 受け入れ集計(向聴を進める有効牌の種類数と延べ枚数)。 */
export interface Ukeire {
  /** 有効牌の種類数。 */
  readonly kinds: number;
  /** 有効牌の延べ枚数(各種別の残り枚数の総和)。 */
  readonly copies: number;
}

/**
 * 13枚の手牌の受け入れを数える。
 * 「引くと向聴数が下がる」牌種を有効牌とみなし、その延べ残り枚数を合算する。
 */
export function ukeire(tiles13: readonly Tile[]): Ukeire {
  const base = shanten(tiles13);
  const candidateKeys = ukeireCandidateKeys(tiles13);
  let kinds = 0;
  let copies = 0;
  for (const kind of SANMA_TILE_KINDS) {
    const key = tileKey(kind);
    if (!candidateKeys.has(key)) continue; // 孤立牌は向聴を進めない(厳密に除外可)。
    const remaining = remainingCopies(tiles13, key);
    if (remaining <= 0) continue;
    const drawn = makeTile(kind.suit, kind.rank);
    if (shanten([...tiles13, drawn]) < base) {
      kinds += 1;
      copies += remaining;
    }
  }
  return { kinds, copies };
}

// ---------------------------------------------------------------------------
// 打牌選択
// ---------------------------------------------------------------------------

/**
 * 受け入れ比較を行う向聴数の上限(これ以下=テンパイ近傍でのみ受け入れを評価)。
 * 1 = テンパイ/1向聴。待ちの広い聴牌へ向かう選択が最も効くのはこの近傍で、
 * ここでは候補も少ない。深い向聴では浮き牌同士の比較になり打牌にほぼ影響しない一方、
 * 計算コストだけ跳ね上がるため評価しない(打点温存・安全度・外側度で決定)。
 */
const UKEIRE_SHANTEN_GATE = 1;

/** 打牌選択に渡す状況(自家=AI 手番の視点)。 */
export interface DiscardContext {
  /** 手番の全牌(門前手牌13枚 + ツモ牌1枚 = 14枚)。 */
  readonly tiles: readonly Tile[];
  /** 他家の河(捨て牌の列)。危険牌回避(現物優先)の判断に使う。省略可。 */
  readonly opponentDiscards?: readonly (readonly Tile[])[];
  /** ドラ実牌の種別キー集合(温存判断用)。赤5は `isRed` で常に価値扱い。省略可。 */
  readonly doraKinds?: ReadonlySet<string>;
}

/** 打牌1候補の評価。優先度順に比較する。 */
interface Candidate {
  readonly tile: Tile;
  /** この牌を切った後の残り13枚(受け入れ算出に再利用)。 */
  readonly remaining13: readonly Tile[];
  /** 打牌後の向聴数(小さいほど良い)。 */
  readonly shantenAfter: number;
  /** 打牌後の受け入れ延べ枚数(大きいほど良い)。未算出は -1。 */
  ukeireCopies: number;
  /** 温存価値(赤5=2・ドラ=1・素牌=0)。小さいほど切ってよい。 */
  readonly value: number;
  /** 安全度(現物にしている他家の数。大きいほど放銃しにくい)。 */
  readonly safety: number;
  /** 外側度(字牌 > 老頭 > 端寄り)。同点最終決着用の決定的キー。 */
  readonly outside: number;
}

/** 端からの距離を外側度に写す(字牌=3・老頭=2・2/8=1・その他=0)。 */
function outsideness(tile: Tile): number {
  if (tile.suit === "honor") return 3;
  if (tile.rank === 1 || tile.rank === 9) return 2;
  if (tile.rank === 2 || tile.rank === 8) return 1;
  return 0;
}

/** 温存価値(赤5は打点直結で最優先温存、表ドラは次点)。 */
function valueOf(
  tile: Tile,
  doraKinds: ReadonlySet<string> | undefined,
): number {
  let v = 0;
  if (tile.isRed) v += 2;
  if (doraKinds?.has(tileKey(tile))) v += 1;
  return v;
}

/** 現物にしている他家の数(その種別を既に河に捨てている他家の数)。 */
function safetyOf(
  tile: Tile,
  opponentDiscards: readonly (readonly Tile[])[] | undefined,
): number {
  if (opponentDiscards === undefined) return 0;
  const key = tileKey(tile);
  let count = 0;
  for (const pile of opponentDiscards) {
    if (pile.some((t) => tileKey(t) === key)) count += 1;
  }
  return count;
}

/**
 * 打牌を選ぶ。優先度(高い順):
 * 1. **手牌効率**: 打牌後の向聴数が最小。
 * 2. **受け入れ**: 同向聴なら受け入れ延べ枚数が最大。
 * 3. **打点温存**: 同効率なら赤5・ドラを残す(価値の低い牌を切る)。
 * 4. **危険牌回避**: 同条件なら他家の現物(既出牌)を優先して切る。
 * 5. **決定性**: なお同点なら外側(字牌・端)の牌を切る(seed 再現性の担保)。
 *
 * これにより「有効牌を残す/打点を温存する/危険牌を避ける」がツモ切りより明確に改善する。
 */
export function chooseDiscard(ctx: DiscardContext): Tile {
  const { tiles, opponentDiscards, doraKinds } = ctx;
  if (tiles.length === 0) {
    throw new Error("chooseDiscard: 空の手牌からは打牌できない");
  }

  // 同一(suit,rank,isRed)の重複候補は1回だけ評価する。
  const seen = new Set<string>();
  const candidates: Candidate[] = [];

  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i];
    const idKey = `${tile.suit}-${tile.rank}-${tile.isRed ? "r" : ""}`;
    if (seen.has(idKey)) continue;
    seen.add(idKey);

    const remaining13 = [...tiles.slice(0, i), ...tiles.slice(i + 1)];
    candidates.push({
      tile,
      remaining13,
      shantenAfter: shanten(remaining13),
      // 受け入れは後段(向聴最小の候補)でのみ算出する(計算量削減)。
      ukeireCopies: -1,
      value: valueOf(tile, doraKinds),
      safety: safetyOf(tile, opponentDiscards),
      outside: outsideness(tile),
    });
  }

  // 1. 向聴最小へ絞る。
  const minShanten = Math.min(...candidates.map((c) => c.shantenAfter));
  const best = candidates.filter((c) => c.shantenAfter === minShanten);

  // 2. 受け入れは「向聴が浅く(テンパイ近傍)、かつ候補が複数」のときだけ算出する。
  //    受け入れ差は待ちの広い聴牌へ向かう選択に効くが、向聴の深い序盤では浮き牌同士の
  //    比較になり打牌選択にほぼ影響しない一方で計算量が跳ね上がるため、そこでは省く
  //    (省略時は打点温存・危険牌回避・外側度で決める)。
  if (best.length > 1 && minShanten <= UKEIRE_SHANTEN_GATE) {
    for (const c of best) c.ukeireCopies = ukeire(c.remaining13).copies;
  }

  best.sort((a, b) => {
    // 受け入れ最大(切って残る受けが広い方)。
    if (a.ukeireCopies !== b.ukeireCopies)
      return b.ukeireCopies - a.ukeireCopies;
    // 打点温存: 価値の低い牌を切る。
    if (a.value !== b.value) return a.value - b.value;
    // 危険牌回避: 現物(安全)な牌を優先して切る。
    if (a.safety !== b.safety) return b.safety - a.safety;
    // 決定性: 外側の牌を切る。
    if (a.outside !== b.outside) return b.outside - a.outside;
    // 最終安定化: 牌種の決定的順序。
    return tileKey(a.tile).localeCompare(tileKey(b.tile));
  });

  return best[0].tile;
}
