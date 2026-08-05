/**
 * 牌モデル(ドメイン層 SSOT / スペック4 4.2)。
 *
 * このモジュールは「牌とは何か」を表す**唯一の正**(Single Source of Truth)。
 * UI 側の表示用ビューモデル(`src/components/game/types.ts` の `TileData`)は、
 * ここで定義する `Tile` を表示用に**写像した投影**にすぎない
 * (issue #63「型重複を避ける方針」: ドメイン `Tile` を SSOT とし、UI は写像する)。
 *
 * ドメイン `Tile` は表示より厳格で、`isRed` は必須(常に真偽が確定する)。
 * `Suit`/`rank` の値域は UI 型と構造的に互換なので、UI へはそのまま渡せる。
 *
 * ゲームロジックのみ。React/DOM 非依存・副作用なし。
 */

/**
 * 牌のスート(スペック4 `Suit`)。字牌は `honor`。
 * UI の `TileData["suit"]` と同じ文字列リテラルで、写像コストをゼロにする。
 */
export type Suit = "man" | "pin" | "sou" | "honor";

/**
 * 牌1枚。値オブジェクト(不変)。
 *
 * - `suit` … スート。
 * - `rank` … 数牌は 1〜9、字牌は下記 {@link HONOR} の 1〜7。
 *   萬子(`man`)はサンマ標準で rank ∈ {1, 9} のみ(2〜8 を抜く / スペック1 1.2)。
 * - `isRed` … オール赤5。5筒・5索は常に `true`、それ以外は常に `false`
 *   (スペック4 4.4 不変条件「赤5は5筒・5索に限る」)。
 *
 * 牌種から生成するときは {@link createTile} を使うこと(不変条件の唯一の定義元)。
 * 逆に、既にある値が赤かを**判定**するときは `tile.isRed` を直接読まず
 * {@link isRedDora} を使うこと。この interface に実行時検証は無く、`createTile` を
 * 経由しない構造的な値は不変条件を破った `isRed` を持ち得るため(issue #485)。
 */
export interface Tile {
  readonly suit: Suit;
  readonly rank: number;
  readonly isRed: boolean;
}

/** オール赤5の対象スート(5筒・5索)。萬子に5は存在しない(スペック1 1.2)。 */
const RED_FIVE_SUITS: ReadonlySet<Suit> = new Set(["pin", "sou"]);

/** オール赤5の対象 rank。 */
const RED_FIVE_RANK = 5;

/** 牌種(`suit` + `rank`)が赤5になり得るか。不変条件そのものの唯一の式。 */
function isRedFiveKind(suit: Suit, rank: number): boolean {
  return rank === RED_FIVE_RANK && RED_FIVE_SUITS.has(suit);
}

/**
 * 赤フラグ判定の入力。ドメインの {@link Tile}(`isRed` 必須)に加え、
 * `isRed` を省略できる表示用ビューモデル(`components/game/types.ts` の `TileData`)や
 * 復元データもそのまま受け取れるよう、`isRed` を任意にした構造で受ける。
 */
type RedDoraCandidate = Pick<Tile, "suit" | "rank"> &
  Partial<Pick<Tile, "isRed">>;

/**
 * 牌が仕様上の赤ドラ(オール赤5 = 5筒・5索)かを判定する**唯一の述語**。
 *
 * `Tile` は実行時検証を持たない公開 interface のため、`createTile` を経由しない
 * 構造的な値(復元データ・外部入力・表示用 `TileData`)は「赤5でないのに
 * `isRed: true`」という仕様外の状態を取り得る。赤扱いの判定をこの関数へ集約し、
 * 得点(`dora/han.ts` の赤ドラ翻)と表示(`components/common/` の色付き素材・
 * 赤枠・「赤」バッジ・`(赤ドラ)` ラベル)が**同じ入力に同じ答えを出す**ことを保証する
 * (issue #146 / #485)。
 *
 * @example
 * isRedDora({ suit: "pin", rank: 5, isRed: true }); // true
 * isRedDora({ suit: "man", rank: 1, isRed: true }); // false(赤5萬は存在しない)
 */
export function isRedDora(tile: RedDoraCandidate): boolean {
  return tile.isRed === true && isRedFiveKind(tile.suit, tile.rank);
}

/**
 * 牌種(`suit` + `rank`)から `Tile` を生成する**唯一のファクトリ**(issue #375)。
 *
 * オール赤5の不変条件(5筒・5索は常に赤 / それ以外は常に非赤 — スペック1 1.2・
 * スペック4 4.4)は**この関数だけが知っている**。`{ suit, rank, isRed: … }` を
 * 直に組み立てると不変条件が分散し、片方だけ直した時に静かな不整合が生まれるため、
 * 牌種から `Tile` を作る箇所はすべてここを経由すること。
 *
 * 牌種の**実在性は検証しない**(サンマに存在しない萬子2〜8 や範囲外 rank でも
 * そのまま返す)。実在牌種の母集合は {@link "../hand/tile-identity".SANMA_TILE_KINDS}、
 * 山の構成は {@link "./tileSet".buildTileSet} の責務。
 */
export function createTile(suit: Suit, rank: number): Tile {
  return {
    suit,
    rank,
    isRed: isRedFiveKind(suit, rank),
  };
}

/**
 * 字牌の rank 割り当て。UI 側(`tileLabel.ts` / `types.ts`)の並びと一致させる:
 * 東1・南2・西3・北4・白5・發6・中7。
 *
 * 北(`NORTH`)は局中は通常の字牌だが、抜きドラ「ガリ」の対象
 * (操作・加点は → スペック2 2.3 / 別 issue)。ここでは識別子のみ提供する。
 */
export const HONOR = {
  EAST: 1,
  SOUTH: 2,
  WEST: 3,
  NORTH: 4,
  WHITE: 5,
  GREEN: 6,
  RED: 7,
} as const;

/**
 * 四人回しサンマで場風・自風になり得る風。北家は抜け番なので北を含まない
 * (spec 2.5 / Q32 の北抜きが強制・任意どちらでもこの席契約は不変)。
 */
export type PlayableWind =
  | typeof HONOR.EAST
  | typeof HONOR.SOUTH
  | typeof HONOR.WEST;
