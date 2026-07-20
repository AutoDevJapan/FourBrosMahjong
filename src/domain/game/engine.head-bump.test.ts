import { describe, expect, it } from "vitest";
import { parseTile, parseTiles } from "@/domain/hand/notation";
import type { Seating } from "@/domain/round/seat";
import {
  createGame,
  discard,
  type EngineState,
  passRon,
  type PlayerId,
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
 * 自家(p0)が `humanSeat` に座り、`RON_TILE` を打とうとしている局面を組む。
 *
 * `hands` で各席の手牌を指定する。自家の席は打牌者なので `DISCARDER_HAND` 固定。
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
  const hand = base.hand;
  if (hand === null)
    throw new Error("hand should exist right after createGame");

  const seating = seatingWithHumanAt(params.humanSeat);
  for (const seat of ["east", "south", "west"] as SeatKey[]) {
    const notation =
      seat === params.humanSeat
        ? DISCARDER_HAND
        : (params.hands[seat] ?? NO_WAIT_3P);
    hand.hands[seat] = parseTiles(notation);
    hand.melds[seat] = [];
    hand.discards[seat] = []; // フリテン回避
    hand.riichi[seat] = false;
    hand.riichiMiss[seat] = false;
    hand.tempMiss[seat] = false;
  }
  hand.drawn = parseTile(RON_TILE);
  hand.turn = params.humanSeat;

  return {
    ...base,
    riichiSticks: params.riichiSticks ?? base.riichiSticks,
    round: { ...base.round, honba: params.honba ?? base.round.honba },
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

/** `RON_TILE` を打って解決させる。 */
function discardRonTile(state: EngineState): EngineState {
  return discard(state, parseTile(RON_TILE));
}

describe("engine: 通常打牌に対する頭ハネ(上家取り / spec 2.4・#311)", () => {
  describe("前提の固定: 各席は単独ならこの牌で和了できる", () => {
    it("放銃者=東 のとき南は単独ロンできる", () => {
      const after = discardRonTile(
        armDiscard({
          seed: 3110,
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
          seed: 3111,
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
          seed: 3112,
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
          seed: 3113,
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
      seed: 3114,
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
    // 放銃者(p0=東)が支払い、南が受け取る。
    expect(after.lastRound?.deltas.p1).toBeGreaterThan(0);
    expect(after.lastRound?.deltas.p0).toBeLessThan(0);
  });

  it("南の打牌に西・東が同時ロン → 下家(西)のみ和了(回転方向の固定)", () => {
    // 放銃者を変えて回転方向を固定する。ronOrder が「上家(前の席)から」など
    // 逆回りに退行すると、ここで東(p1)が勝ってしまい落ちる。
    const armed = armDiscard({
      seed: 3115,
      humanSeat: "south",
      hands: { west: WAIT_3P_B, east: WAIT_3P_A },
    });

    const after = discardRonTile(armed);

    expect(after.phase).toBe("roundEnd");
    expect(after.lastRound?.kind).toBe("win");
    // ronOrder(south) = [west, east] → 西(p2)が上家取り。
    expect(after.lastRound?.winnerId).toBe("p2");
    expect(after.lastRound?.deltas.p1).toBe(0); // 東は和了していない
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
      armDiscard({ seed: 3118, humanSeat: "east", hands }),
    );
    const withPot = discardRonTile(
      armDiscard({
        seed: 3118,
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
    for (const seat of ["east", "south", "west"] as SeatKey[]) {
      hand.melds[seat] = [];
      hand.discards[seat] = [];
      hand.riichi[seat] = false;
      hand.riichiMiss[seat] = false;
      hand.tempMiss[seat] = false;
    }
    hand.hands.east = parseTiles(DISCARDER_HAND);
    hand.hands.south = parseTiles(WAIT_3P_A);
    hand.hands.west = parseTiles(WAIT_3P_B);
    hand.discards.east = [ronTile]; // 打牌済みの河
    hand.pendingDiscard = { seat: "east", tile: ronTile };
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

    const ponTile = parseTile("5z"); // 白(三元牌)= AI の `shouldCallMeld` 対象でもある
    for (const seat of ["east", "south", "west"] as SeatKey[]) {
      hand.melds[seat] = [];
      hand.discards[seat] = [];
      hand.riichi[seat] = false;
      hand.riichiMiss[seat] = false;
      hand.tempMiss[seat] = false;
    }
    hand.hands.east = parseTiles(DISCARDER_HAND);
    // 自家(南)は 5z を2枚持ちでポン可能。3p 待ちではないのでロンは提示されない。
    hand.hands.south = parseTiles("5z 5z 234m 678m 234s 66s 1p");
    hand.hands.west = parseTiles(NO_WAIT_3P);
    hand.discards.east = [ponTile];
    hand.pendingDiscard = { seat: "east", tile: ponTile };
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
