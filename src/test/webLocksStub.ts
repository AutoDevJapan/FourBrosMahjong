/**
 * jsdom テスト用の最小 Web Locks stub(`navigator.locks` は jsdom に無い)。
 *
 * 戦績の追記(#363)と全件削除(#482)はどちらも同じ Web Lock の排他区間で実行される
 * ため、両方のテストがこの stub を共有する。個別に書くと片方だけ実 API と形が
 * ずれていても気づけない。
 *
 * `request` は実 API と同じく **必ず Promise を返す**。同期に値を返す stub は解決が
 * 1マイクロタスク早まり、フォーカス移動や `role="status"` の読み上げ順序を実機と
 * 異なるタイミングで観測してしまう。
 *
 * 既定実装は**実 API の契約を捨てない**。すなわち
 *
 * - **lock 名ごと**に排他する(名前が違えば同時に走る)。名前を無視する stub だと、
 *   実装が別名の lock を使い始めても直列化が壊れたことに気づけない。
 * - `options.signal` の中断を尊重する。中断は**待機中にだけ**効き、取得後の中断は
 *   無視する(Web Locks 仕様と同じ)。上限時間(#488)の検証がここに依存する。
 */

/** `navigator.locks.request` の options のうち、テスト対象が使う最小形。 */
interface StubLockOptions {
  readonly signal: AbortSignal;
}

/** `navigator.locks.request` のうち、テストが必要とする最小形(実 API と同じ options 形式)。 */
export type StubLockRequest = (
  name: string,
  options: StubLockOptions,
  callback: () => unknown,
) => Promise<unknown>;

/**
 * lock 名ごとに FIFO で排他する `request` を作る。呼び出しごとに独立した保持状態を
 * 持つため、テスト間で lock が漏れない。
 */
export function createLockRequest(): StubLockRequest {
  /** lock 名 → その名前で現在待ち行列にある最後の処理(解放時点)。 */
  const tails = new Map<string, Promise<void>>();

  return (name, options, callback) => {
    const previous = tails.get(name) ?? Promise.resolve();
    let aborted = false;
    let settle!: (value: unknown) => void;
    let fail!: (reason: unknown) => void;
    const result = new Promise<unknown>((resolve, reject) => {
      settle = resolve;
      fail = reject;
    });
    const onAbort = () => {
      aborted = true;
      fail(options.signal.reason);
    };
    if (options.signal.aborted) {
      onAbort();
    } else {
      options.signal.addEventListener("abort", onAbort, { once: true });
    }
    // 直前の保持者が解放してから callback を実行する(= lock の取得)。
    const held = previous.then(() => {
      // 待機中に中断されていた場合は取得せず、callback も実行しない。
      if (aborted) return;
      // 取得後の中断は無視する(実 API と同じ)。
      options.signal.removeEventListener("abort", onAbort);
      // `callback()` の**同期 throw** を握らないと、例外が `.then` の外へ抜けて
      // `result` が永遠に settle しない(テストは失敗ではなくタイムアウトになる)。
      // 実 API は callback の例外で要求を reject するので、同期例外も拒否へ畳む。
      // `Promise.resolve().then(callback)` にしないのは、callback の呼び出しが
      // 1マイクロタスク遅れて実機と観測タイミングがずれるため。
      try {
        return Promise.resolve(callback()).then(settle, fail);
      } catch (error) {
        fail(error);
        return;
      }
    });
    // 次の待機者は「直前の保持者の解放 → この要求の callback 完了」まで待つ。
    // 中断された要求は lock を取得しないので、待ち行列だけを素通りさせる
    // (`result` に繋ぐと、中断した瞬間に後続が保持中の lock を追い越してしまう)。
    tails.set(
      name,
      held.then(
        () => undefined,
        () => undefined,
      ),
    );
    return result;
  };
}

/**
 * `navigator.locks` を差し替える。`request` を省略すると、lock 名ごとに直列化する
 * 既定実装(`createLockRequest`)を使う。
 */
export function stubWebLocks(
  request: StubLockRequest = createLockRequest(),
): void {
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: { request },
  });
}

/**
 * `stubWebLocks` の差し替えを元へ戻す。`descriptor` は差し替え前に
 * `Object.getOwnPropertyDescriptor(navigator, "locks")` で退避した値を渡す
 * (jsdom のように元々存在しない環境では `undefined` になり、プロパティごと削除する)。
 */
export function restoreWebLocks(
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) {
    Object.defineProperty(navigator, "locks", descriptor);
    return;
  }
  Reflect.deleteProperty(navigator, "locks");
}
