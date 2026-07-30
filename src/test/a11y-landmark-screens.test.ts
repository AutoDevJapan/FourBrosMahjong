import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { LANDMARK_SCREENS, NOT_FOUND_SCREEN_NAME } from "../../e2e/screens";

/**
 * spec 5.2.6 は「**全ルート**は本文を単一の `<main>` に収める」と定めるが、その強制は
 * `e2e/a11y.spec.ts` が回す画面一覧に依存している。ルートを新設しても一覧へ足し忘れれば、
 * 規約から**無音で外れる**(Playwright は存在しない画面を教えてくれない)。
 *
 * ここでは `src/app/**\/page.tsx` から実ルートを導出し、ランドマーク監査の画面一覧と
 * 過不足なく一致することを固定する。ブラウザ不要の node テストなので `pnpm test` で回る。
 *
 * 一覧は `e2e/screens.ts` から**実体を import** する(ソースの文字列走査ではない)。
 * 走査だとエントリをコメントアウトされても素通りしてしまい、この検査自体が無音化する。
 *
 * 同型の穴埋めとして `src/test/playwright-projects.test.ts`(testMatch の空振り)がある。
 */
const APP_DIR = resolve(process.cwd(), "src/app");

/**
 * App Router がページとして解釈するファイル名。
 *
 * `.tsx` だけを見ると、`page.jsx` / `page.js` で足されたルートが**この検査をすり抜ける**
 * (このテストが塞ごうとしている失敗モードそのもの)。拡張子は Next.js が受け付ける形を
 * 網羅する。先頭の `/` ごと消してディレクトリ部分だけを残す。
 */
const PAGE_FILE = /(?:^|\/)page\.(?:tsx|ts|jsx|js|mjs|cjs)$/;

/**
 * App Router のページファイル群から公開ルートパスを導出する。
 *
 * - ルートグループ `(name)` は URL に現れないのでセグメントごと落とす
 * - プライベートフォルダ `_name` 配下は**ルーティングされない**ので**エントリごと**除外する
 *   (セグメントだけ落とすと `_drafts/preview/page.tsx` が `/preview` に化ける)
 *
 * 一方、**監査すべき具体的な URL を機械的に決められない**形は推測せず落とす:
 * - 動的セグメント `[param]`
 * - パラレルルート `@slot`(スロットは単独の URL を持たない)
 *
 * 追加した時点でこのテストが失敗し、監査対象の決め方を明示的に更新させる。
 */
function appRoutes(): string[] {
  const pages = readdirSync(APP_DIR, { recursive: true, encoding: "utf8" })
    .map((entry) => entry.replaceAll("\\", "/"))
    .filter((entry) => PAGE_FILE.test(entry));

  expect(
    pages.length,
    "src/app にページファイルが 1 つも無い(PAGE_FILE の想定が崩れた可能性)",
  ).toBeGreaterThan(0);

  const routes: string[] = [];
  for (const entry of pages) {
    const segments = entry
      .replace(PAGE_FILE, "")
      .split("/")
      .filter((segment) => segment !== "");

    for (const segment of segments) {
      expect(
        segment.startsWith("[") || segment.startsWith("@"),
        `${entry}: 動的セグメント/パラレルルート ${segment} は未対応。監査対象の具体 URL を決めてこのテストを更新すること`,
      ).toBe(false);
    }

    // プライベートフォルダ配下はルートを持たない。
    if (segments.some((segment) => segment.startsWith("_"))) continue;

    const visible = segments.filter((segment) => !segment.startsWith("("));
    routes.push(visible.length === 0 ? "/" : `/${visible.join("/")}`);
  }

  return routes.sort();
}

/** ランドマーク監査の対象のうち、実在ルートを指すもの(404 の番兵を除く)。 */
function auditedRoutes(): string[] {
  return LANDMARK_SCREENS.filter(
    (screen) => screen.name !== NOT_FOUND_SCREEN_NAME,
  ).map((screen) => screen.path);
}

describe("ランドマーク監査の画面一覧(spec 5.2.6 / #409)", () => {
  it("実在する全ルートがランドマーク監査の対象に入っている", () => {
    const audited = new Set(auditedRoutes());
    const routes = appRoutes();

    expect(routes.length, "ルートを 1 件も導出できていない").toBeGreaterThan(0);
    for (const route of routes) {
      expect(
        audited.has(route),
        `${route} が e2e/screens.ts の監査対象に無い(spec 5.2.6 の「全ルート」から漏れる)`,
      ).toBe(true);
    }
  });

  it("監査対象に実在しないルートが残っていない(404 の番兵を除く)", () => {
    const routes = new Set(appRoutes());
    const audited = auditedRoutes();

    expect(audited.length, "監査対象が空").toBeGreaterThan(0);
    for (const path of audited) {
      expect(
        routes.has(path),
        `${path} に対応する page.tsx が無い(ルート削除時の消し忘れ)`,
      ).toBe(true);
    }
  });

  it("404(not-found.tsx)もランドマーク監査の対象に入っている", () => {
    const notFound = LANDMARK_SCREENS.filter(
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
