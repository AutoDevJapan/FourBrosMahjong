/**
 * 最終順位表(スペック6 6.2 / 6.7 / 6.8)。
 *
 * 半荘終了時の確定済みプレイヤー内訳を受け取り、順位・名前・ソシー合計を表形式で**表示するだけ**の
 * 純表示コンポーネント(スペック6 6.6)。順位の決定やソシー計算は行わず、渡された値を並べるのみ
 * (スペック6 6.8)。順位は色ではなく「N位」テキストで示し、首位のみ記号+読み上げ文で補助する
 * (スペック5 5.2.1: 色のみに依存しない)。
 */

import CharacterPortrait, {
  characterAccentStyle,
} from "@/components/game/CharacterPortrait";
import type { ResultPlayerView } from "@/components/game/types";
import { formatSignedSoshii } from "./soshiiFormat";

export interface RankingTableProps {
  /** 確定済みの最終内訳。表示前に順位(rank)昇順へ整列する。 */
  players: readonly ResultPlayerView[];
  /** `/game/result` だけで使う祝祭的な順位装飾。共有先は従来の簡素な表を保つ。 */
  variant?: "default" | "result";
}

export default function RankingTable({
  players,
  variant = "default",
}: RankingTableProps) {
  // 与えられた確定順位で並べるだけ(値の計算ではなく表示順の整列)。
  const ordered = [...players].sort((a, b) => a.rank - b.rank);
  const isResultPresentation = variant === "result";

  return (
    <table
      className={`${isResultPresentation ? "result-ranking-table " : ""}w-full border-collapse text-left text-sm`}
    >
      <caption className="sr-only">最終順位とソシー合計</caption>
      <thead
        className={isResultPresentation ? "result-ranking-head" : undefined}
      >
        <tr className="border-b border-foreground/20 text-foreground/70">
          <th scope="col" className="py-2 pr-3 font-medium">
            順位
          </th>
          <th scope="col" className="py-2 pr-3 font-medium">
            プレイヤー
          </th>
          <th scope="col" className="py-2 text-right font-medium">
            ソシー合計
          </th>
        </tr>
      </thead>
      <tbody>
        {ordered.map((player) => {
          const total = formatSignedSoshii(player.soshiiTotal);
          const isTop = player.rank === 1;
          return (
            // 対局者名はユーザー設定で重複し得る(#291)ため一意な rank を key にする。
            <tr
              key={player.rank}
              data-rank={player.rank}
              data-character-id={player.playerId}
              style={
                player.playerId
                  ? characterAccentStyle(player.playerId)
                  : undefined
              }
              className={
                isResultPresentation
                  ? `result-ranking-row border-b border-foreground/10${isTop ? " result-ranking-row--winner" : ""}`
                  : "border-b border-foreground/10"
              }
            >
              <th
                scope="row"
                className={`${isResultPresentation ? "result-ranking-rank " : ""}py-2 pr-3 font-normal whitespace-nowrap`}
              >
                <span
                  className={`${isResultPresentation ? "result-rank-group " : ""}inline-flex items-center gap-1`}
                >
                  {isResultPresentation ? (
                    <span className="result-rank-medal" aria-hidden="true">
                      {player.rank}
                    </span>
                  ) : isTop ? (
                    <span aria-hidden="true" title="トップ">
                      👑
                    </span>
                  ) : null}
                  <span
                    className={
                      isResultPresentation ? "result-rank-text" : undefined
                    }
                  >
                    {player.rank}位
                  </span>
                  {isResultPresentation && isTop ? (
                    <span className="result-winner-label">優勝</span>
                  ) : null}
                </span>
              </th>
              <td
                className={`${isResultPresentation ? "result-ranking-player " : ""}py-2 pr-3`}
              >
                <span
                  className={`${isResultPresentation ? "result-ranking-player-inner " : ""}inline-flex items-center gap-2`}
                >
                  {player.playerId ? (
                    <CharacterPortrait playerId={player.playerId} />
                  ) : null}
                  <span className="character-name font-medium">
                    {player.name}
                  </span>
                </span>
              </td>
              <td
                className={`${isResultPresentation ? "result-ranking-total " : ""}py-2 text-right font-mono tabular-nums`}
              >
                <span aria-hidden="true">{total.display}</span>
                <span className="sr-only">{total.srLabel}</span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
