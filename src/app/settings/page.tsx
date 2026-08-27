/**
 * 設定ページ(`/settings`)。
 *
 * スペック6(`documents/spec/screen-design-and-routing.md` 6.2 / 6.6)の表示設定画面。
 * 設定項目はダークモードの手動切替(スペック5 5.4.1)と、四人回しの4人の表示名
 * (issue #291。`localStorage` に保存し次の半荘から `createGame({ names })` へ渡る)。
 *
 * Server/Client 境界(スペック6 6.6「ページ全体を `"use client"` にしない」原則):
 * ブラウザAPI(`localStorage` / `matchMedia`)を操作する対話部分は葉の
 * **Client Component** `ThemeToggle` / `PlayerNamesForm` に閉じており、ページ自体は静的な殻
 * (見出し・ナビゲーション・メタデータ)なので **Server Component** のまま保つ。
 * これにより `metadata`(下記)を export でき、ルート `layout.tsx` の title
 * テンプレート `%s | 四兄弟麻雀` が適用される(Issue #94。Client のままだと
 * `metadata` を持てず `title.default` にフォールバックし `/rules` と不整合になる)。
 *
 * 画面遷移(スペック6 6.3): ロビー `/` ⇄ 設定 `/settings`。「戻る」導線を持つ。
 */

import type { Metadata } from "next";
import { Yuji_Syuku } from "next/font/google";
import { socialMetadata } from "@/app/_lib/metadata";
import {
  DesignLinkButton,
  DesignPageShell,
  DesignPanel,
} from "@/components/layout/DesignSurface";
import ScreenNavigation from "@/components/layout/ScreenNavigation";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { PlayerNamesForm } from "@/components/settings/PlayerNamesForm";

// Phase B2画面だけで読み込む筆文字。ロビーと同じfallback契約を使い、
// root layoutや他routeのfont payloadへ波及させない。
const yujiSyuku = Yuji_Syuku({
  variable: "--font-yuji-syuku",
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  preload: false,
});

const description =
  "四兄弟麻雀の設定。テーマ(システム設定に従う / ライト / ダーク)の手動切替と、四人回しの対局者4人の表示名を変更できます。";

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
    <DesignPageShell className={`settings-page ${yujiSyuku.variable}`}>
      <main className="settings-main">
        <header className="settings-header">
          <DesignLinkButton href="/" className="settings-back-link">
            <span aria-hidden="true">←</span>
            ロビーへ戻る
          </DesignLinkButton>
          <div className="settings-heading-copy">
            <p className="settings-kicker">表示と名前を整える</p>
            <h1 className="settings-title">設定</h1>
            <p className="settings-introduction">
              テーマと四兄弟の表示名を、この端末に保存できます。
            </p>
          </div>
        </header>

        <div className="settings-screen-navigation">
          <ScreenNavigation currentPath="/settings" />
        </div>

        <DesignPanel className="settings-panel">
          <section
            aria-labelledby="appearance-heading"
            className="settings-section"
          >
            <div className="settings-section-heading">
              <p className="settings-section-number" aria-hidden="true">
                01
              </p>
              <div>
                <h2 id="appearance-heading">表示モード</h2>
                <p>画面の明るさを選びます。システム設定への追従もできます。</p>
              </div>
            </div>
            <ThemeToggle />
          </section>

          <div className="settings-divider" aria-hidden="true" />

          <section
            aria-labelledby="players-heading"
            className="settings-section"
          >
            <div className="settings-section-heading">
              <p className="settings-section-number" aria-hidden="true">
                02
              </p>
              <div>
                <h2 id="players-heading">四兄弟の表示名</h2>
                <p>対局中や結果・戦績に表示する名前を変更できます。</p>
              </div>
            </div>
            <PlayerNamesForm />
          </section>

          <div className="settings-divider" aria-hidden="true" />

          <section
            aria-labelledby="history-heading"
            className="settings-history-section"
          >
            <div>
              <h2 id="history-heading">保存済みの戦績</h2>
              <p>
                半荘ごとの結果はこの端末に自動保存されます。閲覧と削除は戦績ページで行えます。
              </p>
            </div>
            <DesignLinkButton href="/history" className="settings-history-link">
              戦績を見る <span aria-hidden="true">→</span>
            </DesignLinkButton>
          </section>
        </DesignPanel>
      </main>
    </DesignPageShell>
  );
}
