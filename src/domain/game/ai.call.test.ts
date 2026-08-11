import { describe, expect, it } from "vitest";
import type { Meld } from "@/domain/hand/meld";
import { parseTiles } from "@/domain/hand/notation";
import { HONOR } from "@/domain/tiles/tile";
import { shouldCallMeld } from "./ai";

function pon(notation: string): Meld {
  return { type: "pon", tiles: parseTiles(notation), concealed: false };
}

describe("shouldCallMeld: ナシナシの AI 鳴き判断(#210)", () => {
  it("役の当てがない数牌の対子/暗刻はポン・大明槓しない", () => {
    expect(
      shouldCallMeld({
        tile: parseTiles("5p")[0],
        melds: [],
        seatWind: HONOR.SOUTH,
        roundWind: HONOR.EAST,
      }),
    ).toBe(false);
  });

  it.each(["5z", "6z", "7z"])("三元牌 %s は鳴いて役を確定する", (tile) => {
    expect(
      shouldCallMeld({
        tile: parseTiles(tile)[0],
        melds: [],
        seatWind: HONOR.SOUTH,
        roundWind: HONOR.EAST,
      }),
    ).toBe(true);
  });

  it("場風・自風は鳴くが、役牌でない風牌とガリの北は鳴かない", () => {
    const decide = (notation: string): boolean =>
      shouldCallMeld({
        tile: parseTiles(notation)[0],
        melds: [],
        seatWind: HONOR.WEST,
        roundWind: HONOR.EAST,
      });
    expect(decide("1z")).toBe(true);
    expect(decide("3z")).toBe(true);
    expect(decide("2z")).toBe(false);
    expect(decide("4z")).toBe(false);
    // 入力境界が将来広がって風に北が渡っても、共通の役牌候補判定がガリを除外する。
    expect(
      shouldCallMeld({
        tile: parseTiles("4z")[0],
        melds: [],
        // @ts-expect-error 北は PlayableWind ではない。型境界を迂回した入力の防御を検証する。
        seatWind: HONOR.NORTH,
        // @ts-expect-error 北はコンパイル時に拒否されるが、実行時にも安全側へ倒す。
        roundWind: HONOR.NORTH,
      }),
    ).toBe(false);
  });

  it.each([0, 8, 99])(
    "カタログ外の字牌 rank %s は役牌として鳴かない",
    (rank) => {
      expect(
        shouldCallMeld({
          tile: { suit: "honor", rank, isRed: false },
          melds: [],
          seatWind: HONOR.SOUTH,
          roundWind: HONOR.EAST,
        }),
      ).toBe(false);
    },
  );

  it("役牌を既に副露して役が確定済みなら、別の鳴きを許す", () => {
    expect(
      shouldCallMeld({
        tile: parseTiles("9s")[0],
        melds: [pon("5z 5z 5z")],
        seatWind: HONOR.SOUTH,
        roundWind: HONOR.EAST,
      }),
    ).toBe(true);
  });
});
