"use client";

/**
 * 自家の手牌(スペック6 6.7 `Hand`)。
 *
 * WAI-ARIA APG の Listbox パターンに準拠したロービングタブインデックスで、
 * 矢印キー移動 + `Enter`/`Space` 選択に対応する(スペック5 5.2.2)。打牌の「選択」までを
 * UI として提供し、選択された牌の扱い(実際の打牌処理)はドメイン層の責務(スペック6 6.8)。
 * 各牌の名称は `option` 要素側の `aria-label` が担うため、内側の `Tile` は装飾扱いにする。
 */
import { useCallback, useRef, useState } from "react";
import type { TileData } from "./types";
import Tile from "../common/Tile";
import { tileLabel } from "../common/tileLabel";

export interface HandProps {
  tiles: readonly TileData[];
  /** 牌が選択(打牌候補として決定)されたときに呼ぶ。UIイベントのみでドメイン計算は行わない。 */
  onSelect?: (index: number, tile: TileData) => void;
  /** アクセシブルな一覧名。 */
  label?: string;
}

export default function Hand({
  tiles,
  onSelect,
  label = "自家の手牌",
}: HandProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const optionRefs = useRef<(HTMLLIElement | null)[]>([]);

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
          setSelectedIndex(index);
          onSelect?.(index, tiles[index]);
          break;
        default:
          break;
      }
    },
    [tiles, focusIndex, onSelect],
  );

  return (
    <ul
      role="listbox"
      aria-label={label}
      aria-orientation="horizontal"
      className="flex flex-wrap gap-1"
    >
      {tiles.map((tile, index) => {
        const isActive = index === activeIndex;
        const isSelected = index === selectedIndex;
        return (
          <li
            // 同一牌が複数あるため index を key に含める。
            key={`${tile.suit}-${tile.rank}-${index}`}
            ref={(el) => {
              optionRefs.current[index] = el;
            }}
            role="option"
            aria-selected={isSelected}
            aria-label={tileLabel(tile)}
            tabIndex={isActive ? 0 : -1}
            onKeyDown={(event) => handleKeyDown(event, index)}
            onClick={() => {
              setSelectedIndex(index);
              setActiveIndex(index);
              onSelect?.(index, tile);
            }}
            className={`cursor-pointer rounded-md transition-transform ${
              isSelected ? "-translate-y-1 ring-2 ring-turn-highlight" : ""
            }`}
          >
            <Tile tile={tile} decorative />
          </li>
        );
      })}
    </ul>
  );
}
