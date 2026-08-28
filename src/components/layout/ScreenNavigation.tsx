"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

type ScreenDestination = {
  href: string;
  label: string;
  description: string;
};

const SCREEN_DESTINATIONS: readonly ScreenDestination[] = [
  {
    href: "/game",
    label: "対局を開始",
    description: "新しい半荘を始める",
  },
  {
    href: "/online",
    label: "オンライン対戦",
    description: "ルームコードで友人と対局する",
  },
  {
    href: "/rules",
    label: "ルール説明",
    description: "独自ルールの要約を読む",
  },
  {
    href: "/history",
    label: "戦績",
    description: "保存された半荘結果を確認する",
  },
  {
    href: "/settings",
    label: "設定",
    description: "表示モードと対局者名を変更する",
  },
];

export interface ScreenNavigationProps {
  /** 現在の画面自身をリンク一覧から除き、同じ場所への不要な遷移を防ぐ。 */
  readonly currentPath: string;
  /** 結果画面では「もう一半荘」ボタンを優先し、対局開始リンクを表示しない。 */
  readonly showGameLink?: boolean;
}

/**
 * 情報系の内部画面間を直接移動する共通ナビゲーション。
 *
 * `/game` の対局中画面には置かず、対局を離れる導線を増やさない。`details` を使った
 * 折りたたみ式にすることで、狭い画面でも本文を圧迫せず、summary とリンクは通常の
 * キーボードフォーカス順に参加する。
 */
export default function ScreenNavigation({
  currentPath,
  showGameLink = true,
}: ScreenNavigationProps) {
  const navigationRef = useRef<HTMLElement>(null);
  const destinations = SCREEN_DESTINATIONS.filter(
    (destination) =>
      destination.href !== currentPath &&
      (showGameLink || destination.href !== "/game"),
  );

  useEffect(() => {
    const navigation = navigationRef.current;
    if (!navigation) return;
    navigation.setAttribute("data-navigation-hydrated", "true");
    return () => navigation.removeAttribute("data-navigation-hydrated");
  }, []);

  return (
    <nav ref={navigationRef} aria-label="画面メニュー">
      <details className="rounded-lg border border-control-border">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm font-medium hover:bg-foreground/5 focus-visible:rounded-lg [&::-webkit-details-marker]:hidden">
          <span>他の画面へ</span>
          <span aria-hidden="true" className="text-base text-foreground/70">
            ▾
          </span>
        </summary>
        <div className="border-t border-control-border p-3">
          <p className="text-xs/5 text-foreground/70">
            対局中はこのメニューを表示しません。画面を移動すると、現在の入力内容が失われる場合があります。
          </p>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {destinations.map((destination) => (
              <li key={destination.href}>
                <Link
                  href={destination.href}
                  className="flex min-h-11 items-center justify-between gap-3 rounded-md border border-control-border px-3 py-2 text-sm hover:bg-foreground/5 focus-visible:rounded-md"
                >
                  <span>
                    <span className="block font-medium">
                      {destination.label}
                    </span>
                    <span className="mt-0.5 block text-xs/4 text-foreground/70">
                      {destination.description}
                    </span>
                  </span>
                  <span
                    aria-hidden="true"
                    className="shrink-0 text-foreground/70"
                  >
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </details>
    </nav>
  );
}
