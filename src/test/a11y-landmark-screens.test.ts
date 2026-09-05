import { describe, expect, it } from "vitest";
import {
  FULL_A11Y_SCREENS,
  LANDMARK_SCREENS,
  NOT_FOUND_SCREEN_NAME,
  nonTextContrastScreens,
  SCREENS,
} from "../../e2e/screens";
import { appRoutes } from "./appRoutes";

/**
 * spec 5.2.6 は「**全ルート**は本文を単一の `<main>` に収める」と定めるが、その強制は
 * `e2e/a11y.spec.ts` が回す画面一覧に依存している。ルートを新設しても一覧へ足し忘れれば、
 * 規約から**無音で外れる**(Playwright は存在しない画面を教えてくれない)。
 *
 * ここでは `src/app/**\/page.*` から実ルートを導出し、ランドマーク監査の画面一覧と
 * 過不足なく一致することを固定する。ブラウザ不要の node テストなので `pnpm test` で回る。
 *
 * 一覧は `e2e/screens.ts` から**実体を import** する(ソースの文字列走査ではない)。
 * 走査だとエントリをコメントアウトされても素通りしてしまい、この検査自体が無音化する。
 *
 * 同型の穴埋めとして `src/test/playwright-projects.test.ts`(testMatch の空振り)がある。
 *
 * ルートの導出は `src/test/appRoutes.ts` に置き、`<h1>` の配置規約(#431)を検査する
 * `a11y-heading-placement.test.tsx` と共有する。導出を各テストへ複製すると、片方だけが
 * 新しいルート表現(動的セグメント等)に気づく非対称な穴が生まれる。
 */

/** ランドマーク監査の対象のうち、実在ルートを指すもの(404 の番兵を除く)。 */
function auditedRoutes(): string[] {
  return SCREENS.map((screen) => screen.path);
}

describe("ランドマーク監査の画面一覧(spec 5.2.6 / #409)", () => {
  it("実在ルート一覧を landmark と非テキストコントラストの両監査が共有する", () => {
    expect(nonTextContrastScreens()).toBe(SCREENS);
    expect(
      LANDMARK_SCREENS.slice(0, SCREENS.length),
      "LANDMARK_SCREENS の実在ルート部分が共通一覧から外れている",
    ).toEqual(SCREENS);
  });

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
        `${path} に対応する page.* が無い(ルート削除時の消し忘れ)`,
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

  it("404(not-found.tsx)も全体 a11y 監査に含まれる", () => {
    expect(FULL_A11Y_SCREENS).toEqual(LANDMARK_SCREENS);
    expect(
      FULL_A11Y_SCREENS.some((screen) => screen.name === NOT_FOUND_SCREEN_NAME),
    ).toBe(true);
  });
});
