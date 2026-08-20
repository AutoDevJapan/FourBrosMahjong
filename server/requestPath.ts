/**
 * HTTP request-targetをroutingに使えるpathnameへ安全に正規化する。
 *
 * NodeのHTTP parserが受理するrequest-targetでも、WHATWG URLとして不正な
 * absolute-formは`new URL`が例外を投げる。request callbackから例外を漏らすと
 * プロセス全体が停止するため、不正値はHTTP 400へ変換できる`null`で返す。
 */
export function requestPath(rawUrl: string | undefined): string | null {
  try {
    return new URL(rawUrl ?? "/", "http://localhost").pathname;
  } catch {
    return null;
  }
}
