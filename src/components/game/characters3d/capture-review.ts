/** Isolated Playwright proof; not the owner's Chrome. Retain work evidence. */

import { mkdir, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

async function main() {
  const r = createRequire(resolve("package.json")),
    { chromium } = r("@playwright/test");
  const output = resolve(process.env.CHARACTER_REVIEW_OUTPUT ?? ""),
    profile = resolve(process.env.CHARACTER_REVIEW_PROFILE ?? "");
  if (
    !process.env.CHARACTER_REVIEW_OUTPUT ||
    !process.env.CHARACTER_REVIEW_PROFILE
  )
    throw new Error(
      "Set CHARACTER_REVIEW_OUTPUT and an existing CHARACTER_REVIEW_PROFILE",
    );
  if (!(await stat(profile)).isDirectory())
    throw new Error("CHARACTER_REVIEW_PROFILE must be an existing directory");
  await mkdir(output, { recursive: true });
  const context = await chromium.launchPersistentContext(profile, {
    headless: true,
    viewport: { width: 1480, height: 1010 },
    deviceScaleFactor: 1,
    artifactsDir: output,
    downloadsPath: output,
    tracesDir: output,
    recordVideo: { dir: output, size: { width: 1480, height: 1060 } },
    args: [
      "--enable-unsafe-swiftshader",
      "--disable-gpu-sandbox",
      "--disable-crash-reporter",
      "--disable-breakpad",
    ],
  });
  const errors: string[] = [],
    telemetry = [];
  try {
    const page = await context.newPage();
    page.on("pageerror", (e: Error) => errors.push(e.message));
    page.on("console", (m: { type: () => string; text: () => string }) => {
      if (m.type() === "error") errors.push(m.text());
    });
    await page.goto("http://127.0.0.1:43196", { waitUntil: "networkidle" });
    await page.evaluate(() => window.characterReview.ready);
    for (const id of ["p0", "p1", "p2", "p3"] as const) {
      await page.evaluate(
        async ({ id }: { id: "p0" | "p1" | "p2" | "p3" }) => {
          await window.characterReview.setState(id, "seated-idle", 0);
          await Promise.all([...document.images].map((i) => i.decode()));
        },
        { id },
      );
      await page.screenshot({
        path: join(output, `${id}-front-side-back-table.png`),
        fullPage: true,
      });
      for (const clip of [
        "bench-idle",
        "draw",
        "declare",
        "call",
        "kita",
        "win-tsumo",
        "win-ron",
      ] as const) {
        await page.evaluate(
          async ({
            id,
            clip,
          }: {
            id: "p0" | "p1" | "p2" | "p3";
            clip:
              | "bench-idle"
              | "draw"
              | "declare"
              | "call"
              | "kita"
              | "win-tsumo"
              | "win-ron";
          }) => window.characterReview.setState(id, clip, 0.55),
          { id, clip },
        );
        telemetry.push(
          await page.evaluate(() => window.characterReview.telemetry()),
        );
        if (clip === "win-tsumo" || clip === "draw" || clip === "call")
          await page.screenshot({
            path: join(output, `${id}-${clip}.png`),
            fullPage: true,
          });
        if (clip !== "bench-idle") {
          await page.locator("#clip").selectOption(clip);
          await page.locator("#restart").click();
          await page.locator("#play").click();
          await page.waitForFunction(
            () =>
              (window.characterReview.telemetry() as { finished: boolean })
                .finished === true,
          );
          await page.locator("#play").click();
          telemetry.push(
            await page.evaluate(() => window.characterReview.telemetry()),
          );
        }
      }
    }
    // Exercise actual controls and verify time advances then stops.
    await page.locator("#actor").selectOption("p2");
    await page.locator("#clip").selectOption("declare");
    await page.locator("#play").click();
    await page.waitForFunction(
      () =>
        (window.characterReview.telemetry() as { time: number }).time > 0.15,
    );
    await page.locator("#play").click();
    const final = await page.evaluate(() => window.characterReview.telemetry());
    await page.locator("#reduced").check();
    await page.locator("#restart").click();
    telemetry.push(final);
    await page.evaluate(() => window.characterReview.dispose());
    telemetry.push(
      await page.evaluate(() => window.characterReview.telemetry()),
    );
    const video = page.video();
    await page.close();
    if (video)
      await video.saveAs(join(output, "four-characters-rig-clips.webm"));
    await writeFile(
      join(output, "verification.json"),
      JSON.stringify(
        {
          at: new Date().toISOString(),
          browser: "isolated Chromium / installed Playwright version",
          status: errors.length ? "failed" : "passed",
          errors,
          telemetry,
          limitations: [
            "review viewer; production renderer not connected",
            "software WebGL2 via SwiftShader; hardware performance not measured",
            "not owner appearance approval",
            "not independent review",
          ],
        },
        null,
        2,
      ) + "\n",
    );
    if (errors.length) throw new Error(errors.join("\n"));
    console.log(JSON.stringify({ output, screenshots: 16, errors: 0 }));
  } finally {
    await context.close();
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
