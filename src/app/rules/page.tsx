import type { Metadata } from "next";
import { Yuji_Syuku } from "next/font/google";
import { socialMetadata } from "@/app/_lib/metadata";
import RulesPage from "@/components/rules/RulesPage";

// Phase B3画面だけで読み込む筆文字。Lobby/Settingsと同じfallback契約を使い、
// root layoutや他routeのfont payloadへ波及させない。
const yujiSyuku = Yuji_Syuku({
  variable: "--font-yuji-syuku",
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  preload: false,
});

const description =
  "四兄弟麻雀(関西式サンマ・四人回し)のルール要約。オール赤5・ガリ(北抜きドラ)・サイコロ連動ドラ・ソシー精算などの独自ルールを説明します。";

export const metadata: Metadata = {
  title: "ルール説明",
  description,
  ...socialMetadata({
    title: "ルール説明 | 四兄弟麻雀",
    description,
    path: "/rules",
  }),
};

/** `/rules` は保存状態を持たない静的なServer Componentとして提供する。 */
export default function Page() {
  return <RulesPage fontVariableClassName={yujiSyuku.variable} />;
}
