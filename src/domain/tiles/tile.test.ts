import { describe, expect, it } from "vitest";
import { createTile, HONOR, isRedDora, type Suit, type Tile } from "./tile";

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
  /**
   * 字牌の rank 上限(東南西北白發中)。
   * `HONOR` から導出せずリテラルで固定するのは、検証対象の定数が壊れたときに
   * このテストも一緒に壊れて検出できなくなるのを避けるため。
   */
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

  it("呼び出しごとに新しいオブジェクトを返す(インスタンスを共有しない)", () => {
    // 山は同一牌種を4枚並べる(`buildTileSet`)。エンジンの牌除去は値比較で
    // 1枚ずつ `splice` するため、4枚が同一参照だと配列操作の意味が変わる。
    // 「同じ牌種はメモ化しよう」という将来の最適化を、ここで明示的に禁じる。
    expect(createTile("pin", 5)).not.toBe(createTile("pin", 5));
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

describe("isRedDora(赤扱い判定の唯一の述語 / issue #485)", () => {
  it("5筒・5索の isRed=true のみ true", () => {
    expect(isRedDora({ suit: "pin", rank: 5, isRed: true })).toBe(true);
    expect(isRedDora({ suit: "sou", rank: 5, isRed: true })).toBe(true);
  });

  // `Tile` は実行時検証を持たないため、復元データ等が不変条件を破った isRed を
  // 持ち込み得る。牌種を見ずに `tile.isRed` を信じると仕様外の赤ドラ翻が混入する。
  it.each<[string, Suit, number]>([
    ["赤5萬(サンマに5萬は無い)", "man", 5],
    ["1萬", "man", 1],
    ["4筒(非5)", "pin", 4],
    ["6索(非5)", "sou", 6],
    ["白(字牌 rank 5)", "honor", HONOR.WHITE],
  ])("仕様外の赤フラグは無視する: %s", (_label, suit, rank) => {
    expect(isRedDora({ suit, rank, isRed: true })).toBe(false);
  });

  it.each<[string, Suit, number]>([
    ["5筒", "pin", 5],
    ["5索", "sou", 5],
  ])("赤フラグが無い/省略された %s は false", (_label, suit, rank) => {
    expect(isRedDora({ suit, rank, isRed: false })).toBe(false);
    expect(isRedDora({ suit, rank })).toBe(false); // 表示用 TileData は isRed 省略可
  });

  // 外部入力を受ける前提の関数なので、判定は truthy ではなく厳密に `=== true`。
  // `!!tile.isRed` へ緩める退行をここで捕まえる。
  it("truthy だが true ではない isRed は赤扱いしない", () => {
    const bogus = {
      suit: "pin" as Suit,
      rank: 5,
      isRed: 1 as unknown as boolean,
    };
    expect(isRedDora(bogus)).toBe(false);
    expect(isRedDora({ ...bogus, isRed: "true" as unknown as boolean })).toBe(
      false,
    );
  });

  it.each([null, undefined])(
    "不正な外部値 %s は例外にせず赤扱いしない",
    (value) => {
      expect(
        isRedDora(value as unknown as Parameters<typeof isRedDora>[0]),
      ).toBe(false);
    },
  );

  // このループは赤5ルールを独立に検証するものではない(両者は同じ内部式を共有する)。
  // 目的は「生成と判定が将来切り離されたら落ちる」ことの固定。
  it("createTile の不変条件と一致する(判定と生成が同じ規則を共有する)", () => {
    const suits: Suit[] = ["man", "pin", "sou", "honor"];
    for (const suit of suits) {
      for (let rank = 1; rank <= 9; rank++) {
        const tile = createTile(suit, rank);
        expect(isRedDora(tile)).toBe(tile.isRed);
      }
    }
  });
});
