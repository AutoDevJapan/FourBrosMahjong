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
import { Yuji_Syuku } from "next/font/google";
import Link from "next/link";
import { socialMetadata } from "@/app/_lib/metadata";
import MatchHistoryList from "@/components/history/MatchHistoryList";
import {
  DesignPageShell,
  DesignPanel,
} from "@/components/layout/DesignSurface";
import ScreenNavigation from "@/components/layout/ScreenNavigation";
import { SOSHII_BREAKDOWN_HEADING } from "@/components/result/resultLabels";

// Phase B6画面だけで読み込む筆文字。他routeのfont payloadへ波及させない。
const yujiSyuku = Yuji_Syuku({
  variable: "--font-yuji-syuku",
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  preload: false,
});

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
    <DesignPageShell className={`history-page ${yujiSyuku.variable}`}>
      {/* ページヘッダーは <main> の内側に置く(スペック5 5.2.6)。外に出すと <header> が
          banner ランドマークになり、ルートごとにランドマーク構成が割れる(#431)。 */}
      <main className="history-main" aria-labelledby="history-page-title">
        <header className="history-header">
          <Link href="/" className="history-back-link">
            <span aria-hidden="true">←</span>
            ロビーへ戻る
          </Link>
          <div className="history-heading-copy">
            <p className="history-kicker">対局の記録</p>
            <h1 id="history-page-title" className="history-title">
              戦績
            </h1>
            <p className="history-introduction">
              半荘が終了するたびに、最終順位と
              {SOSHII_BREAKDOWN_HEADING}がこの端末に自動で保存されます。
            </p>
          </div>
        </header>

        <div className="history-screen-navigation">
          <ScreenNavigation currentPath="/history" />
        </div>
        <DesignPanel className="history-panel">
          <MatchHistoryList />
        </DesignPanel>
      </main>
    </DesignPageShell>
  );
}
