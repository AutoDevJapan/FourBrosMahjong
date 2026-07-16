import { describe, expect, it } from "vitest";
import { HONOR, type Suit, type Tile } from "./tile";

describe("Tile モデル(スペック4 4.2)", () => {
  it("suit / rank / isRed を表現できる", () => {
    const redFivePin: Tile = { suit: "pin", rank: 5, isRed: true };
    expect(redFivePin.suit).toBe<Suit>("pin");
    expect(redFivePin.rank).toBe(5);
    expect(redFivePin.isRed).toBe(true);
  });

  it("字牌の rank 割り当てが UI(tileLabel.ts)と一致する: 東1南2西3北4白5發6中7", () => {
    expect(HONOR).toEqual({
      EAST: 1,
      SOUTH: 2,
      WEST: 3,
      NORTH: 4,
      WHITE: 5,
      GREEN: 6,
      RED: 7,
    });
  });

  it("北(ガリ対象)の rank は 4", () => {
    expect(HONOR.NORTH).toBe(4);
  });
});
