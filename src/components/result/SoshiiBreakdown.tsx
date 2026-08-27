/**
 * ソシー内訳(素点+ウマ+祝儀)の表示(スペック6 6.2 / 6.7 / 6.8, スペック3 3.3)。
 *
 * 1プレイヤー分の確定済み内訳を受け取り、①素点 ②順位ウマ ③役満祝儀 と合計を**表示するだけ**の
 * 純表示コンポーネント(スペック6 6.6)。ウマの数値割当(Q13)や祝儀判定などの計算ロジックは
 * 一切含めず、`GameProvider` 経由で渡された値を整形して並べるのみ(スペック6 6.8)。
 * 増減は色に依存せず符号+テキストで伝える(スペック5 5.2.1)。
 */

import CharacterPortrait, {
  characterAccentStyle,
} from "@/components/game/CharacterPortrait";
import type { ResultPlayerView } from "@/components/game/types";
import { formatSignedSoshii } from "./soshiiFormat";

export interface SoshiiBreakdownProps {
  /** 1プレイヤー分の確定済みソシー内訳(表示専用)。 */
  player: ResultPlayerView;
}

/** 符号付き行(素点・ウマ・祝儀)の値セル。色は補助、符号+スクリーンリーダー文で増減を伝える。 */
function SignedValue({ value }: { value: number }) {
  const { display, srLabel, isPositive } = formatSignedSoshii(value);
  const colorClass =
    value === 0 ? "" : isPositive ? "text-positive" : "text-danger";
  return (
    <span className={`font-mono tabular-nums ${colorClass}`}>
      <span aria-hidden="true">{display}</span>
      <span className="sr-only">{srLabel}</span>
    </span>
  );
}

export default function SoshiiBreakdown({ player }: SoshiiBreakdownProps) {
  const { playerId, name, rank, rawScore, uma, bonus, soshiiTotal } = player;
  const total = formatSignedSoshii(soshiiTotal);

  return (
    <section
      aria-label={`${name}のソシー内訳`}
      data-character-id={playerId}
      style={playerId ? characterAccentStyle(playerId) : undefined}
      className="character-surface rounded-lg border p-4"
    >
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        {playerId ? <CharacterPortrait playerId={playerId} /> : null}
        <span className="text-foreground/70">{rank}位</span>
        <span className="character-name">{name}</span>
      </h3>
      <dl className="mt-3 flex flex-col gap-1.5 text-sm">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-foreground/70">素点</dt>
          <dd>
            {/* 素点は「最終持ち点 − 返し」の増減値(スペック3 3.3①)なので、ウマ・合計と同じ
                符号付き表記(U+2212)+sr-only 読み上げに統一する(issue #278)。 */}
            <SignedValue value={rawScore} />
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-foreground/70">ウマ</dt>
          <dd>
            <SignedValue value={uma} />
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-foreground/70">祝儀</dt>
          <dd>
            <SignedValue value={bonus} />
          </dd>
        </div>
        <div className="mt-1 flex items-baseline justify-between gap-4 border-t border-foreground/15 pt-2 font-semibold">
          <dt>ソシー合計</dt>
          <dd className="font-mono tabular-nums">
            <span aria-hidden="true">{total.display}</span>
            <span className="sr-only">{total.srLabel}</span>
          </dd>
        </div>
      </dl>
    </section>
  );
}
