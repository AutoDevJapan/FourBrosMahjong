/**
 * DOM ツリーから banner ランドマークを列挙する検査ヘルパ(spec 5.2.6 / #431)。
 *
 * ページヘッダーを `<main>` の内側へ統一した結果、**どのルートも banner を公開しない**のが
 * 規約になった。それを守るゲートは「banner が 0 個であること」を数えるので、判定式が
 * 必要になる。Testing Library の `getByRole("banner")` は使えない — ロール解決が
 * `aria-query` のロール単位の `constraints`(`banner` の場合 `"scoped to the body element"`)
 * を**一切評価しない**ため、`<main>` の内側の `<header>` まで banner として返す(実測。
 * `@testing-library/dom` が見るのは属性単位の `undefined` / `set` 制約だけ)。
 *
 * 回帰は `src/test/a11y-heading-placement.test.tsx` の `bannerLandmarks()` ブロックが持つ。
 * 全ルートの期待値が `[]` なので、**判定が壊れて常に `[]` を返しても全件緑**になる —
 * 判定そのものを両方向で固定しないとゲートが無音化する。
 */

/**
 * `<header>` / `<footer>` の暗黙ロールを banner / contentinfo にしない祖先。
 *
 * **Playwright の実装から一字一句写している**(`playwright-core` の
 * `kAncestorPreventingLandmark`)。裏取り役の `e2e/a11y.spec.ts` が `getByRole("banner")`
 * で判定する以上、主ゲートが別の祖先条件を使うと**両者が食い違う**(ロールを上書きした
 * `<nav role="menubar">` の内側などで、こちらだけ緑になる)。
 *
 * axe-core 4.12.1 の `getSectioningContentPlusMainSelector()` も、展開すると
 * `article/aside/nav/section:not([role])` + `main:not([role])` +
 * `[role=article|complementary|navigation|region|main]` で**集合として同一**(実測)。
 * 散文でロール上書きに触れていないのは W3C「ARIA in HTML」の記述だけで、実装は揃っている。
 */
const BANNER_SUPPRESSING_ANCESTORS =
  "article:not([role]), aside:not([role]), main:not([role]), nav:not([role]), section:not([role]), [role=article], [role=complementary], [role=main], [role=navigation], [role=region]";

/**
 * `root` 配下で banner ランドマークとして公開される要素を列挙する。
 *
 * 明示ロールの解決だけは**意図的にブラウザより厳しい**。`role` はトークンリストで、
 * ブラウザ / Playwright は**最初の妥当なトークン**を採るため `role="navigation banner"` は
 * navigation になるが、ここでは `[role~="banner"]` で banner として数える。トークン並記は
 * 本プロジェクトでは使わない書き方であり、ゲートとしては**取りこぼし(偽陰性)より
 * 誤検知(偽陽性)へ倒す**ほうが安全なため(偽陽性は明確なメッセージで落ちて人が直せるが、
 * 偽陰性は規約違反を無音で通す)。この差は回帰テストで意図として固定してある。
 *
 * 可視性も見ない(`getByRole` は非表示要素を除く)。`hidden` な `<header>` を `<main>` の
 * 外に置く形も、規約としては直す対象なので数える。
 */
export function bannerLandmarks(root: ParentNode): Element[] {
  const explicit = [...root.querySelectorAll('[role~="banner"]')];
  const implicit = [...root.querySelectorAll("header")].filter((header) => {
    // 明示 `role` があれば暗黙ロールは上書きされる(上の explicit 側で拾う)。空文字や
    // 空白だけの `role` は「指定なし」と同じ扱いで、暗黙ロールが残る。
    const explicitRole = header.getAttribute("role")?.trim() ?? "";
    return (
      explicitRole === "" &&
      header.parentElement?.closest(BANNER_SUPPRESSING_ANCESTORS) == null
    );
  });
  return [...explicit, ...implicit];
}

/**
 * 失敗メッセージ用に要素を短く名指しする(`outerHTML` はタグ途中で切れて読めない)。
 *
 * `className` ではなく `getAttribute("class")` を使う。SVG 要素の `className` は
 * `SVGAnimatedString` で、テンプレートリテラルに埋めると `[object Object]` になる。
 */
export function describeElement(element: Element): string {
  const parts = [element.tagName.toLowerCase()];
  if (element.id !== "") parts.push(`#${element.id}`);
  const role = element.getAttribute("role");
  if (role !== null) parts.push(`[role="${role}"]`);
  const className = element.getAttribute("class");
  if (className !== null && className !== "") parts.push(`.${className}`);
  return parts.join("");
}
