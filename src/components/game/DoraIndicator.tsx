/**
 * ドラ表示(スペック6 6.4.2 `DoraIndicator`)。
 *
 * 表ドラ表示牌(1〜3枚)を開示し、裏ドラはリーチ和了時のみ開示するため対局中は
 * 枚数ぶん伏せて表示する。ドラ枚数はサイコロ出目由来だが、UI は与えられた表示牌を描くだけで
 * 出目→枚数の決定ロジックは持たない(スペック6 6.8)。`Tile` を再利用する純表示コンポーネント。
 */
import type { DoraData } from "./types";
import Tile from "../common/Tile";

export interface DoraIndicatorProps {
  dora: DoraData;
}

export default function DoraIndicator({ dora }: DoraIndicatorProps) {
  const uraCount = Math.max(0, Math.floor(dora.uraIndicatorCount ?? 0));

  return (
    <section aria-label="ドラ表示" className="flex flex-col items-center gap-1">
      <h2 className="text-xs font-semibold text-tile-face opacity-90">
        ドラ表示
      </h2>
      <ul className="flex gap-0.5">
        {dora.indicators.map((tile, i) => (
          <li key={`${tile.suit}-${tile.rank}-${i}`}>
            <Tile tile={tile} className="h-9 w-7 sm:h-10 sm:w-8" />
          </li>
        ))}
        {Array.from({ length: uraCount }, (_, i) => (
          // 裏ドラは対局中は伏せる(結果確定時に開示)。
          <li key={`ura-${i}`}>
            <Tile tile={null} className="h-9 w-7 sm:h-10 sm:w-8" />
          </li>
        ))}
      </ul>
    </section>
  );
}
