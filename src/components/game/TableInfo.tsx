/**
 * 卓中央の卓情報(スペック6 6.4.2 `TableInfo`): 場風・局・本場・供託。
 *
 * 場/オーラス判定などのロジックは Q11 の責務であり、ここでは与えられた
 * `roundWind` / `handNumber` / `honba` / `riichiSticks` を整形して表示するだけ(スペック6 6.8)。
 * 値渡しのみの純表示コンポーネント(スペック6 6.6)。
 */
import type { TableInfoData } from "./types";

const ROUND_WIND_LABEL: Record<TableInfoData["roundWind"], string> = {
  east: "東",
  south: "南",
};
const DIE_FACE = ["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"] as const;

export interface TableInfoProps {
  info: TableInfoData;
}

export default function TableInfo({ info }: TableInfoProps) {
  const {
    roundWind,
    handNumber,
    honba,
    riichiSticks,
    remainingLiveTiles,
    dice,
    doraCount,
  } = info;
  const roundLabel = `${ROUND_WIND_LABEL[roundWind]}${handNumber}局`;

  return (
    <dl className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-center text-sm text-tile-face">
      <div className="flex items-baseline gap-1">
        <dt className="sr-only">場と局</dt>
        <dd className="text-base font-bold">{roundLabel}</dd>
      </div>
      <div
        className="flex items-baseline gap-1"
        aria-label={`サイコロ ${dice[0]}と${dice[1]}、ドラ${doraCount}枚`}
      >
        <dt className="text-xs opacity-80">サイコロ</dt>
        <dd className="font-mono tabular-nums">
          {DIE_FACE[dice[0]] ?? dice[0]} {dice[0]}・
          {DIE_FACE[dice[1]] ?? dice[1]} {dice[1]} → ドラ{doraCount}枚
        </dd>
      </div>
      <div className="flex items-baseline gap-1">
        <dt className="text-xs opacity-80">本場</dt>
        <dd className="font-mono tabular-nums">{honba}</dd>
      </div>
      <div className="flex items-baseline gap-1">
        <dt className="text-xs opacity-80">供託</dt>
        <dd className="font-mono tabular-nums">{riichiSticks}</dd>
      </div>
      <div
        className="flex items-baseline gap-1 whitespace-nowrap"
        aria-label={`残り山 ${remainingLiveTiles}枚`}
      >
        <dt className="text-xs opacity-80">残り山</dt>
        <dd className="font-mono tabular-nums">{remainingLiveTiles}枚</dd>
      </div>
    </dl>
  );
}
