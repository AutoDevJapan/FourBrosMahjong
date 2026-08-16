/**
 * 卓の4スロットの1つ(スペック6 6.4.1)。
 *
 * その局の割り当て結果(`SlotContent`)に応じて、着席なら `PlayerArea`、抜け番なら `BenchArea` を
 * 描き分ける。どのスロットに誰が座り誰が抜け番かの決定ロジック(Q9・Q10)には一切関与せず、
 * 「スロット→表示内容」のマッピングを受け取って描画するだけ(スペック6 6.4.1 / 6.8)。
 */

import BenchArea from "./BenchArea";
import type { HandProps, HandTileState } from "./Hand";
import PlayerArea from "./PlayerArea";
import type { SeatPosition, SlotContent, TileData } from "./types";

export interface PlayerSlotProps {
  /** 物理スロット位置。`self` のとき手牌を表向き+操作可能にする。 */
  position: SeatPosition;
  content: SlotContent;
  /** 狭幅時の帯表示(スペック6 6.4.3)。 */
  compact?: boolean;
  /** 自家の打牌選択ハンドラ(UIイベントのみ)。 */
  onSelectTile?: (index: number, tile: TileData) => void;
  /** タッチ端末では牌の選択と打牌確定を分離する。 */
  confirmTouchSelection?: boolean;
  /** タッチ選択の確定対象。 */
  confirmTouchSelectionMode?: HandProps["confirmTouchSelectionMode"];
  /** 全体盤面モーダル等で、自家手牌を閲覧専用にする。 */
  handReadOnly?: boolean;
  handTileStates?: readonly HandTileState[];
  onBlockedTile?: (message: string) => void;
}

export default function PlayerSlot({
  position,
  content,
  compact = false,
  onSelectTile,
  confirmTouchSelection = false,
  confirmTouchSelectionMode = "discard",
  handReadOnly = false,
  handTileStates,
  onBlockedTile,
}: PlayerSlotProps) {
  if (content.kind === "bench") {
    return <BenchArea player={content.player} compact={compact} />;
  }
  return (
    <PlayerArea
      player={content.player}
      isSelf={position === "self"}
      compact={compact}
      onSelectTile={position === "self" ? onSelectTile : undefined}
      confirmTouchSelection={
        position === "self" ? confirmTouchSelection : undefined
      }
      confirmTouchSelectionMode={
        position === "self" ? confirmTouchSelectionMode : undefined
      }
      handReadOnly={position === "self" ? handReadOnly : undefined}
      handTileStates={position === "self" ? handTileStates : undefined}
      onBlockedTile={position === "self" ? onBlockedTile : undefined}
    />
  );
}
