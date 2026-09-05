import { describe, expect, it } from "vitest";
import {
  deriveSeating,
  type PlayerRing,
  RING_SIZE,
  SEATED_SEATS,
  seatedPlayers,
} from "./seat";

const ORDER: PlayerRing<string> = ["A", "B", "C", "D"];

describe("deriveSeating", () => {
  it("dealerIndex=0 で 東=order[0]・南/西 と抜け番を割り当てる", () => {
    expect(deriveSeating(ORDER, 0)).toEqual({
      east: "A",
      south: "B",
      west: "C",
      benchWarmer: "D",
    });
  });

  it("親流れ(dealerIndex +1)で1席回転する: 旧南→東・旧西→南・旧北(抜け番)→西・旧東→抜け番", () => {
    const before = deriveSeating(ORDER, 0);
    const after = deriveSeating(ORDER, 1);
    expect(after.east).toBe(before.south); // 旧南 → 新東(親)
    expect(after.south).toBe(before.west); // 旧西 → 南
    expect(after.west).toBe(before.benchWarmer); // 旧抜け番(北) → 西(復帰)
    expect(after.benchWarmer).toBe(before.east); // 旧東(親) → 抜け番
  });

  it("抜け番は常に直前の親(dealerIndex-1 の東)", () => {
    for (let d = 0; d < RING_SIZE; d++) {
      expect(deriveSeating(ORDER, d).benchWarmer).toBe(
        deriveSeating(ORDER, d - 1).east,
      );
    }
  });

  it("1周(4局)で4人が過不足なく1度ずつ親・抜け番になる", () => {
    const dealers = new Set<string>();
    const benched = new Set<string>();
    for (let d = 0; d < RING_SIZE; d++) {
      const s = deriveSeating(ORDER, d);
      dealers.add(s.east);
      benched.add(s.benchWarmer);
      // 毎局、着席3人+抜け番=全員で重複なし
      expect(new Set([s.east, s.south, s.west, s.benchWarmer]).size).toBe(
        RING_SIZE,
      );
    }
    expect(dealers).toEqual(new Set(ORDER));
    expect(benched).toEqual(new Set(ORDER));
  });

  it("dealerIndex は剰余を取るので任意整数・負値でも周期4で一致する", () => {
    expect(deriveSeating(ORDER, 4)).toEqual(deriveSeating(ORDER, 0));
    expect(deriveSeating(ORDER, -1)).toEqual(deriveSeating(ORDER, 3));
    expect(deriveSeating(ORDER, 7)).toEqual(deriveSeating(ORDER, 3));
  });

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    1.5,
  ])("非整数の dealerIndex=%s は RangeError", (dealerIndex) => {
    expect(() => deriveSeating(ORDER, dealerIndex)).toThrow(RangeError);
  });
});

describe("seatedPlayers", () => {
  it("着席3人を席順(東→南→西)で返し抜け番は含まない", () => {
    const seating = deriveSeating(ORDER, 0);
    expect(seatedPlayers(seating)).toEqual(["A", "B", "C"]);
    expect(seatedPlayers(seating)).not.toContain(seating.benchWarmer);
  });

  it("SEATED_SEATS は東/南/西の3席", () => {
    expect(SEATED_SEATS).toEqual(["east", "south", "west"]);
  });
});
