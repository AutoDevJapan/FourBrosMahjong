import { expect, type Locator, type Page } from "@playwright/test";

const CHARACTER_UI = [
  {
    playerId: "p0",
    portrait: "/characters/p0-soakuhin-portrait.avif",
  },
  { playerId: "p1", portrait: "/characters/p1-ryuji-portrait.avif" },
  { playerId: "p2", portrait: "/characters/p2-masaki-portrait.avif" },
  { playerId: "p3", portrait: "/characters/p3-hechima-portrait.avif" },
] as const;

/** 各可視surfaceの固定IDと原本由来portraitが同じ人物へ結線されていることを確認する。 */
export async function expectCharacterPortraits(
  root: Page | Locator,
  minimumSurfacesPerCharacter = 1,
): Promise<void> {
  for (const character of CHARACTER_UI) {
    const surfaces = root
      .locator(`[data-character-id="${character.playerId}"]`)
      .filter({ visible: true });
    await expect
      .poll(() => surfaces.count())
      .toBeGreaterThanOrEqual(minimumSurfacesPerCharacter);

    for (let index = 0; index < (await surfaces.count()); index++) {
      await expect(
        surfaces.nth(index).locator(`img[src="${character.portrait}"]`).first(),
      ).toBeVisible();
    }
  }
}
