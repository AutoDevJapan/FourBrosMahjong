/**
 * 役の有無判定(issue #65 / spec 1.4・2.4・3.1)。
 *
 * **責務境界(#66 点数計算との線引き)**:
 * 本モジュールは「どの役が成立するか」と「各役の翻(役翻)」までを算出する。
 * ドラ(表/裏/赤/ガリ)の翻加算(スペック3 3.2)と、翻合計→点数変換(スペック3 3.1)は
 * **#66 の責務**。よって {@link detectYaku} の翻にドラは一切含まない。
 *
 * **ナシナシ制約(スペック1 1.4)**:
 * - 喰いタン無し: 断么九は門前でのみ役として数える(副露手では無効)。
 * - 後付け無し(完全先付け寄り): 唯一の役が「和了牌で完成した役牌」だけの手は和了不可。
 * - チー無し: 型(`MeldType`)にチーが存在しない({@link "./meld"})。
 * - 喰い替え無し: 打牌合法性のルールで別レイヤ(→ {@link "./kuikae"})。
 *
 * 個々の役定義の出典は標準的な役定義(スペックは役を網羅列挙していないため — PR で齟齬を明記)。
 * 純関数・決定的・React/DOM 非依存。
 */

import { HONOR, type Tile } from "../tiles/tile";
import {
  type Mentsu,
  type StandardForm,
  type WinForm,
  mentsuContainsKind,
} from "./decompose";
import {
  isDragon,
  isGreenTile,
  isHonor,
  isTerminalNumber,
  isWind,
  isYaochu,
  sameKind,
} from "./tile-identity";

/**
 * 成立した役1つ。翻は門前/副露を調整済みの「役翻」(ドラを含まない)。
 * `yakuman` は役満倍数(0=通常役, 1=シングル役満, 2=ダブル役満)。役満時は `han` を無視する。
 */
export interface Yaku {
  readonly id: string;
  readonly name: string;
  readonly han: number;
  readonly yakuman: number;
}

/** 役満対象のパオ役(スペック3 3.3: 大三元・大四喜・四槓子)。 */
export type PaoYaku = "daisangen" | "daisuushii" | "suukantsu";

/** 役判定への入力(手牌+文脈)。席割り当て(Q9)には依存しない。 */
export interface YakuInput {
  /** 和了形全14枚(門前手牌 + 副露牌、和了牌を含む)。 */
  readonly allTiles: readonly Tile[];
  /** 門前(暗槓のみ or 副露ゼロ)なら true。 */
  readonly menzen: boolean;
  readonly winType: "tsumo" | "ron";
  readonly winningTile: Tile;
  /** 自風(HONOR の風 rank)。未指定なら自風役牌を数えない(席=Q9依存を導出しない)。 */
  readonly seatWind?: number;
  /** 場風(HONOR の風 rank)。未指定なら場風役牌を数えない。 */
  readonly roundWind?: number;
  readonly riichi?: boolean;
  readonly doubleRiichi?: boolean;
  readonly ippatsu?: boolean;
  /** 海底摸月(ツモ)/河底撈魚(ロン)。 */
  readonly haitei?: boolean;
  readonly rinshan?: boolean;
  readonly chankan?: boolean;
  /** 天和/地和(親決め=Q9依存の導出はしない。成立可否は文脈で受ける)。 */
  readonly blessing?: "heaven" | "earth";
}

interface RawYaku extends Yaku {
  /** 役牌役か(後付け判定用)。 */
  readonly isYakuhai?: boolean;
  /** その役牌が和了牌で完成したか(後付け判定用)。 */
  readonly agariCompleted?: boolean;
}

// ---------------------------------------------------------------------------
// グループ・牌の述語
// ---------------------------------------------------------------------------

function isTripletLike(m: Mentsu): boolean {
  return m.kind === "triplet" || m.kind === "quad";
}

/** 面子/雀頭が么九牌を含むか(混全帯么九・純全帯么九・混老頭判定用)。 */
function groupHasYaochu(m: Mentsu): boolean {
  if (m.kind === "sequence") {
    // 順子 [s, s+1, s+2] は端に 1 か 9 を含めば么九入り。
    return m.startRank === 1 || m.startRank === 7;
  }
  return isYaochu({ suit: m.suit, rank: m.startRank });
}

/** 雀頭が役牌(三元牌・場風・自風)か(平和の否定条件)。 */
function pairIsValue(pair: Mentsu, input: YakuInput): boolean {
  if (pair.suit !== "honor") return false;
  return (
    isDragon({ suit: "honor", rank: pair.startRank }) ||
    pair.startRank === input.roundWind ||
    pair.startRank === input.seatWind
  );
}

/** 両面待ちで和了牌が順子を完成させたか(平和の待ち条件)。 */
function ryanmenOk(startRank: number, rank: number): boolean {
  if (rank === startRank) return startRank <= 6; // 下端: [r,r+1,r+2] の r 待ち
  if (rank === startRank + 2) return startRank >= 2; // 上端
  return false; // 嵌張(中)
}

// ---------------------------------------------------------------------------
// 全体牌ベースの役(標準形・七対子で共通)
// ---------------------------------------------------------------------------

function wholeHandYaku(input: YakuInput): RawYaku[] {
  const tiles = input.allTiles;
  const yaku: RawYaku[] = [];

  const allYaochu = tiles.every((t) => isYaochu(t));
  const allHonor = tiles.every((t) => isHonor(t));
  const allTerminal = tiles.every((t) => isTerminalNumber(t));
  const allGreen = tiles.every((t) => isGreenTile(t));
  const honorsPresent = tiles.some((t) => isHonor(t));
  const numberSuits = new Set(
    tiles.filter((t) => !isHonor(t)).map((t) => t.suit),
  );

  // --- 役満系(全体牌) ---
  if (allHonor) {
    yaku.push({ id: "tsuuiisou", name: "字一色", han: 0, yakuman: 1 });
  }
  if (allTerminal) {
    yaku.push({ id: "chinroutou", name: "清老頭", han: 0, yakuman: 1 });
  }
  if (allGreen) {
    yaku.push({ id: "ryuuiisou", name: "緑一色", han: 0, yakuman: 1 });
  }

  // --- 通常役(全体牌) ---
  // 断么九: 喰いタン無し → 門前のみ(スペック1 1.4)。
  if (!allYaochu && tiles.every((t) => !isYaochu(t)) && input.menzen) {
    yaku.push({ id: "tanyao", name: "断么九", han: 1, yakuman: 0 });
  }
  // 混老頭(全么九だが字一色/清老頭ではない混在形)。
  if (allYaochu && !allHonor && !allTerminal) {
    yaku.push({ id: "honroutou", name: "混老頭", han: 2, yakuman: 0 });
  }
  // 清一色 / 混一色(1数牌スート)。
  if (numberSuits.size === 1) {
    if (!honorsPresent) {
      yaku.push({
        id: "chinitsu",
        name: "清一色",
        han: input.menzen ? 6 : 5,
        yakuman: 0,
      });
    } else {
      yaku.push({
        id: "honitsu",
        name: "混一色",
        han: input.menzen ? 3 : 2,
        yakuman: 0,
      });
    }
  }

  return yaku;
}

// ---------------------------------------------------------------------------
// 標準形ベースの役
// ---------------------------------------------------------------------------

/** ロン和了牌が三つ子を完成させた場合、その暗刻は明刻扱い(三暗刻/四暗刻)。 */
function effectiveAnkouCount(form: StandardForm, input: YakuInput): number {
  let ankou = form.melds.filter((m) => isTripletLike(m) && m.concealed).length;
  if (input.winType === "ron") {
    const w = input.winningTile;
    const seqCoversWin = form.melds.some(
      (m) => m.kind === "sequence" && mentsuContainsKind(m, w),
    );
    const pairIsWin = sameKind(
      { suit: form.pair.suit, rank: form.pair.startRank },
      w,
    );
    if (!seqCoversWin && !pairIsWin) {
      // 和了牌は刻子を完成させた → 該当暗刻を1つ明刻に降格。
      const demotable = form.melds.some(
        (m) => isTripletLike(m) && m.concealed && mentsuContainsKind(m, w),
      );
      if (demotable && ankou > 0) ankou -= 1;
    }
  }
  return ankou;
}

function standardFormYaku(form: StandardForm, input: YakuInput): RawYaku[] {
  const yaku: RawYaku[] = [];
  const { melds, pair } = form;
  const allGroups = [...melds, pair];
  const sequences = melds.filter((m) => m.kind === "sequence");
  const triplets = melds.filter(isTripletLike);
  const quads = melds.filter((m) => m.kind === "quad");
  const w = input.winningTile;

  // --- 役牌(三元牌・場風・自風) ---
  for (const m of triplets) {
    if (m.suit !== "honor") continue;
    // 北(ガリ)は抜きドラ専用の字牌であり、手牌に残した刻子でも役牌1翻としない
    // (spec 3.0 #83-3「手牌に残した北刻子で役牌翻が発生しない」)。北は三元牌でない
    // ため現行の風割り当てでは元々役牌翻は付かないが、四人回し(北家=抜け番)で風の
    // 割り当てを誤って `roundWind`/`seatWind` に北(HONOR.NORTH)を渡した場合でも
    // 北刻子に役牌翻が付かないよう、ここで明示的に除外する(挙動非破壊のガード)。
    if (m.startRank === HONOR.NORTH) continue;
    const completedByAgari =
      m.concealed && w.suit === "honor" && w.rank === m.startRank;
    if (isDragon({ suit: "honor", rank: m.startRank })) {
      yaku.push({
        id: `yakuhai_dragon_${m.startRank}`,
        name: "役牌(三元牌)",
        han: 1,
        yakuman: 0,
        isYakuhai: true,
        agariCompleted: completedByAgari,
      });
    }
    if (input.roundWind !== undefined && m.startRank === input.roundWind) {
      yaku.push({
        id: "yakuhai_round_wind",
        name: "役牌(場風)",
        han: 1,
        yakuman: 0,
        isYakuhai: true,
        agariCompleted: completedByAgari,
      });
    }
    if (input.seatWind !== undefined && m.startRank === input.seatWind) {
      yaku.push({
        id: "yakuhai_seat_wind",
        name: "役牌(自風)",
        han: 1,
        yakuman: 0,
        isYakuhai: true,
        agariCompleted: completedByAgari,
      });
    }
  }

  // --- 役満(構成) ---
  const dragonTriplets = triplets.filter(
    (m) => m.suit === "honor" && isDragon({ suit: "honor", rank: m.startRank }),
  );
  const windTriplets = triplets.filter(
    (m) => m.suit === "honor" && isWind({ suit: "honor", rank: m.startRank }),
  );
  const pairIsDragon =
    pair.suit === "honor" && isDragon({ suit: "honor", rank: pair.startRank });
  const pairIsWind =
    pair.suit === "honor" && isWind({ suit: "honor", rank: pair.startRank });

  if (dragonTriplets.length === 3) {
    yaku.push({ id: "daisangen", name: "大三元", han: 0, yakuman: 1 });
  }
  if (windTriplets.length === 4) {
    yaku.push({ id: "daisuushii", name: "大四喜", han: 0, yakuman: 1 });
  }
  if (windTriplets.length === 3 && pairIsWind) {
    yaku.push({ id: "shousuushii", name: "小四喜", han: 0, yakuman: 1 });
  }
  const ankou = effectiveAnkouCount(form, input);
  if (ankou === 4) {
    yaku.push({ id: "suuankou", name: "四暗刻", han: 0, yakuman: 1 });
  }
  if (quads.length === 4) {
    yaku.push({ id: "suukantsu", name: "四槓子", han: 0, yakuman: 1 });
  }

  // --- 通常役(構成) ---
  // 平和
  if (
    input.menzen &&
    sequences.length === 4 &&
    !pairIsValue(pair, input) &&
    sequences.some((s) => s.suit === w.suit && ryanmenOk(s.startRank, w.rank))
  ) {
    yaku.push({ id: "pinfu", name: "平和", han: 1, yakuman: 0 });
  }

  // 一盃口 / 二盃口(門前のみ)
  if (input.menzen) {
    const seqKeyCount = new Map<string, number>();
    for (const s of sequences) {
      const key = `${s.suit}${s.startRank}`;
      seqKeyCount.set(key, (seqKeyCount.get(key) ?? 0) + 1);
    }
    let peikou = 0;
    for (const count of seqKeyCount.values()) peikou += Math.floor(count / 2);
    if (peikou >= 2) {
      yaku.push({ id: "ryanpeikou", name: "二盃口", han: 3, yakuman: 0 });
    } else if (peikou === 1) {
      yaku.push({ id: "iipeikou", name: "一盃口", han: 1, yakuman: 0 });
    }
  }

  // 三色同刻(man/pin/sou で同一 rank の刻子)
  for (let rank = 1; rank <= 9; rank++) {
    const suits = new Set(
      triplets
        .filter((m) => m.startRank === rank && m.suit !== "honor")
        .map((m) => m.suit),
    );
    if (suits.size === 3) {
      yaku.push({
        id: "sanshoku_doukou",
        name: "三色同刻",
        han: 2,
        yakuman: 0,
      });
      break;
    }
  }

  // 一気通貫(同一数牌スートで 123/456/789)
  for (const suit of ["man", "pin", "sou"] as const) {
    const starts = new Set(
      sequences.filter((s) => s.suit === suit).map((s) => s.startRank),
    );
    if (starts.has(1) && starts.has(4) && starts.has(7)) {
      yaku.push({
        id: "ittsuu",
        name: "一気通貫",
        han: input.menzen ? 2 : 1,
        yakuman: 0,
      });
      break;
    }
  }

  // 対々和
  if (triplets.length === 4) {
    yaku.push({ id: "toitoi", name: "対々和", han: 2, yakuman: 0 });
  }
  // 三暗刻
  if (ankou === 3) {
    yaku.push({ id: "sanankou", name: "三暗刻", han: 2, yakuman: 0 });
  }
  // 三槓子
  if (quads.length === 3) {
    yaku.push({ id: "sankantsu", name: "三槓子", han: 2, yakuman: 0 });
  }
  // 小三元
  if (dragonTriplets.length === 2 && pairIsDragon) {
    yaku.push({ id: "shousangen", name: "小三元", han: 2, yakuman: 0 });
  }

  // 混全帯么九 / 純全帯么九(全グループが么九を含み、順子が1つ以上)
  const everyGroupYaochu = allGroups.every(groupHasYaochu);
  const honorsPresent = input.allTiles.some((t) => isHonor(t));
  if (everyGroupYaochu && sequences.length >= 1) {
    if (honorsPresent) {
      yaku.push({
        id: "chanta",
        name: "混全帯么九",
        han: input.menzen ? 2 : 1,
        yakuman: 0,
      });
    } else {
      yaku.push({
        id: "junchan",
        name: "純全帯么九",
        han: input.menzen ? 3 : 2,
        yakuman: 0,
      });
    }
  }

  // 九蓮宝燈(門前・副露ゼロ・清一色・1112345678999+α)
  if (input.menzen && form.melds.every((m) => m.concealed)) {
    yaku.push(...chuurenIfApplicable(input));
  }

  return yaku;
}

/** 九蓮宝燈の判定(清一色の 1112345678999 + 1 枚パターン)。 */
function chuurenIfApplicable(input: YakuInput): RawYaku[] {
  const tiles = input.allTiles;
  if (tiles.length !== 14) return [];
  const suits = new Set(tiles.map((t) => t.suit));
  if (suits.size !== 1 || tiles.some((t) => isHonor(t))) return [];
  const counts = new Array<number>(10).fill(0);
  for (const t of tiles) counts[t.rank] += 1;
  if (counts[1] < 3 || counts[9] < 3) return [];
  for (let r = 2; r <= 8; r++) if (counts[r] < 1) return [];
  return [{ id: "chuuren", name: "九蓮宝燈", han: 0, yakuman: 1 }];
}

// ---------------------------------------------------------------------------
// 文脈役(リーチ・ツモ・海底 等)
// ---------------------------------------------------------------------------

function contextYaku(input: YakuInput): RawYaku[] {
  const yaku: RawYaku[] = [];
  if (input.blessing === "heaven") {
    return [{ id: "tenhou", name: "天和", han: 0, yakuman: 1 }];
  }
  if (input.blessing === "earth") {
    return [{ id: "chiihou", name: "地和", han: 0, yakuman: 1 }];
  }
  if (input.menzen) {
    if (input.doubleRiichi) {
      yaku.push({
        id: "double_riichi",
        name: "ダブル立直",
        han: 2,
        yakuman: 0,
      });
    } else if (input.riichi) {
      yaku.push({ id: "riichi", name: "立直", han: 1, yakuman: 0 });
    }
    if (input.ippatsu && (input.riichi || input.doubleRiichi)) {
      yaku.push({ id: "ippatsu", name: "一発", han: 1, yakuman: 0 });
    }
    if (input.winType === "tsumo") {
      yaku.push({
        id: "menzen_tsumo",
        name: "門前清自摸和",
        han: 1,
        yakuman: 0,
      });
    }
  }
  if (input.haitei) {
    yaku.push({
      id: "haitei",
      name: input.winType === "tsumo" ? "海底摸月" : "河底撈魚",
      han: 1,
      yakuman: 0,
    });
  }
  if (input.rinshan) {
    yaku.push({ id: "rinshan", name: "嶺上開花", han: 1, yakuman: 0 });
  }
  if (input.chankan) {
    yaku.push({ id: "chankan", name: "槍槓", han: 1, yakuman: 0 });
  }
  return yaku;
}

// ---------------------------------------------------------------------------
// 特殊形の役
// ---------------------------------------------------------------------------

function thirteenOrphansYaku(): Yaku[] {
  return [{ id: "kokushi", name: "国士無双", han: 0, yakuman: 1 }];
}

// ---------------------------------------------------------------------------
// 公開: 役判定(ナシナシ制約適用済み)
// ---------------------------------------------------------------------------

/**
 * 和了形に対する役を判定し、**ナシナシ制約適用後**の有効な役リストを返す。
 * 空配列 = 役なし(和了不可)。ドラは含まない(→ #66)。
 */
export function detectYaku(form: WinForm, input: YakuInput): Yaku[] {
  if (form.kind === "thirteenOrphans") {
    return thirteenOrphansYaku();
  }

  const raw: RawYaku[] = [...contextYaku(input), ...wholeHandYaku(input)];
  if (form.kind === "sevenPairs") {
    raw.push({ id: "chiitoitsu", name: "七対子", han: 2, yakuman: 0 });
  } else {
    raw.push(...standardFormYaku(form, input));
  }

  return applyNashiNashi(raw);
}

/**
 * ナシナシの後付け制約を適用する。
 * 「唯一の役が、和了牌で完成した役牌」だけの手は後付けとして無効(= 役なし)。
 * それ以外の役(門前ツモ・平和・対々和 等)が1つでもあれば有効。
 */
function applyNashiNashi(raw: readonly RawYaku[]): Yaku[] {
  const strip = (y: RawYaku): Yaku => ({
    id: y.id,
    name: y.name,
    han: y.han,
    yakuman: y.yakuman,
  });
  if (raw.length === 0) return [];

  const hasYakuman = raw.some((y) => y.yakuman > 0);
  if (hasYakuman) return raw.map(strip);

  const nonAtozuke = raw.filter((y) => !(y.isYakuhai && y.agariCompleted));
  if (nonAtozuke.length === 0) return []; // 後付け → 和了不可
  return raw.map(strip);
}
