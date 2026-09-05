import type { Metadata } from "next";
import { Yuji_Syuku } from "next/font/google";
import { HOME_SOCIAL_METADATA } from "@/app/_lib/metadata";
import LobbyPage from "@/components/lobby/LobbyPage";

// Phase B1画面だけで読み込む筆文字。preloadせず、初回offline時はCSSの明示的な
// Mincho fallbackで可読性とlayoutを保つ（SWへ大きなCJK fontを追加しない）。
const yujiSyuku = Yuji_Syuku({
  variable: "--font-yuji-syuku",
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  preload: false,
});

export const metadata: Metadata = HOME_SOCIAL_METADATA;

export default function Home() {
  return <LobbyPage fontVariableClassName={yujiSyuku.variable} />;
}
