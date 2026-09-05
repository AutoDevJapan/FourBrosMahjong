/**
 * 山(壁)= ライブ壁・王牌・嶺上の供給(スペック4 4.1 `Wall`)。
 *
 * 108枚を「ライブ壁(ツモ山)」と「王牌(嶺上牌を含む)」に区分し、
 * `draw()`(通常ツモ)と `drawReplacement()`(嶺上補充: 北抜き/カン時)を提供する。
 *
 * 不変条件(スペック4 4.4): 山に属する牌の総数(`liveWall + deadWall`)+
 * 場外に出た牌(ツモ済み)= 常に108枚。本クラスは山の内部だけを管理する。
 *
 * ドラ表示牌との責務分担(#386):
 * - **選定**(枚数・表裏の対応・どの牌が表示牌か)は `DoraSet` の責務。本クラスは決めない。
 * - **領域の確保**は本クラスの責務。王牌の先頭 {@link DORA_INDICATOR_RESERVE} 枚を
 *   表示牌が置かれる領域として確保し、**嶺上牌として供給しない**。場に晒された表示牌が
 *   プレイヤーの手に渡らないことを構造的に保証する。
 *
 * ⚠️ `deadWallSize` の厳密値はスペック未確定(標準の14枚を既定とし、パラメタ化)。
 * 詳細は下記コンストラクタ注記を参照。
 */

import { MAX_OMOTE_DORA_COUNT } from "../dora/dice";
import type { Rng } from "../random/rng";
import { shuffle } from "../random/shuffle";
import { createTile, isRedDora, type Suit, type Tile } from "../tiles/tile";
import {
  buildTileSet,
  COPIES_PER_TILE,
  TOTAL_TILE_COUNT,
} from "../tiles/tileSet";

/**
 * 王牌の既定枚数。標準麻雀の王牌は14枚(嶺上4 + ドラ表示領域)。
 *
 * 本変種は開門サイコロ出目でドラ枚数が1〜3と変動する(スペック2 2.2)が、
 * 王牌そのものの枚数を変える根拠はスペックに無いため、標準の14枚を既定とする。
 * 将来スペックで確定・修正された場合はこの定数のみ変更すればよい
 * (不変条件「総数108」は `deadWallSize` に依存しない)。
 */
export const DEAD_WALL_SIZE = 14;

/**
 * ドラ表示牌のために王牌の**先頭側へ確保**する枚数(表 + 裏 = 上限枚数 × 2 = 6)。
 *
 * この領域の牌は嶺上牌として供給されない(#386)。`createDoraSet` は王牌先頭から
 * 表 `count` 枚 + 裏 `count` 枚を取るため(スペック2 2.2)、`count` が上限の 3 でも
 * 表示牌はこの領域に収まる。確保を最大枚数で固定するのは、`Wall` が構築時点で
 * 開門サイコロの出目(= `count`)を知らないためである。
 */
export const DORA_INDICATOR_RESERVE = MAX_OMOTE_DORA_COUNT * 2;

/**
 * 1局でカン由来の嶺上牌を引ける回数の上限。
 *
 * 到達経路は2つあり、大きい方が上限になる。
 *
 * 1. **1人四槓**(四槓子の機会を残すため散了しない): その家の手牌に作れる面子は
 *    最大4つ(14枚 = 4面子 + 雀頭)なので **4回**。四槓散了のしきい値には依存しない。
 * 2. **複数家にまたがる**: 四槓散了のしきい値の1つ手前まで(散了判定は嶺上補充より
 *    先に行われるため、散了させたカンは嶺上を引かない)= `FOUR_KAN_ABORT_THRESHOLD − 1` 回。
 *
 * 現状は 1 が 4、2 が 3 なので上限は 4。**駆動しているのは手牌の面子上限であり、
 * `FOUR_KAN_ABORT_THRESHOLD` が同じ 4 なのは偶然の一致**である。両者の関係
 * (`FOUR_KAN_ABORT_THRESHOLD − 1 <= MAX_KAN_PER_HAND`)は
 * `src/domain/integration/dead-wall-budget.integration.test.ts` で照合している。
 */
export const MAX_KAN_PER_HAND = 4;

/**
 * 1局で発生し得る嶺上補充の上限。
 *
 * - **北抜き(ガリ)**: 北は {@link COPIES_PER_TILE} 枚しかないため最大4回。
 * - **カン**: {@link MAX_KAN_PER_HAND} 回(= 手牌に作れる面子の上限)。
 *
 * これは嶺上供給領域(`DEAD_WALL_SIZE − DORA_INDICATOR_RESERVE` = 8枚)を決める
 * **設計上の安全側の見積り**である。実際にはライブ壁から補填が入るため、
 * ライブ壁が残る限り補充回数に上限は無く、供給領域も減らない。供給領域が実際に
 * 減るのは**海底(補填不可)での補充**だけである。
 *
 * 守るべき不変条件は
 * `DEAD_WALL_SIZE − DORA_INDICATOR_RESERVE >= MAX_REPLACEMENTS_PER_HAND`
 * (現状は右辺 8 で等号成立)。王牌枚数・表ドラ上限・カン上限のいずれかを変える際は
 * `src/domain/integration/dead-wall-budget.integration.test.ts` で再検証すること。
 */
export const MAX_REPLACEMENTS_PER_HAND = COPIES_PER_TILE + MAX_KAN_PER_HAND;

function tileKey(tile: Tile): string {
  return `${tile.suit}-${tile.rank}-${tile.isRed ? "r" : "n"}`;
}

function isSuit(value: unknown): value is Suit {
  return (
    value === "man" || value === "pin" || value === "sou" || value === "honor"
  );
}

/**
 * Wall の実行時境界で受け入れられる牌の形と不変条件を検証する。
 *
 * `Tile` は TypeScript の構造型なので、JSON や型アサーションを経由した値が
 * `Wall` へ届くと、文字列化を使った多重集合キーだけでは `rank: "1"` のような
 * 値を数値 rank と同一視してしまう。正準牌のキーを作る前に、プリミティブ型・
 * カタログ上の牌種・ファクトリが決める赤フラグを確認する。
 */
function isCanonicalTile(value: unknown): value is Tile {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const tile = value as Record<string, unknown>;
  const ownKeys = Reflect.ownKeys(tile);
  if (
    ownKeys.length !== 3 ||
    !["suit", "rank", "isRed"].every((key) =>
      Object.prototype.hasOwnProperty.call(tile, key),
    )
  ) {
    return false;
  }

  const suit = tile.suit;
  const rank = tile.rank;
  const isRed = tile.isRed;
  if (!isSuit(suit) || typeof rank !== "number" || !Number.isInteger(rank)) {
    return false;
  }

  const validKind =
    (suit === "honor" && rank >= 1 && rank <= 7) ||
    (suit === "man" && (rank === 1 || rank === 9)) ||
    ((suit === "pin" || suit === "sou") && rank >= 1 && rank <= 9);

  return (
    validKind &&
    typeof isRed === "boolean" &&
    isRed === isRedDora(createTile(suit, rank))
  );
}

function hasCanonicalTileMultiset(tiles: readonly Tile[]): boolean {
  const expected = new Map<string, number>();
  for (const tile of buildTileSet()) {
    const key = tileKey(tile);
    expected.set(key, (expected.get(key) ?? 0) + 1);
  }

  const actual = new Map<string, number>();
  for (const tile of tiles) {
    if (!isCanonicalTile(tile)) return false;
    const key = tileKey(tile);
    actual.set(key, (actual.get(key) ?? 0) + 1);
  }

  if (actual.size !== expected.size) return false;
  for (const [key, count] of expected) {
    if (actual.get(key) !== count) return false;
  }
  return true;
}

/** 山が尽きている状態で `draw()`/`drawReplacement()` を呼んだ場合に投げる。 */
export class WallEmptyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WallEmptyError";
  }
}

/**
 * 1局分の山。構築後は `draw()`/`drawReplacement()` で消費される可変エンティティ。
 * 席割り・親決め(Q9〜Q11)には一切関与しない。
 */
export class Wall {
  /** ライブ壁。先頭が次のツモ牌。 */
  private readonly _live: Tile[];
  /**
   * 王牌のうち**ドラ表示牌用に確保した先頭側**({@link DORA_INDICATOR_RESERVE} 枚)。
   * 嶺上として供給しないため、場に晒された表示牌が手に渡ることは構造的に起きない(#386)。
   */
  private readonly _reserved: Tile[];
  /**
   * 王牌のうち**嶺上供給に使う残り**。末尾から供給し、ライブ壁からの補填は先頭へ入る。
   * 供給と補填が同じ配列で閉じているため、表示牌が押し出されて配られることがない。
   */
  private readonly _rinshan: Tile[];

  /**
   * @param tiles        108枚の牌(通常はシャッフル済み)。順序はそのまま採用する。
   * @param deadWallSize 王牌に確保する枚数(既定 {@link DEAD_WALL_SIZE})。
   *   **0(王牌なし)** か **{@link DORA_INDICATOR_RESERVE} 以上**の整数でなければならない。
   * @throws RangeError 牌が正準の108枚でないとき、`deadWallSize` が整数でないとき、
   *   `[0, 108]` の範囲外のとき、または 1〜{@link DORA_INDICATOR_RESERVE}−1 のとき。
   */
  constructor(tiles: readonly Tile[], deadWallSize: number = DEAD_WALL_SIZE) {
    if (tiles.length !== TOTAL_TILE_COUNT) {
      throw new RangeError(
        `Wall requires exactly ${TOTAL_TILE_COUNT} tiles, received ${tiles.length}.`,
      );
    }
    if (!hasCanonicalTileMultiset(tiles)) {
      throw new RangeError(
        "Wall requires the canonical tile multiset for this game variant.",
      );
    }
    // NaN / 小数は以下の比較をすり抜けて壊れた `Wall` を作るため、最初に弾く。
    if (!Number.isInteger(deadWallSize)) {
      throw new RangeError(
        `deadWallSize must be an integer, received ${deadWallSize}.`,
      );
    }
    if (deadWallSize < 0 || deadWallSize > tiles.length) {
      throw new RangeError(
        `deadWallSize must be within [0, ${tiles.length}], received ${deadWallSize}.`,
      );
    }
    // 0 は「王牌なし」の明示的な構成として許す。1〜5 は表示牌領域を確保すると嶺上が
    // 1枚も供給できなくなり、遅延した WallEmptyError になるため構築時に落とす(#386)。
    if (deadWallSize > 0 && deadWallSize < DORA_INDICATOR_RESERVE) {
      throw new RangeError(
        `deadWallSize must be 0 or at least ${DORA_INDICATOR_RESERVE} (dora indicator reserve), received ${deadWallSize}.`,
      );
    }
    const boundary = tiles.length - deadWallSize;
    this._live = tiles.slice(0, boundary);
    const dead = tiles.slice(boundary);
    // コンストラクタのガードにより `dead.length` は 0 か `DORA_INDICATOR_RESERVE` 以上。
    const reserve = Math.min(DORA_INDICATOR_RESERVE, dead.length);
    this._reserved = dead.slice(0, reserve);
    this._rinshan = dead.slice(reserve);
  }

  /** ライブ壁の現在の内容を切り離した読み取り専用スナップショット。 */
  get liveWall(): readonly Tile[] {
    // `readonly` は実行時には消えるため、内部配列をそのまま返すと
    // `as Tile[]` 等を経由した呼び出し側の shift/splice/pop が壁を壊す。
    // deadWall と同じく配列を切り離し、ツモ状態の所有権を Wall に閉じ込める。
    return [...this._live];
  }

  /**
   * 王牌の現在の内容。ドラ表示の選定は `DoraSet` の責務。
   *
   * 先頭 {@link DORA_INDICATOR_RESERVE} 枚がドラ表示牌用の確保領域、残りが嶺上供給
   * 領域。**末尾が次に供給される嶺上牌**である(この対応は補充後も保たれる)。
   *
   * 内部の2領域を連結した**呼び出し時点のスナップショット**を毎回新しい配列で返す。
   * 以後の消費は反映されないので、枚数を追跡したい場合は都度取得すること。
   */
  get deadWall(): readonly Tile[] {
    return [...this._reserved, ...this._rinshan];
  }

  /** 残りの嶺上供給可能枚数(確保領域は含めない)。 */
  get remainingReplacements(): number {
    return this._rinshan.length;
  }

  /** ライブ壁に残るツモ可能枚数(0 で海底 / スペック2 2.1)。 */
  get remainingLiveTiles(): number {
    return this._live.length;
  }

  /**
   * 通常ツモ。ライブ壁の先頭から1枚取り出して返す。
   * @throws WallEmptyError ライブ壁が空(海底)のとき。
   */
  draw(): Tile {
    const tile = this._live.shift();
    if (tile === undefined) {
      throw new WallEmptyError(
        "Live wall is empty; no tiles left to draw (海底).",
      );
    }
    return tile;
  }

  /**
   * 嶺上補充(北抜き「ガリ」/カン時 / スペック2 2.3)。王牌から嶺上牌を1枚返す。
   *
   * 標準ルールに従い、王牌はライブ壁の末尾から1枚補填して枚数を保つ
   * (結果としてライブ壁が1枚減り、海底が早まる)。ライブ壁が空なら補填せず
   * 嶺上供給領域が減っていく。
   *
   * **ドラ表示牌用の確保領域からは決して供給しない**(#386)。供給(末尾から `pop`)も
   * 補填(先頭へ `unshift`)も嶺上供給領域の内側で閉じているため、場に晒された表示牌が
   * 押し出されてプレイヤーの手に渡ることは構造的に起きない。ライブ壁が有る限り
   * 補充回数に上限は無く、無くなっても {@link MAX_REPLACEMENTS_PER_HAND} 回までは供給できる。
   *
   * @throws WallEmptyError 嶺上供給領域が尽きたとき(残るのは表示牌のみで、配れない)。
   */
  drawReplacement(): Tile {
    const tile = this._rinshan.pop();
    if (tile === undefined) {
      throw new WallEmptyError(
        "Dead wall has no replacement tile left; the remaining tiles are reserved dora indicators and are never dealt.",
      );
    }
    const replenishment = this._live.pop();
    if (replenishment !== undefined) {
      this._rinshan.unshift(replenishment);
    }
    return tile;
  }
}

/**
 * 全108枚を生成・シャッフルして `Wall` を構築する便宜関数。
 *
 * @param rng          乱数源(テストでは固定 seed の `Rng` を渡して再現)。
 * @param deadWallSize 王牌枚数(既定 {@link DEAD_WALL_SIZE})。
 */
export function buildWall(
  rng: Rng,
  deadWallSize: number = DEAD_WALL_SIZE,
): Wall {
  return new Wall(shuffle(buildTileSet(), rng), deadWallSize);
}
