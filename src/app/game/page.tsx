import type { Metadata } from "next";
import { Yuji_Syuku } from "next/font/google";
import { socialMetadata } from "@/app/_lib/metadata";
import GameBoard from "@/components/game/GameBoard";
import {
  DesignLinkButton,
  DesignPageShell,
  DesignPanel,
} from "@/components/layout/DesignSurface";
import "./game.css";

// Phase B4の対局画面だけで読み込む筆文字。ほかのrouteへfont payloadを波及させない。
const yujiSyuku = Yuji_Syuku({
  variable: "--font-yuji-syuku",
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  preload: false,
});

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
    <DesignPageShell className={`game-page ${yujiSyuku.variable}`}>
      {/* 本文は単一の <main> に収める(スペック5 5.2.6)。盤面はランドマーク外に置かない。
          ページヘッダー(<h1>)も <main> の内側に置く。外に出すと <header> が banner
          ランドマークになり、ルートごとにランドマーク構成が割れる(#431)。 */}
      <main className="game-main">
        <header className="game-header">
          <div className="game-heading-copy">
            <p className="game-kicker">四人回し・関西式三人打ち</p>
            <h1 className="game-title">対局画面</h1>
          </div>
          <DesignLinkButton href="/" className="game-back-link">
            <span aria-hidden="true">←</span>
            ロビーへ戻る
          </DesignLinkButton>
        </header>

        <DesignPanel className="game-board-panel">
          <GameBoard />
        </DesignPanel>
      </main>
    </DesignPageShell>
  );
}
