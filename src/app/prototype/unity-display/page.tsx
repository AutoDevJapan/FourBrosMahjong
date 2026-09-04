import type { Metadata } from "next";
import { Yuji_Syuku } from "next/font/google";
import { socialMetadata } from "@/app/_lib/metadata";
import UnityDisplayReference from "@/components/prototype/UnityDisplayReference";
import "../../game/game.css";
import "./unity-display.css";

const yujiSyuku = Yuji_Syuku({
  variable: "--font-yuji-syuku",
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  preload: false,
});

const description =
  "Unity導入前に四兄弟麻雀の表示契約と対局演出を確認するブラウザ・リファレンスです。";

export const metadata: Metadata = {
  title: "Unity表示リファレンス",
  description,
  ...socialMetadata({
    title: "Unity表示リファレンス | 四兄弟麻雀",
    description,
    path: "/prototype/unity-display",
  }),
};

/** #828: Unity Editorなしで表示契約を確認する専用リファレンス入口。 */
export default function UnityDisplayPrototypePage() {
  return <UnityDisplayReference fontVariableClassName={yujiSyuku.variable} />;
}
