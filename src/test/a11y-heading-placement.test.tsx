import { render, screen } from "@testing-library/react";
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
import { LANDMARK_SCREENS, NOT_FOUND_SCREEN_NAME } from "../../e2e/screens";
import { appRoutes } from "./appRoutes";
import { bannerLandmarks, describeElement } from "./bannerLandmarks";

/**
 * `<h1>`・ページヘッダーの配置規約(spec 5.2.6 / #431)を全ルートで固定する。
 *
 * 規約は「**ページヘッダー(`<h1>` を含む)は `<main>` の内側に置く**」。結果として
 * どのルートも banner ランドマークを持たず、ランドマーク構成が `main`(+ ページ内の
 * `nav` 等)で揃う。#409 の時点では内側 4 ルート / 外側 3 ルートに割れており、
 * ルートごとにスクリーンリーダのランドマーク一覧が変わっていた。
 *
 * E2E(`e2e/a11y.spec.ts`)にも同じ不変条件を置いてあるが、**主ゲートはこちら**にする:
 * ブラウザを起動せず数秒で回るため、ルート追加時に真っ先に落ちる。E2E 側は**実 DOM**
 * (SSR + hydration + レイアウト + 実 CSS)で裏を取る役目。判定アルゴリズムの独立検証では
 * ない — Playwright の `getByRole` はブラウザのアクセシビリティツリーではなく自前の
 * `computeAriaRole` を注入して評価しており、`bannerLandmarks()` はその実装を写している。
 *
 * **ここが見るのはページコンポーネントであって、ルートの最終的な DOM ではない**。
 * レイアウト(`src/app/layout.tsx` / `src/app/game/layout.tsx`)はツリーに入らないので、
 * レイアウト由来の `<header>` や 2 つ目の `<main>` はここでは見えない — それは E2E 側の担当。
 * `/game` 系だけは `GameProvider` を手で再現しているが、これは描画に必要なコンテキストを
 * 補うためで、レイアウトのランドマーク寄与を再現しているわけではない。
 *
 * ルート一覧は `appRoutes()`(`src/app/**\/page.*` の実走査)と突き合わせる。ここを
 * 手書き配列だけにすると、**新ルートを足しても検査が増えない**——この規約が割れた
 * そもそもの原因(ルートごとに構造が自由)を再生産することになる。
 */

// App Router のフックを jsdom 用にスタブ。`ResultPageClient` が使うのは `useRouter` だけだが、
// 素の実装は App Router のコンテキスト外で投げるため、ページが後から別のフックを使い始めた
// ときに「landmark が壊れた」ではなく不透明な例外で落ちる。よく使う読み取り系も先に埋める。
//
// 返り値は**モジュールスコープで 1 度だけ**作る。呼び出しごとに新しい値を返すと、
// ページ側がそれを `useEffect` / `useMemo` の依存配列へ入れた瞬間に無限再描画になり、
// 「不透明な例外」より始末の悪い jsdom のハングになる(ここで避けたい失敗モードの逆)。
vi.mock("next/navigation", () => {
  const router = { push: vi.fn(), replace: vi.fn() };
  const searchParams = new URLSearchParams();
  return {
    useRouter: () => router,
    usePathname: () => "/",
    useSearchParams: () => searchParams,
  };
});

// jsdom は `window.matchMedia` を実装しない(`/settings` の `ThemeToggle` が参照する)。
// `stubGlobal` / `unstubAllGlobals` で対にする(素の代入は `restoreAllMocks` では戻らない)。
beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * 各ルートを jsdom で描画するための要素。キーは `appRoutes()` が返すルートパス。
 *
 * `/game` と `/game/result` は実アプリでは `src/app/game/layout.tsx` が置く `GameProvider`
 * の配下に描かれる。ここでは同じ `GameProvider` を、決定性のために `initialGame`
 * (テスト専用の注入経路)付きで再現する — レイアウト自身は `initialGame` を渡さず
 * `?seed` か乱数で初期化するので、そのまま流用はできない。
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
 * 画面名 → 期待する `<h1>` テキスト。`e2e/screens.ts` の `Screen.heading` を唯一の出所に
 * する。ルートと描画コンポーネントの**取り違え**(新ルートのキーに別ページを割り当てる等)は
 * キーの一致検査では通ってしまうため、描いた中身まで突き合わせる。
 */
const EXPECTED_HEADING = new Map(
  LANDMARK_SCREENS.map((screen) => [screen.name, screen.heading] as const),
);

/** 画面名を `e2e/screens.ts` の一覧から引く(パスは 404 の番兵だけ実在しない)。 */
const SCREEN_NAME_BY_PATH = new Map(
  LANDMARK_SCREENS.map((screen) => [screen.path, screen.name] as const),
);

type Case = { name: string; element: () => ReactElement };

const ROUTE_CASES: Case[] = Object.entries(ROUTE_ELEMENTS).map(
  ([path, element]) => ({
    name: SCREEN_NAME_BY_PATH.get(path) ?? path,
    element,
  }),
);

/**
 * 404 は `not-found.tsx` という独立実装でルートを持たないため、`appRoutes()` には現れない。
 * 規約は同じく適用されるので明示的に足す(`e2e/screens.ts` の `LANDMARK_SCREENS` と同じ扱い)。
 */
const NOT_FOUND_CASE: Case = {
  name: NOT_FOUND_SCREEN_NAME,
  element: () => <NotFound />,
};

describe("<h1>・ページヘッダーの配置(spec 5.2.6 / #431)", () => {
  it("実在する全ルートが検査対象になっている", () => {
    // 過不足なく一致させる。増えた側は「新ルートに検査が付いていない」、減った側は
    // 「消えたルートの描画ケースが残っている」を指す。
    expect(Object.keys(ROUTE_ELEMENTS).sort()).toEqual(appRoutes());
  });

  for (const testCase of [...ROUTE_CASES, NOT_FOUND_CASE]) {
    it(`${testCase.name}: <h1> は <main> の内側にあり banner ランドマークを持たない`, () => {
      render(testCase.element());

      // 走査対象は `document.body`。Testing Library の `container` に絞ると、
      // `Modal` のようにポータルで `document.body` 直下へ出る要素を見落とす。
      // 各テストの後に `vitest.setup.ts` の `cleanup()` が body を空へ戻す。
      const root = document.body;

      const mains = root.querySelectorAll("main");
      expect(mains, "<main> がちょうど 1 つでない").toHaveLength(1);

      const headings = root.querySelectorAll("h1");
      expect(headings, "<h1> がちょうど 1 つでない").toHaveLength(1);
      expect(
        mains[0].contains(headings[0]),
        "<h1> が <main> の外にある(spec 5.2.6: ページヘッダーは <main> の内側)",
      ).toBe(true);

      // ルートに対応するページを描いているか(取り違え検出)。`toHaveTextContent` は
      // 部分一致なので使わない — 「ルール説明とFAQ」のような別見出しを通してしまう。
      const expectedHeading = EXPECTED_HEADING.get(testCase.name);
      expect(
        expectedHeading,
        `${testCase.name} が e2e/screens.ts の一覧に無い`,
      ).toBeDefined();
      expect(
        headings[0].textContent?.trim(),
        `${testCase.name} の <h1> 文言が e2e/screens.ts の Screen.heading と一致しない`,
      ).toBe(expectedHeading);

      expect(
        bannerLandmarks(root).map(describeElement),
        "banner ランドマークが公開されている(ページヘッダーを <main> の外へ出すと発生する)",
      ).toEqual([]);
    });
  }
});

/**
 * 上の検査は全ルートで `[]` を期待する。判定関数が壊れて常に `[]` を返すようになっても
 * 全件緑のままなので、**判定そのものを両方向で固定する**(#409 のメタテストが「文字列走査だと
 * 検査自体が無音化する」を塞いだのと同じ理由)。
 */
describe("bannerLandmarks()(banner 判定そのもの)", () => {
  function renderProbe(markup: ReactElement) {
    render(markup);
    return document.body;
  }

  it("<main> の外の <header> は banner、内側の <header> は banner ではない", () => {
    const root = renderProbe(
      <div>
        <header id="outside" />
        <main>
          <header id="inside" />
        </main>
      </div>,
    );

    expect(bannerLandmarks(root).map((element) => element.id)).toEqual([
      "outside",
    ]);
  });

  it("明示 role はトークンリストの最初の妥当なトークンで決まる(Playwright と同じ規則)", () => {
    const root = renderProbe(
      <main>
        <div id="explicit" role="banner" />
        {/* #banner-first: 先頭が banner → banner */}
        <div id="banner-first" role="banner navigation" />
        {/* #navigation-first: 先頭が navigation なので navigation。banner は採られない */}
        <div id="navigation-first" role="navigation banner" />
        {/* #invalid-then-banner: 先頭が無効トークンなので次の妥当なトークン(banner) */}
        <div id="invalid-then-banner" role="bannerr banner" />
      </main>,
    );

    expect(bannerLandmarks(root).map((element) => element.id)).toEqual([
      "explicit",
      "banner-first",
      "invalid-then-banner",
    ]);
  });

  it("妥当なトークンが 1 つも無い role は「指定なし」と同じく暗黙ロールを残す", () => {
    // ここを「role 属性が空でなければ暗黙ロールは消える」と単純化すると、打鍵ミスや
    // 抽象ロールを付けた <main> 外の <header> を**取りこぼす**(ブラウザは banner にする)。
    const root = renderProbe(
      <div>
        <header id="blank-role" role=" " />
        <header id="typo-role" role="bannerr" />
        {/* section は抽象ロールで、明示 role としては妥当でない */}
        <header id="abstract-role" role="section" />
        {/* 妥当な role が付いていれば暗黙ロールは消える(対照) */}
        <header id="valid-role" role="group" />
      </div>,
    );

    expect(bannerLandmarks(root).map((element) => element.id)).toEqual([
      "blank-role",
      "typo-role",
      "abstract-role",
    ]);
  });

  it("祖先が role で上書きされていれば暗黙ロールは抑止されない(ブラウザ実装に一致)", () => {
    const root = renderProbe(
      <div>
        {/* ロール上書き済みの <nav> は landmark 抑止の対象外 → banner のまま */}
        <nav role="menubar">
          <header id="under-overridden-nav" />
        </nav>
        {/* 逆に role=region は sectioning 要素でなくても抑止する */}
        <div role="region">
          <header id="under-region" />
        </div>
      </div>,
    );

    expect(bannerLandmarks(root).map((element) => element.id)).toEqual([
      "under-overridden-nav",
    ]);
  });

  /**
   * 自前判定を持つ理由の**カナリア**。`aria-query` の `elementRoles` は `header` を
   * 2 エントリ持ち、`{ constraints: ["scoped to the body element"] } → banner` と
   * `{ constraints: ["scoped to the main element", …] } → generic` に分かれている。
   * ところが `@testing-library/dom` の `makeElementSelector` はエントリを CSS セレクタへ
   * 変換するときに**要素レベルの `constraints` を捨てる**(見るのは属性レベルの
   * `"undefined"` / `"set"` だけ)。両エントリとも素の `header` セレクタになり、特異度でも
   * 分離できないので先に一致した banner が返る — `<main>` の内側でも banner(実測)。
   *
   * **この期待が赤くなったら乗り換えを再検討する合図**。Testing Library が要素レベルの
   * `constraints` を尊重すれば `"scoped to the main element"` のエントリが効き、
   * `<main>` 内の `<header>` は generic になって `getByRole("banner")` を使える。ただし
   * 乗り換えるかは、そのとき `bannerLandmarks()` との残差(明示ロールの解決規則・可視性
   * フィルタ)を実測してから決めること。期待値だけ書き換えて済ませないこと。
   */
  it("Testing Library の getByRole('banner') は祖先条件を見ない(自前判定を持つ理由)", () => {
    renderProbe(
      <div>
        <header id="outside" />
        <main>
          <header id="inside" />
        </main>
      </div>,
    );

    expect(
      screen.queryAllByRole("banner").map((element) => element.id),
      "この失敗は @testing-library/dom の更新で起きうる。期待値を書き換える前に、上の doc コメント(乗り換え条件)を読むこと",
    ).toEqual(["outside", "inside"]);
  });
});
