/**
 * 卓の4スロットの1つ(スペック6 6.4.1)。
 *
 * その局の割り当て結果(`SlotContent`)に応じて、着席なら `PlayerArea`、抜け番なら `BenchArea` を
 * 描き分ける。どのスロットに誰が座り誰が抜け番かの決定ロジック(Q9・Q10)には一切関与せず、
 * 「スロット→表示内容」のマッピングを受け取って描画するだけ(スペック6 6.4.1 / 6.8)。
 */
import type { SeatPosition, SlotContent, TileData } from "./types";
import BenchArea from "./BenchArea";
import PlayerArea from "./PlayerArea";

export interface PlayerSlotProps {
  /** 物理スロット位置。`self` のとき手牌を表向き+操作可能にする。 */
  position: SeatPosition;
  content: SlotContent;
  /** 狭幅時の帯表示(スペック6 6.4.3)。 */
  compact?: boolean;
  /** 自家の打牌選択ハンドラ(UIイベントのみ)。 */
  onSelectTile?: (index: number, tile: TileData) => void;
}

export default function PlayerSlot({
  position,
  content,
  compact = false,
  onSelectTile,
}: PlayerSlotProps) {
  if (content.kind === "bench") {
    return <BenchArea player={content.player} />;
  }
  return (
    <PlayerArea
      player={content.player}
      isSelf={position === "self"}
      compact={compact}
      onSelectTile={position === "self" ? onSelectTile : undefined}
    />
  );
}
