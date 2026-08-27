// @vitest-environment jsdom

/**
 * 戦績ストア(`useSyncExternalStore` 用)の契約テスト(issue #302)。
 *
 * `MatchHistoryList` の描画結果だけを見るテストでは、`getSnapshot` 内で副作用を
 * 実行していても同じ表示になってしまい回帰を検出できない。ここでは React を介さず
 * 「`getSnapshot` の純粋性・参照安定性」「破損データ削除が購読側の責務であること」
 * 「購読解除の対称性」を直接検証する。
 *
 * 検証対象が `window`(`storage` イベント)と `localStorage` に触れるため、`.ts`
 * (既定は node 環境)でありながら冒頭の docblock で jsdom を指定している。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appendHistory,
  getHistorySnapshot,
  getHistoryViewSnapshot,
  getServerHistorySnapshot,
  getServerHistoryViewSnapshot,
  MATCH_HISTORY_KEY,
  notifyHistoryChanged,
  retryHistoryViewSnapshot,
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

/**
 * 各テストが張った購読。テストが途中で throw しても購読者が残らないよう、
 * `afterEach` で必ず解除する(残留するとイベント通知回数のアサートが静かに壊れる)。
 */
const activeSubscriptions: (() => void)[] = [];

function subscribe(callback: () => void): () => void {
  const unsubscribe = subscribeHistory(callback);
  activeSubscriptions.push(unsubscribe);
  return unsubscribe;
}

afterEach(() => {
  while (activeSubscriptions.length > 0) activeSubscriptions.pop()?.();
  vi.restoreAllMocks();
  window.localStorage.clear();
  retryHistoryViewSnapshot();
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

  it("appendHistory は保存内容を書き換えたかを返す(通知要否の判定 / #310)", () => {
    // 追記できた場合だけ true。呼び出し側はこれを見て notifyHistoryChanged する。
    expect(appendHistory(window.localStorage, entry(1))).toBe(true);
    // 同一 seed は重複排除されるため保存内容は変わらない = 通知不要。
    expect(appendHistory(window.localStorage, entry(1))).toBe(false);
    // 検証を通らない値は書き込まれないため、こちらも通知不要。
    expect(
      appendHistory(window.localStorage, {
        ...entry(2),
        seed: Number.MAX_SAFE_INTEGER,
      }),
    ).toBe(false);
    expect(getHistorySnapshot().map((e) => e.seed)).toEqual([1]);
  });

  it("subscribeHistory が破損データを削除する(描画中ではなく効果側)", () => {
    window.localStorage.setItem(MATCH_HISTORY_KEY, CORRUPTED);

    const unsubscribe = subscribe(() => {});
    expect(window.localStorage.getItem(MATCH_HISTORY_KEY)).toBeNull();
    unsubscribe();
  });

  it("表示snapshotは破損cleanupを未保存と区別し、再読み込みで空状態へ復帰する", () => {
    window.localStorage.setItem(MATCH_HISTORY_KEY, CORRUPTED);

    expect(getHistoryViewSnapshot()).toEqual({ status: "corrupt-retained" });
    const unsubscribe = subscribe(() => {});
    expect(window.localStorage.getItem(MATCH_HISTORY_KEY)).toBeNull();
    // cleanup直後に「履歴が無い」へ落とさず、削除事実を一過性表示する。
    expect(getHistoryViewSnapshot()).toEqual({ status: "corrupt-cleaned" });

    retryHistoryViewSnapshot();
    expect(getHistoryViewSnapshot()).toEqual({ status: "ready", entries: [] });
    unsubscribe();
  });

  it("破損cleanupのremoveItemが失敗したら削除済みを騙らずkeyを残す", () => {
    window.localStorage.setItem(MATCH_HISTORY_KEY, CORRUPTED);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("Storage is read-only", "SecurityError");
    });

    const unsubscribe = subscribe(() => {});
    expect(getHistoryViewSnapshot()).toEqual({ status: "corrupt-retained" });
    expect(window.localStorage.getItem(MATCH_HISTORY_KEY)).toBe(CORRUPTED);
    unsubscribe();
  });

  it("外部storage eventで入った破損値も効果側でcleanupし通知を保つ", () => {
    const callback = vi.fn();
    const unsubscribe = subscribe(callback);
    expect(getHistoryViewSnapshot()).toEqual({ status: "ready", entries: [] });

    window.localStorage.setItem(MATCH_HISTORY_KEY, CORRUPTED);
    window.dispatchEvent(
      new StorageEvent("storage", { key: MATCH_HISTORY_KEY }),
    );
    expect(callback).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(MATCH_HISTORY_KEY)).toBeNull();
    expect(getHistoryViewSnapshot()).toEqual({ status: "corrupt-cleaned" });
    unsubscribe();
  });

  it("読取例外を空履歴と区別し、外部storage event後に一覧へ復帰する", () => {
    const originalGetItem = Storage.prototype.getItem;
    let blocked = true;
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (
      this: Storage,
      key: string,
    ) {
      if (blocked && key === MATCH_HISTORY_KEY) {
        throw new DOMException("Storage is disabled", "SecurityError");
      }
      return originalGetItem.call(this, key);
    });

    const callback = vi.fn();
    const unsubscribe = subscribe(callback);
    expect(getHistoryViewSnapshot()).toEqual({ status: "read-error" });

    appendHistory(window.localStorage, entry(9));
    blocked = false;
    window.dispatchEvent(
      new StorageEvent("storage", { key: MATCH_HISTORY_KEY }),
    );
    expect(callback).toHaveBeenCalledTimes(1);
    const recovered = getHistoryViewSnapshot();
    expect(recovered.status).toBe("ready");
    if (recovered.status === "ready") {
      expect(recovered.entries.map((item) => item.seed)).toEqual([9]);
    }
    unsubscribe();
  });

  it("購読解除後は通知されない(購読の対称性)", () => {
    const callback = vi.fn();
    const unsubscribe = subscribe(callback);

    notifyHistoryChanged();
    expect(callback).toHaveBeenCalledTimes(1);

    unsubscribe();
    notifyHistoryChanged();
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("storage イベントは購読者1人につき1回だけ通知する", () => {
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = subscribe(first);
    const unsubscribeSecond = subscribe(second);

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
    const unsubscribe = subscribe(callback);

    window.dispatchEvent(new StorageEvent("storage", { key: "other.key" }));
    expect(callback).not.toHaveBeenCalled();

    // key === null は別タブの clear() を意味するため取り込む。
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    expect(callback).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("サーバー描画時のスナップショットは null(= 読み込み中)", () => {
    expect(getServerHistorySnapshot()).toBeNull();
    expect(getServerHistoryViewSnapshot()).toBeNull();
  });
});
