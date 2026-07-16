"use client";

/**
 * 対局本体を統括するクライアント境界(スペック6 6.6 `<GameBoard>`)。
 *
 * `/game/page.tsx`(Server shell)から呼ばれる唯一のクライアントアイランド。`GameProvider` が
 * 保持するビュー状態を読み取り、卓・4スロット・操作パネル・ライブリージョンを描画する。
 * 表示に必要な値はすべて props/コンテキスト経由で受け取り、席割り・親・ツモ配分・ウマ等の
 * 決定ロジック(Q9〜Q13)は含めない(スペック6 6.8)。
 *
 * レスポンシブ(スペック6 6.4.3 / スペック5 5.3.2):
 * - `md` 以上: 4スロットのクロス配置(自家=下 / 上家=左 / 対面=上 / 下家=右)。
 * - 狭幅(既定 < `md`): 自家フォーカス表示。他スロットは直近の河+得点+状態のコンパクト帯に縮小。
 * いずれも横スクロールで成立させない。
 */
import { useCallback, useState } from "react";
import { useGame } from "./GameProvider";
import ActionPanel, { type GameAction } from "./ActionPanel";
import LiveRegion from "./LiveRegion";
import PlayerSlot from "./PlayerSlot";
import Table from "./Table";
import { tileLabel } from "../common/tileLabel";
import type { SeatPosition, TileData } from "./types";

const ACTION_LABEL: Record<GameAction, string> = {
  riichi: "リーチ",
  pon: "ポン",
  kan: "カン",
  pullNorth: "北抜き",
  skip: "スキップ",
};

export default function GameBoard() {
  const { state } = useGame();
  const { slots, tableInfo, dora } = state;

  // ライブリージョン用の進行メッセージ(スペック5 5.2.3)。骨組みでは操作の入口を
  // 押した旨を通知するだけで、ドメイン判定の結果ではない。
  const [announcement, setAnnouncement] = useState("");

  const handleSelectTile = useCallback((_index: number, tile: TileData) => {
    setAnnouncement(`${tileLabel(tile)}を選択しました`);
  }, []);

  const handleAction = useCallback((action: GameAction) => {
    setAnnouncement(`${ACTION_LABEL[action]}を選択しました`);
  }, []);

  const renderSlot = useCallback(
    (position: SeatPosition, compact: boolean) => (
      <PlayerSlot
        position={position}
        content={slots[position]}
        compact={compact}
        onSelectTile={handleSelectTile}
      />
    ),
    [slots, handleSelectTile],
  );

  return (
    <div className="w-full">
      {/* md 以上: クロス配置。基底では非表示(a11yツリーからも除外)。 */}
      <div className="mx-auto hidden w-full max-w-4xl grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,1fr)] gap-3 md:grid">
        <div className="col-start-2 row-start-1">
          {renderSlot("across", false)}
        </div>
        <div className="col-start-1 row-start-2">
          {renderSlot("left", false)}
        </div>
        <div className="col-start-2 row-start-2">
          <Table info={tableInfo} dora={dora} />
        </div>
        <div className="col-start-3 row-start-2">
          {renderSlot("right", false)}
        </div>
        <div className="col-span-3 col-start-1 row-start-3">
          {renderSlot("self", false)}
        </div>
        <div className="col-span-3 col-start-1 row-start-4">
          <ActionPanel onAction={handleAction} />
        </div>
      </div>

      {/* 狭幅: 自家フォーカス表示。md 以上では非表示。 */}
      <div className="flex flex-col gap-3 md:hidden">
        <Table info={tableInfo} dora={dora} />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {renderSlot("left", true)}
          {renderSlot("across", true)}
          {renderSlot("right", true)}
        </div>
        {renderSlot("self", false)}
        <ActionPanel onAction={handleAction} />
      </div>

      <LiveRegion politeMessage={announcement} />
    </div>
  );
}
