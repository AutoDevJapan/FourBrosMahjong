"use client";

/**
 * 自家の手牌(スペック6 6.7 `Hand`)。
 *
 * WAI-ARIA APG の Listbox パターンに準拠したロービングタブインデックスで、
 * 矢印キー移動 + `Enter`/`Space` 選択に対応する(スペック5 5.2.2)。打牌の「選択」までを
 * UI として提供し、選択された牌の扱い(実際の打牌処理)はドメイン層の責務(スペック6 6.8)。
 * 各牌の名称は `option` 要素側の `aria-label` が担うため、内側の `Tile` は装飾扱いにする。
 */
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import Tile from "../common/Tile";
import { tileLabel } from "../common/tileLabel";
import type { TileData } from "./types";

export interface HandProps {
  tiles: readonly TileData[];
  /** 閲覧専用表示。listbox操作・選択状態・フォーカスを公開しない。 */
  readOnly?: boolean;
  /** 牌が選択(打牌候補として決定)されたときに呼ぶ。UIイベントのみでドメイン計算は行わない。 */
  onSelect?: (index: number, tile: TileData) => void;
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

export default function Hand({
  tiles,
  readOnly = false,
  onSelect,
  label = "自家の手牌",
  tileStates = [],
  onBlockedSelect,
}: HandProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [previousTiles, setPreviousTiles] = useState(tiles);
  const optionRefs = useRef<(HTMLLIElement | null)[]>([]);
  const handHadFocus = useRef(false);

  // 打牌・鳴き等で手牌が更新されたら、旧 index にあった牌の選択状態を持ち越さない。
  // GameProvider の view は engine 更新時だけ新しい手牌配列を生成するため、参照比較により
  // GameBoard 内の無関係な再レンダーでは選択を維持しつつ、手牌構成の更新を検出できる。
  if (previousTiles !== tiles) {
    setPreviousTiles(tiles);
    if (selectedIndex !== null) setSelectedIndex(null);
  }

  // ポン・カン等で手牌が縮小して activeIndex が範囲外になると、tabIndex=0 の option が
  // 0個になりキーボードで手牌へ到達できなくなる。末尾へクランプしてロービングタブ
  // インデックスの不変条件(常にちょうど1牌が tabIndex=0)を保つ(スペック5 5.2.2)。
  // GameBoard の prevCanRiichi と同様の「レンダー中に state を調整する」React 公認
  // パターン(ここでは範囲外かどうかを props から直接判定できるため前回値の保持は不要)。
  const maxIndex = Math.max(tiles.length - 1, 0);
  if (activeIndex > maxIndex) {
    setActiveIndex(maxIndex);
  }

  useLayoutEffect(() => {
    // キーボード操作中の option は、打牌・鳴きで key/index が変わると DOM から外れて
    // body へフォーカスが落ちる。更新前に手牌内へ実フォーカスがあった場合だけ、DOM 更新後の
    // クランプ済み active option へ戻す。手牌外へ移動済みなら下記 blur が false にする。
    if (!handHadFocus.current || tiles.length === 0) return;
    optionRefs.current[Math.min(activeIndex, tiles.length - 1)]?.focus();
  }, [tiles, activeIndex]);

  const focusIndex = useCallback((index: number) => {
    setActiveIndex(index);
    optionRefs.current[index]?.focus();
  }, []);

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
          if (tileStates[index]?.disabled) {
            onBlockedSelect?.(
              tileStates[index].reason ?? "この牌は選べません。",
            );
            break;
          }
          setSelectedIndex(index);
          onSelect?.(index, tiles[index]);
          break;
        default:
          break;
      }
    },
    [tiles, focusIndex, onSelect, tileStates, onBlockedSelect],
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
            <li
              key={`${tile.suit}-${tile.rank}-${index}`}
              aria-label={accessibleLabel}
              className="relative rounded-md"
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
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <ul
      role="listbox"
      aria-label={label}
      aria-orientation="horizontal"
      onFocusCapture={() => {
        handHadFocus.current = true;
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
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
        const isSelected = index === selectedIndex && !disabled;
        const accessibleLabel = state?.reason
          ? `${tileLabel(tile)}、${state.reason}`
          : state?.indicator
            ? `${tileLabel(tile)}、${state.indicator}`
            : tileLabel(tile);
        return (
          <li
            // 同一牌が複数あるため index を key に含める。
            key={`${tile.suit}-${tile.rank}-${index}`}
            ref={(el) => {
              optionRefs.current[index] = el;
            }}
            role="option"
            aria-selected={isSelected}
            aria-label={accessibleLabel}
            aria-disabled={disabled || undefined}
            tabIndex={isActive ? 0 : -1}
            onKeyDown={(event) => handleKeyDown(event, index)}
            onClick={() => {
              if (disabled) {
                setActiveIndex(index);
                onBlockedSelect?.(state?.reason ?? "この牌は選べません。");
                return;
              }
              setSelectedIndex(index);
              setActiveIndex(index);
              onSelect?.(index, tile);
            }}
            className={`relative rounded-md transition-transform ${
              disabled
                ? "cursor-not-allowed opacity-45 grayscale"
                : "cursor-pointer hover:-translate-y-0.5"
            } ${
              state?.highlighted
                ? "ring-2 ring-turn-highlight ring-offset-2 ring-offset-background"
                : ""
            } ${isSelected ? "-translate-y-1 ring-2 ring-turn-highlight" : ""}`}
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
          </li>
        );
      })}
    </ul>
  );
}
