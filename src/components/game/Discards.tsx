/**
 * 河(捨て牌)の表示(スペック6 6.4.2)。着席プレイヤーごとに表示し、抜け番スロットには出さない。
 * 各牌は自己ラベル付きの `Tile` を再利用する。値渡しのみの純表示コンポーネント(スペック6 6.6)。
 */

"use client";

import { useLayoutEffect, useRef, useState } from "react";
import Tile from "../common/Tile";
import type { RiverTileData } from "./types";

export interface DiscardsProps {
  tiles: readonly RiverTileData[];
  /** 狭幅の帯表示では直近数枚のみを表示するため上限を渡せる(スペック6 6.4.3)。 */
  limit?: number;
}

export interface RiverTileLayout {
  readonly isRiichi: boolean;
  /** リーチ宣言牌と同じ段にある後続牌だけを横へ詰める。 */
  readonly shiftsAfterRiichi: boolean;
}

/**
 * OSS `PlayerRiverManager` の挙動を参考にした、河牌の表示位置メタデータ。
 * 列数が未確定のサーバー/初回描画では横詰めを行わず、実 DOM の列数確定後に再計算する。
 */
export function getRiverTileLayout(
  tiles: readonly RiverTileData[],
  columnCount: number | null,
): readonly RiverTileLayout[] {
  const riichiIndex = tiles.findIndex((tile) => tile.isRiichi === true);
  const columns = columnCount ?? 1;
  const canShift = columnCount !== null && columnCount > 0;

  return tiles.map((tile, index) => ({
    isRiichi: tile.isRiichi === true,
    shiftsAfterRiichi:
      canShift &&
      riichiIndex >= 0 &&
      index > riichiIndex &&
      Math.floor(index / columns) === Math.floor(riichiIndex / columns),
  }));
}

export default function Discards({ tiles, limit }: DiscardsProps) {
  const shown =
    typeof limit === "number" && limit >= 0 ? tiles.slice(-limit) : tiles;
  const listRef = useRef<HTMLUListElement>(null);
  const [columnCount, setColumnCount] = useState<number | null>(null);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (list === null) return;

    const updateColumnCount = () => {
      const columns = window
        .getComputedStyle(list)
        .gridTemplateColumns.trim()
        .split(/\s+/)
        .filter(Boolean).length;
      setColumnCount(columns > 0 ? columns : null);
    };

    updateColumnCount();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => updateColumnCount());
    observer?.observe(list);
    window.addEventListener("resize", updateColumnCount);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateColumnCount);
    };
  }, [limit, shown.length]);

  const layout = getRiverTileLayout(shown, columnCount);
  const hasRiichi = layout.some((item) => item.isRiichi);

  // role="list" は冗長だが明示する — Tailwind preflight の list-style 除去により Safari が
  // list セマンティクスを落とし、VoiceOver がリスト名ごと読まなくなる既知挙動への対処
  // (スペック5 5.2.5 / #270)。
  // OSS の PlayerRiverManager はこの挙動の参照元だが、ここで使うのは挙動のみで、C#・Unity・
  // Majsoul 由来リソース・牌素材は取り込んでいない。
  return (
    <ul
      ref={listRef}
      role="list"
      aria-label="捨て牌"
      data-has-riichi={hasRiichi ? "true" : undefined}
      // 列幅を牌1枚ぶんの固定幅にして密に並べる(#258)。列数はスロット幅に入るぶんだけ
      // 作られ上限 6 列(#387: 6 列固定だと狭いスロットでページが横スクロールしていた)。
      // グリッド定義は `.river-grid`(globals.css)— 牌寸法と列幅の定義元を一本化するため。
      className="game-river river-grid"
    >
      {shown.map((tile, i) => (
        // 河は同一牌が複数並ぶため index を key に含める(捨て順の同一性は保持不要)。
        <li
          key={`${tile.suit}-${tile.rank}-${i}`}
          data-river-index={i}
          data-riichi={layout[i].isRiichi ? "true" : undefined}
          data-after-riichi={layout[i].shiftsAfterRiichi ? "true" : undefined}
        >
          {layout[i].isRiichi ? (
            <span className="sr-only">リーチ宣言牌</span>
          ) : null}
          <Tile tile={tile} size="river" />
        </li>
      ))}
    </ul>
  );
}
