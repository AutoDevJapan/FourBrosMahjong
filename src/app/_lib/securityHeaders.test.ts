import { describe, expect, it } from "vitest";
import {
  contentSecurityPolicy,
  isLoopbackHttpRequest,
  onlineWebSocketConnectSource,
  STATIC_SECURITY_HEADERS,
  SVG_CONTENT_SECURITY_POLICY,
} from "./securityHeaders";

describe("contentSecurityPolicy", () => {
  it("productionではnonce付きscriptだけを信頼し、埋め込みと外部送信を制限する", () => {
    const policy = contentSecurityPolicy(
      "test-nonce",
      false,
      "https://four-bros-mahjong-online-production.up.railway.app/ws",
    );

    expect(policy).toContain(
      "script-src 'self' 'nonce-test-nonce' 'strict-dynamic'",
    );
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).not.toContain("script-src 'unsafe-inline'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(
      policy
        .split(";")
        .map((directive) => directive.trim())
        .find((directive) => directive.startsWith("connect-src ")),
    ).toBe(
      "connect-src 'self' wss://four-bros-mahjong-online-production.up.railway.app",
    );
    // /sw.js の取得経路を CSP 上で明示する(issue #292)。
    expect(policy).toContain("worker-src 'self'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("upgrade-insecure-requests");
  });

  it("接続先が未設定または不正なら外部のconnect-srcを追加しない", () => {
    expect(
      contentSecurityPolicy("test-nonce", false, undefined)
        .split(";")
        .map((directive) => directive.trim())
        .find((directive) => directive.startsWith("connect-src ")),
    ).toBe("connect-src 'self'");
    expect(
      contentSecurityPolicy("test-nonce", false, "javascript:alert(1)")
        .split(";")
        .map((directive) => directive.trim())
        .find((directive) => directive.startsWith("connect-src ")),
    ).toBe("connect-src 'self'");
    expect(
      contentSecurityPolicy(
        "test-nonce",
        false,
        "https://user:pass@example.com/ws",
      )
        .split(";")
        .map((directive) => directive.trim())
        .find((directive) => directive.startsWith("connect-src ")),
    ).toBe("connect-src 'self'");
  });

  it("本番と開発の接続先をWebSocket originへ正規化する", () => {
    expect(
      onlineWebSocketConnectSource(
        "HTTPS://FOUR-BROS-MAHJONG-ONLINE-PRODUCTION.UP.RAILWAY.APP/ws?token=demo",
        false,
      ),
    ).toBe("wss://four-bros-mahjong-online-production.up.railway.app");
    expect(onlineWebSocketConnectSource("ws://localhost:8080/ws", true)).toBe(
      "ws://localhost:8080",
    );
    expect(onlineWebSocketConnectSource(undefined, true)).toBe(
      "ws://localhost:8080",
    );
    expect(
      onlineWebSocketConnectSource("ws://insecure.example/ws", false),
    ).toBeNull();
    expect(onlineWebSocketConnectSource("not a URL", false)).toBeNull();
  });

  it("developmentだけNext.jsのソースマップ用evalを許可する", () => {
    const policy = contentSecurityPolicy("dev-nonce", true);

    expect(policy).toContain("'unsafe-eval'");
    expect(policy).not.toContain("upgrade-insecure-requests");
    expect(policy).toContain("connect-src 'self' ws://localhost:8080");
  });

  it("local production smokeだけupgrade-insecure-requestsを抑止し、他のproduction制約は維持する", () => {
    const policy = contentSecurityPolicy(
      "loopback-nonce",
      false,
      undefined,
      false,
    );

    expect(policy).toContain(
      "script-src 'self' 'nonce-loopback-nonce' 'strict-dynamic'",
    );
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).not.toContain("upgrade-insecure-requests");
    expect(policy).toContain("frame-ancestors 'none'");
  });
});

describe("isLoopbackHttpRequest", () => {
  it("recognizes only HTTP loopback hostnames", () => {
    for (const hostname of ["localhost", "127.0.0.1", "::1", "[::1]"]) {
      expect(isLoopbackHttpRequest("http:", hostname)).toBe(true);
    }

    expect(isLoopbackHttpRequest("https:", "localhost")).toBe(false);
    expect(isLoopbackHttpRequest("http:", "example.com")).toBe(false);
    expect(isLoopbackHttpRequest("http:", "127.0.0.1.example.com")).toBe(false);
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
