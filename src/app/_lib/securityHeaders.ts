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
 * Create a per-response CSP. The nonce makes the small theme bootstrap and
 * Next.js' own inline runtime scripts executable without allowing arbitrary
 * inline JavaScript. `strict-dynamic` lets those trusted runtime scripts load
 * the hashed application chunks they reference.
 */
export function contentSecurityPolicy(nonce: string, development: boolean) {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    // Next.js and Tailwind currently emit inline style attributes. Script is
    // nonce-restricted independently, so this exception does not enable JS.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(development ? [] : ["upgrade-insecure-requests"]),
  ];

  return directives.join("; ");
}
