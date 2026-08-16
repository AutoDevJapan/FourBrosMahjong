import { expect, test } from "@playwright/test";
import { onlineWebSocketConnectSource } from "../src/app/_lib/securityHeaders";
import { e2eServerMode } from "./serverMode";

const HTML_ROUTES = [
  "/",
  "/game",
  "/game/result",
  "/rules",
  "/settings",
  "/history",
  "/online",
];
const PRODUCTION_ONLINE_WEBSOCKET_SOURCE =
  "wss://four-bros-mahjong-online-production.up.railway.app";

function connectSourceDirective(csp: string): string | undefined {
  return csp
    .split(";")
    .map((directive) => directive.trim())
    .find((directive) => directive.startsWith("connect-src "));
}

test.describe("browser security headers", () => {
  for (const route of HTML_ROUTES) {
    test(`${route} はCSPと共通防御ヘッダーを返す`, async ({ request }) => {
      const response = await request.get(route);
      const headers = response.headers();

      expect(response.ok()).toBe(true);
      expect(headers["content-security-policy"]).toContain(
        "frame-ancestors 'none'",
      );
      expect(headers["content-security-policy"]).toMatch(
        /script-src 'self' 'nonce-[^']+' 'strict-dynamic'/,
      );
      // service worker(/sw.js)登録の許可(issue #292)。
      expect(headers["content-security-policy"]).toContain("worker-src 'self'");
      expect(headers["x-content-type-options"]).toBe("nosniff");
      expect(headers["referrer-policy"]).toBe(
        "strict-origin-when-cross-origin",
      );
      expect(headers["permissions-policy"]).toContain("camera=()");
      expect(headers["x-frame-options"]).toBe("DENY");
    });
  }

  test("設定済みのオンラインWebSocket originだけをconnect-srcに許可する", async ({
    request,
  }) => {
    const response = await request.get("/online");
    const csp = response.headers()["content-security-policy"];
    const development = e2eServerMode() === "development";
    const source = onlineWebSocketConnectSource(
      process.env.NEXT_PUBLIC_ONLINE_WS_URL,
      development,
    );
    expect(response.ok()).toBe(true);
    expect(connectSourceDirective(csp)).toBe(
      source ? `connect-src 'self' ${source}` : "connect-src 'self'",
    );
  });

  test("本番想定のWebSocket originをconnect-srcへ固定して許可する", async ({
    request,
  }) => {
    test.skip(e2eServerMode() !== "production", "production server mode only");

    const response = await request.get("/online");
    const csp = response.headers()["content-security-policy"];

    expect(response.ok()).toBe(true);
    expect(connectSourceDirective(csp)).toBe(
      `connect-src 'self' ${PRODUCTION_ONLINE_WEBSOCKET_SOURCE}`,
    );
  });

  for (const route of ["/icon.svg", "/tiles/Pin1.svg"]) {
    test(`${route} はcache可能なSVG専用ポリシーを返す`, async ({ request }) => {
      const response = await request.get(route);
      const headers = response.headers();

      expect(response.ok()).toBe(true);
      expect(headers["content-type"]).toContain("image/svg+xml");
      expect(headers["content-security-policy"]).toContain(
        "default-src 'none'",
      );
      expect(headers["content-security-policy"]).toContain(
        "frame-ancestors 'none'",
      );
      expect(headers["content-security-policy"]).toContain("sandbox");
      expect(headers["content-security-policy"]).not.toContain("nonce-");
      expect(headers["x-content-type-options"]).toBe("nosniff");
      expect(headers["x-frame-options"]).toBe("DENY");
    });
  }

  test("nonce CSP下でテーマ初期化とNext.js hydrationが動作する", async ({
    page,
  }) => {
    const cspErrors: string[] = [];
    page.on("console", (message) => {
      if (/content security policy/i.test(message.text())) {
        cspErrors.push(message.text());
      }
    });
    await page.addInitScript(() => localStorage.setItem("theme", "dark"));

    await page.goto("/settings");

    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.getByRole("heading", { name: "設定" })).toBeVisible();
    expect(cspErrors).toEqual([]);
  });
});
