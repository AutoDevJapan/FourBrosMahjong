/**
 * 対局オーケストレーション層 = 半荘の状態機械(issue #67 / #97 / スペック2 2.1・2.4・2.6・2.8)。
 *
 * 既存ドメインモジュール(tiles/wall/deal/dora/hand/round/scoring)を**結線**して、
 * 新規半荘 → 局開始(配牌・ドラめくり)→ 進行(自家のツモ/打牌・鳴き・リーチ・他家は簡易)→
 * 和了/流局 → 点数・ソシー精算 → 席回転 → オーラス/トビ終了 → 結果、の一連を駆動する純ロジック。
 *
 * React/DOM 非依存。UI 表示型(`src/components/game/types.ts`)には依存せず、UI への写像は
 * UI 層(`src/components/game/gameView.ts`)が本モジュールの公開状態を読んで行う(責務分離)。
 *
 * ## 対応済み(#97)
 * - **リーチ**: 門前テンパイで宣言(1,000点供託)、リーチ後は自動ツモ切り、フリテンリーチはツモのみ、
 *   **裏ドラ**開示(リーチ和了時)、**一発**(リーチ後1巡以内・鳴きを挟むと消滅)、ダブルリーチ。
 * - **鳴き(自家のみ)**: ポン・明槓(他家打牌)・暗槓・加槓(自家ツモ番)。嶺上ツモ・鳴き喰い下がりは
 *   既存 hand が対応。鳴きは一発を消滅させる。
 *
 * ## 割り切り(MVP / フォローアップ issue 化)
 * - 他家(AI)は**ツモ切り**。ツモ/ロンは和了形が成立すれば自動宣言するが、**リーチ・鳴きはしない**(→ #98)。
 * - 加槓に対する槍槓(チャンカン)は未対応(AI は槍槓しない)。リーチ後の暗槓も不可(→ issue)。
 * - 北抜き(ガリ)は**自動**で処理する(手動選択は未対応)。
 * - パオ(責任払い)は**自家の鳴きで確定した大三元/大四喜/四槓子**に対応(#99)。ポン/大明槓で
 *   パオ役満が確定した瞬間に責任者(打牌者)を記録し、和了時 `resolveWinPayment` で責任払い
 *   (ロン折半・ツモ全額・本場)を行う(判定は `scoring/pao.ts`)。役満祝儀は別枠で、支払者は
 *   「同卓の敗者2人」を既定とする(issue #89 の #67 確定)。
 * - `SAFETY_ROUND_CAP` で局数に上限を設け、南4連荘の理論的無限ループを防ぐ(通常は発火しない)。
 *
 * 決定性: `createGame({ seed })` で `createSeededRng` を用いるため、同じ seed + 同じ操作列から
 * 完全に同じ進行が再現できる(ユニットテストの土台)。
 */

import { dealStartingHands } from "@/domain/deal/deal";
import type { DiceRoll } from "@/domain/dora/dice";
import { type DoraSet, createDoraSet } from "@/domain/dora/doraSet";
import { countDoraHan } from "@/domain/dora/han";
import type { MeldInput } from "@/domain/hand/decompose";
import { canRon } from "@/domain/hand/furiten";
import { type Meld, isConcealedHand } from "@/domain/hand/meld";
import { isTenpai } from "@/domain/hand/tenpai";
import { sameKind } from "@/domain/hand/tile-identity";
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
import { isPaoTriggeringCall } from "@/domain/scoring/pao";
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

/** リーチ棒1本の供託点。 */
const RIICHI_STICK_POINTS = 1000;

/** 着席する席(親=東)。抜け番は席を持たない。 */
export type SeatKey = "east" | "south" | "west";

const SEATS: readonly SeatKey[] = ["east", "south", "west"];

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

/** 席ごとの真偽フラグ。 */
type SeatFlags = Record<SeatKey, boolean>;

function seatFlags(value = false): SeatFlags {
  return { east: value, south: value, west: value };
}

/** 1局(進行中)の状態。`Wall` を含むため内部は可変に扱う。 */
interface HandState {
  readonly wall: Wall;
  readonly dice: DiceRoll;
  readonly doraSet: DoraSet;
  readonly seating: Seating<PlayerId>;
  /** 席ごとの門前手牌(副露を除く)。 */
  hands: Record<SeatKey, Tile[]>;
  /** 席ごとの副露(ポン・カン)。 */
  melds: Record<SeatKey, Meld[]>;
  /** 席ごとの河(捨て牌)。 */
  discards: Record<SeatKey, Tile[]>;
  /** 席ごとの北抜き枚数(ガリ)。 */
  kita: Record<SeatKey, number>;
  /** 現在の手番の席。 */
  turn: SeatKey;
  /** 現在の手番がツモった牌(打牌待ち)。未ツモは null。 */
  drawn: Tile | null;
  /** 現在の `drawn` が嶺上牌(カン)由来か(嶺上開花判定)。 */
  fromKan: boolean;
  /** 席ごとのリーチ宣言済みフラグ。 */
  riichi: SeatFlags;
  /** 席ごとのダブルリーチ(初巡・鳴きなしでのリーチ)。 */
  doubleRiichi: SeatFlags;
  /** 席ごとの一発の権利(リーチ後1巡以内・鳴きなし)。 */
  ippatsu: SeatFlags;
  /** 席ごとのリーチ後見逃しフリテン(そのリーチ中は恒久)。 */
  riichiMiss: SeatFlags;
  /** 席ごとの同巡内フリテン(次の自ツモまで一時)。 */
  tempMiss: SeatFlags;
  /** この局で鳴き(ポン/カン)が発生したか(ダブルリーチ判定用)。 */
  callsMade: boolean;
  /**
   * パオ責任者(スペック3 3.3 / #99)。パオ役満(大三元/大四喜/四槓子)を
   * **鳴き(ポン/大明槓)で確定させた席 → その確定牌を打った責任者ID**。
   * その席が和了したとき `settleWin` が責任払いへ渡す。
   */
  paoResponsible: Partial<Record<SeatKey, PlayerId>>;
  /** 直前の打牌(ロン/鳴き判定の対象)。解決後に null。 */
  pendingDiscard: { seat: SeatKey; tile: Tile } | null;
  /** 直前の打牌に対しロン/鳴きを見送った席(頭ハネ解決の再入で参照)。 */
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
  /** リーチ和了か(裏ドラ開示の判定に使う)。 */
  readonly riichiWin?: boolean;
}

/** 期待する入力(自家の意思決定点)。playing 中のみ非 null。 */
export type Pending =
  | {
      readonly kind: "humanDiscard";
      /** ツモ和了できるか。 */
      readonly canTsumo: boolean;
      /** リーチ宣言できるか(門前テンパイ・1,000点以上)。 */
      readonly canRiichi: boolean;
      /** リーチ宣言時に切れる(テンパイを保つ)牌。 */
      readonly riichiTiles: readonly Tile[];
      /** 暗槓できる牌種(手牌に4枚)。 */
      readonly ankanTiles: readonly Tile[];
      /** 加槓できる牌(既存ポンに4枚目)。 */
      readonly kakanTiles: readonly Tile[];
      /** リーチ後で打牌が自動ツモ切りに固定されているか。 */
      readonly locked: boolean;
    }
  | {
      readonly kind: "humanReact";
      readonly tile: Tile;
      readonly from: SeatKey;
      /** ロンできるか。 */
      readonly canRon: boolean;
      /** ポンできるか。 */
      readonly canPon: boolean;
      /** 明槓(大明槓)できるか。 */
      readonly canKan: boolean;
    }
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
  /** 供託リーチ棒(和了で回収・流局で持ち越し)。 */
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

/** 自家(人間)の席(抜け番なら null)。 */
function humanSeatOf(hand: HandState): SeatKey | null {
  return seatOfPlayer(hand.seating, HUMAN_ID);
}

/** 場風の番号(東場=東1・南場=南2)。 */
function roundWindNumber(state: RoundState<PlayerId>): number {
  return state.wind === "east" ? HONOR.EAST : HONOR.SOUTH;
}

/** `Meld[]` → 面子分解用の `MeldInput[]`(tenpai/furiten/win 判定に渡す)。 */
function meldInputsOf(melds: readonly Meld[]): MeldInput[] {
  return melds.map((m) => ({
    tiles: m.tiles,
    isKan: m.type === "kan",
    concealed: m.concealed,
  }));
}

/** 牌の完全一致(赤フラグ含む)。 */
function sameTile(a: Tile, b: Tile): boolean {
  return a.suit === b.suit && a.rank === b.rank && !!a.isRed === !!b.isRed;
}

/** 配列から指定牌種を最大 n 枚取り出す(取得分 / 残り)。 */
function takeKind(
  tiles: readonly Tile[],
  kind: Pick<Tile, "suit" | "rank">,
  n: number,
): { taken: Tile[]; rest: Tile[] } {
  const taken: Tile[] = [];
  const rest: Tile[] = [];
  for (const t of tiles) {
    if (taken.length < n && sameKind(t, kind)) taken.push(t);
    else rest.push(t);
  }
  return { taken, rest };
}

/** 河から鳴かれた牌(最後の該当牌)を取り除く。 */
function removeCalledTileFromRiver(
  hand: HandState,
  discarder: SeatKey,
  tile: Tile,
): void {
  const river = hand.discards[discarder];
  for (let i = river.length - 1; i >= 0; i--) {
    if (sameKind(river[i], tile)) {
      hand.discards[discarder] = [...river.slice(0, i), ...river.slice(i + 1)];
      return;
    }
  }
}

/** 全席の一発の権利を消す(鳴きが入ったとき)。 */
function clearAllIppatsu(hand: HandState): void {
  hand.ippatsu = seatFlags(false);
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
    melds: { east: [], south: [], west: [] },
    discards: { east: [], south: [], west: [] },
    kita: { east: 0, south: 0, west: 0 },
    turn: "east",
    drawn: null,
    fromKan: false,
    riichi: seatFlags(),
    doubleRiichi: seatFlags(),
    ippatsu: seatFlags(),
    riichiMiss: seatFlags(),
    tempMiss: seatFlags(),
    callsMade: false,
    paoResponsible: {},
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

/** カン後の嶺上補充(北抜きも自動処理)。`drawn` と `fromKan` を更新する。 */
function drawKanReplacement(hand: HandState, seat: SeatKey): void {
  let tile: Tile;
  try {
    tile = hand.wall.drawReplacement();
  } catch (error) {
    if (error instanceof WallEmptyError) {
      hand.drawn = null;
      hand.fromKan = false;
      return;
    }
    throw error;
  }
  hand.drawn = autoPullNorth(hand, seat, tile);
  hand.fromKan = true;
  hand.tempMiss[seat] = false;
}

/**
 * 進行を人間の意思決定点(自家の打牌 / 鳴き / ロン)まで、または局・半荘の終了まで進める。
 * AI 手番は自動で処理する(リーチ・鳴きはしない)。
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
      hand.fromKan = false;
      hand.tempMiss[seat] = false; // 同巡内フリテンは次の自ツモで解消。
    }

    const haitei = hand.wall.remainingLiveTiles === 0;

    if (isHuman) {
      if (hand.riichi[seat]) {
        // リーチ後は自動ツモ切り(ツモ和了のみ選択の余地)。
        const tsumo = analyzeTsumo(s, seat, hand.drawn, haitei);
        if (tsumo !== null) {
          return {
            ...s,
            pending: {
              kind: "humanDiscard",
              canTsumo: true,
              canRiichi: false,
              riichiTiles: [],
              ankanTiles: [],
              kakanTiles: [],
              locked: true,
            },
          };
        }
        s = applyDiscard(s, seat, hand.drawn);
        if (s.phase !== "playing" || s.pending !== null) return s;
        continue;
      }
      return { ...s, pending: buildHumanPending(s, seat) };
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

    // AI: ツモ切り(リーチ・鳴きはしない)。
    s = applyDiscard(s, seat, hand.drawn);
    if (s.phase !== "playing" || s.pending !== null) return s;
  }
  return s;
}

/** リーチ宣言時に切れる(テンパイを保つ)牌を列挙する。 */
function riichiDiscardTiles(hand: HandState, seat: SeatKey): Tile[] {
  if (hand.drawn === null) return [];
  const melds = meldInputsOf(hand.melds[seat]);
  const pool = [...hand.hands[seat], hand.drawn];
  const result: Tile[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < pool.length; i++) {
    const t = pool[i];
    const key = `${t.suit}-${t.rank}-${t.isRed ? 1 : 0}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const rest = [...pool.slice(0, i), ...pool.slice(i + 1)];
    if (isTenpai(rest, melds)) result.push(t);
  }
  return result;
}

/** 手牌プール中で4枚揃う牌種(暗槓候補)を列挙する。 */
function ankanCandidates(pool: readonly Tile[]): Tile[] {
  const counts = new Map<string, { tile: Tile; n: number }>();
  for (const t of pool) {
    const k = `${t.suit}-${t.rank}`;
    const e = counts.get(k);
    if (e) e.n += 1;
    else counts.set(k, { tile: t, n: 1 });
  }
  return [...counts.values()].filter((e) => e.n >= 4).map((e) => e.tile);
}

/** 既存ポンに4枚目が手にある牌(加槓候補)を列挙する。 */
function kakanCandidates(hand: HandState, seat: SeatKey, pool: Tile[]): Tile[] {
  const out: Tile[] = [];
  for (const m of hand.melds[seat]) {
    if (m.type !== "pon") continue;
    const match = pool.find((t) => sameKind(t, m.tiles[0]));
    if (match) out.push(match);
  }
  return out;
}

/** 自家の打牌待ち Pending を、現局面から構築する。 */
function buildHumanPending(state: EngineState, seat: SeatKey): Pending {
  const hand = state.hand;
  if (hand === null) return null;
  const drawn = hand.drawn;
  const haitei = hand.wall.remainingLiveTiles === 0;
  const canTsumo =
    drawn !== null && analyzeTsumo(state, seat, drawn, haitei) !== null;

  const pool = [...hand.hands[seat], ...(drawn ? [drawn] : [])];
  const menzen = isConcealedHand(hand.melds[seat]);
  const occupant = seatOccupant(hand.seating, seat);
  const riichiTiles =
    drawn !== null && menzen && state.points[occupant] >= RIICHI_STICK_POINTS
      ? riichiDiscardTiles(hand, seat)
      : [];
  const ankanTiles = drawn !== null ? ankanCandidates(pool) : [];
  const kakanTiles = drawn !== null ? kakanCandidates(hand, seat, pool) : [];

  return {
    kind: "humanDiscard",
    canTsumo,
    canRiichi: riichiTiles.length > 0,
    riichiTiles,
    ankanTiles,
    kakanTiles,
    locked: false,
  };
}

/**
 * 打牌を反映し、ロン/鳴き判定 → 手番送りまでを解決する。
 * 自家のロン/鳴きが発生する場合は `pending` を立てて停止する。
 */
function applyDiscard(
  state: EngineState,
  seat: SeatKey,
  tile: Tile,
): EngineState {
  const hand = state.hand;
  if (hand === null) return state;
  // 手牌(+ツモ)から捨て牌1枚を取り除く。
  const pool = [...hand.hands[seat], hand.drawn].filter(
    (t): t is Tile => t !== null,
  );
  const removeAt = pool.findIndex((t) => sameTile(t, tile));
  const idx = removeAt >= 0 ? removeAt : pool.length - 1;
  const discarded = pool[idx];
  pool.splice(idx, 1);
  hand.hands[seat] = pool;
  hand.discards[seat] = [...hand.discards[seat], discarded];
  hand.drawn = null;
  hand.fromKan = false;
  hand.ippatsu[seat] = false; // 自分の打牌で一発の権利は消える。
  hand.pendingDiscard = { seat, tile: discarded };
  hand.passedRonSeats = [];
  return resolveDiscard(state);
}

/** 自家がポン/明槓できるか(必要枚数 need = ポン2 / 明槓3)。 */
function canHumanCall(
  hand: HandState,
  humanSeat: SeatKey | null,
  discarder: SeatKey,
  tile: Tile,
  haitei: boolean,
  need: number,
): boolean {
  if (humanSeat === null || humanSeat === discarder) return false;
  if (hand.riichi[humanSeat]) return false; // リーチ後は鳴けない。
  if (haitei) return false; // 海底牌は鳴けない。
  const count = hand.hands[humanSeat].filter((t) => sameKind(t, tile)).length;
  return count >= need;
}

/** 直前の打牌に対するロン/鳴き(頭ハネ順)を解決。未決着なら手番を送る。 */
function resolveDiscard(state: EngineState): EngineState {
  const hand = state.hand;
  if (hand === null || hand.pendingDiscard === null) return state;
  const { seat: discarder, tile } = hand.pendingDiscard;
  const haitei = hand.wall.remainingLiveTiles === 0;
  const humanSeat = humanSeatOf(hand);

  // 1. ロン(頭ハネ順)。ロンは鳴きより優先。
  for (const candidate of ronOrder(discarder)) {
    if (hand.passedRonSeats.includes(candidate)) continue;
    const analysis = analyzeRon(state, candidate, tile, haitei);
    if (analysis === null) continue;
    if (seatOccupant(hand.seating, candidate) === HUMAN_ID) {
      // 自家のロン機会 → 入力待ちで停止(同じ打牌へのポン/カンも併せて提示)。
      return {
        ...state,
        pending: {
          kind: "humanReact",
          tile,
          from: discarder,
          canRon: true,
          canPon: canHumanCall(hand, humanSeat, discarder, tile, haitei, 2),
          canKan: canHumanCall(hand, humanSeat, discarder, tile, haitei, 3),
        },
      };
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

  // 2. 自家の鳴き(ロンを見送っていない場合のみ)。
  if (humanSeat !== null && !hand.passedRonSeats.includes(humanSeat)) {
    const canPon = canHumanCall(hand, humanSeat, discarder, tile, haitei, 2);
    const canKan = canHumanCall(hand, humanSeat, discarder, tile, haitei, 3);
    if (canPon || canKan) {
      return {
        ...state,
        pending: {
          kind: "humanReact",
          tile,
          from: discarder,
          canRon: false,
          canPon,
          canKan,
        },
      };
    }
  }

  // 3. ロン・鳴きなし → 手番送り。
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
    melds: hand.melds[seat],
    winningTile,
    winType: "tsumo",
    seatWind: SEAT_WIND_NUMBER[seat],
    roundWind: roundWindNumber(state.round),
    riichi: hand.riichi[seat] && !hand.doubleRiichi[seat],
    doubleRiichi: hand.doubleRiichi[seat],
    ippatsu: hand.ippatsu[seat],
    haitei,
    rinshan: hand.fromKan,
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
  // フリテン(捨て牌・同巡内・リーチ後見逃し)ではロン不可。ツモのみ可(furiten モジュール)。
  const allowed = canRon(
    {
      concealedTiles: hand.hands[seat],
      melds: meldInputsOf(hand.melds[seat]),
      ownDiscards: hand.discards[seat],
      temporaryMiss: hand.tempMiss[seat],
      riichiMiss: hand.riichiMiss[seat],
    },
    winningTile,
  );
  if (!allowed) return null;
  return analyzeWin({
    concealedTiles: [...hand.hands[seat], winningTile],
    melds: hand.melds[seat],
    winningTile,
    winType: "ron",
    seatWind: SEAT_WIND_NUMBER[seat],
    roundWind: roundWindNumber(state.round),
    riichi: hand.riichi[seat] && !hand.doubleRiichi[seat],
    doubleRiichi: hand.doubleRiichi[seat],
    ippatsu: hand.ippatsu[seat],
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
  const isRiichiWin = hand.riichi[winnerSeat];

  // ドラ翻(表・裏・赤・ガリ)。副露牌もドラ集計に含める。
  const meldTiles = hand.melds[winnerSeat].flatMap((m) => [...m.tiles]);
  const winningTiles = [...hand.hands[winnerSeat], winningTile, ...meldTiles];
  const doraBreak = countDoraHan({
    hand: winningTiles,
    doraSet: hand.doraSet,
    riichi: isRiichiWin,
    kitaCount: hand.kita[winnerSeat],
  });

  const value = handValueFromHan(
    analysis.han,
    doraBreak.total,
    analysis.yakuman,
  );
  const score = computeScore(value, isDealerWin);

  const others: SeatedPlayerRef[] = SEATS.filter(
    (seat) => seat !== winnerSeat,
  ).map((seat) => ({
    id: seatOccupant(hand.seating, seat),
    isDealer: seat === "east",
  }));

  const discarderId =
    win.discarderSeat !== undefined
      ? seatOccupant(hand.seating, win.discarderSeat)
      : undefined;

  // パオ(責任払い): 和了手にパオ役満が含まれ、その席がパオ確定牌を鳴いていれば
  // 記録済みの責任者へ寄せる(スペック3 3.3 / #99)。門前完成はパオなし。
  const paoResponsibleId =
    analysis.pao.length > 0 ? hand.paoResponsible[winnerSeat] : undefined;

  const payment = resolveWinPayment({
    winner: { id: winnerId, isDealer: isDealerWin },
    winType,
    score,
    discarderId,
    others,
    paoResponsibleId,
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

  // 供託は和了者が回収済み → 場に残る本数は0。
  return finishRound(
    { ...state, points, bonus, riichiSticks: 0 },
    {
      outcome,
      isDraw: false,
      summary: { kind: "win", label, deltas, winnerId, riichiWin: isRiichiWin },
    },
  );
}

/**
 * 流局テンパイ料(荒牌平局)の1人あたり授受額(スペック3 3.4 / issue #99)。
 *
 * 着席3人(東・南・西)で **3,000点プール**を配分する(抜け番=北家は対局外のため
 * 授受に含めない)。テンパイ者が均等に受け取り、ノーテン者が均等に支払う。
 * **全員テンパイ(k=3)/全員ノーテン(k=0)は授受なし**(点棒移動ゼロ)。
 *
 * | k | 各テンパイ受取 | 各ノーテン支払 |
 * |---|---|---|
 * | 0 | — | 0 |
 * | 1 | +3,000 | −1,500 |
 * | 2 | +1,500 | −3,000 |
 * | 3 | 0 | — |
 *
 * @param tenpaiCount 着席3人中のテンパイ人数 k(0〜3)。
 */
export function notenPaymentPool(tenpaiCount: number): {
  readonly receivePerTenpai: number;
  readonly payPerNoten: number;
} {
  const notenCount = 3 - tenpaiCount;
  if (tenpaiCount <= 0 || notenCount <= 0) {
    return { receivePerTenpai: 0, payPerNoten: 0 };
  }
  return {
    receivePerTenpai: NOTEN_POOL / tenpaiCount,
    payPerNoten: NOTEN_POOL / notenCount,
  };
}

/** 流局(海底)を精算し局を終える。テンパイ料を配分する。 */
function settleDraw(state: EngineState): EngineState {
  const hand = state.hand;
  if (hand === null) return state;
  const tenpaiSeats = SEATS.filter((seat) =>
    isTenpai(hand.hands[seat], meldInputsOf(hand.melds[seat])),
  );
  const notenSeats = SEATS.filter((seat) => !tenpaiSeats.includes(seat));

  // テンパイ料の授受(着席3人・3,000点プール。抜け番は不参加)。
  const points: Record<PlayerId, number> = { ...state.points };
  const pool = notenPaymentPool(tenpaiSeats.length);
  for (const seat of tenpaiSeats) {
    points[seatOccupant(hand.seating, seat)] += pool.receivePerTenpai;
  }
  for (const seat of notenSeats) {
    points[seatOccupant(hand.seating, seat)] -= pool.payPerNoten;
  }

  // 親テンパイなら連荘、さもなくば親流れ。流局は本場+1(finishRound で処理)。
  // 供託リーチ棒は場に持ち越す(riichiSticks は据え置き)。
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
  // 半荘終了時に場へ残った供託リーチ棒(`state.riichiSticks` > 0)の帰属は spec 未確定
  // (Q15 / issue #106・要ユーザー承認)。`settleWin` は和了者が回収して 0 にするため、
  // 残存するのは最終局が `settleDraw`(流局)で終わったとき(その流局がトビを伴う場合も含む)。
  // 現状は再配分せず `state.points` をそのまま素点として精算する = 消失(暫定採用)。
  // 確定回答後、精算前にここで供託帰属処理を差し込む。挙動は変えないこと。
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

/** 自家の打牌。`tile` は表示手牌から選ばれた牌(リーチ後は無視され `drawn` を切る)。 */
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
  const useTile =
    state.pending.locked && state.hand.drawn !== null ? state.hand.drawn : tile;
  const after = applyDiscard({ ...state, pending: null }, seat, useTile);
  return pump(after);
}

/** 自家のツモ切り(リーチ後にツモ和了しないとき用)。 */
export function tsumogiri(state: EngineState): EngineState {
  if (
    state.phase !== "playing" ||
    state.pending?.kind !== "humanDiscard" ||
    state.hand === null ||
    state.hand.drawn === null
  ) {
    return state;
  }
  const seat = seatOfPlayer(state.hand.seating, HUMAN_ID);
  if (seat === null || state.hand.turn !== seat) return state;
  const after = applyDiscard(
    { ...state, pending: null },
    seat,
    state.hand.drawn,
  );
  return pump(after);
}

/** 自家のリーチ宣言(門前テンパイ・1,000点供託)。`tile` は宣言牌(捨て牌)。 */
export function declareRiichi(state: EngineState, tile: Tile): EngineState {
  if (
    state.phase !== "playing" ||
    state.pending?.kind !== "humanDiscard" ||
    !state.pending.canRiichi ||
    state.hand === null ||
    state.hand.drawn === null
  ) {
    return state;
  }
  const seat = seatOfPlayer(state.hand.seating, HUMAN_ID);
  if (seat === null || state.hand.turn !== seat) return state;
  // 宣言牌はテンパイを保つ牌でなければならない。
  if (!state.pending.riichiTiles.some((t) => sameTile(t, tile))) return state;
  const occupant = seatOccupant(state.hand.seating, seat);
  if (state.points[occupant] < RIICHI_STICK_POINTS) return state;

  const hand = state.hand;
  hand.riichi[seat] = true;
  // ダブルリーチ = 自分の第一打・鳴きなし。
  hand.doubleRiichi[seat] = hand.discards[seat].length === 0 && !hand.callsMade;

  const newPoints = {
    ...state.points,
    [occupant]: state.points[occupant] - RIICHI_STICK_POINTS,
  };
  const s1: EngineState = {
    ...state,
    points: newPoints,
    riichiSticks: state.riichiSticks + 1,
    pending: null,
  };
  const s2 = applyDiscard(s1, seat, tile);
  // 一発の権利を開く(applyDiscard 内で一旦 false にされるため後付けで true)。
  if (s2.hand) s2.hand.ippatsu[seat] = true;
  return pump(s2);
}

/**
 * 相手の打牌を鳴いた副露(ポン/大明槓)がパオ役満(大三元/大四喜/四槓子)を
 * 確定させたら、責任者(= その確定牌を打った者)を記録する(スペック3 3.3 / #99)。
 * `existingMelds` は **この鳴きを加える前**の副露列。
 */
function recordPaoResponsible(
  hand: HandState,
  seat: SeatKey,
  discarder: SeatKey,
  existingMelds: readonly Meld[],
  newMeld: Meld,
): void {
  if (
    isPaoTriggeringCall({ existingMelds, newMeld, fromOpponentDiscard: true })
  ) {
    hand.paoResponsible[seat] = seatOccupant(hand.seating, discarder);
  }
}

/** 自家のポン(直前の他家打牌に対して)。 */
export function declarePon(state: EngineState): EngineState {
  if (
    state.phase !== "playing" ||
    state.pending?.kind !== "humanReact" ||
    !state.pending.canPon ||
    state.hand === null ||
    state.hand.pendingDiscard === null
  ) {
    return state;
  }
  const hand = state.hand;
  const seat = humanSeatOf(hand);
  if (seat === null || hand.pendingDiscard === null) return state;
  const { seat: discarder, tile } = hand.pendingDiscard;
  const { taken, rest } = takeKind(hand.hands[seat], tile, 2);
  if (taken.length < 2) return state;

  hand.hands[seat] = rest;
  const ponMeld: Meld = {
    type: "pon",
    tiles: [tile, ...taken],
    concealed: false,
  };
  recordPaoResponsible(hand, seat, discarder, hand.melds[seat], ponMeld);
  hand.melds[seat] = [...hand.melds[seat], ponMeld];
  removeCalledTileFromRiver(hand, discarder, tile);
  clearAllIppatsu(hand);
  hand.callsMade = true;
  hand.pendingDiscard = null;
  hand.passedRonSeats = [];
  hand.drawn = null;
  hand.fromKan = false;
  hand.turn = seat;
  // ポン後は打牌が必要(ツモなし)。
  return { ...state, pending: buildHumanPending(state, seat) };
}

/** 自家の明槓(大明槓・直前の他家打牌に対して)。 */
export function declareKan(state: EngineState): EngineState {
  if (
    state.phase !== "playing" ||
    state.pending?.kind !== "humanReact" ||
    !state.pending.canKan ||
    state.hand === null ||
    state.hand.pendingDiscard === null
  ) {
    return state;
  }
  const hand = state.hand;
  const seat = humanSeatOf(hand);
  if (seat === null || hand.pendingDiscard === null) return state;
  const { seat: discarder, tile } = hand.pendingDiscard;
  const { taken, rest } = takeKind(hand.hands[seat], tile, 3);
  if (taken.length < 3) return state;

  hand.hands[seat] = rest;
  const kanMeld: Meld = {
    type: "kan",
    tiles: [tile, ...taken],
    concealed: false,
  };
  recordPaoResponsible(hand, seat, discarder, hand.melds[seat], kanMeld);
  hand.melds[seat] = [...hand.melds[seat], kanMeld];
  removeCalledTileFromRiver(hand, discarder, tile);
  clearAllIppatsu(hand);
  hand.callsMade = true;
  hand.pendingDiscard = null;
  hand.passedRonSeats = [];
  hand.turn = seat;
  drawKanReplacement(hand, seat); // 嶺上ツモ
  return { ...state, pending: buildHumanPending(state, seat) };
}

/** 自家の暗槓(自ツモ番)。`tile` は槓子にする牌種。 */
export function declareAnkan(state: EngineState, tile: Tile): EngineState {
  if (
    state.phase !== "playing" ||
    state.pending?.kind !== "humanDiscard" ||
    state.hand === null ||
    state.hand.drawn === null
  ) {
    return state;
  }
  if (!state.pending.ankanTiles.some((t) => sameKind(t, tile))) return state;
  const hand = state.hand;
  const seat = humanSeatOf(hand);
  if (seat === null || hand.turn !== seat || hand.drawn === null) return state;

  const pool = [...hand.hands[seat], hand.drawn];
  const { taken, rest } = takeKind(pool, tile, 4);
  if (taken.length < 4) return state;

  hand.hands[seat] = rest;
  hand.drawn = null;
  hand.melds[seat] = [
    ...hand.melds[seat],
    { type: "kan", tiles: taken, concealed: true },
  ];
  clearAllIppatsu(hand);
  hand.callsMade = true;
  drawKanReplacement(hand, seat); // 嶺上ツモ
  return { ...state, pending: buildHumanPending(state, seat) };
}

/** 自家の加槓(自ツモ番・既存ポンに4枚目)。`tile` は加える牌。 */
export function declareKakan(state: EngineState, tile: Tile): EngineState {
  if (
    state.phase !== "playing" ||
    state.pending?.kind !== "humanDiscard" ||
    state.hand === null ||
    state.hand.drawn === null
  ) {
    return state;
  }
  if (!state.pending.kakanTiles.some((t) => sameKind(t, tile))) return state;
  const hand = state.hand;
  const seat = humanSeatOf(hand);
  if (seat === null || hand.turn !== seat || hand.drawn === null) return state;

  const pool = [...hand.hands[seat], hand.drawn];
  const target = hand.melds[seat].find(
    (m) => m.type === "pon" && sameKind(m.tiles[0], tile),
  );
  if (!target) return state;
  const { taken, rest } = takeKind(pool, tile, 1);
  if (taken.length < 1) return state;

  hand.hands[seat] = rest;
  hand.drawn = null;
  hand.melds[seat] = hand.melds[seat].map((m) =>
    m === target
      ? { type: "kan", tiles: [...m.tiles, taken[0]], concealed: false }
      : m,
  );
  clearAllIppatsu(hand);
  hand.callsMade = true;
  drawKanReplacement(hand, seat); // 嶺上ツモ(槍槓は未対応)
  return { ...state, pending: buildHumanPending(state, seat) };
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
    state.pending?.kind !== "humanReact" ||
    !state.pending.canRon ||
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

/** 自家のロン/鳴き見送り(スルー)。頭ハネの残り候補を解決して進行を続ける。 */
export function passRon(state: EngineState): EngineState {
  if (
    state.phase !== "playing" ||
    state.pending?.kind !== "humanReact" ||
    state.hand === null
  ) {
    return state;
  }
  const seat = seatOfPlayer(state.hand.seating, HUMAN_ID);
  if (seat === null) return state;
  const hand = state.hand;
  // ロンを見送った場合はフリテン(同巡内 / リーチ後は恒久)。
  if (state.pending.canRon) {
    hand.tempMiss[seat] = true;
    if (hand.riichi[seat]) hand.riichiMiss[seat] = true;
  }
  hand.passedRonSeats = [...hand.passedRonSeats, seat];
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
