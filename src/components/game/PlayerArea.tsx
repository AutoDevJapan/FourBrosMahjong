/**
 * 着席プレイヤーの表示(スペック6 6.4.2 `PlayerArea`): 手牌・河・得点・状態をまとめる。
 *
 * 自家のみ牌面を表向き(`Hand`)、他家は伏せ牌の枚数のみ(`OpponentHand`)で表示する。
 * 親・手番・リーチの状態は色のみに依存せずアイコン+テキストで併記する(スペック5 5.2.1)。
 * どのプレイヤーが自家/他家/親かの決定(Q10)には関与せず、与えられた割り当てを描くだけ。
 */
import type { SeatWind, SeatedPlayerView, TileData } from "./types";
import Discards from "./Discards";
import Hand from "./Hand";
import OpponentHand from "./OpponentHand";
import ScoreDisplay from "./ScoreDisplay";
import StatusBadge from "./StatusBadge";

const SEAT_WIND_LABEL: Record<SeatWind, string> = {
  east: "東家",
  south: "南家",
  west: "西家",
};

export interface PlayerAreaProps {
  player: SeatedPlayerView;
  /** 自家(手牌を表向き+操作可能)か。 */
  isSelf: boolean;
  /** 狭幅の帯表示(自分手番フォーカス時、他家をコンパクト化)(スペック6 6.4.3)。 */
  compact?: boolean;
  /** 自家の打牌選択ハンドラ(UIイベントのみ)。 */
  onSelectTile?: (index: number, tile: TileData) => void;
}

export default function PlayerArea({
  player,
  isSelf,
  compact = false,
  onSelectTile,
}: PlayerAreaProps) {
  const { name, points, pointsDelta, seatWind, status, hand, discards } =
    player;

  return (
    <section
      aria-label={`${name}(${SEAT_WIND_LABEL[seatWind]})`}
      className={`flex flex-col gap-2 rounded-lg border p-2 ${
        status?.isCurrentTurn
          ? "border-turn-highlight bg-turn-highlight/5"
          : "border-foreground/15"
      }`}
    >
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="rounded bg-foreground/10 px-1.5 py-0.5 text-xs font-semibold">
          {SEAT_WIND_LABEL[seatWind]}
        </span>
        <span className="font-medium">{name}</span>
        {status?.isDealer ? <StatusBadge icon="◆" label="親" /> : null}
        {status?.isCurrentTurn ? (
          <StatusBadge icon="▶" label="手番" variant="highlight" />
        ) : null}
        {status?.hasDeclaredRiichi ? (
          <StatusBadge icon="宣" label="リーチ" variant="riichi" />
        ) : null}
      </header>

      <ScoreDisplay points={points} delta={pointsDelta} />

      {!compact ? (
        <div className="rounded bg-foreground/[.03] p-1.5">
          {isSelf && hand ? (
            <Hand tiles={hand} onSelect={onSelectTile} />
          ) : (
            <OpponentHand count={player.handCount ?? 0} />
          )}
        </div>
      ) : null}

      <Discards tiles={discards} limit={compact ? 6 : undefined} />
    </section>
  );
}
