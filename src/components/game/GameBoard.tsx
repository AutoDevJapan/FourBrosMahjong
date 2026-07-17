"use client";

/**
 * 対局本体を統括するクライアント境界(スペック6 6.6 `<GameBoard>`)。
 *
 * `/game/page.tsx`(Server shell)から呼ばれる唯一のクライアントアイランド。`GameProvider` が
 * 保持する**実対局エンジン**の表示ビュー(`view`)と操作(`controls`)を読み取り、卓・4スロット・
 * 局面に応じた操作パネル・ライブリージョンを描画して1半荘を進行させる。席割り・親・ツモ配分・ウマ等の
 * 決定ロジック(Q9〜Q13)は engine が持ち、本コンポーネントは値の表示と操作の橋渡しに徹する(スペック6 6.8)。
 *
 * レスポンシブ(スペック6 6.4.3 / スペック5 5.3.2):
 * - `md` 以上: 4スロットのクロス配置(自家=下 / 上家=左 / 対面=上 / 下家=右)。
 * - 狭幅(既定 < `md`): 自家フォーカス表示。他スロットは直近の河+得点+状態のコンパクト帯に縮小。
 * いずれも横スクロールで成立させない。
 */
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import ActionPanel, { type ActionItem } from "./ActionPanel";
import { useGame } from "./GameProvider";
import LiveRegion from "./LiveRegion";
import PlayerSlot from "./PlayerSlot";
import Table from "./Table";
import type { SeatPosition, TileData } from "./types";

/** 外部ストア購読なしのダミー(クライアント判定にのみ使う)。 */
const noopSubscribe = () => () => {};

export default function GameBoard() {
  const { view, phase, pending, roundSummary, controls } = useGame();
  const { slots, tableInfo, dora } = view;
  const router = useRouter();

  // 実対局は乱数(クライアント固有)で生成されるため、盤面はマウント後のクライアントでのみ描画する。
  // これにより SSR プリレンダーとの牌のハイドレーション不一致を避け、初回描画後の盤面も安定させる。
  // `useSyncExternalStore` は SSR とハイドレーション初回描画で false、以後クライアントで true を返す
  // (set-state-in-effect を使わないハイドレーション安全なクライアント判定)。
  const mounted = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );

  // 半荘終了 → 結果画面へ(スペック6 6.3)。engine の確定結果は GameProvider が保持し、
  // 遷移先の /game/result が読み取る(スペック6 6.5 / 6.9)。
  useEffect(() => {
    if (mounted && phase === "gameEnd") {
      router.push("/game/result");
    }
  }, [mounted, phase, router]);

  const handleSelectTile = useCallback(
    (_index: number, tile: TileData) => {
      if (pending?.kind === "humanDiscard") {
        controls.discard(tile);
      }
    },
    [pending, controls],
  );

  const actions = useMemo<ActionItem[]>(() => {
    if (phase === "roundEnd") {
      return [
        {
          key: "next",
          label: "次の局へ",
          icon: "▶",
          onClick: controls.nextRound,
          primary: true,
        },
      ];
    }
    if (phase === "gameEnd") {
      return [
        {
          key: "result",
          label: "結果を見る",
          icon: "▶",
          onClick: () => router.push("/game/result"),
          primary: true,
        },
      ];
    }
    if (pending?.kind === "humanRon") {
      return [
        {
          key: "ron",
          label: "ロン",
          icon: "栄",
          onClick: controls.ron,
          primary: true,
        },
        { key: "pass", label: "スルー", icon: "○", onClick: controls.passRon },
      ];
    }
    if (pending?.kind === "humanDiscard") {
      return [
        {
          key: "tsumo",
          label: "ツモ",
          icon: "自",
          onClick: controls.tsumo,
          disabled: !pending.canTsumo,
          primary: pending.canTsumo,
        },
      ];
    }
    return [];
  }, [phase, pending, controls, router]);

  const hint = useMemo(() => {
    if (phase === "roundEnd") return roundSummary?.label ?? "";
    if (phase === "gameEnd") return "半荘終了。結果を確認できます。";
    if (pending?.kind === "humanDiscard") {
      return "牌を選んで打牌してください(北抜きは自動・鳴き/リーチは未対応)。";
    }
    if (pending?.kind === "humanRon") return "ロンできます。";
    return "";
  }, [phase, pending, roundSummary]);

  const announcement = useMemo(() => {
    if (pending?.kind === "humanDiscard") return "あなたの手番です。";
    if (pending?.kind === "humanRon") return "ロンできます。";
    return "";
  }, [pending]);

  const assertive = useMemo(() => {
    if (phase === "roundEnd" || phase === "gameEnd") {
      return roundSummary?.label ?? "";
    }
    return "";
  }, [phase, roundSummary]);

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

  if (!mounted) {
    return (
      <div
        className="flex min-h-[12rem] w-full items-center justify-center rounded-xl border border-foreground/10 text-sm text-foreground/60"
        aria-live="polite"
      >
        対局を準備しています…
      </div>
    );
  }

  return (
    <div
      className="w-full"
      data-phase={phase}
      data-pending={pending?.kind ?? "none"}
    >
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
          <ActionPanel actions={actions} hint={hint} />
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
        <ActionPanel actions={actions} hint={hint} />
      </div>

      <LiveRegion politeMessage={announcement} assertiveMessage={assertive} />
    </div>
  );
}
