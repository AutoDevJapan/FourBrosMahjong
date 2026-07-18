"use client";

/**
 * アクセシブルなモーダルダイアログ(スペック5 5.2.2)。
 *
 * - `role="dialog"` + `aria-modal="true"` + `aria-labelledby`(見出し)で表明する。
 * - **フォーカストラップ**: 開いた瞬間にダイアログへフォーカスを移し、`Tab`/`Shift+Tab` は
 *   ダイアログ内の可視フォーカス可能要素を循環させて外へ出さない。
 * - **`Escape` で閉じる**、背景(オーバーレイ)クリックでも閉じる。
 * - 閉じたら**開く前のフォーカス位置へ戻す**(呼び出し元のトリガーへ復帰)。
 *
 * 卓UIの「全体盤面」等をスタッキング順の影響を受けずに最前面へ出すため `document.body` へ
 * ポータルする。表示制御(開閉状態)は呼び出し元が持ち、本コンポーネントは開いている間だけ描画する。
 */
import { useCallback, useEffect, useEffectEvent, useId, useRef } from "react";
import { createPortal } from "react-dom";

export interface ModalProps {
  /** ダイアログの見出し(`aria-labelledby` の対象)。 */
  title: string;
  /** 閉じる要求(`Escape`・オーバーレイクリック・閉じるボタン)。 */
  onClose: () => void;
  children: React.ReactNode;
}

/**
 * ダイアログ内のフォーカス可能要素を DOM 順で列挙する。
 * `hidden` 属性の要素のみ除外する(レイアウト依存の可視判定は使わず、
 * jsdom を含め環境非依存でトラップの端点を求められるようにする)。
 */
function focusableElements(root: HTMLElement): HTMLElement[] {
  const nodes = root.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
  );
  return Array.from(nodes).filter((el) => !el.hidden);
}

export default function Modal({ title, onClose, children }: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const requestClose = useEffectEvent(onClose);
  const titleId = useId();

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
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
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
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-auto rounded-xl border border-foreground/15 bg-background p-4 shadow-xl"
      >
        <div className="mb-3 flex items-center justify-between gap-4">
          <h2 id={titleId} className="text-base font-bold">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-foreground/25 text-foreground/70 hover:bg-foreground/5"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
