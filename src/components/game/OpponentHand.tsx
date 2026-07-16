/**
 * 他家の伏せ手牌(スペック6 6.4.2)。牌の内容は開示せず**枚数のみ**を表示する。
 * 値渡しのみの純表示コンポーネント(スペック6 6.6)。
 */
import Tile from "../common/Tile";

export interface OpponentHandProps {
  /** 伏せ牌の枚数。 */
  count: number;
}

export default function OpponentHand({ count }: OpponentHandProps) {
  const safeCount = Math.max(0, Math.floor(count));
  return (
    <div
      className="flex flex-wrap gap-0.5"
      // 個々の伏せ牌を1枚ずつ読み上げさせず、枚数を1回で伝える。
      aria-label={`手牌 ${safeCount}枚(伏せ)`}
    >
      {Array.from({ length: safeCount }, (_, i) => (
        <Tile
          key={i}
          tile={null}
          decorative
          className="h-8 w-6 sm:h-9 sm:w-7"
        />
      ))}
    </div>
  );
}
