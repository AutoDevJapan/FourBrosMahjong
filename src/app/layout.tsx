import type { Metadata } from "next";
import { Geist, Geist_Mono, Noto_Sans_JP } from "next/font/google";
import { headers } from "next/headers";
import { ROOT_METADATA } from "@/app/_lib/metadata";
import { ThemeStorageSync } from "@/components/layout/ThemeStorageSync";
import { ServiceWorkerRegister } from "@/components/pwa/ServiceWorkerRegister";
import "./globals.css";

// 欧文フォント(ラテン)。和文グリフは持たないため、日本語は下記 Noto Sans JP に
// フォールバックさせる(font-family スタックは globals.css の @theme --font-sans を参照)。
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

// 和文フォント(本アプリは日本語 UI)。`next/font` がビルド時に取得・セルフホストするため
// CDN 直リンク依存はなく、`display: "swap"` で FOUT/レイアウトシフトを抑える。
// CJK は字数が多くプリロードすると巨大になるため `preload: false`(Next.js の CJK 推奨設定)。
const notoSansJP = Noto_Sans_JP({
  variable: "--font-noto-sans-jp",
  subsets: ["latin"],
  display: "swap",
  preload: false,
});

export const metadata: Metadata = ROOT_METADATA;

/**
 * 初期テーマ適用スクリプト(スペック5 5.4.1)。
 *
 * React のハイドレーション前に同期実行し、`localStorage` に保存された手動選択を
 * `<html data-theme>` へ反映する。これにより最初の描画から正しいテーマが適用され、
 * FOUC(一瞬ライトで表示される)を防ぐ。未選択(system)の場合は属性を付与せず
 * `prefers-color-scheme` に委譲する。属性は JSX では描画しないため、React は
 * この属性を管理下に置かずハイドレーション不一致の警告も出ない
 * (念のため `<html>` に `suppressHydrationWarning` を付与)。
 */
const themeInitScript = `(function(){try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t);}}catch(e){}})();`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // src/proxy.ts generates this nonce and also puts it in the CSP request
  // header, which makes Next.js apply the same nonce to its framework scripts.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    // フォント変数(--font-geist-sans / --font-geist-mono / --font-noto-sans-jp)は
    // <html> に付与する。Tailwind v4 が @theme の --font-sans から導出する
    // --default-font-family は :root/html に適用されるため、これらの変数も html 上で
    // 定義されていないとフォントスタックが解決できず総称フォントへ退化する(Issue #72)。
    <html
      lang="ja"
      className={`${geistSans.variable} ${geistMono.variable} ${notoSansJP.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script
          nonce={nonce}
          // Browsers deliberately hide nonce values from DOM attribute reads;
          // React therefore observes an empty client value during hydration.
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: themeInitScript }}
        />
      </head>
      <body className="antialiased">
        <ThemeStorageSync />
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  );
}
