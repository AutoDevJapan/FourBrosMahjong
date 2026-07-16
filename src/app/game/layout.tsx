"use client";

/**
 * `/game` 配下の共有レイアウト(スペック6 6.5 / 6.6)。
 *
 * 対局状態を保持する `GameProvider`(Client)をここに置くことで、`/game`(対局画面)と
 * `/game/result`(結果画面。実装は別issue #54)がネストされたこのレイアウト配下で同一の
 * プロバイダインスタンスを共有し、ページ遷移してもメモリ内状態が保持される(スペック6 6.5)。
 *
 * このレイアウトはクライアント状態の境界だが、配下の `page.tsx` は Server Component のまま
 * `children` として差し込まれるため、ページ全体がクライアント化するわけではない(スペック6 6.6)。
 */
import { GameProvider } from "@/components/game/GameProvider";

export default function GameLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <GameProvider>{children}</GameProvider>;
}
