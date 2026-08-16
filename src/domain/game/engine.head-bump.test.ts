import { describe, expect, it } from "vitest";
import { parseTile, parseTiles } from "@/domain/hand/notation";
import { type RoundNumber, seatingOf } from "@/domain/round/round";
import { SEATED_SEATS, type Seating } from "@/domain/round/seat";
import type { Tile } from "@/domain/tiles/tile";
import {
  createGame,
  discard,
  type EngineState,
  type PlayerId,
  passRon,
  type SeatKey,
} from "./engine";

/**
 * 頭ハネ(上家取り)の**本番経路**テスト(issue #311)。
 *
 * SSOT: `docs/四兄弟麻雀ルール.md` §3「ダブロン等が発生した場合は上家取り」/
 * `documents/spec/game-flow.md` 2.4 完了条件「Given 2人が同時ロン / When 精算 /
 * Then 上家1人のみ和了(頭ハネ)」。
 *
 * 従来この完了条件を検証していたのは槍槓経路(`engine.chankan.test.ts` /
 * `engine.kokushi-ankan-chankan.test.ts`)だけで、**通常打牌**に対する同時ロンは
 * 未検証だった。本ファイルは `resolveDiscard` の頭ハネループ(engine 内 `ronOrder`)を
 * 通常打牌で直接固定する。
 *
 * ## 空振り防止の作り
 * 「南が勝つ」だけを見ると、西がそもそもロンできないせいで通っているのか区別できない。
 * そこで各同時ロンケースに対し、**敗者側が単独なら和了できる**ことを対照ケースで
 * 固定する(下の「単独なら〜」テスト群)。両者が和了可能であることを示したうえで
 * 初めて、勝者の固定が頭ハネの検証になる。
 */

/** 3p のカンチャン待ち(門前・断么九)。喰いタン無しのため門前で組む。 */
const WAIT_3P_A = "2p 4p 234m 678m 234s 66s";
/** 同じく 3p 待ち(断么九)。A と別形にして席ごとの手牌を区別する。 */
const WAIT_3P_B = "2p 4p 234m 678m 678s 88s";
/** 3p では和了できない手牌(9s/5s のシャンポン待ち)。 */
const NO_WAIT_3P = "1p 1p 1p 9p 9p 9p 1s 1s 1s 9s 9s 5s 5s";
/** 放銃者が抱える、3p を含まない手牌。 */
const DISCARDER_HAND = "1p 1p 9p 9p 1m 1m 9m 9m 1s 1s 9s 9s 5m";

const RON_TILE = "3p";

/** 自家。`discard()` は自家の席の手番でしか通らないため、常に打牌者に据える。 */
const HUMAN: PlayerId = "p0";

/**
 * 対照ケース(単独ロン)と本命ケース(同時ロン)で同じ seed を使う。
 * 同一の壁牌・ドラのもとで「単独なら和了できる」ことを示して初めて、
 * 同時ロンの勝者固定が頭ハネの検証になる。
 */
const SEED_EAST_DISCARDS = 3114;
const SEED_SOUTH_DISCARDS = 3115;

/**
 * 門前手牌(13枚)としてパースする。枚数を誤ったフィクスチャは、engine が
 * 例外を投げないまま「あり得ない局面」を検証してしまうため、ここで弾く。
 */
function expectConcealed13(notation: string): Tile[] {
  const tiles = parseTiles(notation);
  if (tiles.length !== 13) {
    throw new Error(
      `門前手牌は13枚である必要がある: "${notation}" は ${tiles.length} 枚`,
    );
  }
  return tiles;
}

/**
 * `p0`(自家)を任意の席に据えた席割り。抜け番は常に p3。
 *
 * 残り2席へは席順(東→南→西)に p1・p2 を詰める。例えば自家=南なら
 * 東=p1 / 西=p2 になる。
 */
function seatingWithHumanAt(humanSeat: SeatKey): Seating<PlayerId> {
  const rest: PlayerId[] = ["p1", "p2"];
  const seats: SeatKey[] = ["east", "south", "west"];
  const assign = {} as Record<SeatKey, PlayerId>;
  for (const seat of seats) {
    assign[seat] = seat === humanSeat ? "p0" : (rest.shift() as PlayerId);
  }
  return { ...assign, benchWarmer: "p3" };
}

/**
 * 与えられた席割り・`round` のもとで、自家(p0)が `humanSeat` から `RON_TILE` を
 * 打とうとしている局面を組む(`armDiscard` / `armDealerHeadBump` の共通コア)。
 *
 * `hands` で各席の手牌を指定する。自家の席は打牌者なので `DISCARDER_HAND` 固定。
 *
 * ⚠️ 配牌を上書きするだけで**山からは差し引かない**ため、同一牌が場に4枚超
 * 存在しうる。ロン判定と頭ハネ順の検証専用であり、残り枚数に依存するテスト
 * (海底・受け入れ枚数など)へ流用しないこと。
 */
function armDiscardWith(params: {
  base: EngineState;
  /** この局の `round`(席割りの導出元と一致させる責任は呼び出し側にある)。 */
  round: EngineState["round"];
  seating: Seating<PlayerId>;
  /** 自家(p0)の席 = 打牌者。`seating` と整合していることをここで検査する。 */
  humanSeat: SeatKey;
  hands: Partial<Record<SeatKey, string>>;
  riichiSticks?: number;
}): EngineState {
  const { base, round, seating, humanSeat } = params;
  const hand = base.hand;
  if (hand === null)
    throw new Error("hand should exist right after createGame");
  // `discard()` は自家の席の手番でしか通らない。ここが食い違うと打牌が no-op になり、
  // 「和了しなかった」ことを頭ハネの検証と誤認しかねないため、フィクスチャ側で弾く。
  if (seating[humanSeat] !== HUMAN)
    throw new Error(
      `打牌者の席には自家(${HUMAN})が座っている必要がある: ${humanSeat} = ${seating[humanSeat]}`,
    );

  for (const seat of SEATED_SEATS) {
    const notation =
      seat === humanSeat ? DISCARDER_HAND : (params.hands[seat] ?? NO_WAIT_3P);
    hand.hands[seat] = expectConcealed13(notation);
    hand.melds[seat] = [];
    hand.discards[seat] = []; // フリテン回避
    hand.riichi[seat] = false;
    hand.riichiMiss[seat] = false;
    hand.tempMiss[seat] = false;
  }
  hand.drawn = { tile: parseTile(RON_TILE), source: "live" };
  hand.turn = humanSeat;

  return {
    ...base,
    round,
    riichiSticks: params.riichiSticks ?? base.riichiSticks,
    hand: { ...hand, seating },
    pending: {
      kind: "humanDiscard",
      canTsumo: false,
      canRiichi: false,
      riichiTiles: [],
      ankanTiles: [],
      kakanTiles: [],
      forbiddenDiscards: [],
      locked: false,
    },
  };
}

/**
 * 自家(p0)が `humanSeat` に座り、`RON_TILE` を打とうとしている局面を組む。
 *
 * 席割りは `seatingWithHumanAt`(抜け番を p3 に固定した便宜的な割り当て)で与える。
 * **円環から導出できる席割りとは限らない**ため、局進行(連荘・親流れ)を見るテストでは
 * なく、ロン判定と頭ハネ順の検証にのみ使うこと(局進行は `armDealerHeadBump` を使う)。
 *
 * ⚠️ `armDiscardWith` と同じく**山からは牌を差し引かない**。残り枚数に依存するテスト
 * (海底・受け入れ枚数など)へ流用しないこと。
 */
function armDiscard(params: {
  seed: number;
  humanSeat: SeatKey;
  hands: Partial<Record<SeatKey, string>>;
  /** 場に残っている供託リーチ棒の本数(既定 0)。 */
  riichiSticks?: number;
  /** 本場(既定 0)。 */
  honba?: number;
}): EngineState {
  const base = createGame({ seed: params.seed });
  return armDiscardWith({
    base,
    round: { ...base.round, honba: params.honba ?? base.round.honba },
    seating: seatingWithHumanAt(params.humanSeat),
    humanSeat: params.humanSeat,
    hands: params.hands,
    riichiSticks: params.riichiSticks,
  });
}

/** `RON_TILE` を打って解決させる。 */
function discardRonTile(state: EngineState): EngineState {
  return discard(state, parseTile(RON_TILE));
}

describe("engine: 通常打牌に対する頭ハネ(上家取り / spec 2.4・#311)", () => {
  describe("前提の固定: 各席は単独ならこの牌で和了できる", () => {
    it("放銃者=東 のとき南は単独ロンできる", () => {
      const after = discardRonTile(
        armDiscard({
          seed: SEED_EAST_DISCARDS,
          humanSeat: "east",
          hands: { south: WAIT_3P_A },
        }),
      );
      expect(after.lastRound?.kind).toBe("win");
      expect(after.lastRound?.winnerId).toBe("p1"); // 南
    });

    it("放銃者=東 のとき西は単独ロンできる", () => {
      const after = discardRonTile(
        armDiscard({
          seed: SEED_EAST_DISCARDS,
          humanSeat: "east",
          hands: { west: WAIT_3P_B },
        }),
      );
      expect(after.lastRound?.kind).toBe("win");
      expect(after.lastRound?.winnerId).toBe("p2"); // 西
    });

    it("放銃者=南 のとき東は単独ロンできる", () => {
      const after = discardRonTile(
        armDiscard({
          seed: SEED_SOUTH_DISCARDS,
          humanSeat: "south",
          hands: { east: WAIT_3P_A },
        }),
      );
      expect(after.lastRound?.kind).toBe("win");
      expect(after.lastRound?.winnerId).toBe("p1"); // 東
    });

    it("放銃者=南 のとき西は単独ロンできる", () => {
      const after = discardRonTile(
        armDiscard({
          seed: SEED_SOUTH_DISCARDS,
          humanSeat: "south",
          hands: { west: WAIT_3P_B },
        }),
      );
      expect(after.lastRound?.kind).toBe("win");
      expect(after.lastRound?.winnerId).toBe("p2"); // 西
    });
  });

  it("東の打牌に南・西が同時ロン → 下家(南)のみ和了し西は和了しない", () => {
    const armed = armDiscard({
      seed: SEED_EAST_DISCARDS,
      humanSeat: "east",
      hands: { south: WAIT_3P_A, west: WAIT_3P_B },
    });
    const before = { ...armed.points };

    const after = discardRonTile(armed);

    expect(after.phase).toBe("roundEnd");
    expect(after.lastRound?.kind).toBe("win");
    // ronOrder(east) = [south, west] → 上家取りで南(p1)のみ和了。
    expect(after.lastRound?.winnerId).toBe("p1");
    // ダブロンなし: 西(p2)は和了者に含まれず点も動かない。
    expect(after.lastRound?.deltas.p2).toBe(0);
    expect(after.points.p2).toBe(before.p2);
    // 抜け番(p3)はロン精算に一切関与しない。
    expect(after.lastRound?.deltas.p3).toBe(0);
    // 放銃者(p0=東)が支払い、南が受け取る。
    expect(after.lastRound?.deltas.p1).toBeGreaterThan(0);
    expect(after.lastRound?.deltas.p0).toBeLessThan(0);
  });

  it("南の打牌に西・東が同時ロン → 下家(西)のみ和了(回転方向の固定)", () => {
    // 放銃者を変えて回転方向を固定する。ronOrder が「上家(前の席)から」など
    // 逆回りに退行すると、ここで東(p1)が勝ってしまい落ちる。
    const armed = armDiscard({
      seed: SEED_SOUTH_DISCARDS,
      humanSeat: "south",
      hands: { west: WAIT_3P_B, east: WAIT_3P_A },
    });

    const after = discardRonTile(armed);

    expect(after.phase).toBe("roundEnd");
    expect(after.lastRound?.kind).toBe("win");
    // ronOrder(south) = [west, east] → 西(p2)が上家取り。
    expect(after.lastRound?.winnerId).toBe("p2");
    expect(after.lastRound?.deltas.p1).toBe(0); // 東は和了していない
    expect(after.lastRound?.deltas.p3).toBe(0); // 抜け番は関与しない
  });

  it("同時ロン時、供託リーチ棒と本場も上家(南)が総取りする", () => {
    // SSOT: `documents/spec/game-flow.md` 2.4「供託・本場 | ダブロン相当時も上家が取得」。
    // issue #311 が実害に挙げた「供託回収先」を固定する。
    //
    // 供託・本場の有無だけを変えた2局面の差分を取ることで、和了点そのものに
    // 依存せず「増分が誰に乗るか」を直接見る(絶対値の決め打ちを避ける)。
    const sticks = 2;
    const honba = 1;
    const hands = { south: WAIT_3P_A, west: WAIT_3P_B };

    const plain = discardRonTile(
      armDiscard({ seed: SEED_EAST_DISCARDS, humanSeat: "east", hands }),
    );
    const withPot = discardRonTile(
      armDiscard({
        seed: SEED_EAST_DISCARDS,
        humanSeat: "east",
        hands,
        riichiSticks: sticks,
        honba,
      }),
    );

    // 前提: どちらも南(p1)の頭ハネ和了。
    expect(plain.lastRound?.winnerId).toBe("p1");
    expect(withPot.lastRound?.winnerId).toBe("p1");

    const delta = (s: EngineState, id: "p0" | "p1" | "p2") =>
      s.lastRound?.deltas[id] ?? 0;

    // 供託 2本 = 2,000点 + 本場 1本 = 300点 を、上家取りした南が受け取る。
    expect(delta(withPot, "p1") - delta(plain, "p1")).toBe(
      sticks * 1000 + honba * 300,
    );
    // 本場分は放銃者(東)が追加で支払う。供託は場からの回収なので放銃者負担ではない。
    expect(delta(withPot, "p0") - delta(plain, "p0")).toBe(-(honba * 300));
    // 敗者側(西)には供託も本場も一切回らない。
    expect(delta(withPot, "p2")).toBe(0);
    expect(delta(plain, "p2")).toBe(0);
    // 供託は和了者が回収済み → 場に残らない。
    expect(withPot.riichiSticks).toBe(0);
  });

  it("自家がロンをスルーすると残る下家が横取りする(通常打牌)", () => {
    // 東(AI)の打牌に対し、南(自家)と西(AI)がともにロン可能な局面。
    // AI の打牌牌種は制御できないため、`applyDiscard` が組むのと同じ
    // `pendingDiscard` + `humanReact` を直接据えて `passRon` の分岐を固定する。
    const base = createGame({ seed: 3116 });
    const hand = base.hand;
    if (hand === null) throw new Error("hand should exist");

    const ronTile = parseTile(RON_TILE);
    for (const seat of SEATED_SEATS) {
      hand.melds[seat] = [];
      hand.discards[seat] = [];
      hand.riichi[seat] = false;
      hand.riichiMiss[seat] = false;
      hand.tempMiss[seat] = false;
    }
    hand.hands.east = expectConcealed13(DISCARDER_HAND);
    hand.hands.south = expectConcealed13(WAIT_3P_A);
    hand.hands.west = expectConcealed13(WAIT_3P_B);
    hand.discards.east = [ronTile]; // 打牌済みの河
    hand.pendingDiscard = { seat: "east", tile: ronTile, haitei: false };
    hand.passedRonSeats = [];
    hand.drawn = null;
    hand.turn = "east";

    const armed: EngineState = {
      ...base,
      hand: { ...hand, seating: seatingWithHumanAt("south") },
      pending: {
        kind: "humanReact",
        tile: ronTile,
        from: "east",
        canRon: true,
        canPon: false,
        canKan: false,
      },
    };

    const after = passRon(armed);

    expect(after.phase).toBe("roundEnd");
    expect(after.lastRound?.kind).toBe("win");
    // 南(自家)はスルー済み → ronOrder(east) の次候補=西(p2)が横取りする。
    expect(after.lastRound?.winnerId).toBe("p2");
    expect(after.lastRound?.deltas.p0).toBe(0); // 自家は和了していない
    // 見逃しは同巡内フリテン。
    expect(after.hand?.tempMiss.south).toBe(true);
  });

  it("自家がポンをスルーすると同じ打牌を再提示せず進行する(passedRonSeats / 通常打牌)", () => {
    // ロンのスルーは `tempMiss`(同巡内フリテン)でも再提示が塞がれるため、
    // `passedRonSeats` が単独で効くのは**ロン以外(ポン/カン)のスルー**である。
    // ここが抜けると同じ打牌への鳴きを無限に提示し直して進行が止まる。
    const base = createGame({ seed: 3117 });
    const hand = base.hand;
    if (hand === null) throw new Error("hand should exist");

    // 白(三元牌)。ポンを見送るのは自家(南)であり AI の判断は関与しない
    // (西は 5z を持たないため競合しない)。
    const ponTile = parseTile("5z");
    for (const seat of SEATED_SEATS) {
      hand.melds[seat] = [];
      hand.discards[seat] = [];
      hand.riichi[seat] = false;
      hand.riichiMiss[seat] = false;
      hand.tempMiss[seat] = false;
    }
    hand.hands.east = expectConcealed13(DISCARDER_HAND);
    // 自家(南)は 5z を2枚持ちでポン可能。3p 待ちではないのでロンは提示されない。
    hand.hands.south = expectConcealed13("5z 5z 234m 678m 234s 66s");
    hand.hands.west = expectConcealed13(NO_WAIT_3P);
    hand.discards.east = [ponTile];
    hand.pendingDiscard = { seat: "east", tile: ponTile, haitei: false };
    hand.passedRonSeats = [];
    hand.drawn = null;
    hand.turn = "east";

    const armed: EngineState = {
      ...base,
      hand: { ...hand, seating: seatingWithHumanAt("south") },
      pending: {
        kind: "humanReact",
        tile: ponTile,
        from: "east",
        canRon: false,
        canPon: true,
        canKan: false,
      },
    };

    const after = passRon(armed);

    // 同じ打牌へのポンを再提示していない。手番は放銃者の下家=自家(南)へ送られ、
    // 自分のツモ番の打牌待ちになる。
    expect(after.pending?.kind).toBe("humanDiscard");
    expect(after.hand?.turn).toBe("south");
    expect(after.hand?.melds.south).toHaveLength(0); // ポンは成立していない
  });
});

/**
 * 頭ハネ(上家取り)と**親の連荘・親流れ**の交差(issue #326)。
 *
 * ## SSOT から導いた期待挙動
 * - `documents/spec/game-flow.md` 2.7「東場・南場ともに親はテンパイで連荘(**親和了でも連荘**)」
 *   → 親が頭ハネで勝てば `dealerContinues`。
 * - 同 2.7「**連荘時は席・抜け番・局番号を据え置く**(2.5 の回転を行わない)。本場のみ +1」
 *   → 次局は `wind`/`roundNumber`/`order` 据え置き・`honba` +1。
 * - 同 2.5 / 2.6「**親流れ(非連荘)時のみ**反時計回りに全員が1席回転」「連荘時は局番号を
 *   進めない」、`advanceRound` の規定より親流れは `honba` を 0 に戻して次局へ。
 * - `docs/四兄弟麻雀ルール.md` §3「ダブロン等が発生した場合は上家取り」
 *   → 親がロン可能でも上家取りで敗れれば**和了者ではない** = 親流れ。
 *
 * ## 解釈の限界(Q31)
 * 「親はテンパイで連荘」の**テンパイがどの局面を指すか**は SSOT が明示していない。
 * 状態遷移図の `精算` ノードには和了・流局の双方から到達するため、字義どおりなら
 * 「他家和了局でも親がテンパイなら連荘」とも読めてしまう(頭ハネで敗れた親は
 * 和了者でないがテンパイではある)。本ファイルが固定するのは**標準慣行および現行実装**
 * である「テンパイ連荘は流局経路に限る / 和了局は親が和了したかのみで決まる」の側で、
 * これは SSOT からの一意導出ではない。論点は `質問リスト.md` Q31 に起票済み。
 *
 * ## フィクスチャ上の要点(なぜ専用の arm 関数を使うか)
 * 上の `armDiscard` は `hand.seating` を `seatingWithHumanAt` で**直接差し替える**が、
 * その席割りは席順3人だけを入れ替えて抜け番を p3 に固定するもので、**円環
 * (`round.order` + `roundNumber`)から導出できる席割りとは限らない**。
 * 一方 `finishRound` / `advanceRound` は `hand.seating` を見ずに `round` だけで次局を
 * 決める(`settleWin` が `hand.seating` を使うのは `winnerId` を引く写像のみで、
 * `isDealerWin` は `winnerSeat === "east"` の席キー比較)。
 * つまり席割りと `round` が食い違っても局進行自体は壊れないが、**プレイヤーID で書いた
 * アサーション(`seating.east` など)と次局席割りの回転検証が意味を失う** —
 * 今局の `seating` と `seatingOf(nextRoundState)` が無関係な席割りになるため。
 * ここでは席割りを必ず `seatingOf(round)` から導出し、両者の対応を構造的に保証する。
 */
describe("engine: 頭ハネと親の連荘・親流れの交差(spec 2.5〜2.7・#326)", () => {
  /** `nextRoundState` を非 null として取り出す(半荘継続を前提とするケース専用)。 */
  function expectNextRound(state: EngineState) {
    const next = state.nextRoundState;
    if (next === null)
      throw new Error("半荘継続を前提としたケースで次局が存在しない");
    return next;
  }

  /**
   * `roundNumber` から席割りを導出し、その局で**自家(p0)が打牌者**になる局面を組む。
   *
   * 席割りは `seatingOf(round)` 由来なので `round` と常に整合する(上記の要点を参照)。
   *
   * ⚠️ 整合を保証するのは**席割りと `round` の対応だけ**である。`roundsPlayed` は
   * `createGame` の初期値(0)、持ち点も配給原点のままなので、例えば「東4・2本場なのに
   * まだ一局も終えていない」という状態量の食い違いは残る。本ファイルのアサーションは
   * これらに依存しない(`roundsPlayed` は `SAFETY_ROUND_CAP` 判定にしか使われない)が、
   * **終局条件(トビ・親トップやめ・安全上限)を見るテストへ流用しないこと**。
   * `armDiscard` と同じく山からは牌を差し引かないため、残り枚数依存のテストにも不可。
   */
  function armDealerHeadBump(params: {
    seed: number;
    roundNumber: RoundNumber;
    hands: Partial<Record<SeatKey, string>>;
    honba?: number;
  }): { state: EngineState; seating: Seating<PlayerId>; humanSeat: SeatKey } {
    const base = createGame({ seed: params.seed });
    const round = {
      ...base.round,
      roundNumber: params.roundNumber,
      honba: params.honba ?? 0,
    };
    const seating = seatingOf(round);
    const humanSeat = SEATED_SEATS.find((seat) => seating[seat] === HUMAN);
    if (humanSeat === undefined)
      throw new Error(
        `自家(p0)が着席していない局を打牌者にできない: 東${params.roundNumber}`,
      );

    return {
      state: armDiscardWith({
        base,
        round,
        seating,
        humanSeat,
        hands: params.hands,
      }),
      seating,
      humanSeat,
    };
  }

  // `order` は createGame と同じ [p0, p1, p2, p3]、親位置は `roundNumber - 1`。
  // したがって自家(p0)の席は局番号で決まる:
  //   東1 → 東(親) / 東2 → 抜け番 / 東3 → 西 / 東4 → 南
  // 自家を打牌者に据える必要があるため、使えるのは東3(西から打つ)と東4(南から打つ)。

  /** 東3: 席割りは 東=p2(親)/ 南=p3 / 西=p0(自家=打牌者)/ 抜け番=p1。 */
  const ROUND_HUMAN_AT_WEST: RoundNumber = 3;
  /**
   * 東4: 席割りは 東=p3(親)/ 南=p0(自家=打牌者)/ 西=p1 / 抜け番=p2。
   *
   * 自家が南に座るのは各場の第4局だけなので、この配置の親流れは必然的に
   * **場替わり(東4 → 南1)**を伴う(`advanceRound` の局番号 = 4 の分岐)。
   * オーラス(南4)ではないため半荘は継続する。
   */
  const ROUND_HUMAN_AT_SOUTH: RoundNumber = 4;

  /** 親(東)が上家取りで勝つ配置に使う seed。 */
  const SEED_DEALER_WINS_HEAD_BUMP = 3118;
  /** 親(東)がロン可能でも上家取りで敗れる配置に使う seed。 */
  const SEED_DEALER_LOSES_HEAD_BUMP = 3119;

  describe("親が頭ハネで勝つ → 連荘(dealerContinues)", () => {
    // 打牌者=西 のとき ronOrder(west) = [east, south]。
    // 東(親)が上家取りで南を頭ハネする配置。
    const hands = { east: WAIT_3P_A, south: WAIT_3P_B };
    const honba = 2;

    it("前提: 南は単独ならこの牌で和了できる(頭ハネの敗者側が空振りでないこと)", () => {
      const { state, seating } = armDealerHeadBump({
        seed: SEED_DEALER_WINS_HEAD_BUMP,
        roundNumber: ROUND_HUMAN_AT_WEST,
        hands: { south: WAIT_3P_B },
        honba,
      });

      const after = discardRonTile(state);

      expect(after.lastRound?.kind).toBe("win");
      expect(after.lastRound?.winnerId).toBe(seating.south);
      // 子の和了なので親流れ = 対照として「連荘は南の和了では起きない」ことも示す。
      expect(after.lastRound?.winDetails?.dealer).toBe(false);
      expect(after.nextRoundState?.roundNumber).toBe(ROUND_HUMAN_AT_WEST + 1);
      expect(after.nextRoundState?.honba).toBe(0);
    });

    it("前提: 東(親)は単独ならこの牌で和了できる", () => {
      const { state, seating } = armDealerHeadBump({
        seed: SEED_DEALER_WINS_HEAD_BUMP,
        roundNumber: ROUND_HUMAN_AT_WEST,
        hands: { east: WAIT_3P_A },
        honba,
      });

      const after = discardRonTile(state);

      expect(after.lastRound?.kind).toBe("win");
      expect(after.lastRound?.winnerId).toBe(seating.east);
    });

    it("東(親)・南が同時ロン → 親が上家取りで和了し連荘(席・抜け番・局番号を据え置き本場+1)", () => {
      const { state, seating } = armDealerHeadBump({
        seed: SEED_DEALER_WINS_HEAD_BUMP,
        roundNumber: ROUND_HUMAN_AT_WEST,
        hands,
        honba,
      });
      const before = state.round;

      const after = discardRonTile(state);

      expect(after.phase).toBe("roundEnd");
      expect(after.lastRound?.kind).toBe("win");
      // ronOrder(west) = [east, south] → 親(東)が上家取り。
      expect(after.lastRound?.winnerId).toBe(seating.east);
      expect(after.lastRound?.winDetails?.winnerSeat).toBe("east");
      expect(after.lastRound?.winDetails?.dealer).toBe(true);
      // ダブロンなし: 頭ハネされた南は点が動かない。
      expect(after.lastRound?.deltas[seating.south]).toBe(0);
      // 抜け番はロン精算に関与しない。
      expect(after.lastRound?.deltas[seating.benchWarmer]).toBe(0);

      // 連荘: 局番号・場・席順(円環)据え置き、本場のみ +1。
      const next = expectNextRound(after);
      expect(next.wind).toBe(before.wind);
      expect(next.roundNumber).toBe(before.roundNumber);
      expect(next.honba).toBe(honba + 1);
      expect(next.order).toEqual(before.order);
      // 席・抜け番の据え置きは、`seatingOf` が (order, roundNumber) の純関数である以上
      // 上の2つ(order 一致・roundNumber 一致)から従うため、別途アサートしない。
      // 回転が起きないことの実質的な検証は、親流れ側の回転アサーションとの対比が担う。
    });
  });

  describe("親がロン可能でも頭ハネで負ける → 親流れ(dealerPasses)", () => {
    // 打牌者=南 のとき ronOrder(south) = [west, east]。
    // 西が先順のため、**東(親)もロン可能なのに**和了者になれない = #326 の中核。
    const honba = 2;

    it("前提: 東(親)は単独ならこの牌で和了できる(= 親はロンを主張できた)", () => {
      const { state, seating } = armDealerHeadBump({
        seed: SEED_DEALER_LOSES_HEAD_BUMP,
        roundNumber: ROUND_HUMAN_AT_SOUTH,
        hands: { east: WAIT_3P_A },
        honba,
      });

      const after = discardRonTile(state);

      expect(after.lastRound?.kind).toBe("win");
      expect(after.lastRound?.winnerId).toBe(seating.east);
      expect(after.lastRound?.winDetails?.dealer).toBe(true);
      // 親が和了できていれば連荘していた(次のテストとの対照)。
      expect(after.nextRoundState?.roundNumber).toBe(ROUND_HUMAN_AT_SOUTH);
      expect(after.nextRoundState?.honba).toBe(honba + 1);
    });

    it("前提: 西は単独ならこの牌で和了できる", () => {
      const { state, seating } = armDealerHeadBump({
        seed: SEED_DEALER_LOSES_HEAD_BUMP,
        roundNumber: ROUND_HUMAN_AT_SOUTH,
        hands: { west: WAIT_3P_B },
        honba,
      });

      const after = discardRonTile(state);

      expect(after.lastRound?.kind).toBe("win");
      expect(after.lastRound?.winnerId).toBe(seating.west);
    });

    it("西・東(親)が同時ロン → 西が上家取りし、親はロン可能でも親流れ(局が進み本場は0)", () => {
      const { state, seating } = armDealerHeadBump({
        seed: SEED_DEALER_LOSES_HEAD_BUMP,
        roundNumber: ROUND_HUMAN_AT_SOUTH,
        hands: { west: WAIT_3P_B, east: WAIT_3P_A },
        honba,
      });
      const before = state.round;

      const after = discardRonTile(state);

      expect(after.phase).toBe("roundEnd");
      expect(after.lastRound?.kind).toBe("win");
      // ronOrder(south) = [west, east] → 西が上家取り。親は和了者にならない。
      expect(after.lastRound?.winnerId).toBe(seating.west);
      expect(after.lastRound?.winDetails?.winnerSeat).toBe("west");
      expect(after.lastRound?.winDetails?.dealer).toBe(false);
      // 親は「ロンできたのに」和了者でないため点が動かない(ダブロンなし)。
      expect(after.lastRound?.deltas[seating.east]).toBe(0);
      expect(after.lastRound?.deltas[seating.benchWarmer]).toBe(0);

      // 親流れ: 次局へ進み、本場は 0 に戻る(連荘の +1 とは逆向き)。
      // この配置は東4なので、次局は場替わりして南1(`advanceRound` の局番号=4 分岐)。
      expect(before.wind).toBe("east");
      const next = expectNextRound(after);
      expect(next.wind).toBe("south");
      expect(next.roundNumber).toBe(1);
      expect(next.honba).toBe(0);
      // 1席回転: 旧親(東)が抜け番へ回り、旧南が新しい親になる。
      const nextSeating = seatingOf(next);
      expect(nextSeating.benchWarmer).toBe(seating.east);
      expect(nextSeating.east).toBe(seating.south);
      expect(nextSeating.south).toBe(seating.west);
      expect(nextSeating.west).toBe(seating.benchWarmer);
    });
  });
});
