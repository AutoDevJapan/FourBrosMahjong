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
  // WHATWG URL also treats backslashes as forward slashes for special schemes.
  // That makes origin-form inputs such as `/\\evil/ws` or `/foo\\..\\ws`
  // normalize to `/ws`, even though the raw request-target did not address
  // that exact route. No supported endpoint contains a backslash, so reject
  // the ambiguous form before URL normalization can erase the distinction.
  if (rawUrl?.includes("\\")) return null;
  // WHATWG URL also removes dot segments, including their percent-encoded
  // forms. Reject them from the raw request-target so `/prefix/../ops/status`
  // cannot become an alias for the private exact `/ops/status` route.
  if (rawUrl !== undefined && hasDotSegment(rawUrl)) return null;
  try {
    return new URL(rawUrl ?? "/", "http://localhost").pathname;
  } catch {
    return null;
  }
}

function hasDotSegment(rawUrl: string): boolean {
  const target = rawUrl.split(/[?#]/u, 1)[0] ?? "";
  let path = target;
  if (!target.startsWith("/")) {
    const schemeSeparator = target.indexOf(":");
    if (schemeSeparator === -1) {
      path = target;
    } else {
      const afterScheme = target.slice(schemeSeparator + 1);
      if (!afterScheme.startsWith("//")) {
        path = afterScheme;
      } else {
        const authorityEnd = afterScheme.indexOf("/", 2);
        path = authorityEnd === -1 ? "" : afterScheme.slice(authorityEnd);
      }
    }
  }

  return path.split("/").some((segment) => {
    try {
      const decoded = decodeURIComponent(segment);
      return decoded === "." || decoded === "..";
    } catch {
      // Malformed escapes are rejected by the URL parser below when possible;
      // this helper only needs to identify aliases that decode to dot segments.
      return false;
    }
  });
}
