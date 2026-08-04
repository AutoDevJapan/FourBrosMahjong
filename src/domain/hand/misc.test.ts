import { describe, expect, it } from "vitest";
import { HONOR } from "../tiles/tile";
import { isKuikaeForbidden } from "./kuikae";
import { isConcealedHand } from "./meld";
import { parseTile, parseTiles } from "./notation";
import {
  isDragon,
  isGreenTile,
  isTerminalNumber,
  isWind,
  isYakuhaiCandidate,
  isYaochu,
  sameKind,
} from "./tile-identity";

describe("notation.parseTiles", () => {
  it("赤5筒/5索は自動で赤になる", () => {
    expect(parseTile("5p").isRed).toBe(true);
    expect(parseTile("5s").isRed).toBe(true);
    expect(parseTile("5m").isRed).toBe(false);
  });

  it("字牌の rank を HONOR に対応させる", () => {
    expect(parseTile("1z")).toMatchObject({ suit: "honor", rank: HONOR.EAST });
    expect(parseTile("7z")).toMatchObject({ suit: "honor", rank: HONOR.RED });
  });

  it("複数スート混在を解釈する", () => {
    expect(parseTiles("19m 123p")).toHaveLength(5);
  });
});

describe("tile-identity", () => {
  it("么九/老頭/字牌の述語", () => {
    expect(isTerminalNumber(parseTile("1m"))).toBe(true);
    expect(isTerminalNumber(parseTile("5p"))).toBe(false);
    expect(isYaochu(parseTile("1z"))).toBe(true);
    expect(isYaochu(parseTile("5s"))).toBe(false);
  });

  it("三元牌/風牌の述語", () => {
    expect(isDragon(parseTile("5z"))).toBe(true);
    expect(isWind(parseTile("4z"))).toBe(true);
    expect(isDragon(parseTile("4z"))).toBe(false);
  });

  it.each([
    { suit: "honor" as const, rank: HONOR.NORTH },
    { suit: "honor" as const, rank: 0 },
    { suit: "honor" as const, rank: 8 },
    { suit: "honor" as const, rank: 99 },
    { suit: "pin" as const, rank: HONOR.WHITE },
  ])("役牌候補は実在する東南西・三元牌だけに閉じる: $suit $rank", (tile) => {
    expect(isYakuhaiCandidate(tile)).toBe(false);
  });

  it.each([
    HONOR.EAST,
    HONOR.SOUTH,
    HONOR.WEST,
    HONOR.WHITE,
    HONOR.GREEN,
    HONOR.RED,
  ])("実在する役牌 rank %s は役牌候補", (rank) => {
    expect(isYakuhaiCandidate({ suit: "honor", rank })).toBe(true);
  });

  it("緑一色の緑牌(索2346 8 と發)", () => {
    expect(isGreenTile(parseTile("2s"))).toBe(true);
    expect(isGreenTile(parseTile("6z"))).toBe(true); // 發
    expect(isGreenTile(parseTile("5s"))).toBe(false);
    expect(isGreenTile(parseTile("1s"))).toBe(false);
  });

  it("sameKind は赤を無視する", () => {
    expect(sameKind({ suit: "pin", rank: 5 }, parseTile("5p"))).toBe(true);
  });
});

describe("meld.isConcealedHand", () => {
  it("暗槓のみ・副露ゼロは門前", () => {
    expect(isConcealedHand([])).toBe(true);
    expect(
      isConcealedHand([
        { type: "kan", tiles: parseTiles("1111p"), concealed: true },
      ]),
    ).toBe(true);
  });

  it("ポン・明槓があれば非門前", () => {
    expect(
      isConcealedHand([
        { type: "pon", tiles: parseTiles("111p"), concealed: false },
      ]),
    ).toBe(false);
  });
});

describe("kuikae(spec 1.4 喰い替えなし)", () => {
  it("ポンした牌と同種の打牌は禁止", () => {
    expect(isKuikaeForbidden(parseTile("3p"), parseTile("3p"))).toBe(true);
    expect(isKuikaeForbidden(parseTile("3p"), parseTile("6p"))).toBe(false);
  });
});
