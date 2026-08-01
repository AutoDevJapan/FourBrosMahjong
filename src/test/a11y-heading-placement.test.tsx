import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GamePage from "@/app/game/page";
import ResultPage from "@/app/game/result/page";
import HistoryPage from "@/app/history/page";
import NotFound from "@/app/not-found";
import HomePage from "@/app/page";
import RulesPage from "@/app/rules/page";
import SettingsPage from "@/app/settings/page";
import { GameProvider } from "@/components/game/GameProvider";
import { createGame } from "@/domain/game/engine";
import { appRoutes } from "./appRoutes";

/**
 * `<h1>`・ページヘッダーの配置規約(spec 5.2.6 / #431)を全ルートで固定する。
 *
 * 規約は「**ページヘッダー(`<h1>` を含む)は `<main>` の内側に置く**」。結果として
 * どのルートも banner ランドマークを持たず、ランドマーク構成が `main`(+ ページ内の
 * `nav` 等)で揃う。#409 の時点では内側 4 ルート / 外側 3 ルートに割れており、
 * ルートごとにスクリーンリーダのランドマーク一覧が変わっていた。
 *
 * E2E(`e2e/a11y.spec.ts`)にも同じ不変条件を置いてあるが、**主ゲートはこちら**にする:
 * ブラウザを起動せず数秒で回るため、ルート追加時に真っ先に落ちる。E2E 側は実ブラウザの
 * ロール計算(`<header>` → banner の実マッピング)で裏を取る役目。
 *
 * ルート一覧は `appRoutes()`(`src/app/**\/page.*` の実走査)と突き合わせる。ここを
 * 手書き配列だけにすると、**新ルートを足しても検査が増えない**——この規約が割れた
 * そもそもの原因(ルートごとに構造が自由)を再生産することになる。
 */

// App Router の useRouter を jsdom 用にスタブ(`ResultPageClient` が参照する)。
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

// jsdom は `window.matchMedia` を実装しない(`/settings` の `ThemeToggle` が参照する)。
beforeEach(() => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * `<header>` の暗黙ロールが banner にならない祖先(HTML-AAM)。
 *
 * `<header>` は `article` / `aside` / `main` / `nav` / `section` の子孫にある場合に限り
 * banner ではなく generic になる。ロール計算をテスト側に持たず Testing Library の
 * `getByRole("banner")` に委ねると、`dom-accessibility-api` の実装差(この祖先条件を
 * 見ないバージョン)にゲートの意味が左右される。判定式を明示して固定する。
 */
const BANNER_SUPPRESSING_ANCESTORS = "article, aside, main, nav, section";

/** `root` 配下で banner ランドマークとして公開される要素を列挙する。 */
function bannerLandmarks(root: ParentNode): Element[] {
  const explicit = [...root.querySelectorAll('[role="banner"]')];
  const implicit = [...root.querySelectorAll("header")].filter(
    // 明示 `role` があれば暗黙ロールは上書きされる(上の explicit 側で拾う)。
    (header) =>
      !header.hasAttribute("role") &&
      header.parentElement?.closest(BANNER_SUPPRESSING_ANCESTORS) == null,
  );
  return [...explicit, ...implicit];
}

/**
 * 各ルートを jsdom で描画するための要素。キーは `appRoutes()` が返すルートパス。
 *
 * `/game` と `/game/result` は実アプリでは `src/app/game/layout.tsx` の `GameProvider`
 * 配下に描かれるため、ここでも同じ形で包む。配牌は seed 固定で決定的にする。
 */
const ROUTE_ELEMENTS: Readonly<Record<string, () => ReactElement>> = {
  "/": () => <HomePage />,
  "/rules": () => <RulesPage />,
  "/settings": () => <SettingsPage />,
  "/history": () => <HistoryPage />,
  "/game": () => (
    <GameProvider initialGame={createGame({ seed: 0 })}>
      <GamePage />
    </GameProvider>
  ),
  "/game/result": () => (
    <GameProvider initialGame={createGame({ seed: 0 })}>
      <ResultPage />
    </GameProvider>
  ),
};

/**
 * 404 は `not-found.tsx` という独立実装でルートを持たないため、`appRoutes()` には現れない。
 * 規約は同じく適用されるので明示的に足す(`e2e/screens.ts` の `LANDMARK_SCREENS` と同じ扱い)。
 */
const NOT_FOUND_CASE = {
  name: "404(not-found.tsx)",
  render: () => <NotFound />,
};

const ROUTE_CASES = Object.entries(ROUTE_ELEMENTS).map(([path, element]) => ({
  name: path,
  render: element,
}));

describe("<h1>・ページヘッダーの配置(spec 5.2.6 / #431)", () => {
  it("実在する全ルートが検査対象になっている", () => {
    const routes = appRoutes();
    expect(routes.length, "ルートを 1 件も導出できていない").toBeGreaterThan(0);
    // 過不足なく一致させる。増えた側は「新ルートに検査が付いていない」、減った側は
    // 「消えたルートの描画ケースが残っている」を指す。
    expect(Object.keys(ROUTE_ELEMENTS).sort()).toEqual(routes);
  });

  for (const testCase of [...ROUTE_CASES, NOT_FOUND_CASE]) {
    it(`${testCase.name}: <h1> は <main> の内側にあり banner ランドマークを持たない`, () => {
      const { container } = render(testCase.render());

      const mains = container.querySelectorAll("main");
      expect(mains, "<main> がちょうど 1 つでない").toHaveLength(1);

      const headings = container.querySelectorAll("h1");
      expect(headings, "<h1> がちょうど 1 つでない").toHaveLength(1);
      expect(
        mains[0].contains(headings[0]),
        "<h1> が <main> の外にある(spec 5.2.6: ページヘッダーは <main> の内側)",
      ).toBe(true);

      expect(
        bannerLandmarks(container).map((element) =>
          element.outerHTML.slice(0, 120),
        ),
        "banner ランドマークが公開されている(ページヘッダーを <main> の外へ出すと発生する)",
      ).toEqual([]);
    });
  }
});
