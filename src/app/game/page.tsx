import type { Metadata } from "next";
import Link from "next/link";
import GameBoard from "@/components/game/GameBoard";
import { socialMetadata } from "@/app/_lib/metadata";

const description =
  "関西式三人打ちをベースにした四人回しの四兄弟麻雀をプレイする対局画面です。";

/**
 * 対局画面(`/game`)。スペック6 6.6 の「Server shell + Client island」構成。
 *
 * ページ自体は Server Component の静的な殻(見出し・ナビゲーション)に留め、卓の操作領域は
 * クライアントアイランド `<GameBoard>` に切り出す。対局のビュー状態は親レイアウトの
 * `GameProvider` が保持し、`<GameBoard>` がコンテキストから読み取る(スペック6 6.5)。
 *
 * 卓の表示内容は `GameProvider` が保持する実対局エンジンの状態から写像される(スペック6 6.8)。
 */
export const metadata: Metadata = {
  title: "対局",
  description,
  ...socialMetadata({
    title: "対局 | 四兄弟麻雀",
    description,
    path: "/game",
  }),
};

export default function GamePage() {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-4 p-4 sm:p-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-bold sm:text-2xl">対局画面</h1>
        <Link
          href="/"
          className="rounded-full border border-foreground/25 px-3 py-1.5 text-sm hover:bg-foreground/5"
        >
          ロビーへ戻る
        </Link>
      </header>

      <GameBoard />
    </div>
  );
}
