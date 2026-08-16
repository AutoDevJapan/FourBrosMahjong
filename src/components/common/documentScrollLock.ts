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

function applyLock(): () => void {
  const { body } = document;
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  // body を fixed 化すると document のスクロールバーが消え、その幅ぶん内容が横へずれる。
  // 消える幅を padding で補って、ロックの前後でレイアウトが動かないようにする。
  const scrollbarWidth =
    window.innerWidth - document.documentElement.clientWidth;

  const previous = Object.fromEntries(
    LOCKED_STYLE_PROPERTIES.map((property) => [property, body.style[property]]),
  ) as LockedStyle;

  body.style.position = "fixed";
  body.style.top = `${-scrollY}px`;
  body.style.left = `${-scrollX}px`;
  body.style.width = "100%";
  body.style.overflow = "hidden";
  if (scrollbarWidth > 0) body.style.paddingRight = `${scrollbarWidth}px`;

  return () => {
    for (const property of LOCKED_STYLE_PROPERTIES) {
      body.style[property] = previous[property];
    }
    // スタイルを戻しただけでは document のスクロール範囲が再計算されておらず、
    // scrollTo が上限 0 にクランプされて位置を失う。強制的にレイアウトを確定させてから戻す。
    void body.offsetHeight;
    window.scrollTo(scrollX, scrollY);
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
  if (lockCount === 0) restore = applyLock();
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
