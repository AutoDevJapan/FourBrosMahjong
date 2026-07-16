/**
 * 抜け番(休みプレイヤー)表示(スペック6 6.4.2 `BenchArea`)。
 *
 * 名前・固定された持ち点・「抜け番」ラベルを表示する。状態は色のみに依存させず、
 * アイコン+テキストラベルで伝える(スペック5 5.2.1)。持ち点は抜け番中に変化しない
 * (スペック4 不変条件)。誰が抜け番になるかの決定(Q9)には関与しない。
 * 値渡しのみの純表示コンポーネント(スペック6 6.6)。
 */
import type { BenchPlayerView } from "./types";
import ScoreDisplay from "./ScoreDisplay";
import StatusBadge from "./StatusBadge";

export interface BenchAreaProps {
  player: BenchPlayerView;
}

export default function BenchArea({ player }: BenchAreaProps) {
  return (
    <section
      aria-label={`${player.name}(抜け番)`}
      className="flex h-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-foreground/25 bg-foreground/[.03] p-3 text-center"
    >
      <StatusBadge icon="⏸" label="抜け番" variant="bench" />
      <p className="font-medium">{player.name}</p>
      <ScoreDisplay points={player.points} />
      <p className="text-xs text-foreground/60">この局は休み</p>
    </section>
  );
}
