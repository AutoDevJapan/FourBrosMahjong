// @vitest-environment jsdom
// DOM を直接操作するモジュールのため、node 既定の unit プロジェクト内で jsdom を選ぶ
// (`vitest.config.ts` が用意している拡張子規約のオプトアウト手段)。
import { afterEach, describe, expect, it, vi } from "vitest";
import { lockDocumentScroll } from "./documentScrollLock";

afterEach(() => {
  document.body.removeAttribute("style");
  vi.restoreAllMocks();
});

/** ロック前のスクロール位置を jsdom 上で再現する(jsdom は実スクロールを持たない)。 */
function stubScrollPosition(x: number, y: number) {
  vi.spyOn(window, "scrollX", "get").mockReturnValue(x);
  vi.spyOn(window, "scrollY", "get").mockReturnValue(y);
  return vi.spyOn(window, "scrollTo").mockImplementation(() => {});
}

describe("documentScrollLock (#371 モーダル中の背面スクロールロック)", () => {
  it("body を fixed 化してロックし、解除でスクロール位置を復元する", () => {
    const scrollTo = stubScrollPosition(0, 120);

    const release = lockDocumentScroll();
    expect(document.body.style.position).toBe("fixed");
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.body.style.width).toBe("100%");
    // ロック中も見た目の位置が変わらないよう、退避したスクロール量ぶん引き上げる。
    expect(document.body.style.top).toBe("-120px");
    expect(document.body.style.left).toBe("0px");

    release();
    expect(scrollTo).toHaveBeenCalledWith(0, 120);
  });

  it("ロック前から付いていたインラインスタイルを正確に戻す", () => {
    stubScrollPosition(0, 0);
    document.body.style.position = "relative";
    document.body.style.overflow = "auto";
    document.body.style.paddingRight = "7px";

    const release = lockDocumentScroll();
    expect(document.body.style.position).toBe("fixed");

    release();
    expect(document.body.style.position).toBe("relative");
    expect(document.body.style.overflow).toBe("auto");
    expect(document.body.style.paddingRight).toBe("7px");
    // ロックが設定したが元は未設定だったプロパティは、空へ戻す。
    expect(document.body.style.width).toBe("");
    expect(document.body.style.top).toBe("");
  });

  it("ロックが重なっている間は解除せず、最後の解除で復元する", () => {
    stubScrollPosition(0, 0);

    const releaseOuter = lockDocumentScroll();
    const releaseInner = lockDocumentScroll();
    expect(document.body.style.position).toBe("fixed");

    releaseInner();
    expect(document.body.style.position).toBe("fixed");

    releaseOuter();
    expect(document.body.style.position).toBe("");
  });

  it("解除関数は冪等で、二重呼び出ししても他のロックを巻き込まない", () => {
    stubScrollPosition(0, 0);

    const releaseOuter = lockDocumentScroll();
    const releaseInner = lockDocumentScroll();

    releaseInner();
    releaseInner();
    // 二重呼び出しがカウントを余計に減らしていれば、ここで既に解除されてしまう。
    expect(document.body.style.position).toBe("fixed");

    releaseOuter();
    expect(document.body.style.position).toBe("");
  });

  it("スクロール位置の取得が失敗してもモーダル用ロックをno-opへ退避する", () => {
    vi.spyOn(window, "scrollY", "get").mockImplementation(() => {
      throw new Error("scroll position is unavailable");
    });

    const release = lockDocumentScroll();

    expect(() => release()).not.toThrow();
    expect(document.body.style.position).toBe("");
  });

  it("スタイル適用途中のCSSOM例外で部分ロックを残さない", () => {
    const style = document.body.style;
    style.position = "relative";
    style.overflow = "auto";
    const previousTop = style.top;
    const topDescriptor = Object.getOwnPropertyDescriptor(style, "top");
    Object.defineProperty(style, "top", {
      configurable: true,
      get: () => previousTop,
      set: () => {
        throw new Error("CSSOM is unavailable");
      },
    });

    try {
      const release = lockDocumentScroll();

      expect(() => release()).not.toThrow();
      expect(style.position).toBe("relative");
      expect(style.overflow).toBe("auto");
      expect(style.top).toBe(previousTop);
    } finally {
      if (topDescriptor) {
        Object.defineProperty(style, "top", topDescriptor);
      } else {
        Reflect.deleteProperty(style, "top");
      }
    }
  });

  it("レイアウト復元やscrollToの例外を閉じる操作へ漏らさない", () => {
    stubScrollPosition(0, 120);
    const release = lockDocumentScroll();
    const offsetHeightDescriptor = Object.getOwnPropertyDescriptor(
      document.body,
      "offsetHeight",
    );
    Object.defineProperty(document.body, "offsetHeight", {
      configurable: true,
      get: () => {
        throw new Error("layout flush is unavailable");
      },
    });
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {
      throw new Error("scroll restoration is unavailable");
    });

    try {
      expect(() => release()).not.toThrow();
      expect(scrollTo).toHaveBeenCalledWith(0, 120);
      expect(document.body.style.position).toBe("");
    } finally {
      if (offsetHeightDescriptor) {
        Object.defineProperty(
          document.body,
          "offsetHeight",
          offsetHeightDescriptor,
        );
      } else {
        Reflect.deleteProperty(document.body, "offsetHeight");
      }
    }
  });
});
