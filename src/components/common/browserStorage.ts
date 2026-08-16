/**
 * ブラウザ Storage への安全なアクセス。
 *
 * `localStorage` はサーバー(SSR)には存在せず、ブラウザでも Cookie/ストレージを
 * 無効化した環境では**プロパティの取得自体が** `SecurityError` を投げる。
 * どちらも「保存できないだけで機能は成立する」ケースなので、例外を投げずに
 * `null` を返し、呼び出し側がプログレッシブエンハンスメントとして扱えるようにする。
 *
 * 対局者名(`settings/playerNames.ts`)と戦績(`game/matchHistory.ts`)が
 * それぞれ同じヘルパーを持っていたため、ここへ集約した。
 */

/** `localStorage` を安全に取得する。SSR・Storage 無効環境(SecurityError)では null。 */
export function localStorageOrNull(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
