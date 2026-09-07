import { expect, test } from "@playwright/test";

const SITE_URL = "https://four-bros-mahjong.vercel.app";
const IMAGE_URL = `${SITE_URL}/icons/icon-512`;

const pages = [
  { path: "/", title: "四兄弟麻雀 - FourBrosMahjong" },
  { path: "/rules", title: "ルール説明 | 四兄弟麻雀" },
  { path: "/settings", title: "設定 | 四兄弟麻雀" },
  { path: "/history", title: "戦績 | 四兄弟麻雀" },
  { path: "/online", title: "オンライン対戦 | 四兄弟麻雀" },
  // Navigationには含めない検証用ページも、実在するApp Router routeとしてmetadataを持つ。
  {
    path: "/prototype/unity-display",
    title: "Unity表示リファレンス | 四兄弟麻雀",
  },
  { path: "/game", title: "対局 | 四兄弟麻雀" },
  { path: "/game/result", title: "対局結果 | 四兄弟麻雀" },
] as const;

test.describe("metadata / routing", () => {
  for (const item of pages) {
    test(`${item.path} は固有canonical・OGP・Twitter Cardを持つ`, async ({
      page,
    }) => {
      const canonicalUrl =
        item.path === "/" ? SITE_URL : `${SITE_URL}${item.path}`;
      const response = await page.goto(item.path);
      expect(response?.status()).toBe(200);
      await expect(page).toHaveTitle(item.title);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
        "href",
        canonicalUrl,
      );
      await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
        "content",
        item.title,
      );
      await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
        "content",
        canonicalUrl,
      );
      await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
        "content",
        IMAGE_URL,
      );
      await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
        "content",
        "summary",
      );
      await expect(page.locator('meta[name="twitter:title"]')).toHaveAttribute(
        "content",
        item.title,
      );
      await expect(page.locator('meta[name="twitter:image"]')).toHaveAttribute(
        "content",
        IMAGE_URL,
      );
    });
  }

  test("OG画像は宣言寸法・MIMEのPNGとして到達できる", async ({
    page,
    request,
  }) => {
    const response = await request.get("/icons/icon-512");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("image/png");
    expect((await response.body()).byteLength).toBeGreaterThan(0);
    await page.goto("/");
    const dimensions = await page.evaluate(async (src) => {
      const image = new Image();
      image.src = src;
      await image.decode();
      return { width: image.naturalWidth, height: image.naturalHeight };
    }, "/icons/icon-512");
    expect(dimensions).toEqual({ width: 512, height: 512 });
  });

  test("未知のURLは日本語404と復帰導線をportrait・印刷表示でも維持する", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const response = await page.goto("/does-not-exist");
    expect(response?.status()).toBe(404);
    await expect(page.locator("html")).toHaveAttribute("lang", "ja");
    await expect(page).toHaveTitle("ページが見つかりません | 四兄弟麻雀");
    await expect(
      page.getByRole("heading", { name: "ページが見つかりません" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "ロビーへ戻る" }),
    ).toHaveAttribute("href", "/");
    await expect(
      page.getByRole("link", { name: "ルールを見る" }),
    ).toHaveAttribute("href", "/rules");
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);

    await page.emulateMedia({ media: "print" });
    await expect(
      page.getByRole("heading", { name: "ページが見つかりません" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "ロビーへ戻る" }),
    ).toBeVisible();
  });
});
