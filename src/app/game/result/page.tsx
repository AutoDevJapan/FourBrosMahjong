/**
 * 結果画面(`/game/result`)。スペック6 6.2 / 6.5 / 6.6。
 *
 * ページ自体は metadata を提供する Server Component とし、親レイアウトの `GameProvider` を読む
 * 対話部分だけを Client Component に分離する。これによりルートレイアウトの title template が適用され、
 * ブラウザタブや履歴でも結果画面を一意に識別できる(issue #166)。
 */
import type { Metadata } from "next";
import ResultPageClient from "./ResultPageClient";

export const metadata: Metadata = {
  title: "対局結果",
};

export default function ResultPage() {
  return <ResultPageClient />;
}
