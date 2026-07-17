/**
 * 牌の視覚素材(SVG ファイル)への写像を導出する純関数(スペック6 6.7 の表示層)。
 *
 * 素材は FluffyStuff/riichi-mahjong-tiles(CC0 パブリックドメイン)を `public/tiles/` に
 * 同梱したもの。出典は `public/tiles/CREDITS.md` を参照。ここで扱うのは「どの牌にどの SVG を
 * 割り当てるか」という表示写像のみで、ゲームロジック(赤5の不変条件・スート値域等)は
 * ドメイン層(`src/domain/tiles/`)が SSOT であり、本モジュールは一切それを変更・再定義しない。
 *
 * 四兄弟麻雀=サンマのため萬子は 1・9 のみ、赤5は 5筒・5索(`Pin5-Dora`/`Sou5-Dora`)。
 * これらは実使用牌として `public/tiles/` に同梱済み(`Man2`〜`Man8`・`Man5-Dora` は非同梱)。
 */
import type { TileData } from "../game/types";

/** SVG を配信する公開パス(`public/tiles/`)。 */
const TILE_DIR = "/tiles";

/** 数牌スート → SVG ファイル名の接頭辞。 */
const SUIT_PREFIX: Record<Exclude<TileData["suit"], "honor">, string> = {
  man: "Man",
  pin: "Pin",
  sou: "Sou",
};

/**
 * 字牌 rank → SVG ファイル名(`tileLabel.ts` / `domain/tiles` の並びに一致)。
 * 東1・南2・西3・北4・白5・發6・中7。北は北ガリ対象牌でも同素材を共用する。
 */
const HONOR_FILE = [
  "", // rank 0 は未使用
  "Ton", // 東
  "Nan", // 南
  "Shaa", // 西
  "Pei", // 北
  "Haku", // 白
  "Hatsu", // 發
  "Chun", // 中
] as const;

/** 伏せ牌(内容非開示)の裏面素材。 */
export const TILE_BACK_SRC = `${TILE_DIR}/Back.svg`;

/**
 * 牌の面(おもて)を表す SVG ファイル名(拡張子なし)を返す。
 *
 * 赤5(5筒・5索)は色の付いた `*-Dora` 素材を割り当て、色手がかりを補強する
 * (形状差=赤枠+「赤」バッジは `Tile.tsx` 側で別途付与し、色のみに依存しない / スペック5 5.2.1)。
 */
export function tileImageName(tile: TileData): string {
  if (tile.suit === "honor") {
    return HONOR_FILE[tile.rank] ?? "Back";
  }
  const prefix = SUIT_PREFIX[tile.suit];
  if (tile.isRed === true && tile.rank === 5) {
    return `${prefix}5-Dora`;
  }
  return `${prefix}${tile.rank}`;
}

/** 牌の面(おもて)SVG への公開パス(例: `/tiles/Pin5-Dora.svg`)。 */
export function tileImageSrc(tile: TileData): string {
  return `${TILE_DIR}/${tileImageName(tile)}.svg`;
}
