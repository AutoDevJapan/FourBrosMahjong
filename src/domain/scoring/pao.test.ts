import { describe, expect, it } from "vitest";
import type { Meld } from "../hand/meld";
import { HONOR, type Tile } from "../tiles/tile";
import { isPaoTriggeringCall } from "./pao";

/** テスト用の牌生成(赤5は本判定に無関係なので常に false)。 */
function tile(suit: Tile["suit"], rank: number): Tile {
  return { suit, rank, isRed: false };
}

/** 同一字牌の刻子(ポン)。 */
function honorPon(rank: number): Meld {
  return {
    type: "pon",
    tiles: [tile("honor", rank), tile("honor", rank), tile("honor", rank)],
    concealed: false,
  };
}

/** 同一字牌の大明槓(明槓)。 */
function honorDaiminkan(rank: number): Meld {
  return {
    type: "kan",
    tiles: Array.from({ length: 4 }, () => tile("honor", rank)),
    concealed: false,
  };
}

/** 数牌の大明槓(四槓子の母数用)。 */
function suitKan(suit: Tile["suit"], rank: number, concealed = false): Meld {
  return {
    type: "kan",
    tiles: Array.from({ length: 4 }, () => tile(suit, rank)),
    concealed,
  };
}

describe("isPaoTriggeringCall: パオ責任者判定(スペック3 3.3 / #99)", () => {
  describe("大三元", () => {
    it("三元牌2種が副露済み + 3種目をポン → パオ確定", () => {
      const ctx = {
        existingMelds: [honorPon(HONOR.WHITE), honorPon(HONOR.GREEN)],
        newMeld: honorPon(HONOR.RED),
        fromOpponentDiscard: true,
      };
      expect(isPaoTriggeringCall(ctx)).toBe(true);
    });

    it("3種目を大明槓させても確定する", () => {
      const ctx = {
        existingMelds: [honorPon(HONOR.WHITE), honorPon(HONOR.RED)],
        newMeld: honorDaiminkan(HONOR.GREEN),
        fromOpponentDiscard: true,
      };
      expect(isPaoTriggeringCall(ctx)).toBe(true);
    });

    it("三元牌1種しか副露していなければパオ未確定", () => {
      const ctx = {
        existingMelds: [honorPon(HONOR.WHITE)],
        newMeld: honorPon(HONOR.GREEN),
        fromOpponentDiscard: true,
      };
      expect(isPaoTriggeringCall(ctx)).toBe(false);
    });

    it("自力完成(相手の打牌でない)ならパオなし", () => {
      const ctx = {
        existingMelds: [honorPon(HONOR.WHITE), honorPon(HONOR.GREEN)],
        newMeld: honorPon(HONOR.RED),
        fromOpponentDiscard: false,
      };
      expect(isPaoTriggeringCall(ctx)).toBe(false);
    });

    it("既存2種のうち片方が重複(白+白)では3種に届かずパオ未確定", () => {
      const ctx = {
        existingMelds: [honorPon(HONOR.WHITE), honorPon(HONOR.WHITE)],
        newMeld: honorPon(HONOR.GREEN),
        fromOpponentDiscard: true,
      };
      expect(isPaoTriggeringCall(ctx)).toBe(false);
    });
  });

  describe("大四喜", () => {
    it("風牌3種が副露済み + 4種目をポン → パオ確定", () => {
      const ctx = {
        existingMelds: [
          honorPon(HONOR.EAST),
          honorPon(HONOR.SOUTH),
          honorPon(HONOR.WEST),
        ],
        newMeld: honorPon(HONOR.NORTH),
        fromOpponentDiscard: true,
      };
      expect(isPaoTriggeringCall(ctx)).toBe(true);
    });

    it("4種目を大明槓させても確定する", () => {
      const ctx = {
        existingMelds: [
          honorPon(HONOR.EAST),
          honorPon(HONOR.SOUTH),
          honorPon(HONOR.NORTH),
        ],
        newMeld: honorDaiminkan(HONOR.WEST),
        fromOpponentDiscard: true,
      };
      expect(isPaoTriggeringCall(ctx)).toBe(true);
    });

    it("風牌2種しか副露していなければパオ未確定(小四喜止まり)", () => {
      const ctx = {
        existingMelds: [honorPon(HONOR.EAST), honorPon(HONOR.SOUTH)],
        newMeld: honorPon(HONOR.WEST),
        fromOpponentDiscard: true,
      };
      expect(isPaoTriggeringCall(ctx)).toBe(false);
    });

    it("自力完成(相手の打牌でない)ならパオなし", () => {
      const ctx = {
        existingMelds: [
          honorPon(HONOR.EAST),
          honorPon(HONOR.SOUTH),
          honorPon(HONOR.WEST),
        ],
        newMeld: honorPon(HONOR.NORTH),
        fromOpponentDiscard: false,
      };
      expect(isPaoTriggeringCall(ctx)).toBe(false);
    });
  });

  describe("四槓子", () => {
    it("3槓確定 + 4つ目の大明槓 → パオ確定", () => {
      const ctx = {
        existingMelds: [
          suitKan("pin", 1),
          suitKan("sou", 2),
          suitKan("man", 9),
        ],
        newMeld: suitKan("pin", 5),
        fromOpponentDiscard: true,
      };
      expect(isPaoTriggeringCall(ctx)).toBe(true);
    });

    it("2槓しかなければ4つ目の槓でもパオ未確定", () => {
      const ctx = {
        existingMelds: [suitKan("pin", 1), suitKan("sou", 2)],
        newMeld: suitKan("man", 9),
        fromOpponentDiscard: true,
      };
      expect(isPaoTriggeringCall(ctx)).toBe(false);
    });

    it("4つ目が暗槓/加槓(相手の打牌でない)ならパオなし", () => {
      const ctx = {
        existingMelds: [
          suitKan("pin", 1),
          suitKan("sou", 2),
          suitKan("man", 9),
        ],
        newMeld: suitKan("pin", 5, true),
        fromOpponentDiscard: false,
      };
      expect(isPaoTriggeringCall(ctx)).toBe(false);
    });

    it("既存3槓は暗槓混在でも4つ目の大明槓成立でパオ確定", () => {
      const ctx = {
        existingMelds: [
          suitKan("pin", 1, true),
          suitKan("sou", 2, true),
          suitKan("man", 9, true),
        ],
        newMeld: suitKan("pin", 5),
        fromOpponentDiscard: true,
      };
      expect(isPaoTriggeringCall(ctx)).toBe(true);
    });
  });

  describe("非パオ役満・通常役", () => {
    it("通常の役牌ポン(白のみ)ではパオなし", () => {
      const ctx = {
        existingMelds: [],
        newMeld: honorPon(HONOR.WHITE),
        fromOpponentDiscard: true,
      };
      expect(isPaoTriggeringCall(ctx)).toBe(false);
    });
  });
});
