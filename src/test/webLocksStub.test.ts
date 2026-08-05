import { describe, expect, it } from "vitest";
import { createLockRequest } from "./webLocksStub";

/**
 * テストダブル自身の契約を固定する。
 *
 * `createLockRequest` は戦績の追記(#363)・全件削除(#482)・上限時間(#488)の
 * 検証台になっている。ここが lock 名や `signal` を捨てていると、実装側で直列化や
 * 中断が壊れてもテストは緑のままになる(= 無防備なテストダブル)。
 */
describe("webLocksStub の createLockRequest", () => {
  const never = () => new AbortController().signal;

  it("同じ名前の要求は FIFO で直列化する", async () => {
    const request = createLockRequest();
    const order: string[] = [];
    let releaseFirst: (() => void) | null = null;

    const first = request(
      "same",
      { signal: never() },
      () =>
        new Promise<void>((resolve) => {
          order.push("first:enter");
          releaseFirst = resolve;
        }),
    );
    const second = request("same", { signal: never() }, () => {
      order.push("second:enter");
    });

    await Promise.resolve();
    // 先着が保持している間、後続は排他区間へ入れない。
    expect(order).toEqual(["first:enter"]);

    (releaseFirst as unknown as () => void)();
    await Promise.all([first, second]);
    expect(order).toEqual(["first:enter", "second:enter"]);
  });

  it("名前が違えば同時に実行できる(= 名前を捨てていない)", async () => {
    const request = createLockRequest();
    const entered: string[] = [];
    let releaseHeld: (() => void) | null = null;

    const held = request(
      "a",
      { signal: never() },
      () =>
        new Promise<void>((resolve) => {
          entered.push("a");
          releaseHeld = resolve;
        }),
    );
    await request("b", { signal: never() }, () => {
      entered.push("b");
    });

    // "a" を保持したままでも "b" は完了できる。
    expect(entered).toEqual(["a", "b"]);
    (releaseHeld as unknown as () => void)();
    await held;
  });

  it("待機中の中断は要求を失敗させ、callback を実行しない", async () => {
    const request = createLockRequest();
    const controller = new AbortController();
    let releaseHolder: (() => void) | null = null;
    let waiterRan = false;

    const holder = request(
      "same",
      { signal: never() },
      () =>
        new Promise<void>((resolve) => {
          releaseHolder = resolve;
        }),
    );
    const waiter = request("same", { signal: controller.signal }, () => {
      waiterRan = true;
    });

    controller.abort(new Error("timeout"));
    await expect(waiter).rejects.toThrow("timeout");

    (releaseHolder as unknown as () => void)();
    await holder;
    // 中断後に順番が回ってきても排他区間へは入れない。
    await Promise.resolve();
    expect(waiterRan).toBe(false);
  });

  it("中断された待機者は、保持中の lock を後続に追い越させない", async () => {
    const request = createLockRequest();
    const controller = new AbortController();
    const order: string[] = [];
    let releaseHolder: (() => void) | null = null;

    const holder = request(
      "same",
      { signal: never() },
      () =>
        new Promise<void>((resolve) => {
          order.push("holder:enter");
          releaseHolder = resolve;
        }),
    );
    const aborted = request("same", { signal: controller.signal }, () => {
      order.push("aborted:enter");
    });
    const last = request("same", { signal: never() }, () => {
      order.push("last:enter");
    });

    controller.abort(new Error("timeout"));
    await expect(aborted).rejects.toThrow("timeout");
    await Promise.resolve();
    // 中断は待ち行列から抜けるだけで、保持中の lock を解放しない。
    expect(order).toEqual(["holder:enter"]);

    (releaseHolder as unknown as () => void)();
    await Promise.all([holder, last]);
    expect(order).toEqual(["holder:enter", "last:enter"]);
  });

  it("取得後の中断は無視する(実 API と同じ)", async () => {
    const request = createLockRequest();
    const controller = new AbortController();

    const result = await request("same", { signal: controller.signal }, () => {
      controller.abort(new Error("too late"));
      return "done";
    });

    expect(result).toBe("done");
  });

  it("要求前に中断済みの signal は即座に失敗する", async () => {
    const request = createLockRequest();
    const controller = new AbortController();
    controller.abort(new Error("already aborted"));
    let ran = false;

    await expect(
      request("same", { signal: controller.signal }, () => {
        ran = true;
      }),
    ).rejects.toThrow("already aborted");
    expect(ran).toBe(false);
  });
});
