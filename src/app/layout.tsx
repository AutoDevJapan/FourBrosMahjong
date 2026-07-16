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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
