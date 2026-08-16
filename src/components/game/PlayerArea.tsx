/**
 * 着席プレイヤーの表示(スペック6 6.4.2 `PlayerArea`): 手牌・河・得点・状態をまとめる。
 *
 * 自家のみ牌面を表向き(`Hand`)、他家は伏せ牌の枚数のみ(`OpponentHand`)で表示する。
 * 親・手番・リーチの状態は色のみに依存せずアイコン+テキストで併記する(スペック5 5.2.1)。
 * どのプレイヤーが自家/他家/親かの決定(Q10)には関与せず、与えられた割り当てを描くだけ。
 */

import Discards from "./Discards";
import Hand, { type HandProps, type HandTileState } from "./Hand";
import KitaDisplay from "./KitaDisplay";
import Melds from "./Melds";
import OpponentHand from "./OpponentHand";
import ScoreDisplay from "./ScoreDisplay";
import StatusBadge from "./StatusBadge";
import type { SeatedPlayerView, SeatWind, TileData } from "./types";

/** 席風の日本語ラベル。和了者名の席表記(`WinDetails` #259)でも共用する。 */
export const SEAT_WIND_LABEL: Record<SeatWind, string> = {
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
  /** タッチ端末では牌の選択と打牌確定を分離する。 */
  confirmTouchSelection?: boolean;
  /** タッチ選択の確定対象。 */
  confirmTouchSelectionMode?: HandProps["confirmTouchSelectionMode"];
  /** 自家手牌を閲覧専用の静的リストとして表示する。 */
  handReadOnly?: boolean;
  handTileStates?: readonly HandTileState[];
  onBlockedTile?: (message: string) => void;
}

const FURITEN_LABEL = {
  discard: "フリテン（捨て牌）",
  temporary: "フリテン（同巡内）",
  riichi: "フリテン（リーチ後）",
} as const;

export default function PlayerArea({
  player,
  isSelf,
  compact = false,
  onSelectTile,
  confirmTouchSelection = false,
  confirmTouchSelectionMode = "discard",
  handReadOnly = false,
  handTileStates,
  onBlockedTile,
}: PlayerAreaProps) {
  const {
    name,
    points,
    pointsDelta,
    seatWind,
    status,
    hand,
    melds,
    kitaCount,
    discards,
  } = player;

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
        {status?.furitenReason ? (
          <StatusBadge
            icon="禁"
            label={FURITEN_LABEL[status.furitenReason]}
            variant="furiten"
          />
        ) : null}
      </header>

      <ScoreDisplay points={points} delta={pointsDelta} />

      <KitaDisplay count={kitaCount} compact={compact} />

      {!compact ? (
        <div className="rounded bg-foreground/[.03] p-1.5">
          {isSelf && hand ? (
            <Hand
              tiles={hand}
              readOnly={handReadOnly}
              onSelect={onSelectTile}
              confirmTouchSelection={confirmTouchSelection}
              confirmTouchSelectionMode={confirmTouchSelectionMode}
              tileStates={handTileStates}
              onBlockedSelect={onBlockedTile}
            />
          ) : (
            <OpponentHand count={player.handCount ?? 0} />
          )}
        </div>
      ) : null}

      {melds && melds.length > 0 ? <Melds melds={melds} /> : null}

      <Discards tiles={discards} limit={compact ? 6 : undefined} />
    </section>
  );
}
