// @vitest-environment jsdom

/**
 * 戦績ストア(`useSyncExternalStore` 用)の契約テスト(issue #302)。
 *
 * `MatchHistoryList` の描画結果だけを見るテストでは、`getSnapshot` 内で副作用を
 * 実行していても同じ表示になってしまい回帰を検出できない。ここでは React を介さず
 * 「`getSnapshot` の純粋性・参照安定性」「破損データ削除が購読側の責務であること」
 * 「購読解除の対称性」を直接検証する。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appendHistory,
  getHistorySnapshot,
  getServerHistorySnapshot,
  MATCH_HISTORY_KEY,
  notifyHistoryChanged,
  subscribeHistory,
} from "./matchHistory";

const CORRUPTED = '{"version":1,"entries":[{}]}';

function entry(seed: number) {
  const names = ["一郎", "二郎", "三郎", "四郎"] as const;
  return {
    seed,
    finishedAt: 1_753_000_000_000,
    players: names.map((name, i) => ({
      name,
      rank: i + 1,
      rawScore: [23_000, 8_000, -11_000, -20_000][i],
      uma: [10_000, 5_000, -5_000, -10_000][i],
      bonus: 0,
      soshiiTotal: [33_000, 13_000, -16_000, -30_000][i],
    })),
  };
}

afterEach(() => {
  window.localStorage.clear();
});

describe("match history store (#302)", () => {
  it("getHistorySnapshot は破損データでも localStorage を書き換えない(純粋性)", () => {
    window.localStorage.setItem(MATCH_HISTORY_KEY, CORRUPTED);

    expect(getHistorySnapshot()).toEqual([]);
    // 削除は購読(効果)側の責務。描画中に呼ばれる getSnapshot は保存内容を変えない。
    expect(window.localStorage.getItem(MATCH_HISTORY_KEY)).toBe(CORRUPTED);
  });

  it("保存値が変わらない限り同一参照を返す(無限再描画の防止)", () => {
    appendHistory(window.localStorage, entry(1));

    const first = getHistorySnapshot();
    expect(first).toHaveLength(1);
    expect(getHistorySnapshot()).toBe(first);

    // 未保存・破損はいずれも同一の空配列参照に落ちる。
    window.localStorage.clear();
    const empty = getHistorySnapshot();
    expect(empty).toEqual([]);
    window.localStorage.setItem(MATCH_HISTORY_KEY, CORRUPTED);
    expect(getHistorySnapshot()).toBe(empty);
  });

  it("保存値が変われば新しいスナップショットを返す", () => {
    appendHistory(window.localStorage, entry(1));
    const first = getHistorySnapshot();

    appendHistory(window.localStorage, entry(2));
    const second = getHistorySnapshot();

    expect(second).not.toBe(first);
    expect(second.map((e) => e.seed)).toEqual([2, 1]);
  });

  it("subscribeHistory が破損データを削除する(描画中ではなく効果側)", () => {
    window.localStorage.setItem(MATCH_HISTORY_KEY, CORRUPTED);

    const unsubscribe = subscribeHistory(() => {});
    expect(window.localStorage.getItem(MATCH_HISTORY_KEY)).toBeNull();
    unsubscribe();
  });

  it("購読解除後は通知されない(購読の対称性)", () => {
    const callback = vi.fn();
    const unsubscribe = subscribeHistory(callback);

    notifyHistoryChanged();
    expect(callback).toHaveBeenCalledTimes(1);

    unsubscribe();
    notifyHistoryChanged();
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("storage イベントは購読者1人につき1回だけ通知する", () => {
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = subscribeHistory(first);
    const unsubscribeSecond = subscribeHistory(second);

    window.dispatchEvent(
      new StorageEvent("storage", { key: MATCH_HISTORY_KEY }),
    );

    // リスナをモジュールで1本にしていないと購読者数の二乗回呼ばれる。
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    unsubscribeFirst();
    unsubscribeSecond();
    // 全員解除後はリスナ自体が外れ、通知は届かない。
    window.dispatchEvent(
      new StorageEvent("storage", { key: MATCH_HISTORY_KEY }),
    );
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("無関係なキーの storage イベントでは通知しない", () => {
    const callback = vi.fn();
    const unsubscribe = subscribeHistory(callback);

    window.dispatchEvent(new StorageEvent("storage", { key: "other.key" }));
    expect(callback).not.toHaveBeenCalled();

    // key === null は別タブの clear() を意味するため取り込む。
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    expect(callback).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("サーバー描画時のスナップショットは null(= 読み込み中)", () => {
    expect(getServerHistorySnapshot()).toBeNull();
  });
});
