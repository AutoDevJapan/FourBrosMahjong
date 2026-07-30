import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * spec 5.2.6 は「**全ルート**は本文を単一の `<main>` に収める」と定めるが、その強制は
 * `e2e/a11y.spec.ts` の手書き配列 `LANDMARK_SCREENS` に依存している。ルートを新設しても
 * 配列へ足し忘れれば、規約から**無音で外れる**(Playwright は存在しない画面を教えてくれない)。
 *
 * ここでは `src/app/**\/page.tsx` から実ルートを導出し、ランドマーク監査の画面一覧と
 * 過不足なく一致することを固定する。ブラウザ不要の node テストなので `pnpm test` で回る。
 *
 * 同型の穴埋めとして `src/test/playwright-projects.test.ts`(testMatch の空振り)がある。
 */
const APP_DIR = resolve(process.cwd(), "src/app");
const A11Y_SPEC = resolve(process.cwd(), "e2e/a11y.spec.ts");

/** ランドマーク監査で 404 を指すために使う、実在しない番兵パス。 */
const NOT_FOUND_SCREEN_NAME = "404";

/**
 * App Router の `page.tsx` 群から公開ルートパスを導出する。
 *
 * ルートグループ `(name)` は URL に現れないので落とす。動的セグメント `[param]` は
 * 「監査すべき具体的な URL」を機械的に決められないため、**推測せず落とす** — 追加した
 * 時点でこのテストが失敗し、監査対象の決め方を明示的に更新させる。
 */
function appRoutes(): string[] {
  const pages = readdirSync(APP_DIR, { recursive: true, encoding: "utf8" })
    .map((entry) => entry.replaceAll("\\", "/"))
    .filter((entry) => entry === "page.tsx" || entry.endsWith("/page.tsx"));

  expect(pages.length, "src/app に page.tsx が 1 つも無い").toBeGreaterThan(0);

  return pages
    .map((entry) => {
      const segments = entry
        .slice(0, -"page.tsx".length)
        .split("/")
        .filter((segment) => segment !== "");

      for (const segment of segments) {
        expect(
          segment.startsWith("["),
          `動的セグメント ${segment} は未対応。監査対象の具体 URL を決めてこのテストを更新すること`,
        ).toBe(false);
      }

      const visible = segments.filter((segment) => !segment.startsWith("("));
      return visible.length === 0 ? "/" : `/${visible.join("/")}`;
    })
    .sort();
}

/** `e2e/a11y.spec.ts` の画面定義から `{ path, name }` を読み取る。 */
function landmarkScreens(): { path: string; name: string }[] {
  const source = readFileSync(A11Y_SPEC, "utf8");
  const entries = [
    ...source.matchAll(/path:\s*"([^"]+)",\s*name:\s*"([^"]+)"/g),
  ].map((match) => ({ path: match[1], name: match[2] }));

  expect(
    entries.length,
    "a11y.spec.ts から画面定義を 1 件も読み取れない(定義の書き方が変わった可能性)",
  ).toBeGreaterThan(0);
  return entries;
}

describe("ランドマーク監査の画面一覧(spec 5.2.6 / #409)", () => {
  it("実在する全ルートがランドマーク監査の対象に入っている", () => {
    const audited = new Set(
      landmarkScreens()
        .filter((screen) => screen.name !== NOT_FOUND_SCREEN_NAME)
        .map((screen) => screen.path),
    );

    for (const route of appRoutes()) {
      expect(
        audited.has(route),
        `${route} が e2e/a11y.spec.ts の監査対象に無い(spec 5.2.6 の「全ルート」から漏れる)`,
      ).toBe(true);
    }
  });

  it("監査対象に実在しないルートが残っていない(404 の番兵を除く)", () => {
    const routes = new Set(appRoutes());

    for (const screen of landmarkScreens()) {
      if (screen.name === NOT_FOUND_SCREEN_NAME) continue;
      expect(
        routes.has(screen.path),
        `${screen.path} に対応する page.tsx が無い(ルート削除時の消し忘れ)`,
      ).toBe(true);
    }
  });

  it("404(not-found.tsx)もランドマーク監査の対象に入っている", () => {
    const notFound = landmarkScreens().filter(
      (screen) => screen.name === NOT_FOUND_SCREEN_NAME,
    );
    expect(
      notFound,
      "not-found.tsx は独立実装で他ルートの規約が波及しないため、監査対象に必要",
    ).toHaveLength(1);
    expect(
      new Set(appRoutes()).has(notFound[0].path),
      `${notFound[0].path} は 404 を踏むための実在しないパスである必要がある`,
    ).toBe(false);
  });
});
