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
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { RoundSummary } from "@/domain/game/engine";
import Modal from "../common/Modal";
import { tileLabel } from "../common/tileLabel";
import ActionPanel, { type ActionItem } from "./ActionPanel";
import { useGame } from "./GameProvider";
import type { HandProps, HandTileState } from "./Hand";
import LiveRegion from "./LiveRegion";
import PlayerSlot from "./PlayerSlot";
import Table from "./Table";
import type { SeatPosition, TileData } from "./types";
import WinDetails from "./WinDetails";

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

/**
 * 半荘終了時の残存供託の帰属を告げる一文(#282)。流局で半荘が終わり供託が残存した場合、
 * その配分は和了内訳(`WinDetails`)に現れないため、hint / 読み上げで唯一の可視サマリになる。
 * 残存がなければ空文字。
 */
export function residualSticksNote(
  summary: Pick<RoundSummary, "residualSticks"> | null,
): string {
  const award = summary?.residualSticks;
  if (!award) return "";
  return `残存供託${award.sticks}本（${award.points.toLocaleString("ja-JP")}点）は${award.recipientName}が取得。`;
}

export interface GameBoardProps {
  /** 結果ボタンの遷移先。オンライン対局は同じルームへ戻るため上書きする。 */
  readonly resultHref?: string;
  /** オンライン再接続中など、サーバー操作を一時的に停止する。 */
  readonly interactionDisabled?: boolean;
}

export default function GameBoard({
  resultHref = "/game/result",
  interactionDisabled = false,
}: GameBoardProps) {
  const { view, phase, pending, roundSummary, controls } = useGame();
  const { slots, tableInfo, dora } = view;
  const router = useRouter();
  const narrowBoardDescriptionId = useId();

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
  const boardOpenerRef = useRef<HTMLButtonElement>(null);
  // トリガー(「全体盤面」ボタン)は段階②のサブツリー内にあり、卓幅が 360px 以上へ変わると
  // コンテナクエリの display:none で到達不能になる。その場合の最終復帰先として、常に描画され
  // 続ける盤面ルートを渡す(スペック5 5.2.2 / #377)。
  const boardRootRef = useRef<HTMLDivElement>(null);
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
  // リーチ宣言モード: オンのとき、次に選んだ手牌が「リーチ宣言牌」として切られる。
  const [riichiArmed, setRiichiArmed] = useState(false);
  const [tileFeedback, setTileFeedback] = useState({
    message: "",
    eventId: 0,
  });
  // live region は同じ文字列を再代入しただけでは DOM mutation が起きず、AT が再通知できない。
  // 操作イベントごとに連番を進め、LiveRegion 内の子ノードを交換して同一理由も再通知可能にする。
  const announceBlockedTile = useCallback((message: string) => {
    setTileFeedback((previous) => ({
      message,
      eventId: previous.eventId + 1,
    }));
  }, []);
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
  //
  // 半荘を終える局(トビ / 南4完了 / 親トップやめ)は `roundEnd` を経由せず `gameEnd` へ直行する
  // (engine spec 2.8)。ここで自動遷移すると最終局の決着(和了内訳・点数移動)が1フレームも
  // 確認できないため(#277)、gameEnd では自動遷移せず `roundEnd` と同様に決着サマリを表示し、
  // 主要ボタン「結果を見る」(ユーザー操作の push)で結果画面へ進む。push でも履歴トラップは
  // 生じない: /game は gameEnd で自動リダイレクトしないため、結果画面から「戻る」→ /game
  // (最終局の決着表示)→「戻る」→ ロビーと素直に脱出できる(#206/#207 の回帰なし)。
  // 終局済み journal の復元・結果画面からのブラウザバックなど「マウント時点で既に gameEnd」の
  // 場合も同じ出口 UI に合流する(リロードでも同じ決着表示が復元される / #193)。

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
      setTileFeedback((previous) => ({ ...previous, message: "" }));
      if (riichiArmed && pending.canRiichi) {
        controls.riichi(tile);
        setRiichiArmed(false);
        return;
      }
      controls.discard(tile);
    },
    [pending, controls, riichiArmed],
  );

  // 打牌フェーズ(humanDiscard)でのみ自家手牌を対話可能にする。局終了(roundEnd/gameEnd)や
  // 他家打牌への応答待ち(humanReact)では閲覧専用の静的 list として描画し、牌ごとの
  // 「禁止」バッジ・理由文を付けない(#257 / スペック5 5.2.3 の読み上げ渋滞回避)。
  const handInteractive =
    !interactionDisabled && pending?.kind === "humanDiscard";

  const handTileStates = useMemo<readonly HandTileState[]>(() => {
    const self = slots.self;
    if (self.kind !== "seated" || !self.player.hand) return [];
    // 打牌フェーズ外は `Hand` の readOnly 経路で描画するため、個別の牌状態を構築しない(#257)。
    if (pending?.kind !== "humanDiscard") return [];
    return self.player.hand.map((tile) => {
      if (pending.locked) {
        return {
          disabled: true,
          reason:
            "リーチ中は手牌から打牌できません。ツモ切りを選んでください。",
          indicator: "禁止",
        };
      }
      if (
        pending.forbiddenDiscards.some(
          (forbidden) =>
            forbidden.suit === tile.suit && forbidden.rank === tile.rank,
        )
      ) {
        return {
          disabled: true,
          reason: "喰い替え禁止のため、この牌は打牌できません。",
          indicator: "禁止",
        };
      }
      if (!riichiArmed) return {};
      const eligible = pending.riichiTiles.some(
        (candidate) =>
          candidate.suit === tile.suit &&
          candidate.rank === tile.rank &&
          candidate.isRed === !!tile.isRed,
      );
      return eligible
        ? { highlighted: true, indicator: "リーチ可" }
        : {
            disabled: true,
            reason: "この牌ではテンパイを保てないため、リーチ宣言できません。",
            indicator: "禁止",
          };
    });
  }, [pending, riichiArmed, slots.self]);

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
      // 終局後の /game の出口(#207): 結果確認に加えて、その場で新規半荘を開始できる。
      // `newGame` は journal を新規半荘で上書きするため、以後の /game 再訪は新しい対局になる。
      return [
        {
          key: "result",
          label: "結果を見る",
          icon: "▶",
          onClick: () => router.push(resultHref),
          requiresConnection: false,
          primary: true,
        },
        {
          key: "newGame",
          label: "新しい半荘を開始",
          icon: "新",
          onClick: controls.newGame,
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
          onClick: () => {
            setTileFeedback((previous) => ({ ...previous, message: "" }));
            setRiichiArmed((armed) => !armed);
          },
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
  }, [phase, pending, controls, router, resultHref, riichiArmed]);

  const hint = useMemo(() => {
    if (interactionDisabled) {
      return "オンラインサーバーとの接続を待っています。再接続後に操作を再開できます。";
    }
    if (phase === "roundEnd") return roundSummary?.label ?? "";
    if (phase === "gameEnd") {
      // 最終局の決着ラベル(流局サマリ含む)も併記する。和了決着の詳細は WinDetails が描く
      // が、流局で終わる半荘(南4流局完了・トビ流局)はこのラベルが唯一の可視サマリになる(#277)。
      // 残存供託の帰属(#282)も併記し、供託カウント0・持ち点・デルタの整合を検算可能にする。
      const label = roundSummary ? `${roundSummary.label}。` : "";
      return `${label}${residualSticksNote(roundSummary)}半荘終了。結果を確認するか、新しい半荘を開始できます。`;
    }
    if (pending?.kind === "humanReact") {
      // 槍槓応答(#208): 他家の槓宣言への横取りロン機会であることを明示する。
      if (pending.chankan !== undefined) {
        return "他家のカン宣言に槍槓ロンできます。ロン / スルーを選べます。";
      }
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
  }, [interactionDisabled, phase, pending, roundSummary, riichiArmed]);

  const announcement = useMemo(() => {
    if (tileFeedback.message) return tileFeedback.message;
    if (pending?.kind === "humanDiscard") return "あなたの手番です。";
    if (pending?.kind === "humanReact") {
      if (pending.chankan !== undefined) return "槍槓ロンできます。";
      return pending.canRon ? "ロンできます。" : "鳴きできます。";
    }
    return "";
  }, [pending, tileFeedback.message]);

  const assertive = useMemo(() => {
    if (phase === "roundEnd") return roundSummary?.label ?? "";
    if (phase === "gameEnd") {
      // 自動遷移を廃止した(#277)後は /game に留まるため、通常の局終了(「次の局へ」)と
      // 半荘終了(「結果を見る」)を読み上げで区別できるよう「半荘終了」を明示する。
      // 残存供託の帰属(#282)も読み上げに含める(視覚の hint と同一情報)。
      const label = roundSummary ? `${roundSummary.label}。` : "";
      return `${label}${residualSticksNote(roundSummary)}半荘終了。`;
    }
    return "";
  }, [phase, roundSummary]);

  // `onSelect` を明示的に受け取り、全体盤面モーダル(閲覧専用)や打牌フェーズ外(#257)では
  // `handReadOnly` で自家手牌を静的 list 表示に切り替える。
  // `PlayerSlot` は position==="self" のときだけ `onSelectTile` を配線するため、他家スロットでは無害。
  const renderSlot = useCallback(
    (
      position: SeatPosition,
      compact: boolean,
      onSelect?: (index: number, tile: TileData) => void,
      handReadOnly = false,
      confirmTouchSelection = false,
      confirmTouchSelectionMode: HandProps["confirmTouchSelectionMode"] = "discard",
    ) => (
      <PlayerSlot
        position={position}
        content={slots[position]}
        compact={compact}
        onSelectTile={onSelect}
        confirmTouchSelection={confirmTouchSelection}
        confirmTouchSelectionMode={confirmTouchSelectionMode}
        handReadOnly={handReadOnly}
        handTileStates={handTileStates}
        onBlockedTile={announceBlockedTile}
      />
    ),
    [slots, handTileStates, announceBlockedTile],
  );

  // クロス配置のグリッド(段階①)。可視制御クラスと自家手牌の打牌ハンドラを差し替えて、
  // 実盤面(卓幅 >= 360px)と全体盤面モーダル(閲覧専用)の双方で再利用する。
  const crossBoard = useCallback(
    (
      visibilityClass: string,
      onSelfSelect?: (index: number, tile: TileData) => void,
      withActions = true,
      handReadOnly = false,
      confirmTouchSelection = false,
      confirmTouchSelectionMode: HandProps["confirmTouchSelectionMode"] = "discard",
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
          <Table info={tableInfo} dora={dora} showGlossary={withActions} />
        </div>
        <div className="col-start-3 row-start-2">
          {renderSlot("right", false)}
        </div>
        <div className="col-span-3 col-start-1 row-start-3">
          {renderSlot(
            "self",
            false,
            onSelfSelect,
            handReadOnly,
            confirmTouchSelection,
            confirmTouchSelectionMode,
          )}
        </div>
        {withActions ? (
          <div className="col-span-3 col-start-1 row-start-4">
            {/* 局終了(roundEnd)に加え、半荘を終える局は gameEnd へ直行するため、
                gameEnd でも最終局の和了内訳を表示する(#277)。 */}
            {(phase === "roundEnd" || phase === "gameEnd") && roundSummary ? (
              <WinDetails summary={roundSummary} />
            ) : null}
            <ActionPanel
              actions={actions}
              hint={hint}
              disabled={interactionDisabled}
            />
          </div>
        ) : null}
      </div>
    ),
    [
      renderSlot,
      tableInfo,
      dora,
      actions,
      hint,
      interactionDisabled,
      phase,
      roundSummary,
    ],
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
      ref={boardRootRef}
      // モーダルの最終復帰先として focus() できるようにするだけで、タブ順には入れない。
      tabIndex={-1}
      // 素の <div> はロールもアクセシブル名も持たないため、ここへプログラム的に
      // フォーカスが移ってもスクリーンリーダには「どこへ移ったか」が伝わらない。
      // 着地点として名前を持たせる。landmark(region)ではなく group を選ぶ理由は
      // スペック5 5.2.2 が持つ(#405)。
      role="group"
      aria-label="対局盤面"
      className="@container w-full"
      data-phase={phase}
      data-pending={pending?.kind ?? "none"}
      data-round-kind={roundSummary?.kind ?? "none"}
    >
      {/*
       * 盤面本体(段階①/段階②)。いずれか一方だけがコンテナクエリの display:none で
       * 可視化されるため、AT・E2E のロール照会には常に1側だけが露出する(非表示側は
       * display:none で a11y ツリー・ロールクエリ双方から除外される)。
       * 全体盤面モーダル(段階②の補完)を開いている間の背景隔離は、Portal 外のページヘッダーも
       * 含めて Modal が一括して所有する。
       */}
      <div>
        {/* 段階①: 卓幅 >= 360px はクロス配置。牌・隙間は .board-cross の clamp()/cqi で流体縮小。 */}
        {crossBoard(
          "hidden @min-[360px]:grid",
          handleSelectTile,
          true,
          !handInteractive,
          handInteractive,
          riichiArmed ? "riichi" : "discard",
        )}

        {/* 段階②: 卓幅 < 360px は自家フォーカス表示。他家はコンパクト帯へ縮小。 */}
        <div className="flex flex-col gap-3 @min-[360px]:hidden">
          <div className="flex items-start justify-between gap-2">
            <p
              id={narrowBoardDescriptionId}
              data-testid="narrow-board-description"
              className="min-w-0 flex-1 text-xs leading-5 text-foreground/70"
            >
              狭い画面のため、自分の手牌を自動で優先表示しています。
            </p>
            <button
              ref={boardOpenerRef}
              type="button"
              onClick={() => setBoardOpen(true)}
              aria-describedby={narrowBoardDescriptionId}
              className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg border border-control-border px-3 py-1.5 text-xs font-medium hover:bg-foreground/5"
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
          {renderSlot(
            "self",
            false,
            handleSelectTile,
            !handInteractive,
            handInteractive,
            riichiArmed ? "riichi" : "discard",
          )}
          {(phase === "roundEnd" || phase === "gameEnd") && roundSummary ? (
            <WinDetails summary={roundSummary} />
          ) : null}
          <ActionPanel
            actions={actions}
            hint={hint}
            disabled={interactionDisabled}
          />
        </div>
      </div>

      {/* 全体盤面モーダル(段階②の補完): クロス配置を閲覧専用で再表示。フォーカストラップ/Escape は Modal が担保。 */}
      {boardOpen ? (
        <Modal
          title="全体盤面"
          onClose={() => setBoardOpen(false)}
          returnFocusRef={boardOpenerRef}
          fallbackFocusRef={boardRootRef}
        >
          <div className="@container">
            {crossBoard("grid", undefined, false, true)}
          </div>
        </Modal>
      ) : null}

      <LiveRegion
        politeMessage={announcement}
        politeMessageKey={tileFeedback.eventId}
        secondaryPoliteMessage={kitaAnnouncement}
        assertiveMessage={assertive}
      />
    </div>
  );
}
