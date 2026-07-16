"use client";

/**
 * 設定ページ(`/settings`)。
 *
 * スペック6(`documents/spec/screen-design-and-routing.md` 6.2 / 6.6)で
 * **Client Component** として定義された表示設定画面。現時点の設定項目は
 * ダークモードの手動切替(スペック5 5.4.1)のみ。`localStorage` / `matchMedia`
 * を操作する `ThemeToggle` を内包するためページ全体を Client にしている。
 *
 * 画面遷移(スペック6 6.3): ロビー `/` ⇄ 設定 `/settings`。「戻る」導線を持つ。
 */

import Link from "next/link";
import { ThemeToggle } from "@/components/layout/ThemeToggle";

export default function SettingsPage() {
  return (
    <div className="flex min-h-screen flex-col items-center p-8 sm:p-16">
      <main className="flex w-full max-w-md flex-col gap-10">
        <header className="flex flex-col gap-3">
          <Link
            href="/"
            className="inline-flex w-fit items-center gap-1 rounded-md text-sm text-foreground/70 underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
          >
            <span aria-hidden="true">←</span> ロビーへ戻る
          </Link>
          <h1 className="text-3xl font-bold">設定</h1>
          <p className="text-sm/6 text-foreground/70">
            表示に関する設定を変更できます。
          </p>
        </header>

        <section
          aria-labelledby="appearance-heading"
          className="flex flex-col gap-4"
        >
          <h2 id="appearance-heading" className="text-lg font-semibold">
            表示モード
          </h2>
          <ThemeToggle />
        </section>
      </main>
    </div>
  );
}
