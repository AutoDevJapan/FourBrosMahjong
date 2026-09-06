"use client";

/**
 * アクセシブルなモーダルダイアログ(スペック5 5.2.2)。
 *
 * - `role="dialog"` + `aria-modal="true"` + `aria-labelledby`(見出し)で表明する。
 * - **フォーカストラップ**: 開いた瞬間にダイアログへフォーカスを移し、`Tab`/`Shift+Tab` は
 *   ダイアログ内の可視フォーカス可能要素を循環させて外へ出さない。
 * - **`Escape` で閉じる**、背景(オーバーレイ)クリックでも閉じる。
 * - 閉じたら**開く前のフォーカス位置へ戻す**(呼び出し元のトリガーへ復帰)。WebKit は
 *   ポインターで `button` を起動してもフォーカスを移さず `activeElement` がトリガーに
 *   ならないため(#369)、トリガーが判っている呼び出し元は `returnFocusRef` で明示する。
 *   復帰先が到達不能(`display: none` 等)なら次の候補へ連鎖する(#377)。
 * - **背面 document のスクロールをロックする**(issue #371)。`inert` はスクロールを止めないため、
 *   オーバーレイ操作やダイアログ端のオーバースクロールが背面ページへ連鎖するのを
 *   `lockDocumentScroll` で防ぎ、閉じたら開く前のスクロール位置へ正確に戻す。
 *
 * 卓UIの「全体盤面」等をスタッキング順の影響を受けずに最前面へ出すため `document.body` へ
 * ポータルする。表示制御(開閉状態)は呼び出し元が持ち、本コンポーネントは開いている間だけ描画する。
 */
import {
  type RefObject,
  useCallback,
  useEffect,
  useEffectEvent,
  useId,
  useRef,
} from "react";
import { createPortal } from "react-dom";
import { lockDocumentScroll } from "./documentScrollLock";

export interface ModalProps {
  /** ダイアログの見出し(`aria-labelledby` の対象)。 */
  title: string;
  /** 閉じる要求(`Escape`・オーバーレイクリック・閉じるボタン)。 */
  onClose: () => void;
  /** ポインター起動時も含め、閉じた後に戻す呼び出し元。省略時は開く前の activeElement。 */
  returnFocusRef?: RefObject<HTMLElement | null>;
  /**
   * トリガーにも開く前の activeElement にも到達できないときの最終復帰先(スペック5 5.2.2)。
   * WAI-ARIA APG が求める「論理的な作業の流れを提供する要素」を呼び出し元が指定する。
   * モーダルが補完している領域のルート要素に `tabindex="-1"` を与えて渡す。
   * その要素には**ロールとアクセシブル名**も持たせること(既定は `role="group"` +
   * `aria-label`)。名前が無いとフォーカスが移ったことをスクリーンリーダへ伝えられない
   * (スペック5 5.2.2 / #405)。
   */
  fallbackFocusRef?: RefObject<HTMLElement | null>;
  children: React.ReactNode;
}

/**
 * フォーカス復帰先として意味のある要素か(スペック5 5.2.2)。
 *
 * `<body>` / `<html>` は「復帰できていない状態」そのもののため対象外とする。ブラウザでは
 * `body.focus()` が成功してしまい、候補に残すとそこで連鎖が止まってフォーカスを失う。
 * 到達できるかどうか(DOM 接続・可視性・`disabled` 等)はここでは判定しない。実際に
 * `focus()` してみるまで確定しないため、`restoreFocus` が `activeElement` で実測する。
 */
export function isRestoreFocusTarget(
  element: HTMLElement | null | undefined,
): element is HTMLElement {
  if (!element) return false;
  const { body, documentElement } = element.ownerDocument;
  return element !== body && element !== documentElement;
}

/**
 * ダイアログ内のフォーカス可能要素を DOM 順で列挙する。
 * 実ブラウザでは CSS の `display: none` / `visibility: hidden` もフォーカス不能なので、
 * それらの祖先を含めて除外する。`getComputedStyle` はレイアウト寸法を参照しないため、
 * jsdom でも inline style の退行を検出でき、実レイアウトに依存する `getClientRects()` は使わない。
 */
function isUnavailableForFocus(element: HTMLElement): boolean {
  for (
    let current: HTMLElement | null = element;
    current;
    current = current.parentElement
  ) {
    if (
      current.hidden ||
      current.inert ||
      current.getAttribute("aria-hidden") === "true"
    ) {
      return true;
    }

    const style = current.ownerDocument.defaultView?.getComputedStyle(current);
    if (
      style?.display === "none" ||
      style?.visibility === "hidden" ||
      style?.visibility === "collapse"
    ) {
      return true;
    }
  }
  return false;
}

function focusableElements(root: HTMLElement): HTMLElement[] {
  const nodes = root.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
  );
  return Array.from(nodes).filter(
    (el) => !el.matches(":disabled") && !isUnavailableForFocus(el),
  );
}

export default function Modal({
  title,
  onClose,
  returnFocusRef,
  fallbackFocusRef,
  children,
}: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const requestClose = useEffectEvent(onClose);
  const titleId = useId();

  // 背面 document のスクロールロックは隔離処理より前に確定させる。ロックは適用時点の
  // スクロール位置を退避するため、後続の dialog.focus() 等がページを動かす前に取る。
  useEffect(() => lockDocumentScroll(), []);

  // 閉じる瞬間にフォーカス復帰先を解決する。WebKit はポインターで button を起動しても
  // フォーカスを移さないため(#369)、呼び出し元が明示した returnFocusRef を最優先にする。
  // ref を非リアクティブに読むことで隔離エフェクトを ref の identity から切り離しつつ、
  // 表示中にトリガーが再マウントされても最新のノードへ戻せる。
  //
  // 到達可否は DOM 接続では判定できない(#377)。display:none / visibility:hidden /
  // disabled / inert 配下の要素への focus() は no-op になるため、実際に activeElement が
  // 移ったかで実測し、移らなければ次の候補へ連鎖する(スペック5 5.2.2)。
  const restoreFocus = useEffectEvent(
    (previouslyFocused: HTMLElement | null) => {
      const candidates = [
        ...new Set([
          returnFocusRef?.current,
          previouslyFocused,
          fallbackFocusRef?.current,
        ]),
      ].filter(isRestoreFocusTarget);
      for (const candidate of candidates) {
        candidate.focus();
        if (candidate.ownerDocument.activeElement === candidate) return;
      }
      // 戻すべき先があったのに一つも到達できなかった場合だけ知らせる(候補が皆無なのは
      // 「開く前からフォーカスがどこにも無かった」ケースで、失われたものが無い)。
      // 呼び出し元が fallbackFocusRef を渡していない/その要素も到達不能という契約違反
      // であり、黙って <body> へ落とさない(スペック5 5.2.2)。
      if (candidates.length > 0 && process.env.NODE_ENV !== "production") {
        console.warn(
          "Modal: フォーカス復帰先の候補がすべて到達不能でした。到達可能な fallbackFocusRef を渡してください(スペック5 5.2.2 / #377)。",
        );
      }
    },
  );

  // Portal の外にあるページ全体を modal の間だけ隔離する。呼び出し元の一部分だけを
  // inert にすると、GameBoard の兄弟（ページヘッダー等）が操作可能なまま残るため、
  // body 直下に portal された overlay 以外を対象にする。既存属性は閉じる際に正確に戻す。
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const overlay = overlayRef.current;
    const dialog = dialogRef.current;
    if (!overlay || !dialog) return;

    const isolated = Array.from(document.body.children)
      .filter(
        (element): element is HTMLElement =>
          element instanceof HTMLElement && element !== overlay,
      )
      .map((element) => ({
        element,
        inert: element.inert,
        inertAttribute: element.hasAttribute("inert"),
        ariaHidden: element.getAttribute("aria-hidden"),
      }));
    for (const { element } of isolated) {
      element.inert = true;
      element.setAttribute("inert", "");
      element.setAttribute("aria-hidden", "true");
    }

    // inert を適用した後にダイアログへ初期フォーカスを移す。
    dialog.focus();

    // inert を実装しない環境や支援技術・スクリプトによる外部 focus() に対しても、
    // modal 外へ出たフォーカスを即座にダイアログへ回収する。
    const keepFocusInside = (event: FocusEvent) => {
      if (event.target instanceof Node && !overlay.contains(event.target)) {
        dialog.focus();
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      requestClose();
    };
    document.addEventListener("focusin", keepFocusInside, true);
    document.addEventListener("keydown", closeOnEscape, true);

    return () => {
      document.removeEventListener("focusin", keepFocusInside, true);
      document.removeEventListener("keydown", closeOnEscape, true);
      for (const { element, inert, inertAttribute, ariaHidden } of isolated) {
        element.inert = inert;
        if (!inertAttribute) element.removeAttribute("inert");
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
      }
      // フォーカス復帰に preventScroll は指定しない。トリガーが可視なら既定の focus() は
      // 何もスクロールしないため #371 の復元位置は保たれ、画面外のときはフォーカスリングの
      // 視認性(spec 5.2.2)を優先してスクロールインさせる。
      restoreFocus(previouslyFocused);
    };
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = focusableElements(dialog);
      // フォーカス可能要素が無ければダイアログ内に留める。
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey) {
        if (active === first || active === dialog) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [],
  );

  // SSR 時(document 不在)は描画しない。呼び出し元はクライアント境界内で使う。
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      // オーバーレイのクリックで閉じる(装飾要素のため presentation)。
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        // ダイアログ内クリックはオーバーレイへ伝播させない(誤クローズ防止)。
        onClick={(event) => event.stopPropagation()}
        // ダイアログ自体は固定し、見出し・閉じる操作が本文スクロールで流れないようにする
        // (#609)。本文だけを下のスクロール領域へ分けることで、狭幅でも操作を常に発見できる。
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-foreground/15 bg-background p-4 shadow-xl"
      >
        <div className="mb-3 flex shrink-0 items-center justify-between gap-4">
          <h2 id={titleId} className="text-base font-bold">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-control-border text-foreground/70 hover:bg-foreground/5"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>
        <div
          className="min-h-0 flex-1 overflow-auto overscroll-contain"
          data-modal-scroll-area
          tabIndex={0}
        >
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
