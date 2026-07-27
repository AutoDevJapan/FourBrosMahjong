import { describe, expect, it } from "vitest";
import type { Meld } from "@/domain/hand/meld";
import { parseTile, parseTiles } from "@/domain/hand/notation";
import { sameKind } from "@/domain/hand/tile-identity";
import { HONOR, type Tile } from "@/domain/tiles/tile";
import {
  createGame,
  discard,
  type EngineState,
  type SeatKey,
  seatOfPlayer,
} from "./engine";

/**
 * 海底での北抜き(ガリ)による嶺上ツモの役判定(issue #396)。
 *
 * `isHaiteiTsumo` は「嶺上補充でライブ牌が 0 になっても海底摸月ではない」と契約して
 * いるが、北抜きの補充経路だけが通常ツモ扱い(`fromKan = false`)のままで、
 * **嶺上牌でのツモに海底摸月(1翻)が誤って付与**されていた。
 *
 * 嶺上開花はカン限定(spec 3.2「槓の嶺上牌で和了」)なので、北抜きの嶺上牌に
 * 付けてはならない。両方を同時に固定する。
 *
 * なお「海底で北を抜くこと自体を許すか(王牌が13枚に減る件)」は
 * `質問リスト.md` Q33 が未回答のため本テストの対象外(現状維持)。
 */

/** 南(AI)の副露: 白のポン。これで役(役牌)が必ず1つ付き、非門前になる。 */
function whitePon(): Meld {
  return { type: "pon", tiles: parseTiles("5z 5z 5z"), concealed: false };
}

/**
 * 南(AI)の門前10枚を「3面子 + `winTile` の単騎待ち」で組む。
 *
 * `456s`(中張牌)を含めるためチャンタ/純チャン/混老頭は付かず、`1p`/`789s` を
 * 含めるため断幺九も付かない。`winTile` が何であっても役は白のみになる。
 */
function southTenpaiOn(winTile: Tile): Tile[] {
  return [...parseTiles("123p 456s 789s"), winTile];
}

/** 自家(東)が捨てる牌。南・西のどの手牌とも干渉しない。 */
const EAST_DISCARD = "1z";

interface Fixture {
  readonly state: EngineState;
  readonly discardTile: Tile;
  /** 南が単騎で待つ牌(= 南が次に引く牌)。 */
  readonly winTile: Tile;
  /** 南が引く直前のライブ壁最後の1枚。 */
  readonly lastLiveTile: Tile;
}

/**
 * ライブ壁を残り1枚まで削り、自家(東)の打牌で南(AI)が最後の1枚を引く局面を組む。
 *
 * `viaKita` が true なら、その最後の1枚が北である seed を使う。南は北を自動で抜き、
 * **嶺上牌**を引くことになる(その嶺上牌が南の待ち牌)。false なら最後の1枚が北で
 * ない seed を使い、南は**通常の海底牌**を引く(対照)。
 */
function armHaiteiDraw(seed: number, viaKita: boolean): Fixture {
  const base = createGame({ seed });
  const hand = base.hand;
  if (hand === null)
    throw new Error("hand should exist right after createGame");
  if (seatOfPlayer(hand.seating, "p0") !== "east") {
    throw new Error("初局の自家は東であることを前提にしたフィクスチャ");
  }

  while (hand.wall.remainingLiveTiles > 1) hand.wall.draw();
  const lastLiveTile = hand.wall.liveWall[0];
  const isNorth =
    lastLiveTile.suit === "honor" && lastLiveTile.rank === HONOR.NORTH;
  if (isNorth !== viaKita) {
    throw new Error(
      `seed=${seed}: ライブ壁最後の1枚が北であること=${viaKita} を前提にしたフィクスチャ`,
    );
  }
  // 北を抜くと嶺上牌(王牌末尾)を引く。抜かないならライブ壁の最後の1枚を引く。
  const deadWall = hand.wall.deadWall;
  const winTile = viaKita ? deadWall[deadWall.length - 1] : lastLiveTile;

  for (const seat of ["east", "south", "west"] as SeatKey[]) {
    hand.melds[seat] = [];
    hand.discards[seat] = [];
    hand.discardHistory[seat] = [];
    hand.riichi[seat] = false;
    hand.riichiMiss[seat] = false;
    hand.tempMiss[seat] = false;
  }
  hand.melds.south = [whitePon()];
  hand.hands.south = southTenpaiOn(winTile);
  hand.callsMade = true; // 鳴きが入った局(天和/地和を潰す)
  // 自家・西はテンパイしない散らばり手(サンマの萬子は一萬・九萬のみ)。
  hand.hands.east = parseTiles("1m 9m 2p 5p 8p 2s 5s 8s 2z 3z 6z 7z 4p");
  hand.hands.west = parseTiles("1m 9m 3p 6p 9p 3s 6s 9s 2z 3z 6z 7z 4s");

  const discardTile = parseTile(EAST_DISCARD);
  if (sameKind(discardTile, winTile)) {
    throw new Error("自家の打牌が南の待ち牌と同種ではフィクスチャが成立しない");
  }
  hand.drawn = discardTile;
  hand.turn = "east";

  return {
    lastLiveTile,
    winTile,
    discardTile,
    state: {
      ...base,
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
  };
}

function yakuNames(state: EngineState): string[] {
  return state.lastRound?.winDetails?.yaku.map((y) => y.name) ?? [];
}

describe("engine: 海底での北抜きによる嶺上ツモ(#396)", () => {
  it("対照: 通常の海底牌をツモしたら海底摸月が付く", () => {
    const { state, discardTile, winTile, lastLiveTile } = armHaiteiDraw(
      1,
      false,
    );
    // フィクスチャの前提: 南が引くのはライブ壁の最後の1枚そのもの。
    expect(winTile).toBe(lastLiveTile);

    const after = discard(state, discardTile);

    expect(after.lastRound?.kind).toBe("win");
    expect(after.lastRound?.winnerId).toBe(after.hand?.seating.south ?? "p1");
    expect(yakuNames(after)).toContain("海底摸月");
  });

  it("海底で北を抜いて引いた嶺上牌のツモには海底摸月も嶺上開花も付かない", () => {
    const { state, discardTile, winTile, lastLiveTile } = armHaiteiDraw(
      48,
      true,
    );
    // フィクスチャの前提: 引くのは北で、抜いた結果ツモるのは王牌末尾の嶺上牌。
    expect(sameKind(lastLiveTile, parseTile("4z"))).toBe(true);
    expect(winTile).not.toBe(lastLiveTile);

    const after = discard(state, discardTile);

    // 前提: 北抜きが起きて南が和了している(空振り防止)。
    expect(after.lastRound?.kind).toBe("win");
    expect(after.lastRound?.winDetails?.winningTile).toEqual(winTile);

    const yaku = yakuNames(after);
    // 嶺上牌のツモなので海底摸月ではない(`isHaiteiTsumo` の実装契約)。
    expect(yaku).not.toContain("海底摸月");
    // 嶺上開花は「槓の嶺上牌」限定。北抜きの嶺上牌には付けない(spec 3.2)。
    expect(yaku).not.toContain("嶺上開花");
    // 役自体は成立している(白のポン)。役はこれ1つだけ。
    expect(yaku).toEqual(["役牌(三元牌)"]);
  });
});
