/** Browser security policy shared by the request proxy and its regression tests. */

export const STATIC_SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  // frame-ancestors is the authoritative control; DENY retains protection in
  // older clients which do not implement that CSP directive.
  "X-Frame-Options": "DENY",
} as const;

/**
 * SVG is inert when embedded as an image, but becomes an active document when
 * opened directly. Keep this policy stable so public SVG assets remain
 * cacheable instead of sending them through the per-request nonce proxy.
 * Inline styles are required by the bundled tile artwork.
 */
export const SVG_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "sandbox",
].join("; ");

/**
 * Create a per-response CSP. The nonce makes the small theme bootstrap and
 * Next.js' own inline runtime scripts executable without allowing arbitrary
 * inline JavaScript. `strict-dynamic` lets those trusted runtime scripts load
 * the hashed application chunks they reference.
 */
export function onlineWebSocketConnectSource(
  configuredUrl: string | undefined,
  development: boolean,
): string | null {
  const value =
    configuredUrl?.trim() || (development ? "ws://localhost:8080/ws" : "");
  if (!value) return null;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  if (parsed.username || parsed.password) return null;

  const protocol =
    parsed.protocol === "http:"
      ? "ws:"
      : parsed.protocol === "https:"
        ? "wss:"
        : parsed.protocol === "ws:" || parsed.protocol === "wss:"
          ? parsed.protocol
          : null;
  if (!protocol) return null;
  // Production Vercel pages are HTTPS; do not turn a misconfigured insecure
  // endpoint into an allowed mixed-content WebSocket destination.
  if (!development && protocol === "ws:") return null;

  // CSP only needs the endpoint origin. The configured path is intentionally
  // omitted so both `/ws` and an explicitly configured reverse-proxy path work
  // without widening the allowed scheme or host.
  return `${protocol}//${parsed.host}`;
}

export function contentSecurityPolicy(
  nonce: string,
  development: boolean,
  onlineWebSocketUrl = process.env.NEXT_PUBLIC_ONLINE_WS_URL,
) {
  const onlineWebSocketSource = onlineWebSocketConnectSource(
    onlineWebSocketUrl,
    development,
  );
  const connectSources = [
    "'self'",
    ...(onlineWebSocketSource ? [onlineWebSocketSource] : []),
  ];
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    // Next.js and Tailwind currently emit inline style attributes. Script is
    // nonce-restricted independently, so this exception does not enable JS.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${connectSources.join(" ")}`,
    "manifest-src 'self'",
    // service worker(/sw.js)の取得を明示的に許可する。worker-src を省くと
    // child-src → default-src へフォールバックし、ブラウザによって挙動が変わる
    // (script-src の 'strict-dynamic' が波及して取得が阻まれる実装もある)。
    // 明示することで登録経路を CSP 上で確定させる。
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(development ? [] : ["upgrade-insecure-requests"]),
  ];

  return directives.join("; ");
}
