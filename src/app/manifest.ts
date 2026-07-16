import type { MetadataRoute } from "next";
import { FELT_GREEN } from "@/app/_lib/icon-art";

// PWA web manifest。App Router が自動で <link rel="manifest" href="/manifest.webmanifest"> を出力する。
// カラーは spec 5(documents/spec/ui-accessibility-responsive-darkmode.md)の felt 緑トークンと整合。
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "四兄弟麻雀 - FourBrosMahjong",
    short_name: "四兄弟麻雀",
    description:
      "「ギャンブル四兄弟」の麻雀企画をモチーフにした、関西式三人打ち(サンマ)ベースの四人回し麻雀ゲーム。オール赤5・ガリ(北抜きドラ)・サイコロ連動ドラが特徴の非公式ファンメイド作品です。",
    lang: "ja",
    start_url: "/",
    display: "standalone",
    theme_color: FELT_GREEN,
    background_color: FELT_GREEN,
    categories: ["games"],
    icons: [
      // ブラウザタブと同じ #44 のベクターアイコン(全サイズにスケール)。
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      {
        src: "/icons/icon-192",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      // 中央 60% に収めたデザインのため maskable としても安全に使える。
      {
        src: "/icons/icon-512",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
