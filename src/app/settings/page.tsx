/**
 * 設定ページ(`/settings`)。
 *
 * スペック6(`documents/spec/screen-design-and-routing.md` 6.2 / 6.6)の表示設定画面。
 * 現時点の設定項目はダークモードの手動切替(スペック5 5.4.1)のみ。
 *
 * Server/Client 境界(スペック6 6.6「ページ全体を `"use client"` にしない」原則):
 * ブラウザAPI(`localStorage` / `matchMedia`)を操作する対話部分は葉の
 * **Client Component** `ThemeToggle` に閉じており、ページ自体は静的な殻
 * (見出し・ナビゲーション・メタデータ)なので **Server Component** のまま保つ。
 * これにより `metadata`(下記)を export でき、ルート `layout.tsx` の title
 * テンプレート `%s | 四兄弟麻雀` が適用される(Issue #94。Client のままだと
 * `metadata` を持てず `title.default` にフォールバックし `/rules` と不整合になる)。
 *
 * 画面遷移(スペック6 6.3): ロビー `/` ⇄ 設定 `/settings`。「戻る」導線を持つ。
 */

import type { Metadata } from "next";
import Link from "next/link";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { socialMetadata } from "@/app/_lib/metadata";

const description =
  "四兄弟麻雀の表示設定。テーマ(システム設定に従う / ライト / ダーク)の手動切替ができます。";

export const metadata: Metadata = {
  // layout.tsx の title テンプレート `%s | 四兄弟麻雀` により
  // 「設定 | 四兄弟麻雀」として出力される(`/rules` と一貫)。
  title: "設定",
  description,
  ...socialMetadata({
    title: "設定 | 四兄弟麻雀",
    description,
    path: "/settings",
  }),
};

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

        <section
          aria-labelledby="history-heading"
          className="flex flex-col gap-4"
        >
          <h2 id="history-heading" className="text-lg font-semibold">
            戦績
          </h2>
          <p className="text-sm/6 text-foreground/70">
            半荘ごとの結果(最終順位・ソシー内訳)はこの端末に自動保存されます。閲覧と削除は戦績ページから行えます。
          </p>
          <Link
            href="/history"
            className="inline-flex w-fit items-center gap-1 rounded-full border border-foreground/25 px-4 py-2 text-sm hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
          >
            戦績を見る <span aria-hidden="true">→</span>
          </Link>
        </section>
      </main>
    </div>
  );
}
