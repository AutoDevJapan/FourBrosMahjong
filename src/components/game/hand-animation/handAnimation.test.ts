import { describe, expect, it } from "vitest";
import { findNewTileIndex } from "./handAnimation";

const man1 = { suit: "man", rank: 1 } as const;
const pin5 = { suit: "pin", rank: 5 } as const;
const sou9 = { suit: "sou", rank: 9 } as const;

describe("findNewTileIndex", () => {
  it("finds one newly drawn tile in a sorted hand", () => {
    expect(findNewTileIndex([man1, sou9], [man1, pin5, sou9])).toBe(1);
  });

  it("finds the replacement tile when the hand size stays the same", () => {
    expect(findNewTileIndex([man1, pin5], [man1, sou9])).toBe(1);
  });

  it("handles duplicate tiles without confusing their identity", () => {
    expect(
      findNewTileIndex(
        [pin5, pin5],
        [pin5, { suit: "pin", rank: 5, isRed: true }, pin5],
      ),
    ).toBe(1);
  });

  it("ignores removals and multi-tile changes", () => {
    expect(findNewTileIndex([man1, pin5], [man1])).toBeNull();
    expect(
      findNewTileIndex([man1, pin5], [sou9, { suit: "honor", rank: 1 }]),
    ).toBeNull();
  });
});
