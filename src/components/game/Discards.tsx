/**
 * 河(捨て牌)の表示(スペック6 6.4.2)。着席プレイヤーごとに表示し、抜け番スロットには出さない。
 * 各牌は自己ラベル付きの `Tile` を再利用する。値渡しのみの純表示コンポーネント(スペック6 6.6)。
 */
import type { TileData } from "./types";
import Tile from "../common/Tile";

export interface DiscardsProps {
  tiles: readonly TileData[];
  /** 狭幅の帯表示では直近数枚のみを表示するため上限を渡せる(スペック6 6.4.3)。 */
  limit?: number;
}

export default function Discards({ tiles, limit }: DiscardsProps) {
  const shown =
    typeof limit === "number" && limit >= 0 ? tiles.slice(-limit) : tiles;
  return (
    <ul
      aria-label="捨て牌"
      className="grid grid-flow-row auto-rows-min grid-cols-6 gap-0.5"
    >
      {shown.map((tile, i) => (
        // 河は同一牌が複数並ぶため index を key に含める(捨て順の同一性は保持不要)。
        <li key={`${tile.suit}-${tile.rank}-${i}`}>
          <Tile tile={tile} className="h-8 w-6 sm:h-9 sm:w-7" />
        </li>
      ))}
    </ul>
  );
}
