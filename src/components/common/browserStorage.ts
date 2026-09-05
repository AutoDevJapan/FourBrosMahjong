/**
 * ブラウザ Storage への安全なアクセス。
 *
 * `localStorage` はサーバー(SSR)には存在せず、ブラウザでも Cookie/ストレージを
 * 無効化した環境ではプロパティの取得や読み取り自体が `SecurityError` を投げる。
 * どちらも「保存できないだけで機能は成立する」ケースなので、例外を投げずに
 * `null` を返し、呼び出し側がプログレッシブエンハンスメントとして扱えるようにする。
 *
 * 対局者名(`settings/playerNames.ts`)と戦績(`game/matchHistory.ts`)が
 * それぞれ同じヘルパーを持っていたため、ここへ集約した。
 */

/** Storage の可用性確認に使う、データを変更しない読み取りキー。 */
const STORAGE_PROBE_KEY = "four-bros-mahjong.storage-probe";

/**
 * `localStorage` を安全に取得する。
 *
 * Storage のプロパティ取得が成功しても、プライバシー設定やサンドボックスの
 * 制約によりメソッド呼び出しだけが失敗するブラウザがある。書き込みプローブは
 * ユーザーデータを変更し得るため、存在しないキーの読み取りだけを確認する。
 */
export function localStorageOrNull(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    const storage = window.localStorage;
    storage.getItem(STORAGE_PROBE_KEY);
    return storage;
  } catch {
    return null;
  }
}
