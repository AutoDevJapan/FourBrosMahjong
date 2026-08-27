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
      className="game-opponent-hand flex flex-wrap gap-0.5"
      // 伏せ手牌のまとまりを1つの画像的まとまり(role="img")として扱い、個々の伏せ牌を
      // 1枚ずつ読み上げさせず枚数を1回で伝える。`role="img"` は aria-label を許容し、配下の
      // 装飾牌(aria-hidden)を単一ノードへ畳み込む(スペック5 5.2.1 / axe aria-prohibited-attr 回避)。
      role="img"
      aria-label={`手牌 ${safeCount}枚(伏せ)`}
    >
      {Array.from({ length: safeCount }, (_, i) => (
        <Tile key={i} tile={null} decorative size="river" />
      ))}
    </div>
  );
}
