/**
 * ソシー内訳（素点＋ウマ・オカ＋役満祝儀）の表示(スペック6 6.2 / 6.7 / 6.8, スペック3 3.3)。
 *
 * 1プレイヤー分の確定済み内訳を受け取り、①素点 ②ウマ+オカ ③役満祝儀 と合計を**表示するだけ**の
 * 純表示コンポーネント(スペック6 6.6)。ウマの数値割当(Q13)や祝儀判定などの計算ロジックは
 * 一切含めず、`GameProvider` 経由で渡された値を整形して並べるのみ(スペック6 6.8)。
 * 増減は色に依存せず符号+テキストで伝える(スペック5 5.2.1)。
 */

import { useId } from "react";
import CharacterPortrait, {
  characterAccentStyle,
} from "@/components/game/CharacterPortrait";
import type { ResultPlayerView } from "@/components/game/types";
import {
  RAW_SCORE_LABEL,
  TOP_OKA_NOTE,
  UMA_OKA_LABEL,
  YAKUMAN_BONUS_LABEL,
} from "./resultLabels";
import { formatSignedSoshii } from "./soshiiFormat";

export interface SoshiiBreakdownProps {
  /** 1プレイヤー分の確定済みソシー内訳(表示専用)。 */
  player: ResultPlayerView;
  /** routeが明示的に選ぶ表示presentation。未指定は従来の簡素な内訳。 */
  variant?: "default" | "result" | "history";
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

export default function SoshiiBreakdown({
  player,
  variant = "default",
}: SoshiiBreakdownProps) {
  const { playerId, name, rank, rawScore, uma, bonus, soshiiTotal } = player;
  // `aria-label` would flatten the user-controlled name and lose the same bidi
  // isolation used by the visible name. Keep the suffix inside the name label
  // so the two ID references preserve the Japanese phrase without an extra gap.
  const labelId = useId();
  const rankLabelId = `${labelId}-rank`;
  const nameLabelId = `${labelId}-name`;
  const total = formatSignedSoshii(soshiiTotal);
  const presentation = variant === "default" ? null : variant;
  const presentationClass = (suffix: string) =>
    presentation === null ? undefined : `${presentation}-${suffix}`;

  return (
    <section
      aria-labelledby={`${rankLabelId} ${nameLabelId}`}
      data-character-id={playerId}
      style={playerId ? characterAccentStyle(playerId) : undefined}
      className={
        presentation
          ? `${presentationClass("breakdown-card")} character-surface rounded-lg border p-4${rank === 1 ? ` ${presentationClass("breakdown-card--winner")}` : ""}`
          : "character-surface rounded-lg border p-4"
      }
    >
      <h3
        className={`${presentationClass("breakdown-heading") ?? ""}${presentation ? " " : ""}flex items-center gap-2 text-sm font-semibold`}
      >
        {playerId ? <CharacterPortrait playerId={playerId} /> : null}
        <span
          id={rankLabelId}
          className={`${presentationClass("breakdown-rank") ?? ""}${presentation ? " " : ""}text-foreground/70`}
        >
          {rank}位
        </span>
        <span
          id={nameLabelId}
          dir="auto"
          className={`${presentationClass("breakdown-name") ?? ""}${presentation ? " " : ""}character-name player-name-bidi-isolate`}
        >
          <span dir="auto" className="player-name-bidi-isolate">
            {name}
          </span>
          <span className="sr-only">のソシー内訳</span>
        </span>
        {presentation && rank === 1 ? (
          <span className={presentationClass("winner-label")}>優勝</span>
        ) : null}
      </h3>
      <dl
        className={`${presentationClass("breakdown-list") ?? ""}${presentation ? " " : ""}mt-3 flex flex-col gap-1.5 text-sm`}
      >
        <div
          className={`${presentationClass("breakdown-line") ?? ""}${presentation ? " " : ""}flex items-baseline justify-between gap-4`}
        >
          <dt className="text-foreground/70">{RAW_SCORE_LABEL}</dt>
          <dd>
            {/* 素点は「最終持ち点 − 返し」の増減値(スペック3 3.3①)なので、ウマ・合計と同じ
                符号付き表記(U+2212)+sr-only 読み上げに統一する(issue #278)。 */}
            <SignedValue value={rawScore} />
          </dd>
        </div>
        <div
          className={`${presentationClass("breakdown-line") ?? ""}${presentation ? " " : ""}flex items-baseline justify-between gap-4`}
        >
          <dt className="text-foreground/70">
            {UMA_OKA_LABEL}
            {rank === 1 ? (
              <small className={presentationClass("oka-note")}>
                （{TOP_OKA_NOTE}）
              </small>
            ) : null}
          </dt>
          <dd>
            <SignedValue value={uma} />
          </dd>
        </div>
        <div
          className={`${presentationClass("breakdown-line") ?? ""}${presentation ? " " : ""}flex items-baseline justify-between gap-4`}
        >
          <dt className="text-foreground/70">{YAKUMAN_BONUS_LABEL}</dt>
          <dd>
            <SignedValue value={bonus} />
          </dd>
        </div>
        <div
          className={`${presentationClass("breakdown-total") ?? ""}${presentation ? " " : ""}mt-1 flex items-baseline justify-between gap-4 border-t border-foreground/15 pt-2 font-semibold`}
        >
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
