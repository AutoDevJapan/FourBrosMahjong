/** Browser security policy shared by the request proxy and its regression tests. */

import { normalizeOnlineWebSocketUrl } from "../../lib/onlineWebSocket";

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
  const normalizedUrl = normalizeOnlineWebSocketUrl(configuredUrl, development);
  return normalizedUrl ? new URL(normalizedUrl).origin : null;
}

/**
 * Local production smoke servers intentionally use HTTP. WebKit applies
 * `upgrade-insecure-requests` to loopback subresources, which upgrades the
 * same-origin Next.js chunks to an HTTPS endpoint that does not exist. Keep
 * the exception narrowly scoped to the three loopback host spellings; every
 * deployed or non-loopback HTTP request still receives the production policy.
 */
export function isLoopbackHttpRequest(
  protocol: string,
  hostname: string,
): boolean {
  const normalizedHostname = hostname.toLowerCase();
  return (
    protocol === "http:" &&
    (normalizedHostname === "localhost" ||
      normalizedHostname === "127.0.0.1" ||
      normalizedHostname === "::1" ||
      normalizedHostname === "[::1]")
  );
}

export function contentSecurityPolicy(
  nonce: string,
  development: boolean,
  onlineWebSocketUrl = process.env.NEXT_PUBLIC_ONLINE_WS_URL,
  upgradeInsecureRequests = !development,
) {
  // `src/proxy.ts` supplies the loopback exception explicitly. Keep the
  // production-only directive disabled for every development origin too;
  // otherwise a LAN-accessible HTTP dev server upgrades its own assets to
  // HTTPS and cannot hydrate when the caller is not a loopback hostname.
  const shouldUpgradeInsecureRequests = !development && upgradeInsecureRequests;
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
    ...(shouldUpgradeInsecureRequests ? ["upgrade-insecure-requests"] : []),
  ];

  return directives.join("; ");
}
