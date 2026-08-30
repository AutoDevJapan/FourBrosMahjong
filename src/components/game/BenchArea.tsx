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

import CharacterPortrait, { characterAccentStyle } from "./CharacterPortrait";
import ScoreDisplay from "./ScoreDisplay";
import StatusBadge from "./StatusBadge";
import type { BenchPlayerView } from "./types";

export interface BenchAreaProps {
  player: BenchPlayerView;
  /** 自分の物理スロットか。抜け番へ回っても自己識別を維持する。 */
  isSelf: boolean;
  /** 狭幅の帯表示(自分手番フォーカス時、着席他家と密度を揃える)(スペック6 6.4.3)。 */
  compact?: boolean;
}

export default function BenchArea({
  player,
  isSelf,
  compact = false,
}: BenchAreaProps) {
  const accessibleName = `${player.name}(${isSelf ? "あなた・" : ""}抜け番)`;

  if (compact) {
    // 着席他家(`PlayerArea` compact)と同じ体裁の薄い帯: 抜け番バッジ+名前+持ち点のみ。
    return (
      <section
        aria-label={accessibleName}
        data-character-id={player.playerId}
        data-player-kind="bench"
        data-player-role={isSelf ? "self" : "opponent"}
        style={characterAccentStyle(player.playerId)}
        className="game-bench-area game-bench-area--compact character-accent-edge flex flex-col gap-2 rounded-lg border border-dashed border-foreground/25 bg-foreground/[.03] p-2"
      >
        <header className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {isSelf ? (
            <span
              aria-hidden="true"
              className="game-self-badge inline-flex self-start whitespace-nowrap rounded-full border border-foreground/25 bg-background px-1.5 py-0.5 text-xs font-semibold"
            >
              あなた
            </span>
          ) : null}
          <CharacterPortrait playerId={player.playerId} />
          <StatusBadge icon="⏸" label="抜け番" variant="bench" />
          <span
            dir="auto"
            className="character-name player-name-bidi-isolate font-medium"
          >
            {player.name}
          </span>
        </header>
        <ScoreDisplay points={player.points} delta={player.pointsDelta} />
      </section>
    );
  }

  return (
    <section
      aria-label={accessibleName}
      data-character-id={player.playerId}
      data-player-kind="bench"
      data-player-role={isSelf ? "self" : "opponent"}
      style={characterAccentStyle(player.playerId)}
      className="game-bench-area character-accent-edge flex h-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-foreground/25 bg-foreground/[.03] p-3 text-center"
    >
      {isSelf ? (
        <span
          aria-hidden="true"
          className="game-self-badge inline-flex self-start whitespace-nowrap rounded-full border border-foreground/25 bg-background px-1.5 py-0.5 text-xs font-semibold"
        >
          あなた
        </span>
      ) : null}
      <CharacterPortrait playerId={player.playerId} size="medium" />
      <StatusBadge icon="⏸" label="抜け番" variant="bench" />
      <p
        dir="auto"
        className="character-name player-name-bidi-isolate font-medium"
      >
        {player.name}
      </p>
      <ScoreDisplay points={player.points} delta={player.pointsDelta} />
      <p className="text-xs text-foreground/60">この局は休み</p>
    </section>
  );
}
