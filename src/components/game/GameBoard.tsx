"use client";

/**
 * 対局本体を統括するクライアント境界(スペック6 6.6 `<GameBoard>`)。
 *
 * `/game/page.tsx`(Server shell)から呼ばれる唯一のクライアントアイランド。`GameProvider` が
 * 保持する**実対局エンジン**の表示ビュー(`view`)と操作(`controls`)を読み取り、卓・4スロット・
 * 局面に応じた操作パネル・ライブリージョンを描画して1半荘を進行させる。席割り・親・ツモ配分・ウマ等の
 * 決定ロジック(Q9〜Q13)は engine が持ち、本コンポーネントは値の表示と操作の橋渡しに徹する(スペック6 6.8)。
 *
 * レスポンシブ(スペック6 6.4.3 / スペック5 5.3.2 の狭幅2段階方式):
 * - **段階①(スケーリング優先)**: 盤面を `@container`(inline-size)でくるみ、クロス配置は
 *   `.board-cross` の `clamp()`+`cqi` で牌・隙間を卓幅連動に流体縮小する。ビューポート固定の
 *   `md` ブレークポイントではなく**卓の描画幅**で成立させ、640〜767px 帯でも横スクロールなしに
 *   クロス配置(自家=下 / 上家=左 / 対面=上 / 下家=右)を維持する。
 * - **段階②(フォーカス表示切替)**: 卓の描画幅が 360px を下回ったら(`@min-[360px]` 未満)、
 *   自家の手牌・操作パネルをフルサイズ表示し、他家3人は河直近+得点+状態のコンパクト帯に縮小する。
 *   コンパクト化で隠れた全体盤面は「全体盤面」ボタンのモーダル(`Modal`)でいつでも確認できる。
 * いずれの段階も横スクロールで成立させない。
 */
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Modal from "../common/Modal";
import { tileLabel } from "../common/tileLabel";
import ActionPanel, { type ActionItem } from "./ActionPanel";
import { useGame } from "./GameProvider";
import LiveRegion from "./LiveRegion";
import PlayerSlot from "./PlayerSlot";
import Table from "./Table";
import type { SeatPosition, TileData } from "./types";

/** 外部ストア購読なしのダミー(クライアント判定にのみ使う)。 */
const noopSubscribe = () => () => {};

interface KitaObservation {
  readonly roundKey: string;
  readonly count: number;
}

/** 局替わりは0枚を起点として扱い、同じガリ枚数の次局も増加イベントとして検知する。 */
export function pulledKitaCount(
  previous: KitaObservation,
  roundKey: string,
  count: number,
): number {
  return count - (previous.roundKey === roundKey ? previous.count : 0);
}

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

  // 全体盤面モーダル(スペック5 5.3.2 段階②): フォーカス表示でコンパクト化された他家情報を
  // クロス配置のまま再確認するための開閉状態。モーダルの表示自体は `< 360px` でのみ意味を持つ。
  const [boardOpen, setBoardOpen] = useState(false);
  const selfKitaCount =
    slots.self.kind === "seated" ? slots.self.player.kitaCount : 0;
  const roundKey = `${tableInfo.roundWind}-${tableInfo.handNumber}-${tableInfo.honba}`;
  // 自動北抜きは engine 遷移内で完了するため、公開枚数の増加を UI イベントとして保持する。
  // 初期配牌で抜いた場合も 0→N として通知し、局替わりの N→0 では通知を消す。
  const [kitaObservation, setKitaObservation] = useState<KitaObservation>({
    roundKey,
    count: 0,
  });
  const [kitaAnnouncement, setKitaAnnouncement] = useState("");
  if (
    kitaObservation.roundKey !== roundKey ||
    kitaObservation.count !== selfKitaCount
  ) {
    const pulled = pulledKitaCount(kitaObservation, roundKey, selfKitaCount);
    setKitaObservation({ roundKey, count: selfKitaCount });
    setKitaAnnouncement(
      pulled > 0
        ? `北を${pulled === 1 ? "" : `${pulled}枚`}抜きました。嶺上牌を補充しました。ガリは合計${selfKitaCount}枚です。`
        : "",
    );
  }
  // 同じ文言の次回イベントでも live region に DOM 変更を発生させられるよう、一時通知は消去する。
  useEffect(() => {
    if (!kitaAnnouncement) return;
    const timer = window.setTimeout(() => setKitaAnnouncement(""), 1500);
    return () => window.clearTimeout(timer);
  }, [kitaAnnouncement]);
  // 全体盤面を開いている間は盤面本体を `inert` にする(下記 return 参照)。inert 化はトリガー
  // ボタンから即座にフォーカスを奪う(祖先が inert になると activeElement は body へ落ちる)ため、
  // Modal 側の「開く前の activeElement へ復帰」だけでは body へ戻ってしまう。トリガー参照を保持し、
  // モーダルが閉じた(inert 解除後の)タイミングでこのボタンへ確実にフォーカスを戻す。
  const boardTriggerRef = useRef<HTMLButtonElement>(null);
  const wasBoardOpen = useRef(boardOpen);
  useEffect(() => {
    if (wasBoardOpen.current && !boardOpen) {
      boardTriggerRef.current?.focus();
    }
    wasBoardOpen.current = boardOpen;
  }, [boardOpen]);

  // リーチ宣言モード: オンのとき、次に選んだ手牌が「リーチ宣言牌」として切られる。
  const [riichiArmed, setRiichiArmed] = useState(false);
  const canRiichi = pending?.kind === "humanDiscard" && pending.canRiichi;
  // リーチ可能な打牌待ちでなくなったら arming を解除する(レンダー中の前回値比較 =
  // set-state-in-effect を避ける React 公認の「前回レンダー情報の保持」パターン)。
  const [prevCanRiichi, setPrevCanRiichi] = useState(canRiichi);
  if (prevCanRiichi !== canRiichi) {
    setPrevCanRiichi(canRiichi);
    if (!canRiichi && riichiArmed) setRiichiArmed(false);
  }

  // 半荘終了 → 結果画面へ(スペック6 6.3)。engine の確定結果は GameProvider が保持し、
  // 遷移先の /game/result が読み取る(スペック6 6.5 / 6.9)。
  useEffect(() => {
    if (mounted && phase === "gameEnd") {
      router.push("/game/result");
    }
  }, [mounted, phase, router]);

  const handleSelectTile = useCallback(
    (_index: number, tile: TileData) => {
      if (pending?.kind !== "humanDiscard") return;
      // リーチ後は打牌が自動ツモ切りに固定されるため、手牌選択は無効(ツモ/ツモ切りボタンで操作)。
      if (pending.locked) return;
      // 喰い替え禁止(#105 / スペック1 1.4): ポン直後に同種牌は切れない(選択不可・no-op)。
      if (
        pending.forbiddenDiscards.some(
          (f) => f.suit === tile.suit && f.rank === tile.rank,
        )
      ) {
        return;
      }
      if (riichiArmed && pending.canRiichi) {
        controls.riichi(tile);
        setRiichiArmed(false);
        return;
      }
      controls.discard(tile);
    },
    [pending, controls, riichiArmed],
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
    // 他家打牌への反応(ロン / ポン / 明槓 / スルー)。
    if (pending?.kind === "humanReact") {
      const items: ActionItem[] = [];
      if (pending.canRon) {
        items.push({
          key: "ron",
          label: "ロン",
          icon: "栄",
          onClick: controls.ron,
          primary: true,
        });
      }
      if (pending.canPon) {
        items.push({
          key: "pon",
          label: "ポン",
          icon: "碰",
          onClick: controls.pon,
        });
      }
      if (pending.canKan) {
        items.push({
          key: "kan",
          label: "カン",
          icon: "槓",
          onClick: controls.kan,
        });
      }
      items.push({
        key: "pass",
        label: "スルー",
        icon: "○",
        onClick: controls.passRon,
      });
      return items;
    }
    // 自家の打牌待ち(ツモ / リーチ / 暗槓 / 加槓 / ツモ切り)。
    if (pending?.kind === "humanDiscard") {
      const items: ActionItem[] = [
        {
          key: "tsumo",
          label: "ツモ",
          icon: "自",
          onClick: controls.tsumo,
          disabled: !pending.canTsumo,
          primary: pending.canTsumo,
        },
      ];
      // リーチ後は手牌選択が固定されるため、ツモ切りボタンを提供する。
      if (pending.locked) {
        items.push({
          key: "tsumogiri",
          label: "ツモ切り",
          icon: "切",
          onClick: controls.tsumogiri,
        });
      }
      if (pending.canRiichi) {
        items.push({
          key: "riichi",
          label: riichiArmed ? "リーチ解除" : "リーチ",
          icon: "宣",
          onClick: () => setRiichiArmed((armed) => !armed),
          primary: riichiArmed,
        });
      }
      for (const tile of pending.ankanTiles) {
        items.push({
          key: `ankan-${tile.suit}-${tile.rank}`,
          label: `暗槓 ${tileLabel(tile)}`,
          icon: "槓",
          onClick: () => controls.ankan(tile),
        });
      }
      for (const tile of pending.kakanTiles) {
        items.push({
          key: `kakan-${tile.suit}-${tile.rank}`,
          label: `加槓 ${tileLabel(tile)}`,
          icon: "槓",
          onClick: () => controls.kakan(tile),
        });
      }
      return items;
    }
    return [];
  }, [phase, pending, controls, router, riichiArmed]);

  const hint = useMemo(() => {
    if (phase === "roundEnd") return roundSummary?.label ?? "";
    if (phase === "gameEnd") return "半荘終了。結果を確認できます。";
    if (pending?.kind === "humanReact") {
      // 実際に選べる操作だけを案内する(存在しない選択肢を誤って提示しない)。
      const choices = [
        pending.canRon ? "ロン" : null,
        pending.canPon ? "ポン" : null,
        pending.canKan ? "カン" : null,
        "スルー",
      ].filter((c): c is string => c !== null);
      return `${choices.join(" / ")}を選べます。`;
    }
    if (pending?.kind === "humanDiscard") {
      if (pending.locked) {
        return "リーチ中です。ツモ和了かツモ切りを選んでください(北抜きは自動)。";
      }
      if (riichiArmed) {
        return "リーチ宣言牌を選んでください(テンパイを保つ牌のみ有効)。";
      }
      return "牌を選んで打牌してください(北抜きは自動)。";
    }
    return "";
  }, [phase, pending, roundSummary, riichiArmed]);

  const announcement = useMemo(() => {
    if (pending?.kind === "humanDiscard") return "あなたの手番です。";
    if (pending?.kind === "humanReact") {
      return pending.canRon ? "ロンできます。" : "鳴きできます。";
    }
    return "";
  }, [pending]);

  const assertive = useMemo(() => {
    if (phase === "roundEnd" || phase === "gameEnd") {
      return roundSummary?.label ?? "";
    }
    return "";
  }, [phase, roundSummary]);

  // `onSelect` を明示的に受け取り、全体盤面モーダル(閲覧専用)では自家手牌の打牌を無効化できる。
  // `PlayerSlot` は position==="self" のときだけ `onSelectTile` を配線するため、他家スロットでは無害。
  const renderSlot = useCallback(
    (
      position: SeatPosition,
      compact: boolean,
      onSelect?: (index: number, tile: TileData) => void,
    ) => (
      <PlayerSlot
        position={position}
        content={slots[position]}
        compact={compact}
        onSelectTile={onSelect}
      />
    ),
    [slots],
  );

  // クロス配置のグリッド(段階①)。可視制御クラスと自家手牌の打牌ハンドラを差し替えて、
  // 実盤面(卓幅 >= 360px)と全体盤面モーダル(閲覧専用)の双方で再利用する。
  const crossBoard = useCallback(
    (
      visibilityClass: string,
      onSelfSelect?: (index: number, tile: TileData) => void,
      withActions = true,
    ) => (
      <div
        className={`board-cross mx-auto w-full max-w-4xl grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,1fr)] gap-[var(--board-gap)] ${visibilityClass}`}
      >
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
          {renderSlot("self", false, onSelfSelect)}
        </div>
        {withActions ? (
          <div className="col-span-3 col-start-1 row-start-4">
            <ActionPanel actions={actions} hint={hint} />
          </div>
        ) : null}
      </div>
    ),
    [renderSlot, tableInfo, dora, actions, hint],
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
      className="@container w-full"
      data-phase={phase}
      data-pending={pending?.kind ?? "none"}
    >
      {/*
       * 盤面本体(段階①/段階②)。いずれか一方だけがコンテナクエリの display:none で
       * 可視化されるため、AT・E2E のロール照会には常に1側だけが露出する(非表示側は
       * display:none で a11y ツリー・ロールクエリ双方から除外される)。
       * 全体盤面モーダル(段階②の補完)を開いている間はクロス配置を dialog 内に再掲するため、
       * この盤面本体を `inert` + `aria-hidden` で AT・フォーカス・ロールクエリから確実に外し、
       * 自家 region / 手牌 listbox 等のアクセシブル名が dialog と二重露出しないようにする。
       */}
      <div inert={boardOpen} aria-hidden={boardOpen || undefined}>
        {/* 段階①: 卓幅 >= 360px はクロス配置。牌・隙間は .board-cross の clamp()/cqi で流体縮小。 */}
        {crossBoard("hidden @min-[360px]:grid", handleSelectTile)}

        {/* 段階②: 卓幅 < 360px は自家フォーカス表示。他家はコンパクト帯へ縮小。 */}
        <div className="flex flex-col gap-3 @min-[360px]:hidden">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-foreground/70">
              自分手番フォーカス表示
            </p>
            <button
              ref={boardTriggerRef}
              type="button"
              onClick={() => setBoardOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-foreground/25 px-3 py-1.5 text-xs font-medium hover:bg-foreground/5"
            >
              <span aria-hidden="true">▦</span>
              全体盤面
            </button>
          </div>
          <Table info={tableInfo} dora={dora} />
          <div className="grid grid-cols-1 gap-2">
            {renderSlot("left", true)}
            {renderSlot("across", true)}
            {renderSlot("right", true)}
          </div>
          {renderSlot("self", false, handleSelectTile)}
          <ActionPanel actions={actions} hint={hint} />
        </div>
      </div>

      {/* 全体盤面モーダル(段階②の補完): クロス配置を閲覧専用で再表示。フォーカストラップ/Escape は Modal が担保。 */}
      {boardOpen ? (
        <Modal title="全体盤面" onClose={() => setBoardOpen(false)}>
          <div className="@container">
            {crossBoard("grid", undefined, false)}
          </div>
        </Modal>
      ) : null}

      <LiveRegion
        politeMessage={announcement}
        secondaryPoliteMessage={kitaAnnouncement}
        assertiveMessage={assertive}
      />
    </div>
  );
}
