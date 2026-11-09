import { expect, test } from "@playwright/test";
import { advanceUntil } from "./helpers/gameDriver";

test("通常対局でWebGL盤面が起動し、打牌・復元・context lossを通過する", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/game?seed=1");
  const canvas = page.locator(".game-table-3d-canvas");
  await expect(page.locator(".game-table-3d")).toHaveAttribute(
    "data-3d-status",
    "ready",
  );
  const pixels = await canvas.evaluate((element: HTMLCanvasElement) => {
    const gl = element.getContext("webgl2");
    if (!gl) throw new Error("No WebGL2 rendering context");
    return {
      width: gl.drawingBufferWidth,
      height: gl.drawingBufferHeight,
      error: gl.getError(),
    };
  });
  expect(pixels.width).toBeGreaterThan(0);
  expect(pixels.height).toBeGreaterThan(0);
  expect(pixels.error).toBe(0);
  await page.screenshot({
    path: testInfo.outputPath("live-3d-initial.png"),
    fullPage: true,
  });
  const before = await page
    .locator('[data-testid="remaining-live-tiles"] dd')
    .first()
    .textContent();
  const hand = page.getByRole("listbox", { name: "自家の手牌" });
  await hand.getByRole("option").first().focus();
  await hand.getByRole("option").first().press("Enter");
  await expect(
    page.locator('[data-testid="remaining-live-tiles"] dd').first(),
  ).not.toHaveText(before ?? "");
  const after = await page
    .locator('[data-testid="remaining-live-tiles"] dd')
    .first()
    .textContent();
  await page.goto("/game");
  await page.reload();
  await expect(page.locator(".game-table-3d")).toHaveAttribute(
    "data-3d-status",
    "ready",
  );
  await expect(
    page.locator('[data-testid="remaining-live-tiles"] dd').first(),
  ).toHaveText(after ?? "");
  await canvas.evaluate((element: HTMLCanvasElement) => {
    const gl = element.getContext("webgl2");
    const extension = gl?.getExtension("WEBGL_lose_context");
    if (!extension)
      throw new Error("WebGL context-loss test extension unavailable");
    extension.loseContext();
  });
  await expect(
    page.getByRole("status").filter({ hasText: "2D" }),
  ).toBeVisible();
  await expect(
    page.getByRole("list", { name: "自家の手牌", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator('[data-testid="remaining-live-tiles"] dd').first(),
  ).toHaveText(after ?? "");
  expect(errors).toEqual([]);
});

test("3D手牌はポインターで選んだ後に一度だけ確定する", async ({ page }) => {
  await page.goto("/game?seed=1");
  await expect(page.locator(".game-table-3d")).toHaveAttribute(
    "data-3d-status",
    "ready",
  );
  const canvas = page.locator(".game-table-3d-canvas");
  const before = await page
    .locator('[data-testid="remaining-live-tiles"] dd')
    .first()
    .textContent();
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("3D canvas has no bounds");
  await canvas.click({
    position: { x: bounds.width * 0.3, y: bounds.height * 0.87 },
  });
  await expect(page.getByRole("button", { name: /を打牌/ })).toBeVisible();
  await expect(
    page.locator('[data-testid="remaining-live-tiles"] dd').first(),
  ).toHaveText(before ?? "");
  await page.getByRole("button", { name: /を打牌/ }).click();
  await expect(page.getByRole("button", { name: /を打牌/ })).toHaveCount(0);
  await expect(
    page.locator('[data-testid="remaining-live-tiles"] dd').first(),
  ).not.toHaveText(before ?? "");
});

test("darkの実対局と全席回転から結果・戦績へ進む", async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(() => localStorage.setItem("theme", "dark"));
  await page.goto("/game?seed=106");
  await expect(page.locator(".game-table-3d")).toHaveAttribute(
    "data-3d-status",
    "ready",
  );
  await advanceUntil(page, (state) => state?.phase === "roundEnd", {
    maxSteps: 100,
    onRoundEnd: "stop",
  });
  await page.screenshot({
    path: testInfo.outputPath("live-3d-dark-round-end.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "次の局へ" })
    .filter({ visible: true })
    .first()
    .click();
  await expect(
    page
      .getByRole("region", { name: "粗悪品(あなた・抜け番)" })
      .filter({ visible: true })
      .first(),
  ).toHaveAttribute("data-character-id", "p0");
  await advanceUntil(
    page,
    () => new URL(page.url()).pathname === "/game/result",
    { maxSteps: 200 },
  );
  await expect(
    page.getByRole("heading", { name: "半荘終了", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: /戦績/ }).first().click();
  await expect(page).toHaveURL(/\/history$/);
  await expect(
    page.getByRole("heading", { level: 1, name: /戦績/ }),
  ).toBeVisible();
});

test("320pxでも同じ対局状態を描画し、横にはみ出さない", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/game?seed=1");
  await expect(page.locator(".game-table-3d")).toHaveAttribute(
    "data-3d-status",
    "ready",
  );
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320);
  await expect(page.getByRole("button", { name: "全体盤面" })).toBeVisible();
  await expect(
    page.getByRole("listbox", { name: "自家の手牌" }).filter({ visible: true }),
  ).toHaveCount(1);
  const glossary = page.getByRole("button", { name: "対局中の用語を見る" });
  await expect(glossary).toHaveCount(1);
  await glossary.scrollIntoViewIfNeeded();
  const hit = await glossary.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return element.contains(
      document.elementFromPoint(
        rect.x + rect.width / 2,
        rect.y + rect.height / 2,
      ),
    );
  });
  expect(hit).toBe(true);
  await glossary.click();
  await expect(
    page.getByRole("dialog", { name: "対局中の用語" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(glossary).toBeFocused();
  await page.screenshot({
    path: testInfo.outputPath("live-3d-320px.png"),
    fullPage: true,
  });
});

for (const width of [320, 393, 700, 1280]) {
  test(`${width}pxで局情報がドラ牌を覆わない`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/game?seed=1");
    await expect(page.locator(".game-table-3d")).toHaveAttribute(
      "data-3d-status",
      "ready",
    );
    const canvas = await page.locator(".game-table-3d-canvas").boundingBox();
    const info = await page.locator(".game-table-3d-info").boundingBox();
    if (!canvas || !info) throw new Error("Missing live table geometry");
    expect(info.y).toBeGreaterThanOrEqual(canvas.y + canvas.height);
    expect(info.x).toBeGreaterThanOrEqual(0);
    expect(info.x + info.width).toBeLessThanOrEqual(width);
    await expect(page.locator(".game-table-3d-info")).toContainText("東1局");
    await expect(page.locator(".game-table-3d-info")).toContainText("残り山");
  });
}
