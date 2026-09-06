/**
 * モーダル表示中に document(背面ページ)のスクロールを止めるロック(issue #371)。
 *
 * `inert` はフォーカス・ポインタ操作を抑止するが、document 自体のスクロールコンテナは
 * 止めない。そのためオーバーレイ上の wheel/touch や、ダイアログ端でのオーバースクロールが
 * 背面ページへ連鎖してしまう。ここでは `body` を `position: fixed` 化して document から
 * スクロール可能領域そのものを取り除く。
 *
 * `overflow: hidden` だけでは iOS Safari のタッチスクロールを止められないため
 * `position: fixed` 方式を採る。ただしこの方式はスクロール位置を失うので、
 * ロック時の位置を保持し、解除時に `window.scrollTo` で正確に復元する。
 *
 * 複数のモーダルが同時に開いても最も外側の 1 回だけ適用・復元されるよう参照カウントで
 * 管理する。解除関数は冪等で、二重呼び出ししてもカウントは壊れない。
 */

/** ロックが適用される際に退避・復元する `body` のインラインスタイル。 */
const LOCKED_STYLE_PROPERTIES = [
  "position",
  "top",
  "left",
  "width",
  "overflow",
  "paddingRight",
] as const;

type LockedStyle = Record<(typeof LOCKED_STYLE_PROPERTIES)[number], string>;

/** 現在ロックを保持しているモーダルの数。0 になった時点で復元する。 */
let lockCount = 0;
/** 最外のロックが退避した状態の復元処理。ロック中のみ非 null。 */
let restore: (() => void) | null = null;

/** 読み取り専用・書き込み専用のどちらかが壊れていてもスタイルを戻す。 */
function restoreBodyStyles(
  style: CSSStyleDeclaration,
  previous: LockedStyle,
): void {
  for (const property of LOCKED_STYLE_PROPERTIES) {
    try {
      style[property] = previous[property];
    } catch {
      // A restricted CSSOM can reject an individual property. Continue restoring
      // the remaining properties so a partial lock does not remain in place.
    }
  }
}

/**
 * Apply the lock only when the complete capability boundary is usable.
 *
 * Embedded/privacy-restricted documents can expose a DOM/CSSOM object whose
 * getter or setter throws. A modal must remain usable even when its optional
 * scroll lock cannot be applied, so a failed or partial application degrades
 * to a no-op after best-effort restoration.
 */
function applyLock(): (() => void) | null {
  let body: HTMLElement | null = null;
  let style: CSSStyleDeclaration | null = null;
  let previous: LockedStyle | null = null;
  let scrollX = 0;
  let scrollY = 0;

  try {
    body = document.body;
    const root = document.documentElement;
    if (!body || !root) return null;

    scrollX = window.scrollX;
    scrollY = window.scrollY;
    // body を fixed 化すると document のスクロールバーが消え、その幅ぶん内容が横へずれる。
    // 消える幅を padding で補って、ロックの前後でレイアウトが動かないようにする。
    const scrollbarWidth = window.innerWidth - root.clientWidth;

    const currentStyle = body.style;
    style = currentStyle;
    previous = Object.fromEntries(
      LOCKED_STYLE_PROPERTIES.map((property) => [
        property,
        currentStyle[property],
      ]),
    ) as LockedStyle;

    currentStyle.position = "fixed";
    currentStyle.top = `${-scrollY}px`;
    currentStyle.left = `${-scrollX}px`;
    currentStyle.width = "100%";
    currentStyle.overflow = "hidden";
    if (scrollbarWidth > 0) currentStyle.paddingRight = `${scrollbarWidth}px`;
  } catch {
    if (style !== null && previous !== null) {
      restoreBodyStyles(style, previous);
    }
    return null;
  }

  if (body === null || style === null || previous === null) return null;
  const lockedBody = body;
  const lockedStyle = style;
  const lockedPrevious = previous;

  return () => {
    restoreBodyStyles(lockedStyle, lockedPrevious);
    // スタイルを戻しただけでは document のスクロール範囲が再計算されておらず、
    // scrollTo が上限 0 にクランプされて位置を失う。強制的にレイアウトを確定させてから戻す。
    try {
      void lockedBody.offsetHeight;
    } catch {
      // Layout reads are optional for restoration and must not break modal close.
    }
    try {
      window.scrollTo(scrollX, scrollY);
    } catch {
      // A restricted window may reject scroll restoration; the styles are already restored.
    }
  };
}

/**
 * document のスクロールをロックし、解除する関数を返す。
 *
 * 返された解除関数は冪等。同じロックに対して複数回呼んでも 1 回ぶんとして扱う。
 */
export function lockDocumentScroll(): () => void {
  // applyLock が失敗した場合にカウントだけ進んで復元不能になるのを避けるため、
  // 適用が成功してからカウントを進める。
  if (lockCount === 0) {
    const nextRestore = applyLock();
    // スクロールロックはモーダル操作の補助機能。DOM/CSSOMが使えない環境でも
    // ダイアログ自体は使えるよう、適用不能時は冪等なno-opへ退避する。
    if (nextRestore === null) return () => {};
    restore = nextRestore;
  }
  lockCount += 1;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    lockCount -= 1;
    if (lockCount > 0) return;
    restore?.();
    restore = null;
  };
}
