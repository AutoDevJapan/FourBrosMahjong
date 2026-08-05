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
 */

/** `navigator.locks.request` のうち、テストが必要とする最小形。 */
export type StubLockRequest = (
  name: string,
  callback: () => unknown,
) => Promise<unknown>;

const defaultRequest: StubLockRequest = async (_name, callback) => callback();

/**
 * `navigator.locks` を差し替える。`request` を省略すると、排他せず callback を
 * そのまま実行する(単一タブ相当)。
 */
export function stubWebLocks(request: StubLockRequest = defaultRequest): void {
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
