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
 *
 * 表示用 `TileData` は `rank: number` を無制約に受け取る契約(`types.ts`)のため、本モジュールは
 * **同梱素材(カタログ)を網羅した集合**に対して写像を検証し、カタログ外の入力に対しては素材名を
 * 返さず {@link resolveTileFace} が `fallback` を返す。これにより 404・空白牌・裏面誤描画を防ぎ、
 * 表示側で可視のプレースホルダへ確定的に切り替えられる(issue #146)。
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
 * rank 0 や 8 以上はカタログ外(下記 {@link TILE_CATALOG} に含まれない)。
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

/**
 * `public/tiles/` に**実在する牌面素材**(拡張子なし)の網羅集合。
 * `Back` は伏せ牌専用のため表向き牌の写像候補には含めない。
 * ここに無い名前へ写像される入力はカタログ外と判定し、素材参照(404 リスク)を発行しない。
 */
const TILE_CATALOG: ReadonlySet<string> = new Set([
  // 萬子(サンマは 1・9 のみ同梱)
  "Man1",
  "Man9",
  // 筒子 1〜9 + 赤5
  "Pin1",
  "Pin2",
  "Pin3",
  "Pin4",
  "Pin5",
  "Pin6",
  "Pin7",
  "Pin8",
  "Pin9",
  "Pin5-Dora",
  // 索子 1〜9 + 赤5
  "Sou1",
  "Sou2",
  "Sou3",
  "Sou4",
  "Sou5",
  "Sou6",
  "Sou7",
  "Sou8",
  "Sou9",
  "Sou5-Dora",
  // 字牌 7 種
  "Ton",
  "Nan",
  "Shaa",
  "Pei",
  "Haku",
  "Hatsu",
  "Chun",
]);

/**
 * 赤ドラ素材(色付き `*-Dora`)が実在する牌か = **5筒・5索のみ**。
 *
 * ドメイン不変条件(スペック4 4.4「赤5は5筒・5索に限る」)に一致する唯一の判定。
 * `isRed` が 5筒・5索以外(赤5萬・非5・字牌等)に付いていても赤素材は存在しないため、
 * 表示層は赤扱い(色付き素材・赤枠・「赤」バッジ・`(赤ドラ)`)を**発火させない**。
 * これにより牌面・バッジ・ラベルの整合を保つ(issue #146: `isRed` 非整合の解消)。
 */
export function isRedDora(tile: TileData): boolean {
  return (
    tile.isRed === true &&
    tile.rank === 5 &&
    (tile.suit === "pin" || tile.suit === "sou")
  );
}

/**
 * 牌面の解決結果。素材が実在すれば `image`、カタログ外は `fallback`(可視プレースホルダ)。
 * `fallback` は表示層で牌名テキストを描き、裏面や空白牌を出さずに視覚と `aria-label` を一致させる。
 */
export type TileFace =
  | { readonly kind: "image"; readonly name: string; readonly src: string }
  | { readonly kind: "fallback" };

/** カタログ内なら素材名(拡張子なし)、カタログ外なら `null`。 */
function catalogName(tile: TileData): string | null {
  let name: string;
  if (tile.suit === "honor") {
    // rank 0 は HONOR_FILE[0]="" のため `??` では捕捉されないが、カタログ非在で fallback に倒れる。
    name = HONOR_FILE[tile.rank] ?? "";
  } else if (isRedDora(tile)) {
    // 5筒・5索の赤は色付き -Dora 素材(必ずカタログに存在)。
    name = `${SUIT_PREFIX[tile.suit]}5-Dora`;
  } else {
    name = `${SUIT_PREFIX[tile.suit]}${tile.rank}`;
  }
  return TILE_CATALOG.has(name) ? name : null;
}

/**
 * 牌の面(おもて)素材を解決する。カタログ内なら素材名と公開パス、カタログ外なら `fallback`。
 *
 * 赤5(5筒・5索)は色の付いた `*-Dora` 素材を割り当て、色手がかりを補強する
 * (形状差=赤枠+「赤」バッジは `Tile.tsx` 側で別途付与し、色のみに依存しない / スペック5 5.2.1)。
 */
export function resolveTileFace(tile: TileData): TileFace {
  const name = catalogName(tile);
  if (name === null) {
    return { kind: "fallback" };
  }
  return { kind: "image", name, src: `${TILE_DIR}/${name}.svg` };
}
