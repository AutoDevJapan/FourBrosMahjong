import { NextResponse, type NextRequest } from "next/server";
import {
  contentSecurityPolicy,
  STATIC_SECURITY_HEADERS,
} from "@/app/_lib/securityHeaders";

/**
 * Add a fresh nonce to both the request and response. Next.js reads the CSP
 * request header and automatically applies its nonce to framework scripts;
 * the layout reads x-nonce for the theme bootstrap.
 */
export function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const csp = contentSecurityPolicy(
    nonce,
    process.env.NODE_ENV !== "production",
  );
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set("Content-Security-Policy", csp);
  for (const [name, value] of Object.entries(STATIC_SECURITY_HEADERS)) {
    response.headers.set(name, value);
  }
  return response;
}

export const config = {
  matcher: [
    // HTML/app requests only. Immutable framework assets and image/font files
    // cannot execute in a top-level browsing context and need no per-request nonce.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
  ],
};
