import { useId } from "react";
import type { RoundSummary } from "@/domain/game/engine";
import Tile from "../common/Tile";
import { tileLabel } from "../common/tileLabel";
import { sortTiles } from "./gameView";
import { SEAT_WIND_LABEL } from "./PlayerArea";

const CATEGORY: Record<string, string> = {
  normal: "通常",
  mangan: "満貫",
  haneman: "跳満",
  baiman: "倍満",
  sanbaiman: "三倍満",
  yakuman: "役満",
};

export default function WinDetails({ summary }: { summary: RoundSummary }) {
  const detail = summary.winDetails;
  // GameBoard はコンテナ幅に応じて切り替える2つの盤面ツリーを同時に DOM へ置くため、
  // 固定 id だと両方の WinDetails が同じ見出しを名乗ってしまう。インスタンスごとの id で
  // aria-labelledby を必ず自身の見出しへ結び付ける。
  const titleId = useId();
  if (!detail) return null;
  return (
    <section
      aria-labelledby={titleId}
      className="rounded-lg border border-foreground/15 bg-foreground/[.03] p-3 text-sm"
    >
      <h2 id={titleId} className="font-bold">
        和了内訳
      </h2>
      <p>
        <span className="font-semibold">
          {detail.winnerName}({SEAT_WIND_LABEL[detail.winnerSeat]})
        </span>
        ・{detail.dealer ? "親" : "子"}・
        {detail.winType === "tsumo" ? "ツモ" : "ロン"}・
        {CATEGORY[detail.category] ?? detail.category}
      </p>
      {/*
        和了形の開示(#259): 和了確定時に engine が固定した門前手牌+和了牌を表向きで示す。
        副露・ガリは卓上の既存表示(Melds / KitaDisplay)が公開情報として担うため重複させない。
        和了牌は色に依存せず「間隔+『和了』バッジ+aria-label」で区別する(スペック5 5.2.1)。
      */}
      <h3 className="mt-2 font-semibold">和了形</h3>
      <ul aria-label="和了形" className="mt-1 flex flex-wrap items-start gap-1">
        {sortTiles(detail.hand).map((tile, index) => (
          <li key={`hand-${tile.suit}-${tile.rank}-${index}`}>
            <Tile tile={tile} size="river" />
          </li>
        ))}
        <li
          className="ml-2 flex flex-col items-center gap-0.5"
          aria-label={`${tileLabel(detail.winningTile)}(和了牌)`}
        >
          <Tile tile={detail.winningTile} decorative size="river" />
          <span
            aria-hidden="true"
            className="rounded-sm border border-foreground/40 px-1 text-[0.625rem] font-bold leading-tight"
          >
            和了
          </span>
        </li>
      </ul>
      <ul aria-label="成立役" className="mt-2 grid gap-1">
        {detail.yaku.map((yaku, index) => (
          <li
            key={`${yaku.name}-${index}`}
            className="flex justify-between gap-4"
          >
            <span>{yaku.name}</span>
            <span>
              {yaku.yakuman > 0 ? `${yaku.yakuman}倍役満` : `${yaku.han}翻`}
            </span>
          </li>
        ))}
      </ul>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
        <dt>役翻</dt>
        <dd>{detail.yakuHan}翻</dd>
        <dt>表ドラ</dt>
        <dd>{detail.dora.omote}翻</dd>
        <dt>裏ドラ</dt>
        <dd>{detail.dora.ura}翻</dd>
        <dt>赤5</dt>
        <dd>{detail.dora.aka}翻</dd>
        <dt>ガリ</dt>
        <dd>{detail.dora.gari}翻</dd>
        <dt className="font-bold">合計</dt>
        <dd className="font-bold">
          {detail.yakuman > 0
            ? `${detail.yakuman}倍役満`
            : `${detail.totalHan}翻`}
        </dd>
        <dt>本場</dt>
        <dd>{detail.honba}本</dd>
        <dt>供託回収</dt>
        <dd>
          {detail.riichiSticks}本（{detail.stickPayout.toLocaleString("ja-JP")}
          点）
        </dd>
      </dl>
      <h3 className="mt-3 font-semibold">支払い</h3>
      <ul aria-label="支払い内訳">
        {detail.payments.map((payment) => (
          <li key={payment.name}>
            {payment.name}: {payment.amount.toLocaleString("ja-JP")}点
          </li>
        ))}
      </ul>
    </section>
  );
}
