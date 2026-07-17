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
import { useCallback, useEffect, useId, useRef } from "react";
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
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // 開いている間だけ、開く前のフォーカス位置を退避し、閉じたら復帰する。
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    // ダイアログ自体へ初期フォーカスを移す(トラップの起点)。
    dialogRef.current?.focus();
    return () => {
      previouslyFocused?.focus?.();
    };
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
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
    [onClose],
  );

  // SSR 時(document 不在)は描画しない。呼び出し元はクライアント境界内で使う。
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
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
