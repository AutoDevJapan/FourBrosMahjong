/**
 * DOM ツリーから banner ランドマークを列挙する検査ヘルパ(spec 5.2.6 / #431)。
 *
 * ページヘッダーを `<main>` の内側へ統一した結果、**どのルートも banner を公開しない**のが
 * 規約になった。それを守るゲートは「banner が 0 個であること」を数えるので、判定式が要る。
 *
 * Testing Library の `getByRole("banner")` は使えない。`aria-query` の `elementRoles` は
 * `header` を **2 エントリ**持ち、`constraints` で振り分けている(実測):
 *
 * ```
 * { name: "header", constraints: ["scoped to the body element"] }            → ["banner"]
 * { name: "header", constraints: ["scoped to the main element", …] }         → ["generic"]
 * ```
 *
 * ところが `@testing-library/dom` の `makeElementSelector` は各エントリを CSS セレクタへ
 * 変換する際に **要素レベルの `constraints` を捨てる**(見るのは属性レベルの
 * `"undefined"` / `"set"` だけ)。結果として両エントリとも素の `header` セレクタになり、
 * 特異度でも分離できず、先に一致した banner が返る。だから `<main>` の内側の `<header>` まで
 * banner として報告される(実測)。
 *
 * 回帰は `src/test/a11y-heading-placement.test.tsx` の `bannerLandmarks()` ブロックが持つ。
 * 全ルートの期待値が `[]` なので、**判定が壊れて常に `[]` を返しても全件緑**になる —
 * 判定そのものを両方向で固定しないとゲートが無音化する。
 */

/**
 * `<header>` / `<footer>` の暗黙ロールを banner / contentinfo にしない祖先。
 *
 * **Playwright の実装から一字一句写している**(`playwright-core` の
 * `kAncestorPreventingLandmark`)。axe-core 4.12.1 の
 * `getSectioningContentPlusMainSelector()` も、W3C「ARIA in HTML」の `header` 行も、
 * 展開すると**同じ集合**(実測 / 仕様本文で確認)。字面が違うのは WHATWG HTML だけで、
 * そちらは「最も近い祖先のセクショニングコンテンツ / セクショニングルートが `body`」と
 * 定義するため `<main>` を含まない — 実装はどれも追随していない。
 */
export const BANNER_SUPPRESSING_ANCESTORS =
  "article:not([role]), aside:not([role]), main:not([role]), nav:not([role]), section:not([role]), [role=article], [role=complementary], [role=main], [role=navigation], [role=region]";

/**
 * 明示 `role` として妥当なトークン(`playwright-core` の `validRoles` を写したもの)。
 *
 * `role` はトークンリストで、**最初の妥当なトークン**が採用される。妥当なトークンが
 * 1 つも無ければ明示ロールは無効で、暗黙ロールが残る。この一覧を持たずに
 * 「`role` 属性が空でなければ暗黙ロールは消える」と単純化すると、`role="bannerr"`(打鍵ミス)や
 * `role="section"`(抽象ロール)を付けた `<main>` 外の `<header>` を**取りこぼす**。
 */
export const VALID_ROLES: ReadonlySet<string> = new Set(
  `alert alertdialog application article banner blockquote button caption cell
   checkbox code columnheader combobox complementary contentinfo definition
   deletion dialog directory document emphasis feed figure form generic grid
   gridcell group heading img insertion link list listbox listitem log main mark
   marquee math meter menu menubar menuitem menuitemcheckbox menuitemradio
   navigation none note option paragraph presentation progressbar radio
   radiogroup region row rowgroup rowheader scrollbar search searchbox separator
   slider spinbutton status strong subscript superscript switch tab table tablist
   tabpanel term textbox time timer toolbar tooltip tree treegrid treeitem`.split(
    /\s+/,
  ),
);

/** 明示 `role` を解決する(`playwright-core` の `getExplicitAriaRole` と同じ規則)。 */
function explicitRole(element: Element): string | null {
  const tokens = (element.getAttribute("role") ?? "").split(" ");
  return (
    tokens.map((token) => token.trim()).find((t) => VALID_ROLES.has(t)) ?? null
  );
}

/**
 * `root` 配下で banner ランドマークとして公開される要素を、**文書順**で列挙する。
 *
 * 祖先条件・明示ロールの解決とも Playwright に揃えてある。揃えないと、裏取り役の
 * `e2e/a11y.spec.ts`(`getByRole("banner")`)と食い違って、片方だけ緑になる形が生じる。
 *
 * **モデル化していない差が 1 つある**: `role="none"` / `role="presentation"` を付けた要素が
 * グローバル ARIA 属性を持つ / フォーカス可能な場合、ブラウザは presentation conflict
 * resolution で暗黙ロール(= banner)へ戻す。ここではそのまま「明示ロールあり」として
 * 扱うため、`<main>` の外の `<header role="none" aria-label="…">` を取りこぼす。実描画で
 * 同じ判定を回す E2E 側(7 画面)が受け止めるので、既知の穴として据え置く。
 */
export function bannerLandmarks(root: ParentNode): Element[] {
  return [...root.querySelectorAll("*")].filter((element) => {
    const role = explicitRole(element);
    if (role !== null) return role === "banner";
    // 明示ロールが無い(または妥当なトークンが無い)場合だけ暗黙ロールを見る。
    return (
      element.tagName === "HEADER" &&
      // Playwright は `closestCrossShadow(element, …)`(自分自身を含む)。`<header>` 自身は
      // どの選択肢にも一致しない(要素名の側は article/aside/main/nav/section、`[role=…]` の
      // 側は上の早期 return で除かれている)ので、素の `closest` で等価。
      element.closest(BANNER_SUPPRESSING_ANCESTORS) == null
    );
  });
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
