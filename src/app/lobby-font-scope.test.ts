import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Issue #712 lobby font scope", () => {
  it("Yuji Syukuをroot layoutへ載せず、ロビーrouteだけで定義する", () => {
    const rootLayout = readFileSync("src/app/layout.tsx", "utf8");
    const lobbyPage = readFileSync("src/app/page.tsx", "utf8");

    expect(rootLayout).not.toContain("Yuji_Syuku");
    expect(rootLayout).not.toContain("--font-yuji-syuku");
    expect(lobbyPage).toContain(
      'import { Yuji_Syuku } from "next/font/google"',
    );
    expect(lobbyPage).toContain('variable: "--font-yuji-syuku"');
    expect(lobbyPage).toContain("fontVariableClassName={yujiSyuku.variable}");
  });
});
