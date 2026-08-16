/**
 * 卓(中央)コンテナ(スペック6 6.4.2 `Table`)。卓情報(`TableInfo`)とドラ表示(`DoraIndicator`)を
 * 内包する。felt(緑地)背景はセマンティックトークン `--color-table-felt` 経由で参照する
 * (スペック5 5.4.2)。値渡しのみの純表示コンポーネント(スペック6 6.6)。
 */

import DoraIndicator from "./DoraIndicator";
import GameGlossary from "./GameGlossary";
import TableInfo from "./TableInfo";
import type { DoraData, TableInfoData } from "./types";

export interface TableProps {
  info: TableInfoData;
  dora: DoraData;
  /** 閲覧専用の全体盤面モーダルでは、用語モーダルの入れ子を避ける。 */
  showGlossary?: boolean;
}

export default function Table({ info, dora, showGlossary = true }: TableProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl bg-table-felt p-4 shadow-inner">
      <TableInfo info={info} />
      <div className="flex flex-wrap items-center justify-center gap-2">
        <DoraIndicator dora={dora} />
        {showGlossary ? <GameGlossary /> : null}
      </div>
    </div>
  );
}
