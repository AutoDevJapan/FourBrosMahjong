/**
 * 牌1枚の表示コンポーネント(スペック6 6.7: 全牌表示の唯一の再利用元)。
 *
 * `Hand` / `OpponentHand` / `Discards` / `DoraIndicator` はすべてこの `Tile` を再利用する。
 * スペック5 5.2.1 準拠:
 * - 牌の種類は色ではなく**牌面の印字**(漢数字+スート漢字/字牌名)で識別できる。
 * - 赤ドラは色だけでなく**赤枠+「赤」バッジという形状差**を付与し、`aria-label` に `(赤ドラ)` を付記する。
 * - 配色は `globals.css` のセマンティックトークン経由で参照し、生の色値を直接使わない(スペック5 5.4.2)。
 *
 * 値渡しのみの純表示コンポーネントのため Server Component として実装できる(スペック6 6.6)。
 */
import type { TileData } from "../game/types";
import { FACE_DOWN_LABEL, tileFace, tileLabel } from "./tileLabel";

export interface TileProps {
  /** 表向きに描く牌。`null` の場合は伏せ牌(内容非開示)として描く。 */
  tile: TileData | null;
  /**
   * `true` のとき装飾扱い(`aria-hidden`)にし、自前の名称を持たない。
   * `Hand` のように外側の対話要素(`role="option"` 等)が `aria-label` を担うケースで使う。
   */
  decorative?: boolean;
  /** 追加クラス(レイアウト調整用)。 */
  className?: string;
}

const BASE_CLASS =
  "inline-flex select-none items-center justify-center rounded-md border font-semibold leading-none " +
  "h-11 w-8 text-sm sm:h-12 sm:w-9";

export default function Tile({
  tile,
  decorative = false,
  className = "",
}: TileProps) {
  // 伏せ牌: 内容を見せない裏面。色に依存しないよう格子模様+ラベルで伝える。
  if (tile === null) {
    return (
      <span
        className={`${BASE_CLASS} border-tile-border bg-tile-back text-tile-back-mark ${className}`}
        role={decorative ? undefined : "img"}
        aria-label={decorative ? undefined : FACE_DOWN_LABEL}
        aria-hidden={decorative || undefined}
      >
        <span aria-hidden="true">▚</span>
      </span>
    );
  }

  const isRed = tile.isRed === true;
  const borderClass = isRed
    ? "border-2 border-tile-accent-red"
    : "border border-tile-border";

  return (
    <span
      className={`${BASE_CLASS} relative bg-tile-face text-tile-ink ${borderClass} ${className}`}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : tileLabel(tile)}
      aria-hidden={decorative || undefined}
    >
      <span aria-hidden="true">{tileFace(tile)}</span>
      {isRed ? (
        // 赤ドラの形状差: 色だけに頼らず「赤」バッジを付す(スペック5 5.2.1)。
        <span
          aria-hidden="true"
          className="absolute -top-1 -right-1 rounded-sm bg-tile-accent-red px-0.5 text-[0.5rem] font-bold text-tile-face leading-tight"
        >
          赤
        </span>
      ) : null}
    </span>
  );
}
