/**
 * 河(捨て牌)の表示(スペック6 6.4.2)。着席プレイヤーごとに表示し、抜け番スロットには出さない。
 * 各牌は自己ラベル付きの `Tile` を再利用する。値渡しのみの純表示コンポーネント(スペック6 6.6)。
 */

import Tile from "../common/Tile";
import type { TileData } from "./types";

export interface DiscardsProps {
  tiles: readonly TileData[];
  /** 狭幅の帯表示では直近数枚のみを表示するため上限を渡せる(スペック6 6.4.3)。 */
  limit?: number;
}

export default function Discards({ tiles, limit }: DiscardsProps) {
  const shown =
    typeof limit === "number" && limit >= 0 ? tiles.slice(-limit) : tiles;
  // role="list" は冗長だが明示する — Tailwind preflight の list-style 除去により Safari が
  // list セマンティクスを落とし、VoiceOver がリスト名ごと読まなくなる既知挙動への対処
  // (スペック5 5.2.5 / #270)。
  return (
    <ul
      role="list"
      aria-label="捨て牌"
      // 列幅を牌1枚ぶんの固定幅にして密に並べる(#258)。列数はスロット幅に入るぶんだけ
      // 作られ上限 6 列(#387: 6 列固定だと狭いスロットでページが横スクロールしていた)。
      // グリッド定義は `.river-grid`(globals.css)— 牌寸法と列幅の定義元を一本化するため。
      className="river-grid"
    >
      {shown.map((tile, i) => (
        // 河は同一牌が複数並ぶため index を key に含める(捨て順の同一性は保持不要)。
        <li key={`${tile.suit}-${tile.rank}-${i}`}>
          <Tile tile={tile} size="river" />
        </li>
      ))}
    </ul>
  );
}
