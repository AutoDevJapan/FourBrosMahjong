/**
 * 結果画面(`/game/result`)。スペック6 6.2 / 6.5 / 6.6。
 *
 * ページ自体は metadata を提供する Server Component とし、親レイアウトの `GameProvider` を読む
 * 対話部分だけを Client Component に分離する。これによりルートレイアウトの title template が適用され、
 * ブラウザタブや履歴でも結果画面を一意に識別できる(issue #166)。
 */
import type { Metadata } from "next";
import { socialMetadata } from "@/app/_lib/metadata";
import ResultPageClient from "./ResultPageClient";

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
  return <ResultPageClient />;
}
