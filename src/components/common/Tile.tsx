/**
 * 牌1枚の表示コンポーネント(スペック6 6.7: 全牌表示の唯一の再利用元)。
 *
 * `Hand` / `OpponentHand` / `Discards` / `DoraIndicator` はすべてこの `Tile` を再利用する。
 * 牌面は FluffyStuff/riichi-mahjong-tiles(CC0 パブリックドメイン)の SVG を `public/tiles/` に
 * 同梱して用いる(出典 → `public/tiles/CREDITS.md`)。牌の枠(角丸+縁+地色)は従来どおり
 * `globals.css` のセマンティックトークンで描き、その上に牌面 SVG を重ねる。これにより
 * ダークモード連動(スペック5 5.4.2)・`--u` 連動のレスポンシブ寸法(#111)を保ったまま、
 * 牌面のみを高品位な SVG へ差し替える。
 *
 * スペック5 5.2.1 準拠(色のみに依存しない情報伝達):
 * - 牌の種類は色ではなく**牌面 SVG の形状**(漢数字・筒/索の図案・字牌)で識別できる。
 * - 赤ドラは色の付いた `*-Dora` 素材に加え、色に依存しない**赤枠+「赤」バッジという形状差**を
 *   付与し、`aria-label` に `(赤ドラ)` を付記する。
 * - 枠の配色は `globals.css` のセマンティックトークン経由で参照し、生の色値を直接使わない。
 *
 * 値渡しのみの純表示コンポーネントのため Server Component として実装できる(スペック6 6.6)。
 */
import { isRedDora } from "@/domain/tiles/tile";
import type { TileData } from "../game/types";
import { resolveTileFace } from "./tileImage";
import { FACE_DOWN_LABEL, tileLabel } from "./tileLabel";

export interface TileProps {
  /** 表向きに描く牌。`null` の場合は伏せ牌(内容非開示)として描く。 */
  tile: TileData | null;
  /**
   * `true` のとき装飾扱い(`aria-hidden`)にし、自前の名称を持たない。
   * `Hand` のように外側の対話要素(`role="option"` 等)が `aria-label` を担うケースで使う。
   */
  decorative?: boolean;
  /**
   * 表示サイズ(スペック5 5.3.2)。牌寸法は `globals.css` の基準ユニット `--u` の倍数で定義され、
   * クロス卓(`.board-cross`)内では `--u` がコンテナ幅連動の `clamp()` に差し替わって流体縮小する。
   * - `hand`: 自家手牌(既定) / `river`: 河・伏せ牌・副露 / `dora`: ドラ表示。
   */
  size?: "hand" | "river" | "dora";
  /** 追加クラス(レイアウト調整用)。 */
  className?: string;
}

const SIZE_CLASS: Record<NonNullable<TileProps["size"]>, string> = {
  hand: "game-tile",
  river: "game-tile--river",
  dora: "game-tile--dora",
};

const BASE_CLASS =
  "relative inline-flex select-none items-center justify-center rounded-md border";

/**
 * 牌面(おもて)SVG を枠内に配置する背景指定。牌面素材は白地に印字のみを持ち、素材自体が
 * 内側に十分な余白を含むため、`contain`(アスペクト比維持)で中央に置き `bg-tile-face` の
 * 地色を残す。`padding`/`bg-origin-content` は使わない — 河・副露の `flex-wrap` で牌が
 * 伸長(正方形化)しても背景画像が確実に描画されるようにするため。
 */
const FACE_IMAGE_CLASS = "bg-contain bg-center bg-no-repeat";

/**
 * カタログ外牌の可視プレースホルダの体裁。地色(`bg-tile-face`)に濃色印字(`text-tile-ink`)で
 * 牌名テキストを描く。`background-image` を発行しないため 404 が起きず、裏面(`Back`)も出さない。
 * これにより視覚(牌名)と `aria-label`(同名)が一致する検出可能なフォールバックになる(issue #146)。
 */
const FALLBACK_TEXT_CLASS =
  "px-0.5 text-center font-bold leading-none text-tile-ink text-[0.6rem] break-all";

export default function Tile({
  tile,
  decorative = false,
  size = "hand",
  className = "",
}: TileProps) {
  const sizeClass = SIZE_CLASS[size];

  // 伏せ牌: 内容を見せない裏面。設計トークン由来の `.game-tile--back`(青系・全テーマ連動)で
  // 描き、外部 SVG 素材に依存せず全テーマ/全ビューポートで安定して裏面と分かる(Issue #149)。
  if (tile === null) {
    return (
      <span
        className={`${BASE_CLASS} game-tile--back ${sizeClass} overflow-hidden border-tile-border ${className}`}
        role={decorative ? undefined : "img"}
        aria-label={decorative ? undefined : FACE_DOWN_LABEL}
        aria-hidden={decorative || undefined}
        data-face="Back"
      />
    );
  }

  // 赤扱い(色付き素材・赤枠・「赤」バッジ・(赤ドラ)ラベル)は赤素材が実在する 5筒・5索のみ。
  // `isRed` がそれ以外に付いても発火させず、牌面・バッジ・ラベルの整合を保つ(issue #146)。
  // 判定はドメインの isRedDora が唯一の情報源で、得点側の赤ドラ翻と共有する(issue #485)。
  const isRed = isRedDora(tile);
  const borderClass = isRed
    ? "border-2 border-tile-accent-red"
    : "border border-tile-border";
  const label = tileLabel(tile);
  const face = resolveTileFace(tile);

  // カタログ外牌: 素材参照(404 リスク)を発行せず、牌名テキストの可視プレースホルダを描く。
  // background-image は onError 不能のため、フォールバックは背景ではなく前景テキストで確定的に描く。
  if (face.kind === "fallback") {
    return (
      <span
        className={`${BASE_CLASS} ${sizeClass} overflow-hidden bg-tile-face ${borderClass} ${className}`}
        role={decorative ? undefined : "img"}
        aria-label={decorative ? undefined : label}
        aria-hidden={decorative || undefined}
        data-face="fallback"
      >
        <span aria-hidden="true" className={FALLBACK_TEXT_CLASS}>
          {label}
        </span>
      </span>
    );
  }

  return (
    <span
      className={`${BASE_CLASS} ${FACE_IMAGE_CLASS} ${sizeClass} bg-tile-face ${borderClass} ${className}`}
      style={{ backgroundImage: `url(${face.src})` }}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative || undefined}
      data-face={face.name}
    >
      {isRed ? (
        // 赤ドラの形状差: 色だけに頼らず「赤」バッジを付す(スペック5 5.2.1)。
        <span
          aria-hidden="true"
          className="absolute -top-1 -right-1 rounded-sm bg-tile-badge-red px-0.5 text-[0.5rem] font-bold text-tile-face leading-tight"
        >
          赤
        </span>
      ) : null}
    </span>
  );
}
