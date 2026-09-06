"use client";

/**
 * 自家の手牌(スペック6 6.7 `Hand`)。
 *
 * WAI-ARIA APG の Listbox パターンに準拠したロービングタブインデックスで、
 * 矢印キー移動 + `Enter`/`Space` 選択に対応する(スペック5 5.2.2)。打牌の「選択」までを
 * UI として提供し、選択された牌の扱い(実際の打牌処理)はドメイン層の責務(スペック6 6.8)。
 * タッチポインターでは誤タップを防ぐため、必要な画面だけ選択と打牌確定を分離する。
 * 各牌の名称は `option` 要素側の `aria-label` が担うため、内側の `Tile` は装飾扱いにする。
 */
import {
  type RefObject,
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import Tile from "../common/Tile";
import { tileLabel } from "../common/tileLabel";
import HandTileAnimation from "./hand-animation/HandTileAnimation";
import {
  classifyHandTransition,
  type HandTransition,
} from "./hand-animation/handAnimation";
import type { TileData } from "./types";

export interface HandProps {
  tiles: readonly TileData[];
  /** 閲覧専用表示。listbox操作・選択状態・フォーカスを公開しない。 */
  readOnly?: boolean;
  /** 対話中の手牌が閲覧専用へ切り替わる際の論理的なフォーカス着地点(#966)。 */
  readOnlyFocusRef?: RefObject<HTMLElement | null>;
  /** 牌が選択(打牌候補として決定)されたときに呼ぶ。UIイベントのみでドメイン計算は行わない。 */
  onSelect?: (index: number, tile: TileData) => void;
  /** タッチ操作では1回目を選択状態に留め、確定ボタンを要求する。 */
  confirmTouchSelection?: boolean;
  /** タッチ選択の確定対象。リーチ宣言中は通常の打牌と文言を分ける。 */
  confirmTouchSelectionMode?: "discard" | "riichi";
  /** アクセシブルな一覧名。 */
  label?: string;
  tileStates?: readonly HandTileState[];
  onBlockedSelect?: (message: string) => void;
}

export interface HandTileState {
  readonly disabled?: boolean;
  readonly reason?: string;
  readonly indicator?: string;
  readonly highlighted?: boolean;
}

interface HandAnimationState {
  readonly id: number;
  readonly transition: HandTransition | null;
}

const DEAL_STAGGER_MS = 30;

/**
 * Focus is an accessibility enhancement, not a prerequisite for using the hand.
 * Embedded or privacy-restricted DOM hosts may expose a focus method that throws,
 * so contain the write at every Hand focus boundary.
 */
function tryFocus(
  element: HTMLElement | null | undefined,
  options?: FocusOptions,
): boolean {
  if (element === null || element === undefined) return false;
  try {
    if (options === undefined) element.focus();
    else element.focus(options);
    return true;
  } catch {
    return false;
  }
}

/**
 * Verify a focus move when the host permits reading activeElement. If that
 * capability is unavailable, the successful focus call remains best effort.
 */
function tryFocusAndVerify(element: HTMLElement | null | undefined): boolean {
  if (!tryFocus(element)) return false;
  if (element === null || element === undefined) return false;
  try {
    return element.ownerDocument.activeElement === element;
  } catch {
    return true;
  }
}

/**
 * Reading an optional aria-disabled marker must not make focus restoration
 * unavailable. Embedded or privacy-restricted DOM hosts may reject the
 * attribute lookup, in which case the option remains a best-effort target.
 */
function isAriaDisabled(element: HTMLElement | null | undefined): boolean {
  if (element === null || element === undefined) return false;
  try {
    return element.getAttribute("aria-disabled") === "true";
  } catch {
    return false;
  }
}

/**
 * FocusEvent.relatedTarget is an EventTarget, not necessarily a DOM Node.
 * Browsing-context focus changes can provide a Window-like target, which must
 * be treated as leaving the Hand without passing it to Node.contains().
 */
function focusLeftContainer(
  container: HTMLElement,
  relatedTarget: EventTarget | null,
): boolean {
  if (relatedTarget === null) return true;
  try {
    return !(
      relatedTarget instanceof Node && container.contains(relatedTarget)
    );
  } catch {
    return true;
  }
}

/**
 * Scrolling the touch-confirmation control is an accessibility enhancement,
 * not a prerequisite for confirming a discard. Some embedded DOM hosts expose
 * `scrollIntoView` but reject the call, so keep that optional capability behind
 * its own failure boundary.
 */
function tryScrollIntoView(element: HTMLElement): void {
  try {
    element.scrollIntoView?.({
      block: "center",
      inline: "nearest",
      behavior: "auto",
    });
  } catch {
    // The focused confirmation button remains usable when scrolling is blocked.
  }
}

export default function Hand({
  tiles,
  readOnly = false,
  readOnlyFocusRef,
  onSelect,
  confirmTouchSelection = false,
  confirmTouchSelectionMode = "discard",
  label = "自家の手牌",
  tileStates = [],
  onBlockedSelect,
}: HandProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [touchSelectionIndex, setTouchSelectionIndex] = useState<number | null>(
    null,
  );
  const [previousReadOnly, setPreviousReadOnly] = useState(readOnly);
  const [previousTiles, setPreviousTiles] = useState<
    readonly TileData[] | null
  >(null);
  const [handAnimation, setHandAnimation] = useState<HandAnimationState>({
    id: 0,
    transition: null,
  });
  const optionRefs = useRef<(HTMLLIElement | null)[]>([]);
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusIndexRef = useRef<number | null>(null);
  const handHadFocus = useRef(false);
  const lastCommittedReadOnly = useRef(readOnly);
  const pointerTypeRef = useRef<"touch" | "other" | null>(null);
  const touchSelectionStatusId = useId();

  // GameProvider の view は engine 更新時だけ新しい手牌配列を生成するため、参照比較で
  // 構成の更新だけを拾う。同じ配列参照の再レンダーでは transition key を維持し、同じ
  // 演出を再スタートしない。新しい参照でも同じ牌面なら、過去の演出を再利用しない。
  // これは Hand に既存の「props から導ける state を render 中に同期する」パターンに
  // 合わせ、ref を render 中に読み書きしない React 19 の純粋性契約も保つ。
  if (previousTiles !== tiles) {
    const transition = classifyHandTransition(previousTiles, tiles);
    setPreviousTiles(tiles);
    setHandAnimation({
      id: handAnimation.id + 1,
      transition,
    });
    if (selectedIndex !== null) setSelectedIndex(null);
    if (touchSelectionIndex !== null) setTouchSelectionIndex(null);
  }

  const animationPropsForIndex = (index: number) => {
    const transition = handAnimation.transition;
    if (
      transition === null ||
      !transition.affectedTileIndices.includes(index)
    ) {
      return {};
    }
    return {
      animationKey: `${transition.kind}-${handAnimation.id}-${index}`,
      animationKind: transition.kind,
      animationDelayMs:
        transition.kind === "deal" ? index * DEAL_STAGGER_MS : undefined,
    } as const;
  };

  // ポン・カン等で手牌が縮小して activeIndex が範囲外になると、tabIndex=0 の option が
  // 0個になりキーボードで手牌へ到達できなくなる。末尾へクランプしてロービングタブ
  // インデックスの不変条件(常にちょうど1牌が tabIndex=0)を保つ(スペック5 5.2.2)。
  // GameBoard の prevCanRiichi と同様の「レンダー中に state を調整する」React 公認
  // パターン(ここでは範囲外かどうかを props から直接判定できるため前回値の保持は不要)。
  const maxIndex = Math.max(tiles.length - 1, 0);
  if (activeIndex > maxIndex) {
    setActiveIndex(maxIndex);
  }

  // リーチ宣言モードへの切り替えや局面更新で、選択中の牌が操作不可になった場合は
  // 確定待ちを残さない。古い選択が後から有効になって打牌されることも防ぐ。
  // activeIndex の補正と同じく、propsから直接判定できる前回値比較のパターンを使う。
  const touchSelectionInvalid =
    touchSelectionIndex !== null &&
    (touchSelectionIndex >= tiles.length ||
      tileStates[touchSelectionIndex]?.disabled === true);
  if (touchSelectionInvalid) {
    setTouchSelectionIndex(null);
  }

  // 接続断で閲覧専用へ切り替わる際、再接続後に古い選択を表示・確定しない。
  // props の変化から同期的に導ける state は、Hand の既存の手牌更新・index 補正と同じ
  // 条件付き render-state 調整で破棄する(外部副作用ではないため effect は使わない)。
  if (previousReadOnly !== readOnly) {
    setPreviousReadOnly(readOnly);
    if (readOnly) {
      if (selectedIndex !== null) setSelectedIndex(null);
      if (touchSelectionIndex !== null) setTouchSelectionIndex(null);
    }
  }

  useLayoutEffect(() => {
    // キーボード操作中の option は、打牌・鳴きで key/index が変わると DOM から外れて
    // body へフォーカスが落ちる。更新前に手牌内へ実フォーカスがあった場合だけ、DOM 更新後の
    // クランプ済み active option へ戻す。手牌外へ移動済みなら下記 blur が false にする。
    if (!handHadFocus.current || tiles.length === 0) return;
    tryFocus(optionRefs.current[Math.min(activeIndex, tiles.length - 1)]);
  }, [tiles, activeIndex]);

  useLayoutEffect(() => {
    const switchedToReadOnly = !lastCommittedReadOnly.current && readOnly;
    lastCommittedReadOnly.current = readOnly;
    if (!switchedToReadOnly || !handHadFocus.current) return;

    // The interactive hand controls are removed by the read-only branch. Move focus to
    // the caller's named board target so the user does not fall back to body (#966).
    const fallback = readOnlyFocusRef?.current;
    if (!fallback) return;
    if (tryFocusAndVerify(fallback)) {
      handHadFocus.current = false;
    }
  }, [readOnly, readOnlyFocusRef]);

  // タッチ選択で確認UIが追加された直後は、確認ボタンへフォーカスを移す。
  // `preventScroll` でフォーカス移動による予期せぬジャンプを抑えたあと、ボタン自身を
  // viewport中央へ安全にスクロールする。これにより 320/360px の狭幅でも確定操作が
  // 画面外に残らず、document.activeElement が body に落ちない(#607)。
  useLayoutEffect(() => {
    if (!confirmTouchSelection || touchSelectionIndex === null) return;
    const button = confirmButtonRef.current;
    if (!button) return;
    tryFocus(button, { preventScroll: true });
    tryScrollIntoView(button);
  }, [confirmTouchSelection, touchSelectionIndex]);

  // 確定成功時はゲーム側の更新へフォーカスを委ねる。解除操作でのみ復帰先を予約し、
  // 選択牌が再描画されたあとにその牌へ戻す(#607)。
  useLayoutEffect(() => {
    if (touchSelectionIndex !== null) return;
    const index = restoreFocusIndexRef.current;
    if (index === null) return;
    restoreFocusIndexRef.current = null;
    const option = optionRefs.current[index];
    if (!isAriaDisabled(option)) tryFocus(option);
  }, [touchSelectionIndex]);

  const handleCancelTouchSelection = useCallback(() => {
    if (touchSelectionIndex === null) return;
    restoreFocusIndexRef.current = touchSelectionIndex;
    setActiveIndex(touchSelectionIndex);
    setTouchSelectionIndex(null);
    setSelectedIndex(null);
  }, [touchSelectionIndex]);

  const focusIndex = useCallback((index: number) => {
    setActiveIndex(index);
    tryFocus(optionRefs.current[index]);
  }, []);

  const commitSelection = useCallback(
    (index: number, tile: TileData) => {
      setSelectedIndex(index);
      setTouchSelectionIndex(null);
      onSelect?.(index, tile);
    },
    [onSelect],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLLIElement>, index: number) => {
      const last = tiles.length - 1;
      switch (event.key) {
        case "ArrowRight":
        case "ArrowDown":
          event.preventDefault();
          focusIndex(index === last ? 0 : index + 1);
          break;
        case "ArrowLeft":
        case "ArrowUp":
          event.preventDefault();
          focusIndex(index === 0 ? last : index - 1);
          break;
        case "Home":
          event.preventDefault();
          focusIndex(0);
          break;
        case "End":
          event.preventDefault();
          focusIndex(last);
          break;
        case "Enter":
        case " ":
          event.preventDefault();
          if (event.repeat) break;
          if (tileStates[index]?.disabled) {
            onBlockedSelect?.(
              tileStates[index].reason ?? "この牌は選べません。",
            );
            break;
          }
          commitSelection(index, tiles[index]);
          break;
        default:
          break;
      }
    },
    [tiles, focusIndex, commitSelection, tileStates, onBlockedSelect],
  );

  if (readOnly) {
    // role="list" は冗長だが明示する — Tailwind preflight の list-style 除去により Safari が
    // list セマンティクスを落とし、VoiceOver がリスト名ごと読まなくなる既知挙動への対処
    // (スペック5 5.2.5 / #270)。操作可能な listbox 側は別ロール明示済みのため対象外。
    return (
      <ul role="list" aria-label={label} className="flex flex-wrap gap-1">
        {tiles.map((tile, index) => {
          const state = tileStates[index];
          const accessibleLabel = state?.indicator
            ? `${tileLabel(tile)}、${state.indicator}`
            : tileLabel(tile);
          return (
            <HandTileAnimation
              key={`${tile.suit}-${tile.rank}-${index}`}
              aria-label={accessibleLabel}
              className="relative rounded-md"
              {...animationPropsForIndex(index)}
            >
              <Tile tile={tile} decorative />
              {state?.indicator ? (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 bottom-0 rounded-b bg-background/95 px-0.5 text-center font-bold text-[0.55rem] leading-tight text-foreground"
                >
                  {state.indicator}
                </span>
              ) : null}
            </HandTileAnimation>
          );
        })}
      </ul>
    );
  }

  const pendingTouchTile =
    confirmTouchSelection &&
    touchSelectionIndex !== null &&
    !touchSelectionInvalid
      ? tiles[touchSelectionIndex]
      : undefined;

  const handleConfirmTouchSelection = () => {
    if (touchSelectionIndex === null || pendingTouchTile === undefined) return;
    if (tileStates[touchSelectionIndex]?.disabled) {
      setTouchSelectionIndex(null);
      setSelectedIndex(null);
      return;
    }
    commitSelection(touchSelectionIndex, pendingTouchTile);
  };

  const touchSelectionAction =
    confirmTouchSelectionMode === "riichi" ? "リーチ宣言" : "打牌";

  const listbox = (
    <ul
      role="listbox"
      aria-label={label}
      aria-orientation="horizontal"
      aria-describedby={
        pendingTouchTile !== undefined ? touchSelectionStatusId : undefined
      }
      onFocusCapture={() => {
        handHadFocus.current = true;
      }}
      onBlurCapture={(event) => {
        if (focusLeftContainer(event.currentTarget, event.relatedTarget)) {
          handHadFocus.current = false;
        }
      }}
      className="flex flex-wrap gap-1"
    >
      {tiles.map((tile, index) => {
        const isActive = index === activeIndex;
        const state = tileStates[index];
        const disabled = state?.disabled ?? false;
        // 局面更新後に同じ index が禁止牌へ変わっても、以前の選択リングを残さない。
        const effectiveSelectedIndex = touchSelectionIndex ?? selectedIndex;
        const isSelected = index === effectiveSelectedIndex && !disabled;
        const accessibleLabel = state?.reason
          ? `${tileLabel(tile)}、${state.reason}`
          : state?.indicator
            ? `${tileLabel(tile)}、${state.indicator}`
            : tileLabel(tile);
        // 「リーチ可」と「選択中」は同じリングで、選択中だけ浮き上がりを足して区別する。
        const ringed = state?.highlighted === true || isSelected;
        const animationProps = animationPropsForIndex(index);
        return (
          <HandTileAnimation
            // 同一牌が複数あるため index を key に含める。
            key={`${tile.suit}-${tile.rank}-${index}`}
            {...animationProps}
            ref={(el) => {
              optionRefs.current[index] = el;
            }}
            role="option"
            aria-selected={isSelected}
            aria-label={accessibleLabel}
            aria-disabled={disabled || undefined}
            tabIndex={isActive ? 0 : -1}
            onPointerDown={(event) => {
              if (confirmTouchSelection && event.pointerType === "touch") {
                pointerTypeRef.current = "touch";
              } else if (pointerTypeRef.current !== "touch") {
                pointerTypeRef.current = "other";
              }
            }}
            onPointerCancel={() => {
              pointerTypeRef.current = null;
            }}
            onTouchStart={() => {
              if (confirmTouchSelection) pointerTypeRef.current = "touch";
            }}
            onTouchCancel={() => {
              pointerTypeRef.current = null;
            }}
            onKeyDown={(event) => handleKeyDown(event, index)}
            onClick={(event) => {
              // dblclickの2回目は1回目と同じ物理activation。React commit後の
              // 新しいhandlerへ配送されても、次巡の操作として再利用しない。
              if (event.detail > 1) {
                pointerTypeRef.current = null;
                return;
              }
              const isTouchActivation =
                confirmTouchSelection && pointerTypeRef.current === "touch";
              pointerTypeRef.current = null;
              if (disabled) {
                setActiveIndex(index);
                onBlockedSelect?.(state?.reason ?? "この牌は選べません。");
                return;
              }
              setActiveIndex(index);
              if (isTouchActivation) {
                setSelectedIndex(null);
                setTouchSelectionIndex(index);
                return;
              }
              commitSelection(index, tile);
            }}
            className={`relative rounded-md transition-transform motion-reduce:transition-none ${
              confirmTouchSelection ? "hand-touch-option" : ""
            } ${
              disabled
                ? "cursor-not-allowed opacity-45 grayscale"
                : "cursor-pointer hover:-translate-y-0.5"
            } ${
              // 「リーチ可」も「選択中」も同じ 0〜2px のバンドのリングで表す(#399)。
              // `ring-offset-*` を付けると 2〜4px を占め、グローバルの
              // `:focus-visible { outline: 2px; outline-offset: 2px }` と同じ帯に重なる。
              // outline は外側 box-shadow より上に描かれるため、キーボードでその牌へ
              // フォーカスした瞬間に状態表示が完全に隠れていた。
              ringed ? "ring-2 ring-turn-highlight" : ""
            } ${isSelected ? "-translate-y-1" : ""}`}
          >
            <Tile tile={tile} decorative />
            {state?.indicator ? (
              <span
                aria-hidden="true"
                className="absolute inset-x-0 bottom-0 rounded-b bg-background/95 px-0.5 text-center font-bold text-[0.55rem] leading-tight text-foreground"
              >
                {state.indicator}
              </span>
            ) : null}
          </HandTileAnimation>
        );
      })}
    </ul>
  );

  if (pendingTouchTile === undefined) return listbox;

  return (
    <div className="flex flex-col gap-2">
      {listbox}
      <div
        className="rounded-md border border-control-border bg-background/70 p-2"
        onFocusCapture={() => {
          handHadFocus.current = true;
        }}
        onBlurCapture={(event) => {
          if (focusLeftContainer(event.currentTarget, event.relatedTarget)) {
            handHadFocus.current = false;
          }
        }}
      >
        <p
          id={touchSelectionStatusId}
          role="status"
          aria-live="polite"
          className="text-xs text-foreground/75"
        >
          {tileLabel(pendingTouchTile)}
          を選択中です。{touchSelectionAction}
          を確定するにはボタンを押してください。
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            ref={confirmButtonRef}
            type="button"
            onClick={handleConfirmTouchSelection}
            className="min-h-11 rounded-lg bg-turn-highlight px-3 py-2 text-sm font-semibold text-background hover:opacity-90"
          >
            {tileLabel(pendingTouchTile)}で{touchSelectionAction}を確定
          </button>
          <button
            type="button"
            onClick={handleCancelTouchSelection}
            className="min-h-11 rounded-lg border border-control-border px-3 py-2 text-sm font-medium hover:bg-foreground/5"
          >
            選択を解除
          </button>
        </div>
      </div>
    </div>
  );
}
