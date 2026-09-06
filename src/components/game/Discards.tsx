/**
 * 河(捨て牌)の表示(スペック6 6.4.2)。着席プレイヤーごとに表示し、抜け番スロットには出さない。
 * 各牌は自己ラベル付きの `Tile` を再利用する。値渡しのみの純表示コンポーネント(スペック6 6.6)。
 */

"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Tile from "../common/Tile";
import type { RiverTileData } from "./types";

export interface DiscardsProps {
  tiles: readonly RiverTileData[];
  /** 狭幅の帯表示では直近数枚のみを表示するため上限を渡せる(スペック6 6.4.3)。 */
  limit?: number;
}

export interface RiverTileLayout {
  readonly isRiichi: boolean;
  /** リーチ宣言牌と同じ段にある後続牌だけを横へ詰める。 */
  readonly shiftsAfterRiichi: boolean;
}

export interface RiverCue {
  /** 同じ捨て牌でも捨て順が変われば別イベントになる、状態由来のキー。 */
  readonly eventKey: string;
  /** `tiles`(表示上限を適用する前)における入場牌の位置。 */
  readonly tileIndex: number;
  /** この cue が導出された河の状態キー。 */
  readonly stateKey: string;
}

/** 河牌の意味とリーチ状態を含む、DOM/React再描画に依存しない牌キー。 */
export function riverTileKey(tile: RiverTileData): string {
  return `${tile.suit}-${tile.rank}-${tile.isRed === true ? "red" : "normal"}-${tile.isRiichi === true ? "riichi" : "plain"}`;
}

/** 河の順序も含めた状態キー。初回描画・復元を過去イベントとして扱わないために使う。 */
export function riverStateKey(tiles: readonly RiverTileData[]): string {
  return tiles.map((tile, index) => `${index}:${riverTileKey(tile)}`).join("|");
}

/**
 * 1つのコミット済み状態遷移が「河へ1枚追加」だった場合だけ cue を返す。
 *
 * - 初回描画/復元は `previous === null` なので静かにする。
 * - 鳴きによる牌の取り除き、局替わりのリセット、複数状態を飛ばした再接続は
 *   途中の牌を推測せず、次の状態を基準にする。
 * - リーチ宣言牌も同じ追加イベントとして扱う。横置きは state の `isRiichi`、
 *   入場はこの cue から導出するため、ルール処理を待たせない。
 */
export function riverCueForTransition(
  previous: readonly RiverTileData[] | null,
  current: readonly RiverTileData[],
): RiverCue | null {
  if (previous === null || current.length !== previous.length + 1) return null;

  for (let index = 0; index < previous.length; index += 1) {
    if (riverTileKey(previous[index]) !== riverTileKey(current[index])) {
      return null;
    }
  }

  const tileIndex = current.length - 1;
  const tile = current[tileIndex];
  if (tile === undefined) return null;

  const stateKey = riverStateKey(current);
  return {
    eventKey: `discard:${tileIndex}:${riverTileKey(tile)}:${stateKey}`,
    tileIndex,
    stateKey,
  };
}

/** 同種牌の削除で後続牌のDOMノードを不必要に全交換しないための表示キー。 */
function riverTileRenderKey(
  tiles: readonly RiverTileData[],
  index: number,
): string {
  const identity = riverTileKey(tiles[index]);
  let occurrence = 0;
  for (let previousIndex = 0; previousIndex < index; previousIndex += 1) {
    if (riverTileKey(tiles[previousIndex]) === identity) occurrence += 1;
  }
  return `${identity}:${occurrence}`;
}

/**
 * OSS `PlayerRiverManager` の挙動を参考にした、河牌の表示位置メタデータ。
 * 列数が未確定のサーバー/初回描画では横詰めを行わず、実 DOM の列数確定後に再計算する。
 */
export function getRiverTileLayout(
  tiles: readonly RiverTileData[],
  columnCount: number | null,
): readonly RiverTileLayout[] {
  const riichiIndex = tiles.findIndex((tile) => tile.isRiichi === true);
  const columns = columnCount ?? 1;
  const canShift = columnCount !== null && columnCount > 0;

  return tiles.map((tile, index) => ({
    isRiichi: tile.isRiichi === true,
    shiftsAfterRiichi:
      canShift &&
      riichiIndex >= 0 &&
      index > riichiIndex &&
      Math.floor(index / columns) === Math.floor(riichiIndex / columns),
  }));
}

export default function Discards({ tiles, limit }: DiscardsProps) {
  const shown =
    typeof limit === "number" && limit >= 0
      ? tiles.slice(Math.max(tiles.length - limit, 0))
      : tiles;
  const stateKey = riverStateKey(tiles);
  const listRef = useRef<HTMLUListElement>(null);
  const [columnCount, setColumnCount] = useState<number | null>(null);
  const [riverCue, setRiverCue] = useState<RiverCue | null>(null);
  const previousTilesRef = useRef<readonly RiverTileData[] | null>(null);
  const processedStateKeyRef = useRef<string | null>(null);

  useEffect(() => {
    // `tiles` can be a new array on an unrelated parent render. The semantic
    // key is the gate that makes one committed river state one cue decision.
    if (processedStateKeyRef.current === stateKey) return;
    processedStateKeyRef.current = stateKey;

    const previous = previousTilesRef.current;
    previousTilesRef.current = tiles;
    setRiverCue(riverCueForTransition(previous, tiles));
  }, [stateKey, tiles]);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (list === null) return;

    const updateColumnCount = () => {
      try {
        const view = list.ownerDocument.defaultView;
        const getComputedStyle = view?.getComputedStyle;
        if (typeof getComputedStyle !== "function") {
          setColumnCount(null);
          return;
        }
        const columns = getComputedStyle
          .call(view, list)
          .gridTemplateColumns.trim()
          .split(/\s+/)
          .filter(Boolean).length;
        setColumnCount(columns > 0 ? columns : null);
      } catch {
        // CSSOM is optional for the river layout. Keep the unmeasured layout
        // when an embedded runtime cannot expose or evaluate it.
        setColumnCount(null);
      }
    };

    updateColumnCount();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => updateColumnCount());
    observer?.observe(list);
    window.addEventListener("resize", updateColumnCount);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateColumnCount);
    };
  }, [limit, shown.length]);

  const layout = getRiverTileLayout(shown, columnCount);
  const hasRiichi = layout.some((item) => item.isRiichi);
  const shownStartIndex = tiles.length - shown.length;
  const enteringIndex =
    riverCue?.stateKey === stateKey && riverCue.tileIndex >= shownStartIndex
      ? riverCue.tileIndex - shownStartIndex
      : null;

  // role="list" は冗長だが明示する — Tailwind preflight の list-style 除去により Safari が
  // list セマンティクスを落とし、VoiceOver がリスト名ごと読まなくなる既知挙動への対処
  // (スペック5 5.2.5 / #270)。
  // OSS の PlayerRiverManager はこの挙動の参照元だが、ここで使うのは挙動のみで、C#・Unity・
  // Majsoul 由来リソース・牌素材は取り込んでいない。
  return (
    <ul
      ref={listRef}
      role="list"
      aria-label="捨て牌"
      data-has-riichi={hasRiichi ? "true" : undefined}
      data-river-event-key={
        riverCue?.stateKey === stateKey ? riverCue.eventKey : undefined
      }
      data-river-state-key={stateKey}
      // 列幅を牌1枚ぶんの固定幅にして密に並べる(#258)。列数はスロット幅に入るぶんだけ
      // 作られ上限 6 列(#387: 6 列固定だと狭いスロットでページが横スクロールしていた)。
      // グリッド定義は `.river-grid`(globals.css)— 牌寸法と列幅の定義元を一本化するため。
      className="game-river river-grid"
    >
      {shown.map((tile, i) => (
        // 河は同一牌が複数並ぶため、同種牌の出現順を含むキーにする。
        <li
          key={riverTileRenderKey(shown, i)}
          data-river-index={i}
          data-riichi={layout[i].isRiichi ? "true" : undefined}
          data-after-riichi={layout[i].shiftsAfterRiichi ? "true" : undefined}
          data-river-animation={enteringIndex === i ? "discard" : undefined}
          className={
            enteringIndex === i
              ? "river-discard-enter motion-reduce:animate-none"
              : undefined
          }
        >
          {layout[i].isRiichi ? (
            <span className="sr-only">リーチ宣言牌</span>
          ) : null}
          <Tile tile={tile} size="river" />
        </li>
      ))}
    </ul>
  );
}
