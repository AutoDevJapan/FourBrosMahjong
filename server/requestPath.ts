/**
 * HTTP request-targetをroutingに使えるpathnameへ安全に正規化する。
 *
 * NodeのHTTP parserが受理するrequest-targetでも、WHATWG URLとして不正な
 * absolute-formは`new URL`が例外を投げる。request callbackから例外を漏らすと
 * プロセス全体が停止するため、不正値はHTTP 400へ変換できる`null`で返す。
 */
export function requestPath(rawUrl: string | undefined): string | null {
  // WHATWG URL treats a `//host/path` request-target as a network-path
  // reference and removes the authority from `pathname`. Keep it from
  // becoming an alias for a local exact route such as `/ws` or `/ops/status`.
  if (rawUrl?.startsWith("//")) return null;
  try {
    return new URL(rawUrl ?? "/", "http://localhost").pathname;
  } catch {
    return null;
  }
}
