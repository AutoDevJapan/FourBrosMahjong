import type { Metadata } from "next";
import { Geist, Geist_Mono, Noto_Sans_JP } from "next/font/google";
import { ThemeStorageSync } from "@/components/layout/ThemeStorageSync";
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

export const metadata: Metadata = {
  title: {
    default: "四兄弟麻雀 - FourBrosMahjong",
    template: "%s | 四兄弟麻雀",
  },
  description:
    "「ギャンブル四兄弟」の麻雀企画をモチーフにした、関西式三人打ち(サンマ)ベースの四人回し麻雀ゲーム。オール赤5・ガリ(北抜きドラ)・サイコロ連動ドラが特徴の非公式ファンメイド作品です。",
};

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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
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
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="antialiased">
        <ThemeStorageSync />
        {children}
      </body>
    </html>
  );
}
