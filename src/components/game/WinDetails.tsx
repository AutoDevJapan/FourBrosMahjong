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
  // category normally comes from a finite scoring domain, but this component
  // is also used at the online untrusted-payload boundary. Guard the lookup so
  // inherited keys such as __proto__ never become React children.
  const categoryLabel = Object.hasOwn(CATEGORY, detail.category)
    ? CATEGORY[detail.category]
    : detail.category;
  return (
    <section
      aria-labelledby={titleId}
      className="rounded-lg border border-foreground/15 bg-foreground/[.03] p-3 text-sm"
    >
      <h2 id={titleId} className="font-bold">
        和了内訳
      </h2>
      <p>
        <span dir="auto" className="player-name-bidi-isolate font-semibold">
          {detail.winnerName}({SEAT_WIND_LABEL[detail.winnerSeat]})
        </span>
        ・{detail.dealer ? "親" : "子"}・
        {detail.winType === "tsumo" ? "ツモ" : "ロン"}・{categoryLabel}
      </p>
      {/*
        和了形の開示(#259): 和了確定時に engine が固定した門前手牌+和了牌を表向きで示す。
        副露・ガリは卓上の既存表示(Melds / KitaDisplay)が公開情報として担うため重複させない。
        和了牌は色に依存せず「間隔+『和了』バッジ+aria-label」で区別する(スペック5 5.2.1)。

        本コンポーネントの名前付きリスト(和了形/成立役/支払い内訳)は role="list" を明示する —
        冗長だが、Tailwind preflight の list-style 除去により Safari が list セマンティクスを落とし、
        VoiceOver がリスト名ごと読まなくなる既知挙動への対処(スペック5 5.2.5 / #270)。
      */}
      <h3 className="mt-2 font-semibold">和了形</h3>
      <ul
        role="list"
        aria-label="和了形"
        className="mt-1 flex flex-wrap items-start gap-1"
      >
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
      <ul role="list" aria-label="成立役" className="mt-2 grid gap-1">
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
      {/*
        対局者名は重複を許す自由入力なので React key に使ってはならない(スペック6 6.2.1 /
        #312)。同名2名のツモ支払いでは key が衝突し、React の key 一意性契約に違反する。
        RankingTable が名前ではなく順位という安定値を key にするのと同じ趣旨だが、payments には
        順位に相当する安定値が無いため位置(index)を用いる。各 li は内部 state も DOM 状態も
        持たない純テキストで、内容は毎レンダリング payments から全て描き直されるため、index
        キーでも表示が取り違えられることはない。要素に state を持たせる場合は再検討が必要。
      */}
      <ul role="list" aria-label="支払い内訳">
        {detail.payments.map((payment, index) => (
          <li key={`payment-${index}`}>
            <span dir="auto" className="player-name-bidi-isolate">
              {payment.name}: {payment.amount.toLocaleString("ja-JP")}点
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
