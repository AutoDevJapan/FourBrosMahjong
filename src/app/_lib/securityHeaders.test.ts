import { describe, expect, it } from "vitest";
import {
  contentSecurityPolicy,
  STATIC_SECURITY_HEADERS,
  SVG_CONTENT_SECURITY_POLICY,
} from "./securityHeaders";

describe("contentSecurityPolicy", () => {
  it("productionではnonce付きscriptだけを信頼し、埋め込みと外部送信を制限する", () => {
    const policy = contentSecurityPolicy("test-nonce", false);

    expect(policy).toContain(
      "script-src 'self' 'nonce-test-nonce' 'strict-dynamic'",
    );
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).not.toContain("script-src 'unsafe-inline'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("connect-src 'self'");
    // /sw.js の取得経路を CSP 上で明示する(issue #292)。
    expect(policy).toContain("worker-src 'self'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("upgrade-insecure-requests");
  });

  it("developmentだけNext.jsのソースマップ用evalを許可する", () => {
    const policy = contentSecurityPolicy("dev-nonce", true);

    expect(policy).toContain("'unsafe-eval'");
    expect(policy).not.toContain("upgrade-insecure-requests");
  });
});

describe("static security headers", () => {
  it("sniffing・referrer・権限・frame埋め込みを制限する", () => {
    expect(STATIC_SECURITY_HEADERS).toMatchObject({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Frame-Options": "DENY",
    });
    expect(STATIC_SECURITY_HEADERS["Permissions-Policy"]).toContain(
      "camera=()",
    );
  });

  it("直接開かれたSVG documentの能動的な機能を無効化する", () => {
    expect(SVG_CONTENT_SECURITY_POLICY).toContain("default-src 'none'");
    expect(SVG_CONTENT_SECURITY_POLICY).toContain("style-src 'unsafe-inline'");
    expect(SVG_CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'");
    expect(SVG_CONTENT_SECURITY_POLICY).toContain("sandbox");
    expect(SVG_CONTENT_SECURITY_POLICY).not.toContain("nonce-");
  });
});
