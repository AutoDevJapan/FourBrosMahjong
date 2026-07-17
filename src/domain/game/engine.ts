/**
 * 対局オーケストレーション層 = 半荘の状態機械(issue #67 / スペック2 2.1・2.6・2.8)。
 *
 * 既存ドメインモジュール(tiles/wall/deal/dora/hand/round/scoring)を**結線**して、
 * 新規半荘 → 局開始(配牌・ドラめくり)→ 進行(自家のツモ/打牌・他家は簡易)→ 和了/流局 →
 * 点数・ソシー精算 → 席回転 → オーラス/トビ終了 → 結果、の一連を駆動する純ロジック。
 *
 * React/DOM 非依存。UI 表示型(`src/components/game/types.ts`)には依存せず、UI への写像は
 * UI 層(`src/components/game/gameView.ts`)が本モジュールの公開状態を読んで行う(責務分離)。
 *
 * ## 割り切り(MVP / フォローアップ issue 化)
 * - 他家(AI)は**ツモ切り**(引いた牌をそのまま捨てる)。ツモ/ロンは和了形が成立すれば自動宣言。
 * - **リーチ・ポン・カン・チー は未対応**(→ 裏ドラ・一発なし)。北抜き(ガリ)は**自動**で処理する。
 * - 自家が抜け番の局は AI のみで自動進行し、局結果までまとめて確定する。
 * - パオ(責任払い)は未割当。役満祝儀の支払者は「同卓の敗者2人」を既定とする(issue #89 の #67 確定)。
 * - `SAFETY_ROUND_CAP` で局数に上限を設け、南4連荘の理論的無限ループを防ぐ(通常は発火しない)。
 *
 * 決定性: `createGame({ seed })` で `createSeededRng` を用いるため、同じ seed + 同じ操作列から
 * 完全に同じ進行が再現できる(ユニットテストの土台)。
 */

import { dealStartingHands } from "@/domain/deal/deal";
import type { DiceRoll } from "@/domain/dora/dice";
import { type DoraSet, createDoraSet } from "@/domain/dora/doraSet";
import { countDoraHan } from "@/domain/dora/han";
import { canRon } from "@/domain/hand/furiten";
import { isTenpai } from "@/domain/hand/tenpai";
import { type WinAnalysis, analyzeWin } from "@/domain/hand/win";
import { type Rng, createSeededRng } from "@/domain/random/rng";
import {
  advanceRound,
  createInitialRound,
  dealerOf,
  isOorasu,
  type RoundOutcome,
  type RoundState,
  seatingOf,
} from "@/domain/round/round";
import type { PlayerRing, Seating } from "@/domain/round/seat";
import { computeScore, handValueFromHan } from "@/domain/scoring/points";
import {
  RETURN_POINTS,
  SoshiiLedger,
  STARTING_POINTS,
} from "@/domain/scoring/settlement";
import {
  type SeatedPlayerRef,
  resolveWinPayment,
} from "@/domain/scoring/win-payment";
import { HONOR, type Tile } from "@/domain/tiles/tile";
import { type Wall, WallEmptyError, buildWall } from "@/domain/wall/wall";

/** プレイヤー識別子(4兄弟)。`p0` は常に自家(人間)。 */
export type PlayerId = "p0" | "p1" | "p2" | "p3";

/** 自家(人間プレイヤー)のID。 */
export const HUMAN_ID: PlayerId = "p0";

/** 着席する席(親=東)。抜け番は席を持たない。 */
export type SeatKey = "east" | "south" | "west";

/** 着席席の巡目順(東→南→西→東)。 */
const NEXT_SEAT: Record<SeatKey, SeatKey> = {
  east: "south",
  south: "west",
  west: "east",
};

/** 席風の番号(役判定の照合用: 東1・南2・西3 = `HONOR` 準拠)。 */
const SEAT_WIND_NUMBER: Record<SeatKey, number> = {
  east: HONOR.EAST,
  south: HONOR.SOUTH,
  west: HONOR.WEST,
};

/** 局数の安全上限(南4連荘での理論的無限ループ防止)。通常は発火しない。 */
const SAFETY_ROUND_CAP = 32;

/** 流局時テンパイ料の総額(標準の3,000点プールをサンマ3人へ配分)。 */
const NOTEN_POOL = 3000;

/** プレイヤー情報(不変)。 */
interface EnginePlayer {
  readonly id: PlayerId;
  readonly name: string;
}

/** 1局(進行中)の状態。`Wall` を含むため内部は可変に扱う。 */
interface HandState {
  readonly wall: Wall;
  readonly dice: DiceRoll;
  readonly doraSet: DoraSet;
  readonly seating: Seating<PlayerId>;
  /** 席ごとの門前手牌(13枚。副露は未対応のため常に門前)。 */
  hands: Record<SeatKey, Tile[]>;
  /** 席ごとの河(捨て牌)。 */
  discards: Record<SeatKey, Tile[]>;
  /** 席ごとの北抜き枚数(ガリ)。 */
  kita: Record<SeatKey, number>;
  /** 現在の手番の席。 */
  turn: SeatKey;
  /** 現在の手番がツモった牌(打牌待ち)。未ツモは null。 */
  drawn: Tile | null;
  /** 直前の打牌(ロン判定の対象)。解決後に null。 */
  pendingDiscard: { seat: SeatKey; tile: Tile } | null;
  /** 直前の打牌に対しロンを見送った席(頭ハネ解決の再入で参照)。 */
  passedRonSeats: SeatKey[];
}

/** 半荘終了時の1プレイヤー分の確定精算(ソシー内訳)。 */
interface SettlementResult {
  readonly playerId: PlayerId;
  readonly name: string;
  /** 最終順位(1〜)。 */
  readonly rank: number;
  /** ① 素点(= 最終持ち点 − 返し40,000、1点=1ソシー)。 */
  readonly rawScore: number;
  /** ② 順位ウマ + オカ。 */
  readonly uma: number;
  /** ③ 役満祝儀。 */
  readonly bonus: number;
  /** ソシー合計(= rawScore + uma + bonus)。 */
  readonly soshiiTotal: number;
}

/** 直前の局の決着サマリ(UI 表示・アナウンス用)。 */
export interface RoundSummary {
  readonly kind: "win" | "draw";
  /** 表示ラベル(例: `"あなたのツモ 3900点"` / `"流局(テンパイ2人)"`)。 */
  readonly label: string;
  /** この局の持ち点増減。 */
  readonly deltas: Record<PlayerId, number>;
  readonly winnerId?: PlayerId;
}

/** 期待する入力(自家の意思決定点)。playing 中のみ非 null。 */
export type Pending =
  | { readonly kind: "humanDiscard"; readonly canTsumo: boolean }
  | { readonly kind: "humanRon"; readonly tile: Tile; readonly from: SeatKey }
  | null;

/** 半荘のフェーズ。 */
export type GamePhase = "playing" | "roundEnd" | "gameEnd";

/** 半荘全体の状態(不変値として React state に載せる。内部の `Wall` のみ可変)。 */
export interface EngineState {
  readonly players: readonly EnginePlayer[];
  readonly order: PlayerRing<PlayerId>;
  readonly round: RoundState<PlayerId>;
  /** 各プレイヤーの持ち点(素点)。半荘開始時 35,000。 */
  readonly points: Record<PlayerId, number>;
  /** 各プレイヤーの役満祝儀累計(ソシー)。 */
  readonly bonus: Record<PlayerId, number>;
  /** ソシー精算台帳(祝儀は局中、素点+ウマは半荘終了時に適用)。 */
  readonly ledger: SoshiiLedger;
  /** 供託リーチ棒(MVP ではリーチ未対応のため常に0)。 */
  readonly riichiSticks: number;
  readonly rng: Rng;
  readonly hand: HandState | null;
  readonly phase: GamePhase;
  readonly pending: Pending;
  /** 直前局のサマリ(未決着時は null)。 */
  readonly lastRound: RoundSummary | null;
  /** roundEnd 時に保持する次局遷移(null = この局で半荘終了)。 */
  readonly nextRoundState: RoundState<PlayerId> | null;
  /** 半荘終了時の確定精算(それ以外は null)。 */
  readonly result: readonly SettlementResult[] | null;
  /** 進行した局数(安全上限判定用)。 */
  readonly roundsPlayed: number;
}

/** `createGame` のオプション。 */
export interface CreateGameOptions {
  /** 乱数 seed(既定は現在時刻)。テストでは固定値を渡す。 */
  readonly seed?: number;
  /** 4兄弟の表示名(index 0 = 自家)。 */
  readonly names?: readonly [string, string, string, string];
}

const DEFAULT_NAMES: readonly [string, string, string, string] = [
  "あなた",
  "一郎",
  "二郎",
  "三郎",
];

const ALL_IDS: PlayerRing<PlayerId> = ["p0", "p1", "p2", "p3"];

// ---------------------------------------------------------------------------
// 純ヘルパ
// ---------------------------------------------------------------------------

/** 席 → その席に座るプレイヤーID。 */
function seatOccupant(seating: Seating<PlayerId>, seat: SeatKey): PlayerId {
  return seating[seat];
}

/** プレイヤーID → その局での席(着席していなければ null = 抜け番)。 */
export function seatOfPlayer(
  seating: Seating<PlayerId>,
  id: PlayerId,
): SeatKey | null {
  if (seating.east === id) return "east";
  if (seating.south === id) return "south";
  if (seating.west === id) return "west";
  return null;
}

/** 場風の番号(東場=東1・南場=南2)。 */
function roundWindNumber(state: RoundState<PlayerId>): number {
  return state.wind === "east" ? HONOR.EAST : HONOR.SOUTH;
}

/** サイコロ2個を振る。 */
function rollDice(rng: Rng): DiceRoll {
  const die = (): number => 1 + Math.floor(rng.next() * 6);
  return [die(), die()] as unknown as DiceRoll;
}

/** 名前解決。 */
function nameOf(state: EngineState, id: PlayerId): string {
  return state.players.find((p) => p.id === id)?.name ?? id;
}

/** ロン判定順(頭ハネ=上家取り): 放銃者の次席から巡目順に2席。 */
function ronOrder(discarder: SeatKey): [SeatKey, SeatKey] {
  const first = NEXT_SEAT[discarder];
  return [first, NEXT_SEAT[first]];
}

// ---------------------------------------------------------------------------
// 局の生成・進行
// ---------------------------------------------------------------------------

/** 新規半荘を生成し、最初の局を開始した状態を返す。 */
export function createGame(options: CreateGameOptions = {}): EngineState {
  const seed = options.seed ?? Date.now();
  const names = options.names ?? DEFAULT_NAMES;
  const players: EnginePlayer[] = ALL_IDS.map((id, i) => ({
    id,
    name: names[i],
  }));
  // 起家(初局の親)は自家 p0。以後は北家抜けの回転(round モジュール)に従う。
  const round = createInitialRound<PlayerId>({
    dealer: "p0",
    south: "p1",
    west: "p2",
    benchWarmer: "p3",
  });
  const points = Object.fromEntries(
    ALL_IDS.map((id) => [id, STARTING_POINTS]),
  ) as Record<PlayerId, number>;
  const bonus = Object.fromEntries(ALL_IDS.map((id) => [id, 0])) as Record<
    PlayerId,
    number
  >;
  const base: EngineState = {
    players,
    order: ALL_IDS,
    round,
    points,
    bonus,
    ledger: new SoshiiLedger([...ALL_IDS]),
    riichiSticks: 0,
    rng: createSeededRng(seed),
    hand: null,
    phase: "playing",
    pending: null,
    lastRound: null,
    nextRoundState: null,
    result: null,
    roundsPlayed: 0,
  };
  return beginRound(base);
}

/** 現局の席割り・配牌・ドラを用意し、進行を人間の意思決定点まで進める。 */
function beginRound(state: EngineState): EngineState {
  const dice = rollDice(state.rng);
  const wall = buildWall(state.rng);
  const dealt = dealStartingHands(wall); // [east, south, west]
  const doraSet = createDoraSet(wall.deadWall, dice);
  const seating = seatingOf(state.round);
  const hand: HandState = {
    wall,
    dice,
    doraSet,
    seating,
    hands: { east: dealt[0], south: dealt[1], west: dealt[2] },
    discards: { east: [], south: [], west: [] },
    kita: { east: 0, south: 0, west: 0 },
    turn: "east",
    drawn: null,
    pendingDiscard: null,
    passedRonSeats: [],
  };
  const next: EngineState = {
    ...state,
    hand,
    phase: "playing",
    pending: null,
  };
  return pump(next);
}

/** 北抜き(ガリ)を自動処理し、最終的に手番が持つツモ牌を返す。 */
function autoPullNorth(hand: HandState, seat: SeatKey, tile: Tile): Tile {
  let current = tile;
  // 北(字牌 rank=4)を引く限り抜いて嶺上補充する。王牌が尽きたら打ち切る。
  while (current.suit === "honor" && current.rank === HONOR.NORTH) {
    hand.kita[seat] += 1;
    try {
      current = hand.wall.drawReplacement();
    } catch (error) {
      if (error instanceof WallEmptyError) {
        // 嶺上が尽きた極端ケース: 北をそのまま手に残す(実運用では非到達)。
        return current;
      }
      throw error;
    }
  }
  return current;
}

/**
 * 進行を人間の意思決定点(自家の打牌 / 自家のロン)まで、または局・半荘の終了まで進める。
 * AI 手番は自動で処理する。
 */
function pump(state: EngineState): EngineState {
  let s = state;
  for (let guard = 0; guard < 100000; guard++) {
    if (s.phase !== "playing" || s.hand === null) return s;
    const hand = s.hand;
    const seat = hand.turn;
    const isHuman = seatOccupant(hand.seating, seat) === HUMAN_ID;

    // 1. ツモ(未ツモなら山から引く)。山が尽きていれば流局。
    if (hand.drawn === null) {
      if (hand.wall.remainingLiveTiles === 0) {
        return settleDraw(s);
      }
      const raw = hand.wall.draw();
      hand.drawn = autoPullNorth(hand, seat, raw);
    }

    const haitei = hand.wall.remainingLiveTiles === 0;

    if (isHuman) {
      const tsumo = analyzeTsumo(s, seat, hand.drawn, haitei);
      return {
        ...s,
        pending: { kind: "humanDiscard", canTsumo: tsumo !== null },
      };
    }

    // AI: ツモ和了できるなら宣言。
    const aiTsumo = analyzeTsumo(s, seat, hand.drawn, haitei);
    if (aiTsumo !== null) {
      return settleWin(s, {
        winnerSeat: seat,
        winType: "tsumo",
        winningTile: hand.drawn,
        analysis: aiTsumo,
        haitei,
      });
    }

    // AI: ツモ切り。
    s = applyDiscard(s, seat, hand.drawn);
    if (s.phase !== "playing" || s.pending !== null) return s;
  }
  return s;
}

/**
 * 打牌を反映し、ロン判定 → 手番送りまでを解決する。
 * ロン(自家)が発生する場合は `pending` を立てて停止する。
 */
function applyDiscard(
  state: EngineState,
  seat: SeatKey,
  tile: Tile,
): EngineState {
  const hand = state.hand;
  if (hand === null) return state;
  // 14枚(手牌13 + ツモ)から捨て牌1枚を取り除く。
  const pool = [...hand.hands[seat], hand.drawn].filter(
    (t): t is Tile => t !== null,
  );
  const removeAt = pool.findIndex(
    (t) =>
      t.suit === tile.suit && t.rank === tile.rank && t.isRed === tile.isRed,
  );
  const idx = removeAt >= 0 ? removeAt : pool.length - 1;
  const discarded = pool[idx];
  pool.splice(idx, 1);
  hand.hands[seat] = pool;
  hand.discards[seat] = [...hand.discards[seat], discarded];
  hand.drawn = null;
  hand.pendingDiscard = { seat, tile: discarded };
  hand.passedRonSeats = [];
  return resolveDiscard(state);
}

/** 直前の打牌に対するロン(頭ハネ順)を解決。未決着なら手番を送る。 */
function resolveDiscard(state: EngineState): EngineState {
  const hand = state.hand;
  if (hand === null || hand.pendingDiscard === null) return state;
  const { seat: discarder, tile } = hand.pendingDiscard;
  const haitei = hand.wall.remainingLiveTiles === 0;

  for (const candidate of ronOrder(discarder)) {
    if (hand.passedRonSeats.includes(candidate)) continue;
    const analysis = analyzeRon(state, candidate, tile, haitei);
    if (analysis === null) continue;
    if (seatOccupant(hand.seating, candidate) === HUMAN_ID) {
      // 自家のロン機会 → 入力待ちで停止。
      return { ...state, pending: { kind: "humanRon", tile, from: discarder } };
    }
    // AI ロン(頭ハネで最先の1人のみ)。
    return settleWin(state, {
      winnerSeat: candidate,
      winType: "ron",
      winningTile: tile,
      analysis,
      discarderSeat: discarder,
      haitei,
    });
  }

  // ロンなし → 手番送り。
  hand.pendingDiscard = null;
  hand.passedRonSeats = [];
  hand.turn = NEXT_SEAT[discarder];
  return state;
}

// ---------------------------------------------------------------------------
// 和了判定(結線)
// ---------------------------------------------------------------------------

/** ツモ和了の役判定(役なしは null)。 */
function analyzeTsumo(
  state: EngineState,
  seat: SeatKey,
  winningTile: Tile,
  haitei: boolean,
): WinAnalysis | null {
  const hand = state.hand;
  if (hand === null) return null;
  return analyzeWin({
    concealedTiles: [...hand.hands[seat], winningTile],
    winningTile,
    winType: "tsumo",
    seatWind: SEAT_WIND_NUMBER[seat],
    roundWind: roundWindNumber(state.round),
    haitei,
  });
}

/** ロン和了の役判定(フリテン不可・役なしは null)。 */
function analyzeRon(
  state: EngineState,
  seat: SeatKey,
  winningTile: Tile,
  houtei: boolean,
): WinAnalysis | null {
  const hand = state.hand;
  if (hand === null) return null;
  // フリテン(捨て牌)ではロン不可。ツモのみ可(furiten モジュール)。
  const allowed = canRon(
    { concealedTiles: hand.hands[seat], ownDiscards: hand.discards[seat] },
    winningTile,
  );
  if (!allowed) return null;
  return analyzeWin({
    concealedTiles: [...hand.hands[seat], winningTile],
    winningTile,
    winType: "ron",
    seatWind: SEAT_WIND_NUMBER[seat],
    roundWind: roundWindNumber(state.round),
    haitei: houtei,
  });
}

// ---------------------------------------------------------------------------
// 精算(和了 / 流局)→ 局終了
// ---------------------------------------------------------------------------

interface WinInput {
  readonly winnerSeat: SeatKey;
  readonly winType: "tsumo" | "ron";
  readonly winningTile: Tile;
  readonly analysis: WinAnalysis;
  readonly discarderSeat?: SeatKey;
  readonly haitei: boolean;
}

/** 和了を精算し局を終える。 */
function settleWin(state: EngineState, win: WinInput): EngineState {
  const hand = state.hand;
  if (hand === null) return state;
  const { winnerSeat, winType, winningTile, analysis } = win;
  const winnerId = seatOccupant(hand.seating, winnerSeat);
  const isDealerWin = winnerSeat === "east";

  // ドラ翻(表・赤・ガリ。裏はリーチ未対応のため0)。
  const winningTiles = [...hand.hands[winnerSeat], winningTile];
  const doraBreak = countDoraHan({
    hand: winningTiles,
    doraSet: hand.doraSet,
    riichi: false,
    kitaCount: hand.kita[winnerSeat],
  });

  const value = handValueFromHan(
    analysis.han,
    doraBreak.total,
    analysis.yakuman,
  );
  const score = computeScore(value, isDealerWin);

  const others: SeatedPlayerRef[] = (["east", "south", "west"] as SeatKey[])
    .filter((seat) => seat !== winnerSeat)
    .map((seat) => ({
      id: seatOccupant(hand.seating, seat),
      isDealer: seat === "east",
    }));

  const discarderId =
    win.discarderSeat !== undefined
      ? seatOccupant(hand.seating, win.discarderSeat)
      : undefined;

  const payment = resolveWinPayment({
    winner: { id: winnerId, isDealer: isDealerWin },
    winType,
    score,
    discarderId,
    others,
    honba: state.round.honba,
    riichiSticks: state.riichiSticks,
  });

  const points: Record<PlayerId, number> = { ...state.points };
  for (const [id, delta] of Object.entries(payment.deltas)) {
    points[id as PlayerId] += delta;
  }
  points[winnerId] += payment.stickPayout;

  // 役満祝儀(同卓の敗者2人から各1,000ソシー・先着1名・数え役満対象外)。
  // 支払者の範囲(同卓2人 or 抜け番含む3人)は #89 論点② / Q14 で未確定。
  // ここでは暫定で同卓の敗者2人(others)を採用する(spec 3.3③ 参照・確定後に差し替え)。
  const bonus: Record<PlayerId, number> = { ...state.bonus };
  if (score.isTrueYakuman && !score.isCountedYakuman) {
    const loserIds = others.map((o) => o.id as PlayerId);
    const awarded = state.ledger.applyBonus({
      winnerId,
      loserIds,
      score,
    });
    if (awarded) {
      for (const id of loserIds) bonus[id] -= 1000;
      bonus[winnerId] += 1000 * loserIds.length;
    }
  }

  const winnerReceipt =
    winType === "tsumo" ? score.tsumo.total : score.ronTotal;
  const label = `${nameOf(state, winnerId)}の${
    winType === "tsumo" ? "ツモ" : "ロン"
  } ${winnerReceipt.toLocaleString("ja-JP")}点`;

  const deltas = diffPoints(state.points, points);
  const outcome: RoundOutcome = isDealerWin
    ? "dealerContinues"
    : "dealerPasses";

  return finishRound(
    { ...state, points, bonus },
    {
      outcome,
      isDraw: false,
      summary: { kind: "win", label, deltas, winnerId },
    },
  );
}

/** 流局(海底)を精算し局を終える。テンパイ料を配分する。 */
function settleDraw(state: EngineState): EngineState {
  const hand = state.hand;
  if (hand === null) return state;
  const seats: SeatKey[] = ["east", "south", "west"];
  const tenpaiSeats = seats.filter((seat) => isTenpai(hand.hands[seat]));
  const notenSeats = seats.filter((seat) => !tenpaiSeats.includes(seat));

  const points: Record<PlayerId, number> = { ...state.points };
  if (tenpaiSeats.length > 0 && notenSeats.length > 0) {
    const receivePer = NOTEN_POOL / tenpaiSeats.length;
    const payPer = NOTEN_POOL / notenSeats.length;
    for (const seat of tenpaiSeats) {
      points[seatOccupant(hand.seating, seat)] += receivePer;
    }
    for (const seat of notenSeats) {
      points[seatOccupant(hand.seating, seat)] -= payPer;
    }
  }

  // 親テンパイなら連荘、さもなくば親流れ。流局は本場+1(finishRound で処理)。
  const dealerTenpai = tenpaiSeats.includes("east");
  const outcome: RoundOutcome = dealerTenpai
    ? "dealerContinues"
    : "dealerPasses";
  const label = `流局(テンパイ${tenpaiSeats.length}人)`;
  const deltas = diffPoints(state.points, points);

  return finishRound(
    { ...state, points },
    { outcome, isDraw: true, summary: { kind: "draw", label, deltas } },
  );
}

/** 持ち点の増減マップを作る。 */
function diffPoints(
  before: Record<PlayerId, number>,
  after: Record<PlayerId, number>,
): Record<PlayerId, number> {
  const out = {} as Record<PlayerId, number>;
  for (const id of ALL_IDS) out[id] = after[id] - before[id];
  return out;
}

interface RoundConclusion {
  readonly outcome: RoundOutcome;
  readonly isDraw: boolean;
  readonly summary: RoundSummary;
}

/**
 * 局を締め、終了条件を評価する。半荘継続なら次局遷移を保持し `roundEnd` に、
 * 終了なら `gameEnd`(結果確定)へ。
 */
function finishRound(
  state: EngineState,
  conclusion: RoundConclusion,
): EngineState {
  const { outcome, isDraw, summary } = conclusion;
  const round = state.round;
  const oorasu = isOorasu(round);
  const tobi = ALL_IDS.some((id) => state.points[id] < 0);
  const dealerId = dealerOf(round);
  const dealerPoints = state.points[dealerId];
  const maxPoints = Math.max(...ALL_IDS.map((id) => state.points[id]));
  const dealerIsTop = dealerPoints === maxPoints;

  let gameEnds = false;
  if (tobi) {
    gameEnds = true; // トビ(任意の局で即終了)
  } else if (state.roundsPlayed + 1 >= SAFETY_ROUND_CAP) {
    gameEnds = true; // 安全上限
  } else if (oorasu) {
    if (outcome === "dealerPasses") {
      gameEnds = true; // 南4完了(親流れ = これ以上の局なし)
    } else if (dealerPoints > 30000 && dealerIsTop) {
      gameEnds = true; // 南4 親3万超トップ → 親トップやめ
    }
  }

  // 次局の状態(半荘継続時のみ)。流局は本場+1、親流れ流局は honba を引き継ぎ +1。
  let nextRoundState: RoundState<PlayerId> | null = null;
  if (!gameEnds) {
    const advanced = advanceRound(round, outcome);
    nextRoundState =
      isDraw && outcome === "dealerPasses"
        ? { ...advanced, honba: round.honba + 1 }
        : advanced;
  }

  const base: EngineState = {
    ...state,
    lastRound: summary,
    nextRoundState,
    phase: "roundEnd",
    pending: null,
  };

  return gameEnds ? endGame(base) : base;
}

/** 半荘を締め、ソシー精算(素点+ウマ+オカ+祝儀)を確定する。 */
function endGame(state: EngineState): EngineState {
  const finalPoints = ALL_IDS.map((id) => ({
    playerId: id,
    points: state.points[id],
  }));
  const umaBreak = state.ledger.applyUma(finalPoints);
  state.ledger.applyRawScore(finalPoints);
  const ranking = state.ledger.ranking(); // ソシー降順のID列

  const result: SettlementResult[] = ALL_IDS.map((id) => {
    const uma = umaBreak.find((u) => u.playerId === id);
    const umaTotal = (uma?.uma ?? 0) + (uma?.oka ?? 0);
    return {
      playerId: id,
      name: nameOf(state, id),
      rank: ranking.indexOf(id) + 1,
      rawScore: state.points[id] - RETURN_POINTS,
      uma: umaTotal,
      bonus: state.bonus[id],
      soshiiTotal: state.ledger.balanceOf(id),
    };
  });

  return { ...state, phase: "gameEnd", pending: null, result };
}

// ---------------------------------------------------------------------------
// 公開アクション(UI から呼ぶ操作)
// ---------------------------------------------------------------------------

/** 自家の打牌。`tile` は表示手牌から選ばれた牌。 */
export function discard(state: EngineState, tile: Tile): EngineState {
  if (
    state.phase !== "playing" ||
    state.pending?.kind !== "humanDiscard" ||
    state.hand === null
  ) {
    return state;
  }
  const seat = seatOfPlayer(state.hand.seating, HUMAN_ID);
  if (seat === null || state.hand.turn !== seat) return state;
  const after = applyDiscard({ ...state, pending: null }, seat, tile);
  return pump(after);
}

/** 自家のツモ和了宣言。 */
export function declareTsumo(state: EngineState): EngineState {
  if (
    state.phase !== "playing" ||
    state.pending?.kind !== "humanDiscard" ||
    !state.pending.canTsumo ||
    state.hand === null ||
    state.hand.drawn === null
  ) {
    return state;
  }
  const seat = seatOfPlayer(state.hand.seating, HUMAN_ID);
  if (seat === null) return state;
  const haitei = state.hand.wall.remainingLiveTiles === 0;
  const analysis = analyzeTsumo(state, seat, state.hand.drawn, haitei);
  if (analysis === null) return state;
  return settleWin(
    { ...state, pending: null },
    {
      winnerSeat: seat,
      winType: "tsumo",
      winningTile: state.hand.drawn,
      analysis,
      haitei,
    },
  );
}

/** 自家のロン和了宣言。 */
export function declareRon(state: EngineState): EngineState {
  if (
    state.phase !== "playing" ||
    state.pending?.kind !== "humanRon" ||
    state.hand === null
  ) {
    return state;
  }
  const { tile, from } = state.pending;
  const seat = seatOfPlayer(state.hand.seating, HUMAN_ID);
  if (seat === null) return state;
  const haitei = state.hand.wall.remainingLiveTiles === 0;
  const analysis = analyzeRon(state, seat, tile, haitei);
  if (analysis === null) return state;
  return settleWin(
    { ...state, pending: null },
    {
      winnerSeat: seat,
      winType: "ron",
      winningTile: tile,
      analysis,
      discarderSeat: from,
      haitei,
    },
  );
}

/** 自家のロン見送り(スルー)。頭ハネの残り候補を解決して進行を続ける。 */
export function passRon(state: EngineState): EngineState {
  if (
    state.phase !== "playing" ||
    state.pending?.kind !== "humanRon" ||
    state.hand === null
  ) {
    return state;
  }
  const seat = seatOfPlayer(state.hand.seating, HUMAN_ID);
  if (seat === null) return state;
  state.hand.passedRonSeats = [...state.hand.passedRonSeats, seat];
  const after = resolveDiscard({ ...state, pending: null });
  return pump(after);
}

/** 局終了後、次局を開始する(半荘終了時は何もしない)。 */
export function proceedToNextRound(state: EngineState): EngineState {
  if (state.phase !== "roundEnd") return state;
  if (state.nextRoundState === null) return state; // 終了済み(通常 gameEnd 済み)
  const next: EngineState = {
    ...state,
    round: state.nextRoundState,
    nextRoundState: null,
    roundsPlayed: state.roundsPlayed + 1,
    hand: null,
    phase: "playing",
    pending: null,
  };
  return beginRound(next);
}
