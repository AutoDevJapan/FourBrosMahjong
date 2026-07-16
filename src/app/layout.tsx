import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
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
    <html lang="ja" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
