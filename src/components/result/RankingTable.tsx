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
}

export default function RankingTable({ players }: RankingTableProps) {
  // 与えられた確定順位で並べるだけ(値の計算ではなく表示順の整列)。
  const ordered = [...players].sort((a, b) => a.rank - b.rank);

  return (
    <table className="w-full border-collapse text-left text-sm">
      <caption className="sr-only">最終順位とソシー合計</caption>
      <thead>
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
              data-character-id={player.playerId}
              style={
                player.playerId
                  ? characterAccentStyle(player.playerId)
                  : undefined
              }
              className="border-b border-foreground/10"
            >
              <th
                scope="row"
                className="py-2 pr-3 font-normal whitespace-nowrap"
              >
                <span className="inline-flex items-center gap-1">
                  {isTop ? (
                    <span aria-hidden="true" title="トップ">
                      👑
                    </span>
                  ) : null}
                  <span>{player.rank}位</span>
                </span>
              </th>
              <td className="py-2 pr-3">
                <span className="inline-flex items-center gap-2">
                  {player.playerId ? (
                    <CharacterPortrait playerId={player.playerId} />
                  ) : null}
                  <span className="character-name font-medium">
                    {player.name}
                  </span>
                </span>
              </td>
              <td className="py-2 text-right font-mono tabular-nums">
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
