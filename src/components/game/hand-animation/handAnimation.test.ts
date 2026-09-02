import { describe, expect, it } from "vitest";
import { classifyHandTransition, findNewTileIndex } from "./handAnimation";

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

describe("classifyHandTransition", () => {
  it("marks the first visible hand as a deal and affects every tile", () => {
    expect(classifyHandTransition(null, [man1, pin5, sou9])).toEqual({
      kind: "deal",
      newTileIndex: null,
      affectedTileIndices: [0, 1, 2],
    });
  });

  it("distinguishes a one-tile draw from a same-size replacement", () => {
    expect(classifyHandTransition([man1, sou9], [man1, pin5, sou9])).toEqual({
      kind: "draw",
      newTileIndex: 1,
      affectedTileIndices: [1],
    });
    expect(classifyHandTransition([man1, pin5], [man1, sou9])).toEqual({
      kind: "replacement",
      newTileIndex: 1,
      affectedTileIndices: [1],
    });
  });

  it("marks a pon shrink as a meld reflow without inventing a new tile", () => {
    expect(
      classifyHandTransition(
        [man1, pin5, sou9, { suit: "honor", rank: 1 }],
        [man1, sou9],
      ),
    ).toEqual({
      kind: "meld",
      newTileIndex: null,
      affectedTileIndices: [0, 1],
    });
  });

  it("marks a kan plus replacement as one meld transition", () => {
    const replacement = { suit: "honor", rank: 2 } as const;
    expect(
      classifyHandTransition(
        [
          man1,
          pin5,
          sou9,
          { suit: "honor", rank: 1 },
          { suit: "honor", rank: 3 },
        ],
        [man1, { suit: "honor", rank: 3 }, replacement],
      ),
    ).toEqual({
      kind: "meld",
      newTileIndex: 2,
      affectedTileIndices: [0, 1, 2],
    });
  });

  it("treats a full-size multi-tile replacement as a new deal once", () => {
    const previous = [
      ...Array.from({ length: 9 }, (_, index) => ({
        suit: "man" as const,
        rank: index + 1,
      })),
      ...Array.from({ length: 4 }, (_, index) => ({
        suit: "pin" as const,
        rank: index + 1,
      })),
    ];
    const current = [
      ...Array.from({ length: 9 }, (_, index) => ({
        suit: "sou" as const,
        rank: index + 1,
      })),
      ...Array.from({ length: 4 }, (_, index) => ({
        suit: "honor" as const,
        rank: index + 1,
      })),
    ];

    expect(classifyHandTransition(previous, current)).toMatchObject({
      kind: "deal",
      newTileIndex: null,
    });
    expect(classifyHandTransition(current, [...current])).toBeNull();
  });
});
