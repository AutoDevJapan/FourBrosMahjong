import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Issue #712 Game route design scope", () => {
  it("Game固有styleとYuji Syukuを/game pageだけから読む", () => {
    const globals = readFileSync("src/app/globals.css", "utf8");
    const gamePage = readFileSync("src/app/game/page.tsx", "utf8");
    const gameLayout = readFileSync("src/app/game/layout.tsx", "utf8");
    const gameStyles = readFileSync("src/app/game/game.css", "utf8");

    expect(globals).not.toContain(".game-page");
    expect(gameLayout).not.toContain("game.css");
    expect(gamePage).toContain('import "./game.css"');
    expect(gamePage).toContain('import { Yuji_Syuku } from "next/font/google"');
    expect(gamePage).toContain('variable: "--font-yuji-syuku"');
    expect(gamePage).toContain('weight: "400"');
    expect(gamePage).toContain("preload: false");
    expect(gameStyles).toContain(".game-board-cross");
    expect(gameStyles).toContain(".game-focus-board");
    expect(gameStyles).toContain("@media (forced-colors: active)");
    expect(gameStyles).not.toContain("url(");
  });

  it("client遷移後にCSSが残っても共有GameBoardへscope外selectorを適用しない", () => {
    const gameStyles = readFileSync("src/app/game/game.css", "utf8").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    const ruleHeads: string[] = [];
    let start = 0;
    for (let index = 0; index < gameStyles.length; index += 1) {
      const token = gameStyles[index];
      if (token === "{") {
        const head = gameStyles.slice(start, index).trim();
        if (!head.startsWith("@")) ruleHeads.push(head);
      }
      if (token === "{" || token === "}" || token === ";") start = index + 1;
    }

    const unsafeSelectors = ruleHeads
      .flatMap((head) => head.split(","))
      .map((selector) => selector.trim())
      .filter((selector) => selector.includes(".game-"))
      .filter(
        (selector) =>
          !selector.startsWith(".game-page") &&
          !selector.startsWith(".game-full-board-modal"),
      );

    expect(unsafeSelectors).toEqual([]);
  });
});
