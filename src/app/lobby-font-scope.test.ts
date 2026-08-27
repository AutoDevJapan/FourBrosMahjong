import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Issue #712 design route scope", () => {
  it("Yuji Syukuをroot layoutへ載せず、刷新済みrouteだけで定義する", () => {
    const rootLayout = readFileSync("src/app/layout.tsx", "utf8");
    const lobbyPage = readFileSync("src/app/page.tsx", "utf8");
    const settingsPage = readFileSync("src/app/settings/page.tsx", "utf8");
    const rulesPage = readFileSync("src/app/rules/page.tsx", "utf8");
    const gamePage = readFileSync("src/app/game/page.tsx", "utf8");
    const resultPage = readFileSync("src/app/game/result/page.tsx", "utf8");

    expect(rootLayout).not.toContain("Yuji_Syuku");
    expect(rootLayout).not.toContain("--font-yuji-syuku");
    expect(lobbyPage).toContain(
      'import { Yuji_Syuku } from "next/font/google"',
    );
    expect(lobbyPage).toContain('variable: "--font-yuji-syuku"');
    expect(lobbyPage).toContain("fontVariableClassName={yujiSyuku.variable}");
    expect(settingsPage).toContain(
      'import { Yuji_Syuku } from "next/font/google"',
    );
    expect(settingsPage).toContain('variable: "--font-yuji-syuku"');
    expect(settingsPage).toContain("preload: false");
    expect(settingsPage).toContain("${yujiSyuku.variable}");
    expect(rulesPage).toContain(
      'import { Yuji_Syuku } from "next/font/google"',
    );
    expect(rulesPage).toContain('variable: "--font-yuji-syuku"');
    expect(rulesPage).toContain('weight: "400"');
    expect(rulesPage).toContain("preload: false");
    expect(rulesPage).toContain("fontVariableClassName={yujiSyuku.variable}");
    expect(gamePage).toContain('import { Yuji_Syuku } from "next/font/google"');
    expect(gamePage).toContain('variable: "--font-yuji-syuku"');
    expect(gamePage).toContain('weight: "400"');
    expect(gamePage).toContain("preload: false");
    expect(gamePage).toContain("${yujiSyuku.variable}");
    expect(resultPage).toContain(
      'import { Yuji_Syuku } from "next/font/google"',
    );
    expect(resultPage).toContain('variable: "--font-yuji-syuku"');
    expect(resultPage).toContain('weight: "400"');
    expect(resultPage).toContain("preload: false");
    expect(resultPage).toContain("fontVariableClassName={yujiSyuku.variable}");
  });

  it("settings固有styleをroot stylesheetへ載せず、settings routeだけから読む", () => {
    const globals = readFileSync("src/app/globals.css", "utf8");
    const settingsLayout = readFileSync("src/app/settings/layout.tsx", "utf8");
    const settingsStyles = readFileSync(
      "src/app/settings/settings.css",
      "utf8",
    );

    expect(globals).not.toContain(".settings-");
    expect(settingsLayout).toContain('import "./settings.css"');
    expect(settingsStyles).toContain(".settings-main");
    expect(settingsStyles).toContain(".settings-theme-option");
    expect(settingsStyles).toContain(".settings-name-card");
    expect(settingsStyles).toContain("--settings-control-border");
    expect(settingsStyles).toContain("@media (forced-colors: active)");
  });
});
