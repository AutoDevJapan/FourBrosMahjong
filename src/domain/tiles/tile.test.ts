import { describe, expect, it } from "vitest";
import { createTile, HONOR, type Suit, type Tile } from "./tile";

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

/**
 * `createTile` は牌種 → `Tile` の唯一のファクトリ(issue #375)。
 * オール赤5(スペック1 1.2 / スペック4 4.4「赤5は5筒・5索に限る」)は
 * ここだけが知る不変条件なので、期待値は実装式を再利用せず**リテラルで**固定する。
 */
describe("createTile(牌種 → Tile の唯一のファクトリ / issue #375)", () => {
  /** 数牌のスート(rank 1〜9)。 */
  const NUMBER_SUITS: readonly Suit[] = ["man", "pin", "sou"];
  /** 字牌の rank 上限(東南西北白發中)。 */
  const HONOR_RANK_MAX = 7;

  it("5筒・5索は赤(オール赤5)", () => {
    expect(createTile("pin", 5)).toEqual({ suit: "pin", rank: 5, isRed: true });
    expect(createTile("sou", 5)).toEqual({ suit: "sou", rank: 5, isRed: true });
  });

  it("赤になるのは5筒・5索**だけ**(数牌1〜9 × 字牌1〜7 の全数)", () => {
    const reds: string[] = [];
    for (const suit of NUMBER_SUITS) {
      for (let rank = 1; rank <= 9; rank++) {
        if (createTile(suit, rank).isRed) reds.push(`${suit}-${rank}`);
      }
    }
    for (let rank = 1; rank <= HONOR_RANK_MAX; rank++) {
      if (createTile("honor", rank).isRed) reds.push(`honor-${rank}`);
    }
    expect(reds).toEqual(["pin-5", "sou-5"]);
  });

  it("5萬は赤にしない(萬子に5は存在しないが、要求されても赤にはしない)", () => {
    expect(createTile("man", 5).isRed).toBe(false);
  });

  it("白(字牌 rank 5)を rank 一致だけで赤にしない", () => {
    expect(createTile("honor", HONOR.WHITE).isRed).toBe(false);
  });

  it("suit / rank は加工せずそのまま保持する", () => {
    const tile: Tile = createTile("sou", 9);
    expect(tile.suit).toBe<Suit>("sou");
    expect(tile.rank).toBe(9);
  });

  it("牌種の実在性は検証しない(範囲外 rank もそのまま返す)", () => {
    // 実在牌種の母集合は SANMA_TILE_KINDS、山の構成は buildTileSet の責務。
    // ファクトリを検証責務で膨らませないことを固定する。
    expect(createTile("man", 3)).toEqual({
      suit: "man",
      rank: 3,
      isRed: false,
    });
    expect(createTile("honor", 9)).toEqual({
      suit: "honor",
      rank: 9,
      isRed: false,
    });
  });
});
