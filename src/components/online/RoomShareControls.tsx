"use client";

import { useRef, useState } from "react";

type FeedbackKind = "success" | "error" | "info";
interface Feedback {
  readonly kind: FeedbackKind;
  readonly message: string;
}

interface RoomShareControlsProps {
  readonly code: string;
  readonly shareUrl: string;
  readonly statusMessage: string;
}

function feedbackClassName(kind: FeedbackKind): string {
  if (kind === "success") return "border-positive text-positive";
  if (kind === "error") return "border-danger text-danger";
  return "border-control-border text-foreground/80";
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}

type ShareCapability = {
  readonly navigator: Navigator;
  readonly share: Navigator["share"];
};

/**
 * Optional browser capabilities can be exposed through throwing accessors in
 * privacy-restricted or embedded runtimes. Discover Web Share inside the same
 * failure boundary as the call so the manual URL fallback remains reachable.
 */
function readShareCapability(): ShareCapability | null {
  if (typeof navigator === "undefined") return null;
  try {
    const nav = navigator;
    const share = nav.share;
    return typeof share === "function" ? { navigator: nav, share } : null;
  } catch {
    return null;
  }
}

export default function RoomShareControls({
  code,
  shareUrl,
  statusMessage,
}: RoomShareControlsProps) {
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [showManualShare, setShowManualShare] = useState(false);
  const manualUrlInputRef = useRef<HTMLInputElement>(null);

  const selectManualUrl = () => {
    const input = manualUrlInputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  };

  const copyRoomCode = async () => {
    try {
      const clipboard =
        typeof navigator !== "undefined" ? navigator.clipboard : undefined;
      if (!clipboard || typeof clipboard.writeText !== "function") {
        throw new Error("Clipboard API is unavailable");
      }
      await clipboard.writeText(code);
      setFeedback({
        kind: "success",
        message: "ルームコードをコピーしました。",
      });
      setShowManualShare(false);
    } catch {
      setFeedback({
        kind: "error",
        message:
          "コピーできませんでした。下の共有URLを選択するか、ルームコードを手動で共有してください。",
      });
      setShowManualShare(true);
    }
  };

  const shareRoom = async () => {
    const capability = readShareCapability();

    if (capability !== null) {
      try {
        await capability.share.call(capability.navigator, {
          title: "四兄弟麻雀のルーム",
          text: `ルームコード: ${code}`,
          url: shareUrl,
        });
        setFeedback({
          kind: "success",
          message: "共有シートを開きました。",
        });
        setShowManualShare(false);
        return;
      } catch (error) {
        if (isAbortError(error)) {
          setFeedback({ kind: "info", message: "共有をキャンセルしました。" });
          return;
        }
      }
    }

    setFeedback({
      kind: capability === null ? "info" : "error",
      message:
        capability === null
          ? "このブラウザでは共有機能を利用できません。下の共有URLを選択して共有してください。"
          : "共有できませんでした。下の共有URLを選択して共有してください。",
    });
    setShowManualShare(true);
  };

  return (
    <div
      className="min-w-0 flex-1"
      role="group"
      aria-labelledby="online-room-code-label"
    >
      <p
        id="online-room-code-label"
        className="text-xs tracking-widest text-foreground/60 uppercase"
      >
        ルームコード
      </p>
      <button
        type="button"
        className="mt-1 inline-flex min-h-11 items-center font-mono text-2xl font-bold tracking-[0.25em]"
        onClick={() => void copyRoomCode()}
        title="クリックしてコピー"
        aria-label={`ルームコード ${code} をコピー`}
      >
        {code}
      </button>
      <p id="online-room-code-hint" className="mt-1 text-xs text-foreground/60">
        {statusMessage}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="min-h-11 rounded-lg border border-control-border px-3 py-2 text-sm font-medium hover:bg-foreground/5"
          onClick={() => void copyRoomCode()}
          aria-describedby="online-room-code-hint"
        >
          コードをコピー
        </button>
        <button
          type="button"
          className="min-h-11 rounded-lg border border-control-border px-3 py-2 text-sm font-medium hover:bg-foreground/5"
          onClick={() => void shareRoom()}
          aria-describedby="online-room-code-hint"
        >
          共有
        </button>
      </div>
      {feedback ? (
        <p
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className={`mt-2 rounded-lg border px-3 py-2 text-sm ${feedbackClassName(feedback.kind)}`}
        >
          {feedback.message}
        </p>
      ) : null}
      {showManualShare ? (
        <div className="mt-3 rounded-lg border border-control-border p-3">
          <p className="text-sm font-medium">手動で共有する場合</p>
          <p className="mt-1 text-xs/5 text-foreground/70">
            URLをタップして選択し、メッセージなどに貼り付けてください。
          </p>
          <label
            htmlFor="online-room-share-url"
            className="mt-2 block text-xs font-medium"
          >
            共有URL
          </label>
          <div className="mt-1 flex min-w-0 flex-wrap gap-2">
            <input
              ref={manualUrlInputRef}
              id="online-room-share-url"
              type="url"
              value={shareUrl}
              readOnly
              onFocus={(event) => event.currentTarget.select()}
              onClick={(event) => event.currentTarget.select()}
              className="min-h-11 min-w-0 flex-1 rounded-lg border border-control-border bg-transparent px-3 py-2 text-sm"
            />
            <button
              type="button"
              className="min-h-11 rounded-lg border border-control-border px-3 py-2 text-sm font-medium hover:bg-foreground/5"
              onClick={selectManualUrl}
            >
              URLを選択
            </button>
          </div>
          <p className="mt-2 text-xs/5 text-foreground/70">
            URLを使わない場合は、コード「{code}」を手動で伝えてください。
          </p>
        </div>
      ) : null}
    </div>
  );
}
