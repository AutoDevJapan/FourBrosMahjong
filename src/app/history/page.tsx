/**
 * 戦績ページ(`/history`)。issue #293 / スペック6 6.2。
 *
 * `localStorage` に保存された半荘結果(最終順位・ソシー内訳・終了日時)を新しい順に
 * 一覧・閲覧し、全件削除できる。保存はこの端末のブラウザ内で完結する(スペック6 6.9)。
 *
 * Server/Client 境界(スペック6 6.6): ページ自体は metadata と静的な殻を提供する
 * Server Component とし、`localStorage` を読む対話部分だけを Client Component
 * `MatchHistoryList` に分離する。これによりルートレイアウトの title template が適用される。
 */
import type { Metadata } from "next";
import Link from "next/link";
import { socialMetadata } from "@/app/_lib/metadata";
import MatchHistoryList from "@/components/history/MatchHistoryList";
import ScreenNavigation from "@/components/layout/ScreenNavigation";

const description =
  "四兄弟麻雀でこの端末に保存された半荘ごとの戦績(最終順位・ソシー内訳)を新しい順に閲覧できます。";

export const metadata: Metadata = {
  title: "戦績",
  description,
  ...socialMetadata({
    title: "戦績 | 四兄弟麻雀",
    description,
    path: "/history",
  }),
};

export default function HistoryPage() {
  return (
    <div className="mx-auto min-h-screen w-full max-w-3xl p-4 sm:p-6">
      {/* ページヘッダーは <main> の内側に置く(スペック5 5.2.6)。外に出すと <header> が
          banner ランドマークになり、ルートごとにランドマーク構成が割れる(#431)。 */}
      <main className="flex flex-col gap-6">
        <header className="flex flex-col gap-3">
          <Link
            href="/"
            className="inline-flex min-h-11 w-fit items-center gap-1 rounded-md text-sm text-foreground/70 underline-offset-4 hover:underline"
          >
            <span aria-hidden="true">←</span> ロビーへ戻る
          </Link>
          <h1 className="text-xl font-bold sm:text-2xl">戦績</h1>
          <p className="text-sm/6 text-foreground/70">
            半荘が終了するたびに、最終順位とソシー内訳(素点+ウマ+祝儀)がこの端末に自動で保存されます。
          </p>
        </header>

        <ScreenNavigation currentPath="/history" />
        <MatchHistoryList />
      </main>
    </div>
  );
}
