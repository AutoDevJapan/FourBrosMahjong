import { expect, test } from "@playwright/test";

const HTML_ROUTES = [
  "/",
  "/game",
  "/game/result",
  "/rules",
  "/settings",
  "/history",
];

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
      expect(headers["x-content-type-options"]).toBe("nosniff");
      expect(headers["referrer-policy"]).toBe(
        "strict-origin-when-cross-origin",
      );
      expect(headers["permissions-policy"]).toContain("camera=()");
      expect(headers["x-frame-options"]).toBe("DENY");
    });
  }

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
