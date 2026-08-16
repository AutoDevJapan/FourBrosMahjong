import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { bannerLandmarks } from "./bannerLandmarks";

/**
 * `bannerLandmarks()` 自身の回帰(spec 5.2.6 / #431)。
 *
 * 利用側(`src/test/a11y-heading-placement.test.tsx` の全ルート検査、
 * `src/components/game/GameBoard.test.tsx` のモーダル経路)は**すべて `[]` を期待する**ため、
 * 判定関数が壊れて常に `[]` を返すようになっても全件緑のままになる。判定そのものを
 * 両方向で固定しないとゲートが無音化する(#409 のメタテストが「文字列走査だと検査自体が
 * 無音化する」を塞いだのと同じ理由)。
 *
 * `playwright-core` から写した規則(祖先条件・妥当ロール一覧・`<header>` の暗黙ロール規則・
 * 明示ロールの解決)の同期は `bannerLandmarks.playwrightSync.test.ts` が守る。
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
   *
   * **どちら向きに壊れたかを先に確かめること**。`aria-query` が `elementRoles` のエントリ順を
   * 入れ替えただけなら、両方の `header` が generic 扱いになって `getByRole("banner")` は
   * 逆に**本物の banner を取りこぼす**側へ壊れる。赤 = 改善、とは限らない。
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
