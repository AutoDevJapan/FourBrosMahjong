import { describe, expect, it } from "vitest";
import type { Meld } from "@/domain/hand/meld";
import { parseTile, parseTiles } from "@/domain/hand/notation";
import {
  createGame,
  declareRon,
  discard,
  type EngineState,
  passRon,
  type SeatKey,
} from "./engine";

/**
 * AI の加槓・暗槓に対する自家の槍槓ロン選択(issue #208)。
 *
 * 従来は AI(他家)の加槓・暗槓(国士のみ / Q17・#126)に対し自家がロン可能なとき、
 * engine が意思確認なしに自動で和了を成立させていた。本テストは通常ロンと同じ
 * `pending: humanReact`(ロン / スルー)が立ち、
 *  - ロン → 槍槓ロンとして精算(槓は不成立)
 *  - スルー → 既存 `passRon` と同じフリテン処理(同巡内 / リーチ後は恒久)の後、
 *    槓が成立して進行が再開する
 *  - 候補が他家(AI)のみ・頭ハネ順で他家が先の場合は従来どおり即和了
 * ことを検証する。
 *
 * ## フィクスチャの組み立て
 * `HandState` は engine 内部型のため、`createGame` の初期局面(自家 p0 = 東/親)の
 * 可変フィールドを直接上書きし、自家の打牌 → AI 手番の自動カンで槍槓局面へ
 * **公開 API 経由で決定的に**到達させる(AI のカンは `pump` 内の自動判断)。
 */

/** 槍槓応答者に据える「chankan 以外は役なし」の 3p カンチャン待ち(13枚・門前)。 */
const CHANKAN_WAIT_3P = "2p 4p 123s 789s 678p 99p";
/** どの1枚を引いても和了・テンパイ・鳴きが発生しない散らばり13枚(西家用)。 */
const JUNK_13 = "1m 4m 7m 2p 5p 8p 3s 6s 9s 1z 2z 3z 5z";
/** 加槓者(AI)の門前10枚(3p の4枚目 + 散らばり9枚。和了・リーチ不能)。 */
const KAKAN_HOLDER_10 = "3p 1m 4m 7m 2s 5s 8s 2z 3z 5z";

/** 席の手牌・副露・河を上書きする。 */
function setSeat(
  state: EngineState,
  seat: SeatKey,
  hand: string,
  melds: Meld[] = [],
  discards: string[] = [],
): void {
  const h = state.hand;
  if (h === null) throw new Error("no hand");
  h.hands[seat] = parseTiles(hand);
  h.melds[seat] = melds;
  h.discards[seat] = discards.flatMap((d) => parseTiles(d));
}

/** 3p のポン(加槓の土台)。 */
function pon3p(): Meld {
  return { type: "pon", tiles: parseTiles("3p 3p 3p"), concealed: false };
}

/**
 * 自家(東)の打牌待ち局面を作る。`drawnTile` を切ると手番が南(AI)へ移り、
 * 南に仕込んだカン(加槓/暗槓)が自動発火する。
 */
function armHumanTurn(
  seed: number,
  humanHand13: string,
  drawnTile: string,
): { state: EngineState; drawn: ReturnType<typeof parseTile> } {
  const s = createGame({ seed });
  const hand = s.hand;
  if (hand === null)
    throw new Error("hand should exist right after createGame");
  hand.hands.east = parseTiles(humanHand13);
  hand.melds.east = [];
  hand.discards.east = [];
  hand.drawn = parseTile(drawnTile);
  hand.turn = "east";
  return {
    state: {
      ...s,
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
    },
    drawn: parseTile(drawnTile),
  };
}

/** ライブ壁を指定枚数まで消費する(海底・終局を決定的に作る)。 */
function drainLiveWallTo(state: EngineState, target: number): void {
  const hand = state.hand;
  if (hand === null) throw new Error("no hand");
  while (hand.wall.remainingLiveTiles > target) hand.wall.draw();
}

/** 「南(AI)が 3p を加槓 → 自家(東)が槍槓ロン可能」の局面を組む。 */
function armAiKakanVsHuman(seed: number): {
  state: EngineState;
  drawn: ReturnType<typeof parseTile>;
} {
  const armed = armHumanTurn(seed, CHANKAN_WAIT_3P, "1z");
  setSeat(armed.state, "south", KAKAN_HOLDER_10, [pon3p()]);
  setSeat(armed.state, "west", JUNK_13);
  return armed;
}

describe("engine: AI加槓への槍槓ロン選択(#208)", () => {
  it("AIの加槓に自家がロン可能なら自動和了せず、ロン/スルーの選択(humanReact)が立つ", () => {
    const { state, drawn } = armAiKakanVsHuman(1);

    const after = discard(state, drawn); // 東が打牌 → 南(AI)がツモ番で 3p を加槓

    expect(after.phase).toBe("playing");
    expect(after.lastRound).toBeNull(); // 自動和了していない
    expect(after.pending?.kind).toBe("humanReact");
    if (after.pending?.kind !== "humanReact") throw new Error("unreachable");
    expect(after.pending.chankan).toBe("kakan");
    expect(after.pending.canRon).toBe(true);
    expect(after.pending.canPon).toBe(false);
    expect(after.pending.canKan).toBe(false);
    expect(after.pending.from).toBe("south");
    expect(after.pending.tile.suit).toBe("pin");
    expect(after.pending.tile.rank).toBe(3);
    // 槓は未成立(選択待ちの間はポンのまま・嶺上補充もまだ)。
    expect(after.hand?.melds.south).toHaveLength(1);
    expect(after.hand?.melds.south[0].type).toBe("pon");
  });

  it("ロンを選ぶと槍槓ロンで精算され、加槓は取り消される", () => {
    const { state, drawn } = armAiKakanVsHuman(1);
    const pending = discard(state, drawn);

    const won = declareRon(pending);

    expect(won.phase).toBe("roundEnd");
    expect(won.lastRound?.kind).toBe("win");
    expect(won.lastRound?.winnerId).toBe("p0");
    expect(won.lastRound?.winDetails?.winType).toBe("ron");
    // 槍槓(1翻)が付く(この待ち手牌は chankan 以外に役なし)。
    expect(won.lastRound?.winDetails?.yaku.map((y) => y.name)).toContain(
      "槍槓",
    );
    // 加槓者(南=p1)が放銃者として支払う。
    expect(won.lastRound?.deltas.p1).toBeLessThan(0);
    expect(won.lastRound?.deltas.p0).toBeGreaterThan(0);
    // 加槓は不成立(ポンのまま)。
    expect(won.hand?.melds.south[0].type).toBe("pon");
  });

  it("スルーすると加槓が成立して進行が続き、自家は同巡内フリテンになる", () => {
    const { state, drawn } = armAiKakanVsHuman(1);
    // ライブ壁を2枚に絞る: 南のツモで1枚 → 加槓・嶺上補充後、西のツモで海底 → 流局。
    // 自家は次の自ツモを迎えないため、tempMiss(同巡内フリテン)を決定的に観測できる。
    drainLiveWallTo(state, 2);
    const pending = discard(state, drawn);
    expect(pending.pending?.kind).toBe("humanReact");

    const passed = passRon(pending);

    // 加槓が成立している(ポン → 明槓・4枚)。
    expect(passed.hand?.melds.south[0].type).toBe("kan");
    expect(passed.hand?.melds.south[0].concealed).toBe(false);
    expect(passed.hand?.melds.south[0].tiles).toHaveLength(4);
    // 見逃しフリテン(同巡内)。リーチ中でないため恒久フリテンにはならない。
    expect(passed.hand?.tempMiss.east).toBe(true);
    expect(passed.hand?.riichiMiss.east).toBe(false);
    // 自家の和了は成立していない(流局まで進む)。
    expect(passed.lastRound?.kind ?? null).not.toBe("win");
  });

  it("リーチ中にスルーすると恒久フリテン(riichiMiss)になる", () => {
    const { state, drawn } = armAiKakanVsHuman(1);
    const hand = state.hand;
    if (hand === null) throw new Error("no hand");
    hand.riichi.east = true;
    const pending = discard(state, drawn);
    expect(pending.pending?.kind).toBe("humanReact");

    const passed = passRon(pending);

    expect(passed.hand?.melds.south[0].type).toBe("kan");
    expect(passed.hand?.riichiMiss.east).toBe(true);
  });

  it("頭ハネ順で先の他家(AI)がロン可能なら従来どおり即和了し、自家に選択は生じない", () => {
    // 南が加槓 → ronOrder(south) = [west, east]。西(AI)が先にロン可能なため即精算。
    const armed = armHumanTurn(3, JUNK_13, "1z");
    setSeat(armed.state, "south", KAKAN_HOLDER_10, [pon3p()]);
    setSeat(armed.state, "west", CHANKAN_WAIT_3P);

    const after = discard(armed.state, armed.drawn);

    expect(after.phase).toBe("roundEnd");
    expect(after.lastRound?.winnerId).toBe("p2");
    expect(after.pending).toBeNull();
  });

  it("自家がスルーした後、頭ハネ順で次の他家(AI)がロン可能なら横取りが成立する", () => {
    // 西が加槓 → ronOrder(west) = [east, south]。自家(東)が先、南(AI)が次。
    const armed = armHumanTurn(4, CHANKAN_WAIT_3P, "1z");
    // 南は副露済み(門前でない=リーチしない)の 3p 待ち。111s ポン + 10枚。
    setSeat(armed.state, "south", "2p 4p 789s 678p 99p", [
      { type: "pon", tiles: parseTiles("1s 1s 1s"), concealed: false },
    ]);
    setSeat(armed.state, "west", KAKAN_HOLDER_10, [pon3p()]);

    // 東の打牌 → 南(AI)は打牌のみ → 西(AI)が加槓 → 自家の槍槓選択。
    let s = discard(armed.state, armed.drawn);
    for (let guard = 0; guard < 10; guard++) {
      if (s.phase !== "playing" || s.pending === null) break;
      if (s.pending.kind === "humanReact" && s.pending.chankan !== undefined)
        break;
      if (s.pending.kind === "humanReact") {
        s = passRon(s); // 槍槓以外の応答(ポン等)は見送って進める。
        continue;
      }
      break;
    }
    expect(s.pending?.kind).toBe("humanReact");
    if (s.pending?.kind !== "humanReact") throw new Error("unreachable");
    expect(s.pending.chankan).toBe("kakan");
    expect(s.pending.from).toBe("west");

    const passed = passRon(s);

    // 自家スルー → 頭ハネ次席の南(p1)が槍槓ロンで横取り。
    expect(passed.phase).toBe("roundEnd");
    expect(passed.lastRound?.winnerId).toBe("p1");
    // 加槓は不成立(ポンのまま)。
    expect(passed.hand?.melds.west[0].type).toBe("pon");
  });
});

/** 国士無双の13面待ち(13種の么九牌を各1枚)。任意の么九牌でロン可。 */
const KOKUSHI_13_WAIT = "19m 19p 19s 1234567z";
/** 暗槓者(AI)の門前13枚(1m ×4 + 散らばり9枚。和了・リーチ不能)。 */
const ANKAN_HOLDER_13 = "1m 1m 1m 1m 4m 7m 2s 5s 8s 9p 2z 3z 5z";

/** 「南(AI)が 1m を暗槓 → 自家(東)が国士で槍槓ロン可能」の局面を組む。 */
function armAiAnkanVsKokushi(seed: number): {
  state: EngineState;
  drawn: ReturnType<typeof parseTile>;
} {
  const armed = armHumanTurn(seed, KOKUSHI_13_WAIT, "5m");
  setSeat(armed.state, "south", ANKAN_HOLDER_13);
  setSeat(armed.state, "west", JUNK_13);
  return armed;
}

describe("engine: AI暗槓への国士槍槓ロン選択(#208 / Q17・#126)", () => {
  it("AIの暗槓に国士テンパイの自家がロン可能なら選択(humanReact)が立ち、暗槓は未成立", () => {
    const { state, drawn } = armAiAnkanVsKokushi(1);

    const after = discard(state, drawn); // 東が打牌 → 南(AI)が 1m を暗槓

    expect(after.phase).toBe("playing");
    expect(after.lastRound).toBeNull();
    expect(after.pending?.kind).toBe("humanReact");
    if (after.pending?.kind !== "humanReact") throw new Error("unreachable");
    expect(after.pending.chankan).toBe("ankan");
    expect(after.pending.canRon).toBe(true);
    expect(after.pending.from).toBe("south");
    expect(after.pending.tile.suit).toBe("man");
    expect(after.pending.tile.rank).toBe(1);
    expect(after.hand?.melds.south).toHaveLength(0); // 暗槓は未成立
  });

  it("ロンを選ぶと国士無双の槍槓ロンで精算され、暗槓は取り消される", () => {
    const { state, drawn } = armAiAnkanVsKokushi(1);
    const pending = discard(state, drawn);

    const won = declareRon(pending);

    // 親の国士ロン(48,000点)で放銃者(p1)がトビ → 半荘即終了(gameEnd)。
    expect(won.phase).toBe("gameEnd");
    expect(won.lastRound?.winnerId).toBe("p0");
    expect(won.lastRound?.winDetails?.yakuman).toBeGreaterThan(0); // 国士無双
    expect(won.lastRound?.deltas.p1).toBeLessThan(0); // 暗槓者(南)が放銃者
    expect(won.hand?.melds.south).toHaveLength(0); // 暗槓取り消し
  });

  it("スルーすると暗槓が成立して進行が続く", () => {
    const { state, drawn } = armAiAnkanVsKokushi(1);
    const pending = discard(state, drawn);
    expect(pending.pending?.kind).toBe("humanReact");

    const passed = passRon(pending);

    expect(passed.hand?.melds.south[0].type).toBe("kan");
    expect(passed.hand?.melds.south[0].concealed).toBe(true);
    expect(passed.hand?.melds.south[0].tiles).toHaveLength(4);
    expect(passed.lastRound?.kind ?? null).not.toBe("win");
  });

  it("国士以外の手(標準形)では AI 暗槓に槍槓選択は生じず、暗槓が成立する", () => {
    // 自家は清一色(索子)の 9s 単騎待ち = 9s でロンできる標準形(国士ではない)。
    const armed = armHumanTurn(2, "111s 234s 567s 789s 9s", "2p");
    setSeat(armed.state, "south", "9s 9s 9s 9s 1m 4m 7m 2p 5p 8m 2z 3z 5z");
    setSeat(armed.state, "west", JUNK_13);

    const after = discard(armed.state, armed.drawn); // 南(AI)が 9s を暗槓

    // 槍槓の選択は生じない(国士のみ)= 暗槓成立で進行が続く。
    expect(after.lastRound).toBeNull();
    const chankanPending =
      after.pending?.kind === "humanReact" &&
      after.pending.chankan !== undefined;
    expect(chankanPending).toBe(false);
    expect(after.hand?.melds.south[0].type).toBe("kan");
    expect(after.hand?.melds.south[0].concealed).toBe(true);
  });
});
