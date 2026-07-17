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
  const ura = dora.uraIndicators ?? [];
  const uraCount = Math.max(0, Math.floor(dora.uraIndicatorCount ?? 0));

  return (
    <section aria-label="ドラ表示" className="flex flex-col items-center gap-1">
      <h2 className="text-xs font-semibold text-tile-face opacity-90">
        ドラ表示
      </h2>
      <ul className="flex gap-0.5">
        {dora.indicators.map((tile, i) => (
          <li key={`${tile.suit}-${tile.rank}-${i}`}>
            <Tile tile={tile} size="dora" />
          </li>
        ))}
        {ura.length > 0
          ? // リーチ和了時のみ裏ドラを開示する。
            ura.map((tile, i) => (
              <li key={`ura-open-${tile.suit}-${tile.rank}-${i}`}>
                <Tile tile={tile} size="dora" />
              </li>
            ))
          : Array.from({ length: uraCount }, (_, i) => (
              // 裏ドラは対局中は伏せる(リーチ和了時に開示)。
              <li key={`ura-${i}`}>
                <Tile tile={null} size="dora" />
              </li>
            ))}
      </ul>
      {ura.length > 0 ? (
        <p className="text-[0.65rem] text-tile-face opacity-80">裏ドラ開示</p>
      ) : null}
    </section>
  );
}
