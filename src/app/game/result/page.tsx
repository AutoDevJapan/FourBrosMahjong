/**
 * 結果画面(`/game/result`)。スペック6 6.2 / 6.5 / 6.6。
 *
 * ページ自体は metadata を提供する Server Component とし、親レイアウトの `GameProvider` を読む
 * 対話部分だけを Client Component に分離する。これによりルートレイアウトの title template が適用され、
 * ブラウザタブや履歴でも結果画面を一意に識別できる(issue #166)。
 */
import type { Metadata } from "next";
import { Yuji_Syuku } from "next/font/google";
import { socialMetadata } from "@/app/_lib/metadata";
import ResultPageClient from "./ResultPageClient";

// Phase B5画面だけに筆文字を配信し、対局本体や他routeのfont payloadへ波及させない。
const yujiSyuku = Yuji_Syuku({
  variable: "--font-yuji-syuku",
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  preload: false,
});

const description =
  "四兄弟麻雀の半荘終了後に、最終順位とソシー内訳を確認する対局結果画面です。";

export const metadata: Metadata = {
  title: "対局結果",
  description,
  ...socialMetadata({
    title: "対局結果 | 四兄弟麻雀",
    description,
    path: "/game/result",
  }),
};

export default function ResultPage() {
  return <ResultPageClient fontVariableClassName={yujiSyuku.variable} />;
}
