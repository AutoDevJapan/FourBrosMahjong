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
 * - **リーチ**: 門前テンパイで宣言(1,000点供託)、リーチ後は原則自動ツモ切り、フリテンリーチはツモのみ、
 *   **裏ドラ**開示(リーチ和了時)、**一発**(リーチ後1巡以内・鳴きを挟むと消滅)、ダブルリーチ。
 * - **鳴き(自家のみ)**: ポン・明槓(他家打牌)・暗槓・加槓(自家ツモ番)。嶺上ツモ・鳴き喰い下がりは
 *   既存 hand が対応。鳴きは一発を消滅させる。
 * - **喰い替え禁止(現物)**(#105 / スペック1 1.4「喰い替えなし」): サンマはチーが無くポンのみのため
 *   喰い替えは**現物喰い替え**(ポンした牌と同種を直後に切る)に限られる。ポン直後の打牌でその牌種を
 *   禁止する(`hand.ponnedKind` を `discard` が参照し `isKuikaeForbidden` で no-op)。
 *
 * ## AI
 * - 他家(AI)は**手牌効率(向聴・受け入れ)ベースの打牌**(#98)に加え、リーチ・各種カンを行う。
 *   ポン/大明槓は合法性に加え、ナシナシで役無しを固定しない戦略ゲート(#210)を通す。
 * - 加槓に対する槍槓(チャンカン)は**対応済み**(Q17 = 槍槓あり・ユーザー承認 / #115)。加槓宣言時、
 *   その加槓牌でロンできる他家がいれば加槓は不成立(横取り)= 槍槓ロン(`chankan` 1翻)として精算する。
 *   `declareKakan` は自家(p0)専用のため応答者は他家(AI)。
 * - 国士無双の暗槓槍槓は**対応済み**(Q17 フォローアップ・#126・ユーザー承認・国士のみ暗槓槍槓可)。
 *   国士無双テンパイの他家に限り、暗槓(4枚目を暗槓した瞬間)に対しても槍槓ロンを認める。
 *   応答者の和了形が国士無双(`thirteenOrphans`)の場合のみ横取り成立とし、それ以外の役では
 *   暗槓に対する槍槓は不可(暗槓成立)。判定は `resolveChankan` に集約する。
 * - **AI の加槓・暗槓に対する自家の槍槓は選択制**(#208)。通常ロンと同じ
 *   `pending: humanReact`(ロン / スルー)を立てて入力を待ち、スルー時は `passRon` が
 *   見逃しフリテン(同巡内 / リーチ後は恒久)を適用した上で槓を成立させ進行を再開する。
 * - リーチ後の暗槓は**条件付きで許可**(Q18 / #116・ユーザー承認済み・標準慣行)。ツモ牌での暗槓に限り、
 *   待ち・面子構成が変わらない(送り槓でない)場合のみ許可する。七対子テンパイでの暗槓は不可
 *   (`canAnkanAfterRiichi` が判定)。加槓に対する槍槓横取りは Q17 / #115 の範囲。
 * - 北抜き(ガリ)は**自動**で処理する(手動選択は未対応)。
 * - パオ(責任払い)は**鳴きで確定した大三元/大四喜/四槓子**に対応(#99)。ポン/大明槓で
 *   パオ役満が確定した瞬間に責任者(打牌者)を記録し、和了時 `resolveWinPayment` で責任払い
 *   (ロン折半・ツモ全額・本場)を行う(判定は `scoring/pao.ts`)。役満祝儀は別枠で、支払者は
 *   **抜け番を含む和了者以外の3兄弟**とする(Q14 確定・ユーザー承認 2026-07-17 / #129)。
 * - `SAFETY_ROUND_CAP` で局数に上限を設け、南4連荘の理論的無限ループを防ぐ(通常は発火しない)。
 *
 * 決定性: `createGame({ seed })` で `createSeededRng` を用いるため、同じ seed + 同じ操作列から
 * 完全に同じ進行が再現できる(ユニットテストの土台)。
 */

import { dealStartingHands } from "@/domain/deal/deal";
import type { DiceRoll } from "@/domain/dora/dice";
import {
  createDoraSet,
  type DoraSet,
  resolveDora,
} from "@/domain/dora/doraSet";
import { countDoraHan } from "@/domain/dora/han";
import { chooseDiscard, shanten, shouldCallMeld } from "@/domain/game/ai";
import { decomposeAll, type MeldInput } from "@/domain/hand/decompose";
import { canRon } from "@/domain/hand/furiten";
import { isKuikaeForbidden } from "@/domain/hand/kuikae";
import { isConcealedHand, type Meld } from "@/domain/hand/meld";
import { isTenpai, waitingTiles } from "@/domain/hand/tenpai";
import { sameKind, tileKey } from "@/domain/hand/tile-identity";
import { analyzeWin, type WinAnalysis } from "@/domain/hand/win";
import { createSeededRng, type Rng } from "@/domain/random/rng";
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
  YAKUMAN_BONUS,
} from "@/domain/scoring/settlement";
import {
  resolveWinPayment,
  type SeatedPlayerRef,
} from "@/domain/scoring/win-payment";
import { HONOR, type Tile } from "@/domain/tiles/tile";
import { buildWall, type Wall, WallEmptyError } from "@/domain/wall/wall";

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
  /**
   * 席ごとの河(捨て牌)。**表示用**。他家に鳴かれた牌は実体ごと取り除かれる
   * (現実の卓で鳴かれた牌が副露へ移るのと同じ)。フリテン判定には使わない。
   */
  discards: Record<SeatKey, Tile[]>;
  /**
   * 席ごとの全打牌履歴(#395)。鳴かれても取り除かない**判定用**の SSOT。
   *
   * 捨て牌フリテンは恒久(`hand/furiten.ts`)であり、他家の鳴きという自分の意思と
   * 無関係な事象では解除されない。表示用の `discards` を判定に流用すると、
   * 鳴かれた瞬間にフリテンが解けて不正ロンが成立する。安全牌(現物)の評価も
   * 同じ理由で履歴側を見る。
   */
  discardHistory: Record<SeatKey, Tile[]>;
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
  /** 宣言牌の応答解決待ちのリーチ席。ロンされなければ供託を確定する。 */
  pendingRiichiSeat: SeatKey | null;
  /** 直前の打牌に対しロン/鳴きを見送った席(頭ハネ解決の再入で参照)。 */
  passedRonSeats: SeatKey[];
  /**
   * 直前にポンした牌(喰い替え禁止用 / #105・スペック1 1.4)。ポン直後の打牌で
   * この牌と同種を切る=現物喰い替えは非合法手として禁止する。打牌が済めば null。
   */
  ponnedKind: Tile | null;
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
  /**
   * 半荘終了時に場へ残った供託リーチ棒の帰属記録(#282)。流局(トビ流局含む)で半荘が
   * 終わり供託が残存したときのみ `endGame` が設定する。残存分は `deltas[recipientId]` へ
   * 畳み込み済み(和了時の `stickPayout` と同じく供託は複数局分でも受取者のデルタに含める)
   * のため、本フィールドはその内訳(誰が何本・何点を取得したか)の表示・検算用スナップショット。
   */
  readonly residualSticks?: {
    /** 帰属先(Q15 = 最終持ち点最高 / Q20 = 同点最高は席順上位)。 */
    readonly recipientId: PlayerId;
    readonly recipientName: string;
    /** 残存本数。 */
    readonly sticks: number;
    /** 加算点(= sticks × 1,000)。 */
    readonly points: number;
  };
  /** 和了時点で固定した、GUI検算用の表示スナップショット。 */
  readonly winDetails?: {
    readonly winType: "tsumo" | "ron";
    readonly dealer: boolean;
    /** 和了者の表示名(#259)。 */
    readonly winnerName: string;
    /** 和了者の席(東=親)。 */
    readonly winnerSeat: SeatKey;
    /**
     * 和了確定時に固定した門前手牌(和了牌を除く。副露・ガリは含まない — それらは
     * 卓上の既存表示が公開情報として担う)。次局遷移で `hand.hands` は失われるため、
     * 局終了後の開示(#259)はこのスナップショットを参照する。
     */
    readonly hand: readonly Tile[];
    /** 和了牌(ツモ牌 / ロンした打牌・槍槓牌)。 */
    readonly winningTile: Tile;
    readonly yaku: readonly {
      readonly name: string;
      readonly han: number;
      readonly yakuman: number;
    }[];
    readonly yakuHan: number;
    readonly dora: {
      readonly omote: number;
      readonly ura: number;
      readonly aka: number;
      readonly gari: number;
      readonly total: number;
    };
    readonly totalHan: number;
    readonly yakuman: number;
    readonly category: string;
    readonly honba: number;
    readonly riichiSticks: number;
    readonly payments: readonly {
      readonly name: string;
      readonly amount: number;
    }[];
    readonly stickPayout: number;
  };
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
      /**
       * 喰い替え禁止で切れない牌種(#105 / スペック1 1.4)。ポン直後のみ、ポンした牌と
       * 同種の1牌種が入る(それ以外は空)。UI は選択不可にし、`discard` も no-op にする。
       */
      readonly forbiddenDiscards: readonly Tile[];
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
      /**
       * 槍槓応答か(#208)。`"kakan"` = 加槓・`"ankan"` = 暗槓(国士のみ / Q17・#126)への
       * 槍槓ロン機会。`undefined` は通常の打牌応答。槍槓応答では `tile` = 槓宣言牌、
       * `from` = 槓宣言席で、ポン/明槓は常に不可(`canPon`/`canKan` = false)。
       * スルー時は `passRon` が通常ロンと同じフリテン処理の後、槓を成立させ進行を再開する。
       */
      readonly chankan?: "kakan" | "ankan";
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

/** 四人回しの4人の表示名(index 0 = 自家)。 */
export type PlayerNames = readonly [string, string, string, string];

/** `createGame` のオプション。 */
export interface CreateGameOptions {
  /** 乱数 seed(既定は現在時刻)。テストでは固定値を渡す。 */
  readonly seed?: number;
  /** 4兄弟の表示名(index 0 = 自家)。 */
  readonly names?: PlayerNames;
}

/**
 * 表示名の既定値(未設定時の後方互換値)。
 *
 * 実在人物名は含めない。本作は非公式ファンメイドであり、番組メンバー名を出荷物へ
 * 同梱してよいかは未確定(`質問リスト.md` Q28)。実名は `/settings` からユーザーが入力する。
 */
export const DEFAULT_NAMES: PlayerNames = ["あなた", "一郎", "二郎", "三郎"];

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

/**
 * 河(表示用)から鳴かれた牌(最後の該当牌)を取り除く。
 * 判定用の `discardHistory` は**一切触らない**(捨て牌フリテンは恒久 / #395)。
 */
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

/**
 * ロン判定順(頭ハネ=上家取り): 放銃者の次席から巡目順に2席。
 *
 * SSOT: `docs/四兄弟麻雀ルール.md` §3「ダブロン等が発生した場合は上家取り」/
 * `documents/spec/game-flow.md` 2.4。複数家が同時にロンできる場合、この順の
 * **最初の1人だけ**が和了する(呼び出し側は先勝ちで抜ける)。供託・本場も同様に
 * その1人が取得する。
 *
 * 席割りが確定(Q9・Q10)した現在、頭ハネは「席インデックスの環状距離」ではなく
 * `NEXT_SEAT` の巡目順そのもので表せるため、本関数が唯一の実装である
 * (かつて `src/domain/hand/head-bump.ts` に席未確定時の抽象版があったが、
 * engine から未使用の死にコードだったため #311 で削除した)。
 * 通常打牌・槍槓の両経路の検証は `engine.head-bump.test.ts` /
 * `engine.chankan.test.ts` を参照。
 */
function ronOrder(discarder: SeatKey): [SeatKey, SeatKey] {
  const first = NEXT_SEAT[discarder];
  return [first, NEXT_SEAT[first]];
}

// ---------------------------------------------------------------------------
// アクション可否述語(can_*) — 純関数・決定的(issue #139)
//
// 各公開アクションの「その局面で宣言できるか」を、最小の入力だけを取る純述語へ
// 切り出したもの。OpenRiichi(GPL / 設計思想のみ参照)の `RoundState.can_*` が
// 「壁レベルのガード(海底・カン残)× プレイヤーレベルの可否」を分解している設計を
// 参考に、本作の可否分岐を網羅監査できる粒度へ整理した(コードは流用していない)。
// engine 内部(`buildHumanPending` / `canHumanCall` / `riichiAnkanTiles`)はこれらへ
// 委譲し**挙動は不変**。境界(海底・リーチ中・鳴き後・放銃者自身・枚数不足・非門前・
// 点棒不足)を engine 全体を組まずに単体検証できるよう公開する。
// リーチ後暗槓の送り槓ガードは {@link canAnkanAfterRiichi}(Q18 / #116)を参照。
// ---------------------------------------------------------------------------

/**
 * 海底(ライブ牌 0)か(純述語)。海底では嶺上補充ができないためカン・鳴きは不可
 * (標準慣行・#128)。ロン/ツモ自体は海底摸月・河底撈魚として可(別判定)。
 */
export function isHaitei(remainingLiveTiles: number): boolean {
  return remainingLiveTiles === 0;
}

/** 通常ツモが海底牌か。嶺上補充はライブ牌残数を0にしても海底摸月ではない。 */
export function isHaiteiTsumo(
  remainingLiveTiles: number,
  fromKan: boolean,
): boolean {
  return isHaitei(remainingLiveTiles) && !fromKan;
}

/**
 * 他家の打牌に対しポン(need=2)/大明槓(need=3)を宣言できるか(純述語)。
 * - 放銃者自身(`isDiscarder`)は自分の打牌を鳴けない。
 * - リーチ後(`inRiichi`)は鳴けない。
 * - 海底(`haitei`)は鳴けない(嶺上補充不可)。
 * - 門前手牌 `concealed` に打牌 `tile` と同種が `need` 枚以上あること(赤フラグ無視)。
 * サンマはチーが無いため対象はポン/大明槓のみ(上家限定のチー判定は存在しない)。
 */
export function canCallMeldOnDiscard(params: {
  readonly concealed: readonly Tile[];
  readonly tile: Tile;
  readonly need: number;
  readonly inRiichi: boolean;
  readonly haitei: boolean;
  readonly isDiscarder: boolean;
}): boolean {
  const { concealed, tile, need, inRiichi, haitei, isDiscarder } = params;
  if (isDiscarder || inRiichi || haitei) return false;
  return concealed.filter((t) => sameKind(t, tile)).length >= need;
}

/**
 * 自ツモ番でカン(暗槓・加槓)を宣言できる局面か(純述語)。
 * ツモ牌がある(`hasDrawn` = 自ツモ番)かつ海底でない(嶺上補充ができる)こと。
 * 具体的な牌種(暗刻の4枚目 / 既存ポンの4枚目)の有無は候補列挙側が別に判定する。
 */
export function canKanOnDrawTurn(hasDrawn: boolean, haitei: boolean): boolean {
  return hasDrawn && !haitei;
}

/**
 * リーチを宣言できる局面か(純述語)。
 * - ツモ牌がある(`hasDrawn` = 自ツモ番)。
 * - 門前(`isMenzen` = 副露なし。暗槓のみは門前とみなす=`isConcealedHand`)。
 * - 持ち点が供託1,000点以上(`points >= 1,000`)。
 * - テンパイを保つ打牌が存在する(`hasTenpaiKeepingDiscard`)。
 * 既にリーチ済みの席へは engine 側が打牌選択を出さない(自動ツモ切り)ため対象外。
 */
export function canDeclareRiichi(params: {
  readonly hasDrawn: boolean;
  readonly isMenzen: boolean;
  readonly points: number;
  readonly hasTenpaiKeepingDiscard: boolean;
}): boolean {
  const { hasDrawn, isMenzen, points, hasTenpaiKeepingDiscard } = params;
  return (
    hasDrawn &&
    isMenzen &&
    points >= RIICHI_STICK_POINTS &&
    hasTenpaiKeepingDiscard
  );
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
    discardHistory: { east: [], south: [], west: [] },
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
    pendingRiichiSeat: null,
    passedRonSeats: [],
    ponnedKind: null,
  };
  autoPullDealtNorths(hand);
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
 * 配牌に含まれる北をガリとして抜き、抜いた枚数ぶん嶺上牌で13枚へ補充する。
 * 補充牌も北なら {@link autoPullNorth} が連続して抜くため、手牌に北を残さない。
 */
function autoPullDealtNorths(hand: HandState): void {
  for (const seat of SEATS) {
    const concealed: Tile[] = [];
    for (const tile of hand.hands[seat]) {
      if (tile.suit === "honor" && tile.rank === HONOR.NORTH) {
        concealed.push(autoPullNorth(hand, seat, tile));
      } else {
        concealed.push(tile);
      }
    }
    hand.hands[seat] = concealed;
  }
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
 * 複数家にまたがる4組目のカンを四槓散了として途中流局にする。
 * 1人だけの4槓は四槓子の和了機会を残すため継続する。
 * 呼び出し側は槍槓判定を先に完了し、槓子を状態へ反映した直後に本関数を呼ぶ。
 */
function settleFourKanAbortiveDraw(state: EngineState): EngineState | null {
  const hand = state.hand;
  if (hand === null) return null;
  const owners = SEATS.filter((seat) =>
    hand.melds[seat].some((meld) => meld.type === "kan"),
  );
  const kanCount = SEATS.reduce(
    (total, seat) =>
      total + hand.melds[seat].filter((meld) => meld.type === "kan").length,
    0,
  );
  if (kanCount < 4 || owners.length < 2) return null;

  const deltas = Object.fromEntries(ALL_IDS.map((id) => [id, 0])) as Record<
    PlayerId,
    number
  >;
  return finishRound(state, {
    outcome: "dealerContinues",
    isDraw: true,
    summary: { kind: "draw", label: "四槓散了", deltas },
  });
}

/**
 * AI 手番の打牌を手牌効率(向聴・受け入れ)ベースで選ぶ(#98)。
 * 他家の打牌履歴から現物(危険牌回避 / #395)、表ドラ+赤5から打点温存を加味する。
 * 和了牌の温存は考えない(和了は本関数の前段でツモ宣言済み)。
 * 副露後は門前牌だけを評価対象にし、副露数 `meldCount` を渡して向聴・受け入れを
 * 副露込みで補正する(#294: 未補正だと副露手で向聴値が飽和し、AI が自らテンパイを崩す)。
 */
function chooseAiDiscard(
  hand: HandState,
  seat: SeatKey,
  drawn: Tile | null,
  forbiddenDiscards: readonly Tile[] = [],
): Tile {
  const tiles = [...hand.hands[seat], ...(drawn ? [drawn] : [])];
  const opponentDiscards = (["east", "south", "west"] as SeatKey[])
    .filter((s) => s !== seat)
    // 他家が打った牌はその家に対する現物(安全牌)であり続ける。鳴かれて河から
    // 消えても安全性は変わらないため、履歴側を見る(#395)。
    .map((s) => hand.discardHistory[s]);
  const doraKinds = new Set(
    resolveDora(hand.doraSet).omote.map((t) => tileKey(t)),
  );
  return chooseDiscard({
    tiles,
    meldCount: hand.melds[seat].length,
    opponentDiscards,
    doraKinds,
    forbiddenDiscards,
  });
}

/**
 * リーチ宣言牌の候補から、宣言後の待ちが自河と交わる(= 捨て牌フリテンになる)牌を
 * 除いて返す(#295)。フリテンリーチはルール上合法(スペック2 2.4)だが、以後ロン不可の
 * まま手を固定する明確な悪手であり、他家の当たり牌を「見逃す」ように見えるため、
 * AI は非フリテンの待ちになる宣言牌のみを選ぶ。純関数・決定的。
 */
function nonFuritenRiichiTiles(
  hand: HandState,
  seat: SeatKey,
  candidates: readonly Tile[],
): Tile[] {
  if (hand.drawn === null) return [];
  const melds = meldInputsOf(hand.melds[seat]);
  const pool = [...hand.hands[seat], hand.drawn];
  const ownDiscardKeys = new Set(
    // 鳴かれた牌も恒久フリテンの原因として残る(#395)。
    hand.discardHistory[seat].map((t) => tileKey(t)),
  );
  return candidates.filter((candidate) => {
    const index = pool.findIndex((t) => sameTile(t, candidate));
    if (index < 0) return false;
    const rest = [...pool.slice(0, index), ...pool.slice(index + 1)];
    // 宣言牌自身も宣言と同時に自河へ載るため、待ちに含まれるならフリテン扱いにする
    // (役なし完成形をリーチで曲げる場合など、待ちが宣言牌と同種になる形がある)。
    const candidateKey = tileKey(candidate);
    return waitingTiles(rest, melds).every((wait) => {
      const key = tileKey(wait);
      return key !== candidateKey && !ownDiscardKeys.has(key);
    });
  });
}

/**
 * AIのリーチ宣言。合法な宣言牌のうち、宣言後の待ちがフリテンにならない牌に限って
 * 宣言する(#295)。その中に手牌効率AIの選んだ牌があればそれを、なければ先頭を切る。
 * 全候補がフリテンになる場合はリーチを見送り、呼び出し側の通常打牌(ダマ維持)に委ねる。
 */
function applyAiRiichi(state: EngineState, seat: SeatKey): EngineState {
  const hand = state.hand;
  if (hand === null || hand.drawn === null) return state;
  const candidates = riichiDiscardTiles(hand, seat);
  const occupant = seatOccupant(hand.seating, seat);
  if (
    !canDeclareRiichi({
      hasDrawn: true,
      isMenzen: isConcealedHand(hand.melds[seat]),
      points: state.points[occupant],
      hasTenpaiKeepingDiscard: candidates.length > 0,
    })
  ) {
    return state;
  }
  const declarable = nonFuritenRiichiTiles(hand, seat, candidates);
  if (declarable.length === 0) return state;
  const selected = chooseAiDiscard(hand, seat, hand.drawn);
  const tile =
    declarable.find((candidate) => sameTile(candidate, selected)) ??
    declarable[0];
  hand.riichi[seat] = true;
  hand.doubleRiichi[seat] =
    // 「まだ一度も打牌していない」= 履歴が空(表示用の河は鳴きで減りうる / #395)。
    hand.discardHistory[seat].length === 0 && !hand.callsMade;
  hand.pendingRiichiSeat = seat;
  const callsMadeBeforeDeclaration = hand.callsMade;
  const discarded = applyDiscard(state, seat, tile);
  if (
    discarded.phase === "playing" &&
    discarded.hand !== null &&
    discarded.hand.callsMade === callsMadeBeforeDeclaration
  ) {
    discarded.hand.ippatsu[seat] = true;
  }
  return discarded;
}

/**
 * 槍槓候補を頭ハネ順(`ronOrder`)に解決する(Q17・#115 / 国士暗槓は #126 / 選択制は #208)。
 *
 * - 暗槓(`kind: "ankan"`)は和了形が国士無双(`thirteenOrphans`)の候補のみ対象。
 * - 候補が**自家(p0)**なら即和了させず `pending: humanReact`(`chankan` 付き)を立てて
 *   入力を待つ(通常ロンと同じ「ロン / スルー」の選択制 / #208)。
 * - 候補が他家(AI)なら従来どおり即 `settleWin`(槍槓ロン成立・槓は不成立)。
 * - スルー済みの席(`passedRonSeats`)は候補から除く(スルー後の再入で残候補を解決する)。
 * - 誰も横取りできなければ `null` を返す(呼び出し側が槓を成立させる)。
 */
function resolveChankan(
  state: EngineState,
  seat: SeatKey,
  kanTile: Tile,
  kind: "kakan" | "ankan",
): EngineState | null {
  const hand = state.hand;
  if (hand === null) return null;
  for (const candidate of ronOrder(seat)) {
    if (hand.passedRonSeats.includes(candidate)) continue;
    const win = analyzeRon(state, candidate, kanTile, false, true);
    if (win === null) continue;
    if (kind === "ankan" && win.form.kind !== "thirteenOrphans") continue;
    if (seatOccupant(hand.seating, candidate) === HUMAN_ID) {
      return {
        ...state,
        pending: {
          kind: "humanReact",
          tile: kanTile,
          from: seat,
          canRon: true,
          canPon: false,
          canKan: false,
          chankan: kind,
        },
      };
    }
    return settleWin(state, {
      winnerSeat: candidate,
      winType: "ron",
      winningTile: kanTile,
      analysis: win,
      discarderSeat: seat,
      haitei: false,
    });
  }
  return null;
}

/** 暗槓を成立させる(槍槓なし確定後): 槓子化・四槓散了判定・嶺上補充。 */
function completeAiAnkan(
  state: EngineState,
  seat: SeatKey,
  tile: Tile,
): EngineState {
  const hand = state.hand;
  if (hand === null || hand.drawn === null) return state;
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
  const abortiveDraw = settleFourKanAbortiveDraw(state);
  if (abortiveDraw !== null) return abortiveDraw;
  drawKanReplacement(hand, seat);
  return state;
}

/** 加槓を成立させる(槍槓なし確定後): ポン→明槓更新・四槓散了判定・嶺上補充。 */
function completeAiKakan(
  state: EngineState,
  seat: SeatKey,
  tile: Tile,
): EngineState {
  const hand = state.hand;
  if (hand === null || hand.drawn === null) return state;
  const target = hand.melds[seat].find(
    (meld) => meld.type === "pon" && sameKind(meld.tiles[0], tile),
  );
  if (target === undefined) return state;
  const pool = [...hand.hands[seat], hand.drawn];
  const { taken, rest } = takeKind(pool, tile, 1);
  if (taken.length < 1) return state;
  const kakanTile = taken[0];
  hand.hands[seat] = rest;
  hand.drawn = null;
  hand.melds[seat] = hand.melds[seat].map((meld) =>
    meld === target
      ? {
          type: "kan",
          tiles: [...meld.tiles, kakanTile],
          concealed: false,
        }
      : meld,
  );
  clearAllIppatsu(hand);
  hand.callsMade = true;
  const abortiveDraw = settleFourKanAbortiveDraw(state);
  if (abortiveDraw !== null) return abortiveDraw;
  drawKanReplacement(hand, seat);
  return state;
}

/**
 * AIの暗槓。槍槓(国士のみ)判定後、成立すれば嶺上牌を補充する。
 * 自家に槍槓機会があれば `pending: humanReact`(ロン / スルー)で停止する(#208)。
 */
function applyAiAnkan(
  state: EngineState,
  seat: SeatKey,
  tile: Tile,
): EngineState {
  const hand = state.hand;
  if (hand === null || hand.drawn === null) return state;
  const pool = [...hand.hands[seat], hand.drawn];
  const { taken } = takeKind(pool, tile, 4);
  if (taken.length < 4) return state;
  const chankan = resolveChankan(state, seat, taken[0], "ankan");
  if (chankan !== null) return chankan;
  return completeAiAnkan(state, seat, tile);
}

/**
 * AIの加槓。槍槓ロンが無ければポンを明槓へ更新し嶺上牌を補充する。
 * 自家に槍槓機会があれば `pending: humanReact`(ロン / スルー)で停止する(#208)。
 */
function applyAiKakan(
  state: EngineState,
  seat: SeatKey,
  tile: Tile,
): EngineState {
  const hand = state.hand;
  if (hand === null || hand.drawn === null) return state;
  const target = hand.melds[seat].find(
    (meld) => meld.type === "pon" && sameKind(meld.tiles[0], tile),
  );
  if (target === undefined) return state;
  const { taken } = takeKind([...hand.hands[seat], hand.drawn], tile, 1);
  if (taken.length < 1) return state;
  const chankan = resolveChankan(state, seat, taken[0], "kakan");
  if (chankan !== null) return chankan;
  return completeAiKakan(state, seat, tile);
}

/** AIのポン/大明槓を成立させる。大明槓は嶺上牌補充まで行う。 */
function applyAiCall(
  state: EngineState,
  caller: SeatKey,
  discarder: SeatKey,
  tile: Tile,
  kan: boolean,
): EngineState {
  const hand = state.hand;
  if (hand === null) return state;
  const need = kan ? 3 : 2;
  const { taken, rest } = takeKind(hand.hands[caller], tile, need);
  if (taken.length < need) return state;
  const meld: Meld = {
    type: kan ? "kan" : "pon",
    tiles: [tile, ...taken],
    concealed: false,
  };
  hand.hands[caller] = rest;
  recordPaoResponsible(hand, caller, discarder, hand.melds[caller], meld);
  hand.melds[caller] = [...hand.melds[caller], meld];
  removeCalledTileFromRiver(hand, discarder, tile);
  clearAllIppatsu(hand);
  hand.callsMade = true;
  hand.pendingDiscard = null;
  hand.passedRonSeats = [];
  hand.drawn = null;
  hand.fromKan = false;
  hand.turn = caller;
  if (kan) {
    const abortiveDraw = settleFourKanAbortiveDraw(state);
    if (abortiveDraw !== null) return abortiveDraw;
    drawKanReplacement(hand, caller);
    return state;
  }
  // 現物喰い替えは禁止(#105 / スペック1 1.4)。禁止牌は手牌から削らず
  // `forbiddenDiscards` として渡す。削ると `14 − 3×副露数` 枚に満たない手牌で
  // 向聴が評価される(#303)。
  //
  // 禁止牌の指定は現状**防御的**(到達不能)である。理由は #322 の前後で変わった:
  //
  // - #322 以前: `canPon`(need 2)と `canKan`(need 3)は同じガードを共有するため、
  //   3枚以上あれば必ず `kan=true` で上の分岐へ抜けた。つまり同種ちょうど2枚しか
  //   到達せず、門前に4枚目が残らなかった。
  // - #322 以降: 「向聴を悪化させる大明槓はポンへ落とす」判断により、同種3枚持ちの
  //   ままポンへ到達する経路が実在する(4,000半荘で86件)。門前に4枚目が残るように
  //   なったが、**その4枚目が打牌に選ばれることはない**。ポンへ落とすのは
  //   {@link kanKeepsShanten} が「4枚目を切った形(= 大明槓後の形)より厳密に良い
  //   打牌が存在する」と判定したときに限られ、{@link chooseDiscard} は向聴を最優先
  //   するため、常にその厳密に良い牌を選ぶからである。
  //
  // したがって喰い替えは向聴評価の側で既に排除されており、本指定はその不変条件が
  // 崩れた場合(打点優先の打牌方策など)への保険として残している。#325 では、この経路でも
  // `chooseDiscard` に渡す手牌から禁止牌を削らず `14 − 3×副露数` 枚を保つ境界契約を
  // engine レイヤの回帰テストで固定している。
  //
  // なお AI は人間側の `hand.ponnedKind`(`discard()` の no-op ガード用)を立てない。
  // 鳴きから打牌までが本関数内で同期的に完結し、公開境界の `discard()` を通らないため。
  const chosen = chooseAiDiscard(hand, caller, null, [tile]);
  return applyDiscard(state, caller, chosen);
}

/**
 * 進行を人間の意思決定点(自家の打牌 / 鳴き / ロン)まで、または局・半荘の終了まで進める。
 * AI 手番は自動で処理する(和了→カン→リーチ→手牌効率打牌、#98 / #169)。
 */
function pump(state: EngineState): EngineState {
  let s = state;
  for (let guard = 0; guard < 100000; guard++) {
    if (s.phase !== "playing" || s.hand === null) return s;
    // 鳴き連鎖などで自家の新しい意思決定点が生じたら、自動進行せず入力を待つ。
    if (s.pending !== null) return s;
    const hand = s.hand;
    const seat = hand.turn;
    const isHuman = seatOccupant(hand.seating, seat) === HUMAN_ID;

    // 1. ツモ(未ツモなら山から引く)。山が尽きていれば流局。
    if (hand.drawn === null) {
      if (isHaitei(hand.wall.remainingLiveTiles)) {
        return settleDraw(s);
      }
      const raw = hand.wall.draw();
      hand.drawn = autoPullNorth(hand, seat, raw);
      hand.fromKan = false;
      hand.tempMiss[seat] = false; // 同巡内フリテンは次の自ツモで解消。
    }

    const wallExhausted = isHaitei(hand.wall.remainingLiveTiles);
    const haitei = isHaiteiTsumo(hand.wall.remainingLiveTiles, hand.fromKan);

    if (isHuman) {
      if (hand.riichi[seat]) {
        // リーチ後は自動ツモ切りが基本(ツモ和了のみ選択の余地)。ただし送り槓に
        // ならない暗槓は許可する(標準慣行 / Q18・#116)。
        const tsumo = analyzeTsumo(s, seat, hand.drawn, haitei);
        const ankanTiles = riichiAnkanTiles(hand, seat);
        if (tsumo !== null || ankanTiles.length > 0) {
          return {
            ...s,
            pending: {
              kind: "humanDiscard",
              canTsumo: tsumo !== null,
              canRiichi: false,
              riichiTiles: [],
              ankanTiles,
              kakanTiles: [],
              forbiddenDiscards: [],
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

    // リーチ後はツモ和了を逃したら、合法な暗槓を除いて自動ツモ切り。
    if (hand.riichi[seat]) {
      const riichiKan = riichiAnkanTiles(hand, seat);
      if (riichiKan.length > 0) {
        s = applyAiAnkan(s, seat, riichiKan[0]);
        if (s.phase !== "playing" || s.pending !== null) return s;
        continue;
      }
      s = applyDiscard(s, seat, hand.drawn);
      if (s.phase !== "playing" || s.pending !== null) return s;
      continue;
    }

    // AI: 海底でなければ加槓→暗槓の順で合法なカンを宣言する。
    if (canKanOnDrawTurn(hand.drawn !== null, wallExhausted)) {
      const pool = [...hand.hands[seat], hand.drawn];
      const meldCount = hand.melds[seat].length;
      // 向聴を悪化させるカンは宣言しない(#304)。ドラ増加より手を崩さないことを優先する。
      const kakan = kakanCandidates(hand, seat, pool).filter((t) =>
        kanKeepsShanten(pool, meldCount, t, "kakan"),
      );
      if (kakan.length > 0) {
        s = applyAiKakan(s, seat, kakan[0]);
        if (s.phase !== "playing" || s.pending !== null) return s;
        continue;
      }
      // 暗槓候補の評価は加槓が無いときだけ行う(向聴評価は candidate 数ぶん走るため)。
      const ankan = ankanCandidates(pool).filter((t) =>
        kanKeepsShanten(pool, meldCount, t, "ankan"),
      );
      if (ankan.length > 0) {
        s = applyAiAnkan(s, seat, ankan[0]);
        if (s.phase !== "playing" || s.pending !== null) return s;
        continue;
      }
    }

    // 門前テンパイならリーチを宣言する。供託・合法牌は人間と同じ述語で判定する。
    const riichiState = applyAiRiichi(s, seat);
    if (riichiState !== s) {
      s = riichiState;
      if (s.phase !== "playing" || s.pending !== null) return s;
      continue;
    }

    const chosen = chooseAiDiscard(hand, seat, hand.drawn);
    s = applyDiscard(s, seat, chosen);
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

/**
 * カン宣言が手牌の向聴を悪化させないかを判定する(#304 / 大明槓は #322)。純関数・決定的。
 *
 * 方策としての位置づけ・閾値を設けない根拠・定量検証の結果は
 * [ADR-0002](../../../documents/adr/0002-ai-policy.md) を参照。
 *
 * 順子・塔子に使っている牌を槓に回すと、その牌が面子として固定されて待ちが崩れる
 * (例: `456s` を持った状態で4枚目の `5s` を暗槓すると `4s` `6s` が孤立する)。
 * 合法なら無条件に宣言していたため、AI が自らテンパイを落としていた。
 *
 * 比較は**打牌後13枚相当**の向聴に揃える(嶺上牌はこの時点で未知のため評価に含めない):
 * - カンしない場合の最良値 = `min over 打牌 d of shanten(pool − d, 副露数)`
 * - **暗槓**: 同種4枚を門前から抜き面子が1つ増える → `shanten(pool − 4枚, 副露数 + 1)`
 * - **加槓**: 既存ポンへ4枚目を移すだけで面子数は不変 → `shanten(pool − 1枚, 副露数)`
 *
 * 加槓後の形は「その4枚目を打牌した場合」と同一なので、最良打牌が別牌なら悪化と出る。
 *
 * ## 大明槓(#322)
 *
 * 他家の打牌を明槓する場合、「カンしない」の対案は**打牌しないこと**ではなく
 * **同じ牌をポンすること**である({@link shouldCallMeld} が真の局面でのみ呼ばれるため、
 * 鳴くこと自体は既に決まっている)。したがって基準値はポン後の最良打牌に取る:
 *
 * - 大明槓: 同種4枚(手牌3枚 + 鳴いた1枚)が抜けて面子が1つ増える → `shanten(pool − 4枚, 副露数 + 1)`
 * - ポン: 同種3枚が抜けて面子が1つ増え、手牌に4枚目が残る
 *   → `min over 打牌 d of shanten(pool − 3枚 − d, 副露数 + 1)`
 *
 * 基準値の打牌候補には**4枚目(鳴いた牌と同種)も含めてよい**。現物喰い替え禁止(#105)で
 * その打牌は実際には選べないが、除外しても判定結果は変わらないため明示的な除外を置いて
 * いない: 「ポンして4枚目を切った形」は大明槓後の形と牌姿が同一で `afterKan` に等しく、
 * 基準値は最小値を取るので `afterKan <= min(bestPon, afterKan) ⟺ afterKan <= bestPon`
 * が恒等的に成り立つ(除外の有無で分岐しない)。実際に除外コードを外すミューテーションを
 * 掛けても本判定のテストは落ちない。
 *
 * 悪化する場合は**鳴きを見送るのではなくポンへ落とす**。役牌の役を確定させる目的
 * ({@link shouldCallMeld})は達成しつつ、4枚目を手牌に残して面子・塔子として使える。
 *
 * ## 適用範囲
 *
 * - **リーチ後の暗槓**には掛けない。{@link canAnkanAfterRiichi} が待ち牌集合の不変を
 *   要求するため向聴は 0 のまま保証されており、本判定は常に真になる(無意味)。
 * - **人間(p0)**には掛けない。AI の方策であり、UI の選択肢を狭めてはならない。
 *
 * @param pool 評価対象の14枚相当。自ツモ番は「門前手牌 + ツモ牌」、大明槓は
 *   「門前手牌 + 鳴いた牌」(いずれも `14 − 3×副露数` 枚)。
 */
function kanKeepsShanten(
  pool: readonly Tile[],
  meldCount: number,
  tile: Tile,
  kind: "ankan" | "kakan" | "daiminkan",
): boolean {
  const need = kind === "kakan" ? 1 : 4;
  const { taken, rest } = takeKind(pool, tile, need);
  if (taken.length < need) return false;

  // 基準値(カンしない場合の最良の13枚相当)。自ツモ番は「打牌するだけ」、
  // 大明槓は「ポンして打牌する」が対案なので、評価するプールと副露数が異なる。
  let basePool = pool;
  let baseMelds = meldCount;
  if (kind === "daiminkan") {
    // ポン後の手牌 = 4枚のうち3枚を面子へ送り、4枚目を手牌に残した形。
    // `shanten` は赤フラグを見ないため、どの1枚を残すかは結果に影響しない。
    basePool = [...rest, taken[3]];
    baseMelds = meldCount + 1;
  }

  // 打牌候補は種別(赤フラグ無視)で1回だけ評価する({@link chooseDiscard} と同じ粒度)。
  // `tileKey` も `shanten` も赤フラグを見ないため、この重複排除は厳密に等価。
  let bestWithoutKan = Number.POSITIVE_INFINITY;
  const seen = new Set<string>();
  for (let i = 0; i < basePool.length; i++) {
    if (!seen.add(tileKey(basePool[i]))) continue;
    const without = [...basePool.slice(0, i), ...basePool.slice(i + 1)];
    const s = shanten(without, baseMelds);
    if (s < bestWithoutKan) bestWithoutKan = s;
  }
  const afterKan =
    kind === "kakan" ? shanten(rest, meldCount) : shanten(rest, meldCount + 1);
  return afterKan <= bestWithoutKan;
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

/** 2つの牌集合が「種別(赤フラグ無視)」として同一かを判定する。 */
function sameKindSet(a: readonly Tile[], b: readonly Tile[]): boolean {
  const ka = new Set(a.map((t) => tileKey(t)));
  const kb = new Set(b.map((t) => tileKey(t)));
  if (ka.size !== kb.size) return false;
  for (const k of ka) if (!kb.has(k)) return false;
  return true;
}

/**
 * リーチ後にツモ牌 `drawn` で暗槓できるか(標準慣行 / Q18・#116)。純関数・決定的。
 *
 * リーチは門前が前提のため、暗槓できるのは「手牌に暗刻(同種3枚)があり、その4枚目を
 * **ツモした**」場合に限られる。加えて送り槓(待ち・受け・面子構成が変わる槓)を禁じるため、
 * 次の2条件を**すべて**満たすときのみ許可する:
 *  ① 待ち不変: 暗槓の前後で和了牌(種別)の集合が変わらない。
 *  ② 面子構成の固定: 全ての待ちの全和了形で、その3枚が門前の**暗刻として確定**している
 *     (順子/雀頭に使い得ない・七対子/国士でしか和了れない待ちが混じらない)。
 *
 * これにより「七対子テンパイでの暗槓」「送り槓」はいずれも不可となる。
 *
 * @param concealed13 リーチ確定形の門前手牌13枚(ツモ牌を含まない)。
 * @param drawn       今ツモった牌(暗槓に使う4枚目)。
 */
export function canAnkanAfterRiichi(
  concealed13: readonly Tile[],
  drawn: Tile,
): boolean {
  // ツモ牌と同種が手牌にちょうど3枚 → ツモで4枚目(暗刻+ツモ)。手牌内に既に4枚ある
  // 状態や、ツモ牌以外での槓は標準慣行として不可(ツモ牌での暗槓に限る)。
  const xTiles = concealed13.filter((t) => sameKind(t, drawn));
  if (xTiles.length !== 3) return false;

  const before = waitingTiles(concealed13, []);
  if (before.length === 0) return false; // 非テンパイ(リーチ中は通常起きない)。
  // ツモ牌自身が待ち = 暗刻が確定していない(和了牌を槓に回す)→ 送り槓として不可。
  if (before.some((w) => sameKind(w, drawn))) return false;

  // ① 待ち不変チェック: 3枚を暗槓子へ移した「10枚+槓」の待ちと比較する。
  const withoutX = concealed13.filter((t) => !sameKind(t, drawn));
  const kanMeld: MeldInput = {
    tiles: [...xTiles, drawn],
    isKan: true,
    concealed: true,
  };
  if (!sameKindSet(before, waitingTiles(withoutX, [kanMeld]))) return false;

  // ② 面子構成の固定チェック: 全ての待ちの全和了形で drawn が門前暗刻であること。
  for (const win of before) {
    for (const form of decomposeAll([...concealed13, win], [])) {
      if (form.kind !== "standard") return false; // 七対子/国士では暗刻でない。
      const isAnkou = form.melds.some(
        (m) =>
          m.kind === "triplet" &&
          m.concealed &&
          m.suit === drawn.suit &&
          m.startRank === drawn.rank,
      );
      if (!isAnkou) return false;
    }
  }
  return true;
}

/**
 * リーチ後にツモ牌で暗槓できる牌を列挙する(0 or 1 枚)。
 * 判定は {@link canAnkanAfterRiichi}(標準慣行 / Q18)。
 */
function riichiAnkanTiles(hand: HandState, seat: SeatKey): Tile[] {
  const drawn = hand.drawn;
  if (drawn === null) return [];
  // 海底(ライブ牌 0 = 嶺上を引けない)ではカン不可(標準慣行・#128)。
  if (isHaitei(hand.wall.remainingLiveTiles)) return [];
  return canAnkanAfterRiichi(hand.hands[seat], drawn) ? [drawn] : [];
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
  const wallExhausted = isHaitei(hand.wall.remainingLiveTiles);
  const haitei = isHaiteiTsumo(hand.wall.remainingLiveTiles, hand.fromKan);
  const canTsumo =
    drawn !== null && analyzeTsumo(state, seat, drawn, haitei) !== null;

  const pool = [...hand.hands[seat], ...(drawn ? [drawn] : [])];
  const menzen = isConcealedHand(hand.melds[seat]);
  const occupant = seatOccupant(hand.seating, seat);
  // リーチ候補牌の算出ガード。可否の最終判定は canDeclareRiichi が担うが、点棒不足時は
  // 公開状態 `pending.riichiTiles` を空に保つ(挙動不変)ため、ここでも 1,000 点で足切りする。
  const riichiEligible =
    drawn !== null && menzen && state.points[occupant] >= RIICHI_STICK_POINTS;
  const riichiTiles = riichiEligible ? riichiDiscardTiles(hand, seat) : [];
  // 海底(ライブ牌 0 = 嶺上を引けない)ではカン(暗槓・加槓)不可(標準慣行・#128)。
  const canKan = canKanOnDrawTurn(drawn !== null, wallExhausted);
  const ankanTiles = canKan ? ankanCandidates(pool) : [];
  const kakanTiles = canKan ? kakanCandidates(hand, seat, pool) : [];
  // 喰い替え禁止: ポン直後のみ、ポンした牌と同種の打牌を禁止(現物喰い替え / スペック1 1.4)。
  const forbiddenDiscards = hand.ponnedKind !== null ? [hand.ponnedKind] : [];

  return {
    kind: "humanDiscard",
    canTsumo,
    canRiichi: canDeclareRiichi({
      hasDrawn: drawn !== null,
      isMenzen: menzen,
      points: state.points[occupant],
      hasTenpaiKeepingDiscard: riichiTiles.length > 0,
    }),
    riichiTiles,
    ankanTiles,
    kakanTiles,
    forbiddenDiscards,
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
  hand.discardHistory[seat] = [...hand.discardHistory[seat], discarded];
  hand.drawn = null;
  hand.fromKan = false;
  hand.ponnedKind = null; // 打牌で喰い替え禁止の窓(ポン直後の1打)を閉じる。
  hand.ippatsu[seat] = false; // 自分の打牌で一発の権利は消える。
  hand.pendingDiscard = { seat, tile: discarded };
  hand.passedRonSeats = [];
  return resolveDiscard(state);
}

/**
 * 自家がポン/明槓できるか(必要枚数 need = ポン2 / 明槓3)。
 * 自席が着席していれば純述語 {@link canCallMeldOnDiscard} へ委譲する(抜け番は不可)。
 */
function canHumanCall(
  hand: HandState,
  humanSeat: SeatKey | null,
  discarder: SeatKey,
  tile: Tile,
  haitei: boolean,
  need: number,
): boolean {
  if (humanSeat === null) return false; // 抜け番(未着席)は鳴けない。
  return canCallMeldOnDiscard({
    concealed: hand.hands[humanSeat],
    tile,
    need,
    inRiichi: hand.riichi[humanSeat],
    haitei,
    isDiscarder: humanSeat === discarder,
  });
}

/** 宣言牌がロンされなかったリーチの供託を確定する。 */
function commitPendingRiichi(
  state: EngineState,
  discarder: SeatKey,
): EngineState {
  const hand = state.hand;
  if (hand === null || hand.pendingRiichiSeat !== discarder) return state;
  const declarerId = seatOccupant(hand.seating, discarder);
  hand.pendingRiichiSeat = null;
  return {
    ...state,
    points: {
      ...state.points,
      [declarerId]: state.points[declarerId] - RIICHI_STICK_POINTS,
    },
    riichiSticks: state.riichiSticks + 1,
  };
}

/** 直前の打牌に対するロン/鳴き(頭ハネ順)を解決。未決着なら手番を送る。 */
function resolveDiscard(state: EngineState): EngineState {
  const hand = state.hand;
  if (hand === null || hand.pendingDiscard === null) return state;
  const { seat: discarder, tile } = hand.pendingDiscard;
  const haitei = isHaitei(hand.wall.remainingLiveTiles);
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

  // 宣言牌がロンされなかった時点でリーチ成立。鳴きの有無にかかわらず供託を確定する。
  // ロン時は settleWin が先に返るため、未成立の1,000点は支払われず、供託にも含まれない。
  const resolvedState = commitPendingRiichi(state, discarder);

  // 2. 鳴き(頭ハネと同じ巡目順)。大明槓をポンより優先する。
  for (const candidate of ronOrder(discarder)) {
    if (hand.passedRonSeats.includes(candidate)) continue;
    const canPon = canCallMeldOnDiscard({
      concealed: hand.hands[candidate],
      tile,
      need: 2,
      inRiichi: hand.riichi[candidate],
      haitei,
      isDiscarder: false,
    });
    const canKan = canCallMeldOnDiscard({
      concealed: hand.hands[candidate],
      tile,
      need: 3,
      inRiichi: hand.riichi[candidate],
      haitei,
      isDiscarder: false,
    });
    if (!canPon && !canKan) continue;
    if (candidate === humanSeat) {
      return {
        ...resolvedState,
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
    if (
      !shouldCallMeld({
        tile,
        melds: hand.melds[candidate],
        seatWind: SEAT_WIND_NUMBER[candidate],
        roundWind: roundWindNumber(state.round),
      })
    ) {
      continue;
    }
    // 向聴を悪化させる大明槓はポンへ落とす(#322)。対案は「鳴かない」ではなく
    // 「ポンする」なので、4枚目を手牌に残せるぶんポンが優越しうる。
    const useKan =
      canKan &&
      // `!canPon` は防御的(到達不能)。`canCallMeldOnDiscard` は `need` 以外のガード
      // (`isDiscarder` / `inRiichi` / `haitei`)が同一なので `canKan` ⇒ `canPon` が
      // 恒真であり、「ポン不可でカン可」の局面は存在しない。落とし先が無いまま
      // カンを見送る事故を防ぐために残している。
      (!canPon ||
        kanKeepsShanten(
          [...hand.hands[candidate], tile],
          hand.melds[candidate].length,
          tile,
          "daiminkan",
        ));
    return applyAiCall(resolvedState, candidate, discarder, tile, useKan);
  }

  // 3. ロン・鳴きなし → 手番送り。
  hand.pendingDiscard = null;
  hand.passedRonSeats = [];
  hand.turn = NEXT_SEAT[discarder];
  return resolvedState;
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
  // 天和/地和は「自分がまだ打牌していない」ことが条件のため打牌履歴を渡す(#395)。
  const blessing = blessingForTsumo(seat, hand.discardHistory, hand.callsMade);
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
    blessing,
  });
}

/**
 * 天和/地和の権利を実対局状態から導く。
 * 東の初回自摸は天和、南/西の最初の自摸は地和。いずれも局中の鳴きで消滅する。
 *
 * @param discardHistory 席ごとの**打牌履歴**(`HandState.discardHistory`)。条件は
 *   「その席がまだ一度も打牌していない」ことなので、鳴きで牌が抜ける表示用の河
 *   (`HandState.discards`)を渡してはならない(#395)。
 */
export function blessingForTsumo(
  seat: SeatKey,
  discardHistory: Readonly<Record<SeatKey, readonly Tile[]>>,
  callsMade: boolean,
): "heaven" | "earth" | undefined {
  if (callsMade || discardHistory[seat].length !== 0) return undefined;
  return seat === "east" ? "heaven" : "earth";
}

/**
 * ロン和了の役判定(フリテン不可・役なしは null)。
 * `chankan=true` は槍槓(加槓牌の横取り)の判定で、`chankan` 役(1翻)を付与する
 * (Q17 = 槍槓あり / #115)。槍槓は嶺上ツモ前の割り込みのため海底(`houtei`)とは併存しない。
 */
function analyzeRon(
  state: EngineState,
  seat: SeatKey,
  winningTile: Tile,
  houtei: boolean,
  chankan = false,
): WinAnalysis | null {
  const hand = state.hand;
  if (hand === null) return null;
  // フリテン(捨て牌・同巡内・リーチ後見逃し)ではロン不可。ツモのみ可(furiten モジュール)。
  const allowed = canRon(
    {
      concealedTiles: hand.hands[seat],
      melds: meldInputsOf(hand.melds[seat]),
      // 鳴かれて河から消えた牌も捨て牌フリテンの対象として残す(#395)。
      ownDiscardHistory: hand.discardHistory[seat],
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
    chankan,
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
  // リーチ宣言牌でのロンは宣言不成立。供託はまだ計上していないため、宣言フラグだけ戻す。
  if (
    winType === "ron" &&
    win.discarderSeat !== undefined &&
    hand.pendingRiichiSeat === win.discarderSeat
  ) {
    const declarer = win.discarderSeat;
    hand.riichi[declarer] = false;
    hand.doubleRiichi[declarer] = false;
    hand.ippatsu[declarer] = false;
    hand.pendingRiichiSeat = null;
  }
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

  // 役満祝儀(抜け番を含む和了者以外の3兄弟から各1,000ソシー・先着1名・数え役満対象外)。
  // 支払者 = 4兄弟のうち和了者を除く3人(その局の抜け番=北家も支払う)に確定
  // (Q14 確定・ユーザー承認 2026-07-17 / #129・spec 3.3③)。パオ(点数の責任払い)は
  // win-payment 側の別枠で、祝儀の支払者は責任者へ寄せない。
  const bonus: Record<PlayerId, number> = { ...state.bonus };
  if (score.isTrueYakuman && !score.isCountedYakuman) {
    const loserIds = state.order.filter((id) => id !== winnerId);
    const awarded = state.ledger.applyBonus({
      winnerId,
      loserIds,
      score,
    });
    if (awarded) {
      for (const id of loserIds) bonus[id] -= YAKUMAN_BONUS;
      bonus[winnerId] += YAKUMAN_BONUS * loserIds.length;
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
      summary: {
        kind: "win",
        label,
        deltas,
        winnerId,
        riichiWin: isRiichiWin,
        winDetails: {
          winType,
          dealer: isDealerWin,
          winnerName: nameOf(state, winnerId),
          winnerSeat,
          // 次局遷移で hand.hands は破棄されるため、和了確定時にコピーで固定する(#259)。
          hand: [...hand.hands[winnerSeat]],
          winningTile,
          yaku: analysis.yaku.map(({ name, han, yakuman }) => ({
            name,
            han,
            yakuman,
          })),
          yakuHan: analysis.han,
          dora: doraBreak,
          totalHan: analysis.han + doraBreak.total,
          yakuman: analysis.yakuman,
          category: score.category,
          honba: state.round.honba,
          riichiSticks: state.riichiSticks,
          payments: Object.entries(payment.deltas)
            .filter(([, delta]) => delta < 0)
            .map(([id, delta]) => ({
              name: nameOf(state, id as PlayerId),
              amount: -delta,
            })),
          stickPayout: payment.stickPayout,
        },
      },
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

export interface RoundConclusion {
  readonly outcome: RoundOutcome;
  readonly isDraw: boolean;
  readonly summary: RoundSummary;
}

/**
 * 局を締め、終了条件を評価する。半荘継続なら次局遷移を保持し `roundEnd` に、
 * 終了なら `gameEnd`(結果確定)へ。
 *
 * spec 2.8 の終了3経路(トビ / 南4完了 / 南4親3万超トップやめ)を判定する中核。
 * `settleWin`/`settleDraw` からのみ呼ばれる内部遷移だが、各終了分岐を決定的に
 * 直接検証できるよう **テスト用に公開**している(issue #114 / spec 2.8)。
 */
export function finishRound(
  state: EngineState,
  conclusion: RoundConclusion,
): EngineState {
  const { outcome, isDraw, summary } = conclusion;
  const round = state.round;
  const oorasu = isOorasu(round);
  const tobi = ALL_IDS.some((id) => state.points[id] < 0);
  const dealerId = dealerOf(round);
  const dealerPoints = state.points[dealerId];
  // 親トップやめの「トップ」= 抜け番を含む4兄弟全員に対する**単独最高**(Q19 確定・ユーザー承認)。
  // 抜け番(その局は対局外の第4者)の持ち点も比較対象に含め、同点最高は「単独トップ」でないため
  // 不成立(継続)とする。厳密比較: 親が自分以外の全員より**真に**高いときのみ true。
  const dealerIsTop = ALL_IDS.every(
    (id) => id === dealerId || state.points[id] < dealerPoints,
  );

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

/**
 * 残存供託リーチ棒の帰属先 = 抜け番を含む4兄弟全員の最終持ち点で**最高**のプレイヤーID。
 *
 * 単独最高ならその1人(Q15 確定・1位取得 / #130)。**同点最高(単独1位が存在しない)場合は
 * 席順(固定円環 `order` の先頭 = 起家に近い順 = 供託の上家取り慣行に準ずる)で最上位の1人**を
 * 返す(Q20 確定・ユーザー承認 2026-07-17 = 同点最高のうち席順上位が総取り / issue #131)。
 *
 * `order[0]` が起家(初局の親)で半荘を通じ不変(`round/seat` の `PlayerRing`)。実装は席順に
 * 走査し、**厳密に**高い持ち点でのみ更新する(同点は先着 = 席順上位を保持)ため一意に決まる。
 */
function residualRiichiRecipient(
  order: PlayerRing<PlayerId>,
  points: Record<PlayerId, number>,
): PlayerId {
  let topId: PlayerId = order[0];
  for (const id of order) {
    if (points[id] > points[topId]) topId = id;
  }
  return topId;
}

/** 半荘を締め、ソシー精算(素点+ウマ+オカ+祝儀)を確定する。 */
function endGame(state: EngineState): EngineState {
  // 半荘終了時に場へ残った供託リーチ棒(`state.riichiSticks` > 0)は、**最終持ち点が最高**
  // (抜け番含む全員に対する厳密比較 = Q19 整合)のプレイヤーの素点へ加算する(Q15 確定・
  // ユーザー承認 2026-07-17 = 1位取得 / issue #130)。**同点最高で単独1位が存在しない場合は
  // 席順(起家に近い順)で最上位の1人が総取り**する(Q20 確定・ユーザー承認 2026-07-17 =
  // 同点最高のうち席順上位が総取り / issue #131)。`settleWin` は和了者が供託を回収して 0 に
  // するため、残存するのは最終局が `settleDraw`(流局・トビ流局含む)で終わったとき。帰属先が
  // 一意に定まるためソシー合計は常に zero-sum を保つ(消失で総和が目減りしない)。
  const residual = state.riichiSticks * RIICHI_STICK_POINTS;
  const points: Record<PlayerId, number> = { ...state.points };
  let riichiSticks = state.riichiSticks;
  let lastRound = state.lastRound;
  if (residual > 0) {
    const recipient = residualRiichiRecipient(state.order, points);
    points[recipient] += residual;
    riichiSticks = 0; // 供託を素点へ移し、場から下ろす。
    // gameEnd の決着表示は「局開始持ち点 + 表示デルタ = 表示持ち点」「供託カウント 0 と整合」
    // を保つ必要がある(#282)。和了決着では複数局分の供託回収(`stickPayout`)が和了者の
    // デルタに含まれるのと同じ扱いで、残存供託の受取も最終局デルタへ畳み込み、内訳を
    // `residualSticks` に記録して hint 表示・事後検算を可能にする。
    if (lastRound !== null) {
      lastRound = {
        ...lastRound,
        deltas: {
          ...lastRound.deltas,
          [recipient]: lastRound.deltas[recipient] + residual,
        },
        residualSticks: {
          recipientId: recipient,
          recipientName: nameOf(state, recipient),
          sticks: state.riichiSticks,
          points: residual,
        },
      };
    }
  }

  const finalPoints = ALL_IDS.map((id) => ({
    playerId: id,
    points: points[id],
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
      rawScore: points[id] - RETURN_POINTS,
      uma: umaTotal,
      bonus: state.bonus[id],
      soshiiTotal: state.ledger.balanceOf(id),
    };
  });

  return {
    ...state,
    points,
    riichiSticks,
    lastRound,
    phase: "gameEnd",
    pending: null,
    result,
  };
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
  // UI や永続化ジャーナルから存在しない牌を渡されても、applyDiscard の内部
  // フォールバック（末尾牌）で別の牌を捨てて状態を壊さないよう公開境界で拒否する。
  const available = [
    ...state.hand.hands[seat],
    ...(state.hand.drawn === null ? [] : [state.hand.drawn]),
  ];
  if (!available.some((candidate) => sameTile(candidate, useTile)))
    return state;
  // 喰い替え禁止(現物): ポン直後にポンした牌と同種を切るのは非合法手 → no-op で拒否。
  const ponnedKind = state.hand.ponnedKind;
  if (ponnedKind !== null && isKuikaeForbidden(ponnedKind, useTile)) {
    return state;
  }
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
  hand.doubleRiichi[seat] =
    // 「まだ一度も打牌していない」= 履歴が空(表示用の河は鳴きで減りうる / #395)。
    hand.discardHistory[seat].length === 0 && !hand.callsMade;
  hand.pendingRiichiSeat = seat;
  const callsMadeBeforeDeclaration = hand.callsMade;

  const s1: EngineState = {
    ...state,
    pending: null,
  };
  const s2 = applyDiscard(s1, seat, tile);
  // 一発の権利を開く(applyDiscard 内で一旦 false にされるため後付けで true)。
  if (
    s2.phase === "playing" &&
    s2.hand !== null &&
    s2.hand.callsMade === callsMadeBeforeDeclaration
  ) {
    s2.hand.ippatsu[seat] = true;
  }
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
  state = commitPendingRiichi(state, discarder);
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
  // 喰い替え禁止: 直後の打牌でこの牌種(ポンした牌)を切れないよう記録する(スペック1 1.4)。
  hand.ponnedKind = tile;
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
  state = commitPendingRiichi(state, discarder);
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
  const abortiveDraw = settleFourKanAbortiveDraw(state);
  if (abortiveDraw !== null) return abortiveDraw;
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
  // 海底(ライブ牌 0 = 嶺上を引けない)ではカン不可(#128)。pending でも空にしているが
  // 直接呼び出しに対する防御として no-op で拒否する。
  if (isHaitei(hand.wall.remainingLiveTiles)) return state;
  const seat = humanSeatOf(hand);
  if (seat === null || hand.turn !== seat || hand.drawn === null) return state;

  const pool = [...hand.hands[seat], hand.drawn];
  const { taken, rest } = takeKind(pool, tile, 4);
  if (taken.length < 4) return state;

  // 国士無双の暗槓槍槓(Q17 フォローアップ・#126・ユーザー承認・国士のみ暗槓槍槓可)。
  // 通常の槍槓は加槓のみ対象だが(`declareKakan`)、国士無双テンパイの他家に限り、
  // 暗槓の4枚目に対しても槍槓ロンを認める。応答者の和了形が国士無双(`thirteenOrphans`)で
  // ある場合のみ横取り成立とし、それ以外の役(標準/七対子)では暗槓に対する槍槓は不可
  // (= 暗槓成立・従来どおり)。頭ハネ・フリテンは通常ロンと同じく `ronOrder` / `analyzeRon`
  // を再利用する(判定は `resolveChankan` に集約 / #208)。`declareAnkan` は自家(p0)
  // 専用のため応答者は必ず他家(AI)= 即 `settleWin` し入力待ちは発生しない。
  const chankan = resolveChankan(
    { ...state, pending: null },
    seat,
    taken[0],
    "ankan",
  );
  if (chankan !== null) return chankan;

  hand.hands[seat] = rest;
  hand.drawn = null;
  hand.melds[seat] = [
    ...hand.melds[seat],
    { type: "kan", tiles: taken, concealed: true },
  ];
  clearAllIppatsu(hand);
  hand.callsMade = true;
  const abortiveDraw = settleFourKanAbortiveDraw(state);
  if (abortiveDraw !== null) return abortiveDraw;
  drawKanReplacement(hand, seat); // 嶺上ツモ
  // リーチ中の暗槓(Q18・#116)は打牌の自由が無いため、pump に委ねて嶺上ツモ和了 /
  // 連続暗槓 / 自動ツモ切りを解決する(通常の打牌待ちに戻さない)。
  if (hand.riichi[seat]) return pump({ ...state, pending: null });
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
  // 海底(ライブ牌 0 = 嶺上を引けない)ではカン不可(#128)。pending でも空にしているが
  // 直接呼び出しに対する防御として no-op で拒否する。
  if (isHaitei(hand.wall.remainingLiveTiles)) return state;
  const seat = humanSeatOf(hand);
  if (seat === null || hand.turn !== seat || hand.drawn === null) return state;

  const pool = [...hand.hands[seat], hand.drawn];
  const target = hand.melds[seat].find(
    (m) => m.type === "pon" && sameKind(m.tiles[0], tile),
  );
  if (!target) return state;
  const { taken, rest } = takeKind(pool, tile, 1);
  if (taken.length < 1) return state;
  const kakanTile = taken[0];

  // 槍槓(チャンカン / Q17 = 槍槓あり・#115): 加槓宣言牌でロンできる他家がいれば、
  // 加槓は不成立(牌は手に戻らず横取り)= 槍槓ロンを成立させる。頭ハネ(上家取り)は
  // 通常ロンと同じ `ronOrder` に従い、最先の1人のみが和了する。加槓者は放銃者(discarder)
  // として支払う。応答者は既存のフリテン・役判定(`analyzeRon` + `chankan` 役)を再利用する
  // (判定は `resolveChankan` に集約 / #208)。`declareKakan` は自家(p0)専用のため
  // 応答者は必ず他家(AI)= 即 `settleWin` し入力待ちは発生しない。
  const chankan = resolveChankan(
    { ...state, pending: null },
    seat,
    kakanTile,
    "kakan",
  );
  if (chankan !== null) return chankan;

  // 槍槓なし → 加槓成立。嶺上ツモへ進む。
  hand.hands[seat] = rest;
  hand.drawn = null;
  hand.melds[seat] = hand.melds[seat].map((m) =>
    m === target
      ? { type: "kan", tiles: [...m.tiles, kakanTile], concealed: false }
      : m,
  );
  clearAllIppatsu(hand);
  hand.callsMade = true;
  const abortiveDraw = settleFourKanAbortiveDraw(state);
  if (abortiveDraw !== null) return abortiveDraw;
  drawKanReplacement(hand, seat); // 嶺上ツモ
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
  const haitei = isHaiteiTsumo(
    state.hand.wall.remainingLiveTiles,
    state.hand.fromKan,
  );
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

/** 自家のロン和了宣言(通常ロン / 槍槓ロン)。 */
export function declareRon(state: EngineState): EngineState {
  if (
    state.phase !== "playing" ||
    state.pending?.kind !== "humanReact" ||
    !state.pending.canRon ||
    state.hand === null
  ) {
    return state;
  }
  const { tile, from, chankan } = state.pending;
  const seat = seatOfPlayer(state.hand.seating, HUMAN_ID);
  if (seat === null) return state;
  // 槍槓は嶺上ツモ前の割り込みのため海底(河底)とは併存しない(#115)。
  const haitei =
    chankan === undefined && isHaitei(state.hand.wall.remainingLiveTiles);
  const analysis = analyzeRon(state, seat, tile, haitei, chankan !== undefined);
  if (analysis === null) return state;
  // 暗槓への槍槓は国士無双のみ(Q17 フォローアップ・#126)。pending 構築時にも
  // 検証済みだが、直接呼び出しに対する防御として再確認する。
  if (chankan === "ankan" && analysis.form.kind !== "thirteenOrphans") {
    return state;
  }
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
  // ロンを見送った場合はフリテン(同巡内 / リーチ後は恒久)。槍槓の見逃しも同じ扱い(#208)。
  if (state.pending.canRon) {
    hand.tempMiss[seat] = true;
    if (hand.riichi[seat]) hand.riichiMiss[seat] = true;
  }
  hand.passedRonSeats = [...hand.passedRonSeats, seat];

  // 槍槓のスルー(#208): 頭ハネの残候補(他家=AI)を解決し、誰も横取りしなければ
  // 中断していた槓(加槓 / 暗槓)を成立させて嶺上補充 → 進行を再開する。
  const chankan = state.pending.chankan;
  if (chankan !== undefined) {
    const { tile, from } = state.pending;
    const cleared: EngineState = { ...state, pending: null };
    const remaining = resolveChankan(cleared, from, tile, chankan);
    // 自家はスルー済み(passedRonSeats)のため、残候補の槍槓は他家の即和了のみ。
    if (remaining !== null) return remaining;
    const completed =
      chankan === "kakan"
        ? completeAiKakan(cleared, from, tile)
        : completeAiAnkan(cleared, from, tile);
    // スルーの対象は**この槓宣言**のみ。槓成立でこの宣言への応答は完了したため、
    // passedRonSeats を戻す(嶺上ツモからの連続カンは別宣言 = 新たな槍槓判定。
    // なお同巡内は tempMiss が立つため、いずれにせよ自家のロンは次の自ツモまで不可)。
    if (completed.hand !== null) completed.hand.passedRonSeats = [];
    return pump(completed);
  }

  const after = resolveDiscard({ ...state, pending: null });
  // AIが鳴いた直後の打牌に対して新たな自家応答が生じた場合は、その入力待ちを保持する。
  if (after.pending !== null) return after;
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
