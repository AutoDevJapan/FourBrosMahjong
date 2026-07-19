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
  // role="list" は冗長だが明示する — Tailwind preflight の list-style 除去により Safari が
  // list セマンティクスを落とし、VoiceOver がリスト名ごと読まなくなる既知挙動への対処
  // (スペック5 5.2.5 / #270)。
  return (
    <ul
      role="list"
      aria-label="捨て牌"
      // grid-cols-6(1fr 列)はスロット幅いっぱいにセルが引き伸ばされ河が散らばるため、
      // 列幅を牌の内容基準(max-content)にして 6 枚/段を gap-0.5 のみで密に並べる(#258)。
      className="grid w-fit grid-flow-row auto-rows-min grid-cols-[repeat(6,max-content)] gap-0.5"
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
