/**
 * 山(壁)= ライブ壁・王牌・嶺上の供給(スペック4 4.1 `Wall`)。
 *
 * 108枚を「ライブ壁(ツモ山)」と「王牌(嶺上牌を含む)」に区分し、
 * `draw()`(通常ツモ)と `drawReplacement()`(嶺上補充: 北抜き/カン時)を提供する。
 *
 * 不変条件(スペック4 4.4): 山に属する牌の総数(`liveWall + deadWall`)+
 * 場外に出た牌(ツモ済み)= 常に108枚。本クラスは山の内部だけを管理する。
 *
 * ⚠️ スコープ外(本 issue #63 では扱わない):
 * - ドラ表示牌の選定(サイコロ出目由来の枚数 / スペック2 2.2)は別 issue #64。
 *   本クラスは `deadWall` を読めるように公開するだけで、どの牌が表/裏ドラ表示かは決めない。
 * - `deadWallSize` の厳密値はスペック未確定(標準の14枚を既定とし、パラメタ化)。
 *   詳細は下記コンストラクタ注記を参照。
 */

import type { Rng } from "../random/rng";
import { shuffle } from "../random/shuffle";
import type { Tile } from "../tiles/tile";
import { buildTileSet, TOTAL_TILE_COUNT } from "../tiles/tileSet";

/**
 * 王牌の既定枚数。標準麻雀の王牌は14枚(嶺上4 + ドラ表示領域)。
 *
 * 本変種は開門サイコロ出目でドラ枚数が1〜3と変動する(スペック2 2.2)が、
 * 王牌そのものの枚数を変える根拠はスペックに無いため、標準の14枚を既定とする。
 * 将来スペックで確定・修正された場合はこの定数のみ変更すればよい
 * (不変条件「総数108」は `deadWallSize` に依存しない)。
 */
export const DEAD_WALL_SIZE = 14;

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
  /** 王牌(末尾側を嶺上として消費)。 */
  private readonly _dead: Tile[];

  /**
   * @param tiles        108枚の牌(通常はシャッフル済み)。順序はそのまま採用する。
   * @param deadWallSize 王牌に確保する枚数(既定 {@link DEAD_WALL_SIZE})。
   * @throws RangeError 枚数が108でない、または `deadWallSize` が範囲外のとき。
   */
  constructor(tiles: readonly Tile[], deadWallSize: number = DEAD_WALL_SIZE) {
    if (tiles.length !== TOTAL_TILE_COUNT) {
      throw new RangeError(
        `Wall requires exactly ${TOTAL_TILE_COUNT} tiles, received ${tiles.length}.`,
      );
    }
    if (deadWallSize < 0 || deadWallSize > tiles.length) {
      throw new RangeError(
        `deadWallSize must be within [0, ${tiles.length}], received ${deadWallSize}.`,
      );
    }
    const boundary = tiles.length - deadWallSize;
    this._live = tiles.slice(0, boundary);
    this._dead = tiles.slice(boundary);
  }

  /** ライブ壁の現在の内容(読み取り専用ビュー)。 */
  get liveWall(): readonly Tile[] {
    return this._live;
  }

  /** 王牌の現在の内容(読み取り専用ビュー)。ドラ表示の選定は #64 の責務。 */
  get deadWall(): readonly Tile[] {
    return this._dead;
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
   * 王牌が減っていく。北は4枚+カンで嶺上要求が標準の4回を超え得るため、
   * 上限は設けず「王牌が尽きるまで」補充可能とする。
   *
   * @throws WallEmptyError 王牌が空で嶺上牌が無いとき。
   */
  drawReplacement(): Tile {
    const tile = this._dead.pop();
    if (tile === undefined) {
      throw new WallEmptyError(
        "Dead wall is empty; no replacement tile available.",
      );
    }
    const replenishment = this._live.pop();
    if (replenishment !== undefined) {
      this._dead.unshift(replenishment);
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
