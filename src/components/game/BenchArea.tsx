/**
 * 抜け番(休みプレイヤー)表示(スペック6 6.4.2 `BenchArea`)。
 *
 * 名前・固定された持ち点・「抜け番」ラベルを表示する。状態は色のみに依存させず、
 * アイコン+テキストラベルで伝える(スペック5 5.2.1)。持ち点は抜け番中に変化しない
 * (スペック4 不変条件)が、半荘終了(gameEnd)時の残存供託の帰属(Q15/Q20)は抜け番にも
 * 及び得るため、点差(`pointsDelta`)は着席者と同様に表示する(#282)。
 * 誰が抜け番になるかの決定(Q9)には関与しない。
 * 値渡しのみの純表示コンポーネント(スペック6 6.6)。
 *
 * `compact`(スペック6 6.4.3 / スペック5 5.3.2 段階②フォーカス表示): 卓幅 < 360px の
 * 自分手番フォーカス時、着席他家(`PlayerArea` compact)と同じ「名前+点数」の薄い帯に縮小し、
 * 抜け番だけがフルサイズ大カードで突出しないよう密度を揃える(issue #150 要検討点2)。
 * 「この局は休み」の補足文はコンパクト帯では省き、抜け番バッジで休みを伝える。
 */

import ScoreDisplay from "./ScoreDisplay";
import StatusBadge from "./StatusBadge";
import type { BenchPlayerView } from "./types";

export interface BenchAreaProps {
  player: BenchPlayerView;
  /** 狭幅の帯表示(自分手番フォーカス時、着席他家と密度を揃える)(スペック6 6.4.3)。 */
  compact?: boolean;
}

export default function BenchArea({ player, compact = false }: BenchAreaProps) {
  if (compact) {
    // 着席他家(`PlayerArea` compact)と同じ体裁の薄い帯: 抜け番バッジ+名前+持ち点のみ。
    return (
      <section
        aria-label={`${player.name}(抜け番)`}
        className="flex flex-col gap-2 rounded-lg border border-dashed border-foreground/25 bg-foreground/[.03] p-2"
      >
        <header className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <StatusBadge icon="⏸" label="抜け番" variant="bench" />
          <span className="font-medium">{player.name}</span>
        </header>
        <ScoreDisplay points={player.points} delta={player.pointsDelta} />
      </section>
    );
  }

  return (
    <section
      aria-label={`${player.name}(抜け番)`}
      className="flex h-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-foreground/25 bg-foreground/[.03] p-3 text-center"
    >
      <StatusBadge icon="⏸" label="抜け番" variant="bench" />
      <p className="font-medium">{player.name}</p>
      <ScoreDisplay points={player.points} delta={player.pointsDelta} />
      <p className="text-xs text-foreground/60">この局は休み</p>
    </section>
  );
}
