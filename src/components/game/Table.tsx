/**
 * 卓(中央)コンテナ(スペック6 6.4.2 `Table`)。卓情報(`TableInfo`)とドラ表示(`DoraIndicator`)を
 * 内包する。felt(緑地)背景はセマンティックトークン `--color-table-felt` 経由で参照する
 * (スペック5 5.4.2)。値渡しのみの純表示コンポーネント(スペック6 6.6)。
 */

import DoraIndicator from "./DoraIndicator";
import TableInfo from "./TableInfo";
import type { DoraData, TableInfoData } from "./types";

export interface TableProps {
  info: TableInfoData;
  dora: DoraData;
}

export default function Table({ info, dora }: TableProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl bg-table-felt p-4 shadow-inner">
      <TableInfo info={info} />
      <DoraIndicator dora={dora} />
    </div>
  );
}
